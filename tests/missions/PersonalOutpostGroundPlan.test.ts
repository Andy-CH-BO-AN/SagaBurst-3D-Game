import * as THREE from 'three'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createCaptainFrontlineLaunch, createCaptainFrontlineSpawnPlan } from '../../src/career/CaptainBattleLaunch'
import { createCampaignOutpost, getCampaignDefenderFacingYaw, getCampaignOutpostPlacement } from '../../src/campaign/CampaignOutpost'
import { findEagleLandingPosition } from '../../src/world/EagleLanding'
import { describe, expect, it, vi } from 'vitest'
import { personalOutpostDeployment } from '../../src/career/PersonalSquadDeployment'
import { planPersonalOutpostGround } from '../../src/career/PersonalOutpostGroundPlan'

const anchor = { x: 0, z: 0, yaw: 0 }
const slots = (count: number) => Array.from({ length: count }, (_, i) => ({ x: i * 6 + 6, z: -20, yaw: 0 }))

describe('Career Outpost personal squad deployment policy', () => {
  it('requires 28 ground positions for Player eagle, 2 squad eagles and 28 ground riders', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `personal:${i}`)
    const allocate = vi.fn(slots)
    const planned = planPersonalOutpostGround(ids, new Set(ids.slice(0, 2)), true, anchor, allocate)
    expect(allocate).toHaveBeenCalledExactlyOnceWith(28, false)
    expect(planned.groundPositions).toHaveLength(28)
    expect(planned.regularMuster.slice(2)).toEqual(slots(28))
    expect(planned.regularMuster).toHaveLength(30)
  })

  it('preserves un-compacted member indices when eagle riders are interleaved', () => {
    const ids = ['ground-a', 'eagle-a', 'ground-b', 'eagle-b', 'ground-c']
    const planned = planPersonalOutpostGround(ids, new Set(['eagle-a', 'eagle-b']), true, anchor, slots)
    expect([planned.regularMuster[0], planned.regularMuster[2], planned.regularMuster[4]]).toEqual(slots(3))
    expect([planned.regularMuster[1], planned.regularMuster[3]]).toEqual([anchor, anchor])
  })

  it('reserves a Player ground position for non-flying full rosters', () => {
    const allocate = vi.fn(slots)
    const planned = planPersonalOutpostGround(['a', 'b'], new Set(), false, anchor, allocate)
    expect(allocate).toHaveBeenCalledExactlyOnceWith(3, true)
    expect(planned.playerPosition).toEqual(slots(3)[0])
    expect(planned.regularMuster).toEqual(slots(3).slice(1))
  })

  it('does not request ground space for an all-air roster', () => {
    const allocate = vi.fn(() => { throw new Error('No ground space') })
    const planned = planPersonalOutpostGround(['e1', 'e2'], new Set(['e1', 'e2']), true, anchor, allocate)
    expect(allocate).not.toHaveBeenCalled()
    expect(planned.groundPositions).toEqual([])
    expect(planned.regularMuster).toEqual([anchor, anchor])
  })

  it('throws on incomplete ground allocation rather than dropping squad members', () => {
    expect(() => planPersonalOutpostGround(['a'], new Set(), true, anchor, () => []))
      .toThrow('Incomplete personal ground deployment')
  })

  it.each(['viking', 'roman'] as const)(
    'plans actual Stage IX %s Outpost geometry with 28 ground members and three flight pads',
    faction => {
      // Production Stage IX spec positions plus actual fort obstacles/navigation;
      // no NPCs, Mounts, visual GLBs or spawn scheduler are constructed.
      const profile = createCareerProfile(faction)
      profile.activeMission = {
        id: 'stage-ix-fixture', templateId: 'captain-frontline-command',
        kind: 'captain-outpost-defense', targetCampId: -1, phase: 'PREPARING',
        acceptedAt: 1, friendlyActorIds: [], targetActorIds: [],
      }
      const official = createCaptainFrontlineSpawnPlan(createCaptainFrontlineLaunch(profile))
        .npcSpecs.map(spec => ({ x: spec.x, z: spec.z }))
      const outpost = createCampaignOutpost(new THREE.Scene(), faction)
      const placement = getCampaignOutpostPlacement(faction)
      const bounds = {
        minX: placement.centerX - placement.halfWidth, maxX: placement.centerX + placement.halfWidth,
        minZ: Math.min(placement.frontZ, placement.backZ), maxZ: Math.max(placement.frontZ, placement.backZ),
      }
      const navigation = new NavigationWorld()
      navigation.sync(outpost.obstacles)
      const yaw = getCampaignDefenderFacingYaw(faction)
      const slots = personalOutpostDeployment({
        x: placement.centerX, z: (placement.frontZ + placement.backZ) / 2, yaw,
      }, official, 28, bounds, outpost.obstacles, navigation)
      expect(slots).toHaveLength(28)
      const occupied = [...official, ...slots]
      const pads = []
      for (let i = 0; i < 3; i++) {
        const position = findEagleLandingPosition({
          x: placement.centerX, z: placement.backZ + Math.sign(placement.backZ - placement.frontZ) * 20, yaw,
        }, outpost.obstacles, occupied, 300, 150)
        expect(position).not.toBeNull()
        if (position) { occupied.push(position); pads.push(position) }
      }
      expect(pads).toHaveLength(3)
    },
  )

  it.each([
    { name: 'Viking +Z fort', yaw: Math.PI, minZ: 108, maxZ: 180, expectedRear: 174 },
    { name: 'Roman -Z fort', yaw: 0, minZ: -180, maxZ: -108, expectedRear: -174 },
  ])('$name: fits 28 separated riders inside the defender rectangle', ({ yaw, minZ, maxZ, expectedRear }) => {
    // Navigation implementation is not the owner here; this test validates
    // the placement policy's bound, spacing and rear-first behavior.
    const navigation = { areConnected: () => true } as unknown as NavigationWorld
    const bounds = { minX: -44, maxX: 44, minZ, maxZ }
    const planned = personalOutpostDeployment({ x: 0, z: (minZ + maxZ) / 2, yaw },
      [{ x: 0, z: expectedRear }], 28, bounds, [], navigation)
    expect(planned).toHaveLength(28)
    for (const point of planned) {
      expect(point.x).toBeGreaterThan(bounds.minX + 3)
      expect(point.x).toBeLessThan(bounds.maxX - 3)
      expect(point.z).toBeGreaterThan(bounds.minZ + 3)
      expect(point.z).toBeLessThan(bounds.maxZ - 3)
      expect(Math.hypot(point.x, point.z - expectedRear)).toBeGreaterThanOrEqual(4.8)
    }
    for (const [index, a] of planned.entries()) for (const b of planned.slice(index + 1)) {
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(4.8)
    }
  })
})
