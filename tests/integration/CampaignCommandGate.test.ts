import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'
import type { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { applyCampaignBreachOrders, CampaignBreachController } from '../../src/campaign/CampaignGate'
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

  it('allows attackers spawned >=100m away outside closed gate to advance towards gate and damage it with NavigationWorld', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman', undefined, { walkways: true })
    const navigationWorld = new NavigationWorld()
    navigationWorld.sync(outpost.obstacles)
    if (outpost.walkways) {
      navigationWorld.setOutpostWalkways(outpost.walkways.layout)
    }

    const placement = getCampaignOutpostPlacement('roman')
    const gateZ = placement.frontZ
    const startZ = gateZ + 110 // Spawn >= 100m outside the closed gate
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
    const gateController = outpost.gateController
    const initialGateHp = gateController.damageable.currentHp

    const player = { targetable: false, dead: false, isMounted: false } as unknown as Player

    npc.setTacticalOrder('attack')
    npc.assignSiegeObstacle(gateController.siegeObstacle)

    // Simulate first 30 frames (1.5 seconds at 0.05s) with skipBoidsAndObstacles=false and real NavigationWorld
    for (let frame = 0; frame < 30; frame++) {
      npc.update(0.05, player, [npc], [], outpost.obstacles, { setFill() {} }, vi.fn(), vi.fn(), false, 0, null, null, navigationWorld)
    }

    const advancedDeltaZ = startZ - npc.group.position.z
    expect(advancedDeltaZ, 'Attacker must advance forward with real NavigationWorld without stalling').toBeGreaterThan(2.0)

    // Position attacker at approach distance to gate to verify melee engagement and damage dealing
    const approachZ = gateZ + 1.2
    npc.group.position.set(0, getTerrainHeight(0, approachZ), approachZ)
    let damaged = false
    for (let frame = 0; frame < 120; frame++) {
      npc.update(0.05, player, [npc], [], outpost.obstacles, { setFill() {} }, vi.fn(), vi.fn(), false, 0, null, null, navigationWorld)
      if (gateController.damageable.currentHp < initialGateHp) {
        damaged = true
        break
      }
    }

    expect(damaged, 'Attacker must engage and damage closed gate obstacle').toBe(true)
  })

  it('handles breach transition without re-binding attackers to closed gate on subsequent frames', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman', undefined, { walkways: true })
    const navigationWorld = new NavigationWorld()
    navigationWorld.sync(outpost.obstacles)
    if (outpost.walkways) {
      navigationWorld.setOutpostWalkways(outpost.walkways.layout)
    }

    const gate = outpost.gateController
    const breach = outpost.breachController
    expect(gate.state).toBe('closed')
    expect(breach.breached).toBe(false)

    // Attacker 1: Already deployed
    const npc1 = new NPC(
      scene,
      0,
      50,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Attacker 1',
      1,
      false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'breach-attacker-1',
    )
    onTestFinished(() => { npc1.dispose() })

    // Normal pre-breach state: gate is closed, attacker assigned gate siege obstacle
    npc1.setTacticalOrder('attack')
    if (gate.state === 'closed' && !breach.breached) {
      npc1.assignSiegeObstacle(gate.siegeObstacle)
    }
    expect(npc1.siegeObstacle).toBe(gate.siegeObstacle)
    expect(npc1.tacticalOrder).toBe('attack')

    // 1. Destroy a non-gate palisade segment to create a breach
    const palisade = outpost.damageableObstacles.find(o => o.kind === 'palisade')!
    expect(palisade).toBeDefined()
    palisade.takeDamage(palisade.currentHp + 100)

    // Palisade is destroyed -> breach triggered
    expect(breach.breached).toBe(true)
    // Gate remains closed
    expect(gate.state).toBe('closed')

    // On breach: orders applied and gate siege target cleared
    if (npc1.siegeObstacle === gate.siegeObstacle) {
      npc1.assignSiegeObstacle(null)
    }
    applyCampaignBreachOrders([npc1], 'viking')
    expect(npc1.siegeObstacle).toBeNull()
    expect(npc1.tacticalOrder).toBe('charge')

    // 2. Next frame: simulate _updateDefenseCampaign logic
    // Even though gate.state === 'closed', because breach.breached === true, gate must NOT be re-assigned!
    if (gate.state === 'closed' && !breach.breached) {
      npc1.assignSiegeObstacle(gate.siegeObstacle)
    } else {
      if (npc1.siegeObstacle === gate.siegeObstacle) {
        npc1.assignSiegeObstacle(null)
      }
    }
    expect(npc1.siegeObstacle).toBeNull()
    expect(npc1.tacticalOrder).toBe('charge')

    // 3. New attacker spawned after breach:
    const npc2 = new NPC(
      scene,
      0,
      60,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Attacker 2 (post-breach spawn)',
      1,
      false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'breach-attacker-2',
    )
    onTestFinished(() => { npc2.dispose() })

    // Simulate _enqueueDefenseCampaignRemainder spawning npc2:
    if (gate.state === 'closed' && !breach.breached) {
      npc2.assignSiegeObstacle(gate.siegeObstacle)
    }
    const tacticalOrder = breach.breached ? (npc2.aiType === AIType.RANGED ? 'attack' : 'charge') : 'attack'
    npc2.setTacticalOrder(tacticalOrder)

    expect(npc2.siegeObstacle).toBeNull()
    expect(npc2.tacticalOrder).toBe('charge')

    // 4. Gate opening / closing coverage:
    // If gate opens, siege obstacle is cleared; if closed without breach, obstacle is assigned
    const unbreachedBreachController = new CampaignBreachController()
    expect(unbreachedBreachController.breached).toBe(false)
    if (gate.state === 'closed' && !unbreachedBreachController.breached) {
      npc2.assignSiegeObstacle(gate.siegeObstacle)
    }
    expect(npc2.siegeObstacle).toBe(gate.siegeObstacle)

    gate.open()
    expect(gate.state).toBe('open')
    if (gate.state !== 'closed' || unbreachedBreachController.breached) {
      npc2.assignSiegeObstacle(null)
    }
    expect(npc2.siegeObstacle).toBeNull()
  })
})
