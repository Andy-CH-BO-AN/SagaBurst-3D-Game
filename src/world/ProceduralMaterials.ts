import * as THREE from 'three'

export type SurfaceKind = 'skin' | 'cloth' | 'leather' | 'wood' | 'iron' | 'bronze' | 'fur'

interface SurfaceOptions {
  color: number
  kind: SurfaceKind
  roughness?: number
  metalness?: number
  repeat?: THREE.Vector2Tuple
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()
const textureCache = new Map<string, { map: THREE.Texture, roughnessMap: THREE.Texture, bumpMap: THREE.Texture }>()

function hashSeed(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function randomFactory(seed: number): () => number {
  let state = seed || 1
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state)
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state)
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function surfaceSignal(kind: SurfaceKind, x: number, y: number, random: () => number): number {
  const noise = random() * 2 - 1
  switch (kind) {
    case 'wood':
      return Math.sin(x * 0.16 + Math.sin(y * 0.055) * 2.5) * 0.55 + noise * 0.25
    case 'cloth':
      return ((x % 5 === 0 ? 0.4 : 0) + (y % 5 === 0 ? -0.25 : 0)) + noise * 0.18
    case 'leather':
      return Math.sin(x * 0.13) * Math.sin(y * 0.17) * 0.22 + noise * 0.42
    case 'iron':
    case 'bronze':
      return (x + y * 3) % 47 === 0 ? -0.85 : noise * 0.2
    case 'fur':
      return Math.sin((x + y * 0.33) * 0.22) * 0.18 + noise * 0.42
    case 'skin':
      return Math.sin(x * 0.07) * Math.sin(y * 0.09) * 0.08 + noise * 0.12
  }
}

function makeTexture(
  name: string,
  size: number,
  fill: (data: Uint8ClampedArray, index: number, x: number, y: number, random: () => number) => void,
): THREE.Texture {
  const random = randomFactory(hashSeed(name))
  const bytes = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fill(bytes, (y * size + x) * 4, x, y, random)
    }
  }

  let texture: THREE.Texture
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (context) {
      context.putImageData(new ImageData(bytes, size, size), 0, 0)
      texture = new THREE.CanvasTexture(canvas)
    } else {
      texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat)
    }
  } else {
    texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat)
  }
  texture.name = name
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

function getSurfaceTextures(kind: SurfaceKind, color: number, repeat: THREE.Vector2Tuple): { map: THREE.Texture, roughnessMap: THREE.Texture, bumpMap: THREE.Texture } {
  const key = `${kind}:${color.toString(16)}:${repeat.join('x')}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const base = new THREE.Color(color)
  const size = 128
  const map = makeTexture(`${key}:albedo`, size, (data, index, x, y, random) => {
    const signal = surfaceSignal(kind, x, y, random)
    const shade = 1 + signal * (kind === 'fur' ? 0.16 : 0.1)
    data[index] = clampByte(base.r * 255 * shade)
    data[index + 1] = clampByte(base.g * 255 * shade)
    data[index + 2] = clampByte(base.b * 255 * shade)
    data[index + 3] = 255
  })
  map.colorSpace = THREE.SRGBColorSpace

  const roughnessMap = makeTexture(`${key}:roughness`, size, (data, index, x, y, random) => {
    const value = clampByte(218 + surfaceSignal(kind, x, y, random) * 22)
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  })

  const bumpMap = makeTexture(`${key}:bump`, size, (data, index, x, y, random) => {
    const value = clampByte(128 + surfaceSignal(kind, x, y, random) * 48)
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  })

  const textures = { map, roughnessMap, bumpMap }
  textureCache.set(key, textures)
  return textures
}

export function proceduralMaterial(options: SurfaceOptions): THREE.MeshStandardMaterial {
  const roughness = options.roughness ?? (options.kind === 'iron' || options.kind === 'bronze' ? 0.38 : 0.78)
  const metalness = options.metalness ?? (options.kind === 'iron' ? 0.82 : options.kind === 'bronze' ? 0.72 : 0.02)
  const repeat = options.repeat ?? [2, 2]
  const key = `${options.kind}:${options.color.toString(16)}:${roughness}:${metalness}:${repeat.join('x')}`
  const cached = materialCache.get(key)
  if (cached) return cached

  const textures = getSurfaceTextures(options.kind, options.color, repeat)
  for (const texture of Object.values(textures)) texture.repeat.set(repeat[0], repeat[1])
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.map,
    roughness,
    roughnessMap: textures.roughnessMap,
    metalness,
    bumpMap: textures.bumpMap,
    bumpScale: options.kind === 'iron' || options.kind === 'bronze' ? 0.008 : options.kind === 'fur' ? 0.035 : 0.018,
  })
  material.name = `procedural-${options.kind}-${options.color.toString(16)}`
  materialCache.set(key, material)
  return material
}

export function proceduralMaterialCacheSize(): number {
  return materialCache.size
}
