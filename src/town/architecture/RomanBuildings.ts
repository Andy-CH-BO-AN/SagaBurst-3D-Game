import * as THREE from 'three'
import { PALETTE, tabletopDisplayRow, buildHrHallDetails, type BuildContext, type Sketch } from './ArchitectureKit'
import { ROMAN_HOMES, ROMAN_HR_CENTER, ROMAN_STABLE, ROMAN_TOWN_CENTER, ROMAN_WEAPONS } from './ArchitectureSpecs'

/* Roman vocabulary: marble/travertine masonry, red plaster panels, terracotta
 * tile roofs, pediments with gold eagles and laurels, columns and arches. */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Dentilled cornice strip along X at height y (front face toward +Z when yaw = 0). */
function dentils(s: Sketch, x0: number, x1: number, y: number, z: number, yaw = 0): void {
  const dir = V(Math.cos(yaw), 0, -Math.sin(yaw))
  for (let t = x0 + .2; t < x1 - .1; t += .42) {
    const p = V(0, y, 0).addScaledVector(dir, t).add(V(Math.sin(yaw) * z, 0, Math.cos(yaw) * z))
    s.box('stone', p.x, p.y, p.z, .2, .2, .22, PALETTE.marble, yaw)
  }
}
/** Pediment with red tympanum, raking cornices, gold eagle and laurels; (x, z) is the front-face centre, facing yaw. */
function pedimentFront(s: Sketch, x: number, base: number, z: number, width: number, rise: number, yaw = 0, eagle = true): void {
  const face = V(Math.sin(yaw), 0, Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw))
  const at = (lateral: number, y: number, out: number) => V(x, y, z).addScaledVector(right, lateral).addScaledVector(face, out)
  const c = at(0, base, -.25)
  s.gable('stone', c.x, base, c.z, width, rise, .5, PALETTE.marble, yaw)
  const t = at(0, base + .28, .04)
  s.gable('stone', t.x, base + .28, t.z, width - 1.4, rise - .55, .06, PALETTE.redPlaster, yaw)
  for (const side of [-1, 1]) s.beam('stone', at(side * (width / 2 + .25), base - .02, .05), at(0, base + rise + .2, .05), .34, .3, PALETTE.marble)
  s.box('stone', at(0, base - .15, .02).x, base - .15, at(0, base - .15, .02).z, width + .5, .3, .62, PALETTE.marble, yaw)
  if (eagle) {
    const e = at(0, base + rise * .42, .12)
    s.eagle(e.x, e.y, e.z, yaw, Math.min(1.5, rise * .45))
    for (const side of [-1, 1]) { const l = at(side * width * .24, base + rise * .26, .1); s.laurel(l.x, l.y, l.z, yaw, Math.min(.5, rise * .16)) }
  } else { const l = at(0, base + rise * .36, .1); s.laurel(l.x, l.y, l.z, yaw, Math.min(.55, rise * .2)) }
}
/** Ridge tiles along a roof ridge. */
function ridgeTiles(r: Sketch, a: THREE.Vector3, b: THREE.Vector3): void { r.beam('roof', a, b, .34, .34, 0xd08a64, true) }

