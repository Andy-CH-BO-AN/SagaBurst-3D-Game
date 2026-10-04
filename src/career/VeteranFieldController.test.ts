import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { Faction, type NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { claimCareerMission, createCareerProfile, type CareerProfile } from './CareerProfile'
import { BanditMissionController, VETERAN_FIELD_LAYOUT } from './BanditMissionController'
import { VETERAN_MISSION_IDS, acceptVeteranMission, createVeteranRoster, createVeteranSpawnSpec } from './VeteranMission'
import type { TownActorSpec } from '../town/TownRules'
import type { TownWorld } from '../town/TownWorld'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'
import type { ObstacleData } from '../world/Terrain'

vi.mock('./MissionGuide', () => ({
  MissionGuide: class {
    update(): void {}
    updateTownDefense(): void {}
    updateOutpostDefense(): void {}
    hide(): void {}
    dispose(): void {}
  },
}))

class FieldTestMount {
  readonly group = new THREE.Group()
  readonly baseSpeed = 12
  readonly maxHp = 100
  currentHp = 100
  disposed = false
  get dead(): boolean { return this.currentHp <= 0 }
  takeDamage(amount: number): boolean { this.currentHp = Math.max(0, this.currentHp - amount); return true }
  dispose(): void { this.disposed = true }
}

class FieldTestNpc {
  readonly group = new THREE.Group()
  dead = false
  respawnEnabled = true
  mount: FieldTestMount | null = null
  presetId?: NpcSpawnSpec['presetId']
  tier: 1 | 2 | 3 | 4
  squadId?: NpcSpawnSpec['squadId']
  tacticalOrder = 'attack'
  hp = 100
  readonly maxHp = 100
  disposed = false
  temporaryTier?: 1 | 2 | 3 | 4
  temporarySquad?: NpcSpawnSpec['squadId']
  temporaryLoadout?: UnitLoadout
  originalLoadout: UnitLoadout = { meleeWeaponId: 'old-town-sword' }
  formationTarget: { commandId: number; position: THREE.Vector3; facing: THREE.Vector3; reached: boolean } | null = null
  restoreCombatLoadout = vi.fn(() => {
    if (this.temporaryTier !== undefined) this.tier = this.originalTier
    this.squadId = this.originalSquad
    this.temporaryTier = undefined
    this.temporarySquad = undefined
    this.temporaryLoadout = undefined
  })
  private readonly originalTier: 1 | 2 | 3 | 4
  private readonly originalSquad: NpcSpawnSpec['squadId']

  constructor(
    readonly combatantId: string,
    readonly name = 'Test cavalry',
    readonly faction: Faction = Faction.TOWN,
    readonly characterFaction: 'roman' | 'viking' = 'roman',
    tier: 1 | 2 | 3 | 4 = 2,
    squadId?: NpcSpawnSpec['squadId'],
    x = 0,
    z = 0,
  ) {
    this.tier = tier
    this.originalTier = tier
    this.squadId = squadId
    this.originalSquad = squadId
    this.group.position.set(x, 0, z)
  }

  get combatPosition(): THREE.Vector3 { return this.mount && !this.mount.dead ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return Boolean(this.mount && !this.mount.dead) }
  get hpRatio(): number { return this.hp / this.maxHp }
  applyTemporaryCombatLoadout(loadout: UnitLoadout, tier?: 1 | 2 | 3 | 4, squadId?: NpcSpawnSpec['squadId']): void {
    this.temporaryTier = tier
    this.temporarySquad = squadId
    this.temporaryLoadout = { ...loadout }
    if (tier !== undefined) this.tier = tier
    if (squadId !== undefined) this.squadId = squadId
  }
  mountVehicle(mount: FieldTestMount): void { this.mount = mount }
  dismountFromMount(): void { this.mount = null }
  restoreCombatHealth(hp: number): void { if (hp <= 0) { this.hp = 0; this.dead = true } else if (!this.dead) this.hp = Math.min(this.maxHp, hp) }
  takeDamage(amount: number): boolean { this.hp = Math.max(0, this.hp - amount); if (!this.hp) this.dead = true; return true }
  assignFormationTarget = vi.fn((commandId: number, position: THREE.Vector3, facing: THREE.Vector3) => {
    this.formationTarget = { commandId, position: position.clone(), facing: facing.clone(), reached: false }
    this.tacticalOrder = 'formation'
  })
  assignFollowTarget = vi.fn()
  isFormationTargetReached(commandId: number): boolean { return this.formationTarget?.commandId === commandId && this.formationTarget.reached }
  get formationCommandId(): number | null { return this.formationTarget?.commandId ?? null }
  moveToFormationTarget(): number {
    if (!this.formationTarget) return 0
    const before = this.combatPosition.clone()
    this.group.position.copy(this.formationTarget.position)
    if (this.mount) this.mount.group.position.copy(this.formationTarget.position)
    this.formationTarget.reached = true
    return before.distanceTo(this.combatPosition)
  }
  setTacticalOrder(order: string): void { this.tacticalOrder = order }
  dispose(): void { this.disposed = true }
}

const townRoleFor = (role: string): TownActorSpec['role'] => role as TownActorSpec['role']

class FieldTestPlayer {
  readonly group = new THREE.Group()
  dead = false
  hp = 100
  staminaValue = 100
  get combatPosition(): THREE.Vector3 { return this.group.position }
}

function buildResidents(roster: ReturnType<typeof createVeteranRoster>) {
  return roster.friendly.filter(unit => unit.source === 'town').map((unit, index) => {
    const npc = new FieldTestNpc(unit.actorId, unit.heroRole === 'ranger' ? 'Maki' : unit.heroRole === 'captain' ? 'Captain' : 'Town cavalry', Faction.TOWN, 'roman', 2)
    npc.group.position.set(-24 + (index % 6) * 8, 0, 18 + Math.floor(index / 6) * 7)
    const homeMount = unit.mounted ? new FieldTestMount() : undefined
    if (homeMount) { homeMount.group.position.copy(npc.group.position); npc.mountVehicle(homeMount) }
    const spec = { id: unit.actorId, role: townRoleFor(unit.townRole!), x: npc.group.position.x, z: npc.group.position.z, index }
    return { spec, npc, homeMount }
  })
}

function setupField(
  templateId: typeof VETERAN_MISSION_IDS[number],
  initialProfile?: CareerProfile,
  existingResidents?: ReturnType<typeof buildResidents>,
  existingPlayer?: FieldTestPlayer,
  deferStart = false,
  obstacles: ObstacleData[] = [],
) {
  const missionId = initialProfile?.activeMission?.id ?? `controller-${templateId}`
  const roster = createVeteranRoster(templateId, 'roman', missionId,
    initialProfile ? initialProfile.activeMission?.veteranRosterVersion ?? 1 : 3,
    initialProfile?.activeMission?.borrowedActorIds)
  const index = VETERAN_MISSION_IDS.indexOf(templateId)
  const base: CareerProfile = {
    ...createCareerProfile('roman'),
    rank: 'veteran', totalMerit: 900, availableMerit: 900, ownedMounts: ['horse'],
    completedCareerMissionTemplateIds: [...VETERAN_MISSION_IDS.slice(0, index)],
  }
  let profile = initialProfile ?? acceptVeteranMission(base, templateId, { missionId })!
  const residents = existingResidents ?? buildResidents(roster)
  const residentCaptain = residents.find(resident => resident.npc.combatantId === 'captain')?.npc
  const missionCaptain = residentCaptain ?? new FieldTestNpc('captain')
  const player = existingPlayer ?? new FieldTestPlayer()
  const npcFactories: { spec: NpcSpawnSpec; npc: FieldTestNpc }[] = []
  const mountFactories: FieldTestMount[] = []
  const controller = new BanditMissionController(
    new THREE.Scene(),
    { camps: [], obstacles } as unknown as TownWorld,
    new NavigationWorld(),
    missionCaptain as unknown as NPC,
    residents as unknown as { spec: TownActorSpec; npc: NPC; homeMount?: Mount }[],
    () => player as unknown as Player,
    () => profile,
    next => { profile = next; return true },
    {
      createNpc: (spec, actorId) => {
        const npc = new FieldTestNpc(actorId, spec.name, spec.faction, spec.characterFaction, spec.tier, spec.squadId, spec.x, spec.z)
        npc.presetId = spec.presetId
        npcFactories.push({ spec, npc })
        return npc as unknown as NPC
      },
      createMount: () => {
        const mount = new FieldTestMount()
        mountFactories.push(mount)
        return mount as unknown as Mount
      },
    },
  )
  const start = deferStart ? false : controller.startActiveMission()
  return { controller, profile: () => profile, roster, residents, npcFactories, mountFactories, player, start }
}

describe('Veteran field controller staging and lifecycle', () => {
  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'keeps borrowed Town actors at home and orders them to ride or walk to muster in %s', templateId => {
    const setup = setupField(templateId, undefined, undefined, undefined, true)
    const initial = new Map(setup.residents.map(({ npc }) => [npc.combatantId, npc.combatPosition.clone()]))
    expect(setup.controller.startActiveMission()).toBe(true)

    for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
      const npc = setup.residents.find(resident => resident.npc.combatantId === unit.actorId)!.npc as unknown as FieldTestNpc
      expect(npc.combatPosition.distanceTo(initial.get(unit.actorId)!)).toBeLessThan(.001)
      expect(npc.formationTarget ?? npc.assignFollowTarget.mock.calls.length > 0).toBeTruthy()
    }
    setup.controller.dispose()
  })

  it('spawns temporary support at an in-bounds approach and orders it toward the Town muster', () => {
    const setup = setupField('veteran-scout-hunters')
    expect(setup.start).toBe(true)
    const temporary = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
    expect(temporary.length).toBe(77)
    expect(temporary.every(({ npc }) => Math.abs(npc.combatPosition.x) < 280 && Math.abs(npc.combatPosition.z) < 280)).toBe(true)
    expect(temporary.every(({ npc }) => npc.combatPosition.distanceTo(new THREE.Vector3(55, 0, -55)) > 80)).toBe(true)
    expect(temporary.every(({ npc }) => (npc as unknown as FieldTestNpc).formationTarget !== null)).toBe(true)
    const support = temporary.map(({ npc }) => npc as unknown as FieldTestNpc)
    const averageTravel = support.reduce((sum, npc) => sum + npc.moveToFormationTarget(), 0) / support.length
    expect(averageTravel).toBeGreaterThan(80)
    expect(support.every(npc => npc.isFormationTargetReached(9001))).toBe(true)
    setup.controller.updateFlow(.016, 0)
    expect(support.every(npc => npc.formationCommandId === 9000)).toBe(true)
    setup.controller.dispose()
  })

  it('routes temporary support through the Town entry before assigning its final muster slot', () => {
    const setup = setupField('veteran-scout-hunters')
    const support = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
      .map(({ npc }) => npc as unknown as FieldTestNpc)
    expect(support).toHaveLength(77)
    expect(support.every(npc => Math.abs(npc.formationTarget!.position.x - VETERAN_FIELD_LAYOUT.townEntry.x) < 20
      && Math.abs(npc.formationTarget!.position.z - VETERAN_FIELD_LAYOUT.townEntry.z) < 45)).toBe(true)
    const entryTravel = support.reduce((sum, npc) => sum + npc.moveToFormationTarget(), 0) / support.length
    expect(entryTravel).toBeGreaterThan(80)

    setup.controller.updateFlow(.016, 0)
    expect(support.every(npc => Math.abs(npc.formationTarget!.position.x - VETERAN_FIELD_LAYOUT.rally.x) < 20
      && Math.abs(npc.formationTarget!.position.z - VETERAN_FIELD_LAYOUT.rally.z) < 45)).toBe(true)
    for (const npc of support) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
    const captain = setup.controller.friendlies.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
    for (const npc of setup.controller.friendlies as unknown as FieldTestNpc[]) npc.moveToFormationTarget()
    setup.player.group.position.copy(captain.combatPosition)
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('MARCHING')
    setup.controller.dispose()
  })

  it('places muster and courtyard goals outside Town building and market obstacle volumes', () => {
    const obstacle = (x: number, z: number, width: number, depth: number): ObstacleData => ({
      box: new THREE.Box3(new THREE.Vector3(x - width / 2, -2, z - depth / 2), new THREE.Vector3(x + width / 2, 12, z + depth / 2)),
      isBarricade: false,
    })
    const obstacles = [
      obstacle(11, 23, 4, 2), // solid market stall
      obstacle(34, 30, 7, 7), // barracks
      obstacle(-12, 52, 9, 8), // home
      obstacle(34, -15, 8, 7), obstacle(72, -15, 8, 7), // training tents
      obstacle(86, -9, 1, 38), // fence
    ]
    for (const templateId of ['veteran-scout-hunters', 'veteran-tragedy-of-the-scouts'] as const) {
      const setup = setupField(templateId, undefined, undefined, undefined, false, obstacles)
      const goals = setup.controller.friendlies.filter(npc => !npc.dead)
        .map(npc => (npc as unknown as FieldTestNpc).formationTarget?.position ?? npc.combatPosition)
      if (templateId === 'veteran-scout-hunters') {
        const support = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
          .map(({ npc }) => npc as unknown as FieldTestNpc)
        for (const npc of support) npc.moveToFormationTarget()
        setup.controller.updateFlow(.016, 0)
        goals.push(...setup.controller.friendlies.filter(npc => !npc.dead)
          .map(npc => (npc as unknown as FieldTestNpc).formationTarget?.position ?? npc.combatPosition))
      }
      const enemies = setup.controller.missionBandits.map(npc => npc.combatPosition)
      for (const point of [...goals, ...enemies]) {
        expect(Math.abs(point.x)).toBeLessThan(280)
        expect(Math.abs(point.z)).toBeLessThan(280)
        expect(obstacles.some(item => item.box.clone().expandByScalar(1.05).containsPoint(new THREE.Vector3(point.x, Math.max(point.y + .8, item.box.min.y), point.z)))).toBe(false)
      }
      const navigation = new NavigationWorld()
      navigation.sync(obstacles)
      expect(navigation.areConnected(templateId === 'veteran-tragedy-of-the-scouts' ? VETERAN_FIELD_LAYOUT.scoutEnemyCourtyard : VETERAN_FIELD_LAYOUT.supportApproach,
        templateId === 'veteran-tragedy-of-the-scouts' ? VETERAN_FIELD_LAYOUT.scoutRally : VETERAN_FIELD_LAYOUT.rally)).toBe(true)
      setup.controller.dispose()
    }
  })

  it('keeps every Veteran spawn inside terrain bounds', () => {
    const setup = setupField('veteran-village-intercept')
    expect(setup.start).toBe(true)
    for (const actor of [...setup.controller.friendlies, ...setup.controller.missionBandits]) {
      expect(Math.abs(actor.combatPosition.x)).toBeLessThan(280)
      expect(Math.abs(actor.combatPosition.z)).toBeLessThan(280)
      if (actor.mount && !actor.mount.dead) {
        expect(Math.abs(actor.mount.group.position.x)).toBeLessThan(280)
        expect(Math.abs(actor.mount.group.position.z)).toBeLessThan(280)
      }
    }
    setup.controller.dispose()
  })

  it('faces each held enemy leader toward the friendly rally', () => {
    const setup = setupField('veteran-village-intercept')
    expect(setup.start).toBe(true)
    const friendlyLeader = setup.controller.friendlies.find(candidate => candidate.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
    for (const actor of setup.controller.missionBandits) {
      const npc = actor as unknown as FieldTestNpc
      const towardFriendly = friendlyLeader.combatPosition.clone().sub(actor.combatPosition).setY(0).normalize()
      const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), npc.group.rotation.y)
      expect(facing.dot(towardFriendly)).toBeGreaterThan(.75)
    }
    setup.controller.dispose()
  })

  it.each([
    ['veteran-scout-hunters', 100, 40, 22, 77, 40],
    ['veteran-village-intercept', 50, 100, 49, 0, 100],
    ['veteran-spear-line-hunt', 50, 100, 48, 1, 100],
    ['veteran-tragedy-of-the-scouts', 20, 100, 2, 17, 100],
  ] as const)('stages the exact Veteran roster for %s', (id, friendlyTotal, enemyTotal, borrowedCount, temporaryFriendlyCount, tempEnemyCount) => {
    const setup = setupField(id)
    expect(setup.start).toBe(true)
    expect(setup.controller.friendlies).toHaveLength(friendlyTotal - 1)
    expect(setup.controller.missionBandits).toHaveLength(enemyTotal)
    expect(setup.roster.friendly.filter(unit => unit.source === 'town')).toHaveLength(borrowedCount)
    expect(setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)).toHaveLength(temporaryFriendlyCount)
    expect(setup.npcFactories.filter(({ spec }) => spec.faction === Faction.ENEMY)).toHaveLength(tempEnemyCount)
    expect(setup.controller.missionBandits.every(npc => npc.faction === Faction.ENEMY && npc.characterFaction === 'viking')).toBe(true)
    expect(setup.controller.friendlies.filter(npc => npc.tier === 4)).toHaveLength(setup.roster.friendly.filter(unit => unit.tier === 4).length)
    expect(setup.controller.friendlies.filter(npc => npc.tier === 3)).toHaveLength(setup.roster.friendly.filter(unit => unit.tier === 3).length)
    for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
      const actor = setup.controller.friendlies.find(npc => npc.combatantId === unit.actorId) as unknown as FieldTestNpc
      expect(actor).toBe(setup.residents.find(resident => resident.npc === actor)?.npc)
      expect(actor.temporaryTier).toBe(unit.tier)
      expect(actor.temporarySquad).toBe(unit.squadId)
    }
    if (id === 'veteran-tragedy-of-the-scouts') expect(setup.controller.missionBandits.every(npc => npc.tacticalOrder === 'charge')).toBe(true)
    setup.controller.cleanupMission()
    for (const unit of setup.roster.friendly.filter(unit => unit.source === 'town')) {
      const actor = setup.residents.find(resident => resident.npc.combatantId === unit.actorId)!.npc as unknown as FieldTestNpc
      expect(actor.tier).toBe(2)
      expect(actor.squadId).toBeUndefined()
      expect(actor.temporaryTier).toBeUndefined()
      expect(actor.disposed).toBe(false)
      expect(actor.restoreCombatLoadout).toHaveBeenCalledTimes(1)
    }
    expect(setup.npcFactories.every(({ npc }) => npc.disposed)).toBe(true)
    expect(setup.mountFactories.every(mount => mount.disposed)).toBe(true)
    setup.controller.dispose()
  })

  it('disposes a temporary substitute mount when a borrowed rider has no home mount', () => {
    const roster = createVeteranRoster('veteran-scout-hunters', 'roman', 'borrowed-mount')
    const residents = buildResidents(roster)
    const captain = residents.find(resident => resident.npc.combatantId === 'captain')!
    captain.homeMount?.dispose()
    captain.homeMount = undefined
    captain.npc.dismountFromMount()
    const setup = setupField('veteran-scout-hunters', undefined, residents)
    expect(setup.start).toBe(true)
    const substitute = setup.mountFactories[0]
    expect(captain.npc.mount).not.toBeNull()
    setup.controller.cleanupMission()
    expect(substitute.disposed).toBe(true)
    expect(captain.npc.mount).toBeNull()
    setup.controller.dispose()
  })

  it.each(['veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'restores the same reequipped residents, mounts, and shortages after reloading %s', templateId => {
    const setup = setupField(templateId)
    const borrowed = setup.residents.filter(({ spec }) => spec.role.endsWith('_cavalry'))
    expect(borrowed).toHaveLength(47)
    for (const { npc, homeMount } of borrowed) {
      expect(npc.mount).toBe(homeMount)
      expect(npc.temporaryTier).toBe(3)
      expect(npc.temporaryLoadout).toEqual(createVeteranSpawnSpec(setup.roster.friendly.find(unit => unit.actorId === npc.combatantId)!, 'roman').loadout)
    }
    borrowed[0].npc.hp = 37
    const savedPosition = borrowed[0].npc.combatPosition.clone()
    expect(setup.controller.persistRuntimeProgress(true)).toBe(true)
    setup.controller.cleanupMission()
    for (const { npc, homeMount } of borrowed) {
      expect(npc.temporaryLoadout).toBeUndefined()
      expect(npc.tier).toBe(2)
      expect(npc.mount).toBe(homeMount)
      expect(npc.respawnEnabled).toBe(true)
    }
    const reloaded = setupField(templateId, setup.profile(), setup.residents, setup.player)
    expect(reloaded.start).toBe(true)
    expect(reloaded.controller.friendlies.filter(npc => borrowed.some(resident => resident.npc === npc as unknown as FieldTestNpc))).toHaveLength(47)
    expect(borrowed[0].npc.hp).toBe(37)
    expect(borrowed[0].npc.combatPosition.x).toBe(savedPosition.x)
    expect(borrowed[0].npc.combatPosition.z).toBe(savedPosition.z)
    expect(reloaded.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)).toHaveLength(templateId === 'veteran-village-intercept' ? 0 : 1)
    reloaded.controller.dispose()
    setup.controller.dispose()
  })

  it('restores the latest Player mount state when a four-squad charge checkpoints', () => {
    const setup = setupField('veteran-scout-hunters')
    expect(setup.start).toBe(true)
    setup.controller.onMarchStarted = vi.fn()
    setup.controller.onSweepCharge = vi.fn()
    const captain = setup.controller.friendlies.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)!.actorId)!
    const temporary = setup.npcFactories.filter(({ spec }) => spec.faction === Faction.TOWN)
      .map(({ npc }) => npc as unknown as FieldTestNpc)
    for (const npc of temporary) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    for (const npc of setup.controller.friendlies as unknown as FieldTestNpc[]) npc.moveToFormationTarget()
    setup.player.group.position.copy(captain.combatPosition)
    setup.controller.updateFlow(.016, 0)
    expect(setup.controller.onMarchStarted).toHaveBeenCalledTimes(1)
    const mission = setup.profile().activeMission!
    expect(mission.phase).toBe('MARCHING')
    expect(mission.followVoicePlayed).toBe(true)
    mission.mountState = { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] }
    const captainAgain = setup.controller.friendlies.find(npc => npc.combatantId === captain.combatantId)!
    captainAgain.combatPosition.set(161, 0, 20)
    setup.controller.updateFlow(.016, 0)
    expect(setup.controller.onSweepCharge).toHaveBeenCalledTimes(1)
    expect(setup.profile().activeMission).toMatchObject({ phase: 'ENGAGING', chargedSquadIds: [1, 2, 3, 4], followVoicePlayed: true,
      mountState: { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] } })
    setup.controller.cleanupMission()
    const reloadSetup = setupField('veteran-scout-hunters', setup.profile(), setup.residents, setup.player, true)
    reloadSetup.controller.onMarchStarted = vi.fn()
    reloadSetup.controller.onSweepCharge = vi.fn()
    expect(reloadSetup.controller.startActiveMission()).toBe(true)
    expect(reloadSetup.profile().activeMission?.phase).toBe('ENGAGING')
    expect(reloadSetup.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(reloadSetup.controller.onSweepCharge).not.toHaveBeenCalled()
    expect(reloadSetup.profile().activeMission).toMatchObject({ phase: 'ENGAGING', chargedSquadIds: [1, 2, 3, 4],
      mountState: { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] } })
    reloadSetup.controller.cleanupMission()
    const finalReload = setupField('veteran-scout-hunters', reloadSetup.profile(), reloadSetup.residents, reloadSetup.player, true)
    finalReload.controller.onMarchStarted = vi.fn()
    finalReload.controller.onSweepCharge = vi.fn()
    expect(finalReload.controller.startActiveMission()).toBe(true)
    expect(finalReload.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(finalReload.controller.onSweepCharge).not.toHaveBeenCalled()
    finalReload.controller.dispose()
    reloadSetup.controller.dispose()
    setup.controller.dispose()
  })

  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const)(
    'starts %s when NPCs reach their slots even while the Player stays far away', templateId => {
    const setup = setupField(templateId)
    expect(setup.start).toBe(true)
    const captain = setup.controller.friendlies.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)?.actorId)!
    setup.player.group.position.set(-150, 0, -150)
    setup.controller.onMarchStarted = vi.fn()
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
    const candidates = setup.controller.friendlies as unknown as FieldTestNpc[]
    const borrowedIds = new Set(setup.residents.map(resident => resident.npc.combatantId))
    const support = candidates.filter(npc => !borrowedIds.has(npc.combatantId))
    for (const npc of support) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    for (const npc of candidates.slice(0, Math.ceil(candidates.length * .8))) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
    for (const npc of candidates) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('MARCHING')
    expect(setup.player.combatPosition.distanceTo(captain.combatPosition)).toBeGreaterThan(100)
    expect(setup.controller.onMarchStarted).toHaveBeenCalledOnce()
    setup.controller.updateFlow(.016, 0)
    expect(setup.controller.onMarchStarted).toHaveBeenCalledOnce()
    setup.controller.dispose()
  })

  it('waits for a nearby Captain to walk to his own slot without snapping him into place', () => {
    const setup = setupField('veteran-village-intercept')
    const captain = setup.controller.missionLeader as unknown as FieldTestNpc
    const candidates = setup.controller.friendlies as unknown as FieldTestNpc[]
    for (const npc of candidates) if (npc !== captain) npc.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    for (const npc of candidates) if (npc !== captain) npc.moveToFormationTarget()
    const nearby = captain.formationTarget!.position.clone().add(new THREE.Vector3(-8, 0, 0))
    captain.combatPosition.copy(nearby)
    setup.player.group.position.copy(captain.combatPosition)
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('ASSEMBLING')
    expect(captain.combatPosition).toEqual(nearby)
    captain.moveToFormationTarget()
    setup.controller.updateFlow(.016, 0)
    expect(setup.profile().activeMission?.phase).toBe('MARCHING')
    setup.controller.dispose()
  })

  it('avoids the old world edge when restoring a legacy mountedMarchPosition', () => {
    const setup = setupField('veteran-scout-hunters', undefined, undefined, undefined, true)
    const profile = setup.profile()
    profile.activeMission = {
      ...profile.activeMission!, phase: 'MARCHING', mountedMarchPosition: { x: 110, z: -275 }, actorPositions: undefined,
    }
    expect(setup.controller.startActiveMission()).toBe(true)
    for (const actor of [...setup.controller.friendlies, ...setup.controller.missionBandits]) {
      expect(Math.abs(actor.combatPosition.x)).toBeLessThan(280)
      expect(Math.abs(actor.combatPosition.z)).toBeLessThan(280)
    }
    setup.controller.dispose()
  })

  it('restores legacy MARCHING borrowed actors around the saved mounted march anchor', () => {
    const setup = setupField('veteran-scout-hunters', undefined, undefined, undefined, true)
    const profile = setup.profile()
    profile.activeMission = {
      ...profile.activeMission!, phase: 'MARCHING', mountedMarchPosition: { x: 100, z: 100 }, actorPositions: undefined,
    }
    expect(setup.controller.startActiveMission()).toBe(true)
    const captain = setup.controller.friendlies.find(npc => npc.combatantId === 'captain')!
    expect(captain.combatPosition.x).toBeCloseTo(100)
    expect(captain.combatPosition.z).toBeCloseTo(100)
    setup.controller.dispose()
  })

  it('persists a held enemy squad activation only after effective damage reaches a Veteran target', () => {
    const setup = setupField('veteran-spear-line-hunt')
    expect(setup.start).toBe(true)
    const enemy = setup.roster.enemy.find(unit => unit.squadId === 3)!
    const damage = (appliedDamage: number, targetId = enemy.actorId) => setup.controller.events.emit({
      type: 'damage_applied',
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId, targetType: 'npc', name: 'Veteran target', allegiance: Faction.ENEMY, characterFaction: 'viking', squadId: enemy.squadId as NPC['squadId'] },
      method: 'projectile', requestedDamage: 20, appliedDamage,
    })
    damage(0)
    expect(setup.profile().activeMission?.engagedEnemySquadIds ?? []).toEqual([])
    damage(12, 'unrelated-enemy')
    expect(setup.profile().activeMission?.engagedEnemySquadIds ?? []).toEqual([])

    damage(12)

    expect(setup.profile().activeMission?.engagedEnemySquadIds).toContain(enemy.squadId)
    expect(setup.profile().activeMission?.actorPositions).toBeDefined()
    setup.controller.dispose()
  })

  it('persists the final 120 seconds before resolving a Player-dead NPC-survived victory', () => {
    const setup = setupField('veteran-tragedy-of-the-scouts')
    expect(setup.start).toBe(true)
    setup.controller.updateFlow(119.9, 0)
    expect(setup.profile().activeMission?.survivalElapsed).toBeCloseTo(119.9)
    setup.player.dead = true
    setup.controller.updateFlow(.1, 0)
    expect(setup.profile().activeMission?.survivalElapsed).toBe(120)
    expect(setup.controller.survivalElapsedSeconds).toBe(120)
    expect(setup.controller.evaluate(true)).toBe('victory')
    expect(setup.profile().activeMission?.survivalElapsed).toBe(120)
    expect(setup.profile().activeMission?.phase).toBe('ENGAGING')
    setup.controller.dispose()
  })

  it('continues VI after Player death while an NPC survives, but fails on an early full wipe', () => {
    const setup = setupField('veteran-tragedy-of-the-scouts')
    setup.player.dead = true
    setup.controller.friendlies.forEach(npc => ((npc as unknown as FieldTestNpc).dead = true))
    setup.controller.updateFlow(119.9, 0)
    expect(setup.controller.evaluate(true)).toBe('failure')
    setup.controller.dispose()
  })
})

