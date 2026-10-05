import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BanditMissionController } from '../src/career/BanditMissionController'
import { createCareerProfile } from '../src/career/CareerProfile'
import { careerTownSceneRoster } from '../src/career/CareerFieldSceneContext'
import { acceptsCareerMissionStat, type ActiveCareerMission } from '../src/career/CareerMissionState'
import { BattleStatsTracker } from '../src/combat/BattleStatsTracker'
import { CombatEventStream } from '../src/combat/CombatAttribution'
import { LocalBoxCollider, WeaponSweep } from '../src/combat/ShieldBlocking'
import { Player } from '../src/player/Player'
import { AIType, Faction, NPC } from '../src/world/NPC'
import { Mount, MountState, MountType } from '../src/world/Mount'
import { createTownCombatFixture } from './townCombatFixture'
import { TownCavalryPatrolController } from '../src/town/TownCavalryPatrolController'
import { townRoster } from '../src/town/TownRules'
import { combatFixture } from './helpers/townMissionCombat'

const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals() })

function actor(id: string, faction: Faction, x = 0): NPC {
  const npc = new NPC(new THREE.Scene(), x, 0, faction, faction === Faction.ENEMY ? 'viking' : 'roman',
    AIType.MELEE, id, 1, false, undefined, undefined, undefined, id)
  npc.group.position.set(x, 39, 0)
  cleanup.push(() => npc.dispose())
  return npc
}

/** Rendering is omitted; scene callbacks, physical body hits, damage and mission totals are real. */
function fixture(roaming: NPC[], missionTargets: NPC[] = []) {
  const group = new THREE.Group(); group.position.set(100, 39, 100)
  const player = Object.create(Player.prototype) as Player
  Object.assign(player, { group, visualFaction: 'roman', isDead: false, spectatorOnly: false, isMounted: false, currentMount: null })
  const active: ActiveCareerMission = {
    id: 'outskirts-active-mission', templateId: 'recruit-bandits-01', kind: 'bandit', phase: 'ENGAGING',
    targetCampId: 0, targetActorIds: missionTargets.map(npc => npc.combatantId), friendlyActorIds: [], acceptedAt: 0,
  }
  const profile = { ...createCareerProfile('roman'), rank: 'captain', activeMission: active }
  const events = new CombatEventStream()
  const tracker = new BattleStatsTracker(events, false, event => acceptsCareerMissionStat(active, event))
  cleanup.push(() => tracker.dispose())
  const mission = Object.assign(Object.create(BanditMissionController.prototype), {
    readProfile: () => profile, player: () => player, events, tracker, friendlies: [], veteranEnemies: [],
    camps: [{ id: 0, center: new THREE.Vector3(), ambient: [], mission: missionTargets }],
    alertGroupFor: vi.fn(), provokeGroupFor: vi.fn(), combatPeersFor: () => missionTargets,
  }) as BanditMissionController
  const outskirts = {
    actors: roaming, mounts: [] as Mount[], owns: (npc: NPC) => roaming.includes(npc),
    noteHit: vi.fn(), dispose: vi.fn(),
  }
  const skillState = Object.fromEntries(['oneHanded', 'twoHanded', 'ranged', 'mountedImpact', 'blocking'].map(skill => [skill, { level: 1, xp: 0 }]))
  const town = Object.assign(createTownCombatFixture(), {
    profile, player, outskirts, mission, residents: [], mounts: [], stableHorses: [], cat: null,
    event: { hostile: false }, world: { buildings: [], targets: [], obstacles: [] },
    defense: { active: false, phase: null, assault: false, events: new CombatEventStream(), playerEnemies: [], noteEffectiveFriendlyDamage: vi.fn(), peersFor: () => [] },
    missionCombat: { enemyTownHostiles: [], isExternalThreatDefender: () => false, noteExternalHit: vi.fn() },
    skills: { skillState, addXp: vi.fn(() => 0), getMultiplier: () => 1, getMountedImpactMultiplier: () => 1 },
    inventory: { meleeEnabled: true, equippedMelee: { id: 'gladius_rusty', combatKind: 'sword', damageMax: 12, range: 1.8 }, shieldEnabled: false },
    damageNumbers: { spawn: vi.fn() }, showCombatTarget: vi.fn(), activateHostility: vi.fn(), prepareDamage: vi.fn(() => true),
    persistCasualties: vi.fn(), shots: [], previousTip: new THREE.Vector3(), hasPreviousTip: false,
  })
  return { town, mission, outskirts, player, active, tracker }
}

