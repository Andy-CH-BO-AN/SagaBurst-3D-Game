import * as THREE from 'three'
import { expect } from 'vitest'
import type { CharacterRig } from '../../src/world/CharacterVisuals'
import { CharacterCombatAnimator } from '../../src/world/CharacterCombatAnimator'
import { applyBowAttachment } from '../../src/world/BowAttachmentContract'

/** Reuses an already-loaded T4 rig; no meshes, GLBs or gameplay actors created. */
export function assertLegacyBowFacing(root: THREE.Group, rig: CharacterRig): void {
  const pivot = new THREE.Group()
  rig.left.handSocket.add(pivot)
  applyBowAttachment(rig.left.handSocket, pivot)
  const animator = new CharacterCombatAnimator(rig, new THREE.Group(), pivot)
  try {
    root.rotation.y = .8
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion)
    for (const mount of [null, 'HORSE', 'BLACK_CAT', 'CORGI', 'xongkoro'] as const) {
      animator.cancel()
      animator.setEquipment(false, false, mount ?? 'HORSE')
      animator.setLocomotion(0, mount !== null)
      animator.poseBow(1)
      animator.update(.2)
      root.updateMatrixWorld(true)
      const body = new THREE.Vector3(0, 0, -1).transformDirection(pivot.matrixWorld)
      expect(body.dot(forward), `${root.name} ${mount ?? 'standing'}: legacy bow facing`).toBeGreaterThan(.99)
    }
  } finally { pivot.removeFromParent() }
}
