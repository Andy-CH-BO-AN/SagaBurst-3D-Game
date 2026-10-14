import * as THREE from 'three'
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'

const SET_COUNT = 4
const patchedMaterials = new WeakSet<THREE.Material>()
const shadowMaterials = new WeakMap<THREE.Material, { depth: THREE.MeshDepthMaterial; distance: THREE.MeshDistanceMaterial }>()

/** Keep the glTF's complete skin in every render pass, including normals. */
function patchMaterial(material: THREE.Material): void {
  if (patchedMaterials.has(material)) return
  patchedMaterials.add(material)
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey.bind(material)
  const key = previousKey()
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    const declarations = [1, 2, 3].map(set => `attribute vec4 joints_${set};\nattribute vec4 weights_${set};`).join('\n')
    const additions = [1, 2, 3].flatMap(set => ['x', 'y', 'z', 'w'].map(component =>
      `if (weights_${set}.${component} > 0.0) fullSkinMatrix += weights_${set}.${component} * getBoneMatrix(joints_${set}.${component});`)).join('\n')
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n#ifdef USE_SKINNING\n${declarations}\n#endif`)
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n#ifdef USE_SKINNING\nmat4 fullSkinMatrix = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;\n${additions}\n#endif`)
      .replace('#include <skinnormal_vertex>', `#ifdef USE_SKINNING
mat4 skinMatrix = bindMatrixInverse * fullSkinMatrix * bindMatrix;
objectNormal = (skinMatrix * vec4(objectNormal, 0.0)).xyz;
#ifdef USE_TANGENT
objectTangent = (skinMatrix * vec4(objectTangent, 0.0)).xyz;
#endif
#endif`)
      .replace('#include <skinning_vertex>', `#ifdef USE_SKINNING
transformed = (bindMatrixInverse * fullSkinMatrix * bindMatrix * vec4(transformed, 1.0)).xyz;
#endif`)
  }
  material.customProgramCacheKey = () => `${key}:gltf-four-weight-sets-v1`
  material.needsUpdate = true
}

const base = new THREE.Vector3()
const point = new THREE.Vector3()
const matrix = new THREE.Matrix4()
function applyCompleteSkin(this: THREE.SkinnedMesh, index: number, target: THREE.Vector3): THREE.Vector3 {
  base.copy(target).applyMatrix4(this.bindMatrix)
  target.set(0, 0, 0)
  for (let set = 0; set < SET_COUNT; set++) {
    const joints = this.geometry.getAttribute(set === 0 ? 'skinIndex' : `joints_${set}`)
    const weights = this.geometry.getAttribute(set === 0 ? 'skinWeight' : `weights_${set}`)
    for (let component = 0; component < 4; component++) {
      const weight = weights.getComponent(index, component)
      if (weight === 0) continue
      const joint = joints.getComponent(index, component)
      matrix.multiplyMatrices(this.skeleton.bones[joint].matrixWorld, this.skeleton.boneInverses[joint])
      target.addScaledVector(point.copy(base).applyMatrix4(matrix), weight)
    }
  }
  return target.applyMatrix4(this.bindMatrixInverse)
}

/** Reapply per-instance methods after SkeletonUtils cloning; resources remain shared. */
export function configureMultiInfluenceSkinning(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh) || object.geometry.userData.completeSkinInfluences !== true) return
    for (let set = 1; set < SET_COUNT; set++) {
      if (!object.geometry.hasAttribute(`weights_${set}`) || !object.geometry.hasAttribute(`joints_${set}`)) {
        throw new Error(`Incomplete multi-influence skin: ${object.name}, set ${set}`)
      }
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    if (materials.length !== 1) throw new Error('Multi-influence skin requires one material per glTF primitive')
    const material = materials[0]
    patchMaterial(material)
    let shadows = shadowMaterials.get(material)
    if (!shadows) {
      shadows = {
        depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
        distance: new THREE.MeshDistanceMaterial(),
      }
      for (const shadow of [shadows.depth, shadows.distance]) {
        shadow.side = material.side
        patchMaterial(shadow)
      }
      material.addEventListener('dispose', () => {
        shadows!.depth.dispose()
        shadows!.distance.dispose()
        shadowMaterials.delete(material)
      })
      shadowMaterials.set(material, shadows)
    }
    object.customDepthMaterial = shadows.depth
    object.customDistanceMaterial = shadows.distance
    object.applyBoneTransform = applyCompleteSkin
    if (object.skeleton && object.boundingBox) object.computeBoundingBox()
    if (object.skeleton && object.boundingSphere) object.computeBoundingSphere()
  })
}

/** GLTFLoader normalizes WEIGHTS_0 alone. Save that accessor BEFORE loadMesh,
 * then restore it without changing any of the source's remaining weights. */
export function multiInfluenceSkinningPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: 'SAGABURST_multi_influence_skinning',
    async loadMesh(meshIndex) {
      const primitives = parser.json.meshes[meshIndex].primitives as Array<{ attributes: Record<string, number> }>
      const originals = new Map<number, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>()
      for (const primitive of primitives) {
        if (primitive.attributes.WEIGHTS_1 === undefined) continue
        const accessor = primitive.attributes.WEIGHTS_0
        const weights = await parser.getDependency('accessor', accessor) as THREE.BufferAttribute
        originals.set(accessor, weights.clone())
      }
      const root = await parser.loadMesh(meshIndex)
      root.traverse(object => {
        if (!(object instanceof THREE.SkinnedMesh)) return
        const association = parser.associations.get(object) as { primitives?: number } | undefined
        const primitive = primitives[association?.primitives ?? 0]
        const weights = originals.get(primitive.attributes.WEIGHTS_0)
        if (weights) {
          object.geometry.setAttribute('skinWeight', weights)
          object.geometry.userData.completeSkinInfluences = true
        }
      })
      configureMultiInfluenceSkinning(root)
      return root
    },
  }
}
