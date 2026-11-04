import * as THREE from 'three'

export interface ArticulatedFingerPoses {
  relaxed: Record<string, readonly number[]>
  grip: Record<string, readonly number[]>
}
interface ContactState {
  alive: boolean
  action: string
  sampledBowPose?: boolean
  carryWeapon?: 'sword' | 'axe'
  lance: boolean
  shield: boolean
}

/** Bow samples keep ownership through their return-to-idle fade. Empty hands
 * release equipment contact immediately, including during walk/run. */
export function fingerContactOwnership(state: ContactState): { left: boolean, right: boolean } | null {
  if (!state.alive || state.action === 'death' || state.sampledBowPose || state.action === 'bowAim' || state.action === 'bowRelease') return null
  return { right: !!state.carryWeapon || state.lance, left: state.shield || state.carryWeapon === 'axe' && state.action === 'axeAttack2H' }
}

/** Asset-provided absolute target-bind poses, applied once after the mixer.
 * It owns only finger joints; wrists and weapon attachment remain independent. */
export class ArticulatedFingerPose {
  readonly nodes: THREE.Object3D[] = []
  private readonly entries: Array<{ node: THREE.Object3D, left: boolean, relaxed: THREE.Quaternion, grip: THREE.Quaternion }> = []

  constructor(root: THREE.Object3D, poses: ArticulatedFingerPoses) {
    for (const [name, value] of Object.entries(poses.relaxed)) {
      const node = root.getObjectByName(name), grasp = poses.grip[name]
      if (!node || !grasp || !/^(thumb|index|middle|ring|pinky)_0[123]_[lr]$/.test(name)) throw new Error(`Invalid articulated finger pose: ${name}`)
      this.nodes.push(node)
      this.entries.push({ node, left: name.endsWith('_l'), relaxed: new THREE.Quaternion(value[0], value[1], value[2], value[3]), grip: new THREE.Quaternion(grasp[0], grasp[1], grasp[2], grasp[3]) })
    }
  }

  apply(state: ContactState): void {
    const ownership = fingerContactOwnership(state)
    if (!ownership) return
    for (const entry of this.entries) entry.node.quaternion.copy(ownership[entry.left ? 'left' : 'right'] ? entry.grip : entry.relaxed)
  }
}
