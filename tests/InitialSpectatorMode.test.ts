import * as THREE from 'three'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BattleConfig,
  validateBattleConfig,
  createEmptyBattleConfig,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
} from '../src/battle/BattleConfig'
import { BattleSetupUI } from '../src/ui/BattleSetupUI'
import { Player } from '../src/player/Player'
import { NPC, Faction, AIType, AIState } from '../src/world/NPC'
import { ArrowProjectile } from '../src/world/ArrowProjectile'
import { damagePlayer } from '../src/combat/DamageRouter'
import {
  SpectatorCameraController,
  SPECTATOR_MOVE_SPEED,
} from '../src/camera/SpectatorCameraController'
import { getTerrainHeight, PLAYABLE_WORLD_BOUND } from '../src/world/Terrain'
import { handleProjectileHitEffects } from '../src/Game'
import { Mount, MountType } from '../src/world/Mount'

describe('Initial Spectator Mode', () => {
  describe('A. BattleConfig & BattleSetupUI', () => {
    it('defaults spectator to undefined / false and remains backward compatible', () => {
      const config = createEmptyBattleConfig()
      expect(config.spectator).toBe(false)

      const validation = validateBattleConfig(config)
      expect(validation.errors.some(e => e.includes('spectator'))).toBe(false)

      // Backward compatible with omitted spectator
      const legacyConfig: BattleConfig = {
        mode: 'formation',
        viking: { ...config.viking, infantry: { 1: 5, 2: 0, 3: 0 } },
        roman: { ...config.roman, infantry: { 1: 5, 2: 0, 3: 0 } },
        rules: { respawnEnabled: false, includeCamps: true },
      }
      expect(validateBattleConfig(legacyConfig).valid).toBe(true)

      // Validates boolean type if present
      expect(validateBattleConfig({ ...legacyConfig, spectator: true }).valid).toBe(true)
      expect(validateBattleConfig({ ...legacyConfig, spectator: false }).valid).toBe(true)

      // Rejects non-boolean
      const invalid = validateBattleConfig({ ...legacyConfig, spectator: 'true' as any })
      expect(invalid.valid).toBe(false)
      expect(invalid.errors).toContain('spectator must be a boolean')
    })

class MockElement {
  private _id = ''
  get id(): string {
    return this._id
  }
  set id(val: string) {
    this._id = val
    if (val && domRegistry) {
      domRegistry.set(val, this)
    }
  }

  tagName: string = 'div'
  className: string = ''
  type: string = ''
  value: string = '0'
  checked: boolean = false
  disabled: boolean = false
  textContent: string = ''
  dataset: Record<string, string> = {}
  classList = {
    classes: new Set<string>(),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) {
        if (this.classList.classes.has(c)) this.classList.classes.delete(c)
        else this.classList.classes.add(c)
      } else if (force) {
        this.classList.classes.add(c)
      } else {
        this.classList.classes.delete(c)
      }
    },
    add: (c: string) => this.classList.classes.add(c),
    remove: (c: string) => this.classList.classes.delete(c),
    contains: (c: string) => this.classList.classes.has(c),
  }
  listeners: Record<string, Array<(e: any) => void>> = {}
  children: MockElement[] = []
  parentNode: MockElement | null = null

  addEventListener(event: string, fn: (e: any) => void) {
    this.listeners[event] = this.listeners[event] || []
    this.listeners[event].push(fn)
  }
  removeEventListener(event: string, fn: (e: any) => void) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(f => f !== fn)
    }
  }
  dispatchEvent(event: any) {
    const type = typeof event === 'string' ? event : event.type
    const evt = typeof event === 'string'
      ? { type, target: this, currentTarget: this }
      : { ...event, target: this, currentTarget: this }
    const handlers = this.listeners[type] || []
    for (const h of handlers) {
      h(evt)
    }
    return true
  }
  appendChild(child: MockElement) {
    this.children.push(child)
    child.parentNode = this
    return child
  }
  removeChild(child: MockElement) {
    this.children = this.children.filter(c => c !== child)
    child.parentNode = null
    return child
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this)
    }
  }
  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = []
    const isClass = selector.startsWith('.')
    const className = isClass ? selector.slice(1) : ''
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (isClass && child.classList.contains(className)) {
          results.push(child)
        }
        traverse(child)
      }
    }
    traverse(this)
    return results
  }
}

