import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MixerController } from '../src/world/HumanoidAssetRegistry'
import type { CharacterEquipmentPose } from '../src/world/CharacterEquipmentPose'

function fixture(visible?: number) {
  const roots = Array.from({ length: 3 }, () => new THREE.Group())
  const mixers = roots.map(root => new THREE.AnimationMixer(root))
  const clips = roots.map(() => [
    new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, .5, 1], [0, .2, 0])]),
    new THREE.AnimationClip('run', .8, [new THREE.NumberKeyframeTrack('.position[x]', [0, .4, .8], [0, 1, 0])]),
    ...['swordSlash', 'bowRelease', 'pilumThrow', 'death'].map(name =>
      new THREE.AnimationClip(name, .48, [new THREE.NumberKeyframeTrack('.position[x]', [0, .24, .48], [0, 2, 3])])),
  ])
  const controller = new MixerController(mixers, clips)
  const layers = roots.map(() => ({ restore: vi.fn(), apply: vi.fn(), stop: vi.fn() }))
  controller.equipmentLayers = layers as unknown as CharacterEquipmentPose[]
  controller.play('idle', { fadeSeconds: 0 })
  if (visible !== undefined) controller.setVisibleLOD(visible)
  const updates = mixers.map(mixer => vi.spyOn(mixer, 'update'))
  layers.forEach(layer => layer.apply.mockClear())
  return { controller, mixers, roots, clips, layers, updates }
}

function compareLevel(actual: ReturnType<typeof fixture>, baseline: ReturnType<typeof fixture>, lod: number) {
  expect(actual.mixers[lod].time).toBeCloseTo(baseline.mixers[lod].time, 9)
  expect(actual.roots[lod].position.x).toBeCloseTo(baseline.roots[lod].position.x, 7)
  actual.clips[lod].forEach((clip, i) => {
    const a = actual.mixers[lod].existingAction(clip)!, b = baseline.mixers[lod].existingAction(baseline.clips[lod][i])!
    expect(a.enabled).toBe(b.enabled)
    // Faded-out actions have zero influence and are reset by play() before reuse.
    if (b.enabled) expect(a.time).toBeCloseTo(b.time, 8)
    expect(a.paused).toBe(b.paused)
    expect(a.loop).toBe(b.loop)
    expect(a.clampWhenFinished).toBe(b.clampWhenFinished)
    expect(a.timeScale).toBe(b.timeScale)
    expect(a.getEffectiveWeight()).toBeCloseTo(b.getEffectiveWeight(), 7)
  })
}

describe('humanoid LOD visual evaluation work', () => {
  it.each([0, 1, 2])('evaluates only authority + LOD%s in steady state', visible => {
    const f = fixture(visible)
    for (let frame = 0; frame < 60; frame++) f.controller.update(1 / 60)
    for (let index = 0; index < 3; index++) {
      const count = index === 0 || index === visible ? 60 : 0
      expect(f.updates[index]).toHaveBeenCalledTimes(count)
      expect(f.layers[index].apply).toHaveBeenCalledTimes(count)
    }
  })

  it('catches up a hidden looping clip after two seconds without replaying it', () => {
    const a = fixture(2), b = fixture()
    for (const f of [a, b]) f.controller.play('run', { fadeSeconds: 0 })
    for (let frame = 0; frame < 120; frame++) { a.controller.update(1 / 60); b.controller.update(1 / 60) }
    expect(a.updates[1]).not.toHaveBeenCalled()
    const action = a.mixers[1].existingAction(a.clips[1][1])!
    const reset = vi.spyOn(action, 'reset')
    a.controller.setVisibleLOD(1)
    expect(a.updates[1]).toHaveBeenCalledExactlyOnceWith(expect.closeTo(2, 9))
    expect(reset).not.toHaveBeenCalled()
    compareLevel(a, b, 0); compareLevel(a, b, 1)
  })

  it.each(['swordSlash', 'bowRelease', 'pilumThrow', 'death'] as const)('preserves %s fades, clamping and state across every LOD switch', state => {
    const a = fixture(2), b = fixture()
    for (let frame = 0; frame < 90; frame++) { a.controller.update(1 / 60); b.controller.update(1 / 60) }
    for (const f of [a, b]) f.controller.play(state, { fadeSeconds: .12, loop: false })
    for (let frame = 0; frame < 90; frame++) {
      a.controller.update(1 / 60); b.controller.update(1 / 60)
      const lod = [0, 1, 2, 1][Math.floor(frame / 4) % 4]
      a.controller.setVisibleLOD(lod)
      compareLevel(a, b, 0); compareLevel(a, b, lod)
    }
  })

  it('temporarily evaluates all mixers and poses during a fade, then skips again', () => {
    const f = fixture(0)
    f.controller.play('run', { fadeSeconds: .125 })
    f.layers.forEach(layer => layer.apply.mockClear())
    for (let frame = 0; frame < 8; frame++) f.controller.update(1 / 64)
    f.updates.forEach(update => expect(update).toHaveBeenCalledTimes(8))
    f.layers.forEach(layer => expect(layer.apply).toHaveBeenCalledTimes(8))
    f.controller.update(1 / 64)
    expect(f.updates[0]).toHaveBeenCalledTimes(9)
    expect(f.updates[1]).toHaveBeenCalledTimes(8)
  })

  it('settles old-rate time before changing a hidden action timeScale or seek', () => {
    const a = fixture(2), b = fixture()
    for (const scale of [1, .5, 2]) {
      for (const f of [a, b]) f.controller.play('run', { fadeSeconds: 0, timeScale: scale })
      for (let frame = 0; frame < 35; frame++) { a.controller.update(.02); b.controller.update(.02) }
    }
    a.controller.setVisibleLOD(1)
    compareLevel(a, b, 1)
    for (const f of [a, b]) f.controller.seek('run', .35)
    for (let frame = 0; frame < 20; frame++) { a.controller.update(.02); b.controller.update(.02) }
    a.controller.setVisibleLOD(2)
    compareLevel(a, b, 2)
  })

  it('combines 12 Hz with two mixers and switches to near without consuming dt twice', () => {
    const a = fixture(2), b = fixture()
    for (let frame = 0; frame < 60; frame++) { a.controller.update(1 / 60, 60); b.controller.update(1 / 60, 60) }
    expect(a.updates[0]).toHaveBeenCalledTimes(12)
    expect(a.updates[1]).not.toHaveBeenCalled()
    expect(a.updates[2]).toHaveBeenCalledTimes(12)
    for (let frame = 0; frame < 2; frame++) { a.controller.update(1 / 60, 60); b.controller.update(1 / 60, 60) }
    const authorityTime = a.mixers[0].time
    a.controller.setVisibleLOD(1)
    expect(a.mixers[0].time).toBe(authorityTime)
    compareLevel(a, b, 1)
    a.controller.setVisibleLOD(0)
    a.controller.update(1 / 60, 20); b.controller.update(1 / 60, 20)
    compareLevel(a, b, 0)
    a.controller.setVisibleLOD(2)
    compareLevel(a, b, 2)
    expect(a.mixers[0].time).toBeCloseTo(63 / 60)
  })

  it('uses the last evaluated equipment state when switching between far ticks', () => {
    const f = fixture(2)
    f.controller.setEquipmentState({ elapsed: .1, shield: true })
    f.controller.update(.1, 60)
    f.controller.setEquipmentState({ elapsed: .12, shield: false })
    f.controller.update(.02, 60)
    f.controller.setVisibleLOD(1)
    expect(f.layers[1].apply).toHaveBeenLastCalledWith(expect.objectContaining({ elapsed: .1, shield: true }))
  })
})
