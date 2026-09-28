import * as THREE from 'three'
import { environmentRandom } from './EnvironmentVisuals'
import type { CharacterFaction } from './CharacterVisuals'

type HeightSampler = (x: number, z: number) => number

/** Worn paths are shared by terrain color and tuft placement. */
function wearAt(x: number, z: number, faction?: CharacterFaction | null): number {
  if (!faction) return 0
  const depth = z * (faction === 'roman' ? -1 : 1)
  const inside = THREE.MathUtils.smoothstep(depth, 98, 111) * (1 - THREE.MathUtils.smoothstep(depth, 178, 185))
  const lane = 1 - THREE.MathUtils.smoothstep(Math.abs(x + Math.sin(depth * 0.1) * 0.6), 3, 6)
  const crossLane = (1 - THREE.MathUtils.smoothstep(Math.abs(depth - 156), 1.3, 3.4)) * (1 - THREE.MathUtils.smoothstep(Math.abs(x), 32, 40))
  const tentLane = (1 - THREE.MathUtils.smoothstep(Math.abs(Math.abs(x) - 29), 4, 8)) * (1 - THREE.MathUtils.smoothstep(Math.abs(depth - 148), 27, 33))
  return inside * Math.max(lane * 0.95, crossLane * 0.8, tentLane * 0.6)
}

export function meadowMaterial(geometry: THREE.BufferGeometry, faction?: CharacterFaction | null): THREE.Material {
  const snowy = faction === 'viking'
  const positions = geometry.getAttribute('position')
  const colors: number[] = []
  const grass = new THREE.Color(snowy ? 0xd8e4ec : 0x587044)
  const dry = new THREE.Color(snowy ? 0xf4f6f4 : 0x8b8057)
  const soil = new THREE.Color(snowy ? 0x9da9ad : 0x887256)
  const color = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i)
    const patch = 0.5 + Math.sin(x * 0.065 + Math.cos(z * 0.04) * 2) * Math.cos(z * 0.078) * 0.32 + Math.sin(x * 0.23 + z * 0.14) * 0.12
    color.copy(grass).lerp(dry, patch * 0.4).lerp(soil, wearAt(x, z, faction))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const random = environmentRandom(8128)
  const size = 128, data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    const value = (snowy ? 220 : 170) + random() * (snowy ? 25 : 58) + Math.sin(x * Math.PI / 16) * Math.cos(y * Math.PI / 32) * 12
    data[i] = data[i + 1] = data[i + 2] = value
    data[i + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(100, 100)
  texture.anisotropy = 8
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 1, bumpMap: texture, bumpScale: snowy ? 0.025 : 0.055 })
}

export function createMeadow(scene: THREE.Scene, height: HeightSampler, faction?: CharacterFaction | null): void {
  const snowy = faction === 'viking'
  const random = environmentRandom(3791)
  // Seven bent blades per tuft, opaque geometry avoids transparent-card overdraw.
  const vertices: number[] = [], colors: number[] = []
  for (let blade = 0; blade < 7; blade++) {
    const angle = blade * 2.4, h = 0.15 + random() * 0.22, width = 0.016 + random() * 0.014
    const x = Math.cos(angle) * 0.15, z = Math.sin(angle) * 0.15
    const bendX = Math.cos(angle) * 0.13, bendZ = Math.sin(angle) * 0.13
    const dx = Math.cos(angle + Math.PI / 2) * width, dz = Math.sin(angle + Math.PI / 2) * width
    vertices.push(x-dx,0,z-dz, x+dx,0,z+dz, x+bendX+dx*0.5,h*0.58,z+bendZ+dz*0.5,
      x-dx,0,z-dz, x+bendX+dx*0.5,h*0.58,z+bendZ+dz*0.5, x+bendX-dx*0.5,h*0.58,z+bendZ-dz*0.5,
      x+bendX-dx*0.5,h*0.58,z+bendZ-dz*0.5, x+bendX+dx*0.5,h*0.58,z+bendZ+dz*0.5, x+bendX*1.8,h,z+bendZ*1.8)
    for (const light of [0.5,0.5,0.83,0.5,0.83,0.83,0.83,0.83,1]) colors.push(light * (snowy ? 1 : 0.88), light, light * (snowy ? 0.92 : 0.62))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const material = new THREE.MeshLambertMaterial({ color: snowy ? 0xc8c3b3 : 0xa0a675, vertexColors: true, side: THREE.DoubleSide })
  const time = { value: 0 }
  material.onBeforeCompile = shader => {
    shader.uniforms.environmentTime = time
    shader.vertexShader = 'uniform float environmentTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 meadowWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
      transformed.x += sin(environmentTime * 1.6 + meadowWorld.x * 0.3 + meadowWorld.z * 0.24) * position.y * 0.16;
      float meadowDistance = distance(cameraPosition.xz, meadowWorld.xz);
      transformed.y *= 1.0 - smoothstep(65.0, 100.0, meadowDistance);`)
  }
  const dummy = new THREE.Object3D(), tint = new THREE.Color()
  // Spatial chunks retain frustum culling; only nearby chunks submit their tufts.
  for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) {
    const centerX = cx * 80 + 40, centerZ = cz * 80 + 40
    const positions: [number, number][] = []
    for (let i = 0; i < 2400; i++) {
      const x = cx * 80 + random() * 80, z = cz * 80 + random() * 80
      if (snowy && random() < 0.86) continue
      if (random() < wearAt(x,z,faction) * 0.99) continue
      const patch = Math.sin(x * 0.18) * Math.sin(z * 0.14) + Math.cos(x * 0.067 + z * 0.05)
      if (patch < -0.7 && random() < 0.85) continue
      positions.push([x,z])
    }
    const tufts = new THREE.InstancedMesh(geometry, material, positions.length)
    tufts.name = `meadow-${cx}-${cz}`
    positions.forEach(([x,z], i) => {
      dummy.position.set(x - centerX, height(x, z) - 0.02, z - centerZ)
      dummy.rotation.y = random()*Math.PI*2
      dummy.scale.setScalar(0.7+random()*0.9)
      dummy.updateMatrix()
      tufts.setMatrixAt(i,dummy.matrix)
      tint.setHSL(snowy ? 0.12 : 0.18 + random() * 0.055, snowy ? 0.12 : 0.22 + random() * 0.12, snowy ? 0.68 : 0.42 + random() * 0.13)
      tufts.setColorAt(i,tint)
    })
    tufts.instanceMatrix.needsUpdate = true
    tufts.computeBoundingSphere()
    tufts.onBeforeRender = () => {time.value=performance.now()/1000}
    // No additional shadow pass for tiny grass blades.
    // At 160m even the closest tile corner is beyond the 100m blade fade.
    // Avoid submitting distant, fully collapsed blades to the GPU.
    const lod = new THREE.LOD()
    lod.name = `${tufts.name}-lod`
    lod.position.set(centerX, 0, centerZ)
    lod.addLevel(tufts, 0)
    lod.addLevel(new THREE.Group(), 160)
    scene.add(lod)
  }
}
