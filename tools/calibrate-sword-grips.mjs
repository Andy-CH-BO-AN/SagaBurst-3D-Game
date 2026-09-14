import fs from 'node:fs'
import * as THREE from 'three'
import { readGlb, loadRig } from './lib/humanoid-glb.mjs'

// Right-hand landmarks inspected in bind-space palm/side views. The contact
// plane is measured from mesh ray hits below, not copied from the bow contract.
const landmarks = {
  roman: { center: [.008, .055, -.078], normal: [0, 0, -1], thumb: [-1, 0, 0], fingers: [0, 1, 0], wrist: [0, 0, -.065], thumbBase: [-.035, .018, -.061], fingerBase: .055, radius: .028 * 1.12 },
  viking: { center: [.01333337, .10, .01052682], normal: [.92, 0, -.392], thumb: [-.392, 0, -.92], fingers: [0, 1, 0], wrist: [-.015, 0, 0], thumbBase: [-.01, .04, -.035], fingerBase: .13, radius: .037 * 1.12 },
}
for (const faction of ['roman', 'viking']) {
  const base = `public/models/characters/v2/${faction}`, seed = landmarks[faction]
  const source = await loadRig(readGlb(`${base}/lod0.glb`)); source.scene.updateMatrixWorld(true)
  const hand = source.scene.getObjectByName('hand_r')
  const normal = new THREE.Vector3(...seed.normal).normalize(), thumb = new THREE.Vector3(...seed.thumb).normalize()
  const finger = new THREE.Vector3(...seed.fingers), center = new THREE.Vector3(...seed.center), ray = new THREE.Raycaster(), samples = []
  for (const f of [-.015, 0, .015]) for (const t of [-.02, 0, .02]) {
    const origin = center.clone().addScaledVector(finger, f).addScaledVector(thumb, t).addScaledVector(normal, .3)
    ray.set(origin.applyMatrix4(hand.matrixWorld), normal.clone().negate().transformDirection(hand.matrixWorld))
    const hit = ray.intersectObject(source.scene, true).find(h => ['New_arms', 'Legs_Hands'].includes(h.object.name))
    if (hit) samples.push(hand.worldToLocal(hit.point))
  }
  if (samples.length !== 9) throw new Error(`${faction}: 掌面取樣不完整`)
  const plane = Math.max(...samples.map(p => p.dot(normal)))
  center.addScaledVector(normal, plane + seed.radius - center.dot(normal))
  const frames = {}
  for (let lod = 0; lod < 3; lod++) {
    const target = await loadRig(readGlb(`${base}/lod${lod}.glb`)); target.scene.updateMatrixWorld(true)
    const toTarget = target.scene.getObjectByName('hand_r').matrixWorld.clone().invert().multiply(hand.matrixWorld)
    const point = values => new THREE.Vector3(...values).applyMatrix4(toTarget).toArray()
    const direction = vector => vector.clone().transformDirection(toTarget).toArray()
    const targetFinger = finger.clone().transformDirection(toTarget)
    frames[`lod${lod}`] = {
      gripCenterLocal: point(center.toArray()), gripAxisLocal: direction(thumb), palmNormalLocal: direction(normal),
      fingerDirection: targetFinger.toArray(), wristCenter: point(seed.wrist), thumbBaseCenter: point(seed.thumbBase),
      fingerBase: finger.clone().multiplyScalar(seed.fingerBase).applyMatrix4(toTarget).dot(targetFinger), gripRadius: seed.radius,
    }
  }
  const manifest = JSON.parse(fs.readFileSync(`${base}/manifest.json`, 'utf8'))
  manifest.swordGripFrames = frames
  manifest.swordGripCalibration = { version: 1, hand: 'hand_r', samples: samples.map(p => p.toArray()), method: 'right palm rays; outer leather-wrap radius; per-LOD bind basis' }
  fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
  console.log(faction, JSON.stringify(frames.lod0))
}