let domRegistry = new Map<string, MockElement>()

function parseHtmlIntoMock(container: MockElement, html: string) {
  const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase()
    if (tagName.startsWith('/')) continue
    const attrs = match[2]
    const el = new MockElement()
    el.tagName = tagName

    const idMatch = attrs.match(/id="([^"]+)"/)
    if (idMatch) {
      el.id = idMatch[1]
    }

    const classMatch = attrs.match(/class="([^"]+)"/)
    if (classMatch) {
      el.className = classMatch[1]
      classMatch[1].split(/\s+/).forEach(c => {
        if (c) el.classList.add(c)
      })
    }

    const typeMatch = attrs.match(/type="([^"]+)"/)
    if (typeMatch) {
      el.type = typeMatch[1]
    }

    const valueMatch = attrs.match(/value="([^"]+)"/)
    if (valueMatch) {
      el.value = valueMatch[1]
    }

    const dataMatches = [...attrs.matchAll(/data-([a-zA-Z0-9_-]+)="([^"]+)"/g)]
    for (const dm of dataMatches) {
      const key = dm[1].replace(/-([a-z])/g, (_, l) => l.toUpperCase())
      el.dataset[key] = dm[2]
    }

    container.appendChild(el)
  }
}

    describe('BattleSetupUI DOM interactions', () => {
      let container: any

      beforeEach(() => {
        domRegistry.clear()
        const body = new MockElement()
        body.tagName = 'body'

        const doc = {
          body,
          createElement: (tag: string) => {
            const el = new MockElement()
            el.tagName = tag.toLowerCase()
            let innerHtmlVal = ''
            Object.defineProperty(el, 'innerHTML', {
              get: () => innerHtmlVal,
              set: (val: string) => {
                innerHtmlVal = val
                parseHtmlIntoMock(el, val)
              },
            })
            return el
          },
          getElementById: (id: string) => domRegistry.get(id) || null,
        }

        ;(globalThis as any).document = doc
        ;(globalThis as any).HTMLElement = MockElement
        ;(globalThis as any).HTMLInputElement = MockElement
        ;(globalThis as any).HTMLButtonElement = MockElement
        ;(globalThis as any).Event = class Event {
          type: string
          constructor(type: string) {
            this.type = type
          }
        }

        container = doc.createElement('div')
        doc.body.appendChild(container)
      })

      afterEach(() => {
        container.remove()
        domRegistry.clear()
        delete (globalThis as any).document
        delete (globalThis as any).HTMLElement
        delete (globalThis as any).HTMLInputElement
        delete (globalThis as any).HTMLButtonElement
        delete (globalThis as any).Event
      })

      it('mounts with spectator checkbox unchecked by default', () => {
        const setupUI = new BattleSetupUI()
        setupUI.mount(container, () => {})

        const checkbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
        expect(checkbox).not.toBeNull()
        expect(checkbox?.checked).toBe(false)

        setupUI.destroy()
      })

      it('mounts with spectator checkbox checked when initialConfig has spectator: true', () => {
        const initialConfig: BattleConfig = {
          ...createEmptyBattleConfig(),
          spectator: true,
        }
        const setupUI = new BattleSetupUI(initialConfig)
        setupUI.mount(container, () => {})

        const checkbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
        expect(checkbox?.checked).toBe(true)

        setupUI.destroy()
      })

      it('updates config.spectator when checkbox is toggled', () => {
        const setupUI = new BattleSetupUI()
        setupUI.mount(container, () => {})

        const checkbox = document.getElementById('spectator-checkbox') as HTMLInputElement
        checkbox.checked = true
        checkbox.dispatchEvent(new Event('change'))

        // Preset buttons must preserve the selected spectator state
        const preset25Btn = document.getElementById('preset-25')
        preset25Btn?.dispatchEvent(new Event('click'))
        expect(checkbox.checked).toBe(true)

        // Reset must also preserve spectator state
        const resetBtn = document.getElementById('preset-reset')
        resetBtn?.dispatchEvent(new Event('click'))
        expect(checkbox.checked).toBe(true)

        // Preset 50 preserves
        const preset50Btn = document.getElementById('preset-50')
        preset50Btn?.dispatchEvent(new Event('click'))
        expect(checkbox.checked).toBe(true)

        // Uncheck
        checkbox.checked = false
        checkbox.dispatchEvent(new Event('change'))
        preset25Btn?.dispatchEvent(new Event('click'))
        expect(checkbox.checked).toBe(false)

        setupUI.destroy()
      })

      it('passes config with selected spectator value to onStart callback', () => {
        const onStart = vi.fn()
        const setupUI = new BattleSetupUI()
        setupUI.mount(container, onStart)

        // Select 10v10 preset so army validation passes
        document.getElementById('preset-10')?.dispatchEvent(new Event('click'))

        // Check spectator
        const checkbox = document.getElementById('spectator-checkbox') as HTMLInputElement
        checkbox.checked = true
        checkbox.dispatchEvent(new Event('change'))

        // Click start battle
        const startBtn = document.getElementById('btn-start-battle') as HTMLButtonElement
        expect(startBtn.disabled).toBe(false)
        startBtn.dispatchEvent(new Event('click'))

        expect(onStart).toHaveBeenCalledTimes(1)
        const startedConfig: BattleConfig = onStart.mock.calls[0][0]
        expect(startedConfig.spectator).toBe(true)

        setupUI.destroy()
      })
    })
  })

  describe('B. Player Non-Participation & Semantic Independence', () => {
    it('maintains clean semantic independence between dead and spectatorOnly', () => {
      const scene = new THREE.Scene()

      // 1. Normal player
      const normalPlayer = new Player(scene)
      expect(normalPlayer.dead).toBe(false)
      expect(normalPlayer.spectatorOnly).toBe(false)
      expect(normalPlayer.targetable).toBe(true)

      // 2. Initial spectator
      const spectatorPlayer = new Player(scene)
      spectatorPlayer.spectatorOnly = true
      expect(spectatorPlayer.dead).toBe(false)
      expect(spectatorPlayer.spectatorOnly).toBe(true)
      expect(spectatorPlayer.targetable).toBe(false)

      // 3. Post-death spectator
      const mockHpBar = { setFill: vi.fn() } as any
      normalPlayer.takeDamage(250, mockHpBar)
      expect(normalPlayer.dead).toBe(true)
      expect(normalPlayer.spectatorOnly).toBe(false)
      expect(normalPlayer.targetable).toBe(false)
    })

    it('spectatorOnly Player cannot receive damage or trigger death', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      player.spectatorOnly = true
      const deathCallback = vi.fn()
      player.onPlayerDeath = deathCallback

      const mockHpBar = { setFill: vi.fn() } as any
      const hitResult = player.takeDamage(100, mockHpBar)

      expect(hitResult).toBe(false)
      expect(player.hp).toBe(200)
      expect(player.dead).toBe(false)
      expect(deathCallback).not.toHaveBeenCalled()
      expect(mockHpBar.setFill).not.toHaveBeenCalled()

      // DamageRouter also respects spectatorOnly
      const routerResult = damagePlayer(player, 50, mockHpBar, null)
      expect(routerResult.hitSuccess).toBe(false)
      expect(player.hp).toBe(200)
      expect(player.dead).toBe(false)
    })

    it('spectatorOnly Player update returns early and ignores movement/attacks', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      player.spectatorOnly = true

      player.group.position.set(10, 0, 10)
      const initialPos = player.group.position.clone()

      const input = {
        keys: { KeyW: true, ShiftLeft: true } as Record<string, boolean>,
        consumeMouseDelta: () => ({ dx: 10, dy: 5 }),
        isLeftMouseDown: true,
        consumeKeyE: () => true,
        consumeLeftClick: () => true,
        consumeLeftClickRelease: () => true,
      } as any

      const soundManager = { playSwing: vi.fn(), playHit: vi.fn() } as any
      const staminaBar = { setFill: vi.fn() } as any
      const quiverUI = { setAiming: vi.fn(), setChargeRatio: vi.fn(), setShieldBlocked: vi.fn() } as any

      player.update(
        0.016,
        input,
        0,
        new THREE.Vector3(0, 0, 1),
        [],
        staminaBar,
        quiverUI,
        soundManager
      )

      expect(player.group.position.x).toBe(initialPos.x)
      expect(player.group.position.z).toBe(initialPos.z)
      expect(player.isSwinging).toBe(false)
      expect(soundManager.playSwing).not.toHaveBeenCalled()
    })

    it('spectatorOnly Player cannot mount vehicles', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      player.spectatorOnly = true

      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      player.mountVehicle(mount, 0)

      expect(player.isMounted).toBe(false)
      expect(player.currentMount).toBeNull()
    })
  })

  describe('C. NPC AI & Projectile Interaction with Initial Spectator Player', () => {
    it('enemy NPC AI ignores spectatorOnly Player and targets living Viking NPC', () => {
      const scene = new THREE.Scene()

      // Spectator Player at (0, 0, 5)
      const player = new Player(scene)
      player.group.position.set(0, 0, 5)
      player.spectatorOnly = true
      expect(player.targetable).toBe(false)

      // Allied Viking NPC at (0, 0, 20)
      const vikingNpc = new NPC(scene, 0, 20, Faction.PLAYER, 'viking', AIType.MELEE, 'Viking', 1, false)

      // Enemy Roman NPC at (0, 0, 0)
      const enemyNpc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'Roman', 1, false)

      // Call internal target finding via update or inspect target selection
      // Even though Player is closer (dist 5) than Viking NPC (dist 20), enemy must target Viking NPC
      const onHit = vi.fn()
      const onFire = vi.fn()
      const mockHpBar = { setFill: vi.fn() } as any

      // Initial frame: Enemy detects living Viking NPC (distance 20 <= 30) and enters ALERT
      enemyNpc.update(
        0.016,
        player,
        [vikingNpc, enemyNpc],
        [vikingNpc],
        [],
        mockHpBar,
        onHit,
        onFire
      )
      expect(enemyNpc.state).toBe(AIState.ALERT)

      // Advance through 0.6s alert timer into CHASE
      enemyNpc.update(
        0.7,
        player,
        [vikingNpc, enemyNpc],
        [vikingNpc],
        [],
        mockHpBar,
        onHit,
        onFire
      )
      expect(enemyNpc.state).toBe(AIState.CHASE)

      // In CHASE, enemy advances towards Viking NPC in +Z direction
      enemyNpc.update(
        0.1,
        player,
        [vikingNpc, enemyNpc],
        [vikingNpc],
        [],
        mockHpBar,
        onHit,
        onFire
      )
      expect(enemyNpc.group.position.z).toBeGreaterThan(0)
    })

    it('enemy projectile does not hit spectatorOnly Player and continues flight', () => {
      const scene = new THREE.Scene()

      // Spectator Player at (0, 0, 10)
      const player = new Player(scene)
      player.group.position.set(0, 0, 10)
      player.spectatorOnly = true

      // Enemy arrow fired from (0, 1, 0) along +Z directly at player (0, 1, 10)
      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        50, // speed
        25, // damage
        Faction.ENEMY,
        false // not player fired
      )

      const onHit = vi.fn()
      // Step arrow right across player position (10m at 50m/s takes 0.2s)
      arrow.update(0.2, player, [], [], onHit, (damage) => damagePlayer(player, damage, { setFill: () => {} } as any, null))

      // Must not hit spectator player
      expect(onHit).not.toHaveBeenCalled()
      expect(player.hp).toBe(200)
    })

    it('enemy projectile hits normal Player when targetable is true', () => {
      const scene = new THREE.Scene()

      // Normal Player at (0, 0, 10)
      const player = new Player(scene)
      player.group.position.set(0, 0, 10)
      expect(player.targetable).toBe(true)

      const arrow = new ArrowProjectile(
        scene,
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        50,
        25,
        Faction.ENEMY,
        false
      )

      const onHit = vi.fn()
      arrow.update(0.2, player, [], [], onHit, (damage) => damagePlayer(player, damage, { setFill: () => {} } as any, null))

      expect(onHit).toHaveBeenCalledTimes(1)
      expect(onHit).toHaveBeenCalledWith(25, expect.any(THREE.Vector3), 'Player', expect.any(Number), true, undefined, false)
    })

    it('cavalry impact checks player.targetable and ignores spectatorOnly Player', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene)
      player.group.position.set(0, 0, 10)
      player.spectatorOnly = true
      expect(player.targetable).toBe(false)

      const mount = new Mount(scene, MountType.CORGI, 0, 0)
      mount.riderFaction = Faction.ENEMY
      mount.movementSpeed = 10

      const canImpactPlayer = mount.riderFaction === Faction.ENEMY && player.targetable
      expect(canImpactPlayer).toBe(false)
    })
  })

  describe('D. Initial Spectator Camera & UX Isolation', () => {
    it('initializes spectator camera roughly 5m above battlefield center (0, 0)', () => {
      const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 500)
      const expectedGroundY = getTerrainHeight(0, 0)
      const initY = expectedGroundY + 5

      camera.position.set(0, initY, 0)
      camera.lookAt(0, initY, -1)

      const controller = new SpectatorCameraController(camera)
      controller.initFromCamera(camera)

      expect(camera.position.x).toBeCloseTo(0, 4)
      expect(camera.position.z).toBeCloseTo(0, 4)
      expect(camera.position.y).toBeCloseTo(initY, 4)

      // Facing forward along -Z: yaw ≈ 0, pitch ≈ 0
      expect(controller.cameraYaw).toBeCloseTo(0, 2)
      expect(controller.cameraPitch).toBeCloseTo(0, 2)

      // Controller moves freely from center
      const input = {
        keys: { KeyW: true } as Record<string, boolean>,
        consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
        consumeKeyE: () => false,
        consumeLeftClick: () => false,
        consumeLeftClickRelease: () => false,
      } as any

      controller.update(input, 1.0)
      expect(camera.position.z).toBeCloseTo(-SPECTATOR_MOVE_SPEED, 2)
    })

    it('gates player HUD and XP effects when spectatorOnly is true', () => {
      const showEnemyHud = vi.fn()
      const addArcheryXp = vi.fn()
      const updateMountHp = vi.fn()
      const hideMountHud = vi.fn()

      const result = handleProjectileHitEffects(
        false,
        true,
        'Roman Legionary',
        0.5,
        false,
        {
          dead: false,
          controlMode: 'spectator',
          isMounted: false,
          hasMount: false,
          spectatorOnly: true,
        },
        {
          showEnemyHud,
          addArcheryXp,
          updateMountHp,
          hideMountHud,
        }
      )

      expect(result.enemyHudShown).toBe(false)
      expect(result.xpGranted).toBe(false)
      expect(showEnemyHud).not.toHaveBeenCalled()
      expect(addArcheryXp).not.toHaveBeenCalled()
    })
  })
})
