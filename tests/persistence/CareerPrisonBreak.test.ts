import * as townRules from '../../src/town/TownRules'
import { commitPrisonBreakReturn } from '../../src/career/CareerMissionReturnRecovery'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Vector3 } from 'three'
import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { InteractionFocus } from '../../src/world/InteractionFocus'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { beginPrisonBreak, claimCareerFieldResult, prisonRoster, prisonResultDescription, settlePrisonBreak } from '../../src/career/CareerPrisonBreak'
import { CareerProfileStore, CAREER_STORAGE_KEY } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
const stats = { damageDealt: 10, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
function fixture(rank: 'captain' | 'commander' = 'captain') {
  let profile = createCareerProfile('roman'); profile.rank = rank; profile.totalMerit = profile.availableMerit = rank === 'commander' ? 80000 : 5000
  profile.ownedWeapons = ['centurion_blade']; profile.equipment = { melee: 'centurion_blade' }
  profile.ownedMounts = ['snow-leopard']; profile.selectedMountId = 'snow-leopard'
  profile.personalSquad = { members: [{ id: 'personal:hr-1', type: 'soldier' }] }
  profile = acceptHeavyFieldMission(profile, 'soldier-iron-encounter', 'original')!
  profile = beginPrisonBreak(claimCareerFieldResult(profile, 'original', 'failure', stats, stats, 'viking').profile)!
  profile.activeMission!.personalSquad!.state = 'ACTIVE'
  profile.activeMission!.personalSquad!.members['personal:hr-1'] = { status: 'dead', hp: 0, order: 'follow' }
  const prison = profile.activeMission!.prisonBreak!
  prison.combat.stage = 'engaged'
  prison.combat.player = { knocked: false, hp: 43, stamina: 71, x: 0, y: .95, z: -38, yaw: 0 }
  prison.combat.actors = Object.fromEntries(prisonRoster(prison).map(entry => [entry.actorId,
    { status: entry.team === 'enemy' ? 'knocked' : 'active', hp: entry.team === 'enemy' ? 0 : 35, x: 3, y: 0, z: -1, yaw: 2, ammo: 0, shieldImpact: 0 }]))
  prison.swords = { 0: 'player', 1: 'original:prisoner:0' }; prison.gateOpen = true
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  return { profile, store, storage }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Prison encounter persistence', () => {
  it('玩家拾劍先保存，失敗不裝備或顯示成功，重試後才取得臨時武器', () => {
    const { profile, store, storage } = fixture()
    const state = profile.activeMission!.prisonBreak!
    state.swords = {}; state.gateOpen = false
    expect(store.save(profile)).toBe(true)
    const originalInventory = store.load()!.ownedWeapons
    const savedBeforeCountdown = storage.getItem(CAREER_STORAGE_KEY)
    vi.stubGlobal('document', { exitPointerLock() {} })
    const inventory = new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
    const swords = [{ position: new Vector3(0, 0, 1), visible: true }]
    const props = { swords, setSelectedSword: vi.fn(), syncSwords: (saved: typeof state) => { swords[0].visible = saved.swords[0] === undefined } }
    const feedback = vi.fn(), show = vi.fn()
    let retry = () => {}
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
      phase: string; updatePickupFocus(): void; pickupSwords(pressed: boolean): void
    }, {
      profile, store, inventory, props, pickupFocus: new InteractionFocus(), phase: 'countdown', panel: null,
      player: { position: new Vector3(), dead: false }, orbit: { cameraYaw: Math.PI }, bodies: [],
      input: { isLocked: true, clear() {} }, pickupHud: { show, notify: feedback },
      openPanel() {}, closePanel() {}, button: (_label: string, action: () => void) => { retry = action },
    })
    scene.updatePickupFocus(); scene.pickupSwords(true)
    expect(show).toHaveBeenLastCalledWith(null)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBeforeCountdown)
    expect(inventory.activeMelee).toBeUndefined()
    scene.phase = 'fight'
    scene.updatePickupFocus()
    expect(show).toHaveBeenLastCalledWith(expect.stringContaining('破舊羅馬短劍'))
    storage.failWrites = true
    scene.pickupSwords(true)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({})
    expect(inventory.activeMelee).toBeUndefined()
    expect(swords[0].visible).toBe(true)
    expect(feedback).not.toHaveBeenCalled()
    expect(show).toHaveBeenLastCalledWith(null)
    storage.failWrites = false
    retry()
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'player' })
    expect(inventory.activeMelee?.id).toBe('gladius_rusty')
    expect(swords[0].visible).toBe(false)
    expect(feedback).toHaveBeenCalledOnce()
    expect(store.load()!.equipment).toEqual(profile.equipment)
    expect(store.load()!.ownedWeapons).toEqual(originalInventory)
    inventory.dispose()
  })

  it('隊友仍可拾劍，開門後玩家焦點與拾取皆關閉', () => {
    const { profile, store } = fixture(), state = profile.activeMission!.prisonBreak!
    state.swords = {}; state.gateOpen = false
    expect(store.save(profile)).toBe(true)
    const swords = [{ position: new Vector3(0, 0, 1), visible: true }, { position: new Vector3(0, 0, 1.5), visible: true }]
    const props = { swords, setSelectedSword: vi.fn(), syncSwords: (saved: typeof state) => swords.forEach((sword, i) => { sword.visible = saved.swords[i] === undefined }) }
    const npc = { dead: false, battlefieldUnarmed: true, combatPosition: new Vector3(0, 0, 1), applyCareerEquipment: vi.fn(), setTacticalOrder: vi.fn() }
    const show = vi.fn()
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
      profile: typeof profile; updatePickupFocus(): void; pickupSwords(pressed: boolean): void
    }, {
      profile, store, props, pickupFocus: new InteractionFocus(), phase: 'fight', panel: null,
      player: { position: new Vector3(), dead: false }, orbit: { cameraYaw: Math.PI },
      bodies: [{ team: 'friendly', actorId: 'original:prisoner:0', npc }],
      input: { isLocked: true }, pickupHud: { show },
    })
    scene.updatePickupFocus()
    scene.pickupSwords(false)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'original:prisoner:0' })
    expect(npc.applyCareerEquipment).toHaveBeenCalledOnce()
    scene.pickupSwords(true)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'original:prisoner:0' })
    scene.profile.activeMission!.prisonBreak!.gateOpen = true
    scene.updatePickupFocus(); scene.pickupSwords(true)
    expect(show).toHaveBeenLastCalledWith(null)
    expect(props.setSelectedSword).toHaveBeenLastCalledWith(null)
    expect(swords[1].visible).toBe(true)
  })
  it('重整保留玩家與 NPC 戰損、拾劍歸屬與已開門', () => {
    const { profile, store } = fixture()
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.prisonBreak).toEqual(profile.activeMission!.prisonBreak)
  })

  it('拒絕重複拾劍者及看守冒充逃出者的損壞 checkpoint，保留原始 bytes 供恢復', () => {
    const { profile, store, storage } = fixture()
    const invalid = structuredClone(profile)
    invalid.activeMission!.prisonBreak!.swords[2] = 'player'
    const forged = structuredClone(profile)
    forged.activeMission!.prisonBreak!.stage = 'result'
    forged.activeMission!.prisonBreak!.result = { outcome: 'victory', merit: 100, escapedBy: 'original:guard:0' }
    for (const checkpoint of [invalid, forged]) {
      const bytes = JSON.stringify(checkpoint)
      storage.setItem(CAREER_STORAGE_KEY, bytes)
      expect(store.loadChecked().error).toBeTruthy()
      expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    }
  })

  it('舊存檔不回推被俘，未完成越獄沿新規則恢復，已保存的舊結果不重開', () => {
    const { profile, store, storage } = fixture()
    const legacy = structuredClone(profile)
    legacy.activeMission!.prisonBreak!.version = 1
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(legacy))
    expect(store.load()!.activeMission!.prisonBreak).toEqual(profile.activeMission!.prisonBreak)
    const sealed = legacy.activeMission!.prisonBreak!
    sealed.stage = 'result'; sealed.combat.player!.knocked = true; sealed.combat.player!.hp = 0
    sealed.result = { outcome: 'failure', merit: 0 }
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(legacy))
    expect(store.load()!.activeMission!.prisonBreak).toEqual(sealed)
    const restoredLegacy = store.load()!
    expect(settlePrisonBreak(restoredLegacy, 'victory', () => { throw new Error('舊結果不可重發獎') })).toEqual(restoredLegacy)
    delete profile.activeMission!.prisonBreak
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
    expect(store.load()!.activeMission!.prisonBreak).toBeUndefined()
  })

  it('成功與獎勵同交易保存，拒絕寫入後重試僅入帳一次且不改原戰役或裝備部隊資料', () => {
    const { profile, store, storage } = fixture()
    expect(store.save(profile)).toBe(true)
    const before = store.load()!, bytes = storage.getItem(CAREER_STORAGE_KEY)
    storage.failWrites = true
    expect(settlePrisonBreak(before, 'victory', next => store.save(next), 'player')).toBeNull()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    expect(before.activeMission!.prisonBreak!.result).toBeUndefined()
    storage.failWrites = false
    const saved = settlePrisonBreak(before, 'victory', next => store.save(next), 'player')!
    expect(saved.totalMerit - before.totalMerit).toBe(100)
    expect(store.load()!.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100, escapedBy: 'player' })
    expect(prisonResultDescription(store.load()!.activeMission!.prisonBreak!)).toBe('你穿過了敵軍的鐵門。')
    const duplicate = settlePrisonBreak(store.load()!, 'victory', () => { throw new Error('重複結算不可再保存') })!
    expect(duplicate.totalMerit).toBe(saved.totalMerit)
    expect(duplicate.lifetimeStats).toEqual(before.lifetimeStats)
    expect(duplicate.activeMission!.result).toEqual(before.activeMission!.result)
    expect(duplicate.activeMission!.personalSquad).toEqual(before.activeMission!.personalSquad)
    expect(duplicate.townCommandSquad).toEqual(before.townCommandSquad)
    expect(duplicate.equipment).toEqual(before.equipment)
    expect(duplicate.ownedMounts).toEqual(before.ownedMounts)
    expect(duplicate.personalSquad).toEqual(before.personalSquad)
    expect(duplicate.careerMissionCompletionsByTier).toEqual(before.careerMissionCompletionsByTier)
  })

  it('無人逃出且玩家與最後一名戰俘全倒才保存失敗，零獎勵且原敗北死亡不重算', () => {
    const { profile, store } = fixture()
    profile.activeMission!.prisonBreak!.combat.player!.knocked = true
    profile.activeMission!.prisonBreak!.combat.player!.hp = 0
    const friends = prisonRoster(profile.activeMission!.prisonBreak!).filter(entry => entry.team === 'friendly')
    for (const { actorId } of friends.slice(1)) Object.assign(profile.activeMission!.prisonBreak!.combat.actors[actorId], { status: 'knocked', hp: 0 })
    expect(settlePrisonBreak(profile, 'failure', next => store.save(next))).toBeNull()
    Object.assign(profile.activeMission!.prisonBreak!.combat.actors[friends[0].actorId], { status: 'knocked', hp: 0 })
    const saved = settlePrisonBreak(profile, 'failure', next => store.save(next))!
    expect(saved.totalMerit).toBe(profile.totalMerit)
    expect(saved.lifetimeStats.deaths).toBe(profile.lifetimeStats.deaths)
    expect(store.load()!.activeMission!.prisonBreak!.result).toEqual({ outcome: 'failure', merit: 0 })
  })

  it('玩家倒下後隊友續戰，開門只派隊友出門，實際過門的結果保存失敗凍結並重試一次入帳', () => {
    const { profile, store, storage } = fixture()
    vi.stubGlobal('document', { exitPointerLock() {} })
    const state = profile.activeMission!.prisonBreak!, published = vi.fn()
    state.gateOpen = false
    Object.assign(state.combat.player!, { knocked: true, hp: 0 })
    const survivor = 'original:prisoner:0'
    for (const entry of prisonRoster(state)) Object.assign(state.combat.actors[entry.actorId],
      entry.team === 'enemy' || entry.actorId === survivor ? { status: 'active', hp: 35 } : { status: 'knocked', hp: 0 })
    expect(store.save(profile)).toBe(true)
    const position = new Vector3(0, .95, -38)
    const player = { position, group: { position }, dead: true, hp: 0, staminaValue: 71, facingYaw: 0, arrowCount: 0,
      shield: { shieldImpactRemaining: 0, captureDurability: () => ({}) },
      captureFootFall: () => ({ grounded: true, velocityY: 0, apexY: null }), clearTownAction() {} }
    const bodies = prisonRoster(state).filter(entry => entry.team === 'enemy' || entry.actorId === survivor).map(entry => {
      const position = new Vector3(3, 0, -1)
      return { actorId: entry.actorId, team: entry.team, previousPosition: position.clone(), npc: {
        dead: false, hp: 35, combatPosition: position, group: { position, rotation: { y: 0 } },
        battlefieldUnarmed: entry.team === 'friendly', combatAmmo: 0, shield: { shieldImpactRemaining: 0 },
        update: vi.fn(), updateTownTravel: vi.fn(), assignFormationTarget: vi.fn() } }
    })
    const spectator = { update: vi.fn() }, orbit = { update: vi.fn() }, props = { setOpen: vi.fn(), setSelectedSword: vi.fn(), swords: [] }
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
      advancePhase(dt: number): void; updateBodies(dt: number): void; updateCamera(dt: number): void;
      update(dt: number): void; finishPrison(outcome: 'victory' | 'failure', escapedBy?: string): void;
    }, {
      profile, store, player, bodies, spectator, orbit, props, phase: 'fight', combatElapsed: 5, checkpointClock: 0,
      knocked: new Set(Object.keys(state.combat.actors).filter(id => state.combat.actors[id].status === 'knocked')),
      previousPlayerPosition: position.clone(), arenaId: state.combat.arenaId, camera: { position: new Vector3() },
      navigation: { sync() {}, beginFrame() {} }, arena: { obstacles: [], update() {} }, damageNumbers: { update() {} },
      input: { clear() {}, consumeKeyE: () => false }, pickupFocus: new InteractionFocus(), tracker: { snapshot: () => ({ player: stats }) }, openPanel() {}, button() {}, openPrisonResult: published,
    })
    scene.updateCamera(0)
    expect(spectator.update).toHaveBeenCalledOnce()
    expect(orbit.update).not.toHaveBeenCalled()
    scene.updateBodies(0)
    scene.advancePhase(0)
    expect(bodies[0].npc.update).toHaveBeenCalledOnce()
    expect(published).not.toHaveBeenCalled()
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    for (const body of bodies.filter(body => body.team === 'enemy')) body.npc.dead = true
    const meritBeforeGate = store.load()!.totalMerit
    scene.advancePhase(0)
    expect(props.setOpen).toHaveBeenCalledWith(true, true)
    expect(store.load()!.activeMission!.prisonBreak!.gateOpen).toBe(true)
    expect(store.load()!.totalMerit).toBe(meritBeforeGate)
    expect(published).not.toHaveBeenCalled()
    scene.updateBodies(0)
    const friend = bodies[0]
    expect(friend.npc.assignFormationTarget.mock.lastCall?.[1]).toEqual(new Vector3(0, 0, -40.65))
    expect(friend.npc.updateTownTravel).toHaveBeenCalledOnce()
    const writes = vi.spyOn(storage, 'setItem')
    friend.npc.combatPosition.set(0, 0, -39)
    storage.failWrites = true
    scene.advancePhase(0)
    expect(writes).toHaveBeenCalledTimes(1)
    expect(published).not.toHaveBeenCalled()
    expect(store.load()!.activeMission!.prisonBreak!.combat.player!.z).toBe(-38)
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    scene.update(0)
    expect(friend.npc.updateTownTravel).toHaveBeenCalledOnce()
    friend.npc.hp = 1
    storage.failWrites = false
    scene.finishPrison('failure', 'player')
    expect(writes).toHaveBeenCalledTimes(2)
    expect(published).toHaveBeenCalledOnce()
    const restored = store.load()!
    expect(restored.activeMission!.prisonBreak!.combat.player).toMatchObject({ knocked: true, hp: 0 })
    expect(restored.activeMission!.prisonBreak!.combat.actors[friend.actorId]).toMatchObject({ z: -39, hp: 35 })
    expect(restored.totalMerit - profile.totalMerit).toBe(100)
    expect(restored.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100, escapedBy: friend.actorId })
    expect(prisonResultDescription(restored.activeMission!.prisonBreak!)).toBe('隊友成功逃脫，你未能逃出')
    expect(restored.activeMission!.result).toEqual(profile.activeMission!.result)
    expect(restored.lifetimeStats).toEqual(profile.lifetimeStats)
    scene.finishPrison('victory', friend.actorId)
    expect(writes).toHaveBeenCalledTimes(2)
    expect(store.load()!.totalMerit).toBe(restored.totalMerit)
  })


  it('關押載入失敗返回依原任務快照返營保留私人停機位，原敗北與軍功收據不重算', () => {
    const { profile, store } = fixture()
    const original = profile.activeMission!
    original.personalSquad!.members['personal:hr-1'].eaglePadId = 'private-eagle-east'
    profile.personalSquadRuntime = structuredClone(original.personalSquad!)
    profile.personalSquadRuntime.members['personal:hr-1'].eaglePadId = 'stale-town-pad'
    const before = structuredClone(profile)
    const saved = commitPrisonBreakReturn(profile, original.id, [], next => store.save(next))!
    expect(saved.activeMission).toBeUndefined()
    expect(saved.personalSquadRuntime).toMatchObject({ state: 'RESERVE', sceneKey: 'town-home', returnToHR: true,
      members: { 'personal:hr-1': { status: 'reserve', eaglePadId: 'private-eagle-east' } } })
    expect(saved.personalSquadRuntime!.members['personal:hr-1'].hp).toBeUndefined()
    expect(saved.claimedBattleIds).toEqual(before.claimedBattleIds)
    expect(saved.totalMerit).toBe(before.totalMerit)
    expect(saved.availableMerit).toBe(before.availableMerit)
    expect(saved.lifetimeStats).toEqual(before.lifetimeStats)
    expect(profile.activeMission!.result!.outcome).toBe('failure')
    expect(profile).toEqual(before)
  })

  it('正式越獄結果返回先保存原戰敗的 Town／HR 復位，寫入失敗留場重試後才離開', () => {
    const { profile, store, storage } = fixture('commander')
    // External home-roster boundary only; the return owner receives the one service used by this case.
    vi.spyOn(townRules, 'townRoster').mockReturnValue([{ id: 'captain', role: 'captain', duty: 'service', tier: 4,
      mounted: true, training: false, assaultObjective: true, index: 0, x: 0, z: 0, yaw: 0 }])
    profile.townCommandSquad = { type: 'town-command', squadId: 1, townFaction: 'roman', actorIds: ['captain'],
      contribution: emptyPersonalContribution(), state: 'FOLLOWING', authorized: true, sceneKey: 'town-home',
      commandRank: 'commander', squads: [{ squadId: 1, actorIds: ['captain'] }], commandedActorIds: ['captain'],
      members: { captain: { status: 'dead', hp: 0, order: 'charge' } } }
    profile.activeMission!.personalSquad!.members['personal:hr-1'].eaglePadId = 'private-eagle-north'
    const settled = settlePrisonBreak(profile, 'victory', next => store.save(next), 'player')!
    const leave = vi.fn()
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { returnToTown(): void }, {
      profile: settled, store, leave, openPanel() {}, button() {},
    })
    const bytes = storage.getItem(CAREER_STORAGE_KEY)
    storage.failWrites = true
    scene.returnToTown()
    expect(leave).not.toHaveBeenCalled()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    storage.failWrites = false
    scene.returnToTown()
    expect(leave).toHaveBeenCalledOnce()
    const returned = store.load()!
    expect(returned.activeMission).toBeUndefined()
    expect(returned.townCommandSquad).toMatchObject({ state: 'TRAINING', members: { captain: { status: 'reserve' } } })
    expect(returned.personalSquadRuntime).toMatchObject({ returnToHR: true, state: 'RESERVE',
      members: { 'personal:hr-1': { status: 'reserve', eaglePadId: 'private-eagle-north' } } })
    expect(returned.claimedBattleIds).toEqual(settled.claimedBattleIds)
    expect(returned.totalMerit).toBe(settled.totalMerit)
    expect(returned.lifetimeStats).toEqual(settled.lifetimeStats)
    expect(settled.activeMission!.result!.outcome).toBe('failure')
  })

})
