/**
 * Game.ts
 * Main game class. Master orchestrator for Three.js scene, rendering, combat, AI, heightmap physics, sound, inventory, and weapon pickups.
 * Phase 7 & Phase 8: Inventory & Ground Pickup System + 3-Tier Weapon Scaling.
 */
import * as THREE from 'three'
import { createSky } from './world/Sky'
import { createTerrain } from './world/Terrain'
import { Player } from './player/Player'
import { PlayerInput } from './player/PlayerInput'
import { ThirdPersonCamera } from './camera/ThirdPersonCamera'
import { SaveManager } from './save/SaveManager'
import { StaminaBar } from './ui/StaminaBar'
import { HpBar } from './ui/HpBar'
import { DummyEnemy } from './world/DummyEnemy'
import { EnemyAI } from './world/EnemyAI'
import { DamageNumbers } from './ui/DamageNumbers'
import { ArrowProjectile } from './world/ArrowProjectile'
import { QuiverUI } from './ui/QuiverUI'
import { SkillManager } from './rpg/SkillManager'
import { CompassUI } from './ui/CompassUI'
import { EquipmentUI } from './ui/EquipmentUI'
import { SoundManager } from './audio/SoundManager'
import { InventoryManager } from './rpg/InventoryManager'
import { WeaponPickup } from './world/WeaponPickup'

export class Game {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private camera: THREE.PerspectiveCamera
  private clock: THREE.Clock

  private input: PlayerInput
  private player: Player
  private thirdPersonCamera: ThirdPersonCamera

  private dummyEnemy: DummyEnemy
  private enemyAI: EnemyAI
  private damageNumbers: DamageNumbers
  private arrows: ArrowProjectile[] = []
  private pickups: WeaponPickup[] = []

  private obstacles: THREE.Box3[] = []
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

  private pickupPromptEl: HTMLElement
  // @ts-ignore
  private activeNearbyPickup: WeaponPickup | null = null

  private lockOverlay: HTMLElement
  private controlsHint: HTMLElement
  private saveNotify: HTMLElement
  private hintTimer: number | null = null
  private notifyTimer: number | null = null

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
    this.enemyAI    = new EnemyAI(this.scene, 18, -18)
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

    // ── Save Manager ──
    this.saveManager = new SaveManager()

    // ── Spawn World Pickups ──
    this._spawnWorldPickups()

    // Listen for arrow fire from Player
    this.player.onFireArrow = (evt) => {
      const arrow = new ArrowProjectile(
        this.scene,
        evt.origin,
        evt.direction,
        evt.speed,
        evt.damage
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
      'runic_greatsword',
      'wooden_shortbow',
      'recurve_longbow',
      'elven_runebow',
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

  // ── Melee Combat Hit Detection (Player Sword -> Enemies) ──
  private _checkPlayerMeleeHits(): void {
    const equippedMelee = this.inventoryManager.equippedMelee
    if (!this.player.isHitFrame(equippedMelee)) return

    const swordTipPos = this.player.getSwordTipPosition()
    const MELEE_HIT_THRESHOLD = 1.85
    const baseDamage = equippedMelee.damageMax
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

    // Check Enemy AI (Bandit Warrior)
    if (!this.enemyAI.dead) {
      const aiCenter = this.enemyAI.position.clone()
      aiCenter.y += 1.0
      if (swordTipPos.distanceTo(aiCenter) <= MELEE_HIT_THRESHOLD) {
        this.player.markHitProcessed()
        if (this.enemyAI.takeDamage(damage)) {
          this.soundManager.playHit()
          this.damageNumbers.spawn(damage, aiCenter)
          this._showEnemyHud(this.enemyAI.name, this.enemyAI.hpRatio)
          this.skillManager.addXp('oneHanded', 45, this.soundManager)
        }
        return
      }
    }
  }

  // ── World Pickup Interaction ──
  private _updatePickups(dt: number): void {
    let closest: WeaponPickup | null = null
    let closestDist = 2.5

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i]
      pickup.update(dt)

      const dist = this.player.position.distanceTo(pickup.position)
      if (dist < closestDist) {
        closest = pickup
        closestDist = dist
      }
    }

    this.activeNearbyPickup = closest

    if (closest) {
      this.pickupPromptEl.textContent = `[E] 拾取：${closest.name}`
      this.pickupPromptEl.classList.add('visible')
    } else {
      this.pickupPromptEl.classList.remove('visible')
    }

    // Check if E key was pressed to pick up
    if (this.input.consumeKeyE() && closest) {
      if (closest.isArrowPack) {
        this.player.setArrowCount(this.player.arrowCount + closest.arrowQuantity)
        this.quiverUI.setArrowCount(this.player.arrowCount)
        this._showNotify(`🏹 拾取：箭矢 x${closest.arrowQuantity}`)
      } else {
        const count = this.inventoryManager.addWeapon(closest.weaponId)
        this._showNotify(`🎒 拾取：${closest.name} (數量: x${count})`)
      }
      this.soundManager.playHit()
      closest.destroy()

      const idx = this.pickups.indexOf(closest)
      if (idx !== -1) this.pickups.splice(idx, 1)

      this.activeNearbyPickup = null
      this.pickupPromptEl.classList.remove('visible')
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

    const cameraDirection = new THREE.Vector3()
    this.camera.getWorldDirection(cameraDirection)

    // Update ThirdPersonCamera
    this.thirdPersonCamera.update(this.input, dt)

    // Update Compass direction bar
    this.compassUI.update(this.thirdPersonCamera.cameraYaw)

    // Update World Pickups
    this._updatePickups(dt)

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

    // Update Enemy AI (Bandit Warrior) & handles damage to player
    this.enemyAI.update(dt, this.player, this.hpBar, (damage) => {
      this.player.takeDamage(damage, this.hpBar)
      this.soundManager.playHit()
      const hitPos = this.player.position.clone()
      hitPos.y += 1.2
      this.damageNumbers.spawn(damage, hitPos)
    })

    // Check Player Melee Sword Hits
    this._checkPlayerMeleeHits()

    // Update Arrow Projectiles
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i]
      arrow.update(dt, this.dummyEnemy, this.enemyAI, this.obstacles, (damage, hitPos, targetName, hpRatio) => {
        this.soundManager.playHit()
        this.damageNumbers.spawn(damage, hitPos)
        this._showEnemyHud(targetName, hpRatio)
        this.skillManager.addXp('archery', 35, this.soundManager)
      })

      if (!arrow.isAlive) {
        this.arrows.splice(i, 1)
      }
    }

    // Update Floating Damage numbers
    this.damageNumbers.update(dt, this.camera)

    this.renderer.render(this.scene, this.camera)
  }
}
