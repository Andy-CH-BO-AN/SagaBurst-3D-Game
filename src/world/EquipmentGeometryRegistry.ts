import * as THREE from 'three'

/**
 * Procedural equipment builders create a fresh BufferGeometry per actor, so a
 * 300-shield army uploads 300 identical boards. After a builder finishes, each
 * rigid mesh is pointed at an already registered geometry with byte-identical
 * content (type, attributes, index, groups, draw range, name and userData).
 * Replaced per-call copies were never rendered, so they hold no GPU buffers.
 *
 * Shared geometries are immutable and must never be disposed by an instance;
 * owners that dispose their own pieces check isSharedEquipmentGeometry().
 */
const shared = new WeakSet<THREE.BufferGeometry>()
const byHash = new Map<number, THREE.BufferGeometry[]>()
const floatBits = new Float32Array(1)
const floatWord = new Uint32Array(floatBits.buffer)

export function isSharedEquipmentGeometry(geometry: THREE.BufferGeometry): boolean {
  return shared.has(geometry)
}

export function shareEquipmentGeometry(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh) return
    const geometry = object.geometry as THREE.BufferGeometry
    if (shared.has(geometry) || !isShareable(geometry)) return
    const hash = fingerprint(geometry)
    const bucket = byHash.get(hash)
    const match = bucket?.find(candidate => sameContent(candidate, geometry))
    if (match) {
      object.geometry = match
      return
    }
    shared.add(geometry)
    if (bucket) bucket.push(geometry)
    else byHash.set(hash, [geometry])
  })
}

type Plain = THREE.BufferAttribute & { array: Float32Array | Uint16Array | Uint32Array }

function plainAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): attribute is Plain {
  return !(attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    && (attribute as THREE.BufferAttribute).usage === THREE.StaticDrawUsage
    && (attribute.array instanceof Float32Array || attribute.array instanceof Uint16Array || attribute.array instanceof Uint32Array)
}

function isShareable(geometry: THREE.BufferGeometry): boolean {
  if (Object.keys(geometry.morphAttributes).length > 0) return false
  if (geometry.index && !plainAttribute(geometry.index)) return false
  return Object.values(geometry.attributes).every(plainAttribute)
}

function fingerprint(geometry: THREE.BufferGeometry): number {
  let hash = 0x811c9dc5
  const mix = (value: number): void => { hash = Math.imul(hash ^ value, 0x01000193) }
  const text = (value: string): void => { for (let i = 0; i < value.length; i++) mix(value.charCodeAt(i)) }
  const values = (array: Float32Array | Uint16Array | Uint32Array): void => {
    mix(array.length)
    if (array instanceof Float32Array) for (let i = 0; i < array.length; i++) { floatBits[0] = array[i]; mix(floatWord[0]) }
    else for (let i = 0; i < array.length; i++) mix(array[i])
  }
  text(geometry.type)
  if (geometry.index) values((geometry.index as Plain).array)
  for (const name of Object.keys(geometry.attributes).sort()) {
    const attribute = geometry.attributes[name] as Plain
    text(name); mix(attribute.itemSize); mix(attribute.normalized ? 1 : 0)
    values(attribute.array)
  }
  return hash >>> 0
}

function sameArray(a: Float32Array | Uint16Array | Uint32Array, b: Float32Array | Uint16Array | Uint32Array): boolean {
  if (a.constructor !== b.constructor || a.length !== b.length) return false
  if (a instanceof Float32Array) {
    // Compare bit patterns so -0 and NaN payloads stay distinct, like the upload.
    const wordsA = new Uint32Array(a.buffer, a.byteOffset, a.length), wordsB = new Uint32Array(b.buffer, b.byteOffset, b.length)
    for (let i = 0; i < wordsA.length; i++) if (wordsA[i] !== wordsB[i]) return false
    return true
  }
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameContent(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  if (a.type !== b.type || a.name !== b.name || a.morphTargetsRelative !== b.morphTargetsRelative) return false
  if (a.drawRange.start !== b.drawRange.start || a.drawRange.count !== b.drawRange.count) return false
  if (a.groups.length !== b.groups.length || a.groups.some((group, i) => group.start !== b.groups[i].start
    || group.count !== b.groups[i].count || group.materialIndex !== b.groups[i].materialIndex)) return false
  if (Boolean(a.index) !== Boolean(b.index) || a.index && !sameArray((a.index as Plain).array, (b.index as Plain).array)) return false
  const names = Object.keys(a.attributes)
  if (names.length !== Object.keys(b.attributes).length) return false
  for (const name of names) {
    const left = a.attributes[name] as Plain, right = b.attributes[name] as Plain | undefined
    if (!right || left.itemSize !== right.itemSize || left.normalized !== right.normalized || !sameArray(left.array, right.array)) return false
  }
  return JSON.stringify(a.userData) === JSON.stringify(b.userData)
}
