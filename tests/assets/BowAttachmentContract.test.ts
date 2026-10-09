import { describe, it, expect, onTestFinished } from 'vitest'
import { preloadTinyRangerBow } from '../helpers/rangerBowVisual'
import { BOW_STRING_CONTACT, BOW_ARROW_REST } from '../../src/world/BowDrawHand'
import { CharacterBowVisual } from '../../src/world/CharacterBowVisual'
import { createMakiRangerBowInstance } from '../../src/world/MakiRangerEquipment'
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
} from '../../src/world/BowAttachmentContract'

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
    const romanManifest = JSON.parse(readFileSync(new URL('../../public/models/characters/v2/roman/manifest.json', import.meta.url), 'utf8'))
    const vikingManifest = JSON.parse(readFileSync(new URL('../../public/models/characters/v2/viking/manifest.json', import.meta.url), 'utf8'))

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

it('T4 weapon identity uses its asset with a canonical palm grip, survives rebuilds, and isolates mutable instance calibration', async () => {
  const asset = await preloadTinyRangerBow()
  onTestFinished(() => asset.dispose())
  const hand = new THREE.Group(), socket = new THREE.Group(), action = new THREE.Group(), grip = new THREE.Group()
  hand.add(socket); socket.add(action); action.add(grip)
  socket.userData.handGripFrame = {
    palmContactCenter: new THREE.Vector3(), palmNormal: new THREE.Vector3(-1, 0, 0),
    thumbDirection: new THREE.Vector3(0, 1, 0), thumbDir: 1,
  }
  const bow = new CharacterBowVisual(action, grip, hand)
  for (const id of ['maki-ranger-bow-ranged', 'elven_runebow', 'maki-ranger-bow', 'wooden_shortbow', 'maki-ranger-bow-ranged']) {
    grip.position.set(2, 3, 4); grip.rotation.set(.5, .6, .7); grip.scale.setScalar(2)
    bow.rebuild(id)
    hand.updateMatrixWorld(true)
    const special = id.startsWith('maki-ranger-bow')
    expect(asset.containsBody(grip), id).toBe(special)
    // Independent physical contract: an upright bow shoots forward and its
    // grip center lies one handle radius into the palm's contact half-space.
    expect(new THREE.Vector3(0, 0, -1).transformDirection(grip.matrixWorld).z, id).toBeGreaterThan(.999)
    expect(new THREE.Vector3(0, 1, 0).transformDirection(grip.matrixWorld).y, id).toBeGreaterThan(.999)
    expect(bow.getGripPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(special ? -.016 : -.028, 0, 0))).toBeLessThan(.00001)
  }
  const a = createMakiRangerBowInstance(), b = createMakiRangerBowInstance()
  const expected = { rotation: b.model.quaternion.clone(), tip: b.topTip.clone(),
    normal: b.profile.contactNormal.clone(), calibration: b.profile.handCalibrations!['maki-archer-t4'].contactNormal.clone() }
  a.model.rotation.y = 1; a.topTip.setScalar(99); a.profile.contactNormal.setScalar(99)
  a.profile.handCalibrations!['maki-archer-t4'].contactNormal.setScalar(99)
  const c = createMakiRangerBowInstance()
  for (const untouched of [b, c]) {
    expect(untouched.model.quaternion.angleTo(expected.rotation)).toBeLessThan(.00001)
    expect(untouched.topTip.distanceTo(expected.tip)).toBeLessThan(.00001)
    expect(untouched.profile.contactNormal.distanceTo(expected.normal)).toBeLessThan(.00001)
    expect(untouched.profile.handCalibrations!['maki-archer-t4'].contactNormal.distanceTo(expected.calibration)).toBeLessThan(.00001)
  }
})

