// Career profile data model. Type-only: this module must not declare or import runtime values,
// so it emits no JavaScript and a model change never re-selects tests that only ran Career logic.
import type { CareerTutorialState } from './CareerTutorialState'
import type { CareerRetirementRuntime, CareerRetirementState } from './CareerRetirementState'
import type { CareerTownEquipment } from './CareerTownEquipmentState'
import type { TownAirCommandSquadState } from './TownAirCommandAuthority'
import type { CivilianCommandSquadState } from './CivilianCommandAuthority'
import type { EnemyEaglePatrolCheckpoint } from '../town/EnemyEaglePatrolState'
import type { CareerDuelTier, CareerDuelCommanderHome } from './CareerDuelState'
import type { TownCommandSquadState } from './CareerCommandAuthority'
import type { TownEagleGarrisons } from '../town/TownEagleGarrisonState'
import type { CareerAerialState } from './CareerAerialState'
import type { CareerInventory } from './CareerInventory'
import type { CareerPersonalSquadMember } from './CareerPersonalSquad'
import type { CareerOutpostMission, CareerOutpostRecord, CareerOutpostStageId } from './CareerOutpostMission'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { PlayerMountId } from '../battle/BattleConfig'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import type { SkillState } from '../rpg/SkillManager'
import type { CareerMissionTier } from './CareerMissionTier'
import type { ActiveCareerMission } from './CareerMissionState'
import type { CareerBattleOutcome, CareerBattleRole, MeritBreakdown } from './MeritCalculator'

export type { CareerMissionTier } from './CareerMissionTier'

export type CareerRank = 'recruit' | 'soldier' | 'veteran' | 'captain' | 'commander'

export type CareerPurchaseKind = 'weapon' | 'armor' | 'mount' | 'hero'

export type CareerPurchaseTier = 1 | 2 | 3 | 4 | 5

// Tier-specific horse IDs are retained only for legacy saves.
export type CareerMountId = PlayerMountId | 'horse-t1' | 'horse-t2' | 'horse-t3'

export interface CareerLifetimeStats {
  battles: number
  victories: number
  deaths: number
  kills: number
  damage: number
  structureDamage: number
  breaches: number
}

export interface LegacyRaceProgress {
  readonly scheduleVersion: number
  readonly completedRaceIds: import('./CareerRaceState').RaceId[]
  readonly raceBestSeconds?: Partial<Record<import('./CareerRaceState').RaceId, number>>
}

export interface CareerProfile {
  version: 1
  /** One-time ordinary-soldier HP migration receipt, independent of equipment migrations. */
  healthRulesVersion?: 1
  /** Viking Commander 950→900 health conversion, independent of ordinary HP rules. */
  commanderHealthVersion?: 1
  faction: CharacterFaction
  tutorial?: CareerTutorialState

