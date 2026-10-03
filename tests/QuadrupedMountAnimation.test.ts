import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BlackCatVisual } from '../src/world/BlackCatVisual'
import { CorgiVisual } from '../src/world/CorgiVisual'
import { Mount, MountState, MountType } from '../src/world/Mount'
import { QUADRUPED_STUDIO_CLIPS, type QuadrupedAnimationState } from '../src/world/QuadrupedMountAnimation'
import { installBlackCatTestAsset } from './helpers/blackCatAsset'
import { installCorgiTestAsset } from './helpers/corgiAsset'

const species = [
  { name: 'black cat', prefix: 'cat', type: MountType.BLACK_CAT, runSpeed: 13.2, Visual: BlackCatVisual, load: installBlackCatTestAsset },
  { name: 'corgi', prefix: 'corgi', type: MountType.CORGI, runSpeed: 12, Visual: CorgiVisual, load: installCorgiTestAsset },
]

describe.each(species)('$name animation runtime', ({ prefix, type, runSpeed, Visual, load }) => {
  let gltf: GLTF
  beforeAll(async () => { gltf = await load() })

  function actionFor(visual: BlackCatVisual | CorgiVisual, name: QuadrupedAnimationState): THREE.AnimationAction {
    const clip = gltf.animations.find(animation => animation.name === name)
    expect(clip, `shipped ${name} clip`).toBeDefined()
    const action = visual.mixer.existingAction(clip!)
    expect(action).not.toBeNull()
    return action!
  }

  it('ships the canonical clips and loops all three locomotion states', () => {
    expect(gltf.animations.map(clip => clip.name).sort()).toEqual([...QUADRUPED_STUDIO_CLIPS].sort())
    const visual = new Visual()
    for (const clip of ['idle', 'walk', 'run'] as const) {
      visual.playStudioClip(clip)
      const action = actionFor(visual, clip)
      const duration = action.getClip().duration
      visual.update(duration * 3.25)
      expect(action.loop).toBe(THREE.LoopRepeat)
      expect(action.clampWhenFinished).toBe(false)
      expect(action.paused).toBe(false)
      expect(action.time).toBeCloseTo(duration * .25, 4)
      expect(visual.debugState().clip).toBe(clip)
    }
    visual.dispose()
  })

  it('keeps its gait and action phase through speed jitter at both boundaries', () => {
    const visual = new Visual()
    for (const speed of [.11, .19, .15]) {
      visual.setLocomotion(speed)
      expect(visual.debugState().clip).toBe('idle')
    }
    visual.setLocomotion(.2)
    for (const speed of [.19, .11, .15]) {
      visual.setLocomotion(speed)
      expect(visual.debugState().clip).toBe('walk')
    }
    visual.setLocomotion(.09)
    expect(visual.debugState().clip).toBe('idle')
    visual.setLocomotion(5.9)
    expect(visual.debugState().clip).toBe('walk')
    visual.setLocomotion(6)
    visual.update(.2)
    const run = actionFor(visual, 'run')
    let previousTime = run.time
    for (const speed of [5.9, 5.1, 5.01]) {
      visual.setLocomotion(speed)
      expect(visual.debugState().clip).toBe('run')
      expect(run.time).toBe(previousTime)
      visual.update(.01)
      expect(run.time).toBeGreaterThan(previousTime)
      previousTime = run.time
    }
    visual.setLocomotion(4.99)
    expect(visual.debugState().clip).toBe('walk')
    visual.setLocomotion(NaN)
    expect(visual.debugState().clip).toBe('idle')
    visual.dispose()
  })

  it('blends the outgoing and incoming locomotion before completing the transition', () => {
    const visual = new Visual()
    const idle = actionFor(visual, 'idle')
    const run = actionFor(visual, 'run')
    visual.setLocomotion(12)
    visual.update(.06)
    expect(idle.getEffectiveWeight()).toBeGreaterThan(.4)
    expect(idle.getEffectiveWeight()).toBeLessThan(.6)
    expect(run.getEffectiveWeight()).toBeGreaterThan(.4)
    expect(run.getEffectiveWeight()).toBeLessThan(.6)
    visual.update(.07)
    expect(idle.getEffectiveWeight()).toBe(0)
    expect(run.getEffectiveWeight()).toBe(1)
    visual.dispose()
  })

  it('advances at the requested ground speed from slow walking through sprint and catch-up', () => {
    const visual = new Visual()
    for (const [speed, clip, rate] of [
      [.2, 'walk', .1],
      [2, 'walk', 1],
      [runSpeed, 'run', 1],
      [runSpeed * 2, 'run', 2],
      [runSpeed * 2.99, 'run', 2.99],
    ] as const) {
      visual.setLocomotion(speed)
      const action = actionFor(visual, clip)
      const previousTime = action.time
      const dt = .02
      visual.update(dt)
      expect(visual.debugState().clip).toBe(clip)
      expect(visual.debugState().playbackRate).toBeCloseTo(rate, 6)
      expect(action.time).toBeCloseTo(previousTime + dt * rate, 5)
    }
    visual.setLocomotion(runSpeed * 10)
    expect(visual.debugState().playbackRate).toBe(3)
    expect(Number.isFinite(actionFor(visual, 'run').getEffectiveTimeScale())).toBe(true)
    visual.dispose()
  })

  it.each([
    { clip: 'hit', gait: 'walk', speed: 1.3, rate: .65 },
    { clip: 'land', gait: 'walk', speed: 1.3, rate: .65 },
    { clip: 'hit', gait: 'run', speed: runSpeed * 2, rate: 2 },
    { clip: 'land', gait: 'run', speed: runSpeed * 2, rate: 2 },
  ] as const)('recovers $clip into the most recently requested $gait and playback speed', ({ clip, gait, speed, rate }) => {
    const visual = new Visual()
    visual.setLocomotion(2)
    visual.update(.2)
    visual.playOnce(clip)
    visual.setLocomotion(speed)
    expect(visual.debugState()).toMatchObject({ clip, playbackRate: 1 })
    visual.update(actionFor(visual, clip).getClip().duration + .01)
    expect(visual.debugState()).toMatchObject({ clip: gait, playbackRate: rate })
    const locomotion = actionFor(visual, gait)
    const previousTime = locomotion.time
    visual.update(.02)
    expect(locomotion.time).toBeCloseTo(previousTime + .02 * rate, 5)
    visual.dispose()
  })

  it('holds jump through the physics flight and recovers only after the landing one-shot', () => {
    const mount = new Mount(new THREE.Scene(), type, 0, 0)
    mount.state = MountState.CONTROLLED
    mount.beginControlledFrame()
    mount.finishControlledFrame(1 / 60, [])
    expect(mount.onGround).toBe(true)
    expect(mount.proceduralVisual!.debugState().clip).toBe('idle')
    mount.startJump(8)
    mount.startJump(20)
    expect(mount.velY).toBe(8)
    let airborneFrames = 0
    for (let frame = 0; frame < 120; frame++) {
      mount.beginControlledFrame()
      mount.finishControlledFrame(1 / 60, [])
      if (mount.onGround) break
      airborneFrames++
      expect(mount.proceduralVisual!.debugState().clip).toBe('jump')
    }
    expect(airborneFrames).toBeGreaterThan(30)
    expect(mount.onGround).toBe(true)
    expect(mount.proceduralVisual!.debugState().clip).toBe('land')
    for (let frame = 0; frame < 120; frame++) {
      mount.beginControlledFrame()
      mount.finishControlledFrame(1 / 60, [])
    }
    expect(mount.proceduralVisual!.debugState().clip).toBe('idle')
    mount.dispose()
  })

  it('plays death once, holds every bone at its final pose, then restores a living mount', () => {
    const mount = new Mount(new THREE.Scene(), type, 0, 0, 0)
    const visual = mount.proceduralVisual!
    const initialPose = visual.skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone().normalize() }))
    mount.takeDamage(999)
    const death = actionFor(visual, 'death')
    mount.update(death.getClip().duration + .1, [])
    const fallenPose = visual.skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone().normalize() }))
    visual.setLocomotion(12)
    visual.playOnce('hit')
    visual.update(5)
    expect(death.loop).toBe(THREE.LoopOnce)
    expect(death.clampWhenFinished).toBe(true)
    expect(death.paused).toBe(true)
    expect(death.time).toBeCloseTo(death.getClip().duration)
    expect(visual.debugState().clip).toBe('death')
    for (const [index, bone] of visual.skeleton.bones.entries()) {
      expect(bone.position.distanceTo(fallenPose[index].position)).toBeLessThan(1e-6)
      expect(bone.quaternion.clone().normalize().angleTo(fallenPose[index].quaternion)).toBeLessThan(.001)
    }
    mount.restoreForTown(5, 9, Math.PI / 2)
    expect(mount.state).toBe(MountState.IDLE)
    expect(mount.currentHp).toBe(mount.maxHp)
    expect(mount.group.visible).toBe(true)
    expect(visual.debugState().clip).toBe('idle')
    for (const [index, bone] of visual.skeleton.bones.entries()) {
      expect(bone.position.distanceTo(initialPose[index].position)).toBeLessThan(1e-6)
      expect(bone.quaternion.clone().normalize().angleTo(initialPose[index].quaternion)).toBeLessThan(.001)
    }
    mount.dispose()
  })

  it('ignores horse-only studio clips without disturbing the selected animal clip', () => {
    const mount = new Mount(new THREE.Scene(), type, 0, 0, 0)
    mount.playStudioClip('walk')
    for (const clip of ['trot', 'canter', 'gallop'] as const) {
      expect(() => mount.playStudioClip(clip)).not.toThrow()
      expect(mount.proceduralVisual!.debugState().clip).toBe('walk')
    }
    mount.dispose()
  })

  it('keeps locomotion in place across complete cycles and intermediate samples', () => {
    const visual = new Visual()
    const torso = visual.root.getObjectByName(`${prefix}_torso`)!
    for (const clip of ['walk', 'run'] as const) {
      visual.playStudioClip(clip)
      const origin = torso.position.clone()
      const step = actionFor(visual, clip).getClip().duration / 24
      for (let index = 0; index < 24 * 3; index++) {
        visual.update(step)
        expect(visual.root.position.toArray()).toEqual([0, 0, 0])
        expect(Math.abs(torso.position.x - origin.x)).toBeLessThan(.06)
        expect(Math.abs(torso.position.z - origin.z)).toBeLessThan(.06)
      }
    }
    visual.dispose()
  })

  it('keeps the skinned paw soles above their resting ground throughout locomotion', () => {
    const visual = new Visual()
    const body = visual.root.getObjectByName(`${prefix}_body_lod0`) as THREE.SkinnedMesh
    const skinIndex = body.geometry.attributes.skinIndex
    const skinWeight = body.geometry.attributes.skinWeight
    const jointIndices = new THREE.Vector4()
    const weights = new THREE.Vector4()
    const point = new THREE.Vector3()
    const feet = ['front_l', 'front_r', 'rear_l', 'rear_r'].map(foot => {
      const [end, side] = foot.split('_')
      const joint = visual.skeleton.bones.findIndex(bone => bone.name === `${prefix}_${end}_paw_${side}`)
      expect(joint).toBeGreaterThanOrEqual(0)
      const candidates: { index: number, height: number }[] = []
      for (let index = 0; index < body.geometry.attributes.position.count; index++) {
        jointIndices.fromBufferAttribute(skinIndex, index)
        weights.fromBufferAttribute(skinWeight, index)
        for (let influence = 0; influence < 4; influence++) {
          if (jointIndices.getComponent(influence) === joint && weights.getComponent(influence) > .35) {
            body.getVertexPosition(index, point).applyMatrix4(body.matrixWorld)
            candidates.push({ index, height: point.y })
            break
          }
        }
      }
      expect(candidates.length, `${foot} weighted paw vertices`).toBeGreaterThan(0)
      const ground = Math.min(...candidates.map(vertex => vertex.height))
      return { foot, ground, vertices: candidates.filter(vertex => vertex.height < ground + .025).map(vertex => vertex.index) }
    })
    for (const clip of ['walk', 'run'] as const) {
      visual.playStudioClip(clip)
      const step = actionFor(visual, clip).getClip().duration / 96
      for (let frame = 0; frame < 96; frame++) {
        for (const foot of feet) {
          let minimum = Infinity
          for (const index of foot.vertices) {
            body.getVertexPosition(index, point).applyMatrix4(body.matrixWorld)
            minimum = Math.min(minimum, point.y)
          }
          expect(minimum, `${foot.foot} ${clip} phase ${frame / 96}`).toBeGreaterThanOrEqual(foot.ground - .025)
        }
        visual.update(step)
      }
    }
    visual.dispose()
  })

  if (type === MountType.BLACK_CAT) {
    it('has a shared airborne stretch with forefeet ahead of the shoulders and rearfeet behind the hips', () => {
      const visual = new Visual()
      const names = ['front_paw_l', 'front_paw_r', 'rear_paw_l', 'rear_paw_r']
      const paws = names.map(name => visual.root.getObjectByName(`${prefix}_${name}`)!)
      const anchors = names.map(name => visual.root.getObjectByName(`${prefix}_${name.replace('paw', 'upper')}`)!)
      const feet = paws.map(() => new THREE.Vector3())
      const joints = anchors.map(() => new THREE.Vector3())
      const sample = () => {
        paws.forEach((paw, index) => paw.getWorldPosition(feet[index]))
        anchors.forEach((anchor, index) => anchor.getWorldPosition(joints[index]))
      }
      const spread = () => (feet[0].z + feet[1].z - feet[2].z - feet[3].z) / 2
      sample()
      const idleSpread = spread()
      const groundHeights = feet.map(point => point.y)
      visual.playStudioClip('run')
      const step = actionFor(visual, 'run').getClip().duration / 120
      let hasSharedStretch = false
      for (let index = 0; index < 120; index++) {
        sample()
        const airborne = feet.every((point, foot) => point.y > groundHeights[foot] + .15)
        const forefeetAhead = feet[0].z > joints[0].z && feet[1].z > joints[1].z
        const rearfeetBehind = feet[2].z < joints[2].z && feet[3].z < joints[3].z
        hasSharedStretch ||= airborne && forefeetAhead && rearfeetBehind && spread() > idleSpread * 1.5
        visual.update(step)
      }
      expect(hasSharedStretch, 'the reference run includes a shared extended flight pose').toBe(true)
      visual.dispose()
    })
  }

  it('preserves the anatomical knee and hock bend directions throughout locomotion', () => {
    const visual = new Visual()
    const incoming = new THREE.Vector3()
    const outgoing = new THREE.Vector3()
    for (const side of ['l', 'r']) {
      const bones = ['upper', 'lower', 'ankle', 'paw'].map(part => visual.root.getObjectByName(`${prefix}_rear_${part}_${side}`)!)
      const points = bones.map(() => new THREE.Vector3())
      const bends = () => {
        for (const [index, bone] of bones.entries()) bone.getWorldPosition(points[index])
        return [0, 1].map(index => {
          incoming.subVectors(points[index + 1], points[index]).normalize()
          outgoing.subVectors(points[index + 2], points[index + 1]).normalize()
          return incoming.y * outgoing.z - incoming.z * outgoing.y
        })
      }
      visual.playStudioClip('idle')
      const reference = bends().map(Math.sign)
      expect(reference.every(sign => sign !== 0)).toBe(true)
      for (const clip of ['walk', 'run'] as const) {
        visual.playStudioClip(clip)
        const step = actionFor(visual, clip).getClip().duration / 48
        for (let index = 0; index < 48; index++) {
          const pose = bends()
          expect(pose[0] * reference[0], `${side} knee ${clip} phase ${index / 48}`).toBeGreaterThanOrEqual(-.005)
          expect(pose[1] * reference[1], `${side} hock ${clip} phase ${index / 48}`).toBeGreaterThanOrEqual(-.005)
          visual.update(step)
        }
      }
    }
    visual.dispose()
  })

  it('evaluates twelve mounts once each while every LOD and tack shares its instance skeleton', () => {
    const visuals = Array.from({ length: 12 }, () => new Visual())
    const camera = new THREE.PerspectiveCamera()
    for (const [index, visual] of visuals.entries()) {
      camera.position.set(0, 0, [3, 25, 50][index % 3])
      camera.updateMatrixWorld(true)
      visual.lod.update(camera)
      expect(visual.lod.levels.filter(level => level.object.visible)).toHaveLength(1)
      const skins = new Set<THREE.Skeleton>()
      visual.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) skins.add(object.skeleton) })
      expect(skins).toEqual(new Set([visual.skeleton]))
      const update = vi.spyOn(visual.mixer, 'update')
      visual.setLocomotion(2)
      for (let frame = 0; frame < 3; frame++) visual.update(1 / 60)
      expect(update).toHaveBeenCalledTimes(3)
      update.mockRestore()
    }
    expect(new Set(visuals.map(visual => visual.mixer)).size).toBe(12)
    expect(new Set(visuals.map(visual => visual.skeleton)).size).toBe(12)
    for (const visual of visuals) visual.dispose()
  })
})
