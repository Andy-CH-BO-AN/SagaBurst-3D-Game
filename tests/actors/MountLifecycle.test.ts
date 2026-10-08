import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'

vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Mount Class Real Lifecycle Transitions', () => {
  it('transitions actual Mount instance through IDLE -> CONTROLLED -> IDLE -> DEAD states', () => {
    const scene = new THREE.Scene()
    // Only the visual boundary is replaced; Mount state and damage transitions remain real.
    const mount = new Mount(scene, MountType.CORGI, 0, 0)
    onTestFinished(() => mount.dispose())

    // 1. Initial idle state
    expect(mount.state).toBe(MountState.IDLE)
    expect(mount.availableForPlayer).toBe(true)
    expect(mount.dead).toBe(false)

    // 2. Mounted state
    mount.state = MountState.CONTROLLED
    expect(mount.state).toBe(MountState.CONTROLLED)
    expect(mount.availableForPlayer).toBe(false)

    // 3. Dismounted by player
    mount.releaseRider()
    expect(mount.state).toBe(MountState.IDLE)
    expect(mount.availableForPlayer).toBe(true)

    // 4. Fatal damage
    const hitSuccess = mount.takeDamage(mount.maxHp + 10)
    expect(hitSuccess).toBe(true)
    expect(mount.state).toBe(MountState.DEAD)
    expect(mount.dead).toBe(true)
    expect(mount.availableForPlayer).toBe(false)

    mount.dispose()
  })
  it('preserves player saddle height when a mount dies on elevated ground', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    onTestFinished(() => player.dispose())
    const mount = new Mount(scene, MountType.CORGI, 0, 0, 8)
    onTestFinished(() => mount.dispose())

    player.mountVehicle(mount)
    expect(player.isMounted).toBe(true)
    const mountedHeight = player.position.y

    mount.takeDamage(mount.maxHp)

    expect(player.isMounted).toBe(false)
    expect(player.position.y).toBeCloseTo(mountedHeight, 5)
  })

})
