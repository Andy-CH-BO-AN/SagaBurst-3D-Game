import { vi } from 'vitest'
import { TownDefenseController } from '../../src/career/TownDefenseController'
import type { CareerProfile } from '../../src/career/CareerProfile'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'

/** Numeric actor/controller ports for target accounting and the ceasefire boundary; no scene or actor construction. */
export function townAssaultRuntime(readProfile: () => CareerProfile, specs: readonly TownActorSpec[] = townRoster()) {
  const residents = specs.map(spec => ({ spec, npc: {
    combatantId: spec.id, dead: false, hp: 42, missionMovement: true,
    mount: undefined as { dead: boolean; currentHp: number; eagleAttack?: { cancel(): void } } | undefined,
    setTownPeaceful: vi.fn(), setMissionCombatTarget: vi.fn(), assignSiegeObstacle: vi.fn(),
  }, homeMount: spec.eagle ? { dead: false, currentHp: 30, eagleAttack: { cancel: vi.fn() } } : undefined }))
  const active = readProfile().activeMission!
  const casualties = new Set(active.deadFriendlyActorIds)
  const enemies = active.friendlyActorIds.filter(id => !casualties.has(id)).map(combatantId => ({ combatantId, dead: false }))
  const ports = {
    readProfile, residents, enemies, siege: active.siege, startedMissionId: active.id,
    rosterCommitPending: false, spawnBatch: undefined as { pending: number; status: string; ready: boolean } | undefined,
  }
  // This boundary supplies only fields read by the production accounting and ceasefire methods.
  const owner = Object.assign(Object.create(TownDefenseController.prototype) as Pick<TownDefenseController,
    'evaluate' | 'remainingAssaultGroundDefenders' | 'ceaseAssaultAirSupport'>, ports)
  return { owner, ports, residents, enemies }
}
