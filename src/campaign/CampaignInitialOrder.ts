import { officialPlayerOwnsActor } from '../career/CareerOfficialCommandOrder'
import type { CareerProfile } from '../career/CareerProfile'
import { careerVeteranOutpostOwner } from '../career/CareerVeteranOutpost'
import type { NPC } from '../world/NPC'
import { DEFENSE_CAMPAIGN_RULES } from './CampaignConfig'
import type { DefenseCampaignLaunchConfig } from './DefenseCampaignLaunch'

export interface CampaignInitialOrder {
  /** The actor belongs to the faction holding the outpost. */
  outpostOwner: boolean
  /** Fallback order before any saved checkpoint is restored over it. */
  order: NPC['tacticalOrder']
  /** On a battle restored after its breach: give this actor the fresh post-breach orders again. */
  breachOrders: boolean
}

/** Initial intent of one campaign actor; saved player-owned orders stay authoritative after a breach. */
export function campaignInitialOrder(npc: Pick<NPC, 'combatantId' | 'characterFaction' | 'squadId'>,
  campaign: DefenseCampaignLaunchConfig, profile: CareerProfile | null | undefined): CampaignInitialOrder {
  const outpostOwner = npc.characterFaction === careerVeteranOutpostOwner(campaign)
  const commanderAssault = campaign.careerCommanderOutpost?.runtimeState.activePhase === 'assault'
  const order = outpostOwner
    ? DEFENSE_CAMPAIGN_RULES.initialDefenderOrder
    : campaign.careerCommanderOutpost
      ? commanderAssault ? npc.squadId === 7 ? 'attack' : 'charge' : 'defend'
      : campaign.careerVeteranOutpost ? 'attack' : DEFENSE_CAMPAIGN_RULES.initialDefenderOrder
  const authority = (profile?.activeMission ?? profile?.activeOutpostMission)?.officialSquad
  const personalOutpost = campaign.careerMissionKind === 'captain-outpost-defense' ? profile?.activeMission : profile?.activeOutpostMission
  const saved = personalOutpost?.battle?.actors[npc.combatantId]
  const command = saved ? authority?.members?.[npc.combatantId] ?? saved.checkpoint : undefined
  const hasRestoredIntent = !authority?.actorIds.includes(npc.combatantId) && Boolean(command?.order || command?.formation)
  // Legacy Relief attackers may only have resources saved. Keep restored commands,
  // but give actors with no saved intent the same orders as a fresh breached battle.
  const breachOrders = !officialPlayerOwnsActor(authority, npc.combatantId)
    && (outpostOwner || campaign.careerMissionKind === 'outpost-relief' && !hasRestoredIntent)
  return { outpostOwner, order, breachOrders }
}
