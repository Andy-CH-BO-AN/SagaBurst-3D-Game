import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissionGuide } from '../../src/career/MissionGuide'

class Element {
  id = ''; className = ''; textContent = ''; hidden = false
  style: Record<string, string> = {}
  children: Element[] = []
  append(...children: Element[]) { this.children.push(...children) }
  remove = vi.fn()
}
afterEach(() => vi.unstubAllGlobals())
function guide() {
  const body = new Element()
  vi.stubGlobal('document', { createElement: () => new Element(), body })
  const instance = new MissionGuide()
  const root = body.children[0]
  return { instance, root, arrow: root.children[0], label: root.children[1] }
}
describe('Career Outpost defense uses the existing translucent mission guide', () => {
  it('points toward the real defense rally point in the active camera view', () => {
    const { instance, root, arrow, label } = guide()
    instance.updateOutpostDefense('ATTACKING', new THREE.Vector3(), 0, new THREE.Vector3(0, 0, -20), 50)
    expect(root.hidden).toBe(false)
    expect(arrow.style.opacity).toBe('.58')
    expect(arrow.style.transform).toBe(`rotate(${-Math.PI / 2}rad)`)
    expect(label.textContent).toBe('前往防守位置 · 20m')
    expect(root.style.cssText).toContain('position:fixed')
    expect(root.style.cssText).toContain('pointer-events:none')
  })
  it('guides faction field battles without Bandit instructions', () => {
    const { instance, label } = guide()
    const target = new THREE.Vector3(0, 0, -20)
    instance.update('MARCHING', new THREE.Vector3(), 0, target, 40, false, false, 'mounted-field')
    expect(label.textContent).toBe('跟隨隊伍 · 20m')
    instance.update('ENGAGING', new THREE.Vector3(), 0, target, 40, false, false, 'mounted-field')
    expect(label.textContent).toBe('FIELD BATTLE · 敵軍剩餘 40')
  })

  it('dims the same arrow on the defense line and hides it for a terminal result', () => {
    const { instance, root, arrow, label } = guide()
    const point = new THREE.Vector3(0, 0, -20)
    instance.updateOutpostDefense('ATTACKING', point, 1, point, 12)
    expect(arrow.style.opacity).toBe('.18')
    expect(label.textContent).toBe('OUTPOST DEFENSE · 敵軍剩餘 12')
    instance.updateOutpostDefense('RESULT', point, 1, point, 0)
    expect(root.hidden).toBe(true)
    instance.dispose()
    expect(root.remove).toHaveBeenCalledOnce()
  })
})
