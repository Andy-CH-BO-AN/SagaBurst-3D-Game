import type { CareerMissionPhase } from './CareerMissionState'

export function fieldMissionEngagementLabel(kind: 'bandit' | 'patrol', remainingEnemies: number): string {
  return kind === 'patrol'
    ? '巡邏遭遇伏擊 · 解除威脅'
    : `剿匪任務 · 剩餘敵人 ${remainingEnemies}`
}

export function fieldMissionHud(
  kind: 'bandit' | 'patrol',
  phase: CareerMissionPhase,
  remainingEnemies: number,
): string {
  if (kind === 'bandit') return `\n剿匪任務 ${phase} · 剩餘 ${remainingEnemies}`
  const objective = phase === 'ENGAGING'
    ? '遭遇伏擊 · 解除威脅'
    : phase === 'MARCHING'
      ? '沿路巡邏'
      : phase === 'RETURNING'
        ? '返回小鎮'
        : phase === 'ASSEMBLING'
          ? '前往集合點'
          : '巡邏結束'
  return `\n巡邏任務 ${phase} · ${objective}`
}
