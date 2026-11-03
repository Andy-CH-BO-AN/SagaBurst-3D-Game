import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { captureBorrowedCharacterIdentities } from '../career/CareerBorrowedIdentity'
import { validateOrdinaryRetirementCommit } from '../career/CareerRetirement'
import { isTownCommandRevokedByRetirement } from '../career/CareerRetirementCommand'
import { stageMissionReturnRebuild, stageMissionReturnResidents, stageMissionReturnPlayerHealth, isMissionReturnResident } from '../career/CareerMissionReturnRecovery'
import { refitCommandCheckpoint, snapshotCommandActor } from '../career/CareerCommandActorCheckpoint'
import { buildCommanderAuthorityForMission } from '../career/CommanderMissionAcceptance'
import { townDefenseCommanderIds } from '../career/TownDefenseRoster'
import { officialCommandIsPlayerControlled } from '../career/CareerCommandAuthority'
import { captureCareerAerialState } from '../career/CareerAerialState'
import { followDeployedPersonalMission, snapshotPersonalMission } from '../career/CareerPersonalSquadMission'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import { stageTownEaglePlayerCommand } from './TownEagleGarrisonController'
import { townRoster, townPlayerEntryPoint } from './TownRules'
import { getTerrainHeight } from '../world/Terrain'
import type { TownCombatResident } from './TownMissionCombat'
import type { CareerProfileStore } from '../career/CareerProfileStore'
import type { CareerRaceController } from '../career/CareerRaceController'
import type { TownAirCommandSquadController } from './TownAirCommandSquadController'
import type { CivilianCommandSquadController } from './CivilianCommandSquadController'
import type { TownCommandSquadController } from './TownCommandSquadController'
import type { CareerMountController } from '../career/CareerMountController'
import type { EnemyEaglePatrolController } from './EnemyEaglePatrolController'
import type { TownOutskirtsWarfareController } from './TownOutskirtsWarfareController'
import type { TownCavalryPatrolController } from './TownCavalryPatrolController'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'
import type { TownPersonalSquadController } from './TownPersonalSquadController'
import type { CaptainPatrolCommandController } from '../career/CaptainPatrolCommandController'
import type { BanditMissionController } from '../career/BanditMissionController'
import type { TownDefenseController } from '../career/TownDefenseController'
import type { TownRetirementMobilizationController } from './TownRetirementMobilizationController'
import type { Player } from '../player/Player'
import type { CareerMissionPage } from '../career/CareerMissionCatalog'
import type { ArmyCommandController } from '../battle/ArmyCommandController'
import type { SkillManager } from '../rpg/SkillManager'

/** Caller intent; checkpoint precedence is private to the commit implementation. */
export type TownProfileChange = 'ordinary' | 'civilian-command' | 'grounded-return'
  | { kind: 'mission-return'; destination: 'in-place' | 'restart'; travel: 'direct' | 'arrived' }

