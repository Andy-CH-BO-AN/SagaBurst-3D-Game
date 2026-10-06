import { resolveMountImpacts } from '../src/combat/MountImpact'
import { calculateMountImpactDamage } from '../src/combat/CombatBalance'
import type { CombatEvent } from '../src/combat/CombatAttribution'
import { resolveSkillProgressionAward } from '../src/rpg/CombatSkillProgression'
import { NPC, AIType, Faction } from '../src/world/NPC'
import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { Player } from '../src/player/Player'
import type { PlayerInput } from '../src/player/PlayerInput'
import type { StaminaBar } from '../src/ui/StaminaBar'
import type { QuiverUI } from '../src/ui/QuiverUI'
import type { SoundManager } from '../audio/SoundManager'
import { Mount, MountType } from '../src/world/Mount'

function createMockInput(keys: Record<string, boolean> = {}): PlayerInput {
  return {
    keys: { ...keys },
    isLeftMouseDown: false,
    isRightMouseDown: false,
    consumeLeftClick: () => false,
    consumeLeftClickRelease: () => false,
    consumeRightClick: () => false,
  } as unknown as PlayerInput
}

function createMockStaminaBar(): StaminaBar {
  return {
    setFill: vi.fn(),
  } as unknown as StaminaBar
}

function createMockQuiverUI(): QuiverUI {
  return {
    setAiming: vi.fn(),
    setChargeRatio: vi.fn(),
  } as unknown as QuiverUI
}

