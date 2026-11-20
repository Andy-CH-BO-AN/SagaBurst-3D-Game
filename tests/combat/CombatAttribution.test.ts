
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Game } from '../../src/Game'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { claimCareerMission, createCareerProfile } from '../../src/career/CareerProfile'
import { BattleStatsTracker } from '../../src/combat/BattleStatsTracker'
import { CombatEventSinkStack, CombatEventStream, type CombatDamageContext, type CombatEvent, type CombatEventSink } from '../../src/combat/CombatAttribution'
import { damageMount, damageNpc, damageObstacle, damagePlayer } from '../../src/combat/DamageRouter'
import { MountArmor } from '../../src/combat/MountArmor'
import { ShieldCollider, ShieldState, WeaponSweep } from '../../src/combat/ShieldBlocking'
import { punchEventsBetween, type FistStrike } from '../../src/combat/UnarmedCombat'
import { Player } from '../../src/player/Player'
import { SkillManager } from '../../src/rpg/SkillManager'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { TownEquipment } from '../../src/town/TownEquipment'
import { TownScene } from '../../src/town/TownScene'
import { registerTownCombatDisplayName } from '../../src/ui/CombatTargetDisplayName'
import { DamageableObstacle } from '../../src/world/DamageableObstacle'
import type { Mount } from '../../src/world/Mount'
import { MountType } from '../../src/world/Mount'
import { Faction, NPC } from '../../src/world/NPC'
import { createCombatEventRecorder } from '../helpers/combatEventRecorder'

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

/** The Player surface Game's melee caller reads. Fist sampling, its queue drain and weapon hit frames belong to
 * Player and their owners; here the queued jabs drain like the real queue and the hit frame is open. */
type MeleeCallerPlayer = Pick<Player, 'dead' | 'spectatorOnly' | 'isMounted' | 'currentMount' | 'position' | 'combatPosition'
  | 'characterFaction' | 'heroAssetId' | 'armorBreakLevel' | 'hasShield' | 'consumeFistStrikes' | 'isHitFrame'
  | 'isLanceThrustActive' | 'updatePrevLanceTip' | 'markHitProcessed' | 'weaponSweep'>

/** Four jabs from the origin toward +Z, reaching z = .85; queued as one large-dt frame would leave them. */
function meleeCallerPlayer(): MeleeCallerPlayer {
  const queued = punchEventsBetween(0, 1.6, false).map(() => ({ from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }))
  return {
    dead: false, spectatorOnly: false, isMounted: false, currentMount: null, position: new THREE.Vector3(),
    combatPosition: new THREE.Vector3(), characterFaction: 'roman', heroAssetId: null, armorBreakLevel: 1, hasShield: false,
    consumeFistStrikes: () => queued.splice(0), isHitFrame: () => true, isLanceThrustActive: true,
    updatePrevLanceTip() {}, markHitProcessed() {}, weaponSweep: new WeaponSweep(),
  }
}

/** The enemy HUD Game shows after its latest landed hit. */
function shownEnemyHud() {
  const hud: { shown?: { name: string; hpRatio: number } } = {}
  return { hud, _showEnemyHud: (name: string, hpRatio: number) => { hud.shown = { name, hpRatio } } }
}

/** A training dummy within fist reach; only the real Game caller decides whether the queued jabs land. */
function trainingDummyMeleeHarness() {
  let hp = 100
  const position = new THREE.Vector3(0, 0, 1)
  const receiver = {
    group: { position }, combatPosition: position, isMounted: false,
    damageTarget: { targetId: 'punch-target', targetType: 'npc' as const, name: 'target' },
    receiveDamage(amount: number) { const before = hp; hp = Math.max(0, hp - amount); return before - hp },
  }
  const { stream, events } = eventHarness()
  const game = Object.assign(Object.create(Game.prototype) as { _checkPlayerMeleeHits(): void }, {
    player: meleeCallerPlayer(), controlMode: 'player', inventoryManager: { activeMelee: undefined },
    npcGrid: { getNearbyInto: () => [] }, combatMountGrid: { getNearbyInto: () => [] },
    trainingGround: { dummies: [receiver] }, obstacles: [], skillManager: new SkillManager(),
    soundManager: { playPunchHit() {} }, combatEvents: stream, damageNumbers: { spawn() {} }, _showEnemyHud() {},
  })
  return { game, hp: () => hp, events }
}

