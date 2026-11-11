import * as THREE from 'three'
import { flameParts } from '../../arena/ArenaKit'
import { PALETTE, type BuildContext, type Sketch } from './ArchitectureKit'
import { VIKING_HOMES, VIKING_HR_CENTER, VIKING_STABLE, VIKING_TOWN_CENTER, VIKING_WEAPONS } from './ArchitectureSpecs'

/* Viking vocabulary: stone footings, vertical plank and log walls, steep
 * thatch/turf/shingle roofs, crossed bargeboards ending in beast heads,
 * carved interlace posts, round shields, rune discs and red banners. */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const THATCH = .55

/** Plank wall run between two x (or z) bounds with a stone footing course. */
function plankWall(s: Sketch, x0: number, z0: number, x1: number, z1: number, y0: number, height: number, color: number = PALETTE.weathered): void {
  s.span('wood', Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y0 + height, Math.max(z0, z1), color)
  s.span('stone', Math.min(x0, x1) - .08, y0 - .4, Math.min(z0, z1) - .08, Math.max(x0, x1) + .08, y0 + .35, Math.max(z0, z1) + .08, PALETTE.footing)
}
/** Vertical battens on a wall face so plank walls read at distance. */
function battens(s: Sketch, a: THREE.Vector3, b: THREE.Vector3, y0: number, height: number, outward: THREE.Vector3, spacing = 1.4): void {
  const length = a.distanceTo(b), count = Math.max(1, Math.round(length / spacing))
  for (let i = 0; i <= count; i++) {
    const p = a.clone().lerp(b, i / count).addScaledVector(outward, .05)
    s.box('wood', p.x, y0 + height / 2, p.z, Math.abs(outward.x) > .5 ? .1 : .14, height, Math.abs(outward.x) > .5 ? .14 : .1, PALETTE.darkTimber)
  }
}
/** Ridge log with rope bindings and crossed ridge sticks. */
function ridge(r: Sketch, a: THREE.Vector3, b: THREE.Vector3, sticks = true): void {
  r.beam('wood', a, b, .36, .36, PALETTE.darkTimber, true)
  const length = a.distanceTo(b), dir = b.clone().sub(a).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x)
  for (let t = .9; t < length - .5; t += 1.8) {
    const p = a.clone().addScaledVector(dir, t)
    if (sticks) for (const k of [-1, 1]) r.beam('wood', p.clone().addScaledVector(side, k * .9).add(V(0, -.55, 0)), p.clone().addScaledVector(side, -k * .25).add(V(0, .45, 0)), .1, .1, PALETTE.timber, true)
    r.add('cloth', new THREE.TorusGeometry(.22, .045, 4, 10).rotateY(Math.atan2(dir.x, dir.z)).translate(p.x, p.y, p.z), PALETTE.rope)
  }
}
/** Carved rune disc (sun-wheel) on a gable, facing yaw. */
function runeDisc(s: Sketch, x: number, y: number, z: number, yaw: number, radius = .7): void {
  s.add('wood', new THREE.CylinderGeometry(radius, radius, .12, 18).rotateX(Math.PI / 2).rotateY(yaw).translate(x, y, z), PALETTE.carved)
  s.add('wood', new THREE.TorusGeometry(radius * .8, .04, 4, 18).rotateY(yaw).translate(x + Math.sin(yaw) * .07, y, z + Math.cos(yaw) * .07), PALETTE.darkTimber)
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, dx = Math.cos(a) * radius * .4, dy = Math.sin(a) * radius * .4
    const g = new THREE.BoxGeometry(.06, radius * .8, .04).rotateZ(a + Math.PI / 2).translate(dx, dy, .08)
    s.add('wood', g.rotateY(yaw).translate(x, y, z), PALETTE.darkTimber)
  }
}