/* ─────────────── Town Center (Principia) ─────────────── */
export function buildRomanTownCenter(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = ROMAN_TOWN_CENTER, F = T.F, h = T.hall, top = F + h.top
  const innerX = h.halfX - h.wall, innerBack = h.back + h.wall
  // Shell: front wall with the open arched doorway, sides and rear.
  s.wall('stone', 0, F, h.front, h.halfX * 2, h.top, h.wall, [{ x: 0, y: 0, w: T.door.half * 2, h: T.door.height, arch: T.door.half }], PALETTE.marble)
  s.archRing('stone', 0, F + T.door.height - T.door.half, h.front + .02, T.door.half, T.door.half, .42, h.wall + .16, PALETTE.travertine)
  s.box('stone', 0, F + T.door.height + .15, h.front + .4, .55, .7, .2, PALETTE.marble)
  for (const side of [-1, 1]) {
    s.wall('stone', side * (h.halfX - h.wall / 2), F, (h.back + h.front) / 2, h.front - h.back, h.top, h.wall, [], PALETTE.marble, Math.PI / 2)
    // Pilasters framing the doorway on the front face.
    s.box('stone', side * 3.3, F + h.top / 2, h.front + .42, .7, h.top, .18, PALETTE.travertine)
  }
  s.wall('stone', 0, F, h.back + h.wall / 2, h.halfX * 2, h.top, h.wall, [], PALETTE.marble)
  // Interior: red dado, carpet, columns, beams, rear eagle, banners, table, braziers, chandelier.
  for (const side of [-1, 1]) s.span('stone', side * (innerX - .03), F, innerBack, side * innerX, F + 1.3, h.front - h.wall / 2, PALETTE.redPlaster)
  s.span('stone', -innerX, F, innerBack, innerX, F + 1.3, innerBack + .03, PALETTE.redPlaster)
  s.span('cloth', -1.15, F + .005, T.table.front + .1, 1.15, F + .025, h.front + h.wall / 2, PALETTE.red)
  for (const side of [-1, 1]) s.span('metal', side * 1.15 - .06, F + .006, T.table.front + .1, side * 1.15 + .06, F + .03, h.front + h.wall / 2, PALETTE.gold)
  for (const side of [-1, 1]) for (const z of T.interiorColumns.z) s.column(side * T.interiorColumns.x, F, z, h.top, T.interiorColumns.r)
  for (let z = h.back + 1.5; z < h.front; z += 3) s.box('wood', 0, top - .25, z, innerX * 2, .35, .3, PALETTE.darkTimber)
  s.eagle(0, F + 5.4, innerBack + .08, 0, 1.3)
  for (const side of [-1, 1]) s.banner(side * 3.8, F + 6.6, innerBack + .05, 0, 1.4, 3.6)
  s.table(0, F, (T.table.back + T.table.front) / 2, T.table.half * 2, T.table.front - T.table.back, 1.05)
  s.span('cloth', -T.table.half, F + .5, T.table.front - .01, T.table.half, F + 1.05, T.table.front + .01, PALETTE.red)
  s.laurel(0, F + .8, T.table.front + .03, 0, .25)
  for (const side of [-1, 1]) { s.cylinder('stone', side * 6.3, F, -7.6, .3, .38, .9, PALETTE.marble); s.bowlFire(side * 6.3, F + .9, -7.6, .9) }
  const ring = V(0, F + 5.4, -1.2)
  s.add('metal', new THREE.TorusGeometry(1.3, .06, 6, 24).rotateX(Math.PI / 2).translate(ring.x, ring.y, ring.z), PALETTE.iron)
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; s.beam('metal', V(Math.cos(a) * 1.3, ring.y, ring.z + Math.sin(a) * 1.3), V(0, top - .4, ring.z), .03, .03, PALETTE.iron) }
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; s.cylinder('cloth', Math.cos(a) * 1.3, ring.y, ring.z + Math.sin(a) * 1.3, .04, .04, .18, PALETTE.cream, 5); s.add('glow', new THREE.SphereGeometry(.06, 5, 4).translate(Math.cos(a) * 1.3, ring.y + .26, ring.z + Math.sin(a) * 1.3), PALETTE.glow, null) }
  // Open door leaves rest against the inner front wall, clear of the passage.
  for (const side of [-1, 1]) s.doorLeaf(side * T.door.half, F, h.front - h.wall / 2 - .1, T.door.half - .05, T.door.height - T.door.half * .5, side < 0 ? Math.PI : 0)
  // Portico: columns, entablature, dentils, pediment.
  for (const side of [-1, 1]) for (const x of T.portico.columnX) s.column(side * x, F, T.portico.columnZ, h.top, T.portico.columnR)
  s.span('stone', -h.halfX - .3, top, T.portico.columnZ - .6, h.halfX + .3, top + .6, T.portico.columnZ + .6, PALETTE.marble)
  s.span('stone', -h.halfX - .3, top + .1, h.front, h.halfX + .3, top + .6, T.portico.columnZ, PALETTE.marble)
  s.span('stone', -T.roof.halfSpan, top + .6, T.roof.back, T.roof.halfSpan, top + .78, T.roof.front, PALETTE.marble)
  dentils(s, -h.halfX, h.halfX, top + .48, T.portico.columnZ + .7)
  s.span('stone', -h.halfX - .3, top + .22, T.portico.columnZ + .6, h.halfX + .3, top + .36, T.portico.columnZ + .62, PALETTE.redPlaster)
  pedimentFront(s, 0, F + T.roof.eave, T.roof.front - .05, T.roof.halfSpan * 2, T.roof.rise)
  s.gable('stone', 0, F + T.roof.eave, T.roof.back + .2, T.roof.halfSpan * 2, T.roof.rise, .4, PALETTE.marble)
  for (const side of [-1, 1]) s.span('stone', side * h.halfX - .3, top, h.back, side * h.halfX + .3, F + T.roof.eave, h.front, PALETTE.marble)
  // Main tile roof (damageable).
  r.gableRoof('roof', { axis: 'z', halfSpan: T.roof.halfSpan, from: T.roof.back, to: T.roof.front, eave: F + T.roof.eave, ridge: F + T.roof.eave + T.roof.rise })
  ridgeTiles(r, V(0, F + T.roof.eave + T.roof.rise + .18, T.roof.back), V(0, F + T.roof.eave + T.roof.rise + .18, T.roof.front))
  r.add('metal', new THREE.ConeGeometry(.22, .7, 8).translate(0, F + T.roof.eave + T.roof.rise + .6, T.roof.front - .2), PALETTE.gold)
  // Wings: red plaster blocks with marble base, pilasters, arched windows and hip roofs.
  const w = T.wing
  for (const side of [-1, 1]) {
    const x0 = side * w.inner, x1 = side * w.outer, cx = side * (w.inner + w.outer) / 2
    s.span('stone', x0, F, w.back, x1, F + w.top, w.front, PALETTE.redPlaster)
    s.span('stone', x0, F - .05, w.back - .06, x1 + side * .08, F + .9, w.front + .08, PALETTE.marble)
    s.span('stone', x0, F + w.top - .25, w.back - .12, x1 + side * .15, F + w.top + .1, w.front + .15, PALETTE.marble)
    for (const x of [w.inner + .25, (w.inner + w.outer) / 2, w.outer - .2]) s.box('stone', side * x, F + w.top / 2, w.front + .06, .45, w.top, .14, PALETTE.marble)
    for (const x of [w.inner + 1.1, w.outer - 1.05]) {
      s.window(side * x, F + 2.9, w.front + .07, 0, .95, 1.9, 'stone', true)
      s.archRing('stone', side * x, F + 3.38, w.front + .08, .52, .45, .14, .1, PALETTE.marble)
    }
    for (let z = w.back + 1.6; z < w.front - .8; z += 3.1) {
      s.window(x1 + side * .07, F + 2.9, z, side * Math.PI / 2, .9, 1.8, 'stone', true)
      s.box('stone', x1 + side * .05, F + w.top / 2, z + 1.55, .14, w.top, .4, PALETTE.marble)
    }
    s.banner(cx, F + w.top - .4, w.front + .2, 0, 1.1, 3.0)
    r.hipRoof('roof', Math.min(x0, x1) - .25, Math.max(x0, x1) + .3, w.back - .3, w.front + .3, F + w.top + .1, 1.5)
  }
  // Tower above the east wing: loggia with arches, pyramid roof, gold finial and flag.
  const t = T.tower, tx = (t.minX + t.maxX) / 2, tz = (t.minZ + t.maxZ) / 2, tw = t.maxX - t.minX, td = t.maxZ - t.minZ
  s.span('stone', t.minX, F + w.top, t.minZ, t.maxX, F + 8.4, t.maxZ, PALETTE.redPlaster)
  for (const [qx, qz] of [[t.minX, t.minZ], [t.maxX, t.minZ], [t.minX, t.maxZ], [t.maxX, t.maxZ]]) s.box('stone', qx, F + (w.top + t.top) / 2, qz, .5, t.top - w.top, .5, PALETTE.marble)
  s.span('stone', t.minX - .15, F + 8.4, t.minZ - .15, t.maxX + .15, F + 8.7, t.maxZ + .15, PALETTE.marble)
  for (const [yaw, fx, fz, width] of [[0, tx, t.maxZ - .15, tw], [Math.PI, tx, t.minZ + .15, tw], [Math.PI / 2, t.maxX - .15, tz, td], [-Math.PI / 2, t.minX + .15, tz, td]] as const) {
    s.wall('stone', fx, F + 8.7, fz, width, 2.5, .3, [{ x: -.8, y: .35, w: 1.0, h: 1.9, arch: .5 }, { x: .8, y: .35, w: 1.0, h: 1.9, arch: .5 }], PALETTE.marble, yaw)
  }
  s.span('stone', t.minX - .2, F + t.top - .1, t.minZ - .2, t.maxX + .2, F + t.top + .1, t.maxZ + .2, PALETTE.marble)
  r.hipRoof('roof', t.minX - .35, t.maxX + .35, t.minZ - .35, t.maxZ + .35, F + t.top + .1, 1.8)
  r.add('metal', new THREE.SphereGeometry(.2, 8, 6).translate(tx, F + t.top + 2.05, tz), PALETTE.gold)
  // Steps' cheek blocks with bronze fire bowls, statue pedestals and statues.
  for (const side of [-1, 1]) {
    const cx = side * (T.steps.half + T.steps.cheek / 2)
    s.span('stone', cx - T.steps.cheek / 2, Math.min(ctx.ground(cx, T.steps.front), 0) - .4, T.portico.front, cx + T.steps.cheek / 2, F + .5, T.steps.front, PALETTE.marble)
    s.bowlFire(cx, F + .5, T.steps.front - .45, .8)
    const st = T.statues, gy = Math.min(ctx.ground(side * st.x, st.z), 0) - .4
    s.span('stone', side * st.x - st.pedestal / 2, gy, st.z - st.pedestal / 2, side * st.x + st.pedestal / 2, st.pedestalTop, st.z + st.pedestal / 2, PALETTE.marble)
    s.span('stone', side * st.x - st.pedestal / 2 - .08, st.pedestalTop - .15, st.z - st.pedestal / 2 - .08, side * st.x + st.pedestal / 2 + .08, st.pedestalTop, st.z + st.pedestal / 2 + .08, PALETTE.marble)
    s.laurel(side * st.x, (gy + st.pedestalTop) / 2 + .2, st.z + st.pedestal / 2 + .03, 0, .28)
    ctx.statue(side * st.x, st.pedestalTop, st.z, 0, 2.6)
  }
}