function arrowThrough(target: NPC, source?: NPC) {
  let alive = true
  const center = target.group.position.clone().add(new THREE.Vector3(0, 1, 0))
  return {
    training: false, player: !source, source, age: 0,
    arrow: { mesh: { position: center.clone().add(new THREE.Vector3(-2, 0, 0)) }, damage: 10,
      update() { this.mesh.position.copy(center).x += 2 }, destroy: vi.fn(() => { alive = false }), get isAlive() { return alive } },
  }
}

function independentHorse(rider: NPC): Mount {
  return Object.assign(Object.create(Mount.prototype), {
    group: new THREE.Group(), type: MountType.HORSE, state: MountState.IDLE,
    currentHp: 100, maxHp: 100, riderNpc: rider, disposed: false,
    takeDamage(amount: number) { this.currentHp = Math.max(0, this.currentHp - amount); return true },
  }) as Mount
}

function activateDuel(town: any, opponent: NPC, phase = 'ENGAGING') {
  town.profile.activeMission.kind = 'duel'; town.profile.activeMission.phase = phase
  town.profile.activeMission.duelOpponentActorId = opponent.combatantId
  const events = new CombatEventStream()
  town.duel = { active: town.profile.activeMission, opponent, fieldNpcs: [opponent], actors: [opponent], events,
    combatEnabled: phase === 'ENGAGING', isMissionActor: (npc: NPC) => npc === opponent,
    isMissionTarget: (npc: NPC) => npc === opponent,
    canDamageOpponent: (npc: NPC) => phase === 'ENGAGING' && npc === opponent,
    canDamagePlayer: (npc: NPC) => phase === 'ENGAGING' && npc === opponent }
  opponent.setDuelHostility(phase === 'ENGAGING')
}

