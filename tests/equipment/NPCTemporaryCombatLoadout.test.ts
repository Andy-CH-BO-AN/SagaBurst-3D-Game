import * as THREE from 'three'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { getRangedCombatKind, getRangedDamageMultiplier } from '../../src/combat/CombatBalance'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { preloadTinyRangerBow } from '../helpers/rangerBowVisual'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
import { Player } from '../../src/player/Player'
import type { CharacterBowVisual } from '../../src/world/CharacterBowVisual'
import type { CharacterRig } from '../../src/world/CharacterVisuals'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import type { ObstacleData } from '../../src/world/Terrain'
import { personalMemberLoadout } from '../../src/career/PersonalSquadRuntime'

// Asset parsing belongs to PaladinEquipmentAssets; runtime equipment uses a cheap render boundary.
vi.mock('../../src/world/PaladinEquipment', () => ({ createPaladinEquipment: () => new THREE.Group() }))

interface EquipmentFixture {
  arrows: number
  rangedActive: boolean
  townHostile: boolean
  bowArrowReleased: boolean
  attackTimer: number
  attackHitProcessed: boolean
  swordPivot: THREE.Group
  swordGripPivot: THREE.Group
  bowPivot: THREE.Group
  bowGripPivot: THREE.Group
  bowVisual?: CharacterBowVisual
  shieldPivot: THREE.Group
  rig: CharacterRig
  _findTarget(player: Player, npcs: NPC[]): { isPlayer: boolean; npc?: NPC } | null
  _activateDirectObstacle(obstacle: ObstacleData): boolean
}

function fixture(npc: NPC): EquipmentFixture { return npc as unknown as EquipmentFixture }

function soldier(presetId: UnitPresetId = 'roman_heavy_infantry', loadout?: UnitLoadout): NPC {
  return new NPC(new THREE.Scene(), 12, 7, Faction.TOWN, UNIT_PRESETS[presetId].faction, AIType.MELEE,
    'Town soldier', 3, false, loadout ?? UNIT_PRESETS[presetId].tierLoadouts[2], presetId)
}

const selections = Object.values(UNIT_PRESETS).flatMap(preset => [1, 2, 3].map(tier => ({
  id: preset.id, tier, loadout: preset.tierLoadouts[tier as 1 | 2 | 3],
})))

afterEach(() => vi.restoreAllMocks())

