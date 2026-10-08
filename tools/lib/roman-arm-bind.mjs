import * as T from 'three'
import { loadRig, readAccessor } from './humanoid-glb.mjs'

/** Recenter the source's parallel arm joints on its calibrated anatomical
 * wrist. The original rig ran through the top of the arm, 65 mm above its
 * centre. Rebind without moving a vertex or changing rest rotations/lengths.
 */
export async function repairRomanArmBind(asset, assetId, rightFrame, leftFrame) {
  const doc = asset.document
  if (doc.asset.extras.romanArmBind?.targetAssetId === assetId) return false
  const rig = await loadRig(asset)
  rig.scene.updateMatrixWorld(true)
  const changed = new Map(), socketWorld = new Map()
  for (const side of ['l', 'r']) {
    const hand = rig.scene.getObjectByName(`hand_${side}`)
    const frame = side === 'l' ? leftFrame : rightFrame
    const offset = new T.Vector3(...frame.wristCenter)
    const shift = hand.localToWorld(offset.clone()).sub(hand.getWorldPosition(new T.Vector3()))
    const upper = rig.scene.getObjectByName(`upper_arm_${side}`)
    upper.traverse(bone => {
      changed.set(bone.name, bone.matrixWorld.clone())
      if (bone.name.startsWith('socket_')) socketWorld.set(bone.name, bone.matrixWorld.clone())
    })
    upper.position.copy(upper.parent.worldToLocal(upper.getWorldPosition(new T.Vector3()).add(shift)))
    upper.updateWorldMatrix(false, true)
    for (const [name, world] of socketWorld) {
      const socket = rig.scene.getObjectByName(name)
      socket.matrix.copy(socket.parent.matrixWorld).invert().multiply(world)
      socket.matrix.decompose(socket.position, socket.quaternion, socket.scale)
      socket.updateWorldMatrix(false, true)
    }
    for (const key of ['gripCenterLocal', 'palmContactCenter', 'wristCenter', 'thumbBaseCenter']) {
      if (frame[key]) frame[key] = new T.Vector3(...frame[key]).sub(offset).toArray()
    }
  }
  for (const [name] of changed) {
    const object = rig.scene.getObjectByName(name), node = doc.nodes.find(n => n.name === name)
    if (!node) throw Error(`Missing arm node ${name}`)
    if (node.matrix) node.matrix = object.matrix.toArray()
    else node.translation = object.position.toArray()
  }
  const written = new Set()
  for (const skin of doc.skins) {
    if (written.has(skin.inverseBindMatrices)) continue
    written.add(skin.inverseBindMatrices)
    const index = skin.inverseBindMatrices, values = readAccessor(asset, index)
    const accessor = doc.accessors[index], view = doc.bufferViews[accessor.bufferView]
    for (let i = 0; i < skin.joints.length; i++) {
      const name = doc.nodes[skin.joints[i]].name, oldWorld = changed.get(name)
      if (!oldWorld) continue
      const inverse = rig.scene.getObjectByName(name).matrixWorld.clone().invert().multiply(oldWorld)
        .multiply(new T.Matrix4().fromArray(values, i * 16))
      const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 64)
      inverse.elements.forEach((value, column) => asset.binary.writeFloatLE(value, start + column * 4))
    }
  }
  doc.asset.extras.romanArmBind = { version: 1, targetAssetId: assetId,
    method: 'Arm joints recentered on calibrated wrist; inverse bind matrices and socket/grip coordinates rebased; rest geometry and limb lengths preserved' }
  return true
}
