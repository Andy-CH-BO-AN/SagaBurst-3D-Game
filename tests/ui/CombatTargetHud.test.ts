import { afterEach, expect, it, vi } from 'vitest'
import { CombatTargetHud } from '../../src/ui/CombatTargetHud'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('expires four seconds after the latest target hit and cancels expiry when the scene is disposed', () => {
  vi.useFakeTimers()
  const visible = new Set<string>()
  const hud = { classList: { add: (value: string) => visible.add(value), remove: (value: string) => visible.delete(value) } }
  const label = { textContent: '' }, fill = { style: { width: '' } }
  const nodes: Record<string, unknown> = { 'enemy-hud': hud, 'enemy-name': label, 'enemy-hp-fill': fill }
  vi.stubGlobal('document', { getElementById: (id: string) => nodes[id] })
  const target = new CombatTargetHud()
  try {
    target.show('敵方劍兵 · T2', 0.75)
    expect(label.textContent).toBe('敵方劍兵 · T2')
    expect(fill.style.width).toBe('75%')
    vi.advanceTimersByTime(3999)
    expect(visible.has('visible')).toBe(true)
    target.show('軍用戰馬', 0.5)
    vi.advanceTimersByTime(3999)
    expect(visible.has('visible')).toBe(true)
    expect(label.textContent).toBe('軍用戰馬')
    expect(fill.style.width).toBe('50%')
    vi.advanceTimersByTime(1)
    expect(visible.has('visible')).toBe(false)
    target.show('平民', 0.2)
    target.dispose()
    expect(visible.has('visible')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // A later scene owns the shared element; an old timer must not hide it.
    visible.add('visible')
    vi.advanceTimersByTime(4000)
    expect(visible.has('visible')).toBe(true)
  } finally { target.dispose() }
})
