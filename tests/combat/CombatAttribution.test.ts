import { TownScene } from '../../src/town/TownScene'
import { createCareerProfile, claimCareerMission } from '../../src/career/CareerProfile'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import type { HeroCombatProfileId } from '../../src/battle/HeroCombatProfile'
import { TownEquipment } from '../../src/town/TownEquipment'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CombatEventStream, type CombatDamageContext, type CombatEventSink } from '../../src/combat/CombatAttribution'
import { damageNpc, damageObstacle, damagePlayer, damageMount } from '../../src/combat/DamageRouter'
import { ShieldCollider, ShieldState } from '../../src/combat/ShieldBlocking'
import { Player } from '../../src/player/Player'
import { Game } from '../../src/Game'
import { punchEventsBetween, traceFistStrike } from '../../src/combat/UnarmedCombat'
import { SkillManager } from '../../src/rpg/SkillManager'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import { AIState, Faction, NPC } from '../../src/world/NPC'
import { MountArmor } from '../../src/combat/MountArmor'
import type { Mount } from '../../src/world/Mount'
import { MountType } from '../../src/world/Mount'
import { createCombatEventRecorder } from '../helpers/combatEventRecorder'
import { registerTownCombatDisplayName } from '../../src/ui/CombatTargetDisplayName'

function eventHarness() { return createCombatEventRecorder(onTestFinished) }

function mockNpc(options: {
  id?: string
  hp?: number
  maxHp?: number
  shieldId?: string | null
  faction?: Faction
  characterFaction?: 'viking' | 'roman'
  presetId?: string
  tier?: number
  mount?: Pick<NonNullable<NPC['mount']>, 'type' | 'dead'>
  squadId?: number
  position?: THREE.Vector3
  shield?: ShieldState
} = {}): NPC {
  let hp = options.hp ?? options.maxHp ?? 200
  const maxHp = options.maxHp ?? hp
  let dead = false
  let mount = options.mount ?? null

  return {
    combatantId: options.id ?? 'npc-target',
    name: options.id ?? 'NPC Target',
    faction: options.faction ?? Faction.ENEMY,
    characterFaction: options.characterFaction ?? 'roman',
    presetId: options.presetId ?? 'roman_heavy_infantry',
    // Combat display labels derive their rank from the canonical characterTier.
    characterTier: options.tier,
    tier: options.tier,
    generatedAsCavalry: false,
    squadId: options.squadId,
    shieldId: options.shieldId ?? null,
    shield: options.shield,
    maxHp,
    combatPosition: options.position ?? new THREE.Vector3(0.5, 0, 0),
    group: { position: options.position ?? new THREE.Vector3(0.5, 0, 0) },
    get hp() { return hp },
    get hpRatio() { return maxHp > 0 ? hp / maxHp : 0 },
    get dead() { return dead },
    get isMounted() { return mount !== null && !mount.dead },
    get mount() { return mount },
    set mount(value) { mount = value },
    takeDamage(amount: number) {
      if (dead) return false
      hp = Math.max(0, hp - amount)
      if (hp <= 0) { dead = true; mount = null }
      return true
    },
    dismountFromMount: vi.fn(() => { mount = null }),
  } as unknown as NPC
}

function mockPlayer(hp = 200): Player {
  let currentHp = hp
  let dead = false
  return {
    characterFaction: 'viking',
    spectatorOnly: false,
    isMounted: false,
    currentMount: null,
    targetable: true,
    position: new THREE.Vector3(),
    get hp() { return currentHp },
    get hpRatio() { return currentHp / hp },
    get dead() { return dead },
    takeDamage(amount: number) {
      if (dead) return false
      currentHp = Math.max(0, currentHp - amount)
      if (currentHp <= 0) dead = true
      return true
    },
    dismountFromMount: vi.fn(),
  } as unknown as Player
}

function sourceContext(
  stream: CombatEventStream,
  overrides: Partial<CombatDamageContext> = {},
): CombatDamageContext {
  return {
    source: {
      actorId: 'attacker',
      actorType: 'npc',
      allegiance: Faction.PLAYER,
      characterFaction: 'viking',
      presetId: 'viking_archer',
      squadId: 3,
    },
    method: 'melee',
    emit: stream.emit,
    ...overrides,
  }
}

