import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BattleSetupUI } from '../src/ui/BattleSetupUI'
import { BattleReferenceUI } from '../src/ui/BattleReferenceUI'
import { COMBAT_BALANCE } from '../src/combat/CombatBalance'
import { getUnitPresetsForFaction } from '../src/battle/UnitPresetCatalog'

describe('Battle setup and standalone reference UI', () => {
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
    querySelector(selector: string): MockElement | null {
      if (selector.startsWith('#')) {
        return domRegistry.get(selector.slice(1)) ?? null
      }
      return this.querySelectorAll(selector)[0] ?? null
    }
    setAttribute(_name: string, _val: string) {}
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
    container = doc.createElement('div')
    doc.body.appendChild(container)
  })

  afterEach(() => {
    domRegistry.clear()
    delete (globalThis as any).document
    delete (globalThis as any).HTMLElement
    delete (globalThis as any).HTMLInputElement
    delete (globalThis as any).HTMLButtonElement
  })

  it('renders only Army and Player Loadout tabs in Custom Battle', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const armyTab = domRegistry.get('setup-tab-army')
    const loadoutTab = domRegistry.get('setup-tab-loadout')

    expect(armyTab).toBeDefined()
    expect(loadoutTab).toBeDefined()
    expect(domRegistry.get('setup-tab-reference')).toBeUndefined()
    expect(domRegistry.get('setup-reference-panel')).toBeUndefined()
    expect(armyTab?.classList.contains('active')).toBe(true)

    ui.destroy()
  })

  it('switches cleanly between Army and Player Loadout', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const armyTab = domRegistry.get('setup-tab-army')
    const loadoutTab = domRegistry.get('setup-tab-loadout')
    const armyPanel = domRegistry.get('setup-army-panel')
    const loadoutPanel = domRegistry.get('setup-loadout-panel')

    loadoutTab?.click()
    expect(loadoutTab?.classList.contains('active')).toBe(true)
    expect(loadoutPanel?.classList.contains('active')).toBe(true)
    expect(armyPanel?.classList.contains('active')).toBe(false)

    armyTab?.click()
    expect(armyTab?.classList.contains('active')).toBe(true)
    expect(armyPanel?.classList.contains('active')).toBe(true)
    expect(loadoutPanel?.classList.contains('active')).toBe(false)

    ui.destroy()
  })

  it('initializes Player HP and clamps customization to 1–9999', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const hpInput = domRegistry.get('player-hp-input') as MockElement
    expect(hpInput.value).toBe(String(COMBAT_BALANCE.hp.playerDefault))

    hpInput.value = '500'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(500)

    hpInput.value = '15000'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(9999)

    hpInput.value = '-10'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(1)

    ui.destroy()
  })

  it('keeps all lance options in Player Loadout', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-setup-container') as any).innerHTML
    expect(html).toContain('data-loadout-id="hunting_spear"')
    expect(html).toContain('data-loadout-id="steel_lance"')
    expect(html).toContain('data-loadout-id="heavy_lance"')

    ui.destroy()
  })

  it('renders SSOT unit and combat data on the standalone home reference screen', () => {
    const ui = new BattleReferenceUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-reference-container') as any).innerHTML
    expect(html).toContain(String(COMBAT_BALANCE.hp.npcDefault))
    expect(html).toContain(String(COMBAT_BALANCE.hp.playerDefault))
    expect(html).toContain(String(COMBAT_BALANCE.bow.damageMultiplier))
    expect(html).toContain(String(COMBAT_BALANCE.bow.footAttackRange))
    expect(html).toContain(String(COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier))

    for (const preset of getUnitPresetsForFaction('viking')) {
      expect(html).toContain(preset.nameZh)
    }

    ui.destroy()
  })

  it('keeps five reference sub-tabs and switches them independently', () => {
    const ui = new BattleReferenceUI()
    ui.mount(container, () => {})

    const subBtns = container.querySelectorAll('.ref-subtab-btn')
    expect(subBtns.length).toBe(5)
    const balanceBtn = subBtns.find((button: any) => button.dataset.refSubtab === 'balance')
    const weaponsBtn = subBtns.find((button: any) => button.dataset.refSubtab === 'weapons')
    const panels = container.querySelectorAll('.ref-subpanel')
    const balancePanel = panels.find((panel: any) => panel.dataset.refSubpanel === 'balance')
    const weaponsPanel = panels.find((panel: any) => panel.dataset.refSubpanel === 'weapons')

    expect(balanceBtn?.classList.contains('active')).toBe(true)
    expect(balancePanel?.classList.contains('active')).toBe(true)

    weaponsBtn?.click()
    expect(weaponsBtn?.classList.contains('active')).toBe(true)
    expect(weaponsPanel?.classList.contains('active')).toBe(true)
    expect(balanceBtn?.classList.contains('active')).toBe(false)

    ui.destroy()
  })

  it('does not expose technical ids in the standalone reference tables', () => {
    const ui = new BattleReferenceUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-reference-container') as any).innerHTML
    expect(html).not.toContain('<th>ID</th>')
    expect(html).not.toContain('<code>rusty_dagger</code>')
    expect(html).not.toContain('<code>round_shield_t1</code>')
    expect(html).not.toContain('<code>steel_lance</code>')

    ui.destroy()
  })
})
