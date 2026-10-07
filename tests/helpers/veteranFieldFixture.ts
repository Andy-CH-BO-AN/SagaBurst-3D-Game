import * as THREE from 'three'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import type { NPC } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import type { TownActorSpec } from '../../src/town/TownRules'
import type { TownWorld } from '../../src/town/TownWorld'
import type { ObstacleData } from '../../src/world/Terrain'
import type { CharacterFaction } from '../../src/world/CharacterVisuals'
import type { CareerProfile } from '../../src/career/CareerProfile'
import type { ActiveCareerMission } from '../../src/career/CareerMissionState'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { createVeteranRoster, restoreVeteranTownCavalryReserveRoster, type VeteranMissionTemplateId } from '../../src/career/VeteranMission'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { NpcSpawnTestDriver } from './npcSpawnFrames'
import { advanceUntil, type AdvanceUntilOptions } from './simulation'
import { createVeteranMissionProfile } from './veteranFieldBuilders'
import { FieldTestMount, FieldTestNpc, FieldTestPlayer, buildVeteranResidents } from './veteranFieldActors'

export interface VeteranFieldFixtureOptions {
  templateId: VeteranMissionTemplateId
  faction?: CharacterFaction
  missionId?: string
  profile?: CareerProfile
  initialCheckpoint?: Partial<ActiveCareerMission>
  residents?: ReturnType<typeof buildVeteranResidents>
  player?: FieldTestPlayer
  autoStart?: boolean
  ownResidents?: boolean
  obstacles?: ObstacleData[]
}

/** No import-time hooks or globals. Each fixture owns its scheduler and temporary assets.
 * NPC/mount doubles are the rendering boundary; controller, navigation, mission rules,
 * travel encounters and checkpoint transformations are real.
 */
export function createVeteranFieldFixture(options: VeteranFieldFixtureOptions) {
  const { templateId } = options
  let profile = options.profile ?? createVeteranMissionProfile(templateId, options)
  if (options.initialCheckpoint) {
    if (!profile.activeMission) throw new Error('A checkpoint requires an active mission')
    profile = { ...profile, activeMission: { ...profile.activeMission, ...options.initialCheckpoint } }
  }
  const active = profile.activeMission
  if (!active) throw new Error('Veteran fixture requires an active mission')
  const roster = restoreVeteranTownCavalryReserveRoster(
    createVeteranRoster(templateId, profile.faction, active.id, active.veteranRosterVersion ?? 1, active.borrowedActorIds),
    active,
  )
  const residents = options.residents ?? buildVeteranResidents(roster, profile.faction)
  const missionCaptain = residents.find(resident => resident.npc.combatantId === 'captain')?.npc
    ?? new FieldTestNpc('captain')
  const player = options.player ?? new FieldTestPlayer()
  const scene = new THREE.Scene()
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  const spawnDriver = new NpcSpawnTestDriver()
  const scheduler = spawnDriver.scheduler
  const npcFactories: { spec: NpcSpawnSpec; npc: FieldTestNpc }[] = []
  const mountFactories: FieldTestMount[] = []
  const additionalActors: FieldTestNpc[] = []
  let saving = true
  const controller = new BanditMissionController(
    scene, { camps: [], obstacles: options.obstacles ?? [] } as unknown as TownWorld,
    navigation, missionCaptain as unknown as NPC,
    residents as unknown as { spec: TownActorSpec; npc: NPC; homeMount?: Mount }[],
    () => player as unknown as Player, () => profile,
    next => { if (!saving) return false; profile = next; return true },
    {
      createNpc: (spec, actorId) => {
        const npc = new FieldTestNpc(actorId, spec.name, spec.faction, spec.characterFaction,
          spec.tier, spec.squadId, spec.x, spec.z)
        npc.presetId = spec.presetId
        npcFactories.push({ spec, npc })
        return npc as unknown as NPC
      },
      createMount: () => {
        const mount = new FieldTestMount()
        mountFactories.push(mount)
        return mount as unknown as Mount
      },
    },
    scheduler,
  )
  const secondsPerStep = .1
  function waitUntil(condition: () => boolean, step: () => void, settings: AdvanceUntilOptions = {}) {
    return advanceUntil(condition, step, {
      maxSimulationSeconds: 30, secondsPerStep,
      failureMessage: `${templateId}: condition was not reached (phase ${controller.phase})`,
      ...settings,
    })
  }
  function deploy() {
    const started = controller.startActiveMission()
    if (started) advanceUntil(() => controller.ready, () => spawnDriver.advanceFrame(), {
      maxFrames: roster.friendly.length + roster.enemy.length + 1,
      failureMessage: `${templateId}: full mission roster must be ready`,
    })
    const failed = controller.spawnBatches.find(batch => batch.status === 'failed')
    if (failed) throw failed.error
    return started
  }
  function stepFrame(dt = secondsPerStep) {
    spawnDriver.advanceFrame()
    controller.updateFlow(dt, 0)
  }
  // Movement is an explicit test input, separate from the controller's real state machine.
  function reachAssignedPositions(actors = controller.friendlies as unknown as FieldTestNpc[]) {
    for (const actor of actors) if (!actor.dead) actor.moveToFormationTarget()
  }
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true
    controller.dispose()
    for (const actor of additionalActors) if (!actor.disposed) actor.dispose()
    for (const mount of mountFactories) if (!mount.disposed) mount.dispose()
    for (const { npc } of npcFactories) if (!npc.disposed) npc.dispose()
    // Shared residents/player are borrowed by reload fixtures; only their creator owns them.
    if (!options.residents || options.ownResidents) for (const { npc, homeMount } of residents) {
      if (!npc.disposed) npc.dispose()
      if (homeMount && !homeMount.disposed) homeMount.dispose()
    }
    if (!residents.some(({ npc }) => npc === missionCaptain)) missionCaptain.dispose()
    scheduler.tick(Number.MAX_SAFE_INTEGER)
    scene.clear()
  }
  try {
    const start = options.autoStart === false ? false : deploy()
    return {
      controller, profile: () => profile, roster, residents, npcFactories, mountFactories,
      player, scene, navigation, scheduler, spawnDriver, start, deploy, stepFrame,
      get leader() { return controller.missionLeader as unknown as FieldTestNpc | null },
      get actors() { return controller.friendlies as unknown as FieldTestNpc[] },
      get enemies() { return controller.missionBandits as unknown as FieldTestNpc[] },
      reachAssignedPositions,
      trackActor: (actor: FieldTestNpc) => { additionalActors.push(actor); return actor },
      setSaving: (value: boolean) => { saving = value },
      advanceUntil: (condition: () => boolean, settings: AdvanceUntilOptions = {}) =>
        waitUntil(condition, stepFrame, settings),
      assemble: () => waitUntil(() => controller.phase === 'MARCHING', () => {
        reachAssignedPositions()
        stepFrame()
      }, { failureMessage: `${templateId}: assigned squad must begin marching` }),
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
export type VeteranFieldFixture = ReturnType<typeof createVeteranFieldFixture>