/** Borrow the real contact entry and queue drain; every fixture is plain state/math, no actor constructors. */
function unarmedContactHarness(targetX: number, throughTime: number) {
  let hp = 100
  const position = new THREE.Vector3(targetX, 0, 1)
  const receiver = {
    group: { position }, combatPosition: position, isMounted: false,
    damageTarget: { targetId: 'punch-target', targetType: 'npc' as const, name: 'target' },
    receiveDamage(amount: number) { const before = hp; hp = Math.max(0, hp - amount); return before - hp },
  }
  const player = Object.assign(Object.create(Player.prototype), {
    group: { position: new THREE.Vector3(), matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} },
    isDead: false, spectatorOnly: false, visualFaction: 'roman', isMounted: false, currentMount: null,
    pendingFistStrikes: punchEventsBetween(0, throughTime, false).map(() => ({
      from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85),
    })),
  })
  const { stream, events } = eventHarness()
  const game = Object.assign(Object.create(Game.prototype) as { _checkPlayerMeleeHits(): void }, {
    player, controlMode: 'player', inventoryManager: { activeMelee: undefined },
    npcGrid: { getNearbyInto: () => [] }, combatMountGrid: { getNearbyInto: () => [] },
    trainingGround: { dummies: [receiver] }, obstacles: [], skillManager: new SkillManager(),
    soundManager: { playPunchHit() {} }, combatEvents: stream, damageNumbers: { spawn() {} }, _showEnemyHud() {},
  })
  return { game, hp: () => hp, events }
}

