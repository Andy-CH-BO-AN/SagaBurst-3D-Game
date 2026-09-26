import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory'

describe('羅馬盾牌零件貼合', () => {
  it.each([1, 2, 3])('T%i 外框、盾臍與飾條接觸實際盾面', tier => {
    const shield = new THREE.Group()
    WeaponMeshFactory.buildShield(`scutum_t${tier}`, shield)
    shield.updateMatrixWorld(true)
    const board = shield.getObjectByName('curved-scutum-board') as THREE.Mesh<THREE.BoxGeometry>
    const rim = shield.getObjectByName('scutum-rim') as THREE.Mesh<THREE.TubeGeometry>
    const vertices = board.geometry.getAttribute('position')
    const indices = board.geometry.index!
    const triangles: THREE.Triangle[] = []
    for (let i = 0; i < indices.count; i += 3) {
      const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(vertices, indices.getX(i + j)).applyMatrix4(board.matrixWorld))
      triangles.push(new THREE.Triangle(points[0], points[1], points[2]))
    }
    const closest = new THREE.Vector3()
    // Sample every rendered tube ring, including corners: its centre must remain
    // within the tube radius of the board's actual triangles.
    const rimVertices = rim.geometry.getAttribute('position')
    const { tubularSegments, radialSegments, radius } = rim.geometry.parameters
    for (let ring = 0; ring <= tubularSegments; ring++) {
      const centre = new THREE.Vector3()
      for (let side = 0; side < radialSegments; side++) {
        centre.add(new THREE.Vector3().fromBufferAttribute(rimVertices, ring * (radialSegments + 1) + side))
      }
      centre.divideScalar(radialSegments).applyMatrix4(rim.matrixWorld)
      const distance = Math.min(...triangles.map(triangle => triangle.closestPointToPoint(centre, closest).distanceTo(centre)))
      expect(distance).toBeLessThan(radius)
    }

    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1))
    const faceZ = ray.intersectObject(board)[0].point.z
    const bossBounds = new THREE.Box3().setFromObject(shield.getObjectByName('shield-boss')!)
    expect(bossBounds.min.z).toBeLessThan(faceZ)
    expect(bossBounds.max.z).toBeGreaterThan(faceZ)

    const emblems = shield.children.filter(child => child.name === 'scutum-emblem') as THREE.Mesh[]
    expect(emblems).toHaveLength(1)
    for (const emblem of emblems) {
      const positions = emblem.geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(emblem.matrixWorld)
        ray.ray.origin.set(point.x, point.y, 1)
        const face = ray.intersectObject(board)[0]
        expect(face).toBeDefined()
        expect(Math.abs(point.z - face.point.z)).toBeLessThan(0.012)
      }
      // Corners can sit above the shield while a wide, flat inlay's centre
      // disappears inside it. Check front-facing triangle centres as well.
      const index = emblem.geometry.index!
      for (let i = 0; i < index.count; i += 3) {
        const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, index.getX(i + j)).applyMatrix4(emblem.matrixWorld))
        const triangle = new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3])
        if (triangle.getNormal(new THREE.Vector3()).z < 0.5) continue
        const centre = triangle.getMidpoint(new THREE.Vector3())
        ray.ray.origin.set(centre.x, centre.y, 1)
        const face = ray.intersectObject(board)[0]
        expect(face).toBeDefined()
        expect(centre.z - face.point.z).toBeGreaterThan(0)
        expect(centre.z - face.point.z).toBeLessThan(0.012)
      }
    }
    expect(shield.userData.gripCenterLocal).toEqual([0, 0, 0.085])
  })
})
