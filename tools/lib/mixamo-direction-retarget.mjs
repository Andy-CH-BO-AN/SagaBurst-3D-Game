/** Direction-based retarget between two Mixamo-named rigs whose rest poses differ (A-pose donor, T-pose target).
 * Each aimed bone is rotated so its bone axis points where the donor's bone points (minimal swing from the
 * target rest), then the donor's own twist about that axis is re-applied. End bones (hands, toes, head top)
 * copy the donor's local delta. Hips translation is scaled by the hips-height ratio. */
import * as T from 'three'

const SIDES = ['Left', 'Right']
export const AIM_CHILD = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  ...Object.fromEntries(SIDES.flatMap(s => [[`${s}Shoulder`, `${s}Arm`], [`${s}Arm`, `${s}ForeArm`], [`${s}ForeArm`, `${s}Hand`],
    [`${s}UpLeg`, `${s}Leg`], [`${s}Leg`, `${s}Foot`], [`${s}Foot`, `${s}ToeBase`]])),
}
export const END_BONES = ['HeadTop_End', 'LeftHand', 'RightHand', 'LeftToeBase', 'RightToeBase']
const prefixed = name => `mixamorig${name}`

function restOf(scene, names) {
  scene.updateMatrixWorld(true)
  const rest = {}
  for (const name of names) {
    const node = scene.getObjectByName(prefixed(name))
    if (!node) throw new Error(`Rig is missing ${name}`)
    rest[name] = { node, q: node.getWorldQuaternion(new T.Quaternion()), p: node.getWorldPosition(new T.Vector3()), local: node.quaternion.clone(), localP: node.position.clone() }
  }
  return rest
}

export function createRetargeter(donorScene, targetScene) {
  const order = ['Hips']
  const visit = name => { for (const [bone, child] of Object.entries(AIM_CHILD)) if (bone === name && !order.includes(child)) { order.push(child); visit(child) } }
  // Parents before children, including side branches.
  const names = []
  targetScene.getObjectByName(prefixed('Hips')).traverse(o => { if (o.isBone && o.name.startsWith('mixamorig')) names.push(o.name.slice(9)) })
  const bones = names.filter(n => n !== 'headfront')
  const donorRest = restOf(donorScene, bones), targetRest = restOf(targetScene, bones)
  const hipsScale = targetRest.Hips.p.y / donorRest.Hips.p.y
  const aim = {}
  for (const [bone, child] of Object.entries(AIM_CHILD)) {
    aim[bone] = {
      donor: donorRest[child].p.clone().sub(donorRest[bone].p).normalize(),
      target: targetRest[child].p.clone().sub(targetRest[bone].p).normalize(),
    }
  }
  const dq = new T.Quaternion(), twistQ = new T.Quaternion(), swing = new T.Quaternion(), tmp = new T.Quaternion(), tmp2 = new T.Quaternion()
  const dir = new T.Vector3(), proj = new T.Vector3()

  /** Evaluate the donor at the current mixer state and return target local rotations plus hips translation. */
  function pose() {
    donorScene.updateMatrixWorld(true)
    const world = {}, local = {}
    for (const name of bones) {
      const rest = targetRest[name], donor = donorRest[name], node = donor.node
      const donorWorld = node.getWorldQuaternion(new T.Quaternion())
      let q
      if (END_BONES.includes(name)) {
        const donorLocal = node.quaternion
        // Delta in the parent frame: rest_target * (rest_donor^-1 * current_donor)
        tmp.copy(donor.local).invert().multiply(donorLocal)
        q = rest.local.clone().multiply(tmp)
        const parentName = node.parent.name.slice(9)
        local[name] = q
        world[name] = world[parentName].clone().multiply(q)
        continue
      }
      dq.copy(donorWorld).multiply(tmp2.copy(donor.q).invert())
      const a = aim[name]
      // Swing/twist split of the donor's world delta about its rest bone axis.
      proj.set(dq.x, dq.y, dq.z).projectOnVector(a.donor)
      twistQ.set(proj.x, proj.y, proj.z, dq.w)
      const length = twistQ.length()
      let angle = 0
      if (length > 1e-9) { twistQ.set(twistQ.x / length, twistQ.y / length, twistQ.z / length, twistQ.w / length); angle = 2 * Math.atan2(proj.dot(a.donor), dq.w) }
      dir.copy(a.donor).applyQuaternion(dq)
      swing.setFromUnitVectors(a.target, dir)
      tmp.setFromAxisAngle(a.target, angle)
      const w = swing.clone().multiply(tmp).multiply(rest.q)
      const parentName = rest.node.parent?.name?.startsWith('mixamorig') ? rest.node.parent.name.slice(9) : null
      world[name] = w
      local[name] = parentName ? world[parentName].clone().invert().multiply(w) : w.clone()
    }
    const hipsDonor = donorRest.Hips.node.getWorldPosition(new T.Vector3())
    const hips = targetRest.Hips.localP.clone().add(hipsDonor.sub(donorRest.Hips.p).multiplyScalar(hipsScale))
    return { local, hips }
  }
  return { bones, pose, hipsScale, targetRest, donorRest }
}
