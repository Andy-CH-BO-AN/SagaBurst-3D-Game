import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CareerProfile, CareerRank } from '../career/CareerProfile'
import { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { Mount } from '../world/Mount'
import { AIType, Faction, NPC, type BanditAggroState } from '../world/NPC'
import { DeathFadeController, DEATH_DESPAWN_DELAY_SECONDS } from '../world/DeathFade'
import type { HpBar } from '../ui/HpBar'
import type { ObstacleData } from '../world/Terrain'
import { TOWN_NAVIGATION_BOUNDS } from './TownBounds'
import { OUTSKIRTS_ENCOUNTER_LEASH, outskirtsActorId, outskirtsCavalryFaction, outskirtsSquadSpecs } from './TownOutskirtsRules'
import { TownOutskirtsWarfareController } from './TownOutskirtsWarfareController'
import { TownWorld } from './TownWorld'

class TestMount {
  readonly group = new THREE.Group()
  dead = false
  disposed = false
  deathPresentationComplete = false
  riderNpc: TestNpc | null = null
  riderPlayer: object | null = null
  dispose = vi.fn(() => { this.disposed = true })
}
class TestNpc {
  readonly group = new THREE.Group()
  dead = false
  deathPresentationComplete = false
  private readonly deathPresentation = new DeathFadeController()
  respawnEnabled = true
  mount: TestMount | null = null
  encounterAggroState: BanditAggroState = 'idle'
  formationCommandId: number | null = null
  activeFollowTarget: TestNpc | null = null
  activeFollowSlotIndex = -1
  formationGoal: THREE.Vector3 | null = null
  encounterOrigin: THREE.Vector3 | null = null
  disposed = false
  constructor(readonly spec: NpcSpawnSpec) { this.group.position.set(spec.x, 0, spec.z) }
  get combatantId(): string { return this.spec.actorId! }
  get faction(): Faction { return this.spec.faction }
  get combatPosition(): THREE.Vector3 { return this.mount?.group.position ?? this.group.position }
  get isMounted(): boolean { return Boolean(this.mount && !this.mount.dead) }
  mountVehicle(mount: TestMount): void { this.mount = mount; mount.riderNpc = this }
  configureBanditEncounter = vi.fn((origin: THREE.Vector3, _waypoints: readonly THREE.Vector3[] = [], _leash = 58) => {
    this.encounterOrigin = origin.clone(); this.encounterAggroState = 'idle'
  })
  triggerEncounterAlert = vi.fn(() => {
    if (this.encounterAggroState !== 'returning' && this.encounterAggroState !== 'provoked') {
      this.encounterAggroState = 'alerted'; this.formationCommandId = null
    }
  })
  provokeEncounter = vi.fn(() => { this.encounterAggroState = 'provoked' })
  returnFromEncounter = vi.fn(() => { this.encounterAggroState = 'returning' })
  assignFormationTarget = vi.fn((command: number, goal: THREE.Vector3) => {
    this.formationCommandId = command; this.formationGoal = goal.clone(); this.activeFollowTarget = null
  })
  assignFollowTarget = vi.fn((leader: TestNpc, slot: number) => {
    this.activeFollowTarget = leader; this.activeFollowSlotIndex = slot; this.formationCommandId = -1
  })
  clearEncounter = vi.fn()
  updateTownTravel = vi.fn()
  dispose = vi.fn(() => { this.disposed = true })
  move(x: number, z: number): void { this.group.position.set(x, 0, z); this.mount?.group.position.set(x, 0, z) }
  die(): void {
    if (this.mount) { this.group.position.copy(this.mount.group.position); this.mount.riderNpc = null; this.mount = null }
    this.dead = true; this.deathPresentationComplete = false; this.deathPresentation.start(this.group)
  }
  updateDeathPresentation(dt: number): void { this.deathPresentationComplete = this.deathPresentation.update(this.group, dt) }
}

function setup(rank: CareerRank = 'captain', townFaction: CharacterFaction = 'roman', playerFaction: CharacterFaction = 'roman', obstacles: ObstacleData[] = []) {
  let profile: Pick<CareerProfile, 'rank' | 'faction'> = { rank, faction: playerFaction }
  const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS)
  navigation.rebuild(obstacles)
  const created: TestNpc[] = [], horses: TestMount[] = []
  const controller = new TownOutskirtsWarfareController(new THREE.Scene(), townFaction, () => profile, obstacles, navigation, {
    createNpc(spec) { const npc = new TestNpc(spec); created.push(npc); return npc as unknown as NPC },
    createMount(x, z) { const mount = new TestMount(); mount.group.position.set(x, 0, z); horses.push(mount); return mount as unknown as Mount },
  })
  const player = { targetable: true, dead: false, combatPosition: new THREE.Vector3(10000, 0, 10000) } as unknown as Player
  const frame = (dt = .4, peers: NPC[] = []) => controller.prepareFrame(dt, [...controller.actors, ...peers], player)
  const isolate = () => { created.forEach((npc, index) => npc.move(2000 + index * 100, 2000)) }
  return { controller, created, horses, navigation, player, frame, isolate,
    rank(next: CareerRank) { profile = { ...profile, rank: next }; controller.synchronizeRank() } }
}
const asTest = (npc: NPC) => npc as unknown as TestNpc

