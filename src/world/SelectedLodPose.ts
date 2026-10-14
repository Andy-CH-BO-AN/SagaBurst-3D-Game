import * as THREE from 'three'

/** Selected LODs retain the same rig, bind space and animation samples. Their
 * different meshes can therefore consume one actor-owned pose and bone texture.
 * Validate the contract before discarding the redundant cloned bone hierarchy.
 * This never shares mutable state between characters or changes source assets. */
export function shareSelectedLodPose(primary: THREE.Object3D, level: THREE.Object3D): void {
  primary.updateMatrixWorld(true)
  level.updateMatrixWorld(true)
  const replacements: Array<{ mesh: THREE.SkinnedMesh; source: THREE.SkinnedMesh }> = []
  const roots: THREE.Bone[] = []
  level.traverse(node => {
    if (node instanceof THREE.Bone && !(node.parent instanceof THREE.Bone)) roots.push(node)
    if (!(node instanceof THREE.SkinnedMesh)) return
    const source = primary.getObjectByName(node.name)
    if (!(source instanceof THREE.SkinnedMesh)) throw new Error(`Selected LOD missing primary mesh: ${node.name}`)
    const sameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((value, i) => Math.abs(value - b.elements[i]) < 1e-7)
    if (!sameMatrix(node.matrixWorld, source.matrixWorld) || !sameMatrix(node.bindMatrix, source.bindMatrix)
      || node.skeleton.bones.length !== source.skeleton.bones.length
      || node.skeleton.bones.some((bone, i) => {
        const original = source.skeleton.bones[i]
        return bone.name !== original.name || bone.parent?.name !== original.parent?.name
          || !sameMatrix(bone.matrixWorld, original.matrixWorld)
          || !sameMatrix(node.skeleton.boneInverses[i], source.skeleton.boneInverses[i])
      })) throw new Error(`Selected LOD bind space differs: ${node.name}`)
    replacements.push({ mesh: node, source })
  })
  if (!replacements.length) throw new Error('Selected LOD has no skinned mesh')
  const unused = new Set(replacements.map(({ mesh }) => mesh.skeleton))
  for (const { mesh, source } of replacements) mesh.skeleton = source.skeleton
  for (const root of roots) root.removeFromParent()
  for (const skeleton of unused) skeleton.dispose()
}

export function validateSelectedLodAnimations(levels: readonly THREE.AnimationClip[][]): void {
  const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length
    && Array.prototype.every.call(a, (value: number, i: number) => value === b[i])
  for (const clips of levels.slice(1)) {
    if (clips.length !== levels[0].length || clips.some((clip, i) => {
      const source = levels[0][i]
      return clip.name !== source.name || clip.duration !== source.duration || clip.tracks.length !== source.tracks.length
        || clip.tracks.some((track, j) => {
          const original = source.tracks[j]
          return track.name !== original.name || track.getInterpolation() !== original.getInterpolation()
            || !same(track.times, original.times) || !same(track.values, original.values)
        })
    })) throw new Error('Selected LOD animation differs from primary pose')
  }
}

/** Omit only properties that equal the bind value in every authored clip.
 * Keep all body rotations and pelvis translations: runtime equipment layers
 * own those properties. Raw source clips remain available for comparison. */
export function optimizeSelectedAnimationClips(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): THREE.AnimationClip[] {
  const invariant = new Map<string, boolean>()
  for (const clip of clips) for (const track of clip.tracks) {
    const split = track.name.lastIndexOf('.')
    const name = track.name.slice(0, split), property = track.name.slice(split + 1)
    const node = root.getObjectByName(name)
    const eligible = node instanceof THREE.Bone && (property === 'scale'
      || property === 'position' && name !== 'hips'
      || property === 'quaternion' && /Hand(Thumb|Index|Middle|Ring|Pinky)[1-4]$/.test(name))
    if (!eligible || invariant.get(track.name) === false) continue
    const rest = property === 'quaternion' ? node.quaternion.toArray()
      : property === 'position' ? node.position.toArray() : node.scale.toArray()
    const constant = track.getInterpolation() !== THREE.InterpolateSmooth
      && track.getValueSize() === rest.length
      && rest.every((value, i) => Math.fround(value) === track.values[i])
      && track.values.every((value, i) => value === track.values[i % rest.length])
    invariant.set(track.name, constant)
  }
  return clips.map(clip => new THREE.AnimationClip(clip.name, clip.duration,
    clip.tracks.filter(track => invariant.get(track.name) !== true), clip.blendMode))
}
