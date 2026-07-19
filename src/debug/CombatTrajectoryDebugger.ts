import * as THREE from 'three'
import type { Player } from '../player/Player'
import { AIType, Faction, type NPC } from '../world/NPC'
import type { ArrowProjectile } from '../world/ArrowProjectile'
import type { CombatAction } from '../world/CharacterCombatAnimator'

const MAX_SAMPLES = 240
const MAX_ARROW_SAMPLES = 600
const AIM_GUIDE_LENGTH = 5
const MELEE_ACTIONS = new Set<CombatAction>([
  'daggerSlash',
  'swordSlash',
  'greatswordSlash',
  'lanceThrust',
  'mountedLance',
])

const debugActionLabel = (action: CombatAction): string => {
  switch (action) {
    case 'daggerSlash': return 'daggerThrust'
    case 'swordSlash': return 'swordThrust'
    case 'greatswordSlash': return 'greatswordThrust'
    default: return action
  }
}

interface DebugSource {
  key: number
  label: string
  root: THREE.Object3D
  action: CombatAction
  color: number
  showWeapon: boolean
  printSummary: boolean
  getTip: () => THREE.Vector3
  getGrip: (target: THREE.Vector3) => THREE.Vector3
}

interface TraceState {
  action: CombatAction
  count: number
  trailPositions: Float32Array
  trailAttribute: THREE.BufferAttribute
  trail: THREE.Line
  directionPositions: Float32Array
  directionAttribute: THREE.BufferAttribute
  direction: THREE.Line
  localStart: THREE.Vector3
  localEnd: THREE.Vector3
  localMin: THREE.Vector3
  localMax: THREE.Vector3
}

interface DebugLine {
  positions: Float32Array
  attribute: THREE.BufferAttribute
  line: THREE.Line
}

const formatVector = (value: THREE.Vector3): string =>
  `(${value.x.toFixed(2)}, ${value.y.toFixed(2)}, ${value.z.toFixed(2)})`

/** Query-only combat animation diagnostics enabled by `?devcombat`. */
export class CombatTrajectoryDebugger {
  private readonly traces = new Map<number, TraceState>()
  private readonly tmpGrip = new THREE.Vector3()
  private readonly tmpLocal = new THREE.Vector3()
  private readonly tmpBowGrip = new THREE.Vector3()
  private readonly tmpBowNock = new THREE.Vector3()
  private readonly tmpBowHand = new THREE.Vector3()
  private readonly tmpBowArrowTip = new THREE.Vector3()
  private readonly tmpBowTopTip = new THREE.Vector3()
  private readonly tmpBowBottomTip = new THREE.Vector3()
  private readonly tmpProjectileTip = new THREE.Vector3()
  private readonly tmpAimOrigin = new THREE.Vector3()
  private readonly tmpAimStart = new THREE.Vector3()
  private readonly tmpAimEnd = new THREE.Vector3()
  private readonly tmpAimDirection = new THREE.Vector3()
  private readonly lastBowNock = new THREE.Vector3()
  private readonly lastProjectileTip = new THREE.Vector3()
  private readonly panel: HTMLDivElement
  private readonly logAllNpcs: boolean
  private readonly bowNockTrail: DebugLine
  private readonly bowDrawLine: DebugLine
  private readonly bowHandLine: DebugLine
  private readonly bowArrowLine: DebugLine
  private readonly bowBodyLine: DebugLine
  private readonly bowStringLine: DebugLine
  private readonly projectileTrail: DebugLine
  private readonly aimGuideLine: DebugLine
  private readonly aimMarkerPositions: Float32Array
  private readonly aimMarkerAttribute: THREE.BufferAttribute
  private readonly aimMarker: THREE.LineSegments
  private bowActive = false
  private bowWasDrawing = false
  private bowSampleCount = 0
  private readonly bowLocalStart = new THREE.Vector3()
  private readonly bowLocalEnd = new THREE.Vector3()
  private readonly bowLocalMin = new THREE.Vector3()
  private readonly bowLocalMax = new THREE.Vector3()
  private projectileArrowId = -1
  private projectileSampleCount = 0
  private projectileComplete = true
  private readonly projectileStart = new THREE.Vector3()
  private readonly projectileEnd = new THREE.Vector3()
  private readonly projectileMin = new THREE.Vector3()
  private readonly projectileMax = new THREE.Vector3()

