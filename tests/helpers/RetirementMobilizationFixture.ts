import { cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { commanderGateDefenseSlots } from '../../src/career/CommanderTownRoster'
import { createTownEquipmentRefsResolver, townDefaultActorLoadout, townEquipmentActorSpecs, townEquipmentSquadForActor } from '../../src/career/CareerTownEquipmentState'
import { emptyPersonalContribution, type PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import { TOWN_EAGLE_PAIRS } from '../../src/town/TownEagleGarrison'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../../src/town/TownNativeGuardIdentity'

/** Data-only native owner dependencies; callers explicitly supply the retirement state. */
export function withNativeRetirementCheckpoints(profile: CareerProfile): CareerProfile {
  const next = cloneCareerProfile(profile), sceneKey = `town:${next.faction}`
  const specs = townEquipmentActorSpecs(next.faction), resolveRefs = createTownEquipmentRefsResolver(next, next.faction)
  const mountedIds = new Set(specs.filter(spec => {
    const managed = townEquipmentSquadForActor(spec.id) !== undefined || Boolean(next.townEquipment?.[next.faction]?.actors[spec.id])
    return managed ? Boolean(resolveRefs(spec).mount?.itemId) : Boolean(townDefaultActorLoadout(next.faction, spec).mountId)
  }).map(spec => spec.id))
  const position = () => ({ x: 0, y: 0, z: 0, yaw: 0 })
  const members = (ids: readonly string[]): Record<string, PersonalActorCheckpoint> => Object.fromEntries(ids.map(id => {
    const mounted = !TOWN_WATCHTOWER_ARCHER_IDS.includes(id) && mountedIds.has(id)
    return [id, { status: 'deployed', hp: 100, ammo: 30, shieldImpact: 0, position: position(),
      ...(mounted ? { mount: { hp: 100, mounted: true, position: position() } } : {}),
    }]
  }))
  const squads = commanderGateDefenseSlots(), groundIds = squads.flatMap(squad => squad.actorIds)
  next.townCommandSquad = { type: 'town-command', squadId: 1, commandRank: 'commander', townFaction: next.faction,
    sceneKey: 'town-home', state: 'TRAINING', authorized: false, actorIds: groundIds, commandedActorIds: [], squads,
    contribution: emptyPersonalContribution(), members: members(groundIds) }
  const civilianIds = specs.filter(actor => actor.role === 'civilian' || actor.role === 'merchant').map(actor => actor.id)
  next.civilianCommandSquad = { type: 'civilian-command', squadId: 'civilians', townFaction: next.faction, sceneKey,
    actorIds: civilianIds, owners: Object.fromEntries(civilianIds.map(id => [id, 'daily' as const])), members: members(civilianIds) }
  next.retirementTowerGuards = members(TOWN_WATCHTOWER_ARCHER_IDS)
  next.townEagleGarrisons = { [next.faction]: { version: 1, sceneKey, pairs: TOWN_EAGLE_PAIRS.map(pair => ({
    riderId: pair.riderId, mountId: pair.mountId, homePadId: pair.homePadId, duty: 'standby',
    hp: 100, ammo: 30, position: position(), mounted: false, refitAllowed: false,
    mount: { hp: 100, position: position(), flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0,
      velocity: { x: 0, y: 0, z: 0 } } },
  })) } }
  return next
}
