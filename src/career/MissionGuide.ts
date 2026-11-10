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
    context?: 'mounted-field' | 'travel-encounter' | 'captain-sweep',
  ): void {
    this.root.hidden = false
    if (context === 'travel-encounter' && target) {
      this.pointAt(playerPosition, cameraYaw, target)
      this.label.textContent = `途中遇敵 · 協助隊伍 · 剩餘 ${remainingEnemies} 人`
      return
    }
    if (context === 'captain-sweep' && target && (phase === 'ASSEMBLING' || phase === 'MARCHING' || phase === 'ENGAGING')) {
      const distance = this.pointAt(playerPosition, cameraYaw, target)
      this.label.textContent = `前往盜匪營地 · ${Math.round(distance)} 公尺`
      return
    }
    if (phase === 'ENGAGING') {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.label.textContent = context === 'mounted-field' ? `消滅敵軍 · 剩餘 ${remainingEnemies} 人` : fieldMissionEngagementLabel(patrol ? 'patrol' : 'bandit', remainingEnemies)
      return
    }
    if (!target || phase === 'RESULT') { this.hide(); return }
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    const action = phase === 'ASSEMBLING'
      ? '前往集合點'
      : phase === 'RETURNING'
        ? '返回城鎮'
        : lagging ? '跟上隊伍' : context === 'mounted-field' ? '跟隨隊伍' : patrol ? '跟隨隊長巡邏' : '跟隨隊長前往盜匪營地'
    this.label.textContent = `${action} · ${Math.round(distance)} 公尺`
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
    const action = phase === 'ASSEMBLING' ? '前往兵營集合點' : phase === 'RETURNING' ? '返回兵營' : '前往單挑場地'
    this.label.textContent = `${action} · ${Math.round(Math.hypot(dx, dz))} 公尺`
  }

  updateCaptainPatrol(phase: CareerMissionPhase | null, playerPosition: THREE.Vector3,
    cameraYaw: number, target: THREE.Vector3 | null): void {
    if (!phase || !target || phase === 'RESULT') { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    this.label.textContent = phase === 'RETURNING' ? `返回城鎮 · ${Math.round(distance)} 公尺`
      : distance < 12 ? '已抵達巡邏隊 · 按 Q 下達命令' : `前往巡邏隊長 · ${Math.round(distance)} 公尺`
  }

  updateTownDefense(
    phase: CareerMissionPhase,
    playerPosition: THREE.Vector3,
    cameraYaw: number,
    rallyPoint: THREE.Vector3,
    remainingEnemies: number,
    civilianDeaths: number,
    preparationRemaining = 0,
    gateLabel?: string,
  ): void {
    this.root.hidden = false
    if (phase === 'PREPARING') {
      const dx = rallyPoint.x - playerPosition.x
      const dz = rallyPoint.z - playerPosition.z
      const distance = Math.hypot(dx, dz)
      if (distance > 8) {
        this.arrow.style.opacity = '.58'
        this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
        this.label.textContent = `敵軍來襲倒數 ${Math.ceil(preparationRemaining)} 秒 · 前往${gateLabel ?? '防守位置'} ${Math.round(distance)} 公尺`
      } else {
        this.arrow.style.opacity = '.18'
        this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
        this.label.textContent = `敵軍來襲倒數 ${Math.ceil(preparationRemaining)} 秒 · ${gateLabel ? `${gateLabel} · ` : ''}原地準備迎戰`
      }
      return
    }
    this.arrow.style.opacity = '.18'
    this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
    this.label.textContent = `守住${gateLabel ?? '城鎮'} · 敵軍剩餘 ${remainingEnemies} 人 · 平民死亡 ${civilianDeaths}/10`
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
    if (distance > 8) this.label.textContent = `前往防守位置 · ${Math.round(distance)} 公尺`
    else {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.label.textContent = `守住前哨 · 敵軍剩餘 ${remainingEnemies} 人`
    }
  }

  updateRace(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null, label: string): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    this.label.textContent = `${label} · ${Math.round(distance)} 公尺`
  }

  /** Tutorial targets share the mission presentation, with names supplied by the live owner. */
  updateTutorial(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null,
    label: string, interact = false): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = playerPosition.distanceTo(target)
    this.pointAt(playerPosition, cameraYaw, target)
    this.label.textContent = `${label} · ${Math.round(distance)} 公尺${interact ? ' · 靠近按 E 交談' : ''}`
  }

  updateRetirement(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    this.label.textContent = distance > 0 ? `前往退役集合區 · ${Math.round(distance)} 公尺` : '已抵達退役集合區'
    if (distance === 0) this.arrow.style.opacity = '.18'
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
