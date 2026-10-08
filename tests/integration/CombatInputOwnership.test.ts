import * as THREE from 'three'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Game } from '../../src/Game'
import { TownScene } from '../../src/town/TownScene'
import { ArmyCommandController } from '../../src/battle/ArmyCommandController'
import type { FormationController } from '../../src/battle/FormationController'
import type { ArmyCommandUI } from '../../src/ui/ArmyCommandUI'
import { PlayerInput } from '../../src/player/PlayerInput'
import { SpectatorCameraController } from '../../src/camera/SpectatorCameraController'

afterEach(() => vi.unstubAllGlobals())

/** Real browser-event input and command controller, zero actors, assets or renderer. */
function harness() {
  const browser = Object.assign(new EventTarget(), { location: { search: '?nolock' } })
  const documentEvents = Object.assign(new EventTarget(), {
    pointerLockElement: null,
    getElementById: () => null,
    querySelector: () => null,
  })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', documentEvents)
  const input = new PlayerInput()
  onTestFinished(() => input.dispose())
  const mouse = (type: 'mousedown' | 'mouseup', button = 0) => browser.dispatchEvent(Object.assign(new Event(type), { button }))
  const key = (code: string, repeat = false) => browser.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat }))
  const move = () => documentEvents.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 21, movementY: -7 }))
  const ui: Pick<ArmyCommandUI, 'setEnabled' | 'render' | 'renderPlacement' | 'showFeedback'> = {
    setEnabled() {}, render() {}, renderPlacement() {}, showFeedback() {},
  }
  let placement = false
  const formation: Pick<FormationController, 'isPlacementMode' | 'setCompletionHandler' | 'beginPlacement' | 'updatePlacement' | 'confirmPlacement' | 'cancelPlacement'> = {
    get isPlacementMode() { return placement },
    setCompletionHandler() {}, beginPlacement() { placement = true }, updatePlacement() {},
    confirmPlacement() { placement = false; return { accepted: true, participants: [], commandId: 1, count: 0 } },
    cancelPlacement() { placement = false },
  }
  // Rendering/formation boundaries only; the command controller owns selection and consumption.
  const commands = new ArmyCommandController([], 'viking', input, ui as ArmyCommandUI, formation as FormationController)
  const player = { dead: false, pendingAttack: true, clearTownAction() { this.pendingAttack = false } }
  return { input, mouse, key, move, commands, player }
}

interface GameInputEntry {
  _setupShortcuts(): void
  _updatePlayerInputOwnership(): void
  _enterSpectatorMode(reason: 'death' | 'initial'): void
}

function gameEntry(h: ReturnType<typeof harness>) {
  // Only the production input/Observer methods run; no full Game construction.
  const equipmentUI = { visible: false, toggle() { this.visible = !this.visible }, close() { this.visible = false } }
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 30, 0)
  const spectatorController = new SpectatorCameraController(camera)
  const game = Object.assign(Object.create(Game.prototype) as GameInputEntry, {
    input: h.input, player: h.player, controlMode: 'player', isModelStudio: false,
    armyCommandController: h.commands, equipmentUI, camera, spectatorController,
    _updateLockOverlayPrompt() {}, _showDeathBanner() {},
  })
  return game
}

describe('combat input ownership at scene callers', () => {
  it.each(['battle', 'town'] as const)('%s command confirmation consumes down, hold and delayed release while preserving flight controls', mode => {
    const h = harness()
    const game = gameEntry(h)
    const town = Object.assign(Object.create(TownScene.prototype) as { updatePlayerCommands(): void }, {
      input: h.input, player: h.player, personalCommands: h.commands, personalCommandsEnabled: () => true,
    })
    const update = () => mode === 'battle' ? game._updatePlayerInputOwnership() : town.updatePlayerCommands()
    h.key('Backquote'); update()
    h.key('Digit4'); update()
    expect(h.commands.isFormationPlacementMode).toBe(true)
    h.player.pendingAttack = true
    h.key('KeyW'); h.key('ShiftLeft'); h.mouse('mousedown', 2); h.mouse('mousedown'); h.move()
    update()
    expect(h.commands.isFormationPlacementMode).toBe(false)
    expect(h.player.pendingAttack).toBe(false)
    expect(h.input.isLeftMouseDown).toBe(false)
    expect(h.input.consumeLeftClick()).toBe(false)
    h.mouse('mouseup'); update()
    expect(h.input.consumeLeftClickRelease()).toBe(false)
    expect(h.input.keys.KeyW).toBe(true)
    expect(h.input.keys.ShiftLeft).toBe(true)
    expect(h.input.isRightMouseDown).toBe(true)
    expect(h.input.consumeMouseDelta()).toEqual({ dx: 21, dy: -7 })
    expect(h.input.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 })
    // A subsequent physical click belongs to combat normally.
    h.mouse('mousedown'); h.mouse('mouseup'); update()
    expect(h.input.consumeLeftClick()).toBe(true)
    expect(h.input.consumeLeftClickRelease()).toBe(true)
  })

  it('battle equipment entry, clicks and exit cancel pending combat even with unlocked QA input', () => {
    const h = harness(), game = gameEntry(h)
    game._setupShortcuts()
    h.mouse('mousedown', 2); h.mouse('mousedown'); h.key('KeyW'); h.move()
    h.key('Tab')
    expect(game.equipmentUI.visible).toBe(true)
    expect(h.player.pendingAttack).toBe(false)
    expect(h.input.keys.KeyW).toBeUndefined()
    expect(h.input.isRightMouseDown).toBe(false)
    h.key('Tab', true)
    expect(game.equipmentUI.visible).toBe(true)
    h.mouse('mousedown'); h.move(); h.player.pendingAttack = true
    game._updatePlayerInputOwnership()
    expect(h.player.pendingAttack).toBe(false)
    expect(h.input.isLeftMouseDown).toBe(false)
    expect(h.input.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 })
    h.key('Escape'); h.mouse('mouseup')
    expect(game.equipmentUI.visible).toBe(false)
    expect(h.input.consumeLeftClickRelease()).toBe(false)
  })

  it('battle death clears held movement, aim and delta before Observer and rejects the old physical release', () => {
    const h = harness(), game = gameEntry(h)
    h.key('KeyW'); h.key('ShiftLeft'); h.mouse('mousedown', 2); h.mouse('mousedown'); h.move()
    const initialPosition = game.camera.position.clone()
    game._enterSpectatorMode('death')
    expect(game.controlMode).toBe('spectator')
    expect(h.player.pendingAttack).toBe(false)
    expect(h.input.isRightMouseDown).toBe(false)
    h.key('KeyW', true); h.mouse('mouseup')
    expect(h.input.consumeLeftClickRelease()).toBe(false)
    game.spectatorController.update(h.input, 1 / 60)
    expect(game.camera.position.distanceTo(initialPosition)).toBe(0)
    expect(game.spectatorController.cameraYaw).toBeCloseTo(0)
    h.key('KeyW')
    game.spectatorController.update(h.input, 1 / 60)
    expect(game.camera.position.distanceTo(initialPosition)).toBeGreaterThan(0)
  })
})
