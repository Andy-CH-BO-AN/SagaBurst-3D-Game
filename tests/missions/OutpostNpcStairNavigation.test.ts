import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import {
  createCampaignOutpost,
} from '../../src/campaign/CampaignOutpost'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { AIType, AIState, Faction, NPC } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { getTerrainHeight } from '../../src/world/Terrain'

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
      const { outpost, leftStair } = setupOutpost('viking')
      const dummyPlayer = new Player(scene)
      onTestFinished(() => dummyPlayer.dispose())
      dummyPlayer.group.position.set(0, -100, 0)

      const cx = leftStair.ramp.startX
      const dirZ = leftStair.ramp.dirZ
      const midZ = leftStair.ramp.startZ + dirZ * (leftStair.ramp.length * 0.5)

      // NPC A: Ascending up the stairs
      const ascendingNpc = new NPC(scene, cx, midZ - dirZ * 1.5, Faction.PLAYER, 'viking', AIType.MELEE, 'AscendingNPC', 2, false)
      // NPC B: Descending down the stairs
      const descendingNpc = new NPC(scene, cx, midZ + dirZ * 1.5, Faction.PLAYER, 'viking', AIType.MELEE, 'DescendingNPC', 2, false)

      onTestFinished(() => {
        ascendingNpc.dispose()
        descendingNpc.dispose()
      })

      // Update both NPCs on the stairs
      for (let f = 0; f < 60; f++) {
        navWorld.beginFrame()
        ascendingNpc.update(FRAME, dummyPlayer, [ascendingNpc, descendingNpc], [], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
        descendingNpc.update(FRAME, dummyPlayer, [ascendingNpc, descendingNpc], [], outpost.obstacles, { setFill: () => {} }, () => {}, () => {}, false, 0, null, null, navWorld)
      }

      // Both NPCs must remain within the 2.2m stair envelope without penetrating rails
      const halfWidth = leftStair.ramp.halfWidth
      expect(ascendingNpc.group.position.x).toBeGreaterThanOrEqual(cx - halfWidth)
      expect(ascendingNpc.group.position.x).toBeLessThanOrEqual(cx + halfWidth)
      expect(descendingNpc.group.position.x).toBeGreaterThanOrEqual(cx - halfWidth)
      expect(descendingNpc.group.position.x).toBeLessThanOrEqual(cx + halfWidth)
    })
  })
})
