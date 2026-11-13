import { Vector3 } from 'three'
import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { beginPrisonBreak, claimCareerFieldResult, prisonRoster, settlePrisonBreak } from '../../src/career/CareerPrisonBreak'
import { CareerProfileStore, CAREER_STORAGE_KEY } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
const stats = { damageDealt: 10, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
function fixture() {
  let profile = createCareerProfile('roman'); profile.rank = 'captain'; profile.totalMerit = profile.availableMerit = 5000
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

afterEach(() => vi.unstubAllGlobals())

describe('Prison encounter persistence', () => {
  it('重整保留玩家與 NPC 戰損、拾劍歸屬與已開門', () => {
    const { profile, store } = fixture()
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.activeMission!.prisonBreak).toEqual(profile.activeMission!.prisonBreak)
  })

  it('拒絕重複拾取者的損壞 checkpoint，保留原始 bytes 供恢復', () => {
    const { profile, store, storage } = fixture()
    const invalid = structuredClone(profile)
    invalid.activeMission!.prisonBreak!.swords[2] = 'player'
    const bytes = JSON.stringify(invalid)
    storage.setItem(CAREER_STORAGE_KEY, bytes)
    expect(store.loadChecked().error).toBeTruthy()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
  })

  it('舊的已結算敗北存檔不追溯建立被俘流程', () => {
    const { profile, store, storage } = fixture()
    delete profile.activeMission!.prisonBreak
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile))
    expect(store.load()!.activeMission!.prisonBreak).toBeUndefined()
  })

  it('成功與獎勵同交易保存，拒絕寫入後重試僅入帳一次且不改原戰役或裝備部隊資料', () => {
    const { profile, store, storage } = fixture()
    expect(store.save(profile)).toBe(true)
    const before = store.load()!, bytes = storage.getItem(CAREER_STORAGE_KEY)
    storage.failWrites = true
    expect(settlePrisonBreak(before, 'victory', next => store.save(next))).toBeNull()
    expect(storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    expect(before.activeMission!.prisonBreak!.result).toBeUndefined()
    storage.failWrites = false
    const saved = settlePrisonBreak(before, 'victory', next => store.save(next))!
    expect(saved.totalMerit - before.totalMerit).toBe(100)
    expect(store.load()!.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100 })
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

  it('逃脫失敗保存零獎勵且原敗北死亡僅計算一次', () => {
    const { profile, store } = fixture()
    profile.activeMission!.prisonBreak!.combat.player!.knocked = true
    profile.activeMission!.prisonBreak!.combat.player!.hp = 0
    const saved = settlePrisonBreak(profile, 'failure', next => store.save(next))!
    expect(saved.totalMerit).toBe(profile.totalMerit)
    expect(saved.lifetimeStats.deaths).toBe(profile.lifetimeStats.deaths)
    expect(store.load()!.activeMission!.prisonBreak!.result).toEqual({ outcome: 'failure', merit: 0 })
  })

  it('正式場景以單次交易保存門外快照與獎勵，失敗重試使用凍結快照才顯示結果', () => {
    const { profile, store, storage } = fixture()
    expect(store.save(profile)).toBe(true)
    vi.stubGlobal('document', { exitPointerLock() {} })
    const state = profile.activeMission!.prisonBreak!, published = vi.fn()
    const position = new Vector3(0, .95, -39)
    const player = { position, group: { position }, dead: false, hp: 43, staminaValue: 71, facingYaw: 0, arrowCount: 0,
      shield: { shieldImpactRemaining: 0, captureDurability: () => ({}) },
      captureFootFall: () => ({ grounded: true, velocityY: 0, apexY: null }), clearTownAction() {} }
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { finishPrison(outcome: 'victory'): void }, {
      profile, store, player, combatElapsed: 5, knocked: new Set(),
      bodies: prisonRoster(state).map(entry => ({ actorId: entry.actorId, team: entry.team,
        npc: { dead: entry.team === 'enemy', hp: 35, combatPosition: new Vector3(3, 0, 0),
          group: { position: { y: 0 }, rotation: { y: 0 } }, combatAmmo: 0, shield: { shieldImpactRemaining: 0 } } })),
      input: { clear() {} }, tracker: { snapshot: () => ({ player: stats }) }, openPanel() {}, button() {}, openPrisonResult: published,
    })
    const writes = vi.spyOn(storage, 'setItem')
    storage.failWrites = true
    scene.finishPrison('victory')
    expect(writes).toHaveBeenCalledTimes(1)
    expect(published).not.toHaveBeenCalled()
    expect(store.load()!.activeMission!.prisonBreak!.combat.player!.z).toBe(-38)
    expect(store.load()!.activeMission!.prisonBreak!.result).toBeUndefined()
    player.hp = 1
    storage.failWrites = false
    scene.finishPrison('victory')
    expect(writes).toHaveBeenCalledTimes(2)
    expect(published).toHaveBeenCalledOnce()
    const restored = store.load()!
    expect(restored.activeMission!.prisonBreak!.combat.player).toMatchObject({ z: -39, hp: 43 })
    expect(restored.totalMerit - profile.totalMerit).toBe(100)
    expect(restored.activeMission!.prisonBreak!.result).toEqual({ outcome: 'victory', merit: 100 })
  })

})
