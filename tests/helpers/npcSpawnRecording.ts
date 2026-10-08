import * as THREE from 'three'
import { vi } from 'vitest'
import type { AIType, Faction, NPC } from '../../src/world/NPC'
import type { MountType } from '../../src/world/Mount'

/** Constructor-boundary observations only: these actors do not simulate combat or locomotion.
 * Callers still own roster selection, enqueue, registration, readiness and resource ownership.
 * Mount calls prove the caller protocol; real NPC.mountVehicle has separate real-actor owners.
 */
export const recording = { npcs: [] as RecordingNpc[], mounts: [] as RecordingMount[] }

export function resetSpawnRecording(): void {
  recording.npcs.length = 0
  recording.mounts.length = 0
}

export class RecordingNpc {
  readonly group = new THREE.Group()
  maxHp = 100
  hp = 100
  encounterState = 'peaceful'
  encounterIsAlerted = false
  dead = false
  respawnEnabled = false
  missionMovement = false
  mount: RecordingMount | null = null
  tacticalOrder = 'defend'
  shield = { shieldImpactRemaining: 100, shieldImpactMax: 100 }
  combatAmmo = 30
  formationTarget?: { position: THREE.Vector3; speedLimit?: number }
  formationCommandId: number | null = null
  activeFollowTarget: unknown = null

  constructor(scene: THREE.Scene, x: number, z: number, readonly faction: Faction,
    readonly characterFaction: string, readonly aiType: AIType, readonly name: string,
    public tier: number, readonly mountedInput: boolean, public loadout: ConstructorParameters<typeof NPC>[9],
    readonly presetId?: string, public squadId?: string | number, readonly combatantId = name,
    readonly emit?: unknown, readonly visualAssetId?: string, readonly combatProfileId?: string,
    readonly specialCombatProfile?: string) {
    recording.npcs.push(this)
    this.group.position.set(x, 0, z)
    scene.add(this.group)
  }

  get combatPosition(): THREE.Vector3 { return this.mount?.group.position ?? this.group.position }
  get isMounted(): boolean { return Boolean(this.mount) }
  readonly setTownPeaceful = vi.fn()
  readonly configureBanditEncounter = vi.fn()
  readonly clearEncounter = vi.fn()
  readonly triggerEncounterAlert = vi.fn(() => { this.encounterIsAlerted = true })
  readonly setMissionCombatTarget = vi.fn()
  readonly assignSiegeObstacle = vi.fn()
  readonly beginExternalThreat = vi.fn()
  readonly endExternalThreat = vi.fn()
  readonly restoreCombatLoadout = vi.fn()
  readonly applyTemporaryCombatLoadout = vi.fn((loadout: ConstructorParameters<typeof NPC>[9], tier?: number, squadId?: number) => {
    this.loadout = loadout; if (tier !== undefined) this.tier = tier; if (squadId !== undefined) this.squadId = squadId
  })
  readonly setTacticalOrder = vi.fn((order: string) => { this.tacticalOrder = order })
  readonly assignFollowTarget = vi.fn((target: unknown) => { this.activeFollowTarget = target; this.tacticalOrder = 'follow' })
  readonly assignFormationTarget = vi.fn((id: number, position: THREE.Vector3, _forward?: THREE.Vector3, speedLimit?: number) => {
    this.formationCommandId = id; this.formationTarget = { position, speedLimit }; this.tacticalOrder = 'formation'
  })
  readonly isFormationTargetReached = vi.fn(() => false)
  readonly mountVehicle = vi.fn((mount: RecordingMount) => { this.mount = mount; mount.riderNpc = this })
  readonly dismountFromMount = vi.fn(() => { if (this.mount) this.mount.riderNpc = null; this.mount = null })
  readonly restoreCombatHealth = vi.fn((hp: number) => { this.hp = hp; this.dead = hp === 0 })
  readonly restoreCombatAmmo = vi.fn((ammo: number) => { this.combatAmmo = ammo })
  readonly dispose = vi.fn(() => { this.dismountFromMount(); this.group.removeFromParent() })
}

export class RecordingMount {
  readonly group = new THREE.Group()
  riderNpc: RecordingNpc | null = null
  currentHp = 100
  maxHp = 100
  baseSpeed = 10
  dead = false
  constructor(scene: THREE.Scene, readonly type: MountType, x: number, z: number) {
    recording.mounts.push(this)
    this.group.position.set(x, 0, z)
    scene.add(this.group)
  }
  readonly dispose = vi.fn(() => { this.group.removeFromParent() })
}
