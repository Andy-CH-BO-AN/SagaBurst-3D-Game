import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { getRangedCombatKind, getRangedDamageMultiplier } from '../../src/combat/CombatBalance'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { WeaponMeshFactory } from '../../src/world/WeaponMeshFactory'
import { Player } from '../../src/player/Player'
import type { CharacterBowVisual } from '../../src/world/CharacterBowVisual'
import type { CharacterRig } from '../../src/world/CharacterVisuals'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import type { ObstacleData } from '../../src/world/Terrain'

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
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_javelin_infantry.tierLoadouts[1])
    expect(equipment.bowPivot.parent).toBe(equipment.rig.right.handSocket)
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_spearman.tierLoadouts[3])
    expect(npc.isUsingLance).toBe(true)
    expect(npc.rangedDamage).toBe(0)
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_archer.tierLoadouts[1])
    expect(equipment.bowPivot.parent).toBe(equipment.rig.left.handSocket)
    npc.restoreCombatLoadout()

    expect(npc.loadout).toBe(canonical)
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

  it('retains the T4 Captain visual and combat profile when changing weapon type', () => {
    const npc = new NPC(new THREE.Scene(), 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Captain', 4,
      true, UNIT_PRESETS.roman_sword_cavalry.tierLoadouts[3], 'roman_sword_cavalry', undefined,
      'captain', undefined, 'roman-hero-t4', 'praetorian')
    const visual = npc.characterVisualGroup
    npc.applyTemporaryCombatLoadout(UNIT_PRESETS.roman_javelin_infantry.tierLoadouts[3])
    expect(npc.visualAssetId).toBe('roman-hero-t4')
    expect(npc.combatProfileId).toBe('praetorian')
    expect(npc.characterVisualGroup).toBe(visual)
    expect(npc.maxHp).toBe(500)
    expect(npc.rangedDamage).toBe(WEAPONS.legionary_pilum.damageMax * getRangedDamageMultiplier('javelin') * 2)
    npc.restoreForTown()
    expect(npc.meleeWeaponId).toBe('centurion_blade')
    expect(npc.shieldId).toBe('scutum_t3')
    expect(npc.rangedWeaponId).toBeUndefined()
    expect(npc.rangedDamage).toBe(0)
    npc.dispose()
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
