import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'
import type { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { createCampaignOutpost, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import {
  applyCampaignBreachOrders,
  CampaignBreachController,
  CampaignGateController,
  reconcileCampaignGateSiege,
} from '../../src/campaign/CampaignGate'
import type { ObstacleData } from '../../src/world/Terrain'
import { createArmyCommandHarness as controllerHarness } from '../helpers/armyCommandHarness'
import { getOutpostRampartArcherSlots } from '../../src/campaign/OutpostRampartGarrison'

describe('Campaign command gate wiring', () => {
  it('ignores Attack and Charge while campaign command gating says no enemy exists', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
      clearFollowTarget: vi.fn(),
      releaseOutpostRampartGarrison: vi.fn(),
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
    let enemiesPresent = false
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'roman_legionary',
      dead: false,
      setTacticalOrder: vi.fn(),
      clearFollowTarget: vi.fn(),
      releaseOutpostRampartGarrison: vi.fn(),
    }
    const h = controllerHarness(
      [spearman],
      null,
      order => enemiesPresent || order !== 'attack' && order !== 'charge',
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
    expect(spearman.releaseOutpostRampartGarrison).toHaveBeenCalledOnce()
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
    expect(spearman.releaseOutpostRampartGarrison).toHaveBeenCalledTimes(2)
    expect(h.controller.getDesiredOrderForNpc(spearman as unknown as NPC)).toBe('defend')

    enemiesPresent = true
    h.input.pressAll()
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(spearman.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(spearman.releaseOutpostRampartGarrison).toHaveBeenCalledTimes(3)
  })

  it('keeps a real rampart archer firing outside after breach until a player order releases it', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman', undefined, { walkways: true })
    const navigationWorld = new NavigationWorld()
    navigationWorld.sync(outpost.obstacles)
    navigationWorld.setOutpostWalkways(outpost.walkways!.layout)
    const slot = getOutpostRampartArcherSlots('roman').right[7]
    const archer = new NPC(scene, slot.x, slot.z, Faction.PLAYER, 'roman', AIType.RANGED, 'Rampart archer', 2, false, {
      meleeWeaponId: 'gladius_rusty', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 'roman_archer', undefined, 'rampart-archer')
    const placement = getCampaignOutpostPlacement('roman')
    const inward = Math.sign(placement.backZ - placement.frontZ)
    const enemyZ = placement.frontZ - inward * 22
    const enemy = new NPC(scene, slot.x, enemyZ, Faction.ENEMY, 'viking', AIType.MELEE, 'Outside enemy', 1, false, {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null,
    }, 'viking_berserker', undefined, 'outside-enemy')
    onTestFinished(() => { archer.dispose(); enemy.dispose() })
    archer.group.position.set(slot.x, slot.y, slot.z)
    archer.group.rotation.y = 0
    archer.activateOutpostRampartGarrison()
    enemy.group.position.y = getTerrainHeight(enemy.group.position.x, enemy.group.position.z)
    enemy.setTacticalOrder('defend')
    const initial = archer.group.position.clone()
    const fire = vi.fn()
    const player = { targetable: false, dead: false, isMounted: false } as unknown as Player

    for (let frame = 0; frame < 160 && fire.mock.calls.length === 0; frame++) {
      archer.update(0.05, player, [archer, enemy], [archer, enemy], outpost.obstacles,
        { setFill() {} }, vi.fn(), fire, false, 0, null, null, navigationWorld)
    }

    expect(fire).toHaveBeenCalled()
    expect(archer.group.position.distanceTo(initial)).toBeLessThan(0.05)
    expect(archer.tacticalOrder).toBe('defend')
    expect(archer.isOutpostRampartGarrisonActive).toBe(true)

    applyCampaignBreachOrders([archer, enemy], 'viking')
    expect(archer.tacticalOrder).toBe('defend')
    expect(archer.isOutpostRampartGarrisonActive).toBe(true)

    archer.releaseOutpostRampartGarrison()
    applyCampaignBreachOrders([archer], 'viking')
    expect(archer.tacticalOrder).toBe('attack')
    expect(archer.isOutpostRampartGarrisonActive).toBe(false)
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

    // Normal pre-breach state: gate is closed, attacker assigned gate siege obstacle via production reconciler
    npc1.setTacticalOrder('attack')
    reconcileCampaignGateSiege({
      gate,
      breachController: breach,
      npcs: [npc1],
      attackerFaction: 'viking',
    })
    expect(npc1.siegeObstacle).toBe(gate.siegeObstacle)
    expect(npc1.tacticalOrder).toBe('attack')

    // 1. Destroy a non-gate palisade segment to create a breach
    const palisade = outpost.damageableObstacles.find(o => o.kind === 'palisade')!
    expect(palisade).toBeDefined()
    palisade.takeDamage(palisade.currentHp + 100)

    // Palisade is destroyed -> breach triggered
    expect(breach.breached).toBe(true)
    expect(gate.state).toBe('closed')

    // On breach: clear gate target and apply breach orders
    reconcileCampaignGateSiege({
      gate,
      breachController: breach,
      npcs: [npc1],
      attackerFaction: 'viking',
    })
    applyCampaignBreachOrders([npc1], 'viking')
    expect(npc1.siegeObstacle).toBeNull()
    expect(npc1.tacticalOrder).toBe('charge')

    // 2. Next frames: simulate _updateDefenseCampaign calling reconcileCampaignGateSiege
    // Even though gate.state === 'closed', because breach.breached === true, gate must NOT be re-assigned!
    reconcileCampaignGateSiege({
      gate,
      breachController: breach,
      npcs: [npc1],
      attackerFaction: 'viking',
    })
    expect(npc1.siegeObstacle, 'Attacker must not be re-bound to gate after perimeter breach').toBeNull()
    expect(npc1.tacticalOrder, 'Charge tactical order must be preserved').toBe('charge')

    // 3. New attacker spawned after breach (simulating _enqueueDefenseCampaignRemainder):
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

    reconcileCampaignGateSiege({
      gate,
      breachController: breach,
      npcs: [npc2],
      attackerFaction: 'viking',
    })
    const postBreachOrder = breach.breached ? (npc2.aiType === AIType.RANGED ? 'attack' : 'charge') : 'attack'
    npc2.setTacticalOrder(postBreachOrder)

    expect(npc2.siegeObstacle, 'New attacker spawned post-breach must not have gate siege target').toBeNull()
    expect(npc2.tacticalOrder).toBe('charge')

    // 4. Gate open / close with unbreached controller:
    const unbreachedBreachController = new CampaignBreachController()
    expect(unbreachedBreachController.breached).toBe(false)
    reconcileCampaignGateSiege({
      gate,
      breachController: unbreachedBreachController,
      npcs: [npc2],
      attackerFaction: 'viking',
    })
    expect(npc2.siegeObstacle).toBe(gate.siegeObstacle)

    gate.open()
    expect(gate.state).toBe('open')
    reconcileCampaignGateSiege({
      gate,
      breachController: unbreachedBreachController,
      npcs: [npc2],
      attackerFaction: 'viking',
    })
    expect(npc2.siegeObstacle).toBeNull()

    // 5. Veteran / Career personal troop ownership check:
    // A player-personal follower or private soldier must never be automatically commandeered by gate siege
    gate.close()
    expect(gate.state).toBe('closed')
    const personalTroop = new NPC(
      scene,
      0,
      50,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Personal Follower',
      1,
      false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'personal-troop',
    )
    personalTroop.combatOwnership = 'player-personal'
    onTestFinished(() => { personalTroop.dispose() })

    reconcileCampaignGateSiege({
      gate,
      breachController: unbreachedBreachController,
      npcs: [personalTroop],
      attackerFaction: 'viking',
    })
    expect(personalTroop.siegeObstacle, 'Personal squad troops must never be commandeered for gate siege').toBeNull()
  })

  it('revokes gate siege target when an attacker receives follow or mission formation orders', () => {
    const scene = new THREE.Scene()
    const gateRoot = new THREE.Object3D()
    scene.add(gateRoot)
    const obstacle: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(-4, 0, -1), new THREE.Vector3(4, 5, 1)),
      isBarricade: false,
      damageable: new DamageableObstacle({ maxHp: 100, kind: 'gate', root: gateRoot }),
    }
    const obstacles: ObstacleData[] = [obstacle]
    const leftHinge = new THREE.Object3D()
    const rightHinge = new THREE.Object3D()
    const gate = new CampaignGateController({
      defenderFaction: 'roman',
      damageable: obstacle.damageable!,
      obstacle,
      obstacles,
      leftHinge,
      rightHinge,
      openRotationY: Math.PI / 2,
    })
    const breachController = new CampaignBreachController()

    const attacker = new NPC(
      scene,
      0,
      40,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Viking Siege Attacker',
      1,
      false,
      { meleeWeaponId: 'iron_axe', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'viking-attacker',
    )
    attacker.setTacticalOrder('attack')
    onTestFinished(() => { attacker.dispose() })

    // Step 1: Automatic gate siege assignment when eligible and unassigned
    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBe(gate.siegeObstacle)

    // Step 2: Receiving Follow order immediately clears assigned siege obstacle
    attacker.setTacticalOrder('follow')
    expect(attacker.siegeObstacle).toBeNull()

    // Reconcile must not re-assign gate target to a follower
    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBeNull()

    // Step 3: Switch back to attack -> auto-assigned
    attacker.setTacticalOrder('attack')
    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBe(gate.siegeObstacle)

    // Step 4: assignFollowTarget clears siege target and reconciler revokes
    const leader = new NPC(
      scene,
      0,
      30,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Viking Squad Leader',
      1,
      false,
      { meleeWeaponId: 'iron_axe', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'viking-leader',
    )
    onTestFinished(() => { leader.dispose() })

    attacker.assignFollowTarget(leader, 0)
    expect(attacker.siegeObstacle).toBeNull()
    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBeNull()

    // Step 5: Mission formation assignment also clears siege target
    attacker.setTacticalOrder('attack')
    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBe(gate.siegeObstacle)

    attacker.assignFormationTarget(101, new THREE.Vector3(10, 0, 20), new THREE.Vector3(0, 0, 1))
    expect(attacker.siegeObstacle).toBeNull()

    // Step 6: Verify other eligible siege attackers continue targeting the gate
    const secondAttacker = new NPC(
      scene,
      2,
      40,
      Faction.ENEMY,
      'viking',
      AIType.MELEE,
      'Second Siege Attacker',
      1,
      false,
      { meleeWeaponId: 'iron_axe', rangedWeaponId: null, shieldId: null },
      undefined,
      undefined,
      'viking-attacker-2',
    )
    secondAttacker.setTacticalOrder('attack')
    onTestFinished(() => { secondAttacker.dispose() })

    reconcileCampaignGateSiege({
      gate,
      breachController,
      npcs: [attacker, secondAttacker],
      attackerFaction: 'viking',
    })
    expect(attacker.siegeObstacle).toBeNull()
    expect(secondAttacker.siegeObstacle).toBe(gate.siegeObstacle)
  })
})
