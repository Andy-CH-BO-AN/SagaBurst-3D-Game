import * as THREE from 'three'
import { createDuelArena, DUEL_ARENA_LABELS, parseDuelArenaPreviewQuery, type DuelArenaEnvironment, type DuelArenaId } from '../arena/DuelArena'
import { COLOSSEUM, COLOSSEUM_SECTION, colosseumPoint } from '../arena/ColosseumLayout'
import { VALHALLA } from '../arena/ValhallaLayout'
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera'
import { Player } from '../player/Player'
import { PlayerInput } from '../player/PlayerInput'
import { InventoryManager } from '../rpg/InventoryManager'
import { HpBar } from '../ui/HpBar'
import { StaminaBar } from '../ui/StaminaBar'
import { QuiverUI } from '../ui/QuiverUI'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { preloadHighTierEquipment } from '../world/HighTierEquipment'
import { Mount, MountType } from '../world/Mount'

const PLAYER_HALF_HEIGHT = 0.95

export interface DuelArenaPreviewSetup {
  readonly arena: DuelArenaId
  readonly faction: 'roman' | 'viking'
}

/**
 * `?duelarena=roman|valhalla[&faction=roman|viking]`. Unknown arenas return null so
 * the official entry flow continues untouched. The culture defaults to the arena's.
 */
export function resolveDuelArenaPreviewSetup(query: URLSearchParams): DuelArenaPreviewSetup | null {
  const arena = parseDuelArenaPreviewQuery(query.get('duelarena'))
  if (!arena) return null
  const requested = query.get('faction')
  const faction = requested === 'roman' || requested === 'viking' ? requested : arena === 'roman-colosseum' ? 'roman' : 'viking'
  return { arena, faction }
}

/**
 * DEV-only arena walk-through (`?duelarena=roman|valhalla&nolock`). Uses the
 * real Player movement, camera and collision. It never opens a Career store,
 * session launch state, Duel mission or the main menu.
 */
