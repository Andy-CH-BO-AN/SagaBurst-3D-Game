import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { flameParts } from '../../arena/ArenaKit'
import { getTerrainHeight, type ObstacleData, type WalkRampSurface } from '../../world/Terrain'
import { WeaponMeshFactory } from '../../world/WeaponMeshFactory'
import { surfaceBox } from '../TownRamparts'
import type { CommandWatchtowerLayout } from '../TownCommandWatchtowerLayout'
import { ArchitectureKit, PALETTE, Sketch, type BuildContext } from './ArchitectureKit'
import { architectureSpec, DEEP, type ArchitectureFaction, type BuildingSpec, type CivicBuildingKind, type LocalRect } from './ArchitectureSpecs'
import { buildRomanHome, buildRomanHrCenter, buildRomanStable, buildRomanTownCenter, buildRomanWeapons } from './RomanBuildings'
import { buildVikingHome, buildVikingHrCenter, buildVikingStable, buildVikingTownCenter, buildVikingWeapons } from './VikingBuildings'

export { ArchitectureKit } from './ArchitectureKit'
export * from './ArchitectureSpecs'

export interface ArchitectureSite { readonly x: number; readonly z: number; readonly yaw: number }
export type TerrainSampler = (x: number, z: number) => number

/* ─────────────────────────── statues ─────────────────────────── */

/** Static carved warrior meshes (two LODs each, unit height, feet at y=0, facing +Z). */
export interface ArchitectureStatues {
  readonly roman: readonly [THREE.BufferGeometry, THREE.BufferGeometry]
  readonly viking: readonly [THREE.BufferGeometry, THREE.BufferGeometry]
  dispose(): void
}
export const ARCHITECTURE_STATUE_URLS = {
  roman: 'models/architecture/roman-byzantine-statue.glb',
  viking: 'models/architecture/viking-berserker-statue.glb',
} as const
/** Statue LOD switch distance (m): LOD0 near, LOD1 beyond, hidden past the far limit. */
export const ARCHITECTURE_STATUE_LOD = { near: 38, far: 170 } as const

export async function loadArchitectureStatues(base = import.meta.env.BASE_URL): Promise<ArchitectureStatues> {
  const loader = new GLTFLoader()
  const load = async (url: string): Promise<[THREE.BufferGeometry, THREE.BufferGeometry]> => {
    const gltf = await loader.loadAsync(base + url)
    const lods: THREE.BufferGeometry[] = []
    for (const name of ['LOD0', 'LOD1']) {
      const mesh = gltf.scene.getObjectByName(name)
      if (!(mesh instanceof THREE.Mesh)) throw new Error(`${url}: missing ${name}`)
      mesh.updateWorldMatrix(true, false)
      const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrixWorld)
      geometry.computeBoundingSphere()
      lods.push(geometry)
      ;(mesh.geometry as THREE.BufferGeometry).dispose()
    }
    return [lods[0], lods[1]]
  }
  const [roman, viking] = await Promise.all([load(ARCHITECTURE_STATUE_URLS.roman), load(ARCHITECTURE_STATUE_URLS.viking)])
  return { roman, viking, dispose() { for (const g of [...roman, ...viking]) g.dispose() } }
}

/* ─────────────────────────── buildings ─────────────────────────── */

export interface PlacedArchitecture {
  readonly spec: BuildingSpec
  readonly site: ArchitectureSite
  /** Body, roof and ruin share this transform; Town damage swaps roof/ruin visibility. */
  readonly root: THREE.Group
  readonly roof: THREE.Group
  readonly ruin: THREE.Group
  /** Terrain at the site centre and the (possibly lifted) interior floor, world Y. */
  readonly groundY: number
  readonly floorY: number
  /** World collision: walls/columns/props, overhead roof volumes, floor and entrance walk surfaces. */
  readonly obstacles: ObstacleData[]
  readonly entrance: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly width: number }
  readonly anchors: readonly { readonly id: string; readonly role: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }[]
  /** World XZ corners of the public interior, when the building has one. */
  readonly interior?: readonly THREE.Vector3[]
  /** Visual world bounds of the built body and roof. */
  readonly bounds: THREE.Box3
  /** Removes the groups from their parent; GPU resources stay with the kit. */
  detach(): void
}

export interface PlaceArchitectureOptions {
  readonly statues?: ArchitectureStatues
  readonly terrain?: TerrainSampler
  /** Viking Town winter dressing (snow caps); defaults to the faction. */
  readonly snow?: boolean
}

const BUILDERS: Record<ArchitectureFaction, Record<CivicBuildingKind, (ctx: BuildContext) => void>> = {
  roman: { 'town-center': buildRomanTownCenter, 'hr-center': buildRomanHrCenter, weapons: buildRomanWeapons, stable: buildRomanStable,
    'home-a': ctx => buildRomanHome(ctx, 'home-a'), 'home-b': ctx => buildRomanHome(ctx, 'home-b'), 'home-c': ctx => buildRomanHome(ctx, 'home-c') },
  viking: { 'town-center': buildVikingTownCenter, 'hr-center': buildVikingHrCenter, weapons: buildVikingWeapons, stable: buildVikingStable,
    'home-a': ctx => buildVikingHome(ctx, 'home-a'), 'home-b': ctx => buildVikingHome(ctx, 'home-b'), 'home-c': ctx => buildVikingHome(ctx, 'home-c') },
}

/** Building-local (side = x, forward = z) → world, the same mapping as TownRules.townSitePoint. */
export function architectureLocalToWorld(site: ArchitectureSite, x: number, z: number): { x: number; z: number } {
  return { x: site.x + Math.cos(site.yaw) * x + Math.sin(site.yaw) * z, z: site.z - Math.sin(site.yaw) * x + Math.cos(site.yaw) * z }
}

/**
 * Builds one faction building at a Town site on the live terrain.
 *
 * The floor is lifted just above the highest terrain under it (never below the
 * plan's nominal floor), the plinth reaches below the lowest corner, and
 * entrance steps run down to the sampled ground. All colliders and walk
 * surfaces are generated from the plan, so the visible doorway, interior and
 * collision always agree. Site yaw must be a multiple of 90°.
 */