/* ─────────────── Lord's longhouse ─────────────── */
export function buildVikingTownCenter(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = VIKING_TOWN_CENTER, F = T.F, h = T.hall, p = T.porch, top = F + h.top
  const cz = (h.back + h.front) / 2, half = (h.front - h.back) / 2
  // Main hall walls (front wall split around the entrance hall).
  plankWall(s, -h.halfX, h.back, h.halfX, h.back + h.wall, F, h.top)
  for (const side of [-1, 1]) {
    plankWall(s, side * h.halfX, h.back, side * (h.halfX - h.wall), h.front, F, h.top)
    plankWall(s, side * p.halfX, h.front - h.wall, side * h.halfX, h.front, F, h.top)
    battens(s, V(side * p.halfX, 0, h.front), V(side * h.halfX, 0, h.front), F, h.top, V(0, 0, 1))
    battens(s, V(side * h.halfX, 0, h.back), V(side * h.halfX, 0, h.front), F, h.top, V(side, 0, 0))
    // Leaning outer posts along the long walls.
    for (let x = -h.halfX + 1.4; x < h.halfX; x += 2.8) if (Math.abs(x) > p.halfX + .6) s.carvedPost(x, F, h.front + .25, h.top + .2, .2)
  }
  battens(s, V(-h.halfX, 0, h.back), V(h.halfX, 0, h.back), F, h.top, V(0, 0, -1))
  for (const side of [-1, 1]) s.gable('wood', side * (h.halfX - h.wall / 2), top, cz, half * 2 + .3, T.roof.ridge - h.top, .3, PALETTE.weathered, Math.PI / 2)
  // Steep thatch roof and carved end gables.
  // Back slope whole; the front slope is cut over the entrance hall so its eave
  // never drops into the doorway junction (the porch roof covers that span).
  const span = half + T.roof.overhang, eaveY = top - .55, ridgeY = F + T.roof.ridge, x0 = -h.halfX - .7, x1 = h.halfX + .7, px = p.halfX + 1.2
  const cutY = F + T.roof.frontCut, cutZ = cz + (ridgeY - cutY) / (ridgeY - eaveY) * span
  r.shedRoof('roof', { axis: 'x', low: [cz - span, eaveY], high: [cz, ridgeY], from: x0, to: x1, thickness: THATCH })
  for (const [from, to] of [[x0, -px], [px, x1]]) r.shedRoof('roof', { axis: 'x', low: [cz + span, eaveY], high: [cz, ridgeY], from, to, thickness: THATCH })
  r.shedRoof('roof', { axis: 'x', low: [cutZ, cutY], high: [cz, ridgeY], from: -px, to: px, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ axis: 'x', cz, halfSpan: span, from: x0, to: x1, eave: eaveY, ridge: ridgeY, coverage: .5, thickness: THATCH })
  ridge(r, V(-h.halfX - .7, F + T.roof.ridge + .45, cz), V(h.halfX + .7, F + T.roof.ridge + .45, cz))
  for (const side of [-1, 1]) r.crossedGable(side * (h.halfX + .75), F + T.roof.ridge + .45, cz, half + T.roof.overhang, T.roof.ridge - h.top + .55, side * Math.PI / 2, 1.25)
  // Entrance hall: plank walls, door posts, carved gable, rune disc and shield.
  for (const side of [-1, 1]) {
    plankWall(s, side * (p.halfX - h.wall), h.front, side * p.halfX, p.front, F, p.top)
    battens(s, V(side * p.halfX, 0, h.front), V(side * p.halfX, 0, p.front), F, p.top, V(side, 0, 0))
    plankWall(s, side * T.door.half, p.front - h.wall, side * p.halfX, p.front, F, p.top)
    s.carvedPost(side * (T.door.half + .25), F, p.front + .18, T.door.height + .4, .24)
    s.doorLeaf(side * T.door.half, F, p.front - h.wall - .1, T.door.half - .05, T.door.height - .05, side < 0 ? Math.PI : 0)
  }
  s.span('wood', -p.halfX, F + T.door.height, p.front - h.wall, p.halfX, F + p.top, p.front, PALETTE.weathered)
  s.span('wood', -T.door.half - .5, F + T.door.height, p.front, T.door.half + .5, F + T.door.height + .4, p.front + .35, PALETTE.carved)
  for (let x = -T.door.half - .2; x <= T.door.half + .2; x += .45) s.add('wood', new THREE.TorusGeometry(.14, .035, 4, 8).translate(x, F + T.door.height + .2, p.front + .37), PALETTE.darkTimber)
  s.gable('wood', 0, F + p.top, p.front - h.wall / 2, p.halfX * 2, p.ridge - p.top, .3, PALETTE.weathered)
  battens(s, V(-p.halfX + .4, 0, p.front), V(p.halfX - .4, 0, p.front), F + p.top, 1.8, V(0, 0, 1), 1.1)
  runeDisc(s, 0, F + p.top + 2.6, p.front + .05, 0, .85)
  s.shield(0, F + p.top + .95, p.front + .08, 0, .55)
  const porchRoof = { axis: 'z' as const, halfSpan: p.halfX + .6, from: h.front - 2, to: p.front + .45, eave: F + p.top - .45, ridge: F + p.ridge }
  r.gableRoof('roof', { ...porchRoof, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ ...porchRoof, coverage: .5, thickness: THATCH })
  ridge(r, V(0, F + p.ridge + .45, h.front - 1), V(0, F + p.ridge + .45, p.front + .45))
  r.crossedGable(0, F + p.ridge + .45, p.front + .5, p.halfX + .6, p.ridge - p.top + 1.0, 0, 1.35)
  // Stair rails, fire baskets, berserker carvings and shields.
  for (const side of [-1, 1]) {
    const x = side * (T.stairs.half + .12)
    for (const z of [p.front + .1, T.stairs.front - .1]) s.cylinder('wood', x, ctx.ground(x, z) - .2, z, .09, .1, F + 1.1 - ctx.ground(x, z) + .2, PALETTE.carved, 6)
    s.beam('wood', V(x, F + 1.05, p.front + .1), V(x, ctx.ground(x, T.stairs.front) + 1.0, T.stairs.front - .1), .12, .12, PALETTE.carved)
    const bx = side * T.baskets.x, by = ctx.ground(bx, T.baskets.z)
    s.brazier(bx, by, T.baskets.z, 1.15)
    const sx = side * T.statues.x, sy = ctx.ground(sx, T.statues.z)
    s.cylinder('wood', sx, sy - .3, T.statues.z, .42, .46, F + .2 - sy + .3, PALETTE.darkTimber, 10)
    ctx.statue(sx, F + .2, T.statues.z, 0, 2.5)
    for (const x of [6.4, 9.2]) s.shield(side * x, F + 1.9, h.front + .1, 0, .5, side < 0 ? [PALETTE.red, PALETTE.cream] : [PALETTE.cream, 0x2f4a6a])
    s.banner(side * (p.halfX + .9), top - .1, h.front + .45, 0, .95, 2.4, 'wood')
  }
  // Interior: posts, long hearth with fire, high seat, benches, shields and lamps.
  for (const x of T.posts.x) for (const z of T.posts.z) s.carvedPost(x, F, z, h.top + .2, T.posts.r)
  for (const x of T.posts.x) s.beam('wood', V(x, top + .1, T.posts.z[0]), V(x, top + .1, T.posts.z[1]), .26, .26, PALETTE.darkTimber)
  for (const z of T.posts.z) s.beam('wood', V(-h.halfX + .3, top + .1, z), V(h.halfX - .3, top + .1, z), .26, .26, PALETTE.darkTimber)
  const hs = T.hearth
  s.span('stone', -hs.half, F, hs.back, hs.half, F + .3, hs.front, PALETTE.footing)
  s.span('stone', -hs.half + .2, F + .3, hs.back + .2, hs.half - .2, F + .36, hs.front - .2, 0x3d3530)
  for (const x of [-1.6, -.3, 1.0, 2.0]) for (const g of flameParts(x, F + .34, (hs.back + hs.front) / 2, 1.0, Math.round(x * 10 + 40))) s.add('flame', g)
  for (let x = -hs.half + .5; x < hs.half - .3; x += .45) s.add('glow', new THREE.BoxGeometry(.3, .06, .5).translate(x, F + .38, (hs.back + hs.front) / 2), 0xff7a2a, null)
  s.span('wood', -T.seat.half, F, T.seat.back, T.seat.half, F + .6, T.seat.front, PALETTE.carved)
  s.span('wood', -T.seat.half, F + .6, T.seat.back, T.seat.half, F + 1.6, T.seat.back + .2, PALETTE.carved)
  for (const side of [-1, 1]) { s.lynxHead(side * T.seat.half, F + .6, T.seat.back + .1, 0, .35); s.span('wood', side < 0 ? -9 : 3, F, h.back + h.wall, side < 0 ? -3 : 9, F + .5, h.back + h.wall + .55, PALETTE.timber) }
  s.span('cloth', -T.seat.half + .1, F + .62, T.seat.back + .2, T.seat.half - .1, F + .7, T.seat.front, PALETTE.fur)
  for (const side of [-1, 1]) for (const x of [2.5, 5.5, 8.5]) s.shield(side * x, F + 2.2, h.back + h.wall + .06, 0, .45, x === 5.5 ? [PALETTE.cream, PALETTE.red] : [PALETTE.red, PALETTE.cream])
  for (const x of [-6, 6]) s.banner(x, top - .1, h.back + h.wall + .05, 0, 1.0, 2.2, 'wood')
  for (const x of [-6.3, 6.3]) for (const z of [-5.6, 0]) s.lantern(x, top - .4, z)
  s.span('cloth', -1.2, F + .005, hs.front + .2, 1.2, F + .02, p.front - .5, PALETTE.darkRed)
}

