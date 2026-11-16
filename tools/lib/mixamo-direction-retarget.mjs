/** Direction-based retarget between two Mixamo-derived rigs whose rest poses differ (A-pose donor, T-pose target).
 * Each aimed bone points where the donor's bone points (minimal swing from the target rest) and re-applies the
 * donor's twist about that axis. Hands match the donor's anatomical palm frame in world space; the forearm takes
 * most of the resulting pronation so the wrist does not candy-wrap. Hips translation scales by the hips height. */
import * as T from 'three'

const SIDES = ['Left', 'Right']
export const AIM_CHILD = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
  ...Object.fromEntries(SIDES.flatMap(s => [[`${s}Shoulder`, `${s}Arm`], [`${s}Arm`, `${s}ForeArm`], [`${s}ForeArm`, `${s}Hand`],
    [`${s}UpLeg`, `${s}Leg`], [`${s}Leg`, `${s}Foot`], [`${s}Foot`, `${s}ToeBase`]])),
}
const TORSO = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
export const END_BONES = ['HeadTop_End', 'LeftHand', 'RightHand', 'LeftToeBase', 'RightToeBase']
export const PROJECT_NAMES = {
  Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upper_chest', Neck: 'neck', Head: 'head',
  ...Object.fromEntries(SIDES.flatMap(s => { const x = s === 'Left' ? 'l' : 'r'; return [[`${s}Shoulder`, `clavicle_${x}`], [`${s}Arm`, `upper_arm_${x}`],
    [`${s}ForeArm`, `lower_arm_${x}`], [`${s}Hand`, `hand_${x}`], [`${s}UpLeg`, `upper_leg_${x}`], [`${s}Leg`, `lower_leg_${x}`], [`${s}Foot`, `foot_${x}`], [`${s}ToeBase`, `toe_${x}`]] })),
}
const basis = ({ finger, thumb }) => {
  const f = new T.Vector3(...finger).normalize(), t = new T.Vector3(...thumb); t.addScaledVector(f, -t.dot(f)).normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(f, t, new T.Vector3().crossVectors(f, t)))
}

/** @param options.donorName maps a Mixamo short name to the donor's node name.
 *  @param options.frames { donor: {Left,Right}, target: {Left,Right} } of { finger, thumb, palm } in hand-local axes. */
export function createRetargeter(donorScene, targetScene, options) {
  const donorName = options.donorName ?? (name => `mixamorig${name}`)
  const names = []
  targetScene.getObjectByName('mixamorigHips').traverse(o => { if (o.isBone && o.name.startsWith('mixamorig')) names.push(o.name.slice(9)) })
  const bones = names.filter(n => n !== 'headfront')
  donorScene.updateMatrixWorld(true); targetScene.updateMatrixWorld(true)
  const capture = node => node && { node, q: node.getWorldQuaternion(new T.Quaternion()), p: node.getWorldPosition(new T.Vector3()), local: node.quaternion.clone(), localP: node.position.clone() }
  const donorRest = {}, targetRest = {}
  for (const b of bones) { donorRest[b] = capture(donorScene.getObjectByName(donorName(b))); targetRest[b] = capture(targetScene.getObjectByName(`mixamorig${b}`)) }
  const hipsScale = targetRest.Hips.p.y / donorRest.Hips.p.y
  const aim = {}
  for (const [bone, child] of Object.entries(AIM_CHILD)) {
    if (!donorRest[bone] || !donorRest[child]) continue
    aim[bone] = { donor: donorRest[child].p.clone().sub(donorRest[bone].p).normalize(), target: targetRest[child].p.clone().sub(targetRest[bone].p).normalize() }
  }
  const handMap = {}, palmLocal = {}
  for (const side of SIDES) {
    handMap[side] = basis(options.frames.donor[side]).multiply(basis(options.frames.target[side]).invert())
    palmLocal[side] = new T.Vector3(...options.frames.target[side].palm).normalize()
  }
  const dq = new T.Quaternion(), tmp = new T.Quaternion(), proj = new T.Vector3()
  const parentOf = rest => rest.node.parent?.name?.startsWith('mixamorig') ? rest.node.parent.name.slice(9) : null

  /** Evaluate the donor's current pose and return target local rotations plus hips translation. */
  function pose() {
    donorScene.updateMatrixWorld(true)
    const world = {}, local = {}, handWorld = {}
    for (const side of SIDES) handWorld[side] = donorRest[`${side}Hand`].node.getWorldQuaternion(new T.Quaternion()).multiply(handMap[side])
    for (const name of bones) {
      const rest = targetRest[name], donor = donorRest[name], parent = parentOf(rest)
      const parentWorld = parent ? world[parent] : new T.Quaternion()
      let w
      const side = name.startsWith('Left') ? 'Left' : 'Right'
      if (name.endsWith('Hand')) w = handWorld[side].clone()
      else if (!donor) w = parentWorld.clone().multiply(rest.local)
      else if (TORSO.includes(name)) {
        // Torso proportions differ between rigs (a leaning donor neck must not bow this head): transfer the world delta.
        w = donor.node.getWorldQuaternion(new T.Quaternion()).multiply(tmp.copy(donor.q).invert()).multiply(rest.q)
      }
      else if (END_BONES.includes(name) || !aim[name]) {
        // Toes and a head without an end joint: the donor's delta in its parent frame.
        tmp.copy(donor.local).invert().multiply(donor.node.quaternion)
        w = parentWorld.clone().multiply(rest.local).multiply(tmp)
      } else {
        const a = aim[name]
        dq.copy(donor.node.getWorldQuaternion(new T.Quaternion())).multiply(tmp.copy(donor.q).invert())
        proj.set(dq.x, dq.y, dq.z).projectOnVector(a.donor)
        const dir = a.donor.clone().applyQuaternion(dq).normalize()
        const swing = new T.Quaternion().setFromUnitVectors(a.target, dir)
        if (name.endsWith('ForeArm')) {
          // Roll the forearm toward the hand's palm direction; the wrist keeps the remainder.
          const handRest = targetRest[`${side}Hand`].q
          const carried = palmLocal[side].clone().applyQuaternion(handRest).applyQuaternion(swing)
          const wanted = palmLocal[side].clone().applyQuaternion(handWorld[side])
          carried.addScaledVector(dir, -carried.dot(dir)); wanted.addScaledVector(dir, -wanted.dot(dir))
          const angle = Math.atan2(new T.Vector3().crossVectors(carried, wanted).dot(dir), carried.dot(wanted))
          w = new T.Quaternion().setFromAxisAngle(dir, angle * .7).multiply(swing).multiply(rest.q)
        } else {
          const angle = 2 * Math.atan2(proj.dot(a.donor), dq.w)
          w = swing.clone().multiply(tmp.setFromAxisAngle(a.target, angle)).multiply(rest.q)
        }
      }
      world[name] = w
      local[name] = parentWorld.clone().invert().multiply(w).normalize()
    }
    const hips = targetRest.Hips.localP.clone().add(donorRest.Hips.node.getWorldPosition(new T.Vector3()).sub(donorRest.Hips.p).multiplyScalar(hipsScale))
    return { local, hips }
  }
  return { bones, pose, hipsScale, targetRest, donorRest }
}