/* ─────────────── HR Center (military recruitment hall) ─────────────── */
export function buildRomanHrCenter(ctx: BuildContext): void {
  if (ctx.hrHall) { buildExpandedRomanHrCenter(ctx); return }
  const s = ctx.body, r = ctx.roof, T = ROMAN_HR_CENTER, F = T.F, b = T.body, top = F + b.top
  const innerX = b.halfX - b.wall, innerBack = b.back + b.wall, innerFront = b.front - b.wall, p = T.portico
  const alcoves = [-1, 1].map(side => ({ x: side * T.alcoves.x, y: .9, w: T.alcoves.half * 2, h: T.alcoves.height, arch: T.alcoves.half }))
  s.wall('stone', 0, F, b.front - b.wall / 2, b.halfX * 2, b.top, b.wall, [{ x: 0, y: 0, w: T.door.half * 2, h: T.door.height, arch: T.door.half * .55 }, ...alcoves], PALETTE.cream)
  for (const a of alcoves) {
    // Shallow recess: red back panel, scutum and crossed spears, behind a marble archivolt.
    s.span('stone', a.x - a.w / 2, F + a.y, innerFront + .02, a.x + a.w / 2, F + a.y + a.h, innerFront + .06, PALETTE.redPlaster)
    s.archRing('stone', a.x, F + a.y + a.h - a.arch, b.front + .02, a.w / 2, a.arch, .2, .2, PALETTE.marble)
    s.scutum(a.x, F + a.y + 1.4, innerFront + .2, 0, .05)
    for (const sx of [-1, 1]) s.beam('wood', V(a.x - sx * .9, F + a.y + .2, innerFront + .12), V(a.x + sx * .7, F + a.y + 3.0, innerFront + .12), .05, .05, PALETTE.timber, true)
  }
  for (const side of [-1, 1]) s.wall('stone', side * (b.halfX - b.wall / 2), F, (b.back + b.front) / 2, b.front - b.back, b.top, b.wall,
    [{ x: -2.4, y: 2.0, w: 1.1, h: 2.1, arch: .55 }, { x: 1.4, y: 2.0, w: 1.1, h: 2.1, arch: .55 }], PALETTE.cream, side * Math.PI / 2)
  // Wall-local x maps to world z = centre + x on the west wall and centre - x on the east wall.
  for (const side of [-1, 1]) for (const x of [-2.4, 1.4]) s.window(side * (b.halfX + .01), F + 3.05, (b.back + b.front) / 2 - side * x, side * Math.PI / 2, 1.1, 2.1, 'stone', true)
  s.wall('stone', 0, F, b.back + b.wall / 2, b.halfX * 2, b.top, b.wall, [], PALETTE.cream)
  // Red bands and marble plinth course outside.
  for (const [y0, y1, color] of [[0, .9, PALETTE.marble], [1.1, 1.6, PALETTE.redPlaster], [b.top - .9, b.top - .45, PALETTE.redPlaster]] as const) {
    s.span('stone', -b.halfX - .05, F + y0, b.front - .02, -T.door.half - .05, F + y1, b.front + .06, color)
    s.span('stone', T.door.half + .05, F + y0, b.front - .02, b.halfX + .05, F + y1, b.front + .06, color)
    for (const side of [-1, 1]) s.span('stone', side * b.halfX - .06, F + y0, b.back, side * b.halfX + .06, F + y1, b.front, color)
  }
  s.span('stone', -b.halfX - .25, top - .1, b.back - .25, b.halfX + .25, top + .2, b.front + .25, PALETTE.marble)
  // Portico, pediment, open doors and swag banner.
  for (const side of [-1, 1]) {
    s.column(side * p.columnX, F, p.columnZ, p.eave, p.columnR)
    s.doorLeaf(side * T.door.half, F, innerFront - .1, T.door.half - .05, T.door.height - .8, side < 0 ? Math.PI : 0)
  }
  s.span('stone', -p.halfX - .1, F + p.eave - .6, b.front, p.halfX + .1, F + p.eave + .1, p.front + .1, PALETTE.marble)
  s.span('stone', -p.halfX - .1, F + b.top, b.front - 1, p.halfX + .1, F + p.eave - .6, b.front + .1, PALETTE.marble)
  dentils(s, -p.halfX, p.halfX, F + p.eave - .7, p.front + .15)
  pedimentFront(s, 0, F + p.eave + .1, p.front + .15, p.halfX * 2 + .4, p.rise)
  s.banner(0, F + T.door.height + .95, b.front + .32, 0, 3.0, 1.1)
  // Roofs: central gable over the hall, low hips over the wings.
  r.gableRoof('roof', { axis: 'z', halfSpan: p.halfX + .3, from: b.back - .3, to: p.front + .2, eave: F + p.eave + .1, ridge: F + p.eave + .1 + p.rise })
  ridgeTiles(r, V(0, F + p.eave + p.rise + .28, b.back - .3), V(0, F + p.eave + p.rise + .28, p.front + .2))
  s.gable('stone', 0, F + p.eave + .1, b.back - .2, p.halfX * 2 + .6, p.rise, .3, PALETTE.marble)
  s.span('stone', -p.halfX - .1, top + .2, b.back - .2, p.halfX + .1, F + p.eave + .1, b.front, PALETTE.marble)
  for (const side of [-1, 1]) r.hipRoof('roof', side < 0 ? -b.halfX - .4 : p.halfX - .1, side < 0 ? -p.halfX + .1 : b.halfX + .4, b.back - .4, b.front + .4, top + .2, T.wingRoof.rise)
  // Banners on the wing faces and statues before them.
  for (const side of [-1, 1]) {
    s.banner(side * (b.halfX - .7), top - .6, b.front + .1, 0, .95, 3.2)
    const st = T.statues, gy = Math.min(ctx.ground(side * st.x, st.z), 0) - .4
    s.span('stone', side * st.x - st.pedestal / 2, gy, st.z - st.pedestal / 2, side * st.x + st.pedestal / 2, st.pedestalTop, st.z + st.pedestal / 2, PALETTE.marble)
    s.laurel(side * st.x, st.pedestalTop - .45, st.z + st.pedestal / 2 + .03, 0, .26)
    ctx.statue(side * st.x, st.pedestalTop, st.z, 0, 2.5)
  }
  // Interior: recruitment desk, rear eagle banner, racks, shields, benches, chandelier, carpet, torches.
  s.table(0, F, (T.desk.back + T.desk.front) / 2, T.desk.half * 2, T.desk.front - T.desk.back, T.desk.top)
  s.span('cloth', -T.desk.half, F + .1, T.desk.front - .01, T.desk.half, F + T.desk.top - .1, T.desk.front + .02, PALETTE.red)
  s.laurel(0, F + .6, T.desk.front + .04, 0, .3)
  s.box('cloth', 0, F + 3.6, innerBack + .04, 2.4, 3.6, .04, PALETTE.red)
  s.eagle(0, F + 4.1, innerBack + .1, 0, 1.0)
  for (const side of [-1, 1]) {
    s.banner(side * 4.4, F + 5.4, innerBack + .05, 0, 1.2, 3.0)
    s.weaponRack(side * (innerX - .7), F, -1, 6, -side * Math.PI / 2, 'spear', ['paladin_sword_t4', 'byzantine_standard_lance_t5', 'sword_t5'])
    for (const z of [-3.4, -1.6, .2]) s.scutum(side * (innerX - .06), F + 3.4, z, -side * Math.PI / 2, .02, side < 0 ? 'centurion_aquila_shield_t4' : 'byzantine_eagle_shield_t5')
    s.bench(side * 5, F, 2.05, 2.8, 0)
    for (const z of [-4.5, 3]) { s.box('metal', side * (innerX - .1), F + 3.0, z, .12, .5, .12, PALETTE.iron); s.bowlFire(side * (innerX - .32), F + 3.25, z, .45) }
  }
  s.span('cloth', -1.1, F + .005, T.desk.front + .2, 1.1, F + .025, b.front, PALETTE.red)
  const ring = V(0, F + 4.4, -.6)
  s.add('metal', new THREE.TorusGeometry(1.0, .05, 6, 20).rotateX(Math.PI / 2).translate(ring.x, ring.y, ring.z), PALETTE.iron)
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; s.add('glow', new THREE.SphereGeometry(.06, 5, 4).translate(Math.cos(a), ring.y + .2, ring.z + Math.sin(a)), PALETTE.glow, null) }
  s.beam('metal', ring, V(0, top, ring.z), .03, .03, PALETTE.iron)
}