const RETURN_MISSIONS = ['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt'] as const

function finishField(setup: ReturnType<typeof setupField>) {
  setup.controller.missionBandits.forEach(npc => npc.takeDamage(999999))
  const stats = { damageDealt: 40, damageTaken: 0, kills: 1, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
  Object.assign(setup.profile(), claimCareerMission(setup.profile(), setup.profile().activeMission!.id, 'victory', stats).profile)
}

describe('Veteran elimination mission party return', () => {
  it.each(RETURN_MISSIONS)('returns the surviving party from its current position and resumes after reload: %s', id => {
    const setup = setupField(id)
    setup.controller.friendlies[1].takeDamage(999999)
    const leader = setup.controller.missionLeader! as unknown as FieldTestNpc
    leader.combatPosition.set(170, 0, 20)
    finishField(setup)
    const merit = setup.profile().totalMerit
    expect(setup.controller.startReturning()).toBe(true)
    expect(setup.controller.phase).toBe('RETURNING')
    expect(leader.combatPosition.x).toBe(170)
    const home = leader.formationTarget!.position.clone()
    const followers = setup.controller.friendlies.filter(npc => !npc.dead && npc !== setup.controller.missionLeader) as unknown as FieldTestNpc[]
    expect(followers.every(npc => npc.assignFollowTarget.mock.lastCall?.[0] === leader)).toBe(true)
    leader.combatPosition.set(80, 0, 20)
    leader.hp = 37
    setup.controller.updateFlow(5, 0)
    setup.controller.persistRuntimeProgress(true)
    setup.controller.cleanupMission()
    const reload = setupField(id, setup.profile(), setup.residents, setup.player, true)
    reload.controller.onMarchStarted = vi.fn()
    reload.controller.onSweepCharge = vi.fn()
    expect(reload.controller.startActiveMission()).toBe(true)
    expect(reload.controller.phase).toBe('RETURNING')
    expect(reload.controller.missionBandits).toHaveLength(0)
    expect(reload.controller.friendlies.filter(npc => !npc.dead)).toHaveLength(setup.roster.friendly.length - 1)
    const restoredLeader = reload.controller.missionLeader! as unknown as FieldTestNpc
    expect(restoredLeader.combatPosition.x).toBe(80)
    expect(restoredLeader.hp).toBe(37)
    expect(restoredLeader.formationTarget!.position).toEqual(home)
    reload.controller.updateFlow(.016, 0)
    expect(reload.controller.onMarchStarted).not.toHaveBeenCalled()
    expect(reload.controller.onSweepCharge).not.toHaveBeenCalled()
    expect(reload.profile().totalMerit).toBe(merit)
    restoredLeader.combatPosition.copy(home)
    reload.player.group.position.set(170, 0, 20)
    expect(reload.controller.partyReturned).toBe(true)
    expect(reload.controller.returnComplete).toBe(false)
    reload.player.group.position.copy(home)
    expect(reload.controller.returnComplete).toBe(true)
    reload.controller.dispose()
    setup.controller.dispose()
  })

  it('elects a living leader and lets a sole surviving Player walk home', () => {
    const setup = setupField('veteran-scout-hunters')
    setup.controller.missionLeader!.takeDamage(999999)
    finishField(setup)
    expect(setup.controller.startReturning()).toBe(true)
    expect(setup.controller.missionLeader!.dead).toBe(false)
    const home = (setup.controller.missionLeader as unknown as FieldTestNpc).formationTarget!.position.clone()
    setup.controller.friendlies.forEach(npc => npc.takeDamage(999999))
    setup.controller.updateFlow(.016, 0)
    expect(setup.controller.partyReturned).toBe(true)
    setup.player.group.position.copy(home)
    expect(setup.controller.returnComplete).toBe(true)
    setup.controller.dispose()
  })

  it('keeps the result and existing orders when saving the return fails', () => {
    const setup = setupField('veteran-village-intercept')
    finishField(setup)
    const leader = setup.controller.missionLeader! as unknown as FieldTestNpc
    leader.assignFormationTarget.mockClear()
    ;(setup.controller as unknown as { commit: (profile: CareerProfile) => boolean }).commit = () => false
    expect(setup.controller.startReturning()).toBe(false)
    expect(setup.controller.phase).toBe('RESULT')
    expect(leader.assignFormationTarget).not.toHaveBeenCalled()
    setup.controller.dispose()
  })
})
