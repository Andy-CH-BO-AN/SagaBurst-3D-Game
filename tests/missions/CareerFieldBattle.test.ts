import { describe, expect, test } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { MemoryStorage } from '../helpers/memoryStorage'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createActiveCareerMission, type CareerMissionKind } from '../../src/career/CareerMissionState'
import { getRecruitMissionTemplate, RECRUIT_MISSION_CATALOG, RETIRED_RECRUIT_PATROL_IDS } from '../../src/career/CareerMissionCatalog'
import { isCareerFelineBattle, createCareerFelineBattleLaunch, createCareerFelineOrphanMountPlan, createCareerFelineSpawnPlan, careerFieldTacticalOrder } from '../../src/career/CareerBridgeBattle'
import { acceptCavalrySweep, acceptCaptainCavalryCommand } from '../../src/career/CavalrySweep'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { CAPTAIN_PATROL_COMMAND_ID } from '../../src/career/CaptainMissionCatalog'
import { COMMANDER_DECAPITATION_ID, COMMANDER_SKY_RAID_ID } from '../../src/career/CommanderMissionCatalog'
import { townCaptainProfile } from '../../src/town/TownRules'
import { acceptVeteranMission, getVeteranMissionDefinition } from '../../src/career/VeteranMission'
import {
  FIELD_SWEEP_CHARGE_DISTANCE,
  FIELD_SWEEP_DETECTION_RANGE,
  MIGRATED_CAREER_FIELD_TEMPLATE_IDS,
  careerFieldBattleHeroAssetIds,
  careerFieldBattleMapId,
  createCareerFieldCheckpointSeed,
  createCareerFieldDeployment,
  findVeteranSquadsInRange,
  isCareerFieldNoCommandMission,
  isMigratedCareerFieldMission,
  isMigratedCareerFieldTemplate,
  resolveFieldDamagedTargetId,
  resolveMigratedPlayerMountState,
  shouldTriggerSweepAlert,
} from '../../src/career/CareerFieldBattle'
import { T4_RANGER_BOW_RANGED_ID } from '../../src/rpg/WeaponDatabase'
import { Faction } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { populateNpcFactionGrids, selectHostileNpcGrid } from '../../src/world/HostileNpcGrid'
import { ChaseTargetCoordinator } from '../../src/navigation/ChaseTargetCoordinator'
import { Vector3 } from 'three'

function createBanditActive(templateId: string, friendlyIds = ['captain', 'soldier-1', 'soldier-2', 'soldier-3']) {
  const tpl = getRecruitMissionTemplate(templateId)!
  const enemyCount = 'banditCount' in tpl ? tpl.banditCount : 3
  const active = createActiveCareerMission(templateId, 0, enemyCount, 0, `${templateId}-id`, 'bandit', 'captain')
  active.friendlyActorIds = [...friendlyIds]
  return active
}

