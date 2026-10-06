import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ShieldState, ShieldCollider, WeaponSweep, traceCombatSegment, weaponShieldImpact, type CombatContact } from '../src/combat/ShieldBlocking'
import { damageNpc, damagePlayer } from '../src/combat/DamageRouter'
import { Player } from '../src/player/Player'
import { NPC, Faction, AIType } from '../src/world/NPC'
import { InventoryManager } from '../src/rpg/InventoryManager'
import { SkillManager, createDefaultSkillState, skillHpBonus } from '../src/rpg/SkillManager'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { createCareerProfile } from '../src/career/CareerProfile'
import { ArrowProjectile } from '../src/world/ArrowProjectile'

const shield = (tier = 1, kind = 'round_shield') => { const s = new ShieldState(); s.equip(`${kind}_t${tier}`); return s }
const context = (kind: 'shield' | 'body' = 'shield') => ({ source: { actorId: 'enemy', actorType: 'npc' as const, allegiance: Faction.ENEMY, characterFaction: 'viking' as const }, method: 'melee' as const, weaponId: 'viking_axe_t3', contact: { kind, time: .2 } })

describe('Shield impact and overflow', () => {
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
  it('real NPC animation can hit a nearby player through the authoritative callback', () => {
    const scene = new THREE.Scene(), p = new Player(scene)
    const n = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'attacker', 1, false)
    p.position.set(0, n.group.position.y + .95, 1.25)
    const samples: unknown[] = []
    const original = n.weaponSweep.trace.bind(n.weaponSweep)
    vi.spyOn(n.weaponSweep, 'trace').mockImplementation(t => { const result = original(t); if (samples.length < 8) samples.push({ tip: n.getWeaponTipPosition().toArray(), grip: n.getWeaponGripPosition(new THREE.Vector3()).toArray(), player: p.position.toArray(), npc: n.group.position.toArray(), action: n.combatAnimationAction, result }); return result })
    const hit = vi.fn((amount: number, isPlayer: boolean) => {
      if (isPlayer) damagePlayer(p, amount, { setFill() {} } as any, null, { ...context(), weaponId: n.meleeWeaponId ?? undefined, contact: n.weaponSweep.contact })
    })
    for (let i = 0; i < 180 && !p.dead; i++) n.update(1 / 60, p, [], [], [], { setFill() {} } as any, hit, () => {}, true)
    if (!hit.mock.calls.length) console.log(JSON.stringify({ state: n.currentState, weapon: n.meleeWeaponId, samples }))
    expect(hit).toHaveBeenCalled(); expect(p.hp).toBeLessThan(p.maxHp)
    n.dispose(); p.dispose()
  })
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
    expect(emit).not.toHaveBeenCalled(); expect(award).toHaveBeenCalledExactlyOnceWith(1)
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
    const data = new Map<string, string>()
    const store = new CareerProfileStore({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, removeItem: k => { data.delete(k) } })
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
