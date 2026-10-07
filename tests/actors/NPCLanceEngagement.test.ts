import { describe, expect, it, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { NPC, Faction, AIType } from '../../src/world/NPC'

describe('NPC lance engagement', () => {
  it('NPC Lance: forward reach within 3.9m corridor hits, behind does not hit', () => {
    const scene = new THREE.Scene()
    const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'LanceFighter', 2, false)
    onTestFinished(() => npc.dispose())
    npc.isUsingLance = true
    npc.meleeAttackRadius = 3.9

    // NPC facing yaw = 0 means forward is (0, 0, 1) (+Z)
    // Target 2.5m in front of NPC (forwardDist = 2.5, lateralDist = 0.2)
    const inFrontTarget = new THREE.Vector3(0.2, 0, 2.5)
    expect((npc as any)._isTargetInMeleeRange(inFrontTarget)).toBe(true)

    // Target behind NPC (forwardDist = -1.5)
    const behindTarget = new THREE.Vector3(0, 0, -1.5)
    expect((npc as any)._isTargetInMeleeRange(behindTarget)).toBe(false)

    // Target far to the side (forwardDist = 1.0, lateralDist = 2.5 > 1.4)
    const sideTarget = new THREE.Vector3(2.5, 0, 1.0)
    expect((npc as any)._isTargetInMeleeRange(sideTarget)).toBe(false)
  })
})
