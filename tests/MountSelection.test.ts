import { describe, expect, it } from 'vitest'
import { createDefaultPlayerLoadout, getDefaultBattleConfig, validateBattleConfig } from '../src/battle/BattleConfig'
import { resolveUnitLoadout } from '../src/battle/UnitPresetCatalog'
import { createDefaultDefensePlayerLoadout, validateDefenseCampaignLaunchConfig, createDefaultDefenseArmy } from '../src/campaign/DefenseCampaignLaunch'
import { MountType, mountTypeFromId } from '../src/world/Mount'

describe('mount selection', () => {
  it('accepts all three player mounts in custom battle and campaign', () => {
    expect(createDefaultPlayerLoadout().mountId).toBe('horse')
    for (const mountId of ['black-cat', 'corgi', 'horse'] as const) {
      const battle = getDefaultBattleConfig()
      battle.playerLoadout = { ...createDefaultPlayerLoadout(), mountId }
      expect(validateBattleConfig(battle).valid).toBe(true)

      const campaign = {
        type: 'defense' as const,
        defenderFaction: 'viking' as const,
        stageId: 1 as const,
        defenderArmy: createDefaultDefenseArmy('viking'),
        playerLoadout: { ...createDefaultDefensePlayerLoadout('viking'), mountId },
      }
      campaign.defenderArmy.viking_berserker = { 1: 0, 2: 50, 3: 0 }
      expect(validateDefenseCampaignLaunchConfig(campaign).valid).toBe(true)
    }
  })

  it('rejects unknown mount IDs and treats old player loadouts as horse', () => {
    const battle = getDefaultBattleConfig()
    battle.playerLoadout = { ...createDefaultPlayerLoadout(), mountId: 'dragon' as 'horse' }
    expect(validateBattleConfig(battle).valid).toBe(false)
    const campaign = {
      type: 'defense' as const,
      defenderFaction: 'viking' as const,
      stageId: 1 as const,
      defenderArmy: { viking_berserker: { 1: 0, 2: 50, 3: 0 } },
      playerLoadout: { ...createDefaultDefensePlayerLoadout('viking'), mountId: 'dragon' as 'horse' },
    }
    expect(validateDefenseCampaignLaunchConfig(campaign).valid).toBe(false)
    expect(mountTypeFromId(undefined)).toBe(MountType.HORSE)
    expect(mountTypeFromId('black-cat')).toBe(MountType.BLACK_CAT)
    expect(mountTypeFromId('corgi')).toBe(MountType.CORGI)
  })

  it('uses faction mounts for all T3 cavalry and horse for T1/T2', () => {
    for (const [faction, mountId] of [['viking', 'black-cat'], ['roman', 'corgi']] as const) {
      for (const role of ['sword_cavalry', 'lancer', 'horse_archer'] as const) {
        const preset = `${faction}_${role}` as Parameters<typeof resolveUnitLoadout>[0]
        expect(resolveUnitLoadout(preset, 1).mountId).toBe('horse')
        expect(resolveUnitLoadout(preset, 2).mountId).toBe('horse')
        expect(resolveUnitLoadout(preset, 3).mountId).toBe(mountId)
      }
    }
  })
})
