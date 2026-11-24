import { careerRankFixture } from '../helpers/careerRankFixture'
import { describe, expect, it } from 'vitest'
import { arenaCombatPreloadPlan, loadArenaCombatAssets, type ArenaCombatAssetLoaders } from '../../src/arena/ArenaCombatPreloadPlan'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { acceptHeavyFieldMission } from '../../src/career/HeavyFieldMission'
import { beginPrisonBreak, claimCareerFieldResult } from '../../src/career/CareerPrisonBreak'
import { careerArenaTrial, createArenaTrialMission } from '../../src/career/CareerArenaTrials'

const confiscated = ['byzantine_standard_lance_t5', 'byzantine_eagle_shield_t5']
const stats = { damageDealt: 0, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
function commanderWithByzantineLoadout() {
  const profile = createCareerProfile('roman')
  Object.assign(profile, careerRankFixture(profile.faction, 'commander')); profile.totalMerit = profile.availableMerit = 80000
  profile.equipment = { melee: confiscated[0], shield: confiscated[1] }
  return profile
}
/** Asset-loader boundary: the confiscated Byzantine models fail to load; every call is recorded by name. */
function loaders() {
  const called = new Set<string>()
  const load = (name: string) => () => { called.add(name); return Promise.resolve() }
  const port: ArenaCombatAssetLoaders = {
    humanoids: load('humanoids'), heroAsset: id => load(`hero:${id}`)(), horses: load('horses'),
    paladin: load('paladin'), highTier: load('highTier'), makiBow: load('makiBow'),
    equipment: async ids => { called.add('equipment'); return [...ids].some(id => confiscated.includes(String(id))) ? 'failed' : 'ready' },
  }
  return { port, called: () => [...called].filter(name => !name.startsWith('hero:')).sort() }
}

describe('Arena scene equipment admission', () => {
  it('原拜占庭槍與盾載入失敗不阻擋徒手關押；只等待場內實際裝備', async () => {
    const profile = commanderWithByzantineLoadout()
    const accepted = acceptHeavyFieldMission(profile, 'soldier-iron-encounter', 'capture')!
    const captured = beginPrisonBreak(claimCareerFieldResult(accepted, 'capture', 'failure', stats, stats, 'viking').profile)!
    const prison = captured.activeMission!.prisonBreak!
    const plan = arenaCombatPreloadPlan(captured, prison.combat, prison, null)
    // The blocking equipment barrier carries only what the guards in the cell block wield.
    expect(plan.equipmentIds).not.toContain(confiscated[0]); expect(plan.equipmentIds).not.toContain(confiscated[1])
    expect(plan.equipmentIds).toContain('elven_runebow')
    const h = loaders()
    await expect(loadArenaCombatAssets(plan, h.port)).resolves.toBeUndefined()
    expect(h.called()).toEqual(['equipment', 'humanoids'])
    expect(captured.equipment).toEqual(profile.equipment)
  })

  it('普通試煉保留原配裝的阻塞載入契約與共用裝備預載', async () => {
    const profile = commanderWithByzantineLoadout()
    profile.activeMission = createArenaTrialMission(profile, 1, 'roman-colosseum', 'trial')!
    const plan = arenaCombatPreloadPlan(profile, careerArenaTrial(profile.activeMission)!, undefined, null)
    expect(plan.equipmentIds).toEqual(expect.arrayContaining(confiscated))
    // The player's own loadout failing to load blocks the scene instead of publishing it half-loaded.
    const h = loaders()
    await expect(loadArenaCombatAssets(plan, h.port)).rejects.toThrow('試煉裝備資源載入失敗')
    expect(h.called()).toEqual(['equipment', 'highTier', 'horses', 'humanoids', 'makiBow', 'paladin'])
  })
})
