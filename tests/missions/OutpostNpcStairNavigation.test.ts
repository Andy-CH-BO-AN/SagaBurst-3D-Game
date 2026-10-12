import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import {
  createCampaignOutpost,
  getCampaignOutpostPlacement,
} from '../../src/campaign/CampaignOutpost'
import { NAV_PATH_REQUESTS_PER_FRAME, NavigationWorld } from '../../src/navigation/NavigationWorld'
import { isStairLayer } from '../../src/navigation/OutpostLayeredNavigation'
import { AIType, AIState, Faction, NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import {
  getTerrainHeight,
  resolveObstacleCollision,
  type EntityCollisionBody,
} from '../../src/world/Terrain'
import { EntityCollisionBroadPhase } from '../../src/world/EntityCollisionBroadPhase'

describe('Outpost NPC Stair Navigation & Layered Traversal', () => {
  let scene: THREE.Scene
  let navWorld: NavigationWorld
  const FRAME = 1 / 30

  beforeEach(() => {
    scene = new THREE.Scene()
    navWorld = new NavigationWorld()
  })

  function setupOutpost(defenderFaction: 'viking' | 'roman' = 'viking') {
    const outpost = createCampaignOutpost(
      scene,
      defenderFaction,
      { obstacles: [], obstacleMeshes: [] },
      { walkways: true },
    )
    onTestFinished(() => { outpost.root.removeFromParent() })
    const layout = outpost.walkways!.layout
    navWorld.setOutpostWalkways(layout)
    navWorld.sync(outpost.obstacles)

    const leftDeck = layout.decks.find(d => d.side === -1)!
    const rightDeck = layout.decks.find(d => d.side === 1)!
    const leftStair = layout.stairs.find(s => s.side === -1)!
    const rightStair = layout.stairs.find(s => s.side === 1)!

    return { outpost, layout, leftDeck, rightDeck, leftStair, rightStair }
  }

  describe('Scenario A: Follow player onto rampart', () => {
    it('foot NPC climbs stair, walks onto rampart deck, and reaches follow slot on deck', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Player stands on the left rampart deck
      const playerX = -20
      const playerZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      player.group.position.set(playerX, leftDeck.topY + 0.95, playerZ)

      // Foot NPC starts on ground in front of the stair base
      const npcStartZ = leftStair.ramp.startZ - leftStair.ramp.dirZ * 4
      const npcStartY = getTerrainHeight(leftStair.ramp.startX, npcStartZ)
      const npc = new NPC(scene, leftStair.ramp.startX, npcStartZ, Faction.PLAYER, 'viking', AIType.MELEE, 'FootFollower', 2, false)
      npc.group.position.set(leftStair.ramp.startX, npcStartY, npcStartZ)
      onTestFinished(() => npc.dispose())

      npc.assignFollowTarget(player, 0)
      expect(npc.tacticalOrder).toBe('follow')

      // Simulate movement toward the player on the deck
      let climbedToDeck = false
      for (let f = 0; f < 300; f++) {
        navWorld.beginFrame()
        npc.update(
          FRAME,
          player,
          [npc],
          [],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )


        if (Math.abs(npc.group.position.y - leftDeck.topY) < 0.15) {
          climbedToDeck = true
        }
        if ((npc as any).formationTarget?.reached && climbedToDeck) break
      }

      // NPC must have climbed onto the rampart deck and arrived near the follow slot
      expect(climbedToDeck).toBe(true)
      expect(npc.group.position.y).toBeCloseTo(leftDeck.topY, 1)
      expect(npc.group.position.x).toBeLessThan(0)
      expect(Math.hypot(npc.group.position.x - playerX, npc.group.position.z - playerZ)).toBeLessThan(6.0)
    })
  })

  describe('Scenario B: Follow player down to ground', () => {
    it('foot NPC follows descending player from rampart deck down stair to ground', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Both start on the left rampart deck
      const deckZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      const npc = new NPC(scene, -20, deckZ, Faction.PLAYER, 'viking', AIType.MELEE, 'DeckFollower', 2, false)
      npc.group.position.set(-20, leftDeck.topY, deckZ)
      onTestFinished(() => npc.dispose())

      // Player descends to the ground courtyard
      const groundZ = leftStair.ramp.startZ - leftStair.ramp.dirZ * 6
      const groundY = getTerrainHeight(-20, groundZ)
      player.group.position.set(-20, groundY + 0.95, groundZ)

      npc.assignFollowTarget(player, 0)

      // Simulate NPC descending the stairs
      let reachedGround = false
      for (let f = 0; f < 350; f++) {
        navWorld.beginFrame()
        npc.update(
          FRAME,
          player,
          [npc],
          [],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )



        const groundAtNpc = getTerrainHeight(npc.group.position.x, npc.group.position.z)
        if (Math.abs(npc.group.position.y - groundAtNpc) < 0.2 && npc.group.position.y < leftDeck.topY - 1.5) {
          reachedGround = true
        }
        if ((npc as any).formationTarget?.reached && reachedGround) break
      }

      expect(reachedGround).toBe(true)
      const finalGroundY = getTerrainHeight(npc.group.position.x, npc.group.position.z)
      expect(npc.group.position.y).toBeCloseTo(finalGroundY, 1)
    })
  })

  describe('Arrival Layer Isolation', () => {
    it('does not declare arrival when NPC is on ground directly beneath player on deck', () => {
      const { outpost, leftDeck } = setupOutpost('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      const testX = -20
      const testZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2

      // Player on rampart deck above
      player.group.position.set(testX, leftDeck.topY + 0.95, testZ)

      // NPC on ground directly beneath the deck slab
      const groundY = getTerrainHeight(testX, testZ)
      const npc = new NPC(scene, testX, testZ, Faction.PLAYER, 'viking', AIType.MELEE, 'BeneathFollower', 2, false)
      npc.group.position.set(testX, groundY, testZ)
      onTestFinished(() => npc.dispose())

      npc.assignFollowTarget(player, 0)

      // 1 frame update
      navWorld.beginFrame()
      npc.update(
        FRAME,
        player,
        [npc],
        [],
        outpost.obstacles,
        { setFill: () => {} },
        () => {},
        () => {},
        false,
        0,
        null,
        null,
        navWorld,
      )

      // Even though 2D horizontal distance is nearly 0, reached MUST be false
      expect((npc as any).formationTarget?.reached).toBe(false)
      // NPC must be moving toward the stair entrance to climb up
      expect((npc as any).visualMovementSpeed).toBeGreaterThan(0)
    })
  })

  describe('Mounted Unit Exclusion', () => {
    it('keeps mounted unit on ground when following player on rampart', () => {
      const { outpost, leftDeck } = setupOutpost('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Player on deck
      player.group.position.set(-20, leftDeck.topY + 0.95, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2)

      // Mounted NPC on ground
      const groundZ = 135
      const rider = new NPC(scene, 0, groundZ, Faction.PLAYER, 'viking', AIType.MELEE, 'MountedRider', 2, true)
      onTestFinished(() => rider.dispose())

      rider.assignFollowTarget(player, 0)

      for (let f = 0; f < 60; f++) {
        navWorld.beginFrame()
        rider.update(
          FRAME,
          player,
          [rider],
          [],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )
      }

      // Mounted NPC must stay at ground height, never snapping onto elevated deck
      expect(rider.combatPosition.y).toBeLessThan(leftDeck.topY - 1.5)
    })
  })

  describe('Scenario C: Melee charge from ground to rampart', () => {
    it('melee attacker on ground climbs stair to engage enemy on rampart deck', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0) // Park dummy player out of sight

      // Enemy on left rampart deck
      const enemyX = -22
      const enemyZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      const enemy = new NPC(scene, enemyX, enemyZ, Faction.ENEMY, 'roman', AIType.MELEE, 'DeckDefender', 2, false)
      enemy.group.position.set(enemyX, leftDeck.topY, enemyZ)
      onTestFinished(() => enemy.dispose())

      // Friendly attacker on ground near the stair entrance
      const attackerZ = leftStair.ramp.startZ - leftStair.ramp.dirZ * 3
      const attackerY = getTerrainHeight(leftStair.ramp.startX, attackerZ)
      const attacker = new NPC(scene, leftStair.ramp.startX, attackerZ, Faction.PLAYER, 'viking', AIType.MELEE, 'GroundAttacker', 2, false)
      attacker.group.position.set(leftStair.ramp.startX, attackerY, attackerZ)
      attacker.setTacticalOrder('charge')
      onTestFinished(() => attacker.dispose())

      // Simulate combat approach
      let attackedOnDeck = false
      for (let f = 0; f < 300; f++) {
        navWorld.beginFrame()
        attacker.update(
          FRAME,
          dummyPlayer,
          [attacker, enemy],
          [enemy],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )



        if ((attacker as any).state === AIState.ATTACK && Math.abs(attacker.group.position.y - leftDeck.topY) < 0.2) {
          attackedOnDeck = true
          break
        }
      }

      // Attacker must have climbed to deck to attack
      expect(attackedOnDeck).toBe(true)
      expect(attacker.group.position.y).toBeCloseTo(leftDeck.topY, 1)
    })
  })

  describe('Scenario D: Melee pursuit from rampart to ground', () => {
    it('melee attacker on rampart pursues enemy down the stairs to the ground', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0)

      // Friendly attacker starts on left rampart deck
      const deckZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      const attacker = new NPC(scene, -20, deckZ, Faction.PLAYER, 'viking', AIType.MELEE, 'DeckPursuer', 2, false)
      attacker.group.position.set(-20, leftDeck.topY, deckZ)
      onTestFinished(() => attacker.dispose())

      // Enemy is on the ground courtyard
      const groundZ = leftStair.ramp.startZ - leftStair.ramp.dirZ * 5
      const enemy = new NPC(scene, -20, groundZ, Faction.ENEMY, 'roman', AIType.MELEE, 'GroundTarget', 2, false)
      const groundY = getTerrainHeight(-20, groundZ)
      enemy.group.position.set(-20, groundY, groundZ)
      onTestFinished(() => enemy.dispose())

      let descendedToGround = false
      for (let f = 0; f < 350; f++) {
        navWorld.beginFrame()
        attacker.update(
          FRAME,
          dummyPlayer,
          [attacker, enemy],
          [enemy],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )

        const groundAtAttacker = getTerrainHeight(attacker.group.position.x, attacker.group.position.z)
        if (Math.abs(attacker.group.position.y - groundAtAttacker) < 0.25 && attacker.group.position.y < leftDeck.topY - 1.5) {
          descendedToGround = true
          break
        }
      }

      expect(descendedToGround).toBe(true)
    })
  })

  describe('Stair Multi-NPC Traffic Anti-Deadlock', () => {
    it('two NPCs in opposing directions on stairs maintain lane separation and avoid deadlock', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0)

      const cx = leftStair.ramp.startX
      const dirZ = leftStair.ramp.dirZ

      // NPC A: Starts near bottom of stairs, moving UP to the rampart deck
      const startBottomZ = leftStair.ramp.startZ + dirZ * 0.5
      const startBottomY = getTerrainHeight(cx, startBottomZ)
      const ascendingNpc = new NPC(scene, cx, startBottomZ, Faction.PLAYER, 'viking', AIType.MELEE, 'AscendingNPC', 2, false)
      ascendingNpc.group.position.set(cx, startBottomY, startBottomZ)
      ascendingNpc.assignFormationTarget(
        1,
        new THREE.Vector3(-22, leftDeck.topY, (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2),
        new THREE.Vector3(0, 0, dirZ),
      )

      // NPC B: Starts near top of stairs on deck, moving DOWN to ground courtyard
      const startTopZ = leftStair.ramp.startZ + dirZ * (leftStair.ramp.length - 0.5)
      const startTopY = leftStair.ramp.topY
      const descendingNpc = new NPC(scene, cx, startTopZ, Faction.PLAYER, 'viking', AIType.MELEE, 'DescendingNPC', 2, false)
      descendingNpc.group.position.set(cx, startTopY, startTopZ)
      const groundTargetZ = leftStair.ramp.startZ - dirZ * 6
      const groundTargetY = getTerrainHeight(cx, groundTargetZ)
      descendingNpc.assignFormationTarget(
        2,
        new THREE.Vector3(cx, groundTargetY, groundTargetZ),
        new THREE.Vector3(0, 0, -dirZ),
      )

      onTestFinished(() => {
        ascendingNpc.dispose()
        descendingNpc.dispose()
      })

      const halfWidth = leftStair.ramp.halfWidth
      let withinRailEnvelope = true
      let bothReachedDestination = false
      let finalFrames = 0

      const broadPhase = new EntityCollisionBroadPhase()
      const allNpcs = [ascendingNpc, descendingNpc]
      const bodies: EntityCollisionBody[] = [
        { position: ascendingNpc.position, radius: 0.5, height: 2.3, bottomOffset: 0, walkSurfaces: true },
        { position: descendingNpc.position, radius: 0.5, height: 2.3, bottomOffset: 0, walkSurfaces: true },
      ]

      // Update both NPCs on the stairs over bounded frames with real boid separation and production entity collision
      for (let f = 0; f < 220; f++) {
        finalFrames = f + 1
        navWorld.beginFrame()
        ascendingNpc.update(FRAME, dummyPlayer, allNpcs, allNpcs, outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
        descendingNpc.update(FRAME, dummyPlayer, allNpcs, allNpcs, outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)

        // Production entity collision resolution: broad phase pair resolve + obstacle pushout
        broadPhase.resolve(bodies, outpost.obstacles)
        for (const b of bodies) {
          resolveObstacleCollision(
            b.position,
            b.position,
            0,
            true,
            b.radius,
            b.height,
            b.bottomOffset,
            outpost.obstacles,
            { walkSurfaces: b.walkSurfaces },
          )
        }

        const nav = navWorld.outpostNav!
        const ascLayer = nav.getNavLayer(ascendingNpc.combatPosition)
        const dscLayer = nav.getNavLayer(descendingNpc.combatPosition)

        if (isStairLayer(ascLayer)) {
          if (ascendingNpc.group.position.x < cx - halfWidth || ascendingNpc.group.position.x > cx + halfWidth) {
            withinRailEnvelope = false
          }
        }
        if (isStairLayer(dscLayer)) {
          if (descendingNpc.group.position.x < cx - halfWidth || descendingNpc.group.position.x > cx + halfWidth) {
            withinRailEnvelope = false
          }
        }

        const ascReachedDeck = ascLayer === 'rampart_left'
        const dscReachedGround = dscLayer === 'ground'
          && dirZ * (leftStair.ramp.startZ - descendingNpc.group.position.z) >= 0.5

        if (ascReachedDeck && dscReachedGround) {
          bothReachedDestination = true
          break
        }
      }

      const nav = navWorld.outpostNav!
      const finalDiagnostic = {
        frames: finalFrames,
        ascending: {
          pos: { x: ascendingNpc.group.position.x, y: ascendingNpc.group.position.y, z: ascendingNpc.group.position.z },
          layer: nav.getNavLayer(ascendingNpc.combatPosition),
          progressAlongRamp: dirZ * (ascendingNpc.group.position.z - leftStair.ramp.startZ),
        },
        descending: {
          pos: { x: descendingNpc.group.position.x, y: descendingNpc.group.position.y, z: descendingNpc.group.position.z },
          layer: nav.getNavLayer(descendingNpc.combatPosition),
          progressAlongRamp: dirZ * (leftStair.ramp.startZ + dirZ * leftStair.ramp.length - descendingNpc.group.position.z),
        },
      }

      // Both NPCs must remain within the 2.2m stair envelope throughout
      expect(withinRailEnvelope, `NPCs must remain within stair rail boundaries during traversal: ${JSON.stringify(finalDiagnostic)}`).toBe(true)

      // Both NPCs must physically pass the meeting area and arrive at their target destination regions without deadlock
      expect(bothReachedDestination, `Both NPCs should complete traversal without deadlocking: ${JSON.stringify(finalDiagnostic)}`).toBe(true)
      expect(finalDiagnostic.ascending.layer).toBe('rampart_left')
      expect(finalDiagnostic.descending.layer).toBe('ground')
    })
  })

  describe('P1 Regression: Mounted unit combat with closed vs opened gate', () => {
    it('mounted unit pursuing enemy on rampart cannot pass closed gate, but paths to ground below enemy once gate is opened', () => {
      const { outpost, leftDeck } = setupOutpost('viking')
      const placement = getCampaignOutpostPlacement('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0)

      // Enemy stands on left rampart deck
      const enemyX = -22
      const enemyZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      const enemy = new NPC(scene, enemyX, enemyZ, Faction.ENEMY, 'roman', AIType.MELEE, 'DeckDefender', 2, false)
      enemy.group.position.set(enemyX, leftDeck.topY, enemyZ)
      onTestFinished(() => enemy.dispose())

      // Mounted attacker starts OUTSIDE the outpost front gate (Z < frontZ)
      const gateZ = placement.frontZ
      const outsideZ = gateZ - 14
      const outsideY = getTerrainHeight(0, outsideZ)
      const rider = new NPC(scene, 0, outsideZ, Faction.PLAYER, 'viking', AIType.MELEE, 'MountedAttacker', 2, true)
      rider.group.position.set(0, outsideY, outsideZ)
      onTestFinished(() => rider.dispose())

      // Phase 1: Gate is closed. Rider in CHASE must NOT penetrate the closed gate/palisade
      for (let f = 0; f < 60; f++) {
        navWorld.beginFrame()
        rider.update(FRAME, dummyPlayer, [rider, enemy], [enemy], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
      }

      // Rider cannot penetrate through the gate into the courtyard
      expect(rider.combatPosition.z, 'Mounted unit must not pass through closed gate').toBeLessThanOrEqual(gateZ + 0.5)
      expect(rider.combatPosition.y, 'Mounted unit must stay on ground').toBeLessThan(leftDeck.topY - 1.5)

      // Phase 2: Open gate and sync navigation grid
      outpost.gateController.open()
      navWorld.sync(outpost.obstacles)

      // Update rider now that a walkable ground route is available through the gate
      for (let f = 0; f < 120; f++) {
        navWorld.beginFrame()
        rider.update(FRAME, dummyPlayer, [rider, enemy], [enemy], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
      }

      // Rider successfully navigates through the gate into the outpost toward the ground under the enemy
      expect(rider.combatPosition.z, 'Mounted unit should enter through opened gate').toBeGreaterThan(gateZ)
      // Rider remains strictly on ground, never climbs stairs
      expect(rider.combatPosition.y, 'Mounted unit must never climb stairs onto rampart').toBeLessThan(leftDeck.topY - 1.5)
    })
  })

  describe('P2 Regression: Cross-layer follow with closed gate and A* pending frame budget', () => {
    it('ground follower safely stops outside when gate is closed and leader is on rampart', () => {
      const { outpost, leftDeck } = setupOutpost('viking')
      const placement = getCampaignOutpostPlacement('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Player stands on elevated rampart deck inside outpost
      const playerZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      player.group.position.set(-20, leftDeck.topY + 0.95, playerZ)

      // Ground follower starts outside the closed front gate
      const gateZ = placement.frontZ
      const outsideZ = gateZ - 14
      const outsideY = getTerrainHeight(0, outsideZ)
      const follower = new NPC(scene, 0, outsideZ, Faction.PLAYER, 'viking', AIType.MELEE, 'GateBlockedFollower', 2, false)
      follower.group.position.set(0, outsideY, outsideZ)
      onTestFinished(() => follower.dispose())

      follower.assignFollowTarget(player, 0)
      expect(outpost.gateController.state).toBe('closed')

      // Simulate 60 frames while gate is closed
      for (let f = 0; f < 60; f++) {
        navWorld.beginFrame()
        follower.update(FRAME, player, [follower], [], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
      }

      // Follower must safely stop outside without passing through the closed gate/palisade
      expect(follower.combatPosition.z, 'Follower must not penetrate through closed gate').toBeLessThanOrEqual(gateZ + 0.5)
    })

    it('NPC waiting for A* budget frame saturation (pending) safely waits and does not charge into wall', () => {
      const { outpost, leftDeck } = setupOutpost('viking')
      const placement = getCampaignOutpostPlacement('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Open gate so route is theoretically walkable
      outpost.gateController.open()
      navWorld.sync(outpost.obstacles)

      // Player stands on elevated rampart deck
      const playerZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      player.group.position.set(-20, leftDeck.topY + 0.95, playerZ)

      // Follower starts outside the gate
      const outsideZ = placement.frontZ - 14
      const outsideY = getTerrainHeight(0, outsideZ)
      const follower = new NPC(scene, 0, outsideZ, Faction.PLAYER, 'viking', AIType.MELEE, 'BudgetWaitFollower', 2, false)
      follower.group.position.set(0, outsideY, outsideZ)
      onTestFinished(() => follower.dispose())

      follower.assignFollowTarget(player, 0)

      // Exhaust A* frame budget for the current frame
      navWorld.beginFrame()
      for (let i = 0; i < NAV_PATH_REQUESTS_PER_FRAME; i++) {
        navWorld.queryPath({ x: -10 + i * 2, z: i * 4 }, { x: 10 + i * 2, z: i * 4 })
      }
      expect((navWorld as any).pathRequestsThisFrame).toBeGreaterThanOrEqual(NAV_PATH_REQUESTS_PER_FRAME)

      const prevZ = follower.group.position.z

      // Update follower during frame budget exhaustion: must receive pending and safely wait
      follower.update(FRAME, player, [follower], [], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)

      // When pending, follower does not sprint into obstacle
      expect(Math.abs(follower.group.position.z - prevZ), 'Follower must not displace when A* route is pending').toBeLessThan(0.01)

      // Refresh frame budget on next frame: query resolves and follower moves
      navWorld.beginFrame()
      follower.update(FRAME, player, [follower], [], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
      expect(follower.group.position.z, 'Follower should begin moving once budget is available').toBeGreaterThan(prevZ)
    })
  })

  describe('P1 Regression: Ground navigation around solid stair ramp', () => {
    it('mounted NPC routes around stair ramp in courtyard and reaches ground target on opposite side without getting stuck', () => {
      const { outpost, leftStair } = setupOutpost('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0)

      const cx = leftStair.ramp.startX
      const dirZ = leftStair.ramp.dirZ
      // A point along the lower half of the stair ramp
      const crossingZ = leftStair.ramp.startZ + dirZ * 2.5
      // Start 3.5m to the left of the stair
      const startX = cx - 3.5
      const startY = getTerrainHeight(startX, crossingZ)
      // Goal 3.5m to the right of the stair (direct segment cuts directly through stair.bounds)
      const goalX = cx + 3.5
      const goalY = getTerrainHeight(goalX, crossingZ)

      const rider = new NPC(scene, startX, crossingZ, Faction.PLAYER, 'viking', AIType.MELEE, 'CourtyardRider', 2, true)
      rider.group.position.set(startX, startY, crossingZ)
      onTestFinished(() => rider.dispose())

      rider.assignFormationTarget(
        1,
        new THREE.Vector3(goalX, goalY, crossingZ),
        new THREE.Vector3(1, 0, 0),
      )

      // Simulate movement around the stair ramp
      let reachedGoal = false
      let minDistanceToGoal = Infinity
      let frameCount = 0
      for (let f = 0; f < 200; f++) {
        frameCount = f + 1
        navWorld.beginFrame()
        rider.update(FRAME, dummyPlayer, [rider], [rider], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)

        const dist = Math.hypot(rider.combatPosition.x - goalX, rider.combatPosition.z - crossingZ)
        if (dist < minDistanceToGoal) minDistanceToGoal = dist
        if (dist <= 1.5 || (rider as any).formationTarget?.reached) {
          reachedGoal = true
          break
        }
      }

      const nav = navWorld.outpostNav!
      const diagnostic = {
        frameCount,
        finalPos: rider.combatPosition.clone(),
        minDistanceToGoal,
        layer: nav.getNavLayer(rider.combatPosition),
      }

      // Mounted unit should navigate around the stair ramp without getting permanently blocked
      expect(reachedGoal, `Mounted unit must reach goal on opposite side of stair: ${JSON.stringify(diagnostic)}`).toBe(true)
      expect(diagnostic.layer).toBe('ground')
    })
  })

  describe('P1 Regression: NPC on rampart pursuing target midway down stair', () => {
    it('foot NPC on rampart stays in deck corridor until stair top without cutting diagonally into midair', () => {
      const { outpost, leftDeck, leftStair } = setupOutpost('viking')
      const player = new Player(scene)
      onTestFinished(() => player.dispose())

      // Player is halfway down the left stair ramp
      const midStairZ = (leftStair.ramp.startZ + leftStair.ramp.startZ + leftStair.ramp.dirZ * leftStair.ramp.length) / 2
      const midStairY = (leftStair.ramp.startY + leftStair.ramp.topY) / 2
      player.group.position.set(leftStair.ramp.startX, midStairY + 0.95, midStairZ)

      // Foot NPC starts on the left rampart deck corridor at x = -20
      const deckZ = (leftDeck.slab.min.z + leftDeck.slab.max.z) / 2
      const npc = new NPC(scene, -20, deckZ, Faction.PLAYER, 'viking', AIType.MELEE, 'DeckToStairFollower', 2, false)
      npc.group.position.set(-20, leftDeck.topY, deckZ)
      onTestFinished(() => npc.dispose())

      npc.assignFollowTarget(player, 0)

      let steppedOntoStair = false
      let deviatedFromDeckCorridor = false

      for (let f = 0; f < 300; f++) {
        navWorld.beginFrame()
        npc.update(
          FRAME,
          player,
          [npc],
          [],
          outpost.obstacles,
          { setFill: () => {} },
          () => {},
          () => {},
          false,
          0,
          null,
          null,
          navWorld,
        )

        const npcPos = npc.combatPosition
        const distToStairX = Math.abs(npcPos.x - leftStair.ramp.startX)

        // While NPC is traveling along the deck before reaching the stair opening (distToStairX > 1.2m):
        // It MUST stay within the deck slab corridor and maintain elevated deck height!
        if (distToStairX > 1.2) {
          const inDeckZ = npcPos.z >= leftDeck.slab.min.z - 0.3 && npcPos.z <= leftDeck.slab.max.z + 0.3
          const onDeckY = Math.abs(npcPos.y - leftDeck.topY) < 0.25
          if (!inDeckZ || !onDeckY) {
            deviatedFromDeckCorridor = true
          }
        } else {
          // NPC has reached the top landing of the stair and starts descending
          if (npcPos.y < leftDeck.topY - 0.2) {
            steppedOntoStair = true
          }
        }

        if (steppedOntoStair && Math.hypot(npcPos.x - leftStair.ramp.startX, npcPos.z - midStairZ) < 2.5) {
          break
        }
      }

      // NPC must never have cut diagonally off the deck into midair
      expect(deviatedFromDeckCorridor, 'NPC must stay inside the deck corridor while traveling along the rampart').toBe(false)
      // NPC must have successfully reached the stair and begun descending toward target
      expect(steppedOntoStair, 'NPC must proceed to stair top and descend along stair').toBe(true)
    })
  })
})