describe('Combat attribution foundation', () => {
  it('拳頭沒有接觸時正式玩家命中流程不扣血，也不發傷害事件', () => {
    const h = unarmedContactHarness(2, .2)
    h.game._checkPlayerMeleeHits()
    expect(h.hp()).toBe(100)
    expect(h.events).toEqual([])
  })
  it('大 dt 跨過四拳時四次各自扣血，下一個 frame 不得重複同一拳', () => {
    const h = unarmedContactHarness(0, 1.6)
    h.game._checkPlayerMeleeHits()
    expect(h.hp()).toBe(80)
    expect(h.events.filter(event => event.type === 'damage_applied')).toHaveLength(4)
    h.game._checkPlayerMeleeHits()
    expect(h.hp()).toBe(80)
    expect(h.events.filter(event => event.type === 'damage_applied')).toHaveLength(4)
  })
  it('拳頭接觸點剛好在零點八米時可命中', () => {
    const npc = mockNpc({ position: new THREE.Vector3(0, 0, 1.1) })
    const strike = { from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }
    expect(traceFistStrike(strike, new THREE.Vector3(), [npc], [])).toMatchObject({ kind: 'body', target: npc })
  })
  it('拳頭有幾何接觸但超過零點八米時不命中', () => {
    const npc = mockNpc({ position: new THREE.Vector3(0, 0, 1.101) })
    const strike = { from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }
    expect(traceFistStrike(strike, new THREE.Vector3(), [npc], [])).toBeUndefined()
  })
  it('拳頭被障礙物遮蔽時不會命中後方目標', () => {
    const npc = mockNpc({ position: new THREE.Vector3(0, 0, 1) })
    const strike = { from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }
    const obstacle = { box: new THREE.Box3(new THREE.Vector3(-.5, .5, .55), new THREE.Vector3(.5, 1.5, .6)), isBarricade: false }
    expect(traceFistStrike(strike, new THREE.Vector3(), [npc], [obstacle])).toBeUndefined()
  })
  it('拳頭先接觸盾面時沿用實體盾格擋，不讓身體接觸搶先扣血', () => {
    const shield = new ShieldState(); shield.equip('scutum_t1')
    const npc = mockNpc({ position: new THREE.Vector3(0, 0, 1), shield })
    const pivot: Pick<THREE.Object3D, 'matrixWorld' | 'updateWorldMatrix'> = {
      matrixWorld: new THREE.Matrix4().makeTranslation(0, 1, .5), updateWorldMatrix() {},
    }
    npc.shieldCollider = new ShieldCollider(pivot as THREE.Object3D, shield); npc.shieldCollider.setModel('scutum_t1')
    const contact = traceFistStrike({ from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }, new THREE.Vector3(), [npc], [])
    expect(contact?.kind).toBe('shield')
    const { stream, events } = eventHarness()
    const result = damageNpc(npc, 5, sourceContext(stream, { contact, weaponId: 'unarmed',
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' } }))
    expect(result.appliedDamage).toBe(0)
    expect(npc.hp).toBe(200)
    expect(events.filter(event => event.type === 'damage_applied')).toHaveLength(0)
  })
  it('restores nested event ownership without duplicate delivery after repeated releases', () => {
    const original = vi.fn<CombatEventSink>(), first = vi.fn<CombatEventSink>(), second = vi.fn<CombatEventSink>()
    const routing = { originalCombatEventSink: original, combatEventBindings: [], combatEventBindingsClosed: false }
    // Existing routing owner has no actor, model, animation or scene dependencies.
    const owner = routing as unknown as NPC
    const sink = () => Object.getOwnPropertyDescriptor(NPC.prototype, 'combatEventSink')!.get!.call(owner) as CombatEventSink
    const releaseFirst = NPC.prototype.bindCombatEventSink.call(owner, first)
    const releaseSecond = NPC.prototype.bindCombatEventSink.call(owner, second)
    expect(sink()).toBe(second)
    releaseFirst(); releaseFirst()
    expect(sink()).toBe(second)
    releaseSecond(); releaseSecond()
    expect(sink()).toBe(original)
    routing.combatEventBindingsClosed = true
    expect(() => NPC.prototype.bindCombatEventSink.call(owner, first)).toThrow('disposed NPC')
  })

  it('preserves the mounted rider display through lethal dismount and emits actual HP loss with one kill', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ hp: 3, maxHp: 200, presetId: 'roman_archer', tier: 3,
      mount: { type: MountType.XONGKORO, dead: false } })
    const context = sourceContext(stream)

    const result = damageNpc(npc, 80, context)

    expect(result.requestedDamage).toBe(80)
    expect(result.appliedDamage).toBe(3)
    expect(result.killed).toBe(true)
    expect(result.targetId).toBe('npc-target')
    expect(result.targetName).toBe('敵方巨鷹弓兵 · T3')
    expect(result.hpRatio).toBe(0)
    expect(npc.name).toBe('NPC Target')
    expect(npc.mount).toBeNull()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      requestedDamage: 80,
      appliedDamage: 3,
      target: { targetId: 'npc-target', name: 'NPC Target' },
    })
    expect(events[1]).toMatchObject({
      type: 'actor_killed',
      source: { actorId: 'attacker', squadId: 3 },
      target: { targetId: 'npc-target', name: 'NPC Target' },
    })

    const eventCount = events.length
    const second = damageNpc(npc, 80, context)
    expect(second.hitSuccess).toBe(false)
    expect(second.appliedDamage).toBe(0)
    expect(second.killed).toBe(false)
    expect(events).toHaveLength(eventCount)
  })

  it('does not reduce body damage just because a shield is equipped', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ id: 'guard-roman-melee-2', hp: 200, maxHp: 200, shieldId: 'round_shield_t1' })
    registerTownCombatDisplayName(npc, { id: 'guard-roman-melee-2', role: 'melee_infantry', unitKind: 'melee',
      duty: 'gate_guard', gateId: 'north', mounted: false, training: false, assaultObjective: true,
      tier: 2, index: 1, x: 0, z: 0 }, 'roman')

    const result = damageNpc(npc, 100, sourceContext(stream))

    expect(result.requestedDamage).toBe(100)
    expect(result.appliedDamage).toBe(100)
    expect(result.killed).toBe(false)
    expect(result.targetName).toBe('敵方北門劍兵 · T2')
    expect(result.targetId).toBe('guard-roman-melee-2')
    expect(result.hpRatio).toBe(0.5)
    expect(npc.name).toBe('guard-roman-melee-2')
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      requestedDamage: 100,
      appliedDamage: 100,
      target: { targetId: 'guard-roman-melee-2', name: 'guard-roman-melee-2' },
    })
  })

  it('attributes player death with actual damage and never double-counts it', () => {
    const { events, stream } = eventHarness()
    const player = mockPlayer(5)
    const hpBar = { setFill: vi.fn() }

    const result = damagePlayer(player, 25, hpBar, null, sourceContext(stream))

    expect(result.appliedDamage).toBe(5)
    expect(result.killed).toBe(true)
    expect(events.map(event => event.type)).toEqual(['damage_applied', 'actor_killed'])
    expect(events[1]).toMatchObject({ target: { targetId: 'player', targetType: 'player' } })

    damagePlayer(player, 25, hpBar, null, sourceContext(stream))
    expect(events).toHaveLength(2)
  })

  it('attributes mount damage to the rider target without turning mount death into an actor kill', () => {
    const { events, stream } = eventHarness()
    const npc = mockNpc({ id: 'mounted-target', hp: 200 })
    const mount = {
      currentHp: 5,
      maxHp: 100,
      dead: false,
      displayName: '戰馬', mountDisplayName: '戰馬坐騎',
      group: { uuid: 'mount-target' },
      takeDamage(amount: number) {
        if (this.dead) return false
        this.currentHp = Math.max(0, this.currentHp - amount)
        if (this.currentHp <= 0) this.dead = true
        return true
      },
    }
    npc.mount = mount as unknown as NonNullable<NPC['mount']>

    const result = damageNpc(npc, 50, sourceContext(stream, { contact: { kind: 'mount', time: .1 } }))

    expect(result.isMountHit).toBe(true)
    expect(result.targetName).toBe('戰馬')
    expect(result.hpRatio).toBe(0)
    expect(result.appliedDamage).toBe(5)
    expect(result.killed).toBe(true)
    expect(result.mountDied).toBe(true)
    expect(npc.dismountFromMount).toHaveBeenCalledOnce()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'damage_applied',
      target: {
        targetType: 'mount',
        ownerActorId: 'mounted-target',
      },
      appliedDamage: 5,
    })
  })

  it('routes weapon overflow to mount HP using Impact and leaves the rider shield independent', () => {
    const { stream } = eventHarness(), shield = new ShieldState()
    shield.equip('round_shield_t1')
    const npc = mockNpc({ shield }), armor = new MountArmor('ARMORED_HORSE')
    const mount = {
      armor, currentHp: 600, maxHp: 600, dead: false, disposed: false,
      displayName: '重甲戰馬', group: { uuid: 'armored-target' },
      takeDamage(this: { currentHp: number; dead: boolean }, amount: number) { this.currentHp = Math.max(0, this.currentHp - amount); this.dead = this.currentHp === 0; return true },
    } as unknown as Mount
    npc.mount = mount
    const context = sourceContext(stream, { weaponId: 'heavy_lance', source: {
      actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'viking', isMounted: true,
    }, contact: { kind: 'mount', mount, time: 0 } })
    expect(damageNpc(npc, 80, context)).toMatchObject({ appliedDamage: 0, blockedImpact: 40, isMountHit: true })
    expect(armor.remaining).toBe(10)
    expect(damageNpc(npc, 80, context)).toMatchObject({ appliedDamage: 60, blockedImpact: 10 })
    expect(armor.remaining).toBe(0)
    expect(damageMount(mount, 80, context)).toMatchObject({ appliedDamage: 80, blockedImpact: 0 })
    expect(npc.hp).toBe(200)
    expect(shield.shieldImpactRemaining).toBe(shield.shieldImpactMax)
  })

  it('protects the player mount from NPC projectiles without protecting a rider body hit', () => {
    const { stream } = eventHarness(), player = mockPlayer(), armor = new MountArmor('SNOW_LEOPARD')
    const mount = { armor, currentHp: 500, maxHp: 500, dead: false,
      displayName: '重甲雪豹', group: { uuid: 'leopard-target' },
      takeDamage(this: { currentHp: number; dead: boolean }, amount: number) { this.currentHp -= amount; return true },
    } as unknown as Mount
    player.currentMount = mount
    const context = sourceContext(stream, { method: 'projectile', weaponId: 'bow_t5', contact: { kind: 'mount', mount, time: 0 } })
    expect(damagePlayer(player, 90, { setFill: vi.fn() }, null, context)).toMatchObject({ appliedDamage: 0, blockedImpact: 1, isMountHit: true })
    expect(armor.remaining).toBe(49)
    expect(damagePlayer(player, 90, { setFill: vi.fn() }, null, { ...context, contact: { kind: 'body', time: 0 } })).toMatchObject({ appliedDamage: 90, blockedImpact: 0, isMountHit: false })
    expect(armor.remaining).toBe(49)
    expect(mount.currentHp).toBe(500)
  })

  it('emits structure damage and destruction exactly once using applied damage', () => {
    const { events, stream } = eventHarness()
    const gate = new DamageableObstacle({
      kind: 'gate',
      maxHp: 5,
      root: { uuid: 'gate', parent: null, visible: true, removeFromParent: vi.fn() } as unknown as THREE.Object3D,
      ownerFaction: 'roman',
    })
    const context = sourceContext(stream, { method: 'siege' })

    const first = damageObstacle(gate, 50, context)

    expect(first.appliedDamage).toBe(5)
    expect(first.destroyed).toBe(true)
    expect(events.map(event => event.type)).toEqual([
      'structure_damaged',
      'structure_destroyed',
    ])
    expect(events[0]).toMatchObject({
      requestedDamage: 50,
      appliedDamage: 5,
      target: { structureKind: 'gate' },
    })

    damageObstacle(gate, 50, context)
    expect(events).toHaveLength(2)
  })
  it('excludes a peaceful hidden shield from both direct and prepared collision queries without consuming it', () => {
    let armed = false, updates = 0
    const shield = new ShieldState(() => armed); shield.equip('round_shield_t1')
    const pivot: Pick<THREE.Object3D, 'visible' | 'matrixWorld' | 'updateWorldMatrix'> = { visible: false, matrixWorld: new THREE.Matrix4(), updateWorldMatrix() { updates++ } }
    const collider = new ShieldCollider(pivot as THREE.Object3D, shield, () => armed)
    collider.setModel('round_shield_t1')
    const from = new THREE.Vector3(0, 0, 1), to = new THREE.Vector3(0, 0, -1)
    const remaining = shield.shieldImpactRemaining
    expect(shield.active).toBe(false)
    expect(shield.absorb(50, 2)).toEqual({ damage: 50, blockedImpact: 0 })
    expect(collider.time(from, to)).toBe(Infinity)
    collider.prepare(); expect(collider.preparedTime(from, to)).toBe(Infinity)
    expect(updates).toBe(0)
    armed = true; collider.refreshVisibility()
    expect(pivot.visible).toBe(true)
    expect(shield.active).toBe(true)
    expect(collider.time(from, to)).toBeCloseTo(.36)
    armed = false; collider.refreshVisibility()
    expect(collider.preparedTime(from, to)).toBe(Infinity)
    expect(pivot.visible).toBe(false)
    expect(shield.shieldImpactRemaining).toBe(remaining)
  })

  it('routes T5 shield impact and seventh-axe break overflow only at an authoritative contact', () => {
    const { events, stream } = eventHarness(), shield = new ShieldState()
    shield.equip('commander_shield_t5')
    const npc = mockNpc({ hp: 200, shield }), initial = shield.shieldImpactRemaining
    // Only the visibility scalar is needed; no scene or collision geometry is created.
    const pivot: Pick<THREE.Object3D, 'visible'> = { visible: true }
    npc.shieldCollider = new ShieldCollider(pivot as THREE.Object3D, shield)
    const contact = sourceContext(stream, { weaponId: 'axe_t5', contact: { kind: 'shield', time: 0 } })
    expect(initial).toBe(96)
    for (let hit = 0; hit < 6; hit++) {
      expect(damageNpc(npc, 50, contact)).toMatchObject({ appliedDamage: 0, blockedImpact: 15 })
    }
    expect(shield.shieldImpactRemaining).toBe(6)
    expect(shield.active).toBe(true)
    expect(pivot.visible).toBe(true)
    expect(damageNpc(npc, 50, contact)).toMatchObject({ appliedDamage: 30, blockedImpact: 6 })
    expect(shield.shieldBroken).toBe(true)
    expect(pivot.visible).toBe(false)
    expect(events.filter(event => event.type === 'hit_blocked')).toHaveLength(7)
    expect(npc.hp).toBe(170)
    expect(damageNpc(npc, 50, contact)).toMatchObject({ appliedDamage: 50, blockedImpact: 0 })
    shield.reset(); npc.shieldCollider.refreshVisibility()
    expect(shield.shieldImpactRemaining).toBe(initial)
    expect(pivot.visible).toBe(true)
  })

  it('keeps the T5 shield collider inside its tapered face as the hand moves and rotates', () => {
    const shield = new ShieldState(); shield.equip('commander_shield_t5')
    const matrixWorld = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(3, 2, -4)
    const pivot: Pick<THREE.Object3D, 'visible' | 'matrixWorld' | 'updateWorldMatrix'> = {
      visible: true, matrixWorld, updateWorldMatrix() {},
    }
    const collider = new ShieldCollider(pivot as THREE.Object3D, shield)
    collider.setModel('commander_shield_t5')
    const time = (x: number, y: number, front = 1, back = -1) => collider.time(
      new THREE.Vector3(x, y, front).applyMatrix4(matrixWorld), new THREE.Vector3(x, y, back).applyMatrix4(matrixWorld))
    expect(time(0, 0)).toBeCloseTo((1 - .109) / 2)
    expect(time(.26, .3)).toBeLessThan(Infinity)
    // Outside a side edge, the lower point, and the narrow crown: no invisible wings.
    expect(time(.29, .3)).toBe(Infinity)
    expect(time(.10, -.5)).toBe(Infinity)
    expect(time(.10, .55)).toBe(Infinity)
    // A sweep wholly behind the face (through the handle) never blocks.
    expect(time(0, 0, -.061, -.15)).toBe(Infinity)
    matrixWorld.makeRotationX(.7).setPosition(-2, 1, 5)
    expect(time(0, 0)).toBeCloseTo((1 - .109) / 2)
    shield.absorb(100, 96); collider.refreshVisibility()
    expect(time(0, 0)).toBe(Infinity)
    expect(pivot.visible).toBe(false)
    shield.reset(); collider.refreshVisibility()
    expect(time(0, 0)).toBeLessThan(Infinity)
    expect(pivot.visible).toBe(true)
  })

})


