import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { proceduralMaterial } from './ProceduralMaterials'

/** Seeded decoration keeps reloads, previews and both mirrored camps consistent. */
export function environmentRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

export function timberMaterial(color = 0x75604a): THREE.MeshStandardMaterial {
  return proceduralMaterial({ kind: 'wood', color, roughness: 0.94, repeat: [2, 1] })
}

export function beamBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const direction = b.clone().sub(a)
  const geometry = new THREE.CylinderGeometry(radius * 0.82, radius, direction.length(), 7)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()))
  geometry.translate(...a.clone().add(b).multiplyScalar(0.5).toArray())
  return geometry
}

/** Static details are baked per material, keeping each damageable prop inexpensive. */
export function bakedMesh(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const geometry = mergeGeometries(parts, false)!
  parts.forEach(part => part.dispose())
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function createPineVisual(seed: number, snowy = false): THREE.Group {
  const random = environmentRandom(seed)
  const root = new THREE.Group()
  const wood: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.10, 0.34, 5.7, 9).translate(0, 2.85, 0)]
  const needles: THREE.BufferGeometry[] = []
  const addNeedles = (x: number, y: number, z: number, width: number, length: number, angle: number, level: number): void => {
    const spray = new THREE.IcosahedronGeometry(1, 1)
    const positions = spray.getAttribute('position')
    const colors: number[] = []
    const shade = new THREE.Color()
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i), py = positions.getY(i), pz = positions.getZ(i)
      const serration = 1 + Math.sin(px * 19 + pz * 13 + py * 7) * 0.22
      positions.setXYZ(i, px * serration, py * serration, pz * serration)
      shade.setHSL(0.29 + random() * 0.025, 0.28, 0.14 + level * 0.006 + (py + 1) * 0.018)
      if (snowy) {
        shade.lerp(new THREE.Color(0xe7eff3), THREE.MathUtils.smoothstep(py, -0.05, 0.5))
      }
      colors.push(shade.r, shade.g, shade.b)
    }
    spray.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    spray.scale(width, 0.20 + width * 0.26, length).rotateY(angle).translate(x, y, z)
    spray.computeVertexNormals()
    needles.push(spray)
  }
  for (let level = 0; level < 10; level++) {
    const y = 1.45 + level * 0.43 + random() * 0.16
    const radius = 1.82 * (1 - level / 10.8)
    addNeedles(0, y + 0.35, 0, radius * 0.38, radius * 0.4, level, level)
    for (let branch = 0; branch < 8; branch++) {
      if (branch > 0 && random() < 0.12) continue
      const angle = branch * Math.PI / 4 + level * 1.77 + random() * 0.15
      const reach = radius * (0.72 + random() * 0.36)
      const end = new THREE.Vector3(Math.sin(angle) * reach, y + 0.05, Math.cos(angle) * reach)
      wood.push(beamBetween(new THREE.Vector3(0, y + 0.30, 0), end, 0.025 + radius * 0.015))
      for (const t of [0.35, 0.62, 0.88]) {
        const spread = (0.15 + radius * 0.20) * (1.15 - t * 0.4)
        addNeedles(Math.sin(angle) * reach * t, y + 0.24 - t * 0.1, Math.cos(angle) * reach * t,
          spread, 0.24 + radius * 0.19, angle, level)
      }
    }
  }
  addNeedles(0, 5.65, 0, 0.18, 0.18, 0, 10)
  root.add(bakedMesh(wood, timberMaterial(0x62503f)))
  root.add(bakedMesh(needles, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })))
  root.rotation.y = random() * Math.PI * 2
  return root
}

export function createChevalVisual(): THREE.Group {
  const root = new THREE.Group()
  const wood: THREE.BufferGeometry[] = []
  const tips: THREE.BufferGeometry[] = []
  const bindings: THREE.BufferGeometry[] = []
  wood.push(beamBetween(new THREE.Vector3(-1.5, 0.88, 0), new THREE.Vector3(1.5, 0.88, 0), 0.16))
  for (const x of [-1.15, 0, 1.15]) {
    for (const direction of [-1, 1]) {
      const start = new THREE.Vector3(x, 0.08, -direction * 0.7)
      const end = new THREE.Vector3(x, 1.82, direction * 0.7)
      wood.push(beamBetween(start, end, 0.105))
      const tip = new THREE.ConeGeometry(0.087, 0.3, 7)
      const axis = end.clone().sub(start).normalize()
      tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis))
      tip.translate(...end.clone().addScaledVector(axis, 0.12).toArray())
      tips.push(tip)
    }
    for (let band = 0; band < 3; band++) {
      bindings.push(new THREE.TorusGeometry(0.2, 0.025, 5, 10).rotateY(Math.PI / 2).translate(x + (band - 1) * 0.055, 0.88, 0))
    }
  }
  root.add(bakedMesh(wood, timberMaterial()), bakedMesh(tips, timberMaterial(0xb29a72)), bakedMesh(bindings, new THREE.MeshStandardMaterial({ color: 0x9d8a61, roughness: 1 })))
  return root
}

function fabricPanel(vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  // Triangular panels share a cloth weave scale, with seams supplied by the poles/ropes.
  const uvs: number[] = []
  for (let i = 0; i < vertices.length; i += 3) uvs.push((vertices[i] + vertices[i + 2]) * 0.4, vertices[i + 1] * 0.4)
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  return geometry
}

