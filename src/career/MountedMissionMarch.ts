import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import { returnFollowLocalOffset } from '../battle/FollowOrder'

const SECOND_SQUAD_OFFSET = new THREE.Vector3(28, 0, -4.4)

export interface MountedMissionSquad {
  leader: NPC | undefined
  /** Includes the leader when it is part of this squad. */
  members: readonly NPC[]
  leaderOffset?: THREE.Vector3
}

export interface MountedMissionMarchOptions {
  chargeDistance?: number
  followerCount?: number
  playFollow?: boolean
  marchTarget?: THREE.Vector3
  chargeAfterFollow?: boolean
  squads?: readonly MountedMissionSquad[]
  leaderMode?: 'independent' | 'follow-first'
  /** NPCs start after Player's reserved position in this squad; null means no Player. */
  playerSquadIndex?: number | null
}

/** Commands only mission NPCs; the Player stays an independent rider. */
export class MountedMissionMarchController {
  private started = false
  private charged = false
  private followFinished = false
  private readonly squads: Array<{ leader: NPC | undefined; members: NPC[]; leaderOffset: THREE.Vector3 }>
  private readonly rescue: NPC[]
  private readonly leaderMode: 'independent' | 'follow-first'
  private readonly playerSquadIndex: number | null

  constructor(
    npcs: readonly NPC[],
    private readonly breach: THREE.Vector3,
    private readonly followVoice: (onFinished?: () => void) => void,
    private readonly onChargeTriggered: () => boolean | void,
    private readonly chargeVoice: () => void,
    private readonly resumeCharged = false,
    private readonly options: MountedMissionMarchOptions = {},
  ) {
    const configured = options.squads
    this.squads = configured
      ? configured.map((squad, index) => ({
          leader: squad.leader,
          members: [...new Set(squad.members)],
          leaderOffset: squad.leaderOffset?.clone() ?? defaultLeaderOffset(index),
        }))
      : legacySquads(npcs)
    this.leaderMode = options.leaderMode ?? (this.squads.length <= 2 ? 'follow-first' : 'independent')
    this.playerSquadIndex = options.playerSquadIndex === undefined ? 0 : options.playerSquadIndex
    this.rescue = [...new Set(this.squads.flatMap(squad => squad.members))]
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (this.resumeCharged) {
      this.charged = true
      this.orderCharge()
      return
    }

    if (this.squads.some(squad => squad.leader?.dead)) {
      this.charge()
      return
    }
    const living = this.rescue.filter(npc => !npc.dead)
    if (!living.length) {
      this.charge()
      return
    }
    const speed = Math.min(...living.map(npc => (npc.isMounted ?? Boolean(npc.mount && !npc.mount.dead)) && npc.mount ? npc.mount.baseSpeed : 7.5))
    const marchTarget = this.options.marchTarget ?? this.breach
    const leaders: NPC[] = []
    for (let squadIndex = 0; squadIndex < this.squads.length; squadIndex++) {
      const squad = this.squads[squadIndex]
      const leader = squad.leader && !squad.leader.dead
        ? squad.leader
        : squad.members.find(npc => !npc.dead)
      if (!leader) continue
      squad.leader = leader
      leaders.push(leader)
      const leaderTarget = marchTarget.clone().add(squad.leaderOffset)
      if (squadIndex === 0 || this.leaderMode === 'independent') {
        const facing = marchTarget.clone().sub(leader.combatPosition).setY(0).normalize()
        leader.assignFormationTarget(1, leaderTarget, facing, speed)
      } else {
        leader.assignFollowTarget(this.squads[0].leader!, 0, squad.leaderOffset.clone(), speed)
      }
      const members = squad.members.filter(npc => !npc.dead && npc !== leader)
      const playerSlot = this.playerSquadIndex === squadIndex ? 1 : 0
      const followerCount = this.options.followerCount
        ?? Math.max(1, squad.members.length - (playerSlot === 1 ? 0 : 1))
      members.forEach((npc, index) => {
        const slot = index + playerSlot
        const mounted = npc.isMounted ?? Boolean(npc.mount && !npc.mount.dead)
        npc.assignFollowTarget(leader, slot, returnFollowLocalOffset(slot, followerCount, mounted, 5), speed)
      })
    }
    if (!leaders.length) {
      this.charge()
      return
    }
    if (this.options.playFollow !== false) this.followVoice(() => { this.followFinished = true })
    else this.followFinished = true
  }

  update(): void {
    if (!this.started || this.charged) return
    // A dead squad leader should release the remaining force to combat.
    if (this.squads.some(squad => squad.leader?.dead)) {
      this.charge()
      return
    }
    const leader = this.squads[0]?.leader
    const distance = leader
      ? Math.hypot(leader.combatPosition.x - this.breach.x, leader.combatPosition.z - this.breach.z)
      : 0
    const waiting = this.options.chargeAfterFollow
      ? !this.followFinished
      : distance > (this.options.chargeDistance ?? 50)
    if (waiting && leader && !leader.dead) return
    this.charge()
  }

  private charge(): void {
    // Save the phase before releasing AI, so a failed save can retry next frame.
    if (this.onChargeTriggered() === false) return
    this.charged = true
    this.orderCharge()
    if (this.squads[0]?.leader && !this.squads[0].leader.dead) this.chargeVoice()
  }

  private orderCharge(): void {
    for (const npc of this.rescue) if (!npc.dead) npc.setTacticalOrder('charge')
  }

  get hasCharged(): boolean { return this.charged }
}

function defaultLeaderOffset(index: number): THREE.Vector3 {
  if (index === 0) return new THREE.Vector3()
  if (index === 1) return SECOND_SQUAD_OFFSET.clone()
  const column = (index + 1) % 2 === 0 ? 1 : -1
  const row = Math.floor(index / 2)
  return new THREE.Vector3(column * (24 + row * 8), 0, -row * 6)
}

function legacySquads(npcs: readonly NPC[]): Array<{ leader: NPC | undefined; members: NPC[]; leaderOffset: THREE.Vector3 }> {
  const rescue = npcs.filter(npc => npc.squadId === 1 || npc.squadId === 2)
  const first = rescue.filter(npc => npc.squadId === 1)
  const second = rescue.filter(npc => npc.squadId === 2)
  return [
    { leader: first.find(npc => npc.name === 'Captain'), members: first, leaderOffset: new THREE.Vector3() },
    { leader: second.find(npc => npc.name === 'Maki'), members: second, leaderOffset: SECOND_SQUAD_OFFSET.clone() },
  ]
}
