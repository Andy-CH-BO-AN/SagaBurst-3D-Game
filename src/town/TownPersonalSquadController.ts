import type * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import type { Player } from '../player/Player'
import type { TownHRLayout } from './TownHRLayout'
import { PersonalSquadRuntime, spawnPersonalSquadActor, type PersonalSquadRuntimeOptions } from '../career/PersonalSquadRuntime'

export { personalMemberLoadout, spawnPersonalSquadActor } from '../career/PersonalSquadRuntime'
export type { PersonalSquadState } from '../career/CareerPersonalSquadMission'

export class TownPersonalSquadController extends PersonalSquadRuntime {
  constructor(scene: THREE.Scene, readonly layout: TownHRLayout,
    read: () => CareerProfile, player: () => Player, spawn = spawnPersonalSquadActor,
    options: PersonalSquadRuntimeOptions = {}) {
    super(scene, layout.muster, read, player, spawn, options)
  }
}