/** The small Principia theme extends into one enclosed recruitment basilica. */
function buildExpandedRomanHrCenter(ctx: BuildContext): void {
  const h = ctx.hrHall!, b = h.body, s = ctx.body, r = ctx.roof, F = ROMAN_HR_CENTER.F
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, width = b.maxX - b.minX, depth = b.maxZ - b.minZ
  s.wall('stone', cx, F, b.maxZ - h.wall / 2, width, h.eave, h.wall,
    h.portals.map(p => ({ x: p.x - cx, y: 0, w: p.doorWidth, h: p.height, arch: .8 })), PALETTE.cream)
  s.wall('stone', cx, F, b.minZ + h.wall / 2, width, h.eave, h.wall, [], PALETTE.cream)
  for (const side of [-1, 1]) {
    const x = side < 0 ? b.minX : b.maxX
    s.wall('stone', x - side * h.wall / 2, F, cz, depth, h.eave, h.wall,
      [-6, 0, 6].map(z => ({ x: -side * (z - cz), y: 2.5, w: 1.2, h: 1.8, arch: .6 })), PALETTE.cream, side * Math.PI / 2)
    for (const z of [-6, 0, 6]) s.window(x + side * .02, F + 3.4, z, side * Math.PI / 2, 1.2, 1.8, 'stone', true)
    for (const [lo, hi, color] of [[0, .9, PALETTE.marble], [1.1, 1.6, PALETTE.redPlaster], [h.eave - .6, h.eave - .2, PALETTE.redPlaster]] as const)
      s.span('stone', x - .06, F + lo, b.minZ, x + .06, F + hi, b.maxZ, color)
  }
  let edge = b.minX
  for (const p of [...h.portals].sort((a, b) => a.x - b.x)) {
    for (const [lo, hi, color] of [[0, .9, PALETTE.marble], [1.1, 1.6, PALETTE.redPlaster]] as const)
      s.span('stone', edge, F + lo, b.maxZ, p.x - p.doorWidth / 2, F + hi, b.maxZ + .06, color)
    edge = p.x + p.doorWidth / 2
  }
  for (const [lo, hi, color] of [[0, .9, PALETTE.marble], [1.1, 1.6, PALETTE.redPlaster]] as const)
    s.span('stone', edge, F + lo, b.maxZ, b.maxX, F + hi, b.maxZ + .06, color)
  for (const z of [b.minZ, b.maxZ]) s.box('stone', cx, F + h.eave, z, width + .36, .25, .36, PALETTE.marble)
  for (const x of [b.minX, b.maxX]) s.box('stone', x, F + h.eave, cz, .36, .25, depth, PALETTE.marble)
  const roof = { axis: 'x' as const, cz, halfSpan: depth / 2 + .4, from: b.minX - .4, to: b.maxX + .4, eave: F + h.eave, ridge: F + h.ridge, thickness: .25 }
  r.gableRoof('roof', roof)
  ridgeTiles(r, V(roof.from, roof.ridge + .15, cz), V(roof.to, roof.ridge + .15, cz))
  for (const side of [-1, 1]) pedimentFront(r, side < 0 ? b.minX - .08 : b.maxX + .08, F + h.eave, cz, depth + .5, h.ridge - h.eave, side * Math.PI / 2)
  for (const p of h.portals) {
    for (const side of [-1, 1]) {
      s.column(p.x + side * 3.7, F, b.maxZ + .8, h.eave, .38)
      s.doorLeaf(p.x + side * p.doorWidth / 2, F, b.maxZ - h.wall - .1, p.doorWidth / 2 - .05, p.height - .8, side < 0 ? Math.PI : 0)
    }
    r.gableRoof('roof', { axis: 'z', cx: p.x, halfSpan: 4.3, from: b.maxZ - .2, to: p.z + .2, eave: F + h.eave, ridge: F + h.eave + 2.4, thickness: .25 })
    pedimentFront(r, p.x, F + h.eave, p.z + .05, 8.6, 2.4)
  }
  for (const x of [b.minX + 1.5, b.maxX - 1.5]) s.banner(x, F + 6.1, b.maxZ + .1, 0, 1.1, 3.0)
  buildHrHallDetails(ctx)
}