/** Plain runtime ports; no actor constructor, model, scene, skeleton or mixer. */
interface TownFistEntry {
  melee(): void
  hitFieldNpc: (target: NPC, damage: number, method: 'melee') => void
  hitResident: (target: NPC, damage: number, method: 'melee') => void
  hitBattlefieldMount: (target: Mount, damage: number, method: 'melee') => void
  skills: SkillManager
  profile: ReturnType<typeof createCareerProfile>
}

it('Career melee → NPC 傷害 → CombatEvent → 單挑統計、軍功與徒手 XP，四拳各計一次且不套用舊長槍', () => {
  const target = mockNpc({ id: 'boxing-target', hp: 20, position: new THREE.Vector3(0, 0, 1) })
  Object.setPrototypeOf(target, NPC.prototype)
  Object.assign(target, { equipmentVisualLOD: { currentLevel: 0 }, retaliateAgainstPlayer() {} })
  const player = Object.assign(Object.create(Player.prototype), {
    group: { position: new THREE.Vector3(), matrixWorld: new THREE.Matrix4(), updateWorldMatrix() {} },
    isDead: false, spectatorOnly: false, visualFaction: 'roman', currentMount: null, isMounted: false,
    pendingFistStrikes: punchEventsBetween(0, 1.6, false).map(() => ({
      from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85),
    })),
  }) as Player
  const profile = createCareerProfile('roman')
  profile.ownedWeapons = ['steel_lance']
  profile.equipment = { melee: 'steel_lance' }
  profile.activeMission = createCareerDuelMission(profile, 'roman_archer', 1, 'boxing-target', 'captain', 'boxing-chain')!
  profile.activeMission.phase = 'ENGAGING'
  const inventory = new TownEquipment(() => profile, () => true)
  inventory.sheathAll()
  const { stream, events } = eventHarness()
  const tracker = new BattleStatsTracker(stream)
  onTestFinished(() => tracker.dispose())
  const town = Object.assign(Object.create(TownScene.prototype) as TownFistEntry, {
    profile, inventory, player, skills: new SkillManager(), residents: [], mounts: [], combatMounts: [],
    world: { obstacles: [] }, event: { hostile: false }, defense: { active: false },
    mission: { events: stream, isRetirementEvacuating: () => false }, runtimeCombatActors: () => [target],
    isProtectedTownAlly: () => false, squadRefitSafety: { note() {} },
    scheduleCareerSkillProgressionFlush() {}, damageNumbers: { spawn() {} }, showCombatTarget() {},
  })
  town.melee(); town.melee()
  expect(target.hp).toBe(0)
  const damages = events.filter(event => event.type === 'damage_applied')
  expect(damages).toHaveLength(4)
  expect(damages.every(event => event.requestedDamage === 5 && event.appliedDamage === 5
    && event.weaponId === 'unarmed' && event.attackSource === 'unarmed')).toBe(true)
  expect(events.filter(event => event.type === 'actor_killed')).toHaveLength(1)
  expect(town.skills.skillState.unarmed.xp).toBe(40)
  expect(town.skills.skillState.oneHanded.xp).toBe(0)
  expect(town.skills.skillState.twoHanded.xp).toBe(0)
  expect(town.skills.skillState.mountedImpact.xp).toBe(0)
  const snapshot = tracker.snapshot([], player)
  expect(snapshot.player).toMatchObject({ damageDealt: 20, kills: 1 })
  const claimed = claimCareerMission(town.profile, 'boxing-chain', 'victory', snapshot.player)
  expect(claimed.meritAwarded).toBe(9)
  expect(claimed.profile.totalMerit).toBe(9)
})