describe('NPC temporary combat loadout', () => {
  it.each(selections)('synchronizes $id T$tier equipment independently of the original actor tier', ({ id, tier, loadout }) => {
    const npc = soldier(id), equipment = fixture(npc)
    const canonical = npc.loadout, before = { ...canonical }
    const pilumVisual = vi.spyOn(WeaponMeshFactory, 'buildNpcRanged')
    npc.meleeDamage = 999
    npc.pendingLanceChargeSpeed = 20
    equipment.bowArrowReleased = true
    equipment.attackTimer = 10
    equipment.attackHitProcessed = true
    npc.applyTemporaryCombatLoadout(loadout)

    const melee = WEAPONS[loadout.meleeWeaponId!]
    const ranged = loadout.rangedWeaponId ? WEAPONS[loadout.rangedWeaponId] : undefined
    const kind = getRangedCombatKind(ranged)
    expect(npc.loadout).toBe(canonical)
    expect(npc.loadout).toEqual(before)
    expect(npc.meleeWeaponId).toBe(loadout.meleeWeaponId)
    expect(npc.meleeDamage).toBe(melee.damageMax)
    expect(npc.meleeAttackRadius).toBe(melee.range)
    expect(npc.isUsingLance).toBe(melee.combatKind === 'lance')
    expect(npc.rangedWeaponId).toBe(loadout.rangedWeaponId ?? undefined)
    expect(npc.rangedCombatKind).toBe(kind)
    expect(npc.rangedDamage).toBe(ranged ? ranged.damageMax * getRangedDamageMultiplier(kind) : 0)
    expect(npc.shieldId).toBe(loadout.shieldId ?? null)
    expect(equipment.shieldPivot.children.length > 0).toBe(Boolean(loadout.shieldId))
    expect(equipment.arrows).toBe(ranged ? 30 : 0)
    expect(equipment.rangedActive).toBe(Boolean(ranged))
    expect(npc.hasActiveRangedWeapon).toBe(Boolean(ranged))
    expect(equipment.bowPivot.visible).toBe(Boolean(ranged))
    expect(equipment.swordPivot.visible).toBe(!ranged)
    expect(npc.pendingLanceChargeSpeed).toBe(0)
    expect(equipment.bowArrowReleased).toBe(false)
    expect(equipment.attackTimer).toBe(0)
    expect(equipment.attackHitProcessed).toBe(false)
    if (kind === 'javelin') {
      expect(equipment.bowVisual).toBeUndefined()
      expect(equipment.bowPivot.parent).toBe(equipment.rig.right.handSocket)
      expect(pilumVisual).toHaveBeenLastCalledWith('roman', tier, equipment.bowGripPivot)
    } else if (kind === 'bow') {
      expect(equipment.bowVisual).toBeDefined()
      expect(equipment.bowPivot.parent).toBe(equipment.rig.left.handSocket)
      expect(equipment.bowGripPivot.children.length).toBeGreaterThan(0)
    } else {
      expect(equipment.bowVisual).toBeUndefined()
      expect(equipment.bowGripPivot.children).toHaveLength(0)
    }
    npc.dispose()
  })

  it('reparents and rebuilds bow, pilum and melee through repeated overrides, then restores the first equipment snapshot', () => {
    const npc = soldier('roman_archer'), equipment = fixture(npc)
    const canonical = npc.loadout
    npc.meleeDamage = 42
    equipment.arrows = 7
    equipment.rangedActive = false
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_javelin_infantry.tierLoadouts[1], 1, 2, 'roman_javelin_infantry')
    expect(npc.presetId).toBe('roman_javelin_infantry')
    expect(npc.tier).toBe(1)
    expect(npc.squadId).toBe(2)
    expect(equipment.bowPivot.parent).toBe(equipment.rig.right.handSocket)
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_spearman.tierLoadouts[3], 3, 3, 'roman_spearman')
    expect(npc.presetId).toBe('roman_spearman')
    expect(npc.isUsingLance).toBe(true)
    expect(npc.rangedDamage).toBe(0)
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_archer.tierLoadouts[1])
    expect(equipment.bowPivot.parent).toBe(equipment.rig.left.handSocket)
    npc.restoreCombatLoadout()

    expect(npc.loadout).toBe(canonical)
    expect(npc.presetId).toBe('roman_archer')
    expect(npc.tier).toBe(3)
    expect(npc.squadId).toBeUndefined()
    expect(npc.meleeWeaponId).toBe(canonical!.meleeWeaponId)
    expect(npc.meleeDamage).toBe(42)
    expect(npc.isUsingLance).toBe(false)
    expect(npc.rangedWeaponId).toBe('recurve_longbow')
    expect(npc.rangedDamage).toBe(WEAPONS.recurve_longbow.damageMax * getRangedDamageMultiplier('bow'))
    expect(equipment.arrows).toBe(7)
    expect(equipment.rangedActive).toBe(false)
    expect(npc.hasActiveRangedWeapon).toBe(false)
    expect(equipment.bowPivot.visible).toBe(false)
    expect(equipment.swordPivot.visible).toBe(true)
    npc.restoreCombatLoadout()
    expect(equipment.arrows).toBe(7)
    npc.dispose()
  })

  it('prevents the original Viking preset from overwriting the selected temporary loadout during movement commands', () => {
    const npc = soldier('viking_spearman')
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.viking_archer.tierLoadouts[1])
    for (const order of ['charge', 'defend', 'attack'] as const) {
      npc.setTacticalOrder(order)
      expect(npc.meleeWeaponId).toBe('rusty_dagger')
      expect(npc.rangedWeaponId).toBe('wooden_shortbow')
      expect(npc.hasActiveRangedWeapon).toBe(true)
    }
    npc.restoreForTown()
    npc.setTacticalOrder('charge')
    expect(npc.meleeWeaponId).toBe('steel_sword')
    npc.setTacticalOrder('defend')
    expect(npc.meleeWeaponId).toBe('steel_lance')
    npc.dispose()
  })

  it('restores saved ammo and its exhausted melee state without refilling the temporary loadout', () => {
    const npc = soldier(), equipment = fixture(npc), canonical = npc.loadout
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_archer.tierLoadouts[1])
    npc.restoreCombatAmmo(4.9)
    expect(npc.combatAmmo).toBe(4)
    expect(npc.hasActiveRangedWeapon).toBe(true)
    expect(equipment.bowPivot.visible).toBe(true)
    npc.restoreCombatAmmo(0)
    expect(npc.combatAmmo).toBe(0)
    expect(npc.hasActiveRangedWeapon).toBe(false)
    expect(equipment.rangedActive).toBe(false)
    expect(equipment.bowPivot.visible).toBe(false)
    expect(equipment.swordPivot.visible).toBe(true)
    expect(npc.rangedWeaponId).toBe('wooden_shortbow')
    expect(npc.loadout).toBe(canonical)
    for (const invalid of [-1, NaN, Infinity]) {
      npc.restoreCombatAmmo(invalid)
      expect(npc.combatAmmo).toBe(0)
    }
    npc.restoreForTown()
    expect(npc.rangedWeaponId).toBeUndefined()
    expect(npc.combatAmmo).toBe(0)
    npc.dispose()
  })

  it.each([
    ['roman', 'paladin_sword_t4', 60, 'roman-hero-t4', 'praetorian'],
    ['viking', 'paladin_mace_t4', 55, 'viking-hero-t4', 'varangian'],
  ] as const)('%s HR Captain consumes custom %s and restores it after temporary mission equipment', (faction, weapon, damage, visualAssetId, combatProfileId) => {
    // One real NPC, no Mount or world: this owner verifies runtime equipment, not deployment policy.
    const spec = personalMemberLoadout({ id: 'personal:captain', type: 'captain',
      equipment: { melee: weapon, ranged: null, shield: 'paladin_shield_t4', mount: 'horse' } }, faction)
    const npc = new NPC(new THREE.Scene(), 0, 0, Faction.PLAYER, faction, AIType.MELEE, 'Captain', spec.tier,
      spec.mounted, spec.loadout, spec.presetId, undefined, 'personal:captain', undefined,
      spec.hero?.visualAssetId, spec.hero?.combatProfileId)
    onTestFinished(() => npc.dispose())
    expect(npc.meleeWeaponId).toBe(weapon)
    expect(npc.meleeDamage).toBe(damage)
    expect(npc.shield.shieldImpactMax).toBe(48)
    const visual = npc.characterVisualGroup
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_javelin_infantry.tierLoadouts[3])
    expect(npc.visualAssetId).toBe(visualAssetId)
    expect(npc.combatProfileId).toBe(combatProfileId)
    expect(npc.characterVisualGroup).toBe(visual)
    expect(npc.maxHp).toBe(500)
    expect(npc.rangedDamage).toBe(WEAPONS.legionary_pilum.damageMax * getRangedDamageMultiplier('javelin') * 2)
    npc.restoreForTown()
    expect(npc.meleeWeaponId).toBe(weapon)
    expect(npc.meleeDamage).toBe(damage)
    expect(npc.shieldId).toBe('paladin_shield_t4')
    expect(npc.shield.shieldImpactRemaining).toBe(48)
    expect(npc.rangedWeaponId).toBeUndefined()
    expect(npc.rangedDamage).toBe(0)
  })

  it('restores dead Town opponents with original ranged equipment, full health and ammo, and clears temporary hostility', () => {
    const npc = soldier('roman_archer'), equipment = fixture(npc)
    npc.setTownPeaceful()
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_spearman.tierLoadouts[1])
    npc.setDuelHostility(true)
    npc.takeDamage(9999)
    expect(npc.dead).toBe(true)
    npc.restoreForTown()
    expect(npc.dead).toBe(false)
    expect(npc.hp).toBe(npc.maxHp)
    expect(npc.rangedWeaponId).toBe('recurve_longbow')
    expect(npc.rangedDamage).toBe(WEAPONS.recurve_longbow.damageMax * getRangedDamageMultiplier('bow'))
    expect(npc.meleeWeaponId).toBe('gladius_rusty')
    expect(npc.isUsingLance).toBe(false)
    expect(npc.shieldId).toBeNull()
    expect(equipment.arrows).toBe(30)
    expect(equipment.rangedActive).toBe(true)
    expect(equipment.bowPivot.visible).toBe(true)
    expect(npc.hostileToPlayer).toBe(false)
    expect(equipment.townHostile).toBe(false)
    expect(npc.respawnEnabled).toBe(false)
    expect(npc.currentState).toBe(AIState.IDLE)
    expect(npc.position.x).toBe(12)
    expect(npc.position.z).toBe(7)
    npc.dispose()
  })

  it('allows a closer faction enemy during Duel and clears Player hostility without changing Town hostility', () => {
    const npc = soldier(), equipment = fixture(npc), scene = new THREE.Scene(), player = new Player(scene)
    const otherEnemy = new NPC(scene, 12, 7, Faction.ENEMY, 'viking', AIType.MELEE, 'Unrelated enemy', 1, false)
    player.setPosition(40, 0, 40)
    npc.setTownPeaceful()
    npc.setDuelHostility(true)
    expect(npc.hostileToPlayer).toBe(true)
    expect(equipment.townHostile).toBe(false)
    expect(equipment._findTarget(player, [otherEnemy])?.npc).toBe(otherEnemy)
    otherEnemy.group.position.set(200, 0, 200)
    expect(equipment._findTarget(player, [otherEnemy])?.isPlayer).toBe(true)
    Object.defineProperty(player, 'dead', { value: true })
    expect(equipment._findTarget(player, [otherEnemy])?.npc).toBe(otherEnemy)
    otherEnemy.takeDamage(1000)
    expect(equipment._findTarget(player, [otherEnemy])).toBeNull()
    npc.setDuelHostility(false)
    expect(npc.hostileToPlayer).toBe(false)
    expect(equipment.townHostile).toBe(false)
    expect(npc.currentState).toBe(AIState.IDLE)
    npc.dispose(); otherEnemy.dispose()
  })

  it('cannot turn a blocking Town building into a siege target while dueling Player', () => {
    const npc = soldier(), equipment = fixture(npc)
    const damageable = new DamageableObstacle({ kind: 'tent', maxHp: 100, root: new THREE.Group() })
    const obstacle: ObstacleData = {
      box: new THREE.Box3(new THREE.Vector3(10, 0, 8), new THREE.Vector3(14, 5, 12)),
      isBarricade: false, damageable,
    }
    npc.setDuelHostility(true)
    expect(equipment._activateDirectObstacle(obstacle)).toBe(false)
    expect(damageable.hpRatio).toBe(1)
    npc.setDuelHostility(false)
    expect(equipment._activateDirectObstacle(obstacle)).toBe(true)
    npc.dispose()
  })
})

