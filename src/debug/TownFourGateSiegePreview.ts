import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TownWorld } from '../town/TownWorld'
import { TownFourGateSiege, type TownSiegeSectorRoster } from '../career/TownFourGateSiege'
import { createTownSiegeCrewSlots, townSiegeFrame } from '../career/TownFourGateSiegePolicy'
import { parseTownFourGateSiegeCheckpoint } from '../career/TownFourGateSiegeCheckpoint'
import { TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { townRampartHeight } from '../town/TownRamparts'
import { TOWN_NAVIGATION_BOUNDS } from '../town/TownBounds'
import { NavigationWorld } from '../navigation/NavigationWorld'
import { NPC, AIType, Faction } from '../world/NPC'
import { Player } from '../player/Player'
import { Mount, MountType } from '../world/Mount'
import { SpatialGrid } from '../world/SpatialGrid'
import { getTerrainHeight } from '../world/Terrain'
import { gameplayNpcSpawns, trackNpcSpawn } from '../world/NpcSpawnScheduler'
import { HumanoidAssetRegistry } from '../world/HumanoidAssetRegistry'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import { HorseAssetRegistry } from '../world/HorseAssetRegistry'
import { preloadHighTierEquipment } from '../world/HighTierEquipment'
import { preloadPaladinEquipment } from '../world/PaladinEquipment'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { HpBar } from '../ui/HpBar'
import { damageNpc, damagePlayer } from '../combat/DamageRouter'
import type { DamageableObstacle } from '../world/DamageableObstacle'
import { BlackCatVisual } from '../world/BlackCatVisual'
import { CorgiVisual } from '../world/CorgiVisual'

const PREVIEW_KEY = 'sagaburst_dev_four_gate_siege_v1'

/** Isolated DEV route. It never creates a Career store or reads/writes Career/session launch state. */
export async function launchTownFourGateSiegePreview(container: HTMLElement): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('Four-gate preview is DEV-only')
  const query = new URLSearchParams(location.search), defender = query.get('faction') === 'viking' ? 'viking' : 'roman'
  const attacker = defender === 'roman' ? 'viking' : 'roman'
  const panel = document.createElement('aside')
  panel.id = 'four-gate-preview'
  panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:10000;width:350px;max-height:90vh;overflow:auto;background:#162028ee;color:#eee;padding:16px;font:13px/1.6 system-ui;border-radius:8px'
  panel.textContent = '載入真實 TownWorld、人物與四門攻城車…'; document.body.append(panel)
  for (const id of ['hud', 'crosshair']) { const node = document.getElementById(id); if (node) node.style.display = 'none' }
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping
  container.append(renderer.domElement)
  const scene = new THREE.Scene(), actors: NPC[] = [], mounts: Mount[] = [], hitTargets = new Set<DamageableObstacle>()
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 1000)
  const controls = new OrbitControls(camera, renderer.domElement)
  let world: TownWorld | undefined, siege: TownFourGateSiege | undefined, player: Player | undefined, disposed = false, raf = 0
  const batch = gameplayNpcSpawns.batch(() => { paused = true })
  let paused = true
  const cleanup = () => {
    if (disposed) return
    disposed = true; cancelAnimationFrame(raf); batch.cancel(); siege?.dispose()
    for (const npc of actors) npc.dispose()
    for (const mount of mounts) mount.dispose()
    player?.dispose(); world?.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); panel.remove()
    window.removeEventListener('resize', resize); window.removeEventListener('pagehide', cleanup)
    delete (window as unknown as { __fourGatePreview?: unknown }).__fourGatePreview
  }
  const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }
  try {
    await Promise.all([preloadPaladinEquipment(), preloadHighTierEquipment(), HumanoidAssetRegistry.preload(), HorseAssetRegistry.preload(renderer),
      BlackCatVisual.preload(), CorgiVisual.preload(), ...(['roman-hero-t4', 'viking-hero-t4', 'roman-hero-t5', 'viking-hero-t5'] as const)
        .map(id => HumanoidAssetRegistry.preloadAsset(HERO_ASSETS[id].descriptor))])
    const text = query.get('restore') === '1' ? sessionStorage.getItem(PREVIEW_KEY) : null
    const saved = text ? parseTownFourGateSiegeCheckpoint(JSON.parse(text)) : undefined
    if (text && (!saved || saved.faction !== attacker)) throw new Error('Invalid preview checkpoint or faction mismatch')
    world = new TownWorld(defender, scene, Faction.PLAYER, { fourGateSiege: true })
    const passageMeshCount = () => {
      let meshes = 0
      world!.siegeDockPassages!.root.traverse(object => { if (object instanceof THREE.Mesh) meshes++ })
      return meshes
    }
    const passageMeshesBeforeConfigure = passageMeshCount()
    const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS), grid = new SpatialGrid<NPC>()
    navigation.setTownRamparts(world.fortifications.rampartLayout); navigation.sync(world.obstacles)
    const sectors: TownSiegeSectorRoster[] = TOWN_GATES.map(gate => ({ gateId: gate.id,
      wallActorIds: [-1, 1].map(side => `preview:wall:${gate.id}:${side}`), cavalryActorIds: [`preview:cavalry:${gate.id}`] }))
    siege = new TownFourGateSiege({ scene, world, navigation, grid, actors: () => actors, sectors,
      acceptsOrders: () => true, registerHit: ramp => { hitTargets.add(ramp.damageable) }, unregisterHit: ramp => { hitTargets.delete(ramp.damageable) } }, saved)
    const slots = createTownSiegeCrewSlots(attacker)
    siege.prepare(slots)
    const passageMeshesAfterConfigure = passageMeshCount()
    for (const gate of world.gates.values()) hitTargets.add(gate.damageable)
    const specs: NpcSpawnSpec[] = slots.map(slot => slot.spec)
    for (const gate of TOWN_GATES) {
      const sector = sectors.find(s => s.gateId === gate.id)!
      const presetId = defender === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker', profile = T4_UNIT_PROFILES[presetId]
      for (const [index, side] of ([-1, 1] as const).entries()) {
        const ramp = [...siege.ramps.values()].find(r => r.assignment.id === `town-siege-ramp:${gate.id}:${side < 0 ? 'left' : 'right'}`)!
        const p = ramp.placement.deckConnection.clone().addScaledVector(townSiegeFrame(gate.id).inward, 2)
        specs.push({ actorId: sector.wallActorIds[index], x: p.x, z: p.z, spawnY: townRampartHeight(world.fortifications.rampartLayout, p.x, p.z)!,
          faction: Faction.PLAYER, characterFaction: defender, aiType: AIType.MELEE, name: `${gate.id} wall guard`, tier: 4,
          cavalry: false, respawnEnabled: false, presetId, loadout: resolveT4UnitLoadout(presetId), ...profile })
      }
      const p = townGatePoint(gate, 0, 16), cavalryPreset = defender === 'roman' ? 'roman_sword_cavalry' : 'viking_sword_cavalry'
      specs.push({ actorId: sector.cavalryActorIds[0], x: p.x, z: p.z, faction: Faction.PLAYER, characterFaction: defender,
        aiType: AIType.MELEE, name: `${gate.id} reserve cavalry`, tier: 4, cavalry: true, respawnEnabled: false,
        presetId: cavalryPreset, loadout: { ...resolveT4UnitLoadout(cavalryPreset), mountId: 'horse' }, ...T4_UNIT_PROFILES[cavalryPreset] })
    }
    for (const spec of specs) {
      const state = saved?.actors[spec.actorId!]
      if (state?.status === 'dead' || state?.status === 'exited') continue
      batch.enqueue(spec.actorId!, () => {
        const npc = trackNpcSpawn(new NPC(scene, spec.x, spec.z, spec.faction, spec.characterFaction, spec.aiType, spec.name, spec.tier,
          spec.cavalry, spec.loadout, spec.presetId, undefined, spec.actorId, undefined, spec.visualAssetId, spec.combatProfileId))
        if (spec.spawnY !== undefined) npc.position.y = spec.spawnY
        npc.respawnEnabled = false
        if (spec.cavalry) {
          const mount = trackNpcSpawn(new Mount(scene, MountType.HORSE, spec.x, spec.z)); npc.mountVehicle(mount); mounts.push(mount)
        }
        actors.push(npc); siege!.register(npc)
        if (!state && spec.faction === Faction.PLAYER) {
          npc.setTacticalOrder('defend')
          if (!spec.cavalry) npc.activateTownRampartGarrison()
        }
      })
    }
    batch.seal()
    await gameplayNpcSpawns.wait(batch, (done, total) => { panel.textContent = `原生分幀部署 ${done}/${total}`; renderer.render(scene, camera) })
    player = new Player(scene, defender); player.position.set(45, getTerrainHeight(45, 12), 12)
    const hp = new HpBar(), nearby: NPC[] = []
    const focus = (gateId: TownGateId) => {
      const f = townSiegeFrame(gateId), p = new THREE.Vector3(f.gate.x, getTerrainHeight(f.gate.x, f.gate.z) + 5, f.gate.z)
      controls.target.copy(p); camera.position.copy(p).addScaledVector(f.outward, 80).addScaledVector(f.tangent, 35); camera.position.y += 40; controls.update()
    }
    focus('north')
    panel.innerHTML = `<strong>Four-Gate Siege · DEV</strong><div>${defender} town · 8 ramps / 80 crew + 12 representative defenders</div>
      <div>外護欄 Mesh：配置前 ${passageMeshesBeforeConfigure} → 配置後 ${passageMeshesAfterConfigure}（含 8 處獨立通道；非實測 draw calls／FPS）</div>
      <div><a href="?fourgatepreview=1&nolock&faction=roman">Roman</a> · <a href="?fourgatepreview=1&nolock&faction=viking">Viking</a></div>
      <label>Sector <select id="siege-sector">${TOWN_GATES.map(g => `<option>${g.id}</option>`).join('')}</select></label>
      <label>Ramp <select id="siege-side"><option value="left">left</option><option value="right">right</option></select></label><br>
      <button id="siege-pause">開始／暫停</button> <button id="siege-pusher">擊殺一名 Pusher</button><br>
      <button id="siege-damage">攻城車 -100 HP</button> <button id="siege-destroy">摧毀選定攻城車</button><br>
      <button id="siege-gate">摧毀選定 Gate</button><br><button id="siege-save">Snapshot</button> <button id="siege-restore">Reload Snapshot</button>
      <div id="siege-status"></div><pre id="siege-state" style="font:11px monospace;white-space:pre-wrap"></pre>
      <small>拖曳旋轉、滾輪縮放；所有車體與士兵使用正式物理／移動。沒有自動 Dock、Teleport 或 Career 存檔寫入。</small>`
    const element = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!
    const gateId = () => element<HTMLSelectElement>('siege-sector').value as TownGateId
    const selected = () => siege!.ramps.get(`town-siege-ramp:${gateId()}:${element<HTMLSelectElement>('siege-side').value as 'left' | 'right'}`)!
    element('siege-sector').onchange = () => focus(gateId())
    element('siege-pause').onclick = () => { paused = !paused }
    element('siege-pusher').onclick = () => { const npc = selected().assignment.pusherIds.map(id => actors.find(n => n.combatantId === id)).find(n => n && !n.dead); if (npc) npc.takeDamage(npc.maxHp * 100) }
    element('siege-damage').onclick = () => { selected().damageable.takeDamage(100) }
    element('siege-destroy').onclick = () => { selected().damageable.destroy() }
    element('siege-gate').onclick = () => { world!.gates.get(gateId())!.destroy() }
    element('siege-save').onclick = () => {
      const checkpoint = siege!.snapshot()
      if (!parseTownFourGateSiegeCheckpoint(checkpoint)) throw new Error('Preview snapshot failed contract validation')
      sessionStorage.setItem(PREVIEW_KEY, JSON.stringify(checkpoint)); element('siege-status').textContent = '已保存獨立 Preview Snapshot'
    }
    element('siege-restore').onclick = () => { const url = new URL(location.href); url.searchParams.set('restore', '1'); location.assign(url) }
    Object.assign(window, { __fourGatePreview: { siege, actors, mounts, world, navigation, camera, controls, renderer, hitTargets,
      passageMeshes: { beforeConfigure: passageMeshesBeforeConfigure, afterConfigure: passageMeshesAfterConfigure },
      snapshot: () => siege!.snapshot(), dispose: cleanup } })
    window.addEventListener('resize', resize); window.addEventListener('pagehide', cleanup)
    let last = performance.now(), statusElapsed = 0
    const frame = (time: number) => {
      if (disposed) return
      raf = requestAnimationFrame(frame); const dt = Math.min(.05, Math.max(0, (time - last) / 1000)); last = time
      gameplayNpcSpawns.tick(time)
      if (!paused) {
        grid.clear(); for (const npc of actors) if (!npc.dead) grid.insert(npc)
        navigation.sync(world!.obstacles); navigation.beginFrame(); siege!.update(dt)
        for (const npc of actors) npc.update(dt, player!, actors, grid.getNearbyInto(npc.combatPosition, 4, nearby), world!.obstacles, hp,
          (damage, isPlayer, target) => { if (isPlayer) damagePlayer(player!, damage, hp, null); else if (target) damageNpc(target, damage) },
          () => false, false, npc.combatPosition.distanceTo(camera.position), null, grid, navigation)
      }
      controls.update(); renderer.render(scene, camera)
      statusElapsed += dt
      if (statusElapsed > .25) {
        statusElapsed = 0
        element('siege-state').textContent = [...siege!.ramps.values()].map(r => `${r.assignment.id.replace('town-siege-ramp:', '')} ${r.controller.state}\n  ${r.controller.distance.toFixed(1)}/${r.controller.travelDistance.toFixed(1)}m · ${r.damageable.currentHp} HP · ${r.controller.alivePushers} pushers · ${Math.round(r.controller.dockingProgress * 100)}%`).join('\n')
        element('siege-status').textContent = `${paused ? '暫停' : '執行中'} · ${siege!.entrances.entries.size} entrances · ${actors.filter(n => n.campaignBreachCompleted).length} crew reached wall`
      }
    }
    raf = requestAnimationFrame(frame)
  } catch (error) { cleanup(); throw error }
}
