import { markObstacleTopologyChanged } from '../world/ObstacleTopology'
import { createTownCommandWatchtower } from './TownCommandWatchtower'
import { createTownCommandWatchtowerAirspaceObstacle, getTownCommandWatchtowerLayout, TOWN_COMMAND_WATCHTOWER, validateWatchtowerPlacement, type CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'
import { resolveTownEagleGarrison, type TownEagleGarrisonLayout } from './TownEagleGarrison'
import { buildTownGroundSign, townEagleSigns } from './TownGroundSign'
import { resolveTownEagleTrainingGround, type TownEagleTrainingGround } from './TownEagleTrainingGround'
import { XONGKORO_LANDING } from '../world/EagleLanding'
import { eagleLandingFootprint, isEagleLandingClear } from '../world/EagleLanding'
import { isEagleApproachClear } from '../world/EagleApproach'
import { resolveTownHRLayout, townHrLocalMuster, type TownHRLayout } from './TownHRLayout'
import { TownDockPassages } from './TownDockPassages'
import { TownSiegeAirspace } from './TownSiegeAirspace'
import { createTownFortifications } from './TownFortifications'
import { townCivicClearance, type CivicClearanceShape, TOWN_CENTER, TOWN_WELL, TOWN_PLAZA, townHousing, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, TOWN_CITY, TOWN_EAGLE_STATION_SITES, TOWN_GATES, townRoadIntersectsBox, townSceneryExcluded, type TownRoad } from './TownLayout'
import { ArchitectureKit, architectureStatues, buildEaglePadMarkings, buildEagleStation, buildTownPlaza, dressCommandWatchtower, dressTownGate, dressTownGateLeaves, dressTownWalls,
  placeArchitecture, townHomeVariant, type CivicBuildingKind, type TownCenterServiceRole } from './architecture/TownArchitecture'
import type { TownServiceStation } from './TownCommanderIdentity'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createCampfireVisual, createPineVisual } from '../world/EnvironmentVisuals'
import { Faction } from '../combat/CombatFaction'
import { TOWN_SITES, townRoster, townPlayerEntryPoint } from './TownRules'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { getTerrainHeight, getWalkRampHeight, removeObstacleData, resetTerrainScenePolicy, setObstaclePathQuerySource, setScenePlayableWorldBound, type ObstacleData } from '../world/Terrain'
import { TOWN_PLAYABLE_WORLD_BOUND, TOWN_GROUND_SIZE, TOWN_BANDIT_CAMP_CENTERS, townSceneryPoint, nearTownBanditCamp } from './TownBounds'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { civicHallFromPlan, type CivicHall } from '../navigation/CivicExitRoute'
import { proceduralMaterial } from '../world/ProceduralMaterials'

/** Resets battlefield-specific terrain policies before sampling Town watchtower or ground heights. */
export function initializeTownWorldTerrain(scene?: { userData: Record<string, unknown> }): CommandWatchtowerLayout {
  resetTerrainScenePolicy()
  if (scene) setScenePlayableWorldBound(scene as THREE.Scene, TOWN_PLAYABLE_WORLD_BOUND)
  return getTownCommandWatchtowerLayout()
}

