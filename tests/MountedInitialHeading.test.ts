import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { Player } from '../src/player/Player'
import { Mount, MountType, MountState } from '../src/world/Mount'
import type { PlayerInput } from '../src/player/PlayerInput'

function createMockInput(keys: Record<string, boolean> = {}): PlayerInput {
  return {
    keys: { ...keys },
    consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    consumeLeftClick: () => false,
    consumeLeftClickRelease: () => false,
    consumeRightClick: () => false,
    isPointerLocked: () => true,
    requestPointerLock: () => {},
    exitPointerLock: () => {},
    update: () => {},
    dispose: () => {},
  } as unknown as PlayerInput
}

const cameraAimPoint = new THREE.Vector3(0, 0, -10)

function updatePlayer(player: Player, dt: number, input: PlayerInput, cameraYaw = 0): void {
  const obstacles: any[] = []
  const staminaBar = { setFill: () => {} } as any
  const quiverUI = { setAiming: () => {}, setChargeRatio: () => {}, setShieldBlocked: () => {} } as any
  const soundManager = { playSwing: () => {}, playBowRelease: () => {}, playHit: () => {} } as any
  player.update(dt, input, cameraYaw, cameraAimPoint, obstacles, staminaBar, quiverUI, soundManager)
}

describe('Mounted Initial Heading & Movement Regression Tests', () => {
  let scene: THREE.Scene
  let player: Player

  beforeEach(() => {
    scene = new THREE.Scene()
    player = new Player(scene)
    // Game initialization sets player to face battlefield forward (-Z)
    player.faceDirection(0, -1)
  })

  it('initializes mount heading to match player facing yaw upon mounting without input', () => {
    const mount = new Mount(scene, MountType.CORGI, 0, 145)
    // Mount is constructed with default rotation.y = 0
    expect(mount.group.rotation.y).toBe(0)

    // Player enters mounted state via mountVehicle
    player.mountVehicle(mount)

    expect(player.isMounted).toBe(true)
    expect(player.currentMount).toBe(mount)
    expect(mount.state).toBe(MountState.CONTROLLED)

    // Horse heading must be Math.PI (-Z, toward battle)
    expect(mount.group.rotation.y).toBeCloseTo(Math.PI, 6)
    // Player facingYaw must match mount heading
    expect(player.facingYaw).toBeCloseTo(Math.PI, 6)
  })

  it('preserves mounted heading without drift across multiple idle frames', () => {
    const mount = new Mount(scene, MountType.CORGI, 0, 145)
    player.mountVehicle(mount)

    const initialMountHeading = mount.group.rotation.y
    const initialPlayerHeading = player.facingYaw

    // 10 idle frames with zero input
    const idleInput = createMockInput()
    for (let i = 0; i < 10; i++) {
      updatePlayer(player, 0.016, idleInput, 0)
    }

    expect(mount.group.rotation.y).toBeCloseTo(initialMountHeading, 6)
    expect(player.facingYaw).toBeCloseTo(initialPlayerHeading, 6)
  })

  it('produces zero orientation snap on the first W press frame', () => {
    const mount = new Mount(scene, MountType.CORGI, 0, 145)
    player.mountVehicle(mount)

    // Let 3 idle frames run first
    const idleInput = createMockInput()
    for (let i = 0; i < 3; i++) {
      updatePlayer(player, 0.016, idleInput, 0)
    }

    const preWHeading = mount.group.rotation.y
    expect(preWHeading).toBeCloseTo(Math.PI, 6)

    // First frame of pressing W with camera looking along -Z (cameraYaw = 0)
    const wInput = createMockInput({ KeyW: true })
    updatePlayer(player, 0.016, wInput, 0)

    const postWHeading = mount.group.rotation.y
    const headingDelta = Math.abs(Math.atan2(Math.sin(postWHeading - preWHeading), Math.cos(postWHeading - preWHeading)))

    // Heading delta must be essentially zero; no ~180° inversion
    expect(headingDelta).toBeLessThan(1e-5)
    expect(postWHeading).toBeCloseTo(Math.PI, 6)
    expect(player.facingYaw).toBeCloseTo(Math.PI, 6)
  })

  it('moves the mount towards negative Z (intended battlefield forward) when pressing W', () => {
    const mount = new Mount(scene, MountType.CORGI, 0, 145)
    player.mountVehicle(mount)

    const initialZ = mount.group.position.z
    const wInput = createMockInput({ KeyW: true })

    // Simulate 5 frames of moving forward (dt = 0.1s total)
    for (let i = 0; i < 5; i++) {
      updatePlayer(player, 0.02, wInput, 0)
    }

    // Mount should move along -Z towards enemy frontline (Z < 145)
    expect(mount.group.position.z).toBeLessThan(initialZ)
    expect(initialZ - mount.group.position.z).toBeCloseTo(12 * 0.1, 1)
  })
})
