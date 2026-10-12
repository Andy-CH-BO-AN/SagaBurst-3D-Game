import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareSeatSupport } from './SkinnedSeatContact'

export interface SelectedHumanoidSource {
  rig: 'mixamo66' | 'steppe37'
  uniformScale: number
}

/** The selected Steppe's authored helper rule, evaluated only after mounted FK.
 * Compare thigh directions in pelvis space, so torso yaw never enters the skirt.
 * Ground clips already contain helper tracks and must not receive this layer. */
export class SelectedMountedSkirt {
  readonly nodes: THREE.Object3D[] = []
  private readonly sides: Array<{ thigh: THREE.Object3D; restDirection: THREE.Vector3; front: THREE.Object3D; back: THREE.Object3D; frontRest: THREE.Quaternion; backRest: THREE.Quaternion }> = []
  private readonly apron: THREE.Object3D
  private readonly apronRest: THREE.Quaternion
  private readonly direction = new THREE.Vector3()
  private readonly swing = new THREE.Quaternion()
  private readonly weighted = new THREE.Quaternion()

  constructor(root: THREE.Object3D) {
    const get = (name: string) => {
      const node = root.getObjectByName(name)
      if (!node) throw new Error(`Selected Steppe missing ${name}`)
      return node
    }
    for (const side of ['l', 'r']) {
      const thigh = get(`upper_leg_${side}`), front = get(`skirt_front_${side}`), back = get(`skirt_back_${side}`)
      this.sides.push({ thigh, front, back, restDirection: new THREE.Vector3(0, 1, 0).applyQuaternion(thigh.quaternion), frontRest: front.quaternion.clone(), backRest: back.quaternion.clone() })
      this.nodes.push(front, back)
    }
    this.apron = get('skirt_apron')
    this.apronRest = this.apron.quaternion.clone()
    this.nodes.push(this.apron)
  }

  apply(): void {
    let forwardFlexion = 0
    for (const side of this.sides) {
      this.direction.set(0, 1, 0).applyQuaternion(side.thigh.quaternion)
      this.swing.setFromUnitVectors(side.restDirection, this.direction)
      side.front.quaternion.copy(this.weighted.identity().slerp(this.swing, .9)).multiply(side.frontRest)
      side.back.quaternion.copy(this.weighted.identity().slerp(this.swing, .7)).multiply(side.backRest)
      forwardFlexion = Math.max(forwardFlexion, Math.atan2(this.direction.z, -this.direction.y) - Math.atan2(side.restDirection.z, -side.restDirection.y))
    }
    this.apron.quaternion.copy(this.weighted.setFromAxisAngle(this.direction.set(1, 0, 0), -.9 * forwardFlexion)).multiply(this.apronRest)
  }
}

const MIXAMO_ALIASES: Readonly<Record<string, string>> = {
  Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upper_chest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'clavicle_l', RightShoulder: 'clavicle_r',
  LeftArm: 'upper_arm_l', LeftForeArm: 'lower_arm_l', LeftHand: 'hand_l',
  RightArm: 'upper_arm_r', RightForeArm: 'lower_arm_r', RightHand: 'hand_r',
  LeftUpLeg: 'upper_leg_l', LeftLeg: 'lower_leg_l', LeftFoot: 'foot_l', LeftToeBase: 'toe_l',
  RightUpLeg: 'upper_leg_r', RightLeg: 'lower_leg_r', RightFoot: 'foot_r', RightToeBase: 'toe_r',
}

/** A view of the original rig for the game's bone lookups, not a retarget.
 * Keep all 66/37 joints, parents, inverse binds and animation sample values.
 * Equipment frames are calibrated separately in each original hand basis. */
export function prepareSelectedHumanoidSource(gltf: GLTF, source: SelectedHumanoidSource): void {
  const { scene } = gltf
  if (!(source.uniformScale > 0) || !Number.isFinite(source.uniformScale)) throw new Error('Invalid source scale')
  if (source.rig === 'mixamo66') {
    const renamed = new Map<string, string>()
    scene.traverse(node => {
      const name = MIXAMO_ALIASES[node.name.replace(/^mixamorig:?/, '')]
      if (!name || !(node instanceof THREE.Bone)) return
      renamed.set(node.name, name)
      node.userData.sourceBoneName = node.name
      node.name = name
    })
    gltf.animations = gltf.animations.map(clip => new THREE.AnimationClip(clip.name, clip.duration,
      clip.tracks.map(track => {
        const split = track.name.lastIndexOf('.')
        const alias = renamed.get(track.name.slice(0, split))
        if (!alias) return track
        const mapped = track.clone()
        mapped.name = `${alias}${track.name.slice(split)}`
        return mapped
      }), clip.blendMode))
    scene.updateMatrixWorld(true)
    const sockets = {
      socket_hand_l: 'hand_l', socket_hand_r: 'hand_r', socket_back: 'chest',
      socket_head: 'head', socket_pelvis: 'hips', socket_foot_l: 'foot_l', socket_foot_r: 'foot_r',
      sole_l: 'foot_l', sole_r: 'foot_r',
    }
    for (const [name, parentName] of Object.entries(sockets)) {
      const parent = scene.getObjectByName(parentName)
      if (!parent) throw new Error(`Selected source missing ${parentName}`)
      const socket = new THREE.Object3D()
      socket.name = name
      // Bone rotation is deliberately retained. Socket basis matches the model
      // in rest; palm attachments compensate using the measured hand frame.
      socket.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion())).invert()
      if (name.startsWith('sole_')) {
        const world = parent.getWorldPosition(new THREE.Vector3()); world.y = 0
        socket.position.copy(parent.worldToLocal(world))
      }
      parent.add(socket)
    }
  }
  scene.scale.setScalar(source.uniformScale)
  // Inspected underside of the upper thighs in source mesh coordinates,
  // excluding the hanging skirt. These project independently onto each LOD.
  const bearing = source.rig === 'mixamo66'
    ? [[-.06755692, .82565891, -.09472248], [.07574582, .82509485, -.09562403]]
    : [[-.02979784, .92268130, -.11817514], [.01326805, .94021204, -.11296710]]
  scene.traverse(node => { if (node instanceof THREE.SkinnedMesh) prepareSeatSupport(node, bearing) })
  scene.updateMatrixWorld(true)
}
