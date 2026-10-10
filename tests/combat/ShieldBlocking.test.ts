import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ShieldState, ShieldCollider, WeaponSweep, traceCombatSegment, weaponShieldImpact, type CombatContact } from '../../src/combat/ShieldBlocking'
import { damageNpc, damagePlayer } from '../../src/combat/DamageRouter'
import { Player } from '../../src/player/Player'
import { NPC, Faction, AIType } from '../../src/world/NPC'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { SkillManager, createDefaultSkillState, skillHpBonus } from '../../src/rpg/SkillManager'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { ArrowProjectile } from '../../src/world/ArrowProjectile'
import { MemoryStorage } from '../helpers/memoryStorage'
import { ARMORS } from '../../src/rpg/ArmorDatabase'

const shield = (tier = 1, kind = 'round_shield') => { const s = new ShieldState(); s.equip(`${kind}_t${tier}`); return s }
const context = (kind: 'shield' | 'body' = 'shield') => ({ source: { actorId: 'enemy', actorType: 'npc' as const, allegiance: Faction.ENEMY, characterFaction: 'viking' as const }, method: 'melee' as const, weaponId: 'viking_axe_t3', contact: { kind, time: .2 } })

describe('Shield impact and overflow', () => {
  it('T4 Mace breaks 48-impact T4 Shield on its fourth hit without scaling impact by hero damage', () => {
    expect(ARMORS.paladin_shield_t4).toMatchObject({ tier: 4, shieldImpactMax: 48 })
    const state = new ShieldState(); state.equip('paladin_shield_t4')
    const impact = weaponShieldImpact('paladin_mace_t4')
    expect(impact).toBe(12); expect(weaponShieldImpact('paladin_sword_t4')).toBe(1)
    for (const remaining of [36, 24, 12, 0]) {
      expect(state.absorb(110, impact).damage).toBe(0)
      expect(state.shieldImpactRemaining).toBe(remaining)
      expect(state.shieldBroken).toBe(remaining === 0)
    }
  })
  it('T4 Mace overflows exactly 7/12 of body damage when five impact remains', () => {
    const state = new ShieldState(); state.equip('paladin_shield_t4'); state.shieldImpactRemaining = 5
    expect(state.absorb(110, weaponShieldImpact('paladin_mace_t4')).damage).toBeCloseTo(110 * 7 / 12)
  })
  it('breaks T1 after exactly five fully blocked ordinary hits', () => {
    const s = shield(); for (let i = 0; i < 5; i++) expect(s.absorb(80, 1).damage).toBe(0)
    expect(s.shieldBroken).toBe(true); expect(s.absorb(80, 1, 50)).toEqual({ damage: 80, blockedImpact: 0 })
  })
  it('uses 5/10/20 and deterministic 2/4/8 axe impact', () => {
    for (const [tier, max, impact] of [[1, 5, 2], [2, 10, 4], [3, 20, 8]]) {
      expect(shield(tier).shieldImpactMax).toBe(max)
      expect(weaponShieldImpact(`viking_axe_t${tier}`)).toBe(impact)
    }
    expect(weaponShieldImpact('steel_sword')).toBe(1)
    expect(weaponShieldImpact('heavy_lance')).toBe(1)
    expect(weaponShieldImpact()).toBe(1)
  })
  it('T2 axe twice leaves 2; third axe causes half damage', () => {
    const s = shield(2); s.absorb(80, 4); s.absorb(80, 4)
    expect(s.shieldImpactRemaining).toBe(2); expect(s.absorb(80, 4).damage).toBe(40)
  })
  it.each([[1, 0, 70], [4, 0, 40], [8, 0, 0], [1, 50, 35], [4, 20, 32], [4, 50, 20]])('remaining %s level %s produces %s damage', (remaining, level, expected) => {
    const s = shield(3); s.shieldImpactRemaining = remaining
    expect(s.absorb(80, 8, level).damage).toBe(expected); expect(s.shieldBroken).toBe(true)
  })
  it('does not repair on equipment toggle, only explicit battle/respawn reset', () => {
    const s = shield(); s.absorb(10, 3); s.equip(null); s.equip('round_shield_t1')
    expect(s.shieldImpactRemaining).toBe(2); s.reset(); expect(s.shieldImpactRemaining).toBe(5)
  })
})