export function placeArchitecture(kit: ArchitectureKit, kind: CivicBuildingKind, site: ArchitectureSite, options: PlaceArchitectureOptions = {}): PlacedArchitecture {
  const spec = architectureSpec(kit.faction, kind)
  const terrain = options.terrain ?? getTerrainHeight
  const world = (x: number, z: number) => architectureLocalToWorld(site, x, z)
  const groundY = terrain(site.x, site.z)
  const env = spec.envelope
  let high = -Infinity, low = Infinity
  for (const r of spec.floor) for (let x = r.minX; x <= r.maxX + 1e-6; x += Math.max(.5, (r.maxX - r.minX) / 8))
    for (let z = r.minZ; z <= r.maxZ + 1e-6; z += Math.max(.5, (r.maxZ - r.minZ) / 8)) { const p = world(x, z); high = Math.max(high, terrain(p.x, p.z) - groundY) }
  for (const x of [env.minX, 0, env.maxX]) for (const z of [env.minZ, 0, env.maxZ]) { const p = world(x, z); low = Math.min(low, terrain(p.x, p.z) - groundY) }
  const lift = spec.fixedFloor ? 0 : Math.max(0, high + .12 - spec.floorY)
  const rootY = groundY + lift
  const plinthBottom = Math.min(low, 0) - lift - .6
  const ground = (x: number, z: number) => { const p = world(x, z); return terrain(p.x, p.z) - rootY }
  const service = spec.anchors.find(anchor => anchor.role === 'merchant')
  const canopyY = Math.max(spec.floorY + 5.6, service ? ground(service.x, service.z) + 5.5 : 0)

  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-${kind}`
  root.position.set(site.x, rootY, site.z); root.rotation.y = site.yaw
  const roof = new THREE.Group(); roof.name = 'roof'; root.add(roof)
  const ruin = new THREE.Group(); ruin.name = 'ruin'; ruin.visible = false; root.add(ruin)
  const body = new Sketch(kit), roofSketch = new Sketch(kit)
  const ctx: BuildContext = {
    kit, body, roof: roofSketch, root, snow: options.snow ?? kit.faction === 'viking', ground, canopyY,
    statue: (x, y, z, yaw, height) => { if (options.statues) root.add(statueLod(kit, options.statues, x, y, z, yaw, height)) },
    display: (id, kindOf, x, y, z, tilt = 0, yaw = 0) => root.add(weaponDisplay(kit, id, kindOf, x, y, z, tilt, yaw)),
  }
  foundation(ctx, spec, plinthBottom)
  BUILDERS[kit.faction][kind](ctx)
  body.build(root, root.name)
  roofSketch.build(roof, `${root.name}-roof`)
  rubble(kit, ruin, spec)
  root.updateMatrixWorld(true)

  // Collision in world space.
  const rotation = new THREE.Matrix4().makeRotationY(site.yaw)
  const toWorld = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) =>
    new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)).applyMatrix4(rotation).translate(new THREE.Vector3(site.x, rootY, site.z))
  const obstacles: ObstacleData[] = []
  for (const collider of spec.colliders) {
    const [x0, y0, z0, x1, y1, z1] = collider.box
    const box = toWorld(x0, y0 <= DEEP ? plinthBottom - .4 : y0, z0, x1, y1, z1)
    const overhead = collider.role === 'roof' || collider.role === 'overhead'
    obstacles.push({ box, isBarricade: false, ...(overhead ? { navigationPassable: true } : {}) })
  }
  const floorTop = rootY + spec.floorY, base = rootY + plinthBottom
  for (const rect of spec.floor) obstacles.push(walkSlab(site, rect, floorTop, base))
  const e = spec.entrance, out = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw))
  const threshold = world(e.x, e.z)
  const foot = world(e.x + out.x * e.approach, e.z + out.z * e.approach)
  const footY = terrain(foot.x, foot.z) + .03
  if (e.approach > 0 && Math.abs(floorTop - footY) > .05) {
    const length = Math.hypot(threshold.x - foot.x, threshold.z - foot.z)
    const ramp: WalkRampSurface = { startX: foot.x, startZ: foot.z, dirX: (threshold.x - foot.x) / length, dirZ: (threshold.z - foot.z) / length,
      halfWidth: e.width / 2, length, landing: 0, startY: footY, topY: floorTop, mounted: true }
    const box = surfaceBox(ramp); box.min.y = Math.min(base, footY - .4)
    obstacles.push({ box, walkSurface: ramp, solidBelow: box.min.y, isBarricade: false, navigationPassable: true })
  }
  const anchors = spec.anchors.map(anchor => {
    const p = world(anchor.x, anchor.z)
    return { id: anchor.id, role: anchor.role, x: p.x, y: anchor.role === 'merchant' ? terrain(p.x, p.z) : floorTop, z: p.z, yaw: anchor.yaw + site.yaw }
  })
  const interior = spec.interior ? [[spec.interior.minX, spec.interior.minZ], [spec.interior.maxX, spec.interior.minZ], [spec.interior.maxX, spec.interior.maxZ], [spec.interior.minX, spec.interior.maxZ]]
    .map(([x, z]) => { const p = world(x, z); return new THREE.Vector3(p.x, floorTop, p.z) }) : undefined
  ruin.visible = false
  const bounds = new THREE.Box3().setFromObject(root)
  return {
    spec, site, root, roof, ruin, groundY, floorY: floorTop, obstacles, interior, bounds,
    entrance: { x: threshold.x, y: floorTop, z: threshold.z, yaw: e.yaw + site.yaw, width: e.width },
    anchors,
    detach() { root.removeFromParent() },
  }
}

function walkSlab(site: ArchitectureSite, rect: LocalRect, top: number, base: number): ObstacleData {
  const a = architectureLocalToWorld(site, (rect.minX + rect.maxX) / 2, rect.minZ)
  const b = architectureLocalToWorld(site, (rect.minX + rect.maxX) / 2, rect.maxZ)
  const length = rect.maxZ - rect.minZ
  const surface: WalkRampSurface = { startX: a.x, startZ: a.z, dirX: (b.x - a.x) / length, dirZ: (b.z - a.z) / length,
    halfWidth: (rect.maxX - rect.minX) / 2, length, landing: 0, startY: top, topY: top, mounted: true }
  const box = surfaceBox(surface); box.min.y = base
  return { box, walkSurface: surface, solidBelow: base, isBarricade: false, navigationPassable: true }
}

/** Plinth under every floor slab and the entrance steps down to the ground. */
function foundation(ctx: BuildContext, spec: BuildingSpec, bottom: number): void {
  const s = ctx.body, roman = ctx.kit.faction === 'roman', F = spec.floorY
  const color = roman ? (spec.kind.startsWith('home') ? PALETTE.ashlar : PALETTE.travertine) : PALETTE.footing
  for (const r of spec.floor) {
    s.span('stone', r.minX - .12, bottom, r.minZ - .12, r.maxX + .12, F - .06, r.maxZ + .12, color)
    if (roman) s.span('stone', r.minX, F - .06, r.minZ, r.maxX, F, r.maxZ, PALETTE.marble)
    else s.span('wood', r.minX, F - .06, r.minZ, r.maxX, F, r.maxZ, PALETTE.timber)
  }
  const e = spec.entrance
  if (e.approach <= 0) return
  const yaw = e.yaw, out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const footGround = ctx.ground(e.x + out.x * e.approach, e.z + out.z * e.approach)
  const rise = F - footGround
  const count = Math.max(1, Math.min(12, Math.ceil(Math.abs(rise) / .19)))
  const stone = roman || spec.kind === 'hr-center'
  for (let i = 0; i < count; i++) {
    const t0 = i / count, y = F - rise * t0
    const along0 = e.approach * t0, along1 = e.approach
    const c = new THREE.Vector3(e.x, 0, e.z).addScaledVector(out, (along0 + along1) / 2)
    const g = new THREE.BoxGeometry(e.width, Math.max(.05, y - Math.min(footGround, F) + .35), along1 - along0)
    g.rotateY(yaw).translate(c.x, (y + Math.min(footGround, F) - .35) / 2, c.z)
    s.add(stone ? 'stone' : 'wood', g, stone ? PALETTE.marble : PALETTE.timber)
  }
}

function rubble(kit: ArchitectureKit, ruin: THREE.Group, spec: BuildingSpec): void {
  const s = new Sketch(kit), e = spec.envelope, roman = kit.faction === 'roman'
  const w = e.maxX - e.minX, d = e.maxZ - e.minZ
  for (let i = 0; i < 14; i++) {
    const x = (e.minX + e.maxX) / 2 + Math.sin(i * 8) * w * .35, z = (e.minZ + e.maxZ) / 2 + Math.cos(i * 4) * d * .3
    const g = new THREE.BoxGeometry(2.2, .4 + (i % 3) * .2, .8).rotateY(i * 1.7).translate(x, .25 + i % 2 * .15, z)
    s.add(i % 3 && roman ? 'stone' : 'wood', g, i % 3 && roman ? PALETTE.ashlar : PALETTE.darkTimber)
  }
  for (let i = 0; i < 5; i++) s.box(roman ? 'roof' : 'wood', Math.sin(i * 3) * w * .3, .2, Math.cos(i * 5) * d * .25, 2.5, .2, 1.6, roman ? PALETTE.terracotta : PALETTE.hay, i)
  s.build(ruin, `architecture-${kit.faction}-${spec.kind}-ruin`)
}

function statueLod(kit: ArchitectureKit, statues: ArchitectureStatues, x: number, y: number, z: number, yaw: number, height: number): THREE.LOD {
  const [near, far] = statues[kit.faction]
  const lod = new THREE.LOD(); lod.name = `${kit.faction}-statue`
  const a = new THREE.Mesh(near, kit.materials.statue); a.castShadow = true; a.receiveShadow = true
  const b = new THREE.Mesh(far, kit.materials.statue); b.receiveShadow = true
  lod.addLevel(a, 0); lod.addLevel(b, ARCHITECTURE_STATUE_LOD.near); lod.addLevel(new THREE.Object3D(), ARCHITECTURE_STATUE_LOD.far)
  lod.position.set(x, y, z); lod.rotation.y = yaw; lod.scale.setScalar(height)
  return lod
}

const displayTemplates = new WeakMap<ArchitectureKit, Map<string, THREE.Group>>()
function weaponDisplay(kit: ArchitectureKit, id: string, kind: 'melee' | 'ranged' | 'shield', x: number, y: number, z: number, tilt: number, yaw: number): THREE.Object3D {
  let templates = displayTemplates.get(kit)
  if (!templates) displayTemplates.set(kit, templates = new Map())
  let template = templates.get(id)
  if (!template) {
    template = new THREE.Group()
    if (kind === 'melee') WeaponMeshFactory.buildMelee(id, template)
    else if (kind === 'ranged') WeaponMeshFactory.buildRanged(id, template, true)
    else WeaponMeshFactory.buildShield(id, template)
    template.traverse(o => { if (o instanceof THREE.Mesh) kit.resources.track(o.geometry) })
    templates.set(id, template)
  }
  const display = template.clone(true); display.name = 'architecture-display-' + id
  display.position.set(x, y, z); display.rotation.set(0, yaw, tilt)
  display.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = true } })
  return display
}

/* ─────────────────────────── fortification dressing ─────────────────────────── */

export interface ArchitectureDressing { readonly root: THREE.Group; readonly obstacles: ObstacleData[] }

/**
 * Faction gatehouse around an existing Town gate (TownFortifications keeps the
 * opening, jambs, arch/lintel, leaves, HP and controller). Local +Z is outward.
 * Towers stand only on the outer side of the wall line, clear of the rampart
 * deck (inward ≥ 1.2m) and of the 14m passage.
 */
export function dressTownGate(kit: ArchitectureKit, gate: { x: number; z: number; yaw: number }, options: { statues?: ArchitectureStatues; terrain?: TerrainSampler } = {}): ArchitectureDressing {
  const terrain = options.terrain ?? getTerrainHeight
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-gatehouse`
  const groundY = terrain(gate.x, gate.z)
  root.position.set(gate.x, groundY, gate.z); root.rotation.y = gate.yaw
  const s = new Sketch(kit), roman = kit.faction === 'roman'
  const site = { x: gate.x, z: gate.z, yaw: gate.yaw }
  const ground = (x: number, z: number) => { const p = architectureLocalToWorld(site, x, z); return terrain(p.x, p.z) - groundY }
  const obstacles: ObstacleData[] = []
  const rotation = new THREE.Matrix4().makeRotationY(gate.yaw), offset = new THREE.Vector3(gate.x, groundY, gate.z)
  const collide = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    obstacles.push({ box: new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)).applyMatrix4(rotation).translate(offset), isBarricade: false })
  const tower = { inner: 8.8, outer: roman ? 13.8 : 13.6, back: -.9, front: roman ? 4.1 : 3.8, top: roman ? 14 : 12.5 }
  for (const side of [-1, 1]) {
    const x0 = side * tower.inner, x1 = side * tower.outer, cx = (x0 + x1) / 2, w = Math.abs(x1 - x0), d = tower.front - tower.back, cz = (tower.back + tower.front) / 2
    const base = Math.min(ground(cx, tower.front), ground(cx, tower.back), 0) - .8
    collide(Math.min(x0, x1), base, tower.back, Math.max(x0, x1), tower.top + 2.5, tower.front)
    if (roman) {
      s.span('stone', x0, base, tower.back, x1, tower.top - 2.6, tower.front, PALETTE.ashlar)
      s.span('stone', x0 - side * .1, base, tower.back - .1, x1 + side * .1, 1.2, tower.front + .1, PALETTE.travertine)
      for (const y of [7.4, 8.0]) s.span('stone', x0, y, tower.front - .02, x1, y + .45, tower.front + .06, PALETTE.redPlaster)
      s.window(cx, 5.2, tower.front + .03, 0, .45, 1.1, 'stone', true)
      s.banner(cx, 7.1, tower.front + .1, 0, 1.5, 4.2)
      // Arched loggia and hip roof with flag.
      for (const [yaw, fx, fz, width] of [[0, cx, tower.front - .15, w], [Math.PI, cx, tower.back + .15, w], [Math.PI / 2, Math.max(x0, x1) - .15, cz, d], [-Math.PI / 2, Math.min(x0, x1) + .15, cz, d]] as const)
        s.wall('stone', fx, tower.top - 2.6, fz, width, 2.4, .3, [-1, 0, 1].map(k => ({ x: k * width / 3.2, y: .3, w: .95, h: 1.8, arch: .48 })), PALETTE.ashlar, yaw)
      s.span('stone', x0 - side * .25, tower.top - .2, tower.back - .25, x1 + side * .25, tower.top + .05, tower.front + .25, PALETTE.marble)
      s.hipRoof('roof', Math.min(x0, x1) - .4, Math.max(x0, x1) + .4, tower.back - .4, tower.front + .4, tower.top + .05, 1.9)
      s.cylinder('metal', cx, tower.top + 1.9, cz, .04, .05, 2.6, PALETTE.gold, 6)
      s.banner(cx + .62, tower.top + 4.35, cz, 0, 1.1, 1.1)
      // Corinthian column with a fire bowl in front of each jamb, and a statue on a pedestal.
      s.column(side * 7.9, ground(side * 7.9, 1.65) - .3, 1.65, 7.3 - ground(side * 7.9, 1.65), .44)
      collide(side * 7.9 - .5, -2, 1.15, side * 7.9 + .5, 7.2, 2.15)
      s.bowlFire(side * 7.9, 7.2, 1.65, .8)
      const px = side * 11.3, pz = 5.4, py = ground(px, pz)
      s.span('stone', px - .75, py - .4, pz - .75, px + .75, py + 1.5, pz + .75, PALETTE.marble)
      s.laurel(px, py + .9, pz + .78, 0, .28)
      collide(px - .75, -2, pz - .75, px + .75, py + 4.2, pz + .75)
      if (options.statues) root.add(statueLod(kit, options.statues, px, py + 1.5, pz, 0, 2.7))
    } else {
      s.span('stone', x0, base, tower.back, x1, 2.4, tower.front, PALETTE.footing)
      s.span('wood', x0, 2.4, tower.back, x1, tower.top - 2.8, tower.front, PALETTE.weathered)
      for (let t = .2; t < w; t += .55) s.cylinder('wood', Math.min(x0, x1) + t, 2.4, tower.front + .08, .16, .18, tower.top - 5.2, PALETTE.weathered, 7)
      for (const y of [4.4, 7.6]) s.beam('wood', new THREE.Vector3(x0, y, tower.front + .3), new THREE.Vector3(x1, y, tower.front + .3), .3, .3, PALETTE.darkTimber, true)
      s.banner(cx, 8.9, tower.front + .4, 0, 1.4, 4.4, 'wood')
      // Open lookout: corner posts, railing, shields, pyramid shingle roof, crossed finial, beast heads.
      for (const [qx, qz] of [[x0, tower.back], [x1, tower.back], [x0, tower.front], [x1, tower.front]]) s.carvedPost(qx, tower.top - 2.8, qz, 2.9, .2)
      for (const z of [tower.back, tower.front]) s.beam('wood', new THREE.Vector3(x0, tower.top - 1.7, z), new THREE.Vector3(x1, tower.top - 1.7, z), .18, .18, PALETTE.darkTimber)
      s.span('wood', x0 - side * .3, tower.top - 2.9, tower.back - .3, x1 + side * .3, tower.top - 2.7, tower.front + .3, PALETTE.darkTimber)
      s.shield(cx - .8, tower.top - 2.0, tower.front + .1, 0, .45); s.shield(cx + .8, tower.top - 2.0, tower.front + .1, 0, .45, [PALETTE.cream, PALETTE.red])
      s.bowlFire(cx, tower.top - 2.7, cz, .6)
      s.hipRoof('wood', Math.min(x0, x1) - .55, Math.max(x0, x1) + .55, tower.back - .55, tower.front + .55, tower.top, 2.6, PALETTE.weathered)
      for (const k of [-1, 1]) s.beam('wood', new THREE.Vector3(cx - .7 * k, tower.top + 2.2, cz), new THREE.Vector3(cx + .7 * k, tower.top + 3.6, cz), .2, .14, PALETTE.carved)
      for (const [qx, qz, yaw] of [[x1 + side * .4, tower.front + .4, side * Math.PI / 4], [x0 - side * .05, tower.front + .45, -side * Math.PI / 6]] as const) s.dragonHead(qx, tower.top - .2, qz, yaw, .75)
      s.brazier(side * 8.4, ground(side * 8.4, 2.6), 2.6, 1.15)
      collide(side * 8.4 - .4, -2, 2.2, side * 8.4 + .4, 1.6, 3.0)
      const px = side * 11.2, pz = 4.7, py = ground(px, pz)
      s.cylinder('wood', px, py - .3, pz, .45, .5, .7, PALETTE.darkTimber, 10)
      collide(px - .5, -2, pz - .5, px + .5, py + 3, pz + .5)
      if (options.statues) root.add(statueLod(kit, options.statues, px, py + .4, pz, 0, 2.5))
    }
  }
  if (roman) {
    // Attic and pediment over the existing elliptical arch, outward of the rampart deck.
    s.span('stone', -8.8, 8.5, -.9, 8.8, 10.2, 1.45, PALETTE.ashlar)
    s.span('stone', -9.0, 10.2, -.9, 9.0, 10.45, 1.6, PALETTE.marble)
    s.span('stone', -8.8, 8.5, 1.4, 8.8, 9.0, 1.5, PALETTE.redPlaster)
    s.gable('stone', 0, 10.45, 1.25, 12, 2.6, .5, PALETTE.marble)
    s.gable('stone', 0, 10.7, 1.52, 10, 1.9, .06, PALETTE.redPlaster)
    s.eagle(0, 11.6, 1.6, 0, 1.4)
    for (const k of [-1, 1]) s.laurel(k * 2.9, 11.1, 1.58, 0, .45)
    s.box('stone', 0, 7.7, 1.25, .8, 1.0, .3, PALETTE.marble)
    collide(-8.8, 8.5, -.9, 8.8, 13.1, 1.6)
  } else {
    // Covered walk over the lintel with railing, shield and crossed axes.
    for (const x of [-7.4, -3.7, 0, 3.7, 7.4]) s.cylinder('wood', x, 8.2, .1, .14, .14, 2.0, PALETTE.carved, 7)
    s.beam('wood', new THREE.Vector3(-8.8, 9.1, .9), new THREE.Vector3(8.8, 9.1, .9), .16, .16, PALETTE.darkTimber)
    s.span('wood', -9.4, 10.2, -1.0, 9.4, 10.35, 1.3, PALETTE.darkTimber)
    s.shedRoof('wood', { axis: 'x', low: [1.6, 10.2], high: [-.6, 11.2], from: -9.4, to: 9.4, thickness: .16, color: PALETTE.weathered })
    s.shield(0, 7.65, 1.35, 0, .85)
    for (const k of [-1, 1]) {
      s.beam('wood', new THREE.Vector3(-1.6 * k, 6.9, 1.45), new THREE.Vector3(1.0 * k, 8.4, 1.45), .07, .07, PALETTE.timber, true)
      s.box('metal', 1.05 * k, 8.3, 1.48, .5, .35, .05, PALETTE.iron)
    }
    collide(-9.4, 8.2, -1.0, 9.4, 11.3, 1.6)
  }
  s.build(root, root.name)
  root.updateMatrixWorld(true)
  return { root, obstacles }
}

