import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Game } from '../../src/Game'
import { commanderOutpostCombatLocked } from '../../src/career/CommanderOutpost'
import type { Mount } from '../../src/world/Mount'

describe('Game pickup caller', () => {
  it('lets Game wire the interaction controller so dismounting works while the Commander Last Stand combat lock is active', () => {
    let pressed = false
    const state = { prompt: null as string | null, dismounts: 0, registeredMounts: [] as Mount[], mountedOn: [] as Mount[] }
    const mount = { group: { position: new Vector3(1.4, 0, 0) }, availableForPlayer: true, coopPuppet: false, displayName: '馬',
      type: 'HORSE', dead: false, state: 'IDLE', movementSpeed: 0, currentLod: 0, eagleVisual: null,
      setCameraDistance() {}, update() {} } as unknown as Mount
    const player = { position: new Vector3(), dead: false, spectatorOnly: false, isMounted: true, currentMount: mount as Mount | null,
      arrowCount: 0, setArrowCount() {},
      dismountFromMount() { state.dismounts++; this.isMounted = false; this.currentMount = null } }
    // The same preparation state Game hands to the Last Stand lock owner.
    const lock = { coopGuest: false, launch: { careerCommanderOutpost: {} },
      runtime: { getSnapshot: () => ({ activePhase: 'deployment' as const }) }, deploymentBatch: { ready: true } }
    const hudClassesRemoved: string[] = []
    const operations: string[] = []
    const game = Object.assign(Object.create(Game.prototype) as { _updateInteractions(dt: number): void }, {
      mounts: [mount], inventoryManager: { pickupDisposition: () => 'backpack', addWeapon: () => 0, equipWeapon: () => 0 },
      customPickupPolicy: false, quiverUI: { setArrowCount() {} },
      pickupHud: { show: (text: string | null) => { state.prompt = text }, notify() {} },
      _aimTargetRegistry: { registerMount: (target: Mount) => { state.registeredMounts.push(target) } },
      mountHud: { classList: { remove: (name: string) => { hudClassesRemoved.push(name) } } },
      trainingGround: { mounts: [mount] }, tutorialScene: { operation: (name: string) => { operations.push(name) } },
      _mountPlayer: (target: Mount) => { state.mountedOn.push(target) }, player, camera: { position: new Vector3() }, obstacles: [], thirdPersonCamera: { cameraYaw: Math.PI },
      input: { isLocked: true, consumeKeyE: () => { const value = pressed; pressed = false; return value } },
      soundManager: { updateHorseGallopLoops() {}, updateEagleWingbeats() {} }, equipmentUI: { visible: false },
      controlMode: 'player', interactionInputCaptured: false, isTrainingGround: false, modelStudio: null, pickups: [],
    })
    // Build the controller through Game's real port wiring.
    Object.assign(game, { interactions: (game as unknown as { _createInteractionController(): unknown })._createInteractionController() })
    expect(commanderOutpostCombatLocked(lock)).toBe(true)
    game._updateInteractions(0)
    expect(state.prompt).toBe('[E] 下騎')
    pressed = true
    game._updateInteractions(0)
    expect(state.dismounts).toBe(1)
    expect(state.registeredMounts).toEqual([mount])
    expect(hudClassesRemoved).toEqual(['visible'])
    expect(operations).toEqual(['dismounted'])
    expect(player.isMounted).toBe(false)
    expect(state.prompt).toBe('[E] 騎乘：馬')
    pressed = true
    game._updateInteractions(0)
    expect(state.mountedOn).toEqual([mount])
  })
})
