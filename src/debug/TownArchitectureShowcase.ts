import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { Player } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { InventoryManager } from '../rpg/InventoryManager'
import { QuiverUI } from '../ui/QuiverUI'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { XongkoroVisual } from '../world/XongkoroVisual'
import { Mount, MountType } from '../world/Mount'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { preloadHighTierEquipment } from '../world/HighTierEquipment'
import { getTerrainHeight, setObstaclePathQuerySource, type ObstacleData } from '../world/Terrain'
import { XONGKORO_LANDING, isEagleLandingClear } from '../world/EagleLanding'
import { isEagleApproachClear } from '../world/EagleApproach'
import { TOWN_GROUND_SIZE, TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { TOWN_CENTER, TOWN_CITY, TOWN_CITY_ROADS, TOWN_GATES, TOWN_GARRISON_EAGLE_SITES, TOWN_LOCAL_ROADS, TOWN_PLAZA, TOWN_PRIVATE_EAGLE_SITES, townHousing, type TownRoad } from '../town/TownLayout'
import { TOWN_SITES, townAuthoredRoster, stableHorsePositions } from '../town/TownRules'
import { resolveTownHRLayout } from '../town/TownHRLayout'
import { createTownFortifications } from '../town/TownFortifications'
import { createTownCommandWatchtower } from '../town/TownCommandWatchtower'
import { TOWN_COMMAND_WATCHTOWER } from '../town/TownCommandWatchtowerLayout'
import { initializeTownWorldTerrain } from '../town/TownWorld'
import {
  ArchitectureKit, architectureLocalToWorld, buildEaglePadMarkings, buildEagleStation, buildTownPlaza, dressCommandWatchtower, dressTownGate,
  dressTownGateLeaves, dressTownWalls, loadArchitectureStatues, originalTownFootprint, placeArchitecture, townHomeVariant, TOWN_PLAZA_MONUMENT,
  type ArchitectureFaction, type ArchitectureStatues, type CivicBuildingKind, type PlacedArchitecture,
} from '../town/architecture/TownArchitecture'

const PLAYER_HALF_HEIGHT = .95

export function resolveTownArchitectureShowcase(query: URLSearchParams): ArchitectureFaction | null {
  const value = query.get('townarchitecture')
  return value === 'roman' || value === 'viking' ? value : null
}

interface ShowcaseEntry { id: string; label: string; placed: PlacedArchitecture; original: { width: number; depth: number }; local: THREE.Box3; triangles: number; meshes: number }
interface CameraShot { position: THREE.Vector3; target: THREE.Vector3 }

/**
 * DEV-only Town architecture showcase (`?townarchitecture=roman|viking&nolock`).
 * Every building, gatehouse, wall, watchtower, plaza and eagle station is built
 * at its real Town position on the real Town terrain with the same builders the
 * Town will use. Player movement, mounting and collision are the game's own.
 * It never reads or writes a Career save.
 */
export async function launchTownArchitectureShowcase(container: HTMLElement, faction: ArchitectureFaction): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('Town architecture showcase is DEV-only')
  const panel = document.createElement('aside')
  panel.id = 'town-architecture-showcase'
  panel.style.cssText = 'position:fixed;top:10px;left:10px;z-index:10000;width:356px;max-height:calc(100vh - 20px);overflow:auto;background:#141a20ee;color:#eee;padding:12px;font:12px/1.5 system-ui;border-radius:8px'
  panel.textContent = '載入城鎮建築展示…'
  document.body.append(panel)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = faction === 'roman' ? 1.05 : 1.12
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .1, 1400)
  let disposed = false, raf = 0
  const kit = new ArchitectureKit(faction)
  let statues: ArchitectureStatues | undefined
  let player: Player | undefined, input: PlayerInput | undefined
  const mounts: Mount[] = []
  const owned: { dispose(): void }[] = []
  const obstacles: ObstacleData[] = []
  const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }
  const cleanup = () => {
    if (disposed) return
    disposed = true; cancelAnimationFrame(raf)
    setObstaclePathQuerySource(obstacles, false)
    input?.dispose(); player?.dispose(); mounts.forEach(m => m.dispose())
    kit.dispose(); statues?.dispose(); owned.forEach(o => o.dispose())
    renderer.dispose(); renderer.domElement.remove(); panel.remove()
    window.removeEventListener('resize', resize); window.removeEventListener('pagehide', cleanup)
    delete (window as unknown as { __townArchitecture?: unknown }).__townArchitecture
  }
  try {
    const layout = initializeTownWorldTerrain(scene)
    scene.background = new THREE.Color(faction === 'roman' ? 0xb8ccd1 : 0x8d9ea9)
    scene.fog = new THREE.Fog(scene.background as THREE.Color, 160, 520)
    scene.add(new THREE.AmbientLight(faction === 'roman' ? 0xffedcf : 0xe0e9f2, .35))
    scene.add(new THREE.HemisphereLight(faction === 'roman' ? 0xfff1d8 : 0xc5d6ef, 0x66614d, 1.5))
    const fill = new THREE.DirectionalLight(0xdde7ec, .7); fill.position.set(0, 12, 70); scene.add(fill)
    const sun = new THREE.DirectionalLight(0xffecd0, 2.4); sun.position.set(-40, 75, 30); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 140, bottom: -140, far: 260 }); sun.shadow.bias = -.002
    scene.add(sun); scene.add(sun.target)
    await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), XongkoroVisual.preload(), preloadPaladinEquipment(), preloadHighTierEquipment(),
      loadArchitectureStatues().then(loaded => { statues = loaded })])
    if (disposed) return
    scene.add(townGround(faction, owned))
    const roads: TownRoad[] = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS]
    scene.add(townRoads(roads, faction, owned))
    const world = new THREE.Group(); world.name = 'architecture-showcase'; scene.add(world)
    const entries: ShowcaseEntry[] = []
    const place = (id: string, label: string, kind: CivicBuildingKind, site: { x: number; z: number; yaw: number }) => {
      const placed = placeArchitecture(kit, kind, site, { statues })
      world.add(placed.root); obstacles.push(...placed.obstacles)
      const saved = { p: placed.root.position.clone(), r: placed.root.rotation.y }
      placed.root.position.set(0, 0, 0); placed.root.rotation.y = 0; placed.root.updateMatrixWorld(true)
      const local = new THREE.Box3()
      let triangles = 0, meshes = 0
      placed.root.traverse(o => {
        if (!(o instanceof THREE.Mesh) || !o.visible || o.parent?.name === 'ruin') return
        if (o.parent instanceof THREE.LOD && o.parent.levels[0].object !== o) return
        local.expandByObject(o); meshes++
        const g = o.geometry as THREE.BufferGeometry; triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
      })
      placed.root.position.copy(saved.p); placed.root.rotation.y = saved.r; placed.root.updateMatrixWorld(true)
      entries.push({ id, label: `${label} · ${placed.spec.label}`, placed, original: originalTownFootprint(faction, kind), local, triangles, meshes })
      return placed
    }
    place('town-center', '城鎮中心', 'town-center', { x: TOWN_CENTER.x, z: TOWN_CENTER.z, yaw: TOWN_CENTER.yaw })
    place('weapons', '武器店', 'weapons', TOWN_SITES.weapons)
    place('stable', '馬廄', 'stable', TOWN_SITES.stable)
    townHousing(faction).forEach((home, i) => place(home.id, `住宅 ${home.id}`, townHomeVariant(i), home))
    // Real fortifications and watchtower supply the gate controllers, ramparts and ramps.
    const fort = createTownFortifications(faction, obstacles, kit.materials.plain)
    world.add(fort.root)
    fort.root.traverse(o => { if (o instanceof THREE.Mesh) owned.push(o.geometry) })
    // Same static merge TownWorld applies to its wall root (per material).
    for (const group of [fort.wallRoot, ...fort.wallRoot.children.filter(c => c instanceof THREE.Group)]) batchStatic(group as THREE.Group, owned)
    world.add(dressTownWalls(kit, fort.walls, { x: (TOWN_CITY.minX + TOWN_CITY.maxX) / 2, z: (TOWN_CITY.minZ + TOWN_CITY.maxZ) / 2 }))
    for (const gate of TOWN_GATES) {
      const dressing = dressTownGate(kit, gate, { statues }); world.add(dressing.root); obstacles.push(...dressing.obstacles)
      const leaves = fort.root.getObjectByName(`town-${gate.id}-gate-leaves`)
      if (leaves) dressTownGateLeaves(kit, leaves.children)
    }
    const hr = resolveTownHRLayout(faction, obstacles, roads)
    place('hr-center', 'HR 中心', 'hr-center', hr.site)
    const plaza = buildTownPlaza(kit, TOWN_PLAZA, { statues }); world.add(plaza.root); obstacles.push(...plaza.obstacles)
    const towerObstacles: ObstacleData[] = []
    const tower = createTownCommandWatchtower(layout, faction, towerObstacles, { ...kit.materials.plain })
    owned.push({ dispose: () => tower.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() }) })
    const towerDressing = dressCommandWatchtower(kit, layout, { x: TOWN_COMMAND_WATCHTOWER.x, z: TOWN_COMMAND_WATCHTOWER.z })
    world.add(tower); world.add(towerDressing.root)
    obstacles.push(...towerObstacles)
    // Eagle fields: painted pads, two shared supply posts, clearance against the built world.
    const pads = [...TOWN_PRIVATE_EAGLE_SITES.map((p, i) => ({ ...p, id: `private-eagle-pad:${i + 1}` })), ...TOWN_GARRISON_EAGLE_SITES.map((p, i) => ({ ...p, id: `garrison-${i + 1}` }))]
    world.add(buildEaglePadMarkings(kit, pads, XONGKORO_LANDING))
    const stations = [buildEagleStation(kit, { x: -40, z: 32.5, yaw: 0 }), buildEagleStation(kit, { x: -36, z: -8, yaw: 0 })]
    for (const station of stations) { world.add(station.root); obstacles.push(...station.obstacles) }
    const airspace = [...obstacles.filter(o => !o.walkSurface), { box: towerDressing.airspace, isBarricade: false, projectilePassable: true }]
    const padChecks = pads.map(pad => ({ id: pad.id, landing: isEagleLandingClear(pad, airspace, pads.filter(o => o !== pad), TOWN_PLAYABLE_WORLD_BOUND),
      approach: isEagleApproachClear(pad, airspace, pads.filter(o => o !== pad), TOWN_PLAYABLE_WORLD_BOUND) }))
    // Real stable horses in their five stalls and one parked xongkoro per eagle field.
    for (const stall of stableHorsePositions()) {
      const horse = new Mount(scene, MountType.HORSE, stall.x, stall.z, getTerrainHeight(TOWN_SITES.stable.x, TOWN_SITES.stable.z) + .5, stall.variant)
      horse.visualHold = true; mounts.push(horse)
    }
    for (const pad of [pads[1], pads[5]]) {
      const eagle = new Mount(scene, MountType.XONGKORO, pad.x, pad.z, getTerrainHeight(pad.x, pad.z))
      eagle.resetForScene(pad.x, pad.z, pad.yaw); eagle.visualHold = true; mounts.push(eagle)
    }
    setObstaclePathQuerySource(obstacles, true)
    world.updateMatrixWorld(true)

    // Overlays: original footprints, plan envelopes, colliders and NPC anchors.
    const overlays = { footprints: new THREE.Group(), colliders: new THREE.Group(), anchors: new THREE.Group() }
    for (const group of Object.values(overlays)) { group.visible = false; scene.add(group) }
    const lineMat = (color: number) => { const m = new THREE.LineBasicMaterial({ color, depthTest: false }); owned.push(m); return m }
    const footMat = lineMat(0xffd54a), envMat = lineMat(0x4ad8ff)
    const rect = (site: { x: number; z: number; yaw: number }, minX: number, maxX: number, minZ: number, maxZ: number, y: number, material: THREE.Material) => {
      const pts = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ]].map(([x, z]) => { const p = architectureLocalToWorld(site, x, z); return new THREE.Vector3(p.x, y, p.z) })
      const g = new THREE.BufferGeometry().setFromPoints(pts); owned.push(g); const line = new THREE.Line(g, material); line.renderOrder = 999; return line
    }
    for (const entry of entries) {
      const { placed, original } = entry, y = placed.floorY + .08
      overlays.footprints.add(rect(placed.site, -original.width / 2, original.width / 2, -original.depth / 2, original.depth / 2, y, footMat))
      const env = placed.spec.envelope
      overlays.footprints.add(rect(placed.site, env.minX, env.maxX, env.minZ, env.maxZ, y + .05, envMat))
      for (const o of placed.obstacles) {
        const helper = new THREE.Box3Helper(o.box, o.walkSurface ? 0x5aff7a : o.navigationPassable ? 0xffa64a : 0xff5a5a)
        ;(helper.material as THREE.Material).depthTest = false; helper.renderOrder = 998; overlays.colliders.add(helper); owned.push(helper.geometry, helper.material as THREE.Material)
      }
      for (const a of placed.anchors) {
        const color = a.role === 'officer' || a.role === 'merchant' ? 0xffc24a : a.role === 'horse' ? 0x4aa8ff : 0x5aff7a
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .06, 14), new THREE.MeshBasicMaterial({ color, depthTest: false }))
        owned.push(disc.geometry, disc.material as THREE.Material); disc.position.set(a.x, a.y + .04, a.z); disc.renderOrder = 997; overlays.anchors.add(disc)
      }
    }
    for (const actor of townAuthoredRoster()) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .05, 10), new THREE.MeshBasicMaterial({ color: 0xff4af0, depthTest: false }))
      owned.push(marker.geometry, marker.material as THREE.Material); marker.position.set(actor.x, getTerrainHeight(actor.x, actor.z) + .1, actor.z); marker.renderOrder = 997; overlays.anchors.add(marker)
    }
    const residentClearance = Math.min(...townAuthoredRoster().map(a => Math.hypot(a.x - TOWN_PLAZA_MONUMENT.x, a.z - TOWN_PLAZA_MONUMENT.z))) - TOWN_PLAZA_MONUMENT.radius

    // Player, horse, cameras.
    const entry = entries[0].placed
    const spawn = { x: entry.entrance.x + Math.sin(entry.entrance.yaw) * 8, z: entry.entrance.z + Math.cos(entry.entrance.yaw) * 8 }
    player = new Player(scene, faction)
    player.resetForScene(spawn.x, getTerrainHeight(spawn.x, spawn.z) + PLAYER_HALF_HEIGHT, spawn.z)
    player.faceDirection(-Math.sin(entry.entrance.yaw), -Math.cos(entry.entrance.yaw))
    const horse = new Mount(scene, MountType.HORSE, spawn.x + 3, spawn.z)
    horse.resetForScene(spawn.x + 3, spawn.z, 0); horse.visualHold = true; mounts.push(horse)
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null }, null, faction)
    input = new PlayerInput()
    const orbit = new ThirdPersonCamera(camera, player); orbit.setYaw(entry.entrance.yaw)
    const hp = new HpBar(), stamina = new StaminaBar(), quiver = new QuiverUI(); player.setDamageHud(hp); hp.setFill(1)
    const sound = { playBowRelease() {} }
    const free = new OrbitControls(camera, renderer.domElement); free.enabled = false; free.enableDamping = true; owned.push(free)
    let mode: 'player' | 'free' | 'shot' = 'free'
    const setFree = (target: THREE.Vector3, position: THREE.Vector3) => { mode = 'free'; free.enabled = true; free.target.copy(target); camera.position.copy(position); free.update() }
    const shotsFor = (e: ShowcaseEntry): Record<string, CameraShot> => {
      const p = e.placed, site = p.site, h = p.spec.height + p.spec.floorY, center = new THREE.Vector3(site.x, p.groundY + h * .4, site.z)
      const size = Math.max(e.local.max.x - e.local.min.x, e.local.max.z - e.local.min.z), dist = size * 1.15 + 6
      const at = (x: number, z: number, y: number) => { const q = architectureLocalToWorld(site, x, z); return new THREE.Vector3(q.x, p.groundY + y, q.z) }
      const ent = p.spec.entrance, inward = { x: -Math.sin(ent.yaw), z: -Math.cos(ent.yaw) }
      const interior = p.spec.interior
      return {
        front: { position: at(-dist * .3, dist, h * .55 + 2), target: center },
        side: { position: at(dist, dist * .15, h * .5 + 2), target: center },
        back: { position: at(-dist * .4, -dist, h * .6 + 2), target: center },
        entrance: { position: at(ent.x - inward.x * 7, ent.z - inward.z * 7, p.spec.floorY + 2.2), target: at(ent.x + inward.x * 4, ent.z + inward.z * 4, p.spec.floorY + 1.6) },
        interior: interior ? { position: at(ent.x + inward.x * 1.2, ent.z + inward.z * 1.2, p.spec.floorY + 2.6), target: at((interior.minX + interior.maxX) / 2 + inward.x * 3, (interior.minZ + interior.maxZ) / 2 + inward.z * 3, p.spec.floorY + 1.2) }
          : { position: at(ent.x - inward.x * 3.5, ent.z - inward.z * 3.5, p.spec.floorY + 1.8), target: at(ent.x + inward.x * 3, ent.z + inward.z * 3, p.spec.floorY + 1) },
      }
    }
    const sites: Record<string, CameraShot> = {
      'overview': { position: new THREE.Vector3(150, 140, 190), target: new THREE.Vector3(20, 0, -8) },
      'gate-south': { position: new THREE.Vector3(18, getTerrainHeight(0, 100) + 11, 132), target: new THREE.Vector3(0, getTerrainHeight(0, 100) + 7, 100) },
      'gate-north': { position: new THREE.Vector3(-14, getTerrainHeight(0, -115) + 11, -148), target: new THREE.Vector3(0, getTerrainHeight(0, -115) + 7, -115) },
      'wall-ramp': { position: new THREE.Vector3(-50, getTerrainHeight(-50, 80) + 24, 60), target: new THREE.Vector3(-35, getTerrainHeight(-35, 95) + 8, 92) },
      'watchtower': { position: new THREE.Vector3(TOWN_COMMAND_WATCHTOWER.x + 40, layout.groundY + 46, TOWN_COMMAND_WATCHTOWER.z + 44), target: new THREE.Vector3(TOWN_COMMAND_WATCHTOWER.x, layout.groundY + 18, TOWN_COMMAND_WATCHTOWER.z) },
      'plaza': { position: new THREE.Vector3(TOWN_PLAZA_MONUMENT.x + 18, getTerrainHeight(59, 18) + 14, TOWN_PLAZA_MONUMENT.z + 24), target: new THREE.Vector3(TOWN_PLAZA_MONUMENT.x - 3, getTerrainHeight(59, 18) + 1.5, TOWN_PLAZA_MONUMENT.z - 2) },
      'eagle-training': { position: new THREE.Vector3(-30, getTerrainHeight(-40, 32) + 16, 12), target: new THREE.Vector3(-50, getTerrainHeight(-55, 54), 50) },
      'eagle-garrison': { position: new THREE.Vector3(-20, getTerrainHeight(-36, -8) + 18, 6), target: new THREE.Vector3(-48, getTerrainHeight(-50, -40), -40) },
    }
    const goto = (target: string, view = 'front') => {
      const e = entries.find(x => x.id === target)
      const s = e ? shotsFor(e)[view] : sites[target]
      if (!s) throw new Error(`Unknown showcase view ${target}/${view}`)
      setFree(s.target, s.position)
    }
    const teleport = (x: number, feetY: number, z: number) => { player!.dismountFromMount({ preserveWorldPosition: true }); player!.resetForScene(x, feetY + PLAYER_HALF_HEIGHT, z) }
    const walkTo = (target: string) => {
      const e = entries.find(x => x.id === target)!.placed, out = { x: Math.sin(e.entrance.yaw), z: Math.cos(e.entrance.yaw) }
      const x = e.entrance.x + out.x * (e.spec.entrance.approach + 2.5), z = e.entrance.z + out.z * (e.spec.entrance.approach + 2.5)
      teleport(x, getTerrainHeight(x, z) + .05, z); player!.faceDirection(-out.x, -out.z); orbit.setYaw(e.entrance.yaw)
      horse.resetForScene(x + out.z * 3, z - out.x * 3, e.entrance.yaw + Math.PI); horse.visualHold = true
      mode = 'player'; free.enabled = false
    }
    /** QA: approach each public hall from outside on foot or mounted, holding W, and report where the body stops. */
    const checkEntrances = (mounted: boolean) => entries.filter(e => e.placed.interior || e.id === 'stable').map(e => {
      const placed = e.placed, out = { x: Math.sin(placed.entrance.yaw), z: Math.cos(placed.entrance.yaw) }
      const x = placed.entrance.x + out.x * (placed.spec.entrance.approach + 4), z = placed.entrance.z + out.z * (placed.spec.entrance.approach + 4)
      teleport(x, getTerrainHeight(x, z) + .05, z); player!.faceDirection(-out.x, -out.z); orbit.setYaw(placed.entrance.yaw); mode = 'player'; free.enabled = false
      if (mounted) { horse.resetForScene(x, z, placed.entrance.yaw + Math.PI); horse.visualHold = false; player!.mountVehicle(horse) }
      advance(.3)
      const start = player!.position.clone()
      advance(e.id === 'stable' ? 2.5 : 5, ['KeyW'])
      const p = player!.position, c = placed.interior
      const inside = c ? p.x > Math.min(...c.map(v => v.x)) && p.x < Math.max(...c.map(v => v.x)) && p.z > Math.min(...c.map(v => v.z)) && p.z < Math.max(...c.map(v => v.z)) : null
      const body = mounted ? horse.group.position.y : p.y - PLAYER_HALF_HEIGHT
      const result = { id: e.id, mounted, moved: +start.distanceTo(p).toFixed(2), bodyY: +body.toFixed(2), floorY: +placed.floorY.toFixed(2), inside }
      if (mounted) { player!.dismountFromMount({ preserveWorldPosition: true }); horse.visualHold = true }
      return result
    })
    const toggleRoofs = (visible?: boolean) => { for (const e of entries) e.placed.roof.visible = visible ?? !e.placed.roof.visible }
    const toggleGates = () => { for (const g of fort.gates.values()) g.toggle() }

    let totalTriangles = 0, totalMeshes = 0
    world.traverse(o => { if (o instanceof THREE.Mesh && !(o.parent instanceof THREE.LOD && o.parent.levels[0].object !== o)) { totalMeshes++; const g = o.geometry as THREE.BufferGeometry; totalTriangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3 * (o instanceof THREE.InstancedMesh ? o.count : 1) } })
    const report = () => entries.map(e => {
      const l = e.local, w = l.max.x - l.min.x, d = l.max.z - l.min.z
      return { id: e.id, label: e.label, original: `${e.original.width}×${e.original.depth}`, built: `${w.toFixed(1)}×${d.toFixed(1)}`,
        envelope: `${(e.placed.spec.envelope.maxX - e.placed.spec.envelope.minX).toFixed(1)}×${(e.placed.spec.envelope.maxZ - e.placed.spec.envelope.minZ).toFixed(1)}`,
        localX: [l.min.x, l.max.x].map(v => +v.toFixed(2)), localZ: [l.min.z, l.max.z].map(v => +v.toFixed(2)),
        height: +(l.max.y).toFixed(2), lift: +(e.placed.floorY - e.placed.groundY - e.placed.spec.floorY).toFixed(2), triangles: Math.round(e.triangles), meshes: e.meshes,
        anchors: e.placed.anchors.length, colliders: e.placed.obstacles.length, stepSlope: +entranceSlope(e.placed).toFixed(2) }
    })
    const other = faction === 'roman' ? 'viking' : 'roman'
    const buttons = (id: string, views: string[]) => views.map(v => `<button data-go="${id}" data-view="${v}">${{ front: '正', side: '側', back: '背', entrance: '入口', interior: '室內' }[v] ?? v}</button>`).join('')
    panel.innerHTML = `<strong>${faction === 'roman' ? '羅馬' : '維京'} 城鎮建築展示 · DEV</strong>
      <div><a href="?townarchitecture=${other}&nolock" style="color:#9cf">切換到${other === 'roman' ? '羅馬' : '維京'}</a> · 真實 Town 地形與座標，不讀寫存檔</div>
      <div style="margin:6px 0">滑鼠拖曳旋轉／右鍵平移／滾輪縮放（自由鏡頭）。「走入」切到玩家：WASD、Shift、Space、E 上下馬。</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
        ${Object.keys(sites).map(k => `<button data-go="${k}">${{ overview: '全景', 'gate-south': '南門', 'gate-north': '北門', 'wall-ramp': '城牆坡道', watchtower: '瞭望塔', plaza: '廣場', 'eagle-training': '巨鷹訓練場', 'eagle-garrison': '空軍駐地' }[k]}</button>`).join('')}
        <button id="arch-roofs">屋頂顯示切換</button><button id="arch-gates">城門開關</button>
        <label><input type="checkbox" data-overlay="footprints">原 footprint／範圍</label>
        <label><input type="checkbox" data-overlay="colliders">碰撞</label>
        <label><input type="checkbox" data-overlay="anchors">NPC Anchor／居民</label>
      </div>
      <table style="width:100%;border-collapse:collapse">${entries.filter((e, i) => !e.id.startsWith('home-') || i < 6).map(e => `<tr><td style="padding:2px 0">${e.label}</td><td>${buttons(e.id, e.placed.spec.interior ? ['front', 'side', 'back', 'entrance', 'interior'] : ['front', 'side', 'back', 'entrance'])}<button data-walk="${e.id}">走入</button></td></tr>`).join('')}</table>
      <details><summary>其餘住宅</summary>${entries.filter(e => e.id.startsWith('home-')).slice(3).map(e => `<div>${e.label} ${buttons(e.id, ['front', 'back'])}</div>`).join('')}</details>
      <pre id="arch-state" style="font:11px/1.4 monospace;white-space:pre-wrap;margin:6px 0 0"></pre>`
    panel.querySelectorAll<HTMLButtonElement>('button[data-go]').forEach(b => { b.onclick = () => goto(b.dataset.go!, b.dataset.view ?? 'front') })
    panel.querySelectorAll<HTMLButtonElement>('button[data-walk]').forEach(b => { b.onclick = () => walkTo(b.dataset.walk!) })
    panel.querySelectorAll<HTMLInputElement>('input[data-overlay]').forEach(c => { c.onchange = () => { overlays[c.dataset.overlay as keyof typeof overlays].visible = c.checked } })
    panel.querySelector<HTMLButtonElement>('#arch-roofs')!.onclick = () => toggleRoofs()
    panel.querySelector<HTMLButtonElement>('#arch-gates')!.onclick = toggleGates
    const state = panel.querySelector<HTMLElement>('#arch-state')!
    goto('overview')

    const aim = new THREE.Vector3(), frameInfo = { calls: 0, triangles: 0 }
    const simulate = (dt: number) => {
      const p = player!, keys = input!
      kit.update(dt)
      if (mode === 'player') {
        orbit.update(keys, dt, obstacles)
        if (keys.consumeKeyE()) {
          if (p.isMounted) { p.dismountFromMount(); horse.visualHold = horse.onGround }
          else if (horse.group.position.distanceTo(p.position) < 3.2) { horse.visualHold = false; p.mountVehicle(horse) }
        }
      } else free.update()
      p.update(dt, keys, orbit.cameraYaw, orbit.getAimPoint(aim), obstacles, stamina, quiver, sound, inventory)
      if (!p.isMounted) { horse.update(dt, obstacles); if (horse.onGround) horse.visualHold = true }
      p.fitMountedSeat()
      for (const m of mounts) if (m !== horse) m.update(dt, obstacles)
    }
    const advance = (seconds: number, held: string[] = []) => {
      for (const code of held) input!.keys[code] = true
      try { for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60) } finally { for (const code of held) input!.keys[code] = false }
    }
    Object.assign(window, { __townArchitecture: { faction, entries, report, padChecks, checkEntrances, residentClearance, goto, walkTo, teleport, advance, toggleRoofs, toggleGates,
      overlays, camera, renderer, player, horse, fort, setMode: (m: 'player' | 'free') => { mode = m; free.enabled = m === 'free' }, frameInfo,
      cost: { meshes: totalMeshes, triangles: Math.round(totalTriangles) }, dispose: cleanup,
      /** QA: one synchronous frame (works while the tab is in the background). */
      render: () => { if (mode === 'free') free.update(); else orbit.update(input!, 0, obstacles); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', .9) } } })
    window.addEventListener('resize', resize); window.addEventListener('pagehide', cleanup)
    let last = performance.now(), statusElapsed = 0
    const frame = (time: number) => {
      if (disposed) return
      raf = requestAnimationFrame(frame)
      const dt = Math.min(.05, Math.max(0, (time - last) / 1000)); last = time
      simulate(dt)
      renderer.render(scene, camera)
      frameInfo.calls = renderer.info.render.calls; frameInfo.triangles = renderer.info.render.triangles
      if ((statusElapsed += dt) > .25) {
        statusElapsed = 0
        const p = player!, feet = p.position.y - PLAYER_HALF_HEIGHT
        const failing = padChecks.filter(c => !c.landing || !c.approach).map(c => c.id)
        state.textContent = [
          `模式 ${mode === 'player' ? '玩家' : '自由鏡頭'}${p.isMounted ? ' · 騎乘' : ''} · 玩家 ${p.position.x.toFixed(1)}, ${feet.toFixed(2)}, ${p.position.z.toFixed(1)}`,
          `本幀 draw calls ${frameInfo.calls} · 三角面 ${frameInfo.triangles.toLocaleString()}`,
          `建築與裝飾 ${totalMeshes} meshes · ${Math.round(totalTriangles).toLocaleString()} 三角面（含城牆／瞭望塔）`,
          `巨鷹停機位 ${pads.length} 個：${failing.length ? '✘ ' + failing.join(', ') : '全部通過 landing／approach 淨空'}`,
          `廣場紀念碑與最近 authored 居民距離 ${residentClearance.toFixed(1)}m`,
          ...report().map(r => `${r.id.padEnd(12)} 原 ${r.original} → 建 ${r.built}（範圍 ${r.envelope}）高 ${r.height}m`),
        ].join('\n')
      }
    }
    raf = requestAnimationFrame(frame)
  } catch (error) {
    cleanup()
    throw error
  }
}

/** Rise over run of the entrance steps (mounts climb ≤ ~0.5). */
function entranceSlope(p: PlacedArchitecture): number {
  const ramp = p.obstacles.find(o => o.walkSurface && o.walkSurface.startY !== o.walkSurface.topY)?.walkSurface
  return ramp ? Math.abs(ramp.topY - ramp.startY) / ramp.length : 0
}
function batchStatic(parent: THREE.Group, owned: { dispose(): void }[]): void {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>()
  for (const child of parent.children) if (child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && !Array.isArray(child.material) && !child.geometry.getAttribute('color')) {
    const bucket = buckets.get(child.material) ?? []; bucket.push(child); buckets.set(child.material, bucket)
  }
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue
    const parts = meshes.map(m => { m.updateMatrix(); const g = m.geometry.clone().applyMatrix4(m.matrix); return g.index ? g.toNonIndexed() : g })
    for (const part of parts) for (const name of Object.keys(part.attributes)) if (!parts.every(p => p.hasAttribute(name))) for (const p of parts) p.deleteAttribute(name)
    const merged = mergeGeometries(parts, false); parts.forEach(p => p.dispose())
    if (!merged) continue
    owned.push(merged)
    const mesh = new THREE.Mesh(merged, material); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh)
    meshes.forEach(m => m.removeFromParent())
  }
}
function townGround(faction: ArchitectureFaction, owned: { dispose(): void }[]): THREE.Mesh {
  const g = new THREE.PlaneGeometry(TOWN_GROUND_SIZE, TOWN_GROUND_SIZE, 280, 280); g.rotateX(-Math.PI / 2)
  const p = g.attributes.position, colors: number[] = []
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i); p.setY(i, getTerrainHeight(x, z))
    const n = Math.sin(x * .4) * Math.cos(z * .29) + Math.sin(z * .7) * .3
    const c = new THREE.Color(faction === 'roman' ? (n > -.4 ? 0x6d7650 : 0x858061) : (n > -.8 ? 0xd4dee2 : 0x9ba19b)); colors.push(c.r, c.g, c.b)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals()
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 })
  owned.push(g, m)
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; return mesh
}
function townRoads(roads: readonly TownRoad[], faction: ArchitectureFaction, owned: { dispose(): void }[]): THREE.Mesh {
  const vertices: number[] = []
  for (const r of roads) {
    const length = Math.hypot(r.bx - r.ax, r.bz - r.az), count = Math.ceil(length / 1), across = Math.ceil(r.width / 1)
    const nx = -(r.bz - r.az) / length, nz = (r.bx - r.ax) / length
    for (let i = 0; i < count; i++) for (let j = 0; j < across; j++) {
      const corners = [i / count, (i + 1) / count].flatMap(t => [j / across - .5, (j + 1) / across - .5].map(side => [r.ax + (r.bx - r.ax) * t + nx * r.width * side, r.az + (r.bz - r.az) * t + nz * r.width * side]))
      for (const k of [0, 1, 2, 1, 3, 2]) { const [x, z] = corners[k]; vertices.push(x, getTerrainHeight(x, z) + .02, z) }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals()
  const m = new THREE.MeshStandardMaterial({ color: faction === 'roman' ? 0x9b927f : 0x8c867c, roughness: .95, polygonOffset: true, polygonOffsetFactor: -1 })
  owned.push(g, m)
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; return mesh
}
