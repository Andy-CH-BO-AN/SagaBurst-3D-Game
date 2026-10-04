import * as THREE from 'three'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import { returnFollowLocalOffset, followSlotWorldPosition } from '../battle/FollowOrder'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import { townCaptainProfile } from '../town/TownRules'
import { TOWN_MOUNTED_MISSION_MUSTER } from '../town/TownLayout'
import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { resolveCareerReliefMount } from './CareerOutpostMission'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'

export const CAVALRY_SWEEP_ID = 'career-cavalry-sweep'
export const SWEEP_CHARGE_DISTANCE = 60
export const SWEEP_DETECTION_RANGE = 80
// Existing Town terrain: cavalry entrance forecourt, then march south.
export const SWEEP_CENTER = new THREE.Vector3(110, 0, -275)
export const SWEEP_CAPTAIN_START = new THREE.Vector3(TOWN_MOUNTED_MISSION_MUSTER.x, 0, TOWN_MOUNTED_MISSION_MUSTER.z)
export const SWEEP_YAW = Math.PI
/** Indexed by mission slot: Captain at 0, Maki at 29; gaps receive temporary riders. */
export type SweepGarrisonActorIds = readonly (string | undefined)[]
export function sweepPlayerSpawn(captain = SWEEP_CAPTAIN_START, yaw = SWEEP_YAW): THREE.Vector3 {
  return followSlotWorldPosition(captain, yaw, returnFollowLocalOffset(0, 29, true, 5))
}
export function sweepBanditPosition(index: number): THREE.Vector3 {
  return SWEEP_CENTER.clone().add(new THREE.Vector3((Math.floor(index / 8) - 2) * 4, 0, (index % 8 - 3.5) * 3))
}
export function acceptCavalrySweep(current: CareerProfile, id = createCareerMissionId(CAVALRY_SWEEP_ID), garrisonActorIds: SweepGarrisonActorIds = []): CareerProfile | null {
  const mount = resolveCareerReliefMount(current)
  if (!mount || current.activeMission || current.activeOutpostMission || current.townEvent?.state === 'hostile') return null
  const profile = cloneCareerProfile(current)
  profile.selectedMountId = mount
  profile.activeMission = createCavalrySweepMission(id, garrisonActorIds)
  profile.activeMission.mountState = { activeMountId: mount, hp: {}, unavailable: [] }
  return profile
}
export function createCavalrySweepMission(id = createCareerMissionId(CAVALRY_SWEEP_ID), garrisonActorIds: SweepGarrisonActorIds = []): ActiveCareerMission {
  return {
    id, templateId: CAVALRY_SWEEP_ID, kind: 'cavalry-sweep', targetCampId: 0, phase: 'ASSEMBLING',
    targetActorIds: Array.from({ length: 40 }, (_, index) => `${id}:bandit:${index}`),
    friendlyActorIds: Array.from({ length: 59 }, (_, index) => garrisonActorIds[index] ?? `${id}:cavalry:${index}`), acceptedAt: Date.now(),
    borrowedActorIds: garrisonActorIds.slice(0, 59).filter((id): id is string => id !== undefined),
  }
}
/** T4 leaders reuse the same profiles as Relief; every ordinary soldier is cavalry. */
export function createSweepRoster(faction: CharacterFaction, captain = SWEEP_CAPTAIN_START, yaw = SWEEP_YAW): NpcSpawnSpec[] {
  const specs: NpcSpawnSpec[] = []
  const maki = followSlotWorldPosition(captain, yaw, new THREE.Vector3(28, 0, -4.4))
  for (const squadId of [1, 2] as const) {
    const count = MAX_COMMAND_SQUAD_SIZE - (squadId === 1 ? 1 : 0)
    for (let index = 0; index < count; index++) {
      const leader = index === 0
      const presetId: UnitPresetId = leader && squadId === 2 ? `${faction}_archer` : `${faction}_${!leader && index % 3 === 0 ? 'lancer' : 'sword_cavalry'}`
      const hero = leader ? squadId === 1 ? townCaptainProfile(faction) : T4_UNIT_PROFILES[presetId] : undefined
      const anchor = squadId === 1 ? captain : maki
      const slot = squadId === 1 ? index : index - 1
      const position = leader ? anchor : followSlotWorldPosition(anchor, yaw, returnFollowLocalOffset(slot, 29, true, 5))
      specs.push({
        x: position.x, z: position.z, faction: Faction.TOWN, characterFaction: faction, aiType: leader && squadId === 2 ? AIType.RANGED : AIType.MELEE,
        name: leader ? squadId === 1 ? 'Captain' : 'Maki' : `Cavalry ${squadId}-${index}`,
        tier: leader ? 4 : 1, cavalry: true, respawnEnabled: false, presetId, squadId,
        loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[hero?.baseLoadoutTier ?? 1], mountId: hero ? squadId === 2 ? 'black-cat' : hero.mountOverride ?? 'horse' : 'horse' },
        ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId, specialCombatProfile: hero.specialCombatProfile } : {}),
      })
    }
  }
  return specs
}
