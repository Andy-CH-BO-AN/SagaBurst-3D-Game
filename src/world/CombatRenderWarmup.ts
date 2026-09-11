import * as THREE from 'three'
import { HumanoidAssetRegistry } from './HumanoidAssetRegistry'
import { prewarmProjectileVisuals, createProjectileWarmupGroup } from './ArrowProjectile'
import { CharacterBowVisual } from './CharacterBowVisual'
import { createVikingHornAccessory } from './HumanoidAssetRegistry'
import { WeaponMeshFactory } from './WeaponMeshFactory'
import { Faction } from './NPC'

export class CombatRenderWarmup {
  private static warmed = false

  static isWarmed(): boolean {
    return this.warmed
  }

  /**
   * Test-only seam to reset warmup status across isolated test suites.
   */
  static _resetForTesting(): void {
    this.warmed = false
  }

  /**
   * Performs an offscreen GPU warmup pass using a dedicated 16x16 WebGLRenderTarget.
   * Compiles all shaders and forces GPU texture/geometry uploads for:
   * - Humanoid Viking & Roman LOD0, LOD1, LOD2
   * - Viking horn accessory
   * - Bow body, bow string, and nocked arrow visuals (viking & elven)
   * - Arrow and Pilum projectile visuals & procedural materials
   */
  static warmup(renderer: THREE.WebGLRenderer, _gameCamera: THREE.Camera, gameScene: THREE.Scene): void {
    if (this.warmed) return

    // 1. Ensure CPU projectile visuals are prewarmed
    prewarmProjectileVisuals()

    // 2. Build isolated warmup scene
    const warmupScene = new THREE.Scene()
    warmupScene.name = 'combat-warmup-scene'

    let renderTarget: THREE.WebGLRenderTarget | null = null
    let prevTarget: THREE.WebGLRenderTarget | null | undefined = undefined

    try {
      // Match game lighting and shadows so shaders compile with shadow map passes
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
      dirLight.position.set(20, 40, 20)
      dirLight.castShadow = true
      dirLight.shadow.mapSize.width = 512
      dirLight.shadow.mapSize.height = 512
      warmupScene.add(dirLight)
      const ambLight = new THREE.AmbientLight(0xffffff, 0.6)
      warmupScene.add(ambLight)

      // Projectile visuals
      const projectileGroup = createProjectileWarmupGroup()
      warmupScene.add(projectileGroup)

      // Bow visuals: viking_bow and elven_runebow
      const vikingBowGroup = new THREE.Group()
      const vikingBowVisual = new CharacterBowVisual(vikingBowGroup, vikingBowGroup)
      vikingBowVisual.rebuild('viking_bow')
      warmupScene.add(vikingBowGroup)

      const elvenBowGroup = new THREE.Group()
      const elvenBowVisual = new CharacterBowVisual(elvenBowGroup, elvenBowGroup)
      elvenBowVisual.rebuild('elven_runebow')
      warmupScene.add(elvenBowGroup)

      // Representative melee weapons & shields
      const weaponGroup = new THREE.Group()
      WeaponMeshFactory.buildNpcMelee(Faction.ENEMY, 2, false, weaponGroup)
      WeaponMeshFactory.buildNpcMelee(Faction.PLAYER, 2, false, weaponGroup)
      WeaponMeshFactory.buildShield('shield_round_iron', weaponGroup)
      WeaponMeshFactory.buildShield('shield_scutum_iron', weaponGroup)
      warmupScene.add(weaponGroup)

      // Viking Horn accessory
      const hornAccessory = createVikingHornAccessory()
      warmupScene.add(hornAccessory)

      // Humanoid LOD levels (Viking & Roman, LOD0/1/2) via isolated representative clones
      // Note: Canonical registry templates are NEVER added to warmupScene or mutated.
      if (HumanoidAssetRegistry.ready) {
        const humanoidWarmupGroup = HumanoidAssetRegistry.createWarmupGroup()
        warmupScene.add(humanoidWarmupGroup)
      }

      // Ensure all warmup-specific meshes in warmupScene have shadows enabled for shader compilation
      warmupScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true
          object.receiveShadow = true
        }
      })

      // 3. Setup offscreen camera and render target
      const warmupCam = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
      warmupCam.position.set(0, 1, 3)
      warmupCam.lookAt(0, 1, 0)

      // Step A: Explicit WebGLRenderer compile pass
      renderer.compile(warmupScene, warmupCam, gameScene)

      // Step B: Offscreen render pass to force buffer & texture uploads to GPU
      renderTarget = new THREE.WebGLRenderTarget(16, 16)
      prevTarget = renderer.getRenderTarget()
      renderer.setRenderTarget(renderTarget)
      renderer.render(warmupScene, warmupCam)

      // 4. Mark warmed ONLY upon successful completion of compile + render pass
      this.warmed = true
    } catch (error) {
      if (import.meta.env?.DEV) {
        console.warn('CombatRenderWarmup failed:', error)
      }
    } finally {
      // Guaranteed cleanup: restore previous render target (even when null for default framebuffer),
      // dispose temporary target, and clear scene
      if (prevTarget !== undefined && renderer) {
        try {
          renderer.setRenderTarget(prevTarget)
        } catch {
          // ignore cleanup errors during error teardown
        }
      }
      if (renderTarget) {
        renderTarget.dispose()
      }
      warmupScene.clear()
    }
  }
}
