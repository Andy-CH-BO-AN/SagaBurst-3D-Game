import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { getTerrainHeight, type ObstacleData } from '../../src/world/Terrain'
import type { Player } from '../../src/player/Player'
import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'

describe('Campaign command gate wiring', () => {
  it('ignores Attack and Charge while campaign command gating says no enemy exists', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
      clearFollowTarget: vi.fn(),
    }
    const h = controllerHarness(
      [spearman],
      null,
      order => order !== 'attack' && order !== 'charge',
    )

    h.input.pressAll()
    h.controller.update()
    h.input.press('1')
    h.controller.update()
    expect(spearman.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('部署階段：敵軍尚未進場')

    h.input.pressAll()
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(spearman.setTacticalOrder).not.toHaveBeenCalled()

    h.input.pressAll()
    h.controller.update()
    h.input.press('3')
    h.controller.update()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('defend')
  })

  it('allows Follow me (5) in deployment phase when campaignFollowEnabled is true, rejects Dismiss (6), and clears follow on defend', () => {
    const onCampaignFollow = vi.fn()
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'roman_legionary',
      dead: false,
      setTacticalOrder: vi.fn(),
      clearFollowTarget: vi.fn(),
    }
    const h = controllerHarness(
      [spearman],
      null,
      order => order !== 'attack' && order !== 'charge',
      null,
      'roman',
      'preset',
      true,
      undefined,
      undefined,
      undefined,
      null,
      true,
      onCampaignFollow,
    )

    // Open submenu for all units
    h.input.pressAll()
    h.controller.update()

    // Press '5' for Follow me
    h.input.press('5')
    h.controller.update()

    expect(onCampaignFollow).toHaveBeenCalledWith('all', expect.arrayContaining([expect.objectContaining({ presetId: 'roman_legionary' })]))
    expect(h.ui.showFeedback).toHaveBeenCalledWith('全軍 → Follow me · 跟隨')
    expect(h.controller.getDesiredOrderForNpc(spearman as unknown as NPC)).toBe('follow')

    // Open submenu again, press '6' (Dismiss) - should be ignored because dismiss is only for personal squads
    h.input.pressAll()
    h.controller.update()
    h.input.press('6')
    h.controller.update()
    expect(h.controller.getDesiredOrderForNpc(spearman as unknown as NPC)).toBe('follow')

    // Still in submenu: press '3' (Defend) - should clear follow and switch order to defend
    h.input.press('3')
    h.controller.update()
    expect(spearman.clearFollowTarget).toHaveBeenCalled()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('defend')
    expect(h.controller.getDesiredOrderForNpc(spearman as unknown as NPC)).toBe('defend')
  })

  it('allows attackers spawned >=100m away outside closed gate to advance towards gate and damage it', () => {
    const scene = new THREE.Scene()
    const startZ = 105
    const npc = new NPC(
      scene,
      0,
      startZ,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Siege attacker',
      1,
      false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'siege-advance-attacker',
    )
    onTestFinished(() => { npc.dispose() })

    npc.group.position.y = getTerrainHeight(0, startZ)

    const gateHp = 500
    const gate = new DamageableObstacle({
      kind: 'gate',
      maxHp: gateHp,
      root: new THREE.Object3D(),
      ownerFaction: 'roman',
    })
    const obstacle: ObstacleData = {
      isBarricade: false,
      damageable: gate,
      box: new THREE.Box3(new THREE.Vector3(-4, -10, -1), new THREE.Vector3(4, 10, 1)),
    }

    const player = { targetable: false, dead: false, isMounted: false } as unknown as Player

    npc.setTacticalOrder('attack')
    npc.assignSiegeObstacle(obstacle)

    // Simulate first 20 frames (1 second at 0.05s) - verify attacker moves forward along -Z towards gate at z=0
    for (let frame = 0; frame < 20; frame++) {
      npc.update(0.05, player, [npc], [], [obstacle], { setFill() {} }, vi.fn(), vi.fn(), true)
    }

    const advancedDeltaZ = startZ - npc.group.position.z
    expect(advancedDeltaZ, 'Attacker must advance forward instead of stalling at (0,0,0)').toBeGreaterThan(2.0)

    // Simulate forward until attacker reaches gate and deals damage
    let damaged = false
    for (let frame = 0; frame < 600; frame++) {
      npc.update(0.05, player, [npc], [], [obstacle], { setFill() {} }, vi.fn(), vi.fn(), true)
      if (gate.currentHp < gateHp) {
        damaged = true
        break
      }
    }

    expect(damaged, 'Attacker must approach and damage closed gate obstacle').toBe(true)
  })
})
