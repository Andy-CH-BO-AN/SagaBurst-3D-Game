import { describe, expect, test } from 'vitest'
import { createCareerProfile, claimCareerMission } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createActiveCareerMission, type CareerMissionKind } from '../../src/career/CareerMissionState'
import { getRecruitMissionTemplate, RECRUIT_MISSION_CATALOG, RETIRED_RECRUIT_PATROL_IDS } from '../../src/career/CareerMissionCatalog'
import { isCareerFelineBattle, createCareerFelineBattleLaunch, createCareerFelineSpawnPlan, careerFieldTacticalOrder } from '../../src/career/CareerBridgeBattle'
import { acceptCavalrySweep, acceptCaptainCavalryCommand, CAVALRY_SWEEP_ID } from '../../src/career/CavalrySweep'
import { CAPTAIN_PATROL_COMMAND_ID } from '../../src/career/CaptainMissionCatalog'
import { COMMANDER_DECAPITATION_ID, COMMANDER_SKY_RAID_ID } from '../../src/career/CommanderMissionCatalog'
import { townCaptainProfile } from '../../src/town/TownRules'
import { VETERAN_MISSION_IDS, acceptVeteranMission, getVeteranMissionDefinition } from '../../src/career/VeteranMission'
import {
  MIGRATED_CAREER_FIELD_TEMPLATE_IDS,
  careerFieldBattleHeroAssetIds,
  careerFieldBattleMapId,
  createCareerFieldCheckpointSeed,
  createCareerFieldDeployment,
  findVeteranSquadsInRange,
  isCareerFieldNoCommandMission,
  isMigratedCareerFieldMission,
  isMigratedCareerFieldTemplate,
  isMigratedFieldDeploymentReady,
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
      VETERAN_MISSION_IDS[3], // veteran-tragedy-of-the-scouts
      CAPTAIN_PATROL_COMMAND_ID,
      COMMANDER_SKY_RAID_ID,
      COMMANDER_DECAPITATION_ID,
      'commander-four-gate-defense',
      ...RETIRED_RECRUIT_PATROL_IDS,
    ]
    for (const id of excluded) {
      expect(isMigratedCareerFieldTemplate(id)).toBe(false)
      const kind: CareerMissionKind = id === VETERAN_MISSION_IDS[3] ? 'veteran-field'
        : id === CAPTAIN_PATROL_COMMAND_ID ? 'captain-patrol-command'
        : id.startsWith('commander-') ? id as CareerMissionKind
        : 'patrol'
      const mission = { ...createActiveCareerMission(id, 0, 1, 0, `${id}-x`), kind }
      expect(isMigratedCareerFieldMission(mission)).toBe(false)
      expect(isCareerFelineBattle(mission)).toBe(false)
    }
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

  test('preserves counts, loadouts, mounts, command authority and borrowed identities without Town civilians', () => {
    const profile = createCareerProfile('roman')
    profile.ownedMounts = ['horse']
    profile.selectedMountId = 'horse'

    // 1. Recruit bandits 01..04
    for (const id of ['recruit-bandits-01', 'recruit-bandits-02', 'recruit-bandits-03', 'recruit-bandits-04']) {
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
    }

    // 2. Recruit Cavalry Sweep (no command) vs Captain Cavalry Command (officialSquad kept)
    profile.activeMission = undefined
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

    // 3. Veteran field 3 missions
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

    expect(shouldTriggerSweepAlert([{ x: 0, z: 0 }], { x: 0, z: 58 }, false)).toBe(true)
    expect(shouldTriggerSweepAlert([{ x: 0, z: -100 }], { x: 0, z: 58 }, false)).toBe(false)
    expect(resolveFieldDamagedTargetId({
      type: 'damage_applied', appliedDamage: 12,
      source: { faction: Faction.PLAYER, actorId: 'player' },
      target: { targetType: 'npc', targetId: deadEnemy, faction: Faction.BANDIT },
    } as never, deployment)).toBe(deadEnemy)
  })

  test('settled migrated missions remain idempotent against duplicate claim', () => {
    const recruit = createCareerProfile('roman')
    recruit.activeMission = createBanditActive('recruit-bandits-01')
    const stats = { damageDealt: 150, damageTaken: 10, kills: 2, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
    const firstClaim = claimCareerMission(recruit, recruit.activeMission.id, 'victory', stats)
    const meritAfterFirst = firstClaim.profile.totalMerit
    const secondClaim = claimCareerMission(firstClaim.profile, recruit.activeMission.id, 'victory', stats)
    expect(secondClaim.profile.totalMerit).toBe(meritAfterFirst)
    expect(CAVALRY_SWEEP_ID).toBe('career-cavalry-sweep')
  })

  test('CareerProfileStore preserves felineBattle dead actor states across save/reload for migrated field missions', () => {
    const data = new Map<string, string>()
    const memoryStorage = {
      get length() { return data.size },
      clear() { data.clear() },
      getItem(key: string) { return data.get(key) ?? null },
      key(index: number) { return Array.from(data.keys())[index] ?? null },
      removeItem(key: string) { data.delete(key) },
      setItem(key: string, value: string) { data.set(key, value) },
    } satisfies Storage
    const store = new CareerProfileStore(memoryStorage)
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

  test('evaluates migrated field deployment readiness without requiring commanderMission', () => {
    const mission = createBanditActive('recruit-bandits-01')
    expect(mission.commanderMission).toBeUndefined()
    expect(isMigratedFieldDeploymentReady(mission, false)).toBe(false)
    expect(isMigratedFieldDeploymentReady(mission, true)).toBe(true)

    mission.felineBattle = {
      ready: true,
      actors: {},
      playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 },
      player: { hp: 100, stamina: 100, dead: false, ammo: 0, shieldImpact: 0, position: { x: 0, y: 0, z: 0, yaw: 0 } },
    }
    expect(isMigratedFieldDeploymentReady(mission, false)).toBe(true)
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
})
