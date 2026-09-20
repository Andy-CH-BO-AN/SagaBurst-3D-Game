import * as THREE from 'three'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BattleConfig,
  getDefaultBattleConfig,
  createEmptyBattleConfig,
  validateBattleConfig,
  PRESET_10V10,
  PRESET_25V25,
} from '../src/battle/BattleConfig'
import {
  BattleSpawner,
  VIKING_PLAYER_SPAWN,
  ROMAN_PLAYER_SPAWN,
  allegianceFor,
} from '../src/battle/BattleSpawner'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { BattleController } from '../src/battle/BattleController'
import { BattleSetupUI } from '../src/ui/BattleSetupUI'
import { Player } from '../src/player/Player'
import { Mount, MountType } from '../src/world/Mount'
import { ThirdPersonCamera } from '../src/camera/ThirdPersonCamera'

describe('Player Faction Selection (Viking / Roman)', () => {
  describe('A. BattleConfig Domain & Validation', () => {
    it('defaults playerFaction to "viking" in getDefaultBattleConfig and createEmptyBattleConfig', () => {
      const defaultConfig = getDefaultBattleConfig()
      expect(defaultConfig.playerFaction).toBe('viking')

      const emptyConfig = createEmptyBattleConfig()
      expect(emptyConfig.playerFaction).toBe('viking')
    })

    it('validates playerFaction: accepts "viking", "roman", or undefined (backward compatible)', () => {
      const config = getDefaultBattleConfig()

      config.playerFaction = 'viking'
      expect(validateBattleConfig(config).valid).toBe(true)

      config.playerFaction = 'roman'
      expect(validateBattleConfig(config).valid).toBe(true)

      delete config.playerFaction
      expect(validateBattleConfig(config).valid).toBe(true)
    })

    it('rejects invalid playerFaction values', () => {
      const config = getDefaultBattleConfig()
      ;(config as any).playerFaction = 'spartan'
      const result = validateBattleConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Invalid player faction'))).toBe(true)
    })
  })

  describe('B. BattleSpawner Cultural Identity & Allegiance Mapping', () => {
    it('allegianceFor correctly maps culture to allegiance based on player faction', () => {
      // When player is Viking:
      expect(allegianceFor('viking', 'viking')).toBe(Faction.PLAYER)
      expect(allegianceFor('roman', 'viking')).toBe(Faction.ENEMY)

      // When player is Roman:
      expect(allegianceFor('roman', 'roman')).toBe(Faction.PLAYER)
      expect(allegianceFor('viking', 'roman')).toBe(Faction.ENEMY)
    })

    it('formation mode with playerFaction: "viking" spawns player at VIKING_PLAYER_SPAWN and aligns armies', () => {
      const config: BattleConfig = {
        ...PRESET_10V10,
        playerFaction: 'viking',
        mode: 'formation',
      }
      const plan = BattleSpawner.createSpawnPlan(config)

      expect(plan.playerSpawn).toEqual(VIKING_PLAYER_SPAWN)

      // All Viking NPCs are Faction.PLAYER, all Roman NPCs are Faction.ENEMY
      const vikingNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'viking')
      const romanNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'roman')

      expect(vikingNpcs.length).toBe(10)
      expect(romanNpcs.length).toBe(10)

      expect(vikingNpcs.every(s => s.faction === Faction.PLAYER)).toBe(true)
      expect(romanNpcs.every(s => s.faction === Faction.ENEMY)).toBe(true)

      // Safe clearance around VIKING_PLAYER_SPAWN (0, 145.0) applies only to Viking army
      for (const s of vikingNpcs) {
        const dist = Math.hypot(s.x - VIKING_PLAYER_SPAWN.x, s.z - VIKING_PLAYER_SPAWN.z)
        expect(dist).toBeGreaterThanOrEqual(10.0)
      }
    })

    it('formation mode with playerFaction: "roman" spawns player at ROMAN_PLAYER_SPAWN and flips allegiance', () => {
      const config: BattleConfig = {
        ...PRESET_10V10,
        playerFaction: 'roman',
        mode: 'formation',
      }
      const plan = BattleSpawner.createSpawnPlan(config)

      expect(plan.playerSpawn).toEqual(ROMAN_PLAYER_SPAWN)

      const vikingNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'viking')
      const romanNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'roman')

      expect(vikingNpcs.length).toBe(10)
      expect(romanNpcs.length).toBe(10)

      // When player is Roman: Romans are allies (Faction.PLAYER), Vikings are enemies (Faction.ENEMY)
      expect(romanNpcs.every(s => s.faction === Faction.PLAYER)).toBe(true)
      expect(vikingNpcs.every(s => s.faction === Faction.ENEMY)).toBe(true)

      // Safe clearance around ROMAN_PLAYER_SPAWN (0, -145.0) applies to Roman army
      for (const s of romanNpcs) {
        const dist = Math.hypot(s.x - ROMAN_PLAYER_SPAWN.x, s.z - ROMAN_PLAYER_SPAWN.z)
        expect(dist).toBeGreaterThanOrEqual(10.0)
      }
    })

    it('scattered mode with playerFaction: "roman" maps Roman NPCs as allies and Viking NPCs as enemies', () => {
      const config: BattleConfig = {
        ...PRESET_10V10,
        playerFaction: 'roman',
        mode: 'scattered',
      }
      const plan = BattleSpawner.createSpawnPlan(config)

      const vikingNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'viking')
      const romanNpcs = plan.npcSpecs.filter(s => s.characterFaction === 'roman')

      expect(romanNpcs.every(s => s.faction === Faction.PLAYER)).toBe(true)
      expect(vikingNpcs.every(s => s.faction === Faction.ENEMY)).toBe(true)
    })
  })

  describe('C. Culture vs Allegiance Decoupling in NPC AI and Equipment', () => {
    it('Roman ally (characterFaction: "roman", faction: Faction.PLAYER) has Roman equipment and ignores Player', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'roman')
      player.group.position.set(0, 0, -140)

      const romanAlly = new NPC(
        scene,
        0,
        -130,
        Faction.PLAYER,
        'roman',
        AIType.MELEE,
        'RomanAlly',
        2,
        false
      )

      expect(romanAlly.characterFaction).toBe('roman')
      expect(romanAlly.faction).toBe(Faction.PLAYER)
      expect(romanAlly.shieldId).toBe('scutum_t2')

      // Target selection must ignore the player because both are Faction.PLAYER
      const target = (romanAlly as any)._findTarget(player, [romanAlly])
      expect(target).toBeNull()
    })

    it('Viking enemy (characterFaction: "viking", faction: Faction.ENEMY) has Viking equipment and targets Roman Player', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'roman')
      player.group.position.set(0, 0, -120)

      const vikingEnemy = new NPC(
        scene,
        0,
        -110,
        Faction.ENEMY,
        'viking',
        AIType.MELEE,
        'VikingEnemy',
        2,
        false
      )

      expect(vikingEnemy.characterFaction).toBe('viking')
      expect(vikingEnemy.faction).toBe(Faction.ENEMY)
      expect(vikingEnemy.shieldId).toBe('round_shield_t2')

      // Target selection must find the player because player is Faction.PLAYER while viking is Faction.ENEMY
      const target = (vikingEnemy as any)._findTarget(player, [vikingEnemy])
      expect(target).not.toBeNull()
      expect(target.isPlayer).toBe(true)
    })
  })

  describe('D. BattleController Cultural Victory Determination', () => {
    it('evaluates Roman victory when all Viking NPCs are eliminated, even when Roman NPCs are Faction.PLAYER', () => {
      const controller = new BattleController({ ...PRESET_10V10, playerFaction: 'roman' })
      const scene = new THREE.Scene()

      const romanAlly = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'RomanAlly', 1, false)
      const vikingEnemy = new NPC(scene, 0, 10, Faction.ENEMY, 'viking', AIType.MELEE, 'VikingEnemy', 1, false)

      const npcs = [romanAlly, vikingEnemy]
      controller.initCounts(npcs)

      // Viking dies
      vikingEnemy.takeDamage(9999)
      controller.update(npcs)

      expect(controller.getResult()).toBe('ROMAN_VICTORY')
    })

    it('evaluates Viking victory when all Roman NPCs are eliminated, even when Viking NPCs are Faction.ENEMY', () => {
      const controller = new BattleController({ ...PRESET_10V10, playerFaction: 'roman' })
      const scene = new THREE.Scene()

      const romanAlly = new NPC(scene, 0, 0, Faction.PLAYER, 'roman', AIType.MELEE, 'RomanAlly', 1, false)
      const vikingEnemy = new NPC(scene, 0, 10, Faction.ENEMY, 'viking', AIType.MELEE, 'VikingEnemy', 1, false)

      const npcs = [romanAlly, vikingEnemy]
      controller.initCounts(npcs)

      // Roman dies
      romanAlly.takeDamage(9999)
      controller.update(npcs)

      expect(controller.getResult()).toBe('VIKING_VICTORY')
    })
  })

  describe('E. BattleSetupUI DOM and Preset Interaction', () => {
    class MockElement {
      private _id = ''
      get id(): string { return this._id }
      set id(val: string) {
        this._id = val
        if (val && domRegistry) domRegistry.set(val, this)
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
      click() {
        this.dispatchEvent({ type: 'click' })
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
      domRegistry.clear()
      delete (globalThis as any).document
      delete (globalThis as any).HTMLElement
      delete (globalThis as any).HTMLInputElement
      delete (globalThis as any).HTMLButtonElement
      delete (globalThis as any).Event
    })

    it('mounts UI with Viking faction selected by default', () => {
      const ui = new BattleSetupUI()
      ui.mount(container, () => {})
      const vikingBtn = domRegistry.get('faction-btn-viking')
      const romanBtn = domRegistry.get('faction-btn-roman')

      expect(vikingBtn?.classList.contains('active')).toBe(true)
      expect(romanBtn?.classList.contains('active')).toBe(false)
      expect((ui as any).config.playerFaction).toBe('viking')
      ui.destroy()
    })

    it('switches faction when Roman button is clicked and updates active class', () => {
      const ui = new BattleSetupUI()
      ui.mount(container, () => {})
      const vikingBtn = domRegistry.get('faction-btn-viking')
      const romanBtn = domRegistry.get('faction-btn-roman')

      romanBtn?.click()

      expect(romanBtn?.classList.contains('active')).toBe(true)
      expect(vikingBtn?.classList.contains('active')).toBe(false)
      expect((ui as any).config.playerFaction).toBe('roman')
      ui.destroy()
    })

    it('preserves selected playerFaction when preset is applied', () => {
      const ui = new BattleSetupUI()
      ui.mount(container, () => {})
      const romanBtn = domRegistry.get('faction-btn-roman')
      romanBtn?.click()
      expect((ui as any).config.playerFaction).toBe('roman')

      // Apply 25v25 preset
      const presetBtn = domRegistry.get('preset-25')
      presetBtn?.click()

      expect((ui as any).config.playerFaction).toBe('roman')
      expect(romanBtn?.classList.contains('active')).toBe(true)
      ui.destroy()
    })

    it('exposes the 200v200 preset and clamps manual Custom Battle counts at 200 per faction', () => {
      const ui = new BattleSetupUI(createEmptyBattleConfig())
      ui.mount(container, () => {})

      const setupMarkup = (domRegistry.get('battle-setup-container') as any).innerHTML
      expect(setupMarkup).toContain('max="200"')
      expect(setupMarkup).toContain('/ 200')
      expect(domRegistry.get('preset-200')).toBeDefined()

      ;(ui as any)._setUnitCount('viking', 'infantry', 1, 250)
      ;(ui as any)._setUnitCount('roman', 'infantry', 1, 250)
      expect((ui as any).config.viking.infantry[1]).toBe(200)
      expect((ui as any).config.roman.infantry[1]).toBe(200)
      expect(domRegistry.get('viking-total')?.textContent).toBe('200')
      expect(domRegistry.get('roman-total')?.textContent).toBe('200')
      expect((domRegistry.get('btn-start-battle') as MockElement).disabled).toBe(false)

      domRegistry.get('preset-200')?.click()
      expect((ui as any).config.viking.infantry).toEqual({ 1: 20, 2: 24, 3: 16 })
      expect((ui as any).config.roman.horseArcher).toEqual({ 1: 12, 2: 16, 3: 12 })
      ui.destroy()
    })

    it('preserves selected playerFaction when reset button is clicked', () => {
      const ui = new BattleSetupUI()
      ui.mount(container, () => {})
      const romanBtn = domRegistry.get('faction-btn-roman')
      romanBtn?.click()
      expect((ui as any).config.playerFaction).toBe('roman')

      const resetBtn = domRegistry.get('preset-reset')
      resetBtn?.click()

      expect((ui as any).config.playerFaction).toBe('roman')
      expect(romanBtn?.classList.contains('active')).toBe(true)
      ui.destroy()
    })

    it('passes chosen playerFaction in callback when START BATTLE is clicked', () => {
      const onStart = vi.fn()
      const ui = new BattleSetupUI()
      ui.mount(container, onStart)

      // Ensure config passes army size validation (>= 1 on each side)
      const presetBtn = domRegistry.get('preset-10')
      presetBtn?.click()

      const romanBtn = domRegistry.get('faction-btn-roman')
      romanBtn?.click()

      const startBtn = domRegistry.get('btn-start-battle') as MockElement
      startBtn?.click()

      expect(onStart).toHaveBeenCalledTimes(1)
      expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
        playerFaction: 'roman',
      }))
      ui.destroy()
    })
  })

  describe('F. Player Heading, Camera Yaw and Mount Synchronization', () => {
    it('orients Roman player to face +Z and camera yaw to Math.PI (orbiting behind toward +Z)', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'roman')
      player.faceDirection(0, 1) // Face +Z (toward Viking army)

      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const tpCamera = new ThirdPersonCamera(camera, player)
      tpCamera.setYaw(Math.PI)

      const aimDir = new THREE.Vector3()
      tpCamera.getAimDirection(aimDir)
      // Level aim towards +Z
      expect(aimDir.z).toBeGreaterThan(0.9)

      // Mount player onto mount and verify mount faces +Z
      const mount = new Mount(scene, MountType.CORGI, 0, -145)
      player.mountVehicle(mount)

      expect(mount.group.rotation.y).toBeCloseTo(0, 2)
    })

    it('orients Viking player to face -Z and camera yaw to 0 (orbiting behind toward -Z)', () => {
      const scene = new THREE.Scene()
      const player = new Player(scene, 'viking')
      player.faceDirection(0, -1) // Face -Z (toward Roman army)

      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1000)
      const tpCamera = new ThirdPersonCamera(camera, player)
      tpCamera.setYaw(0)

      const aimDir = new THREE.Vector3()
      tpCamera.getAimDirection(aimDir)
      // Level aim towards -Z
      expect(aimDir.z).toBeLessThan(-0.9)

      // Mount player onto mount and verify mount faces -Z
      const mount = new Mount(scene, MountType.CORGI, 0, 145)
      player.mountVehicle(mount)

      expect(mount.group.rotation.y).toBeCloseTo(Math.PI, 2)
    })
  })
})
