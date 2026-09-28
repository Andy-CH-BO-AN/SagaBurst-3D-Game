import * as THREE from 'three'
import { createCampfireVisual, createChevalVisual, createTentVisual, timberMaterial, bakedMesh, beamBetween } from '../world/EnvironmentVisuals'
import {
  getTerrainHeight,
  removeObstacleData,
  type ObstacleData,
} from '../world/Terrain'
import {
  DAMAGEABLE_OBSTACLE_HP,
  DamageableObstacle,
  type DamageableObstacleKind,
} from '../world/DamageableObstacle'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { CampaignBreachController, CampaignGateController } from './CampaignGate'

export const CAMPAIGN_OUTPOST_LAYOUT = {
  centerX: 0,
  frontDistance: 108,
  backDistance: 180,
  halfWidth: 44,
  gateWidth: 8,
  stakeLineDistance: 115,
} as const

// Canonical humanoid heights are 1.86m Viking / 1.78m Roman.
// Keep the defender palisade 0.40m below the matching archer height so
// defenders can visually and physically shoot over it without firing gaps.
export const CAMPAIGN_STRUCTURE_HP_MULTIPLIER = {
  palisade: 4,
  gate: 4,
} as const

export const CAMPAIGN_PALISADE_HEIGHT = {
  viking: 1.46,
  roman: 1.38,
} as const

export function getCampaignDefenderFacingYaw(
  defenderFaction: CharacterFaction,
): number {
  // Campaign outposts mirror across Z. Roman defenders at -Z face +Z toward
  // the front gate; Viking defenders at +Z face -Z.
  return defenderFaction === 'roman' ? 0 : Math.PI
}

export interface CampaignOutpostPlacement {
  centerX: number
  frontZ: number
  backZ: number
  halfWidth: number
  gateWidth: number
  stakeLineZ: number
}

export function getCampaignOutpostPlacement(
  defenderFaction: CharacterFaction,
): CampaignOutpostPlacement {
  const zSign = defenderFaction === 'roman' ? -1 : 1
  return {
    centerX: CAMPAIGN_OUTPOST_LAYOUT.centerX,
    frontZ: CAMPAIGN_OUTPOST_LAYOUT.frontDistance * zSign,
    backZ: CAMPAIGN_OUTPOST_LAYOUT.backDistance * zSign,
    halfWidth: CAMPAIGN_OUTPOST_LAYOUT.halfWidth,
    gateWidth: CAMPAIGN_OUTPOST_LAYOUT.gateWidth,
    stakeLineZ: CAMPAIGN_OUTPOST_LAYOUT.stakeLineDistance * zSign,
  }
}

export interface CampaignOutpostCollections {
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
}

export interface CampaignOutpostResult {
  root: THREE.Group
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
  damageableObstacles: DamageableObstacle[]
  gate: DamageableObstacle
  gateController: CampaignGateController
  breachController: CampaignBreachController
}

interface DamageablePieceOptions {
  kind: DamageableObstacleKind
  root: THREE.Object3D
  hitMeshes: readonly THREE.Object3D[]
  box: THREE.Box3
  isBarricade: boolean
  projectileBoxes?: readonly THREE.Box3[]
}

/**
 * Builds the shared Campaign outpost around the existing camp/armory/stable area.
 *
 * Custom Battle does not call this builder. Defense/Offense Campaign runtime can opt into the
 * outpost without changing the existing shared map or battle spawner.
 */
