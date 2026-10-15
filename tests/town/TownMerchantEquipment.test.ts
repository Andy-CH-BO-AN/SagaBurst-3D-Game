import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { CIVILIAN_HUMANOID_ASSET, HumanoidAssetRegistry, resolveHumanoidAnimationClips } from '../../src/world/HumanoidAssetRegistry'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { calibrateEquipmentFrames, calibrateLanceIdleAttachment } from '../../src/world/EquipmentAttachmentContract'
// @ts-expect-error The repository diagnostic loader has no TypeScript declaration.
import { loadRig, readGlb } from '../../tools/lib/humanoid-glb.mjs'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { townMerchantLoadout } from '../../src/town/TownMerchantEquipment'
import { weaponShieldImpact } from '../../src/combat/ShieldBlocking'

// Two real NPCs plus a Player, zero Mount/TownWorld. Calibrated native rigs protect physical attack dispatch.
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))

type HumanoidTemplate = ReturnType<typeof HumanoidAssetRegistry._snapshotTemplatesForTesting> extends Map<string, infer T> ? T : never
const savedTemplates = HumanoidAssetRegistry._snapshotTemplatesForTesting()

beforeAll(async () => {
  const templates = HumanoidAssetRegistry._snapshotTemplatesForTesting()
  for (const faction of ['roman', 'viking'] as const) {
    // Combat dispatch uses the retained resident rig. Military selected-source
    // skin/pose contracts have their own asset integration owner.
    const base = 'public/models/characters/v2/roman-civilian'
    const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8')) as HumanoidTemplate['manifest']
    const levels: HumanoidTemplate['levels'] = await Promise.all([0, 1, 2].map(lod => loadRig(readGlb(`${base}/lod${lod}.glb`))))
    const authoredLeft = manifest.handGripFrames?.left, swords = manifest.swordGripFrames
    if (!authoredLeft || !swords) throw new Error(`${faction} Merchant rig requires authored hand and sword frames`)
    const left: Parameters<typeof calibrateEquipmentFrames>[1] = {
      ...authoredLeft, palmContactCenter: new THREE.Vector3(...authoredLeft.palmContactCenter),
      palmNormal: new THREE.Vector3(...authoredLeft.palmNormal), thumbDirection: new THREE.Vector3(...authoredLeft.thumbDirection),
      fingerDirection: new THREE.Vector3(...authoredLeft.fingerDirection), wristCenter: new THREE.Vector3(...authoredLeft.wristCenter),
      thumbBaseCenter: new THREE.Vector3(...authoredLeft.thumbBaseCenter),
    }
    levels[0].scene.updateMatrixWorld(true)
    const referenceHand = levels[0].scene.getObjectByName('hand_l')!
    levels.forEach((level, lod) => {
      level.scene.updateMatrixWorld(true)
      const frames = calibrateEquipmentFrames(swords[`lod${lod}` as 'lod0' | 'lod1' | 'lod2'], left,
        referenceHand, level.scene.getObjectByName('hand_l')!)
      level.scene.userData.equipmentGripFrames = frames
      level.scene.userData.equipmentFaction = faction
      calibrateLanceIdleAttachment(level.scene, level.animations.find(clip => clip.name === 'idle')!, frames.lanceRight)
    })
    templates.set(faction, { manifest, levels, animationClips: resolveHumanoidAnimationClips(levels.map(level => level.animations)) })
  }
  HumanoidAssetRegistry._restoreTemplatesForTesting(templates)
  const base = 'public/models/characters/v2/roman-civilian'
  const manifest = JSON.parse(readFileSync(`${base}/manifest.json`, 'utf8'))
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
  const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => loadRig(readGlb(`public${url}`)))
  try { await HumanoidAssetRegistry.preloadAsset(CIVILIAN_HUMANOID_ASSET) }
  finally { fetchMock.mockRestore(); loader.mockRestore() }
})
afterAll(() => HumanoidAssetRegistry._restoreTemplatesForTesting(savedTemplates))

function merchant(faction: 'roman' | 'viking'): NPC {
  const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, faction, AIType.MELEE, 'merchant', 2, false,
    townMerchantLoadout(), undefined, 'civilians', 'merchant', undefined, undefined, undefined, undefined,
    'civilian', faction, 'merchant')
  onTestFinished(() => npc.dispose())
  return npc
}

function nativeCombat(npc: NPC, target: NPC) {
  const player = new Player(new THREE.Scene())
  onTestFinished(() => player.dispose())
  player.group.position.set(200, 0, 200)
  npc.armTownCivilian('gladius_rusty'); npc.setMissionCombatTarget(target); npc.setTacticalOrder('attack')
  const hits: number[] = []
  const step = () => {
    target.position.y = npc.combatPosition.y
    npc.group.updateMatrixWorld(true); target.group.updateMatrixWorld(true)
    npc.update(.05, player, [npc, target], [target], [], { setFill: () => {} },
      damage => hits.push(damage), () => {}, true)
  }
  return { step, hits }
}

