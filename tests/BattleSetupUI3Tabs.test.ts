import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BattleSetupUI } from '../src/ui/BattleSetupUI'
import { COMBAT_BALANCE } from '../src/combat/CombatBalance'
import { WEAPONS } from '../src/rpg/WeaponDatabase'
import { getUnitPresetsForFaction } from '../src/battle/UnitPresetCatalog'

describe('BattleSetupUI 3 Tabs & Player HP', () => {
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

  it('renders all 3 tabs: army, reference, loadout', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const armyTab = domRegistry.get('setup-tab-army')
    const referenceTab = domRegistry.get('setup-tab-reference')
    const loadoutTab = domRegistry.get('setup-tab-loadout')

    expect(armyTab).toBeDefined()
    expect(referenceTab).toBeDefined()
    expect(loadoutTab).toBeDefined()

    const armyPanel = domRegistry.get('setup-army-panel')
    const referencePanel = domRegistry.get('setup-reference-panel')
    const loadoutPanel = domRegistry.get('setup-loadout-panel')

    expect(armyPanel).toBeDefined()
    expect(referencePanel).toBeDefined()
    expect(loadoutPanel).toBeDefined()

    // By default, army tab and panel are active
    expect(armyTab?.classList.contains('active')).toBe(true)
    expect(armyPanel?.classList.contains('active')).toBe(true)
    expect(referenceTab?.classList.contains('active')).toBe(false)
    expect(referencePanel?.classList.contains('active')).toBe(false)
    expect(loadoutTab?.classList.contains('active')).toBe(false)
    expect(loadoutPanel?.classList.contains('active')).toBe(false)

    ui.destroy()
  })

  it('switches between tabs cleanly on click', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const armyTab = domRegistry.get('setup-tab-army')
    const referenceTab = domRegistry.get('setup-tab-reference')
    const loadoutTab = domRegistry.get('setup-tab-loadout')
    const armyPanel = domRegistry.get('setup-army-panel')
    const referencePanel = domRegistry.get('setup-reference-panel')
    const loadoutPanel = domRegistry.get('setup-loadout-panel')

    // Click reference tab
    referenceTab?.click()
    expect(referenceTab?.classList.contains('active')).toBe(true)
    expect(referencePanel?.classList.contains('active')).toBe(true)
    expect(armyTab?.classList.contains('active')).toBe(false)
    expect(armyPanel?.classList.contains('active')).toBe(false)

    // Click loadout tab
    loadoutTab?.click()
    expect(loadoutTab?.classList.contains('active')).toBe(true)
    expect(loadoutPanel?.classList.contains('active')).toBe(true)
    expect(referenceTab?.classList.contains('active')).toBe(false)
    expect(referencePanel?.classList.contains('active')).toBe(false)

    // Click army tab back
    armyTab?.click()
    expect(armyTab?.classList.contains('active')).toBe(true)
    expect(armyPanel?.classList.contains('active')).toBe(true)
    expect(loadoutTab?.classList.contains('active')).toBe(false)

    ui.destroy()
  })

  it('initializes Player HP input to 200 and allows customization (1–9999)', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const hpInput = domRegistry.get('player-hp-input') as MockElement
    expect(hpInput).toBeDefined()
    expect(hpInput.value).toBe(String(COMBAT_BALANCE.hp.playerDefault))
    expect((ui as any).config.playerHp).toBe(COMBAT_BALANCE.hp.playerDefault)

    // Change value to 500
    hpInput.value = '500'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(500)

    // Clamp value to 9999 max
    hpInput.value = '15000'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(9999)

    // Clamp value to 1 min
    hpInput.value = '-10'
    hpInput.dispatchEvent({ type: 'input' })
    expect((ui as any).config.playerHp).toBe(1)

    ui.destroy()
  })

  it('includes hunting_spear, steel_lance, and heavy_lance in loadout options', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-setup-container') as any).innerHTML
    expect(html).toContain('data-loadout-id="hunting_spear"')
    expect(html).toContain('data-loadout-id="steel_lance"')
    expect(html).toContain('data-loadout-id="heavy_lance"')

    ui.destroy()
  })

  it('renders dynamic reference content matching COMBAT_BALANCE and presets', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-setup-container') as any).innerHTML

    // Checks that SSOT balance values are present
    expect(html).toContain(String(COMBAT_BALANCE.hp.npcDefault))
    expect(html).toContain(String(COMBAT_BALANCE.hp.playerDefault))
    expect(html).toContain(String(COMBAT_BALANCE.bow.damageMultiplier))
    expect(html).toContain(String(COMBAT_BALANCE.bow.footAttackRange))
    expect(html).toContain(String(COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier))
    expect(html).toContain(String(COMBAT_BALANCE.berserker.moveSpeedMultiplier))

    // Checks that archetypes from UnitPresetCatalog are rendered
    const vikingPresets = getUnitPresetsForFaction('viking')
    for (const p of vikingPresets) {
      expect(html).toContain(p.nameZh)
    }

    ui.destroy()
  })

  it('provides compact sub-tabs inside Tab 2 and toggles subpanels cleanly', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const subBtns = container.querySelectorAll('.ref-subtab-btn')
    expect(subBtns.length).toBe(5)

    const balanceBtn = subBtns.find((b: any) => b.dataset.refSubtab === 'balance')
    const vikingBtn = subBtns.find((b: any) => b.dataset.refSubtab === 'viking')
    const romanBtn = subBtns.find((b: any) => b.dataset.refSubtab === 'roman')
    const weaponsBtn = subBtns.find((b: any) => b.dataset.refSubtab === 'weapons')
    const shieldsBtn = subBtns.find((b: any) => b.dataset.refSubtab === 'shields')

    expect(balanceBtn).toBeDefined()
    expect(vikingBtn).toBeDefined()
    expect(romanBtn).toBeDefined()
    expect(weaponsBtn).toBeDefined()
    expect(shieldsBtn).toBeDefined()

    const subPanels = container.querySelectorAll('.ref-subpanel')
    expect(subPanels.length).toBe(5)

    const balancePanel = subPanels.find((p: any) => p.dataset.refSubpanel === 'balance')
    const weaponsPanel = subPanels.find((p: any) => p.dataset.refSubpanel === 'weapons')

    // Initial subtab is balance
    expect(balanceBtn?.classList.contains('active')).toBe(true)
    expect(balancePanel?.classList.contains('active')).toBe(true)
    expect(weaponsBtn?.classList.contains('active')).toBe(false)
    expect(weaponsPanel?.classList.contains('active')).toBe(false)

    // Click weapons subtab
    weaponsBtn?.click()
    expect(weaponsBtn?.classList.contains('active')).toBe(true)
    expect(weaponsPanel?.classList.contains('active')).toBe(true)
    expect(balanceBtn?.classList.contains('active')).toBe(false)
    expect(balancePanel?.classList.contains('active')).toBe(false)

    ui.destroy()
  })

  it('removes technical IDs from weapons and shields reference tables and cards', () => {
    const ui = new BattleSetupUI()
    ui.mount(container, () => {})

    const html = (domRegistry.get('battle-setup-container') as any).innerHTML

    // ID column header should not exist
    expect(html).not.toContain('<th>ID</th>')
    // Technical IDs should not be wrapped in code blocks in reference tables
    expect(html).not.toContain('<code>rusty_dagger</code>')
    expect(html).not.toContain('<code>round_shield_t1</code>')
    expect(html).not.toContain('<code>steel_lance</code>')

    ui.destroy()
  })
})
