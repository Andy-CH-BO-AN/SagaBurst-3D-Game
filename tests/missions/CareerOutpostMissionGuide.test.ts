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
  it('guides Captain Patrol toward a moving leader and hides only its own UI at the result', () => {
    const { instance, root, arrow, label } = guide()
    const other = new MissionGuide('career-duel-guide')
    const target = new THREE.Vector3(185, 0, 0)
    instance.updateCaptainPatrol('ENGAGING', new THREE.Vector3(), 0, target)
    expect(root.hidden).toBe(false); expect(label.textContent).toBe('前往巡邏隊長 · 185m')
    expect(arrow.style.transform).toBe('rotate(0rad)')
    target.set(0, 0, -25)
    instance.updateCaptainPatrol('ENGAGING', new THREE.Vector3(), 0, target)
    expect(label.textContent).toBe('前往巡邏隊長 · 25m')
    expect(arrow.style.transform).toBe(`rotate(${-Math.PI / 2}rad)`)
    instance.updateCaptainPatrol('ENGAGING', new THREE.Vector3(0, 0, -20), 0, target)
    expect(label.textContent).toBe('已抵達巡邏隊 · 按 Q 指揮')
    other.updateDuel('RETURNING', new THREE.Vector3(), 0, target)
    instance.updateCaptainPatrol('RESULT', new THREE.Vector3(), 0, target)
    expect(root.hidden).toBe(true)
    expect((document.body as unknown as Element).children[1].hidden).toBe(false)
    instance.updateCaptainPatrol('RETURNING', new THREE.Vector3(), 0, target)
    expect(label.textContent).toBe('返回小鎮 · 25m')
    instance.updateCaptainPatrol('ENGAGING', new THREE.Vector3(), 0, null)
    expect(root.hidden).toBe(true)
    instance.dispose(); other.dispose()
  })
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

  it.each(['ASSEMBLING', 'MARCHING', 'ENGAGING'] as const)('Captain sweep %s points directly at Bandits instead of the muster', phase => {
    const { instance, label, arrow } = guide()
    instance.update(phase, new THREE.Vector3(), 0, new THREE.Vector3(0, 0, -120), 40, false, false, 'captain-sweep')
    expect(label.textContent).toBe('前往 Bandits 所在位置 · 120m · 剩餘 40')
    expect(arrow.style.transform).toBe(`rotate(${-Math.PI / 2}rad)`)
    expect(arrow.style.opacity).toBe('.58')
    instance.update('ASSEMBLING', new THREE.Vector3(), 0, new THREE.Vector3(0, 0, -20), 40)
    expect(label.textContent).toBe('前往集合點 · 20m')
  })

  it('labels the commanded North gate during town preparation, arrival and combat', () => {
    const { instance, label, arrow } = guide(), rally = new THREE.Vector3(0, 0, -103)
    instance.updateTownDefense('PREPARING', new THREE.Vector3(), 0, rally, 120, 0, 10, '北門')
    expect(label.textContent).toBe('開戰倒數 10 秒 · 北門 103m')
    expect(arrow.style.transform).toBe(`rotate(${-Math.PI / 2}rad)`)
    instance.updateTownDefense('PREPARING', rally, 0, rally, 120, 0, 5, '北門')
    expect(label.textContent).toBe('開戰倒數 5 秒 · 北門 · 準備迎戰')
    instance.updateTownDefense('ATTACKING', rally, 0, rally, 119, 1, 0, '北門')
    expect(label.textContent).toBe('TOWN DEFENSE · 北門 · 敵軍剩餘 119 · 平民死亡 1/10')
    instance.updateTownDefense('PREPARING', new THREE.Vector3(), 0, new THREE.Vector3(0, 0, 51), 120, 0, 10)
    expect(label.textContent).toBe('開戰倒數 10 秒 · 防守位置 51m')
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
