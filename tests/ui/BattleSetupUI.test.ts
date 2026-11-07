import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattleSetupUI } from '../../src/ui/BattleSetupUI'
import { getDefaultBattleConfig } from '../../src/battle/BattleConfig'

class FakeElement {
  id = ''
  className = ''
  textContent = ''
  value = ''
  disabled = false
  checked = false
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  attributes: Record<string, string> = {}
  listeners: Record<string, Array<(event: any) => void>> = {}
  parentNode: FakeElement | null = null
  children: FakeElement[] = []
  private _innerHTML = ''

  constructor(public tagName: string = 'div') {}

  get classList() {
    const self = this
    return {
      add(...cls: string[]) {
        const set = new Set(self.className.split(' ').filter(Boolean))
        cls.forEach(c => set.add(c))
        self.className = Array.from(set).join(' ')
      },
      remove(...cls: string[]) {
        const set = new Set(self.className.split(' ').filter(Boolean))
        cls.forEach(c => set.delete(c))
        self.className = Array.from(set).join(' ')
      },
      toggle(cls: string, force?: boolean) {
        const set = new Set(self.className.split(' ').filter(Boolean))
        const has = set.has(cls)
        const shouldAdd = force !== undefined ? force : !has
        if (shouldAdd) set.add(cls); else set.delete(cls)
        self.className = Array.from(set).join(' ')
        return shouldAdd
      },
      contains(cls: string) {
        return self.className.split(' ').includes(cls)
      },
    }
  }

  get innerHTML() {
    return this._innerHTML
  }

  set innerHTML(html: string) {
    this._innerHTML = html
    this.children = []
    parseHtmlToElements(html, this)
  }

  appendChild(child: FakeElement) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild(child: FakeElement) {
    const idx = this.children.indexOf(child)
    if (idx >= 0) {
      this.children.splice(idx, 1)
      child.parentNode = null
    }
    return child
  }

  addEventListener(event: string, callback: (event: any) => void) {
    this.listeners[event] = this.listeners[event] || []
    this.listeners[event].push(callback)
  }

  dispatchEvent(event: { type: string; [key: string]: any }) {
    const list = this.listeners[event.type] || []
    for (const cb of list) {
      cb({ currentTarget: this, target: this, ...event })
    }
  }

  click() {
    this.dispatchEvent({ type: 'click' })
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }

  descendants(): FakeElement[] {
    return this.children.flatMap(child => [child, ...child.descendants()])
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const all = this.descendants()
    if (selector.startsWith('#')) {
      const id = selector.slice(1)
      return all.filter(el => el.id === id)
    }
    if (selector.startsWith('.')) {
      const cls = selector.slice(1)
      return all.filter(el => el.classList.contains(cls))
    }
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const attrExpr = selector.slice(1, -1)
      if (attrExpr.includes('=')) {
        const [attr, val] = attrExpr.split('=')
        const cleanVal = val.replace(/['"]/g, '')
        return all.filter(el => {
          if (attr.startsWith('data-')) {
            const dataKey = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase())
            return el.dataset[dataKey] === cleanVal || el.dataset[attr.slice(5)] === cleanVal
          }
          return el.attributes[attr] === cleanVal
        })
      }
      return all.filter(el => {
        if (attrExpr.startsWith('data-')) {
          const key = attrExpr.slice(5)
          return key in el.dataset
        }
        return attrExpr in el.attributes
      })
    }
    return all.filter(el => el.tagName.toLowerCase() === selector.toLowerCase())
  }
}

function parseHtmlToElements(html: string, parent: FakeElement) {
  // Simple regex tag matcher for IDs, classes, and data attributes to support setup queries
  const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>/g
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase()
    if (['br', 'hr', 'img', 'input', 'meta'].includes(tagName) || !html.slice(match.index).includes(`</${tagName}>`)) {
      const el = new FakeElement(tagName)
      extractAttributes(match[2], el)
      parent.appendChild(el)
    } else {
      const el = new FakeElement(tagName)
      extractAttributes(match[2], el)
      parent.appendChild(el)
    }
  }
}

function extractAttributes(raw: string, el: FakeElement) {
  const idMatch = raw.match(/id=["']([^"']+)["']/)
  if (idMatch) el.id = idMatch[1]

  const classMatch = raw.match(/class=["']([^"']+)["']/)
  if (classMatch) el.className = classMatch[1]

  const valueMatch = raw.match(/value=["']([^"']*)["']/)
  if (valueMatch) el.value = valueMatch[1]

  const dataRegex = /data-([a-zA-Z0-9\-]+)=["']([^"']*)["']/g
  let dm: RegExpExecArray | null
  while ((dm = dataRegex.exec(raw)) !== null) {
    const rawKey = dm[1]
    const val = dm[2]
    el.dataset[rawKey] = val
    const camel = rawKey.replace(/-([a-z])/g, (_, l) => l.toUpperCase())
    el.dataset[camel] = val
  }
}

