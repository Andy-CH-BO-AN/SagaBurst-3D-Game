import * as THREE from 'three'
import type { CareerMissionPhase } from './CareerMissionState'
import { fieldMissionEngagementLabel } from './CareerMissionPresentation'
import '../ui/career-hud.css'

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
  private readonly labelText = document.createElement('span')
  private readonly distBadge = document.createElement('span')
  private readonly interactBadge = document.createElement('span')
  private pillKey = ''

  constructor(id = 'career-mission-guide') {
    this.root.id = id
    this.root.className = 'career-mission-guide'
    this.arrow.className = 'mission-guide-arrow'
    this.label.className = 'mission-guide-label'

    this.labelText.className = 'mission-guide-text'
    this.distBadge.className = 'mission-guide-dist'
    this.distBadge.hidden = true

    this.interactBadge.className = 'mission-guide-interact'
    const kbd = document.createElement('kbd')
    kbd.className = 'sb-kbd'
    kbd.textContent = 'E'
    const interactText = document.createElement('span')
    interactText.textContent = '交談'
    this.interactBadge.append(kbd, interactText)
    this.interactBadge.hidden = true

    this.label.append(this.labelText, this.distBadge, this.interactBadge)
    this.root.append(this.arrow, this.label)
    document.body.append(this.root)
    this.hide()
  }

  private setPill(text: string, distanceMeters?: number, interact = false): void {
    const distText = distanceMeters !== undefined ? `${Math.round(distanceMeters)}m` : ''
    const key = `${text}|${distText}|${interact ? '1' : '0'}`
    if (key === this.pillKey) return
    this.pillKey = key
    this.labelText.textContent = text
    this.distBadge.textContent = distText
    this.distBadge.hidden = !distText
    this.interactBadge.hidden = !interact
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
      this.setPill(`途中遇敵 · 協助隊伍 · 剩餘 ${remainingEnemies} 人`)
      return
    }
    if (context === 'captain-sweep' && target && (phase === 'ASSEMBLING' || phase === 'MARCHING' || phase === 'ENGAGING')) {
      const distance = this.pointAt(playerPosition, cameraYaw, target)
      if (phase === 'ENGAGING') this.setPill(`消滅盜匪 · 剩餘 ${remainingEnemies} 人`)
      else this.setPill('前往盜匪營地', distance)
      return
    }
    if (phase === 'ENGAGING') {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.setPill(context === 'mounted-field' ? `消滅敵軍 · 剩餘 ${remainingEnemies} 人` : fieldMissionEngagementLabel('bandit', remainingEnemies))
      return
    }
    if (!target || phase === 'RESULT') { this.hide(); return }
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    const action = phase === 'ASSEMBLING'
      ? '前往集合點'
      : phase === 'RETURNING'
        ? '返回城鎮'
        : lagging ? '跟上隊伍' : context === 'mounted-field' ? '跟隨隊伍' : patrol ? '跟隨隊長巡邏' : '跟隨隊長前往盜匪營地'
    this.setPill(action, distance)
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
    this.arrow.style.opacity = '.78'
    this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
    const action = phase === 'ASSEMBLING' ? '前往兵營集合點' : phase === 'RETURNING' ? '返回兵營' : '前往單挑場地'
    this.setPill(action, Math.hypot(dx, dz))
  }

  updateCaptainPatrol(phase: CareerMissionPhase | null, playerPosition: THREE.Vector3,
    cameraYaw: number, target: THREE.Vector3 | null): void {
    if (!phase || !target || phase === 'RESULT') { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    if (phase === 'RETURNING') this.setPill('返回城鎮', distance)
    else if (distance < 12) this.setPill('已抵達巡邏隊 · 按 Q 下達命令')
    else this.setPill('前往巡邏隊長', distance)
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
        this.arrow.style.opacity = '.78'
        this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
        this.setPill(`敵軍來襲倒數 ${Math.ceil(preparationRemaining)} 秒 · 前往${gateLabel ?? '防守位置'}`, distance)
      } else {
        this.arrow.style.opacity = '.18'
        this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
        this.setPill(`敵軍來襲倒數 ${Math.ceil(preparationRemaining)} 秒 · ${gateLabel ? `${gateLabel} · ` : ''}原地準備迎戰`)
      }
      return
    }
    this.arrow.style.opacity = '.18'
    this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
    this.setPill(`守住${gateLabel ?? '城鎮'} · 敵軍剩餘 ${remainingEnemies} 人 · 平民死亡 ${civilianDeaths}/10`)
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
    if (distance > 8) this.setPill('前往防守位置', distance)
    else {
      this.arrow.style.opacity = '.18'
      this.arrow.style.transform = 'rotate(-90deg) scale(.7)'
      this.setPill(`守住前哨 · 敵軍剩餘 ${remainingEnemies} 人`)
    }
  }

  updateRace(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null, label: string): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    this.setPill(label, distance)
  }

  /** Tutorial targets share the mission presentation, with names supplied by the live owner. */
  updateTutorial(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null,
    label: string, interact = false): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = playerPosition.distanceTo(target)
    this.pointAt(playerPosition, cameraYaw, target)
    this.setPill(label, distance, interact)
  }

  updateRetirement(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3 | null): void {
    if (!target) { this.hide(); return }
    this.root.hidden = false
    const distance = this.pointAt(playerPosition, cameraYaw, target)
    if (distance > 0) this.setPill('前往退役集合區', distance)
    else {
      this.arrow.style.opacity = '.18'
      this.setPill('已抵達退役集合區')
    }
  }

  private pointAt(playerPosition: THREE.Vector3, cameraYaw: number, target: THREE.Vector3): number {
    const dx = target.x - playerPosition.x
    const dz = target.z - playerPosition.z
    this.arrow.style.opacity = '.78'
    this.arrow.style.transform = `rotate(${missionGuideArrowAngle(dx, dz, cameraYaw)}rad)`
    return Math.hypot(dx, dz)
  }

  hide(): void { this.root.hidden = true }
  dispose(): void { this.root.remove() }
}
