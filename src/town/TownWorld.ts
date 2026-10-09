import { resolveTownEagleGarrison, TOWN_EAGLE_GARRISON_NAME, type TownEagleGarrisonLayout } from './TownEagleGarrison'
import { resolveTownEagleTrainingGround, type TownEagleTrainingGround } from './TownEagleTrainingGround'
import { XONGKORO_LANDING } from '../world/EagleLanding'
import { resolveTownHRLayout, type TownHRLayout } from './TownHRLayout'
import { createTownFortifications } from './TownFortifications'
import { TOWN_CITY_ROADS, TOWN_CAVALRY_FIELD, TOWN_PLAZA, TOWN_PLAZA_CENTER, townSceneryExcluded, type TownRoad } from './TownLayout'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createCampfireVisual, createPineVisual } from '../world/EnvironmentVisuals'
import { Faction } from '../combat/CombatFaction'
import { WeaponMeshFactory } from '../world/WeaponMeshFactory'
import { TOWN_SITES, townSitePoint } from './TownRules'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { getTerrainHeight, setScenePlayableWorldBound, type ObstacleData } from '../world/Terrain'
import { TOWN_PLAYABLE_WORLD_BOUND, TOWN_GROUND_SIZE, TOWN_BANDIT_CAMP_CENTERS, townSceneryPoint, nearTownBanditCamp } from './TownBounds'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { proceduralMaterial } from '../world/ProceduralMaterials'
export class TownWorld {
  readonly root = new THREE.Group()
  readonly roads: TownRoad[] = []
  readonly hr: TownHRLayout
  readonly eagleGarrison: TownEagleGarrisonLayout
  readonly eagleTraining: TownEagleTrainingGround
  readonly terrainMesh: THREE.Mesh
  readonly obstacles: ObstacleData[] = []
  readonly camps: { faction: Faction; capacity: number; spawnPoints: THREE.Vector3[] }[] = []
  readonly targets: THREE.Vector3[] = []
  readonly fortifications: ReturnType<typeof createTownFortifications>
  get gates() { return this.fortifications.gates }
  readonly buildings: { id: string; ownerFaction: Faction; campId?: number; obstacles: ObstacleData[]; hp: DamageableObstacle; roof: THREE.Group; ruin: THREE.Group; damaged: boolean }[] = []
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
  constructor(readonly faction: CharacterFaction, scene: THREE.Scene, private readonly ownerAllegiance: Faction = Faction.TOWN) {
    setScenePlayableWorldBound(scene, TOWN_PLAYABLE_WORLD_BOUND)
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
    this.road(-57, 0, 85, 0, 8); this.road(0, -23, 0, 36, 12); this.road(25, -50, 25, 30, 7)
    this.road(-35, -18, -27, 32, 6); this.road(0, 10, 0, 30, 12); this.road(-25, 20, 10, 20, 8); this.road(-22, -10, 0, -10, 7)
    for (let z = TOWN_PLAZA.minZ; z <= TOWN_PLAZA.maxZ; z += 2) this.road(TOWN_PLAZA.minX, z, TOWN_PLAZA.maxX, z, 2.1)
    this.building('hall', '', faction === 'roman' ? 0 : -3, -34, faction === 'roman' ? 18 : 14, faction === 'roman' ? 14 : 24, 6, 'hall')
    this.building('weapons', '武器店 · ARMOURY', TOWN_SITES.weapons.x, TOWN_SITES.weapons.z, 11, 10, 3.6, 'shop', TOWN_SITES.weapons.yaw)
    this.building('stable', '馬廄 · STABLE', TOWN_SITES.stable.x, TOWN_SITES.stable.z, 14, 11, 3.7, 'stable', TOWN_SITES.stable.yaw)
    for (let i = 0; i < 5; i++) this.building('home-' + i, '住宅', i > 2 ? (i === 3 ? -54 : -12) : -52, i > 2 ? 52 : -28 + i * 23, 9, faction === 'roman' ? 8 : 12, 3.4, 'home')
    this.trainingEntrance()
    for (const road of TOWN_CITY_ROADS) this.road(road.ax, road.az, road.bx, road.bz, road.width)
    this.cavalryTrainingGround()
    this.fortifications = createTownFortifications(faction, this.obstacles, { stone: this.stone, wood: this.wood, dark: this.dark, snow: this.snow })
    this.root.add(this.fortifications.root); this.trackOwned(this.fortifications.root)
    this.batch(this.fortifications.wallRoot)
    for (const child of this.fortifications.wallRoot.children) if (child instanceof THREE.Group) this.batch(child)
    this.building('barracks', '', 34, 30, 7, 7, 3, 'home', TOWN_SITES.barracks.yaw)
    this.road(10, 20, 33, 16, 5)
    for (const [x, z] of [[43, -41, '近戰步兵'], [70, -41, '遠程步兵'], [43, 2, '遠程步兵'], [70, 2, '近戰步兵']] as const) {
      for (let row = 0; row < (z < -10 ? 2 : 4); row++) this.road(x - 11, z + 3 + row * 7, x + 11, z + 3 + row * 7, 5)
      for (let i = 0; i < 2; i++) this.building('tent-' + x + '-' + z + '-' + i, '', x - 6 + i * 11, z - 9, 7, 6, 2.6, 'tent')
    }
    // Separate six-metre rails with four-metre passages, leaving the cavalry entrance clear.
    for (let i = 0; i < 8; i++) {
      const x = 86, z = -48 + i * 10, y = getTerrainHeight(x, z)
      this.solid(x, z, .5, 1.4, 6)
      this.cube(this.root, x, y + .7, z, .2, 1.4, .2, this.wood); this.cube(this.root, x, y + 1, z, .18, .18, 6, this.wood)
      if (faction === 'viking') this.cube(this.root, x, y + 1.15, z, .24, .12, 6, this.snow)
    }
    for (const [x, z] of [[-12, 24], [11, 23], [-18, -19]]) {
      const y = getTerrainHeight(x, z)
      this.solid(x, z, 3.5, 1, 1.5)
      for (const dx of [-1.7, 1.7]) this.cube(this.root, x + dx, y + 1.25, z, .12, 2.5, .12, this.wood)
      this.cube(this.root, x, y + 2.5, z, 4, .15, 2.7, this.canvas); this.cube(this.root, x, y + .8, z, 3.5, .2, 1.5, this.wood)
    }
    for (const [x, z] of [[-10, -19], [10, -19], [20, 30], [-22, 22]]) this.campfire(x, z)
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
        this.building('camp-' + cx + '-' + i, '', x, z, 5, 5, 2.4, 'tent', angle + Math.PI, campId)
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
      if (townSceneryExcluded(x, z, 7) || nearTownBanditCamp(x, z, 26)) continue
      if (this.camps.some(c => c.spawnPoints.some(p => Math.hypot(p.x - x, p.z - z) < 18))) continue
      const copy = tree.clone(true), scale = .8 + i % 5 * .13
      copy.position.set(x, getTerrainHeight(x, z), z); copy.scale.setScalar(scale); copy.rotation.y = angle
      this.root.add(copy); this.solid(x, z, .6, 5, .6)
    }
    this.hr = resolveTownHRLayout(faction, this.obstacles, this.roads)
    this.building('hr-center', '人力資源中心', this.hr.site.x, this.hr.site.z, this.hr.width, this.hr.depth, 5.5, 'hall', this.hr.site.yaw)
    const hrRoot = this.buildings.find(building => building.id === 'hr-center')!.hp.root as THREE.Group
    this.sign(hrRoot, 'HR CENTER', 0, 6.5, this.hr.depth / 2 + .5, 9)
    this.eagleTraining = resolveTownEagleTrainingGround(this.obstacles, this.roads, this.hr)
    this.eagleGarrison = resolveTownEagleGarrison(this.eagleTraining)
    this.eagleTrainingGround()
    this.batch(this.root)
  }

  private eagleTrainingGround(): void {
    const { trainer } = this.eagleTraining
    // Leave the first landing pad and the nearby diagonal road clear after turning the frame.
    const x = trainer.x - 4.5, z = trainer.z + 3.5
    const yaw = Math.atan2(TOWN_PLAZA_CENTER.x - x, TOWN_PLAZA_CENTER.z - z)
    // Clear the 2.3m on-foot NPC body (and 1.9m Player) with a little headroom.
    this.groundedTrainingSign(['XONGKORO TRAINING', '老鷹訓練場 · E 交談'], x, z, 12, yaw, 2.6)
    // Corner stakes identify the existing terrain; no extra floor or walk-through platform.
    for (const site of [...this.eagleTraining.pads, ...this.eagleGarrison.pads]) for (const dx of [-XONGKORO_LANDING.width / 2, XONGKORO_LANDING.width / 2]) {
      for (const dz of [-XONGKORO_LANDING.depth / 2, XONGKORO_LANDING.depth / 2]) {
        const x = site.x + dx, z = site.z + dz
        this.cube(this.root, x, getTerrainHeight(x, z) + .2, z, .3, .4, .3, this.stone)
      }
    }
    const garrison = this.eagleGarrison.pads[0]
    this.groundedTrainingSign(TOWN_EAGLE_GARRISON_NAME.split(' · '), garrison.x, garrison.z - 10, 12)
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
  private trackOwned(root: THREE.Object3D): void {
    root.traverse(o => { if (o instanceof THREE.Mesh) { this.geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.name.startsWith('procedural-')) this.materials.add(m) } })
  }
  private campfire(x: number, z: number): void {
    const fire = createCampfireVisual(Math.round(x * 73 + z * 31)); fire.position.set(x, getTerrainHeight(x, z), z)
    this.trackOwned(fire); this.root.add(fire); this.solid(x, z, 1.2, .55, 1.2)
  }
  private trainingEntrance(): void {
    const center = townSitePoint('barracks', 0, 4), root = new THREE.Group()
    root.position.set(center.x, getTerrainHeight(center.x, center.z), center.z); root.rotation.y = center.yaw; this.root.add(root)
    for (const side of [-1, 1]) {
      this.cube(root, side * 8, 1.7, 0, .35, 3.4, .35, this.wood)
      const point = townSitePoint('barracks', side * 8, 4); this.solid(point.x, point.z, .4, 3.4, .4)
    }
    this.cube(root, 0, 3.3, 0, 16.5, .35, .45, this.dark)
    this.sign(root, 'INFANTRY TRAINING', 0, 2.9, .3, 10)
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      const point = townSitePoint('barracks', side * (10 + i * 2), 4), y = getTerrainHeight(point.x, point.z)
      this.cube(this.root, point.x, y + .7, point.z, .2, 1.4, .2, this.wood)
      this.cube(this.root, point.x, y + 1, point.z, .18, .16, 2.2, this.wood); this.solid(point.x, point.z, .25, 1.3, 2.2)
    }
    this.batch(root)
  }
  private cavalryTrainingGround(): void {
    const field = TOWN_CAVALRY_FIELD
    // Use the shared terrain directly for the training field. The old visual
    // lane meshes added no gameplay collision or mission semantics and could
    // cut through actors on the undulating terrain.
    for (const x of [35, 70, 105]) {
      this.building(`cavalry-tent-${x}`, '', x + 12, -106, 8, 5, 3, 'tent')
      this.groundedTrainingSign([x === 35 ? this.faction === 'viking' ? 'AXE CAVALRY' : 'MELEE CAVALRY' : x === 70 ? 'LANCERS' : 'HORSE ARCHERS'], x + 12, -101, 10)
    }
    // Wide south-facing entrance connects to the internal mounted road.
    const entrance = new THREE.Group(); entrance.position.set((field.minX + field.maxX) / 2, getTerrainHeight(82, -53), -53)
    this.root.add(entrance); this.sign(entrance, 'CAVALRY TRAINING', 0, 4.2, 0, 12)
    for (const side of [-1, 1]) {
      this.cube(entrance, side * 8, 2.2, 0, .25, 4.4, .25, this.wood)
      this.solid(82 + side * 8, -53, .25, 4.4, .25)
    }
    this.batch(entrance)
  }
  /** The cavalry-style timber board shares one level top; each post reaches its own terrain sample. */
  private groundedTrainingSign(lines: readonly string[], x: number, z: number, width: number, yaw = 0, minimumHeadroom = 0): void {
    const root = new THREE.Group(), ground = getTerrainHeight(x, z)
    root.position.set(x, ground, z); root.rotation.y = yaw; this.root.add(root)
    const halfWidth = width / 2, cos = Math.cos(yaw), sin = Math.sin(yaw)
    const point = (side: number, front = 0) => ({ x: x + cos * side + sin * front, z: z - sin * side + cos * front })
    const posts = [-1, 1].map(side => {
      const position = point(side * halfWidth)
      return { side, ...position, ground: getTerrainHeight(position.x, position.z) }
    })
    const collisionSpan = .25 * (Math.abs(cos) + Math.abs(sin))
    let top = Math.max(ground, ...posts.map(post => post.ground)) + 3.6
    if (minimumHeadroom > 0) {
      // Include the front-mounted board and a walking body's depth, not just its two feet.
      let passageGround = ground
      for (let side = -halfWidth; side <= halfWidth; side += .5) for (const front of [-.6, 0, .3, .9]) {
        const sample = point(side, front)
        passageGround = Math.max(passageGround, getTerrainHeight(sample.x, sample.z))
      }
      top = Math.max(top, passageGround + minimumHeadroom + .6 + (width / 6.4 + .15) / 2)
    }
    for (const post of posts) {
      const { side, ground: postGround } = post, height = top - postGround
      this.cube(root, side * halfWidth, postGround - ground + height / 2, 0, .2, height, .2, this.wood)
      this.solid(post.x, post.z, collisionSpan, height, collisionSpan)
    }
    this.cube(root, 0, top - ground - .2, 0, width + .4, .2, .25, this.wood)
    // The label faces local +Z; mount its .16m backing against the timber's front face.
    this.sign(root, lines.join('\n'), 0, top - ground - .6, .25 / 2 + .16, width, false)
    this.batch(root)
  }
  private medievalFrame(root: THREE.Group, w: number, d: number, h: number, roman: boolean): void {
    for (const side of [-1, 1]) {
      for (let xx = -w / 2; xx <= w / 2; xx += w / Math.ceil(w / 3)) {
        this.cube(root, xx, h / 2, side * (d / 2 + .13), .2, h, .25, this.dark)
        if (roman && xx + 2.7 < w / 2) { const brace = this.cube(root, xx + 1.3, h * .52, side * (d / 2 + .15), .14, Math.hypot(2.5, h * .6), .18, this.dark); brace.rotation.z = -.55 }
      }
      for (const y of [.7, h * .5, h]) this.cube(root, 0, y, side * (d / 2 + .14), w, .2, .26, this.dark)
      if (!roman) for (let y = .5; y < h; y += .32) this.cube(root, side * (w / 2 + .08), y, 0, .2, .15, d + .5, this.wood)
      else for (let zz = -d / 2; zz <= d / 2; zz += 2.5) this.cube(root, side * (w / 2 + .08), h / 2, zz, .22, h, .2, this.dark)
    }
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
  private building(id: string, _name: string, x: number, z: number, w: number, d: number, h: number, kind: string, yaw = 0, campId?: number): void {
    const y = getTerrainHeight(x, z), root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = yaw; this.root.add(root)
    const attachments: THREE.Box3[] = []
    const tent = kind === 'tent', stable = kind === 'stable', roman = this.faction === 'roman'
    const lowGround = Math.min(...[-1, 1].flatMap(sx => [-1, 1].map(sz => getTerrainHeight(x + Math.cos(yaw) * sx * w / 2 + Math.sin(yaw) * sz * d / 2, z - Math.sin(yaw) * sx * w / 2 + Math.cos(yaw) * sz * d / 2))))
    const foundationDepth = Math.max(.5, y - lowGround + .6)
    this.cube(root, 0, .5 - foundationDepth / 2, 0, w + .7, foundationDepth, d + .7, this.stone)
    if (!tent) {
      if (stable) {
        // Open-front five-stall stable, with a real roof and visible horses inside.
        this.cube(root, 0, h / 2, -d / 2, w, h, .3, this.wood)
        for (const side of [-1, 1]) this.cube(root, side * w / 2, h / 2, 0, .3, h, d, this.wood)
        for (let i = 0; i < 6; i++) {
          const xx = -6.5 + i * 2.6
          this.cube(root, xx, 1.05, .2, .14, 1.5, 7.3, this.wood)
          this.cube(root, xx, h / 2, d / 2, .22, h, .22, this.dark)
        }
        for (let i = 0; i < 5; i++) {
          const xx = -5.2 + i * 2.6
          this.cube(root, xx, .75, 4.5, 2.2, .55, .65, this.wood)
          this.cube(root, xx, 1.05, 4.5, 1.95, .15, .45, this.canvas)
        }
      } else this.cube(root, 0, h / 2, 0, w, h, d, roman ? this.plaster : this.wood)
      if (!stable) for (const dx of kind === 'hall' && roman ? [-7, 0, 7] : [0]) { this.cube(root, dx, 1.25, d / 2 + .03, 1.65, 2.5, .15, this.dark); this.cube(root, dx, 2.6, d / 2 + .15, 2, .18, .3, this.wood) }
      if (!stable) for (let xx = -w / 2 + 1.5; xx < w / 2; xx += 3) {
        if (Math.abs(xx) > 1.5) this.cube(root, xx, h * .65, d / 2 + .06, .85, .85, .12, this.dark)
        if (!roman) this.cube(root, xx, h / 2, d / 2 + .13, .22, h, .28, this.dark)
      }
      this.medievalFrame(root, w, d, h, roman)
      this.cube(root, w * .3, h + 1.5, -d * .2, 1.3, 4, 1.3, this.stone)
      this.cube(root, w * .3, h + 3.55, -d * .2, 1.7, .3, 1.7, this.dark)
    }
    const roof = new THREE.Group(); roof.position.y = tent ? .2 : h; root.add(roof)
    const rise = tent ? h : kind === 'hall' ? 5 : roman ? 3.4 : 3.6, slope = Math.atan2(rise, w / 2), span = Math.hypot(rise, w / 2)
    for (const side of [-1, 1]) {
      const panel = this.cube(roof, side * w / 4, rise / 2, 0, span + .6, .22, d + (roman && kind === 'hall' ? 5 : 1), tent ? this.canvas : this.roofMat); panel.rotation.z = -side * slope
      if (!roman) { const cap = panel.clone(); cap.material = this.snow; cap.position.y += .17; cap.scale.y = .16; roof.add(cap) }
    }
    if (!tent) {
      this.cube(roof, 0, rise + .12, 0, .24, .24, d + 1.6, this.dark)
      for (const side of [-1, 1]) {
        for (let zz = -d / 2; zz <= d / 2; zz += 1.1) {
          const rafter = this.cube(roof, side * w / 4, rise / 2 + .18, zz, span + .7, .12, .09, roman ? this.dark : this.canvas)
          rafter.rotation.z = -side * slope
        }
        for (const zz of [-d / 2 - .55, d / 2 + .55]) {
          const bar = this.cube(roof, side * w / 4, rise / 2 + .22, zz, span + (roman ? .6 : 1.6), .22, .22, this.dark)
          bar.rotation.z = -side * slope
        }
      }
      const facade = this.geo(new THREE.BufferGeometry())
      facade.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, d / 2, w / 2, 0, d / 2, 0, rise, d / 2, w / 2, 0, -d / 2, -w / 2, 0, -d / 2, 0, rise, -d / 2], 3)); facade.computeVertexNormals()
      roof.add(new THREE.Mesh(facade, roman ? this.plaster : this.wood))
      if (!stable) for (let xx = -w / 2; xx <= w / 2; xx += 1.6) this.cube(root, xx, .65, d / 2 + .09, 1.4, .45, .15, roman ? this.stone : this.dark)
    }
    if (['shop', 'stable', 'barracks'].includes(kind)) {
      const porchWidth = kind === 'barracks' ? 18 : w + 1
      const porchDepth = kind === 'barracks' ? 5 : 4.2
      this.cube(root, 0, h - .15, d / 2 + porchDepth / 2, porchWidth, .22, porchDepth, this.roofMat)
      if (!roman) this.cube(root, 0, h + .02, d / 2 + porchDepth / 2, porchWidth, .15, porchDepth, this.snow)
      for (const side of [-1, 1]) {
        const xx = side * (porchWidth / 2 - .25), zz = d / 2 + porchDepth - .2
        this.cube(root, xx, h / 2, zz, .22, h, .22, this.wood)
        attachments.push(new THREE.Box3(new THREE.Vector3(xx - .14, -100, zz - .14), new THREE.Vector3(xx + .14, h, zz + .14)))
      }
      this.sign(root, kind === 'shop' ? 'WEAPON SHOP' : stable ? 'HORSE SHOP' : 'BARRACKS', 0, kind === 'barracks' ? h - .3 : h + 1.05, kind === 'barracks' ? d / 2 + porchDepth + .15 : d / 2 + .25, stable || kind === 'barracks' ? 7 : 6)
      if (kind === 'shop') {
        this.weaponDisplay(root, d / 2)
        for (const side of [-1, 1]) attachments.push(new THREE.Box3(new THREE.Vector3(side * 3.8 - 1.3, -100, d / 2 + 1.5), new THREE.Vector3(side * 3.8 + 1.3, 1.15, d / 2 + 2.9)))
      }
    }
    const ruin = new THREE.Group(); ruin.position.copy(root.position); ruin.rotation.y = yaw; ruin.visible = false; this.root.add(ruin)
    for (let i = 0; i < 9; i++) { const chunk = this.cube(ruin, Math.sin(i * 8) * w * .35, .25 + i % 2 * .15, Math.cos(i * 4) * d * .3, 2.2, .4, .7, roman && !tent ? this.stone : this.wood); chunk.rotation.y = i * 1.7 }
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: kind === 'hall' ? 900 : tent ? 120 : 300, root })
    this.batch(root); this.batch(roof); this.batch(ruin)
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-w / 2 - .2, -100, -d / 2 - .2), new THREE.Vector3(w / 2 + .2, h + 3, d / 2 + .2)).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).translate(root.position), isBarricade: false, damageable: hp }
    const buildingObstacles = [obstacle, ...attachments.map(box => ({ box: box.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).translate(root.position), isBarricade: false, damageable: hp }))]
    this.buildings.push({ id, ownerFaction: id.startsWith('camp-') ? Faction.BANDIT : this.ownerAllegiance, ...(campId === undefined ? {} : { campId }), obstacles: buildingObstacles, hp, roof, ruin, damaged: false }); this.obstacles.push(...buildingObstacles)
    hp.onDestroyed(() => { ruin.visible = true; for (const part of buildingObstacles) { const index = this.obstacles.indexOf(part); if (index >= 0) this.obstacles.splice(index, 1) } })
  }
  refreshDamage(): void { for (const b of this.buildings) if (!b.damaged && b.hp.hpRatio <= .6 && !b.hp.destroyed) { b.damaged = true; b.roof.rotation.z = .14; b.roof.position.y -= 1; b.roof.children.slice(0, 2).forEach(c => c.visible = false) } }
  restoreTownDamage(): void {
    for (const building of this.buildings) {
      if (building.ownerFaction !== Faction.TOWN) continue
      building.hp.restore()
      building.ruin.visible = false
      if (building.damaged) {
        building.roof.rotation.z = 0
        building.roof.position.y += 1
        building.roof.children.slice(0, 2).forEach(child => { child.visible = true })
      }
      building.damaged = false
      for (const obstacle of building.obstacles) if (!this.obstacles.includes(obstacle)) this.obstacles.push(obstacle)
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
  private textTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#34281e'; ctx.fillRect(0, 0, 1024, 160)
    for (let y = 8; y < 160; y += 8) { ctx.strokeStyle = y % 16 ? '#4b3825' : '#291d13'; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(300, y - 4, 650, y + 5, 1024, y); ctx.stroke() }
    ctx.strokeStyle = '#917044'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 1008, 144)
    for (const x of [28, 996]) for (const y of [28, 132]) { ctx.fillStyle = '#201b17'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill() }
    const lines = text.split('\n')
    ctx.fillStyle = '#f3dfab'; ctx.font = `bold ${lines.length > 1 ? 48 : 78}px Georgia, serif`; ctx.textAlign = 'center'
    lines.forEach((line, index) => ctx.fillText(line, 512, lines.length > 1 ? 65 + index * 62 : 112, 940))
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; this.textures.add(map); return map
  }
  private sign(parent: THREE.Object3D, text: string, x: number, y: number, z: number, width: number, hanging = true): void {
    this.cube(parent, x, y, z - .08, width + .18, width / 6.4 + .15, .16, this.dark)
    if (hanging) for (const side of [-1, 1]) this.cube(parent, x + side * width * .36, y + width / 10, z - .08, .06, .7, .06, this.dark)
    const material = new THREE.MeshBasicMaterial({ map: this.textTexture(text) }); this.materials.add(material)
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(width, width / 6.4)), material)
    sign.name = 'town-shop-sign'; sign.position.set(x, y, z + .02); parent.add(sign)
  }
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
  private weaponDisplay(root: THREE.Group, front: number): void {
    // All display pieces use the real equipment factories, outside the player's path.
    const templates = new Map<string, THREE.Group>()
    const item = (id: string, kind: 'melee' | 'ranged' | 'shield', x: number, y: number, z: number, tilt = 0) => {
      let template = templates.get(id)
      if (!template) {
        template = new THREE.Group()
        if (kind === 'melee') WeaponMeshFactory.buildMelee(id, template)
        else if (kind === 'ranged') WeaponMeshFactory.buildRanged(id, template, true)
        else WeaponMeshFactory.buildShield(id, template)
        template.traverse(o => { if (o instanceof THREE.Mesh) this.geometries.add(o.geometry) })
        templates.set(id, template)
      }
      const display = template.clone(true); display.name = 'shop-display-' + id; display.position.set(x, y, z); display.rotation.z = tilt; root.add(display)
    }
    for (const side of [-1, 1]) {
      const x = side * 3.8
      this.cube(root, x, 1, front + 2.2, 2.6, .18, 1.3, this.wood)
      for (const dx of [-1.1, 1.1]) this.cube(root, x + dx, .5, front + 2.2, .15, 1, 1.1, this.wood)
      this.cube(root, x, 1.4, front + .45, 2.8, .16, .2, this.wood)
      for (let i = 0; i < 5; i++) item(['gladius_rusty', 'gladius_standard', 'centurion_blade', 'steel_sword', 'viking_axe_t2'][i], 'melee', x - 1 + i * .48, 1.05, front + 2.2, -.15 + i * .07)
      for (let i = 0; i < 3; i++) item(i % 2 ? 'steel_lance' : 'hunting_spear', 'melee', x - .8 + i * .8, .65, front + .4, side * .1)
      item(side < 0 ? 'scutum_t2' : 'round_shield_t2', 'shield', side * 2.5, 1.65, front + .2)
      item(side < 0 ? 'recurve_longbow' : 'wooden_shortbow', 'ranged', side * 4.5, 2, front + .4, side * .3)
    }
  }
  dispose(): void { this.root.traverse(child => { if (child instanceof THREE.InstancedMesh) child.dispose() }); this.root.removeFromParent(); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()) }
}
