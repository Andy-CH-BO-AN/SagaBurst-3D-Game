import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { MixerController } from '../src/world/HumanoidAssetRegistry'
import type { CharacterRig } from '../src/world/CharacterVisuals'
import type { Player } from '../src/player/Player'
import type { HpBar } from '../src/ui/HpBar'

type NPCFixture = {
  state: AIState
  arrows: number
  rig: CharacterRig
  bowPivot: THREE.Group
  swordPivot: THREE.Group
  bowVisual: { nockedArrow: THREE.Group }
  _findTarget(): { position: THREE.Vector3; isDead: boolean; isPlayer: boolean } | null
  _createAlertSprite(): THREE.Sprite
}

afterEach(() => vi.restoreAllMocks())

describe('NPC imported bow release', () => {
  for (const arrows of [1, 2]) {
    it(`fires once and preserves recovery with ${arrows} arrow(s), even if the target disappears`, () => {
      vi.spyOn(NPC.prototype as unknown as NPCFixture, '_createAlertSprite').mockReturnValue(new THREE.Sprite())
      const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, AIType.RANGED, 'bow-recovery', 2, false)
      const fixture = npc as unknown as NPCFixture
      fixture.state = AIState.ATTACK
      fixture.arrows = arrows
      const target = vi.spyOn(fixture, '_findTarget').mockReturnValue({
        position: npc.position.clone().add(new THREE.Vector3(0, 0, 15)), isDead: false, isPlayer: false,
      })
      const hand = fixture.rig.left.wrist
      hand.name = 'recovery_hand'
      const track = (end: number, duration: number) => new THREE.NumberKeyframeTrack('recovery_hand.rotation[x]', [0, duration], [0, end])
      const release = new THREE.AnimationClip('bowRelease', 0.22, [track(0.9, 0.22)])
      const mixer = new THREE.AnimationMixer(npc.group)
      fixture.rig.animation = new MixerController([mixer], [[
        new THREE.AnimationClip('idle', 1, [track(0, 1)]),
        new THREE.AnimationClip('bowLoad', 0.8, [track(0.1, 0.8)]),
        new THREE.AnimationClip('bowHold', 1, [track(0.1, 1)]),
        release,
      ]])
      const fire = vi.fn()
      const update = () => npc.update(0.01, {} as Player, [], [], [], {} as HpBar, vi.fn(), fire, true)
      for (let i = 0; i < 170 && !fire.mock.calls.length; i++) update()
      expect(fire).toHaveBeenCalledTimes(1)
      expect(fire.mock.calls[0][2]).toBe('arrow')
      expect(npc.combatAnimationAction).toBe('bowRelease')
      expect(fixture.bowPivot.visible).toBe(true)
      expect(fixture.swordPivot.visible).toBe(false)
      expect(fixture.bowVisual.nockedArrow.visible).toBe(false)
      const timeAtRelease = mixer.existingAction(release)!.time
      const handAtRelease = hand.quaternion.clone()
      target.mockReturnValue(null)
      for (let i = 0; i < 10; i++) update()
      expect(npc.combatAnimationAction).toBe('bowRelease')
      expect(mixer.existingAction(release)!.time).toBeGreaterThan(timeAtRelease + 0.09)
      expect(hand.quaternion.angleTo(handAtRelease)).toBeGreaterThan(0.1)
      expect(fixture.bowVisual.nockedArrow.visible).toBe(false)
      for (let i = 0; i < 10; i++) update()
      expect(npc.combatAnimationAction).not.toBe('bowRelease')
      expect(fire).toHaveBeenCalledTimes(1)
      expect(fixture.arrows).toBe(arrows - 1)
      expect(fixture.bowPivot.visible).toBe(arrows > 1)
      expect(fixture.swordPivot.visible).toBe(arrows === 1)
    })
  }
})