describe('Duel shares normal Town combat', () => {
  it.each(['patrol', 'gate_guard', 'training'] as const)('protects an idle friendly %s actor and its mount during Duel', duty => {
    const friendly = actor('town:ally', Faction.TOWN), opponent = actor('duel:opponent', Faction.TOWN, 80)
    const { town } = fixture([]); activateDuel(town, opponent)
    const mount = independentHorse(friendly); friendly.mount = mount
    town.residents = [{ spec: { duty }, npc: friendly, homeMount: mount }]
    const before = friendly.hp
    expect(town.isProtectedTownAlly(friendly)).toBe(true); expect(town.isProtectedTownAlly(mount)).toBe(true)
    town.hitFieldNpc(friendly, 10, 'melee', undefined, { kind: 'body', time: .5 })
    town.hitBattlefieldMount(mount, 10, 'projectile', undefined, { kind: 'mount', mount, time: .5 })
    expect(friendly.hp).toBe(before); expect(mount.currentHp).toBe(100)
  })
  it.each([Faction.BANDIT, Faction.ENEMY, Faction.TOWN])('keeps rider and mount protection consistent for %s during Duel', faction => {
    const rider = actor('roaming:rider', faction), opponent = actor('duel:opponent', Faction.TOWN, 80)
    const { town, player, outskirts } = fixture([rider]); activateDuel(town, opponent)
    const mount = independentHorse(rider); rider.mount = mount; mount.group.position.copy(rider.group.position)
    Object.assign(mount, { mountCollider: new LocalBoxCollider(mount.group, new THREE.Box3(new THREE.Vector3(-.6, 0, -1.1), new THREE.Vector3(.6, 1.6, 1.1))) })
    outskirts.mounts.push(mount); town.combatMounts.push(mount); town.combatMountGrid.insert(mount)
    const hp = rider.hp
    town.hitFieldNpc(rider, 10, 'melee', undefined, { kind: 'body', time: .5 })
    town.hitBattlefieldMount(mount, 10, 'melee', undefined, { kind: 'mount', mount, time: .5 })
    expect(rider.hp).toBe(hp - (faction === Faction.TOWN ? 0 : 10))
    expect(mount.currentHp).toBe(faction === Faction.TOWN ? 100 : 90)
    expect(outskirts.noteHit).toHaveBeenCalledTimes(faction === Faction.TOWN ? 0 : 2)
    if (faction !== Faction.TOWN) expect(rider.hostileToPlayer).toBe(true)
    expect(town.activateHostility).not.toHaveBeenCalled(); expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.profile.activeMission.duelOpponentActorId).toBe(opponent.combatantId)
    // Real sweep target selection must include the hostile rider, independently of mount contact.
    const grip = new THREE.Vector3(0, 40, -.8), tip = new THREE.Vector3(0, 40, .2)
    player.group.position.set(0, 39, -1.2); player.group.rotation.y = Math.PI
    const sweep = new WeaponSweep(); sweep.capture(grip, tip)
    Object.assign(player, { weaponSweep: sweep, getWeaponGripPosition: () => grip, getSwordTipPosition: () => tip,
      isHitFrame: () => true, markHitProcessed: vi.fn() })
    const trace = vi.spyOn(sweep, 'traceFirst')
    town.melee()
    expect(trace.mock.calls[0][0].includes(rider)).toBe(faction !== Faction.TOWN)
    expect(trace.mock.calls[0][1]?.includes(mount)).toBe(faction !== Faction.TOWN)
  })

  it.each(['PREPARING', 'ENGAGING'])('routes world attacks, retaliation and cross-ownership projectiles in %s', phase => {
    const bandit = actor('roaming:bandit', Faction.BANDIT), opponent = actor('duel:opponent', Faction.TOWN, 30)
    const { town, outskirts } = fixture([bandit]); activateDuel(town, opponent, phase)
    const playerShot = arrowThrough(bandit); town.shots = [playerShot]; town.updateShots(.05)
    expect(bandit.hp).toBe(bandit.maxHp - 10)
    expect(outskirts.noteHit).toHaveBeenCalledWith(bandit, true)
    expect(bandit.hostileToPlayer).toBe(true)
    const npcShot = arrowThrough(opponent, bandit); town.shots = [npcShot]; town.updateShots(.05)
    expect(opponent.hp).toBe(opponent.maxHp - 10)
    expect(npcShot.arrow.isAlive).toBe(false)
    const worldTarget = actor('roaming:cavalry', Faction.ENEMY, 60); outskirts.actors.push(worldTarget)
    town.hitFieldNpc(worldTarget, 10, 'melee', bandit, { kind: 'body', time: .5 })
    expect(worldTarget.hp).toBe(worldTarget.maxHp - 10)
    town.hitFieldNpc(bandit, 10, 'melee', opponent, { kind: 'body', time: .5 })
    expect(bandit.hp).toBe(bandit.maxHp - 20)
    expect(town.prepareDamage).not.toHaveBeenCalled(); expect(town.activateHostility).not.toHaveBeenCalled()
  })
})

