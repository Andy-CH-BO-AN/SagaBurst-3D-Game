import { describe, expect, it } from 'vitest'
import {
  createDefaultDefenseArmy,
  createDefaultDefensePlayerLoadout,
  createDefenseCampaignWaveConfig,
  positionDefenseCampaignDefenders,
  positionDefenseCampaignReinforcements,
  validateDefenseCampaignLaunchConfig,
  type DefenseCampaignLaunchConfig,
} from './DefenseCampaignLaunch'
import { calculateArmyTotal } from '../battle/BattleConfig'
import { BattleSpawner } from '../battle/BattleSpawner'
import { getCampaignOutpostPlacement } from './CampaignOutpost'

function launch(
  defenderFaction: 'roman' | 'viking',
  withDefenders = false,
  stageId: DefenseCampaignLaunchConfig['stageId'] = 1,
): DefenseCampaignLaunchConfig {
  const defenderArmy = createDefaultDefenseArmy(defenderFaction, stageId)
  if (withDefenders) {
    defenderArmy[
      defenderFaction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
    ] = { 1: 0, 2: 50, 3: 0 }
  }
  return {
    type: 'defense',
    defenderFaction,
    stageId,
    defenderArmy,
    playerLoadout: createDefaultDefensePlayerLoadout(defenderFaction),
  }
}