it('NPC equips the T4 bow body on initial load and refresh while preserving ordinary identity and restoring its original bow', async () => {
  const asset = await preloadTinyRangerBow()
  onTestFinished(() => asset.dispose())
  const npc = soldier('roman_archer', { meleeWeaponId: 'gladius_standard', rangedWeaponId: 'maki-ranger-bow-ranged', shieldId: null })
  onTestFinished(() => npc.dispose())
  const visual = fixture(npc)
  expect(asset.containsBody(visual.bowGripPivot)).toBe(true)
  for (const id of ['elven_runebow', 'pilum_standard', 'maki-ranger-bow-ranged']) {
    npc.applyTemporaryCombatLoadout({ meleeWeaponId: 'gladius_standard', rangedWeaponId: id, shieldId: null })
    expect(asset.containsBody(visual.bowGripPivot), id).toBe(id === 'maki-ranger-bow-ranged')
    expect(visual.bowPivot.parent).toBe(id === 'pilum_standard' ? visual.rig.right.handSocket : visual.rig.left.handSocket)
    expect(npc.specialCombatProfile).toBeUndefined()
    expect(npc.visualAssetId).toBeUndefined()
  }
  npc.restoreCombatLoadout()
  expect(npc.rangedWeaponId).toBe('maki-ranger-bow-ranged')
  expect(asset.containsBody(visual.bowGripPivot)).toBe(true)
})
