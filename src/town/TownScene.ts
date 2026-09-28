import * as THREE from 'three'
import { Player } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { NPC, AIType, Faction } from '../world/NPC'
import { Mount, MountType } from '../world/Mount'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { preloadMakiRangerBow } from '../world/MakiRangerEquipment'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ArrowProjectile } from '../world/ArrowProjectile'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'
import { damageNpc, damagePlayer } from '../combat/DamageRouter'
import { SpatialGrid } from '../world/SpatialGrid'
import { checkMountImpact, applyMountImpactDamage } from '../combat/MountImpact'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { QuiverUI } from '../ui/QuiverUI'
import { EquipmentUI } from '../ui/EquipmentUI'
import { SkillManager } from '../rpg/SkillManager'
import { SoundManager } from '../audio/SoundManager'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CAREER_RANKS, CAREER_RANK_THRESHOLDS, cloneCareerProfile, enlistmentMerit, promoteCareer, type CareerProfile } from '../career/CareerProfile'
import { TownWorld } from './TownWorld'
import { TownEquipment } from './TownEquipment'
import { TOWN_RULES, TownEvent, townRoster, isCivilian, productStatus, TOWN_PRODUCTS, settleTown, updateRangerMount, type TownActorSpec, type TownResult } from './TownRules'

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
  readonly player: Player
  readonly residents: Resident[] = []
  readonly mounts: Mount[] = []
  readonly cat: Mount
  readonly inventory: TownEquipment
  private readonly input = new PlayerInput()
  private readonly orbit: ThirdPersonCamera
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
  private notice = ''
  private readonly store = new CareerProfileStore()
  static async create(container: HTMLElement, profile: CareerProfile, onCampaign: () => void, onRestart: (p: CareerProfile) => void): Promise<TownScene> {
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    try {
      await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), BlackCatVisual.preload(), HumanoidAssetRegistry.preloadAsset(HERO_ASSETS['maki-archer-t4'].descriptor), preloadMakiRangerBow()])
      return new TownScene(container, renderer, profile, onCampaign, onRestart)
    } catch (error) { renderer.dispose(); throw error }
  }
  private constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, public profile: CareerProfile, private readonly onCampaign: () => void, private readonly onRestart: (p: CareerProfile) => void) {
    sound ??= new SoundManager()
    this.renderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; container.appendChild(renderer.domElement)
    this.world = new TownWorld(profile.faction, this.scene)
    this.player = new Player(this.scene, profile.faction); this.player.group.position.set(0, getTerrainHeight(0, 9) + .9, 9); this.player.group.rotation.y = Math.PI
    this.inventory = new TownEquipment(() => this.profile, p => this.commit(p))
    this.orbit = new ThirdPersonCamera(this.camera, this.player)
    this.cat = new Mount(this.scene, MountType.BLACK_CAT, -25, 18); this.cat.reservedForTown = true; this.cat.catVisual?.setEquipmentVisible(false); this.mounts.push(this.cat)
    for (const spec of townRoster()) {
      if (spec.role === 'cat') { this.event.register(spec.id, this.cat); continue }
      const civilian = isCivilian(spec.role), ranger = spec.role === 'ranger', cavalry = spec.role.includes('cavalry') || spec.role === 'captain', ranged = spec.role.startsWith('ranged') || ranger
      const preset = (profile.faction + '_' + (cavalry ? ranged ? 'horse_archer' : 'sword_cavalry' : ranged ? profile.faction === 'roman' ? 'javelin_infantry' : 'archer' : profile.faction === 'roman' ? 'heavy_infantry' : 'berserker')) as UnitPresetId
      const loadout = civilian ? { meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null } : ranger ? { meleeWeaponId: 'maki-ranger-bow', rangedWeaponId: T4_RANGER_BOW_RANGED_ID, shieldId: null, mountId: null } : { ...UNIT_PRESETS[preset].tierLoadouts[spec.role === 'captain' ? 3 : TOWN_RULES.garrisonTier] }
      const npc = new NPC(this.scene, spec.x, spec.z, Faction.ENEMY, civilian ? 'roman' : ranger ? 'viking' : profile.faction, ranged ? AIType.RANGED : AIType.MELEE, NAMES[spec.role] ?? spec.id, ranger ? 4 : spec.role === 'captain' ? 3 : TOWN_RULES.garrisonTier, cavalry, loadout, civilian ? undefined : preset, undefined, spec.id, undefined, ranger ? 'maki-archer-t4' : undefined, ranger ? 'ranger' : undefined, ranger ? 'maki-ranger' : undefined, civilian ? 'civilian' : undefined, profile.faction)
      npc.setTownPeaceful(); npc.group.rotation.y = Math.PI
      if (cavalry) { const mount = new Mount(this.scene, MountType.HORSE, spec.x, spec.z); mount.reservedForTown = true; mount.group.rotation.y = Math.PI; npc.mountVehicle(mount); this.mounts.push(mount) }
      const training = spec.role.includes('_'), target = training ? this.world.addTarget(spec.x, spec.z - (ranged ? 3 : 1.5), ranged) : undefined
      this.residents.push({ spec, npc, target, cycle: -1, walkTime: 0 }); this.event.register(spec.id, npc)
    }
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
    document.body.append(this.hud, this.hint)
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
    const panel = document.createElement('div'); panel.id = 'town-dialog'; panel.style.cssText = 'position:fixed;inset:12% 24%;z-index:1000;background:#221f1af7;color:#f0e3c5;padding:28px;overflow:auto;border:1px solid #c3a975;font:16px system-ui;box-shadow:0 20px 90px #000'
    const heading = document.createElement('h2'); heading.textContent = title; panel.append(heading)
    const body = document.createElement('p'); body.textContent = text; body.style.whiteSpace = 'pre-line'; panel.append(body)
    if (!this.result) this.button(panel, '關閉 · Q / Esc', () => this.closePanel())
    document.body.append(panel); this.panel = panel; return panel
  }
  private button(parent: HTMLElement, label: string, action: () => void): void { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:12px 20px;margin:10px 12px 10px 0;cursor:pointer'; b.onclick = action; parent.append(b) }
  private talk(id: string): void {
    if (this.event.hostile || !this.serviceAvailable(id)) return
    const p = this.profile
    if (id === 'captain') {
      const next = CAREER_RANKS[CAREER_RANKS.indexOf(p.rank) + 1], merit = enlistmentMerit(p)
      const panel = this.openPanel('騎兵隊長 · 任命', '目前軍階：' + p.rank + '\n本次入伍軍功：' + merit + (next ? '\n下一階：' + next + ' · 需求 ' + CAREER_RANK_THRESHOLDS[next] + ' · 尚差 ' + Math.max(0, CAREER_RANK_THRESHOLDS[next] - merit) : '\n已達最高軍階'))
      if (next && merit >= CAREER_RANK_THRESHOLDS[next]) this.button(panel, '確認升一階', () => { const fresh = promoteCareer(this.profile); if (fresh && this.commit(fresh)) { this.notice = '已任命為 ' + fresh.rank; this.talk('captain') } })
    } else if (id === 'deployment') {
      const panel = this.openPanel('出戰步兵', p.faction.toUpperCase() + ' · 前往第一關防守戰役設定')
      this.button(panel, '前往戰役', () => { if (!this.event.hostile) { this.dispose(); this.onCampaign() } })
    } else {
      const mount = id !== 'merchant', panel = this.openPanel(mount ? '黑貓馬廄 · 價格表' : '武器店 · 價格表', '展示用途，尚未開放購買。價格與解鎖 Tier 為暫定配置。')
      const table = document.createElement('table'); table.style.cssText = 'width:100%;text-align:left;line-height:2'; panel.append(table)
      for (const item of TOWN_PRODUCTS.filter(i => (i.category === 'mount') === mount)) { const row = table.insertRow(); for (const value of [item.name, 'T' + item.tier, item.price + ' 軍功', productStatus(p, item)]) row.insertCell().textContent = value }
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
    this.event.hostile = true; this.closePanel(); this.notice = '全鎮反擊！所有服務停止。'
    for (const r of this.residents) r.npc.beginTownHostility()
    const speaker = this.residents.find(r => r.spec.role === 'captain' && !r.npc.dead) ?? this.residents.find(r => !r.npc.dead && !isCivilian(r.spec.role))
    this.chargeSpeakerId = speaker?.spec.id ?? null
    if (shout && speaker) sound.playCommanderCommand(this.profile.faction, 'charge')
  }
  private hitResident(npc: NPC | Mount, amount: number): void {
    if (npc.dead || amount <= 0 || !this.prepareDamage()) return
    if (npc instanceof NPC) damageNpc(npc, amount)
    else { npc.takeDamage(amount); if (npc.dead && this.ranger.mount === npc) this.ranger.dismountFromMount() }
    this.activateHostility(); this.persistCasualties()
  }
  private get ranger(): NPC { return this.residents.find(r => r.spec.role === 'ranger')!.npc }
  private damageBuilding(index: number, amount: number): void {
    const b = this.world.buildings[index]; if (!b || b.hp.destroyed || amount <= 0 || !this.prepareDamage()) return
    b.hp.takeDamage(amount); this.world.refreshDamage(); this.navigation.sync(this.world.obstacles); this.activateHostility(); this.persistCasualties()
  }
  /** Write only deaths/destructions, never a per-hit log or a health snapshot. */
  private persistCasualties(): void {
    const current = this.profile.townEvent
    if (!current || current.state !== 'hostile') return
    const deadActorIds = [...this.event.actors].filter(([, actor]) => actor.dead).map(([id]) => id)
    const destroyedBuildingIds = this.world.buildings.filter(b => b.hp.destroyed).map(b => b.id)
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
      const targets = s.player ? [...this.residents.map(r => r.npc), this.cat] : [this.player]
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
    if (!this.inventory.meleeEnabled || !this.player.isHitFrame(this.inventory.equippedMelee)) return
    const weapon = this.inventory.equippedMelee, from = this.player.getWeaponGripPosition(new THREE.Vector3()), tip = this.player.getSwordTipPosition(), ray = new THREE.Ray(from, tip.clone().sub(from).normalize())
    // Buildings block melee before residents behind them.
    for (let i = 0; i < this.world.buildings.length; i++) {
      const b = this.world.buildings[i], box = this.world.obstacles.find(o => o.damageable === b.hp)?.box
      const p = box && ray.intersectBox(box.clone().expandByScalar(.25), new THREE.Vector3())
      if (p && p.distanceTo(from) <= from.distanceTo(tip) + .3) { this.player.markHitProcessed(); this.damageBuilding(i, weapon.damageMax); return }
    }
    if (this.world.targets.some(p => p.distanceTo(tip) < .8)) { this.player.markHitProcessed(); return }
    for (const target of [...this.residents.map(r => r.npc), this.cat]) {
      if (target.dead) continue
      const center = target instanceof NPC ? target.combatPosition.clone() : target.group.position.clone(); center.y += 1
      if (tip.distanceTo(center) < Math.max(.8, (weapon.range ?? 1.8) * .6)) { this.player.markHitProcessed(); this.hitResident(target, weapon.damageMax); return }
    }
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
      npc.group.rotation.y = Math.atan2(Math.cos(angle), -Math.sin(angle)); npc.group.position.set(x, getTerrainHeight(x, z), z)
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
    this.hint.textContent = this.target ? 'E 與 ' + NAMES[this.target] + ' 交談' : this.event.hostile ? '全鎮追擊中' : this.inventory.meleeEnabled || this.inventory.rangedEnabled ? '已武裝 · Tab 管理裝備' : '已收起武裝 · Tab 開啟裝備'
  }
  private finish(result: TownResult): void {
    this.result = result
    const next = settleTown(this.profile, this.profile.townEvent!.id, result)
    if (!this.commit(next)) { const p = this.openPanel('結算尚未保存', '保存失敗；尚未扣款或轉場。'); this.button(p, '重試保存', () => this.finish(result)); return }
    const panel = this.openPanel(result === 'player_defeated' ? '你已戰敗' : '小鎮已擊敗', result === 'player_defeated' ? '實際扣除 ' + next.townEvent!.penalty + ' 可用軍功，餘額 ' + next.availableMerit : '轉投 ' + next.faction + '，軍階 Recruit。本次入伍軍功歸零；歷史軍功與收藏保留。')
    this.button(panel, '進入和平小鎮', () => { this.dispose(); this.onRestart(next) })
  }
  private frame(time: number): void {
    if (this.disposed) return
    const dt = Math.min(.05, (time - this.last) / 1000); this.last = time
    if (!this.panel && !this.equipment.visible && !this.result) {
      this.elapsed += dt
      this.player.update(dt, this.input, this.orbit.cameraYaw, this.orbit.getAimPoint(new THREE.Vector3()), this.world.obstacles, this.stamina, this.quiver, sound, this.inventory)
      this.melee()
      if (this.event.hostile) this.updateHostile(dt); else for (const r of this.residents) this.updatePeace(r, dt)
      for (const m of this.mounts) { m.setCameraDistance(m.group.position.distanceTo(this.camera.position)); if (m.dead) m.update(dt, this.world.obstacles) }
      if (!this.event.hostile) { this.cat.beginControlledFrame(); this.cat.finishControlledFrame(dt, this.world.obstacles) }
      this.updateShots(dt); this.orbit.update(this.input, dt); this.interaction()
      const outcome = this.event.evaluate(this.player.dead); if (outcome && !this.panel) this.finish(outcome)
    }
    this.hud.textContent = this.profile.faction.toUpperCase() + ' · ' + this.profile.rank + '\n歷史軍功 ' + this.profile.totalMerit + ' · 可用 ' + this.profile.availableMerit + ' · 本次入伍 ' + enlistmentMerit(this.profile) + '\n' + (this.event.hostile ? '追擊者剩餘 ' + [...this.event.actors.values()].filter(a => !a.dead).length + ' / 85' : '和平小鎮 · 60 駐軍 / 20 路人 / 5 功能角色') + (this.notice ? '\n' + this.notice : '')
    document.getElementById('quiver-hud')!.style.display = this.inventory.rangedEnabled ? '' : 'none'
    this.hud.style.whiteSpace = 'pre-line'; this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(t => this.frame(t))
  }
  dispose(): void {
    if (this.disposed) return
    document.getElementById('controls-hint')!.textContent = this.previousControls
    document.getElementById('quiver-hud')!.style.display = ''
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.abort(); this.input.dispose(); this.panel?.remove(); this.equipment.close(); this.hud.remove(); this.hint.remove(); this.player.dispose(); this.residents.forEach(r => r.npc.dispose()); this.mounts.forEach(m => m.dispose()); this.shots.forEach(s => s.arrow.destroy()); this.world.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); document.exitPointerLock?.()
  }
}