/** Career field fight: an ally stands in the same strike lane in front of a bandit; only the real Game caller decides targets. */
function careerBanditMeleeHarness() {
  const ally = mockNpc({ id: 'field-ally', faction: Faction.PLAYER, hp: 200, position: new THREE.Vector3(0, 0, 1) })
  const bandit = mockNpc({ id: 'recruit-bandit-1', faction: Faction.BANDIT, hp: 40, position: new THREE.Vector3(0, 0, 1) })
  const player = meleeCallerPlayer()
  const inventoryManager: { activeMelee: (typeof WEAPONS)[string] | undefined } = { activeMelee: undefined }
  const { stream, events } = eventHarness()
  const { hud, _showEnemyHud } = shownEnemyHud()
  const game = Object.assign(Object.create(Game.prototype) as { _checkPlayerMeleeHits(): void }, {
    player, controlMode: 'player', inventoryManager, felineMissionId: 'recruit-bandits-01',
    careerProfile: { activeMission: { phase: 'ENGAGING' } },
    npcGrid: { getNearbyInto: () => [ally, bandit] }, combatMountGrid: { getNearbyInto: () => [] },
    obstacles: [], skillManager: new SkillManager(), combatEvents: stream, damageNumbers: { spawn() {} }, _showEnemyHud,
    soundManager: { playPunchHit() {}, playLanceImpact() {}, playSwordHit() {} },
  })
  return { game, player, inventoryManager, ally, bandit, events, hud }
}