function enemy(shieldId: string | null): NPC {
  const npc = new NPC(new THREE.Scene(), 0, 1.3, Faction.ENEMY, 'roman', AIType.MELEE, 'target', 2, false,
    { meleeWeaponId: 'steel_sword', shieldId, mountId: null }, 'roman_heavy_infantry')
  onTestFinished(() => npc.dispose())
  return npc
}

describe('Town Merchant native T4 equipment', () => {
  it.each(['roman', 'viking'] as const)('%s keeps both native weapons and T4 shield through peace, retaliation, explicit refit and temporary combat', faction => {
    const npc = merchant(faction)
    npc.takeDamage(13)
    const hp = npc.hp
    npc.armTownCivilian('gladius_rusty'); npc.disarmTownCivilian(); npc.setTownPeaceful(); npc.beginTownHostility()
    expect(npc.loadout).toEqual({ meleeWeaponId: 'paladin_sword_t4', secondaryMeleeWeaponId: 'paladin_mace_t4',
      rangedWeaponId: null, shieldId: 'paladin_shield_t4', mountId: null })
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(npc.hp).toBe(hp)
    expect(npc.maxHp).toBe(50)
    expect(npc.combatProfileId).toBeUndefined()
    expect(npc.shieldId).toBe('paladin_shield_t4')
    expect(npc.shield.shieldImpactMax).toBe(48)
    expect(npc.applyCareerEquipment({ meleeWeaponId: 'steel_sword' })).toBe(false)
    npc.applyTemporaryCombatLoadout({ meleeWeaponId: 'hunting_spear', shieldId: null })
    npc.restoreCombatLoadout(); npc.takeDamage(100); npc.restoreForTown(); npc.armTownCivilian('gladius_rusty')
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(npc.loadout?.secondaryMeleeWeaponId).toBe('paladin_mace_t4')
    expect(npc.shieldId).toBe('paladin_shield_t4')
  })

  it.each([
    { targetShield: null, weapon: 'paladin_sword_t4', action: 'swordSlash', damage: 60, impact: 1 },
    { targetShield: 'scutum_t2', weapon: 'paladin_mace_t4', action: 'axeAttack1H', damage: 55, impact: 12 },
  ] as const)('uses $weapon against target shield=$targetShield through native attacks without changing its own shield', ({ targetShield, weapon, action, damage, impact }) => {
    const npc = merchant('viking'), target = enemy(targetShield), combat = nativeCombat(npc, target)
    npc.shield.shieldImpactRemaining = 17
    let frames = 0
    while (npc.combatAnimationAction !== action && frames++ < 80) combat.step()
    expect(npc.combatAnimationAction).toBe(action)
    expect(frames).toBeLessThan(80)
    expect(npc.meleeWeaponId).toBe(weapon)
    expect(npc.meleeDamage).toBe(damage)
    expect(weaponShieldImpact(npc.meleeWeaponId!)).toBe(impact)
    expect(npc.shieldId).toBe('paladin_shield_t4')
    expect(npc.shield.shieldImpactRemaining).toBe(17)
    for (let i = 0; i < 80 && !combat.hits.length; i++) combat.step()
    expect(combat.hits[0], JSON.stringify({ position: npc.position, target: target.position,
      grip: npc.getWeaponGripPosition(new THREE.Vector3()), tip: npc.getWeaponTipPosition(), action: npc.combatAnimationAction })).toBe(damage)
  })

  it('returns to Sword after the target shield breaks and never rebuilds duplicate melee meshes', () => {
    const npc = merchant('roman'), target = enemy('scutum_t2'), combat = nativeCombat(npc, target)
    combat.step()
    expect(npc.meleeWeaponId).toBe('paladin_mace_t4')
    const equipment = npc as unknown as { swordGripPivot: THREE.Group }
    const meshCount = equipment.swordGripPivot.children.length
    target.shield.shieldImpactRemaining = 0
    for (let frame = 0; frame < 80 && npc.meleeWeaponId !== 'paladin_sword_t4'; frame++) combat.step()
    expect(npc.meleeWeaponId).toBe('paladin_sword_t4')
    expect(equipment.swordGripPivot.children).toHaveLength(meshCount)
    target.shield.reset()
    for (let frame = 0; frame < 80 && npc.meleeWeaponId !== 'paladin_mace_t4'; frame++) combat.step()
    expect(npc.meleeWeaponId).toBe('paladin_mace_t4')
    expect(equipment.swordGripPivot.children).toHaveLength(meshCount)
  })
})