it.each(['resident', 'mount'] as const)('Career %s 的真實空手傷害只發一次徒手 XP', route => {
  const player = mockPlayer()
  const profile = createCareerProfile('roman')
  const town = Object.assign(Object.create(TownScene.prototype) as TownFistEntry, {
    profile, player, skills: new SkillManager(), inventory: { activeMelee: undefined },
    world: { obstacles: [] }, residents: [], mounts: [], event: { hostile: true },
    prepareDamage: () => true, isProtectedTownAlly: () => false, canHitTownMount: () => true,
    activateHostility() {}, persistCasualties() {}, showCombatTarget() {},
    scheduleCareerSkillProgressionFlush() {}, damageNumbers: { spawn() {} }, squadRefitSafety: { note() {} },
    mission: { events: new CombatEventStream() },
  })
  const contact = { kind: 'body' as const, time: .5, attackSource: 'unarmed' as const }
  if (route === 'resident') {
    const target = mockNpc()
    Object.setPrototypeOf(target, NPC.prototype)
    const entry = town as unknown as { hitResident(npc: NPC, amount: number, method: 'melee', c: typeof contact): void }
    entry.hitResident(target, 5, 'melee', contact)
    expect(target.hp).toBe(195)
  } else {
    let hp = 100
    const target = { group: { uuid: 'mount', position: new THREE.Vector3() }, displayName: 'horse', maxHp: 100,
      get currentHp() { return hp }, dead: false, currentLod: 0,
      takeDamage(amount: number) { hp -= amount; return true } } as unknown as Mount
    const entry = town as unknown as { hitBattlefieldMount(mount: Mount, amount: number, method: 'melee', source: undefined, c: typeof contact): void }
    entry.hitBattlefieldMount(target, 5, 'melee', undefined, contact)
    expect(hp).toBe(95)
  }
  expect(town.skills.skillState.unarmed.xp).toBe(10)
  expect(town.skills.skillState.oneHanded.xp).toBe(0)
})