  constructor(private readonly scene: THREE.Scene) {
    this.logAllNpcs = new URLSearchParams(window.location.search).get('devcombat') === 'all'
    this.panel = document.createElement('div')
    this.panel.id = 'combat-trajectory-debug'
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '9999',
      padding: '8px 10px',
      color: '#fff4b0',
      background: 'rgba(5, 10, 15, 0.82)',
      border: '1px solid #d4af37',
      borderRadius: '4px',
      font: '12px/1.45 monospace',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    })
    document.body.appendChild(this.panel)

    this.bowNockTrail = this.createDebugLine(MAX_SAMPLES, 0xff66ff, 0.95)
    this.bowDrawLine = this.createDebugLine(2, 0x66ddff, 0.75)
    this.bowHandLine = this.createDebugLine(2, 0xffffff, 0.85)
    this.bowArrowLine = this.createDebugLine(2, 0xffaa33, 0.95)
    this.bowBodyLine = this.createDebugLine(9, 0x66ff66, 1)
    this.bowStringLine = this.createDebugLine(3, 0x66ddff, 0.95)
    this.projectileTrail = this.createDebugLine(MAX_ARROW_SAMPLES, 0x33ff99, 0.95)
    this.aimGuideLine = this.createDebugLine(2, 0xff3344, 0.95)

    this.aimMarkerPositions = new Float32Array(18)
    this.aimMarkerAttribute = new THREE.BufferAttribute(this.aimMarkerPositions, 3)
    const aimMarkerGeometry = new THREE.BufferGeometry()
    aimMarkerGeometry.setAttribute('position', this.aimMarkerAttribute)
    this.aimMarker = new THREE.LineSegments(
      aimMarkerGeometry,
      new THREE.LineBasicMaterial({ color: 0xff3344, depthTest: false, transparent: true, opacity: 0.95 }),
    )
    this.aimMarker.frustumCulled = false
    this.aimMarker.renderOrder = 1002
    this.aimMarker.visible = false
    this.aimMarker.userData.ignoreAimRaycast = true
    this.scene.add(this.aimMarker)
  }

  update(player: Player, npcs: NPC[], arrows: ArrowProjectile[], aimPoint: THREE.Vector3): void {
    this.sample({
      key: player.group.id,
      label: 'Player',
      root: player.group,
      action: player.combatAnimationAction,
      color: 0xffdd33,
      showWeapon: !player.isAiming,
      printSummary: true,
      getTip: () => player.getSwordTipPosition(),
      getGrip: (target) => player.getWeaponGripPosition(target),
    })

    let activeNpcActions = 0
    for (const npc of npcs) {
      const npcAction = npc.dead ? 'idle' : npc.combatAnimationAction
      if (MELEE_ACTIONS.has(npcAction)) activeNpcActions++
      this.sample({
        key: npc.group.id,
        label: npc.name,
        root: npc.group,
        action: npcAction,
        color: npc.faction === Faction.PLAYER ? 0x39a9ff : 0xff4b3e,
        showWeapon: !npc.dead && npc.aiType === AIType.MELEE,
        printSummary: this.logAllNpcs,
        getTip: () => npc.getWeaponTipPosition(),
        getGrip: (target) => npc.getWeaponGripPosition(target),
      })
    }

    this.sampleBow(player)
    this.sampleProjectile(arrows)
    this.sampleAimGuide(player, aimPoint)

    this.panel.textContent = [
      'COMBAT TRAJECTORY DEV  (?devcombat)',
      `Player: ${debugActionLabel(player.combatAnimationAction)}`,
      `Bow draw: ${Math.round(player.bowDrawRatio * 100)}%`,
      `NPC melee actions: ${activeNpcActions}`,
      'yellow=player  blue=ally  red=enemy',
      'short line=grip→tip  trail=attack path',
      'lime=full bow body  cyan=full bow string',
      'magenta=nock path  cyan thin=grip→nock',
      'white=hand→nock  orange=nocked arrow',
      'green=launched arrow flight path',
      'red=5m aim guide + target marker',
      this.logAllNpcs ? 'console=player+npcs' : 'console=player  (?devcombat=all for npcs)',
    ].join('\n')
  }

  private sampleAimGuide(player: Player, aimPoint: THREE.Vector3): void {
    const showingAim = player.isAiming || player.combatAnimationAction === 'bowRelease'
    this.aimGuideLine.line.visible = showingAim
    this.aimMarker.visible = showingAim
    if (!showingAim) return

    // Derive direction from the real nock-to-target launch vector, then draw
    // it from the character's upper torso so the guide is easy to read.
    const launchOrigin = player.getBowNockPosition(this.tmpAimOrigin)
    const direction = this.tmpAimDirection.copy(aimPoint).sub(launchOrigin).normalize()
    const start = this.tmpAimStart.copy(player.position)
    start.y += 1.1
    const end = this.tmpAimEnd.copy(start).addScaledVector(direction, AIM_GUIDE_LENGTH)
    this.setSegment(this.aimGuideLine, start, end)

    const size = 0.16
    this.aimMarkerPositions.set([
      end.x - size, end.y, end.z, end.x + size, end.y, end.z,
      end.x, end.y - size, end.z, end.x, end.y + size, end.z,
      end.x, end.y, end.z - size, end.x, end.y, end.z + size,
    ])
    this.aimMarkerAttribute.needsUpdate = true
  }

  private sampleBow(player: Player): void {
    const showingBow = player.isAiming || player.combatAnimationAction === 'bowRelease'
    if (!showingBow) {
      this.bowDrawLine.line.visible = false
      this.bowHandLine.line.visible = false
      this.bowArrowLine.line.visible = false
      this.bowBodyLine.line.visible = false
      this.bowStringLine.line.visible = false
      this.bowNockTrail.line.visible = false
      if (this.bowActive) this.printBowSummary()
      this.bowActive = false
      this.bowWasDrawing = false
      return
    }

    const grip = player.getBowGripPosition(this.tmpBowGrip)
    const nock = player.getBowNockPosition(this.tmpBowNock)
    const hand = player.getBowStringHandPosition(this.tmpBowHand)
    const arrowTip = player.getNockedArrowTipPosition(this.tmpBowArrowTip)
    const topTip = player.getBowTopTipPosition(this.tmpBowTopTip)
    const bottomTip = player.getBowBottomTipPosition(this.tmpBowBottomTip)

    if (!this.bowActive) {
      this.bowActive = true
      this.bowSampleCount = 0
      this.bowNockTrail.line.geometry.setDrawRange(0, 0)
      this.bowNockTrail.line.visible = true
      this.lastBowNock.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    }

    this.setSegment(this.bowDrawLine, grip, nock)
    this.setSegment(this.bowHandLine, hand, nock)
    this.setSegment(this.bowArrowLine, nock, arrowTip)
    const bodyPointCount = player.writeBowBodyProfile(this.bowBodyLine.positions)
    this.bowBodyLine.attribute.needsUpdate = true
    this.bowBodyLine.line.geometry.setDrawRange(0, bodyPointCount)
    this.bowBodyLine.line.visible = true
    this.setPolyline(this.bowStringLine, [topTip, nock, bottomTip])

    // Do not record the 0→aim arm-raising transition: it draws a large arc
    // toward the ground that is not the arrow's firing direction. The magenta
    // trail now contains only the actual string pull while the mouse is held.
    if (!player.isAiming || player.bowDrawRatio <= 0.001) {
      if (!this.bowWasDrawing) {
        this.bowSampleCount = 0
        this.bowNockTrail.line.geometry.setDrawRange(0, 0)
        this.lastBowNock.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
      }
      return
    }
    this.bowWasDrawing = true

    // Ignore identical held frames so a long aim does not consume the sample
    // buffer before the player starts pulling the string.
    if (this.bowSampleCount >= MAX_SAMPLES || nock.distanceToSquared(this.lastBowNock) < 0.000001) return
    this.lastBowNock.copy(nock)
    this.appendPoint(this.bowNockTrail, this.bowSampleCount, nock)
    this.bowSampleCount++
    this.bowNockTrail.line.geometry.setDrawRange(0, this.bowSampleCount)

    this.tmpLocal.copy(nock)
    player.group.worldToLocal(this.tmpLocal)
    if (this.bowSampleCount === 1) {
      this.bowLocalStart.copy(this.tmpLocal)
      this.bowLocalMin.copy(this.tmpLocal)
      this.bowLocalMax.copy(this.tmpLocal)
    }
    this.bowLocalEnd.copy(this.tmpLocal)
    this.bowLocalMin.min(this.tmpLocal)
    this.bowLocalMax.max(this.tmpLocal)
  }

  private sampleProjectile(arrows: ArrowProjectile[]): void {
    let current: ArrowProjectile | undefined
    for (let i = arrows.length - 1; i >= 0; i--) {
      if (arrows[i].isPlayerFired) {
        current = arrows[i]
        break
      }
    }

    if (!current) {
      if (!this.projectileComplete) this.finishProjectileTrace()
      return
    }

    const arrowId = current.mesh.id
    if (arrowId !== this.projectileArrowId) {
      if (!this.projectileComplete) this.finishProjectileTrace()
      this.projectileArrowId = arrowId
      this.projectileSampleCount = 0
      this.projectileComplete = false
      this.projectileTrail.line.geometry.setDrawRange(0, 0)
      this.projectileTrail.line.visible = true
      this.lastProjectileTip.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    }

    if (this.projectileComplete || this.projectileSampleCount >= MAX_ARROW_SAMPLES) return
    const tip = current.getTipPosition(this.tmpProjectileTip)
    // Spatial sampling keeps the full 200 m flight inside the fixed buffer on
    // high-refresh displays without changing the rendered trajectory shape.
    const movedEnough = tip.distanceToSquared(this.lastProjectileTip) >= 0.12
    if (!movedEnough && !current.isStuck) return
    this.lastProjectileTip.copy(tip)
    this.appendPoint(this.projectileTrail, this.projectileSampleCount, tip)
    this.projectileSampleCount++
    this.projectileTrail.line.geometry.setDrawRange(0, this.projectileSampleCount)

    if (this.projectileSampleCount === 1) {
      this.projectileStart.copy(tip)
      this.projectileMin.copy(tip)
      this.projectileMax.copy(tip)
    }
    this.projectileEnd.copy(tip)
    this.projectileMin.min(tip)
    this.projectileMax.max(tip)

    if (current.isStuck || this.projectileSampleCount >= MAX_ARROW_SAMPLES) {
      this.finishProjectileTrace()
    }
  }

  private printBowSummary(): void {
    console.info(`[CombatTrajectory] Player bowDraw — ${this.bowSampleCount} moving samples`)
    console.table({
      start: formatVector(this.bowLocalStart),
      end: formatVector(this.bowLocalEnd),
      min: formatVector(this.bowLocalMin),
      max: formatVector(this.bowLocalMax),
    })
  }

  private finishProjectileTrace(): void {
    if (this.projectileComplete) return
    this.projectileComplete = true
    console.info(`[CombatTrajectory] Player arrowFlight — ${this.projectileSampleCount} samples`)
    console.table({
      start: formatVector(this.projectileStart),
      end: formatVector(this.projectileEnd),
      min: formatVector(this.projectileMin),
      max: formatVector(this.projectileMax),
    })
  }

  private setSegment(line: DebugLine, from: THREE.Vector3, to: THREE.Vector3): void {
    line.positions.set([from.x, from.y, from.z, to.x, to.y, to.z])
    line.attribute.needsUpdate = true
    line.line.geometry.setDrawRange(0, 2)
    line.line.visible = true
  }

  private setPolyline(line: DebugLine, points: readonly THREE.Vector3[]): void {
    const count = Math.min(points.length, line.positions.length / 3)
    for (let i = 0; i < count; i++) {
      const offset = i * 3
      line.positions[offset] = points[i].x
      line.positions[offset + 1] = points[i].y
      line.positions[offset + 2] = points[i].z
    }
    line.attribute.needsUpdate = true
    line.line.geometry.setDrawRange(0, count)
    line.line.visible = true
  }

  private appendPoint(line: DebugLine, index: number, point: THREE.Vector3): void {
    const offset = index * 3
    line.positions[offset] = point.x
    line.positions[offset + 1] = point.y
    line.positions[offset + 2] = point.z
    line.attribute.needsUpdate = true
  }

  private createDebugLine(maxPoints: number, color: number, opacity: number): DebugLine {
    const positions = new Float32Array(maxPoints * 3)
    const attribute = new THREE.BufferAttribute(positions, 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', attribute)
    geometry.setDrawRange(0, 0)
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }),
    )
    line.frustumCulled = false
    line.renderOrder = 1001
    line.visible = false
    line.userData.ignoreAimRaycast = true
    this.scene.add(line)
    return { positions, attribute, line }
  }

  private sample(source: DebugSource): void {
    const state = this.getOrCreateTrace(source.key, source.color)
    const tip = source.getTip()
    const grip = source.getGrip(this.tmpGrip)

    state.direction.visible = source.showWeapon
    if (source.showWeapon) {
      state.directionPositions.set([grip.x, grip.y, grip.z, tip.x, tip.y, tip.z])
      state.directionAttribute.needsUpdate = true
    }

    const isMelee = MELEE_ACTIONS.has(source.action)
    const wasMelee = MELEE_ACTIONS.has(state.action)
    if (!isMelee) {
      if (wasMelee && source.printSummary) this.printSummary(source.label, state)
      state.action = source.action
      return
    }

    if (source.action !== state.action) {
      state.action = source.action
      state.count = 0
      state.trail.geometry.setDrawRange(0, 0)
      state.trail.visible = true
    }

    if (state.count >= MAX_SAMPLES) return
    const offset = state.count * 3
    state.trailPositions[offset] = tip.x
    state.trailPositions[offset + 1] = tip.y
    state.trailPositions[offset + 2] = tip.z
    state.count++
    state.trail.geometry.setDrawRange(0, state.count)
    state.trailAttribute.needsUpdate = true

    this.tmpLocal.copy(tip)
    source.root.worldToLocal(this.tmpLocal)
    if (state.count === 1) {
      state.localStart.copy(this.tmpLocal)
      state.localMin.copy(this.tmpLocal)
      state.localMax.copy(this.tmpLocal)
    }
    state.localEnd.copy(this.tmpLocal)
    state.localMin.min(this.tmpLocal)
    state.localMax.max(this.tmpLocal)
  }

  private getOrCreateTrace(key: number, color: number): TraceState {
    const existing = this.traces.get(key)
    if (existing) return existing

    const trailPositions = new Float32Array(MAX_SAMPLES * 3)
    const trailAttribute = new THREE.BufferAttribute(trailPositions, 3)
    const trailGeometry = new THREE.BufferGeometry()
    trailGeometry.setAttribute('position', trailAttribute)
    trailGeometry.setDrawRange(0, 0)
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
    )
    trail.frustumCulled = false
    trail.renderOrder = 1000
    trail.visible = false
    trail.userData.ignoreAimRaycast = true
    this.scene.add(trail)

    const directionPositions = new Float32Array(6)
    const directionAttribute = new THREE.BufferAttribute(directionPositions, 3)
    const directionGeometry = new THREE.BufferGeometry()
    directionGeometry.setAttribute('position', directionAttribute)
    const direction = new THREE.Line(
      directionGeometry,
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.55 }),
    )
    direction.frustumCulled = false
    direction.renderOrder = 999
    direction.userData.ignoreAimRaycast = true
    this.scene.add(direction)

    const created: TraceState = {
      action: 'idle',
      count: 0,
      trailPositions,
      trailAttribute,
      trail,
      directionPositions,
      directionAttribute,
      direction,
      localStart: new THREE.Vector3(),
      localEnd: new THREE.Vector3(),
      localMin: new THREE.Vector3(),
      localMax: new THREE.Vector3(),
    }
    this.traces.set(key, created)
    return created
  }

  private printSummary(label: string, state: TraceState): void {
    console.info(`[CombatTrajectory] ${label} ${debugActionLabel(state.action)} — ${state.count} samples`)
    console.table({
      start: formatVector(state.localStart),
      end: formatVector(state.localEnd),
      min: formatVector(state.localMin),
      max: formatVector(state.localMax),
    })
  }
}