export async function launchDuelArenaPreview(container: HTMLElement, setup: DuelArenaPreviewSetup): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('Duel arena preview is DEV-only')
  const { arena: id, faction } = setup
  const panel = document.createElement('aside')
  panel.id = 'duel-arena-preview'
  panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10000;width:330px;background:#151a20e8;color:#eee;padding:14px;font:13px/1.55 system-ui;border-radius:8px'
  panel.textContent = `載入 ${DUEL_ARENA_LABELS[id]}、人物與戰馬…`
  document.body.append(panel)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = id === 'roman-colosseum' ? 1.08 : 1.2
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 900)
  let arena: DuelArenaEnvironment | undefined
  let player: Player | undefined
  let horse: Mount | undefined
  let input: PlayerInput | undefined
  let raf = 0
  let disposed = false
  const resize = (): void => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }
  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(raf)
    input?.dispose()
    horse?.dispose()
    player?.dispose()
    arena?.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    panel.remove()
    window.removeEventListener('resize', resize)
    window.removeEventListener('pagehide', cleanup)
    delete (window as unknown as { __duelArenaPreview?: unknown }).__duelArenaPreview
  }
  try {
    await Promise.all([HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer), preloadPaladinEquipment(), preloadHighTierEquipment()])
    // The arena installs the scene ground, bounds and fall rule before any actor is created.
    arena = createDuelArena(id, scene)
    const spawn = arena.spawns.player
    player = new Player(scene, faction)
    player.resetForScene(spawn.x, spawn.y + PLAYER_HALF_HEIGHT, spawn.z)
    player.faceDirection(Math.sin(spawn.yaw), Math.cos(spawn.yaw))
    const horseSpot = id === 'roman-colosseum' ? { x: 6, z: -12 } : { x: 5, z: -20 }
    horse = new Mount(scene, MountType.HORSE, horseSpot.x, horseSpot.z)
    horse.resetForScene(horseSpot.x, horseSpot.z, 0)
    horse.visualHold = true
    const inventory = new InventoryManager({ meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: null }, null, faction)
    input = new PlayerInput()
    const orbit = new ThirdPersonCamera(camera, player)
    orbit.setYaw(spawn.yaw + Math.PI)
    const hp = new HpBar(), stamina = new StaminaBar(), quiver = new QuiverUI()
    player.setDamageHud(hp)
    hp.setFill(1)
    const sound = { playBowRelease() {} }
    let deaths = 0
    let maxFeetY = 0
    let lastLanding = ''
    let wasGrounded = true
    let airborneApex = 0
    player.onPlayerDeath = () => { deaths++ }

    const respawn = (): void => {
      player!.dismountFromMount({ preserveWorldPosition: true })
      player!.resetForScene(spawn.x, spawn.y + PLAYER_HALF_HEIGHT, spawn.z)
      player!.refillCombatSupplies()
      hp.setFill(1)
      maxFeetY = 0
    }
    const teleport = (x: number, feetY: number, z: number): void => {
      player!.dismountFromMount({ preserveWorldPosition: true })
      player!.resetForScene(x, feetY + PLAYER_HALF_HEIGHT, z)
    }
    const galleryPoint = colosseumPoint(-Math.PI / 2, COLOSSEUM_SECTION.galleryEndD - 1.2)
    panel.innerHTML = `<strong>${DUEL_ARENA_LABELS[id]} · DEV 預覽</strong>
      <div>WASD 移動、Shift 衝刺、Space 跳、E 上下馬、左鍵攻擊、右鍵瞄準、移動滑鼠轉視角。</div>
      <div><a href="?duelarena=roman&nolock">羅馬競技場</a> · <a href="?duelarena=valhalla&nolock">維京英靈殿</a></div>
      <button id="arena-respawn">回到起點</button>
      ${id === 'roman-colosseum' ? '<button id="arena-gallery">傳送到頂層走道（QA）</button>' : ''}
      <pre id="arena-state" style="font:11px/1.45 monospace;white-space:pre-wrap;margin:8px 0 0"></pre>
      <small>不讀寫生涯存檔、不建立 Duel 任務；墜落傷害只在本場景啟用。</small>`
    panel.querySelector<HTMLButtonElement>('#arena-respawn')!.onclick = respawn
    const galleryButton = panel.querySelector<HTMLButtonElement>('#arena-gallery')
    if (galleryButton) galleryButton.onclick = () => teleport(galleryPoint.x, COLOSSEUM_SECTION.galleryY, galleryPoint.z)
    const state = panel.querySelector<HTMLElement>('#arena-state')!
    // QA-only fixed camera for exterior/overview inspection; null restores the player camera.
    let cameraOverride: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
    const setCamera = (position: [number, number, number] | null, target: [number, number, number] = [0, 0, 0]): void => {
      cameraOverride = position ? { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) } : null
    }
    // Static scene cost of the arena alone (excludes the player and horse).
    let arenaMeshes = 0, arenaTriangles = 0
    arena.root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      arenaMeshes++
      const geometry = node.geometry as THREE.BufferGeometry
      arenaTriangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3
    })
    const aimPoint = new THREE.Vector3()
    const frameInfo = { calls: 0, triangles: 0 }
    window.addEventListener('resize', resize)
    window.addEventListener('pagehide', cleanup)
    let last = performance.now(), statusElapsed = 0
    const simulate = (dt: number): void => {
      const p = player!, mount = horse!, keys = input!
      if (cameraOverride) {
        camera.position.copy(cameraOverride.position)
        camera.lookAt(cameraOverride.target)
      } else orbit.update(keys, dt, arena!.obstacles)
      if (keys.consumeKeyE()) {
        // A horse left mid-jump keeps falling; it is parked only once it has landed.
        if (p.isMounted) { p.dismountFromMount(); mount.visualHold = mount.onGround }
        else if (!p.dead && mount.group.position.distanceTo(p.position) < 3.2) { mount.visualHold = false; p.mountVehicle(mount) }
      }
      if (!p.dead) {
        p.update(dt, keys, orbit.cameraYaw, orbit.getAimPoint(aimPoint), arena!.obstacles, stamina, quiver, sound, inventory)
        // Ground boundary applies only to living bodies on support; falls always complete.
        if (!p.dead && p.isGrounded) {
          if (p.isMounted) { if (arena!.constrainGroundedBody(mount.group.position)) p.syncMountTransform() }
          else arena!.constrainGroundedBody(p.group.position)
        }
      } else {
        p.update(dt, keys, orbit.cameraYaw, orbit.getAimPoint(aimPoint), arena!.obstacles, stamina, quiver, sound, inventory, 1, false)
      }
      if (!p.isMounted) {
        mount.update(dt, arena!.obstacles)
        if (mount.onGround && !mount.dead) mount.visualHold = true
      }
      p.fitMountedSeat()
      arena!.update(dt)
      const feetY = p.position.y - PLAYER_HALF_HEIGHT
      maxFeetY = Math.max(maxFeetY, feetY)
      const grounded = p.isGrounded
      if (!grounded) airborneApex = wasGrounded ? feetY : Math.max(airborneApex, feetY)
      else if (!wasGrounded) lastLanding = `${(airborneApex - feetY).toFixed(2)}m → HP ${Math.round(p.hp)}`
      wasGrounded = grounded
    }
    /** QA: advance the same gameplay step at a fixed 60 Hz with held key codes (no rendering). */
    const advance = (seconds: number, held: string[] = []): void => {
      for (const code of held) input!.keys[code] = true
      try { for (let t = 0; t < seconds; t += 1 / 60) simulate(1 / 60) }
      finally { for (const code of held) input!.keys[code] = false }
    }
    Object.assign(window, { __duelArenaPreview: { arena, player, horse, camera, renderer, input, orbit, teleport, respawn, setCamera, advance,
      frameInfo, arenaCost: { meshes: arenaMeshes, triangles: Math.round(arenaTriangles) }, get deaths() { return deaths }, get lastLanding() { return lastLanding }, dispose: cleanup } })
    const frame = (time: number): void => {
      if (disposed) return
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, Math.max(0, (time - last) / 1000))
      last = time
      simulate(dt)
      renderer.render(scene, camera)
      frameInfo.calls = renderer.info.render.calls
      frameInfo.triangles = renderer.info.render.triangles
      statusElapsed += dt
      if (statusElapsed > 0.2) {
        statusElapsed = 0
        const bounds = id === 'roman-colosseum'
          ? `外牆外 ${COLOSSEUM.apron}m 地面邊界；頂層走道高 ${COLOSSEUM_SECTION.galleryY.toFixed(1)}m`
          : `室內 ${VALHALLA.halfWidth * 2}×${VALHALLA.backZ - VALHALLA.frontZ}m`
        const p = player!, grounded = p.isGrounded, feetY = p.position.y - PLAYER_HALF_HEIGHT
        state.textContent = [
          `位置 ${p.position.x.toFixed(1)}, ${feetY.toFixed(2)}, ${p.position.z.toFixed(1)}`,
          `HP ${Math.round(p.hp)} / ${Math.round(p.maxHp)}${p.dead ? ' · 陣亡' : ''}${p.isMounted ? ' · 騎乘' : ''}${grounded ? '' : ' · 空中'}`,
          `最高腳底 ${maxFeetY.toFixed(1)}m · 上次落地 ${lastLanding || '—'}`,
          `死亡次數 ${deaths}`,
          `場景 ${arenaMeshes} meshes · ${Math.round(arenaTriangles).toLocaleString()} 三角面（不含人物／馬）`,
          `本幀 draw calls ${frameInfo.calls} · 三角面 ${frameInfo.triangles.toLocaleString()}`,
          bounds,
        ].join('\n')
      }
    }
    raf = requestAnimationFrame(frame)
  } catch (error) {
    cleanup()
    throw error
  }
}