it.each([
  [1, undefined, 100], [2, undefined, 100], [3, undefined, 100],
  [4, 'praetorian', 70], [5, 'roman-commander', 50],
] as const)('T%s Duel NPC 真的出拳且每拳固定 5，保留 Tier 承傷配置', (tier, profile, expectedIncoming) => {
  const strike = { from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }
  const hit = vi.fn()
  const player = { dead: false, targetable: true, isMounted: false,
    combatPosition: new THREE.Vector3(0, 0, 1), group: { position: new THREE.Vector3(0, 0, 1) } } as Player
  const animator = { busy: false, cancel: vi.fn(), start: vi.fn(), setLocomotion() {},
    update: () => ({ fists: [strike] }) }
  const body = Object.assign(Object.create(NPC.prototype), {
    duelUnarmed: true, duelHostile: true, combatProfileId: profile as HeroCombatProfileId | undefined,
    _tier: tier, currentHp: 200, _maxHp: 200, state: AIState.CHASE, _faction: Faction.TOWN,
    meleeWeaponId: null, loadout: {}, meleeAttackRadius: .8, mount: null,
    group: { position: new THREE.Vector3() }, rig: {}, pendingFall: { active: false }, mountedOrbitActive: true,
    animator, visualMovementSpeed: 0, _faceDirection() {}, _updateFootPhysics() {}, ...navigationStubs(),
  }) as NPC
  NPC.prototype.update.call(body, .2, player, [], [], [], { setFill() {} }, hit, () => false)
  expect(animator.start).toHaveBeenCalledExactlyOnceWith('punchCombo', 1)
  expect(hit).toHaveBeenCalledExactlyOnceWith(5, true)
  expect(body.meleeDamage).toBe(5)
  NPC.prototype.takeDamage.call(body, 100)
  expect(body.hp).toBe(200 - expectedIncoming)
  const guard = NPC.prototype as unknown as { _isTargetInMeleeRange(target: THREE.Vector3): boolean }
  expect(guard._isTargetInMeleeRange.call(body, player.combatPosition)).toBe(false) // Ordinary equipment guard is unchanged.
})

