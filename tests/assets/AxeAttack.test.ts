import * as T from 'three'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CharacterCombatAnimator } from '../../src/world/CharacterCombatAnimator'
import { applySwordAttachment } from '../../src/world/SwordAttachmentContract'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { resolveUnitLoadout } from '../../src/battle/UnitPresetCatalog'
import { selectedHumanoidInstance, replacementManifest } from '../helpers/selectedHumanoidAsset'

// The previous fixture bypassed the registry and re-applied legacy retarget/FK
// onto imported Viking clips. Exercise the selected runtime path instead.
async function fixture() {
  const actor = await selectedHumanoidInstance('viking')
  onTestFinished(() => actor.dispose())
  const pivot = new T.Group(), model = new T.Group()
  pivot.add(model); WeaponMeshFactory.buildMelee('viking_axe_t2', model)
  actor.rig.right.handSocket.add(pivot)
  applySwordAttachment(actor.rig.right.handSocket, pivot, model, actor.rig.swordGripFrame!)
  const animator = new CharacterCombatAnimator(actor.rig, pivot, new T.Group())
  return { actor, pivot, model, animator }
}
describe('Viking axe attacks', () => {
  it('keeps the full source clip, palm attachment and one hit through gameplay-scaled attacks and LOD switches', async () => {
    const { actor, model, animator } = await fixture()
    const manifest = replacementManifest('viking')
    for (const action of ['axeAttack1H', 'axeAttack2H'] as const) for (const speed of [1, 1.55]) {
      animator.cancel(); animator.setEquipment(false, action === 'axeAttack1H')
      animator.setLocomotion(0, false); animator.update(.2)
      expect(animator.start(action, speed)).toBe(true)
      expect(animator.currentOwnership).toBe('clip')
      const binding = manifest.animations!.embedded.find(binding => binding.clip === action)!
      const expectedHit = binding.events!.hit * .48 / binding.duration / speed
      let hits = 0, completions = 0, contact = 0
      for (let frame = 1; frame <= 90; frame++) {
        const events = animator.update(1 / 120, frame % 2 ? 29 : 61)
        hits += Number(events.hitActiveStarted); completions += Number(events.actionCompleted)
        if (events.hitActiveStarted) contact = frame / 120
        actor.root.updateMatrixWorld(true)
        const grip = model.localToWorld(new T.Vector3(0, action === 'axeAttack2H' && frame / 120 < .48 / speed ? .35 : .15, 0))
        const palm = actor.rig.right.wrist.localToWorld(new T.Vector3(...actor.rig.swordGripFrame!.gripCenterLocal))
        expect(grip.distanceTo(palm), `${action} speed${speed} frame${frame}`).toBeLessThan(1e-5)
      }
      expect(hits).toBe(1); expect(completions).toBe(1)
      expect(contact).toBeGreaterThanOrEqual(expectedHit - 1e-9)
      expect(contact - expectedHit).toBeLessThan(1 / 120 + 1e-9)
      expect(animator.currentAction).toBe('idle')
      expect(actor.rig.animation!.getDuration(action)).toBeCloseTo(binding.duration, 4)
    }
  })
  it('keeps both palms on the formal axe shaft through the mounted two-handed contact window', async () => {
    const { actor, model, animator } = await fixture()
    const parent = new T.Group(); parent.rotation.set(.1, .7, -.15); parent.position.set(3, 2, -4); parent.add(actor.root)
    const visual = model.getObjectByName('dane-axe-visual')!
    const binding = replacementManifest('viking').animations!.embedded.find(binding => binding.clip === 'axeAttack2H')!
    const start = binding.events!.activeStart * .48 / binding.duration
    const end = binding.events!.activeEnd * .48 / binding.duration
    for (const mount of ['HORSE', 'CORGI'] as const) {
      animator.cancel(); animator.setEquipment(false, false, mount); animator.setLocomotion(0, true); animator.update(.2)
      parent.updateMatrixWorld(true)
      const ankles = [actor.rig.leftLeg.ankle, actor.rig.rightLeg.ankle]
      const mountedFeet = ankles.map(ankle => actor.root.worldToLocal(ankle.getWorldPosition(new T.Vector3())))
      expect(animator.start('axeAttack2H')).toBe(true)
      let contactSamples = 0
      for (let frame = 1; frame <= 60; frame++) {
        animator.update(1 / 120); parent.updateMatrixWorld(true)
        ankles.forEach((ankle, index) => {
          const foot = actor.root.worldToLocal(ankle.getWorldPosition(new T.Vector3()))
          expect(foot.x, `${mount} seat x`).toBeCloseTo(mountedFeet[index].x, 4)
          expect(foot.z, `${mount} seat z`).toBeCloseTo(mountedFeet[index].z, 4)
        })
        const right = actor.rig.right.wrist.localToWorld(new T.Vector3(...actor.rig.swordGripFrame!.gripCenterLocal))
        const actualRight = model.localToWorld(new T.Vector3(0, frame / 120 < .48 ? .35 : .15, 0))
        expect(actualRight.distanceTo(right), mount).toBeLessThan(1e-5)
        if (frame / 120 < start || frame / 120 > end) continue
        const left = actor.rig.left.wrist.localToWorld(new T.Vector3(...actor.rig.equipmentGripFrames!.lanceLeft.gripCenterLocal))
        // Formal Dane axe's actual wooden haft, not an imagined infinite line.
        const butt = visual.localToWorld(new T.Vector3(0, -.1, 0))
        const top = visual.localToWorld(new T.Vector3(0, 1.17, 0))
        const closest = new T.Line3(butt, top).closestPointToPoint(left, true, new T.Vector3())
        expect(closest.distanceTo(left), `${mount} contact frame${frame}`).toBeLessThan(.04)
        contactSamples++
      }
      expect(contactSamples).toBeGreaterThan(0)
    }
  })
  it('emits exactly one hit for large/zero/distance-throttled steps and none after cancellation', async () => {
    const { animator } = await fixture()
    for (const action of ['axeAttack1H', 'axeAttack2H'] as const) for (const distance of [0, 80]) {
      animator.cancel(); animator.setEquipment(false, action === 'axeAttack1H')
      expect(animator.start(action)).toBe(true)
      expect(animator.start(action)).toBe(false)
      expect(animator.update(0, distance).hitActiveStarted).toBe(false)
      expect({ ...animator.update(1, distance) }).toMatchObject({ hitActiveStarted: true, actionCompleted: true })
      expect(animator.update(1, distance).hitActiveStarted).toBe(false)
      expect(animator.start(action)).toBe(true)
      animator.update(.001, distance); animator.cancel()
      expect(animator.update(1, distance).hitActiveStarted).toBe(false)
    }
  })
    it('Player uses current shield equipment for all axe tiers and preserves sword/gladius actions', () => {
        const player = new Player(new T.Scene());
        onTestFinished(() => player.dispose());
        const inventory = new InventoryManager();
        const update = () => player.update(0, { keys: {}, consumeLeftClick: () => false, consumeLeftClickRelease: () => false } as any, 0, new T.Vector3(0, 1, 10), [], { setFill() { } } as any, { setAiming() { }, setChargeRatio() { }, setShieldBlocked() { } } as any, {} as any, inventory);
        for (const shield of [true, false, true]) {
            if (shield)
                inventory.equipWeapon('round_shield_t3');
            else
                inventory.unequipShield();
            update();
            for (const tier of [1, 2, 3])
                expect((player as any)._meleeAction(WEAPONS[`viking_axe_t${tier}`])).toBe(shield ? 'axeAttack1H' : 'axeAttack2H');
            for (const id of ['steel_sword', 'gladius_standard'])
                expect((player as any)._meleeAction(WEAPONS[id])).toBe('swordSlash');
        }
    });
    it('chooses by actual weapon/shield and switches Veteran charge/defend and cavalry at runtime', () => {
        for (const presetId of ['viking_berserker', 'viking_sword_cavalry'] as const) {
            const npc = new NPC(new T.Scene(), 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'test', 2, false);
            onTestFinished(() => npc.dispose());
            Object.assign(npc, { presetId, loadout: resolveUnitLoadout(presetId, 2), meleeWeaponId: 'viking_axe_t2', shieldId: 'round_shield_t2' });
            expect((npc as any)._meleeAction()).toBe('axeAttack1H');
            if (presetId === 'viking_berserker')
                npc.setTacticalOrder('charge');
            else {
                npc.shieldId = null;
                npc.rebuildShield();
            }
            expect((npc as any)._meleeAction()).toBe('axeAttack2H');
            if (presetId === 'viking_berserker')
                npc.setTacticalOrder('defend');
            else {
                npc.shieldId = 'round_shield_t2';
                npc.rebuildShield();
            }
            expect((npc as any)._meleeAction()).toBe('axeAttack1H');
            npc.meleeWeaponId = 'steel_sword';
            expect((npc as any)._meleeAction()).toBe('swordSlash');
            npc.meleeWeaponId = 'gladius_standard';
            expect((npc as any)._meleeAction()).toBe('swordSlash');
        }
    });

})
