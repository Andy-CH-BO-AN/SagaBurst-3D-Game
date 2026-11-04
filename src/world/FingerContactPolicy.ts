export interface ArticulatedFingerPoses {
  relaxed: Record<string, readonly number[]>
  grip: Record<string, readonly number[]>
  sword?: Record<string, readonly number[]>
  /** Hand-only grasp station; the weapon keeps its original attachment. */
  swordGripCenterLocal?: [number, number, number]
  mountedSword?: Record<string, readonly number[]>
  mountedSwordGripCenterLocal?: [number, number, number]
}
interface ContactState {
  alive: boolean
  action: string
  sampledBowPose?: boolean
  carryWeapon?: 'sword' | 'axe'
  lance: boolean
  shield: boolean
}

/** Projectile samples keep ownership through release/bow recovery. Empty
 * hands release equipment contact immediately, including during walk/run. */
export function fingerContactOwnership(state: ContactState): { left: boolean, right: boolean } | null {
  if (!state.alive || state.action === 'death' || state.sampledBowPose
    || ['bowAim', 'bowRelease', 'pilumThrow'].includes(state.action)) return null
  return { right: !!state.carryWeapon || state.lance, left: state.shield || state.carryWeapon === 'axe' && state.action === 'axeAttack2H' }
}