describe('Combat attribution foundation', () => {
  it('keeps the real player melee damage caller locked during Commander Last Stand preparation', () => {
    const h = trainingDummyMeleeHarness()
    let phase: 'deployment' | 'assault' = 'deployment'
    Object.assign(h.game, {
      defenseCampaignConfig: { careerCommanderOutpost: {} },
      defenseCampaignRuntime: { getSnapshot: () => ({ activePhase: phase }) },
      commanderOutpostDeploymentBatch: { ready: true },
    })
    h.game._checkPlayerMeleeHits()
    expect(h.hp()).toBe(100)
    expect(h.events).toEqual([])
    phase = 'assault'
    h.game._checkPlayerMeleeHits()
    // Every jab crossed in one large frame lands separately.
    expect(h.hp()).toBe(80)
    expect(h.events.filter(event => event.type === 'damage_applied')).toHaveLength(4)
  })

  it('Career field unarmed and Hunting Spear melee damage and kill a bandit behind an unharmed ally', () => {
    const h = careerBanditMeleeHarness()
    h.game._checkPlayerMeleeHits()
    expect(h.bandit.hp).toBe(20)
    expect(h.ally.hp).toBe(200)
    expect(h.hud.shown).toEqual({ name: expect.any(String), hpRatio: .5 })

    h.inventoryManager.activeMelee = WEAPONS.hunting_spear
    h.player.weaponSweep.capture(new THREE.Vector3(0, 1, .2), new THREE.Vector3(0, 1, .6))
    h.player.weaponSweep.capture(new THREE.Vector3(0, 1, .6), new THREE.Vector3(0, 1, 1.4))
    h.game._checkPlayerMeleeHits()
    expect(h.bandit.dead).toBe(true)
    expect(h.ally.hp).toBe(200)
    const hits = h.events.filter(event => event.type === 'damage_applied' || event.type === 'actor_killed')
    expect(hits.every(event => event.source.actorType === 'player' && event.target.targetId === 'recruit-bandit-1')).toBe(true)
    expect(hits.filter(event => event.type === 'damage_applied')).toHaveLength(5)
    expect(hits.filter(event => event.type === 'actor_killed')).toHaveLength(1)
  })

  it('restores nested event ownership without duplicate delivery after repeated releases', () => {
    const received: string[] = []
    const sink = (name: string): CombatEventSink => () => { received.push(name) }
    const original = sink('original'), first = sink('first'), second = sink('second')
    // As constructed with its original sink; dispose reaches only plain lifecycle ports.
    const { npc } = unarmedNpc({ combatEvents: new CombatEventSinkStack(original), animator: fistAnimator(false),
      pendingFall: { active: false, clear() {} }, characterVisualGroup: { traverse() {} },
      alertSprite: { material: { dispose() {} } }, group: { position: new THREE.Vector3(), removeFromParent() {} } })
    const event: CombatEvent = { type: 'structure_destroyed', method: 'siege',
      source: { actorId: 'routing-npc', actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'viking' },
      target: { targetId: 'structure:gate', targetType: 'structure', name: 'gate' } }
    // The sink every NPC damage context (siege strike, eagle dive) emits through.
    const emitFromNpc = () => (npc as unknown as { readonly combatEventSink?: CombatEventSink }).combatEventSink?.(event)
    emitFromNpc()
    const releaseFirst = npc.bindCombatEventSink(first)
    const releaseSecond = npc.bindCombatEventSink(second)
    emitFromNpc()
    releaseFirst(); releaseFirst()
    emitFromNpc()
    releaseSecond(); releaseSecond()
    emitFromNpc()
    expect(received).toEqual(['original', 'second', 'second', 'original'])
    // Disposal drops a still-bound owner and refuses new ones.
    const releaseLate = npc.bindCombatEventSink(first)
    npc.dispose()
    emitFromNpc()
    releaseLate()
    emitFromNpc()
    expect(received.slice(4)).toEqual(['original', 'original'])
    expect(() => npc.bindCombatEventSink(first)).toThrow('disposed NPC')
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

  it('lets player Armor Break pierce half of the blocked damage while shield and barding durability drain in full', () => {
    const { stream } = eventHarness(), shield = new ShieldState()
    shield.equip('commander_shield_t5')
    const npc = mockNpc({ hp: 200, shield })
    npc.shieldCollider = new ShieldCollider({ visible: true } as THREE.Object3D, shield)
    const player = { actorId: 'player', actorType: 'player' as const, allegiance: Faction.PLAYER, characterFaction: 'viking' as const }
    // axe_t5 spends 15 Impact; Lv.50 lets 50% of the fully blocked 50 damage land.
    expect(damageNpc(npc, 50, sourceContext(stream, { weaponId: 'axe_t5', contact: { kind: 'shield', time: 0 },
      source: { ...player, armorBreakLevel: 50 } }))).toMatchObject({ appliedDamage: 25, blockedImpact: 15 })
    expect(shield.shieldImpactRemaining).toBe(81)
    expect(damageNpc(npc, 50, sourceContext(stream, { weaponId: 'axe_t5', contact: { kind: 'shield', time: 0 },
      source: { ...player, armorBreakLevel: 10 } }))).toMatchObject({ appliedDamage: 5, blockedImpact: 15 })
    expect(npc.hp).toBe(170)

    const armor = new MountArmor('ARMORED_HORSE')
    const mount = { armor, currentHp: 600, maxHp: 600, dead: false, disposed: false, displayName: '重甲戰馬', group: { uuid: 'pierced' },
      takeDamage(this: { currentHp: number }, amount: number) { this.currentHp -= amount; return true } } as unknown as Mount
    // Above Lv.50 is still capped at 50%: heavy lance 40 Impact of 50 barding, 80 → 40 HP.
    expect(damageMount(mount, 80, sourceContext(stream, { weaponId: 'heavy_lance', contact: { kind: 'mount', mount, time: 0 },
      source: { ...player, isMounted: true, armorBreakLevel: 99 } }))).toMatchObject({ appliedDamage: 40, blockedImpact: 40 })
    expect(armor.remaining).toBe(10)
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
  Object.assign(profile.inventory!.quantities, Object.fromEntries(['steel_lance'].map(id => [id, 1]))); profile.ownedWeapons = ['steel_lance'];
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

it('Career resident 與 mount 的真實空手傷害只發一次徒手 XP', () => {
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

  // resident route
  const target = mockNpc()
  Object.setPrototypeOf(target, NPC.prototype)
  const entryResident = town as unknown as { hitResident(npc: NPC, amount: number, method: 'melee', c: typeof contact): void }
  entryResident.hitResident(target, 5, 'melee', contact)
  expect(target.hp).toBe(195)
  expect(town.skills.skillState.unarmed.xp).toBe(10)
  expect(town.skills.skillState.oneHanded.xp).toBe(0)

  // mount route
  let mountHp = 100
  const mountTarget = { group: { uuid: 'mount', position: new THREE.Vector3() }, displayName: 'horse', maxHp: 100,
    get currentHp() { return mountHp }, dead: false, currentLod: 0,
    takeDamage(amount: number) { mountHp -= amount; return true } } as unknown as Mount
  const entryMount = town as unknown as { hitBattlefieldMount(mount: Mount, amount: number, method: 'melee', source: undefined, c: typeof contact): void }
  entryMount.hitBattlefieldMount(mountTarget, 5, 'melee', undefined, contact)
  expect(mountHp).toBe(95)
  expect(town.skills.skillState.unarmed.xp).toBe(20)
})

/** Where the fist pursuit asked locomotion to move this frame; `maxDistance` is its straight-line stop cap. */
interface MoveIntent { direction: THREE.Vector3; maxDistance: number }

/** A plain NPC state on the real prototype at the origin, on foot, with no fall pending. Facing, foot physics and
 * stepping are the locomotion boundary: the step only records its intent. No model, rig, mixer or scene. */
function unarmedNpc(state: Record<string, unknown> = {}) {
  const moves: MoveIntent[] = []
  const npc = Object.assign(Object.create(NPC.prototype), {
    group: { position: new THREE.Vector3() }, mount: null, rig: {}, pendingFall: { active: false }, mountedOrbitActive: true,
    _faceDirection() {}, _updateFootPhysics() {},
    _navigationPath: { clear() {} }, _tmpMoveDir: new THREE.Vector3(), _tmpNavigationTarget: new THREE.Vector3(),
    _movementObstacleRadius: () => .4, _movementObstacleHeight: () => 1.8, _clearObstacleDetour() {}, _clearNavigationPath() {},
    _moveByDirection(direction: THREE.Vector3, _speed: number, _dt: number, _sprint: boolean, maxDistance: number) {
      moves.push({ direction: direction.clone(), maxDistance })
    },
    ...state,
  }) as NPC
  return { npc, moves }
}

/** Fist animation port: which combos were started or cancelled, and the strikes each frame samples. */
function fistAnimator(busy: boolean, frames: FistStrike[][] = []) {
  const animator = { busy, started: [] as string[], cancelled: 0,
    start(clip: string) { this.started.push(clip) }, cancel() { this.cancelled++ }, setLocomotion() {},
    update: () => ({ fists: frames.shift() ?? [] }) }
  return animator
}

const duelPlayer = (z: number) => ({ dead: false, targetable: true, isMounted: false,
  combatPosition: new THREE.Vector3(0, 0, z), group: { position: new THREE.Vector3(0, 0, z) } }) as Player
type UnarmedDuelEntry = { updateUnarmedDuel(dt: number, player: Player, obstacles: [], distance: number, hit: (damage: number, isPlayer: boolean) => void): void }

it('T1..T5 Duel NPC 真的出拳且每拳固定 5，保留 Tier 承傷配置', () => {
  const tiers = [
    [1, undefined, 100], [2, undefined, 100], [3, undefined, 100],
    [4, 'praetorian', 70], [5, 'roman-commander', 50],
  ] as const
  for (const [, profile, expectedIncoming] of tiers) {
    const animator = fistAnimator(false, [[{ from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }]])
    const hit = vi.fn()
    const { npc } = unarmedNpc({ duelUnarmed: true, duelHostile: true, combatProfileId: profile, currentHp: 200, animator })
    npc.update(.2, duelPlayer(.75), [], [], [], { setFill() {} }, hit, () => false)
    expect(animator.started).toEqual(['punchCombo'])
    expect(hit).toHaveBeenCalledExactlyOnceWith(5, true)
    expect(npc.meleeDamage).toBe(5)
    npc.takeDamage(100)
    expect(npc.hp).toBe(200 - expectedIncoming)
  }
  // The punch is the only reach a loadout without a melee weapon has: no sword contact, even at 0.75m inside a 0.8m radius.
  const { npc: bareHanded } = unarmedNpc({ loadout: {}, meleeWeaponId: null, meleeAttackRadius: .8 })
  const swordContact = (npc: NPC) => (npc as unknown as { _isTargetInMeleeRange(target: THREE.Vector3): boolean })
    ._isTargetInMeleeRange(new THREE.Vector3(0, 0, .75))
  expect(swordContact(bareHanded)).toBe(false)
  Object.assign(bareHanded, { meleeWeaponId: 'gladius_rusty' })
  expect(swordContact(bareHanded)).toBe(true)
})

it('空手 Duel NPC 追擊沿用既有導航：路徑被牆擋住時朝路徑點而非玩家移動，不使用隱形劍範圍', () => {
  const animator = fistAnimator(false)
  const waypoint = new THREE.Vector3(5, 0, 0)
  const { npc, moves } = unarmedNpc({ animator, meleeAttackRadius: .8,
    _resolveNavigationMoveTarget(this: { _tmpNavigationTarget: THREE.Vector3 }) { this._tmpNavigationTarget.copy(waypoint); return 'path' } })
  const entry = npc as unknown as UnarmedDuelEntry
  entry.updateUnarmedDuel(.2, duelPlayer(6), [], 0, vi.fn())
  expect(moves).toHaveLength(1)
  expect(moves[0].direction.x).toBeCloseTo(1)           // toward the A* waypoint around the wall
  expect(Math.abs(moves[0].direction.z)).toBeLessThan(1e-6)
  expect(moves[0].maxDistance).toBe(Infinity)            // no straight-line cap while following a route
  expect(animator.started).toEqual([])                   // 6 m away: no punch, no sword reach
  // Unreachable: persistent detour is used, and with none active the NPC holds position.
  Object.assign(npc, { _resolveNavigationMoveTarget: () => 'unreachable', _detourActive: false, _applyPersistentObstacleDetour() {} })
  entry.updateUnarmedDuel(.2, duelPlayer(6), [], 0, vi.fn())
  expect(moves).toHaveLength(1)
})

it('空手 Duel NPC 四連拳播放中玩家退出拳距：繼續逼近，不取消、不重啟連拳，也不重複傷害', () => {
  // The running combo still swings a jab that reaches z = 2.9: on a target 3 m away it must not land, since the
  // 0.8m fist reach is measured from this NPC, not from the target it chases.
  const animator = fistAnimator(true, [[{ from: new THREE.Vector3(0, 1, .7), to: new THREE.Vector3(0, 1, 2.9) }]])
  const hit = vi.fn()
  const { npc, moves } = unarmedNpc({ animator })
  const entry = npc as unknown as UnarmedDuelEntry
  const player = duelPlayer(3)
  entry.updateUnarmedDuel(.2, player, [], 0, hit)
  expect(moves).toHaveLength(1)
  expect(moves[0].direction.z).toBeGreaterThan(.99) // Toward the player while the combo is still playing.
  expect({ started: animator.started, cancelled: animator.cancelled }).toEqual({ started: [], cancelled: 0 })
  expect(hit).not.toHaveBeenCalled()
  // Inside punch range mid-combo, the NPC holds and the running combo is neither restarted nor stacked.
  player.combatPosition.set(0, 0, .5)
  entry.updateUnarmedDuel(.2, player, [], 0, hit)
  expect(moves).toHaveLength(1)
  expect(animator.started).toEqual([])
})

it('空手 NPC 的出拳距離同時可觸發（大於身體碰撞距離）且打得到（拳頭可及），追擊停點在觸發距離內', async () => {
  const { UNARMED_ACTOR_CONTACT_DISTANCE, UNARMED_ATTACK_DISTANCE, UNARMED_STOP_DISTANCE } = await import('../../src/combat/UnarmedCombat')
  const shortestArmedFistReach = .53, fistRadius = .055, bodyRadius = .3
  expect(UNARMED_ATTACK_DISTANCE).toBeGreaterThan(UNARMED_ACTOR_CONTACT_DISTANCE)
  expect(UNARMED_ATTACK_DISTANCE - bodyRadius).toBeLessThan(shortestArmedFistReach + fistRadius)
  expect(UNARMED_STOP_DISTANCE).toBeLessThan(UNARMED_ATTACK_DISTANCE)
})

it('protects HR mounts from the real Town damage caller during defense preparation', () => {
    const targetMount = {
      id: 'personal-horse',
      dead: false,
      disposed: false,
      currentHp: 100,
      maxHp: 100,
      group: { position: new THREE.Vector3(0, 0, 0) },
    } as any

    const attackerNpc = {
      combatantId: 'attacker-1',
      combatOwnership: 'player-personal',
      faction: Faction.PLAYER,
      meleeWeaponId: 'sword_iron',
    } as any

    const mockTown = {
      retirementFinale: null,
      fourGateCombatHeld: false,
      isRetirementEvacuating: () => false,
      defense: { phase: 'PREPARING' },
      personalSquad: { mounts: [targetMount] },
      canHitTownMount: () => true,
    }

    // 1. During PREPARING phase, personalSquad mount is protected
    const hitBattlefieldMount = (TownScene.prototype as any).hitBattlefieldMount
    hitBattlefieldMount.call(mockTown, targetMount, 25, 'melee', attackerNpc, undefined)
    expect(targetMount.currentHp).toBe(100)

  })


it('徒手戰俘沿正式 NPC 索敵命中敵對 NPC，傳遞拳頭接觸與正確受害者', () => {
  const { npc: target } = unarmedNpc({ _faction: Faction.ENEMY })
  target.group.position.set(0, 0, .75)
  const contacts: (string | undefined)[] = []
  const hit = vi.fn((_damage: number, _isPlayer: boolean, _victim?: NPC) => { contacts.push(body.unarmedContact?.attackSource) })
  const { npc: body } = unarmedNpc({ battlefieldUnarmed: true, _faction: Faction.PLAYER,
    animator: fistAnimator(false, [[{ from: new THREE.Vector3(0, 1, .4), to: new THREE.Vector3(0, 1, .85) }]]) })
  body.setMissionCombatTarget(target)
  body.update(.2, { dead: false } as Player, [target], [target], [], { setFill() {} }, hit, () => false)
  expect(hit).toHaveBeenCalledExactlyOnceWith(5, false, target)
  // The fist contact is visible to the damage callback only while it runs.
  expect(contacts).toEqual(['unarmed'])
  expect(body.unarmedContact).toBeUndefined()
})