export class TownWorld {
  readonly root = new THREE.Group()
  readonly roads: TownRoad[] = []
  readonly civicShapes: CivicClearanceShape[] = []
  readonly civicClearance: ReturnType<typeof townCivicClearance>
  readonly hr: TownHRLayout
  /** Indoor Town Center posts of the Captain, Sergeant and Commander (world XZ, floor Y). */
  private readonly serviceStations = new Map<TownCenterServiceRole, TownServiceStation>()
  /** Doorways of enterable civic halls, derived from the same plan that builds their colliders. */
  readonly civicHalls: CivicHall[] = []
  readonly eagleGarrison: TownEagleGarrisonLayout
  readonly eagleTraining: TownEagleTrainingGround
  readonly commandWatchtower: CommandWatchtowerLayout
  readonly townCenterHeight: number
  readonly terrainMesh: THREE.Mesh
  readonly obstacles: ObstacleData[] = []
  /** Rendered roofs/crowns/boards supplement body colliders for flight clearance. */
  readonly airspaceObstacles: ObstacleData[] = []
  readonly camps: { faction: Faction; capacity: number; spawnPoints: THREE.Vector3[] }[] = []
  readonly targets: THREE.Vector3[] = []
  readonly siegeDockPassages?: TownDockPassages
  readonly siegeAirspace?: TownSiegeAirspace
  readonly fortifications: ReturnType<typeof createTownFortifications>
  get gates() { return this.fortifications.gates }
  /** Damageable structures. `obstacles` is the hit/collision volume; `supports` (floors, steps) leave and return with it but are never hit. */
  readonly buildings: { id: string; ownerFaction: Faction; campId?: number; obstacles: ObstacleData[]; supports: ObstacleData[]; hp: DamageableObstacle; roof: THREE.Group; ruin: THREE.Group; damaged: boolean; restorePhysics?(): void; setDamaged(damaged: boolean): void }[] = []
  /** Faction architecture resources shared by every civic building, the plaza and their dressing. */
  private readonly architecture: ArchitectureKit
  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly textures = new Set<THREE.Texture>()
  private readonly box = this.geo(new THREE.BoxGeometry(1, 1, 1))
  private readonly wood = proceduralMaterial({ kind: 'wood', color: 0x9b7954, roughness: .92 })
  private readonly dark = this.mat(0x423329)
  private readonly stone = this.mat(0x9d9481)
  private readonly plaster = this.mat(0xd9c6a5)
  private readonly roofMat = this.mat(this.faction === 'roman' ? 0x9f4f35 : 0x55574a)
  private readonly snow = this.mat(0xd8e3ea)
  private readonly canvas = this.mat(0xa89471)
  constructor(readonly faction: CharacterFaction, scene: THREE.Scene, private readonly ownerAllegiance: Faction = Faction.TOWN, options: { fourGateSiege?: boolean } = {}) {
    this.commandWatchtower = initializeTownWorldTerrain(scene)
    // Created here: class fields initialize before the `faction` parameter property is assigned.
    this.architecture = new ArchitectureKit(faction)
    scene.add(this.root)
    this.roofMat.color.setHex(0xffffff); this.roofMat.map = this.surfaceTexture(faction === 'roman' ? 'tile' : 'thatch'); this.roofMat.bumpMap = this.roofMat.map; this.roofMat.bumpScale = .07
    this.stone.map = this.surfaceTexture('stone'); this.stone.color.setHex(0xffffff)
    this.plaster.map = this.surfaceTexture('plaster'); this.plaster.color.setHex(0xffffff)
    scene.background = new THREE.Color(faction === 'roman' ? 0xb8ccd1 : 0x8d9ea9)
    scene.fog = new THREE.Fog(scene.background, 120, 350)
    scene.add(new THREE.AmbientLight(faction === 'roman' ? 0xffedcf : 0xe0e9f2, .35))
    const porchFill = new THREE.DirectionalLight(0xdde7ec, .7); porchFill.position.set(0, 12, 70); scene.add(porchFill)
    scene.add(new THREE.HemisphereLight(faction === 'roman' ? 0xfff1d8 : 0xc5d6ef, 0x66614d, 1.5))
    const sun = new THREE.DirectionalLight(0xffecd0, 2.4); sun.position.set(-40, 75, 30); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 90, bottom: -90, far: 180 }); sun.shadow.bias = -.002; scene.add(sun)
    const g = this.geo(new THREE.PlaneGeometry(TOWN_GROUND_SIZE, TOWN_GROUND_SIZE, 400, 400)); g.rotateX(-Math.PI / 2)
    const p = g.attributes.position, colors = []
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); p.setY(i, getTerrainHeight(x, z))
      const n = Math.sin(x * .4) * Math.cos(z * .29) + Math.sin(z * .7) * .3
      const c = new THREE.Color(faction === 'roman' ? (n > -.4 ? 0x6d7650 : 0x858061) : (n > -.8 ? 0xd4dee2 : 0x9ba19b)); colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals()
    const ground = this.mat(0xffffff); ground.vertexColors = true; const land = new THREE.Mesh(g, ground); land.receiveShadow = true; this.root.add(land); this.terrainMesh = land
    this.civic('weapons', 'weapons', TOWN_SITES.weapons)
    this.civic('stable', 'stable', TOWN_SITES.stable)
    townHousing(faction).forEach((home, index) => this.civic(home.id, townHomeVariant(index), home))
    this.civic('town-center', 'town-center', TOWN_CENTER)
    const hall = this.buildings.find(building => building.id === 'town-center')!.hp.root
    this.townCenterHeight = new THREE.Box3().setFromObject(hall).max.y - getTerrainHeight(TOWN_CENTER.x, TOWN_CENTER.z)
    for (const road of TOWN_CITY_ROADS) this.road(road.ax, road.az, road.bx, road.bz, road.width)
    for (const road of TOWN_LOCAL_ROADS) this.road(road.ax, road.az, road.bx, road.bz, road.width)
    const plaza = buildTownPlaza(this.architecture, TOWN_PLAZA, { statues: architectureStatues() })
    this.root.add(plaza.root); this.obstacles.push(...plaza.obstacles)
    // A small well sits at the plaza edge, leaving its centre free for a full squad.
    const wellX = TOWN_WELL.x, wellZ = TOWN_WELL.z, wellY = getTerrainHeight(wellX, wellZ)
    this.solid(wellX, wellZ, 2.6, 1, 2.6)
    for (const side of [-1, 1]) {
      this.cube(this.root, wellX + side * 1.2, wellY + .5, wellZ, .3, 1, 2.7, this.stone)
      this.cube(this.root, wellX, wellY + .5, wellZ + side * 1.2, 2.7, 1, .3, this.stone)
    }
    if (options.fourGateSiege) {
      this.siegeAirspace = new TownSiegeAirspace(this.airspaceObstacles)
      this.siegeDockPassages = new TownDockPassages(this.obstacles, this.siegeAirspace)
    }
    // Same faction material set as the architecture showcase; the kit owns and disposes it.
    this.fortifications = createTownFortifications(faction, this.obstacles, this.architecture.materials.plain, this.siegeDockPassages)
    this.root.add(this.fortifications.root); this.trackOwned(this.fortifications.root, false)
    this.batch(this.fortifications.wallRoot)
    for (const child of this.fortifications.wallRoot.children) if (child instanceof THREE.Group) this.batch(child)
    this.dressFortifications()
    const rockGeo = this.geo(new THREE.IcosahedronGeometry(1, 0))
    for (let i = 0; i < 36; i++) {
      const { x, z } = townSceneryPoint(i, 110, 7), y = getTerrainHeight(x, z)
      if (townSceneryExcluded(x, z, 4) || nearTownBanditCamp(x, z, 26)) continue
      this.solid(x, z, 3.3, 3, 2.7)
      const rock = new THREE.Mesh(rockGeo, this.stone); rock.position.set(x, y, z); rock.scale.set(2, 1.5, 1.8); this.root.add(rock)
      if (faction === 'viking') this.cube(this.root, x, y + 1.2, z, 1.8, .18, 1.4, this.snow)
    }
    for (const [campId, [cx, cz]] of TOWN_BANDIT_CAMP_CENTERS.entries()) {
      const spawnPoints: THREE.Vector3[] = []
      this.campfire(cx, cz)
      for (let i = 0; i < 5; i++) {
        const angle = i / 5 * Math.PI * 2, x = cx + Math.sin(angle) * 10, z = cz + Math.cos(angle) * 10
        this.tent('camp-' + cx + '-' + i, x, z, angle + Math.PI, campId)
        for (const side of [-1, 1]) {
          const yaw = angle + Math.PI, xx = x + Math.cos(yaw) * side * 1.1 + Math.sin(yaw) * 5, zz = z - Math.sin(yaw) * side * 1.1 + Math.cos(yaw) * 5
          spawnPoints.push(new THREE.Vector3(xx, getTerrainHeight(xx, zz), zz))
        }
      }
      this.camps.push({ faction: Faction.BANDIT, capacity: 10, spawnPoints })
    }
    const tree = createPineVisual(42, faction === 'viking')
    this.trackOwned(tree)
    for (let i = 0; i < 90; i++) {
      const { x, z, angle } = townSceneryPoint(i, 112, 13)
      if (townSceneryExcluded(x, z, 12) || nearTownBanditCamp(x, z, 26)) continue
      if (this.camps.some(c => c.spawnPoints.some(p => Math.hypot(p.x - x, p.z - z) < 18))) continue
      const copy = tree.clone(true), scale = .8 + i % 5 * .13
      copy.position.set(x, getTerrainHeight(x, z), z); copy.scale.setScalar(scale); copy.rotation.y = angle
      this.root.add(copy); this.solid(x, z, .6, 5, .6)
      this.airspaceObstacles.push({ box: new THREE.Box3().setFromObject(copy), isBarricade: false })
    }
    this.hr = resolveTownHRLayout(faction, this.obstacles, this.roads)
    this.civic('hr-center', 'hr-center', this.hr.site)
    this.eagleTraining = resolveTownEagleTrainingGround(this.obstacles, this.roads, this.hr)
    this.eagleGarrison = resolveTownEagleGarrison(this.eagleTraining)
    this.eagleTrainingGround()
    validateWatchtowerPlacement(this.commandWatchtower, [...this.obstacles, ...this.airspaceObstacles], this.roads)
    const watchtower = createTownCommandWatchtower(this.commandWatchtower, faction, this.obstacles, { ...this.architecture.materials.plain })
    this.root.add(watchtower); this.trackOwned(watchtower, false)
    // Faction cladding and pavilion roof; ramps, landings, rails and their collision are unchanged.
    const towerDressing = dressCommandWatchtower(this.architecture, this.commandWatchtower, { x: TOWN_COMMAND_WATCHTOWER.x, z: TOWN_COMMAND_WATCHTOWER.z })
    this.root.add(towerDressing.root)
    this.airspaceObstacles.push(createTownCommandWatchtowerAirspaceObstacle(this.commandWatchtower))
    this.airspaceObstacles.push({ box: towerDressing.airspace, isBarricade: false, projectilePassable: true })
    this.airspaceObstacles.push(...this.obstacles.filter(obstacle => !obstacle.physicalPassable))
    this.validateAirfield()
    const roster = townRoster().filter(actor => actor.duty !== 'civilian')
    const entry = townPlayerEntryPoint()
    this.civicClearance = townCivicClearance(this.civicShapes, this.roads, [
      ...roster.map(actor => ({ ...actor, ...(actor.garrison ?? {}), radius: actor.mounted ? 1 : .42 })),
      { id: 'player-entry', ...entry, radius: .42 }, { id: 'hr-officer', ...this.hr.officer, radius: 1 },
      ...this.hr.muster.map((slot, index) => ({ id: `hr-muster-${index}`, ...slot, radius: 2.2 })),
    ])
    if (this.civicClearance.blocked.length) console.warn('城鎮建築通道淨空需檢查', this.civicClearance)
    this.batch(this.root)
    setObstaclePathQuerySource(this.obstacles, true)
  }

  private eagleTrainingGround(): void {
    // Painted faction landing marks follow the existing terrain: no floor, collision or airspace.
    this.root.add(buildEaglePadMarkings(this.architecture, [...this.eagleTraining.pads, ...this.eagleGarrison.pads], XONGKORO_LANDING))
    // Supply posts (the trainer serves at the private one) and their signs share one station layout;
    // `validateAirfield` re-checks every pad against both.
    for (const site of TOWN_EAGLE_STATION_SITES) {
      const station = buildEagleStation(this.architecture, site)
      this.root.add(station.root); this.obstacles.push(...station.obstacles)
      this.airspaceObstacles.push({ box: station.airspace, isBarricade: false })
    }
    for (const spec of townEagleSigns()) {
      const sign = buildTownGroundSign(spec, { box: this.box, wood: this.wood, dark: this.dark, own: resource => this.own(resource) })
      this.root.add(sign.root); this.obstacles.push(...sign.obstacles); this.batch(sign.root)
      this.airspaceObstacles.push({ box: sign.airspace, isBarricade: false })
    }
  }
  private own(resource: THREE.BufferGeometry | THREE.Material | THREE.Texture): void {
    if (resource instanceof THREE.BufferGeometry) this.geometries.add(resource)
    else if (resource instanceof THREE.Material) this.materials.add(resource)
    else this.textures.add(resource)
  }

  /** PR1 gatehouses, leaf detail and wall dressing around the existing gates and curtain walls (controllers, HP and ramparts unchanged). */
  private dressFortifications(): void {
    const statues = architectureStatues()
    this.root.add(dressTownWalls(this.architecture, this.fortifications.walls, { x: (TOWN_CITY.minX + TOWN_CITY.maxX) / 2, z: (TOWN_CITY.minZ + TOWN_CITY.maxZ) / 2 }))
    for (const gate of TOWN_GATES) {
      const dressing = dressTownGate(this.architecture, gate, { statues })
      this.root.add(dressing.root); this.obstacles.push(...dressing.obstacles)
      this.airspaceObstacles.push({ box: new THREE.Box3().setFromObject(dressing.root), isBarricade: false })
      const leaves = this.fortifications.root.getObjectByName(`town-${gate.id}-gate-leaves`)
      if (leaves) dressTownGateLeaves(this.architecture, leaves.children)
    }
  }

  private validateAirfield(): void {
    const pads = [...this.eagleTraining.pads, ...this.eagleGarrison.pads]
    const muster = new THREE.Box3().setFromPoints(this.hr.muster.map(slot => new THREE.Vector3(slot.x, 0, slot.z)))
      .expandByVector(new THREE.Vector3(3, 100, 3))
    for (const pad of pads) {
      const footprint = eagleLandingFootprint(pad)
      if (footprint.min.x < TOWN_CITY.minX || footprint.max.x > TOWN_CITY.maxX
        || footprint.min.z < TOWN_CITY.minZ || footprint.max.z > TOWN_CITY.maxZ
        || footprint.intersectsBox(muster) || this.roads.some(road => townRoadIntersectsBox(road, footprint, 2))
        || !isEagleLandingClear(pad, this.airspaceObstacles, pads.filter(other => other !== pad), TOWN_PLAYABLE_WORLD_BOUND)
        || !isEagleApproachClear(pad, this.airspaceObstacles, pads.filter(other => other !== pad), TOWN_PLAYABLE_WORLD_BOUND)) {
        throw new Error(`Blocked Town eagle footprint or authored approach: ${pad.id}`)
      }
    }
  }

  private roadSurface?: THREE.MeshStandardMaterial
  private get roadMaterial(): THREE.MeshStandardMaterial {
    if (!this.roadSurface) {
      this.roadSurface = this.mat(0xffffff); this.roadSurface.map = this.surfaceTexture('stone')
      this.roadSurface.bumpMap = this.roadSurface.map; this.roadSurface.bumpScale = .045
    }
    return this.roadSurface
  }
  private surfaceTexture(kind: 'stone' | 'tile' | 'thatch' | 'plaster'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = kind === 'stone' ? '#625c50' : kind === 'tile' ? '#49362e' : kind === 'thatch' ? '#79613e' : '#c8b897'; ctx.fillRect(0, 0, 256, 256)
    for (let row = 0; row < 8; row++) for (let col = -1; col < 8; col++) {
      const n = Math.sin(row * 17 + col * 39) * .5 + .5, x = col * 40 + row % 2 * 20, y = row * 32
      if (kind === 'stone') {
        const gray = 105 + Math.floor(n * 45); ctx.fillStyle = `rgb(${gray + 12},${gray + 7},${gray})`; ctx.beginPath(); ctx.roundRect(x + 2, y + 2, 37, 29, 5); ctx.fill()
      } else if (kind === 'tile') {
        ctx.fillStyle = `hsl(18 28% ${28 + n * 16}%)`; ctx.fillRect(x + 1, y + 2, 38, 29); ctx.fillStyle = '#b3866133'; ctx.fillRect(x + 2, y + 3, 36, 3)
      }
    }
    for (let i = 0; i < 2600; i++) {
      const x = (i * 83.13) % 256, y = (i * 37.71) % 256
      ctx.fillStyle = i % 2 ? '#fff1ca18' : '#31251818'; ctx.fillRect(x, y, kind === 'thatch' ? 1 : 2, kind === 'thatch' ? 10 + i % 17 : 2)
    }
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4; this.textures.add(map)
    if (kind !== 'stone') map.repeat.set(4, 3)
    return map
  }
  private solid(x: number, z: number, w: number, h: number, d: number): void {
    const y = getTerrainHeight(x, z)
    this.obstacles.push({ box: new THREE.Box3(new THREE.Vector3(x - w / 2, y - 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2)), isBarricade: false })
  }
  private trackOwned(root: THREE.Object3D, materials = true): void {
    root.traverse(o => { if (o instanceof THREE.Mesh) { this.geometries.add(o.geometry); if (materials) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.name.startsWith('procedural-')) this.materials.add(m) } })
  }
  private campfire(x: number, z: number): void {
    const fire = createCampfireVisual(Math.round(x * 73 + z * 31)); fire.position.set(x, getTerrainHeight(x, z), z)
    this.trackOwned(fire); this.root.add(fire); this.solid(x, z, 1.2, .55, 1.2)
  }
  /** Batch static siblings per material, retaining damageable roofs and shader effects as separate roots. */
  private batch(parent: THREE.Group): void {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>()
    for (const child of parent.children) if (child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && !Array.isArray(child.material) && child.geometry.attributes.normal && !child.geometry.attributes.color) {
      const bucket = buckets.get(child.material) ?? []; bucket.push(child); buckets.set(child.material, bucket)
    }
    for (const [material, meshes] of buckets) {
      if (meshes.length < 2) continue
      const parts = meshes.map(m => { m.updateMatrix(); const part = m.geometry.clone().applyMatrix4(m.matrix); if (part.index) { const unindexed = part.toNonIndexed(); part.dispose(); return unindexed } return part })
      // Different procedural meshes may omit UVs; keep only a common attribute layout.
      for (const part of parts) for (const attr of Object.keys(part.attributes)) if (!parts.every(p => p.hasAttribute(attr))) for (const p of parts) p.deleteAttribute(attr)
      const merged = mergeGeometries(parts, false); parts.forEach(p => p.dispose())
      if (!merged) continue
      const result = new THREE.Mesh(this.geo(merged), material); result.castShadow = true; result.receiveShadow = true; parent.add(result)
      meshes.forEach(m => m.removeFromParent())
    }
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T { this.geometries.add(g); return g }
  private mat(color: number): THREE.MeshStandardMaterial { const m = new THREE.MeshStandardMaterial({ color, roughness: .88 }); this.materials.add(m); return m }
  /** Indoor post of a Town Center service resident, from the faction's own hall plan. */
  serviceStation(role: TownCenterServiceRole): TownServiceStation {
    const station = this.serviceStations.get(role)
    if (!station) throw new Error(`城鎮中心缺少服務站位：${role}`)
    return { ...station }
  }
  /** Authored civic support height, shared by initial stall placement and live movement.*/
  civicFloorY(id: string): number {
    const floor = this.buildings.find(building => building.id === id)?.supports[0]?.walkSurface
    if (!floor) throw new Error(`城鎮建築缺少樓板：${id}`)
    return floor.topY
  }
  /** Surviving floor/ramp height, also used to admit legacy saved actors to HR. */
  civicSupportY(id: string, point: { x: number; z: number }): number | undefined {
    let y: number | undefined
    for (const support of this.buildings.find(b => b.id === id)?.supports ?? []) {
      const value = support.walkSurface && getWalkRampHeight(support.walkSurface, point.x, point.z)
      if (typeof value === 'number') y = Math.max(y ?? -Infinity, value)
    }
    return y
  }
  private cube(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.box, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  private road(ax: number, az: number, bx: number, bz: number, width: number): void {
    this.roads.push({ ax, az, bx, bz, width })
    const vertices: number[] = [], length = Math.hypot(bx - ax, bz - az), count = Math.ceil(length / .5), across = Math.ceil(width / .5)
    const nx = -(bz - az) / length, nz = (bx - ax) / length
    for (let i = 0; i < count; i++) for (let j = 0; j < across; j++) {
      const corners = [i / count, (i + 1) / count].flatMap(t => [j / across - .5, (j + 1) / across - .5].map(side => [ax + (bx - ax) * t + nx * width * side, az + (bz - az) * t + nz * width * side]))
      for (const k of [0, 1, 2, 1, 3, 2]) { const [x, z] = corners[k]; vertices.push(x, getTerrainHeight(x, z) + .018, z) }
    }
    const g = this.geo(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.flatMap((v, i) => i % 3 === 0 ? [v * .42, vertices[i + 2] * .42] : []), 2)); g.computeVertexNormals()
    const m = this.roadMaterial; const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.root.add(mesh)
  }
  /** Faction civic building from the shared architecture plans, registered with HP, ruin and supports. */
  private civic(id: string, kind: CivicBuildingKind, site: { x: number; z: number; yaw: number }): void {
    const placed = placeArchitecture(this.architecture, kind, site, { statues: architectureStatues(), hrMuster: kind === 'hr-center' ? townHrLocalMuster(this.hr) : undefined })
    if (kind === 'town-center') for (const anchor of placed.anchors) if (anchor.role === 'service')
      this.serviceStations.set(anchor.id.slice('service:'.length) as TownCenterServiceRole, { x: anchor.x, y: anchor.y, z: anchor.z, yaw: anchor.yaw })
    if (kind === 'town-center') this.civicHalls.push(civicHallFromPlan(id, placed.spec, site, placed.floorY))
    this.root.add(placed.root, placed.ruin)
    if (kind === 'hr-center') {
      for (const slot of this.hr.muster) slot.y = placed.floorY
      for (const support of placed.supports) {
        const y = support.walkSurface && getWalkRampHeight(support.walkSurface, this.hr.officer.x, this.hr.officer.z)
        if (typeof y === 'number') this.hr.officer.y = y
      }
    }
    this.civicShapes.push({ id, bounds: placed.bounds, blocking: placed.obstacles.filter(o => !o.navigationPassable).map(o => o.box) })
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: placed.spec.maxHp, root: placed.root })
    const obstacles = placed.obstacles.map(obstacle => ({ ...obstacle, damageable: hp }))
    const supports = placed.supports
    const airspace: ObstacleData[] = placed.airspaceBounds.map(box => ({ box, isBarricade: false }))
    const ruins = placed.ruinObstacles
    const invalidate = () => { markObstacleTopologyChanged(this.obstacles); markObstacleTopologyChanged(this.airspaceObstacles) }
    const setDamaged = (damaged: boolean) => {
      placed.setDamaged(damaged); invalidate()
    }
    const restorePhysics = () => {
      for (const part of ruins) { removeObstacleData(this.obstacles, part); removeObstacleData(this.airspaceObstacles, part) }
      for (const part of [...airspace, ...obstacles, ...supports]) if (!part.physicalPassable && !this.airspaceObstacles.includes(part)) this.airspaceObstacles.push(part)
      invalidate()
    }
    this.buildings.push({ id, ownerFaction: this.ownerAllegiance, obstacles, supports, hp, roof: placed.roof, ruin: placed.ruin, damaged: false, setDamaged, restorePhysics })
    this.obstacles.push(...obstacles, ...supports)
    this.airspaceObstacles.push(...airspace)
    hp.onDestroyed(() => {
      placed.ruin.visible = true
      for (const part of obstacles) { removeObstacleData(this.obstacles, part); removeObstacleData(this.airspaceObstacles, part) }
      for (const part of airspace) removeObstacleData(this.airspaceObstacles, part)
      // The foundation and entrance remain visible and walkable. Only fallen pieces obstruct movement/flight.
      this.obstacles.push(...ruins); this.airspaceObstacles.push(...ruins)
      invalidate()
    })
  }
  /** Bandit camp tent (canvas roof over a low base). */
  private tent(id: string, x: number, z: number, yaw: number, campId: number): void {
    const w = 5, d = 5, h = 2.4
    const y = getTerrainHeight(x, z), root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = yaw; this.root.add(root)
    const lowGround = Math.min(...[-1, 1].flatMap(sx => [-1, 1].map(sz => getTerrainHeight(x + Math.cos(yaw) * sx * w / 2 + Math.sin(yaw) * sz * d / 2, z - Math.sin(yaw) * sx * w / 2 + Math.cos(yaw) * sz * d / 2))))
    const foundationDepth = Math.max(.5, y - lowGround + .6)
    this.cube(root, 0, .5 - foundationDepth / 2, 0, w + .7, foundationDepth, d + .7, this.stone)
    const roof = new THREE.Group(); roof.position.y = .2; root.add(roof)
    const slope = Math.atan2(h, w / 2), span = Math.hypot(h, w / 2)
    for (const side of [-1, 1]) {
      const panel = this.cube(roof, side * w / 4, h / 2, 0, span + .6, .22, d + 1, this.canvas); panel.rotation.z = -side * slope
      if (this.faction !== 'roman') { const cap = panel.clone(); cap.material = this.snow; cap.position.y += .17; cap.scale.y = .16; roof.add(cap) }
    }
    const ruin = new THREE.Group(); ruin.position.copy(root.position); ruin.rotation.y = yaw; ruin.visible = false; this.root.add(ruin)
    for (let i = 0; i < 9; i++) { const chunk = this.cube(ruin, Math.sin(i * 8) * w * .35, .25 + i % 2 * .15, Math.cos(i * 4) * d * .3, 2.2, .4, .7, this.wood); chunk.rotation.y = i * 1.7 }
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: 120, root })
    this.batch(root); this.batch(roof); this.batch(ruin)
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-w / 2 - .2, -100, -d / 2 - .2), new THREE.Vector3(w / 2 + .2, h + 3, d / 2 + .2)).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).translate(root.position), isBarricade: false, damageable: hp }
    const setDamaged = (damaged: boolean) => {
      roof.rotation.z = damaged ? .14 : 0; roof.position.y = damaged ? -.8 : .2
      roof.children.slice(0, 2).forEach(child => { child.visible = !damaged })
    }
    this.buildings.push({ id, ownerFaction: Faction.BANDIT, campId, obstacles: [obstacle], supports: [], hp, roof, ruin, damaged: false, setDamaged }); this.obstacles.push(obstacle)
    this.airspaceObstacles.push({ box: new THREE.Box3().setFromObject(root), isBarricade: false })
    hp.onDestroyed(() => { ruin.visible = true; removeObstacleData(this.obstacles, obstacle) })
  }
  refreshDamage(): void { for (const b of this.buildings) if (!b.damaged && b.hp.hpRatio <= .6 && !b.hp.destroyed) { b.damaged = true; b.setDamaged(true) } }
  restoreTownDamage(): void {
    for (const building of this.buildings) {
      if (building.ownerFaction !== Faction.TOWN) continue
      building.hp.restore()
      building.ruin.visible = false
      if (building.damaged) building.setDamaged(false)
      building.damaged = false
      building.restorePhysics?.()
      for (const obstacle of [...building.obstacles, ...building.supports]) if (!this.obstacles.includes(obstacle)) {
        this.obstacles.push(obstacle)
        markObstacleTopologyChanged(this.obstacles)
      }
    }
  }
  addTarget(x: number, z: number, ranged: boolean): THREE.Vector3 {
    const y = getTerrainHeight(x, z), target = new THREE.Vector3(x, y + 1.3, z)
    this.cube(this.root, x, y + .8, z, .15, 1.6, .15, this.wood)
    this.cube(this.root, x, y + 1.3, z, ranged ? .9 : .55, ranged ? .9 : .7, .18, this.canvas)
    this.cube(this.root, x, y + 1.3, z - .11, ranged ? .2 : 1.2, .16, .05, this.roofMat)
    this.solid(x, z, .5, 1.7, .35)
    this.targets.push(target); return target
  }
  finalizeTrainingTargets(): void { this.batch(this.root) }

  private markerMaterial?: THREE.SpriteMaterial
  addServiceMarker(parent: THREE.Object3D, height: number): THREE.Sprite {
    if (!this.markerMaterial) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
      const ctx = canvas.getContext('2d')!; ctx.font = 'bold 112px sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = '#302818'; ctx.lineWidth = 10; ctx.strokeText('?', 64, 105); ctx.fillStyle = '#ffe096'; ctx.fillText('?', 64, 105)
      const map = new THREE.CanvasTexture(canvas); this.textures.add(map)
      this.markerMaterial = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false }); this.materials.add(this.markerMaterial)
    }
    const marker = new THREE.Sprite(this.markerMaterial); marker.name = 'town-service-question'; marker.position.y = height + .7; marker.scale.set(1.05, 1.05, 1); marker.renderOrder = 200; parent.add(marker); return marker
  }
  dispose(): void {
    setObstaclePathQuerySource(this.obstacles, false)
    this.siegeDockPassages?.dispose(); this.root.traverse(child => { if (child instanceof THREE.InstancedMesh) child.dispose() }); this.root.removeFromParent(); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.architecture.dispose() }
}