describe('Phase 2B migrated career field battles', () => {
  test('matches only the exact 9 migrated missions and keeps Town missions excluded', () => {
    expect(MIGRATED_CAREER_FIELD_TEMPLATE_IDS).toHaveLength(9)
    for (const id of MIGRATED_CAREER_FIELD_TEMPLATE_IDS) {
      expect(isMigratedCareerFieldTemplate(id)).toBe(true)
    }
    const excluded = [
      'veteran-tragedy-of-the-scouts',
      CAPTAIN_PATROL_COMMAND_ID,
      COMMANDER_SKY_RAID_ID,
      COMMANDER_DECAPITATION_ID,
      'commander-four-gate-defense',
      ...RETIRED_RECRUIT_PATROL_IDS,
    ]
    for (const id of excluded) {
      expect(isMigratedCareerFieldTemplate(id)).toBe(false)
      const kind: CareerMissionKind = id === 'veteran-tragedy-of-the-scouts' ? 'veteran-field'
        : id === CAPTAIN_PATROL_COMMAND_ID ? 'captain-patrol-command'
        : id.startsWith('commander-') ? id as CareerMissionKind
        : 'patrol'
      const mission = { ...createActiveCareerMission(id, 0, 1, 0, `${id}-x`), kind }
      expect(isMigratedCareerFieldMission(mission)).toBe(false)
      expect(isCareerFelineBattle(mission)).toBe(false)
    }
    const outpost = acceptCareerOutpost({ ...createCareerProfile('roman'), rank: 'soldier' }, 1, 'route-outpost')!
    expect(outpost.activeOutpostMission?.kind).toBe('outpost-defense')
    expect(isMigratedCareerFieldMission(outpost.activeMission)).toBe(false)
    expect(isCareerFelineBattle(outpost.activeMission)).toBe(false)
    // Retired patrols stay out of recruit catalog.
    expect(RECRUIT_MISSION_CATALOG.some(entry => RETIRED_RECRUIT_PATROL_IDS.includes(entry.id as never))).toBe(false)
  })

  test('selects terrain mapId strictly by player Career faction (roman grass, viking snow)', () => {
    expect(careerFieldBattleMapId('roman')).toBe('original')
    expect(careerFieldBattleMapId('viking')).toBe('snow')

    for (const faction of ['roman', 'viking'] as const) {
      const expectedMap = faction === 'viking' ? 'snow' : 'original'
      const recruit = createCareerProfile(faction)
      recruit.activeMission = createBanditActive('recruit-bandits-01')
      const banditLaunch = createCareerFelineBattleLaunch(recruit)
      expect(banditLaunch.battle.mapId).toBe(expectedMap)
      expect(banditLaunch.battle.playerFaction).toBe(faction)

      const veteran = createCareerProfile(faction)
      veteran.rank = 'veteran'
      veteran.ownedMounts = ['horse']
      veteran.selectedMountId = 'horse'
      const vetProfile = acceptVeteranMission(veteran, 'veteran-village-intercept', {
        missionId: `vet-${faction}`,
        townCavalryReserveActorIds: [],
      })!
      const vetLaunch = createCareerFelineBattleLaunch(vetProfile)
      expect(vetLaunch.battle.mapId).toBe(expectedMap)
    }
  })

  test('deploys a representative Recruit roster with its borrowed Captain identity and no Town civilians', () => {
    const profile = createCareerProfile('roman')
    profile.ownedMounts = ['horse']
    profile.selectedMountId = 'horse'

    // Recruit templates share one builder; use one representative input.
    const id = 'recruit-bandits-02'
    const tpl = getRecruitMissionTemplate(id)!
    const friendlyCount = tpl.friendlyCombatants - 1
    const friendlyIds = ['captain', ...Array.from({ length: friendlyCount - 1 }, (_, i) => `town-soldier:${i}`)]
    const romanCaptain = townCaptainProfile('roman')
    profile.activeMission = createBanditActive(id, friendlyIds)
    profile.activeMission.borrowedActorIdentities = {
      captain: { characterFaction: 'roman', characterTier: 4, visualAssetId: romanCaptain.visualAssetId, combatProfileId: romanCaptain.combatProfileId, heroArchetype: 'captain' },
    }
    const deployment = createCareerFieldDeployment(profile)
    const allies = deployment.plan.npcSpecs.filter(s => s.faction === Faction.PLAYER)
    const enemies = deployment.plan.npcSpecs.filter(s => s.faction === Faction.BANDIT)
    expect(allies).toHaveLength(friendlyCount)
    expect(enemies).toHaveLength('banditCount' in tpl ? tpl.banditCount : 0)
    expect(allies[0].characterTier).toBe(4)
    expect(allies[0].visualAssetId).toBe(romanCaptain.visualAssetId)
    expect(deployment.campfireCenter).toBeDefined()
    expect(isCareerFieldNoCommandMission(profile.activeMission)).toBe(true)
    expect(deployment.plan.npcSpecs.some(s => s.faction === Faction.TOWN)).toBe(false)
  })

  test('keeps Recruit cavalry uncommandable while Captain cavalry retains official authority and Ranger gear', () => {
    const profile = createCareerProfile('roman')
    profile.ownedMounts = ['horse']
    profile.selectedMountId = 'horse'
    const sweepProfile = acceptCavalrySweep(profile, 'sweep-1', ['captain', ...Array.from({ length: 58 }, (_, i) => i === 28 ? 'ranger' : undefined)])!
    const sweepPlan = createCareerFelineSpawnPlan(sweepProfile)
    expect(sweepPlan.npcSpecs.filter(s => s.faction === Faction.PLAYER && s.cavalry)).toHaveLength(59)
    expect(sweepPlan.npcSpecs.filter(s => s.faction === Faction.BANDIT)).toHaveLength(40)
    expect(sweepPlan.npcSpecs[29].actorId).toBe('ranger')
    expect(sweepPlan.npcSpecs[29].loadout?.rangedWeaponId).toBe(T4_RANGER_BOW_RANGED_ID)
    expect(isCareerFieldNoCommandMission(sweepProfile.activeMission)).toBe(true)

    const captainProfile = createCareerProfile('viking')
    captainProfile.rank = 'captain'
    captainProfile.ownedMounts = ['horse']
    captainProfile.selectedMountId = 'horse'
    const capSweep = acceptCaptainCavalryCommand(captainProfile, 'cap-sweep-1', ['captain', ...Array.from({ length: 58 }, (_, i) => i === 28 ? 'ranger' : undefined)])!
    expect(capSweep.activeMission!.officialSquad?.type).toBe('mission-official')
    expect(capSweep.activeMission!.officialSquad?.actorIds.length).toBeGreaterThan(0)
    expect(isCareerFieldNoCommandMission(capSweep.activeMission)).toBe(false)
    expect(careerFieldBattleHeroAssetIds(capSweep)).toContain('maki-archer-t4')
  })

  test('preserves the distinct Veteran field formations and enemy squad memberships', () => {
    for (const vetId of ['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const) {
      const vetBase = createCareerProfile('roman')
      vetBase.rank = 'veteran'
      vetBase.ownedMounts = ['horse']
      vetBase.selectedMountId = 'horse'
      const def = getVeteranMissionDefinition(vetId)!
      const accepted = acceptVeteranMission(vetBase, vetId, {
        missionId: `m-${vetId}`,
        townCavalryReserveActorIds: vetId === 'veteran-scout-hunters' ? ['captain', 'ranger'] : [],
      })!
      const deploy = createCareerFieldDeployment(accepted)
      expect(deploy.plan.npcSpecs.filter(s => s.faction === Faction.PLAYER)).toHaveLength(def.friendlyCombatants - 1)
      expect(deploy.plan.npcSpecs.filter(s => s.faction === Faction.ENEMY)).toHaveLength(def.enemyCombatants)
      expect(Object.keys(deploy.enemySquadIdsByActorId)).toHaveLength(def.enemyCombatants)
    }
  })

  test('supports ambush alerts, squad engagement, and non-respawning legacy checkpoint migration', () => {
    const veteran = createCareerProfile('viking')
    veteran.rank = 'veteran'
    veteran.ownedMounts = ['horse']
    veteran.selectedMountId = 'horse'
    const accepted = acceptVeteranMission(veteran, 'veteran-spear-line-hunt', {
      missionId: 'legacy-vet',
      townCavalryReserveActorIds: [],
    })!
    const active = accepted.activeMission!
    const deadEnemy = active.targetActorIds[0]
    const injuredAlly = active.friendlyActorIds[0]
    active.deadTargetActorIds = [deadEnemy]
    active.actorHealth = { [injuredAlly]: { hp: 45, mountHp: 60 }, [deadEnemy]: { hp: 0 } }
    active.actorPositions = { [injuredAlly]: { x: 999, y: 0, z: 999, yaw: 0 } }
    active.playerHp = 77
    active.playerStamina = 50
    active.engagedEnemySquadIds = [1]

    const deployment = createCareerFieldDeployment(accepted)
    expect(careerFieldTacticalOrder(active, Faction.ENEMY)).toBe('defend')
    expect(careerFieldTacticalOrder(active, Faction.PLAYER)).toBe('attack')

    // Seed preserves dead enemy (no respawn), ally health, player HP, and uses fresh field positions.
    const seed = createCareerFieldCheckpointSeed(active, deployment.plan, {
      hp: 100, maxHp: 100, stamina: 100,
      x: deployment.plan.playerSpawn.x, y: 0, z: deployment.plan.playerSpawn.z, yaw: deployment.playerYaw,
      ammo: 30, shieldImpact: 0, stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    }, () => 0)
    expect(seed.actors[deadEnemy].status).toBe('dead')
    expect(seed.actors[injuredAlly].hp).toBe(45)
    expect(seed.actors[injuredAlly].position!.x).not.toBe(999)
    expect(seed.player.hp).toBe(77)

    // Ambush squad activation & bandit sweep alerts
    const triggered = findVeteranSquadsInRange(
      [{ x: deployment.enemyCenter.x, z: deployment.enemyCenter.z }],
      deployment.plan.npcSpecs.filter(s => s.faction === Faction.ENEMY).map(s => ({ actorId: s.actorId!, x: s.x, z: s.z })),
      deployment.enemySquadIdsByActorId,
      new Set([1]),
    )
    expect(triggered.length).toBeGreaterThan(0)
    expect(triggered).not.toContain(1)

    expect(resolveFieldDamagedTargetId({
      type: 'damage_applied', appliedDamage: 12,
      source: { faction: Faction.PLAYER, actorId: 'player' },
      target: { targetType: 'npc', targetId: deadEnemy, faction: Faction.BANDIT },
    } as never, deployment)).toBe(deadEnemy)
  })

  test('CareerProfileStore preserves felineBattle dead actor states across save/reload for migrated field missions', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    const profile = createCareerProfile('roman')
    const mission = createBanditActive('recruit-bandits-02')
    const killedEnemyId = mission.targetActorIds[0]!
    const survivingEnemyId = mission.targetActorIds[1]!
    const actors: Record<string, { status: 'reserve' | 'deployed' | 'dead'; hp?: number }> = Object.fromEntries(
      [...mission.friendlyActorIds, ...mission.targetActorIds].map(id => [id, { status: 'deployed' as const, hp: 90 }]),
    )
    actors[killedEnemyId] = { status: 'dead' as const, hp: 0 }
    actors[survivingEnemyId] = { status: 'deployed' as const, hp: 42 }
    mission.felineBattle = {
      ready: true,
      actors,
      playerStats: { damageDealt: 75, damageTaken: 12, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      player: {
        hp: 88,
        stamina: 95,
        dead: false,
        ammo: 0,
        shieldImpact: 0,
        position: { x: 4, y: 1.5, z: -12, yaw: 0.5 },
      },
    }
    profile.activeMission = mission
    expect(store.save(profile)).toBe(true)

    const reloaded = store.load()
    const restoredBattle = reloaded?.activeMission?.felineBattle
    expect(restoredBattle).toBeDefined()
    expect(restoredBattle?.actors[killedEnemyId]?.status).toBe('dead')
    expect(restoredBattle?.actors[survivingEnemyId]).toMatchObject({ status: 'deployed', hp: 42 })
    expect(restoredBattle?.player).toMatchObject({ hp: 88, stamina: 95, dead: false })
  })

  test('routes Faction.PLAYER target acquisition to Faction.BANDIT without changing bandit faction', () => {
    const npcGrid = new SpatialGrid<{ combatPosition: Vector3; hp: number; dead: boolean; faction: Faction; hostileToPlayer?: boolean; mount?: { isFlyingMount?: boolean } }>(20)
    const factionGrids = {
      [Faction.PLAYER]: new SpatialGrid<typeof npcGrid extends SpatialGrid<infer U> ? U : never>(20),
      [Faction.ENEMY]: new SpatialGrid<typeof npcGrid extends SpatialGrid<infer U> ? U : never>(20),
      [Faction.TOWN]: new SpatialGrid<typeof npcGrid extends SpatialGrid<infer U> ? U : never>(20),
      [Faction.BANDIT]: new SpatialGrid<typeof npcGrid extends SpatialGrid<infer U> ? U : never>(20),
    }
    const playerHostileGrid = new SpatialGrid<typeof npcGrid extends SpatialGrid<infer U> ? U : never>(20)
    const ally = { combatPosition: new Vector3(0, 0, 0), hp: 100, dead: false, faction: Faction.PLAYER }
    const bandit = { combatPosition: new Vector3(12, 0, 0), hp: 100, dead: false, faction: Faction.BANDIT }
    const peacefulTown = { combatPosition: new Vector3(4, 0, 0), hp: 100, dead: false, faction: Faction.TOWN, hostileToPlayer: false }

    populateNpcFactionGrids([ally, bandit, peacefulTown], npcGrid, factionGrids, playerHostileGrid)

    const allyHostileGrid = selectHostileNpcGrid(ally.faction, playerHostileGrid, factionGrids)
    const coordinator = new ChaseTargetCoordinator()
    const target = coordinator.findGroupTarget(ally as never, allyHostileGrid as never)
    expect(target).toBe(bandit as never)
    expect(bandit.faction).toBe(Faction.BANDIT)

    const banditHostileGrid = selectHostileNpcGrid(bandit.faction, playerHostileGrid, factionGrids)
    expect(banditHostileGrid.findNearest(bandit.combatPosition, () => true)).toBe(ally)
  })

  test('migrates legacy mountState HP, armor impact, and dead/unavailable horse state into felineBattle', () => {
    const profile = createCareerProfile('roman')
    const missionWithDeadHorse = createBanditActive('recruit-bandits-01')
    missionWithDeadHorse.mountState = { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] }
    const deployment = createCareerFieldDeployment({ ...profile, activeMission: missionWithDeadHorse })
    const deadSeed = createCareerFieldCheckpointSeed(missionWithDeadHorse, deployment.plan, {
      hp: 90, maxHp: 100, stamina: 80,
      x: 0, y: 0, z: 0, yaw: 0, ammo: 0, shieldImpact: 0,
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      mount: { mountId: 'horse', hp: 100, armorImpactRemaining: 0, mounted: true },
    }, () => 0)
    expect(deadSeed.player.mountHp).toBe(0)
    expect(deadSeed.player.mount).toMatchObject({ hp: 0, mounted: false })

    const missionWithDamagedArmored = createBanditActive('recruit-bandits-02')
    missionWithDamagedArmored.mountState = {
      activeMountId: 'armored-horse',
      hp: { 'armored-horse': 135 },
      armorImpact: { 'armored-horse': 18 },
      unavailable: [],
    }
    const armoredDeployment = createCareerFieldDeployment({ ...profile, activeMission: missionWithDamagedArmored })
    const damagedSeed = createCareerFieldCheckpointSeed(missionWithDamagedArmored, armoredDeployment.plan, {
      hp: 100, maxHp: 100, stamina: 100,
      x: 0, y: 0, z: 0, yaw: 0, ammo: 0, shieldImpact: 0,
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      mount: { mountId: 'armored-horse', hp: 200, armorImpactRemaining: 50, mounted: true },
    }, () => 0)
    expect(damagedSeed.player.mountHp).toBe(135)
    expect(damagedSeed.player.mount).toMatchObject({ hp: 135, armorImpactRemaining: 18, mounted: true })
    expect(resolveMigratedPlayerMountState(missionWithDamagedArmored, 'armored-horse')).toEqual({
      mountId: 'armored-horse',
      hp: 135,
      armorImpact: 18,
      unavailable: false,
    })
  })

  test('legacy Town Captain II save keeps roster resources but redeploys at the field spawn', () => {
    const captain = createCareerProfile('roman')
    captain.rank = 'captain'
    captain.ownedMounts = ['horse']
    captain.selectedMountId = 'horse'
    const accepted = acceptCaptainCavalryCommand(captain, 'cap-legacy', ['captain', ...Array.from({ length: 58 }, () => undefined)])!
    const active = accepted.activeMission!
    expect(active.felineBattle).toBeUndefined()
    const [, deployedId, deadId, untouchedId] = active.officialSquad!.actorIds
    const townPoint = { x: 999, y: 7, z: 998, yaw: 2 }
    active.officialSquad!.members = {
      [deployedId]: {
        status: 'deployed', hp: 80, ammo: 12, shieldImpact: 6, order: 'follow', position: townPoint,
        formation: { commandId: 4, position: townPoint, reached: true },
        mount: { hp: 50, armorImpactRemaining: 9, mounted: true, position: townPoint },
      },
      [deadId]: { status: 'dead', hp: 0, position: townPoint },
    }
    const deployment = createCareerFieldDeployment(accepted)
    const seed = createCareerFieldCheckpointSeed(active, deployment.plan, {
      hp: 130, maxHp: 130, stamina: 100, x: 0, y: 0, z: 0, yaw: 0, ammo: 0, shieldImpact: 0,
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    }, () => 0)
    const spec = deployment.plan.npcSpecs.find(entry => entry.actorId === deployedId)!
    const deployed = seed.actors[deployedId]
    expect(Object.keys(seed.actors)).toHaveLength(deployment.plan.npcSpecs.length)
    expect(deployed).toMatchObject({ status: 'reserve', hp: 80, ammo: 12, shieldImpact: 6, order: 'follow' })
    expect(deployed.position).toMatchObject({ x: spec.x, z: spec.z })
    expect(deployed.position!.x).not.toBe(townPoint.x)
    expect(deployed.formation).toBeUndefined()
    expect(deployed.mount).toMatchObject({ hp: 50, armorImpactRemaining: 9, mounted: true })
    expect(deployed.mount!.position).toMatchObject({ x: spec.x, z: spec.z })
    expect(seed.actors[deadId]).toMatchObject({ status: 'dead', hp: 0 })
    expect(seed.actors[untouchedId].status).toBe('reserve')
    expect(active.officialSquad!.actorIds).toHaveLength(29)
  })

  test('legacy Captain II orphan mount spawns at the field spawn from the migrated checkpoint on every reload', () => {
    const captain = createCareerProfile('roman')
    captain.rank = 'captain'
    captain.ownedMounts = ['horse']
    captain.selectedMountId = 'horse'
    const accepted = acceptCaptainCavalryCommand(captain, 'cap-orphan', ['captain', ...Array.from({ length: 58 }, () => undefined)])!
    const active = accepted.activeMission!
    const riderId = active.officialSquad!.actorIds[2]
    const townPoint = { x: 999, y: 7, z: 998, yaw: 2 }
    active.officialSquad!.members = {
      [riderId]: { status: 'dead', hp: 0, position: townPoint, mount: { hp: 61, armorImpactRemaining: 7, mounted: false, position: townPoint } },
    }
    const spec = createCareerFieldDeployment(accepted).plan.npcSpecs.find(entry => entry.actorId === riderId)!
    active.felineBattle = createCareerFieldCheckpointSeed(active, createCareerFieldDeployment(accepted).plan, {
      hp: 130, maxHp: 130, stamina: 100, x: 0, y: 0, z: 0, yaw: 0, ammo: 0, shieldImpact: 0,
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    }, () => 0)
    const seedMount = createCareerFelineOrphanMountPlan(accepted).find(entry => entry.actorId === riderId)!
    expect(seedMount.saved).toMatchObject({ hp: 61, armorImpactRemaining: 7, mounted: false, position: { x: spec.x, z: spec.z } })
    // Move the orphan in the new battlefield before saving. Its old Town record stays present.
    const fieldPoint = { x: spec.x + 4, y: 2, z: spec.z + 6, yaw: 0.7 }
    active.felineBattle.actors[riderId].mount!.position = fieldPoint
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(accepted)).toBe(true)
    const reloaded = store.load()!
    expect(reloaded.activeMission!.felineBattle!.actors[riderId]).toMatchObject({ status: 'dead', hp: 0 })
    expect(reloaded.activeMission!.officialSquad!.members![riderId].position).toEqual(townPoint)
    const orphan = createCareerFelineOrphanMountPlan(reloaded).find(entry => entry.actorId === riderId)!
    expect(orphan.saved).toMatchObject({ hp: 61, armorImpactRemaining: 7, mounted: false, position: fieldPoint })
    expect(orphan.saved.position.x).not.toBe(townPoint.x)
    expect(store.save(reloaded)).toBe(true)
    expect(createCareerFelineOrphanMountPlan(store.load()!).find(entry => entry.actorId === riderId)?.saved).toEqual(orphan.saved)

  })

  test('friendly charge follows the persisted one-shot flag, never deployment-ready ENGAGING phase', () => {
    const captain = createCareerProfile('roman')
    captain.rank = 'captain'
    captain.ownedMounts = ['horse']
    captain.selectedMountId = 'horse'
    const captainMission = acceptCaptainCavalryCommand(captain, 'cap-charge', ['captain', ...Array.from({ length: 58 }, () => undefined)])!.activeMission!
    expect(captainMission.kind).toBe('cavalry-sweep')
    for (const mission of [createBanditActive('recruit-bandits-01'), captainMission]) {
      mission.phase = 'ENGAGING'
      mission.sweepAlerted = true
      expect(careerFieldTacticalOrder(mission, Faction.PLAYER)).not.toBe('charge')
      mission.fieldFriendlyCharge = true
      expect(careerFieldTacticalOrder(mission, Faction.PLAYER)).toBe('charge')
    }
  })

  test('first field checkpoint keeps the skill-adjusted HP pool and clamps legacy HP against it', () => {
    const base = {
      stamina: 100, x: 0, y: 0, z: 0, yaw: 0, ammo: 0, shieldImpact: 0,
      stats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
    }
    const fresh = createBanditActive('recruit-bandits-01')
    const freshSeed = createCareerFieldCheckpointSeed(fresh, createCareerFieldDeployment({ ...createCareerProfile('roman'), activeMission: fresh }).plan,
      { ...base, hp: 130, maxHp: 130 }, () => 0)
    expect(freshSeed.player.hp).toBe(130)

    const legacy = createBanditActive('recruit-bandits-01')
    legacy.playerHp = 115
    const legacySeed = createCareerFieldCheckpointSeed(legacy, createCareerFieldDeployment({ ...createCareerProfile('roman'), activeMission: legacy }).plan,
      { ...base, hp: 130, maxHp: 130 }, () => 0)
    expect(legacySeed.player.hp).toBe(115)
  })

  test('keeps 80m sweep camp alert distinct from 60m friendly charge distance and preserves one-shot alert state', () => {
    expect(FIELD_SWEEP_DETECTION_RANGE).toBe(80)
    expect(FIELD_SWEEP_CHARGE_DISTANCE).toBe(60)
    const campCenter = { x: 0, z: 0 }
    expect(shouldTriggerSweepAlert([{ x: 0, z: 85 }], campCenter, false)).toBe(false)
    expect(shouldTriggerSweepAlert([{ x: 0, z: 75 }], campCenter, false)).toBe(true)
    expect(75 <= FIELD_SWEEP_CHARGE_DISTANCE).toBe(false)
    expect(shouldTriggerSweepAlert([{ x: 0, z: 200 }], campCenter, true)).toBe(true)
  })
})