  /** Lifetime earned merit. Never decreases; appointments use merit earned during this enlistment. */
  totalMerit: number
  /** Spendable merit. Purchases deduct this without affecting rank. */
  availableMerit: number
  rank: CareerRank
  /** T5 elite identity, independent of rank and spendable currency. Missing legacy value means ordinary. */
  /** Non-default T5 class in use (Roman Byzantine Cataphract / Viking Ironblood Warlord); null = the faction's default Commander. */
  eliteClass?: 'byzantine-cataphract' | 'ironblood-warlord' | null
  /** Permanently unlocked Commander classes of this faction for this enlistment; eliteClass is only the one in use. Missing legacy value = the class in use. */
  unlockedCareerClasses?: ('roman-commander' | 'byzantine-cataphract' | 'viking-commander' | 'ironblood-warlord')[]
  /** T4 class in use while Captain (Roman Paladin/Centurion, Viking Varangian/Dragon Oathguard). Missing legacy value = the faction default
   * (Paladin / Varangian). Kept as data after T5; T5 identity ignores it. */
  t4Specialization?: 'paladin' | 'centurion' | 'varangian' | 'dragon-oathguard'
  /** Permanently unlocked T4 classes of this faction for this enlistment. Missing legacy Captain value = the default only. */
  unlockedT4Classes?: ('paladin' | 'centurion' | 'varangian' | 'dragon-oathguard')[]
  /** Optional ending lifecycle; retirement never changes the appointed rank. */
  careerRetirement?: CareerRetirementState
  /** Grounded player and owned-mount resources throughout the retirement sequence. */
  retirementRuntime?: CareerRetirementRuntime
  /** Native tower resources have no ordinary command checkpoint. */
  retirementTowerGuards?: Record<string, import('./CareerPersonalSquadMission').PersonalActorCheckpoint>
  /** Permanent Career combat progression. Never resets when returning to town or changing missions. */
  skills?: SkillState
  enlistmentMeritBase: number
  equipment?: { melee?: string; ranged?: string; shield?: string | null }
  /** Persistent receipt, independent of current inventory: selling the reward never re-grants it. */
  commanderMeleeGranted?: boolean
  /** Undefined legacy selections are preserved; only a known untouched starter is replaceable. */
  meleeSelectionOrigin?: 'starter' | 'custom'
  starterWeaponId?: string
  townDialogueSeen?: string[]
  personalSquad?: { members: CareerPersonalSquadMember[] }
  /** Wounded deployed members after a slow mission return, until actual HR arrival. */
  personalSquadRuntime?: import('./CareerPersonalSquadMission').PersonalSquadMission
  /** Legacy purchases; any owned tier grants the single military horse. */
  ownedHorseTiers?: (1 | 2 | 3)[]
  /** Cosmetic only; missing legacy values use the original grey coat. */
  horseAppearanceVariant?: import('../world/HorseAssetRegistry').HorseAppearanceVariant
  mountArmor?: Partial<Record<CareerMountId, number>>
  selectedMountId?: CareerMountId
  playerAerialState?: CareerAerialState
  /** Minimal roaming deployment state survives mission cleanup independently in each Town. */
  townOutskirts?: Partial<Record<CharacterFaction, import('../town/TownOutskirtsWarfareController').TownOutskirtsCheckpoint>>
  townPatrols?: Partial<Record<CharacterFaction, import('../town/TownPatrolCheckpoint').TownPatrolCheckpoint>>
  townCommandSquad?: TownCommandSquadState
  civilianCommandSquad?: CivilianCommandSquadState
  townAirCommandSquad?: TownAirCommandSquadState
  racePlayerState?: import('./CareerRaceState').RaceRider
  activeRace?: import('./CareerRaceState').CareerRaceSession
  raceRecords?: import('./CareerRaceState').CareerRaceRecord[]
  legacyRaceProgress?: LegacyRaceProgress[]
  raceScheduleVersion?: import('./CareerRaceState').RaceScheduleVersion
  completedRaceIds?: import('./CareerRaceState').RaceId[]
  raceBestSeconds?: Partial<Record<import('./CareerRaceState').RaceId, number>>
  activeMission?: ActiveCareerMission
  activeOutpostMission?: CareerOutpostMission
  completedOutpostStages?: CareerOutpostStageId[]
  /** Canonical, persistent prerequisite for Enemy Town Assault. */
  completedOutpostRelief?: boolean
  outpostBattleRecords?: CareerOutpostRecord[]
  careerMissionCompletions?: number
  /** Mission-board tiers are independent of the player's current rank. */
  careerMissionCompletionsByTier?: Partial<Record<CareerMissionTier, number>>
  completedCareerMissionTemplateIds?: string[]
  /** Original service resources retained through Duel settlement and scene reconstruction. */
  townCommanderRecovery?: CareerDuelCommanderHome & { faction: CharacterFaction }
  townDuelResidentRecovery?: CareerDuelCommanderHome & { faction: CharacterFaction; actorId: string }
  /** Each unit preset unlocks only its own next Duel tier. */
  unarmedDuelHighestDefeatedTier?: CareerDuelTier
  duelHighestDefeatedTierByPreset?: Partial<Record<UnitPresetId, CareerDuelTier>>
  townEvent?: { id: string; state: 'hostile' | 'settled'; pendingResult?: 'player_defeated' | 'town_defeated'; result?: 'player_defeated' | 'town_defeated'; penalty?: number; deadActorIds?: string[]; destroyedBuildingIds?: string[]; authorizedTownCommandActorIds?: string[] }

  enemyEaglePatrols?: Partial<Record<CharacterFaction, EnemyEaglePatrolCheckpoint>>
  townEagleGarrisons?: TownEagleGarrisons
  townEquipment?: CareerTownEquipment
  inventory?: CareerInventory
  ownedWeapons: string[]
  ownedArmors: string[]
  ownedMounts: PlayerMountId[]
  ownedHeroes: HeroAssetId[]

  lifetimeStats: CareerLifetimeStats
  claimedBattleIds: string[]
}

export interface CareerBattleResult {
  battleId: string
  outcome: CareerBattleOutcome
  role: CareerBattleRole
  stats: BattleStatsSnapshot
}

export interface CareerBattleClaim {
  profile: CareerProfile
  meritAwarded: number
  meritBreakdown: MeritBreakdown
  alreadyClaimed: boolean
  previousRank: CareerRank
  newRank: CareerRank
}

export interface CareerMissionClaim {
  profile: CareerProfile
  meritAwarded: number
  alreadyClaimed: boolean
}

export interface CareerPurchaseRequest {
  kind: CareerPurchaseKind
  id: string
  cost: number
  requiredTier: CareerPurchaseTier
  quantity?: number
}

export type CareerPurchaseFailureReason =
  | 'invalid-id'
  | 'invalid-cost'
  | 'invalid-tier'
  | 'invalid-quantity'
  | 'already-owned'
  | 'tier-locked'
  | 'insufficient-merit'
  | 'ownership-limit'

export interface CareerPurchaseResult {
  profile: CareerProfile
  purchased: boolean
  spentMerit: number
  reason?: CareerPurchaseFailureReason
}
