import * as THREE from 'three'
import { DamageableObstacle } from '../world/DamageableObstacle'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { proceduralMaterial } from '../world/ProceduralMaterials'
export class TownWorld {
  readonly root = new THREE.Group()
  readonly obstacles: ObstacleData[] = []
  readonly targets: THREE.Vector3[] = []
  readonly buildings: { id: string; hp: DamageableObstacle; roof: THREE.Group; damaged: boolean }[] = []
  private readonly geometries = new Set<THREE.BufferGeometry>()
  private readonly materials = new Set<THREE.Material>()
  private readonly textures = new Set<THREE.Texture>()
  private readonly box = this.geo(new THREE.BoxGeometry(1, 1, 1))
  private readonly wood = proceduralMaterial({ kind: 'wood', color: 0x74543b, roughness: .92 })
  private readonly dark = this.mat(0x423329)
  private readonly stone = this.mat(0x9d9481)
  private readonly plaster = this.mat(0xd9c6a5)
  private readonly roofMat = this.mat(this.faction === 'roman' ? 0x9f4f35 : 0x55574a)
  private readonly snow = this.mat(0xd8e3ea)
  private readonly canvas = this.mat(0xa89471)
  constructor(readonly faction: CharacterFaction, scene: THREE.Scene) {
    scene.add(this.root)
    scene.background = new THREE.Color(faction === 'roman' ? 0xb8ccd1 : 0x8d9ea9)
    scene.fog = new THREE.Fog(scene.background, 120, 290)
    scene.add(new THREE.HemisphereLight(faction === 'roman' ? 0xfff1d8 : 0xc5d6ef, 0x66614d, 2.4))
    const sun = new THREE.DirectionalLight(0xffecd0, 2.4); sun.position.set(-40, 75, 30); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 90, bottom: -90, far: 180 }); sun.shadow.bias = -.002; scene.add(sun)
    const g = this.geo(new THREE.PlaneGeometry(360, 360, 160, 160)); g.rotateX(-Math.PI / 2)
    const p = g.attributes.position, colors = []
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); p.setY(i, getTerrainHeight(x, z))
      const n = Math.sin(x * .4) * Math.cos(z * .29) + Math.sin(z * .7) * .3
      const c = new THREE.Color(faction === 'roman' ? (n > -.4 ? 0x6d7650 : 0x858061) : (n > -.8 ? 0xd4dee2 : 0x9ba19b)); colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals()
    const ground = this.mat(0xffffff); ground.vertexColors = true; const land = new THREE.Mesh(g, ground); land.receiveShadow = true; this.root.add(land)
    this.road(-57, 0, 85, 0, 8); this.road(0, -23, 0, 36, 12); this.road(25, -50, 25, 30, 7)
    this.road(-35, -18, -27, 26, 6)
    for (let z = -10; z <= 10; z += 2) this.road(-17, z, 18, z, 2.1)
    this.building('hall', faction === 'roman' ? 'FORUM · 市鎮中心' : '首領長屋 · GREAT HALL', faction === 'roman' ? 0 : -3, -34, faction === 'roman' ? 23 : 14, faction === 'roman' ? 13 : 24, 7, 'hall')
    this.building('weapons', '武器店 · ARMOURY', -29, -10, 11, 10, 3.6, 'shop')
    this.building('stable', '馬廄 · STABLE', -34, 20, 14, 11, 3.7, 'stable')
    for (let i = 0; i < 5; i++) this.building('home-' + i, '住宅', -52 + (i > 2 ? (i - 2) * 19 : 0), i > 2 ? 39 : -28 + i * 23, 9, faction === 'roman' ? 8 : 12, 3.4, 'home')
    this.building('barracks', '兵營 · BARRACKS', 53, 39, 24, 10, 4.5, 'barracks')
    for (const [x, z, name] of [[43, -41, '近戰騎兵'], [70, -41, '弓騎兵'], [43, -6, '遠程步兵'], [70, -6, '近戰步兵']] as const) {
      this.label(this.root, name, x, getTerrainHeight(x, z) + 4, z)
      for (let row = 0; row < (z < -10 ? 2 : 4); row++) this.road(x - 11, z + 3 + row * 7, x + 11, z + 3 + row * 7, 5)
      for (let i = 0; i < 2; i++) this.building('tent-' + x + '-' + z + '-' + i, '', x - 6 + i * 11, z - 9, 7, 6, 2.6, 'tent')
    }
    for (let i = 0; i < 12; i++) {
      const x = 86, z = -48 + i * 7, y = getTerrainHeight(x, z)
      this.cube(this.root, x, y + .7, z, .2, 1.4, .2, this.wood); this.cube(this.root, x, y + 1, z, .18, .18, 6, this.wood)
      if (faction === 'viking') this.cube(this.root, x, y + 1.15, z, .24, .12, 6, this.snow)
    }
    for (const [x, z] of [[-12, 24], [11, 23], [-18, -19]]) {
      const y = getTerrainHeight(x, z)
      for (const dx of [-1.7, 1.7]) this.cube(this.root, x + dx, y + 1.25, z, .12, 2.5, .12, this.wood)
      this.cube(this.root, x, y + 2.5, z, 4, .15, 2.7, this.canvas); this.cube(this.root, x, y + .8, z, 3.5, .2, 1.5, this.wood)
    }
    const glow = this.mat(0xffa34a); glow.emissive.setHex(0xff6900); glow.emissiveIntensity = 2
    for (const [x, z] of [[-10, -19], [10, -19], [25, 20], [-22, 22]]) {
      const y = getTerrainHeight(x, z); this.cube(this.root, x, y + .3, z, .8, .5, .8, this.stone); this.cube(this.root, x, y + .75, z, .35, .6, .35, glow)
    }
    const rockGeo = this.geo(new THREE.IcosahedronGeometry(1, 0))
    for (let i = 0; i < 36; i++) {
      const a = i * 2.399, x = Math.cos(a) * (105 + i % 5 * 8), z = Math.sin(a) * (82 + i % 7 * 5), y = getTerrainHeight(x, z)
      const rock = new THREE.Mesh(rockGeo, this.stone); rock.position.set(x, y, z); rock.scale.set(2, 1.5, 1.8); this.root.add(rock)
      if (faction === 'viking') this.cube(this.root, x, y + 1.2, z, 1.8, .18, 1.4, this.snow)
    }
  }
  private geo<T extends THREE.BufferGeometry>(g: T): T { this.geometries.add(g); return g }
  private mat(color: number): THREE.MeshStandardMaterial { const m = new THREE.MeshStandardMaterial({ color, roughness: .88 }); this.materials.add(m); return m }
  private cube(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.box, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  private road(ax: number, az: number, bx: number, bz: number, width: number): void {
    const vertices: number[] = [], length = Math.hypot(bx - ax, bz - az), count = Math.ceil(length / 2)
    const px = -(bz - az) / length * width / 2, pz = (bx - ax) / length * width / 2
    for (let i = 0; i < count; i++) {
      const corners = [i / count, (i + 1) / count].flatMap(t => { const bend = this.faction === 'viking' ? Math.sin(t * Math.PI) * 2 : 0; const x = ax + (bx - ax) * t + bend, z = az + (bz - az) * t; return [[x + px, z + pz], [x - px, z - pz]] })
      for (const k of [0, 2, 1, 1, 2, 3]) { const [x, z] = corners[k]; vertices.push(x, getTerrainHeight(x, z) + .045, z) }
    }
    const g = this.geo(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals()
    const m = this.mat(this.faction === 'roman' ? 0xa89d81 : 0xa3a8a3); m.side = THREE.DoubleSide; this.root.add(new THREE.Mesh(g, m))
  }
  private building(id: string, name: string, x: number, z: number, w: number, d: number, h: number, kind: string): void {
    const y = getTerrainHeight(x, z), root = new THREE.Group(); root.position.set(x, y, z); this.root.add(root)
    const tent = kind === 'tent', roman = this.faction === 'roman'
    this.cube(root, 0, .25, 0, w + .7, .5, d + .7, this.stone)
    if (!tent) {
      this.cube(root, 0, h / 2, 0, w, h, d, roman ? this.plaster : this.wood)
      for (const dx of kind === 'hall' && roman ? [-7, 0, 7] : [0]) { this.cube(root, dx, 1.25, d / 2 + .03, 1.65, 2.5, .15, this.dark); this.cube(root, dx, 2.6, d / 2 + .15, 2, .18, .3, this.wood) }
      for (let xx = -w / 2 + 1.5; xx < w / 2; xx += 3) {
        if (Math.abs(xx) > 1.5) this.cube(root, xx, h * .65, d / 2 + .06, .85, .85, .12, this.dark)
        if (!roman) this.cube(root, xx, h / 2, d / 2 + .13, .22, h, .28, this.dark)
      }
      if (roman && kind === 'hall') for (let xx = -10; xx <= 10; xx += 2.5) { this.cube(root, xx, h / 2, d / 2 + 2, .5, h, .5, this.stone); this.cube(root, xx, h - .2, d / 2 + 2, .8, .4, .8, this.stone) }
      if (kind === 'stable') for (let xx = -5; xx < 7; xx += 3) this.cube(root, xx, .75, d / 2 + 2, 2.6, 1.5, .18, this.wood)
    }
    const roof = new THREE.Group(); roof.position.y = tent ? .2 : h; root.add(roof)
    const rise = tent ? h : roman ? 2.2 : 3.6, slope = Math.atan2(rise, w / 2), span = Math.hypot(rise, w / 2)
    for (const side of [-1, 1]) {
      const panel = this.cube(roof, side * w / 4, rise / 2, 0, span + .6, .22, d + (roman && kind === 'hall' ? 5 : 1), tent ? this.canvas : this.roofMat); panel.rotation.z = -side * slope
      if (!roman) { const cap = panel.clone(); cap.material = this.snow; cap.position.y += .17; cap.scale.y = .16; roof.add(cap) }
    }
    if (!tent) {
      const facade = this.geo(new THREE.BufferGeometry())
      facade.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, d / 2, w / 2, 0, d / 2, 0, rise, d / 2, w / 2, 0, -d / 2, -w / 2, 0, -d / 2, 0, rise, -d / 2], 3)); facade.computeVertexNormals()
      roof.add(new THREE.Mesh(facade, roman ? this.plaster : this.wood))
      for (let xx = -w / 2; xx <= w / 2; xx += 1.6) this.cube(root, xx, .65, d / 2 + .09, 1.4, .45, .15, roman ? this.stone : this.dark)
    }
    if (name) this.label(root, name, 0, h + .5, d / 2 + 1)
    const ruin = new THREE.Group(); ruin.position.copy(root.position); ruin.visible = false; this.root.add(ruin)
    for (let i = 0; i < 9; i++) { const chunk = this.cube(ruin, Math.sin(i * 8) * w * .35, .25 + i % 2 * .15, Math.cos(i * 4) * d * .3, 2.2, .4, .7, roman && !tent ? this.stone : this.wood); chunk.rotation.y = i * 1.7 }
    const hp = new DamageableObstacle({ kind: 'tent', maxHp: kind === 'hall' ? 900 : tent ? 120 : 300, root })
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h + 3, z + d / 2)), isBarricade: false, damageable: hp }
    this.buildings.push({ id, hp, roof, damaged: false }); this.obstacles.push(obstacle)
    hp.onDestroyed(() => { ruin.visible = true; const index = this.obstacles.indexOf(obstacle); if (index >= 0) this.obstacles.splice(index, 1) })
  }
  refreshDamage(): void { for (const b of this.buildings) if (!b.damaged && b.hp.hpRatio <= .6 && !b.hp.destroyed) { b.damaged = true; b.roof.rotation.z = .14; b.roof.position.y -= 1; b.roof.children.slice(0, 2).forEach(c => c.visible = false) } }
  addTarget(x: number, z: number, ranged: boolean): THREE.Vector3 {
    const y = getTerrainHeight(x, z), target = new THREE.Vector3(x, y + 1.3, z)
    this.cube(this.root, x, y + .8, z, .15, 1.6, .15, this.wood)
    this.cube(this.root, x, y + 1.3, z, ranged ? .9 : .55, ranged ? .9 : .7, .18, this.canvas)
    this.cube(this.root, x, y + 1.3, z - .11, ranged ? .2 : 1.2, .16, .05, this.roofMat)
    this.targets.push(target); return target
  }
  label(parent: THREE.Object3D, text: string, x: number, y: number, z: number): void {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#251f19e8'; ctx.fillRect(0, 0, 512, 80); ctx.fillStyle = '#eedbb0'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 50)
    const map = new THREE.CanvasTexture(canvas); this.textures.add(map); const mat = new THREE.SpriteMaterial({ map }); this.materials.add(mat)
    const sprite = new THREE.Sprite(mat); sprite.position.set(x, y, z); sprite.scale.set(6, .94, 1); parent.add(sprite)
  }
  dispose(): void { this.root.removeFromParent(); this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()) }
}
