import type { CareerMissionPhase } from './CareerMissionState'

/** Player-facing name for an internal mission phase; the phase enum itself never reaches the screen. */
export function missionPhaseLabel(phase: CareerMissionPhase): string {
  switch (phase) {
    case 'ASSEMBLING': return '集合中'
    case 'MARCHING': return '行軍中'
    case 'ENGAGING':
    case 'ATTACKING': return '交戰中'
    case 'RETURNING': return '返回城鎮'
    case 'PREPARING':
    case 'DEPLOYING': return '部署準備中'
    case 'SPAWNING': return '敵軍抵達中'
    default: return '結算中'
  }
}

export function fieldMissionEngagementLabel(kind: 'bandit' | 'patrol', remainingEnemies: number): string {
  return kind === 'patrol'
    ? '擊退伏兵 · 保護隊伍'
    : `消滅盜匪 · 剩餘 ${remainingEnemies} 人`
}

export function fieldMissionHud(
  kind: 'bandit' | 'patrol',
  phase: CareerMissionPhase,
  remainingEnemies: number,
): string {
  if (kind === 'bandit') {
    const objective = phase === 'ASSEMBLING' ? '前往集合點'
      : phase === 'MARCHING' ? '跟隨隊長前往盜匪營地'
        : phase === 'ENGAGING' ? `消滅盜匪 · 剩餘 ${remainingEnemies} 人`
          : phase === 'RETURNING' ? '返回城鎮' : '剿匪任務結束'
    return `\n剿匪任務\n${objective}`
  }
  const objective = phase === 'ENGAGING'
    ? '擊退伏兵 · 保護隊伍'
    : phase === 'MARCHING'
      ? '跟隨隊長沿路巡邏'
      : phase === 'RETURNING'
        ? '返回城鎮'
        : phase === 'ASSEMBLING'
          ? '前往集合點'
          : '巡邏結束'
  return `\n巡邏任務\n${objective}`
}

/** Player-facing names for squad states; the saved state strings stay unchanged. */
export function personalSquadStateLabel(state: 'RESERVE' | 'DEPLOYING' | 'ACTIVE' | 'RETURNING'): string {
  return state === 'RESERVE' ? '待命中' : state === 'DEPLOYING' ? '出發中' : state === 'ACTIVE' ? '出戰中' : '返回中'
}

export function townCommandStateLabel(state: 'TRAINING' | 'FOLLOWING' | 'RETURNING' | null): string {
  return state === 'FOLLOWING' ? '跟隨中' : state === 'RETURNING' ? '返回中' : '駐防待命'
}