/* ─────────────── Warrior recruitment hall ─────────────── */
export function buildVikingHrCenter(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = VIKING_HR_CENTER, F = T.F, b = T.body, top = F + b.top
  plankWall(s, -b.halfX, b.back, b.halfX, b.back + b.wall, F, b.top)
  for (const side of [-1, 1]) {
    plankWall(s, side * b.halfX, b.back, side * (b.halfX - b.wall), b.front, F, b.top)
    plankWall(s, side * T.door.half, b.front - b.wall, side * b.halfX, b.front, F, b.top)
    battens(s, V(side * b.halfX, 0, b.back), V(side * b.halfX, 0, b.front), F, b.top, V(side, 0, 0))
    for (const z of T.gallery.z) s.carvedPost(side * T.gallery.x, Math.min(F, ctx.ground(side * T.gallery.x, z)), z, F + T.roof.eaveY - Math.min(F, ctx.ground(side * T.gallery.x, z)) + .1, T.gallery.r)
    s.carvedPost(side * (T.door.half + .28), F, b.front + .2, T.door.height + .3, .26)
    s.doorLeaf(side * T.door.half, F, b.front - b.wall - .1, T.door.half - .05, T.door.height - .05, side < 0 ? Math.PI : 0)
    for (let z = -8; z < 8; z += 4) s.window(side * (b.halfX + .02), F + 2.5, z, side * Math.PI / 2, .7, .7, 'wood')
  }
  s.span('wood', -b.halfX, F + T.door.height, b.front - b.wall, b.halfX, top, b.front, PALETTE.weathered)
  battens(s, V(-b.halfX, 0, b.front), V(b.halfX, 0, b.front), F, b.top, V(0, 0, 1), 1.3)
  s.span('wood', -T.door.half - .6, F + T.door.height, b.front, T.door.half + .6, F + T.door.height + .45, b.front + .4, PALETTE.carved)
  for (let x = -T.door.half - .3; x <= T.door.half + .3; x += .45) s.add('wood', new THREE.TorusGeometry(.15, .035, 4, 8).translate(x, F + T.door.height + .22, b.front + .42), PALETTE.darkTimber)
  for (const [z, yaw] of [[b.front - b.wall / 2, 0], [b.back + b.wall / 2, Math.PI]] as const) s.gable('wood', 0, top, z, b.halfX * 2 + .4, T.roof.ridge - b.top - .1, .3, PALETTE.weathered, yaw)
  runeDisc(s, 0, top + 2.0, b.front + .08, 0, .75)
  for (const side of [-1, 1]) s.shield(side * 2.3, top + 1.0, b.front + .1, 0, .55, side < 0 ? [PALETTE.red, PALETTE.cream] : [PALETTE.cream, PALETTE.red])
  const roofSpec = { axis: 'z' as const, halfSpan: T.roof.eaveX + .3, from: T.roof.back, to: T.roof.front + .3, eave: F + T.roof.eaveY - .25, ridge: F + T.roof.ridge }
  r.gableRoof('roof', { ...roofSpec, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ ...roofSpec, coverage: .5, thickness: THATCH })
  ridge(r, V(0, F + T.roof.ridge + .45, T.roof.back), V(0, F + T.roof.ridge + .45, T.roof.front + .3))
  r.crossedGable(0, F + T.roof.ridge + .45, T.roof.front + .35, T.roof.eaveX + .3, T.roof.ridge - T.roof.eaveY + .7, 0, 1.25)
  r.crossedGable(0, F + T.roof.ridge + .45, T.roof.back - .05, T.roof.eaveX + .3, T.roof.ridge - T.roof.eaveY + .7, Math.PI, 1.1)
  for (const side of [-1, 1]) s.beam('wood', V(side * T.gallery.x, F + T.roof.eaveY, T.gallery.z[0] - .5), V(side * T.gallery.x, F + T.roof.eaveY, T.gallery.z[T.gallery.z.length - 1] + .5), .28, .28, PALETTE.darkTimber)
  // Banners, notice board with painted figures (no lettering), stone steps rails and statues.
  for (const side of [-1, 1]) {
    s.banner(side * 3.95, top - .25, b.front + .12, 0, 1.0, 2.6, 'wood')
    const x = side * T.statues.x, gy = ctx.ground(x, T.statues.z)
    s.cylinder('wood', x, gy - .3, T.statues.z, .42, .46, F + .2 - gy + .3, PALETTE.darkTimber, 10)
    ctx.statue(x, F + .2, T.statues.z, 0, 2.4)
    s.span('wood', side * T.steps.half, ctx.ground(side * T.steps.half, b.front + 1) - .3, b.front, side * (T.steps.half + .3), F + .5, T.steps.front, PALETTE.carved)
  }
  const board = s.kit.decal('viking-muster-board', 256, (g, size) => {
    g.fillStyle = '#d8c79f'; g.fillRect(0, 0, size, size)
    g.strokeStyle = '#4a3420'; g.lineWidth = 8; g.strokeRect(4, 4, size - 8, size - 8)
    g.fillStyle = '#3b2a1c'
    for (let i = 0; i < 4; i++) { const x = 40 + i * 58; g.beginPath(); g.arc(x, 110, 12, 0, Math.PI * 2); g.fill(); g.fillRect(x - 10, 124, 20, 46); g.fillRect(x - 18, 128, 36, 8); g.fillRect(x - 10, 170, 7, 40); g.fillRect(x + 3, 170, 7, 40) }
    g.beginPath(); g.moveTo(128, 30); g.lineTo(158, 70); g.lineTo(98, 70); g.closePath(); g.stroke()
  })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), board)
  s.kit.resources.track(plane.geometry); plane.rotation.y = Math.PI / 2; plane.position.set(b.halfX + .09, F + 1.9, 6.4); ctx.root.add(plane)
  s.span('wood', b.halfX + .02, F + .9, 5.4, b.halfX + .08, F + 2.9, 7.4, PALETTE.darkTimber)
  // Interior: muster table, racks, wall shields, long tables, rugs, iron candle rings.
  s.table(0, F, (T.table.back + T.table.front) / 2, T.table.half * 2, T.table.front - T.table.back)
  s.span('cloth', -T.table.half + .2, F + 1.0, T.table.back + .15, T.table.half - .2, F + 1.02, T.table.front - .15, PALETTE.canvas)
  s.box('wood', 0, F + .5, T.table.back - .55, .8, 1.0, .5, PALETTE.carved)
  s.banner(0, top - .1, b.back + b.wall + .05, 0, 1.6, 2.8, 'wood')
  for (const side of [-1, 1]) {
    const innerX = b.halfX - b.wall
    s.weaponRack(side * (innerX - .2), F, (T.racks.z0 + T.racks.z1) / 2, T.racks.z1 - T.racks.z0, Math.PI / 2, side < 0 ? 'axe' : 'spear')
    for (const z of [-8, 1.5, 4, 6.5]) s.shield(side * (innerX - .05), F + 2.7, z, -side * Math.PI / 2, .45, z > 2 ? [PALETTE.cream, PALETTE.red] : [PALETTE.red, 0x2f4a6a])
    s.table(side * (T.longTables.minX + T.longTables.maxX) / 2, F, (T.longTables.back + T.longTables.front) / 2, T.longTables.maxX - T.longTables.minX, T.longTables.front - T.longTables.back, .9)
    s.span('cloth', side * 1.0 - .9, F + .005, -6.4, side * 1.0 + .9, F + .02, 8.6, PALETTE.darkRed)
    const ring = V(0, top + 1.4, side * 4)
    s.add('metal', new THREE.TorusGeometry(.9, .05, 6, 18).rotateX(Math.PI / 2).translate(ring.x, ring.y, ring.z), PALETTE.iron)
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; s.add('glow', new THREE.SphereGeometry(.06, 5, 4).translate(Math.cos(a) * .9, ring.y + .2, ring.z + Math.sin(a) * .9), PALETTE.glow, null) }
    s.beam('metal', ring, V(0, F + T.roof.ridge - .6, ring.z), .03, .03, PALETTE.iron)
  }
  s.span('cloth', -1.0, F + .005, T.table.front + .2, 1.0, F + .02, b.front - .4, PALETTE.darkRed)
}

