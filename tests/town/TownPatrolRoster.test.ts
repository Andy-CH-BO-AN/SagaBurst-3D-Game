import { TownMissionCombat, type TownCombatResident } from '../../src/town/TownMissionCombat'
import { Faction } from '../../src/combat/CombatFaction'
import { TownWatchtowerNavigation } from '../../src/navigation/TownWatchtowerNavigation'
import { getTownCommandWatchtowerLayout } from '../../src/town/TownCommandWatchtowerLayout'
import { describe, expect, it } from 'vitest'
import { selectMissionCavalryActorIds } from '../../src/career/BanditMissionController'
import { townRoster } from '../../src/town/TownRules'
import type { NPC } from '../../src/world/NPC'
import { townDefenseThreatInRange, townDefenseThreatResponse } from '../../src/town/TownGarrison'
import { Vector3 } from 'three'

describe('Town patrol roster contracts', () => {
  it('permits stationary close defense outside home while bounding pursuit to the home sector', () => {
    const spec = townRoster().find(spec => spec.role === 'commander') ?? townRoster().find(spec => spec.duty === 'gate_guard')!
    const npc = { isMounted: false, rangedWeaponId: undefined, combatPosition: new Vector3(spec.x, spec.y ?? 0, spec.z) }
    const near = npc.combatPosition.clone().add(new Vector3(10, 0, 0))
    expect(townDefenseThreatInRange(spec, npc, near, 20)).toBe(true)
    expect(townDefenseThreatResponse(spec, npc, near, 20)).toBe('pursue')
    expect(townDefenseThreatInRange(spec, npc, near.clone().add(new Vector3(20, 0, 0)), 20)).toBe(false)
    npc.combatPosition.add(new Vector3(22, 0, 0))
    expect(townDefenseThreatInRange(spec, npc, npc.combatPosition.clone().add(new Vector3(1, 0, 0)), 20)).toBe(true)
    expect(townDefenseThreatResponse(spec, npc, npc.combatPosition.clone().add(new Vector3(1, 0, 0)), 20)).toBe('defend')
    expect(townDefenseThreatResponse(spec, npc, npc.combatPosition.clone().add(new Vector3(9, 0, 0)), 20)).toBe('ignore')
  })
  it('keeps two twenty-rider patrols distinct from the service Captain, training and gate guards', () => {
    const roster = townRoster(), patrol = roster.filter(s => s.duty === 'patrol')
    expect(roster).toHaveLength(235); expect(patrol).toHaveLength(40)
    expect(new Set(roster.map(s => s.id)).size).toBe(roster.length)
    expect(roster.filter(s => s.role === 'captain')).toHaveLength(1)
    for (const id of ['A', 'B']) {
      const members = patrol.filter(s => s.patrolId === id)
      expect(members).toHaveLength(20); expect(members.filter(s => s.patrolLeader)).toHaveLength(1)
      expect(members.filter(s => !s.patrolLeader)).toHaveLength(19)
      for (const s of members) {
        expect(s).toMatchObject({ mounted: true, training: false, assaultObjective: false, tier: s.patrolLeader ? 4 : 2 })
        expect(s.defenseGroup).toBeUndefined(); expect(s.role).not.toBe('captain')
      }
    }
    expect(roster.filter(s => s.mounted && s.duty === 'training')).toHaveLength(60)
    expect(roster.filter(s => s.duty === 'gate_guard')).toHaveLength(40)
  })

  it('excludes patrol identities from ordinary mission cavalry selection', () => {
    const roster = townRoster()
    const fake = roster.map(spec => ({ spec, npc: { dead: false, combatantId: spec.id, mount: { dead: false } } as NPC }))
    expect(selectMissionCavalryActorIds(fake, 59)).toEqual(selectMissionCavalryActorIds(fake.filter(r => r.spec.duty !== 'patrol'), 59))
  })
})

it('lets nearby military pursue a reachable tower target while preserving civilian and home-sector limits', () => {
  const tower = new TownWatchtowerNavigation(getTownCommandWatchtowerLayout())
  const template = townRoster().find(spec => spec.unitKind && !spec.eagle)!
  const spec = { ...template, garrison: undefined, x: -21, y: tower.layout.groundY, z: -28 }
  const npc = { isMounted: false, rangedWeaponId: undefined, combatPosition: new Vector3(spec.x, spec.y, spec.z) }
  const target = new Vector3(-29, tower.layout.platformY, -41)
  expect(townDefenseThreatResponse(spec, npc, target, 20)).toBe('ignore')
  expect(townDefenseThreatResponse(spec, npc, target, 20, tower)).toBe('pursue')
  expect(townDefenseThreatResponse({ ...spec, role: 'civilian', unitKind: undefined }, npc, target, 20, tower)).toBe('ignore')
  expect(townDefenseThreatResponse({ ...spec, x: 60 }, npc, target, 20, tower)).toBe('ignore')
  // An airborne point above the structure is not proof of a reachable floor.
  expect(townDefenseThreatResponse(spec, npc, target.clone().add(new Vector3(0, 5, 0)), 20, tower)).toBe('ignore')
})

it('assigns the nearest eligible tower threat and retains the first equal-distance candidate', () => {
  const tower = new TownWatchtowerNavigation(getTownCommandWatchtowerLayout())
  const template = townRoster().find(spec => spec.unitKind && !spec.eagle)!
  const spec = { ...template, garrison: undefined, x: -21, y: tower.layout.groundY, z: -28 }
  let selected: NPC | undefined
  const body = { dead: false, faction: Faction.TOWN, isMounted: false, rangedWeaponId: undefined,
    combatPosition: new Vector3(spec.x, spec.y, spec.z),
    setMissionCombatTarget(target: NPC | undefined) { selected = target }, beginExternalThreat() {} }
  const resident: TownCombatResident = { spec, npc: body as unknown as NPC, cycle: 0, walkTime: 0 }
  const threat = (x: number, y: number, z: number, faction = Faction.BANDIT, dead = false): NPC =>
    ({ combatPosition: new Vector3(x, y, z), faction, dead }) as NPC
  // The farther threat precedes both nearest ties in the same spatial bucket.
  const farther = threat(-30, tower.layout.platformY, -41)
  const first = threat(-29, tower.layout.platformY, -41)
  const tie = threat(-29, tower.layout.platformY, -41)
  const friendly = threat(spec.x, spec.y, spec.z, Faction.TOWN)
  const dead = threat(spec.x, spec.y, spec.z, Faction.BANDIT, true)
  type Inputs = ConstructorParameters<typeof TownMissionCombat>
  // Exercise only real sensing/assignment; no actors, render scene or movement engine.
  const combat = new TownMissionCombat({
    field: { ambientBandits: [farther, first, tie, friendly, dead], missionBandits: [], friendlies: [] },
    duel: { fieldNpcs: [], isMissionActor: () => false }, defense: {},
  } as unknown as Inputs[0], {
    residents: [resident], navigation: { townNav: { watchtower: tower } },
  } as unknown as Inputs[1])
  combat['updateExternalThreatAssignments']()
  expect(selected).toBe(first)
})
