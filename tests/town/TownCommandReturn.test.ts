import { Vector3 } from 'three'
import { expect, it, vi } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { emptyPersonalContribution } from '../../src/combat/CommandMerit'
import type { PersonalActorCheckpoint } from '../../src/career/CareerPersonalSquadMission'
import type { Player } from '../../src/player/Player'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Mount } from '../../src/world/Mount'
import type { NPC } from '../../src/world/NPC'
import { getTerrainHeight } from '../../src/world/Terrain'
import { townStationSpec } from '../../src/town/TownGarrison'
import type { TownActorSpec } from '../../src/town/TownRules'
import { TownCommandSquadController, TOWN_COMMAND_RETURN_ID } from '../../src/town/TownCommandSquadController'

function returning(change: 'mount dies' | 'ranged restored') {
  const y = getTerrainHeight(20, 0), wallY = getTerrainHeight(10, 0) + 8
  const authored: TownActorSpec = { id: 'guard', role: 'ranged_infantry', duty: 'gate_guard',
    mounted: false, training: false, assaultObjective: false, tier: 2, index: 0, x: 10, y: wallY, z: 0,
    garrison: { kind: 'rampart', gateId: 'north', x: 10, y: wallY, z: 0, yaw: 0,
      groundFallback: { x: 20, y, z: 0, yaw: 0 } } }
  const mount = { dead: false }
  const body = {
    combatantId: authored.id, dead: false, isMounted: change === 'mount dies',
    rangedWeaponId: change === 'mount dies' ? 'wooden_shortbow' : undefined as string | undefined,
    hasActiveRangedWeapon: change === 'mount dies', combatPosition: new Vector3(20, y, 0),
    formationCommandId: TOWN_COMMAND_RETURN_ID, reached: false, missionMovement: true,
    clearEncounter: vi.fn(), setTacticalOrder: vi.fn(), setTownPeaceful: vi.fn(), activateTownRampartGarrison: vi.fn(),
    assignFormationTarget: vi.fn((_id: number, _point: Vector3) => { body.reached = false }),
    isFormationTargetReached: () => body.reached,
    updateTownTravel: vi.fn(),
  }
  const spec = townStationSpec(authored, body.isMounted, Boolean(body.rangedWeaponId))
  const member: PersonalActorCheckpoint = { status: 'deployed', order: 'formation', formation: {
    commandId: TOWN_COMMAND_RETURN_ID, position: { x: spec.x, y: spec.y, z: spec.z, yaw: 0 }, reached: false } }
  const resident = { spec, npc: body as unknown as NPC, homeMount: change === 'mount dies' ? mount as Mount : undefined }
  const profile = createCareerProfile('roman')
  const controller = new TownCommandSquadController([resident], () => ({ dead: false }) as Player, () => profile, () => true)
  // Seed just the saved return intent; the real public update owns retarget and arrival.
  controller['value'] = { type: 'town-command', townFaction: 'roman', squadId: 1, actorIds: [spec.id],
    authorized: true, state: 'RETURNING', sceneKey: 'town-home', contribution: emptyPersonalContribution(), members: { [spec.id]: member } }
  return { body, mount, member, resident, controller, wallY }
}

it.each(['mount dies', 'ranged restored'] as const)('retargets a ground return when %s during travel and waits for actual wall arrival', change => {
  const { body, mount, member, resident, controller, wallY } = returning(change)
  body.updateTownTravel.mockImplementationOnce(() => {
    if (change === 'mount dies') { mount.dead = true; body.isMounted = false }
    else { body.rangedWeaponId = 'wooden_shortbow'; body.hasActiveRangedWeapon = true }
    body.reached = true // The old ground goal was reached in this travel update.
  })
  controller.updateResident(resident, .1, new Vector3(), [], {} as NavigationWorld)
  expect(member.formation?.position).toEqual({ x: 10, y: wallY, z: 0, yaw: 0 })
  expect(body.assignFormationTarget).toHaveBeenCalledOnce()
  expect(member.status).toBe('deployed')
  expect(body.activateTownRampartGarrison).not.toHaveBeenCalled()
  // A stale reached flag at the same XZ on ground must never activate a wall guard.
  body.combatPosition.set(10, getTerrainHeight(10, 0), 0); body.reached = true
  controller.updateResident(resident, .1, new Vector3(), [], {} as NavigationWorld)
  expect(member.status).toBe('deployed')
  expect(body.activateTownRampartGarrison).not.toHaveBeenCalled()
  body.combatPosition.y = wallY
  controller.updateResident(resident, .1, new Vector3(), [], {} as NavigationWorld)
  expect(member.status).toBe('reserve')
  expect(member.formation).toBeUndefined()
  expect(body.activateTownRampartGarrison).toHaveBeenCalledOnce()
  expect(controller.state).toBe('TRAINING')
})