describe('Town outskirts combat routing', () => {
  it.each((['roaming', 'mission'] as const).flatMap(origin => (['body', 'shield', 'mount', 'mount-death', 'lethal'] as const).map(kind => [origin, kind] as const)))(
    'routes a hostile %s %s contact into the whole Patrol even without rider HP loss', (origin, kind) => {
    const hostile = actor(`${origin}:attacker`, Faction.ENEMY, 3)
    const residents = townRoster().filter(spec => spec.patrolId === 'A').slice(0, 3)
      .map(spec => ({ spec, npc: actor(spec.id, Faction.TOWN) }))
    const [victim, ...survivors] = residents
    const patrol = new TownCavalryPatrolController(residents)
    const { town } = fixture(origin === 'roaming' ? [hostile] : [], origin === 'mission' ? [hostile] : [])
    Object.assign(town, { residents, patrol })
    const combat = combatFixture({ simulation: { residents: residents as any, patrol: () => patrol, outskirts: () => town.outskirts as any } })
    if (origin === 'mission') { combat.field.fieldNpcs = [hostile]; combat.field.missionBandits = [hostile] }
    town.missionCombat = combat.combat
    const beforeHp = victim.npc.hp
    if (kind === 'shield') Object.assign(victim.npc, { shield: { active: true, absorb: () => ({ damage: 0, blockedImpact: 10 }) }, shieldCollider: null })
    if (kind === 'mount' || kind === 'mount-death') {
      const mount = independentHorse(victim.npc)
      victim.npc.mount = mount
      if (kind === 'mount-death') mount.takeDamage = amount => {
        mount.currentHp = Math.max(0, mount.currentHp - amount)
        if (mount.currentHp === 0) { mount.state = MountState.DEAD; mount.riderNpc = null; victim.npc.mount = null }
        return true
      }
      town.hitFieldNpc(victim.npc, kind === 'mount-death' ? 9999 : 10, 'melee', hostile, { kind: 'mount', mount, time: .5 })
      expect(victim.npc.hp).toBe(beforeHp)
      if (kind === 'mount-death') expect(mount.dead).toBe(true)
    } else town.hitFieldNpc(victim.npc, kind === 'lethal' ? 9999 : 10, 'melee', hostile, { kind: kind === 'shield' ? 'shield' : 'body', time: .5 })
    if (kind === 'shield') expect(victim.npc.hp).toBe(beforeHp)
    if (kind === 'lethal') expect(victim.npc.dead).toBe(true)
    expect(survivors.every(r => patrol.combatEnabled(r.npc))).toBe(true)
    expect(patrol.squads[0].state).toBe('ENGAGING')
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it('ignores friendly, zero-damage and formally borrowed Patrol contacts when routing squad alert', () => {
    const friendly = actor('roaming:ally', Faction.TOWN), enemy = actor('roaming:enemy', Faction.ENEMY)
    const residents = townRoster().filter(spec => spec.patrolId === 'A').slice(0, 3).map(spec => ({ spec, npc: actor(spec.id, Faction.TOWN) }))
    const patrol = new TownCavalryPatrolController(residents)
    const { town } = fixture([friendly, enemy])
    Object.assign(town, { residents, patrol })
    town.missionCombat.noteExternalHit.mockImplementation((target: NPC, source: NPC) => patrol.noteHostileHit(target, source))
    const victim = residents[0].npc
    town.hitFieldNpc(victim, 10, 'melee', friendly, { kind: 'body', time: .5 })
    town.hitFieldNpc(victim, 0, 'melee', enemy, { kind: 'body', time: .5 })
    patrol.relinquish(victim.combatantId)
    town.hitFieldNpc(victim, 10, 'melee', enemy, { kind: 'body', time: .5 })
    expect(patrol.combatActors).toHaveLength(0)
    expect(patrol.squads[0].state).not.toBe('ENGAGING')
  })

  it('lets an NPC kill a mission target and advance the unchanged objective without claiming player contribution', () => {
    const target = actor('mission-bandit-0', Faction.BANDIT, 20)
    const roaming = actor('town-roaming:enemy:0:0', Faction.ENEMY)
    const { town, mission, active, tracker } = fixture([roaming], [target])
    expect(mission.remainingEnemies).toBe(1)
    town.hitFieldNpc(target, 9999, 'melee', roaming, { kind: 'body', time: .5 })
    expect(target.dead).toBe(true)
    expect(mission.remainingEnemies).toBe(0)
    expect(mission.evaluate(false)).toBe('victory')
    expect(active.targetActorIds).toEqual([target.combatantId])
    expect(active.friendlyActorIds).toEqual([])
    expect(mission.fieldNpcs).toEqual([target])
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, kills: 0 })
    expect(town.skills.addXp).not.toHaveBeenCalled()
    expect(town.missionCombat.noteExternalHit).toHaveBeenCalledExactlyOnceWith(target, roaming)
  })

  it.each(['bandit', 'town-defense', 'enemy-town-assault'] as const)('gives player combat XP for roaming Bandits during %s without crime or mission credit', kind => {
    const roaming = actor('town-roaming:bandit:0:0', Faction.BANDIT)
    const objective = actor('mission-enemy-0', Faction.ENEMY, 50)
    const { town, outskirts, active, mission, tracker } = fixture([roaming], [objective])
    active.kind = kind
    if (kind !== 'bandit') Object.assign(town.defense, { active: true, phase: 'ATTACKING', assault: kind === 'enemy-town-assault' })
    const before = roaming.hp
    town.hitFieldNpc(roaming, 10, 'melee', undefined, { kind: 'body', time: .5 })
    expect(roaming.hp).toBe(before - 10)
    expect(town.skills.addXp.mock.calls[0].slice(0, 2)).toEqual(['oneHanded', 10])
    expect(outskirts.noteHit).toHaveBeenCalledExactlyOnceWith(roaming, true)
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
    expect(mission.remainingEnemies).toBe(1)
    expect(active.targetActorIds).toEqual([objective.combatantId])
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, kills: 0 })
  })

  it('protects a same-faction roaming rider without adding them to mission friendlies', () => {
    const ally = actor('town-roaming:enemy:0:0', Faction.TOWN)
    const { town, mission, outskirts } = fixture([ally])
    const before = ally.hp
    expect(town.isProtectedTownAlly(ally)).toBe(true)
    town.hitFieldNpc(ally, 10, 'melee', undefined, { kind: 'body', time: .5 })
    town.hitResident(ally, 10)
    expect(ally.hp).toBe(before)
    expect(mission.friendlies).toEqual([])
    expect(outskirts.noteHit).not.toHaveBeenCalled()
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it.each(['melee', 'projectile'] as const)('lets Player %s damage a Veteran VI native Patrol engaged with allied roaming cavalry', method => {
    const allied = actor('town-roaming:cavalry:a:0', Faction.TOWN, 50)
    const { town, player, active } = fixture([allied])
    active.kind = 'veteran-field'; active.templateId = 'veteran-tragedy-of-the-scouts'
    const residents = careerTownSceneRoster(town.profile).filter(entry => entry.spec.patrolId === 'A').slice(0, 3)
      .map(({ spec, allegiance }, index) => ({ spec, npc: actor(spec.id, allegiance, index * 8), cycle: -1, walkTime: 0 }))
    const patrol = new TownCavalryPatrolController(residents), target = residents[0].npc
    const { combat, field } = combatFixture({ simulation: { residents, patrol: () => patrol } })
    field.active = active
    Object.assign(town, { residents, patrol, missionCombat: combat })
    patrol.noteHostileHit(target, allied)
    expect(patrol.combatEnabled(target)).toBe(true)
    expect(target.faction).toBe(Faction.ENEMY)
    expect(target.hostileToPlayer).toBe(true)
    const before = target.hp
    if (method === 'melee') {
      player.group.position.set(0, 39, -1.2)
      const grip = new THREE.Vector3(0, 40, -.8), tip = new THREE.Vector3(0, 40, .2)
      const sweep = new WeaponSweep(); sweep.capture(grip, tip)
      Object.assign(player, { getWeaponGripPosition: () => grip, getSwordTipPosition: () => tip,
        weaponSweep: sweep, isHitFrame: () => true, markHitProcessed: vi.fn() })
      town.melee()
      expect(target.hp).toBeLessThan(before)
      expect(player.markHitProcessed).toHaveBeenCalledOnce()
    } else {
      const shot = arrowThrough(target); town.shots = [shot]; town.updateShots(.05)
      expect(target.hp).toBe(before - 10)
      expect(shot.arrow.destroy).toHaveBeenCalledOnce()
    }
    expect(town.isProtectedTownAlly(target)).toBe(false)
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it('continues protecting a home Town Patrol engaged with hostile roaming cavalry', () => {
    const hostile = actor('town-roaming:cavalry:a:0', Faction.ENEMY, 50)
    const { town } = fixture([hostile])
    const residents = careerTownSceneRoster(town.profile).filter(entry => entry.spec.patrolId === 'A').slice(0, 3)
      .map(({ spec, allegiance }, index) => ({ spec, npc: actor(spec.id, allegiance, index * 8), cycle: -1, walkTime: 0 }))
    const patrol = new TownCavalryPatrolController(residents), target = residents[0].npc
    const { combat, field } = combatFixture({ simulation: { residents, patrol: () => patrol } })
    field.active = town.profile.activeMission
    Object.assign(town, { residents, patrol, missionCombat: combat })
    patrol.noteHostileHit(target, hostile)
    expect(patrol.combatEnabled(target)).toBe(true)
    expect(target.faction).toBe(Faction.TOWN)
    expect(target.hostileToPlayer).toBe(false)
    expect(town.isProtectedTownAlly(target)).toBe(true)
    const before = target.hp, shot = arrowThrough(target)
    town.shots = [shot]; town.updateShots(.05)
    town.hitResident(target, 10)
    expect(target.hp).toBe(before)
    expect(shot.arrow.isAlive).toBe(true)
    expect(town.prepareDamage).not.toHaveBeenCalled()
  })

  it.each([Faction.BANDIT, Faction.ENEMY, Faction.TOWN])('player melee and arrows use faction protection for a roaming %s rider', faction => {
    const roaming = actor('town-roaming:0:0', faction)
    const { town, player } = fixture([roaming])
    player.group.position.set(0, 39, -1.2); player.group.rotation.y = Math.PI
    const grip = new THREE.Vector3(0, 40, -.8), tip = new THREE.Vector3(0, 40, .2)
    const sweep = new WeaponSweep(); sweep.capture(grip, tip)
    Object.assign(player, { getWeaponGripPosition: () => grip, getSwordTipPosition: () => tip,
      weaponSweep: sweep, isHitFrame: () => true, markHitProcessed: vi.fn() })
    const before = roaming.hp
    town.melee()
    const afterMelee = roaming.hp
    player.group.position.set(100, 39, 100)
    const shot = arrowThrough(roaming); town.shots = [shot]; town.updateShots(.05)
    if (faction === Faction.TOWN) {
      expect(afterMelee).toBe(before)
      expect(roaming.hp).toBe(before)
      expect(shot.arrow.isAlive).toBe(true)
    } else {
      expect(afterMelee).toBeLessThan(before)
      expect(roaming.hp).toBe(afterMelee - 10)
      expect(shot.arrow.isAlive).toBe(false)
    }
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it('alerts a hostile squad after effective horse damage while ignoring fully blocked rider hits', () => {
    const roaming = actor('town-roaming:bandit:0:0', Faction.BANDIT)
    const { town, outskirts, tracker } = fixture([roaming])
    const mount = independentHorse(roaming)
    roaming.mount = mount; outskirts.mounts.push(mount)
    const before = roaming.hp
    town.hitFieldNpc(roaming, 10, 'melee', undefined, { kind: 'mount', mount, time: .5 })
    expect(mount.currentHp).toBe(90)
    expect(roaming.hp).toBe(before)
    expect(outskirts.noteHit).toHaveBeenCalledExactlyOnceWith(roaming, true)
    expect(tracker.checkpoint()).toMatchObject({ damageDealt: 0, kills: 0 })
    outskirts.noteHit.mockClear()
    const blocked = Object.assign(roaming, { shield: { active: true, absorb: () => ({ damage: 0, blockedImpact: 10 }) }, shieldCollider: null })
    town.hitFieldNpc(blocked, 10, 'melee', undefined, { kind: 'shield', time: .5 })
    expect(outskirts.noteHit).not.toHaveBeenCalled()
    town.hitFieldNpc(roaming, 10, 'melee', undefined, { kind: 'body', time: .5 })
    expect(outskirts.noteHit).toHaveBeenCalledExactlyOnceWith(roaming, true)
  })

  it('protects an independent mount contact belonging to a protected roaming ally', () => {
    const ally = actor('town-roaming:enemy:0:0', Faction.TOWN)
    const { town, outskirts } = fixture([ally])
    const mount = independentHorse(ally); ally.mount = mount; outskirts.mounts.push(mount)
    expect(town.isProtectedTownAlly(ally)).toBe(true)
    expect(town.isProtectedTownAlly(mount)).toBe(true)
    const before = ally.hp
    town.hitBattlefieldMount(mount, 10, 'melee', undefined, { kind: 'mount', mount, time: .5 })
    expect(mount.currentHp).toBe(100)
    expect(ally.hp).toBe(before)
    expect(ally.hostileToPlayer).toBe(false)
    expect(outskirts.noteHit).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it.each(['player', 'mission', 'roaming'] as const)('includes roaming bodies in %s projectile collisions and routes natural hostility', shooter => {
    const target = actor('town-roaming:bandit:0:0', Faction.BANDIT)
    const missionAlly = actor('mission-ally', Faction.TOWN, 100)
    const roamingEnemy = actor('town-roaming:enemy:0:0', Faction.ENEMY, 150)
    const source = shooter === 'player' ? undefined : shooter === 'mission' ? missionAlly : roamingEnemy
    const { town, outskirts } = fixture([target, roamingEnemy])
    town.mission.friendlies.push(missionAlly)
    const shot = arrowThrough(target, source); town.shots = [shot]
    const before = target.hp
    town.updateShots(.05)
    expect(target.hp).toBe(before - 10)
    expect(shot.arrow.destroy).toHaveBeenCalledOnce()
    expect(outskirts.noteHit).toHaveBeenCalledExactlyOnceWith(target, !source)
    expect(town.activateHostility).not.toHaveBeenCalled()
  })

  it('lets roaming projectiles hit a mission actor but excludes actors on the shooter faction', () => {
    const source = actor('town-roaming:enemy:0:0', Faction.ENEMY, 150)
    const missionTarget = actor('mission-bandit', Faction.BANDIT)
    const { town } = fixture([source], [missionTarget])
    const before = missionTarget.hp
    town.shots = [arrowThrough(missionTarget, source)]; town.updateShots(.05)
    expect(missionTarget.hp).toBe(before - 10)
    missionTarget.group.position.x = 100
    const sameFaction = actor('town-roaming:enemy:1:0', Faction.ENEMY)
    town.outskirts.actors.push(sameFaction)
    const hp = sameFaction.hp, shot = arrowThrough(sameFaction, source)
    town.shots = [shot]; town.updateShots(.05)
    expect(sameFaction.hp).toBe(hp)
    expect(shot.arrow.isAlive).toBe(true)
  })

  it('disposes the roaming controller once when leaving the Town runtime', () => {
    const { town, outskirts } = fixture([])
    const element = { textContent: '', style: {}, classList: { remove: vi.fn() } }
    vi.stubGlobal('document', { getElementById: () => element, exitPointerLock: vi.fn() })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const disposable = () => ({ dispose: vi.fn() })
    Object.assign(town, {
      flushCareerSkillProgression: vi.fn(), weaponWheelUI: disposable(), duelHud: disposable(), duelGuide: disposable(),
      listeners: { abort: vi.fn() }, input: disposable(), equipment: { close: vi.fn() },
      hud: { remove: vi.fn() }, hint: { remove: vi.fn() }, pointerPrompt: { remove: vi.fn() }, ambientLabel: { remove: vi.fn() },
      mission: disposable(), defense: disposable(), player: disposable(), world: disposable(),
      renderer: { dispose: vi.fn(), domElement: { remove: vi.fn() } }, camera: new THREE.PerspectiveCamera(),
      damageNumbers: { update: vi.fn() },
    })
    town.dispose(); town.dispose()
    expect(outskirts.dispose).toHaveBeenCalledOnce()
  })
})
