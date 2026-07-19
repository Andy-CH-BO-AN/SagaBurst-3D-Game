/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { createSky } from './world/Sky'
import { createTerrain, EntityCollisionBody, ObstacleData, resolveEntityCollision } from './world/Terrain'
import { Player } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { SaveManager } from './save/SaveManager'
import { StaminaBar } from './ui/StaminaBar'
import { HpBar } from './ui/HpBar'
import { DummyEnemy } from './world/DummyEnemy'
import { NPC, Faction, AIType } from './world/NPC'
import { SpatialGrid } from './world/SpatialGrid'
import { ArrowProjectile } from './world/ArrowProjectile'
import { Mount, MountType, MountState } from './world/Mount'
import { DamageNumbers } from './ui/DamageNumbers'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { CompassUI } from './ui/CompassUI'
import { EquipmentUI } from './ui/EquipmentUI'
import { SoundManager } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import { WeaponPickup } from './world/WeaponPickup'
import { damageNpc, damagePlayer } from './combat/DamageRouter'

export class Game {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private camera: THREE.PerspectiveCamera
  private clock: THREE.Clock

  private input: PlayerInput
  private player: Player
  private thirdPersonCamera: ThirdPersonCamera

  private dummyEnemy: DummyEnemy
  private npcs: NPC[] = []
  private damageNumbers: DamageNumbers
  private arrows: ArrowProjectile[] = []
  private pickups: WeaponPickup[] = []
  private mounts: Mount[] = []

  private obstacles: ObstacleData[] = []
  private saveManager: SaveManager
  private staminaBar: StaminaBar
  private hpBar: HpBar
  private quiverUI: QuiverUI
  private skillManager: SkillManager
  private compassUI: CompassUI
  private equipmentUI: EquipmentUI
  private soundManager: SoundManager
  private inventoryManager: InventoryManager

  // Enemy HUD elements
  private enemyHud: HTMLElement
  private enemyNameEl: HTMLElement
  private enemyHpFill: HTMLElement
  private enemyHudTimer: number | null = null

  private mountHud: HTMLElement
  private mountNameEl: HTMLElement
  private mountHpFill: HTMLElement

  private pickupPromptEl: HTMLElement
  // @ts-ignore
  private activeNearbyPickup: WeaponPickup | null = null

  private lockOverlay: HTMLElement
  private controlsHint: HTMLElement
  private saveNotify: HTMLElement
  private hintTimer: number | null = null
  private notifyTimer: number | null = null

  // ── Reusable temporary vectors (P-1: avoid per-frame GC pressure) ──
  private readonly _tmpCameraDir = new THREE.Vector3()

  private readonly _tmpHitPos = new THREE.Vector3()

  // LOD & Spatial Partitioning
  private npcGrid = new SpatialGrid<NPC>(20)