describe('BattleSetupUI 2.0 Integration & Bug Fixes', () => {
  let fakeBody: FakeElement
  let elementsById: Map<string, FakeElement>

  beforeEach(() => {
    fakeBody = new FakeElement('body')
    elementsById = new Map()

    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
      getElementById: (id: string) => {
        const found = fakeBody.descendants().find(el => el.id === id)
        return found ?? null
      },
      querySelectorAll: (sel: string) => fakeBody.querySelectorAll(sel),
      querySelector: (sel: string) => fakeBody.querySelector(sel),
      body: fakeBody,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders ground battle totals without duplicate denominator (10 / 300, not 10 / 300 / 300)', () => {
    const config = getDefaultBattleConfig()
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})

    const vTotal = document.getElementById('viking-total')
    const rTotal = document.getElementById('roman-total')
    expect(vTotal).not.toBeNull()
    expect(rTotal).not.toBeNull()
    expect(vTotal?.textContent).toBe('10 / 300')
    expect(rTotal?.textContent).toBe('10 / 300')
    expect(vTotal?.textContent).not.toContain('/ 300 / 300')
    expect(rTotal?.textContent).not.toContain('/ 300 / 300')
  })

  it('correctly sets aerial denominators for participating player (49 friendly, 50 enemy)', () => {
    const config = getDefaultBattleConfig()
    config.playerFaction = 'viking'
    config.spectator = false
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})

    ui.switchBattleType('aerial')

    const vTotal = document.getElementById('viking-total')
    const rTotal = document.getElementById('roman-total')
    // Both factions carry over their 2 archers from PRESET_10V10
    expect(vTotal?.textContent).toBe('2 / 49')
    expect(rTotal?.textContent).toBe('2 / 50')
  })

  it('immediately updates aerial denominators when switching player faction from viking to roman', () => {
    const config = getDefaultBattleConfig()
    config.playerFaction = 'viking'
    config.spectator = false
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})
    ui.switchBattleType('aerial')

    const romanBtn = document.getElementById('faction-btn-roman')
    expect(romanBtn).not.toBeNull()
    romanBtn?.click()

    const vTotal = document.getElementById('viking-total')
    const rTotal = document.getElementById('roman-total')
    // Now Roman is player faction (49 max), Viking is enemy (50 max)
    expect(vTotal?.textContent).toBe('2 / 50')
    expect(rTotal?.textContent).toBe('2 / 49')
  })

  it('immediately syncs both sides to 50 max when spectator mode is enabled in aerial battle', () => {
    const config = getDefaultBattleConfig()
    config.playerFaction = 'viking'
    config.spectator = false
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})
    ui.switchBattleType('aerial')

    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    expect(spectatorCheckbox).not.toBeNull()
    spectatorCheckbox!.checked = true
    spectatorCheckbox?.dispatchEvent({ type: 'change' })

    const vTotal = document.getElementById('viking-total')
    const rTotal = document.getElementById('roman-total')
    expect(vTotal?.textContent).toBe('2 / 50')
    expect(rTotal?.textContent).toBe('2 / 50')
  })

  it('switches between Viking and Roman roster panels when edit tabs are clicked', () => {
    const config = getDefaultBattleConfig()
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})

    const editTabRoman = document.getElementById('edit-tab-roman')
    const editTabViking = document.getElementById('edit-tab-viking')
    const panelViking = document.getElementById('roster-panel-viking')
    const panelRoman = document.getElementById('roster-panel-roman')

    expect(panelViking?.classList.contains('active')).toBe(true)
    expect(panelRoman?.classList.contains('active')).toBe(false)

    editTabRoman?.click()
    expect(panelViking?.classList.contains('active')).toBe(false)
    expect(panelRoman?.classList.contains('active')).toBe(true)

    editTabViking?.click()
    expect(panelViking?.classList.contains('active')).toBe(true)
    expect(panelRoman?.classList.contains('active')).toBe(false)
  })

  it('switches active edit faction when clicking army overview cards', () => {
    const config = getDefaultBattleConfig()
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})

    const overviewRoman = document.getElementById('overview-card-roman')
    const overviewViking = document.getElementById('overview-card-viking')
    const panelViking = document.getElementById('roster-panel-viking')
    const panelRoman = document.getElementById('roster-panel-roman')

    overviewRoman?.click()
    expect(panelRoman?.classList.contains('active')).toBe(true)
    expect(panelViking?.classList.contains('active')).toBe(false)

    overviewViking?.click()
    expect(panelViking?.classList.contains('active')).toBe(true)
    expect(panelRoman?.classList.contains('active')).toBe(false)
  })

  it('restores 300 cap when toggling back from aerial to ground battle', () => {
    const config = getDefaultBattleConfig()
    const ui = new BattleSetupUI(config)
    ui.mount(fakeBody as any, () => {})

    ui.switchBattleType('aerial')
    expect(document.getElementById('viking-total')?.textContent).toBe('2 / 49')

    ui.switchBattleType('ground')
    expect(document.getElementById('viking-total')?.textContent).toBe('10 / 300')
    expect(document.getElementById('roman-total')?.textContent).toBe('10 / 300')
  })
})
