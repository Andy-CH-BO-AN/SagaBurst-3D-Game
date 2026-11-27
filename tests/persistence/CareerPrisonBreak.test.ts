import { personalSquadFixture } from '../helpers/personalSquadFixture'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import { Vector3 } from 'three'
import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { arenaCombatCounts, checkpointArenaActors, type ArenaProgressBody } from '../../src/arena/ArenaCombatProgress'
import type { ArenaPhase } from '../../src/arena/ArenaOpeningGate'
import { PrisonBreakEncounter, type PrisonBody, type PrisonBreakHost, type PrisonBreakPropsPort, type PrisonPartnerView, type PrisonPickupRequest } from '../../src/arena/PrisonBreakEncounter'
import type { MissionReturnHome } from '../../src/career/CareerMissionReturnRecovery'
import { CoopSession, DEFAULT_COOP_PORT, type CoopBridge, type CoopLinkState, type CoopMessage } from '../../src/coop/CoopLink'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { beginPrisonBreak, claimCareerFieldResult, prisonRoster, prisonResultDescription, settlePrisonBreak, PRISON_COOP_PARTNER, type PrisonBreakState } from '../../src/career/CareerPrisonBreak'
import { CareerProfileStore, CAREER_STORAGE_KEY } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
const idleLink: CoopLinkState = { role: null, status: 'idle', address: null, port: DEFAULT_COOP_PORT, error: null }
const stats = { damageDealt: 10, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
function fixture(rank: 'captain' | 'commander' = 'captain') {
  let profile = createCareerProfile('roman'); Object.assign(profile, careerRankFixture(profile.faction, rank)); profile.totalMerit = profile.availableMerit = rank === 'commander' ? 80000 : 5000
  Object.assign(profile.inventory!.quantities, Object.fromEntries(['centurion_blade'].map(id => [id, 1]))); profile.ownedWeapons = ['centurion_blade']; profile.equipment = { melee: 'centurion_blade' }
  Object.assign(profile.inventory!.quantities, Object.fromEntries(['snow-leopard'].map(id => [id, 1]))); profile.ownedMounts = ['snow-leopard']; profile.selectedMountId = 'snow-leopard'
  profile.personalSquad = personalSquadFixture(profile, [{ id: 'personal:hr-1', type: 'soldier' }])
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

interface Sword { position: Vector3; visible: boolean }
interface World {
  profile: CareerProfile; phase: ArenaPhase; guest: boolean; owner: string; locked: boolean; yaw: number
  player: { position: Vector3; previousPosition: Vector3; dead: boolean }
  bodies: (PrisonBody & ArenaProgressBody)[]; knocked: Set<string>; partners: PrisonPartnerView[]; requests: PrisonPickupRequest[]
  retry: (() => void) | null
  swords: Sword[]; homes: MissionReturnHome[]; inventory: InventoryManager
}
function world(profile: CareerProfile, over: Partial<World> = {}): World {
  const inventory = new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
  onTestFinished(() => { inventory.dispose() })
  return { profile, phase: 'fight', guest: false, owner: 'player', locked: true, yaw: Math.PI,
    player: { position: new Vector3(), previousPosition: new Vector3(), dead: false }, bodies: [], knocked: new Set(), partners: [], requests: [], retry: null, swords: [], homes: [], inventory, ...over }
}
/** The scene's host port over the real store: commit adopts only a saved profile; a pause keeps the retry and clears the pickup focus. */
function prisonRig(w: World, store: CareerProfileStore) {
  const rec = { prompts: [] as (string | null)[], notices: [] as string[], selected: [] as (number | null)[],
    gates: [] as { open: boolean; animate: boolean }[], resyncs: 0, frozen: 0, taunts: [] as string[], unsaved: [] as (() => void)[],
    settled: 0, saveAttempts: 0 }
  const hud = { hidden: false, textContent: '' as string | null }
  const props: PrisonBreakPropsPort = {
    swords: w.swords, setSelectedSword: index => { rec.selected.push(index) },
    syncSwords: state => { w.swords.forEach((sword, i) => { sword.visible = state.swords[i] === undefined }) },
    setOpen: (open, animate) => { rec.gates.push({ open, animate }) },
  }
  const host: PrisonBreakHost = {
    arenaId: w.profile.activeMission!.prisonBreak!.combat.arenaId, get swordOwner() { return w.owner }, props, hud,
    prompt: { show: text => { rec.prompts.push(text) }, notify: text => { rec.notices.push(text) } }, inventory: w.inventory,
    isGuest: () => w.guest, phase: () => w.phase, profile: () => w.profile, adoptProfile: next => { w.profile = next },
    commit: next => { if (!store.save(next)) return false; w.profile = next; return true },
    save: next => { rec.saveAttempts++; return store.save(next) },
    captureProgress: () => {
      const next = cloneCareerProfile(w.profile), combat = next.activeMission!.prisonBreak!.combat
      const { friendly, enemy } = rosterIds(next.activeMission!.prisonBreak!)
      combat.actors = checkpointArenaActors([...friendly, ...enemy], w.bodies, w.knocked)
      return next
    },
    pauseForSave: retry => { w.retry = retry; encounter.clearPickupFocus() },
    savePending: () => w.retry !== null, panelOpen: () => false, bodies: () => w.bodies,
    guards: () => {
      const { friendly, enemy } = rosterIds(w.profile.activeMission!.prisonBreak!)
      const counts = arenaCombatCounts({ friendlyActorIds: friendly, targetActorIds: enemy }, w.bodies, w.knocked, w.player.dead, w.partners.length)
      return { total: enemy.length, standing: counts.enemyActive, friendlyAlive: counts.friendlyActive }
    },
    player: () => w.player, partners: () => w.partners, takePartnerRequests: () => w.requests.splice(0),
    inputLocked: () => w.locked, cameraYaw: () => w.yaw, resyncCoop: () => { rec.resyncs++ }, playerStats: () => stats,
    freezeForResult: () => { w.phase = 'result'; rec.frozen++ }, showTaunt: line => { rec.taunts.push(line) },
    showUnsaved: retry => { rec.unsaved.push(retry) }, settled: () => { rec.settled++ }, townReturn: () => w.homes,
  }
  const encounter = new PrisonBreakEncounter(host)
  const retryNow = () => { const retry = w.retry!; w.retry = null; retry() }
  return { encounter, rec, hud, retryNow }
}
function rosterIds(state: PrisonBreakState) {
  const roster = prisonRoster(state)
  return { friendly: roster.filter(e => e.team === 'friendly').map(e => e.actorId), enemy: roster.filter(e => e.team === 'enemy').map(e => e.actorId) }
}
function body(actorId: string, team: 'friendly' | 'enemy', from: Vector3, to = from.clone()) {
  const calls = { equipped: [] as (string | null | undefined)[], orders: [] as string[] }
  const npc = { dead: false, hp: 35, combatAmmo: 0, battlefieldUnarmed: team === 'friendly', combatPosition: to,
    group: { position: to, rotation: { y: 0 } }, shield: { shieldImpactRemaining: 0 },
    applyCareerEquipment: (loadout: { meleeWeaponId?: string | null }) => { calls.equipped.push(loadout.meleeWeaponId); return true },
    setTacticalOrder: (order: string) => { calls.orders.push(order) } } as unknown as PrisonBody['npc'] & ArenaProgressBody['npc'] & { dead: boolean; hp: number }
  return { actorId, team, previousPosition: from.clone(), npc, calls }
}
const friendlyBody = (actorId: string, from: Vector3, to = from.clone()) => body(actorId, 'friendly', from, to)
const guardBodies = (state: PrisonBreakState) => rosterIds(state).enemy.map(id => body(id, 'enemy', new Vector3(3, 0, -1)))
const sword = (x: number, y: number, z: number): Sword => ({ position: new Vector3(x, y, z), visible: true })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Prison encounter persistence', () => {
  it('越獄目標反映恢復與戰中倒下的看守，開門後提示出口並保留倒下觀戰說明', () => {
    const { profile, store } = fixture(), state = profile.activeMission!.prisonBreak!
    state.gateOpen = false
    const guards = guardBodies(state)
    const w = world(profile, { bodies: guards, knocked: new Set(guards.slice(0, 2).map(g => g.actorId)) })
    const { encounter, hud } = prisonRig(w, store)
    encounter.updateHud()
    expect(hud.textContent).toContain(`2／${guards.length}`)
    guards[2].npc.dead = true
    encounter.updateHud()
    expect(hud.textContent).toContain(`3／${guards.length}`)
    state.gateOpen = true; w.player.dead = true; encounter.updateHud()
    expect(hud.textContent).toContain('鐵門已開｜穿過出口')
    expect(hud.textContent).toContain('正在觀戰；友軍仍可逃脫')
    w.phase = 'result'; encounter.updateHud()
    expect(hud.hidden).toBe(true)
  })
  it('玩家拾劍先保存，失敗不裝備或顯示成功，重試後才取得臨時武器', () => {
    const { profile, store, storage } = fixture()
    const state = profile.activeMission!.prisonBreak!
    state.swords = {}; state.gateOpen = false
    expect(store.save(profile)).toBe(true)
    const originalInventory = store.load()!.ownedWeapons
    const savedBeforeCountdown = storage.getItem(CAREER_STORAGE_KEY)
    const w = world(profile, { phase: 'countdown', swords: [sword(0, 0, 1)] })
    const { encounter, rec, retryNow } = prisonRig(w, store)
    encounter.updatePickupFocus(); encounter.pickupSwords(true)
    expect(rec.prompts.at(-1)).toBeNull()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(savedBeforeCountdown)
    expect(w.inventory.activeMelee).toBeUndefined()
    w.phase = 'fight'
    encounter.updatePickupFocus()
    expect(rec.prompts.at(-1)).toContain('破舊羅馬短劍')
    storage.failWrites = true
    encounter.pickupSwords(true)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({})
    expect(w.inventory.activeMelee).toBeUndefined()
    expect(w.swords[0].visible).toBe(true)
    expect(rec.notices).toEqual([])
    expect(rec.prompts.at(-1)).toBeNull()
    storage.failWrites = false
    retryNow()
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'player' })
    expect(w.inventory.activeMelee?.id).toBe('gladius_rusty')
    expect(w.swords[0].visible).toBe(false)
    expect(rec.notices).toHaveLength(1)
    expect(store.load()!.equipment).toEqual(profile.equipment)
    expect(store.load()!.ownedWeapons).toEqual(originalInventory)
  })

  it('隊友仍可拾劍，開門後玩家焦點與拾取皆關閉', () => {
    const { profile, store } = fixture(), state = profile.activeMission!.prisonBreak!
    state.swords = {}; state.gateOpen = false
    expect(store.save(profile)).toBe(true)
    const prisoner = friendlyBody('original:prisoner:0', new Vector3(0, 0, 1))
    const w = world(profile, { swords: [sword(0, 0, 1), sword(0, 0, 1.5)], bodies: [prisoner] })
    const { encounter, rec } = prisonRig(w, store)
    encounter.updatePickupFocus()
    encounter.pickupSwords(false)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'original:prisoner:0' })
    expect(prisoner.calls.equipped).toEqual(['gladius_rusty'])
    encounter.pickupSwords(true)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: 'original:prisoner:0' })
    w.profile.activeMission!.prisonBreak!.gateOpen = true
    encounter.updatePickupFocus(); encounter.pickupSwords(true)
    expect(rec.prompts.at(-1)).toBeNull()
    expect(rec.selected.at(-1)).toBeNull()
    expect(w.swords[1].visible).toBe(true)
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

  it('玩家倒下後隊友續戰，最後看守倒下才開門，隊友實際過門的結果保存失敗凍結並重試一次入帳', () => {
    const { profile, store, storage } = fixture()
    const state = profile.activeMission!.prisonBreak!
    state.gateOpen = false
    Object.assign(state.combat.player!, { knocked: true, hp: 0 })
    const survivor = 'original:prisoner:0'
    for (const entry of prisonRoster(state)) Object.assign(state.combat.actors[entry.actorId],
      entry.team === 'enemy' || entry.actorId === survivor ? { status: 'active', hp: 35 } : { status: 'knocked', hp: 0 })
    expect(store.save(profile)).toBe(true)
    const friend = friendlyBody(survivor, new Vector3(3, 0, -1), new Vector3(3, 0, -1))
    const guards = guardBodies(state)
    const w = world(profile, { bodies: [friend, ...guards], knocked: new Set(rosterIds(state).friendly.filter(id => id !== survivor)),
      player: { position: new Vector3(0, .95, -38), previousPosition: new Vector3(0, .95, -38), dead: true } })
    const { encounter, rec } = prisonRig(w, store)
    expect(encounter.resolveResult()).toBe(false)
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    // A restored knockout and new casualties leave one active guard blocking the gate.
    const [knockedGuard, ...standingGuards] = guards
    const lastGuard = standingGuards.at(-1)!
    w.knocked.add(knockedGuard.actorId)
    for (const guard of standingGuards.slice(0, -1)) guard.npc.dead = true
    expect(encounter.openGateIfCleared()).toBe(true)
    expect(rec.gates).toEqual([])
    expect(store.load()!.activeMission!.prisonBreak!.gateOpen).toBe(false)
    lastGuard.npc.dead = true
    const meritBeforeGate = store.load()!.totalMerit
    expect(encounter.openGateIfCleared()).toBe(true)
    expect(rec.gates).toEqual([{ open: true, animate: true }])
    expect(store.load()!.activeMission!.prisonBreak!.gateOpen).toBe(true)
    expect(store.load()!.totalMerit).toBe(meritBeforeGate)
    expect(rec.settled).toBe(0)
    friend.npc.combatPosition.set(0, 0, -39)
    storage.failWrites = true
    expect(encounter.resolveResult()).toBe(true)
    expect(rec.saveAttempts).toBe(1)
    expect(rec.settled).toBe(0)
    expect(rec.unsaved).toHaveLength(1)
    expect(store.load()!.activeMission!.prisonBreak!.combat.player!.z).toBe(-38)
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    expect(encounter.settlementPending).toBe(true)
    friend.npc.hp = 1
    storage.failWrites = false
    encounter.finish('failure', 'player')
    expect(rec.saveAttempts).toBe(2)
    expect(rec.settled).toBe(1)
    expect(encounter.settlementPending).toBe(false)
    const restored = store.load()!
    expect(restored.activeMission!.prisonBreak!.combat.player).toMatchObject({ knocked: true, hp: 0 })
    expect(restored.activeMission!.prisonBreak!.combat.actors[survivor]).toMatchObject({ z: -39, hp: 35 })
    expect(restored.totalMerit - profile.totalMerit).toBe(100)
    expect(restored.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100, escapedBy: survivor })
    expect(prisonResultDescription(restored.activeMission!.prisonBreak!)).toBe('隊友成功逃脫，你未能逃出')
    expect(restored.activeMission!.result).toEqual(profile.activeMission!.result)
    expect(restored.lifetimeStats).toEqual(profile.lifetimeStats)
    encounter.finish('victory', survivor)
    expect(rec.saveAttempts).toBe(2)
    expect(rec.settled).toBe(1)
    expect(store.load()!.totalMerit).toBe(restored.totalMerit)
  })

  it('玩家倒下時場景改用旁觀鏡頭、開門後只派隊友出門，開門保存被拒時暫停，結算交給 encounter 且未保存時整個戰鬥畫格凍結', () => {
    const { profile } = fixture(), state = profile.activeMission!.prisonBreak!
    state.gateOpen = false
    Object.assign(state.combat.player!, { knocked: true, hp: 0 })
    const calls = { updates: 0, targets: [] as Vector3[], travels: 0, frozenFrames: 0, spectates: 0, orbits: 0, pauses: 0, checkpoints: 0, finished: [] as string[] }
    const gate = { cleared: false }
    const position = new Vector3(3, 0, -1)
    const npc = { dead: false, hp: 35, combatAmmo: 0, shield: { shieldImpactRemaining: 0 }, combatPosition: position, group: { position, rotation: { y: 0 } }, battlefieldUnarmed: true,
      update: () => { calls.updates++ }, updateTownTravel: () => { calls.travels++ },
      assignFormationTarget: (_order: number, target: Vector3) => { calls.targets.push(target.clone()) } }
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
      updateCamera(dt: number): void; updateBodies(dt: number): void; captureProgress(): CareerProfile | null; update(dt: number): void; advancePhase(dt: number): void; finish(outcome: 'victory' | 'failure'): void
    }, {
      localProfile: profile, knocked: new Set<string>(), combatElapsed: 0, disposed: false,
      player: { dead: true, hp: 0, position, staminaValue: 71, facingYaw: 0, arrowCount: 0, group: { position }, shield: { shieldImpactRemaining: 0, captureDurability: () => ({}) },
        currentMount: null, isFalling: false, captureFootFall: () => ({ grounded: true, velocityY: 0, apexY: null }) }, spectator: { update: () => { calls.spectates++ } }, orbit: { update: () => { calls.orbits++ } },
      camera: { position: new Vector3() }, input: { clear() {}, consumeKeyE: () => false }, arenaId: state.combat.arenaId,
      opening: { phase: 'fight', advance: () => false }, bodies: [{ actorId: 'original:prisoner:0', team: 'friendly', previousPosition: position.clone(), npc }],
      navigation: { sync() {}, beginFrame() {} }, arena: { obstacles: [], update() { calls.frozenFrames++ } }, damageNumbers: { update() {} },
      props: { swords: [] }, settled: false, checkpointFight: () => { calls.checkpoints++ },
      pauseForPrisonSave: () => { calls.pauses++ },
      encounter: { settlementPending: false, clearPickupFocus() {}, resolveResult: () => false, openGateIfCleared: () => gate.cleared, finish: (outcome: string) => { calls.finished.push(outcome) } },
    })
    scene.updateCamera(0)
    expect(calls).toMatchObject({ spectates: 1, orbits: 0 })
    scene.updateBodies(0)
    expect(calls).toMatchObject({ updates: 1, targets: [], travels: 0 })
    // The checkpoint the scene hands the encounter keeps the standing prisoner and knocks every actor without a body.
    const checkpoint = scene.captureProgress()!.activeMission!.prisonBreak!.combat.actors
    expect(checkpoint['original:prisoner:0']).toMatchObject({ status: 'active', hp: 35, x: 3 })
    expect(checkpoint['original:prisoner:1']).toMatchObject({ status: 'knocked', hp: 0 })
    state.gateOpen = true
    scene.updateBodies(0)
    expect(calls.targets).toEqual([new Vector3(0, 0, -40.65)])
    expect(calls.travels).toBe(1)
    scene.advancePhase(0)
    expect(calls).toMatchObject({ pauses: 1, checkpoints: 0 }) // A refused gate-opening save pauses with a retry instead of checkpointing on.
    gate.cleared = true
    scene.advancePhase(0)
    expect(calls).toMatchObject({ pauses: 1, checkpoints: 0 })
    scene.finish('victory')
    expect(calls.finished).toEqual(['victory'])
    // One real fight frame hands the E press, focus and HUD to the encounter.
    const frame = { claims: [] as boolean[], focus: 0, hud: 0, coop: [] as unknown[] }
    Object.assign(scene, {
      encounter: { settlementPending: false, clearPickupFocus() {}, resolveResult: () => false, openGateIfCleared: () => true,
        pickupSwords: (pressed: boolean) => { frame.claims.push(pressed) }, updatePickupFocus: () => { frame.focus++ }, updateHud: () => { frame.hud++ },
        applyCoopState: (message: CoopMessage) => { frame.coop.push(message.swords) } },
      updateBodies() {}, melee() {}, resolveBodies() {}, mountImpacts() {}, updateShots() {}, updateMarkers() {}, updateCamera() {},
      elapsed: 0, knocked: new Set<string>(), skillsDirty: false, aimPoint: new Vector3(), previousPlayerPosition: new Vector3(),
      input: { clear() {}, consumeKeyE: () => true, consumeWheelStep: () => 0 }, orbit: { cameraYaw: 0, getAimPoint: () => new Vector3() },
      player: { dead: false, isGrounded: false, position, update() {}, hpRatio: 1 }, inventory: {}, skills: { getRangedMultiplier: () => 1 },
      weaponWheelUI: { update() {} }, hp: { setFill() {} }, hud: { update() {} }, openingHud: { update() {} },
      arena: { obstacles: [], update() { calls.frozenFrames++ } }, props: { swords: [], update() {} }, opening: { phase: 'fight', remaining: 0, advance: () => false, pauseIfUnlocked() {} },
    })
    scene.update(0)
    expect(frame).toEqual({ claims: [true], focus: 1, hud: 1, coop: [] })
    // Co-op: the real session's messages reach the guest's encounter and the host's pickup queue.
    let deliver: (data: string) => void = () => {}
    const bridge: CoopBridge = { status: async () => idleLink, host: async () => idleLink, join: async () => idleLink, leave: async () => {},
      send: () => {}, onMessage: listener => { deliver = data => listener(data); return () => {} }, onState: () => () => {} }
    const session = new CoopSession(bridge), pickups: PrisonPickupRequest[] = []
    Object.assign(scene, { coopUnsubscribe: [], coopPickupRequests: pickups, disposed: false })
    const coopScene = scene as unknown as { listenPrisonCoop(session: CoopSession, role: 'host' | 'guest'): void }
    coopScene.listenPrisonCoop(session, 'guest'); coopScene.listenPrisonCoop(session, 'host')
    // Frames carry the sender's hub seat: the host is 0, this guest 1.
    deliver('0' + JSON.stringify({ t: 'prisonState', swords: { 0: PRISON_COOP_PARTNER }, gateOpen: false }))
    deliver('1' + JSON.stringify({ t: 'prisonPickup', index: 1 }))
    deliver('1' + JSON.stringify({ t: 'prisonPickup', index: 'x' }))
    expect(frame.coop).toEqual([{ 0: PRISON_COOP_PARTNER }])
    expect(pickups).toEqual([{ seat: 1, index: 1 }])
    const opening = (scene as unknown as { opening: { phase: string } }).opening
    opening.phase = 'countdown'; deliver('1' + JSON.stringify({ t: 'prisonPickup', index: 0 })); opening.phase = 'fight'
    expect(pickups).toEqual([{ seat: 1, index: 1 }]) // A guest request before the fight is live is ignored.
    Object.assign(scene, { encounter: { settlementPending: true, clearPickupFocus() {} } })
    scene.update(0) // Unsaved result: only the arena and damage numbers tick; no body, player or shot steps.
    expect(calls).toMatchObject({ updates: 1, travels: 1, frozenFrames: 2 })
    expect(frame).toMatchObject({ claims: [true], focus: 1, hud: 1 })
  })

  it('正式越獄結果返回先保存原戰敗的 Town／HR 復位，寫入失敗留場重試後才離開，原敗北與軍功收據不重算', () => {
    const { profile, store, storage } = fixture('commander')
    profile.townCommandSquad = { type: 'town-command', squadId: 1, townFaction: 'roman', actorIds: ['captain'],
      contribution: emptyPersonalContribution(), state: 'FOLLOWING', authorized: true, sceneKey: 'town-home',
      commandRank: 'commander', squads: [{ squadId: 1, actorIds: ['captain'] }], commandedActorIds: ['captain'],
      members: { captain: { status: 'dead', hp: 0, order: 'charge' } } }
    profile.activeMission!.personalSquad!.members['personal:hr-1'].eaglePadId = 'private-eagle-north'
    profile.personalSquadRuntime = structuredClone(profile.activeMission!.personalSquad!)
    profile.personalSquadRuntime.members['personal:hr-1'].eaglePadId = 'stale-town-pad'
    const settled = settlePrisonBreak(profile, 'victory', next => store.save(next), 'player')!
    const beforeReturn = structuredClone(settled)
    const w = world(settled, { homes: [{ spec: { id: 'captain', role: 'captain', duty: 'service', x: 0, z: 0, yaw: 0 } }] })
    const { encounter } = prisonRig(w, store)
    const left = { count: 0 }
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { returnToTown(): void }, {
      localProfile: settled, encounter, leave: () => { left.count++ }, openPanel() {}, button() {},
    })
    const bytes = storage.getItem(CAREER_STORAGE_KEY)
    storage.failWrites = true
    scene.returnToTown()
    expect(left.count).toBe(0)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    storage.failWrites = false
    scene.returnToTown()
    expect(left.count).toBe(1)
    const returned = store.load()!
    expect(returned.activeMission).toBeUndefined()
    expect(returned.townCommandSquad).toMatchObject({ state: 'TRAINING', members: { captain: { status: 'reserve' } } })
    expect(returned.personalSquadRuntime).toMatchObject({ returnToHR: true, state: 'RESERVE',
      members: { 'personal:hr-1': { status: 'reserve', eaglePadId: 'private-eagle-north' } } })
    expect(returned.personalSquadRuntime!.members['personal:hr-1'].hp).toBeUndefined()
    expect(returned.claimedBattleIds).toEqual(settled.claimedBattleIds)
    expect(returned.totalMerit).toBe(settled.totalMerit)
    expect(returned.availableMerit).toBe(settled.availableMerit)
    expect(returned.lifetimeStats).toEqual(settled.lifetimeStats)
    expect(settled.activeMission!.result!.outcome).toBe('failure')
    expect(settled).toEqual(beforeReturn)
  })

  it('合作客機拾劍只是請求：主機在距離內保存為隊友歸屬，客機只在記憶體副本裝備且不寫存檔', () => {
    const { profile, store, storage } = fixture(), state = profile.activeMission!.prisonBreak!
    state.swords = {}; state.gateOpen = false
    expect(store.save(profile)).toBe(true)
    const partner = { seat: 1, combatPosition: new Vector3(0, 0, 2), previousPosition: null }
    const second = { seat: 2, combatPosition: new Vector3(20, 0, 20), previousPosition: null }
    const hostWorld = world(profile, { swords: [sword(0, 0, 1), sword(6, 0, 6)], partners: [partner, second],
      requests: [{ seat: 1, index: 1 }, { seat: 1, index: 0 }, { seat: 2, index: 1 }],
      player: { position: new Vector3(9, 0, 9), previousPosition: new Vector3(9, 0, 9), dead: false } })
    const host = prisonRig(hostWorld, store)
    host.encounter.pickupSwords(false)
    // Sword 1 is beyond the guest's reach on the host; sword 0 is saved for the partner and re-sent at once.
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: PRISON_COOP_PARTNER })
    expect(hostWorld.swords.map(entry => entry.visible)).toEqual([false, true])
    expect(host.rec.resyncs).toBe(1)
    // One sword per partner: seat 1 already holds one; seat 2 claims under its own id, and the save still loads.
    partner.combatPosition.set(6, 0, 5); second.combatPosition.set(6, 0, 5)
    hostWorld.requests.push({ seat: 1, index: 1 }, { seat: 2, index: 1 }); host.encounter.pickupSwords(false)
    expect(store.load()!.activeMission!.prisonBreak!.swords).toEqual({ 0: PRISON_COOP_PARTNER, 1: 'coop-partner-2' })
    expect(store.loadChecked().error).toBeFalsy()

    // The guest page holds a copy of the host's save; the host's prison state arms its Player there only.
    const hostBytes = storage.getItem(CAREER_STORAGE_KEY)
    const guestWorld = world(structuredClone(profile), { guest: true, owner: PRISON_COOP_PARTNER, swords: [sword(0, 0, 1), sword(6, 0, 6)] })
    const guest = prisonRig(guestWorld, store)
    const message: CoopMessage = { t: 'prisonState', swords: { 0: PRISON_COOP_PARTNER }, gateOpen: true, fight: true, guards: 0, outcome: null }
    guest.encounter.applyCoopState(message)
    expect(guestWorld.inventory.activeMelee?.id).toBe('gladius_rusty')
    expect(guest.rec.notices).toHaveLength(1)
    expect(guest.rec.gates).toEqual([{ open: true, animate: true }])
    expect(guestWorld.profile.activeMission!.prisonBreak!.gateOpen).toBe(true)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(hostBytes)
  })

  it('合作隊友存活時主機與戰俘全倒不算失敗，隊友實際過門才結算成功並記錄隊友逃脫', () => {
    const { profile, store } = fixture()
    const state = profile.activeMission!.prisonBreak!
    Object.assign(state.combat.player!, { knocked: true, hp: 0 })
    for (const entry of prisonRoster(state)) Object.assign(state.combat.actors[entry.actorId], { status: 'knocked', hp: 0 })
    expect(store.save(profile)).toBe(true)
    const position = new Vector3(4, .95, -30)
    // The living partner is the team's only standing body; every roster actor is already knocked.
    const w = world(profile, { knocked: new Set(prisonRoster(state).map(entry => entry.actorId)),
      player: { position, previousPosition: position.clone(), dead: true },
      partners: [{ seat: 2, combatPosition: new Vector3(0, 0, -37), previousPosition: new Vector3(0, 0, -37) }] })
    const { encounter, rec } = prisonRig(w, store)
    expect(encounter.resolveResult()).toBe(false)
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    w.partners[0].combatPosition.set(0, 0, -39.5)
    expect(encounter.resolveResult()).toBe(true)
    const saved = store.loadChecked()
    expect(saved.error).toBeFalsy()
    expect(saved.profile!.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100, escapedBy: 'coop-partner-2' })
    expect(saved.profile!.totalMerit - profile.totalMerit).toBe(100)
    expect(prisonResultDescription(saved.profile!.activeMission!.prisonBreak!)).toBe('隊友成功逃脫，你未能逃出')
    expect(rec.settled).toBe(1)
  })

  it('合作客機的技能進度只經 commitSkills 存入客機自己的存檔，不寫主機越獄存檔，寫入失敗保持待存', () => {
    const { profile, store, storage } = fixture()
    expect(store.save(profile)).toBe(true)
    const hostBytes = storage.getItem(CAREER_STORAGE_KEY)
    const skillState = { oneHanded: { level: 3, xp: 10 } }
    const commitSkills = vi.fn(() => false)
    const guest = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { flushSkills(): void; skillsDirty: boolean }, {
      profile, store, skills: { skillState }, skillsDirty: true, coopPlayerSource: { read: () => profile, commit: vi.fn(), commitSkills },
    })
    guest.flushSkills()
    expect(commitSkills).toHaveBeenLastCalledWith(skillState)
    expect(guest.skillsDirty).toBe(true)
    commitSkills.mockReturnValue(true)
    guest.flushSkills()
    expect(guest.skillsDirty).toBe(false)
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(hostBytes)
  })

})