  constructor(container: HTMLElement) {
    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    // ── Scene ──
    this.scene = new THREE.Scene()

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(
      70, window.innerWidth / window.innerHeight, 0.1, 500
    )

    // ── Clock ──
    this.clock = new THREE.Clock()

    // ── Audio ──
    this.soundManager = new SoundManager()

    // ── World ──
    createSky(this.scene)
    const { obstacles } = createTerrain(this.scene)
    this.obstacles = obstacles

    // ── Player & Input ──
    this.input = new PlayerInput()
    this.player = new Player(this.scene)

    // ── Camera controller ──
    this.thirdPersonCamera = new ThirdPersonCamera(this.camera, this.player)

    // ── Combat & Enemies ──
    this.dummyEnemy = new DummyEnemy(this.scene, 0, -6)
    
    // @ts-ignore: Intentionally unused for testing
    const isSpawnValid = (x: number, z: number) => {
      for (const obs of this.obstacles) {
        if (x > obs.box.min.x - 2 && x < obs.box.max.x + 2 &&
            z > obs.box.min.z - 2 && z < obs.box.max.z + 2) {
          return false
        }
      }
      return true
    }

    // ── Spawn Test NPCs ──
    for (let i = 0; i < 3; i++) {
      let px = 0, pz = 0
      let attempts = 0
      do {
        px = -5 - Math.random() * 20
        pz = -5 - Math.random() * 20
        attempts++
      } while (!isSpawnValid(px, pz) && attempts < 50)
      
      const isArcher = Math.random() < 0.5
      const tier = (i + 1) as 1 | 2 | 3
      const name = isArcher ? `維京射手 Viking Archer T${tier}` : `維京步兵 Viking Infantry T${tier}`
      const isMounted = Math.random() < 0.5
      this._spawnNpc(px, pz, Faction.PLAYER, isArcher ? AIType.RANGED : AIType.MELEE, name, tier, isMounted)
    }

    for (let i = 0; i < 3; i++) {
      let px = 0, pz = 0
      let attempts = 0
      do {
        px = 5 + Math.random() * 20
        pz = 5 + Math.random() * 20
        attempts++
      } while (!isSpawnValid(px, pz) && attempts < 50)

      const isArcher = Math.random() < 0.5
      const tier = (i + 1) as 1 | 2 | 3
      const name = isArcher ? `羅馬射手 Roman Archer T${tier}` : `羅馬步兵 Roman Infantry T${tier}`
      const isMounted = Math.random() < 0.5
      this._spawnNpc(px, pz, Faction.ENEMY, isArcher ? AIType.RANGED : AIType.MELEE, name, tier, isMounted)
    }
    
    this.damageNumbers = new DamageNumbers()

    // ── RPG Systems & Inventory ──
    this.staminaBar       = new StaminaBar()
    this.hpBar            = new HpBar()
    this.quiverUI         = new QuiverUI()
    this.skillManager     = new SkillManager()
    this.compassUI        = new CompassUI()
    this.equipmentUI      = new EquipmentUI()
    this.inventoryManager = new InventoryManager()

    this.lockOverlay    = document.getElementById('lock-overlay')!
    this.controlsHint   = document.getElementById('controls-hint')!
    this.saveNotify     = document.getElementById('save-notify')!
    this.pickupPromptEl = document.getElementById('pickup-prompt')!

    this.enemyHud    = document.getElementById('enemy-hud')!
    this.enemyNameEl = document.getElementById('enemy-name')!
    this.enemyHpFill = document.getElementById('enemy-hp-fill')!

    this.mountHud    = document.getElementById('mount-hud')!
    this.mountNameEl = document.getElementById('mount-name')!
    this.mountHpFill = document.getElementById('mount-hp-fill')!

    // ── Save Manager ──
    this.saveManager = new SaveManager()

    // ── Spawn World Pickups & Mounts ──
    this._spawnWorldPickups()
    this._spawnMounts()

    // Listen for arrow fire from Player
    this.player.onFireArrow = (evt) => {
      const arrow = new ArrowProjectile(
        this.scene,
        evt.origin,
        evt.direction,
        evt.speed,
        evt.damage,
        Faction.PLAYER,
        true
      )
      this.arrows.push(arrow)
      this.quiverUI.setArrowCount(this.player.arrowCount)
    }

    // Player Death notify
    this.player.onPlayerDeath = () => {
      this._showNotify('💀 你陣亡了！正在原點重置...')
    }

    this._setupPointerLock()
    this._setupResize()
    this._setupShortcuts()

    // Initialise bars
    this.hpBar.setFill(this.player.hpRatio)
    this.staminaBar.setFill(1)
    this.quiverUI.setArrowCount(this.player.arrowCount)

    this._loop()
  }

  private _spawnWorldPickups(): void {
    const weaponTypes = [
      'rusty_dagger',
      'steel_sword',
      'steel_lance',
      'runic_greatsword',
      'wooden_shortbow',
      'recurve_longbow',
      'elven_runebow',
      'scutum_t1',
      'scutum_t2',
      'scutum_t3',
      'round_shield_t1',
      'round_shield_t2',
      'round_shield_t3',
    ]

    // Spawn 30 weapon pickups in a golden spiral pattern around spawn
    for (let i = 0; i < 30; i++) {
      const wId = weaponTypes[i % weaponTypes.length]
      const angle = i * 0.45
      const dist  = 6 + i * 1.3
      const px = Math.cos(angle) * dist
      const pz = Math.sin(angle) * dist
      this.pickups.push(new WeaponPickup(this.scene, wId, px, pz))
    }

    // Spawn 4 Arrow Supply Packs
    this.pickups.push(new WeaponPickup(this.scene, '', 3, -3, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', -5, -4, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', 12, 10, true, 15))
    this.pickups.push(new WeaponPickup(this.scene, '', -12, 10, true, 15))
  }

