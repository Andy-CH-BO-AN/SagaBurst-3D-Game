import { preloadHighTierEquipment } from '../../src/world/HighTierEquipment'
import { readFileSync } from 'node:fs'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HERO_ASSETS } from '../../src/world/HeroAssetCatalog'
import { HumanoidAssetRegistry, type HumanoidAssetManifest } from '../../src/world/HumanoidAssetRegistry'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { preloadPaladinEquipment } from '../../src/world/PaladinEquipment'
import { townCommanderSpec } from '../../src/town/TownCommander'
import { townMilitaryEquipment } from '../../src/town/TownRules'
import { installCorgiTestAsset } from '../helpers/corgiAsset'
import { installBlackCatTestAsset } from '../helpers/blackCatAsset'
// @ts-expect-error Offline tooling is JavaScript; its loader explicitly omits image/material payload.
import { readGlb, loadRig } from '../../tools/lib/humanoid-glb.mjs'

describe.each(['roman', 'viking'] as const)('%s mounted Commander service clearance', faction => {
  const assetId = `${faction}-hero-t5` as const
  const descriptor = HERO_ASSETS[assetId].descriptor
  const directory = `public/models/characters/v2/${assetId}`
  const manifest: HumanoidAssetManifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'))

  it('fits its real mounted service geometry inside the collision-safe Town placement envelope', async () => {
    // One real NPC/mount pair, authored GLBs and no TownWorld. The placement suite
    // checks this 5m envelope against built Town obstacles; here the rider, held
    // equipment and mount must actually fit it so a center-point check cannot pass.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => manifest } as Response)
    const loader = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async function (this: GLTFLoader, url) {
      return loadRig(readGlb(url.startsWith(`/models/characters/v2/${assetId}/`) ? `${directory}/${url.split('/').at(-1)}` : `public${url}`), this)
    })
    onTestFinished(() => { fetchMock.mockRestore(); loader.mockRestore() })
    await Promise.all([HumanoidAssetRegistry.preloadAsset(descriptor), preloadPaladinEquipment(), preloadHighTierEquipment(),
      faction === 'roman' ? installCorgiTestAsset() : installBlackCatTestAsset()])
    const scene = new THREE.Scene(), spec = townCommanderSpec({ x: 25, z: 5, yaw: -Math.PI / 2 })
    const gear = townMilitaryEquipment(faction, spec)
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, faction, AIType.MELEE,
      'commander', 4, spec.mounted, gear.loadout, gear.presetId, undefined, spec.id, undefined, assetId, `${faction}-commander`)
    onTestFinished(() => npc.dispose())
    const mount = new Mount(scene, faction === 'roman' ? MountType.CORGI : MountType.BLACK_CAT, spec.x, spec.z)
    onTestFinished(() => mount.dispose())
    mount.group.rotation.y = spec.yaw!
    npc.setTownPeaceful(); npc.mountVehicle(mount)
    const envelope = new THREE.Box3(new THREE.Vector3(spec.x - 2.5, -100, spec.z - 2.5), new THREE.Vector3(spec.x + 2.5, 100, spec.z + 2.5))
    const occupied = new THREE.Box3()
    for (let frame = 0; frame < 30; frame++) {
      mount.beginControlledFrame(); mount.finishControlledFrame(1 / 30, [])
      npc.updateTownPeace(1 / 30, 0, false, false)
      scene.updateMatrixWorld(true)
      occupied.union(new THREE.Box3().setFromObject(npc.group, true))
      occupied.union(new THREE.Box3().setFromObject(mount.group, true))
    }
    expect(npc.mount).toBe(mount)
    expect(occupied.isEmpty()).toBe(false)
    expect(envelope.containsBox(occupied), `${faction}: mounted body and equipment stay inside Town's reserved clearance`).toBe(true)
  })

})