/** Scene composition supplies existing owners and effects, not snapshot merge rules. */
export interface TownProfileCommitRuntime {
  profile: CareerProfile
  store: Pick<CareerProfileStore, 'save'>
  skills: Pick<SkillManager, 'skillState'>
  player?: Pick<Player, 'dead' | 'hp' | 'staminaValue' | 'shield'> & Parameters<typeof captureCareerAerialState>[0]
  residents: readonly TownCombatResident[]
  world: { faction: CareerProfile['faction'] }
  sceneContext: { missionOnlyResidents: boolean }
  race?: Pick<CareerRaceController, 'session' | 'capturePlayerState'>
  townAirCommand?: Pick<TownAirCommandSquadController, 'checkpoint' | 'stageContext' | 'applySavedState'>
  civilianCommand?: Pick<CivilianCommandSquadController, 'checkpoint' | 'applySavedState' | 'synchronize'>
  townCommand?: Pick<TownCommandSquadController, 'checkpoint' | 'stageRefit' | 'stageMissionHandoff' | 'applySavedState' | 'grant'>
  careerMounts?: Pick<CareerMountController, 'checkpoint'>
  enemyEaglePatrol?: Pick<EnemyEaglePatrolController, 'checkpoint'>
  outskirts?: Pick<TownOutskirtsWarfareController, 'cooldownCheckpoint' | 'checkpoint'>
  patrol?: Pick<TownCavalryPatrolController, 'checkpoint'>
  eagleGarrison?: Pick<TownEagleGarrisonController, 'snapshot' | 'beginRefit'>
  personalSquad?: Pick<TownPersonalSquadController, 'sceneKey' | 'captureForNewMission' | 'checkpoint' | 'cleanup' | 'beginMission' | 'regroupAfterMission'>
  captainPatrol?: Pick<CaptainPatrolCommandController, 'active' | 'checkpoint'>
  defense?: Pick<TownDefenseController, 'active' | 'personalContribution'>
  mission?: Pick<BanditMissionController, 'ambientBandits' | 'personalContribution'>
  retirementMobilization?: Pick<TownRetirementMobilizationController, 'capture'>
  personalCommands?: Pick<ArmyCommandController, 'close'>
  garrisonRestored: boolean
  restoringAerialState: boolean
  residentReturnPending: boolean
  townRefitOnReturn: boolean
  careerSaveFailures: number
  careerSkillsDirty: boolean
  deploymentPage?: CareerMissionPage | 'duel'
  notice: string
  clearCareerSkillSaveTimer(): void
  unavailableTownCavalryActorIds(includeReturning: boolean): ReadonlySet<string>
  captureRetirementResources(profile: CareerProfile): void
  applyRetirementDeparture(): void
  synchronizeEagleCommandOwnership(): void
  synchronizeEaglePatrolPolicy(): void
  synchronizeCommandActors(): void
  cancelCareerAudio(): void
}

/** Merges live resources, saves once, then publishes and performs authorized handoffs.
 * A rejected write leaves the published profile and live handoff state unchanged.
 * Completed returns retain their recovery authority across reentrant handoff saves.
 */
