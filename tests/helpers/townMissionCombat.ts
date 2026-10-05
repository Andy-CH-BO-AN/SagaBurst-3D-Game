import { MissionTravelEncounter } from '../../src/career/MissionTravelEncounter'
import * as THREE from 'three'
import { vi } from 'vitest'
import type { ActiveCareerMission, CareerMissionPhase } from '../../src/career/CareerMissionState'
import type { VeteranMissionEnemySquad } from '../../src/career/BanditMissionController'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import { TownMissionCombat, type TownCombatResident } from '../../src/town/TownMissionCombat'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { townWartimePeers } from '../../src/town/TownWartime'
import type { HpBar } from '../../src/ui/HpBar'
import type { Mount } from '../../src/world/Mount'
import { Faction, type NPC } from '../../src/world/NPC'

type Controllers = ConstructorParameters<typeof TownMissionCombat>[0]
type Simulation = ConstructorParameters<typeof TownMissionCombat>[1]

export function combatActor(id: string, faction = Faction.TOWN) {
  const actor = {
    combatantId: id, faction, dead: false, group: new THREE.Group(), mount: null as Mount | null,
    townCategory: undefined as NPC['townCategory'], hostileToPlayer: false,
    get combatPosition() { return this.mount?.group.position ?? this.group.position },
    clearEncounter: vi.fn<NPC['clearEncounter']>(),
    setTacticalOrder: vi.fn((order: NPC['tacticalOrder']) => { actor.tacticalOrder = order }),
    tacticalOrder: 'attack' as NPC['tacticalOrder'],
    assignFormationTarget: vi.fn<NPC['assignFormationTarget']>(),
    update: vi.fn<NPC['update']>(), updateTownPeace: vi.fn<NPC['updateTownPeace']>(),
    beginExternalThreat: vi.fn<NPC['beginExternalThreat']>(), endExternalThreat: vi.fn<NPC['endExternalThreat']>(),
  }
  return actor as typeof actor & NPC
}

export function combatMount() {
  const mount = {
    group: new THREE.Group(), previousPosition: new THREE.Vector3(-1, 0, 0), dead: false,
    movementSpeed: 15, isSprinting: true, skipImpactThisFrame: false, riderNpc: null as NPC | null,
    canImpact: vi.fn<Mount['canImpact']>(() => true),
    beginControlledFrame: vi.fn<Mount['beginControlledFrame']>(), finishControlledFrame: vi.fn<Mount['finishControlledFrame']>(),
    setCameraDistance: vi.fn<Mount['setCameraDistance']>(), update: vi.fn<Mount['update']>(),
  }
  mount.group.position.x = 1
  return mount as typeof mount & Mount
}

export function combatResident(npc: NPC, role: TownActorSpec['role'] = 'melee_infantry'): TownCombatResident {
  return { npc, spec: { ...townRoster().find(spec => spec.role === role)!, id: npc.combatantId, x: 5, z: 6, index: 0, yaw: .7 }, cycle: -1, walkTime: 0 }
}

/** Typed substitutes at the simulation's public seam; no TownScene or controller internals. */
export function combatFixture(options: { controllers?: Partial<Controllers>; simulation?: Partial<Simulation> } = {}) {
  const field = {
    travelEncounter: new MissionTravelEncounter(),
    prepareTravelEncounter: vi.fn(), noteTravelHit: vi.fn(() => false), engageFormalMission: vi.fn(),
    isMissionTarget: vi.fn((actor: NPC) => field.missionBandits.includes(actor)),
    active: undefined as ActiveCareerMission | undefined,
    fieldNpcs: [] as NPC[], friendlies: [] as NPC[], ambientBandits: [] as NPC[], missionBandits: [] as NPC[],
    veteranEnemySquads: [] as readonly VeteranMissionEnemySquad[],
    departingNpcs: [] as NPC[], cavalryMounts: [] as Mount[],
    combatPeersFor: vi.fn((_actor: NPC): NPC[] => field.fieldNpcs),
    markVeteranEnemySquadEngaged: vi.fn((squadId: number) => {
      const active = field.active
      if (!active || active.kind !== 'veteran-field') return false
      const engagedEnemySquadIds = [...new Set([...(active.engagedEnemySquadIds ?? []), squadId])]
      field.active = { ...active, engagedEnemySquadIds }
      return true
    }),
    updateFlow: vi.fn<(dt: number, cameraYaw: number) => void>(), updateDepartingCavalry: vi.fn<() => void>(),
  }
  const duel = {
    active: undefined as ActiveCareerMission | undefined,
    phase: null as CareerMissionPhase | null, fieldNpcs: [] as NPC[], allMounts: [] as Mount[],
    opponent: null as NPC | null, combatEnabled: false,
    update: vi.fn<(dt: number) => void>(), isMissionActor: vi.fn((actor: NPC) => duel.fieldNpcs.includes(actor)),
    persistRuntimeProgress: vi.fn<(force?: boolean) => void>(),
    setExternalCombat: vi.fn<(actor: NPC, enabled: boolean) => void>(),
  }
  const defense = {
    active: undefined as ActiveCareerMission | undefined,
    phase: null as CareerMissionPhase | null, assault: false,
    fieldNpcs: [] as NPC[], waitingEnemies: [] as NPC[], enemyMounts: [] as Mount[],
    peersFor: vi.fn((actor: NPC): NPC[] => townWartimePeers(actor, defense.fieldNpcs)),
    updateFlow: vi.fn<(dt: number, cameraYaw: number) => void>(), updateCivilianOrder: vi.fn<(actor: NPC) => void>(),
  }
  const player = { dead: false, combatPosition: new THREE.Vector3(), currentMount: null as Mount | null } as unknown as Player
  const careerMounts = { activeMount: null as Mount | null, update: vi.fn<(dt: number) => void>() }
  const simulation: Simulation = {
    player: () => player, residents: [], cameraPosition: new THREE.Vector3(), obstacles: [],
    navigation: new NavigationWorld(), hp: { setFill: vi.fn() } as unknown as HpBar, careerMounts,
    peaceResident: vi.fn(), updateCommandCue: vi.fn(), clearCombatShots: vi.fn(),
    hitNpc: vi.fn(), damagePlayer: vi.fn(), fireNpc: vi.fn(),
    ...options.simulation,
  }
  const controllers = { field, duel, defense, ...options.controllers }
  const combat = new TownMissionCombat(controllers, simulation)
  return { combat, field, duel, defense, simulation, player, careerMounts }
}