/** Adds faction detail to the existing gate leaves (they keep rotating with their hinges). */
export function dressTownGateLeaves(kit: ArchitectureKit, hinges: readonly THREE.Object3D[]): void {
  hinges.forEach((hinge, index) => {
    const side = index === 0 ? -1 : 1, s = new Sketch(kit)
    for (const z of [-.36, .36]) {
      if (kit.faction === 'roman') {
        for (let y = .6; y < 6; y += .9) for (let x = .7; x < 6.6; x += 1.1) s.add('metal', new THREE.SphereGeometry(.07, 6, 4).translate(-side * x, y, z), PALETTE.bronze)
        s.add('metal', new THREE.TorusGeometry(.32, .05, 6, 16).translate(-side * 6.2, 3.0, z + Math.sign(z) * .06), PALETTE.gold)
      } else {
        for (const y of [.6, 2.0, 3.4, 4.8]) s.span('metal', -side * 6.9, y, z - .03, -side * .1, y + .16, z + .03, PALETTE.iron)
        s.add('metal', new THREE.TorusGeometry(.32, .05, 6, 16).translate(-side * 6.1, 2.7, z + Math.sign(z) * .06), PALETTE.iron)
      }
    }
    s.build(hinge, `architecture-${kit.faction}-gate-leaf`)
  })
}

