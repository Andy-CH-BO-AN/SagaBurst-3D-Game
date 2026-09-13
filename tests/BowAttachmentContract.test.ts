import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  DEFAULT_BOW_GRIP_PROFILE,
  getBowHandGripFrame,
  getBowWeaponGripFrame,
  computeBowSocketAttachment,
  applyBowAttachment,
  updateBowOrientation,
  isGripOnPalmarSide,
  getGripSignedDistance,
} from '../src/world/BowAttachmentContract'

describe('BowAttachmentContract', () => {
  it('defines canonical BowGripProfile shared across factions with single source of truth scale', () => {
    expect(DEFAULT_BOW_GRIP_PROFILE.id).toBe('bow_standard')
    expect(DEFAULT_BOW_GRIP_PROFILE.gripRadius).toBeCloseTo(0.028)
    expect(DEFAULT_BOW_GRIP_PROFILE.gripLength).toBeCloseTo(0.14)
    expect(DEFAULT_BOW_GRIP_PROFILE.visualScale).toBeCloseTo(1)
    expect(DEFAULT_BOW_GRIP_PROFILE.shootingAxis).toEqual(new THREE.Vector3(0, 0, -1))
    expect(DEFAULT_BOW_GRIP_PROFILE.longitudinalAxis).toEqual(new THREE.Vector3(0, 1, 0))
    expect(DEFAULT_BOW_GRIP_PROFILE.contactNormal).toEqual(new THREE.Vector3(-1, 0, 0))
  })

  it('checks the contact plane only (not mesh intersection) for two differently oriented fixtures', () => {
    const romanFrame = {
      palmContactCenter: new THREE.Vector3(0.015, 0.070, -0.077),
      palmNormal: new THREE.Vector3(0, 0, -1),
      thumbDir: 1,
    }
    const vikingFrame = {
      palmContactCenter: new THREE.Vector3(-0.018, 0.10, 0.015),
      palmNormal: new THREE.Vector3(-1, 0, 0),
      thumbDirection: new THREE.Vector3(0, 0, -1),
      thumbDir: -1,
    }

    // Roman grip center: palmContactCenter + palmNormal * radius
    const romanGripCenter = new THREE.Vector3()
      .copy(romanFrame.palmContactCenter)
      .addScaledVector(romanFrame.palmNormal, DEFAULT_BOW_GRIP_PROFILE.gripRadius)
    expect(isGripOnPalmarSide(romanGripCenter, romanFrame)).toBe(true)
    expect(getGripSignedDistance(romanGripCenter, romanFrame)).toBeCloseTo(0.028)

    // Viking grip center: palmContactCenter + palmNormal * radius
    const vikingGripCenter = new THREE.Vector3()
      .copy(vikingFrame.palmContactCenter)
      .addScaledVector(vikingFrame.palmNormal, DEFAULT_BOW_GRIP_PROFILE.gripRadius)
    expect(isGripOnPalmarSide(vikingGripCenter, vikingFrame)).toBe(true)
    expect(getGripSignedDistance(vikingGripCenter, vikingFrame)).toBeCloseTo(0.028)
  })

  it('validates that Roman and Viking manifest.json files export valid HandGripFrame on rig metadata', async () => {
    const { readFileSync } = await import('node:fs')
    const romanManifest = JSON.parse(readFileSync(new URL('../public/models/characters/v2/roman/manifest.json', import.meta.url), 'utf8'))
    const vikingManifest = JSON.parse(readFileSync(new URL('../public/models/characters/v2/viking/manifest.json', import.meta.url), 'utf8'))

    expect(romanManifest.handGripFrames?.left).toBeDefined()
    expect(vikingManifest.handGripFrames?.left).toBeDefined()

    const rHg = romanManifest.handGripFrames.left
    const vHg = vikingManifest.handGripFrames.left

    const rFrame = {
      palmContactCenter: new THREE.Vector3(...rHg.palmContactCenter),
      palmNormal: new THREE.Vector3(...rHg.palmNormal),
      thumbDir: rHg.thumbDir,
      thumbDirection: new THREE.Vector3(...rHg.thumbDirection),
    }
    const vFrame = {
      palmContactCenter: new THREE.Vector3(...vHg.palmContactCenter),
      palmNormal: new THREE.Vector3(...vHg.palmNormal),
      thumbDir: vHg.thumbDir,
      thumbDirection: new THREE.Vector3(...vHg.thumbDirection),
    }

    const rGrip = new THREE.Vector3().copy(rFrame.palmContactCenter).addScaledVector(rFrame.palmNormal, DEFAULT_BOW_GRIP_PROFILE.gripRadius)
    const vGrip = new THREE.Vector3().copy(vFrame.palmContactCenter).addScaledVector(vFrame.palmNormal, DEFAULT_BOW_GRIP_PROFILE.gripRadius)

    expect(isGripOnPalmarSide(rGrip, rFrame)).toBe(true)
    expect(isGripOnPalmarSide(vGrip, vFrame)).toBe(true)
    expect(getGripSignedDistance(rGrip, rFrame)).toBeCloseTo(0.028)
    expect(getGripSignedDistance(vGrip, vFrame)).toBeCloseTo(0.028)
  })

  it('computes valid socket attachment without NaNs', () => {
    const socket = new THREE.Object3D()
    socket.position.set(0, 0.07, 0)
    socket.rotation.set(0.1, 0.2, 0.3)
    socket.updateMatrix()

    const { position, quaternion, scale } = computeBowSocketAttachment(socket)
    expect(Number.isFinite(position.x)).toBe(true)
    expect(Number.isFinite(position.y)).toBe(true)
    expect(Number.isFinite(position.z)).toBe(true)
    expect(Number.isFinite(quaternion.w)).toBe(true)
    expect(scale.x).toBeCloseTo(1)
    expect(scale.y).toBeCloseTo(1)
    expect(scale.z).toBeCloseTo(1)
  })

  it('applies attachment onto bow pivot', () => {
    const socket = new THREE.Object3D()
    socket.position.set(0, 0.07, 0)
    const bowPivot = new THREE.Object3D()
    socket.add(bowPivot)

    applyBowAttachment(socket, bowPivot)
    expect(bowPivot.position.lengthSq()).toBeGreaterThan(0)
    expect(Number.isFinite(bowPivot.quaternion.x)).toBe(true)
  })

  it('orientates bow upright towards targetWorld', () => {
    const root = new THREE.Object3D()
    const socket = new THREE.Object3D()
    socket.position.set(0, 1.4, 0)
    root.add(socket)
    const bowPivot = new THREE.Object3D()
    socket.add(bowPivot)
    root.updateWorldMatrix(true, true)

    applyBowAttachment(socket, bowPivot)

    const targetWorld = new THREE.Vector3(0, 1.4, 10)
    updateBowOrientation(socket, bowPivot, targetWorld)

    const bowWorldQuat = new THREE.Quaternion()
    bowPivot.getWorldQuaternion(bowWorldQuat)

    // Check upright body axis (+Y): should point predominantly towards world up (0, 1, 0)
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bowWorldQuat)
    expect(bodyUp.y).toBeGreaterThan(0.99)

    // Check shooting axis (-Z): should point towards target (0, 0, 1) in world
    const shootDir = new THREE.Vector3(0, 0, -1).applyQuaternion(bowWorldQuat)
    expect(shootDir.z).toBeGreaterThan(0.99)
  })

  it('falls back gracefully when targetWorld is undefined without throwing or flipping', () => {
    const root = new THREE.Object3D()
    const socket = new THREE.Object3D()
    socket.position.set(0, 1.4, 0)
    root.add(socket)
    const bowPivot = new THREE.Object3D()
    socket.add(bowPivot)
    root.updateWorldMatrix(true, true)

    applyBowAttachment(socket, bowPivot)
    expect(() => updateBowOrientation(socket, bowPivot, undefined)).not.toThrow()

    const bowWorldQuat = new THREE.Quaternion()
    bowPivot.getWorldQuaternion(bowWorldQuat)
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bowWorldQuat)
    expect(bodyUp.y).toBeGreaterThan(0.99)
  })
})