function geometry() {
  const state = shield(1, 'scutum'), group = new THREE.Group(), pivot = new THREE.Group()
  group.add(pivot); pivot.position.set(0, 1.3, .65)
  const collider = new ShieldCollider(pivot, state); collider.setModel('scutum_t1')
  return { group, pivot, shield: state, shieldCollider: collider, isMounted: false, combatPosition: group.position }
}
describe('Physical first contact', () => {
  it('Paladin face follows rotation, excludes grip air and tapered corners, and disappears when broken', () => {
    const state = new ShieldState(); state.equip('paladin_shield_t4')
    const pivot = new THREE.Group(); pivot.position.set(2, 1, 3); pivot.rotation.y = .8; pivot.updateMatrixWorld(true)
    const collider = new ShieldCollider(pivot, state); collider.setModel('paladin_shield_t4')
    const point = (x: number, y: number, z: number) => pivot.localToWorld(new THREE.Vector3(x, y, z))
    expect(collider.time(point(0, 0, 1), point(0, 0, -.1))).toBeLessThan(1)
    expect(collider.time(point(-.2, 0, .085), point(.2, 0, .085))).toBe(Infinity)
    expect(collider.time(point(.3, -.45, 1), point(.3, -.45, -1))).toBe(Infinity)
    expect(state.shieldImpactRemaining).toBe(48)
    state.absorb(110, 48); collider.refreshVisibility()
    expect(pivot.visible).toBe(false)
    expect(collider.time(point(0, 0, 1), point(0, 0, -1))).toBe(Infinity)
  })
  it('shield wins in front, body wins behind, legs and side bypass', () => {
    const target = geometry(), out: CombatContact = { kind: 'body', time: 0 }
    expect(traceCombatSegment(target, new THREE.Vector3(0, 1.3, 2), new THREE.Vector3(0, 1.3, -2), out)).toBe(true)
    expect(out.kind).toBe('shield')
    traceCombatSegment(target, new THREE.Vector3(0, 1.3, -2), new THREE.Vector3(0, 1.3, 2), out); expect(out.kind).toBe('body')
    traceCombatSegment(target, new THREE.Vector3(0, .2, 2), new THREE.Vector3(0, .2, -2), out); expect(out.kind).toBe('body')
    traceCombatSegment(target, new THREE.Vector3(2, 1, 0), new THREE.Vector3(-2, 1, 0), out); expect(out.kind).toBe('body')
    target.shield.absorb(80, target.shield.shieldImpactMax)
    traceCombatSegment(target, new THREE.Vector3(0, 1.3, 2), new THREE.Vector3(0, 1.3, -2), out); expect(out.kind).toBe('body')
  })
  it('follows actual parent transform, including lowered shields', () => {
    const target = geometry(), out: CombatContact = { kind: 'body', time: 0 }
    target.pivot.position.x = 1
    traceCombatSegment(target, new THREE.Vector3(0, 1.3, 2), new THREE.Vector3(0, 1.3, -2), out); expect(out.kind).toBe('body')
    traceCombatSegment(target, new THREE.Vector3(1, 1.3, 2), new THREE.Vector3(1, 1.3, -2), out); expect(out.kind).toBe('shield')
    target.group.rotation.y = Math.PI
    traceCombatSegment(target, new THREE.Vector3(-1, 1.3, -2), new THREE.Vector3(-1, 1.3, 2), out); expect(out.kind).toBe('shield')
  })
  it('sweeps a blade through shield then body without double damage', () => {
    const target = geometry(), sweep = new WeaponSweep()
    sweep.capture(new THREE.Vector3(-.2, 1.3, 2), new THREE.Vector3(.2, 1.3, 2))
    sweep.capture(new THREE.Vector3(-.2, 1.3, -1), new THREE.Vector3(.2, 1.3, -1))
    expect(sweep.trace(target)?.kind).toBe('shield')
  })
})