export function createCampaignOutpost(
  scene: THREE.Scene,
  defenderFaction: CharacterFaction,
  collections?: CampaignOutpostCollections,
): CampaignOutpostResult {
  const root = new THREE.Group()
  root.name = `campaign-outpost-${defenderFaction}`
  scene.add(root)

  // Campaign runtime should pass the same arrays used by NPC navigation and
  // projectile collision. This guarantees destruction removes the live obstacle
  // rather than only mutating a detached copy.
  const obstacles = collections?.obstacles ?? []
  const obstacleMeshes = collections?.obstacleMeshes ?? []
  const damageableObstacles: DamageableObstacle[] = []
  const breachController = new CampaignBreachController()

  const woodMaterial = timberMaterial(0x827058)
  const darkWoodMaterial = timberMaterial(0x514333)
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const palisadeHeight = CAMPAIGN_PALISADE_HEIGHT[defenderFaction]
  const palisadeStakeGeometry = new THREE.CylinderGeometry(0.11, 0.15, palisadeHeight, 7, 2)
  // Shape each stake into a hewn point while retaining the exact wall height.
  const stakePositions = palisadeStakeGeometry.getAttribute('position')
  for (let i = 0; i < stakePositions.count; i++) {
    if (Math.abs(stakePositions.getY(i)) < 0.001) {
      stakePositions.setY(i, palisadeHeight / 2 - 0.18)
    } else if (stakePositions.getY(i) > palisadeHeight * 0.49) {
      stakePositions.setX(i, stakePositions.getX(i) * 0.16)
      stakePositions.setZ(i, stakePositions.getZ(i) * 0.16)
    }
  }
  palisadeStakeGeometry.computeVertexNormals()

  const unregisterHitMeshes = (hitMeshes: readonly THREE.Object3D[]): void => {
    for (const mesh of hitMeshes) {
      const index = obstacleMeshes.indexOf(mesh)
      if (index >= 0) obstacleMeshes.splice(index, 1)
    }
  }

  const registerDamageablePiece = (options: DamageablePieceOptions): DamageableObstacle => {
    const damageable = new DamageableObstacle({
      kind: options.kind,
      maxHp: DAMAGEABLE_OBSTACLE_HP[options.kind]
        * (options.kind === 'palisade' || options.kind === 'gate'
          ? CAMPAIGN_STRUCTURE_HP_MULTIPLIER[options.kind]
          : 1),
      root: options.root,
      hitMeshes: options.hitMeshes,
      ownerFaction: defenderFaction,
    })
    const obstacle: ObstacleData = {
      box: options.box,
      isBarricade: options.isBarricade,
      damageable,
      projectileBoxes: options.projectileBoxes,
    }

    damageable.onDestroyed(() => {
      removeObstacleData(obstacles, obstacle)
      unregisterHitMeshes(damageable.hitMeshes)
    })

    obstacles.push(obstacle)
    obstacleMeshes.push(...options.hitMeshes)
    damageableObstacles.push(damageable)
    return damageable
  }

  const createPalisadeSegment = (
    name: string,
    x: number,
    z: number,
    widthX: number,
    depthZ: number,
  ): DamageableObstacle => {
    const pieceRoot = new THREE.Group()
    pieceRoot.name = name

    // Render the palisade as tightly packed timber stakes. Actor collision and
    // projectile collision both use the same continuous obstacle volume, so
    // there are no visual/projectile gaps that can make ranged LoS flicker.
    const horizontal = widthX >= depthZ
    const length = horizontal ? widthX : depthZ
    const spacing = 0.20
    const stakeCount = Math.max(2, Math.ceil(length / spacing))
    const actualSpacing = length / stakeCount
    const stakes = new THREE.InstancedMesh(
      palisadeStakeGeometry,
      woodMaterial,
      stakeCount,
    )
    stakes.name = `${name}-stakes`
    stakes.castShadow = true
    stakes.receiveShadow = true

    const matrix = new THREE.Matrix4()
    let minTerrainY = Infinity
    let maxTerrainY = -Infinity
    for (let i = 0; i < stakeCount; i++) {
      const offset = -length / 2 + actualSpacing * (i + 0.5)
      const stakeX = horizontal ? x + offset : x
      const stakeZ = horizontal ? z : z + offset
      const terrainY = getTerrainHeight(stakeX, stakeZ)
      minTerrainY = Math.min(minTerrainY, terrainY)
      maxTerrainY = Math.max(maxTerrainY, terrainY)
      matrix.makeTranslation(stakeX, terrainY + palisadeHeight / 2, stakeZ)
      stakes.setMatrixAt(i, matrix)
      stakes.setColorAt(i, new THREE.Color().setHSL(0.09, 0.12, 0.65 + Math.sin(i * 13.7) * 0.12))
    }
    stakes.instanceMatrix.needsUpdate = true
    pieceRoot.add(stakes)

    const createRail = (heightRatio: number): THREE.Mesh => {
      const parts: THREE.BufferGeometry[] = []
      const sections = Math.ceil(length / 2)
      const pointAt = (offset: number): THREE.Vector3 => {
        const px = horizontal ? x + offset : x + 0.17
        const pz = horizontal ? z + 0.17 : z + offset
        return new THREE.Vector3(px, getTerrainHeight(px, pz) + palisadeHeight * heightRatio, pz)
      }
      for (let i = 0; i < sections; i++) {
        parts.push(beamBetween(pointAt(-length / 2 + length * i / sections),
          pointAt(-length / 2 + length * (i + 1) / sections), 0.075))
      }
      return bakedMesh(parts, darkWoodMaterial)
    }
    const lowerRail = createRail(0.42)
    const upperRail = createRail(0.76)
    pieceRoot.add(lowerRail, upperRail)

    root.add(pieceRoot)

    const box = new THREE.Box3(
      new THREE.Vector3(x - widthX / 2, minTerrainY, z - depthZ / 2),
      new THREE.Vector3(x + widthX / 2, maxTerrainY + palisadeHeight, z + depthZ / 2),
    )
    const palisade = registerDamageablePiece({
      kind: 'palisade',
      root: pieceRoot,
      hitMeshes: [stakes, lowerRail, upperRail],
      box,
      isBarricade: true,
    })
    palisade.onDestroyed(() => {
      breachController.trigger()
    })
    return palisade
  }

  const zSign = defenderFaction === 'roman' ? -1 : 1
  const { frontZ, backZ, halfWidth, gateWidth, stakeLineZ } = getCampaignOutpostPlacement(defenderFaction)
  const frontSideSpan = halfWidth - gateWidth / 2
  const frontSegmentLength = frontSideSpan / 3

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const distanceFromGate = frontSegmentLength * (i + 0.5)
      const x = side * (gateWidth / 2 + distanceFromGate)
      createPalisadeSegment(
        `campaign-front-palisade-${side < 0 ? 'left' : 'right'}-${i + 1}`,
        x,
        frontZ,
        frontSegmentLength,
        0.8,
      )
    }
  }

  const sideSegmentDepth = Math.abs(backZ - frontZ) / 5
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      const z = frontZ + zSign * sideSegmentDepth * (i + 0.5)
      createPalisadeSegment(
        `campaign-side-palisade-${side < 0 ? 'left' : 'right'}-${i + 1}`,
        side * halfWidth,
        z,
        0.8,
        sideSegmentDepth,
      )
    }
  }

  const rearSegmentWidth = (halfWidth * 2) / 7
  for (let i = 0; i < 7; i++) {
    const x = -halfWidth + rearSegmentWidth * (i + 0.5)
    createPalisadeSegment(
      `campaign-rear-palisade-${i + 1}`,
      x,
      backZ,
      rearSegmentWidth,
      0.8,
    )
  }

  const gateTerrainY = getTerrainHeight(0, frontZ)
  const gateRoot = new THREE.Group()
  gateRoot.name = `campaign-outpost-gate-${defenderFaction}`

  // Each leaf is parented to its outer hinge so OPEN can rotate the real
  // geometry away from the breach instead of only removing collision.
  const leftGateHinge = new THREE.Group()
  leftGateHinge.name = 'campaign-gate-left-hinge'
  leftGateHinge.position.set(-gateWidth / 2, gateTerrainY, frontZ)
  gateRoot.add(leftGateHinge)

  const leftGate = new THREE.Mesh(unitBox, darkWoodMaterial)
  leftGate.position.set(gateWidth / 4, (palisadeHeight - 0.14) / 2, 0)
  leftGate.scale.set(gateWidth / 2, palisadeHeight - 0.14, 0.9)
  leftGate.castShadow = true
  leftGateHinge.add(leftGate)

  const leftGateTop = new THREE.Mesh(unitBox, woodMaterial)
  leftGateTop.position.set(gateWidth / 4, palisadeHeight - 0.07, 0)
  leftGateTop.scale.set(gateWidth / 2, 0.14, 1.05)
  leftGateTop.castShadow = true
  leftGateHinge.add(leftGateTop)

  const rightGateHinge = new THREE.Group()
  rightGateHinge.name = 'campaign-gate-right-hinge'
  rightGateHinge.position.set(gateWidth / 2, gateTerrainY, frontZ)
  gateRoot.add(rightGateHinge)

  const rightGate = new THREE.Mesh(unitBox, darkWoodMaterial)
  rightGate.position.set(-gateWidth / 4, (palisadeHeight - 0.14) / 2, 0)
  rightGate.scale.set(gateWidth / 2, palisadeHeight - 0.14, 0.9)
  rightGate.castShadow = true
  rightGateHinge.add(rightGate)

  const rightGateTop = new THREE.Mesh(unitBox, woodMaterial)
  rightGateTop.position.set(-gateWidth / 4, palisadeHeight - 0.07, 0)
  rightGateTop.scale.set(gateWidth / 2, 0.14, 1.05)
  rightGateTop.castShadow = true
  rightGateHinge.add(rightGateTop)

  // Plank relief, diagonal bracing and iron straps travel with each hinged leaf.
  const gateDetails: THREE.Object3D[] = []
  const iron = new THREE.MeshStandardMaterial({ color: 0x3e4140, roughness: 0.78, metalness: 0.5 })
  for (const [hinge, sign] of [[leftGateHinge, 1], [rightGateHinge, -1]] as const) {
    const woodParts: THREE.BufferGeometry[] = []
    const ironParts: THREE.BufferGeometry[] = []
    for (let plank = 0; plank < 10; plank++) {
      woodParts.push(new THREE.BoxGeometry(gateWidth / 20 - 0.025, palisadeHeight - 0.13, 0.94)
        .translate(sign * (plank + 0.5) * gateWidth / 20, palisadeHeight / 2, 0))
    }
    for (const face of [-1, 1]) {
      woodParts.push(beamBetween(new THREE.Vector3(sign * 0.15, 0.18, face * 0.49), new THREE.Vector3(sign * (gateWidth / 2 - 0.15), palisadeHeight - 0.18, face * 0.49), 0.065))
      for (const y of [0.27, palisadeHeight - 0.27]) {
        ironParts.push(new THREE.BoxGeometry(gateWidth / 2 - 0.12, 0.09, 0.025).translate(sign * gateWidth / 4, y, face * 0.485))
        for (const x of [0.2, 1.3, 2.6, 3.8]) {
          ironParts.push(new THREE.SphereGeometry(0.038, 6, 4).translate(sign * x, y, face * 0.51))
        }
      }
    }
    const planks = bakedMesh(woodParts, woodMaterial)
    const hardware = bakedMesh(ironParts, iron)
    hinge.add(planks, hardware)
    gateDetails.push(planks, hardware)
  }

  root.add(gateRoot)
  const gate = registerDamageablePiece({
    kind: 'gate',
    root: gateRoot,
    hitMeshes: [leftGate, leftGateTop, rightGate, rightGateTop, ...gateDetails],
    box: new THREE.Box3(
      new THREE.Vector3(-gateWidth / 2, gateTerrainY, frontZ - 0.45),
      new THREE.Vector3(gateWidth / 2, gateTerrainY + palisadeHeight, frontZ + 0.45),
    ),
    isBarricade: true,
  })
  const gateObstacle = obstacles.find(obstacle => obstacle.damageable === gate)
  if (!gateObstacle) throw new Error('Campaign gate obstacle registration failed')

  const gateController = new CampaignGateController({
    defenderFaction,
    damageable: gate,
    obstacle: gateObstacle,
    obstacles,
    leftHinge: leftGateHinge,
    rightHinge: rightGateHinge,
    openRotationY: zSign * Math.PI / 2,
    breachController,
  })

  const stakeXs = [-40, -32, -24, -16, -10, 10, 16, 24, 32, 40]
  for (const [index, x] of stakeXs.entries()) {
    const z = stakeLineZ + zSign * (index % 2 === 0 ? -0.8 : 0.8)
    const terrainY = getTerrainHeight(x, z)
    const pieceRoot = createChevalVisual()
    pieceRoot.name = `campaign-chevaux-de-frise-${index + 1}`
    pieceRoot.position.set(x, terrainY, z)
    const hitMeshes = [...pieceRoot.children]

    root.add(pieceRoot)
    registerDamageablePiece({
      kind: 'chevaux_de_frise',
      root: pieceRoot,
      hitMeshes,
      box: new THREE.Box3(
        new THREE.Vector3(x - 1.6, terrainY, z - 0.8),
        new THREE.Vector3(x + 1.6, terrainY + 2.0, z + 0.8),
      ),
      isBarricade: true,
    })
  }

  // Let the cloth hem and rope pegs meet the terrain without bending the roof.
  const groundTentHem = (tent: THREE.Group): void => {
    const point = new THREE.Vector3()
    for (const child of tent.children) {
      if (!(child instanceof THREE.Mesh)) continue
      const positions = child.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i)
        if (y >= 0.7) continue
        point.set(positions.getX(i), y, positions.getZ(i)).applyEuler(tent.rotation).add(tent.position)
        const offset = getTerrainHeight(point.x, point.z) - tent.position.y
        positions.setY(i, y + offset * (1 - THREE.MathUtils.smoothstep(y, 0.1, 0.7)))
      }
      positions.needsUpdate = true
      child.geometry.computeVertexNormals()
    }
  }

  const createTent = (
    name: string,
    x: number,
    z: number,
    rotationY: number,
  ): DamageableObstacle => {
    const terrainY = getTerrainHeight(x, z)
    const tentRoot = createTentVisual(defenderFaction)
    tentRoot.name = name
    tentRoot.position.set(x, terrainY, z)
    tentRoot.rotation.y = rotationY
    groundTentHem(tentRoot)
    root.add(tentRoot)

    return registerDamageablePiece({
      kind: 'tent',
      root: tentRoot,
      hitMeshes: [...tentRoot.children],
      box: new THREE.Box3(
        new THREE.Vector3(x - 3.7, terrainY, z - 3.7),
        new THREE.Vector3(x + 3.7, terrainY + 3.8, z + 3.7),
      ),
      isBarricade: false,
    })
  }

  // Keep the gate -> central lookout corridor open for infantry formations and
  // mounted deployment. Tents live on the two side lanes only.
  const tentLayout: readonly [number, number, number][] = [
    [-28, 124, Math.PI / 4],
    [ 28, 124, -Math.PI / 4],
    [-36, 136, Math.PI / 4],
    [ 36, 136, -Math.PI / 4],
    [-28, 150, Math.PI / 4],
    [ 28, 150, -Math.PI / 4],
    [-36, 162, Math.PI / 4],
    [ 36, 162, -Math.PI / 4],
    [-28, 174, Math.PI / 4],
    [ 28, 174, -Math.PI / 4],
  ]
  tentLayout.forEach(([x, absZ, rotationY], index) => {
    createTent(
      `campaign-outpost-tent-${index + 1}`,
      x,
      absZ * zSign,
      rotationY + (x < 0 ? Math.PI / 4 : -Math.PI / 4),
    )
  })

  const createCampfire = (
    name: string,
    x: number,
    z: number,
  ): DamageableObstacle => {
    const terrainY = getTerrainHeight(x, z)
    const fireRoot = createCampfireVisual(x < 0 ? 17 : 29)
    fireRoot.name = name
    fireRoot.position.set(x, terrainY, z)
    const hitMeshes = [...fireRoot.children]

    root.add(fireRoot)
    return registerDamageablePiece({
      kind: 'campfire',
      root: fireRoot,
      hitMeshes,
      box: new THREE.Box3(
        new THREE.Vector3(x - 0.9, terrainY, z - 0.9),
        new THREE.Vector3(x + 0.9, terrainY + 1.0, z + 0.9),
      ),
      isBarricade: false,
    })
  }

  createCampfire('campaign-outpost-campfire-1', -16, 156 * zSign)
  createCampfire('campaign-outpost-campfire-2', 16, 156 * zSign)

  return {
    root,
    obstacles,
    obstacleMeshes,
    damageableObstacles,
    gate,
    gateController,
    breachController,
  }
}
