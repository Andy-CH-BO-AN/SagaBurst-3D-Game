import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { Faction, type NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { NavigationWorld } from '../navigation/NavigationWorld'
import type { Player } from '../player/Player'
import { createCareerProfile, type CareerProfile } from './CareerProfile'
import { BanditMissionController } from './BanditMissionController'
import { VETERAN_MISSION_IDS, acceptVeteranMission, createVeteranRoster } from './VeteranMission'
import type { TownActorSpec } from '../town/TownRules'
import type { TownWorld } from '../town/TownWorld'
import type { UnitLoadout } from '../battle/UnitPresetCatalog'

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
  assignFormationTarget(): void {}
  assignFollowTarget = vi.fn()
  isFormationTargetReached(): boolean { return true }
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
  return roster.friendly.filter(unit => unit.source === 'town').map(unit => {
    const npc = new FieldTestNpc(unit.actorId, unit.heroRole === 'ranger' ? 'Maki' : unit.heroRole === 'captain' ? 'Captain' : 'Town cavalry', Faction.TOWN, 'roman', 2)
    const homeMount = unit.mounted ? new FieldTestMount() : undefined
    if (homeMount) npc.mountVehicle(homeMount)
    const spec = { id: unit.actorId, role: townRoleFor(unit.townRole!), x: 2, z: 3, index: 0 }
    return { spec, npc, homeMount }
  })
}

function setupField(
  templateId: typeof VETERAN_MISSION_IDS[number],
  initialProfile?: CareerProfile,
  existingResidents?: ReturnType<typeof buildResidents>,
  existingPlayer?: FieldTestPlayer,
  deferStart = false,
) {
  const missionId = initialProfile?.activeMission?.id ?? `controller-${templateId}`
  const roster = createVeteranRoster(templateId, 'roman', missionId)
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
    { camps: [], obstacles: [] } as unknown as TownWorld,
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
  it.each([
    ['veteran-scout-hunters', 100, 40, 22, 77, 40],
    ['veteran-village-intercept', 50, 100, 7, 42, 100],
    ['veteran-spear-line-hunt', 50, 100, 11, 38, 100],
    ['veteran-tragedy-of-the-scouts', 20, 100, 16, 3, 100],
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

  it('restores the latest Player mount state when a four-squad charge checkpoints', () => {
    const setup = setupField('veteran-scout-hunters')
    expect(setup.start).toBe(true)
    setup.controller.onMarchStarted = vi.fn()
    setup.controller.onSweepCharge = vi.fn()
    const captain = setup.controller.friendlies.find(npc => npc.combatantId === setup.roster.friendly.find(unit => unit.leader)!.actorId)!
    setup.player.group.position.copy(captain.combatPosition)
    setup.controller.updateFlow(.016, 0)
    expect(setup.controller.onMarchStarted).toHaveBeenCalledTimes(1)
    const mission = setup.profile().activeMission!
    expect(mission.phase).toBe('MARCHING')
    expect(mission.followVoicePlayed).toBe(true)
    mission.mountState = { activeMountId: 'horse', hp: { horse: 0 }, unavailable: ['horse'] }
    const captainAgain = setup.controller.friendlies.find(npc => npc.combatantId === captain.combatantId)!
    captainAgain.combatPosition.set(110, 0, -275)
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
