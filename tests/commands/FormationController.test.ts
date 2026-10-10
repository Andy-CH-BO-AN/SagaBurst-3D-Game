import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { Faction, type NPC } from '../../src/world/NPC'
import { FormationController } from '../../src/battle/FormationController'
import { getTerrainHeight, PLAYABLE_WORLD_BOUND } from '../../src/world/Terrain'

import { createFormationPlacementHarness, placementParticipant, blockingBox } from '../helpers/formationPlacement'
function placementHarness(...args: Parameters<typeof createFormationPlacementHarness>) {
  const fixture = createFormationPlacementHarness(...args)
  onTestFinished(() => fixture.formation.cancelPlacement())
  return fixture
}

describe('Formation placement and confirmation', () => {
  it('uses explicit authority for mixed Town and flying members, placing only the flyer at cruise height', () => {
    const foot = { ...placementParticipant('official', -10), faction: Faction.TOWN }
    const flyer = { ...placementParticipant('personal', 10, true), mount: { isFlyingMount: true } }
    const bystander = placementParticipant('bystander', 20)
    const formation = new FormationController(new THREE.Scene(), new THREE.PerspectiveCamera(),
      [foot, flyer, bystander] as unknown as NPC[], new THREE.Object3D(), [])
    onTestFinished(() => formation.cancelPlacement())
    formation.setParticipantPolicy(npc => npc.name === 'official' || npc.name === 'personal')
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: new THREE.Vector3(0, getTerrainHeight(0, 0), 0) }])
    formation.beginPlacement('all')
    expect(formation.confirmPlacement().count).toBe(2)
    const groundSlot = foot.assignFormationTarget.mock.calls[0][1] as THREE.Vector3
    const airSlot = flyer.assignFormationTarget.mock.calls[0][1] as THREE.Vector3
    expect(groundSlot.y).toBe(getTerrainHeight(groundSlot.x, groundSlot.z))
    expect(airSlot.y).toBe(getTerrainHeight(airSlot.x, airSlot.z) + 30)
    expect(bystander.assignFormationTarget).not.toHaveBeenCalled()
  })

  it('joins a refitted actor in a free slot without moving existing members and waits for its arrival', () => {
    // Two recording actors, no real NPC/Mount/world: this protects formation handover/completion wiring.
    const member = (name: string, x: number) => {
      let saved: NPC['combatFormationCheckpoint']
      const actor = { name, dead: false, isMounted: false, combatPosition: new THREE.Vector3(x, 0, 0),
        get formationCommandId() { return saved?.commandId ?? null },
        get combatFormationCheckpoint() { return saved },
        assignFormationTarget: vi.fn((id: number, point: THREE.Vector3) => {
          saved = { commandId: id, position: { x: point.x, z: point.z, yaw: 0 }, reached: false }
        }),
        isFormationTargetReached: vi.fn(() => false),
      }
      return { actor, npc: actor as unknown as NPC }
    }
    const reference = member('reference', 100), joining = member('joining', 0)
    reference.npc.assignFormationTarget(7, new THREE.Vector3(100, 0, 100), new THREE.Vector3(0, 0, 1))
    reference.actor.isFormationTargetReached.mockReturnValue(true)
    const saved = reference.npc.combatFormationCheckpoint
    const formation = new FormationController(new THREE.Scene(), new THREE.PerspectiveCamera(),
      [reference.npc, joining.npc], new THREE.Object3D(), [blockingBox(97, 101, 97, 103)])
    onTestFinished(() => formation.cancelPlacement())
    const completed = vi.fn(); formation.setCompletionHandler(completed)
    expect(formation.joinCommand(joining.npc, reference.npc)).toBe(true)
    const slot = joining.actor.assignFormationTarget.mock.calls[0][1]
    expect(joining.npc.formationCommandId).toBe(7)
    expect(slot.distanceTo(new THREE.Vector3(100, slot.y, 100))).toBeGreaterThanOrEqual(1)
    expect(slot.x < 96.5 || slot.x > 101.5 || slot.z < 96.5 || slot.z > 103.5).toBe(true)
    expect(reference.npc.combatFormationCheckpoint).toEqual(saved)
    expect(reference.actor.assignFormationTarget).toHaveBeenCalledOnce()
    formation.updateCompletion(); expect(completed).not.toHaveBeenCalled()
    joining.actor.isFormationTargetReached.mockReturnValue(true)
    formation.updateCompletion(); expect(completed).toHaveBeenCalledOnce()
  })

  it('keeps every ideal slot when no obstacle blocks it', () => {
    const center = new THREE.Vector3(12, getTerrainHeight(12, -8), -8)
    const participants = [placementParticipant('left', -1), placementParticipant('right', 1)]
    const { formation, solve } = placementHarness([], participants)
    const make = vi.spyOn(formation as any, 'makeFormation')
    const placement = solve(center)

    expect(placement?.center).toEqual(center)
    expect(placement?.slots).toEqual([
      new THREE.Vector3(11, getTerrainHeight(11, -8), -8),
      new THREE.Vector3(13, getTerrainHeight(13, -8), -8),
    ])
    expect(make).toHaveBeenCalledOnce()
  })

  it('moves only the blocked unit while preserving the formation center and clear slot', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participants = [placementParticipant('a', -1), placementParticipant('b', 1)]
    const { solve } = placementHarness([blockingBox(-1.2, -0.8, -0.2, 0.2)], participants)
    const first = solve(center)
    const second = solve(center)

    expect(first).not.toBeNull()
    expect(first?.center).toEqual(center)
    expect(first?.slots).toEqual(second?.slots)
    expect(first?.slots[1].x).toBe(1)
    expect(first?.slots[1].z).toBe(0)
    expect(first?.slots[0].equals(new THREE.Vector3(-1, getTerrainHeight(-1, 0), 0))).toBe(false)
    expect(first?.slots[0].distanceToSquared(first!.slots[1])).toBeGreaterThanOrEqual(1)
  })

  it('moves two blocked units to distinct free slots without shifting their neighbors', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participants = Array.from({ length: 5 }, (_, index) => placementParticipant(`p-${index}`, index - 2))
    const { solve } = placementHarness([blockingBox(-2.2, 0.3, -0.5, 0.5)], participants)
    const placement = solve(center)
    const ideal = [-4, -2, 0, 2, 4]

    expect(placement?.center).toEqual(center)
    expect([0, 3, 4].map(index => placement?.slots[index].x)).toEqual([-4, 2, 4])
    expect([0, 3, 4].every(index => placement?.slots[index].z === 0)).toBe(true)
    expect([1, 2].every(index => placement?.slots[index].x !== ideal[index] || placement?.slots[index].z !== 0)).toBe(true)
    expect(new Set(placement?.slots.map(slot => `${slot.x},${slot.z}`)).size).toBe(5)
    for (let left = 0; left < 5; left++) for (let right = left + 1; right < 5; right++) {
      const dx = placement!.slots[left].x - placement!.slots[right].x
      const dz = placement!.slots[left].z - placement!.slots[right].z
      expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps clear slots and whole-formation boundary shift when one edge slot is blocked', () => {
    const edge = PLAYABLE_WORLD_BOUND - 1
    const center = new THREE.Vector3(edge, getTerrainHeight(edge, 0), 0)
    const participants = Array.from({ length: 5 }, (_, index) => placementParticipant(`p-${index}`, index))
    const { solve } = placementHarness([blockingBox(edge - 7.3, edge - 6.7, -0.5, 0.5)], participants)
    const placement = solve(center)

    expect(placement).not.toBeNull()
    expect(placement?.center.x).toBe(PLAYABLE_WORLD_BOUND - 4)
    expect(placement?.center.z).toBe(0)
    expect(placement?.slots.every(slot => Math.abs(slot.x) <= PLAYABLE_WORLD_BOUND && Math.abs(slot.z) <= PLAYABLE_WORLD_BOUND)).toBe(true)
    expect(new Set(placement?.slots.map(slot => `${slot.x},${slot.z}`)).size).toBe(5)
    expect(placement?.slots.slice(1).map(slot => slot.x)).toEqual([PLAYABLE_WORLD_BOUND - 6, PLAYABLE_WORLD_BOUND - 4, PLAYABLE_WORLD_BOUND - 2, PLAYABLE_WORLD_BOUND])
    expect(placement?.slots[0].x).toBe(PLAYABLE_WORLD_BOUND - 10)
  })

  it('uses the mounted footprint to continue past a foot-only valid candidate', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const obstacle = blockingBox(0.6, 0.8, -0.5, 0.5)
    const foot = placementHarness([obstacle], [placementParticipant('foot', 0)])
    const mounted = placementHarness([obstacle], [placementParticipant('mount', 0, true)])

    expect(foot.solve(center)?.slots[0].x).toBe(0)
    expect(mounted.solve(center)?.center.x).toBe(0)
    expect(mounted.solve(center)?.slots[0].x).not.toBe(0)
  })

  it('uses per-assignment footprints in mixed ALL so a clear foot slot stays put', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participants = [placementParticipant('foot', -10), placementParticipant('mount', 10, true)]
    const { solve } = placementHarness([blockingBox(-0.3, -0.1, -0.5, 0.5)], participants)

    expect(solve(center, 'all')?.center.equals(center)).toBe(true)
    expect(solve(center, 'all')?.slots.map(slot => slot.x)).toEqual([-1, 1])
  })

  it('accepts an obstacle on the route when all final slots are clear', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participant = placementParticipant('foot', 0)
    participant.combatPosition.z = -10
    const { solve } = placementHarness([blockingBox(-1, 1, -5.5, -4.5)], [participant])

    expect(solve(center)?.center.x).toBe(0)
    expect(solve(center)?.center.z).toBe(0)
  })

  it('returns no placement when obstacles cover every nearby final slot', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const { solve } = placementHarness([blockingBox(-22, 22, -22, 22)], [placementParticipant('foot', 0)])
    expect(solve(center)).toBeNull()
  })

  it('re-solves with ten live participants when eleven were previewed', () => {
    const camera = new THREE.PerspectiveCamera()
    const participants = Array.from({ length: 11 }, (_, index) => placementParticipant(`p-${index}`, index - 5))
    const formation = new FormationController(
      new THREE.Scene(), camera, participants as any, new THREE.Object3D(),
      [blockingBox(0.8, 1.2, -1.6, -0.9)],
    )
    onTestFinished(() => formation.cancelPlacement())
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('viking_spearman')
    const shown = preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]
    expect(shown).toHaveLength(11)
    expect((formation as any).previewCenter.equals(requested)).toBe(true)
    const ideal = (formation as any).makeFormation(requested, (formation as any).previewForward, 11, 10).slots as THREE.Vector3[]
    expect(shown.filter((slot, index) => !slot.equals(ideal[index]))).toHaveLength(1)

    participants[10].dead = true
    const result = formation.confirmPlacement()
    expect(result.accepted).toBe(true)
    expect(result.count).toBe(10)
    expect(participants.slice(0, 10).every(npc => npc.assignFormationTarget.mock.calls.length === 1)).toBe(true)
    expect(participants[10].assignFormationTarget).not.toHaveBeenCalled()
    expect(participants[0].assignFormationTarget.mock.calls[0][1].z).toBeCloseTo(0)
  })

  it('confirms the displayed mixed ALL slots when the live participants are unchanged', () => {
    const participants = [placementParticipant('foot', -10), placementParticipant('mount', 10, true)]
    const formation = new FormationController(
      new THREE.Scene(), new THREE.PerspectiveCamera(), participants as any, new THREE.Object3D(),
      [blockingBox(1.4, 1.6, -0.5, 0.5)],
    )
    onTestFinished(() => formation.cancelPlacement())
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('all')
    const shownSlots = (preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]).map(slot => `${slot.x},${slot.z}`)
    expect(shownSlots).toHaveLength(2)
    expect((formation as any).previewCenter.equals(requested)).toBe(true)
    expect(shownSlots).toContain('-1,0')
    expect(shownSlots).not.toContain('1,0')

    expect(formation.confirmPlacement().accepted).toBe(true)
    const commandedSlots = participants.map(npc => npc.assignFormationTarget.mock.calls[0][1] as THREE.Vector3)
      .map(slot => `${slot.x},${slot.z}`)
    expect(commandedSlots.sort()).toEqual(shownSlots.sort())
  })

  it('rejects confirmation without a terrain hit or living participant', () => {
    const participant = placementParticipant('foot', 0)
    const formation = new FormationController(
      new THREE.Scene(), new THREE.PerspectiveCamera(), [participant] as any, new THREE.Object3D(), [],
    )
    onTestFinished(() => formation.cancelPlacement())
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([])
    formation.beginPlacement('viking_spearman')
    expect(formation.confirmPlacement().accepted).toBe(false)

    participant.dead = true
    expect(formation.confirmPlacement().accepted).toBe(false)
  })

  it('reuses a relocated placement on an unchanged preview frame', () => {
    const participant = placementParticipant('foot', 0)
    const formation = new FormationController(
      new THREE.Scene(), new THREE.PerspectiveCamera(), [participant] as any, new THREE.Object3D(),
      [blockingBox(-0.2, 0.2, -0.2, 0.2)],
    )
    onTestFinished(() => formation.cancelPlacement())
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const solve = vi.spyOn(formation as any, 'resolvePlacement')
    const make = vi.spyOn(formation as any, 'makeFormation')
    const show = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('viking_spearman')
    expect((formation as any).previewCenter.equals(requested)).toBe(true)
    expect((show.mock.calls.at(-1)?.[1] as THREE.Vector3[])[0].x).not.toBe(0)
    const counts = [solve.mock.calls.length, make.mock.calls.length, show.mock.calls.length]
    formation.updatePlacement()
    expect([solve.mock.calls.length, make.mock.calls.length, show.mock.calls.length]).toEqual(counts)
  })

  it('uses the mounted collision footprint for obstacle validity', () => {
    const obstacle = {
      box: new THREE.Box3(new THREE.Vector3(0.6, 0, -0.5), new THREE.Vector3(0.8, 2.5, 0.5)),
      isBarricade: false,
    }
    const formation = new FormationController(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      [],
      new THREE.Object3D(),
      [obstacle],
    )
    onTestFinished(() => formation.cancelPlacement())
    const slot = new THREE.Vector3(0, 0, 0)
    expect((formation as any).isSlotBlocked(slot, { isMounted: false })).toBe(false)
    expect((formation as any).isSlotBlocked(slot, { isMounted: true })).toBe(true)
  })

  it('does not rerun placement assignment when geometry and participants are unchanged', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(0, 50, 0)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial())
    terrain.rotation.x = -Math.PI / 2
    terrain.updateMatrixWorld(true)
    const npcs = Array.from({ length: 200 }, (_, index) => ({
      name: `npc-${index}`,
      faction: Faction.PLAYER,
      dead: false,
      presetId: 'viking_berserker',
      isMounted: false,
      combatPosition: new THREE.Vector3(index % 20, 0, Math.floor(index / 20)),
    }))
    const formation = new FormationController(new THREE.Scene(), camera, npcs as any, terrain, [])
    onTestFinished(() => formation.cancelPlacement())
    const solveSpy = vi.spyOn(formation as any, 'resolvePlacement')
    const makeFormationSpy = vi.spyOn(formation as any, 'makeFormation')
    const signatureSpy = vi.spyOn(formation as any, 'getParticipantSignature')

    formation.beginPlacement('all')
    expect(solveSpy).toHaveBeenCalledTimes(1)
    expect(makeFormationSpy).toHaveBeenCalledTimes(1)
    expect(signatureSpy).toHaveBeenCalledTimes(1)
    formation.updatePlacement()
    expect(solveSpy).toHaveBeenCalledTimes(1)
    expect(makeFormationSpy).toHaveBeenCalledTimes(1)
    expect(signatureSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps squad formation participants scoped even when the squad mixes presets', () => {
    const squadOne = [
      { name: 'spear', faction: Faction.PLAYER, presetId: 'viking_spearman', squadId: 1, dead: false },
      { name: 'archer', faction: Faction.PLAYER, presetId: 'viking_horse_archer', squadId: 1, dead: false },
    ]
    const other = { name: 'other', faction: Faction.PLAYER, presetId: 'viking_spearman', squadId: 2, dead: false }
    const formation = new FormationController(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      [...squadOne, other] as any,
      new THREE.Object3D(),
      [],
    )
    onTestFinished(() => formation.cancelPlacement())

    const participants = (formation as any).resolveParticipants('squad:1')
    expect(participants.map((npc: any) => npc.name)).toEqual(['spear', 'archer'])
  })
})
