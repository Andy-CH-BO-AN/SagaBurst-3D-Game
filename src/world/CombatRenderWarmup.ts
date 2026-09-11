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
   * Performs an offscreen GPU warmup pass using a dedicated 16x16 WebGLRenderTarget.
   * Compiles all shaders and forces GPU texture/geometry uploads for:
   * - Humanoid Viking & Roman LOD0, LOD1, LOD2
   * - Viking horn accessory
   * - Bow body, bow string, and nocked arrow visuals (viking & elven)
   * - Arrow and Pilum projectile visuals & procedural materials
   */
  static warmup(renderer: THREE.WebGLRenderer, _gameCamera: THREE.Camera, gameScene: THREE.Scene): void {
    if (this.warmed) return
    this.warmed = true

    // 1. Ensure CPU projectile visuals are prewarmed
    prewarmProjectileVisuals()

    // 2. Build isolated warmup scene
    const warmupScene = new THREE.Scene()
    warmupScene.name = 'combat-warmup-scene'

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

    // Humanoid LOD levels (Viking & Roman, LOD0/1/2)
    const attachedTemplateLevels: THREE.Group[] = []
    if (HumanoidAssetRegistry.ready) {
      HumanoidAssetRegistry.forEachLODLevel((levelScene, _faction, lodIndex) => {
        levelScene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.castShadow = lodIndex < 2
            object.receiveShadow = true
          }
        })
        warmupScene.add(levelScene)
        attachedTemplateLevels.push(levelScene)
      })
    }

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

    try {
      // Step A: Explicit WebGLRenderer compile pass
      renderer.compile(warmupScene, warmupCam, gameScene)

      // Step B: Offscreen render pass to force buffer & texture uploads to GPU
      const renderTarget = new THREE.WebGLRenderTarget(16, 16)
      const prevTarget = renderer.getRenderTarget()
      renderer.setRenderTarget(renderTarget)
      renderer.render(warmupScene, warmupCam)
      renderer.setRenderTarget(prevTarget)
      renderTarget.dispose()
    } catch {
      // Safe fallback for environments without full WebGL context (e.g. unit tests)
    } finally {
      // 4. Detach template scenes cleanly so they remain unpolluted
      for (const levelScene of attachedTemplateLevels) {
        warmupScene.remove(levelScene)
      }
      warmupScene.clear()
    }
  }
}
