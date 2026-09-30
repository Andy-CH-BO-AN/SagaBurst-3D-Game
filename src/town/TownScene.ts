import * as THREE from 'three'
import { Player, PLAYER_ARROW_CAPACITY } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { NPC, AIType, Faction } from '../world/NPC'
import { Mount, MountType, mountTypeFromId } from '../world/Mount'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { CorgiVisual } from '../world/CorgiVisual'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { getTerrainHeight, resolveEntityCollision, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { damageNpc, damagePlayer } from '../combat/DamageRouter'
import { createNpcCombatActorRef, createPlayerCombatActorRef, type CombatDamageMethod } from '../combat/CombatAttribution'
import { SpatialGrid } from '../world/SpatialGrid'
import { checkMountImpact, applyMountImpactDamage } from '../combat/MountImpact'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { DamageNumbers } from '../ui/DamageNumbers'
import { selectTownDialogue, formatTownDialogue, promotionDetails, TownAmbientDialogue, type DialogueContext, type DialogueRole } from '../career/CareerTownDialogue'
import { installTownStyles } from './TownUI'
import { isTownProductOwned, purchaseTownHorse } from './TownRules'
import { getCareerPurchaseTier } from '../career/CareerProfile'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { QuiverUI } from '../ui/QuiverUI'
import { EquipmentUI } from '../ui/EquipmentUI'
import { SkillManager } from '../rpg/SkillManager'
import { SoundManager, type AudioCommand, type CareerMissionVoiceCue, type HorseGallopCandidate } from '../audio/SoundManager'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, claimCareerMission, clearCareerMission, cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from '../career/CareerProfile'
import { availableRecruitMissions, getRecruitMissionTemplate, patrolPreferredCamp } from '../career/CareerMissionCatalog'
import { BanditMissionController } from '../career/BanditMissionController'
import { fieldMissionHud } from '../career/CareerMissionPresentation'
import { RECRUIT_MISSION_MERIT_RULES } from '../career/CareerMissionMeritPolicy'
import { TownDefenseController } from '../career/TownDefenseController'
import { CareerMountController } from '../career/CareerMountController'
import { preserveHpRatio, resolveCareerHeroAsset } from '../career/CareerPlayerProfile'
import { createTownDefenseMission, type CareerMissionOutcome, type CareerMissionResult } from '../career/CareerMissionState'
import { getAntiCavalryMultiplier } from '../combat/CombatBalance'
import { calculatePlayerMeleeDamage } from '../combat/PlayerMeleeDamage'
import { townMeleeBuildingContact, townMeleeContact } from './TownCombat'
import { TownWorld } from './TownWorld'
import { TownEquipment } from './TownEquipment'
import { TOWN_RULES, TownEvent, townRoster, townCaptainProfile, townMilitaryEquipment, stableHorsePositions, townSitePoint, TOWN_SITES, isCivilian, productStatus, TOWN_PRODUCTS, settleTown, updateRangerMount, type TownActorSpec, type TownResult } from './TownRules'

let sound: SoundManager
interface Resident { spec: TownActorSpec; npc: NPC; homeMount?: Mount; target?: THREE.Vector3; cycle: number; walkTime: number }
interface Shot { arrow: ArrowProjectile; readonly training: boolean; readonly player: boolean; readonly source?: NPC; age: number }
const NAMES: Record<string, string> = { captain: '騎兵隊長', deployment: '士官長', merchant: '武器店主', ranger: '遊俠 Maki', cat: '黑貓店主', civilian: '平民 Civilian' }
export class TownScene {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 400)
  readonly renderer: THREE.WebGLRenderer
  readonly event = new TownEvent()
  readonly world: TownWorld
  player!: Player
  readonly residents: Resident[] = []
  readonly mounts: Mount[] = []
  readonly stableHorses: Mount[] = []
  private readonly serviceMarkers = new Map<string, THREE.Sprite>()
  cat!: Mount
  readonly inventory: TownEquipment
  private readonly input = new PlayerInput()
  private orbit!: ThirdPersonCamera
  private readonly grid = new SpatialGrid<NPC>(4)
  private readonly defenseEnemyGrid = new SpatialGrid<NPC>(8)
  private readonly defenseTownGrid = new SpatialGrid<NPC>(8)
  private readonly banditThreatGrid = new SpatialGrid<NPC>(20)
  private readonly externalThreatActors = new Set<NPC>()
  private readonly neighbors: NPC[] = []
  private nextTrainingSound = 0
  private readonly previousControls = document.getElementById('controls-hint')!.textContent
  private npcObstacles: ObstacleData[] = []
  private readonly navigation = new NavigationWorld()
  private readonly hp = new HpBar()
  private readonly stamina = new StaminaBar()
  private readonly quiver = new QuiverUI()
  private readonly equipment = new EquipmentUI()
  private readonly skills = new SkillManager()
  private readonly listeners = new AbortController()
  private readonly hud = document.createElement('div')
  private readonly hint = document.createElement('div')
  private readonly pointerPrompt = document.createElement('div')
  private panel: HTMLDivElement | null = null
  private target: string | null = null
  private shots: Shot[] = []
  private raf = 0
  private last = performance.now()
  private elapsed = 0
  private disposed = false
  private result: TownResult | null = null
  chargeSpeakerId: string | null = null
  private readonly damageNumbers = new DamageNumbers()
  private readonly ambient = new TownAmbientDialogue()
  private readonly ambientLabel = document.createElement('div')
  private ambientUntil = 0
  private ambientActor: NPC | null = null
  private readonly previousTip = new THREE.Vector3()
  private hasPreviousTip = false
  private notice = ''
  private readonly store = new CareerProfileStore()
  private mission!: BanditMissionController
  private defense!: TownDefenseController
  private careerMounts!: CareerMountController
  private missionResultOpen = false
  private careerCommandCue: AudioCommand | null = null
  private ambientDefeatShown = false
  static async create(container: HTMLElement, profile: CareerProfile, onCampaign: () => void, onRestart: (p: CareerProfile) => void, progress: (text: string) => void = () => {}): Promise<TownScene> {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    try {
      progress('載入人物、坐騎與動畫…')
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), BlackCatVisual.preload(), CorgiVisual.preload(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[townCaptainProfile(profile.faction).visualAssetId].descriptor), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['maki-archer-t4'].descriptor), preloadMakiRangerBow()])
      progress('建立村莊與營地…')
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const town = new TownScene(container, renderer, profile, onCampaign, onRestart)
      try { await town.initialize(progress); return town } catch (error) { town.dispose(); throw error }
    } catch (error) { renderer.dispose(); throw error }
  }
  private constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, public profile: CareerProfile, _onCampaign: () => void, private readonly onRestart: (p: CareerProfile) => void) {
    installTownStyles()
    sound ??= new SoundManager()
    this.renderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement)
    this.world = new TownWorld(profile.faction, this.scene)
    this.inventory = new TownEquipment(() => this.profile, p => this.commit(p))
  }
  private async initialize(progress: (text: string) => void): Promise<void> {
    const { profile, renderer } = this
    const yieldFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const catSpot = townSitePoint('stable', -3, 8)
    this.cat = new Mount(this.scene, MountType.BLACK_CAT, catSpot.x, catSpot.z); this.cat.group.rotation.y = catSpot.yaw; this.cat.reservedForTown = true; this.cat.catVisual?.setEquipmentVisible(false); this.mounts.push(this.cat)
    for (const stall of stableHorsePositions()) {
      const horse = new Mount(this.scene, MountType.HORSE, stall.x, stall.z, getTerrainHeight(TOWN_SITES.stable.x, TOWN_SITES.stable.z) + .5, stall.variant)
      horse.reservedForTown = true; horse.group.rotation.y = stall.yaw
      this.stableHorses.push(horse); this.mounts.push(horse)
    }
    let spawned = 0
    for (const spec of townRoster()) {
      if (spawned++ % 4 === 0) { progress('建立駐軍與居民 ' + Math.min(spawned, 85) + ' / 85…'); await yieldFrame() }
      if (spec.role === 'cat') { this.event.register(spec.id, this.cat); this.serviceMarkers.set(spec.id, this.world.addServiceMarker(this.cat.group, 2.15)); continue }
      const civilian = isCivilian(spec.role), ranger = spec.role === 'ranger', cavalry = spec.role.includes('cavalry') || spec.role === 'captain', ranged = spec.role.startsWith('ranged') || ranger
      const military = !civilian && !ranger ? townMilitaryEquipment(profile.faction, spec.role) : null
      const preset = military?.presetId
      const captain = spec.role === 'captain' ? townCaptainProfile(profile.faction) : undefined
      const loadout = civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null } : military!.loadout
      const npc = new NPC(this.scene, spec.x, spec.z, Faction.TOWN, civilian ? 'roman' : ranger ? 'viking' : profile.faction, ranged ? AIType.RANGED : AIType.MELEE, NAMES[spec.role] ?? spec.id, civilian ? TOWN_RULES.garrisonTier : ranger ? 4 : military!.level, cavalry, loadout, preset, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : captain?.visualAssetId, ranger ? 'ranger' : captain?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, profile.faction)
      npc.setTownPeaceful(); npc.group.rotation.y = Math.PI
      let homeMount: Mount | undefined
      if (cavalry) { const mount = new Mount(this.scene, captain ? mountTypeFromId(captain.mountOverride) : MountType.HORSE, spec.x, spec.z); mount.reservedForTown = true; mount.group.rotation.y = spec.yaw ?? Math.PI; npc.mountVehicle(mount); this.mounts.push(mount); homeMount = mount }
      if (NAMES[spec.role] && spec.role !== 'civilian') { npc.group.rotation.y = spec.yaw ?? 0; this.serviceMarkers.set(spec.id, this.world.addServiceMarker(npc.group, ranger ? 1.9 : captain ? 2 : 2.2)) }
      const training = spec.role.includes('_'), target = training ? this.world.addTarget(spec.x, spec.z - (ranged ? 3 : 1.5), ranged) : undefined
      this.residents.push({ spec, npc, homeMount, target, cycle: -1, walkTime: 0 }); this.event.register(spec.id, npc)
    }
    progress('預熱動畫、材質與陰影…')
    this.camera.position.set(0, 24, 42); this.camera.lookAt(0, 0, 0)
    for (const distance of [100, 35, 0]) {
      for (let i = 0; i < this.residents.length; i++) {
        this.residents[i].npc.updateTownPeace(.2, distance, Boolean(this.residents[i].target), true)
        if (i % 8 === 0) await yieldFrame()
      }
      for (const mount of this.mounts) { mount.setCameraDistance(distance); mount.horseVisual?.update(.016, distance) }
      this.scene.updateMatrixWorld(true)
      await renderer.compileAsync(this.scene, this.camera)
      renderer.render(this.scene, this.camera); await yieldFrame()
    }
    for (const resident of this.residents) { resident.npc.setTownPeaceful(); resident.npc.updateTownPeace(.2, resident.npc.group.position.distanceTo(this.camera.position), false, false) }
    progress('村莊準備完成，生成玩家…')
    this.player = new Player(this.scene, profile.faction, resolveCareerHeroAsset(profile))
    this.player.group.position.set(0, getTerrainHeight(0, 9) + .9, 9); this.player.group.rotation.y = Math.PI
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.navigation.sync(this.world.obstacles)
    const missionCaptain = this.residents.find(resident => resident.spec.role === 'captain')!.npc
    this.mission = new BanditMissionController(this.scene, this.world, this.navigation, missionCaptain, this.residents, () => this.player, () => this.profile, p => this.commit(p))
    this.mission.onMarchStarted = () => this.playMissionVoice('follow')
    this.defense = new TownDefenseController(this.scene, this.residents, () => this.player, () => this.profile, p => this.commit(p), this.cat, this.navigation)
    this.careerMounts = new CareerMountController(
      this.scene,
      () => this.player,
      () => this.profile,
      p => this.commit(p),
      () => this.world.obstacles,
      () => [
        ...this.residents.filter(r => !r.npc.dead).map(r => r.npc.combatPosition),
        ...this.mounts.filter(mount => !mount.dead).map(mount => mount.group.position),
        ...this.mission.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
        ...this.defense.fieldNpcs.filter(npc => !npc.dead).map(npc => npc.combatPosition),
      ],
    )
    this.restoreActiveCareerMission()
    progress('預熱城外 Bandit…')
    const banditWarmupStarted = performance.now()
    for (const distance of [100, 35, 0]) {
      for (const bandit of this.mission.ambientBandits) bandit.updateTownPeace(.2, distance, false, false)
      this.scene.updateMatrixWorld(true)
      await renderer.compileAsync(this.scene, this.camera)
      await yieldFrame()
    }
    if (import.meta.env.DEV) console.info(`[CareerTownWarmup] ambient Bandit ${Math.round(performance.now() - banditWarmupStarted)}ms`)
    this.player.update(.2, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory)
    this.orbit.update(this.input)
    await renderer.compileAsync(this.scene, this.camera)
    renderer.render(this.scene, this.camera); await yieldFrame()
    this.input.clear()
    this.event.complete()
    if (profile.townEvent?.state === 'hostile') {
      for (const id of profile.townEvent.deadActorIds ?? []) {
        const actor = id === 'cat' ? this.cat : this.residents.find(r => r.spec.id === id)?.npc
        actor?.takeDamage(999999)
      }
      for (const id of profile.townEvent.destroyedBuildingIds ?? []) this.world.buildings.find(b => b.id === id)?.hp.destroy()
    }
    this.hud.id = 'town-hud'; this.hud.style.cssText = 'position:fixed;top:20px;left:20px;z-index:90;background:#201d19de;color:#efe1c3;padding:16px 22px;border:1px solid #aa9270;line-height:1.7;font:15px system-ui;max-width:520px;pointer-events:none'
    this.hint.id = 'town-hint'; this.hint.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:90;color:#fff;background:#211e19dd;padding:10px 20px;font:18px system-ui;pointer-events:none'
    this.pointerPrompt.id = 'town-pointer-prompt'; this.pointerPrompt.textContent = '點擊畫面進入遊戲'; this.pointerPrompt.style.cssText = 'position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);z-index:89;color:#fff4d0;background:#201d19e8;border:1px solid #aa9270;padding:14px 22px;font:600 18px system-ui;pointer-events:none'
    this.ambientLabel.className = 'town-ambient'; this.ambientLabel.hidden = true
    document.body.append(this.hud, this.hint, this.pointerPrompt, this.ambientLabel)
    document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · Tab 裝備／拔刀 · E 交談 · Q / Esc 關閉面板'
    const opts = { capture: true, signal: this.listeners.signal }
    window.addEventListener('keydown', e => this.key(e), opts)
    for (const type of ['mousedown', 'mouseup', 'wheel'] as const) window.addEventListener(type, e => { if (this.panel || this.equipment.visible) { e.stopImmediatePropagation(); this.input.clear() } }, { ...opts, passive: false })
    renderer.domElement.addEventListener('click', () => { if (!this.panel && !this.equipment.visible) { if (!location.search.includes('nolock')) this.input.requestPointerLock(renderer.domElement); sound.unlockAudio() } }, { signal: this.listeners.signal })
    document.addEventListener('pointerlockchange', () => this.updatePointerPrompt(), { signal: this.listeners.signal })
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }, { signal: this.listeners.signal })
    this.player.onFireArrow = e => this.fire(e.origin, e.direction, e.speed, e.damage, true, false, e.visualKind)
    if (profile.townEvent?.state === 'hostile') { this.inventory.restoreForHostile(); this.activateHostility(false); this.notice = '未結束的小鎮事件已恢復：全鎮仍在追擊。' }
    this.hp.setFill(1)
    this.updatePointerPrompt()
    this.orbit.update(this.input)
    this.last = performance.now()
    this.raf = requestAnimationFrame(t => this.frame(t))
    if (this.profile.activeMission?.result && this.profile.activeMission.phase !== 'RETURNING') this.openMissionResult(this.profile.activeMission.result, true)
  }
  private commit(profile: CareerProfile): boolean {
    if (!this.store.save(profile)) { this.notice = '保存失敗，資料尚未變更。請確認瀏覽器儲存空間後重試。'; return false }
    this.profile = profile; return true
  }
  private key(e: KeyboardEvent): void {
    if (this.panel || this.equipment.visible) {
      e.stopImmediatePropagation()
      if (['KeyQ', 'Escape', 'Tab'].includes(e.code)) { e.preventDefault(); if (!this.result && !this.missionResultOpen) this.closePanel() }
      return
    }
    if (e.repeat) return
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.(); this.equipment.open(this.skills, this.inventory, () => this.input.clear(), this.careerMounts); return }
    if (e.code === 'KeyE') { e.preventDefault(); e.stopImmediatePropagation(); if (this.target) this.talk(this.target) }
  }
  private closePanel(): void {
    this.panel?.remove(); this.panel = null; this.equipment.close(); this.input.clear(); this.player.clearTownAction(); if (!location.search.includes('nolock')) this.input.requestPointerLock(this.renderer.domElement)
  }
  private openPanel(title: string, text: string): HTMLDivElement {
    this.panel?.remove(); this.equipment.close(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.()
    const panel = document.createElement('div'); panel.id = 'town-dialog'; panel.className = 'town-panel'
    const eyebrow = document.createElement('small'); eyebrow.className = 'town-eyebrow'; eyebrow.textContent = this.profile.faction === 'roman' ? 'VINUM · LEGION RECORD' : 'ØKSE · HALL OF WARRIORS'; panel.append(eyebrow)
    const heading = document.createElement('h2'); heading.textContent = title; panel.append(heading)
    const body = document.createElement('p'); body.textContent = text; body.style.whiteSpace = 'pre-line'; panel.append(body)
    if (!this.result && !this.missionResultOpen) this.button(panel, '關閉 · Q / Esc', () => this.closePanel())
    document.body.append(panel); this.panel = panel; return panel
  }
  private button(parent: HTMLElement, label: string, action: () => void): void { const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; parent.append(b) }
  private talk(id: string, response?: string): void {
    if (this.event.hostile || !this.serviceAvailable(id)) return
    const role = id as DialogueRole, key = this.profile.faction + ':' + id
    const firstMeet = !this.profile.townDialogueSeen?.includes(key)
    const outpostKey = this.profile.faction + ':soldier-outpost'
    const firstOutpost = id === 'deployment' && this.profile.rank === 'soldier' && !this.profile.townDialogueSeen?.includes(outpostKey)
    if (firstMeet || firstOutpost) {
      const next = cloneCareerProfile(this.profile)
      next.townDialogueSeen = [...(next.townDialogueSeen ?? []), ...(firstMeet ? [key] : []), ...(firstOutpost ? [outpostKey] : [])]
      if (!this.commit(next)) { this.openPanel('無法保存交談紀錄', this.notice); return }
    }
    const p = this.profile, context: DialogueContext = { townFaction: p.faction, npcRole: role, playerRank: p.rank, firstMeet }
    const greeting = response ?? selectTownDialogue(context)
    if (id === 'captain') {
      const next = CAREER_RANKS[CAREER_RANKS.indexOf(p.rank) + 1], merit = enlistmentMerit(p), eligible = Boolean(next && merit >= CAREER_RANK_THRESHOLDS[next])
      const text = formatTownDialogue(selectTownDialogue({ ...context, nextRank: next, promotionEligible: eligible }, 'promotion'), { nextRank: next ?? '', required: next ? CAREER_RANK_THRESHOLDS[next] : 0 })
      const panel = this.openPanel('騎兵隊長 · 任命', greeting + '\n\n' + (response ? '' : text))
      const detail = document.createElement('p'); detail.className = 'town-summary'; detail.textContent = promotionDetails(p); panel.append(detail)
      if (eligible) this.button(panel, next === 'captain' ? '接受隊長任命' : '接受任命', () => {
        const fresh = promoteCareer(this.profile)
        if (fresh && this.commit(fresh)) {
          this.applyCareerPlayerIdentity()
          this.talk('captain', selectTownDialogue({ ...context, playerRank: fresh.rank }, 'promotionSuccess'))
        }
      })
    } else if (id === 'deployment') {
      this.openDeploymentPanel(greeting, context, firstOutpost)
    } else {
      const mount = id !== 'merchant', panel = this.openPanel(NAMES[id], greeting)
      const summary = document.createElement('p'); summary.className = 'town-summary'; summary.textContent = '可用軍功 ' + p.availableMerit + ' · ' + p.rank + (mount ? ' · 戰馬依 T1 → T2 → T3 購買；購買後按 Tab 騎乘／收起' : ' · 目前僅展示價目'); panel.append(summary)
      const showProducts = () => {
        panel.querySelector('.town-products')?.remove()
        const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
        for (const item of TOWN_PRODUCTS.filter(i => (i.category === 'mount') === mount)) {
          const row = document.createElement('article'); row.className = 'town-product'
          const title = document.createElement('strong'); title.textContent = item.name
          const meta = document.createElement('small'); meta.textContent = 'T' + item.tier + ' · ' + item.price + ' 軍功 · ' + productStatus(this.profile, item)
          row.append(title, meta)
          this.button(row, item.id.startsWith('horse-t') && !isTownProductOwned(this.profile, item) ? '購買' : '查看', () => {
            const current = this.profile, owned = isTownProductOwned(current, item), tierUnlocked = getCareerPurchaseTier(current.rank) >= item.tier
            let message = selectTownDialogue({ ...context, isOwned: owned, tierUnlocked, hasEnoughMerit: current.availableMerit >= item.price }, 'product')
            if (item.id.startsWith('horse-t') && !owned) {
              const status = productStatus(current, item), fresh = purchaseTownHorse(current, item.id)
              if (fresh) {
                if (!this.commit(fresh)) { this.talk(id, this.notice); return }
                message = selectTownDialogue(context, 'horsePurchaseSuccess') + '\n按 Tab → 坐騎 → 騎乘。'
              } else if (status === '先購買前一階戰馬') message += '\n請先購買前一階戰馬。'
            }
            this.talk(id, message)
          })
          list.append(row)
        }
      }
      if (id === 'cat' && !response) this.button(panel, '查看坐騎', showProducts)
      else showProducts()
    }
  }
  private openDeploymentPanel(greeting: string, context: DialogueContext, firstOutpost: boolean): void {
    const active = this.profile.activeMission
    if (active?.result) { this.openMissionResult(active.result, true); return }
    const panel = this.openPanel('士官長', greeting)
    const arrows = document.createElement('p'); arrows.className = 'town-summary'; arrows.textContent = `箭袋 ${this.player.arrowCount}/${PLAYER_ARROW_CAPACITY}`; panel.append(arrows)
    if (this.player.arrowCount < PLAYER_ARROW_CAPACITY) this.button(panel, '申請補滿箭矢', () => {
      this.player.setArrowCount(PLAYER_ARROW_CAPACITY)
      this.quiver.setArrowCount(this.player.arrowCount)
      const line = this.profile.faction === 'roman'
        ? '把箭袋張開。軍團不讓士兵空著手上前線——三十發，一發不少。讓敵人學會數數。'
        : '把箭袋拿來。三十支都給你塞滿——讓下一群蠢蛋替你數到零。'
      this.openDeploymentPanel(line, context, firstOutpost)
    })
    if (active) {
      const template = getRecruitMissionTemplate(active.templateId)
      const badge = document.createElement('p'); badge.className = 'town-summary'
      badge.textContent = `任務進行中：${template?.name ?? active.templateId}\n狀態 ${active.phase}${active.kind === 'town-defense' ? ' · 守住所屬城鎮' : active.kind === 'patrol' ? ' · 沿指定路線巡邏' : ` · 目標 Camp ${active.targetCampId + 1}`}`
      panel.append(badge)
      return
    }
    if (firstOutpost) {
      const outpost = document.createElement('p'); outpost.className = 'town-summary'
      outpost.textContent = selectTownDialogue(context, 'soldierFirstOutpost')
      panel.append(outpost)
    }
    const missions = availableRecruitMissions(this.profile)
    const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
    for (const template of missions) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = template.name
      const details = document.createElement('small')
      details.textContent = template.kind === 'town-defense'
        ? `${template.briefing}\n所屬 Career Town\n玩家 1 · AI 守軍 63（駐軍 ${template.friendlySoldiers}、隊長、Maki、士官長）\n敵方 T2 騎兵 ${template.enemyCount} · 平民傷亡上限 ${template.maxCivilianDeaths} · 風險 ${template.risk}`
        : template.kind === 'patrol'
          ? `${template.briefing}\n路線 ${template.routeId === 'south-road' ? '南路' : '森林線'}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlyCombatants - 2} · 友軍總數 ${template.friendlyCombatants}\n任務內容 沿線巡查 · 風險 ${template.risk}`
          : `${template.briefing}\n城外 Bandit Camp ${template.preferredCampIndex + 1}\n玩家 1 · Mission Leader 1 · Friendly soldiers ${template.friendlySoldiers} · 友軍總數 ${template.friendlyCombatants}\nBandits ${template.banditCount} · 風險 ${template.risk}`
      details.style.whiteSpace = 'pre-line'
      row.append(title, details)
      this.button(row, '接受任務', () => this.acceptMission(template.id))
      list.append(row)
    }
    if (enlistmentMerit(this.profile) < 60) {
      const gate = document.createElement('p'); gate.className = 'town-summary'
      gate.textContent = '累積本次入伍軍功後，會逐步開放林線巡邏、敵眾我寡與大型守城任務。'
      panel.append(gate)
    }
  }
  private restoreActiveCareerMission(): void {
    const { profile } = this
    if (profile.activeMission) {
      if (profile.activeMission.kind === 'town-defense') {
        if (!profile.activeMission.result || profile.activeMission.phase === 'RETURNING') this.defense.startActiveMission()
      } else {
        this.mission.startActiveMission()
      }
      if (!profile.activeMission.result || profile.activeMission.phase === 'RETURNING') this.inventory.prepareForCombat()
      this.careerMounts.restoreActiveMount()
    }
  }
  private playMissionVoice(cue: CareerMissionVoiceCue): void {
    sound ??= new SoundManager()
    sound.playCareerMissionVoice(this.profile.faction, cue)
  }
  private async playTownDefenseAlert(): Promise<void> {
    const missionId = this.profile.activeMission?.id
    await (sound ??= new SoundManager()).playTownAlarm()
    setTimeout(() => {
      if (!this.disposed && this.profile.activeMission?.id === missionId) this.playMissionVoice('townDefense')
    }, 450)
  }
  private acceptMission(templateId: string): void {
    const fresh = this.store.load()
    const template = availableRecruitMissions(fresh ?? this.profile).find(candidate => candidate.id === templateId)
    if (!fresh || !template) { this.openPanel('無法接受任務', '生涯存檔已變更，請重新與士官長交談。'); return }
    if (fresh.activeMission || this.event.hostile || fresh.townEvent?.state === 'hostile') { this.openPanel('無法接受任務', '目前已有任務或小鎮處於敵對狀態。'); return }
    if (this.player.dead || this.mission.fieldNpcs.some(npc => npc.inCombat || npc.encounterIsAlerted)) { this.openPanel('無法接受任務', '你目前仍在另一場交戰中。'); return }
    if (template.kind === 'town-defense') {
      const defenders = this.residents.filter(resident => resident.spec.role.includes('_')).map(resident => resident.spec.id)
      const captain = this.residents.find(resident => resident.spec.role === 'captain')?.spec.id
      const ranger = this.residents.find(resident => resident.spec.role === 'ranger')?.spec.id
      const deployment = this.residents.find(resident => resident.spec.role === 'deployment')?.spec.id
      const civilians = this.residents.filter(resident => resident.spec.role === 'civilian').map(resident => resident.spec.id)
      if (defenders.length !== 60 || !captain || !ranger || !deployment || civilians.length !== 20) { this.openPanel('任務建立失敗', '城鎮駐軍或平民名單不完整。'); return }
      const mission = createTownDefenseMission([...defenders, captain, ranger, deployment], civilians)
      const next = cloneCareerProfile(fresh); next.activeMission = mission
      if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
      if (!this.defense.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，但城防部署無法建立。重新載入後可恢復同一 missionId。'); return }
      this.inventory.prepareForCombat()
      this.notice = '警報！敌軍正在接近。前往主防線集合。'
      void this.playTownDefenseAlert()
      this.closePanel()
      return
    }
    const preferredCamp = template.kind === 'patrol' ? patrolPreferredCamp(template.routeId) : template.preferredCampIndex
    const campId = this.mission.chooseCamp(preferredCamp)
    if (campId === null) { this.openPanel('地區暫時無法接取', '附近營地仍在交戰，請先脫離戰鬥或稍後選擇其他任務。'); return }
    const mission = this.mission.createMission(template, campId)
    const next = cloneCareerProfile(fresh); next.activeMission = mission
    if (!this.commit(next)) { this.openPanel('任務保存失敗', '任務尚未開始。請確認瀏覽器儲存空間後重試。'); return }
    if (!this.mission.startActiveMission()) { this.openPanel('任務建立失敗', '任務已保存，但隊伍無法建立。重新載入後可用同一個 missionId 恢復。'); return }
    this.inventory.prepareForCombat()
    this.notice = `已接受 ${template.name}。前往兵營外集合。`
    this.playMissionVoice('missionAccepted')
    this.closePanel()
  }
  private applyCareerPlayerIdentity(): void {
    const hero = resolveCareerHeroAsset(this.profile)
    if (this.player.heroAssetId === hero) return
    const old = this.player
    const position = old.group.position.clone()
    const facing = old.facingYaw
    const oldHp = old.hp
    const oldMaxHp = old.maxHp
    const stamina = old.staminaValue
    const arrows = old.arrowCount
    const mount = old.currentMount
    const mountHeading = mount?.group.rotation.y
    const cameraYaw = this.orbit.cameraYaw
    const cameraPitch = this.orbit.cameraPitch
    if (mount) old.dismountFromMount()
    old.dispose()
    this.player = new Player(this.scene, this.profile.faction, hero)
    this.player.group.position.copy(position)
    this.player.faceDirection(Math.sin(facing), Math.cos(facing))
    this.player.setHp(preserveHpRatio(oldHp, oldMaxHp, this.player.maxHp))
    this.player.setStamina(stamina)
    this.player.setArrowCount(arrows)
    this.player.onFireArrow = event => this.fire(event.origin, event.direction, event.speed, event.damage, true, false, event.visualKind)
    if (mount && !mount.dead) this.player.mountVehicle(mount, mountHeading)
    this.orbit = new ThirdPersonCamera(this.camera, this.player); this.orbit.setYaw(cameraYaw); this.orbit.setPitch(cameraPitch)
    this.player.update(0, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory)
    this.hp.setFill(this.player.hpRatio)
  }
  private finishMission(outcome: CareerMissionOutcome): void {
    const active = this.profile.activeMission
    if (!active || active.result) return
    const defense = active.kind === 'town-defense'
    const stats = defense ? this.defense.snapshot().player : this.mission.snapshot().player
    const claim = claimCareerMission(this.profile, active.id, outcome, stats)
    if (defense && claim.profile.activeMission?.result) {
      claim.profile.activeMission.result.defense = { civilianSurvived: this.defense.civilianSurvived, civilianDeaths: this.defense.civilianDeaths }
    }
    if (!this.commit(claim.profile)) {
      this.missionResultOpen = true
      const panel = this.openPanel('任務結算尚未保存', '保存失敗；軍功尚未入帳，任務結果已保留在目前場景。')
      this.button(panel, '重試保存結算', () => this.finishMission(outcome))
      return
    }
    this.openMissionResult(this.profile.activeMission!.result!, false)
  }
  private openMissionResult(result: CareerMissionResult, _reloaded: boolean): void {
    this.missionResultOpen = true
    const complete = result.outcome === 'victory'
    const merit = result.merit
    const defenseText = result.defense ? `\n\nCivilians\nSurvived ${result.defense.civilianSurvived}\nDeaths ${result.defense.civilianDeaths}` : ''
    const zeroMeritReason = merit.total !== 0 ? '' : result.stats.damageDealt > 0
      ? `\n\n有效傷害未達 ${RECRUIT_MISSION_MERIT_RULES.damagePerPoint} 點軍功門檻；本次軍功為 0。`
      : '\n\n本次未對任務目標造成有效貢獻。個人軍功：0'
    const panel = this.openPanel(result.defense ? `Town Defense · ${complete ? 'SUCCESS' : 'FAILURE'}` : complete ? 'MISSION COMPLETE' : 'MISSION FAILED', `玩家統計 PLAYER\nDamage ${Math.round(result.stats.damageDealt)}\nKills ${result.stats.kills}\nSurvived ${result.stats.survived ? 'Yes' : 'No'}${defenseText}\n\nMilitary Merit\nDamage merit ${merit.damage}\nKill merit ${merit.kills}\nMission contribution merit ${merit.contribution}\nTotal ${merit.total}${zeroMeritReason}`)
    this.button(panel, '返回小鎮', () => result.defense ? this.settleTownDefenseInPlace() : this.fastReturnFromMission())
    if (!result.defense && complete && result.stats.survived) this.button(panel, this.mission.friendlies.some(npc => !npc.dead) ? '跟隊伍走回去' : '自行走回小鎮', () => {
      if (this.mission.phase === 'RETURNING') return
      if (!this.mission.startReturning()) { this.notice = '返回狀態保存失敗，請重試。'; return }
      if (this.mission.friendlies.some(npc => !npc.dead)) this.playMissionVoice('return')
      this.missionResultOpen = false
      this.closePanel()
    })
  }
  private fastReturnFromMission(): void {
    const active = this.profile.activeMission
    if (!active) return
    if (active.kind === 'town-defense') { this.settleTownDefenseInPlace(); return }
    const next = clearCareerMission(this.profile, active.id)
    if (!this.commit(next)) {
      const panel = this.openPanel('返回狀態尚未保存', '任務結算仍安全保留。請重試保存後返回小鎮。')
      this.button(panel, '重試返回小鎮', () => this.fastReturnFromMission())
      return
    }
    this.mission.cleanupMission(active.targetCampId)
    this.inventory.sheathAll()
    this.missionResultOpen = false
    this.dispose()
    this.onRestart(next)
  }
  private restoreResidentForTown(resident: Resident): void {
    resident.npc.dismountFromMount()
    resident.npc.restoreForTown()
    resident.npc.group.rotation.y = resident.spec.yaw ?? Math.PI
    resident.cycle = -1
    resident.walkTime = 0
    this.externalThreatActors.delete(resident.npc)
    if (resident.homeMount) {
      resident.homeMount.restoreForTown(resident.spec.x, resident.spec.z, resident.spec.yaw ?? Math.PI)
      resident.npc.mountVehicle(resident.homeMount)
    }
  }
  private clearMissionCombatShots(): void {
    for (const shot of this.shots ?? []) shot.arrow.destroy()
    this.shots = []
  }
  private restPlayerInTown(): void {
    this.careerMounts.restInTown()
    this.inventory.sheathAll()
    this.player.restoreForTown()
    this.hp.setFill(1)
    this.stamina.setFill(1)
    this.quiver.setArrowCount(this.player.arrowCount)
  }
  private settleTownDefenseInPlace(): void {
    const active = this.profile.activeMission
    if (!active || active.kind !== 'town-defense' || !active.result) return
    const next = clearCareerMission(this.profile, active.id)
    if (!this.commit(next)) {
      const panel = this.openPanel('返回狀態尚未保存', '守城結算仍安全保留。請重試，軍功不會重複發放。')
      this.button(panel, '重試原地結算', () => this.settleTownDefenseInPlace())
      return
    }

    this.defense.cleanupMission()
    this.clearMissionCombatShots()
    for (const resident of this.residents) {
      if (resident.spec.role.includes('_') || resident.spec.role === 'captain' || resident.spec.role === 'ranger' || resident.spec.role === 'deployment' || resident.spec.role === 'civilian') this.restoreResidentForTown(resident)
    }
    const catSpot = townSitePoint('stable', -3, 8)
    this.cat.restoreForTown(catSpot.x, catSpot.z, catSpot.yaw)
    this.cat.catVisual?.setEquipmentVisible(false)
    this.world.restoreTownDamage()
    this.navigation.sync(this.world.obstacles)
    this.restPlayerInTown()
    this.missionResultOpen = false
    this.target = null
    this.hasPreviousTip = false
    this.notice = '守城結束。駐軍與居民已歸位，城鎮服務恢復。'
    if (this.panel) this.closePanel()
  }
  private settleReturnedMissionInPlace(): void {
    const active = this.profile.activeMission
    if (!active || active.kind === 'town-defense' || active.phase !== 'RETURNING') return
    const missionResidents = new Set(this.mission.friendlies)
    const next = clearCareerMission(this.profile, active.id)
    if (!this.commit(next)) {
      const panel = this.openPanel('返回狀態尚未保存', '隊伍已返抵小鎮，但任務結算尚未寫入。請重試，軍功不會重複發放。')
      this.button(panel, '重試原地結算', () => this.settleReturnedMissionInPlace())
      return
    }

    this.mission.cleanupMission(active.targetCampId)
    this.clearMissionCombatShots()
    for (const resident of this.residents) {
      if (!missionResidents.has(resident.npc)) continue
      this.restoreResidentForTown(resident)
    }

    this.restPlayerInTown()
    this.missionResultOpen = false
    this.target = null
    this.hasPreviousTip = false
    this.notice = '隊伍已整隊返營。駐軍歸位，馬廄與城鎮服務已恢復。'
    if (this.panel) this.closePanel()
  }
  private serviceAvailable(id: string): boolean {
    if (this.defense?.servicesLocked) return false
    if (id === 'captain' && this.mission?.missionLeader) return false
    if (this.event.actors.get(id)?.dead) return false
    const building = id === 'merchant' ? 'weapons' : id === 'ranger' || id === 'cat' ? 'stable' : null
    return !building || !this.world.buildings.find(b => b.id === building)?.hp.destroyed
  }
  /** Persist before applying the first effective hit; failure leaves the target unchanged. */
  private prepareDamage(): boolean {
    if (this.event.hostile) return true
    const active = this.profile.activeMission
    if (active?.kind === 'town-defense') return false
    const p = active ? clearCareerMission(this.profile, active.id) : cloneCareerProfile(this.profile)
    p.townEvent = { id: crypto.randomUUID(), state: 'hostile' }
    if (!this.commit(p)) return false
    if (active) {
      this.mission.cleanupMission(active.targetCampId)
      this.clearMissionCombatShots()
      this.missionResultOpen = false
    }
    return true
  }
  private activateHostility(shout = true): void {
    if (this.event.hostile) return
    this.event.hostile = true
    // A real hit must not cancel the current swing or clear held movement / Shift keys.
    if (this.panel || this.equipment.visible) this.closePanel()
    this.notice = '全鎮反擊！所有服務停止。'
    for (const r of this.residents) r.npc.beginTownHostility()
    const speaker = this.residents.find(r => r.spec.role === 'captain' && !r.npc.dead) ?? this.residents.find(r => !r.npc.dead && !isCivilian(r.spec.role))
    this.chargeSpeakerId = speaker?.spec.id ?? null
    if (shout && speaker) sound.playCommanderCommand(this.profile.faction, 'charge')
  }
  private isProtectedTownAlly(target: NPC | Mount): boolean {
    const active = this.profile?.activeMission
    if (active?.kind === 'town-defense') {
      if (target instanceof NPC) return target.faction === Faction.TOWN
      return target === this.cat || (this.stableHorses ?? []).includes(target)
        || (this.residents ?? []).some(resident => resident.homeMount === target)
    }
    const ally = target instanceof NPC
      ? target
      : target.riderNpc ?? (this.residents ?? []).find(resident => resident.homeMount === target)?.npc
    return Boolean(ally && (this.mission?.friendlies?.includes(ally) || this.externalThreatActors?.has(ally)
      || this.isMilitaryExternalThreatDefender(ally)))
  }
  private isMilitaryExternalThreatDefender(ally: NPC): boolean {
    const resident = this.residents?.find(candidate => candidate.npc === ally)
    if (!resident?.spec || ally.dead || !(resident.spec.role.includes('_') || resident.spec.role === 'captain' || resident.spec.role === 'deployment')) return false
    return [...(this.mission?.ambientBandits ?? []), ...(this.mission?.missionBandits ?? [])]
      .some(bandit => !bandit.dead && bandit.combatPosition.distanceToSquared(ally.combatPosition) <= 20 * 20)
  }
  private hitResident(npc: NPC | Mount, amount: number): void {
    if (this.isProtectedTownAlly(npc) || npc.dead || amount <= 0 || !this.prepareDamage()) return
    let applied = 0
    const position = npc instanceof NPC ? npc.combatPosition.clone() : npc.group.position.clone()
    if (npc instanceof NPC) applied = damageNpc(npc, amount).appliedDamage
    else { const before = npc.currentHp; npc.takeDamage(amount); applied = before - npc.currentHp; if (npc.dead && this.ranger.mount === npc) this.ranger.dismountFromMount() }
    if (applied > 0) {
      this.damageNumbers.spawn(applied, position)
      sound?.playSwordHit(0, true)
    }
    this.activateHostility(); this.persistCasualties()
  }
  private get ranger(): NPC { return this.residents.find(r => r.spec.role === 'ranger')!.npc }
  private damageBuilding(index: number, amount: number, hitPosition?: THREE.Vector3): void {
    const b = this.world.buildings[index]; if (!b || b.hp.destroyed || !Number.isFinite(amount) || amount <= 0) return
    const townOwned = b.ownerFaction !== Faction.BANDIT
    if (townOwned && this.profile?.activeMission?.kind === 'town-defense') return
    if (townOwned && !this.prepareDamage()) return
    const position = hitPosition ?? b.hp.root.getWorldPosition(new THREE.Vector3())
    const { appliedDamage } = b.hp.takeDamage(amount)
    if (appliedDamage <= 0) return
    this.damageNumbers.spawn(appliedDamage, position)
    this.world.refreshDamage(); this.navigation.sync(this.world.obstacles)
    if (townOwned) this.activateHostility()
    else if (b.campId !== undefined) this.mission.provokeCamp(b.campId)
    this.persistCasualties()
  }
  /** Write only deaths/destructions, never a per-hit log or a health snapshot. */
  private persistCasualties(): void {
    const current = this.profile.townEvent
    if (!current || current.state !== 'hostile') return
    const deadActorIds = [...this.event.actors].filter(([, actor]) => actor.dead).map(([id]) => id)
    const destroyedBuildingIds = this.world.buildings.filter(b => b.ownerFaction !== Faction.BANDIT && b.hp.destroyed).map(b => b.id)
    if (deadActorIds.length === (current.deadActorIds?.length ?? 0) && destroyedBuildingIds.length === (current.destroyedBuildingIds?.length ?? 0)) return
    const next = cloneCareerProfile(this.profile)
    next.townEvent = { ...current, deadActorIds, destroyedBuildingIds }
    if (!this.commit(next)) {
      const panel = this.openPanel('事件保存失敗', '本次死亡／破壞尚未保存。重試成功後繼續；重新載入可能丟失這次變化，但追擊不會解除。')
      this.button(panel, '重試保存事件', () => { if (this.commit(next)) this.closePanel() })
    }
  }
  private hitFieldNpc(target: NPC, amount: number, method: CombatDamageMethod, source?: NPC): void {
    if (target.dead || amount <= 0) return
    const result = damageNpc(target, amount, {
      source: source ? createNpcCombatActorRef(source) : createPlayerCombatActorRef(this.player),
      method,
      weaponId: source?.meleeWeaponId ?? (method === 'projectile' ? this.inventory.equippedRanged?.id : this.inventory.equippedMelee?.id),
      emit: this.defense.active ? this.defense.events.emit : this.mission.events.emit,
    })
    if (result.appliedDamage <= 0) return
    if (this.defense.active && source?.faction === Faction.ENEMY) this.defense.noteEffectiveFriendlyDamage(target)
    if (method === 'projectile') sound?.playProjectileImpact(target.currentLod, !source)
    else if (method === 'mount-impact') sound?.playHorseImpact(target.currentLod, !source)
    else if ((source?.meleeCombatKind ?? this.inventory.equippedMelee?.combatKind) === 'lance') sound?.playLanceImpact(target.currentLod, !source)
    else sound?.playSwordHit(target.currentLod, !source)
    if (target.faction === Faction.BANDIT) {
      if (source) this.mission.alertGroupFor(target)
      else this.mission.provokeGroupFor(target)
    }
    if (!source && !target.dead && (target.faction === Faction.BANDIT || target.faction === Faction.ENEMY)) target.retaliateAgainstPlayer()
    if (!source) this.damageNumbers.spawn(result.appliedDamage, target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)))
  }
  private damagePlayerFromNpc(source: NPC, amount: number, method: CombatDamageMethod): void {
    const result = damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null, {
      source: createNpcCombatActorRef(source), method, weaponId: source.meleeWeaponId ?? source.rangedWeaponId, emit: this.defense.active ? this.defense.events.emit : this.mission.events.emit,
    })
    if (result.appliedDamage <= 0) return
    if (method === 'projectile') sound?.playProjectileImpact(0, true)
    else if (method === 'mount-impact') sound?.playHorseImpact(0, true)
    else if (source.meleeCombatKind === 'lance') sound?.playLanceImpact(0, true)
    else sound?.playSwordHit(0, true)
  }
  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, player: boolean, training: boolean, kind: 'arrow' | 'pilum', source?: NPC): void {
    if (this.shots.length >= 100 || training && this.shots.filter(s => s.training).length >= 60) return
    const shooterFaction = player ? Faction.PLAYER : source?.faction ?? Faction.ENEMY
    this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, shooterFaction, player, kind), training, player, source, age: 0 })
    if (!training && kind === 'arrow') sound?.playBowRelease(player ? 0 : source?.currentLod ?? 0, player, player ? 0 : origin.distanceTo(this.player.combatPosition))
  }
  private updateShots(dt: number): void {
    for (const s of this.shots) {
      if (!s.arrow.isAlive) continue
      const from = s.arrow.mesh.position.clone(); s.age += dt
      s.arrow.update(dt, this.player, [], [], () => {}, damage => damagePlayer(this.player, damage, this.hp, null), undefined, true)
      const to = s.arrow.mesh.position, delta = to.clone().sub(from), length = delta.length(), ray = new THREE.Ray(from, delta.normalize())
      if (s.training) { if (s.age > .3) s.arrow.destroy(); continue }
      let nearest = length + .01, hit: (() => void) | null = null
      for (let i = 0; i < this.world.buildings.length; i++) {
        const b = this.world.buildings[i]
        if (b.hp.destroyed) continue
        for (const obstacle of b.obstacles) {
          const p = ray.intersectBox(obstacle.box, new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
          if (distance < nearest) { nearest = distance; hit = () => { if (s.player) this.damageBuilding(i, s.arrow.damage, p!) } }
        }
      }
      for (const target of this.world.targets) {
        const p = ray.intersectSphere(new THREE.Sphere(target, .6), new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => {} }
      }
      const targets: Array<Player | NPC | Mount> = s.player
        ? [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.releasedEnemies,
          ...[...this.residents.map(r => r.npc), ...(this.cat ? [this.cat] : []), ...(this.stableHorses ?? [])].filter(target => !this.isProtectedTownAlly(target))]
        : s.source?.faction === Faction.BANDIT
          ? [this.player, ...this.mission.combatPeersFor(s.source).filter(npc => npc.faction !== s.source!.faction)]
          : this.defense.active && s.source
            ? s.source.faction === Faction.ENEMY
              ? [this.player, ...this.defense.peersFor(s.source), ...(this.cat && !this.cat.dead ? [this.cat] : [])]
              : this.defense.releasedEnemies
          : s.source?.faction === Faction.TOWN
            ? s.source.hostileToPlayer
              ? [this.player]
              : this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
          : s.source?.faction === Faction.PLAYER
            ? this.mission.combatPeersFor(s.source).filter(npc => npc.faction === Faction.BANDIT)
            : [this.player]
      for (const target of targets) {
        if (target.dead) continue
        const center = target instanceof Player ? target.position.clone() : target instanceof NPC ? target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)) : target.group.position.clone().add(new THREE.Vector3(0, 1, 0))
        const p = ray.intersectSphere(new THREE.Sphere(center, .8), new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => {
          if (target instanceof Player && s.source) this.damagePlayerFromNpc(s.source, s.arrow.damage, 'projectile')
          else if (target instanceof NPC && (target.faction === Faction.BANDIT || target.faction === Faction.ENEMY || Boolean(s.source && target.faction !== s.source.faction))) this.hitFieldNpc(target, s.arrow.damage, 'projectile', s.source)
          else if (target === this.cat && this.defense.active && s.source?.faction === Faction.ENEMY) {
            this.cat.takeDamage(s.arrow.damage)
            if (this.cat.dead && this.ranger.mount === this.cat) this.ranger.dismountFromMount()
          }
          else if (target instanceof NPC || target instanceof Mount) this.hitResident(target, s.arrow.damage)
        } }
      }
      if (hit) { hit(); s.arrow.destroy() }
      if (s.age > 5 || to.y < getTerrainHeight(to.x, to.z)) s.arrow.destroy()
    }
    this.shots = this.shots.filter(s => s.arrow.isAlive)
  }
  private melee(): void {
    if (!this.inventory.meleeEnabled) { this.hasPreviousTip = false; return }
    const currentTip = this.player.getSwordTipPosition()
    const previousTip = this.hasPreviousTip ? this.previousTip.clone() : currentTip
    this.previousTip.copy(currentTip); this.hasPreviousTip = true
    if (!this.player.isHitFrame(this.inventory.equippedMelee)) return
    const weapon = this.inventory.equippedMelee, from = this.player.getWeaponGripPosition(new THREE.Vector3()), tip = this.player.getSwordTipPosition()
    const damageResult = calculatePlayerMeleeDamage({
      baseDamage: weapon.damageMax,
      combatKind: weapon.combatKind,
      isLance: weapon.isLance === true,
      isMounted: this.player.isMounted,
      mountSpeed: this.player.currentMount?.movementSpeed ?? 0,
      oneHandedMultiplier: this.skills?.getOneHandedMultiplier?.() ?? 1,
      faction: this.player.characterFaction,
      hasShield: this.inventory.shieldEnabled,
      heroAssetId: this.player.heroAssetId ?? undefined,
    })
    // Buildings block melee before residents behind them.
    let buildingHit = -1, nearestBuilding = Infinity, buildingHitPosition: THREE.Vector3 | undefined
    for (let i = 0; i < this.world.buildings.length; i++) {
      const b = this.world.buildings[i]
      if (b.hp.destroyed) continue
      for (const { box } of b.obstacles) {
        if (!townMeleeBuildingContact(this.player.position, this.player.facingYaw, from, tip, previousTip, box, weapon.range ?? 1.8, weapon.combatKind === 'lance')) continue
        const distance = box.distanceToPoint(this.player.position)
        if (distance < nearestBuilding) { nearestBuilding = distance; buildingHit = i; buildingHitPosition = box.clampPoint(this.player.position, new THREE.Vector3()) }
      }
    }
    if (buildingHit >= 0) { this.player.markHitProcessed(); this.damageBuilding(buildingHit, damageResult.damage, buildingHitPosition); return }
    if (this.world.targets.some(p => p.distanceTo(tip) < .8)) { this.player.markHitProcessed(); return }
    for (const target of [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.defense.releasedEnemies]) {
      if (target.dead) continue
      const center = target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0))
      const line = new THREE.Ray(this.player.position, center.clone().sub(this.player.position).normalize())
      const blocked = this.world.obstacles.some(o => { const hit = line.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(this.player.position) < center.distanceTo(this.player.position) - .4 })
      if (!blocked && townMeleeContact(this.player.position, this.player.facingYaw, from, tip, previousTip, center, weapon.range ?? 1.8, weapon.combatKind === 'lance')) {
        this.player.markHitProcessed()
        this.hitFieldNpc(target, Math.round(damageResult.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, target.isMounted)), 'melee')
        if (damageResult.isCharge && this.player.currentMount) this.player.currentMount.skipImpactThisFrame = true
        return
      }
    }
    for (const target of [...this.residents.map(r => r.npc), ...(this.cat ? [this.cat] : []), ...(this.stableHorses ?? [])].filter(target => !this.isProtectedTownAlly(target))) {
      if (target.dead) continue
      const center = target instanceof NPC ? target.combatPosition.clone() : target.group.position.clone(); center.y += 1
      const line = new THREE.Ray(this.player.position, center.clone().sub(this.player.position).normalize())
      const blocked = this.world.obstacles.some(o => { const hit = line.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(this.player.position) < center.distanceTo(this.player.position) - .4 })
      if (!blocked && townMeleeContact(this.player.position, this.player.facingYaw, from, tip, previousTip, center, weapon.range ?? 1.8, weapon.combatKind === 'lance')) { this.player.markHitProcessed(); this.hitResident(target, Math.round(damageResult.damage * getAntiCavalryMultiplier(weapon.combatKind, this.player.isMounted, target instanceof Mount || target.isMounted))); return }
    }
  }
  private resolveBodies(): void {
    const playerBody = { position: this.player.group.position, radius: .42, height: 1.8, bottomOffset: .9 }
    for (const r of this.residents) {
      if (this.mission.friendlies.includes(r.npc)) continue
      if (r.npc.dead) continue
      const position = r.npc.mount?.group.position ?? r.npc.group.position
      if (Math.hypot(position.x - playerBody.position.x, position.z - playerBody.position.z) > 3) continue
      resolveEntityCollision(playerBody, { position, radius: r.npc.mount ? .95 : .42, height: r.npc.mount ? 2.8 : 1.8, bottomOffset: 0, anchored: true }, this.world.obstacles)
    }
    for (const mount of [this.cat, ...this.stableHorses]) if (!mount.dead) resolveEntityCollision(playerBody, { position: mount.group.position, radius: .85, height: 2, bottomOffset: 0, anchored: true }, this.world.obstacles)
    for (const npc of [...this.mission.fieldNpcs, ...this.defense.fieldNpcs]) if (!npc.dead && npc.combatPosition.distanceTo(this.player.combatPosition) < 3) resolveEntityCollision(playerBody, { position: npc.combatPosition, radius: .42, height: 1.8, bottomOffset: 0, anchored: false }, this.world.obstacles)
    this.player.group.position.y = Math.max(this.player.group.position.y, getTerrainHeight(this.player.group.position.x, this.player.group.position.z) + .9)
  }
  private updateAmbient(): void {
    if (this.event.hostile || this.defense.active || this.panel || this.equipment.visible || this.result) { this.ambientLabel.hidden = true; return }
    const nearby = this.residents.find(r => r.spec.role === 'civilian' && !r.npc.dead && r.npc.combatPosition.distanceTo(this.player.combatPosition) < 5)
    if (nearby) {
      const line = this.ambient.take(this.elapsed, this.profile.faction, this.profile.rank)
      if (line) { this.ambientActor = nearby.npc; this.ambientUntil = this.elapsed + 4; this.ambientLabel.textContent = line }
    }
    const actor = this.ambientActor
    this.ambientLabel.hidden = !actor || actor.dead || this.elapsed > this.ambientUntil
    if (this.ambientLabel.hidden || !actor) return
    const point = actor.combatPosition.clone().add(new THREE.Vector3(0, 2.4, 0)).project(this.camera)
    if (point.z > 1 || point.z < -1) { this.ambientLabel.hidden = true; return }
    this.ambientLabel.style.left = (point.x * .5 + .5) * innerWidth + 'px'; this.ambientLabel.style.top = (-point.y * .5 + .5) * innerHeight + 'px'
  }
  private updatePeace(r: Resident, dt: number): void {
    const { npc, spec, target } = r, distance = npc.group.position.distanceTo(this.camera.position), phase = this.elapsed + spec.index * .41
    let speed = 0
    if (npc.mount) {
      npc.mount.beginControlledFrame()
      if (target) {
        const dest = new THREE.Vector3(spec.x + Math.sin(phase * .5) * .65, 0, spec.z + Math.cos(phase * .5) * .65), dir = dest.sub(npc.mount.group.position); dir.y = 0
        speed = .65; npc.mount.addControlledMovement(dir.normalize(), speed, dt)
      }
      npc.mount.finishControlledFrame(dt, this.world.obstacles)
    } else if (spec.role === 'civilian') {
      const walking = Math.sin(phase * .3) > .5
      if (walking) r.walkTime += dt
      const angle = r.walkTime * .35 + spec.index, x = spec.x + Math.sin(angle) * .65, z = spec.z + Math.cos(angle) * .65
      speed = walking ? .23 : 0;
      const previous = npc.group.position.clone()
      npc.group.rotation.y = Math.atan2(Math.cos(angle), -Math.sin(angle)); npc.group.position.set(x, getTerrainHeight(x, z), z)
      resolveObstacleCollision(npc.group.position, previous, 0, true, .42, 1.8, 0, this.world.obstacles)
      npc.group.position.y = getTerrainHeight(npc.group.position.x, npc.group.position.z)
    }
    if (target) { const pos = npc.mount?.group.position ?? npc.group.position; const yaw = Math.atan2(target.x - pos.x, target.z - pos.z); npc.group.rotation.y = yaw; if (npc.mount) npc.mount.group.rotation.y = yaw }
    const cycle = Math.floor(phase / 3), start = cycle !== r.cycle; r.cycle = cycle
    const release = npc.updateTownPeace(dt, distance, Boolean(target), start, speed, phase % 3)
    if (release && distance < 22 && this.elapsed >= this.nextTrainingSound) { sound.playBowRelease(npc.currentLod, false, distance); this.nextTrainingSound = this.elapsed + .6 }
    if (release && target) { const origin = npc.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)); this.fire(origin, target.clone().sub(origin).normalize(), 16, 0, false, true, npc.rangedCombatKind === 'javelin' ? 'pilum' : 'arrow') }
  }
  private updateFieldCombat(dt: number): void {
    this.navigation.sync(this.world.obstacles); this.navigation.beginFrame()
    this.mission.updateFlow(dt, this.orbit.cameraYaw)
    this.updateCareerCommandCue()
    this.updateExternalThreatAssignments()
    const missionActors = new Set(this.mission.fieldNpcs)
    for (const resident of this.residents) {
      if (!missionActors.has(resident.npc) && !this.externalThreatActors.has(resident.npc)) this.updatePeace(resident, dt)
    }
    const actors = [...new Set([...this.mission.fieldNpcs, ...this.externalThreatActors])]
    this.grid.clear(); for (const actor of actors) if (!actor.dead) this.grid.insert(actor)
    for (const actor of actors) {
      const peers = actor.faction === Faction.BANDIT
        ? [...new Set([...this.mission.combatPeersFor(actor), ...this.externalThreatActors])]
        : this.externalThreatActors.has(actor)
          ? [...this.mission.ambientBandits, ...this.mission.missionBandits, ...this.externalThreatActors]
          : this.mission.combatPeersFor(actor)
      actor.update(
        dt,
        this.player,
        peers,
        this.grid.getNearbyInto(actor.combatPosition, 2, this.neighbors),
        this.world.obstacles,
        this.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.damagePlayerFromNpc(actor, damage, 'melee')
          else if (targetNpc) this.hitFieldNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.fire(origin, direction, actor.rangedProjectileSpeed, actor.rangedDamage, false, false, kind, actor),
        false,
        actor.group.position.distanceTo(this.camera.position),
        null,
        null,
        this.navigation,
      )
    }
    const mount = this.careerMounts.activeMount
    if (mount && mount === this.player.currentMount && !mount.dead) {
      for (const target of [...this.mission.ambientBandits, ...this.mission.missionBandits]) {
        if (target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, this.elapsed, damage => this.hitFieldNpc(target, damage, 'mount-impact'))
      }
    }
    this.careerMounts.update(dt)
  }
  private updateExternalThreatAssignments(): void {
    const bandits = [...this.mission.ambientBandits, ...this.mission.missionBandits].filter(npc => !npc.dead)
    this.banditThreatGrid.clear()
    for (const bandit of bandits) this.banditThreatGrid.insert(bandit)
    const missionFriendlies = new Set(this.mission.friendlies)
    for (const resident of this.residents) {
      const { npc, spec } = resident
      const military = spec.role.includes('_') || spec.role === 'captain' || spec.role === 'deployment'
      const threatened = military && !npc.dead && !missionFriendlies.has(npc)
        && this.banditThreatGrid.getNearby(npc.combatPosition, 20).length > 0
      if (threatened) {
        if (!this.externalThreatActors.has(npc)) npc.beginExternalThreat()
        this.externalThreatActors.add(npc)
      } else if (this.externalThreatActors.delete(npc)) {
        if (npc.dead) continue
        npc.endExternalThreat()
        const point = new THREE.Vector3(spec.x, getTerrainHeight(spec.x, spec.z), spec.z)
        if (npc.mount && !npc.mount.dead) {
          npc.mount.group.position.copy(point)
          npc.mount.group.rotation.y = spec.yaw ?? Math.PI
        } else {
          npc.group.position.copy(point)
          npc.group.rotation.y = spec.yaw ?? Math.PI
        }
      }
    }
  }
  private updateDefenseCombat(dt: number): void {
    this.navigation.sync(this.world.obstacles); this.navigation.beginFrame()
    this.defense.updateFlow(dt, this.orbit.cameraYaw)
    this.updateCareerCommandCue()
    const actors = this.defense.fieldNpcs
    this.grid.clear(); this.defenseEnemyGrid.clear(); this.defenseTownGrid.clear()
    const innerBreach = this.defense.releasedEnemies.some(enemy => !enemy.dead && Math.hypot(enemy.combatPosition.x, enemy.combatPosition.z) < 45)
    for (const actor of actors) {
      if (actor.dead) continue
      this.grid.insert(actor)
      if (actor.faction === Faction.ENEMY) this.defenseEnemyGrid.insert(actor)
      else if (actor.townCategory !== 'civilian' || innerBreach) this.defenseTownGrid.insert(actor)
    }
    for (const actor of actors) {
      const hostileGrid = actor.faction === Faction.ENEMY ? this.defenseTownGrid : this.defenseEnemyGrid
      actor.update(
        dt,
        this.player,
        this.defense.peersFor(actor),
        this.grid.getNearbyInto(actor.combatPosition, 2, this.neighbors),
        this.world.obstacles,
        this.hp,
        (damage, isPlayer, targetNpc) => {
          if (isPlayer) this.damagePlayerFromNpc(actor, damage, 'melee')
          else if (targetNpc) this.hitFieldNpc(targetNpc, damage, 'melee', actor)
        },
        (origin, direction, kind) => this.fire(origin, direction, actor.rangedProjectileSpeed, actor.rangedDamage, false, false, kind, actor),
        false,
        actor.group.position.distanceTo(this.camera.position),
        null,
        hostileGrid,
        this.navigation,
      )
    }
    for (const enemy of this.defense.waitingEnemies) {
      if (enemy.dead) continue
      const mount = enemy.mount
      if (mount && !mount.dead) {
        mount.setCameraDistance(mount.group.position.distanceTo(this.camera.position))
        mount.beginControlledFrame()
        mount.finishControlledFrame(dt, this.world.obstacles)
      }
      enemy.updateTownPeace(dt, enemy.group.position.distanceTo(this.camera.position), false, false)
    }
    // A lethal hit dismounts the rider immediately. Keep the now-unowned
    // mission horse updating so its collapse/death state completes visibly.
    for (const enemyMount of this.defense.enemyMounts) {
      enemyMount.setCameraDistance(enemyMount.group.position.distanceTo(this.camera.position))
      if (enemyMount.dead || !enemyMount.riderNpc) enemyMount.update(dt, this.world.obstacles)
    }
    const mount = this.careerMounts.activeMount
    if (mount && mount === this.player.currentMount && !mount.dead) {
      for (const target of this.grid.getNearby(mount.group.position, 2.5)) {
        if (target.faction !== Faction.ENEMY || target.dead || !checkMountImpact(mount, target.combatPosition, .5)) continue
        applyMountImpactDamage(mount, target, target.combatPosition, this.elapsed, damage => this.hitFieldNpc(target, damage, 'mount-impact'))
      }
    }
    if (this.ranger.mount === this.cat && !this.cat.dead && !this.ranger.dead) {
      for (const target of this.grid.getNearby(this.cat.group.position, 2.5)) {
        if (target.faction !== Faction.ENEMY || target.dead || !checkMountImpact(this.cat, target.combatPosition, .5)) continue
        applyMountImpactDamage(this.cat, target, target.combatPosition, this.elapsed, damage => this.hitFieldNpc(target, damage, 'mount-impact', this.ranger))
      }
    }
    this.careerMounts.update(dt)
  }
  private updateCareerCommandCue(): void {
    const active = this.profile.activeMission
    let cue: AudioCommand | null = null
    if (active?.kind === 'town-defense') {
      if (active.phase === 'PREPARING' || active.phase === 'ATTACKING' && !this.defense.reserveHasCharged) cue = 'defend'
      else if (active.phase === 'ATTACKING' || active.phase === 'FAILURE_LOCKED') cue = this.defense.reserveHasCharged ? 'charge' : 'defend'
    } else if (active?.phase === 'ENGAGING') {
      cue = 'attack'
    }
    if (cue === this.careerCommandCue) return
    this.careerCommandCue = cue
    if (cue) sound?.playCommanderCommand(this.profile.faction, cue)
  }
  private updateCareerHorseAudio(): void {
    const candidates: HorseGallopCandidate[] = []
    const playerMount = this.player.currentMount
    if (playerMount && !playerMount.dead && playerMount.type === MountType.HORSE) candidates.push({
      id: playerMount,
      active: playerMount.movementSpeed >= 7.5,
      lod: playerMount.currentLod,
      distance: playerMount.group.position.distanceTo(this.camera.position),
      isPlayer: true,
    })
    const actors = this.defense.active ? this.defense.fieldNpcs : this.mission.fieldNpcs
    for (const actor of actors) {
      const mount = actor.mount
      if (!mount || mount.dead || mount.type !== MountType.HORSE || actor.dead || mount === playerMount) continue
      candidates.push({
        id: mount,
        active: mount.movementSpeed >= 7.5,
        lod: mount.currentLod,
        distance: mount.group.position.distanceTo(this.camera.position),
        isPlayer: false,
      })
    }
    sound?.updateHorseGallopLoops(candidates)
  }
  private updateHostile(dt: number): void {
    this.navigation.sync(this.world.obstacles); this.navigation.beginFrame()
    if (this.npcObstacles.length !== this.world.obstacles.length) this.npcObstacles = this.world.obstacles.map(o => ({ box: o.box, isBarricade: o.isBarricade }))
    this.grid.clear(); for (const r of this.residents) if (!r.npc.dead) this.grid.insert(r.npc)
    const ranger = this.ranger, status = updateRangerMount(ranger, this.cat, ranger.combatPosition.distanceTo(this.cat.group.position))
    this.cat.catVisual?.setEquipmentVisible(status === 'mounted')
    for (const r of this.residents) {
      if (r.npc === ranger && status === 'approach') {
        const dir = this.cat.group.position.clone().sub(ranger.group.position); dir.y = 0; ranger.group.position.addScaledVector(dir.normalize(), dt * 3.5); ranger.group.position.y = getTerrainHeight(ranger.group.position.x, ranger.group.position.z); ranger.group.rotation.y = Math.atan2(dir.x, dir.z); ranger.updateTownPeace(dt, ranger.group.position.distanceTo(this.camera.position), false, false, 3.5); continue
      }
      r.npc.update(dt, this.player, [], this.grid.getNearbyInto(r.npc.combatPosition, 2, this.neighbors), this.npcObstacles, this.hp, (damage, isPlayer) => { if (isPlayer) damagePlayer(this.player, damage, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null) }, (origin, direction, kind) => this.fire(origin, direction, r.npc.rangedProjectileSpeed, r.npc.rangedDamage, false, false, kind, r.npc), false, r.npc.group.position.distanceTo(this.camera.position), null, null, this.navigation)
    }
    for (const mount of this.mounts) if (!mount.dead && mount.riderNpc && checkMountImpact(mount, this.player.combatPosition, .6)) {
      applyMountImpactDamage(mount, this.player, this.player.combatPosition, this.elapsed, amount => damagePlayer(this.player, amount, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null))
    }
    if (!this.cat.dead && status === 'foot') {
      const dir = this.player.position.clone().sub(this.cat.group.position); dir.y = 0
      this.cat.beginControlledFrame(); this.cat.group.rotation.y = Math.atan2(dir.x, dir.z)
      if (dir.length() > 1.5) this.cat.addControlledMovement(dir.normalize(), 7, dt)
      else if (this.cat.canImpact(this.player, this.elapsed)) damagePlayer(this.player, 15, this.hp, null)
      this.cat.finishControlledFrame(dt, this.world.obstacles)
    }
  }
  private interaction(): void {
    this.target = null; let nearest = 2.6
    if (!this.event.hostile && !this.defense.active) for (const id of ['captain', 'deployment', 'merchant', 'ranger', 'cat']) {
      if (!this.serviceAvailable(id)) continue
      const pos = id === 'cat' ? this.cat.group.position : this.residents.find(r => r.spec.id === id)!.npc.combatPosition
      const delta = pos.clone().sub(this.player.combatPosition); delta.y = 0; const distance = delta.length()
      if (distance > nearest || delta.normalize().dot(new THREE.Vector3(Math.sin(this.player.facingYaw), 0, Math.cos(this.player.facingYaw))) < .35) continue
      const start = this.player.position.clone(), end = pos.clone().add(new THREE.Vector3(0, 1, 0)), ray = new THREE.Ray(start, end.clone().sub(start).normalize())
      if (this.world.obstacles.some(o => { const hit = ray.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(start) < end.distanceTo(start) })) continue
      this.target = id; nearest = distance
    }
    this.hint.textContent = this.target ? 'E 與 ' + NAMES[this.target] + ' 交談' : this.event.hostile ? '全鎮追擊中' : this.defense.active ? '城鎮正在遭受攻擊' : ''
    this.hint.style.display = this.hint.textContent ? '' : 'none'
  }
  private finish(result: TownResult): void {
    this.result = result
    const next = settleTown(this.profile, this.profile.townEvent!.id, result)
    if (!this.commit(next)) { const p = this.openPanel('結算尚未保存', '保存失敗；尚未扣款或轉場。'); this.button(p, '重試保存', () => this.finish(result)); return }
    const panel = this.openPanel(result === 'player_defeated' ? '弱者必須服從法律' : '小鎮已擊敗', result === 'player_defeated' ? '實際扣除 ' + next.townEvent!.penalty + ' 可用軍功，餘額 ' + next.availableMerit : '轉投 ' + next.faction + '，軍階 Recruit。本次入伍軍功歸零；歷史軍功與收藏保留。')
    this.button(panel, (result === 'player_defeated' ? '返回 ' : '前往 ') + (next.faction === 'viking' ? 'økse 村' : 'vinum 村'), () => { this.dispose(); this.onRestart(next) })
  }
  private showAmbientDefeat(): void {
    if (this.ambientDefeatShown) return
    this.ambientDefeatShown = true
    this.missionResultOpen = true
    const panel = this.openPanel('你被擊敗', '這是自由野外戰鬥：不增加軍功，也不扣除可用軍功。')
    this.button(panel, '返回小鎮', () => {
      const next = cloneCareerProfile(this.profile)
      this.missionResultOpen = false
      this.dispose()
      this.onRestart(next)
    })
  }
  private frame(time: number): void {
    if (this.disposed) return
    this.updatePointerPrompt()
    const dt = Math.min(.05, (time - this.last) / 1000); this.last = time
    if (!this.panel && !this.equipment.visible && !this.result) {
      this.elapsed += dt
      this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory)
      this.player.group.updateWorldMatrix(true, true)
      this.melee()
      if (this.event.hostile) this.updateHostile(dt)
      else if (this.defense.active) this.updateDefenseCombat(dt)
      else {
        this.updateFieldCombat(dt)
      }
      this.updateCareerHorseAudio()
      for (const horse of this.stableHorses) if (!horse.dead) horse.horseVisual?.update(dt, horse.group.position.distanceTo(this.camera.position))
      for (const m of this.mounts) { m.setCameraDistance(m.group.position.distanceTo(this.camera.position)); if (m.dead) m.update(dt, this.world.obstacles) }
      if (!this.event.hostile && !this.cat.dead && !this.cat.riderNpc) { this.cat.beginControlledFrame(); this.cat.finishControlledFrame(dt, this.world.obstacles) }
      this.resolveBodies(); this.updateShots(dt); this.orbit.update(this.input, dt); this.interaction()
      const townOutcome = this.event.evaluate(this.player.dead)
      if (townOutcome && !this.panel) this.finish(townOutcome)
      else if (!this.event.hostile) {
        const missionOutcome = this.defense.active ? this.defense.evaluate(this.player.dead) : this.mission.evaluate(this.player.dead)
        if (missionOutcome && !this.panel) this.finishMission(missionOutcome)
        else if (!this.profile.activeMission && this.player.dead && !this.panel) this.showAmbientDefeat()
        else if (!this.defense.active && this.mission.returnComplete && !this.panel) this.settleReturnedMissionInPlace()
      }
    }
    else sound?.updateHorseGallopLoops([])
    for (const [id, marker] of this.serviceMarkers) marker.visible = !this.event.hostile && !this.defense.active && this.serviceAvailable(id)
    const missionHud = this.profile.activeMission
      ? this.profile.activeMission.kind === 'town-defense'
        ? `\nTOWN DEFENSE ${this.profile.activeMission.phase} · 敵軍剩餘 ${this.defense.remainingEnemies} · 平民死亡 ${this.defense.civilianDeaths}/10`
        : fieldMissionHud(
          this.profile.activeMission.kind === 'patrol' ? 'patrol' : 'bandit',
          this.profile.activeMission.phase,
          this.mission.remainingEnemies,
        )
      : ''
    this.hud.textContent = `${this.profile.faction === 'viking' ? 'økse 村' : 'vinum 村'}\n已任命軍階 ${this.profile.rank}\n累積軍功 ${this.profile.totalMerit} · 可用軍功 ${this.profile.availableMerit}${missionHud}`
    this.damageNumbers.update(dt, this.camera)
    this.updateAmbient()
    this.quiver.setArrowCount(this.player.arrowCount)
    document.getElementById('quiver-hud')!.style.display = this.inventory.rangedEnabled ? '' : 'none'
    this.hud.style.whiteSpace = 'pre-line'; this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(t => this.frame(t))
  }
  dispose(): void {
    sound?.updateHorseGallopLoops([])
    if (this.disposed) return
    document.getElementById('controls-hint')!.textContent = this.previousControls
    document.getElementById('quiver-hud')!.style.display = ''
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.abort(); this.input.dispose(); this.panel?.remove(); this.equipment.close(); this.hud.remove(); this.hint.remove(); this.pointerPrompt.remove(); this.careerMounts?.dispose(); this.mission?.dispose(); this.defense?.dispose(); this.player?.dispose(); this.ambientLabel.remove(); this.damageNumbers.update(100, this.camera); this.residents.forEach(r => r.npc.dispose()); this.mounts.forEach(m => m.dispose()); this.shots.forEach(s => s.arrow.destroy()); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); document.exitPointerLock?.()
  }

  private updatePointerPrompt(): void {
    const unlocked = !this.input.isLocked && !location.search.includes('nolock')
    this.pointerPrompt.style.display = unlocked && !this.panel && !this.equipment.visible ? '' : 'none'
  }
}