/* ─────────────── Smithy ─────────────── */
export function buildVikingWeapons(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = VIKING_WEAPONS, F = T.F, h = T.house, f = T.forge, top = F + h.top
  const hx = (h.minX + h.maxX) / 2, hHalf = (h.maxX - h.minX) / 2, fx = (f.minX + f.maxX) / 2, fHalf = (f.maxX - f.minX) / 2
  // Closed workshop house.
  plankWall(s, h.minX, h.back, h.maxX, h.back + .45, F, h.top)
  plankWall(s, h.minX, h.back, h.minX + .45, h.front, F, h.top)
  plankWall(s, h.maxX - .45, h.back, h.maxX, h.front, F, h.top)
  plankWall(s, h.minX, h.front - .45, h.maxX, h.front, F, h.top)
  battens(s, V(h.minX, 0, h.front), V(h.maxX, 0, h.front), F, h.top, V(0, 0, 1), 1.2)
  s.box('wood', -3.6, F + 1.1, h.front + .06, 1.1, 2.2, .1, PALETTE.darkTimber)
  s.window(-1.2, F + 2.0, h.front + .05, 0, .8, .7, 'wood')
  s.gable('wood', hx, top, h.front - .2, hHalf * 2 + .3, h.ridge - h.top - .2, .3, PALETTE.weathered)
  s.gable('wood', hx, top, h.back + .2, hHalf * 2 + .3, h.ridge - h.top - .2, .3, PALETTE.weathered, Math.PI)
  s.shield(hx - .9, top + 1.4, h.front + .06, 0, .5)
  s.banner(hx + .8, top + 1.6, h.front + .1, 0, .8, 2.0, 'wood')
  const houseRoof = { axis: 'z' as const, cx: hx, halfSpan: hHalf + .5, from: h.back - .4, to: h.front + .45, eave: top - .35, ridge: F + h.ridge }
  r.gableRoof('roof', { ...houseRoof, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ ...houseRoof, coverage: .5, thickness: THATCH })
  ridge(r, V(hx, F + h.ridge + .45, h.back - .4), V(hx, F + h.ridge + .45, h.front + .45))
  r.crossedGable(hx, F + h.ridge + .45, h.front + .5, hHalf + .5, h.ridge - h.top + .4, 0, 1.0)
  // Open forge shed: rear and side walls, carved corner post, shingle gable with one beast head.
  plankWall(s, f.minX, f.back, f.maxX, f.back + .5, F, 3.0)
  plankWall(s, f.maxX - .4, f.back, f.maxX, f.front, F, 3.0)
  s.carvedPost(f.maxX - .2, F, f.front - .2, 3.0, .2)
  s.beam('wood', V(h.maxX, F + 3.0, f.front - .2), V(f.maxX, F + 3.0, f.front - .2), .25, .25, PALETTE.darkTimber)
  s.gable('wood', fx, F + 3.0, f.front - .2, fHalf * 2 + .3, f.ridge - 3.2, .2, PALETTE.weathered, 0, [{ x: 0, y: .5, w: 1.4, h: 1.6, arch: .7 }])
  const shedRoof = { axis: 'z' as const, cx: fx, halfSpan: fHalf + .45, from: f.back - .4, to: f.front + .4, eave: F + 2.8, ridge: F + f.ridge, thickness: .22, color: PALETTE.weathered }
  r.gableRoof('wood', shedRoof)
  if (ctx.snow) r.snowOnGable({ ...shedRoof, coverage: .5 })
  r.beam('wood', V(fx, F + f.ridge + .2, f.back - .4), V(fx, F + f.ridge + .2, f.front + .4), .28, .28, PALETTE.darkTimber, true)
  r.lynxHead(fx, F + f.ridge + .05, f.front + .35, 0, .9)
  // Forge, hood and stone chimney with fire; anvil, coal, tools.
  s.span('stone', 1.8, F, f.back + .5, 4.6, F + 1.1, -3.4, PALETTE.footing)
  s.span('stone', 2.1, F + 1.1, f.back + .6, 4.3, F + 1.16, -3.6, 0x3b3430)
  s.brazier(3.2, F + .05, -4.0, .9, PALETTE.footing)
  s.add('stone', new THREE.CylinderGeometry(.5, 1.3, 1.5, 4).rotateY(Math.PI / 4).translate(3.2, F + 2.6, -4.05), PALETTE.footing)
  s.span('stone', T.chimney.x - .65, F + 3.3, T.chimney.z - .65, T.chimney.x + .65, F + T.chimney.top, T.chimney.z + .65, PALETTE.footing)
  s.span('stone', T.chimney.x - .78, F + T.chimney.top - .25, T.chimney.z - .78, T.chimney.x + .78, F + T.chimney.top, T.chimney.z + .78, 0x6f685e)
  s.anvil(3.0, F, -1.2, .3)
  s.span('wood', 4.4, F, -1.0, 5.1, F + .7, -.2, PALETTE.darkTimber)
  for (let i = 0; i < 6; i++) s.add('stone', new THREE.IcosahedronGeometry(.13, 0).translate(4.55 + (i % 3) * .2, F + .76, -.85 + Math.floor(i / 3) * .3), 0x252321)
  for (let i = 0; i < 5; i++) { const x = 1.2 + i * .5; s.box('wood', x, F + 2.0, f.back + .55, .05, .6, .05, PALETTE.timber); s.box('metal', x, F + 2.35, f.back + .57, .22, .1, .08, PALETTE.iron) }
  s.weaponRack(.95, F, 0, 3.4, Math.PI / 2, 'axe')
  // Merchant canopy: four carved posts, shingle gable, hanging smith's board.
  const c = T.canopy, low = ctx.canopyY, crest = low + (c.ridge - c.minY)
  for (const side of [-1, 1]) for (const z of c.postZ) {
    const gy = ctx.ground(side * c.postX, z)
    s.carvedPost(side * c.postX, Math.min(gy, F), z, low - Math.min(gy, F), .17)
  }
  for (const z of c.postZ) s.beam('wood', V(-6, low, z), V(6, low, z), .22, .22, PALETTE.darkTimber)
  for (const side of [-1, 1]) s.beam('wood', V(side * c.postX, low, c.postZ[0]), V(side * c.postX, low, c.postZ[1]), .2, .2, PALETTE.darkTimber)
  const canopyRoof = { axis: 'x' as const, cz: (c.back + c.front) / 2, halfSpan: (c.front - c.back) / 2, from: -6, to: 6, eave: low, ridge: crest, thickness: .18, color: PALETTE.weathered }
  r.gableRoof('wood', canopyRoof)
  if (ctx.snow) r.snowOnGable({ ...canopyRoof, coverage: .55, thickness: .18 })
  for (const side of [-1, 1]) r.lynxHead(side * 6.05, crest - .15, (c.back + c.front) / 2, side * Math.PI / 2, .7)
  s.span('wood', -.8, low - 1.45, c.postZ[1] - .05, .8, low - .35, c.postZ[1] + .05, PALETTE.carved)
  for (const side of [-1, 1]) s.beam('metal', V(side * .5, low - .35, c.postZ[1] + .02), V(side * .5, low, c.postZ[1] + .02), .02, .02, PALETTE.iron)
  s.box('metal', 0, low - 1.0, c.postZ[1] + .09, .55, .16, .06, PALETTE.iron)
  s.box('metal', 0, low - 1.15, c.postZ[1] + .09, .22, .2, .06, PALETTE.iron)
  for (const k of [-1, 1]) s.beam('metal', V(-.45 * k, low - .55, c.postZ[1] + .1), V(.4 * k, low - 1.3, c.postZ[1] + .1), .05, .05, PALETTE.iron)
  // Display tables, leaning shields, barrels.
  const tb = T.tables
  for (const side of [-1, 1]) {
    const gx = side * tb.x, gy = ctx.ground(gx, tb.z)
    s.table(gx, gy, tb.z, tb.halfX * 2, tb.halfZ * 2, F + tb.top - gy)
    const ids = side < 0 ? ['axe_t5', 'axe_t5'] : ['axe_t5', 'bow_t5']
    ids.forEach((id, i) => ctx.display(id, id === 'bow_t5' ? 'ranged' : 'melee', gx, F + tb.top, tb.z + (i - .5) * .6, 0, Math.PI / 2))
  }
  s.shield(-3.8, F + 1.8, h.front + .12, 0, .6)
  s.barrel(-.4, ctx.ground(-.4, 4.1), 4.1, .85)
  s.span('cloth', 4.6, F + .62, -2.1, 5.1, F + .66, -1.3, PALETTE.fur)

}