const navigationStubs = () => ({ _navigationPath: { clear() {} }, _tmpMoveDir: new THREE.Vector3(), _tmpNavigationTarget: new THREE.Vector3(),
  _movementObstacleRadius: () => .4, _movementObstacleHeight: () => 1.8, _clearObstacleDetour() {}, _clearNavigationPath() {} })

it('空手 Duel NPC 追近後才出拳，超過拳頭 0.8m 的實體軌跡不造成傷害', () => {
  const hit = vi.fn(), move = vi.fn()
  const player = { dead: false, targetable: true, isMounted: false,
    combatPosition: new THREE.Vector3(0, 0, 2), group: { position: new THREE.Vector3(0, 0, 2) } } as Player
  const animator = { busy: false, cancel() {}, start: vi.fn(), setLocomotion() {},
    update: () => ({ fists: [{ from: new THREE.Vector3(0, 1, .7), to: new THREE.Vector3(0, 1, 1.9) }] }) }
  const body = Object.assign(Object.create(NPC.prototype), {
    group: { position: new THREE.Vector3() }, animator, visualMovementSpeed: 0,
    _faceDirection() {}, _updateFootPhysics() {}, _moveByDirection: move, ...navigationStubs(),
  })
  const entry = NPC.prototype as unknown as { updateUnarmedDuel(dt: number, player: Player, obstacles: [], distance: number, callback: typeof hit): void }
  entry.updateUnarmedDuel.call(body, .2, player, [], 0, hit)
  expect(move).toHaveBeenCalledOnce()
  expect(animator.start).not.toHaveBeenCalled()
  expect(hit).not.toHaveBeenCalled()
})