function createMockSoundManager(): SoundManager {
  return {
    playSwing: vi.fn(),
    playBowRelease: vi.fn(),
  } as unknown as SoundManager
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('Player Directional Movement & Stamina', () => {
  let scene: THREE.Scene
  let player: Player
  let staminaBar: StaminaBar
  let quiverUI: QuiverUI
  let soundManager: SoundManager

  const cameraAimPoint = new THREE.Vector3(0, 0, -10)

  function updatePlayer(p: Player, dt: number, input: PlayerInput, yaw = 0) {
    p.update(dt, input, yaw, cameraAimPoint, [], staminaBar, quiverUI, soundManager)
  }

  beforeEach(() => {
    scene = new THREE.Scene()
    player = new Player(scene)
    staminaBar = createMockStaminaBar()
    quiverUI = createMockQuiverUI()
    soundManager = createMockSoundManager()
  })

  describe('Walk and Diagonal Speeds (Normalization)', () => {
    it('moves forward (W) at normal speed (8.0 u/s)', () => {
      const startPos = player.position.clone()
      const input = createMockInput({ KeyW: true })
      updatePlayer(player, 0.1, input)
      const displacement = horizontalDistance(player.position, startPos)
      expect(displacement).toBeCloseTo(0.8, 5) // 8.0 * 0.1
    })

    it('moves diagonal forward (W+A, W+D) at exact same magnitude as orthogonal (8.0 u/s, no sqrt(2) boost)', () => {
      // W alone
      const pW = new Player(scene)
      const startW = pW.position.clone()
      updatePlayer(pW, 0.1, createMockInput({ KeyW: true }))
      const distW = horizontalDistance(pW.position, startW)

      // W+A
      const pWA = new Player(scene)
      const startWA = pWA.position.clone()
      updatePlayer(pWA, 0.1, createMockInput({ KeyW: true, KeyA: true }))
      const distWA = horizontalDistance(pWA.position, startWA)

      // W+D
      const pWD = new Player(scene)
      const startWD = pWD.position.clone()
      updatePlayer(pWD, 0.1, createMockInput({ KeyW: true, KeyD: true }))
      const distWD = horizontalDistance(pWD.position, startWD)

      expect(distW).toBeCloseTo(0.8, 5)
      expect(distWA).toBeCloseTo(distW, 5)
      expect(distWD).toBeCloseTo(distW, 5)
    })

    it('moves backward (S) at 30% speed (2.4 u/s)', () => {
      const startPos = player.position.clone()
      const input = createMockInput({ KeyS: true })
      updatePlayer(player, 0.1, input)
      const displacement = horizontalDistance(player.position, startPos)
      expect(displacement).toBeCloseTo(0.24, 5) // 8.0 * 0.3 * 0.1 = 0.24
    })

    it('moves diagonal backward (S+A, S+D) at exact same 30% magnitude (2.4 u/s)', () => {
      // S alone
      const pS = new Player(scene)
      const startS = pS.position.clone()
      updatePlayer(pS, 0.1, createMockInput({ KeyS: true }))
      const distS = horizontalDistance(pS.position, startS)

      // S+A
      const pSA = new Player(scene)
      const startSA = pSA.position.clone()
      updatePlayer(pSA, 0.1, createMockInput({ KeyS: true, KeyA: true }))
      const distSA = horizontalDistance(pSA.position, startSA)

      // S+D
      const pSD = new Player(scene)
      const startSD = pSD.position.clone()
      updatePlayer(pSD, 0.1, createMockInput({ KeyS: true, KeyD: true }))
      const distSD = horizontalDistance(pSD.position, startSD)

      expect(distS).toBeCloseTo(0.24, 5)
      expect(distSA).toBeCloseTo(distS, 5)
      expect(distSD).toBeCloseTo(distS, 5)
    })

    it('moves lateral (A, D) at 100% speed (8.0 u/s)', () => {
      const startPos = player.position.clone()
      const input = createMockInput({ KeyA: true })
      updatePlayer(player, 0.1, input)
      const displacement = horizontalDistance(player.position, startPos)
      expect(displacement).toBeCloseTo(0.8, 5)
    })
  })

  describe('Sprint Eligibility and Stamina Drain', () => {
    it('town action cancellation clears the swing latch so Shift can sprint again', () => {
      const attack = createMockInput(); attack.consumeLeftClick = () => true; attack.isLocked = true
      const inventory = new InventoryManager({ meleeWeaponId: 'gladius_rusty', rangedWeaponId: '', shieldId: null })
      player.update(.016, attack, 0, cameraAimPoint, [], staminaBar, quiverUI, soundManager, inventory)
      expect(player.swinging).toBe(true)
      player.clearTownAction()
      expect(player.swinging).toBe(false)
      player.setStamina(100)
      const from = player.position.clone()
      updatePlayer(player, .1, createMockInput({ KeyW: true, ShiftLeft: true }))
      expect(horizontalDistance(player.position, from)).toBeCloseTo(1.6, 5)
      expect(player.staminaValue).toBeLessThan(100)
    })
    it('allows sprint on forward directions (W, W+A, W+D) and drains stamina', () => {
      player.setStamina(100)
      const input = createMockInput({ KeyW: true, ShiftLeft: true })
      updatePlayer(player, 0.1, input)
      // Sprint speed: 8 * 2.0 = 16.0 u/s -> 1.6 displacement in 0.1s
      expect(player.staminaValue).toBeLessThan(100)
      expect(player.staminaValue).toBeCloseTo(100 - 30 * 0.1, 2)
    })

    it('does NOT sprint with Shift + S and does NOT drain stamina', () => {
      player.setStamina(100)
      const input = createMockInput({ KeyS: true, ShiftLeft: true })
      const startPos = player.position.clone()
      updatePlayer(player, 0.1, input)

      // Speed remains 30% backward (2.4 u/s -> 0.24 in 0.1s)
      const displacement = horizontalDistance(player.position, startPos)
      expect(displacement).toBeCloseTo(0.24, 5)
      // Stamina is NOT drained (remains 100)
      expect(player.staminaValue).toBe(100)
    })

    it('does NOT sprint with Shift + S+A, Shift + S+D, Shift + A, Shift + D', () => {
      for (const nonForwardKey of [{ KeyS: true, KeyA: true }, { KeyS: true, KeyD: true }, { KeyA: true }, { KeyD: true }]) {
        const p = new Player(scene)
        p.setStamina(100)
        const input = createMockInput({ ...nonForwardKey, ShiftLeft: true })
        updatePlayer(p, 0.1, input)
        expect(p.staminaValue).toBe(100)
      }
    })

    it('immediately halts sprint and stops stamina drain when switching from W to S while holding Shift', () => {
      player.setStamina(100)

      // Step 1: Sprinting with W + Shift
      const inputW = createMockInput({ KeyW: true, ShiftLeft: true })
      updatePlayer(player, 0.1, inputW)
      expect(player.staminaValue).toBeCloseTo(97, 1)

      // Step 2: Still holding Shift, but changed input to S
      const staminaBeforeS = player.staminaValue
      const posBeforeS = player.position.clone()
      const inputS = createMockInput({ KeyS: true, ShiftLeft: true })
      updatePlayer(player, 0.1, inputS)

      // Displacement should be backward 30% (2.4 u/s * 0.1s = 0.24)
      const displacement = horizontalDistance(player.position, posBeforeS)
      expect(displacement).toBeCloseTo(0.24, 5)

      // Stamina should NOT decrease; it should actually regenerate (STAMINA_REGEN = 15/s -> +1.5 in 0.1s)
      expect(player.staminaValue).toBeGreaterThan(staminaBeforeS)
    })
  })

  describe('Mounted Player Directional Movement', () => {
    it.each([false, true])('mounted sprint with shieldRaised=%s still deals impact damage and awards Mounted Impact XP', raised => {
      const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: '', shieldId: 'scutum_t1' })
      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      player.mountVehicle(mount)
      player.setStamina(100)
      const controls = createMockInput({ KeyW: true, ShiftLeft: true })
      controls.isRightMouseDown = raised
      const start = mount.group.position.clone()
      player.update(.1, controls, 0, cameraAimPoint, [], staminaBar, quiverUI, soundManager, inventory)

      expect(player.shield.shieldRaised).toBe(raised)
      expect(player.isAiming).toBe(false)
      expect(player.currentMount).toBe(mount)
      expect(horizontalDistance(mount.group.position, start)).toBeCloseTo(mount.baseSpeed * .2, 5)
      expect(mount.isSprinting).toBe(true)
      expect(mount.skipImpactThisFrame).toBe(false)

      const target = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'impact-target', 1, false)
      target.group.position.copy(start).lerp(mount.group.position, .5)
      const hp = target.hp, impact = target.shield.shieldImpactRemaining
      const events: CombatEvent[] = []
      const options = {
        onDamagePlayer: () => { throw new Error('Player mount must not hit its own rider') },
        combatEvents: (event: CombatEvent) => { events.push(event) },
      }
      resolveMountImpacts([mount], player, [target], 1, options)
      const expected = Math.min(hp, calculateMountImpactDamage(mount.movementSpeed, true))
      expect(target.hp).toBeCloseTo(hp - expected)
      expect(target.shield.shieldImpactRemaining).toBe(impact)
      expect(player.shield.shieldImpactRemaining).toBe(7.5)
      const hit = events.find(event => event.type === 'damage_applied')
      expect(hit).toBeDefined()
      expect(resolveSkillProgressionAward(hit!, inventory.equippedMelee, true)).toEqual({ skill: 'mountedImpact', xp: expected })
      resolveMountImpacts([mount], player, [target], 1, options)
      expect(target.hp).toBeCloseTo(hp - expected) // Existing per-target cooldown still applies.

      controls.keys.ShiftLeft = false
      player.update(.1, controls, 0, cameraAimPoint, [], staminaBar, quiverUI, soundManager, inventory)
      expect(mount.isSprinting).toBe(false)
      expect(player.shield.shieldRaised).toBe(raised)
      target.dispose(); player.dispose(); mount.dispose()
    })

    it('applies 100% speed forward and 30% speed backward to Mount', () => {
      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      player.isMounted = true
      player.currentMount = mount

      // Forward W
      const startW = mount.group.position.clone()
      const inputW = createMockInput({ KeyW: true })
      updatePlayer(player, 0.1, inputW)
      const fwdDist = horizontalDistance(mount.group.position, startW)
      // mount baseSpeed = 12 -> 12 * 0.1 = 1.2
      expect(fwdDist).toBeCloseTo(1.2, 5)

      // Backward S
      const startS = mount.group.position.clone()
      const inputS = createMockInput({ KeyS: true })
      updatePlayer(player, 0.1, inputS)
      const backDist = horizontalDistance(mount.group.position, startS)
      // mount baseSpeed = 12 * 0.3 * 0.1 = 0.36
      expect(backDist).toBeCloseTo(0.36, 5)
    })

    it('mount sprint applies on W and does not apply on S', () => {
      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      player.isMounted = true
      player.currentMount = mount
      player.setStamina(100)

      // Shift + W on mount -> 12 * 2.0 * 0.1 = 2.4
      const startW = mount.group.position.clone()
      updatePlayer(player, 0.1, createMockInput({ KeyW: true, ShiftLeft: true }))
      expect(horizontalDistance(mount.group.position, startW)).toBeCloseTo(2.4, 5)

      // Shift + S on mount -> 12 * 0.3 * 0.1 = 0.36 (no sprint!)
      const startS = mount.group.position.clone()
      updatePlayer(player, 0.1, createMockInput({ KeyS: true, ShiftLeft: true }))
      expect(horizontalDistance(mount.group.position, startS)).toBeCloseTo(0.36, 5)
    })

    it('applies 50% speed for mounted lateral movement (A/D) while foot lateral remains 100%', () => {
      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      player.isMounted = true
      player.currentMount = mount

      // Mounted A (left) -> 12 * 0.5 * 0.1 = 0.6
      const startA = mount.group.position.clone()
      updatePlayer(player, 0.1, createMockInput({ KeyA: true }))
      expect(horizontalDistance(mount.group.position, startA)).toBeCloseTo(0.6, 5)

      // Mounted D (right) -> 12 * 0.5 * 0.1 = 0.6
      const startD = mount.group.position.clone()
      updatePlayer(player, 0.1, createMockInput({ KeyD: true }))
      expect(horizontalDistance(mount.group.position, startD)).toBeCloseTo(0.6, 5)

      // Foot A (left) on a dismounted player remains 100% (8 * 1.0 * 0.1 = 0.8)
      const footPlayer = new Player(scene)
      const footStartA = footPlayer.position.clone()
      updatePlayer(footPlayer, 0.1, createMockInput({ KeyA: true }))
      expect(horizontalDistance(footPlayer.position, footStartA)).toBeCloseTo(0.8, 5)
    })
  })
})
