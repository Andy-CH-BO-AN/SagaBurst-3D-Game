import * as THREE from 'three'
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

export const ROMAN_OUTPOST_LAYOUT = {
  centerX: 0,
  frontZ: -135,
  backZ: -171,
  halfWidth: 22,
  gateWidth: 8,
  stakeLineZ: -129,
} as const

export interface RomanOutpostResult {
  root: THREE.Group
  obstacles: ObstacleData[]
  obstacleMeshes: THREE.Object3D[]
  damageableObstacles: DamageableObstacle[]
  gate: DamageableObstacle
}

interface DamageablePieceOptions {
  kind: DamageableObstacleKind
  root: THREE.Object3D
  hitMeshes: readonly THREE.Object3D[]
  box: THREE.Box3
  isBarricade: boolean
}

/**
 * Builds the Roman campaign outpost around the existing Roman armory/stable area.
 *
 * Custom Battle does not call this builder. Campaign runtime can opt into the
 * outpost without changing the existing shared map or battle spawner.
 */
export function createRomanOutpost(scene: THREE.Scene): RomanOutpostResult {
  const root = new THREE.Group()
  root.name = 'roman-campaign-outpost'
  scene.add(root)

  const obstacles: ObstacleData[] = []
  const obstacleMeshes: THREE.Object3D[] = []
  const damageableObstacles: DamageableObstacle[] = []

  const woodMaterial = new THREE.MeshLambertMaterial({ color: 0x76502b })
  const darkWoodMaterial = new THREE.MeshLambertMaterial({ color: 0x4d321d })
  const canvasMaterial = new THREE.MeshLambertMaterial({ color: 0xb6a47c, side: THREE.DoubleSide })
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a32 })
  const stoneMaterial = new THREE.MeshLambertMaterial({ color: 0x6d6b63 })

  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const stakePole = new THREE.CylinderGeometry(0.1, 0.13, 3.4, 6)
  const tentGeometry = new THREE.ConeGeometry(2.7, 2.2, 4)
  const fireLogGeometry = new THREE.CylinderGeometry(0.12, 0.12, 1.15, 6)
  const flameGeometry = new THREE.ConeGeometry(0.35, 0.9, 8)
  const stoneGeometry = new THREE.DodecahedronGeometry(0.22, 0)

  const unregisterHitMeshes = (hitMeshes: readonly THREE.Object3D[]): void => {
    for (const mesh of hitMeshes) {
      const index = obstacleMeshes.indexOf(mesh)
      if (index >= 0) obstacleMeshes.splice(index, 1)
    }
  }

  const registerDamageablePiece = (options: DamageablePieceOptions): DamageableObstacle => {
    const damageable = new DamageableObstacle({
      kind: options.kind,
      maxHp: DAMAGEABLE_OBSTACLE_HP[options.kind],
      root: options.root,
      hitMeshes: options.hitMeshes,
      ownerFaction: 'roman',
    })
    const obstacle: ObstacleData = {
      box: options.box,
      isBarricade: options.isBarricade,
      damageable,
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
    const terrainY = getTerrainHeight(x, z)
    const pieceRoot = new THREE.Group()
    pieceRoot.name = name

    const wall = new THREE.Mesh(unitBox, woodMaterial)
    wall.position.set(x, terrainY + 1.65, z)
    wall.scale.set(widthX, 3.3, depthZ)
    wall.castShadow = true
    wall.receiveShadow = true
    pieceRoot.add(wall)

    const brace = new THREE.Mesh(unitBox, darkWoodMaterial)
    brace.position.set(x, terrainY + 1.25, z)
    brace.scale.set(
      Math.max(0.18, widthX > depthZ ? widthX : 0.18),
      0.22,
      Math.max(0.18, depthZ >= widthX ? depthZ : 0.18),
    )
    brace.castShadow = true
    pieceRoot.add(brace)

    root.add(pieceRoot)

    const box = new THREE.Box3(
      new THREE.Vector3(x - widthX / 2, terrainY, z - depthZ / 2),
      new THREE.Vector3(x + widthX / 2, terrainY + 3.4, z + depthZ / 2),
    )
    return registerDamageablePiece({
      kind: 'palisade',
      root: pieceRoot,
      hitMeshes: [wall, brace],
      box,
      isBarricade: true,
    })
  }

  const { frontZ, backZ, halfWidth, gateWidth, stakeLineZ } = ROMAN_OUTPOST_LAYOUT
  const frontSideSpan = halfWidth - gateWidth / 2
  const frontSegmentLength = frontSideSpan / 3

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const distanceFromGate = frontSegmentLength * (i + 0.5)
      const x = side * (gateWidth / 2 + distanceFromGate)
      createPalisadeSegment(
        `roman-front-palisade-${side < 0 ? 'left' : 'right'}-${i + 1}`,
        x,
        frontZ,
        frontSegmentLength,
        0.8,
      )
    }
  }

  const sideSegmentDepth = (frontZ - backZ) / 5
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      const z = frontZ - sideSegmentDepth * (i + 0.5)
      createPalisadeSegment(
        `roman-side-palisade-${side < 0 ? 'left' : 'right'}-${i + 1}`,
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
      `roman-rear-palisade-${i + 1}`,
      x,
      backZ,
      rearSegmentWidth,
      0.8,
    )
  }

  const gateTerrainY = getTerrainHeight(0, frontZ)
  const gateRoot = new THREE.Group()
  gateRoot.name = 'roman-outpost-gate'

  const leftGate = new THREE.Mesh(unitBox, darkWoodMaterial)
  leftGate.position.set(-gateWidth / 4, gateTerrainY + 1.65, frontZ)
  leftGate.scale.set(gateWidth / 2, 3.3, 0.9)
  leftGate.castShadow = true
  gateRoot.add(leftGate)

  const rightGate = new THREE.Mesh(unitBox, darkWoodMaterial)
  rightGate.position.set(gateWidth / 4, gateTerrainY + 1.65, frontZ)
  rightGate.scale.set(gateWidth / 2, 3.3, 0.9)
  rightGate.castShadow = true
  gateRoot.add(rightGate)

  const gateTop = new THREE.Mesh(unitBox, woodMaterial)
  gateTop.position.set(0, gateTerrainY + 3.45, frontZ)
  gateTop.scale.set(gateWidth + 0.8, 0.3, 1.05)
  gateTop.castShadow = true
  gateRoot.add(gateTop)

  root.add(gateRoot)
  const gate = registerDamageablePiece({
    kind: 'gate',
    root: gateRoot,
    hitMeshes: [leftGate, rightGate, gateTop],
    box: new THREE.Box3(
      new THREE.Vector3(-gateWidth / 2, gateTerrainY, frontZ - 0.45),
      new THREE.Vector3(gateWidth / 2, gateTerrainY + 3.6, frontZ + 0.45),
    ),
    isBarricade: true,
  })

  const stakeXs = [-18, -13, -8, 8, 13, 18]
  for (const [index, x] of stakeXs.entries()) {
    const z = stakeLineZ + (index % 2 === 0 ? -0.8 : 0.8)
    const terrainY = getTerrainHeight(x, z)
    const pieceRoot = new THREE.Group()
    pieceRoot.name = `roman-chevaux-de-frise-${index + 1}`

    const poleA = new THREE.Mesh(stakePole, darkWoodMaterial)
    poleA.position.set(x, terrainY + 0.9, z)
    poleA.rotation.z = Math.PI / 4
    poleA.castShadow = true
    pieceRoot.add(poleA)

    const poleB = new THREE.Mesh(stakePole, darkWoodMaterial)
    poleB.position.set(x, terrainY + 0.9, z)
    poleB.rotation.z = -Math.PI / 4
    poleB.castShadow = true
    pieceRoot.add(poleB)

    const cross = new THREE.Mesh(stakePole, woodMaterial)
    cross.position.set(x, terrainY + 0.85, z)
    cross.rotation.x = Math.PI / 2
    cross.castShadow = true
    pieceRoot.add(cross)

    root.add(pieceRoot)
    registerDamageablePiece({
      kind: 'chevaux_de_frise',
      root: pieceRoot,
      hitMeshes: [poleA, poleB, cross],
      box: new THREE.Box3(
        new THREE.Vector3(x - 1.6, terrainY, z - 0.8),
        new THREE.Vector3(x + 1.6, terrainY + 2.0, z + 0.8),
      ),
      isBarricade: true,
    })
  }

  const createTent = (name: string, x: number, z: number, rotationY: number): void => {
    const terrainY = getTerrainHeight(x, z)
    const tent = new THREE.Mesh(tentGeometry, canvasMaterial)
    tent.name = name
    tent.position.set(x, terrainY + 1.1, z)
    tent.rotation.y = rotationY
    tent.castShadow = true
    tent.receiveShadow = true
    root.add(tent)
  }

  createTent('roman-outpost-tent-1', -12, -159, Math.PI / 4)
  createTent('roman-outpost-tent-2', 12, -159, -Math.PI / 4)
  createTent('roman-outpost-tent-3', -12, -150, Math.PI / 4)

  const createCampfire = (name: string, x: number, z: number): void => {
    const terrainY = getTerrainHeight(x, z)
    const fireRoot = new THREE.Group()
    fireRoot.name = name

    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(fireLogGeometry, darkWoodMaterial)
      log.position.set(x, terrainY + 0.14, z)
      log.rotation.z = Math.PI / 2
      log.rotation.y = (Math.PI / 3) * i
      fireRoot.add(log)
    }

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8
      const stone = new THREE.Mesh(stoneGeometry, stoneMaterial)
      stone.position.set(x + Math.cos(angle) * 0.7, terrainY + 0.14, z + Math.sin(angle) * 0.7)
      fireRoot.add(stone)
    }

    const flame = new THREE.Mesh(flameGeometry, emberMaterial)
    flame.position.set(x, terrainY + 0.55, z)
    fireRoot.add(flame)

    root.add(fireRoot)
  }

  createCampfire('roman-outpost-campfire-1', 8, -151)
  createCampfire('roman-outpost-campfire-2', 8, -164)

  return {
    root,
    obstacles,
    obstacleMeshes,
    damageableObstacles,
    gate,
  }
}