/* ─────────────── Weapon shop (fabrica / armoury) ─────────────── */
export function buildRomanWeapons(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = ROMAN_WEAPONS, F = T.F, b = T.body, top = F + b.top, a = T.arch
  s.wall('stone', 0, F, b.front - b.wall / 2, b.halfX * 2, b.top, b.wall, [{ x: 0, y: 0, w: a.half * 2, h: a.spring + a.rise, arch: a.rise }], PALETTE.cream)
  s.archRing('stone', 0, F + a.spring, b.front + .02, a.half, a.rise, .38, b.wall + .14, PALETTE.marble)
  s.box('stone', 0, F + a.spring + a.rise + .2, b.front + .1, .55, .6, .7, PALETTE.marble)
  for (const side of [-1, 1]) {
    const holes = side < 0 ? [-2.6, -.4, 1.8].map(z => ({ x: z, y: 1.3, w: .9, h: 1.7, arch: .45 })) : []
    s.wall('stone', side * (b.halfX - b.wall / 2), F, (b.back + b.front) / 2, b.front - b.back, b.top, b.wall, holes, PALETTE.cream, side * Math.PI / 2)
    if (side < 0) for (const x of [-2.6, -.4, 1.8]) s.window(-b.halfX - .01, F + 2.15, x + (b.back + b.front) / 2, -Math.PI / 2, .9, 1.7, 'stone', true)
  }
  s.wall('stone', 0, F, b.back + b.wall / 2, b.halfX * 2, b.top, b.wall, [], PALETTE.cream)
  // Red dado with a marble meander band outside.
  for (const side of [-1, 1]) {
    s.span('stone', side * b.halfX - .05, F, b.back - .05, side * b.halfX + .05, F + 1.0, b.front + .05, PALETTE.redPlaster)
    s.span('stone', side * b.halfX - .06, F + 1.0, b.back - .06, side * b.halfX + .06, F + 1.18, b.front + .06, PALETTE.marble)
    s.span('stone', side < 0 ? -b.halfX - .05 : a.half + .4, F, b.front - .02, side < 0 ? -a.half - .4 : b.halfX + .05, F + 1.0, b.front + .06, PALETTE.redPlaster)
    s.column(side * T.corner.x, F, T.corner.z, b.top, T.corner.r)
  }
  s.span('stone', -b.halfX, F, b.back - .05, b.halfX, F + 1.0, b.back + .02, PALETTE.redPlaster)
  s.span('stone', -T.roof.halfSpan, top, T.roof.back, T.roof.halfSpan, top + .2, T.roof.front, PALETTE.marble)
  dentils(s, -b.halfX, b.halfX, top - .08, b.front + .12)
  pedimentFront(s, 0, top + .2, T.roof.front, T.roof.halfSpan * 2, T.roof.rise, 0, false)
  s.gable('stone', 0, top + .2, T.roof.back + .2, T.roof.halfSpan * 2, T.roof.rise, .3, PALETTE.cream)
  r.gableRoof('roof', { axis: 'z', halfSpan: T.roof.halfSpan + .25, from: T.roof.back - .2, to: T.roof.front + .2, eave: top + .1, ridge: top + .2 + T.roof.rise })
  ridgeTiles(r, V(0, top + T.roof.rise + .35, T.roof.back - .2), V(0, top + T.roof.rise + .35, T.roof.front + .2))
  for (const side of [-1, 1]) for (let z = b.back; z <= b.front; z += 1.2) s.box('wood', side * (b.halfX + .25), top - .05, z, .5, .18, .16, PALETTE.darkTimber)
  // Forge, hood and chimney; tool wall; sword rack; anvil; quench tub; scuta; helmet.
  s.span('stone', -5, F, b.back + b.wall, -2.6, F + 1.2, -3.2, PALETTE.footing)
  s.span('stone', -4.6, F + 1.2, b.back + b.wall + .1, -3.0, F + 1.25, -3.5, 0x4a4038)
  s.add('metal', new THREE.CylinderGeometry(.35, 1.2, 1.2, 4).rotateY(Math.PI / 4).translate(-3.8, F + 2.6, -4.0), PALETTE.bronze)
  s.span('stone', -4.25, F + 3.2, -4.55, -3.35, F + b.top + T.roof.rise + 1.6, -3.65, PALETTE.ashlar)
  s.span('stone', -4.4, F + b.top + T.roof.rise + 1.4, -4.7, -3.2, F + b.top + T.roof.rise + 1.7, -3.5, PALETTE.marble)
  s.brazier(-3.8, F + .3, -3.9, .8, PALETTE.footing)
  for (let i = 0; i < 5; i++) { const x = -1.6 + i * .5; s.box('wood', x, F + 2.1, b.back + b.wall + .05, .05, .55, .05, PALETTE.timber); s.box('metal', x, F + 2.4, b.back + b.wall + .07, .2, .12, .1, PALETTE.iron) }
  s.weaponRack(2.3, F, -4.25, 2.8, 0, 'spear', ['paladin_sword_t4', 'byzantine_standard_lance_t5', 'sword_t5'])
  s.anvil(-.6, F, -1.2, .4)
  s.cylinder('wood', 1.5, F, -1.4, .45, .4, .7, PALETTE.timber, 12); s.cylinder('water', 1.5, F + .62, -1.4, .4, .4, .04, undefined, 12)
  for (const z of [-1.6, -.6, .4]) s.scutum(4.6, F + .62, z, -Math.PI / 2, .28)
  s.add('metal', new THREE.SphereGeometry(.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-.6, F + 1.75, -4.4), PALETTE.bronze)
  s.box('cloth', -.6, F + 2.0, -4.4, .05, .22, .4, PALETTE.red)
  s.span('wood', -1.6, F + 1.5, -4.75, .4, F + 1.55, -4.35, PALETTE.timber)
  // Striped canvas awning on posts over the merchant, clear of rider headroom.
  const c = T.canopy, low = ctx.canopyY, high = low + .5
  for (const side of [-1, 1]) {
    s.cylinder('wood', side * c.postX, ctx.ground(side * c.postX, c.postZ) - .3, c.postZ, .12, .14, low - ctx.ground(side * c.postX, c.postZ) + .35, PALETTE.darkTimber, 8)
    s.beam('wood', V(side * c.postX, high, b.front + .25), V(side * c.postX, low, c.postZ), .12, .12, PALETTE.darkTimber)
  }
  s.beam('wood', V(-c.halfX, low, c.postZ), V(c.halfX, low, c.postZ), .14, .14, PALETTE.darkTimber)
  for (let i = 0; i < 8; i++) {
    const x0 = -c.halfX + i * c.halfX / 4, x1 = x0 + c.halfX / 4
    s.shedRoof('cloth', { axis: 'x', low: [c.front, low + .05], high: [b.front + .3, high + .05], from: x0, to: x1, thickness: .04, color: i % 2 ? PALETTE.cream : PALETTE.stripe })
  }
  // Display tables with real equipment, keeping the merchant's position.
  const tb = T.tables
  for (const side of [-1, 1]) {
    const gx = side * tb.x, gy = ctx.ground(gx, tb.z)
    s.table(gx, gy, tb.z, tb.halfX * 2, tb.halfZ * 2, tb.top - gy + F > 0 ? F + tb.top - gy : 1)
    const ids = ['paladin_sword_t4', 'sword_t5']
    ctx.root.add(tabletopDisplayRow(ids.map(id => ({ id, kind: id === 'bow_t5' ? 'ranged' : 'melee' })), gx, F + tb.top, tb.z, tb.halfX * 2, tb.halfZ * 2, Math.PI / 2))
  }
  s.scutum(-5.1, F + 2.1, b.front + .12, 0, 0, 'centurion_aquila_shield_t4')
  s.scutum(4.5, F + 2.4, -2.5, -Math.PI / 2, 0, 'byzantine_eagle_shield_t5')
  s.crate(-5.4, ctx.ground(-5.4, 7.8), 7.8, .6)
  s.barrel(5.55, ctx.ground(5.55, 5.6), 5.6, .8)
  s.banner(4.6, top - .3, b.front + .15, 0, .9, 2.3)
}

