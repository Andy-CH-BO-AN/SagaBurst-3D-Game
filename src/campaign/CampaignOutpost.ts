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
import type { CharacterFaction } from '../world/CharacterVisuals'

export const CAMPAIGN_OUTPOST_LAYOUT = {
  centerX: 0,
  frontDistance: 135,
  backDistance: 171,
  halfWidth: 44,
  gateWidth: 8,
  stakeLineDistance: 129,
} as const

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
}

interface DamageablePieceOptions {
  kind: DamageableObstacleKind
  root: THREE.Object3D
  hitMeshes: readonly THREE.Object3D[]
  box: THREE.Box3
  isBarricade: boolean
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

  const woodMaterial = new THREE.MeshLambertMaterial({ color: 0x76502b })
  const darkWoodMaterial = new THREE.MeshLambertMaterial({ color: 0x4d321d })
  const canvasMaterial = new THREE.MeshLambertMaterial({ color: 0xb6a47c, side: THREE.DoubleSide })
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff8a32 })
  const stoneMaterial = new THREE.MeshLambertMaterial({ color: 0x6d6b63 })

  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const palisadeStakeGeometry = new THREE.CylinderGeometry(0.11, 0.15, 3.4, 6)
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
      ownerFaction: defenderFaction,
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
    const pieceRoot = new THREE.Group()
    pieceRoot.name = name

    // Keep collision continuous, but render the wall as spaced timber stakes so
    // defenders/attackers remain visible through the palisade.
    const horizontal = widthX >= depthZ
    const length = horizontal ? widthX : depthZ
    const spacing = 0.72
    const stakeCount = Math.max(2, Math.floor(length / spacing))
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
      matrix.makeTranslation(stakeX, terrainY + 1.7, stakeZ)
      stakes.setMatrixAt(i, matrix)
    }
    stakes.instanceMatrix.needsUpdate = true
    pieceRoot.add(stakes)

    const centerTerrainY = getTerrainHeight(x, z)
    const lowerRail = new THREE.Mesh(unitBox, darkWoodMaterial)
    lowerRail.position.set(x, centerTerrainY + 1.15, z)
    lowerRail.scale.set(
      horizontal ? widthX : 0.16,
      0.16,
      horizontal ? 0.16 : depthZ,
    )
    lowerRail.castShadow = true
    pieceRoot.add(lowerRail)

    const upperRail = new THREE.Mesh(unitBox, darkWoodMaterial)
    upperRail.position.set(x, centerTerrainY + 2.15, z)
    upperRail.scale.set(
      horizontal ? widthX : 0.16,
      0.16,
      horizontal ? 0.16 : depthZ,
    )
    upperRail.castShadow = true
    pieceRoot.add(upperRail)

    root.add(pieceRoot)

    const box = new THREE.Box3(
      new THREE.Vector3(x - widthX / 2, minTerrainY, z - depthZ / 2),
      new THREE.Vector3(x + widthX / 2, maxTerrainY + 3.5, z + depthZ / 2),
    )
    return registerDamageablePiece({
      kind: 'palisade',
      root: pieceRoot,
      hitMeshes: [stakes, lowerRail, upperRail],
      box,
      isBarricade: true,
    })
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

  const stakeXs = [-40, -32, -24, -16, -10, 10, 16, 24, 32, 40]
  for (const [index, x] of stakeXs.entries()) {
    const z = stakeLineZ + (index % 2 === 0 ? -0.8 : 0.8)
    const terrainY = getTerrainHeight(x, z)
    const pieceRoot = new THREE.Group()
    pieceRoot.name = `campaign-chevaux-de-frise-${index + 1}`

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

  const createTent = (
    name: string,
    x: number,
    z: number,
    rotationY: number,
  ): DamageableObstacle => {
    const terrainY = getTerrainHeight(x, z)
    const tentRoot = new THREE.Group()
    tentRoot.name = name

    const tent = new THREE.Mesh(tentGeometry, canvasMaterial)
    tent.position.set(x, terrainY + 1.1, z)
    tent.rotation.y = rotationY
    tent.castShadow = true
    tent.receiveShadow = true
    tentRoot.add(tent)
    root.add(tentRoot)

    return registerDamageablePiece({
      kind: 'tent',
      root: tentRoot,
      hitMeshes: [tent],
      box: new THREE.Box3(
        new THREE.Vector3(x - 2.5, terrainY, z - 2.5),
        new THREE.Vector3(x + 2.5, terrainY + 2.4, z + 2.5),
      ),
      isBarricade: false,
    })
  }

  createTent('campaign-outpost-tent-1', -12, 159 * zSign, Math.PI / 4)
  createTent('campaign-outpost-tent-2', 12, 159 * zSign, -Math.PI / 4)
  createTent('campaign-outpost-tent-3', -12, 150 * zSign, Math.PI / 4)

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

  createCampfire('campaign-outpost-campfire-1', 8, 151 * zSign)
  createCampfire('campaign-outpost-campfire-2', 8, 164 * zSign)

  return {
    root,
    obstacles,
    obstacleMeshes,
    damageableObstacles,
    gate,
  }
}
