import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TownScene } from '../src/town/TownScene'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'

function hostile(faction: Faction) {
  return new NPC(new THREE.Scene(), 0, 0, faction, 'viking', AIType.MELEE, 'Hostile', 2, false)
}

function player(x = 5) {
  return { characterFaction: 'roman', targetable: true, dead: false, isMounted: false, group: { position: new THREE.Vector3(x, 0, 0) } }
}

describe('Town player hit aggro', () => {
  it('makes a damaged Bandit acquire Player immediately even with a closer Town soldier', () => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    const soldier = hostile(Faction.TOWN)
    soldier.group.position.x = 1
    const town = Object.create(TownScene.prototype) as any
    town.player = player()
    town.inventory = { equippedMelee: { id: 'gladius_rusty' } }
    town.defense = { active: false }
    town.mission = { events: { emit: vi.fn() }, provokeGroupFor: vi.fn(() => bandit.provokeEncounter()) }
    town.damageNumbers = { spawn: vi.fn() }

    town.hitFieldNpc(bandit, 5, 'melee')
    expect(town.mission.provokeGroupFor).toHaveBeenCalledOnce()
    expect(bandit.encounterAggroState).toBe('provoked')
    expect((bandit as any)._findTarget(town.player, [soldier])?.isPlayer).toBe(true)
    expect((bandit as any)._cachedTargetIsPlayer).toBe(true)
    bandit.dispose(); soldier.dispose()
  })

  it('does not replay the exclamation on each effective hit, but can alert after a full reset', () => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    const sprite = (bandit as any).alertSprite as THREE.Sprite
    bandit.triggerEncounterAlert()
    expect(sprite.visible).toBe(true)
    sprite.visible = false
    for (let i = 0; i < 5; i++) {
      bandit.takeDamage(1)
      bandit.provokeEncounter()
      bandit.triggerEncounterAlert()
      expect(sprite.visible).toBe(false)
    }
    bandit.configureBanditEncounter(new THREE.Vector3())
    bandit.triggerEncounterAlert()
    expect(sprite.visible).toBe(true)
    bandit.dispose()
  })

  it.each(['alerted', 'provoked'] as const)('reacquires Player from AI IDLE without replaying known %s awareness', awareness => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    if (awareness === 'provoked') bandit.provokeEncounter()
    else bandit.triggerEncounterAlert()
    const internal = bandit as any
    internal.state = AIState.IDLE
    internal.alertSprite.visible = false
    bandit.takeDamage(1)
    expect(internal.alertSprite.visible).toBe(false)
    bandit.update(.016, player() as any, [], [bandit], [], () => {}, true)
    expect(internal.alertSprite.visible).toBe(false)
    expect(bandit.inCombat).toBe(true)
    expect(internal._cachedTargetIsPlayer).toBe(true)
    bandit.dispose()
  })

  it('announces an idle encounter only when an effective first hit provokes awareness', () => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    const internal = bandit as any
    bandit.takeDamage(1)
    expect(internal.alertSprite.visible).toBe(false)
    bandit.provokeEncounter()
    expect(bandit.encounterAggroState).toBe('provoked')
    expect(internal.alertSprite.visible).toBe(true)
    bandit.dispose()
  })

  it('allows one new detection only after returning fully to the encounter origin', () => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    bandit.triggerEncounterAlert()
    const internal = bandit as any
    expect(internal.alertSprite.visible).toBe(true)
    bandit.update(.5, player() as any, [], [bandit], [], () => {}, true)
    expect(internal.alertSprite.visible).toBe(false)
    bandit.group.position.x = 30
    internal._beginEncounterReturn()
    bandit.triggerEncounterAlert()
    expect(bandit.encounterAggroState).toBe('returning')
    expect(internal.alertSprite.visible).toBe(false)
    bandit.group.position.set(0, 0, 0)
    bandit.update(.016, player(100) as any, [], [bandit], [], () => {}, true)
    expect(bandit.encounterAggroState).toBe('idle')
    bandit.triggerEncounterAlert()
    expect(internal.alertSprite.visible).toBe(true)
    internal.alertSprite.visible = false
    bandit.triggerEncounterAlert()
    expect(internal.alertSprite.visible).toBe(false)
    bandit.dispose()
  })

  it('does not re-announce awareness when hit while returning before reaching camp', () => {
    const bandit = hostile(Faction.BANDIT)
    bandit.configureBanditEncounter(new THREE.Vector3())
    bandit.triggerEncounterAlert()
    const internal = bandit as any
    internal.alertSprite.visible = false
    bandit.group.position.x = 30
    internal._beginEncounterReturn()
    bandit.provokeEncounter()
    expect(bandit.encounterAggroState).toBe('provoked')
    expect(internal.alertSprite.visible).toBe(false)
    bandit.dispose()
  })

  it('keeps the generic alert marker for NPCs without encounter awareness', () => {
    const enemy = hostile(Faction.ENEMY)
    enemy.update(.016, player() as any, [], [enemy], [], () => {}, true)
    expect((enemy as any).alertSprite.visible).toBe(true)
    enemy.dispose()
  })

  it('also makes a living Town Defense enemy acquire Player after effective damage', () => {
    const enemy = hostile(Faction.ENEMY)
    const soldier = hostile(Faction.TOWN)
    soldier.group.position.x = 1
    const town = Object.create(TownScene.prototype) as any
    town.player = player()
    town.inventory = { equippedMelee: { id: 'gladius_rusty' } }
    town.defense = { active: true, events: { emit: vi.fn() }, noteEffectiveFriendlyDamage: vi.fn() }
    town.damageNumbers = { spawn: vi.fn() }
    town.hitFieldNpc(enemy, 5, 'melee')
    expect((enemy as any)._findTarget(town.player, [soldier])?.isPlayer).toBe(true)
    expect(town.defense.noteEffectiveFriendlyDamage).not.toHaveBeenCalled()
    enemy.dispose(); soldier.dispose()
  })

  it('signals defense only after effective enemy damage', () => {
    const enemy = hostile(Faction.ENEMY)
    const soldier = hostile(Faction.TOWN)
    const town = Object.create(TownScene.prototype) as any
    town.player = player()
    town.inventory = { equippedMelee: { id: 'gladius_rusty' } }
    town.defense = { active: true, events: { emit: vi.fn() }, noteEffectiveFriendlyDamage: vi.fn() }
    town.damageNumbers = { spawn: vi.fn() }

    town.hitFieldNpc(soldier, 5, 'melee')
    expect(town.defense.noteEffectiveFriendlyDamage).not.toHaveBeenCalled()
    town.hitFieldNpc(soldier, 5, 'melee', enemy)
    expect(town.defense.noteEffectiveFriendlyDamage).toHaveBeenCalledExactlyOnceWith(soldier)
    enemy.dispose(); soldier.dispose()
  })
})
