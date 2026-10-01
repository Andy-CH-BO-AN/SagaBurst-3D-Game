import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import { returnFollowLocalOffset } from '../battle/FollowOrder'
const SECOND_SQUAD_OFFSET = new THREE.Vector3(28, 0, -4.4)

/** NPC commands only: Player remains an independent rider in Captain's squad. */
export class MountedMissionMarchController {
  private started = false
  private charged = false
  private readonly captain: NPC
  private readonly maki: NPC
  private readonly rescue: NPC[]
  private readonly firstSquad: Set<NPC>
  constructor(
    npcs: readonly NPC[],
    private readonly breach: THREE.Vector3,
    private readonly followVoice: () => void,
    private readonly onChargeTriggered: () => boolean | void,
    private readonly chargeVoice: () => void,
    private readonly resumeCharged = false,
    private readonly options: {
      chargeDistance?: number; followerCount?: number; playFollow?: boolean; marchTarget?: THREE.Vector3
      squads?: readonly [{ leader: NPC | undefined; members: readonly NPC[] }, { leader: NPC | undefined; members: readonly NPC[] }]
    } = {},
  ) {
    this.rescue = options.squads ? options.squads.flatMap(squad => [...squad.members]) : npcs.filter(npc => npc.squadId === 1 || npc.squadId === 2)
    this.firstSquad = new Set(options.squads?.[0].members ?? this.rescue.filter(npc => npc.squadId === 1))
    this.captain = (options.squads ? options.squads[0].leader : this.rescue.find(npc => npc.name === 'Captain'))!
    this.maki = (options.squads ? options.squads[1].leader : this.rescue.find(npc => npc.name === 'Maki'))!
    if (this.rescue.some(npc => !npc.dead && !npc.mount)) throw new Error('Mounted mission requires mounted cavalry')
  }
  start(): void {
    if (this.started) return
    this.started = true
    if (this.resumeCharged) {
      this.charged = true
      for (const npc of this.rescue) if (!npc.dead) npc.setTacticalOrder('charge')
      return
    }
    if (!this.captain || !this.maki || this.captain.dead || this.maki.dead) { this.charge(); return }
    const speed = Math.min(...this.rescue.filter(npc => !npc.dead).map(npc => npc.mount!.baseSpeed))
    const marchTarget = this.options.marchTarget ?? this.breach
    const facing = marchTarget.clone().sub(this.captain.combatPosition).setY(0).normalize()
    this.captain.assignFormationTarget(1, marchTarget, facing, speed)
    this.maki.assignFollowTarget(this.captain, 0, SECOND_SQUAD_OFFSET, speed)
    let slotA = 1, slotB = 0
    for (const npc of this.rescue) {
      if (npc === this.captain || npc === this.maki) continue
      const leader = this.firstSquad.has(npc) ? this.captain : this.maki
      const slot = this.firstSquad.has(npc) ? slotA++ : slotB++
      npc.assignFollowTarget(leader, slot, returnFollowLocalOffset(slot, this.options.followerCount ?? 24, true, 5), speed)
    }
    if (this.options.playFollow !== false) this.followVoice()
  }
  update(): void {
    if (!this.started || this.charged) return
    const distance = this.captain ? Math.hypot(this.captain.combatPosition.x - this.breach.x, this.captain.combatPosition.z - this.breach.z) : 0
    if (distance > (this.options.chargeDistance ?? 50) && this.captain && this.maki && !this.captain.dead && !this.maki.dead) return
    this.charge()
  }
  private charge(): void {
    // Save the phase before releasing AI, so a failed save can retry next frame.
    if (this.onChargeTriggered() === false) return
    this.charged = true
    for (const npc of this.rescue) if (!npc.dead) npc.setTacticalOrder('charge')
    if (this.captain && !this.captain.dead) this.chargeVoice()
  }
  get hasCharged(): boolean { return this.charged }
}
