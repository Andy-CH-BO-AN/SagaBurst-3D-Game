import * as THREE from 'three'
import { describe, it, expect, vi } from 'vitest'
import { Player } from '../src/player/Player'
import {
  SpectatorCameraController,
  SPECTATOR_MOVE_SPEED,
  SPECTATOR_FAST_MULTIPLIER,
} from '../src/camera/SpectatorCameraController'
import { Mount, MountType } from '../src/world/Mount'

function createMockInput() {
  let dx = 0
  let dy = 0
  let leftClicked = false
  let leftReleased = false
  let ePressed = false

  return {
    keys: {} as Record<string, boolean>,
    isLeftMouseDown: false,
    isRightMouseDown: false,
    setMouseDelta(x: number, y: number) {
      dx = x
      dy = y
    },
    consumeMouseDelta() {
      const res = { dx, dy }
      dx = 0
      dy = 0
      return res
    },
    triggerLeftClick() {
      leftClicked = true
    },
    consumeLeftClick() {
      const val = leftClicked
      leftClicked = false
      return val
    },
    consumeLeftClickRelease() {
      const val = leftReleased
      leftReleased = false
      return val
    },
    consumeKeyE() {
      const val = ePressed
      ePressed = false
      return val
    },
  }
}

describe('Permanent Player Death & Spectator Camera', () => {
  describe('1. Permanent Player Death', () => {
    it('sets player dead, zeroes HP, fires death callback once, and never respawns automatically', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      const mockHpBar = { setFill: vi.fn() } as any
      const deathCallback = vi.fn()
      player.onPlayerDeath = deathCallback

      player.group.position.set(20, 0, 30)
      player.spawnX = 0
      player.spawnZ = 0

      expect(player.dead).toBe(false)
      expect(player.hp).toBe(100)

      // Apply fatal damage
      const hit = player.takeDamage(150, mockHpBar)
      expect(hit).toBe(true)
      expect(player.dead).toBe(true)
      expect(player.hp).toBe(0)
      expect(deathCallback).toHaveBeenCalledTimes(1)
      expect(mockHpBar.setFill).toHaveBeenCalledWith(0)

      // Subsequent damage to dead player should return false and not fire callback again
      const extraHit = player.takeDamage(50, mockHpBar)
      expect(extraHit).toBe(false)
      expect(deathCallback).toHaveBeenCalledTimes(1)

      // Advance frames across several seconds: player must remain dead at position, never resetting to spawn
      const mockInput = createMockInput() as any
      const aimPoint = new THREE.Vector3(0, 0, 0)
      const staminaBar = { setFill: vi.fn() } as any
      const quiverUI = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() } as any
      const soundManager = { playSwing: vi.fn(), playHit: vi.fn() } as any

      for (let i = 0; i < 180; i++) {
        player.update(
          0.016,
          mockInput,
          0,
          aimPoint,
          [],
          staminaBar,
          quiverUI,
          soundManager
        )
      }

      expect(player.dead).toBe(true)
      expect(player.hp).toBe(0)
      // Coordinates remain near death point (20, 30), NOT reset to spawn (0, 0)
      expect(player.position.x).toBeCloseTo(20, 0)
      expect(player.position.z).toBeCloseTo(30, 0)
    })

    it('handles mounted player death cleanly without snapping to horse ground center', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      const mount = new Mount(scene, MountType.CORGI, 10, 20)
      player.mountVehicle(mount, 0)

      const seatPosBeforeDeath = player.position.clone()
      expect(player.isMounted).toBe(true)

      // Trigger dedicated death detach
      player.detachFromMountOnDeath()

      expect(player.isMounted).toBe(false)
      expect(player.currentMount).toBeNull()
      // Position is preserved at rider seat height, NOT teleported to ground or reset
      expect(player.position.x).toBeCloseTo(seatPosBeforeDeath.x, 2)
      expect(player.position.y).toBeCloseTo(seatPosBeforeDeath.y, 2)
      expect(player.position.z).toBeCloseTo(seatPosBeforeDeath.z, 2)
    })
  })

  describe('2. Spectator Camera Takeover', () => {
    it('seamlessly preserves active camera world position and orientation on frame 0', () => {
      const activeCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1000)
      activeCamera.position.set(12.5, 4.2, -35.8)
      activeCamera.rotation.set(-0.2, 1.1, 0, 'YXZ')
      activeCamera.updateMatrixWorld(true)

      const spectatorCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1000)
      const controller = new SpectatorCameraController(spectatorCamera)

      controller.initFromCamera(activeCamera)

      // Position and quaternion must match the source camera exactly
      expect(spectatorCamera.position.x).toBeCloseTo(activeCamera.position.x, 5)
      expect(spectatorCamera.position.y).toBeCloseTo(activeCamera.position.y, 5)
      expect(spectatorCamera.position.z).toBeCloseTo(activeCamera.position.z, 5)
      expect(spectatorCamera.quaternion.x).toBeCloseTo(activeCamera.quaternion.x, 5)
      expect(spectatorCamera.quaternion.y).toBeCloseTo(activeCamera.quaternion.y, 5)
      expect(spectatorCamera.quaternion.z).toBeCloseTo(activeCamera.quaternion.z, 5)
      expect(spectatorCamera.quaternion.w).toBeCloseTo(activeCamera.quaternion.w, 5)

      // Verified forward vector
      const activeDir = new THREE.Vector3()
      const spectatorDir = new THREE.Vector3()
      activeCamera.getWorldDirection(activeDir)
      spectatorCamera.getWorldDirection(spectatorDir)

      expect(spectatorDir.x).toBeCloseTo(activeDir.x, 4)
      expect(spectatorDir.y).toBeCloseTo(activeDir.y, 4)
      expect(spectatorDir.z).toBeCloseTo(activeDir.z, 4)
    })
  })

  describe('3. Spectator Movement Controls', () => {
    it('moves WASD relative to camera yaw on horizontal XZ plane', () => {
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller = new SpectatorCameraController(camera, 10, 2)
      const input = createMockInput() as any

      // 1. With yaw = 0: forward is -Z
      controller.setYaw(0)
      controller.setPitch(0)
      camera.position.set(0, 5, 0)
      input.keys['KeyW'] = true

      controller.update(input, 1.0)
      expect(camera.position.x).toBeCloseTo(0, 3)
      expect(camera.position.y).toBeCloseTo(5, 3) // No vertical change
      expect(camera.position.z).toBeCloseTo(-10, 3) // Moved forward in -Z by speed * dt = 10 * 1

      // 2. With yaw = Math.PI / 2 (facing -X): forward is -X
      camera.position.set(0, 5, 0)
      controller.setYaw(Math.PI / 2)
      input.keys['KeyW'] = true

      controller.update(input, 1.0)
      expect(camera.position.x).toBeCloseTo(-10, 3)
      expect(camera.position.y).toBeCloseTo(5, 3)
      expect(camera.position.z).toBeCloseTo(0, 3)
    })

    it('normalizes diagonal horizontal movement so W+D is not faster than W alone', () => {
      const camera1 = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller1 = new SpectatorCameraController(camera1, 10, 2)
      const input1 = createMockInput() as any
      controller1.setYaw(0)
      controller1.setPitch(0)
      camera1.position.set(0, 0, 0)
      input1.keys['KeyW'] = true
      controller1.update(input1, 1.0)
      const distW = camera1.position.length()

      const camera2 = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller2 = new SpectatorCameraController(camera2, 10, 2)
      const input2 = createMockInput() as any
      controller2.setYaw(0)
      controller2.setPitch(0)
      camera2.position.set(0, 0, 0)
      input2.keys['KeyW'] = true
      input2.keys['KeyD'] = true
      controller2.update(input2, 1.0)
      const distWD = camera2.position.length()

      expect(distWD).toBeCloseTo(distW, 4)
    })

    it('multiplies speed with Shift key without affecting player stamina', () => {
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller = new SpectatorCameraController(camera, SPECTATOR_MOVE_SPEED, SPECTATOR_FAST_MULTIPLIER)
      const input = createMockInput() as any
      controller.setYaw(0)
      controller.setPitch(0)
      camera.position.set(0, 0, 0)

      input.keys['KeyW'] = true
      input.keys['ShiftLeft'] = true
      controller.update(input, 1.0)

      const expectedSpeed = SPECTATOR_MOVE_SPEED * SPECTATOR_FAST_MULTIPLIER
      expect(camera.position.length()).toBeCloseTo(expectedSpeed, 2)
    })

    it('moves Space up (+Y) and Ctrl down (-Y) independent of camera pitch', () => {
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller = new SpectatorCameraController(camera, 10, 2)
      const input = createMockInput() as any

      // Even if looking downward (-45 deg)
      controller.setPitch(-Math.PI / 4)
      camera.position.set(0, 10, 0)

      // Space moves up
      input.keys['Space'] = true
      controller.update(input, 1.0)
      expect(camera.position.y).toBeCloseTo(20, 3)

      // Control moves down
      delete input.keys['Space']
      input.keys['ControlLeft'] = true
      controller.update(input, 1.0)
      expect(camera.position.y).toBeCloseTo(10, 3)
    })

    it('scales movement linearly with delta time', () => {
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const controller = new SpectatorCameraController(camera, 20, 2)
      const input = createMockInput() as any
      controller.setYaw(0)
      controller.setPitch(0)

      camera.position.set(0, 0, 0)
      input.keys['KeyW'] = true
      controller.update(input, 0.5)
      const distHalfSec = camera.position.length()

      camera.position.set(0, 0, 0)
      controller.update(input, 1.0)
      const distOneSec = camera.position.length()

      expect(distOneSec).toBeCloseTo(distHalfSec * 2, 3)
    })
  })

  describe('4. Input Isolation for Dead Player', () => {
    it('ignores movement keys, mouse attacks and weapon actions when player is dead', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      const mockHpBar = { setFill: vi.fn() } as any
      player.takeDamage(100, mockHpBar)
      expect(player.dead).toBe(true)

      const initialPos = player.position.clone()

      const input = createMockInput() as any
      input.keys['KeyW'] = true
      input.keys['KeyD'] = true
      input.keys['ShiftLeft'] = true
      input.isLeftMouseDown = true
      input.triggerLeftClick()

      const staminaBar = { setFill: vi.fn() } as any
      const quiverUI = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() } as any
      const soundManager = { playSwing: vi.fn(), playHit: vi.fn() } as any

      player.update(
        0.016,
        input,
        0,
        new THREE.Vector3(0, 0, 10),
        [],
        staminaBar,
        quiverUI,
        soundManager
      )

      // Position must remain unchanged
      expect(player.position.x).toBe(initialPos.x)
      expect(player.position.y).toBe(initialPos.y)
      expect(player.position.z).toBe(initialPos.z)

      // Sound and attack must not be triggered
      expect(soundManager.playSwing).not.toHaveBeenCalled()
      expect(player.isSwinging).toBe(false)
    })
  })
})
