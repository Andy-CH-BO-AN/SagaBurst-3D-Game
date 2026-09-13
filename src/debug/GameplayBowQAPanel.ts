import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Player } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { NPC, AIState, AIType, Faction } from '../world/NPC'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { positionArrowCenterFromNock } from '../world/CharacterBowVisual'
import { getTerrainHeight } from '../world/Terrain'
import type { HandGripFrame } from '../world/BowAttachmentContract'
import { InventoryManager } from '../rpg/InventoryManager'
import { StaminaBar } from '../ui/StaminaBar'
import { HpBar } from '../ui/HpBar'
import { QuiverUI } from '../ui/QuiverUI'
import { SoundManager } from '../audio/SoundManager'

type Subject = 'player' | 'npc'
type Stage = 'before' | 'load' | 'hold' | 'release' | 'recovery' | 'walkBow' | 'runBow' | 'walk' | 'run'
interface LaunchRecord {
  actor: Subject
  time: number
  origin: number[]
  direction: number[]
  speed: number
  visualKind: 'arrow' | 'pilum'
  centerError?: number
}

/**
 * DEV-only deterministic input/AI harness. All animation, equipment and launch
 * decisions run through the real Player.update / NPC.update public methods.
 * Camera inspection reads the rendered skeleton; it never writes its pose.
 */
