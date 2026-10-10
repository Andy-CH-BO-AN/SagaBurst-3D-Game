import { describe, expect, it, onTestFinished } from 'vitest'
import { TrainingDummy } from '../../src/training/TrainingDummy'
import { damageReceiver } from '../../src/combat/DamageRouter'
import { trainingDamageText } from '../../src/training/TrainingDamageDisplay'
import { resolveSkillProgressionAward } from '../../src/rpg/CombatSkillProgression'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { Faction } from '../../src/world/NPC'
import { createThreeTestScene } from '../helpers/threeTestEnvironment'
import { createCombatEventRecorder } from '../helpers/combatEventRecorder'

describe('Static training receiver lifetime and attribution', () => {
  it.each(['melee', 'projectile', 'mount-impact'] as const)('%s remains hittable after repeated lethal-sized damage, emits actual damage and never awards XP', method => {
    const dummy = new TrainingDummy(createThreeTestScene(), { x: 100, z: 40, distance: 0 })
    onTestFinished(() => dummy.dispose())
    const { stream, events } = createCombatEventRecorder(onTestFinished)
    const context = { method, source: { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'viking' as const }, weaponId: 'steel_sword', emit: stream.emit }
    for (const amount of [25, 100000, 12.5]) {
      const result = damageReceiver(dummy, amount, context)
      expect(result).toMatchObject({ hitSuccess: true, appliedDamage: amount, killed: false, hpRatio: 1 })
    }
    expect(events).toHaveLength(3)
    expect(events.every(event => event.type === 'damage_applied' && event.target.targetType === 'training')).toBe(true)
    expect(events.map(event => resolveSkillProgressionAward(event, WEAPONS.steel_sword))).toEqual([null, null, null])
    expect(trainingDamageText(events[2], '戰馬')).toContain('Damage: 12.5')
    expect(trainingDamageText(events[2], '戰馬')).not.toContain('Hit:')
  })

  it('reports contact evidence and rejects damage after receiver disposal', () => {
    const dummy = new TrainingDummy(createThreeTestScene(), { x: 100, z: 40, distance: 60 })
    onTestFinished(() => dummy.dispose())
    const { stream, events } = createCombatEventRecorder(onTestFinished)
    damageReceiver(dummy, 75, { source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'viking' }, method: 'projectile', weaponId: 'elven_runebow', contact: { kind: 'body', time: .5 }, emit: stream.emit })
    expect(trainingDamageText(events[0])).toContain('Hit: body')
    expect(trainingDamageText(events[0])).toContain('60m Dummy')
    dummy.dispose()
    expect(damageReceiver(dummy, 10).hitSuccess).toBe(false)
    expect(dummy.group.parent).toBeNull()
  })
})