it('空手 Duel NPC 追擊沿用既有導航：路徑被牆擋住時朝路徑點而非玩家移動，不使用隱形劍範圍', () => {
  const move = vi.fn()
  const player = { dead: false, targetable: true, isMounted: false,
    combatPosition: new THREE.Vector3(0, 0, 6), group: { position: new THREE.Vector3(0, 0, 6) } } as Player
  const animator = { busy: false, cancel() {}, start: vi.fn(), setLocomotion() {}, update: () => ({ fists: [] }) }
  const waypoint = new THREE.Vector3(5, 0, 0)
  const body = Object.assign(Object.create(NPC.prototype), {
    group: { position: new THREE.Vector3() }, animator, visualMovementSpeed: 0, meleeAttackRadius: .8,
    _faceDirection() {}, _updateFootPhysics() {}, _moveByDirection: move, ...navigationStubs(),
    _resolveNavigationMoveTarget(_target: THREE.Vector3) { this._tmpNavigationTarget.copy(waypoint); return 'path' },
  })
  const entry = NPC.prototype as unknown as { updateUnarmedDuel(dt: number, player: Player, obstacles: [], distance: number, callback: () => void): void }
  entry.updateUnarmedDuel.call(body, .2, player, [], 0, vi.fn())
  const [direction, , , , maxDistance] = move.mock.calls[0]
  expect(direction.x).toBeCloseTo(1)           // toward the A* waypoint around the wall
  expect(Math.abs(direction.z)).toBeLessThan(1e-6)
  expect(maxDistance).toBe(Infinity)            // no straight-line cap while following a route
  expect(animator.start).not.toHaveBeenCalled() // 6 m away: no punch, no sword reach
  // Unreachable: persistent detour is used, and with none active the NPC holds position.
  move.mockClear()
  Object.assign(body, { _resolveNavigationMoveTarget: () => 'unreachable', _detourActive: false, _applyPersistentObstacleDetour() {} })
  entry.updateUnarmedDuel.call(body, .2, player, [], 0, vi.fn())
  expect(move).not.toHaveBeenCalled()
})