describe('Routing, progression and controls', () => {
  it('only overflow receives Blocking reduction; ordinary body and mount impact stay full damage', () => {
    const p = new Player(new THREE.Scene()); p.rebuildShield('scutum_t3'); p.blockingLevel = 50
    const hp = { setFill: vi.fn() } as any, award = vi.fn(); p.onShieldBlock = award
    p.shield.shieldImpactRemaining = 1
    const first = damagePlayer(p, 80, hp, 'scutum_t3', context())
    expect(first.appliedDamage).toBe(35); expect(award).toHaveBeenCalledExactlyOnceWith(1)
    expect(damagePlayer(p, 30, hp, 'scutum_t3', context('body')).appliedDamage).toBe(30)
    expect(damagePlayer(p, 20, hp, 'scutum_t3', { ...context(), method: 'mount-impact' }).appliedDamage).toBe(20)
    expect(award).toHaveBeenCalledTimes(1)
  })
  it('fully absorbed hits do not emit body damage and friends/self cannot generate XP', () => {
    const p = new Player(new THREE.Scene()); p.rebuildShield('scutum_t3')
    const emit = vi.fn(), award = vi.fn(); p.onShieldBlock = award
    const hit = { ...context(), weaponId: 'steel_sword', emit }
    expect(damagePlayer(p, 80, { setFill() {} } as any, 'scutum_t3', hit).appliedDamage).toBe(0)
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'hit_blocked', blockedImpact: 1, target: expect.objectContaining({ targetId: 'player' }) })); expect(award).toHaveBeenCalledExactlyOnceWith(1)
    damagePlayer(p, 80, {} as any, 'scutum_t3', { ...hit, hostileToTarget: false })
    damagePlayer(p, 80, {} as any, 'scutum_t3', { ...hit, source: { ...hit.source, actorId: 'player', actorType: 'player' } })
    expect(award).toHaveBeenCalledTimes(1)
  })
  it('NPC blocks, breaks, then takes full body damage; Defense only raises usable shields', () => {
    const n = new NPC(new THREE.Scene(), 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'guard', 1, false)
    n.setTacticalOrder('defend'); expect(n.shield.shieldRaised).toBe(true)
    n.setTacticalOrder('follow'); expect(n.shield.shieldRaised).toBe(false)
    expect(damageNpc(n, 80, { ...context(), weaponId: 'steel_sword' }).appliedDamage).toBe(0)
    n.shield.shieldImpactRemaining = 0
    expect(damageNpc(n, 20, context('body')).appliedDamage).toBe(20)
    n.shieldId = null; n.rebuildShield(); n.setTacticalOrder('defend'); expect(n.shield.shieldRaised).toBe(false)
  })
  it('RMB is hold, allows movement and attack, release lowers; broken shield stays broken', () => {
    const p = new Player(new THREE.Scene()), inventory = new InventoryManager()
    inventory.equipWeapon('round_shield_t2')
    const ui = { setAiming() {}, setChargeRatio() {}, setShieldBlocked() {} }
    const input = { keys: { Space: false, KeyW: true }, isRightMouseDown: true, isLeftMouseDown: false, consumeLeftClick: () => true, consumeLeftClickRelease: () => false }
    const update = () => p.update(.016, input as any, 0, new THREE.Vector3(0, 1, 10), [], { setFill() {} } as any, ui as any, { playSwing() {} } as any, inventory)
    const z = p.position.z; update(); expect(p.shield.shieldRaised).toBe(true); expect(p.position.z).not.toBe(z)
    expect((p as any).animator.busy).toBe(true)
    input.isRightMouseDown = false; update(); expect(p.shield.shieldRaised).toBe(false)
  })
  it('reuses XP curve, caps at 50, saves/reloads and adds exactly +50 HP', () => {
    const skills = new SkillManager(); skills.addXp('blocking', 100); expect(skills.skillState.blocking.level).toBe(2)
    skills.addXp('blocking', 1e9); expect(skills.skillState.blocking).toEqual({ level: 50, xp: 0 })
    const store = new CareerProfileStore(new MemoryStorage())
    const profile = createCareerProfile('roman'); profile.skills = skills.skillState
    expect(store.save(profile)).toBe(true); expect(store.load()!.skills!.blocking.level).toBe(50)
    expect(skillHpBonus(skills.skillState)).toBe(50); expect(createDefaultSkillState().blocking.level).toBe(1)
  })
  it.each(['arrow', 'pilum'] as const)('stops fast %s at shield without body damage', kind => {
    const scene = new THREE.Scene(), p = new Player(scene); p.position.set(0, 50, 0); p.rebuildShield('scutum_t3')
    // Test projectile + router with an explicit attached primitive at chest height.
    const pivot = new THREE.Group(); scene.add(pivot); pivot.position.set(0, 50, .65)
    p.shieldCollider = new ShieldCollider(pivot, p.shield); p.shieldCollider.setModel('scutum_t3')
    const arrow = new ArrowProjectile(scene, new THREE.Vector3(0, 50, 2), new THREE.Vector3(0, 0, -1), 100, 80, Faction.ENEMY, false, kind)
    const before = p.hp
    arrow.update(.04, p, [], [], () => {}, (damage, c) => damagePlayer(p, damage, { setFill() {} } as any, 'scutum_t3', c))
    expect(arrow.isAlive).toBe(false); expect(p.hp).toBe(before); expect(p.shield.shieldImpactRemaining).toBe(29)
  })
})
