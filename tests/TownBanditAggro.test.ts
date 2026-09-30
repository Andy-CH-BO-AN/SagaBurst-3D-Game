import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { TownScene } from '../src/town/TownScene'
import { AIType, Faction, NPC } from '../src/world/NPC'

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
