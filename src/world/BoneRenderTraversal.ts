import type * as THREE from 'three'

/**
 * Three's main projection and shadow-map passes stop descending at `visible === false`,
 * while world-matrix updates, skinning (Skeleton.update) and world queries ignore it.
 * A subtree made only of Bones has nothing to draw, so hiding it removes every one of
 * its bones from both render traversals without changing a pose or a skinned vertex.
 *
 * Contract: draw nothing directly under a bone. Renderables attach through a non-bone
 * socket; any socket keeps all of its bone ancestors visible, so call this after the
 * instance's sockets exist.
 */
export function hideBoneOnlySubtrees(root: THREE.Object3D): void {
  const boneOnly = (object: THREE.Object3D): boolean => {
    let only = (object as THREE.Bone).isBone === true
    for (const child of object.children) if (!boneOnly(child)) only = false
    return only
  }
  const hide = (object: THREE.Object3D): void => {
    if (boneOnly(object)) { object.visible = false; return }
    for (const child of object.children) hide(child)
  }
  hide(root)
}
