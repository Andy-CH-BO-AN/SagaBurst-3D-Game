import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MixerController } from '../src/world/HumanoidAssetRegistry'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { CharacterCombatAnimator, type CombatAction } from '../src/world/CharacterCombatAnimator'
import type { CharacterRig } from '../src/world/CharacterVisuals'
import type { Player } from '../src/player/Player'
import type { HpBar } from '../src/ui/HpBar'

afterEach(() => vi.restoreAllMocks())

function animation() {
  const mixers = Array.from({ length: 3 }, () => new THREE.AnimationMixer(new THREE.Group()))
  const clips = mixers.map(() => [
    new THREE.AnimationClip('idle', 10, []),
    new THREE.AnimationClip('swordSlash', 0.48, []),
    new THREE.AnimationClip('bowRelease', 0.22, []),
    new THREE.AnimationClip('pilumThrow', 1.5, []),
  ])
  const controller = new MixerController(mixers, clips)
  controller.play('idle', { fadeSeconds: 0 })
  const updates = mixers.map(mixer => vi.spyOn(mixer, 'update'))
  return { controller, mixers, clips, updates }
}

describe('humanoid visual distance throttle', () => {
  it.each([10, 27, 28])('evaluates all three mixers every frame at %sm', distance => {
    const { controller, mixers, updates } = animation()
    for (let frame = 0; frame < 60; frame++) controller.update(1 / 60, distance)
    for (const update of updates) expect(update).toHaveBeenCalledTimes(60)
    for (const mixer of mixers) expect(mixer.time).toBeCloseTo(1)
  })

  it.each([29, 60])('evaluates all three mixers at 12 Hz at %sm without losing time', distance => {
    const { controller, mixers, clips, updates } = animation()
    for (let frame = 0; frame < 4; frame++) controller.update(1 / 60, distance)
    for (const update of updates) expect(update).not.toHaveBeenCalled()
    controller.update(1 / 60, distance)
    for (const update of updates) expect(update).toHaveBeenCalledWith(5 / 60)
    for (let frame = 5; frame < 60; frame++) controller.update(1 / 60, distance)
    for (const update of updates) expect(update).toHaveBeenCalledTimes(12)
    mixers.forEach((mixer, i) => {
      expect(mixer.time).toBeCloseTo(1)
      expect(mixer.existingAction(clips[i][0])!.time).toBeCloseTo(1)
    })
  })

  it('consumes the actual accumulated dt including interval overshoot', () => {
    const { controller, updates } = animation()
    for (const dt of [0.017, 0.021, 0.031, 0.029]) controller.update(dt, 60)
    for (const update of updates) {
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0][0]).toBeCloseTo(0.098)
    }
  })

  it('flushes pending far time exactly once on return near; zero dt preserves it', () => {
    const { controller, mixers, updates } = animation()
    controller.update(1 / 60, 60)
    controller.update(1 / 60, 60)
    controller.update(0, 10)
    for (const update of updates) expect(update).not.toHaveBeenCalled()
    controller.update(1 / 60, 10)
    for (const update of updates) expect(update).toHaveBeenLastCalledWith(3 / 60)
    controller.update(1 / 60, 10)
    for (const update of updates) expect(update).toHaveBeenLastCalledWith(1 / 60)
    for (let frame = 0; frame < 5; frame++) controller.update(1 / 60, 60)
    for (const mixer of mixers) expect(mixer.time).toBeCloseTo(9 / 60)
  })

  it('crosses 27/29m repeatedly without resetting or duplicating clip time', () => {
    const { controller, mixers, clips } = animation()
    for (let frame = 0; frame < 120; frame++) {
      controller.update(1 / 60, frame % 2 === 0 ? 29 : 27)
      mixers.forEach((mixer, i) => {
        const expected = (frame + 1 - (frame % 2 === 0 ? 1 : 0)) / 60
        expect(mixer.time).toBeCloseTo(expected)
        expect(mixer.existingAction(clips[i][0])!.time).toBeCloseTo(expected)
      })
    }
  })
})

type Fixture = {
  rig: CharacterRig
  animator: CharacterCombatAnimator
  bowArrowReleased: boolean
  _findTarget(): { position: THREE.Vector3; isDead: boolean; isPlayer: boolean } | null
}

function npcFixture(type = AIType.MELEE) {
  const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, type, 'distance-test', 2, false)
  const fixture = npc as unknown as Fixture
  const { controller, mixers } = animation()
  fixture.rig.animation = controller
  const target = vi.spyOn(fixture, '_findTarget').mockReturnValue(null)
  const forward = vi.spyOn(controller, 'update')
  const tick = (distance: number, dt = 1 / 60) => npc.update(dt, {} as Player, [], [], [], {} as HpBar, vi.fn(), vi.fn(), true, distance)
  return { npc, fixture, target, forward, tick, mixers }
}

describe('NPC / combat animator distance forwarding and gameplay isolation', () => {
  it.each(['idle', 'chase', 'melee', 'ranged', 'recovery', 'dead'] as const)('forwards distance on the %s path', path => {
    const { npc, fixture, target, forward, tick } = npcFixture(path === 'ranged' || path === 'recovery' ? AIType.RANGED : AIType.MELEE)
    if (path === 'dead') npc.takeDamage(99999)
    if (path === 'chase') npc.state = AIState.CHASE
    if (['melee', 'ranged', 'recovery'].includes(path)) npc.state = AIState.ATTACK
    if (path !== 'idle' && path !== 'dead') target.mockReturnValue({
      position: npc.position.clone().add(new THREE.Vector3(0, 0, path === 'melee' ? 1 : 15)), isDead: false, isPlayer: false,
    })
    if (path === 'recovery') {
      fixture.animator.start('bowRelease')
      fixture.bowArrowReleased = true
    }
    tick(60)
    expect(forward).toHaveBeenCalledExactlyOnceWith(1 / 60, 60)
  })

  it.each<Exclude<CombatAction, 'idle' | 'bowAim'>>(['swordSlash', 'lanceThrust', 'mountedLance', 'bowRelease', 'pilumThrow'])('keeps every %s gameplay event on the same frame near and far', action => {
    function timeline(distance: number) {
      const { fixture, mixers } = npcFixture()
      fixture.animator.start(action)
      const events = []
      // Binary-exact steps also exercise pilum's equal release/completion time.
      for (let frame = 0; frame < 128; frame++) {
        const result = fixture.animator.update(1 / 64, distance)
        if (result.hitActiveStarted || result.projectileRelease || result.actionCompleted) events.push({ frame, ...result })
      }
      fixture.animator.update(1 / 64, 10)
      return { events, time: mixers[0].time }
    }
    const near = timeline(10), far = timeline(60)
    expect(far.events).toEqual(near.events)
    expect(far.events.some(event => event.actionCompleted)).toBe(true)
    expect(far.events.some(event => event.hitActiveStarted || event.projectileRelease)).toBe(true)
    expect(far.time).toBeCloseTo(near.time)
  })

  it('keeps chase movement and alert countdown identical near and far', () => {
    function simulation(distance: number) {
      const { npc, target, tick } = npcFixture()
      target.mockReturnValue({ position: npc.position.clone().add(new THREE.Vector3(0, 0, 15)), isDead: false, isPlayer: false })
      const frames = []
      for (let frame = 0; frame < 90; frame++) {
        tick(distance)
        frames.push({ state: npc.state, position: npc.position.toArray(), action: npc.combatAnimationAction, hp: npc.hp })
      }
      return frames
    }
    expect(simulation(60)).toEqual(simulation(10))
  })
})
