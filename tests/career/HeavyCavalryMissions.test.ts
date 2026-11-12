import { describe, expect, it } from 'vitest'
import { availableCareerMissionsForPage } from '../../src/career/CareerMissionCatalog'
import { careerMissionTierForTemplateId } from '../../src/career/CareerMissionTier'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, CAREER_STORAGE_KEY, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { acceptHeavyFieldMission, createCareerHeavySpawnPlan, getHeavyFieldMissionAvailability } from '../../src/career/HeavyFieldMission'
import { Faction } from '../../src/combat/CombatFaction'
import { AIType } from '../../src/world/NPC'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { MemoryStorage } from '../helpers/memoryStorage'
import { acceptCommanderMission } from '../../src/career/CommanderMissionCatalog'
import {
  CAPTAIN_STEEL_AVALANCHE_ID, COMMANDER_IRON_LEGION_ID, SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID,
  createHeavyFieldState,
  heavyCommandPlan, heavyFrontlineDistance, isHeavyFormationComplete, heavyTacticalOrder,
  parseHeavyFieldState, planVeteranCaltropDefense, shouldIssueHeavyFormation, shouldTriggerHeavyCounterCharge,
  shouldTriggerHeavyEnemyCharge, veteranCaltropWorldRects,
} from '../../src/career/HeavyCavalryMissions'

function damage(targetType: 'npc' | 'mount', id: string, appliedDamage: number): CombatEvent {
  return { type: 'damage_applied', method: 'melee', requestedDamage: 10, appliedDamage,
    source: { actorId: 'p', actorType: 'player', allegiance: 0, characterFaction: 'roman' },
    target: targetType === 'npc' ? { targetId: id, targetType, name: 'x' } : { targetId: `${id}:mount`, targetType, name: 'm', ownerActorId: id } } as unknown as CombatEvent
}

describe('heavy cavalry tactical triggers', () => {
  const enemies = new Set(['e1'])

  it('敵方 Charge 只由騎士或坐騎的有效傷害觸發，且只觸發一次', () => {
    const state = createHeavyFieldState(VETERAN_IRON_TIDE_ID)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 0), enemies)).toBe(false)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'stranger', 9), enemies)).toBe(false)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('mount', 'e1', 4), enemies)).toBe(true)
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 4), enemies)).toBe(true)
    state.enemyChargeTriggered = true
    expect(shouldTriggerHeavyEnemyCharge(VETERAN_IRON_TIDE_ID, state, damage('npc', 'e1', 4), enemies)).toBe(false)
    // Captain's infantry only charge on the 20m rule, never on damage.
    expect(shouldTriggerHeavyEnemyCharge(CAPTAIN_STEEL_AVALANCHE_ID, createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID), damage('npc', 'e1', 4), enemies)).toBe(false)
  })

  it('Soldier 先行軍再列陣，20m 反衝鋒只在列陣後觸發一次並可還原', () => {
    const state = createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', state)).toBe('follow')
    expect(shouldTriggerHeavyCounterCharge(state, 10)).toBe(false)
    expect(shouldIssueHeavyFormation(state, { x: 0, z: 0 }, { x: 30, z: 0 })).toBe(false)
    expect(shouldIssueHeavyFormation(state, { x: 28, z: 0 }, { x: 30, z: 0 })).toBe(true)
    state.formationIssued = true
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', state)).toBe('formation')
    expect(shouldTriggerHeavyCounterCharge(state, 20.01)).toBe(false)
    expect(shouldTriggerHeavyCounterCharge(state, 20)).toBe(true)
    state.counterChargeTriggered = true
    expect(shouldTriggerHeavyCounterCharge(state, 5)).toBe(false)
    const restored = parseHeavyFieldState(JSON.parse(JSON.stringify(state)), SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyTacticalOrder(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', restored!)).toBe('charge')
    expect(parseHeavyFieldState({ version: 1, formationIssued: false, enemyChargeTriggered: false, counterChargeTriggered: 1 }, SOLDIER_IRON_ENCOUNTER_ID)).toBeUndefined()
  })

  it('Captain 開場雙方 Defend，我方進入 20m 後敵方全軍 Charge 且不覆蓋我方軍令', () => {
    const state = createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID)
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'friendly', state)).toBe('defend')
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', state)).toBe('defend')
    state.counterChargeTriggered = true
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', state)).toBe('charge')
    expect(heavyTacticalOrder(CAPTAIN_STEEL_AVALANCHE_ID, 'friendly', state)).toBe('defend')
  })

  it('Soldier 敵軍在我方列陣完成前原地待命，完成（或逾時）後才 Attack', () => {
    const state = createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'enemy', state).kind).toBe('hold')
    expect(isHeavyFormationComplete([1, 2, 50, 60], 5)).toBe(false)
    expect(isHeavyFormationComplete([1, 2, 2.5, 1, 1, 1, 1, 50], 5)).toBe(true)
    expect(isHeavyFormationComplete([50, 60], 25)).toBe(true)
    state.enemyReleased = true
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'enemy', state).kind).toBe('plain')
  })

  it('Soldier / Veteran 敵軍在受傷前為真正的 Attack（不使用會強制 Defend 的 Formation 守位）', () => {
    for (const id of [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID] as const) {
      const state = createHeavyFieldState(id)
      state.enemyReleased = true
      expect(heavyCommandPlan(id, 'enemy', state)).toEqual({ order: 'attack', kind: 'plain' })
      state.enemyChargeTriggered = true
      expect(heavyCommandPlan(id, 'enemy', state)).toEqual({ order: 'charge', kind: 'charge' })
    }
    expect(heavyCommandPlan(VETERAN_IRON_TIDE_ID, 'friendly', createHeavyFieldState(VETERAN_IRON_TIDE_ID)).kind).toBe('hold')
    expect(heavyCommandPlan(SOLDIER_IRON_ENCOUNTER_ID, 'friendly', createHeavyFieldState(SOLDIER_IRON_ENCOUNTER_ID)).kind).toBe('march')
    expect(heavyCommandPlan(CAPTAIN_STEEL_AVALANCHE_ID, 'enemy', createHeavyFieldState(CAPTAIN_STEEL_AVALANCHE_ID)).kind).toBe('hold')
  })

  it('前線距離取兩軍最近的單位而非中心點', () => {
    expect(heavyFrontlineDistance([{ x: 0, z: 0 }, { x: 0, z: -200 }], [{ x: 0, z: 18 }, { x: 0, z: 300 }])).toBe(18)
  })
})