export function createTentVisual(faction: 'roman' | 'viking'): THREE.Group {
  const root = new THREE.Group()
  const canvas = proceduralMaterial({ kind: 'cloth', color: 0xbdb196, roughness: 1, repeat: [3, 3] }).clone()
  canvas.side = THREE.DoubleSide
  const trim = proceduralMaterial({ kind: 'cloth', color: faction === 'roman' ? 0x793e32 : 0x465c66, roughness: 1 })
  trim.side = THREE.DoubleSide
  const fabric: THREE.BufferGeometry[] = []
  const trimParts: THREE.BufferGeometry[] = []
  // Ridge tent with gently sagging side panels, raised hems and an open entrance.
  for (const side of [-1, 1]) {
    for (let strip = 0; strip < 8; strip++) {
      const z0 = -2.55 + strip * 0.6375, z1 = z0 + 0.6375
      const ridge0 = 3.5 - Math.sin((z0 + 2.55) / 5.1 * Math.PI) * 0.16
      const ridge1 = 3.5 - Math.sin((z1 + 2.55) / 5.1 * Math.PI) * 0.16
      fabric.push(fabricPanel([0, ridge0, z0, side*2.4, 0.18, z0, side*2.4, 0.18, z1, 0, ridge0, z0, side*2.4, 0.18, z1, 0, ridge1, z1]))
      trimParts.push(fabricPanel([side*2.27, 0.36, z0, side*2.42, 0.14, z0, side*2.42, 0.14, z1, side*2.27, 0.36, z0, side*2.42, 0.14, z1, side*2.27, 0.36, z1]))
    }
    fabric.push(fabricPanel([0, 3.5, -2.55, side*2.4, 0.18, -2.55, 0, 0.18, -2.55]))
    fabric.push(fabricPanel([0, 3.5, 2.55, side*2.4, 0.18, 2.55, side*0.95, 0.2, 2.58]))
  }
  const timber: THREE.BufferGeometry[] = []
  const ropes: THREE.BufferGeometry[] = []
  for (const z of [-2.6, 2.6]) {
    timber.push(beamBetween(new THREE.Vector3(0, 0, z), new THREE.Vector3(0, 3.65, z), 0.075))
    for (const side of [-1, 1]) {
      ropes.push(beamBetween(new THREE.Vector3(side*1.4, 1.58, z), new THREE.Vector3(side*3.0, 0.1, z*1.12), 0.018))
      timber.push(beamBetween(new THREE.Vector3(side*3.0, 0, z*1.12), new THREE.Vector3(side*3.0, 0.32, z*1.12), 0.035))
    }
  }
  timber.push(beamBetween(new THREE.Vector3(0, 3.52, -2.8), new THREE.Vector3(0, 3.52, 2.8), 0.065))
  root.add(bakedMesh(fabric, canvas), bakedMesh(trimParts, trim), bakedMesh(timber, timberMaterial()), bakedMesh(ropes, new THREE.MeshStandardMaterial({color:0x9b8762, roughness:1})))
  return root
}

export function createCampfireVisual(seed: number): THREE.Group {
  const root = new THREE.Group()
  const random = environmentRandom(seed)
  const stones: THREE.BufferGeometry[] = []
  const logs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 11; i++) {
    const angle = i / 11 * Math.PI * 2
    stones.push(new THREE.DodecahedronGeometry(0.18 + random()*0.06, 0).scale(1.1, 0.7, 0.85).rotateY(angle).translate(Math.cos(angle)*0.67, 0.12, Math.sin(angle)*0.67))
  }
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2
    logs.push(beamBetween(new THREE.Vector3(Math.cos(angle)*0.5, 0.12, Math.sin(angle)*0.5), new THREE.Vector3(-Math.cos(angle)*0.27, 0.32, -Math.sin(angle)*0.27), 0.11))
  }
  root.add(bakedMesh(stones, new THREE.MeshStandardMaterial({color:0x747064, roughness:1})), bakedMesh(logs, timberMaterial(0x302720)))
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.48, 16).rotateX(-Math.PI/2), new THREE.MeshStandardMaterial({color:0x542314, emissive:0xe7430b, emissiveIntensity:0.55, roughness:1}))
  coals.position.y = 0.025
  root.add(coals)
  // Tapered, curved flame tongues with a bright core, animated on the GPU.
  const flames: THREE.BufferGeometry[] = []
  for (let i = 0; i < 7; i++) {
    const height = 0.42+random()*0.46
    const geo = new THREE.ConeGeometry(0.11+random()*0.08, height, 7, 4)
    const pos = geo.getAttribute('position')
    const colors: number[] = []
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v)+height/2)/height
      pos.setX(v, pos.getX(v)+t*t*0.17)
      const color = new THREE.Color().setRGB(1, 0.22+(1-t)*0.66, 0.015+(1-t)*0.14)
      colors.push(color.r, color.g, color.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.rotateY(i*2.4).translate(Math.cos(i*2.4)*0.19, 0.18+height/2, Math.sin(i*2.4)*0.19)
    flames.push(geo)
  }
  const flameMaterial = new THREE.MeshBasicMaterial({vertexColors:true})
  const time = { value: 0 }
  flameMaterial.onBeforeCompile = shader => {
    shader.uniforms.environmentTime = time
    shader.vertexShader = 'uniform float environmentTime;\n'+shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += sin(environmentTime * 7.0 + position.y * 9.0) * 0.055 * position.y; transformed.y *= 0.94 + sin(environmentTime * 9.0 + position.x * 13.0) * 0.09;')
  }
  const flame = bakedMesh(flames, flameMaterial)
  flame.castShadow = false
  flame.onBeforeRender = () => { time.value = performance.now() / 1000 }
  root.add(flame)
  return root
}