export function commitTownProfile(runtime: TownProfileCommitRuntime, profile: CareerProfile,
  change: TownProfileChange = 'ordinary'): boolean {
  if (!validateOrdinaryRetirementCommit(runtime.profile, profile).allowed) {
    runtime.notice = '退役紀錄已更新，請重新操作。'
    return false
  }
  runtime.clearCareerSkillSaveTimer()
  const missionReturn = typeof change === 'object' ? change : undefined
  const outgoingReturn = missionReturn ? runtime.profile.activeMission : undefined
  const completedReturn = Boolean(outgoingReturn && (outgoingReturn.result || runtime.profile.claimedBattleIds.includes(outgoingReturn.id)))
  const rebuildTown = completedReturn && missionReturn?.destination === 'restart'
  const groundedTownReturn = change === 'grounded-return'
    || missionReturn?.travel === 'direct' && (outgoingReturn?.kind === 'captain-patrol-command'
      || completedReturn && missionReturn.destination === 'in-place')
  const restoringResidents = Boolean(completedReturn || runtime.residentReturnPending)
  let next = cloneCareerProfile(profile)
  // Return owns canonical recovery before live ledgers are considered. The
  // settlement caller supplies the destination, never checkpoint override flags.
  if (completedReturn && missionReturn?.destination === 'in-place') {
    next = stageMissionReturnResidents(next, runtime.residents.filter(resident => resident.spec.id).map(resident => ({
      spec: resident.spec, ...(isMissionReturnResident(resident.spec)
        ? { checkpoint: refitCommandCheckpoint(resident.npc, resident.homeMount) } : {}),
    })))
  } else if (rebuildTown) {
    next = stageMissionReturnRebuild(next, townRoster().map(spec => ({ spec })), outgoingReturn?.personalSquad)
  }
  if (groundedTownReturn) delete next.playerAerialState
  // Capture the live race in unrelated town saves, including the hostility transition.
  if (runtime.race?.session && next.activeRace?.id === runtime.race.session.id) next.activeRace = structuredClone(runtime.race.session)
  if (!runtime.race?.session && next.racePlayerState && runtime.profile.racePlayerState) next.racePlayerState = runtime.race?.capturePlayerState() ?? next.racePlayerState
  if (next.activeRace && (next.activeMission || next.activeOutpostMission)) { runtime.notice = '賽馬尚未結束，不能同時接受正式任務。'; return false }
  const startsFormal = Boolean(next.activeMission && next.activeMission.id !== runtime.profile.activeMission?.id
    || next.activeOutpostMission && next.activeOutpostMission.id !== runtime.profile.activeOutpostMission?.id)
  let townStateChanged = JSON.stringify(next.townCommandSquad) !== JSON.stringify(runtime.profile.townCommandSquad)
  const airStateChanged = JSON.stringify(next.townAirCommandSquad) !== JSON.stringify(runtime.profile.townAirCommandSquad)
  if (!airStateChanged && runtime.townAirCommand) next.townAirCommandSquad = runtime.townAirCommand.checkpoint() ?? next.townAirCommandSquad
  if (runtime.townAirCommand) next = runtime.townAirCommand.stageContext(next)
  const airClaimsReleased = Boolean(runtime.profile.townAirCommandSquad?.commandedActorIds.length
    && !next.townAirCommandSquad?.commandedActorIds.length)
  const airScenePermissionChanged = (runtime.profile.townEvent?.state === 'hostile') !== (next.townEvent?.state === 'hostile')
    || runtime.profile.faction !== next.faction
  const civilianStateChanged = JSON.stringify(next.civilianCommandSquad) !== JSON.stringify(runtime.profile.civilianCommandSquad)
  if (!restoringResidents && change !== 'civilian-command' && !civilianStateChanged && runtime.civilianCommand) next.civilianCommandSquad = runtime.civilianCommand.checkpoint() ?? next.civilianCommandSquad
  const startsDefense = startsFormal && (next.activeMission?.kind === 'town-defense' || next.activeMission?.kind === 'commander-four-gate-defense')
  if (startsFormal && next.activeMission?.kind === 'commander-four-gate-defense') {
    next.activeMission.mountState = runtime.careerMounts!.checkpoint()
    next.activeMission.playerHp = runtime.player!.hp
    next.activeMission.playerStamina = runtime.player!.staminaValue
  }
  const respawning = Boolean(runtime.player?.dead && runtime.profile.activeMission && !next.activeMission)
  const returningFromDefense = Boolean((runtime.profile.activeMission?.kind === 'town-defense' || runtime.profile.activeMission?.kind === 'commander-four-gate-defense') && runtime.profile.activeMission.result && !next.activeMission)
  if ((startsDefense && next.rank !== 'commander' || respawning || returningFromDefense) && runtime.townCommand) next = runtime.townCommand.stageRefit(next, startsDefense)
  else if (startsFormal && runtime.townCommand) next = runtime.townCommand.stageMissionHandoff(next)
  else if (!restoringResidents && !townStateChanged && next.faction === runtime.profile.faction && runtime.townCommand) next.townCommandSquad = runtime.townCommand.checkpoint() ?? next.townCommandSquad
  if (startsFormal && next.activeMission && next.activeMission.kind !== 'commander-four-gate-defense' && next.townCommandSquad) {
    const returning = new Set(next.townCommandSquad.actorIds.filter(id => {
      const member = next.townCommandSquad!.members?.[id]
      return Boolean(next.townCommandSquad!.nativeReturnStates?.[id])
        || member?.status !== 'dead' && member?.formation?.commandId === -4400 && !member.formation.reached
    }))
    next.activeMission.friendlyActorIds = next.activeMission.friendlyActorIds.filter(id => !returning.has(id))
    if (next.activeMission.officialSquad) {
      const authority = next.activeMission.officialSquad
      authority.actorIds = authority.actorIds.filter(id => !returning.has(id))
      if (authority.squads) authority.squads = authority.squads.map(squad => ({ ...squad, actorIds: squad.actorIds.filter(id => !returning.has(id)) })).filter(squad => squad.actorIds.length)
      if (authority.commandedSquadIds) authority.commandedSquadIds = authority.commandedSquadIds.filter(id => authority.squads?.some(squad => squad.squadId === id) ?? true)
    }
  }
  if (startsDefense && next.rank === 'commander' && next.activeMission) {
    const mission = next.activeMission, unavailable = runtime.unavailableTownCavalryActorIds(true)
    const residentDeaths = new Set((runtime.residents ?? []).filter(resident => resident.npc.dead).map(resident => resident.spec.id))
    // Keep casualties in the source ledger even when their native owner also reports them unavailable.
    if (mission.kind !== 'commander-four-gate-defense')
      mission.friendlyActorIds = mission.friendlyActorIds.filter(id => !unavailable.has(id) || residentDeaths.has(id))
    const dead = new Set(mission.deadFriendlyActorIds)
    for (const { spec, npc, homeMount } of runtime.residents ?? []) if (npc.dead && mission.friendlyActorIds.includes(spec.id)) {
      dead.add(spec.id)
      mission.actorHealth = { ...mission.actorHealth, [spec.id]: { hp: 0,
        ...(homeMount ? { mountHp: homeMount.dead ? 0 : homeMount.currentHp } : {}) } }
    }
    mission.deadFriendlyActorIds = [...dead]
    if (mission.officialSquad && mission.kind !== 'commander-four-gate-defense') {
      const authority = mission.officialSquad
      authority.actorIds = authority.actorIds.filter(id => !dead.has(id) && mission.friendlyActorIds.includes(id))
      authority.squads = authority.squads?.map(squad => ({ ...squad,
        actorIds: squad.actorIds.filter(id => authority.actorIds.includes(id)),
      })).filter(squad => squad.actorIds.length)
    }
  }
  // The existing service Commander joins only a newly accepted Commander defense.
  // Save its actual resources before any restart; failed saves never grant live authority.
  const defenseCommanderId = startsDefense ? townDefenseCommanderIds(next, (runtime.residents ?? []).map(r => r.spec),
    new Set((runtime.residents ?? []).filter(r => r.npc.dead).map(r => r.spec.id)))[0] : undefined
  if (defenseCommanderId && next.activeMission && !next.activeMission.friendlyActorIds.includes(defenseCommanderId)) {
    next.activeMission.friendlyActorIds.push(defenseCommanderId)
  }
  if (startsFormal && next.activeMission && !next.activeMission.officialSquad) {
    next.activeMission.officialSquad = buildCommanderAuthorityForMission(next, next.activeMission, (runtime.residents ?? []).map(resident => resident.spec))
  }
  if (startsDefense && next.rank === 'commander' && next.activeMission?.officialSquad) {
    const mission = next.activeMission, authority = mission.officialSquad!
    for (const { spec, npc, homeMount } of runtime.residents ?? []) {
      if (!authority.actorIds.includes(spec.id)) continue
      const saved = snapshotCommandActor(npc, homeMount)
      authority.members = { ...authority.members, [spec.id]: saved }
      mission.actorHealth = { ...mission.actorHealth, [spec.id]: { hp: npc.hp,
        ...(saved.mount ? { mountHp: saved.mount.hp } : {}) } }
    }
  }
  // Capture native bodies while the accepting scene still owns them, including
  // missions that immediately rebuild a field scene after this transaction.
  if (startsFormal && next.activeMission && next.activeMission.kind !== 'duel') {
    const mission = next.activeMission
    const identities = captureBorrowedCharacterIdentities(runtime.residents.map(({ spec, npc }) => ({
      combatantId: spec.id, characterIdentity: npc.characterIdentity,
    })), [...mission.friendlyActorIds, ...(mission.borrowedActorIds ?? [])], mission.borrowedActorIdentities)
    if (Object.keys(identities).length) mission.borrowedActorIdentities = identities
  }
  const airPatrol = runtime.enemyEaglePatrol?.checkpoint()
  if (airPatrol) next.enemyEaglePatrols = { ...next.enemyEaglePatrols, [runtime.world.faction]: airPatrol }
  const outskirts = runtime.outskirts?.cooldownCheckpoint()
  if (outskirts?.squads.length) next.townOutskirts = { ...next.townOutskirts, [runtime.world.faction]: outskirts }
  const patrol = runtime.patrol?.checkpoint()
  if (patrol?.squads.length) {
    const previous = next.townPatrols?.[runtime.world.faction]?.squads ?? []
    next.townPatrols = { ...next.townPatrols, [runtime.world.faction]: {
      squads: [...previous.filter(s => !patrol.squads.some(current => current.id === s.id)), ...patrol.squads],
    } }
  }
  // A completed borrow/refit belongs to the mission return, not the old autonomous ledger.
  const outgoing = runtime.profile.activeMission
  if (outgoing && !next.activeMission && runtime.world.faction === next.faction && next.townPatrols?.[next.faction]) {
    const borrowed = new Set([...(outgoing.officialSquad?.actorIds ?? []), ...(outgoing.borrowedActorIds ?? [])])
    const returned = new Set(runtime.residents.filter(r => r.spec.duty === 'patrol'
      && (outgoing.kind === 'town-defense' || outgoing.kind === 'commander-four-gate-defense' || borrowed.has(r.spec.id))).map(r => r.spec.patrolId))
    next.townPatrols[next.faction] = { squads: next.townPatrols[next.faction]!.squads.filter(s => !returned.has(s.id)) }
  }
  if (next.activeMission?.kind === 'captain-patrol-command') {
    next.activeMission.patrolOutskirts = runtime.outskirts?.checkpoint() ?? next.activeMission.patrolOutskirts
    if (runtime.mission?.ambientBandits.length) next.activeMission.patrolAmbient = {
      type: 'mission-official', townFaction: runtime.profile.faction, squadId: 1,
      actorIds: runtime.mission.ambientBandits.map(actor => actor.combatantId), contribution: emptyPersonalContribution(),
      members: Object.fromEntries(runtime.mission.ambientBandits.map(actor => [actor.combatantId, snapshotCommandActor(actor)])),
    }
  }
  next.skills = runtime.skills.skillState
  const settledTownEvent = runtime.profile.townEvent?.state === 'hostile'
    && next.townEvent?.state === 'settled' && next.townEvent.id === runtime.profile.townEvent.id
  if (runtime.garrisonRestored && runtime.eagleGarrison) {
    // The live actors belong to this constructed world even while a saved transition changes the profile.
    const faction = runtime.world.faction
    const refit = !next.activeMission && runtime.profile.activeMission ? new Set(next.townEagleGarrisons?.[faction]?.pairs.filter(pair => pair.refitAllowed).map(pair => pair.riderId)) : undefined
    let snapshot = runtime.eagleGarrison.snapshot(`town:${faction}`)
    const claimed: string[] = [], released: string[] = []
    for (const resident of runtime.residents ?? []) {
      if (!resident.spec.eagle) continue
      const id = resident.npc.combatantId
      const owns = (profile: CareerProfile) => Boolean(profile.rank === 'commander' && profile.faction === faction
        && ((profile.activeMission?.kind === 'town-defense' || profile.activeMission?.kind === 'commander-four-gate-defense') && !profile.activeMission.result
          && profile.activeMission.officialSquad?.missionId === profile.activeMission.id
          && profile.activeMission.officialSquad?.townFaction === faction
          && officialCommandIsPlayerControlled(profile.activeMission.officialSquad, id)
          || !profile.activeMission && !profile.activeOutpostMission && profile.townEvent?.state !== 'hostile'
            && profile.townAirCommandSquad?.commandedActorIds.includes(id)))
      if (owns(next)) claimed.push(id)
      else if (owns(runtime.profile)) released.push(id)
    }
    if (claimed.length) snapshot = stageTownEaglePlayerCommand(snapshot, claimed, true)
    if (released.length) snapshot = stageTownEaglePlayerCommand(snapshot, released, false, !runtime.profile.activeMission && !runtime.profile.activeOutpostMission
      && !next.activeMission && !next.activeOutpostMission
      && next.townEvent?.state !== 'hostile' && next.faction === faction)
    const serviceIds = (next.townCommandSquad?.refittingActorIds ?? []).filter(id =>
      !runtime.profile.townCommandSquad?.refittingActorIds?.includes(id) && /^town-eagle-rider:[1-5]$/.test(id))
    if (serviceIds.length) snapshot = stageTownEaglePlayerCommand(snapshot, serviceIds, false, true)
    for (const pair of snapshot.pairs) if (serviceIds.includes(pair.riderId)) pair.serviceRefit = true
    for (const pair of snapshot.pairs) if (settledTownEvent || refit?.has(pair.riderId) || serviceIds.includes(pair.riderId)) pair.refitAllowed = true
    next.townEagleGarrisons = { ...next.townEagleGarrisons, [faction]: snapshot }
  }
  if (runtime.player && !runtime.restoringAerialState && !groundedTownReturn) next.playerAerialState = captureCareerAerialState(runtime.player, runtime.personalSquad?.sceneKey ?? 'town-home')
  if (respawning || groundedTownReturn) delete next.playerAerialState
  const newMission = Boolean(next.activeMission && next.activeMission.id !== runtime.profile.activeMission?.id)
  const newOutpost = Boolean(next.activeOutpostMission && next.activeOutpostMission.id !== runtime.profile.activeOutpostMission?.id)
  const missionFinished = Boolean(next.activeMission?.result
    && next.activeMission.id === runtime.profile.activeMission?.id && !runtime.profile.activeMission.result)
  const active = next.activeMission ?? next.activeOutpostMission
  if ((newMission || newOutpost) && next.activeMission?.kind !== 'duel') {
    const roster = snapshotPersonalMission(next)
    if (roster) active!.personalSquad = runtime.personalSquad?.captureForNewMission(roster) ?? roster
  } else if (active?.personalSquad) {
    const saved = runtime.personalSquad?.checkpoint()
    if (saved) {
      saved.contribution = (runtime.captainPatrol?.active ? runtime.captainPatrol.checkpoint()?.personalSquad?.contribution : runtime.defense?.active ? runtime.defense.personalContribution : runtime.mission?.personalContribution) ?? saved.contribution
      active.personalSquad = saved
    }
  }
  if (missionFinished && active?.personalSquad) active.personalSquad = followDeployedPersonalMission(active.personalSquad)
  if (newMission || newOutpost) next.personalSquadRuntime = undefined
  const townClaimStateChanged = JSON.stringify([
    next.townCommandSquad?.commandedActorIds,
    next.townCommandSquad?.nativeReturnStates,
  ]) !== JSON.stringify([
    runtime.profile.townCommandSquad?.commandedActorIds,
    runtime.profile.townCommandSquad?.nativeReturnStates,
  ])
  townStateChanged = JSON.stringify(next.townCommandSquad) !== JSON.stringify(runtime.profile.townCommandSquad)
  // HR/native handoff callbacks may save again before the recovered live actors are applied.
  if (rebuildTown) next = stageMissionReturnRebuild(next, townRoster().map(spec => ({ spec })))
  else if (restoringResidents) next = stageMissionReturnResidents(next,
    runtime.world.faction === next.faction && !runtime.sceneContext.missionOnlyResidents ? runtime.residents.map(resident => ({
      spec: resident.spec, ...(isMissionReturnResident(resident.spec)
        ? { checkpoint: refitCommandCheckpoint(resident.npc, resident.homeMount) } : {}),
    })) : townRoster().map(spec => ({ spec })))
  if (next.activeMission && next.activeMission.id === runtime.profile.activeMission?.id
    && next.activeMission.kind !== 'commander-four-gate-defense') {
    for (const { spec, npc } of runtime.residents ?? []) if (spec.duty === 'watchtower_guard') {
      next.activeMission.actorHealth = { ...next.activeMission.actorHealth, [spec.id]: { hp: npc.dead ? 0 : npc.hp } }
    }
  }
  if (next.careerRetirement?.phase === 'final-stand') runtime.captureRetirementResources(next)
  else runtime.retirementMobilization?.capture(next)
  // Run after the last live snapshot, before saving. Nested handoffs must see
  // the same recovered player HP as this durable completed-return checkpoint.
  if (completedReturn && !rebuildTown) next = stageMissionReturnPlayerHealth(next, runtime.player?.maxHp)
  if (!runtime.store.save(next)) { runtime.careerSaveFailures++; runtime.notice = '保存失敗，資料尚未變更。請確認瀏覽器儲存空間後重試。'; return false }
  if (completedReturn && !rebuildTown && runtime.player) {
    if (groundedTownReturn) {
      const entry = townPlayerEntryPoint()
      runtime.player.resetForScene(entry.x, getTerrainHeight(entry.x, entry.z) + .9, entry.z)
      runtime.player.group.rotation.y = entry.yaw
    } else runtime.player.setHp(runtime.player.maxHp)
  }
  // No handoff callbacks may capture the outgoing battle poses over the saved rebuild.
  if (rebuildTown) { runtime.profile = next; runtime.careerSkillsDirty = false; return true }
  if (restoringResidents) runtime.residentReturnPending = true
  if (respawning || returningFromDefense) runtime.townRefitOnReturn = true
  // Authorize the live controller only after the transition and permission are durably saved.
  if (settledTownEvent && runtime.garrisonRestored) for (const resident of runtime.residents ?? []) {
    if (resident.spec.eagle) runtime.eagleGarrison?.beginRefit(resident.spec.id)
  }
  if (newMission || newOutpost) {
    runtime.personalCommands?.close()
    if (next.activeMission?.kind === 'duel') runtime.personalSquad?.cleanup()
    else runtime.personalSquad?.beginMission(active?.personalSquad)
  }
  if (next.activeMission && next.activeMission.id !== runtime.profile.activeMission?.id) {
    runtime.player?.shield?.reset()
    for (const resident of runtime.residents ?? []) resident.npc?.shield?.reset()
  }
  if (next.activeMission?.id !== runtime.profile.activeMission?.id || next.faction !== runtime.profile.faction) runtime.cancelCareerAudio()
  if (next.rank !== runtime.profile.rank) runtime.deploymentPage = undefined
  const endedFormal = Boolean(runtime.profile.activeMission && !next.activeMission || runtime.profile.activeOutpostMission && !next.activeOutpostMission)
  const rankChanged = next.rank !== runtime.profile.rank
  runtime.profile = next
  runtime.applyRetirementDeparture()
  if (restoringResidents) runtime.civilianCommand?.applySavedState(next.civilianCommandSquad)
  if (runtime.townAirCommand && (airStateChanged || airClaimsReleased || airScenePermissionChanged || startsFormal || endedFormal || rankChanged)) runtime.townAirCommand.applySavedState(next.townAirCommandSquad)
  runtime.synchronizeEagleCommandOwnership()
  runtime.synchronizeEaglePatrolPolicy()
  if (startsFormal || townStateChanged || townClaimStateChanged || endedFormal) runtime.townCommand?.applySavedState(next.townCommandSquad)
  if (!isTownCommandRevokedByRetirement(next) && !runtime.townRefitOnReturn && (endedFormal || next.rank === 'captain' || next.rank === 'commander') && !next.townEvent?.authorizedTownCommandActorIds) runtime.townCommand?.grant()
  runtime.synchronizeCommandActors()
  if (missionFinished) runtime.personalSquad?.regroupAfterMission()
  if (startsFormal || missionFinished || endedFormal || rankChanged) runtime.civilianCommand?.synchronize()
  runtime.careerSkillsDirty = false
  return true
}