  private _spawnMounts(): void {
    // 2 Cats, 2 Corgis
    this.mounts.push(new Mount(this.scene, MountType.BLACK_CAT, 10, -5))
    this.mounts.push(new Mount(this.scene, MountType.BLACK_CAT, -15, 20))
    this.mounts.push(new Mount(this.scene, MountType.CORGI, 15, 15))
    this.mounts.push(new Mount(this.scene, MountType.CORGI, -20, -10))
  }

  // @ts-ignore: Intentionally unused for testing
  private _spawnNpc(
    x: number,
    z: number,
    faction: Faction,
    aiType: AIType,
    name: string,
    tier: 1 | 2 | 3,
    cavalry?: boolean,
  ): void {
    const npc = new NPC(this.scene, x, z, faction, aiType, name, tier, cavalry)
    this.npcs.push(npc)
    if (npc.mount) this.mounts.push(npc.mount)
  }

  // ── Pointer Lock ──
  private _setupPointerLock(): void {
    if (window.location.search.includes('nolock')) {
      this.lockOverlay.style.display = 'none'
    }
    this.lockOverlay.addEventListener('click', () => {
      if (!this.equipmentUI?.visible) {
        this.input.requestPointerLock()
      }
    })
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement || window.location.search.includes('nolock')) {
        this.lockOverlay.style.display = 'none'
        this.lockOverlay.classList.add('hidden')
        this._scheduleHintHide()
      } else {
        if (!this.equipmentUI?.visible) {
          this.lockOverlay.style.display = 'flex'
          this.lockOverlay.classList.remove('hidden')
        }
        this.controlsHint.classList.remove('hidden')
        if (this.hintTimer !== null) clearTimeout(this.hintTimer)
      }
    })
  }

  private _scheduleHintHide(): void {
    if (this.hintTimer !== null) clearTimeout(this.hintTimer)
    this.hintTimer = window.setTimeout(() => {
      this.controlsHint.classList.add('hidden')
    }, 5000)
  }

  // ── Keyboard Shortcuts & Top-Left Menu ──
  private _setupShortcuts(): void {
    const gameMenu = document.getElementById('game-menu')
    const menuBtn  = document.getElementById('menu-btn')
    const menuSave = document.getElementById('menu-save')
    const menuLoad = document.getElementById('menu-load')
    const menuInv  = document.getElementById('menu-inventory')

    if (gameMenu) {
      gameMenu.addEventListener('mousedown', (e) => {
        e.stopPropagation() // Stop lock-overlay mousedown handler from triggering pointer lock
      })
      gameMenu.addEventListener('click', (e) => {
        e.stopPropagation() // Stop lock-overlay click handler from triggering pointer lock
      })
      gameMenu.addEventListener('mouseenter', () => {
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      })
    }

    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.toggle('open')
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      })
    }

    if (menuSave) {
      menuSave.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this._saveGame()
      })
    }

    if (menuLoad) {
      menuLoad.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this._loadGame()
      })
    }

    if (menuInv) {
      menuInv.addEventListener('click', (e) => {
        e.stopPropagation()
        if (gameMenu) gameMenu.classList.remove('open')
        this.equipmentUI.toggle(this.skillManager, this.inventoryManager)
      })
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Digit0' || e.code === 'Numpad0' || e.code === 'Key0') {
        e.preventDefault()
        if (gameMenu) {
          gameMenu.classList.toggle('open')
          if (gameMenu.classList.contains('open') && document.pointerLockElement) {
            document.exitPointerLock()
          }
        }
      }

      if (e.code === 'Tab' || e.code === 'KeyI') {
        e.preventDefault()
        this.equipmentUI.toggle(this.skillManager, this.inventoryManager, () => {
          this._showNotify(`⚔️ 已裝備：${this.inventoryManager.equippedMelee.name}`)
        })
        if (this.equipmentUI.visible) {
          if (document.pointerLockElement) {
            document.exitPointerLock()
          }
        } else {
          this.input.requestPointerLock()
        }
      }
      if (e.code === 'Escape') {
        if (gameMenu) gameMenu.classList.remove('open')
        if (this.equipmentUI.visible) {
          e.preventDefault()
          this.equipmentUI.close()
          this.input.requestPointerLock()
        }
      }
    })
  }

  private _saveGame(): void {
    const pos = this.player.position
    const skills = this.skillManager.skillState
    const inv = this.inventoryManager.saveState

    const ok = this.saveManager.save({
      position: { x: pos.x, y: pos.y, z: pos.z },
      hp: this.player.hp,
      stamina: this.player.staminaValue,
      arrows: this.player.arrowCount,
      skills: {
        oneHanded: skills.oneHanded,
        archery: skills.archery,
      },
      inventory: inv,
      mountData: this.player.isMounted && this.player.currentMount ? {
        isMounted: true,
        type: this.player.currentMount.type
      } : undefined
    })
    this._showNotify(ok ? '💾 遊戲已存檔（含背包裝備）' : '❌ 存檔失敗')
  }

  private _loadGame(): void {
    if (!this.saveManager.hasSave()) {
      this._showNotify('⚠️ 沒有存檔')
      return
    }
    const data = this.saveManager.load()
    this.player.setPosition(data.position.x, data.position.y, data.position.z)
    this.player.setStamina(data.stamina)
    this.player.setHp(data.hp ?? 100)
    this.player.setArrowCount(data.arrows ?? 30)

    if (data.skills) {
      this.skillManager.setSkillState(data.skills)
    }
    if (data.inventory) {
      this.inventoryManager.loadSaveState(data.inventory)
    }

    if (data.mountData && data.mountData.isMounted) {
      // Create mount for player at load position
      const m = new Mount(this.scene, data.mountData.type as MountType, data.position.x, data.position.z)
      this.mounts.push(m)
      this.player.isMounted = true
      this.player.currentMount = m
      m.state = MountState.CONTROLLED
      this.mountNameEl.textContent = `坐騎：${m.displayName}`
      this.mountHpFill.style.width = `${Math.max(0, (m.currentHp / m.maxHp) * 100)}%`
      this.mountHud.classList.add('visible')
    }

    this.staminaBar.setFill(data.stamina / 100)
    this.hpBar.setFill(this.player.hpRatio)
    this.quiverUI.setArrowCount(this.player.arrowCount)

    this._showNotify('📂 讀檔成功（還原背包與裝備）')
  }

  private _showNotify(msg: string): void {
    this.saveNotify.textContent = msg
    this.saveNotify.classList.add('visible')
    if (this.notifyTimer !== null) clearTimeout(this.notifyTimer)
    this.notifyTimer = window.setTimeout(() => {
      this.saveNotify.classList.remove('visible')
    }, 2000)
  }

  // ── Enemy HUD UI update ──
  private _showEnemyHud(name: string, ratio: number): void {
    this.enemyNameEl.textContent = name
    this.enemyHpFill.style.width = `${Math.max(0, ratio * 100)}%`

    this.enemyHud.classList.add('visible')
    if (this.enemyHudTimer !== null) clearTimeout(this.enemyHudTimer)
    this.enemyHudTimer = window.setTimeout(() => {
      this.enemyHud.classList.remove('visible')
    }, 4000)
  }

  // ── Shared: Lance Charge Bonus (C-5) ──
  /** Returns the final damage after applying lance charge multiplier.
   *  Also sets skipImpactThisFrame on the player's mount if charging. */
  private _applyLanceChargeBonus(isLance: boolean, baseDamage: number): number {
    if (!isLance) return baseDamage
    const mount = this.player.isMounted ? this.player.currentMount : null
    if (mount && mount.movementSpeed > 10) {
      mount.skipImpactThisFrame = true
      return baseDamage * 3.0
    }
    return baseDamage
  }

  // ── Melee Combat Hit Detection (Player Sword -> Enemies) ──
  private _checkPlayerMeleeHits(): void {
    const equippedMelee = this.inventoryManager.equippedMelee
    if (!this.player.isHitFrame(equippedMelee)) return

    const swordTipPos = this.player.getSwordTipPosition()
    const MELEE_HIT_THRESHOLD = equippedMelee.range || 1.85
    let baseDamage = equippedMelee.damageMax
    
    // Lance Charge Bonus
    baseDamage = this._applyLanceChargeBonus(equippedMelee.isLance === true, baseDamage)

    const damage = Math.round(baseDamage * this.skillManager.getOneHandedMultiplier())

    // Check Dummy Enemy
    if (!this.dummyEnemy.dead) {
      const dummyCenter = this.dummyEnemy.position.clone()
      dummyCenter.y += 1.0
      if (swordTipPos.distanceTo(dummyCenter) <= MELEE_HIT_THRESHOLD) {
        this.player.markHitProcessed()
        if (this.dummyEnemy.takeDamage(damage)) {
          this.soundManager.playHit()
          this.damageNumbers.spawn(damage, dummyCenter)
          this._showEnemyHud('訓練假人 Dummy Target', this.dummyEnemy.hpRatio)
          this.skillManager.addXp('oneHanded', 35, this.soundManager)
        }
        return
      }
    }

    // Check NPCs (Only hit Faction.ENEMY)
    for (const npc of this.npcs) {
      if (!npc.dead && npc.faction === Faction.ENEMY) {
        const aiCenter = npc.combatPosition.clone()
        aiCenter.y += 1.0
        if (swordTipPos.distanceTo(aiCenter) <= MELEE_HIT_THRESHOLD) {
          this.player.markHitProcessed()
          const result = damageNpc(npc, damage)
          if (result.hitSuccess) {
            this.soundManager.playHit()
            this.damageNumbers.spawn(damage, aiCenter)
            this._showEnemyHud(result.targetName, result.hpRatio)
            this.skillManager.addXp('oneHanded', 45, this.soundManager)
          }
          return
        }
      }
    }
  }

  // ── World Pickup & Mount Interaction ──
  private _updateInteractions(dt: number): void {
    // Update Mounts
    for (const mount of this.mounts) {
      mount.update(dt, this.obstacles)
    }

    const isEPressed = this.input.consumeKeyE()

    if (this.player.isMounted && this.player.currentMount) {
      // Handle Dismount
      this.pickupPromptEl.textContent = `[E] 下騎`
      this.pickupPromptEl.classList.add('visible')

      if (isEPressed) {
        this.player.isMounted = false
        this.player.currentMount.state = MountState.IDLE
        this.player.currentMount = null
        this.soundManager.playHit() // Placeholder sound
        this.pickupPromptEl.classList.remove('visible')
        this.mountHud.classList.remove('visible')
      }
      return // Skip pickups while mounted
    }

    let closestPickup: WeaponPickup | null = null
    let closestMount: Mount | null = null
    let closestDist = 2.5

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i]
      pickup.update(dt)

      const dist = this.player.position.distanceTo(pickup.position)
      if (dist < closestDist) {
        closestPickup = pickup
        closestMount = null
        closestDist = dist
      }
    }

    for (const mount of this.mounts) {
      if (!mount.availableForPlayer) continue
      const dist = this.player.position.distanceTo(mount.group.position)
      if (dist < closestDist) {
        closestMount = mount
        closestPickup = null
        closestDist = dist
      }
    }

    if (closestPickup) {
      this.pickupPromptEl.textContent = `[E] 拾取：${closestPickup.name}`
      this.pickupPromptEl.classList.add('visible')
    } else if (closestMount) {
      this.pickupPromptEl.textContent = `[E] 騎乘：${closestMount.displayName}`
      this.pickupPromptEl.classList.add('visible')
    } else {
      this.pickupPromptEl.classList.remove('visible')
    }

    // Check if E key was pressed to pick up or mount
    if (isEPressed) {
      if (closestPickup) {
        if (closestPickup.isArrowPack) {
          this.player.setArrowCount(this.player.arrowCount + closestPickup.arrowQuantity)
          this.quiverUI.setArrowCount(this.player.arrowCount)
          this._showNotify(`🏹 拾取：箭矢 x${closestPickup.arrowQuantity}`)
        } else {
          const count = this.inventoryManager.addWeapon(closestPickup.weaponId)
          this._showNotify(`🎒 拾取：${closestPickup.name} (數量: x${count})`)
        }
        this.soundManager.playHit()
        closestPickup.destroy()
        
        const idx = this.pickups.indexOf(closestPickup)
        if (idx !== -1) this.pickups.splice(idx, 1)

      } else if (closestMount) {
        this.player.isMounted = true
        this.player.currentMount = closestMount
        closestMount.state = MountState.CONTROLLED
        
        // Show mount HUD
        this.mountNameEl.textContent = `坐騎：${closestMount.displayName}`
        this.mountHpFill.style.width = `${Math.max(0, (closestMount.currentHp / closestMount.maxHp) * 100)}%`
        this.mountHud.classList.add('visible')
        this.soundManager.playHit()
      }
      this.pickupPromptEl.classList.remove('visible')
    }
  }

  /** Prevent living people, NPCs, and mounts from occupying the same space. */
  private _resolveEntityCollisions(): void {
    const bodies: EntityCollisionBody[] = []
    const controlledMount = this.player.isMounted ? this.player.currentMount : null

    if (controlledMount) {
      bodies.push({
        position: controlledMount.group.position,
        radius: 1.0,
        height: 2.6,
        bottomOffset: 0,
        anchored: true,
      })
    } else {
      bodies.push({
        position: this.player.position,
        radius: 0.38,
        height: 1.9,
        bottomOffset: 0.95,
      })
    }

    for (const npc of this.npcs) {
      if (npc.dead) continue
      if (npc.isMounted) continue
      bodies.push({
        position: npc.position,
        radius: 0.5,
        height: 2.3,
        bottomOffset: 0,
      })
    }

    for (const mount of this.mounts) {
      if (mount === controlledMount) continue
      bodies.push({
        position: mount.group.position,
        radius: 1.0,
        height: 2.6,
        bottomOffset: 0,
      })
    }

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        resolveEntityCollision(bodies[i], bodies[j])
      }
    }
  }

  private _updateImpactDamage(now: number): void {
    const checkImpact = (mount: Mount, targetPos: THREE.Vector3, targetRadius: number): boolean => {
      if (mount.skipImpactThisFrame) return false
      const dx = mount.group.position.x - mount.previousPosition.x
      const dz = mount.group.position.z - mount.previousPosition.z
      const px = targetPos.x - mount.previousPosition.x
      const pz = targetPos.z - mount.previousPosition.z
      const lineLenSq = dx*dx + dz*dz
      if (lineLenSq < 0.0001) return false
      let t = (px * dx + pz * dz) / lineLenSq
      t = Math.max(0, Math.min(1, t))
      const closestX = mount.previousPosition.x + t * dx
      const closestZ = mount.previousPosition.z + t * dz
      const distSq = (closestX - targetPos.x) ** 2 + (closestZ - targetPos.z) ** 2
      return distSq <= (targetRadius + 1.0) ** 2
    }

    const applyImpactDamage = (mount: Mount, target: any, targetPos: THREE.Vector3, onHit: (damage: number) => void): void => {
      if (Math.abs(mount.group.position.y - targetPos.y) > 2.0) return
      if (mount.movementSpeed > 4 && mount.canImpact(target, now)) {
        const damage = Math.round(8 + mount.movementSpeed * 1.5 * (mount.isSprinting ? 1.5 : 1.0))
        onHit(damage)
      }
    }

    for (const mount of this.mounts) {
      if (mount.state !== MountState.CONTROLLED || mount.dead) continue
      
      if (mount === this.player.currentMount) {
        if (!this.dummyEnemy.dead && checkImpact(mount, this.dummyEnemy.position, 0.5)) {
          applyImpactDamage(mount, this.dummyEnemy, this.dummyEnemy.position, (damage) => {
            if (this.dummyEnemy.takeDamage(damage)) {
              this.soundManager.playHit()
              this._tmpHitPos.copy(this.dummyEnemy.position)
              this._tmpHitPos.y += 1.0
              this.damageNumbers.spawn(damage, this._tmpHitPos)
              this._showEnemyHud('訓練假人 Dummy Target', this.dummyEnemy.hpRatio)
            }
          })
        }
        for (const npc of this.npcs) {
          if (npc.dead || npc.faction !== Faction.ENEMY) continue
          if (checkImpact(mount, npc.combatPosition, 0.5)) {
            applyImpactDamage(mount, npc, npc.combatPosition, (damage) => {
              const result = damageNpc(npc, damage)
              if (result.hitSuccess) {
                this.soundManager.playHit()
                this._tmpHitPos.copy(npc.combatPosition)
                this._tmpHitPos.y += 1.0
                this.damageNumbers.spawn(damage, this._tmpHitPos)
                this._showEnemyHud(result.targetName, result.hpRatio)
              }
            })
          }
        }
      } else if (mount.riderFaction === Faction.ENEMY && !this.player.dead) {
        if (checkImpact(mount, this.player.position, 0.38)) {
          applyImpactDamage(mount, this.player, this.player.position, (damage) => {
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              this._tmpHitPos.copy(this.player.position)
              this._tmpHitPos.y += 1.0
              this.damageNumbers.spawn(damage, this._tmpHitPos)
              if (result.isMountHit) {
                this.mountHpFill.style.width = `${Math.max(0, result.hpRatio * 100)}%`
              } else {
                this.mountHud.classList.remove('visible')
              }
            }
          })
        }
      }
    }
  }

  // ── Resize ──
  private _setupResize(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  // ── Main loop ──
  private _loop = (): void => {
    requestAnimationFrame(this._loop)
    const dt = Math.min(this.clock.getDelta(), 0.05)

    this.camera.getWorldDirection(this._tmpCameraDir)
    const cameraDirection = this._tmpCameraDir

    // Update ThirdPersonCamera
    this.thirdPersonCamera.update(this.input, dt)

    // Update Compass direction bar
    this.compassUI.update(this.thirdPersonCamera.cameraYaw)

    // Update Player logic
    this.player.update(
      dt,
      this.input,
      this.thirdPersonCamera.cameraYaw,
      cameraDirection,
      this.obstacles,
      this.staminaBar,
      this.quiverUI,
      this.soundManager,
      this.inventoryManager,
      this.skillManager.getArcheryMultiplier()
    )

    // Update Dummy Enemy
    this.dummyEnemy.update(dt)

    // Update NPCs
    this.npcGrid.clear()
    for (const npc of this.npcs) {
      if (npc.hp > 0) this.npcGrid.insert(npc)
    }



    for (const npc of this.npcs) {
      if (npc.hp <= 0) {
        // Dead NPCs still need animation update, but no AI/Boids
        npc.update(dt, this.player, this.npcs, [], this.obstacles, this.hpBar, 
          () => {}, // dead npc can't hit
          () => {}, // dead npc can't shoot
          true // skipBoidsAndObstacles
        )
        continue
      }

      // No LOD tiers. Full update for everyone.
      const skipBoidsAndObstacles = false
      const nearbyNPCs = this.npcGrid.getNearby(npc.combatPosition, 40)

      npc.update(
        dt, 
        this.player,
        this.npcs,
        nearbyNPCs,
        this.obstacles,
        this.hpBar, 
        (damage, isPlayer, targetNpc) => {
          // Melee Hit Callback
          if (isPlayer) {
            const result = damagePlayer(this.player, damage, this.hpBar, this.inventoryManager.equippedShield?.id ?? null)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              const hitPos = this.player.position.clone()
              hitPos.y += 1.2
              this.damageNumbers.spawn(damage, hitPos)
              if (result.isMountHit) {
                this.mountHpFill.style.width = `${Math.max(0, result.hpRatio * 100)}%`
              } else {
                this.mountHud.classList.remove('visible')
              }
            }
          } else if (targetNpc) {
            const result = damageNpc(targetNpc, damage)
            if (result.hitSuccess) {
              this.soundManager.playHit()
              const hitPos = targetNpc.combatPosition.clone()
              hitPos.y += 1.2
              this.damageNumbers.spawn(damage, hitPos)
            }
          }
        },
        (origin, direction) => {
          // Ranged Fire Callback
          const arrow = new ArrowProjectile(
            this.scene,
            origin,
            direction,
            15.0, // Arrow speed
            npc.rangedDamage, // Arrow damage
            npc.faction
          )
          this.arrows.push(arrow)
          this.soundManager.playHit() // Should ideally be a bow string sound, using hit for now
        },
        skipBoidsAndObstacles
      )
    }

    // Check Player Melee Sword Hits
    this._checkPlayerMeleeHits()

    // Update Pickups & Mounts Interaction
    this._updateInteractions(dt)

    // Resolve all entity overlaps after every entity has moved this frame.
    this._resolveEntityCollisions()

    // Reset impact flag
    for (const mount of this.mounts) {
      mount.skipImpactThisFrame = false
    }

    // Update Arrow Projectiles
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.update(dt, this.dummyEnemy, this.player, this.npcs, this.obstacles, (damage, hitPos, targetName, hpRatio, isPlayer, _npc, isMountHit) => {
        this.soundManager.playHit()
        this.damageNumbers.spawn(damage, hitPos)
        if (!isPlayer && arrow.isPlayerFired) {
          this._showEnemyHud(targetName, hpRatio)
          this.skillManager.addXp('archery', 35, this.soundManager)
        }
        if (isPlayer && isMountHit) {
          if (this.player.isMounted && this.player.currentMount) {
            this.mountHpFill.style.width = `${Math.max(0, hpRatio * 100)}%`
          } else {
            this.mountHud.classList.remove('visible')
          }
        }
      })

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }

    // Process Impact Damage
    this._updateImpactDamage(this.clock.elapsedTime)

    // Update Floating Damage numbers
    this.damageNumbers.update(dt, this.camera)

    this.renderer.render(this.scene, this.camera)
  }
}