/* ─────────────── Stable ─────────────── */
export function buildRomanStable(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, T = ROMAN_STABLE, F = T.F, cl = T.clerestory, ar = T.arcade
  const backEave = F + 4.4, frontEave = F + ar.entablature
  // Rear and side walls (sides rise into pedimented gables over the clerestory).
  s.wall('stone', 0, F, (T.rear.z0 + T.rear.z1) / 2, T.side.outer * 2, backEave - F, T.rear.z1 - T.rear.z0, [], PALETTE.cream)
  for (const side of [-1, 1]) {
    const x = side * (T.side.inner + T.side.outer) / 2
    for (const [bottom, top, color] of [[0, .9, PALETTE.marble], [.9, 1, PALETTE.cream], [1, 1.4, PALETTE.redPlaster], [1.4, ar.entablature, PALETTE.cream]] as const)
      s.span('stone', x - (T.side.outer - T.side.inner) / 2, F + bottom, T.rear.z1,
        x + (T.side.outer - T.side.inner) / 2, F + top, T.front, color)
    s.span('stone', side * T.side.inner, F + ar.entablature, cl.back, side * T.side.outer, F + cl.top, cl.front, PALETTE.redPlaster)
    pedimentFront(s, side * (T.side.outer + .05), F + cl.top, (cl.front + cl.back) / 2, cl.front - cl.back + .6, cl.rise + .2, side * Math.PI / 2, true)
    // Harness pegs and a saddle inside the end stalls.
    for (let i = 0; i < 3; i++) s.add('metal', new THREE.TorusGeometry(.18, .025, 4, 10).rotateY(Math.PI / 2).translate(side * (T.side.inner - .05), F + 2.0, -3.6 + i * .7), PALETTE.darkTimber)
  }
  // Clerestory walls with lunette windows.
  for (const [z, yaw] of [[cl.front, 0], [cl.back, Math.PI]] as const) {
    s.wall('stone', 0, F + ar.entablature, z, T.side.inner * 2, cl.top - ar.entablature, .4, [], PALETTE.cream, yaw)
    for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) s.window(x, F + cl.top - .75, z + (yaw ? -.21 : .21), yaw, 1.0, .9, 'stone', true)
  }
  // Front arcade: slender columns, arches, red frieze.
  for (let i = 1; i <= 4; i++) s.column(-6.5 + i * 2.6, F, T.columns.z, ar.spring + .05, T.columns.r, { flutes: false })
  s.wall('stone', 0, F + ar.spring, T.columns.z, T.side.outer * 2, ar.entablature - ar.spring, .5,
    [0, 1, 2, 3, 4].map(i => ({ x: -5.2 + i * 2.6, y: 0, w: 2.36, h: .9, arch: .9 })), PALETTE.cream)
  s.span('stone', -T.side.outer, F + ar.top, T.columns.z + .25, T.side.outer, F + ar.top + .35, T.columns.z + .3, PALETTE.redPlaster)
  for (const x of [-3.9, -1.3, 1.3, 3.9]) s.laurel(x, F + ar.top + .17, T.columns.z + .32, 0, .14)
  // Roofs: clerestory gable along X, lean-tos front and back, porch pent roof.
  r.gableRoof('roof', { axis: 'x', halfSpan: (cl.front - cl.back) / 2 + .3, cz: (cl.front + cl.back) / 2, from: -T.side.outer - .3, to: T.side.outer + .3, eave: F + cl.top, ridge: F + cl.top + cl.rise })
  ridgeTiles(r, V(-T.side.outer - .3, F + cl.top + cl.rise + .2, (cl.front + cl.back) / 2), V(T.side.outer + .3, F + cl.top + cl.rise + .2, (cl.front + cl.back) / 2))
  r.shedRoof('roof', { axis: 'x', low: [T.front + .3, frontEave], high: [cl.front, F + cl.top - .9], from: -T.side.outer - .2, to: T.side.outer + .2 })
  r.shedRoof('roof', { axis: 'x', low: [T.rear.z0 - .3, backEave], high: [cl.back, F + cl.top - .9], from: -T.side.outer - .2, to: T.side.outer + .2 })
  const pr = T.porch
  r.shedRoof('roof', { axis: 'x', low: [pr.front, F + pr.low], high: [T.front + .2, F + pr.high], from: -T.side.outer - .1, to: T.side.outer + .1 })
  for (const side of [-1, 1]) s.column(side * pr.postX, ctx.ground(side * pr.postX, pr.postZ), pr.postZ, F + pr.low - ctx.ground(side * pr.postX, pr.postZ), .14, { capital: 'stone', flutes: false })
  s.span('wood', -T.side.outer, F + pr.low - .2, pr.postZ - .1, T.side.outer, F + pr.low, pr.postZ + .1, PALETTE.darkTimber)
  // Stalls: partitions, mangers, hay racks, straw and lanterns.
  s.span('cloth', -T.side.inner, F - .025, T.rear.z1, T.side.inner, F, T.front, PALETTE.hay)
  for (let i = 1; i <= 4; i++) {
    const x = -6.5 + i * 2.6, d = T.dividers
    s.span('wood', x - .07, F, d.back, x + .07, F + d.top - .1, d.front, PALETTE.timber)
    s.span('wood', x - .1, F + d.top - .12, d.back, x + .1, F + d.top, d.front, PALETTE.darkTimber)
    s.beam('wood', V(x + .09, F + .1, d.back + .2), V(x + .09, F + d.top - .2, d.front - .2), .08, .08, PALETTE.darkTimber)
    s.beam('wood', V(x + .09, F + d.top - .2, d.back + .2), V(x + .09, F + .1, d.front - .2), .08, .08, PALETTE.darkTimber)
  }
  for (const x of [-5.2, -2.6, 0, 2.6, 5.2]) {
    s.span('wood', x - .95, F, T.rear.z1, x + .95, F + 1.0, T.rear.z1 + .55, PALETTE.timber)
    s.span('cloth', x - .85, F + .95, T.rear.z1 + .05, x + .85, F + 1.05, T.rear.z1 + .5, PALETTE.hay)
    s.lantern(x, F + 3.1, 2.2)
  }
  // Water basin with a laurel spout at the porch corner.
  const bs = T.basin
  s.span('stone', bs.minX, ctx.ground((bs.minX + bs.maxX) / 2, (bs.minZ + bs.maxZ) / 2) - .3, bs.minZ, bs.maxX, F + bs.top, bs.maxZ, PALETTE.marble)
  s.span('water', bs.minX + .08, F + bs.top - .12, bs.minZ + .08, bs.maxX - .08, F + bs.top - .08, bs.maxZ - .08)
  s.laurel(T.side.outer + .04, F + 2.2, 8.3, Math.PI / 2, .2)
  s.banner(-T.side.outer - .1, F + 4.0, 0, -Math.PI / 2, 1.0, 2.6)
}