describe('CharacterBowVisual actor contact ownership', () => {
  // Zero actors/assets: only the socket hierarchy and real bow presentation.
  function fixture() {
    const scene = new THREE.Scene()
    const owner = new THREE.Group(), foreign = new THREE.Group()
    const hand = new THREE.Group(), socket = new THREE.Group(), action = new THREE.Group(), grip = new THREE.Group()
    scene.add(foreign, owner)
    owner.add(hand); hand.add(socket); socket.add(action); action.add(grip)
    socket.userData.handGripFrame = {
      palmContactCenter: new THREE.Vector3(), palmNormal: new THREE.Vector3(-1, 0, 0),
      thumbDirection: new THREE.Vector3(0, 1, 0), thumbDir: 1,
    }
    foreign.position.set(80, 30, -40)
    const foreignContact = new THREE.Object3D(), foreignRest = new THREE.Object3D()
    foreignContact.name = BOW_STRING_CONTACT; foreignRest.name = BOW_ARROW_REST
    foreignRest.position.z = -1
    foreign.add(foreignContact, foreignRest)
    const bow = new CharacterBowVisual(action, grip, owner)
    function rebuild() {
      bow.rebuild('wooden_shortbow')
      // Capture each rebuilt instance before clear(); never dispose cached materials.
      const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      grip.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        geometry.add(object.geometry)
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!material.name.startsWith('procedural-')) materials.add(material)
        }
      })
      onTestFinished(() => { geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()) })
    }
    rebuild()
    function update() {
      scene.updateMatrixWorld(true)
      bow.update(1, undefined, true)
      scene.updateMatrixWorld(true)
      return bow.getNockPosition(new THREE.Vector3())
    }
    function addContact(name: string, position: THREE.Vector3) {
      const contact = new THREE.Object3D()
      contact.name = name; contact.position.copy(position); owner.add(contact)
      return contact
    }
    return { scene, owner, foreign, foreignContact, grip, bow, update, rebuild, addContact }
  }

  it('missing local contacts use a short local nock instead of foreign scene contacts', () => {
    const { bow, foreign, grip, update } = fixture()
    let nock!: THREE.Vector3
    expect(() => { nock = update() }).not.toThrow()
    expect(nock.distanceTo(bow.getGripPosition(new THREE.Vector3()))).toBeLessThan(1)
    for (const mesh of grip.children) {
      if (mesh instanceof THREE.Mesh && mesh.geometry instanceof THREE.CylinderGeometry) {
        expect(mesh.geometry.parameters.height * mesh.scale.y).toBeLessThan(2)
      }
    }
    foreign.position.set(-100, 70, 100)
    expect(update().distanceTo(nock)).toBeLessThan(1e-6)
  })

  it('only the owning actor contact drives the nock when another actor has the same name', () => {
    const { bow, foreign, update, addContact } = fixture()
    const contact = addContact(BOW_STRING_CONTACT, new THREE.Vector3(.1, .2, .4))
    const before = update()
    expect(before.distanceTo(contact.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6)
    foreign.position.set(-90, 60, 120)
    expect(update().distanceTo(before)).toBeLessThan(1e-6)
    contact.position.z += .15
    expect(update().distanceTo(before)).toBeCloseTo(.15)
    expect(bow.getNockPosition(new THREE.Vector3()).distanceTo(contact.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6)
  })

  it('a foreign arrow rest cannot steer the nocked arrow when local contacts are missing', () => {
    const { bow, foreign, foreignContact, grip, update } = fixture()
    foreignContact.removeFromParent()
    const nock = update()
    const tip = bow.getArrowTipPosition(new THREE.Vector3())
    const forward = new THREE.Vector3(0, 0, -1).transformDirection(grip.matrixWorld)
    expect(tip.clone().sub(nock).normalize().dot(forward)).toBeGreaterThan(.999)
    foreign.position.set(-100, -40, 80)
    update()
    expect(bow.getArrowTipPosition(new THREE.Vector3()).distanceTo(tip)).toBeLessThan(1e-6)
  })

  it.each([false, true])('replaced rig contacts are rediscovered after rebuild=%s without retaining detached contacts', rebuildBow => {
    const { bow, update, rebuild, addContact } = fixture()
    const oldContact = addContact(BOW_STRING_CONTACT, new THREE.Vector3(.1, .2, .4))
    const oldRest = addContact(BOW_ARROW_REST, new THREE.Vector3(.1, .2, -.4))
    update()
    oldContact.removeFromParent(); oldRest.removeFromParent()
    oldContact.position.set(50, 30, 80); oldRest.position.set(-60, 40, 80)
    const contact = addContact(BOW_STRING_CONTACT, new THREE.Vector3(.15, .25, .3))
    const rest = addContact(BOW_ARROW_REST, new THREE.Vector3(.15, .25, -.5))
    if (rebuildBow) rebuild()
    const nock = update()
    expect(nock.distanceTo(contact.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-6)
    const arrowDirection = bow.getArrowTipPosition(new THREE.Vector3()).sub(nock).normalize()
    expect(arrowDirection.dot(rest.getWorldPosition(new THREE.Vector3()).sub(nock).normalize())).toBeGreaterThan(.999)
  })
})
