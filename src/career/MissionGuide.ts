import * as THREE from 'three'
import type { CareerMissionPhase } from './CareerMissionState'
import { fieldMissionEngagementLabel } from './CareerMissionPresentation'

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

  constructor(id = 'career-mission-guide') {
    this.root.id = id
    this.root.className = 'career-mission-guide'
    this.root.style.cssText = 'position:fixed;left:50%;bottom:155px;transform:translateX(-50%);z-index:94;pointer-events:none;text-align:center;color:#fff1c6;text-shadow:0 2px 5px #000;font:600 15px/1.4 system-ui'
    this.arrow.style.cssText = 'width:42px;height:42px;margin:0 auto 4px;color:#f4d287;font:40px/42px system-ui;opacity:.58;transform-origin:center;transition:transform .12s linear,opacity .2s'
    this.label.style.cssText = 'padding:5px 10px;border-radius:4px;background:#15120ea8;border:1px solid #b6955e66'
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
    context?: 'mounted-field',
  ): void {
    this.root.hidden = false
    if (phase === 'ENGAGING') {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.label.textContent = context === 'mounted-field' ? `FIELD BATTLE · 敵軍剩餘 ${remainingEnemies}` : fieldMissionEngagementLabel(patrol ? 'patrol' : 'bandit', remainingEnemies)
      return
    }
    if (!target || phase === 'RESULT') { this.hide(); return }
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    const action = phase === 'ASSEMBLING'
      ? '前往集合點'
      : phase === 'RETURNING'
        ? '返回小鎮'
        : lagging ? '跟上隊伍' : context === 'mounted-field' ? '跟隨隊伍' : patrol ? '沿路巡邏' : '前往 Bandit Camp'
    this.label.textContent = `${action} · ${Math.round(distance)}m`
  }

  updateDuel(
    phase: CareerMissionPhase | null,
    playerPosition: THREE.Vector3,
    cameraYaw: number,
    target: THREE.Vector3 | null,
  ): void {
    if (!target || (phase !== 'ASSEMBLING' && phase !== 'MARCHING' && phase !== 'RETURNING')) { this.hide(); return }
    const dx = target.x - playerPosition.x, dz = target.z - playerPosition.z
    this.root.hidden = false
    this.arrow.style.opacity = '.58'
    this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
    const action = phase === 'ASSEMBLING' ? '前往兵營集合點' : phase === 'RETURNING' ? '返回兵營' : '前往城外單挑場地'
    this.label.textContent = `${action} · ${Math.round(Math.hypot(dx, dz))}m`
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

  /** Reuses the mission arrow for Career battles at the real Campaign Outpost. */
  updateOutpostDefense(
    phase: CareerMissionPhase,
    playerPosition: THREE.Vector3,
    cameraYaw: number,
    rallyPoint: THREE.Vector3,
    remainingEnemies: number,
  ): void {
    if (phase === 'RESULT' || phase === 'RESET') { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, rallyPoint)
    if (distance > 8) this.label.textContent = `前往防守位置 · ${Math.round(distance)}m`
    else {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.label.textContent = `OUTPOST DEFENSE · 敵軍剩餘 ${remainingEnemies}`
    }
  }

  private pointAt(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3): number {
    const dx = target.x - playerPosition.x
    const dz = target.z - playerPosition.z
    this.arrow.style.opacity = '.58'
    this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
    return Math.hypot(dx, dz)
  }

  hide(): void { this.root.hidden = true }
  dispose(): void { this.root.remove() }
}
