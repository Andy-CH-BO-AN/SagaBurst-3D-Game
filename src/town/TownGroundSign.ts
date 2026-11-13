import * as THREE from 'three'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { architectureLocalToWorld } from './architecture/ArchitectureSpecs'
import { TOWN_EAGLE_GARRISON_NAME } from './TownEagleGarrison'
import { TOWN_EAGLE_STATION_SITES } from './TownLayout'

/** A two-post ground sign; `headroom` keeps a walk-through passage under its board. */
export interface TownGroundSignSpec {
  readonly id: string
  readonly lines: readonly string[]
  readonly x: number
  readonly z: number
  readonly width: number
  readonly yaw: number
  readonly headroom: number
}

/** Eagle-field signs stand in front of their supply posts, in the same frame as the stations. */
export function townEagleSigns(): TownGroundSignSpec[] {
  const [training, garrison] = TOWN_EAGLE_STATION_SITES
  const front = (site: { x: number; z: number; yaw: number }, distance: number) => architectureLocalToWorld(site, 0, distance)
  return [
    // Visitors walk under this board to the trainer at the station opening.
    { id: 'eagle-training', lines: ['XONGKORO TRAINING', '老鷹訓練場 · E 交談'], ...front(training, 5), width: 10, yaw: training.yaw, headroom: 2.6 },
    { id: 'eagle-garrison', lines: TOWN_EAGLE_GARRISON_NAME.split(' · '), ...front(garrison, 4.5), width: 12, yaw: garrison.yaw, headroom: 0 },
  ]
}

/** Board texture shared by Town shop and ground signs. */
export function townSignTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#34281e'; ctx.fillRect(0, 0, 1024, 160)
  for (let y = 8; y < 160; y += 8) { ctx.strokeStyle = y % 16 ? '#4b3825' : '#291d13'; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(300, y - 4, 650, y + 5, 1024, y); ctx.stroke() }
  ctx.strokeStyle = '#917044'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 1008, 144)
  for (const x of [28, 996]) for (const y of [28, 132]) { ctx.fillStyle = '#201b17'; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill() }
  const lines = text.split('\n')
  ctx.fillStyle = '#f3dfab'; ctx.font = `bold ${lines.length > 1 ? 48 : 78}px Georgia, serif`; ctx.textAlign = 'center'
  lines.forEach((line, index) => ctx.fillText(line, 512, lines.length > 1 ? 65 + index * 62 : 112, 940))
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace
  return map
}

export interface TownGroundSignResources {
  readonly box: THREE.BufferGeometry
  readonly wood: THREE.Material
  readonly dark: THREE.Material
  /** Records the sign's own plane geometry, text material and texture for disposal. */
  own(resource: THREE.BufferGeometry | THREE.Material | THREE.Texture): void
}

/**
 * Posts follow the terrain; the board rises to clear `headroom` over the whole
 * walk-through span. Returns the post colliders and the visual bounds for airspace.
 */
export function buildTownGroundSign(spec: TownGroundSignSpec, resources: TownGroundSignResources,
  terrain: (x: number, z: number) => number = getTerrainHeight): { root: THREE.Group; obstacles: ObstacleData[]; airspace: THREE.Box3 } {
  const { x, z, width, yaw } = spec
  const root = new THREE.Group(), ground = terrain(x, z)
  root.name = `town-ground-sign:${spec.id}`
  root.position.set(x, ground, z); root.rotation.y = yaw
  const cube = (cx: number, cy: number, cz: number, w: number, h: number, d: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(resources.box, material); mesh.position.set(cx, cy, cz); mesh.scale.set(w, h, d)
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh)
  }
  const halfWidth = width / 2, cos = Math.cos(yaw), sin = Math.sin(yaw)
  const point = (side: number, front = 0) => ({ x: x + cos * side + sin * front, z: z - sin * side + cos * front })
  const posts = [-1, 1].map(side => { const position = point(side * halfWidth); return { side, ...position, ground: terrain(position.x, position.z) } })
  const collisionSpan = .25 * (Math.abs(cos) + Math.abs(sin))
  let top = Math.max(ground, ...posts.map(post => post.ground)) + 3.6
  if (spec.headroom > 0) {
    // Include the front-mounted board and a walking body's depth, not just its two feet.
    let passageGround = ground
    for (let side = -halfWidth; side <= halfWidth; side += .5) for (const front of [-.6, 0, .3, .9]) {
      const sample = point(side, front)
      passageGround = Math.max(passageGround, terrain(sample.x, sample.z))
    }
    top = Math.max(top, passageGround + spec.headroom + .6 + (width / 6.4 + .15) / 2)
  }
  const obstacles: ObstacleData[] = []
  for (const post of posts) {
    const height = top - post.ground
    cube(post.side * halfWidth, post.ground - ground + height / 2, 0, .2, height, .2, resources.wood)
    obstacles.push({ box: new THREE.Box3(new THREE.Vector3(post.x - collisionSpan / 2, post.ground - 2, post.z - collisionSpan / 2),
      new THREE.Vector3(post.x + collisionSpan / 2, post.ground + height, post.z + collisionSpan / 2)), isBarricade: false })
  }
  cube(0, top - ground - .2, 0, width + .4, .2, .25, resources.wood)
  // The label faces local +Z; mount its .16m backing against the timber's front face.
  const boardY = top - ground - .6, boardZ = .25 / 2 + .16
  cube(0, boardY, boardZ - .08, width + .18, width / 6.4 + .15, .16, resources.dark)
  const texture = townSignTexture(spec.lines.join('\n')), material = new THREE.MeshBasicMaterial({ map: texture })
  const plane = new THREE.PlaneGeometry(width, width / 6.4)
  resources.own(texture); resources.own(material); resources.own(plane)
  const board = new THREE.Mesh(plane, material); board.name = 'town-shop-sign'; board.position.set(0, boardY, boardZ + .02); root.add(board)
  root.updateMatrixWorld(true)
  return { root, obstacles, airspace: new THREE.Box3().setFromObject(root) }
}
