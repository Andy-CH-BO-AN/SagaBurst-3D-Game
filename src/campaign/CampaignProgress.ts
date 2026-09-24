import {
  isCampaignStageId,
  type CampaignFaction,
  type CampaignStageId,
} from './CampaignConfig'

export const DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY = 'sagaburst_defense_campaign_progress_v1'

export const DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY = 'sagaburst_defense_campaign_setup_target'

export interface DefenseCampaignSetupTarget {
  defenderFaction: CampaignFaction
  stageId: CampaignStageId
}

export function parseDefenseCampaignSetupTarget(
  value: unknown,
): DefenseCampaignSetupTarget | null {
  if (!value || typeof value !== 'object') return null
  const target = value as Partial<Record<'defenderFaction' | 'stageId', unknown>>
  if (target.defenderFaction !== 'roman' && target.defenderFaction !== 'viking') return null
  if (typeof target.stageId !== 'number' || !isCampaignStageId(target.stageId)) return null
  return {
    defenderFaction: target.defenderFaction,
    stageId: target.stageId,
  }
}

export interface CampaignProgressStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface DefenseCampaignProgressState {
  roman: CampaignStageId
  viking: CampaignStageId
}

function defaultProgress(): DefenseCampaignProgressState {
  return { roman: 1, viking: 1 }
}

function browserStorage(): CampaignProgressStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readProgress(storage: CampaignProgressStorage | null): DefenseCampaignProgressState {
  if (!storage) return defaultProgress()
  try {
    const raw = storage.getItem(DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY)
    if (!raw) return defaultProgress()
    const parsed = JSON.parse(raw) as Partial<Record<CampaignFaction, unknown>>
    return {
      roman: typeof parsed.roman === 'number' && isCampaignStageId(parsed.roman)
        ? parsed.roman
        : 1,
      viking: typeof parsed.viking === 'number' && isCampaignStageId(parsed.viking)
        ? parsed.viking
        : 1,
    }
  } catch {
    return defaultProgress()
  }
}

export function getDefenseCampaignUnlockedStage(
  faction: CampaignFaction,
  storage: CampaignProgressStorage | null = browserStorage(),
): CampaignStageId {
  return readProgress(storage)[faction]
}

export function isDefenseCampaignStageUnlocked(
  faction: CampaignFaction,
  stageId: CampaignStageId,
  storage: CampaignProgressStorage | null = browserStorage(),
): boolean {
  return stageId <= getDefenseCampaignUnlockedStage(faction, storage)
}

export function completeDefenseCampaignStage(
  faction: CampaignFaction,
  completedStage: CampaignStageId,
  storage: CampaignProgressStorage | null = browserStorage(),
): CampaignStageId {
  const current = readProgress(storage)
  const currentUnlocked = current[faction]
  if (completedStage > currentUnlocked) return currentUnlocked

  const nextStage = Math.min(9, completedStage + 1) as CampaignStageId
  const unlocked = Math.max(currentUnlocked, nextStage) as CampaignStageId

  if (storage && unlocked !== currentUnlocked) {
    current[faction] = unlocked
    try {
      storage.setItem(DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY, JSON.stringify(current))
    } catch {
      // Progress persistence is best-effort; gameplay can continue without storage.
    }
  }

  return unlocked
}