/**
 * Faction detail along the existing curtain walls (collision unchanged): Roman
 * red band, cornice, pilasters and banners; Viking hung shields and banners.
 */
export function dressTownWalls(kit: ArchitectureKit, walls: readonly ObstacleData[], center: { x: number; z: number }): THREE.Group {
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-wall-dressing`
  const s = new Sketch(kit), roman = kit.faction === 'roman'
  walls.forEach((wall, index) => {
    const b = wall.box, alongX = b.max.x - b.min.x > b.max.z - b.min.z
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2
    const out = alongX ? new THREE.Vector3(0, 0, Math.sign(cz - center.z)) : new THREE.Vector3(Math.sign(cx - center.x), 0, 0)
    const faceX = alongX ? cx : out.x > 0 ? b.max.x : b.min.x, faceZ = alongX ? (out.z > 0 ? b.max.z : b.min.z) : cz
    const length = alongX ? b.max.x - b.min.x : b.max.z - b.min.z, top = b.max.y
    const yaw = Math.atan2(out.x, out.z)
    const strip = (y0: number, y1: number, depth: number, color: number, slot: 'stone' | 'wood' = 'stone') =>
      s.box(slot, faceX + out.x * depth / 2, (y0 + y1) / 2, faceZ + out.z * depth / 2, alongX ? length : depth, y1 - y0, alongX ? depth : length, color)
    if (roman) {
      strip(top - 2.3, top - 1.8, .08, PALETTE.redPlaster)
      strip(top - .3, top, .2, PALETTE.marble)
      if (index % 3 === 0) s.box('stone', faceX + out.x * .1, (b.min.y + top) / 2, faceZ + out.z * .1, alongX ? .7 : .2, top - b.min.y, alongX ? .2 : .7, PALETTE.travertine)
      if (index % 9 === 4) s.banner(faceX, top - 2.5, faceZ, yaw, 1.2, 3.6)
    } else {
      if (index % 2 === 0) s.shield(faceX + out.x * .35, top - 3.6, faceZ + out.z * .35, yaw, .5, index % 4 ? [PALETTE.red, PALETTE.cream] : [PALETTE.cream, 0x2f4a6a])
      if (index % 9 === 4) s.banner(faceX + out.x * .4, top - 1.2, faceZ + out.z * .4, yaw, 1.2, 3.8, 'wood')
    }
  })
  s.build(root, root.name)
  return root
}

/** The pavilion roof rises this far above the authored tower height; callers add its bounds to airspace. */
export const ARCHITECTURE_WATCHTOWER_ROOF_RISE = 2.4

/**
 * Faction cladding and roof for the command watchtower. Shallow detail on the
 * outer ramp foundations and the core, a pavilion roof whose eave stays 3.2m
 * above the observation deck; ramps, landings, rails, guard posts and their
 * collision are untouched. `airspace` is the box eagles must avoid.
 */
export function dressCommandWatchtower(kit: ArchitectureKit, layout: CommandWatchtowerLayout, center: { x: number; z: number }): { root: THREE.Group; airspace: THREE.Box3 } {
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-watchtower-dressing`
  const s = new Sketch(kit), roman = kit.faction === 'roman', c = layout.core
  const deck = layout.platformY, eave = deck + 3.2, ridgeY = layout.groundY + layout.totalHeight + ARCHITECTURE_WATCHTOWER_ROOF_RISE
  // Outer faces of the spiral: banners and blind arches (Roman) or shields and battens (Viking) below each flight.
  layout.ramps.forEach((ramp, index) => {
    const mid = new THREE.Vector3(ramp.startX + ramp.dirX * ramp.length / 2, 0, ramp.startZ + ramp.dirZ * ramp.length / 2)
    let lateral = new THREE.Vector3(-ramp.dirZ, 0, ramp.dirX)
    if (lateral.dot(mid.clone().sub(new THREE.Vector3(center.x, 0, center.z))) < 0) lateral = lateral.negate()
    const yaw = Math.atan2(lateral.x, lateral.z)
    const lower = index >= 4 ? layout.ramps[index - 4] : null
    for (let t = 2; t < ramp.length - 1.5; t += roman ? 4.5 : 3) {
      const y = ramp.startY + (ramp.topY - ramp.startY) * t / ramp.length
      const floor = lower ? lower.startY + (lower.topY - lower.startY) * t / lower.length + 3.2 : layout.groundY
      const p = new THREE.Vector3(ramp.startX + ramp.dirX * t, 0, ramp.startZ + ramp.dirZ * t).addScaledVector(lateral, ramp.halfWidth + .5)
      if (roman) {
        if (y - floor > 4.2 && index % 2 === 0) s.banner(p.x, y - .4, p.z, yaw, 1.2, Math.min(3.4, y - floor - 1))
        else if (y - floor > 2.6) s.archRing('stone', p.x, floor + Math.max(.8, (y - floor) * .35), p.z, .6, .55, .16, .12, PALETTE.marble, yaw)
      } else {
        s.shield(p.x + lateral.x * .1, y + .55, p.z + lateral.z * .1, yaw, .5, (t | 0) % 2 ? [PALETTE.red, PALETTE.cream] : [PALETTE.cream, 0x2f4a6a])
        if (y - floor > 3) s.box('wood', p.x, (y + floor) / 2 - .2, p.z, Math.abs(lateral.x) > .5 ? .1 : .18, y - floor - .6, Math.abs(lateral.x) > .5 ? .18 : .1, PALETTE.darkTimber)
      }
    }
    if (roman) {
      const a = new THREE.Vector3(ramp.startX, ramp.startY - .65, ramp.startZ).addScaledVector(lateral, ramp.halfWidth + .47)
      const b = new THREE.Vector3(ramp.startX + ramp.dirX * ramp.length, ramp.topY - .65, ramp.startZ + ramp.dirZ * ramp.length).addScaledVector(lateral, ramp.halfWidth + .47)
      s.beam('stone', a, b, .1, .4, PALETTE.redPlaster)
    }
  })
  // Pavilion over the observation deck: columns/carved posts at the existing corner standards and a pitched roof.
  const x0 = c.min.x - .6, x1 = c.max.x + .6, z0 = c.min.z - .6, z1 = c.max.z + .6
  s.hipRoof(roman ? 'roof' : 'wood', x0, x1, z0, z1, eave, ridgeY - eave, roman ? undefined : PALETTE.weathered)
  s.span(roman ? 'stone' : 'wood', x0 + .3, eave - .3, z0 + .3, x1 - .3, eave, z1 - .3, roman ? PALETTE.marble : PALETTE.darkTimber)
  if (roman) dentilRing(s, x0 + .3, x1 - .3, z0 + .3, z1 - .3, eave - .35)
  for (const [qx, qz] of [[c.min.x + .5, c.min.z + .5], [c.max.x - .5, c.min.z + .5], [c.min.x + .5, c.max.z - .5], [c.max.x - .5, c.max.z - .5]]) {
    if (roman) s.column(qx, deck + 1.7, qz, eave - deck - 2.0, .2, { flutes: false })
    else s.carvedPost(qx, deck + 1.7, qz, eave - deck - 1.7, .18)
  }
  const cx = (c.min.x + c.max.x) / 2, cz = (c.min.z + c.max.z) / 2
  if (roman) {
    s.add('metal', new THREE.ConeGeometry(.25, .9, 8).translate(cx, ridgeY + .45, cz), PALETTE.gold)
    for (const [qx, qz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) s.add('metal', new THREE.SphereGeometry(.16, 8, 6).translate(qx, eave + .05, qz), PALETTE.gold)
    for (const [z, yaw] of [[z1 - .3, 0], [z0 + .3, Math.PI]] as const) s.banner(cx, eave - .35, z, yaw, 1.5, 2.2)
  } else {
    for (const [qx, qz, yaw] of [[x0, z0, -3 * Math.PI / 4], [x1, z0, 3 * Math.PI / 4], [x0, z1, -Math.PI / 4], [x1, z1, Math.PI / 4]] as const) s.dragonHead(qx, eave - .35, qz, yaw, .8)
    for (const k of [-1, 1]) s.beam('wood', new THREE.Vector3(cx - .8 * k, ridgeY - .1, cz), new THREE.Vector3(cx + .8 * k, ridgeY + 1.4, cz), .22, .14, PALETTE.carved)
  }
  s.build(root, root.name)
  root.updateMatrixWorld(true)
  const airspace = new THREE.Box3(new THREE.Vector3(x0 - .4, eave - .5, z0 - .4), new THREE.Vector3(x1 + .4, ridgeY + 1.6, z1 + .4))
  return { root, airspace }
}
function dentilRing(s: Sketch, x0: number, x1: number, z0: number, z1: number, y: number): void {
  for (let x = x0 + .2; x < x1; x += .45) for (const z of [z0, z1]) s.box('stone', x, y, z, .18, .18, .18, PALETTE.marble)
  for (let z = z0 + .2; z < z1; z += .45) for (const x of [x0, x1]) s.box('stone', x, y, z, .18, .18, .18, PALETTE.marble)
}

/* ─────────────────────────── plaza ─────────────────────────── */

/** Clear spot between the authored plaza training squads for the central monument. */
export const TOWN_PLAZA_MONUMENT = { x: 59, z: 18.5, radius: 2.0 } as const

export function buildTownPlaza(kit: ArchitectureKit, area: { minX: number; maxX: number; minZ: number; maxZ: number }, options: { statues?: ArchitectureStatues; terrain?: TerrainSampler } = {}): ArchitectureDressing {
  const terrain = options.terrain ?? getTerrainHeight
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-plaza`
  const s = new Sketch(kit), roman = kit.faction === 'roman', obstacles: ObstacleData[] = []
  const m = TOWN_PLAZA_MONUMENT, gy = (x: number, z: number) => terrain(x, z)
  const collide = (x: number, z: number, half: number, height: number) => { const y = gy(x, z); obstacles.push({ box: new THREE.Box3(new THREE.Vector3(x - half, y - 1, z - half), new THREE.Vector3(x + half, y + height, z + half)), isBarricade: false }) }
  // Terrain-following paving decal over the whole plaza.
  const paving = kit.decal(`${kit.faction}-plaza-paving`, 1024, (g, size) => paintPlaza(g, size, roman, area, m))
  root.add(terrainDecal(kit, area, paving, terrain, .035))
  const my = gy(m.x, m.z)
  if (roman) {
    s.cylinder('stone', m.x, my - .3, m.z, m.radius, m.radius + .1, .95, PALETTE.marble, 24)
    s.cylinder('water', m.x, my + .5, m.z, m.radius - .15, m.radius - .15, .08, undefined, 24)
    s.span('stone', m.x - .6, my - .2, m.z - .6, m.x + .6, my + 2.1, m.z + .6, PALETTE.marble)
    s.span('stone', m.x - .75, my + 2.0, m.z - .75, m.x + .75, my + 2.3, m.z + .75, PALETTE.marble)
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
      s.laurel(m.x + f.x * .62, my + 1.3, m.z + f.z * .62, yaw, .25)
      s.box('stone', m.x + f.x * .7, my + .95, m.z + f.z * .7, .3, .3, .25, PALETTE.ashlar, yaw)
      s.beam('water', new THREE.Vector3(m.x + f.x * .8, my + .9, m.z + f.z * .8), new THREE.Vector3(m.x + f.x * 1.4, my + .55, m.z + f.z * 1.4), .08, .08)
    }
    collide(m.x, m.z, m.radius, 4.8)
    if (options.statues) root.add(statueLod(kit, options.statues, m.x, my + 2.3, m.z, Math.PI, 2.6))
    // Perimeter: olive planters, benches, braziers on pedestals, banner standards.
    for (const [x, z] of [[area.minX + 2, area.minZ + 2], [area.maxX - 2, area.minZ + 2], [area.minX + 2, area.maxZ - 2], [area.maxX - 2, area.maxZ - 2]]) {
      const y = gy(x, z); s.planter(x, y - .1, z, 2.0, 2.0); s.tree(x, y + .5, z, 'olive', 1.1); collide(x, z, 1.0, 2.5)
    }
    for (const [x, z, yaw] of [[m.x - 4.2, m.z + 3.2, Math.PI / 5], [m.x + 4.2, m.z + 3.2, -Math.PI / 5], [area.minX + 1.2, (area.minZ + area.maxZ) / 2, Math.PI / 2]] as const) {
      s.bench(x, gy(x, z), z, 2.4, yaw, true); collide(x, z, .9, .6)
    }
    for (const [x, z] of [[area.minX + 1.2, area.minZ + 8], [area.maxX - 1.2, area.minZ + 8], [area.minX + 1.2, area.maxZ - 8], [area.maxX - 1.2, area.maxZ - 8]]) {
      const y = gy(x, z); s.span('stone', x - .4, y - .2, z - .4, x + .4, y + 1.3, z + .4, PALETTE.marble); s.bowlFire(x, y + 1.3, z, .7); collide(x, z, .4, 1.7)
    }
    for (const [x, z] of [[area.minX + 8, area.maxZ - 1.2], [area.maxX - 8, area.maxZ - 1.2]]) { s.bannerPole(x, gy(x, z), z, 0, 6, 'metal'); collide(x, z, .15, 6) }
  } else {
    // Fire ring, carved rune stone, log benches, banners, barrels and sacks.
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2
      s.add('stone', new THREE.IcosahedronGeometry(.42, 0).scale(1, .7, 1).translate(m.x + Math.cos(a) * 1.55, my + .15, m.z + Math.sin(a) * 1.55), PALETTE.footing)
    }
    s.cylinder('stone', m.x, my - .1, m.z, 1.25, 1.3, .25, 0x3b3430, 14)
    for (const g of flamesAround(m.x, my + .2, m.z)) s.add('flame', g)
    for (let i = 0; i < 6; i++) { const a = i * 1.05; s.beam('wood', new THREE.Vector3(m.x + Math.cos(a) * .9, my + .2, m.z + Math.sin(a) * .9), new THREE.Vector3(m.x, my + 1.1, m.z), .16, .16, PALETTE.darkTimber, true) }
    collide(m.x, m.z, 1.9, 1.2)
    const rx = m.x + 6.5, rz = m.z - 3
    const rune = kit.decal('viking-rune-stone', 256, (g, size) => {
      g.fillStyle = '#8f877a'; g.fillRect(0, 0, size, size)
      g.strokeStyle = '#7a2a1f'; g.lineWidth = 10; g.beginPath()
      for (let t = 0; t <= 1.001; t += .02) { const a = t * Math.PI * 3.2, r = 90 - t * 60; g[t ? 'lineTo' : 'moveTo'](size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r) }
      g.stroke(); g.fillStyle = '#d8c59a'
      for (let i = 0; i < 7; i++) g.fillRect(28 + i * 30, 222, 6, 24)
    })
    s.add('stone', new THREE.CylinderGeometry(.45, .75, 3.0, 7).scale(1.3, 1, .55).translate(rx, gy(rx, rz) + 1.3, rz), PALETTE.footing)
    const face = new THREE.Mesh(kit.resources.track(new THREE.PlaneGeometry(1.25, 2.2)), rune); face.position.set(rx, gy(rx, rz) + 1.45, rz + .43); root.add(face)
    collide(rx, rz, .8, 3)
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, x = m.x + Math.cos(a) * 4.2, z = m.z + Math.sin(a) * 4.2, y = gy(x, z)
      s.beam('wood', new THREE.Vector3(x - Math.sin(a) * 1.2, y + .4, z + Math.cos(a) * 1.2), new THREE.Vector3(x + Math.sin(a) * 1.2, y + .4, z - Math.cos(a) * 1.2), .5, .5, PALETTE.timber, true)
      collide(x, z, .9, .7)
    }
    for (const [x, z] of [[area.minX + 2, area.maxZ - 2], [area.maxX - 2, area.minZ + 2]]) {
      const y = gy(x, z); s.barrel(x, y, z); s.barrel(x + .8, y, z + .2); s.crate(x + .4, y, z - .9, .7)
      s.box('cloth', x - .7, y + .35, z - .4, .6, .7, .5, PALETTE.canvas); collide(x + .2, z - .2, 1.4, 1.2)
    }
    for (const [x, z] of [[area.minX + 1.2, area.minZ + 6], [area.maxX - 1.2, area.maxZ - 6], [area.minX + 1.2, area.maxZ - 6], [area.maxX - 1.2, area.minZ + 6]]) { s.brazier(x, gy(x, z), z, 1.15); collide(x, z, .45, 1.6) }
    for (const [x, z] of [[area.minX + 8, area.maxZ - 1.2], [area.maxX - 8, area.maxZ - 1.2]]) { s.bannerPole(x, gy(x, z), z, 0, 6.5, 'wood'); collide(x, z, .15, 6.5) }
  }
  s.build(root, root.name)
  return { root, obstacles }
}
/** Two overlapping clusters read as a larger bonfire. */
function flamesAround(x: number, y: number, z: number): THREE.BufferGeometry[] {
  return [...flameParts(x - .2, y, z, 1.5, 11), ...flameParts(x + .25, y, z + .15, 1.3, 19)]
}

function paintPlaza(g: CanvasRenderingContext2D, size: number, roman: boolean, area: { minX: number; maxX: number; minZ: number; maxZ: number }, m: { x: number; z: number }): void {
  const w = area.maxX - area.minX, d = area.maxZ - area.minZ
  const px = (x: number) => (x - area.minX) / w * size, pz = (z: number) => (z - area.minZ) / d * size
  g.fillStyle = roman ? '#bfb3a2' : '#8b8478'; g.fillRect(0, 0, size, size)
  // Cobble/flagstone field.
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cell = roman ? 14 : 26
  for (let y = 0; y < size; y += cell) for (let x = (y / cell) % 2 ? cell / 2 : 0; x < size; x += cell) {
    const shade = (roman ? 170 : 120) + Math.floor(random() * 40)
    g.fillStyle = roman ? `rgb(${shade},${shade - 8},${shade - 20})` : `rgb(${shade},${shade - 3},${shade - 10})`
    g.beginPath(); g.roundRect(x + 1.5, y + 1.5, cell - 3 + (roman ? 0 : random() * 8 - 4), cell - 3, roman ? 2 : 5); g.fill()
  }
  const cx = px(m.x), cz = pz(m.z), scale = size / w
  if (roman) {
    // Octagonal rings and red radial bands around the monument, gold laurel inlay.
    g.strokeStyle = '#a65a4a'; g.lineWidth = .45 * scale
    for (const r of [4.6, 9.5]) { g.beginPath(); for (let i = 0; i <= 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * scale, cz + Math.sin(a) * r * scale) } g.stroke() }
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * 4.6 * scale, cz + Math.sin(a) * 4.6 * scale); g.lineTo(cx + Math.cos(a) * 13 * scale, cz + Math.sin(a) * 13 * scale); g.stroke() }
    g.fillStyle = '#d9ab45'
    const lx = cx, lz = cz - 7 * scale
    for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
      const a = Math.PI / 2 + side * (.4 + i * .3), x = lx + Math.cos(a) * 1.6 * scale, y = lz + Math.sin(a) * 1.6 * scale
      g.beginPath(); g.ellipse(x, y, .45 * scale, .18 * scale, a + side, 0, Math.PI * 2); g.fill()
    }
    g.strokeStyle = '#efe6d6'; g.lineWidth = .5 * scale; g.strokeRect(2, 2, size - 4, size - 4)
  } else {
    // Gravel ring around the fire and worn flagstone paths.
    g.fillStyle = '#6c665c'; g.beginPath(); g.arc(cx, cz, 6.5 * scale, 0, Math.PI * 2); g.fill()
    for (let i = 0; i < 4000; i++) { const a = random() * Math.PI * 2, r = random() * 6.5 * scale; g.fillStyle = random() > .5 ? '#7e786d' : '#5a554c'; g.fillRect(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 2, 2) }
    g.strokeStyle = '#a49d8f'; g.lineWidth = .35 * scale; g.beginPath(); g.arc(cx, cz, 6.6 * scale, 0, Math.PI * 2); g.stroke()
    for (let i = 0; i < 1800; i++) { g.fillStyle = 'rgba(235,242,245,.55)'; g.fillRect(random() * size, random() * size, 3 + random() * 6, 2 + random() * 4) }
  }
}

/** Terrain-following textured grid over a rectangle (no collision). */
function terrainDecal(kit: ArchitectureKit, area: { minX: number; maxX: number; minZ: number; maxZ: number }, material: THREE.Material, terrain: TerrainSampler, lift: number): THREE.Mesh {
  const w = area.maxX - area.minX, d = area.maxZ - area.minZ
  const g = kit.resources.track(new THREE.PlaneGeometry(w, d, Math.ceil(w), Math.ceil(d)))
  g.rotateX(-Math.PI / 2)
  const p = g.getAttribute('position'), uv = g.getAttribute('uv')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (area.minX + area.maxX) / 2, z = p.getZ(i) + (area.minZ + area.maxZ) / 2
    p.setXYZ(i, x, terrain(x, z) + lift, z)
    uv.setXY(i, (x - area.minX) / w, 1 - (z - area.minZ) / d)
  }
  g.computeVertexNormals()
  const mesh = new THREE.Mesh(g, material); mesh.receiveShadow = true; mesh.name = 'architecture-ground-decal'
  return mesh
}

/* ─────────────────────────── eagle facilities ─────────────────────────── */

/** Painted landing marks on each pad, following the terrain (no collision, no airspace use). */
export function buildEaglePadMarkings(kit: ArchitectureKit, pads: readonly { x: number; z: number; yaw: number }[], size: { width: number; depth: number }, terrain: TerrainSampler = getTerrainHeight): THREE.Group {
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-eagle-pads`
  const roman = kit.faction === 'roman'
  const material = kit.decal(`${kit.faction}-eagle-pad`, 512, (g, n) => {
    g.clearRect(0, 0, n, n)
    const ink = roman ? 'rgba(232,214,160,.9)' : 'rgba(64,48,34,.8)', accent = roman ? 'rgba(214,170,70,.95)' : 'rgba(158,52,40,.9)'
    g.strokeStyle = ink; g.lineWidth = 10
    g.beginPath(); g.ellipse(n / 2, n / 2, n * .3, n * .3, 0, 0, Math.PI * 2); g.stroke()
    g.setLineDash([22, 18]); g.beginPath(); g.ellipse(n / 2, n / 2, n * .42, n * .42, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([])
    g.fillStyle = accent
    for (const k of [0, 1, 2]) { const y = n * .1 + k * 26; g.beginPath(); g.moveTo(n / 2 - 40, y + 20); g.lineTo(n / 2, y); g.lineTo(n / 2 + 40, y + 20); g.lineTo(n / 2 + 40, y + 32); g.lineTo(n / 2, y + 12); g.lineTo(n / 2 - 40, y + 32); g.fill() }
    if (roman) {
      for (const side of [-1, 1]) for (let i = 0; i < 9; i++) { const a = Math.PI / 2 + side * (.35 + i * .28); g.beginPath(); g.ellipse(n / 2 + Math.cos(a) * n * .2, n / 2 + Math.sin(a) * n * .2, 16, 7, a + side, 0, Math.PI * 2); g.fill() }
    } else {
      g.strokeStyle = accent; g.lineWidth = 8
      for (let k = 0; k < 3; k++) { const ox = n / 2 + (k - 1) * 22, oy = n / 2 + (k === 1 ? -20 : 8); g.beginPath(); for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 3; g[i ? 'lineTo' : 'moveTo'](ox + Math.cos(a) * 46, oy + Math.sin(a) * 46) } g.stroke() }
    }
  }, true)
  for (const pad of pads) {
    const half = Math.max(size.width, size.depth) / 2
    const mesh = terrainDecal(kit, { minX: pad.x - half, maxX: pad.x + half, minZ: pad.z - half, maxZ: pad.z + half }, material, terrain, .05)
    mesh.geometry.translate(-pad.x, 0, -pad.z); mesh.geometry.rotateY(pad.yaw); mesh.geometry.translate(pad.x, 0, pad.z)
    // Re-sample the rotated grid onto the terrain.
    const p = mesh.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) p.setY(i, terrain(p.getX(i), p.getZ(i)) + .05)
    mesh.geometry.computeVertexNormals(); mesh.renderOrder = 2
    root.add(mesh)
  }
  return root
}

