import * as THREE from 'three'
import { CampaignGateController } from '../campaign/CampaignGate'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { createPalisadeSegment, createPalisadeStakeGeometry } from '../world/PalisadeSegment'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { TOWN_CITY, TOWN_GATES, type TownGateId } from './TownLayout'

/** All obstacles share TownWorld's live array, also used by mounts, navigation and shots. */
export function createTownFortifications(faction: CharacterFaction, obstacles: ObstacleData[], materials: {
  stone: THREE.Material; wood: THREE.Material; dark: THREE.Material; snow: THREE.Material
}) {
  const root = new THREE.Group(); root.name = `town-fortifications-${faction}`
  const gates = new Map<TownGateId, CampaignGateController>()
  const walls: ObstacleData[] = []
  const palisadeInstances: THREE.InstancedMesh[] = []
  const wallRoot = new THREE.Group(); wallRoot.name = 'town-static-walls'; root.add(wallRoot)
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  const stakeGeometry = faction === 'viking' ? createPalisadeStakeGeometry(TOWN_CITY.wallHeight, .5) : undefined
  const cube = (parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(boxGeometry, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d)
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  for (const gate of TOWN_GATES) {
    const horizontal = gate.id === 'north' || gate.id === 'south'
    const start = horizontal ? TOWN_CITY.minX : TOWN_CITY.minZ
    const end = horizontal ? TOWN_CITY.maxX : TOWN_CITY.maxZ
    const center = horizontal ? gate.x : gate.z
    for (const [low, high] of [[start, center - TOWN_CITY.gateWidth / 2], [center + TOWN_CITY.gateWidth / 2, end]]) {
      const count = Math.ceil((high - low) / 20), span = (high - low) / count
      for (let i = 0; i < count; i++) {
        const along = low + span * (i + .5), x = horizontal ? along : gate.x, z = horizontal ? gate.z : along
        const w = horizontal ? span : TOWN_CITY.wallThickness, d = horizontal ? TOWN_CITY.wallThickness : span
        let collision: THREE.Box3
        if (stakeGeometry) {
          const segment = createPalisadeSegment({ name: `town-wall-${gate.id}-${low}-${i}`, x, z, widthX: w, depthZ: d,
            height: TOWN_CITY.wallHeight, stakeGeometry, woodMaterial: materials.wood, railMaterial: materials.dark, spacing: .65, railRadius: .18, railOffset: .6 })
          for (const mesh of [...segment.root.children]) {
            if (mesh instanceof THREE.InstancedMesh) palisadeInstances.push(mesh)
            else wallRoot.add(mesh)
          }
          collision = segment.box
          // Broad snow caps retain the snowy settlement palette without multiplying stake meshes.
          cube(wallRoot, x, getTerrainHeight(x, z) + TOWN_CITY.wallHeight - .8, z, w, .18, d, materials.snow)
        } else {
          const heights = [low + span * i, along, low + span * (i + 1)].map(value => getTerrainHeight(horizontal ? value : x, horizontal ? z : value))
          const base = Math.min(...heights) - 1, top = Math.max(...heights) + TOWN_CITY.wallHeight
          cube(wallRoot, x, (base + top) / 2, z, w, top - base, d, materials.stone)
          cube(wallRoot, x, top + .1, z, w + .05, .35, d + .3, materials.stone)
          for (let merlon = 1; merlon < span; merlon += 3) cube(wallRoot, horizontal ? low + i * span + merlon : x,
            top + .65, horizontal ? z : low + i * span + merlon, horizontal ? 1.4 : d, 1, horizontal ? d : 1.4, materials.stone)
          collision = new THREE.Box3(new THREE.Vector3(x - w / 2, base, z - d / 2), new THREE.Vector3(x + w / 2, top + 1.2, z + d / 2))
        }
        const obstacle = { box: collision, isBarricade: false }; obstacles.push(obstacle); walls.push(obstacle)
      }
    }
    const gateRoot = new THREE.Group(); gateRoot.name = `town-${gate.id}-gate`; gateRoot.position.set(gate.x, getTerrainHeight(gate.x, gate.z), gate.z); gateRoot.rotation.y = gate.yaw; root.add(gateRoot)
    const localBox = (x: number, y: number, w: number, h: number, d: number) => {
      const box = new THREE.Box3(new THREE.Vector3(x - w / 2, y, -d / 2), new THREE.Vector3(x + w / 2, y + h, d / 2))
      gateRoot.updateMatrixWorld(true); box.applyMatrix4(gateRoot.matrixWorld); obstacles.push({ box, isBarricade: false })
    }
    for (const side of [-1, 1]) {
      cube(gateRoot, side * 7.9, 2, 0, 1.8, 4, 2.4, faction === 'roman' ? materials.stone : materials.dark)
      localBox(side * 7.9, -1, 1.8, 5, 2.4)
    }
    if (faction === 'roman') {
      // Elliptical barrel arch: masonry ring around an actual opening, never a flat lintel.
      const shape = new THREE.Shape()
      shape.moveTo(8.8, 4)
      shape.absellipse(0, 4, 8.8, 4.5, 0, Math.PI, false, 0)
      shape.lineTo(-7, 4)
      shape.absellipse(0, 4, 7, 3, Math.PI, 0, true, 0); shape.closePath()
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false, curveSegments: 24 })
      geometry.translate(0, 0, -1.2)
      const arch = new THREE.Mesh(geometry, materials.stone); arch.name = 'roman-stone-arch'; arch.castShadow = arch.receiveShadow = true; gateRoot.add(arch)
      // Overhead projectile volumes must not become a navigation blocker across the door.
      const boxes: THREE.Box3[] = []
      gateRoot.updateMatrixWorld(true)
      for (let i = 0; i < 28; i++) {
        const x = -7 + i * .5, innerY = 4 + 3 * Math.sqrt(Math.max(0, 1 - Math.min(Math.abs(x), Math.abs(x + .5)) ** 2 / 49))
        boxes.push(new THREE.Box3(new THREE.Vector3(x, innerY, -1.2), new THREE.Vector3(x + .5, 8.5, 1.2)).applyMatrix4(gateRoot.matrixWorld))
      }
      // Arch pieces retain their height for body/projectile collision; ground navigation uses the jamb.
      const jambBox = new THREE.Box3(new THREE.Vector3(7, -1, -1.2), new THREE.Vector3(8.8, 8.5, 1.2)).applyMatrix4(gateRoot.matrixWorld)
      for (const box of boxes) obstacles.push({ box, isBarricade: false, navigationBox: jambBox })
    } else {
      for (const side of [-1, 1]) {
        cube(gateRoot, side * 7.9, 6, 0, 1.8, 4, 2.4, materials.dark)
        localBox(side * 7.9, 4, 1.8, 4, 2.4)
      }
      cube(gateRoot, 0, 7.5, 0, 17.6, .7, 2.4, materials.dark)
      cube(gateRoot, 0, 8, 0, 17.8, .2, 2.5, materials.snow)
      const lintel = new THREE.Box3(new THREE.Vector3(-8.8, 7.15, -1.2), new THREE.Vector3(8.8, 8.2, 1.2)).applyMatrix4(gateRoot.matrixWorld)
      const jamb = new THREE.Box3(new THREE.Vector3(7, -1, -1.2), new THREE.Vector3(8.8, 8.2, 1.2)).applyMatrix4(gateRoot.matrixWorld)
      obstacles.push({ box: lintel, projectileBoxes: [lintel], navigationBox: jamb, isBarricade: false })
    }
    const leaves = new THREE.Group(); leaves.name = `town-${gate.id}-gate-leaves`; gateRoot.add(leaves)
    const hinges = [-1, 1].map(side => {
      const hinge = new THREE.Group(); hinge.position.x = side * 7; leaves.add(hinge)
      if (faction === 'roman') {
        const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(-side * 7, 0)
        for (let i = 14; i >= 0; i--) { const length = i / 2, worldX = 7 - length; shape.lineTo(-side * length, 4 + 3 * Math.sqrt(Math.max(0, 1 - worldX ** 2 / 49))) }
        shape.closePath()
        const geo = new THREE.ExtrudeGeometry(shape, { depth: .6, bevelEnabled: false }); geo.translate(0, 0, -.3)
        const mesh = new THREE.Mesh(geo, materials.wood); mesh.castShadow = mesh.receiveShadow = true; hinge.add(mesh)
      } else cube(hinge, -side * 3.5, 3, 0, 7, 6, .7, materials.wood)
      for (const y of [1, 3]) cube(hinge, -side * 3.5, y, .4, 6.8, .2, .16, materials.dark)
      return hinge
    })
    gateRoot.updateMatrixWorld(true)
    const gateHeight = faction === 'roman' ? 7 : TOWN_CITY.gateHeight
    const collisionBox = new THREE.Box3(new THREE.Vector3(-7, -1, -.5), new THREE.Vector3(7, gateHeight, .5)).applyMatrix4(gateRoot.matrixWorld)
    const damageable = new DamageableObstacle({ kind: 'gate', maxHp: 520 * 4, root: leaves, ownerFaction: faction })
    const obstacle = { box: collisionBox, isBarricade: false, damageable }; obstacles.push(obstacle)
    gates.set(gate.id, new CampaignGateController({ defenderFaction: faction, damageable, obstacle, obstacles,
      leftHinge: hinges[0], rightHinge: hinges[1], openRotationY: Math.PI / 2, initialState: 'open' }))
  }
  if (stakeGeometry) {
    const count = palisadeInstances.reduce((sum, mesh) => sum + mesh.count, 0)
    const stakes = new THREE.InstancedMesh(stakeGeometry, materials.wood, count)
    stakes.name = 'town-palisade-stakes'; stakes.castShadow = stakes.receiveShadow = true
    const matrix = new THREE.Matrix4(), color = new THREE.Color()
    let slot = 0
    for (const mesh of palisadeInstances) {
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, matrix); stakes.setMatrixAt(slot, matrix); mesh.getColorAt(i, color); stakes.setColorAt(slot++, color) }
      mesh.dispose()
    }
    stakes.instanceMatrix.needsUpdate = true; stakes.computeBoundingSphere(); wallRoot.add(stakes)
  }
  return { root, wallRoot, gates, walls }
}