describe('heavy cavalry field missions in Career', () => {
  const profileFor = (rank: 'soldier' | 'veteran' | 'captain' | 'commander', faction: 'roman' | 'viking' = 'roman') => {
    const profile = createCareerProfile(faction)
    profile.rank = rank
    profile.totalMerit = 20_000
    profile.availableMerit = 20_000
    profile.ownedMounts = ['black-cat']
    profile.selectedMountId = 'black-cat'
    return profile
  }

  it('Tier 與任務頁面：Soldier 不再被歸入 Recruit，新任務只出現在對應軍階頁面', () => {
    const ids = [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID, CAPTAIN_STEEL_AVALANCHE_ID, COMMANDER_IRON_LEGION_ID]
    expect(ids.map(careerMissionTierForTemplateId)).toEqual([2, 3, 4, 5])
    expect(availableCareerMissionsForPage(profileFor('soldier'), 'soldier').map(t => t.id)).toContain(SOLDIER_IRON_ENCOUNTER_ID)
    expect(availableCareerMissionsForPage(profileFor('soldier'), 'recruit').map(t => t.id)).not.toContain(SOLDIER_IRON_ENCOUNTER_ID)
    expect(availableCareerMissionsForPage(profileFor('veteran'), 'veteran').map(t => t.id)).toContain(VETERAN_IRON_TIDE_ID)
    expect(getHeavyFieldMissionAvailability(profileFor('soldier'), VETERAN_IRON_TIDE_ID).unlocked).toBe(false)
    expect(getHeavyFieldMissionAvailability(profileFor('captain'), SOLDIER_IRON_ENCOUNTER_ID).unlocked).toBe(true)
  })

  it('接受後兵力、重騎兵 Preset 與初始距離（>200m）在各軍階任務正確', () => {
    const missionIds = [SOLDIER_IRON_ENCOUNTER_ID, VETERAN_IRON_TIDE_ID, CAPTAIN_STEEL_AVALANCHE_ID] as const
    for (const missionId of missionIds) {
      const rank = missionId === SOLDIER_IRON_ENCOUNTER_ID ? 'soldier' : missionId === VETERAN_IRON_TIDE_ID ? 'veteran' : 'captain'
      const accepted = acceptHeavyFieldMission(profileFor(rank), missionId, `test:${missionId}`)!
      const plan = createCareerHeavySpawnPlan(accepted)
      const friendly = plan.npcSpecs.filter(spec => spec.faction === Faction.PLAYER), enemy = plan.npcSpecs.filter(spec => spec.faction === Faction.ENEMY)
      expect(friendly).toHaveLength(accepted.activeMission!.friendlyActorIds.length)
      expect(enemy).toHaveLength(accepted.activeMission!.targetActorIds.length)
      expect(new Set(plan.npcSpecs.map(spec => spec.actorId)).size).toBe(plan.npcSpecs.length)
      if (missionId !== CAPTAIN_STEEL_AVALANCHE_ID) expect(enemy.every(spec => spec.presetId === 'viking_heavy_cavalry' && spec.loadout?.mountId === 'snow-leopard' && spec.loadout.shieldId)).toBe(true)
      else expect(friendly.every(spec => spec.presetId === 'roman_heavy_cavalry' && spec.characterTier === 4 && spec.loadout?.mountId === 'armored-horse')).toBe(true)
      expect(friendly.every(spec => (spec.loadout?.rangedWeaponId ? spec.aiType === AIType.RANGED : spec.aiType === AIType.MELEE))).toBe(true)
      const heavyClass = { roman: { 4: 'centurion', 5: 'byzantine-cataphract' }, viking: { 4: 'dragon-oathguard', 5: 'ironblood-warlord' } } as const
      const elite = plan.npcSpecs.filter(spec => spec.presetId?.endsWith('_heavy_cavalry') && spec.characterTier! >= 4)
      expect(elite.every(spec => spec.combatProfileId === heavyClass[spec.characterFaction][spec.characterTier as 4 | 5])).toBe(true)
      const eliteCounts = { [SOLDIER_IRON_ENCOUNTER_ID]: [9, 1], [VETERAN_IRON_TIDE_ID]: [25, 5], [CAPTAIN_STEEL_AVALANCHE_ID]: [29, 0] }[missionId]
      expect([4, 5].map(tier => elite.filter(spec => spec.characterTier === tier).length)).toEqual(eliteCounts)
      expect(heavyFrontlineDistance(friendly, enemy)).toBeGreaterThan(200)
      expect(accepted.activeMission!.commanderMission?.heavyField?.enemyChargeTriggered).toBe(false)
      const restored = parseCareerProfile(JSON.parse(JSON.stringify(accepted)))
      expect(restored?.activeMission?.templateId).toBe(missionId)
      expect(restored?.activeMission?.commanderMission?.heavyField).toEqual(accepted.activeMission!.commanderMission!.heavyField)
    }
  })

  it('Veteran 單位不與拒馬重疊，Captain 官方軍令編制為 29 人單隊且私兵另列', () => {
    const veteran = acceptHeavyFieldMission(profileFor('veteran'), VETERAN_IRON_TIDE_ID, 'v')!
    expect([veteran.activeMission!.officialSquad, veteran.activeMission!.personalSquad]).toEqual([undefined, undefined])
    expect(acceptHeavyFieldMission(profileFor('soldier'), SOLDIER_IRON_ENCOUNTER_ID, 's')!.activeMission!.officialSquad).toBeUndefined()
    expect(acceptHeavyFieldMission(profileFor('captain'), SOLDIER_IRON_ENCOUNTER_ID, 's')!.activeMission!.officialSquad).toBeUndefined()
    const rects = veteranCaltropWorldRects(planVeteranCaltropDefense(), 'roman')
    const friendly = createCareerHeavySpawnPlan(veteran).npcSpecs.filter(spec => spec.faction === Faction.PLAYER)
    expect(friendly.filter(spec => rects.some(r => spec.x > r.minX - 1 && spec.x < r.maxX + 1 && spec.z > r.minZ - 1 && spec.z < r.maxZ + 1))).toEqual([])
    const captainProfile = profileFor('captain')
    captainProfile.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
    const captain = acceptHeavyFieldMission(captainProfile, CAPTAIN_STEEL_AVALANCHE_ID, 'c')!.activeMission!
    expect(captain.officialSquad?.actorIds).toHaveLength(29)
    expect(captain.officialSquad?.actorIds.every(id => captain.friendlyActorIds.includes(id))).toBe(true)
    expect(captain.personalSquad?.memberIds).toEqual(['personal:hr-1'])
  })

  it('saves and loads Heavy Field active missions with strict rank authority, legacy revocation, and fail-closed corrupt protection', () => {
    // 1. Captain accepts Soldier mission: save() === true -> loadChecked() has same mission, personalSquad, officialSquad === undefined
    const store1 = new CareerProfileStore(new MemoryStorage())
    const captainSoldier = profileFor('captain')
    captainSoldier.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
    const acceptedCaptainSoldier = acceptHeavyFieldMission(captainSoldier, SOLDIER_IRON_ENCOUNTER_ID, 'cap-sol')!
    expect(store1.save(acceptedCaptainSoldier)).toBe(true)
    const loadedCaptainSoldier = store1.loadChecked().profile!
    expect(loadedCaptainSoldier.activeMission?.templateId).toBe(SOLDIER_IRON_ENCOUNTER_ID)
    expect(loadedCaptainSoldier.activeMission?.officialSquad).toBeUndefined()
    expect(loadedCaptainSoldier.activeMission?.personalSquad?.memberIds).toEqual(['personal:hr-1'])

    // 2. Captain accepts Steel Avalanche: save() === true -> loadChecked() keeps 29-man squad
    const store2 = new CareerProfileStore(new MemoryStorage())
    const captainSteel = profileFor('captain')
    captainSteel.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
    const acceptedCaptainSteel = acceptHeavyFieldMission(captainSteel, CAPTAIN_STEEL_AVALANCHE_ID, 'cap-steel')!
    expect(store2.save(acceptedCaptainSteel)).toBe(true)
    const loadedCaptainSteel = store2.loadChecked().profile!
    expect(loadedCaptainSteel.activeMission?.templateId).toBe(CAPTAIN_STEEL_AVALANCHE_ID)
    expect(loadedCaptainSteel.activeMission?.officialSquad?.actorIds).toHaveLength(29)
    expect(loadedCaptainSteel.activeMission?.personalSquad?.memberIds).toEqual(['personal:hr-1'])

    // 3. Commander accepts Commander Iron Legion: valid squads roundtrip, while forged squads reject
    const store3 = new CareerProfileStore(new MemoryStorage())
    const commanderProfile = profileFor('commander')
    const acceptedCommander = acceptCommanderMission(commanderProfile, COMMANDER_IRON_LEGION_ID, 'cmd-legion')!
    expect(store3.save(acceptedCommander)).toBe(true)
    const loadedCommander = store3.loadChecked().profile!
    expect(loadedCommander.activeMission?.officialSquad?.commandRank).toBe('commander')
    expect(loadedCommander.activeMission?.officialSquad?.squads?.length).toBeGreaterThan(1)

    // Forged claim: unofficial stranger actorId injected into squad
    const forgedCommander = structuredClone(acceptedCommander)
    forgedCommander.activeMission!.officialSquad!.actorIds = ['stranger_actor_id']
    expect(store3.save(forgedCommander)).toBe(false)

    // 4. Legacy Captain Soldier save with unauthorized officialSquad: safely revokes officialSquad while retaining mission, casualties & state
    const storage4 = new MemoryStorage()
    const store4 = new CareerProfileStore(storage4)
    const legacyCaptainSave = structuredClone(acceptedCaptainSoldier)
    legacyCaptainSave.activeMission!.officialSquad = {
      type: 'mission-official',
      missionId: 'cap-sol',
      townFaction: 'roman',
      squadId: 1,
      actorIds: acceptedCaptainSoldier.activeMission!.friendlyActorIds.slice(0, 10),
      contribution: { kills: 0, damageTaken: 0, structuresDestroyed: 0, gateBreaches: 0, damageDealt: 0, arrowHits: 0, meleeHits: 0, mountDamage: 0 },
    } as any
    storage4.setItem(CAREER_STORAGE_KEY, JSON.stringify(legacyCaptainSave))
    const migratedProfile = store4.loadChecked().profile!
    expect(migratedProfile.activeMission?.templateId).toBe(SOLDIER_IRON_ENCOUNTER_ID)
    expect(migratedProfile.activeMission?.officialSquad).toBeUndefined()
    expect(migratedProfile.activeMission?.personalSquad?.memberIds).toEqual(['personal:hr-1'])

    // 5. Corrupted active Heavy Field: fail-closed, does not save/drop mission
    expect(store4.save(migratedProfile)).toBe(true)
    const validBytes = storage4.getItem(CAREER_STORAGE_KEY)!
    const corruptedSave = structuredClone(migratedProfile)
    corruptedSave.activeMission!.targetActorIds = ['corrupted_target']
    expect(store4.save(corruptedSave)).toBe(false)
    expect(storage4.getItem(CAREER_STORAGE_KEY)).toBe(validBytes)
  })
})