/* ─────────────── Stable ─────────────── */
export function buildVikingStable(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = VIKING_STABLE, F = T.F, R = T.roof
  plankWall(s, -T.side.outer, T.rear.z0, T.side.outer, T.rear.z1, F, R.rearEave + .4)
  battens(s, V(-T.side.outer, 0, T.rear.z0), V(T.side.outer, 0, T.rear.z0), F, R.rearEave + .4, V(0, 0, -1), 1.3)
  for (const side of [-1, 1]) {
    const x = side * (T.side.inner + T.side.outer) / 2
    s.profile('wood', x, [[T.rear.z0, 0], [R.frontEaveZ, 0], [R.frontEaveZ, F + R.frontEave], [R.ridgeZ, F + R.ridge], [T.rear.z0, F + R.rearEave + .4]], T.side.outer - T.side.inner, PALETTE.weathered)
    s.span('stone', side * T.side.outer - .5, -.4, T.rear.z0 - .08, side * T.side.inner + side * 0, F + .35, R.frontEaveZ, PALETTE.footing)
    battens(s, V(side * T.side.outer, 0, T.rear.z0), V(side * T.side.outer, 0, R.frontEaveZ), F, R.frontEave - .2, V(side, 0, 0), 1.4)
    // Boards follow the shorter rear slope so they stay inside the stable's footprint.
    r.crossedGable(side * (T.side.outer + .1), F + R.ridge + .45, R.ridgeZ, R.ridgeZ - R.rearEaveZ, R.ridge - R.rearEave + .5, side * Math.PI / 2, 1.1)
    for (let i = 0; i < 3; i++) s.add('metal', new THREE.TorusGeometry(.18, .025, 4, 10).rotateY(Math.PI / 2).translate(side * (T.side.inner - .05), F + 2.0, -3.6 + i * .7), PALETTE.darkTimber)
  }
  r.shedRoof('roof', { axis: 'x', low: [R.rearEaveZ, F + R.rearEave], high: [R.ridgeZ, F + R.ridge], from: -T.side.outer - .5, to: T.side.outer + .5, thickness: THATCH })
  r.shedRoof('roof', { axis: 'x', low: [R.frontEaveZ + .2, F + R.frontEave - .1], high: [R.ridgeZ, F + R.ridge], from: -T.side.outer - .5, to: T.side.outer + .5, thickness: THATCH })
  if (ctx.snow) {
    r.shedRoof('snow', { axis: 'x', low: [R.ridgeZ - 2.4, F + R.ridge - 2.2 + .62], high: [R.ridgeZ, F + R.ridge + .62], from: -T.side.outer - .4, to: T.side.outer + .4, thickness: .1 })
    r.shedRoof('snow', { axis: 'x', low: [R.ridgeZ + 2.8, F + R.ridge - 1.8 + .62], high: [R.ridgeZ, F + R.ridge + .62], from: -T.side.outer - .4, to: T.side.outer + .4, thickness: .1 })
  }
  ridge(r, V(-T.side.outer - .5, F + R.ridge + .45, R.ridgeZ), V(T.side.outer + .5, F + R.ridge + .45, R.ridgeZ))
  // Carved front posts, beam, lanterns; porch shingle roof on two posts.
  for (let i = 1; i <= 4; i++) s.carvedPost(-6.5 + i * 2.6, F, T.posts.z, R.frontEave, T.posts.r)
  s.beam('wood', V(-T.side.outer, F + R.frontEave, T.posts.z), V(T.side.outer, F + R.frontEave, T.posts.z), .3, .3, PALETTE.darkTimber)
  const pr = T.porch
  r.shedRoof('wood', { axis: 'x', low: [pr.front, F + pr.low], high: [R.frontEaveZ, F + R.frontEave], from: -T.side.outer - .2, to: T.side.outer + .2, thickness: .16, color: PALETTE.weathered })
  if (ctx.snow) r.shedRoof('snow', { axis: 'x', low: [pr.front - .3, F + pr.low + .17], high: [R.frontEaveZ + .6, F + R.frontEave + .08], from: -T.side.outer, to: T.side.outer, thickness: .08 })
  for (const side of [-1, 1]) { const gy = ctx.ground(side * pr.postX, pr.postZ); s.carvedPost(side * pr.postX, Math.min(gy, F), pr.postZ, F + pr.low - Math.min(gy, F), .16) }
  s.beam('wood', V(-T.side.outer, F + pr.low, pr.postZ), V(T.side.outer, F + pr.low, pr.postZ), .24, .24, PALETTE.darkTimber)
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) s.lantern(x, F + R.frontEave - .5, T.posts.z + .3)
  // Stalls: X-braced partitions, mangers, hay, straw.
  s.span('cloth', -T.side.inner, F - .025, T.rear.z1, T.side.inner, F, R.frontEaveZ, PALETTE.hay)
  for (let i = 1; i <= 4; i++) {
    const x = -6.5 + i * 2.6, d = T.dividers
    for (const z of [d.back, d.front]) s.cylinder('wood', x, F, z, .1, .11, d.top, PALETTE.weathered, 6)
    for (const y of [.25, d.top - .1]) s.beam('wood', V(x, F + y, d.back), V(x, F + y, d.front), .14, .14, PALETTE.weathered)
    s.beam('wood', V(x, F + .3, d.back), V(x, F + d.top - .15, d.front), .1, .1, PALETTE.darkTimber)
    s.beam('wood', V(x, F + d.top - .15, d.back), V(x, F + .3, d.front), .1, .1, PALETTE.darkTimber)
    s.span('wood', x - .05, F + .3, d.back, x + .05, F + d.top - .15, d.front, PALETTE.timber)
  }
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
    s.span('wood', x - .95, F, T.rear.z1, x + .95, F + 1.0, T.rear.z1 + .55, PALETTE.weathered)
    s.span('cloth', x - .85, F + .95, T.rear.z1 + .05, x + .85, F + 1.06, T.rear.z1 + .5, PALETTE.hay)
  }
  const tr = T.trough
  s.span('wood', tr.minX, ctx.ground(tr.minX, tr.minZ) - .2, tr.minZ, tr.maxX, F + .8, tr.maxZ, PALETTE.weathered)
  s.span('water', tr.minX + .07, F + .66, tr.minZ + .07, tr.maxX - .07, F + .7, tr.maxZ - .07)
  const bk = T.basket; s.brazier(bk.x, ctx.ground(bk.x, bk.z), bk.z, 1.05)
  s.banner(-T.side.outer - .1, F + 3.4, -1.5, -Math.PI / 2, 1.0, 2.4, 'wood')
  s.shield(-T.side.outer - .08, F + 1.6, 2.4, -Math.PI / 2, .5)
  // Hanging horse board (carved head silhouette, no lettering).
  s.span('wood', -.7, F + pr.low - 1.25, pr.postZ - .05, .7, F + pr.low - .35, pr.postZ + .05, PALETTE.carved)
  s.lynxHead(0, F + pr.low - 1.25, pr.postZ + .1, 0, .38, PALETTE.darkTimber)
}