describe('Town outskirts runtime', () => {
  it.each(['recruit', 'soldier', 'veteran'] as const)('creates no warfare actors at %s rank and unlocks on promotion', rank => {
    const test = setup(rank)
    expect(test.controller.actors).toHaveLength(0)
    expect(test.controller.mounts).toHaveLength(0)
    test.rank('captain')
    expect(test.controller.actors).toHaveLength(60)
    expect(test.controller.mounts).toHaveLength(30)
    test.rank('commander')
    expect(test.created).toHaveLength(60)
    test.controller.dispose()
  })

  it.each([
    ['roman', 'roman', 'viking', Faction.ENEMY, 'viking_axe_t2'],
    ['viking', 'viking', 'roman', Faction.ENEMY, 'gladius_standard'],
    ['viking', 'roman', 'roman', Faction.TOWN, 'gladius_standard'],
    ['roman', 'viking', 'viking', Faction.TOWN, 'viking_axe_t2'],
  ] as const)('uses the opposite of %s Town with %s Career allegiance', (town, player, visual, allegiance, weapon) => {
    const test = setup('commander', town, player)
    const bandits = test.created.filter(npc => npc.faction === Faction.BANDIT)
    const riders = test.created.filter(npc => npc.spec.cavalry)
    expect(bandits).toHaveLength(30)
    expect(test.controller.squads.filter(squad => squad.spec.kind === 'bandit').map(squad => squad.members.length)).toEqual([5, 5, 5, 5, 5, 5])
    expect(riders).toHaveLength(30)
    expect(test.controller.squads.filter(squad => squad.spec.kind === 'cavalry').map(squad => squad.members.length)).toEqual([10, 10, 10])
    expect(riders.every(npc => npc.spec.tier === 2 && npc.spec.characterFaction === visual && npc.faction === allegiance
      && npc.spec.loadout?.meleeWeaponId === weapon && npc.spec.loadout?.mountId === 'horse' && !npc.respawnEnabled)).toBe(true)
    expect(outskirtsCavalryFaction(town, player).faction).toBe(allegiance)
    test.controller.dispose()
  })

  it('claims living cavalry identities and horses once, without repositioning or roaming replacements', () => {
    const test = setup(); test.isolate()
    const cavalry = test.controller.squads.filter(s => s.spec.kind === 'cavalry')
    cavalry[0].members.slice(0, 7).forEach(n => asTest(n).die())
    const living = cavalry.flatMap(s => s.members).filter(n => !n.dead)
    const positions = living.map(n => n.combatPosition.clone()), mounts = living.map(n => n.mount)
    const claim = test.controller.claimCavalryForSiege('viking')
    expect(claim.actors).toEqual(living)
    expect(claim.actors).toHaveLength(23)
    expect(claim.mounts).toEqual(mounts)
    expect(claim.actors.every((n, i) => n.combatPosition.equals(positions[i]))).toBe(true)
    expect(living.some(n => test.controller.actors.includes(n))).toBe(false)
    test.frame(120)
    expect(cavalry.every(s => s.state === 'SIEGE_OWNED' && s.members.length === 0)).toBe(true)
    expect(test.controller.claimCavalryForSiege('viking').actors).toHaveLength(0)
    test.controller.releaseSiegeOwnership()
    expect(cavalry.every(s => s.members.length === 10)).toBe(true)
    test.controller.dispose()
  })

  it('starts each bandit squad cooldown at its own full wipe and waits exactly 60 seconds', () => {
    const test = setup(); test.isolate()
    const [a, b] = test.controller.squads
    a.members.forEach(n => asTest(n).die()); test.frame()
    test.frame(30)
    b.members.forEach(n => asTest(n).die()); test.frame(0)
    test.frame(29)
    expect(a.state).toBe('RESPAWN_COOLDOWN'); expect(b.state).toBe('RESPAWN_COOLDOWN')
    test.frame(1)
    expect(a.members.every(n => !n.dead)).toBe(true)
    expect(b.state).toBe('RESPAWN_COOLDOWN')
    test.frame(30)
    expect(b.members.every(n => !n.dead)).toBe(true)
    test.controller.dispose()
  })

  it('reloads a deterministic complete roster with independent routes and identities', () => {
    const first = setup(), second = setup()
    expect(first.created.map(npc => [npc.combatantId, npc.spec.x, npc.spec.z])).toEqual(second.created.map(npc => [npc.combatantId, npc.spec.x, npc.spec.z]))
    expect(new Set(first.created.map(npc => npc.combatantId)).size).toBe(60)
    expect(first.created.every(npc => npc.combatantId.startsWith('outskirts:'))).toBe(true)
    expect(new Set(outskirtsSquadSpecs().map(spec => JSON.stringify(spec.route))).size).toBe(9)
    expect(outskirtsActorId('outskirts:bandit:a', 0)).toBe('outskirts:bandit:a:0')
    first.controller.dispose(); second.controller.dispose()
  })

  it('alerts the full squad when only a follower detects a nearby hostile and shares first-contact origin', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[0]
    squad.members.forEach((npc, index) => asTest(npc).move(index ? 100 : 40, 0))
    const enemy = new TestNpc({ ...test.created[30].spec, actorId: 'mission:enemy', x: 122, z: 0 })
    test.frame(.4, [enemy as unknown as NPC])
    expect(squad.state).toBe('ENGAGING')
    expect(squad.members.every(npc => npc.encounterAggroState === 'alerted')).toBe(true)
    expect(squad.engagementOrigin?.toArray()).toEqual([40, 0, 0])
    expect(squad.members.every(npc => asTest(npc).encounterOrigin?.equals(squad.engagementOrigin!))).toBe(true)
    expect(squad.members.every(npc => asTest(npc).configureBanditEncounter.mock.lastCall?.[2] === OUTSKIRTS_ENCOUNTER_LEASH)).toBe(true)
    test.controller.dispose()
  })

  it('registers Town actors as hostile peers while allied cavalry ignores the Player', () => {
    const test = setup('captain', 'viking', 'roman'); test.isolate()
    const squad = test.controller.squads[6]
    squad.members.forEach(npc => asTest(npc).move(0, 0))
    test.player.combatPosition.set(2, 0, 0)
    test.frame()
    expect(squad.state).toBe('PATROLLING')
    test.controller.noteHit(squad.members[0], true)
    expect(squad.state).toBe('PATROLLING')
    const defender = new TestNpc({ ...test.created[30].spec, actorId: 'enemy-town:guard', faction: Faction.ENEMY, x: 20, z: 0 })
    test.frame(.4, [defender as unknown as NPC])
    expect(squad.state).toBe('ENGAGING')
    expect(squad.members.every(npc => npc.encounterAggroState === 'alerted')).toBe(true)
    test.controller.dispose()
  })

  it('preserves returning detection immunity and allows a Player provoke to cancel the return for all survivors', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[0]
    squad.members.forEach(npc => asTest(npc).move(0, 0))
    test.controller.noteHit(squad.members[0], false)
    squad.members.forEach(npc => { asTest(npc).encounterAggroState = 'returning'; asTest(npc).move(100, 0) })
    const origin = squad.engagementOrigin!.clone()
    test.player.combatPosition.set(101, 0, 0)
    test.frame()
    expect(squad.members.every(npc => npc.encounterAggroState === 'returning')).toBe(true)
    test.controller.noteHit(squad.members[3], true)
    expect(squad.members.every(npc => npc.encounterAggroState === 'provoked')).toBe(true)
    expect(squad.engagementOrigin?.equals(origin)).toBe(true)
    const before = squad.members.map(npc => asTest(npc).returnFromEncounter.mock.calls.length)
    test.player.combatPosition.set(10000, 0, 10000)
    test.frame()
    expect(squad.members.map(npc => asTest(npc).returnFromEncounter.mock.calls.length)).toEqual(before)
    test.controller.dispose()
  })

  it('returns after nearby enemies disappear and physically regroups at the original route', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[0]
    squad.members.forEach(npc => asTest(npc).move(0, 0))
    test.controller.noteHit(squad.members[0], false)
    squad.members.forEach(npc => asTest(npc).move(40, 0))
    test.frame()
    expect(squad.members.every(npc => npc.encounterAggroState === 'returning')).toBe(true)
    squad.members.forEach(npc => asTest(npc).move(0, 0))
    test.frame()
    expect(squad.state).toBe('REGROUPING')
    test.controller.updateTravel(squad.leader!, .016, new THREE.Vector3())
    expect(asTest(squad.leader!).formationGoal?.equals(squad.route[squad.waypoint])).toBe(true)
    expect(asTest(squad.leader!).combatPosition.toArray()).toEqual([0, 0, 0])
    const goal = squad.route[squad.waypoint]
    squad.members.forEach(npc => asTest(npc).move(goal.x, goal.z))
    test.frame()
    expect(squad.state).toBe('PATROLLING')
    test.controller.dispose()
  })

  it('uses one route leader and trail followers and replaces the leader only after human death', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[6], first = squad.leader!
    asTest(first).mount!.dead = true
    test.frame()
    expect(squad.leader).toBe(first)
    asTest(first).dead = true
    test.frame()
    expect(squad.leader).toBe(squad.members[1])
    for (const npc of squad.members.filter(npc => !npc.dead)) test.controller.updateTravel(npc, .016, new THREE.Vector3())
    expect(asTest(squad.leader!).assignFormationTarget).toHaveBeenCalledOnce()
    for (const npc of squad.members.slice(2)) expect(asTest(npc).activeFollowTarget).toBe(squad.leader)
    expect(test.created).toHaveLength(60)
    test.controller.dispose()
  })

  it('restores follower movement after combat has cleared its previous follow formation', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[0], follower = asTest(squad.members[1])
    squad.members.forEach(npc => asTest(npc).move(0, 0))
    test.controller.updateTravel(squad.members[1], .016, new THREE.Vector3())
    expect(follower.assignFollowTarget).toHaveBeenCalledOnce()
    test.controller.noteHit(squad.members[0], false)
    expect(follower.formationCommandId).toBeNull()
    test.frame()
    expect(squad.state).toBe('REGROUPING')
    test.controller.updateTravel(squad.members[1], .016, new THREE.Vector3())
    expect(follower.assignFollowTarget).toHaveBeenCalledTimes(2)
    expect(follower.activeFollowTarget).toBe(squad.leader)
    test.controller.dispose()
  })

  it('reinforces only a complete human wipe from a safe edge while preserving player-ridden retired horses', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[6], initial = [...squad.members]
    initial.slice(0, -1).forEach(npc => { asTest(npc).die() })
    test.frame()
    expect(test.created).toHaveLength(60)
    expect(squad.members).toEqual(initial)
    const oldHorse = test.horses[0]
    oldHorse.riderPlayer = {}
    asTest(initial[initial.length - 1]).die()
    test.frame()
    expect(squad.members).toHaveLength(10)
    expect(squad.state).toBe('ENTERING')
    expect(squad.generation).toBe(1)
    expect(test.created).toHaveLength(70)
    expect(squad.members.every(npc => Math.abs(npc.combatPosition.z) >= 335 && Math.abs(npc.combatPosition.z) <= 345)).toBe(true)
    expect(squad.members.every(npc => npc.combatantId.endsWith(':wave:1') && !npc.respawnEnabled)).toBe(true)
    expect(test.controller.mounts).toHaveLength(31)
    expect(oldHorse.dispose).not.toHaveBeenCalled()
    expect(oldHorse.riderPlayer).toBeTruthy()
    const position = squad.leader!.combatPosition.clone()
    test.controller.updateTravel(squad.leader!, .016, new THREE.Vector3())
    expect(squad.leader!.combatPosition.equals(position)).toBe(true)
    expect(asTest(squad.leader!).formationGoal!.distanceTo(position)).toBeGreaterThan(60)
    test.controller.dispose()
    expect(oldHorse.dispose).toHaveBeenCalledOnce()
  })

  it('keeps sensing and peaceful travel outside the shared navigation frame budget', () => {
    const test = setup(); test.isolate()
    const begin = vi.spyOn(test.navigation, 'beginFrame'), paths = vi.spyOn(test.navigation, 'queryPath')
    test.frame()
    expect(test.created.every(npc => !npc.updateTownTravel.mock.calls.length)).toBe(true)
    for (const npc of test.controller.actors) test.controller.updateTravel(npc, .016, new THREE.Vector3())
    expect(test.created.every(npc => npc.updateTownTravel.mock.calls.length === 1)).toBe(true)
    expect(test.created.filter(npc => npc.assignFormationTarget.mock.calls.length)).toHaveLength(9)
    expect(begin).not.toHaveBeenCalled()
    expect(paths).not.toHaveBeenCalled()
    test.controller.dispose()
  })

  it('reads distant registered actors only once to build the spatial grid, without global per-sensor scans', () => {
    const test = setup()
    const distant = Array.from({ length: 60 }, (_, index) => new TestNpc({
      ...test.created[30].spec, actorId: `remote:guard:${index}`, x: -10000 - index * 100, z: -10000,
    }))
    const reads = distant.map(npc => vi.spyOn(npc, 'combatPosition', 'get'))
    test.frame(.4, distant as unknown as NPC[])
    expect(reads.every(read => read.mock.calls.length === 1)).toBe(true)
    test.frame(.4, distant as unknown as NPC[])
    expect(reads.every(read => read.mock.calls.length === 2)).toBe(true)
    test.controller.dispose()
  })

  it('retains dead generations for normal fade updates without sensing, following, or selecting them as leaders', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[0], previous = [...squad.members]
    previous.forEach(npc => { asTest(npc).dead = true })
    const reads = previous.map(npc => vi.spyOn(asTest(npc), 'combatPosition', 'get'))
    test.frame(); test.frame(60)
    expect(previous.every(npc => test.controller.actors.includes(npc) && test.controller.combatEnabled(npc))).toBe(true)
    expect(squad.leader?.dead).toBe(false)
    expect(previous).not.toContain(squad.leader)
    expect(squad.members.some(npc => previous.includes(npc))).toBe(false)
    for (const dead of previous) test.controller.updateTravel(dead, .016, new THREE.Vector3())
    expect(reads.every(read => read.mock.calls.length === 0)).toBe(true)
    expect(previous.every(npc => !asTest(npc).updateTownTravel.mock.calls.length && !asTest(npc).dispose.mock.calls.length)).toBe(true)
    test.controller.dispose()
  })

  it('prunes only retired generations after the existing death presentation, preserving pending deaths and current casualties', () => {
    const test = setup(); test.isolate()
    const squad = test.controller.squads[6], old = [...squad.members]
    const priorMounts = [...test.controller.mounts]
    old.slice(0, -1).forEach(npc => {
      asTest(npc).die()
      asTest(npc).updateDeathPresentation(DEATH_DESPAWN_DELAY_SECONDS)
    })
    test.frame()
    expect(test.controller.actors).toHaveLength(60)
    expect(old.slice(0, -1).every(npc => test.controller.owns(npc) && !asTest(npc).disposed)).toBe(true)
    asTest(old[old.length - 1]).die()
    test.frame()
    expect(test.controller.actors).toHaveLength(61)
    expect(old.slice(0, -1).every(npc => !test.controller.owns(npc) && !test.controller.combatEnabled(npc))).toBe(true)
    expect(old.slice(0, -1).every(npc => asTest(npc).dispose.mock.calls.length === 1)).toBe(true)
    const last = old[old.length - 1]
    expect(test.controller.owns(last)).toBe(true)
    asTest(last).group.visible = false
    asTest(last).updateDeathPresentation(DEATH_DESPAWN_DELAY_SECONDS - .01)
    test.frame()
    expect(test.controller.actors).toHaveLength(61)
    expect(test.controller.combatEnabled(last)).toBe(true)
    expect(asTest(last).dispose).not.toHaveBeenCalled()
    asTest(last).updateDeathPresentation(.01)
    const oldParticipants = [...test.controller.actors]
    test.controller.prepareFrame(.4, oldParticipants, test.player)
    expect(test.controller.actors).toHaveLength(60)
    expect(test.controller.actors).not.toContain(last)
    expect(test.controller.owns(last)).toBe(false)
    expect(asTest(last).dispose).toHaveBeenCalledOnce()
    expect(priorMounts.slice(0, 10).every(mount => !test.controller.mounts.includes(mount))).toBe(true)
    expect(priorMounts.slice(10).every(mount => test.controller.mounts.includes(mount))).toBe(true)
    expect(test.horses.slice(0, 10).every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
    test.controller.dispose()
    expect(old.every(npc => asTest(npc).dispose.mock.calls.length === 1)).toBe(true)
  })

  it('bounds actors and mounts across eight full-squad waves, retaining a ridden horse until dismount and finishing dead mounts', () => {
    const test = setup(); test.isolate()
    const retainedHorse = test.horses[0]
    retainedHorse.dead = true
    const borrowedHorse = test.horses[1]
    borrowedHorse.riderPlayer = {}
    for (let wave = 1; wave <= 8; wave++) {
      const previous = test.controller.squads.flatMap(squad => squad.members)
      previous.forEach(npc => asTest(npc).die())
      test.frame(); test.frame(60)
      expect(test.controller.actors).toHaveLength(120)
      expect(test.controller.actors.filter(npc => !npc.dead)).toHaveLength(60)
      previous.forEach(npc => asTest(npc).updateDeathPresentation(DEATH_DESPAWN_DELAY_SECONDS - .01))
      test.frame()
      expect(previous.every(npc => test.controller.combatEnabled(npc) && !asTest(npc).disposed)).toBe(true)
      previous.forEach(npc => asTest(npc).updateDeathPresentation(.01))
      test.frame()
      expect(test.controller.actors).toHaveLength(60)
      expect(previous.every(npc => !test.controller.owns(npc) && !test.controller.combatEnabled(npc))).toBe(true)
      expect(previous.every(npc => asTest(npc).dispose.mock.calls.length === 1)).toBe(true)
      expect(test.controller.mounts).toHaveLength(32)
      expect(test.horses.filter(horse => horse.disposed).every(horse => horse.dispose.mock.calls.length === 1)).toBe(true)
      expect(test.controller.mounts).toContain(retainedHorse)
      expect(test.controller.mounts).toContain(borrowedHorse)
      expect(borrowedHorse.riderPlayer).toBeTruthy()
    }
    expect(test.created).toHaveLength(540)
    retainedHorse.deathPresentationComplete = true
    test.frame()
    expect(test.controller.mounts).toHaveLength(31)
    expect(retainedHorse.dispose).toHaveBeenCalledOnce()
    borrowedHorse.riderPlayer = null
    test.frame()
    expect(test.controller.mounts).toHaveLength(30)
    expect(borrowedHorse.dispose).toHaveBeenCalledOnce()
    test.frame()
    expect(borrowedHorse.dispose).toHaveBeenCalledOnce()
    test.controller.dispose()
    expect(test.created.every(npc => npc.dispose.mock.calls.length === 1)).toBe(true)
    expect(test.horses.every(horse => horse.dispose.mock.calls.length === 1)).toBe(true)
  })

  it('reports real NPC death completion from the original dead update, independent of visibility and reset on respawn', () => {
    const npc = new NPC(new THREE.Scene(), 0, 0, Faction.BANDIT, 'viking', AIType.MELEE, 'Presentation probe', 1, false,
      { meleeWeaponId: 'rusty_dagger', rangedWeaponId: null, shieldId: null, mountId: null })
    npc.respawnEnabled = false
    const player = { dead: false } as Player
    const update = (dt: number) => npc.update(dt, player, [], [], [], null as unknown as HpBar, () => {}, () => {})
    try {
      npc.group.visible = false
      expect(npc.deathPresentationComplete).toBe(false)
      npc.takeDamage(npc.maxHp * 10)
      expect(npc.deathPresentationComplete).toBe(false)
      npc.group.visible = false
      update(DEATH_DESPAWN_DELAY_SECONDS - .01)
      expect(npc.deathPresentationComplete).toBe(false)
      update(.01)
      expect(npc.deathPresentationComplete).toBe(true)
      npc.group.visible = true
      expect(npc.deathPresentationComplete).toBe(true)
      npc.respawn()
      expect(npc.dead).toBe(false)
      expect(npc.deathPresentationComplete).toBe(false)
      npc.takeDamage(npc.maxHp * 10)
      update(.01)
      expect(npc.deathPresentationComplete).toBe(false)
    } finally { npc.dispose() }
  })

  it.each(['roman', 'viking'] as const)('connects actual %s Town spawn slots, loops, and reinforced edge entries to each own sector', faction => {
    // Canvas pixels are irrelevant to topology; all geometry and obstacle creation runs through the real TownWorld.
    const context = new Proxy<Record<string, unknown>>({}, { get: (target, key: string) => target[key] ?? (() => {}) })
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) })
    vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} })
    let world: TownWorld | undefined
    let test: ReturnType<typeof setup> | undefined
    try {
      world = new TownWorld(faction, new THREE.Scene())
      expect(world.obstacles.length).toBeGreaterThan(100)
      test = setup('captain', faction, faction, world.obstacles)
      const clearSlot = (member: NPC) => {
        const cell = test!.navigation.grid.worldToCell(member.combatPosition)
        expect(cell, `${member.combatantId} navigation cell`).not.toBeNull()
        expect(test!.navigation.grid.isBlocked(cell!), `${member.combatantId} obstacle-free cell`).toBe(false)
        const radius = member.isMounted ? 1.3 : .65
        for (const obstacle of world!.obstacles) {
          const box = obstacle.navigationBox ?? obstacle.box
          const dx = Math.max(box.min.x - member.combatPosition.x, 0, member.combatPosition.x - box.max.x)
          const dz = Math.max(box.min.z - member.combatPosition.z, 0, member.combatPosition.z - box.max.z)
          expect(Math.hypot(dx, dz), `${member.combatantId} collision clearance`).toBeGreaterThanOrEqual(radius)
        }
      }
      for (const squad of test.controller.squads) {
        for (const [index, point] of squad.route.entries()) {
          expect(test.navigation.areConnected(point, squad.route[(index + 1) % squad.route.length]), `${squad.id} route ${index}`).toBe(true)
        }
        for (const member of squad.members) {
          clearSlot(member)
          expect(test.navigation.areConnected(member.combatPosition, squad.route[squad.waypoint]), member.combatantId).toBe(true)
          asTest(member).dead = true
        }
      }
      test.frame(); test.frame(60)
      for (const squad of test.controller.squads) for (const member of squad.members) {
        clearSlot(member)
        expect(Math.max(Math.abs(member.combatPosition.x), Math.abs(member.combatPosition.z)), member.combatantId).toBeGreaterThanOrEqual(335)
        expect(Math.max(Math.abs(member.combatPosition.x), Math.abs(member.combatPosition.z)), member.combatantId).toBeLessThanOrEqual(345)
        expect(test.navigation.areConnected(member.combatPosition, squad.route[squad.waypoint]), `${member.combatantId} edge entry`).toBe(true)
      }
      expect(test.created).toHaveLength(120)
    } finally {
      test?.controller.dispose()
      world?.dispose()
      vi.unstubAllGlobals()
    }
  })
})
