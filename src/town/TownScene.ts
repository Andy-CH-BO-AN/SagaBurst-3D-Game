import * as THREE from 'three'
import { Player } from '../player/Player'
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
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { getTerrainHeight, resolveEntityCollision, resolveObstacleCollision, type ObstacleData } from '../world/Terrain'
import { damageNpc, damagePlayer } from '../combat/DamageRouter'
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
import { SoundManager } from '../audio/SoundManager'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from '../career/CareerProfile'
import { getAntiCavalryMultiplier, getBerserkerModifiers } from '../combat/CombatBalance'
import { townMeleeContact } from './TownCombat'
import { TownWorld } from './TownWorld'
import { TownEquipment } from './TownEquipment'
import { TOWN_RULES, TownEvent, townRoster, townCaptainProfile, stableHorsePositions, townSitePoint, TOWN_SITES, isCivilian, productStatus, TOWN_PRODUCTS, settleTown, updateRangerMount, type TownActorSpec, type TownResult } from './TownRules'

let sound: SoundManager
interface Resident { spec: TownActorSpec; npc: NPC; target?: THREE.Vector3; cycle: number; walkTime: number }
interface Shot { arrow: ArrowProjectile; readonly training: boolean; readonly player: boolean; age: number }
const NAMES: Record<string, string> = { captain: '騎兵隊長', deployment: '出戰步兵', merchant: '武器店主', ranger: '遊俠 Maki', cat: '黑貓店主', civilian: '平民 Civilian' }
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
  private readonly input = new PlayerInput({ freeLookOnEntry: true })
  private orbit!: ThirdPersonCamera
  private readonly grid = new SpatialGrid<NPC>(4)
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
      const preset = (profile.faction + '_' + (cavalry ? ranged ? 'horse_archer' : 'sword_cavalry' : ranged ? profile.faction === 'roman' ? 'javelin_infantry' : 'archer' : profile.faction === 'roman' ? 'heavy_infantry' : 'berserker')) as UnitPresetId
      const captain = spec.role === 'captain' ? townCaptainProfile(profile.faction) : undefined
      const loadout = civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null } : { ...UNIT_PRESETS[preset].tierLoadouts[spec.role === 'captain' ? 3 : TOWN_RULES.garrisonTier] }
      const npc = new NPC(this.scene, spec.x, spec.z, Faction.TOWN, civilian ? 'roman' : ranger ? 'viking' : profile.faction, ranged ? AIType.RANGED : AIType.MELEE, NAMES[spec.role] ?? spec.id, ranger || captain ? 4 : TOWN_RULES.garrisonTier, cavalry, loadout, civilian ? undefined : preset, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : captain?.visualAssetId, ranger ? 'ranger' : captain?.combatProfileId, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, profile.faction)
      npc.setTownPeaceful(); npc.group.rotation.y = Math.PI
      if (cavalry) { const mount = new Mount(this.scene, captain ? mountTypeFromId(captain.mountOverride) : MountType.HORSE, spec.x, spec.z); mount.reservedForTown = true; mount.group.rotation.y = spec.yaw ?? Math.PI; npc.mountVehicle(mount); this.mounts.push(mount) }
      if (NAMES[spec.role] && spec.role !== 'civilian') { npc.group.rotation.y = spec.yaw ?? 0; this.serviceMarkers.set(spec.id, this.world.addServiceMarker(npc.group, ranger ? 1.9 : captain ? 2 : 2.2)) }
      const training = spec.role.includes('_'), target = training ? this.world.addTarget(spec.x, spec.z - (ranged ? 3 : 1.5), ranged) : undefined
      this.residents.push({ spec, npc, target, cycle: -1, walkTime: 0 }); this.event.register(spec.id, npc)
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
    this.player = new Player(this.scene, profile.faction)
    this.player.group.position.set(0, getTerrainHeight(0, 9) + .9, 9); this.player.group.rotation.y = Math.PI
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
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
    this.navigation.sync(this.world.obstacles)
    this.hud.id = 'town-hud'; this.hud.style.cssText = 'position:fixed;top:20px;left:20px;z-index:90;background:#201d19de;color:#efe1c3;padding:16px 22px;border:1px solid #aa9270;line-height:1.7;font:15px system-ui;max-width:520px;pointer-events:none'
    this.hint.id = 'town-hint'; this.hint.style.cssText = 'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:90;color:#fff;background:#211e19dd;padding:10px 20px;font:18px system-ui;pointer-events:none'
    this.ambientLabel.className = 'town-ambient'; this.ambientLabel.hidden = true
    document.body.append(this.hud, this.hint, this.ambientLabel)
    document.getElementById('controls-hint')!.textContent = 'WASD 移動 · Shift 奔跑 · Tab 裝備／拔刀 · E 交談 · Q / Esc 關閉面板'
    const opts = { capture: true, signal: this.listeners.signal }
    window.addEventListener('keydown', e => this.key(e), opts)
    for (const type of ['mousedown', 'mouseup', 'wheel'] as const) window.addEventListener(type, e => { if (this.panel || this.equipment.visible) { e.stopImmediatePropagation(); this.input.clear() } }, { ...opts, passive: false })
    renderer.domElement.addEventListener('click', () => { if (!this.panel && !this.equipment.visible) { if (!location.search.includes('nolock')) this.input.requestPointerLock(renderer.domElement); sound.unlockAudio() } }, { signal: this.listeners.signal })
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }, { signal: this.listeners.signal })
    this.player.onFireArrow = e => this.fire(e.origin, e.direction, e.speed, e.damage, true, false, e.visualKind)
    if (profile.townEvent?.state === 'hostile') { this.inventory.restoreForHostile(); this.activateHostility(false); this.notice = '未結束的小鎮事件已恢復：全鎮仍在追擊。' }
    this.hp.setFill(1)
    this.orbit.update(this.input)
    this.last = performance.now()
    this.raf = requestAnimationFrame(t => this.frame(t))
  }
  private commit(profile: CareerProfile): boolean {
    if (!this.store.save(profile)) { this.notice = '保存失敗，資料尚未變更。請確認瀏覽器儲存空間後重試。'; return false }
    this.profile = profile; return true
  }
  private key(e: KeyboardEvent): void {
    if (this.panel || this.equipment.visible) {
      e.stopImmediatePropagation()
      if (['KeyQ', 'Escape', 'Tab'].includes(e.code)) { e.preventDefault(); if (!this.result) this.closePanel() }
      return
    }
    if (e.repeat) return
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); this.input.clear(); this.player.clearTownAction(); document.exitPointerLock?.(); this.equipment.open(this.skills, this.inventory, () => this.input.clear()); return }
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
    if (!this.result) this.button(panel, '關閉 · Q / Esc', () => this.closePanel())
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
        if (fresh && this.commit(fresh)) this.talk('captain', selectTownDialogue({ ...context, playerRank: fresh.rank }, 'promotionSuccess'))
      })
    } else if (id === 'deployment') {
      const panel = this.openPanel('出戰步兵', greeting + '\n\n' + selectTownDialogue(context, firstOutpost ? 'soldierFirstOutpost' : 'mission'))
      const badge = document.createElement('p'); badge.className = 'town-summary'; badge.textContent = '出戰尚未開放'; panel.append(badge)
    } else {
      const mount = id !== 'merchant', panel = this.openPanel(NAMES[id], greeting)
      const summary = document.createElement('p'); summary.className = 'town-summary'; summary.textContent = '可用軍功 ' + p.availableMerit + ' · ' + p.rank + (mount ? ' · 戰馬依 T1 → T2 → T3 購買；村內騎乘尚未開放' : ' · 目前僅展示價目'); panel.append(summary)
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
                message = selectTownDialogue(context, 'horsePurchaseSuccess')
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
  private serviceAvailable(id: string): boolean {
    if (this.event.actors.get(id)?.dead) return false
    const building = id === 'merchant' ? 'weapons' : id === 'ranger' || id === 'cat' ? 'stable' : null
    return !building || !this.world.buildings.find(b => b.id === building)?.hp.destroyed
  }
  /** Persist before applying the first effective hit; failure leaves the target unchanged. */
  private prepareDamage(): boolean {
    if (this.event.hostile) return true
    const p = cloneCareerProfile(this.profile); p.townEvent = { id: crypto.randomUUID(), state: 'hostile' }
    return this.commit(p)
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
  private hitResident(npc: NPC | Mount, amount: number): void {
    if (npc.dead || amount <= 0 || !this.prepareDamage()) return
    let applied = 0
    const position = npc instanceof NPC ? npc.combatPosition.clone() : npc.group.position.clone()
    if (npc instanceof NPC) applied = damageNpc(npc, amount).appliedDamage
    else { const before = npc.currentHp; npc.takeDamage(amount); applied = before - npc.currentHp; if (npc.dead && this.ranger.mount === npc) this.ranger.dismountFromMount() }
    if (applied > 0) this.damageNumbers.spawn(applied, position)
    this.activateHostility(); this.persistCasualties()
  }
  private get ranger(): NPC { return this.residents.find(r => r.spec.role === 'ranger')!.npc }
  private damageBuilding(index: number, amount: number): void {
    const b = this.world.buildings[index]; if (!b || b.hp.destroyed || amount <= 0) return
    const townOwned = b.ownerFaction !== Faction.BANDIT
    if (townOwned && !this.prepareDamage()) return
    b.hp.takeDamage(amount); this.world.refreshDamage(); this.navigation.sync(this.world.obstacles)
    if (townOwned) this.activateHostility()
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
  private fire(origin: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number, player: boolean, training: boolean, kind: 'arrow' | 'pilum'): void {
    if (this.shots.length >= 100 || training && this.shots.filter(s => s.training).length >= 60) return
    this.shots.push({ arrow: new ArrowProjectile(this.scene, origin, direction, speed, damage, player ? Faction.PLAYER : Faction.ENEMY, player, kind), training, player, age: 0 })
  }
  private updateShots(dt: number): void {
    for (const s of this.shots) {
      const from = s.arrow.mesh.position.clone(); s.age += dt
      s.arrow.update(dt, this.player, [], [], () => {}, damage => damagePlayer(this.player, damage, this.hp, null), undefined, true)
      const to = s.arrow.mesh.position, delta = to.clone().sub(from), length = delta.length(), ray = new THREE.Ray(from, delta.normalize())
      if (s.training) { if (s.age > .3) s.arrow.destroy(); continue }
      let nearest = length + .01, hit: (() => void) | null = null
      for (let i = 0; i < this.world.buildings.length; i++) {
        const b = this.world.buildings[i], obstacle = this.world.obstacles.find(o => o.damageable === b.hp)
        if (!obstacle) continue
        const p = ray.intersectBox(obstacle.box, new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => { if (s.player) this.damageBuilding(i, s.arrow.damage) } }
      }
      for (const target of this.world.targets) {
        const p = ray.intersectSphere(new THREE.Sphere(target, .6), new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => {} }
      }
      const targets = s.player ? [...this.residents.map(r => r.npc), this.cat, ...this.stableHorses] : [this.player]
      for (const target of targets) {
        if (target.dead) continue
        const center = target instanceof Player ? target.position.clone() : target instanceof NPC ? target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0)) : target.group.position.clone().add(new THREE.Vector3(0, 1, 0))
        const p = ray.intersectSphere(new THREE.Sphere(center, .8), new THREE.Vector3()), distance = p?.distanceTo(from) ?? Infinity
        if (distance < nearest) { nearest = distance; hit = () => target instanceof Player ? damagePlayer(target, s.arrow.damage, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null) : this.hitResident(target, s.arrow.damage) }
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
    const weapon = this.inventory.equippedMelee, from = this.player.getWeaponGripPosition(new THREE.Vector3()), tip = this.player.getSwordTipPosition(), ray = new THREE.Ray(from, tip.clone().sub(from).normalize())
    // Buildings block melee before residents behind them.
    for (let i = 0; i < this.world.buildings.length; i++) {
      const b = this.world.buildings[i], box = this.world.obstacles.find(o => o.damageable === b.hp)?.box
      const p = box && ray.intersectBox(box.clone().expandByScalar(.25), new THREE.Vector3())
      if (p && p.distanceTo(from) <= from.distanceTo(tip) + .3) { this.player.markHitProcessed(); this.damageBuilding(i, weapon.damageMax); return }
    }
    if (this.world.targets.some(p => p.distanceTo(tip) < .8)) { this.player.markHitProcessed(); return }
    for (const target of [...this.residents.map(r => r.npc), this.cat, ...this.stableHorses]) {
      if (target.dead) continue
      const center = target instanceof NPC ? target.combatPosition.clone() : target.group.position.clone(); center.y += 1
      const line = new THREE.Ray(this.player.position, center.clone().sub(this.player.position).normalize())
      const blocked = this.world.obstacles.some(o => { const hit = line.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(this.player.position) < center.distanceTo(this.player.position) - .4 })
      if (!blocked && townMeleeContact(this.player.position, this.player.facingYaw, from, tip, previousTip, center, weapon.range ?? 1.8, weapon.combatKind === 'lance')) { this.player.markHitProcessed(); this.hitResident(target, Math.round(weapon.damageMax * getAntiCavalryMultiplier(weapon.combatKind, false, target instanceof Mount || target.isMounted) * getBerserkerModifiers(this.profile.faction, false, weapon.combatKind, this.inventory.shieldEnabled).meleeDamageMultiplier)); return }
    }
  }
  private resolveBodies(): void {
    const playerBody = { position: this.player.group.position, radius: .42, height: 1.8, bottomOffset: .9 }
    for (const r of this.residents) {
      if (r.npc.dead) continue
      const position = r.npc.mount?.group.position ?? r.npc.group.position
      if (Math.hypot(position.x - playerBody.position.x, position.z - playerBody.position.z) > 3) continue
      resolveEntityCollision(playerBody, { position, radius: r.npc.mount ? .95 : .42, height: r.npc.mount ? 2.8 : 1.8, bottomOffset: 0, anchored: true }, this.world.obstacles)
    }
    for (const mount of [this.cat, ...this.stableHorses]) if (!mount.dead) resolveEntityCollision(playerBody, { position: mount.group.position, radius: .85, height: 2, bottomOffset: 0, anchored: true }, this.world.obstacles)
    this.player.group.position.y = Math.max(this.player.group.position.y, getTerrainHeight(this.player.group.position.x, this.player.group.position.z) + .9)
  }
  private updateAmbient(): void {
    if (this.event.hostile || this.panel || this.equipment.visible || this.result) { this.ambientLabel.hidden = true; return }
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
      r.npc.update(dt, this.player, [], this.grid.getNearbyInto(r.npc.combatPosition, 2, this.neighbors), this.npcObstacles, this.hp, (damage, isPlayer) => { if (isPlayer) damagePlayer(this.player, damage, this.hp, this.inventory.shieldEnabled ? this.inventory.equippedShield?.id ?? null : null) }, (origin, direction, kind) => this.fire(origin, direction, r.npc.rangedProjectileSpeed, r.npc.rangedDamage, false, false, kind), false, r.npc.group.position.distanceTo(this.camera.position), null, null, this.navigation)
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
    if (!this.event.hostile) for (const id of ['captain', 'deployment', 'merchant', 'ranger', 'cat']) {
      if (!this.serviceAvailable(id)) continue
      const pos = id === 'cat' ? this.cat.group.position : this.residents.find(r => r.spec.id === id)!.npc.combatPosition
      const delta = pos.clone().sub(this.player.combatPosition); delta.y = 0; const distance = delta.length()
      if (distance > nearest || delta.normalize().dot(new THREE.Vector3(Math.sin(this.player.facingYaw), 0, Math.cos(this.player.facingYaw))) < .35) continue
      const start = this.player.position.clone(), end = pos.clone().add(new THREE.Vector3(0, 1, 0)), ray = new THREE.Ray(start, end.clone().sub(start).normalize())
      if (this.world.obstacles.some(o => { const hit = ray.intersectBox(o.box, new THREE.Vector3()); return hit && hit.distanceTo(start) < end.distanceTo(start) })) continue
      this.target = id; nearest = distance
    }
    this.hint.textContent = this.target ? 'E 與 ' + NAMES[this.target] + ' 交談' : this.event.hostile ? '全鎮追擊中' : ''
    this.hint.style.display = this.hint.textContent ? '' : 'none'
  }
  private finish(result: TownResult): void {
    this.result = result
    const next = settleTown(this.profile, this.profile.townEvent!.id, result)
    if (!this.commit(next)) { const p = this.openPanel('結算尚未保存', '保存失敗；尚未扣款或轉場。'); this.button(p, '重試保存', () => this.finish(result)); return }
    const panel = this.openPanel(result === 'player_defeated' ? '弱者必須服從法律' : '小鎮已擊敗', result === 'player_defeated' ? '實際扣除 ' + next.townEvent!.penalty + ' 可用軍功，餘額 ' + next.availableMerit : '轉投 ' + next.faction + '，軍階 Recruit。本次入伍軍功歸零；歷史軍功與收藏保留。')
    this.button(panel, (result === 'player_defeated' ? '返回 ' : '前往 ') + (next.faction === 'viking' ? 'økse 村' : 'vinum 村'), () => { this.dispose(); this.onRestart(next) })
  }
  private frame(time: number): void {
    if (this.disposed) return
    const dt = Math.min(.05, (time - this.last) / 1000); this.last = time
    if (!this.panel && !this.equipment.visible && !this.result) {
      this.elapsed += dt
      this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory)
      this.player.group.updateWorldMatrix(true, true)
      this.melee()
      if (this.event.hostile) this.updateHostile(dt); else for (const r of this.residents) this.updatePeace(r, dt)
      for (const horse of this.stableHorses) if (!horse.dead) horse.horseVisual?.update(dt, horse.group.position.distanceTo(this.camera.position))
      for (const m of this.mounts) { m.setCameraDistance(m.group.position.distanceTo(this.camera.position)); if (m.dead) m.update(dt, this.world.obstacles) }
      if (!this.event.hostile) { this.cat.beginControlledFrame(); this.cat.finishControlledFrame(dt, this.world.obstacles) }
      this.resolveBodies(); this.updateShots(dt); this.orbit.update(this.input, dt); this.interaction()
      const outcome = this.event.evaluate(this.player.dead); if (outcome && !this.panel) this.finish(outcome)
    }
    for (const [id, marker] of this.serviceMarkers) marker.visible = !this.event.hostile && this.serviceAvailable(id)
    this.hud.textContent = this.profile.faction === 'viking' ? 'økse 村' : 'vinum 村'
    this.damageNumbers.update(dt, this.camera)
    this.updateAmbient()
    document.getElementById('quiver-hud')!.style.display = this.inventory.rangedEnabled ? '' : 'none'
    this.hud.style.whiteSpace = 'pre-line'; this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(t => this.frame(t))
  }
  dispose(): void {
    if (this.disposed) return
    document.getElementById('controls-hint')!.textContent = this.previousControls
    document.getElementById('quiver-hud')!.style.display = ''
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.abort(); this.input.dispose(); this.panel?.remove(); this.equipment.close(); this.hud.remove(); this.hint.remove(); this.player?.dispose(); this.ambientLabel.remove(); this.damageNumbers.update(100, this.camera); this.residents.forEach(r => r.npc.dispose()); this.mounts.forEach(m => m.dispose()); this.shots.forEach(s => s.arrow.destroy()); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); document.exitPointerLock?.()
  }
}
