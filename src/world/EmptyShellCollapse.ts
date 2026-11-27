import * as THREE from 'three'

/**
 * Removes imported empty shell leaves (glTF nodes that carry no mesh, light or children)
 * from a mount template before it is cloned, so each instance stops paying a per-frame
 * `updateMatrixWorld` visit for nodes that contribute nothing to any pose or draw call.
 *
 * Removed only when every condition holds: plain Object3D/Group leaf, no Bone ancestor
 * (sockets and bone attachments stay), not named `socket_*` or in `keep`, no `userData` beyond the loader's
 * `name`, and not the target of any animation track (matched by name or uuid). Template geometry,
 * materials and textures are untouched. Returns the removed node names.
 */
export function collapseEmptyShellLeaves(
  scene: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  /** Names the caller looks up later (manifest LOD nodes, required nodes): never removed. */
  keep: Iterable<string> = [],
): string[] {
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('perfNoShellCollapse')) return []
  const driven = new Set<string>(keep)
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const { nodeName } = THREE.PropertyBinding.parseTrackName(track.name)
      if (nodeName) driven.add(nodeName)
    }
  }
  const removed: string[] = []
  const visit = (node: THREE.Object3D, underBone: boolean): void => {
    const nextUnderBone = underBone || (node as THREE.Bone).isBone === true
    for (const child of [...node.children]) {
      visit(child, nextUnderBone)
      const type = child.type
      if (nextUnderBone || child.children.length > 0 || (type !== 'Object3D' && type !== 'Group')) continue
      if (child.name.startsWith('socket_') || driven.has(child.name) || driven.has(child.uuid)) continue
      if (Object.keys(child.userData).some(key => key !== 'name')) continue
      node.remove(child)
      removed.push(child.name)
    }
  }
  visit(scene, false)
  return removed
}
