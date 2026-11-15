import * as THREE from 'three'

export function civilianShelterSlots(count = 20): THREE.Vector3[] {
  const center = { x: 0, z: -3 }
  const rows = Math.ceil(count / 5)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 5)
    const column = index % 5 - (Math.min(5, count - row * 5) - 1) / 2
    return new THREE.Vector3(center.x + column * 2, 0, center.z + (row - (rows - 1) / 2) * 2)
  })
}