describe('Defense Campaign Stage 1 launch config', () => {
  it('starts with no default defenders so the player builds the army', () => {
    expect(calculateArmyTotal(createDefaultDefenseArmy('roman', 1))).toBe(0)
    expect(calculateArmyTotal(createDefaultDefenseArmy('viking', 1))).toBe(0)
    expect(validateDefenseCampaignLaunchConfig(launch('roman')).valid).toBe(false)
    expect(validateDefenseCampaignLaunchConfig(launch('viking')).valid).toBe(false)
  })

  it('defaults the player to mounted T3 lance, faction T3 ranged, and T3 shield', () => {
    expect(createDefaultDefensePlayerLoadout('roman')).toEqual({
      meleeWeaponId: 'heavy_lance',
      rangedWeaponId: 'legionary_pilum',
      shieldId: 'scutum_t3',
      startMounted: true,
    })
    expect(createDefaultDefensePlayerLoadout('viking')).toEqual({
      meleeWeaponId: 'heavy_lance',
      rangedWeaponId: 'elven_runebow',
      shieldId: 'round_shield_t3',
      startMounted: true,
    })
  })

  it('mirrors defender and attacker factions through the same wave builder', () => {
    const romanDefense = launch('roman', true)
    const vikingDefense = launch('viking', true)

    const romanDefenders = createDefenseCampaignWaveConfig(romanDefense, 'defenders')
    const romanAttackers = createDefenseCampaignWaveConfig(romanDefense, 'attackers')
    expect(calculateArmyTotal(romanDefenders.roman)).toBe(50)
    expect(calculateArmyTotal(romanDefenders.viking)).toBe(0)
    expect(calculateArmyTotal(romanAttackers.viking)).toBe(100)
    expect(calculateArmyTotal(romanAttackers.roman)).toBe(0)

    const vikingDefenders = createDefenseCampaignWaveConfig(vikingDefense, 'defenders')
    const vikingAttackers = createDefenseCampaignWaveConfig(vikingDefense, 'attackers')
    expect(calculateArmyTotal(vikingDefenders.viking)).toBe(50)
    expect(calculateArmyTotal(vikingDefenders.roman)).toBe(0)
    expect(calculateArmyTotal(vikingAttackers.roman)).toBe(100)
    expect(calculateArmyTotal(vikingAttackers.viking)).toBe(0)
  })

  it('builds the Stage 1 attacker 4:2:2:1:1 composition at T2', () => {
    const config = createDefenseCampaignWaveConfig(launch('roman', true), 'attackers')
    expect(config.viking.viking_berserker?.[2]).toBe(40)
    expect(config.viking.viking_archer?.[2]).toBe(20)
    expect(config.viking.viking_sword_cavalry?.[2]).toBe(20)
    expect(config.viking.viking_lancer?.[2]).toBe(10)
    expect(config.viking.viking_horse_archer?.[2]).toBe(10)
  })

  it('builds 50 T1 sword-cavalry reinforcements for either defender faction', () => {
    const roman = createDefenseCampaignWaveConfig(launch('roman', true), 'reinforcement')
    const viking = createDefenseCampaignWaveConfig(launch('viking', true), 'reinforcement')
    expect(roman.roman.roman_sword_cavalry?.[1]).toBe(50)
    expect(viking.viking.viking_sword_cavalry?.[1]).toBe(50)
  })

  it('allows the full Stage 1 80-defender mix with 30 T1 bonus slots', () => {
    const config = launch('roman')
    config.defenderArmy = {
      roman_heavy_infantry: { 1: 30, 2: 40, 3: 10 },
    }

    expect(calculateArmyTotal(config.defenderArmy)).toBe(80)
    expect(validateDefenseCampaignLaunchConfig(config).valid).toBe(true)
  })

  it('rejects the 31st T1 defender in Stage 1', () => {
    const config = launch('roman')
    config.defenderArmy = {
      roman_heavy_infantry: { 1: 31, 2: 39, 3: 10 },
    }

    const result = validateDefenseCampaignLaunchConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('T1 total 31 exceeds capacity 30'))).toBe(true)
  })

  it.each([
    [2, 85, 35, 40],
    [3, 90, 35, 45],
  ] as const)('allows the full Stage %s defender cap with the extra ten T1 slots', (
    stageId,
    expectedTotal,
    t1,
    t2,
  ) => {
    const config = launch('roman', false, stageId)
    config.defenderArmy = {
      roman_heavy_infantry: { 1: t1, 2: t2, 3: 10 },
    }

    expect(calculateArmyTotal(config.defenderArmy)).toBe(expectedTotal)
    expect(validateDefenseCampaignLaunchConfig(config).valid).toBe(true)
  })

  it.each([
    [4, 80, 10],
    [5, 60, 30],
    [6, 30, 60],
  ] as const)('allows Stage %s to fill 90 defenders with the extra T2 slots', (
    stageId,
    t2,
    t3,
  ) => {
    const config = launch('roman', false, stageId)
    config.defenderArmy = {
      roman_heavy_infantry: { 1: 0, 2: t2, 3: t3 },
    }

    expect(calculateArmyTotal(config.defenderArmy)).toBe(90)
    expect(validateDefenseCampaignLaunchConfig(config).valid).toBe(true)
  })

  it.each([7, 8, 9] as const)(
    'allows Stage %s to field 90 T3 defenders with the extra T3 slots',
    stageId => {
      const config = launch('roman', false, stageId)
      config.defenderArmy = {
        roman_heavy_infantry: { 1: 0, 2: 0, 3: 90 },
      }

      expect(calculateArmyTotal(config.defenderArmy)).toBe(90)
      expect(validateDefenseCampaignLaunchConfig(config).valid).toBe(true)
    },
  )

  it('rejects using Stage 1 T1 bonus slots for extra T2/T3 defenders', () => {
    const config = launch('roman')
    config.defenderArmy = {
      roman_heavy_infantry: { 1: 0, 2: 50, 3: 10 },
    }

    const result = validateDefenseCampaignLaunchConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('T2+T3 total 60 exceeds shared capacity 50'))).toBe(true)
  })

  it('allows up to 10 T3 defenders in Stage 1 and rejects the 11th', () => {
    const valid = launch('roman')
    valid.defenderArmy = {
      roman_heavy_infantry: { 1: 0, 2: 40, 3: 10 },
    }
    expect(validateDefenseCampaignLaunchConfig(valid).valid).toBe(true)

    const invalid = launch('roman')
    invalid.defenderArmy = {
      roman_heavy_infantry: { 1: 0, 2: 39, 3: 11 },
    }
    const result = validateDefenseCampaignLaunchConfig(invalid)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('T3 total 11 exceeds capacity 10'))).toBe(true)
  })

  it('rejects cavalry over the Stage 1 cap', () => {
    const config = launch('roman')
    config.defenderArmy = {
      roman_sword_cavalry: { 1: 0, 2: 11, 3: 0 },
      roman_heavy_infantry: { 1: 0, 2: 39, 3: 0 },
    }
    const result = validateDefenseCampaignLaunchConfig(config)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('cavalry cap'))).toBe(true)
  })


  it.each(['roman', 'viking'] as const)(
    'keeps a full Stage 9 %s mounted defender army inside the outpost',
    defenderFaction => {
      const config = launch(defenderFaction, false, 9)
      const presetId = defenderFaction === 'roman'
        ? 'roman_sword_cavalry'
        : 'viking_sword_cavalry'
      config.defenderArmy = {
        [presetId]: { 1: 0, 2: 0, 3: 90 },
      }

      const defenders = createDefenseCampaignWaveConfig(config, 'defenders')
      const plan = BattleSpawner.createSpawnPlan(defenders)
      positionDefenseCampaignDefenders(plan.npcSpecs, defenderFaction)

      const placement = getCampaignOutpostPlacement(defenderFaction)
      const minZ = Math.min(placement.frontZ, placement.backZ)
      const maxZ = Math.max(placement.frontZ, placement.backZ)
      const mounted = plan.npcSpecs.filter(spec => spec.cavalry || Boolean(spec.loadout?.mountId))

      expect(mounted).toHaveLength(90)
      expect(mounted.every(spec => Math.abs(spec.x) < placement.halfWidth)).toBe(true)
      expect(mounted.every(spec => spec.z > minZ && spec.z < maxZ)).toBe(true)
      expect(new Set(mounted.map(spec => `${spec.x},${spec.z}`)).size).toBe(90)
    },
  )

  it('places 50 reinforcements 250m away on the attacking army side for both factions', () => {
    for (const faction of ['roman', 'viking'] as const) {
      const reinforcement = createDefenseCampaignWaveConfig(launch(faction, true), 'reinforcement')
      const plan = BattleSpawner.createSpawnPlan(reinforcement)
      positionDefenseCampaignReinforcements(plan.npcSpecs, faction)

      expect(plan.npcSpecs).toHaveLength(50)
      expect(Math.max(...plan.npcSpecs.map(spec => Math.abs(spec.x)))).toBeLessThan(11)

      const zValues = plan.npcSpecs.map(spec => spec.z)
      if (faction === 'roman') {
        expect(Math.min(...zValues)).toBeGreaterThanOrEqual(250)
        expect(Math.max(...zValues)).toBeLessThan(262)
      } else {
        expect(Math.max(...zValues)).toBeLessThanOrEqual(-250)
        expect(Math.min(...zValues)).toBeGreaterThan(-262)
      }
      for (let i = 0; i < plan.npcSpecs.length; i++) {
        for (let j = i + 1; j < plan.npcSpecs.length; j++) {
          const a = plan.npcSpecs[i]
          const b = plan.npcSpecs[j]
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2.2)
        }
      }
    }
  })

  it('rejects string stage ids instead of coercing session data', () => {
    const config = launch('roman') as unknown as Record<string, unknown>
    config.stageId = '1'
    expect(validateDefenseCampaignLaunchConfig(config).valid).toBe(false)
  })

  it('builds a valid attacker wave for all nine stages', () => {
    const expectedTotals = [100, 110, 120, 130, 140, 150, 160, 180, 200]
    for (let stageId = 1; stageId <= 9; stageId++) {
      const config = launch(
        'roman',
        true,
        stageId as DefenseCampaignLaunchConfig['stageId'],
      )
      expect(validateDefenseCampaignLaunchConfig(config).valid, `Stage ${stageId}`).toBe(true)

      const attackers = createDefenseCampaignWaveConfig(config, 'attackers')
      expect(calculateArmyTotal(attackers.viking), `Stage ${stageId}`).toBe(
        expectedTotals[stageId - 1],
      )
    }
  })

  it('allocates Stage 4 mixed attacker tiers across the full 4:2:2:1:1 role mix', () => {
    const config = createDefenseCampaignWaveConfig(launch('roman', true, 4), 'attackers')
    expect(config.viking.viking_berserker).toEqual({ 1: 0, 2: 40, 3: 12 })
    expect(config.viking.viking_archer).toEqual({ 1: 0, 2: 20, 3: 6 })
    expect(config.viking.viking_sword_cavalry).toEqual({ 1: 0, 2: 20, 3: 6 })
    expect(config.viking.viking_lancer).toEqual({ 1: 0, 2: 10, 3: 3 })
    expect(config.viking.viking_horse_archer).toEqual({ 1: 0, 2: 10, 3: 3 })
    expect(calculateArmyTotal(config.viking)).toBe(130)
  })

  it('allocates later attacker quality progression without changing role proportions', () => {
    const stage6 = createDefenseCampaignWaveConfig(launch('roman', true, 6), 'attackers')
    expect(stage6.viking.viking_berserker).toEqual({ 1: 0, 2: 12, 3: 48 })
    expect(stage6.viking.viking_archer).toEqual({ 1: 0, 2: 6, 3: 24 })
    expect(calculateArmyTotal(stage6.viking)).toBe(150)

    const stage7 = createDefenseCampaignWaveConfig(launch('roman', true, 7), 'attackers')
    expect(stage7.viking.viking_berserker).toEqual({ 1: 0, 2: 0, 3: 64 })
    expect(stage7.viking.viking_archer).toEqual({ 1: 0, 2: 0, 3: 32 })
    expect(calculateArmyTotal(stage7.viking)).toBe(160)
  })
})
