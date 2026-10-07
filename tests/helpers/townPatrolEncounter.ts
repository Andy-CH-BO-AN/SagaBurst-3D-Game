import { Faction, type NPC } from '../../src/world/NPC'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { getTerrainHeight } from '../../src/world/Terrain'
import { combatActor } from './townMissionCombat'
import type { TownPatrolFixture } from './townPatrolFixture'

export function createTownPatrolEncounter(h: TownPatrolFixture) {
  const bandit = combatActor('roaming:bandit', Faction.BANDIT)
  const cavalry = combatActor('roaming:cavalry', Faction.ENEMY)
  Object.assign(bandit, { encounterAggroState: 'alerted' }); Object.assign(cavalry, { encounterAggroState: 'alerted' })
  const actors: NPC[] = [bandit, cavalry], grid = new SpatialGrid<NPC>(8)
  const roaming = { owns: (npc: NPC) => actors.includes(npc), squadMembersFor: (npc: NPC) => [npc] }
  const a = h.controller.squads[0], b = h.controller.squads[1]
  for (const [index, r] of a.members.entries()) r.homeMount!.group.position.set(150 + index * 2, getTerrainHeight(150 + index * 2, 0), 0)
  for (const [index, r] of b.members.entries()) r.homeMount!.group.position.set(-220 + index * 2, getTerrainHeight(-220 + index * 2, -200), -200)
  bandit.group.position.copy(a.members[19].npc.combatPosition).x += 25
  cavalry.group.position.set(320, 0, 300)
  const frame = (dt = .4, excluded = new Set<NPC>()) => {
    h.controller.beginFrame(excluded); grid.clear()
    for (const npc of actors) if (!npc.dead) grid.insert(npc)
    h.controller.prepareCombatFrame(dt, grid, roaming)
  }
  return { a, b, bandit, cavalry, actors, grid, roaming, frame }
}