/* ─────────────── Homes ─────────────── */
export function buildVikingHome(ctx: BuildContext, variant: 'home-a' | 'home-b' | 'home-c'): void {
  if (variant === 'home-a') vikingHomeA(ctx)
  else if (variant === 'home-b') vikingHomeB(ctx)
  else vikingHomeC(ctx)
}
function vikingHomeA(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, a = VIKING_HOMES.a, F = VIKING_HOMES.F, top = F + a.top
  plankWall(s, -a.halfX, a.back, a.halfX, a.back + .4, F, a.top)
  for (const side of [-1, 1]) {
    plankWall(s, side * a.halfX, a.back, side * (a.halfX - .4), a.front, F, a.top)
    battens(s, V(side * a.halfX, 0, a.back), V(side * a.halfX, 0, a.front), F, a.top, V(side, 0, 0), 1.3)
    s.window(side * (a.halfX + .02), F + 1.7, -1, side * Math.PI / 2, .7, .7, 'wood')
  }
  plankWall(s, -a.halfX, a.front - .4, a.halfX, a.front, F, a.top)
  battens(s, V(-a.halfX, 0, a.front), V(a.halfX, 0, a.front), F, a.top, V(0, 0, 1), 1.2)
  s.box('wood', 0, F + 1.05, a.front + .06, 1.2, 2.1, .1, PALETTE.darkTimber)
  s.add('metal', new THREE.TorusGeometry(.12, .025, 5, 10).translate(.35, F + 1.05, a.front + .13), PALETTE.iron)
  for (const [z, yaw] of [[a.front - .2, 0], [a.back + .2, Math.PI]] as const) s.gable('wood', 0, top, z, a.halfX * 2 + .2, a.ridge - a.top - .3, .3, PALETTE.weathered, yaw, yaw ? [] : [{ x: 0, y: 1.2, w: .8, h: .8 }])
  s.window(0, top + 1.6, a.front + .02, 0, .75, .75, 'wood')
  s.shield(-1.7, top + .9, a.front + .05, 0, .42)
  const roofSpec = { axis: 'z' as const, halfSpan: a.roofHalf + .2, from: a.back - .45, to: a.front + .45, eave: top - .45, ridge: F + a.ridge }
  r.gableRoof('roof', { ...roofSpec, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ ...roofSpec, coverage: .5, thickness: THATCH })
  ridge(r, V(0, F + a.ridge + .45, a.back - .45), V(0, F + a.ridge + .45, a.front + .45), false)
  r.crossedGable(0, F + a.ridge + .45, a.front + .5, a.roofHalf + .2, a.ridge - a.top + .4, 0, 1.0)
  r.crossedGable(0, F + a.ridge + .45, a.back - .5, a.roofHalf + .2, a.ridge - a.top + .4, Math.PI, 1.0)
  // Little gabled porch on two posts, chimney, woodpile shed, stump with axe, fence posts.
  for (const side of [-1, 1]) s.cylinder('wood', side * (a.porchHalf - .15), ctx.ground(side * (a.porchHalf - .15), a.porchFront - .2) - .2, a.porchFront - .2, .12, .14, F + 2.4 - ctx.ground(side * (a.porchHalf - .15), a.porchFront - .2) + .2, PALETTE.carved, 8)
  const porch = { axis: 'z' as const, halfSpan: a.porchHalf + .25, from: a.front - .1, to: a.porchFront + .2, eave: F + 2.3, ridge: F + 3.3, thickness: .3 }
  r.gableRoof('roof', porch)
  s.lantern(.9, F + 2.0, a.front + .3)
  s.span('stone', 1.8, F, -3.1, 3.0, F + a.ridge + .4, -1.9, PALETTE.footing)
  s.span('stone', 1.7, F + a.ridge + .2, -3.2, 3.1, F + a.ridge + .4, -1.8, 0x6f685e)
  s.shedRoof('wood', { axis: 'z', low: [-4.6, F + 1.5], high: [-a.halfX, F + 1.9], from: -2.1, to: 1.1, thickness: .1, color: PALETTE.weathered })
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) s.add('wood', new THREE.CylinderGeometry(.13, .13, 1.0, 7).rotateZ(Math.PI / 2).translate(-4.0, F + .2 + row * .26, -1.7 + i * .45 + (row % 2) * .2), PALETTE.timber)
  const sx = 3.0, sz = 4.4, sy = ctx.ground(sx, sz)
  s.cylinder('wood', sx, sy - .1, sz, .38, .42, .9, PALETTE.timber, 10)
  s.beam('wood', V(sx, sy + .8, sz), V(sx + .2, sy + 1.4, sz + .3), .05, .05, PALETTE.darkTimber, true)
  s.box('metal', sx - .02, sy + .82, sz - .02, .05, .22, .3, PALETTE.iron)
  for (const side of [-1, 1]) s.fence(V(side * 4.45, ctx.ground(side * 4.4, 5.75), 5.75), V(side * 3.2, ctx.ground(side * 3.2, 5.75), 5.75), 1.0)
  s.barrel(-2.4, ctx.ground(-2.4, 3.6), 3.6, .8)
}
function vikingHomeB(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, b = VIKING_HOMES.b, F = VIKING_HOMES.F
  // Low stone-and-log walls under a deep thatch with a turf crown.
  s.span('stone', -b.halfX, F - .4, b.back, b.halfX, F + 1.0, b.front, PALETTE.footing)
  s.span('wood', -b.halfX + .1, F + 1.0, b.back + .1, b.halfX - .1, F + b.top + .4, b.front - .1, PALETTE.weathered)
  for (let y = F + 1.1; y < F + b.top + .4; y += .24) for (const side of [-1, 1]) s.beam('wood', V(side * (b.halfX - .05), y, b.back + .1), V(side * (b.halfX - .05), y, b.front - .1), .22, .22, PALETTE.timber, true)
  for (const [z, yaw] of [[b.front - .15, 0], [b.back + .15, Math.PI]] as const) s.gable('wood', 0, F + b.top + .4, z, b.halfX * 2, b.ridge - b.top - .5, .3, PALETTE.weathered, yaw)
  // Deep door recess framed by heavy posts.
  s.box('wood', 0, F + .95, b.front + .02, 1.3, 1.9, .1, PALETTE.darkTimber)
  for (const side of [-1, 1]) s.box('wood', side * .8, F + 1.1, b.front + .15, .3, 2.2, .3, PALETTE.carved)
  s.box('wood', 0, F + 2.25, b.front + .15, 2.0, .3, .32, PALETTE.carved)
  s.window(2.2, F + 1.4, b.front + .02, 0, .5, .5, 'wood')
  const roofSpec = { axis: 'z' as const, halfSpan: b.roofHalf + .3, from: b.back - .6, to: b.front + .6, eave: F + 1.2, ridge: F + b.ridge, thickness: .7 }
  r.gableRoof('roof', roofSpec)
  // Turf crown over the upper half of the thatch.
  r.gableRoof('turf', { ...roofSpec, halfSpan: (b.roofHalf + .3) * .62, eave: F + b.ridge - (b.ridge - 1.2) * .62 + .75, ridge: F + b.ridge + .75, thickness: .25, color: 0xc8d2b0 })
  if (ctx.snow) r.snowOnGable({ ...roofSpec, coverage: .35, thickness: .95 })
  // Hipped thatch ends (small half-hips) and smoke hole.
  for (const z of [b.back - .6, b.front + .6]) r.hipRoof('roof', -1.2, 1.2, z - .5, z + .5, F + b.ridge - 1.3, 1.2)
  s.cylinder('stone', 0, F + b.ridge - .4, -1, .32, .36, .8, PALETTE.footing, 8)
  // Drying rack with hides and a woodpile.
  for (const x of [-4.3, -2.5]) s.cylinder('wood', x, ctx.ground(x, 4.1) - .2, 4.1, .07, .08, 2.2, PALETTE.weathered, 6)
  s.beam('wood', V(-4.3, F + 1.9, 4.1), V(-2.5, F + 1.9, 4.1), .08, .08, PALETTE.weathered, true)
  for (const x of [-3.8, -3.0]) s.box('cloth', x, F + 1.35, 4.1, .6, 1.1, .05, x < -3.4 ? PALETTE.fur : 0x8a6a4a)
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) s.add('wood', new THREE.CylinderGeometry(.14, .14, 1.1, 7).rotateZ(Math.PI / 2).translate(3.4, ctx.ground(3.4, 4.2) + .15 + row * .27, 3.8 + i * .3 + (row % 2) * .15), PALETTE.timber)
}
function vikingHomeC(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, c = VIKING_HOMES.c, F = VIKING_HOMES.F, top = F + c.top
  plankWall(s, -c.halfX, c.back, c.halfX, c.back + .4, F, c.top)
  plankWall(s, -c.halfX, c.back, -c.halfX + .4, c.front, F, c.top)
  plankWall(s, c.halfX - .4, c.back, c.halfX, c.front, F, c.top)
  plankWall(s, -c.halfX, c.front - .4, c.halfX, c.front, F, c.top)
  for (const side of [-1, 1]) battens(s, V(side * c.halfX, 0, c.back), V(side * c.halfX, 0, c.front), F, c.top, V(side, 0, 0), 1.1)
  // Storey band and tall A-frame gable with loft window and shield.
  for (const side of [-1, 1]) s.beam('wood', V(side * (c.halfX + .05), F + 2.4, c.back), V(side * (c.halfX + .05), F + 2.4, c.front), .2, .2, PALETTE.darkTimber)
  for (const [z, yaw] of [[c.front - .2, 0], [c.back + .2, Math.PI]] as const) s.gable('wood', 0, top, z, c.halfX * 2 + .2, c.ridge - c.top - .4, .3, PALETTE.weathered, yaw, yaw ? [] : [{ x: 0, y: .8, w: .9, h: 1.0 }])
  s.window(0, top + 1.3, c.front + .02, 0, .85, .95, 'wood')
  s.window(-1.8, F + 3.3, c.front + .02, 0, .7, .7, 'wood')
  s.shield(1.6, top + .6, c.front + .06, 0, .48, [PALETTE.cream, PALETTE.red])
  const roofSpec = { axis: 'z' as const, halfSpan: c.halfX + .8, from: c.back - .45, to: c.front + .45, eave: top - .55, ridge: F + c.ridge }
  r.gableRoof('roof', { ...roofSpec, thickness: THATCH })
  if (ctx.snow) r.snowOnGable({ ...roofSpec, coverage: .5, thickness: THATCH })
  ridge(r, V(0, F + c.ridge + .45, c.back - .45), V(0, F + c.ridge + .45, c.front + .45))
  r.crossedGable(0, F + c.ridge + .45, c.front + .5, c.halfX + .8, c.ridge - c.top + .55, 0, 1.2)
  // Side entrance on +X under a shingle lean-to.
  const sp = c.sidePorch, dz = (sp.minZ + sp.maxZ) / 2
  s.box('wood', c.halfX + .06, F + 1.1, dz, .1, 2.2, 1.2, PALETTE.darkTimber)
  for (const z of [sp.minZ, sp.maxZ]) s.cylinder('wood', sp.outer - .15, ctx.ground(sp.outer - .15, z) - .2, z, .12, .14, F + 2.6 - ctx.ground(sp.outer - .15, z) + .2, PALETTE.carved, 8)
  r.shedRoof('wood', { axis: 'z', low: [sp.outer + .2, F + 2.5], high: [c.halfX, F + 3.3], from: sp.minZ - .4, to: sp.maxZ + .4, thickness: .14, color: PALETTE.weathered })
  s.lantern(c.halfX + .35, F + 2.3, sp.maxZ + .1)
  // Front storage annex with a lean-to, chimney, wattle garden.
  const an = c.annex
  plankWall(s, an.minX, c.front, an.maxX, an.front, F, an.top)
  s.box('wood', (an.minX + an.maxX) / 2, F + .9, an.front + .05, 1.0, 1.6, .1, PALETTE.darkTimber)
  r.shedRoof('roof', { axis: 'x', low: [an.front + .4, F + an.top - .2], high: [c.front - .2, F + an.top + 1.2], from: an.minX - .3, to: an.maxX + .3, thickness: .35 })
  s.span('stone', -3.15, F, -4.75, -2.05, F + c.ridge, -3.65, PALETTE.footing)
  const g = c.garden, gy = (x: number, z: number) => ctx.ground(x, z)
  s.fence(V(g.minX, gy(g.minX, g.front), g.front), V(g.maxX, gy(g.maxX, g.front), g.front), .6, true)
  s.fence(V(g.minX, gy(g.minX, g.back), g.back), V(g.minX, gy(g.minX, g.front), g.front), .6, true)
  s.fence(V(g.maxX, gy(g.maxX, g.back), g.back), V(g.maxX, gy(g.maxX, g.front), g.front), .6, true)
  for (let i = 0; i < 8; i++) s.add('foliage', new THREE.IcosahedronGeometry(.22, 0).translate(g.minX + .4 + (i % 4) * .9, gy(g.minX + .4 + (i % 4) * .9, 5.3) + .2, 4.95 + Math.floor(i / 4) * .6), PALETTE.leaf)
  s.barrel(2.9, ctx.ground(2.9, 4.6), 4.6, .8)
}
