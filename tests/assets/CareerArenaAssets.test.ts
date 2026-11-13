import { afterEach, describe, expect, it, vi } from 'vitest'
import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { beginPrisonBreak, claimCareerFieldResult } from '../../src/career/CareerPrisonBreak'
import { createArenaTrialMission } from '../../src/career/CareerArenaTrials'
import { HumanoidAssetRegistry } from '../../src/world/HumanoidAssetRegistry'
import * as highTier from '../../src/world/HighTierEquipment'
import * as paladin from '../../src/world/PaladinEquipment'
import * as maki from '../../src/world/MakiRangerEquipment'

const confiscated = ['byzantine_standard_lance_t5', 'byzantine_eagle_shield_t5']
const stats = { damageDealt: 0, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
const preload = (profile: CareerProfile) => {
  const entry = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { preloadCombatAssets(): Promise<void> }, { profile })
  return entry.preloadCombatAssets()
}
function boundary() {
  vi.spyOn(HumanoidAssetRegistry, 'preload').mockResolvedValue()
  vi.spyOn(HumanoidAssetRegistry, 'preloadAsset').mockResolvedValue()
  const paladinLoad = vi.spyOn(paladin, 'preloadPaladinEquipment').mockResolvedValue()
  const highLoad = vi.spyOn(highTier, 'preloadHighTierEquipment').mockResolvedValue()
  const makiLoad = vi.spyOn(maki, 'preloadMakiRangerBow').mockResolvedValue()
  const selected = vi.spyOn(highTier, 'prepareByzantineEquipment').mockImplementation(async ids =>
    [...ids].some(id => confiscated.includes(String(id))) ? 'failed' : 'ready')
  const profile = createCareerProfile('roman')
  profile.rank = 'commander'; profile.totalMerit = profile.availableMerit = 80000
  profile.equipment = { melee: confiscated[0], shield: confiscated[1] }
  return { profile, selected, paladinLoad, highLoad, makiLoad }
}
afterEach(() => vi.restoreAllMocks())

describe('Arena scene equipment admission', () => {
  it('原拜占庭槍與盾載入失敗不阻擋徒手關押；只等待場內實際裝備', async () => {
    const h = boundary()
    const accepted = acceptHeavyFieldMission(h.profile, 'soldier-iron-encounter', 'capture')!
    const captured = beginPrisonBreak(claimCareerFieldResult(accepted, 'capture', 'failure', stats, stats, 'viking').profile)!
    await expect(preload(captured)).resolves.toBeUndefined()
    expect(h.selected).toHaveBeenCalledOnce()
    const ids = [...h.selected.mock.calls[0][0]]
    expect(ids).not.toContain(confiscated[0]); expect(ids).not.toContain(confiscated[1])
    expect(ids).toContain('elven_runebow')
    expect(h.paladinLoad).not.toHaveBeenCalled(); expect(h.highLoad).not.toHaveBeenCalled(); expect(h.makiLoad).not.toHaveBeenCalled()
    expect(captured.equipment).toEqual(h.profile.equipment)
  })

  it('普通試煉保留原配裝的阻塞載入契約與共用裝備預載', async () => {
    const h = boundary()
    h.profile.activeMission = createArenaTrialMission(h.profile, 1, 'roman-colosseum', 'trial')!
    await expect(preload(h.profile)).rejects.toThrow('裝備資源載入失敗')
    expect([...h.selected.mock.calls[0][0]]).toEqual(expect.arrayContaining(confiscated))
    expect(h.paladinLoad).toHaveBeenCalledOnce(); expect(h.highLoad).toHaveBeenCalledOnce(); expect(h.makiLoad).toHaveBeenCalledOnce()
  })
})
