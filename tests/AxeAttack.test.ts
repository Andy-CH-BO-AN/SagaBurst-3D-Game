import * as T from 'three';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readGlb, loadRig } from '../tools/lib/humanoid-glb.mjs';
import { createHumanoidRigAdapter, createMountedIdleClip, MixerController } from '../src/world/HumanoidAssetRegistry';
import { CharacterEquipmentPose } from '../src/world/CharacterEquipmentPose';
import { CharacterCombatAnimator, AXE_HIT_TIMES } from '../src/world/CharacterCombatAnimator';
import { applyEquipmentAttachment, calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../src/world/EquipmentAttachmentContract';
import { applySwordAttachment, swordHandMatrix } from '../src/world/SwordAttachmentContract';
import { WeaponMeshFactory } from '../src/world/WeaponMeshFactory';
import { NPC, Faction, AIType } from '../src/world/NPC';
import { Player } from '../src/player/Player';
import { InventoryManager } from '../src/rpg/InventoryManager';
import { WEAPONS } from '../src/rpg/WeaponDatabase';
import { resolveUnitLoadout } from '../src/battle/UnitPresetCatalog';
import type { HandGripFrame } from '../src/world/BowAttachmentContract';
async function fixture(weapon = 'viking_axe_t2') {
    const base = 'public/models/characters/v2/viking';
    const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'));
    const levels = await Promise.all([0, 1, 2].map(i => loadRig(readGlb(`${base}/lod${i}.glb`))));
    const left = { ...manifest.handGripFrames.left } as HandGripFrame;
    for (const k of ['palmContactCenter', 'palmNormal', 'thumbDirection', 'fingerDirection', 'wristCenter', 'thumbBaseCenter'] as const)
        left[k] = new T.Vector3(...manifest.handGripFrames.left[k]);
    const frames = levels.map((l, i) => calibrateEquipmentFrames(manifest.swordGripFrames[`lod${i}`], left, levels[0].scene.getObjectByName('hand_l'), l.scene.getObjectByName('hand_l')));
    levels.forEach((l, i) => calibrateLanceIdleAttachment(l.scene, l.animations.find(c => c.name === 'idle')!, frames[i].lanceRight));
    const controller = new MixerController(levels.map(l => new T.AnimationMixer(l.scene)), levels.map(l => [...l.animations, createMountedIdleClip(l.animations.find(c => c.name === 'idle')!)]));
    const rigs = levels.map((l, i) => { l.scene.userData.equipmentGripFrames = frames[i]; return createHumanoidRigAdapter(l.scene, controller); });
    controller.equipmentLayers = rigs.map((r, i) => new CharacterEquipmentPose(levels[i].scene, r, frames[i]));
    const pivot = new T.Group(), model = new T.Group();
    pivot.add(model);
    WeaponMeshFactory.buildMelee(weapon, model);
    rigs[0].right.handSocket.add(pivot);
    if (weapon === 'steel_lance') applyEquipmentAttachment(rigs[0].right.handSocket, pivot, model, frames[0].lanceRight, 'lance');
    else applySwordAttachment(rigs[0].right.handSocket, pivot, model, frames[0].lanceRight, frames[0].lanceRight.modelRotationLocal);
    const animator = new CharacterCombatAnimator(rigs[0], pivot, new T.Group());
    return { levels, frames, rigs, controller, pivot, model, animator };
}
describe('Viking axe attacks', () => {
    it('descends below the mounted rider pelvis through the 1H contact frame on every LOD', async () => {
        const f = await fixture();
        for (const mount of ['HORSE', 'CORGI'] as const) {
            f.controller.stop(); f.animator.cancel();
            f.animator.setEquipment(false, true, mount);
            f.animator.setLocomotion(0, true); f.animator.update(.2);
            f.animator.start('axeAttack1H');
            const samples: Array<{ hit: boolean; blades: T.Vector3[] }> = [];
            for (let frame = 0; frame < 72; frame++) {
                const event = f.animator.update(1 / 120);
                f.levels.forEach(l => l.scene.updateMatrixWorld(true));
                const blades = f.rigs.map((rig, i) => new T.Vector3(.32, 1.17, 0).applyMatrix4(
                    rig.right.wrist.matrixWorld.clone().multiply(swordHandMatrix(f.frames[i].lanceRight))
                        .multiply(new T.Matrix4().makeRotationX(.45))));
                samples.push({ hit: event.hitActiveStarted, blades });
            }
            expect(samples.filter(s => s.hit)).toHaveLength(1);
            const hit = samples.findIndex(s => s.hit);
            for (let lod = 0; lod < 3; lod++) {
                const before = samples[hit - 1].blades[lod], contact = samples[hit].blades[lod], after = samples[hit + 1].blades[lod];
                expect(contact.y).toBeLessThan(before.y - .015);
                expect(after.y).toBeLessThan(contact.y - .015);
                const pelvis = f.rigs[lod].pelvis!.getWorldPosition(new T.Vector3());
                expect(contact.y).toBeLessThan(pelvis.y - .1);
                expect(contact.y).toBeGreaterThan(pelvis.y - .85);
                expect(contact.x).toBeLessThan(-.6);
                expect(contact.z).toBeGreaterThan(.8);
                expect(contact.distanceTo(samples[hit].blades[0])).toBeLessThan(.00001);
            }
            expect(f.animator.currentAction).toBe('idle');
        }
    });
    it('matches the lance carry wrist exactly and points the axe cutting edge down on every Viking LOD', async () => {
        const f = await fixture(), lance = await fixture('steel_lance');
        for (const mount of ['HORSE', 'CORGI'] as const) for (const shield of [true, false]) {
            f.controller.stop(); f.animator.cancel();
            f.animator.setEquipment(false, shield, mount);
            f.animator.setLocomotion(0, true); f.animator.update(.2);
            lance.controller.stop(); lance.animator.cancel();
            lance.animator.setEquipment(true, shield, mount);
            lance.animator.setLocomotion(0, true); lance.animator.update(.2);
            const visual = f.model.getObjectByName('dane-axe-visual')!;
            const check = () => {
                f.levels.forEach(l => l.scene.updateMatrixWorld(true));
                const edge = new T.Vector3(1, 0, 0).transformDirection(visual.matrixWorld);
                // The unchanged lance wrist retains its subtle idle breathing.
                expect(edge.y).toBeLessThan(-.99);
                for (let i = 0; i < 3; i++) {
                    const wrist = f.rigs[i].right.wrist;
                    for (const joint of ['shoulder', 'elbow', 'wrist'] as const) {
                        f.rigs[i].right[joint].quaternion.toArray().forEach((value, component) =>
                            expect(value).toBeCloseTo(lance.rigs[i].right[joint].quaternion.toArray()[component], 10));
                    }
                    const palm = wrist.localToWorld(new T.Vector3(...f.frames[i].lanceRight.gripCenterLocal));
                    expect(palm.distanceTo(visual.localToWorld(new T.Vector3()))).toBeLessThan(.00001);
                }
            };
            check();
            f.animator.start(shield ? 'axeAttack1H' : 'axeAttack2H');
            for (let frame = 0; frame < 84; frame++) f.animator.update(1 / 120);
            // Compare the same breathing phase after the recovery fade settles.
            for (const actor of [f, lance]) { actor.controller.seek('mounted', .25); actor.animator.update(0); }
            check();
        }
    });
    it('keeps the production Player axe attachment on the calibrated palm after weapon swaps', async () => {
        const f = await fixture();
        const player = new Player(new T.Scene());
        const raw = player as any;
        raw.rig = f.rigs[0];
        raw.rig.swordGripFrame = f.frames[0].lanceRight;
        raw.rig.right.handSocket.add(raw.swordPivot);
        for (const id of ['viking_axe_t1', 'steel_sword', 'viking_axe_t3']) {
            player.rebuildMeleeWeapon(id);
            expect(raw.swordPivot.userData.swordAttachmentOwned).toBe(true);
            f.levels[0].scene.updateMatrixWorld(true);
            const grip = raw.swordGripPivot.localToWorld(new T.Vector3(0, .15, 0));
            const palm = raw.rig.right.wrist.localToWorld(new T.Vector3(...f.frames[0].lanceRight.gripCenterLocal));
            expect(grip.distanceTo(palm)).toBeLessThan(.00001);
        }
    });
    it('records the selected source FBX and distinct contact times in every LOD manifest binding', () => {
        const manifest = JSON.parse(readFileSync('public/models/characters/v2/viking/manifest.json', 'utf8'));
        for (const [clip, source] of [['axeAttack1H', 'HumanM@Attack1H01_R'], ['axeAttack2H', 'HumanM@Attack2H01']] as const) {
            const binding = manifest.animations.embedded.find((entry: {
                clip: string;
            }) => entry.clip === clip);
            expect(binding).toMatchObject({ sourceClip: source, loop: false, duration: .48, events: { hit: AXE_HIT_TIMES[clip], actionComplete: .48 } });
            for (const lod of [0, 1, 2]) {
                const asset = readGlb(`public/models/characters/v2/viking/lod${lod}.glb`);
                expect(asset.document.asset.extras.axeAttackBuild.clips[clip].sourceClip).toBe(source);
            }
        }
    });
    it('Player uses current shield equipment for all axe tiers and preserves sword/gladius actions', () => {
        const player = new Player(new T.Scene());
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
    it('samples source clips and both hands on every LOD, foot and mounted', async () => {
        const f = await fixture(), rows = [];
        for (const mounted of [false, true])
            for (const shield of [true, false]) {
                f.controller.stop();
                f.animator.cancel();
                f.animator.setEquipment(false, shield);
                f.animator.setLocomotion(0, mounted);
                f.animator.update(.2);
                expect(f.animator.start(shield ? 'axeAttack1H' : 'axeAttack2H')).toBe(true);
                expect(f.animator.currentOwnership).toBe('clip');
                let hits = 0, completed = 0;
                for (let frame = 1; frame <= 72; frame++) {
                    f.animator.setLocomotion(4, mounted, true);
                    const e = f.animator.update(1 / 120);
                    hits += Number(e.hitActiveStarted);
                    completed += Number(e.actionCompleted);
                    f.levels.forEach(l => l.scene.updateMatrixWorld(true));
                    const visual = f.model.getObjectByName('dane-axe-visual')!;
                    const blade = visual.localToWorld(new T.Vector3(.32, 1.17, 0));
                    const support = visual.localToWorld(new T.Vector3(0, -.1, 0));
                    const grip = visual.localToWorld(new T.Vector3());
                    const errors = f.rigs.map((r, i) => ({ right: r.right.wrist.localToWorld(new T.Vector3(...f.frames[i].lanceRight.gripCenterLocal)).distanceTo(grip), left: r.left.wrist.localToWorld(new T.Vector3(...f.frames[i].lanceLeft.gripCenterLocal)).distanceTo(support) }));
                    rows.push({ mounted, shield, time: frame / 120, blade: blade.toArray(), errors, hit: e.hitActiveStarted });
                    if (frame / 120 < .48)
                        for (const error of errors) {
                            expect(error.right).toBeLessThan(.00001);
                            if (!shield && frame / 120 >= .08 && frame / 120 <= .42)
                                expect(error.left).toBeLessThan(.00001);
                        }
                }
                expect(hits).toBe(1);
                expect(completed).toBe(1);
                expect((f.controller as any).current).toBe(mounted ? 'mounted' : 'run');
            }
        // The cutting edge enters the forward attack area at each distinct event.
        for (const shield of [true, false]) {
            const hit = rows.find(r => r.shield === shield && !r.mounted && r.hit)!;
            const expected = AXE_HIT_TIMES[shield ? 'axeAttack1H' : 'axeAttack2H'];
            expect(hit.time).toBeGreaterThanOrEqual(expected);
            expect(hit.time - expected).toBeLessThan(1 / 120 + 1e-9);
            expect(Math.abs(hit.blade[0])).toBeLessThan(.9);
            expect(hit.blade[2]).toBeGreaterThan(1.5);
        }
    });
    it('emits exactly one hit for large/zero/distance-throttled steps and none after cancellation', async () => {
        const f = await fixture();
        for (const shield of [true, false])
            for (const distance of [0, 80]) {
                f.animator.cancel();
                f.animator.setEquipment(false, shield);
                const action = shield ? 'axeAttack1H' : 'axeAttack2H';
                expect(f.animator.start(action)).toBe(true);
                expect(f.animator.start(action)).toBe(false);
                expect(f.animator.update(0, distance).hitActiveStarted).toBe(false);
                expect({ ...f.animator.update(1, distance) }).toMatchObject({ hitActiveStarted: true, actionCompleted: true });
                expect(f.animator.update(1, distance).hitActiveStarted).toBe(false);
                f.animator.start(action);
                f.animator.update(AXE_HIT_TIMES[action] / 2, distance);
                f.animator.cancel();
                expect(f.animator.update(1, distance).hitActiveStarted).toBe(false);
            }
    });
    it('settles inactive LOD time during attacks without a hand/socket jump', async () => {
        const f = await fixture();
        f.animator.setEquipment(false, false);
        f.animator.setLocomotion(2);
        f.controller.setVisibleLOD(0);
        f.animator.update(.2);
        f.animator.start('axeAttack2H');
        for (let frame = 0; frame < 57; frame++) {
            f.animator.update(1 / 120, 80);
            const lod = frame % 3;
            f.controller.setVisibleLOD(lod);
            f.levels.forEach(l => l.scene.updateMatrixWorld(true));
            const authority = f.rigs[0].right.wrist.localToWorld(new T.Vector3(...f.frames[0].lanceRight.gripCenterLocal));
            const visible = f.rigs[lod].right.wrist.localToWorld(new T.Vector3(...f.frames[lod].lanceRight.gripCenterLocal));
            expect(visible.distanceTo(authority)).toBeLessThan(.001);
        }
    });
    it('chooses by actual weapon/shield and switches Veteran charge/defend and cavalry at runtime', () => {
        for (const presetId of ['viking_berserker', 'viking_sword_cavalry'] as const) {
            const npc = new NPC(new T.Scene(), 0, 0, Faction.PLAYER, 'viking', AIType.MELEE, 'test', 2, false);
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
});
