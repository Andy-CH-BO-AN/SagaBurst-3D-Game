import type { CampaignGateState } from '../campaign/CampaignGate'
import type { MobileSiegeRampState } from '../campaign/MobileSiegeRampController'
import { TOWN_GATES, type TownGateId } from '../town/TownLayout'

/** 守城 HUD 只讀資料模型：由唯讀 source 組成顯示字串與狀態，不擁有、不修改任何戰鬥狀態。 */
export type FourGateHudGateStatus = 'intact' | 'damaged' | 'critical' | 'open' | 'breached'
/** absent：尚未抵達；staged：待命或推進；docked：已接牆；abandoned：停駛／棄置；destroyed：已摧毀。 */
export type FourGateHudRampStatus = 'absent' | 'staged' | 'docked' | 'abandoned' | 'destroyed'

export const FOUR_GATE_HUD_CRITICAL_RATIO = 0.25
export const FOUR_GATE_HUD_GATE_LABELS: Readonly<Record<TownGateId, string>> = { north: '北門', east: '東門', south: '南門', west: '西門' }
export const FOUR_GATE_HUD_GATE_STATUS_LABELS: Readonly<Record<FourGateHudGateStatus, string>> = {
  intact: '完整', damaged: '受損', critical: '危急', open: '開啟', breached: '已攻破',
}
export const FOUR_GATE_HUD_RAMP_STATUS_LABELS: Readonly<Record<FourGateHudRampStatus, string>> = {
  absent: '未抵達', staged: '待命', docked: '已接牆', abandoned: '停駛', destroyed: '已摧毀',
}

/** 城門狀態：正常「開啟」與「已攻破」(destroyed) 嚴格分開，耐久只用來分級，不輸出精確數字。 */
export function fourGateHudGateStatus(state: CampaignGateState | undefined, hpRatio: number): FourGateHudGateStatus {
  if (state === 'destroyed') return 'breached'
  if (state === 'open') return 'open'
  if (!Number.isFinite(hpRatio) || hpRatio >= 1) return 'intact'
  return hpRatio < FOUR_GATE_HUD_CRITICAL_RATIO ? 'critical' : 'damaged'
}

export function fourGateHudRampStatus(state: MobileSiegeRampState | undefined): FourGateHudRampStatus {
  if (!state) return 'absent'
  if (state === 'DOCKED') return 'docked'
  if (state === 'DESTROYED') return 'destroyed'
  if (state === 'ABANDONED') return 'abandoned'
  return 'staged'
}

export function formatFourGateHudClock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export interface FourGateHudPhaseInput {
  phase: string | null
  preparationRemaining: number
  survivalRemaining: number
  spectating: boolean
}
export interface FourGateHudPhaseView { clock: string; label: string; hint: string }

/** 沿用任務既有階段與計時；觀戰只改標籤，倒數照常更新。 */
export function fourGateHudPhase(input: FourGateHudPhaseInput): FourGateHudPhaseView {
  const spectate = input.spectating ? ' · 觀戰中' : ''
  switch (input.phase) {
    case 'PREPARING': return { clock: formatFourGateHudClock(input.preparationRemaining), label: `備戰${spectate}`, hint: input.spectating ? '' : 'H 跳過準備' }
    case 'DEPLOYING': return { clock: formatFourGateHudClock(input.survivalRemaining), label: `部署中${spectate}`, hint: '' }
    case 'SPAWNING': return { clock: formatFourGateHudClock(input.survivalRemaining), label: `敵軍抵達中${spectate}`, hint: '' }
    case 'ATTACKING': return { clock: formatFourGateHudClock(input.survivalRemaining), label: `距守城勝利${spectate}`, hint: '' }
    default: return { clock: formatFourGateHudClock(input.survivalRemaining), label: `戰鬥結束${spectate}`, hint: '' }
  }
}

export interface FourGateHudSource {
  phase: string | null
  preparationRemaining: number
  survivalRemaining: number
  spectating: boolean
  friendlyAlive: number
  enemyAlive: number
  gates: readonly {
    id: TownGateId
    defendersAlive: number
    defendersTotal: number
    gateState: CampaignGateState | undefined
    gateHpRatio: number
    ramps: readonly [MobileSiegeRampState | undefined, MobileSiegeRampState | undefined]
  }[]
}

export interface FourGateHudGateView {
  id: TownGateId
  name: string
  count: string
  /** 0–100，整數百分比，守軍剩餘比例。 */
  percent: number
  status: FourGateHudGateStatus
  statusLabel: string
  ramps: readonly [FourGateHudRampStatus, FourGateHudRampStatus]
}
export interface FourGateHudView extends FourGateHudPhaseView {
  friendly: number
  enemy: number
  /** 0–100，我方在雙方存活總數中的比例；雙方皆為 0 時為 50。 */
  friendlyPercent: number
  gates: readonly FourGateHudGateView[]
}

const percent = (alive: number, total: number): number => total > 0 ? Math.round(Math.max(0, Math.min(1, alive / total)) * 100) : 0

/** 四門固定依 北、東、南、西 排列，不隨戰況重排。 */
export function buildFourGateHudView(source: FourGateHudSource): FourGateHudView {
  const byId = new Map(source.gates.map(gate => [gate.id, gate]))
  const total = source.friendlyAlive + source.enemyAlive
  const phase = fourGateHudPhase(source)
  return {
    ...phase,
    friendly: source.friendlyAlive,
    enemy: source.enemyAlive,
    friendlyPercent: total > 0 ? Math.round(source.friendlyAlive / total * 100) : 50,
    gates: (['north', 'east', 'south', 'west'] as const).filter(id => TOWN_GATES.some(gate => gate.id === id)).map(id => {
      const gate = byId.get(id)
      const alive = gate?.defendersAlive ?? 0, defendersTotal = gate?.defendersTotal ?? 0
      const status = fourGateHudGateStatus(gate?.gateState, gate?.gateHpRatio ?? 1)
      return {
        id, name: FOUR_GATE_HUD_GATE_LABELS[id], count: `${alive}/${defendersTotal}`, percent: percent(alive, defendersTotal),
        status, statusLabel: FOUR_GATE_HUD_GATE_STATUS_LABELS[status],
        ramps: [fourGateHudRampStatus(gate?.ramps[0]), fourGateHudRampStatus(gate?.ramps[1])] as const,
      }
    }),
  }
}