export class GameplayBowQAPanel {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.005, 300)
  private readonly controls: OrbitControls
  private readonly input = new PlayerInput()
  private readonly stamina = new StaminaBar()
  private readonly hp = new HpBar()
  private readonly quiver = new QuiverUI()
  private readonly sound = new SoundManager()
  private readonly inventory = new InventoryManager()
  private player!: Player
  private archer!: NPC
  private target!: NPC
  private subject: Subject = 'player'
  private stage: Stage = 'before'
  private targetEnabled = false
  private elapsed = 0
  private playing = false
  private speed = 0
  private launches: LaunchRecord[] = []
  private projectiles: ArrowProjectile[] = []
  private transitions: string[] = []
  private previousAction = ''
  private readonly aimTarget = new THREE.Vector3()
  private readonly panel: HTMLDivElement
  private readonly readValue = (id: string): string => (this.panel.querySelector(`#${id}`) as HTMLInputElement).value

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    if (!import.meta.env.DEV) throw new Error('Gameplay bow QA is development-only')
    this.scene.background = new THREE.Color(0xbac5cb)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6d665b, 2.4))
    const sun = new THREE.DirectionalLight(0xfff7e9, 3)
    sun.position.set(3, 8, 5)
    this.scene.add(sun)
    const floor = new THREE.PlaneGeometry(160, 160, 128, 128)
    floor.rotateX(-Math.PI / 2)
    const positions = floor.attributes.position
    for (let index = 0; index < positions.count; index++) {
      positions.setY(index, getTerrainHeight(positions.getX(index), positions.getZ(index)))
    }
    floor.computeVertexNormals()
    this.scene.add(new THREE.Mesh(floor, new THREE.MeshStandardMaterial({ color: 0x777b71, roughness: 1 })))
    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.enableDamping = false
    this.controls.minDistance = 0.12
    this.controls.maxDistance = 100
    document.getElementById('lock-overlay')?.remove()
    document.getElementById('controls-hint')?.remove()
    for (const id of ['crosshair', 'aim-reticle', 'compass-container']) {
      const element = document.getElementById(id)
      if (element) element.style.display = 'none'
    }
    this.panel = document.createElement('div')
    this.panel.id = 'gameplay-bow-qa-panel'
    this.panel.style.cssText = 'position:fixed;left:16px;top:60px;z-index:100;background:#17202bee;color:#fff;padding:12px;width:335px;font:13px system-ui;max-height:82vh;overflow:auto'
    this.panel.innerHTML = `<strong>實際 Player / NPC 持弓 QA</strong><br>
      <span>每格 1/60 s；使用正式 update、裝備與發射事件。</span><br>
      <label>角色 <select id="gameplay-bow-qa-subject"><option value="player">Player Viking</option><option value="npc">真正 Viking Bow NPC</option></select></label><br>
      <label>階段 <select id="gameplay-bow-qa-stage">
        <option value="before">Before</option><option value="load">Load</option><option value="hold">Hold / 滿弓前</option><option value="release">Release（首次發射畫格）</option><option value="recovery">Recovery</option>
        <option value="walkBow">W + bow / NPC 巡邏持弓</option><option value="runBow">Shift+W + bow / NPC 追擊持弓</option><option value="walk">W（非持弓）/ NPC 巡邏</option><option value="run">Shift+W（非持弓）/ NPC 追擊</option>
      </select></label><br>
      <label>視角 <select id="gameplay-bow-qa-view"><option value="body">全身</option><option value="palm">掌側</option><option value="opposite">對側</option><option value="top">持弓手俯視</option><option value="topHands">俯視雙手</option><option value="drawTop">拉弓手俯視</option><option value="drawPalm">拉弓手掌側</option><option value="drawOpposite">拉弓手對側</option><option value="drawOblique">拉弓手 45°</option><option value="axis">弓軸正面</option><option value="oblique">45°</option></select></label><br>
      <button id="gameplay-bow-qa-apply">重播至階段</button>
      <button id="gameplay-bow-qa-camera">只改鏡頭</button><br>
      <button id="gameplay-bow-qa-step">+1 畫格</button>
      <button id="gameplay-bow-qa-ten">+10 畫格</button>
      <button id="gameplay-bow-qa-play">播放 / 暫停</button><br>
      <small>Player 瞄準時禁止 sprint 加速；W 的 8 m/s 會使用 run 腿部。NPC 巡邏 2.2 m/s 使用 walk。NPC 滿弓會直接進 release，不能假報持續 bowHold。</small>
      <pre id="gameplay-bow-qa-status" style="white-space:pre-wrap"></pre>
      <details open><summary>實際發射事件（世界座標）</summary><pre id="gameplay-bow-qa-launches" style="white-space:pre-wrap"></pre></details>`
    // UI mouse operations must not also become gameplay input.
    for (const eventName of ['mousedown', 'mouseup', 'keydown', 'keyup']) {
      this.panel.addEventListener(eventName, event => event.stopPropagation())
    }
    document.body.append(this.panel)
    this.panel.querySelector<HTMLButtonElement>('#gameplay-bow-qa-apply')!.onclick = () => this.sample()
    this.panel.querySelector<HTMLButtonElement>('#gameplay-bow-qa-camera')!.onclick = () => this.frameCamera()
    this.panel.querySelector<HTMLButtonElement>('#gameplay-bow-qa-step')!.onclick = () => this.stepFrames(1)
    this.panel.querySelector<HTMLButtonElement>('#gameplay-bow-qa-ten')!.onclick = () => this.stepFrames(10)
    this.panel.querySelector<HTMLButtonElement>('#gameplay-bow-qa-play')!.onclick = () => { this.playing = !this.playing; this.writeStatus() }
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    })
    this.sample()
    this.render()
  }

  private reset(): void {
    this.player?.group.removeFromParent()
    this.archer?.group.removeFromParent()
    this.target?.group.removeFromParent()
    for (const projectile of this.projectiles) projectile.destroy()
    this.projectiles = []
    this.launches = []
    this.transitions = []
    this.previousAction = ''
    this.elapsed = 0
    this.speed = 0
    this.targetEnabled = false
    this.playing = false
    this.input.isLeftMouseDown = false
    this.input.isRightMouseDown = false
    for (const key of Object.keys(this.input.keys)) this.input.keys[key] = false
    this.input.consumeLeftClick()
    this.input.consumeLeftClickRelease()
    this.player = new Player(this.scene)
    this.player.faceDirection(0, 1)
    this.archer = new NPC(this.scene, 0, 0, Faction.PLAYER, AIType.RANGED, 'Bow QA Viking', 2, false)
    this.target = new NPC(this.scene, 0, 12, Faction.ENEMY, AIType.MELEE, 'Bow QA target', 2, false)
    this.target.position.y = getTerrainHeight(0, 12)
    this.target.group.visible = false
    // Let the real patrol AI consume its initial airborne spawn waypoint once,
    // then use public placement to start the diagnostic on its terrain surface.
    this.archer.update(1 / 60, this.player, [], [], [], this.hp, () => {}, () => {})
    this.archer.position.y = getTerrainHeight(this.archer.position.x, this.archer.position.z)
    this.player.group.visible = this.subject === 'player'
    this.archer.group.visible = this.subject === 'npc'
    this.player.onFireArrow = event => {
      const nock = this.player.getBowNockPosition(new THREE.Vector3())
      this.recordLaunch('player', event.origin, event.direction, event.speed, 'arrow', positionArrowCenterFromNock(nock, nock, event.direction).distanceTo(event.origin))
      this.projectiles.push(new ArrowProjectile(this.scene, event.origin, event.direction, event.speed, event.damage, Faction.PLAYER, true))
    }
  }

  private sample(): void {
    this.subject = this.readValue('gameplay-bow-qa-subject') as Subject
    this.stage = this.readValue('gameplay-bow-qa-stage') as Stage
    this.reset()
    if (this.subject === 'player') this.samplePlayer()
    else this.sampleNPC()
    this.frameCamera()
    this.writeStatus()
  }

  private samplePlayer(): void {
    this.stepFrames(30)
    if (this.stage === 'before') return
    const bow = this.stage !== 'walk' && this.stage !== 'run'
    this.input.isRightMouseDown = bow
    this.input.isLeftMouseDown = bow
    this.input.keys.KeyW = ['walkBow', 'runBow', 'walk', 'run'].includes(this.stage)
    this.input.keys.ShiftLeft = this.stage === 'runBow' || this.stage === 'run'
    this.stepFrames(this.stage === 'load' ? 36 : 78)
    if (this.stage === 'release' || this.stage === 'recovery') {
      // Releasing aim uses Player's normal automatic release branch, without
      // setting private click flags or calling its private animator.
      this.input.isLeftMouseDown = false
      this.input.isRightMouseDown = false
      for (let count = 0; this.launches.length === 0 && count < 60; count++) this.tick()
      if (this.stage === 'recovery') this.stepFrames(24)
    }
  }

  private sampleNPC(): void {
    if (this.stage === 'before' || this.stage === 'walkBow' || this.stage === 'walk') {
      this.stepFrames(this.stage === 'before' ? 1 : 60)
      return
    }
    this.targetEnabled = true
    if (this.stage === 'runBow' || this.stage === 'run') {
      this.target.position.z = 35
      this.target.position.y = getTerrainHeight(this.target.position.x, this.target.position.z)
      this.stepFrames(100)
      return
    }
    for (let count = 0; this.archer.currentState !== AIState.ATTACK && count < 240; count++) this.tick()
    if (this.stage === 'load') this.stepFrames(36)
    else if (this.stage === 'hold') this.stepFrames(88)
    else {
      for (let count = 0; this.launches.length === 0 && count < 180; count++) this.tick()
      if (this.stage === 'recovery') this.stepFrames(24)
    }
  }

  private tick(): void {
    const dt = 1 / 60
    this.elapsed += dt
    const actor = this.subject === 'player' ? this.player : this.archer
    const previousPosition = actor.position.clone()
    // Advance previous projectiles first so a newly emitted arrow is visible
    // at its exact production constructor origin in the release screenshot.
    for (const projectile of this.projectiles) {
      projectile.update(dt, this.player, [], [], () => {})
    }
    if (this.subject === 'player') {
      this.aimTarget.copy(this.player.position).add(new THREE.Vector3(0, 0.45, 12))
      this.player.update(dt, this.input, Math.PI, this.aimTarget, [], this.stamina, this.quiver, this.sound, this.inventory)
      this.quiver.setArrowCount(this.player.arrowCount)
    } else {
      this.archer.update(dt, this.player, this.targetEnabled ? [this.archer, this.target] : [this.archer], [], [], this.hp,
        () => {},
        (origin, direction, visualKind) => {
          this.recordLaunch('npc', origin, direction, 20, visualKind)
          this.projectiles.push(new ArrowProjectile(this.scene, origin, direction, 20, this.archer.rangedDamage, Faction.PLAYER, false, visualKind))
        })
    }
    this.speed = Math.hypot(actor.position.x - previousPosition.x, actor.position.z - previousPosition.z) / dt
    const action = `${actor.combatAnimationAction}${this.subject === 'npc' ? ` / ${this.archer.currentState}` : ''}`
    if (action !== this.previousAction) {
      this.transitions.push(`${this.elapsed.toFixed(3)} s: ${action}`)
      this.previousAction = action
    }
    this.scene.updateMatrixWorld(true)
  }

  private stepFrames(count: number): void {
    for (let frame = 0; frame < count; frame++) this.tick()
    this.writeStatus()
  }

  private recordLaunch(actor: Subject, origin: THREE.Vector3, direction: THREE.Vector3, speed: number, visualKind: 'arrow' | 'pilum', centerError?: number): void {
    const event: LaunchRecord = { actor, time: this.elapsed, origin: origin.toArray(), direction: direction.toArray(), speed, visualKind, centerError }
    this.launches.push(event)
    console.info('[GameplayBowQA] launch', JSON.stringify(event))
  }

  private frameCamera(): void {
    const root = this.subject === 'player' ? this.player.group : this.archer.group
    root.updateMatrixWorld(true)
    const socket = root.getObjectByName('socket_hand_l')
    const hand = socket?.parent
    const frame = socket?.userData.handGripFrame as HandGripFrame | undefined
    const view = this.readValue('gameplay-bow-qa-view')
    const bodyCenter = root.position.clone().add(new THREE.Vector3(0, this.subject === 'player' ? 0.1 : 1, 0))
    const center = hand && frame ? hand.localToWorld(frame.palmContactCenter.clone()) : bodyCenter
    const drawHand = root.getObjectByName('hand_r')
    const drawCenter = drawHand?.getWorldPosition(new THREE.Vector3()).lerp(drawHand.getObjectByName('bow_string_contact')!.getWorldPosition(new THREE.Vector3()), .5) ?? bodyCenter
    const drawNormal = drawHand ? new THREE.Vector3().fromArray(drawHand.userData.bowHandFrame.palmNormal).transformDirection(drawHand.matrixWorld) : new THREE.Vector3(1, 0, 0)
    const bothCenter = center.clone().lerp(drawCenter, 0.5)
    const normal = hand && frame ? frame.palmNormal.clone().transformDirection(hand.matrixWorld) : new THREE.Vector3(1, 0, 0)
    const thumb = hand && frame?.thumbDirection ? frame.thumbDirection.clone().transformDirection(hand.matrixWorld) : new THREE.Vector3(0, 1, 0)
    const tangent = new THREE.Vector3().crossVectors(normal, thumb).normalize()
    const direction = view === 'drawPalm' ? drawNormal : view === 'drawOpposite' ? drawNormal.clone().negate() : view === 'drawOblique' ? drawNormal.clone().add(new THREE.Vector3(0, .5, 1)).normalize() : view === 'palm' ? normal : view === 'opposite' ? normal.clone().negate()
      : ['top', 'topHands', 'drawTop'].includes(view) ? new THREE.Vector3(0.03, 1, 0.08).normalize()
        : view === 'axis' ? new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion)
          : view === 'body' ? new THREE.Vector3(0.6, 0.2, 1).normalize() : normal.clone().sub(tangent).normalize()
    this.camera.fov = view === 'body' ? 40 : view === 'topHands' ? 40 : 16
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(view === 'body' ? bodyCenter : view === 'topHands' ? bothCenter : view.startsWith('draw') ? drawCenter : center)
    this.camera.position.copy(this.controls.target).addScaledVector(direction, view === 'body' ? 3.4 : view === 'topHands' ? 2.2 : 1.3)
    this.controls.update()
  }

  private writeStatus(): void {
    if (!this.player) return
    const actor = this.subject === 'player' ? this.player : this.archer
    const locomotion = this.speed > 3 ? 'run' : this.speed > 0.1 ? 'walk' : 'idle'
    const playerState = this.subject === 'player' ? `aim=${this.player.isAiming}; draw=${this.player.bowDrawRatio.toFixed(3)}; arrows=${this.player.arrowCount}\nW=${!!this.input.keys.KeyW}; Shift=${!!this.input.keys.ShiftLeft}\n` : `AI=${this.archer.currentState}; bow NPC（Roman 目標未更新）\n`
    this.panel.querySelector('#gameplay-bow-qa-status')!.textContent =
      `${this.subject} / ${this.stage} / ${this.playing ? '播放' : '固定'}\nt=${this.elapsed.toFixed(3)} s; action=${actor.combatAnimationAction}\n` +
      `${playerState}實際速度=${this.speed.toFixed(3)} m/s；移動 clip=${locomotion}\n發射事件=${this.launches.length}\nVisual QA：未判定\n${this.transitions.slice(-8).join('\n')}`
    this.panel.querySelector('#gameplay-bow-qa-launches')!.textContent = JSON.stringify(this.launches, (_key, value) => typeof value === 'number' ? Number(value.toFixed(6)) : value, 2)
  }

  private render = (): void => {
    requestAnimationFrame(this.render)
    if (this.playing) { this.tick(); this.writeStatus() }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}
