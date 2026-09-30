import * as THREE from 'three'
import type { CareerMissionPhase } from './CareerMissionState'

/** CSS rotation for a right-pointing arrow, projected into the active camera's horizontal view. */
export function missionGuideArrowAngle(dx: number, dz: number, cameraYaw: number): number {
  const screenRight = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw)
  const screenForward = -dx * Math.sin(cameraYaw) - dz * Math.cos(cameraYaw)
  return Math.atan2(-screenForward, screenRight)
}

export class MissionGuide {
  private readonly root = document.createElement('div')
  private readonly arrow = document.createElement('div')
  private readonly label = document.createElement('div')

  constructor() {
    this.root.id = 'career-mission-guide'
    this.arrow.className = 'mission-guide-arrow'
    this.arrow.textContent = '➤'
    this.label.className = 'mission-guide-label'
    this.root.append(this.arrow, this.label)
    document.body.append(this.root)
    this.hide()
  }

  update(
    phase: CareerMissionPhase,
    playerPosition: THREE.Vector3,
    cameraYaw: number,
    target: THREE.Vector3 | null,
    remainingEnemies: number,
    lagging = false,
    patrol = false,
  ): void {
    this.root.hidden = false
    if (phase === 'ENGAGING') {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.label.textContent = `${patrol ? '巡邏遇敵' : '剿匪任務'} · 剩餘敵人 ${remainingEnemies}`
      return
    }
    if (!target || phase === 'RESULT') { this.hide(); return }
    const dx = target.x - playerPosition.x
    const dz = target.z - playerPosition.z
    const distance = Math.hypot(dx, dz)
    const screenAngle = missionGuideArrowAngle(dx, dz, cameraYaw)
    this.arrow.style.opacity = '.58'
    this.arrow.style.transform = `rotate(${screenAngle}rad)`
    const action = phase === 'ASSEMBLING'
      ? '前往集合點'
      : phase === 'RETURNING'
        ? '返回小鎮'
        : lagging ? '跟上隊伍' : patrol ? '沿路巡邏' : '前往 Bandit Camp'
    this.label.textContent = `${action} · ${Math.round(distance)}m`
  }

  updateTownDefense(
    phase: CareerMissionPhase,
    playerPosition: THREE.Vector3,
    cameraYaw: number,
    rallyPoint: THREE.Vector3,
    remainingEnemies: number,
    civilianDeaths: number,
    preparationRemaining: number,
  ): void {
    this.root.hidden = false
    if (phase === 'PREPARING') {
      const dx = rallyPoint.x - playerPosition.x
      const dz = rallyPoint.z - playerPosition.z
      const distance = Math.hypot(dx, dz)
      if (distance > 8) {
        this.arrow.style.opacity = '.58'
        this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
        this.label.textContent = `前往防守位置 · ${Math.round(distance)}m`
      } else {
        this.arrow.style.opacity = '.18'
        this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
        this.label.textContent = preparationRemaining > 0
          ? `加入防線，準備守城 · ${Math.ceil(preparationRemaining)}s`
          : '加入防線 · 守軍部署中'
      }
      return
    }
    this.arrow.style.opacity = '.18'
    this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
    this.label.textContent = `TOWN DEFENSE · 敵軍剩餘 ${remainingEnemies} · 平民死亡 ${civilianDeaths}/10`
  }

  hide(): void { this.root.hidden = true }
  dispose(): void { this.root.remove() }
}