/**
 * Shared low supply post for eagle fields (open canvas/shingle shed, harness
 * rack with saddles, crates, two banner standards). Footprint 8×4m, under 3.4m.
 */
export function buildEagleStation(kit: ArchitectureKit, site: ArchitectureSite, terrain: TerrainSampler = getTerrainHeight): ArchitectureDressing {
  const roman = kit.faction === 'roman', groundY = terrain(site.x, site.z)
  const root = new THREE.Group(); root.name = `architecture-${kit.faction}-eagle-station`
  root.position.set(site.x, groundY, site.z); root.rotation.y = site.yaw
  const s = new Sketch(kit), ground = (x: number, z: number) => { const p = architectureLocalToWorld(site, x, z); return terrain(p.x, p.z) - groundY }
  // Open shed on four posts.
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.2], [1.6, 1.2]]) {
    const y = ground(x, z), h = (z < 0 ? 2.9 : 2.5) - y
    if (roman) s.column(x, y, z, h, .12, { flutes: false }); else s.cylinder('wood', x, y - .1, z, .1, .12, h + .1, PALETTE.carved, 7)
  }
  if (roman) {
    for (let i = 0; i < 4; i++) s.shedRoof('cloth', { axis: 'x', low: [1.6, 2.5], high: [-1.8, 3.0], from: -2.0 + i, to: -1.0 + i, thickness: .04, color: i % 2 ? PALETTE.cream : PALETTE.stripe })
    s.span('stone', -1.7, ground(0, -1.7) - .2, -1.8, 1.7, 1.0, -1.5, PALETTE.marble)
    s.banner(0, 2.8, -1.45, 0, 1.0, 1.6)
  } else {
    s.shedRoof('wood', { axis: 'x', low: [1.5, 2.4], high: [-1.9, 3.1], from: -2.1, to: 2.1, thickness: .14, color: PALETTE.weathered })
    s.span('wood', -1.7, ground(0, -1.7) - .2, -1.8, 1.7, 1.4, -1.55, PALETTE.weathered)
    s.shield(0, 1.9, -1.45, 0, .45)
  }
  s.table(0, Math.min(ground(0, -.6), 0), -.6, 2.4, .8, .9)
  s.crate(-1.0, ground(-1.0, .4), .4, .65); s.barrel(1.1, ground(1.1, .5), .5, .8)
  // Harness rack with saddles beside the shed.
  const rx = 3.3
  for (const z of [-1.4, 1.4]) s.cylinder('wood', rx, ground(rx, z) - .1, z, .07, .08, 1.5, PALETTE.darkTimber, 6)
  s.beam('wood', new THREE.Vector3(rx, 1.3, -1.5), new THREE.Vector3(rx, 1.3, 1.5), .1, .1, PALETTE.darkTimber, true)
  for (const z of [-.8, .2, 1.0]) {
    s.box('cloth', rx, 1.25, z, .55, .2, .5, roman ? PALETTE.red : 0x6b4a32)
    s.box('cloth', rx, .95, z, .05, .5, .1, 0x3d2b1f)
  }
  for (const x of [-3.6, 3.9]) s.bannerPole(x, ground(x, 1.6), 1.6, 0, 3.4, roman ? 'metal' : 'wood')
  s.build(root, root.name)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  return { root, obstacles: [{ box, isBarricade: false }] }
}