/* ─────────────── Homes ─────────────── */
export function buildRomanHome(ctx: BuildContext, variant: 'home-a' | 'home-b' | 'home-c'): void {
  if (variant === 'home-a') romanHomeA(ctx)
  else if (variant === 'home-b') romanHomeB(ctx)
  else romanHomeC(ctx)
}
function shutteredWindow(s: Sketch, x: number, y: number, z: number, yaw: number, open = true): void {
  s.window(x, y, z, yaw, .8, 1.0, 'wood', false)
  const right = V(Math.cos(yaw), 0, -Math.sin(yaw)), face = V(Math.sin(yaw), 0, Math.cos(yaw))
  for (const side of [-1, 1]) {
    const p = V(x, y, z).addScaledVector(right, side * (open ? .68 : .2)).addScaledVector(face, .06)
    s.box('wood', p.x, p.y, p.z, .4, 1.05, .05, PALETTE.darkTimber, yaw)
  }
  s.box('stone', x, y + .62, z + face.z * .05, 1.0, .14, .14, PALETTE.marble, yaw)
}
function romanHomeA(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, a = ROMAN_HOMES.a, F = ROMAN_HOMES.F, top = F + a.top
  s.wall('stone', 0, F, a.front - .2, a.halfX * 2, a.top, .4, [{ x: 0, y: 0, w: 1.3, h: 2.3, arch: .65 }], PALETTE.cream)
  for (const side of [-1, 1]) s.wall('stone', side * (a.halfX - .2), F, (a.back + a.front) / 2, a.front - a.back, a.top, .4, [], PALETTE.cream, Math.PI / 2)
  s.wall('stone', 0, F, a.back + .2, a.halfX * 2, a.top, .4, [], PALETTE.cream)
  s.span('stone', -a.halfX - .04, F, a.back - .04, a.halfX + .04, F + .9, a.front + .04, PALETTE.redPlaster)
  for (const x of [-2.4, 2.4]) shutteredWindow(s, x, F + 2.0, a.front + .02, 0)
  shutteredWindow(s, a.halfX + .02, F + 2.0, -.8, Math.PI / 2)
  s.doorLeaf(-.65, F, a.front - .45, 1.25, 2.0, Math.PI / 2 - .15)
  // Gable ends sit on the side walls; the ridge runs across the façade.
  for (const side of [-1, 1]) s.gable('stone', side * (a.halfX - .2), top, (a.back + a.front) / 2, a.front - a.back + .3, 1.9, .4, PALETTE.cream, Math.PI / 2)
  r.gableRoof('roof', { axis: 'x', halfSpan: (a.front - a.back) / 2 + .45, cz: (a.front + a.back) / 2, from: -a.halfX - .35, to: a.halfX + .35, eave: top - .05, ridge: top + 1.9 })
  ridgeTiles(r, V(-a.halfX - .35, top + 2.05, (a.front + a.back) / 2), V(a.halfX + .35, top + 2.05, (a.front + a.back) / 2))
  // Small porch: two columns and a laurel pediment.
  for (const side of [-1, 1]) s.column(side * a.columnX, F, a.columnZ, 2.8, .17)
  s.span('stone', -a.porchHalf, F + 2.8, a.front, a.porchHalf, F + 3.1, a.porchFront, PALETTE.marble)
  pedimentFront(s, 0, F + 3.1, a.porchFront, a.porchHalf * 2 + .2, .9, 0, false)
  r.gableRoof('roof', { axis: 'z', halfSpan: a.porchHalf + .2, from: a.front - .2, to: a.porchFront + .15, eave: F + 3.05, ridge: F + 4.05, thickness: .16 })
  // Pots, planters and a chimney.
  s.amphora(-a.halfX + .5, ctx.ground(-3.1, 3.5), 3.5, .9); s.amphora(-a.halfX + 1.0, ctx.ground(-2.6, 3.7), 3.7, .7)
  s.planter(2.7, ctx.ground(2.7, 3.2) - .1, 3.2, 1.2, .6)
  s.span('stone', 1.8, top, -2.6, 2.6, top + 2.6, -1.8, PALETTE.ashlar)
}
function romanHomeB(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, b = ROMAN_HOMES.b, F = ROMAN_HOMES.F, m = b.main, sh = b.shop
  const mx = (m.minX + m.maxX) / 2, mw = m.maxX - m.minX
  s.wall('stone', mx, F, m.front - .2, mw, m.top, .4, [{ x: -1.4 - mx, y: 0, w: 1.3, h: 2.5, arch: .65 }], PALETTE.cream)
  s.archRing('stone', -1.4, F + 1.85, m.front + .02, .65, .65, .18, .5, PALETTE.marble)
  for (const side of [-1, 1]) s.box('stone', -1.4 + side * 1.0, F + 1.4, m.front + .1, .4, 2.8, .25, PALETTE.marble)
  s.wall('stone', m.minX + .2, F, 0, m.front - m.back, m.top, .4, [], PALETTE.cream, Math.PI / 2)
  s.wall('stone', mx, F, m.back + .2, mw, m.top, .4, [], PALETTE.cream)
  s.wall('stone', m.maxX - .2, F, 0, m.front - m.back, m.top, .4, [], PALETTE.cream, Math.PI / 2)
  s.span('stone', m.minX - .04, F, m.back - .04, m.maxX, F + .8, m.front + .04, PALETTE.redPlaster)
  s.span('stone', m.minX - .06, F + 3.3, m.back - .06, sh.maxX + .06, F + 3.55, m.front + .06, PALETTE.marble)
  s.span('stone', m.minX - .05, F + 3.55, m.front - .02, m.maxX, F + 3.95, m.front + .05, PALETTE.redPlaster)
  for (const x of [-3.4, -.2]) shutteredWindow(s, x, F + 4.9, m.front + .02, 0)
  shutteredWindow(s, -3.4, F + 1.8, m.front + .02, 0)
  s.lantern(-1.4, F + 2.9, m.front + .45)
  r.hipRoof('roof', m.minX - .4, m.maxX + .2, m.back - .4, m.front + .4, F + m.top, 1.6)
  // Ground-floor shop with striped awning; recessed upper loggia with a balustrade.
  s.span('stone', sh.minX, F, sh.back, sh.maxX, F + sh.top, sh.front, PALETTE.cream)
  s.span('stone', sh.minX, F, sh.front - .05, sh.maxX + .04, F + .8, sh.front + .03, PALETTE.redPlaster)
  s.window((sh.minX + sh.maxX) / 2, F + 1.8, sh.front + .02, 0, 1.6, 1.2, 'wood')
  s.span('stone', sh.minX, F + sh.top, sh.back, sh.maxX, F + m.top - .2, b.loggiaFront - .2, PALETTE.cream)
  for (const x of [sh.minX + .3, (sh.minX + sh.maxX) / 2, sh.maxX - .25]) s.column(x, F + sh.top, b.loggiaFront, m.top - sh.top - .2, .14)
  for (const x of [(sh.minX * 3 + sh.maxX) / 4 + .1, (sh.minX + sh.maxX * 3) / 4]) s.archRing('stone', x, F + m.top - 1.15, b.loggiaFront, .6, .55, .16, .3, PALETTE.marble)
  s.span('stone', sh.minX, F + m.top - .6, b.loggiaFront - .15, sh.maxX, F + m.top - .2, b.loggiaFront + .15, PALETTE.cream)
  for (let x = sh.minX + .2; x < sh.maxX; x += .32) s.cylinder('stone', x, F + sh.top, sh.front - .1, .06, .07, .8, PALETTE.marble, 6)
  s.span('stone', sh.minX, F + sh.top + .8, sh.front - .2, sh.maxX, F + sh.top + .92, sh.front, PALETTE.marble)
  s.tree(3.6, F + sh.top, -.2, 'olive', .45)
  r.hipRoof('roof', sh.minX - .1, sh.maxX + .35, sh.back - .4, b.loggiaFront + .45, F + m.top - .2, 1.2)
  const aw = b.awning
  for (let i = 0; i < 6; i++) {
    const x0 = 1.8 + i * .4, x1 = x0 + .4
    s.shedRoof('cloth', { axis: 'x', low: [aw.front, F + aw.y], high: [sh.front + .05, F + aw.y + .6], from: x0, to: x1, thickness: .04, color: i % 2 ? PALETTE.cream : PALETTE.stripe })
  }
  for (const x of [2.0, 4.1]) s.cylinder('wood', x, ctx.ground(x, aw.front - .15) - .2, aw.front - .15, .06, .07, F + aw.y - ctx.ground(x, aw.front - .15) + .2, PALETTE.darkTimber, 6)
  s.barrel(2.5, ctx.ground(2.5, 2.6), 2.6, .8); s.barrel(3.3, ctx.ground(3.3, 2.4), 2.4, .8); s.crate(3.8, ctx.ground(3.8, 3.0), 2.9, .55)
  s.banner(1.0, F + 6.0, m.front + .1, 0, .8, 2.3)
  s.amphora(-2.5, ctx.ground(-2.5, 4.05), 4.05, .8)
}
function romanHomeC(ctx: BuildContext): void {
  const s = ctx.body, r = ctx.roof, c = ROMAN_HOMES.c, F = ROMAN_HOMES.F
  // Rear two-storey wing with arched upper windows.
  s.span('stone', -4.4, F, c.rear.back, 4.4, F + c.rear.top, c.rear.front, PALETTE.cream)
  s.span('stone', -4.44, F, c.rear.back - .04, 4.44, F + .8, c.rear.front + .04, PALETTE.redPlaster)
  s.span('stone', -4.46, F + 3.0, c.rear.back - .06, 4.46, F + 3.25, c.rear.front + .06, PALETTE.marble)
  for (const x of [-.2, 1.6, 3.4]) s.window(x, F + 4.5, c.rear.front + .02, 0, .7, 1.2, 'stone', true)
  r.hipRoof('roof', -4.8, 4.8, c.rear.back - .4, c.rear.front + .4, F + c.rear.top, 1.6)
  // Left wing (single storey) with red panels and a lean-to roof.
  const l = c.left
  s.span('stone', l.minX, F, c.rear.front, l.maxX, F + l.top, l.front, PALETTE.redPlaster)
  s.span('stone', l.minX - .04, F, c.rear.front, l.maxX + .04, F + .8, l.front + .04, PALETTE.marble)
  shutteredWindow(s, (l.minX + l.maxX) / 2, F + 2.0, l.front + .02, 0, false)
  r.shedRoof('roof', { axis: 'z', low: [l.maxX + .35, F + l.top - .2], high: [l.minX - .1, F + l.top + .9], from: c.rear.front, to: l.front + .35 })
  // Courtyard: perimeter walls, arched gate with pediment, peristyle, fountain, cypress and vines.
  const w = c.wall
  s.span('stone', l.maxX, F, w.front - w.t, c.gate.minX, F + w.top, w.front, PALETTE.cream)
  s.span('stone', c.gate.maxX, F, w.front - w.t, 4.4, F + w.top, w.front, PALETTE.cream)
  s.span('stone', 4.4 - w.t, F, c.rear.front, 4.4, F + w.top, w.front, PALETTE.cream)
  for (const x of [l.maxX, 4.4]) s.span('stone', x - (x > 0 ? w.t : 0), F + w.top, x > 0 ? c.rear.front : w.front - w.t, x + (x > 0 ? 0 : w.t), F + w.top + .12, w.front, PALETTE.marble)
  const gx = (c.gate.minX + c.gate.maxX) / 2
  for (const side of [-1, 1]) s.column(gx + side * 1.15, F, w.front + .05, 2.7, .17)
  s.wall('stone', gx, F + 1.5, w.front - w.t / 2, 2.7, 1.4, w.t + .1, [{ x: 0, y: 0, w: 2.0, h: 1.0, arch: 1.0 }], PALETTE.cream)
  pedimentFront(s, gx, F + 2.9, w.front + .2, 2.9, .9, 0, false)
  s.span('stone', gx - 1.45, F + 2.7, w.front - .3, gx + 1.45, F + 2.95, w.front + .25, PALETTE.marble)
  for (const side of [-1, 1]) s.doorLeaf(gx + side * 1.0, F, w.front - w.t - .08, .95, 1.9, side < 0 ? Math.PI / 2 + .3 : Math.PI / 2 - .3)
  for (const x of [-1.0, 1.0, 3.0]) s.column(x, F, -.55, 3.2, .15)
  s.shedRoof('roof', { axis: 'x', low: [-.15, F + 3.2], high: [c.rear.front + .1, F + 3.7], from: l.maxX, to: 4.3, thickness: .16 })
  const f = c.fountain
  s.cylinder('stone', f.x, F, f.z, f.r, f.r + .05, .55, PALETTE.marble, 16); s.cylinder('water', f.x, F + .45, f.z, f.r - .08, f.r - .08, .06, undefined, 16)
  s.cylinder('stone', f.x, F + .5, f.z, .12, .16, .6, PALETTE.marble, 8); s.cylinder('stone', f.x, F + 1.05, f.z, .38, .1, .18, PALETTE.marble, 12)
  s.tree(3.7, F, 3.1, 'cypress', 1.1)
  s.tree(-1.0, F, 3.2, 'cypress', .8)
  for (let i = 0; i < 9; i++) s.add('foliage', new THREE.IcosahedronGeometry(.32, 0).translate(.4 + i * .45, F + w.top - .1 - (i % 3) * .3, w.front + .08), PALETTE.leaf)
  for (const x of [-.7, 3.2]) s.amphora(x, ctx.ground(x, w.front + .5), w.front + .45, .9)
  for (const side of [-1, 1]) s.bowlFire(gx + side * 1.5, F + 1.7, w.front + .25, .4)
  s.span('stone', -3.6, F + c.rear.top, -3.3, -2.9, F + c.rear.top + 1.9, -2.6, PALETTE.ashlar)
}
