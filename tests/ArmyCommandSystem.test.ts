import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  ArmyCommandController,
  getArmyCommandShortcut,
  getArmyCommandShortcuts,
  getCommandFromSubmenuKey,
} from '../src/battle/ArmyCommandController'
import { armyCommandTargetLabel } from '../src/ui/ArmyCommandUI'
import { AIState, AIType, Faction, NPC } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { STAMINA_DRAIN, SPRINT_MULTIPLIER } from '../src/movement/MovementBalance'
import {
  assignUnitsToSlots,
  FORMATION_ALL_MAX_COLUMNS,
  FORMATION_MAX_COLUMNS,
  formationRowAxis,
  getFormationBoundaryShift,
  generateFormationSlots,
  generateLineFormationSlots,
} from '../src/battle/FormationMath'
import { FormationController } from '../src/battle/FormationController'
import { findNearestValidFormation } from '../src/battle/FormationPlacement'
import { getTerrainHeight, PLAYABLE_WORLD_BOUND } from '../src/world/Terrain'

function placementHarness(obstacles: Array<{ box: THREE.Box3; isBarricade: boolean }>, participants: any[]) {
  const formation = new FormationController(
    new THREE.Scene(), new THREE.PerspectiveCamera(), participants, new THREE.Object3D(), obstacles,
  )
  const solve = (center: THREE.Vector3, target: any = 'viking_spearman', preview = false) =>
    (formation as any).findNearestPlacement(center, new THREE.Vector3(0, 0, 1), participants, target, preview) as
      | { center: THREE.Vector3; slots: THREE.Vector3[] }
      | null
  return { formation, solve }
}

function placementParticipant(name: string, x: number, mounted = false) {
  return { name, faction: Faction.PLAYER, presetId: 'viking_spearman', dead: false,
    isMounted: mounted, combatPosition: new THREE.Vector3(x, 0, 0), assignFormationTarget: vi.fn() }
}

function blockingBox(minX: number, maxX: number, minZ: number, maxZ: number) {
  return { box: new THREE.Box3(new THREE.Vector3(minX, -10, minZ), new THREE.Vector3(maxX, 10, maxZ)), isBarricade: false }
}

function controllerHarness(npcs: any[], formation: any = null) {
  const pressed = new Set<string>()
  const consume = (code: string) => {
    if (!pressed.has(code)) return false
    pressed.delete(code)
    return true
  }
  const input = {
    consumeKeyPress: consume,
    consumeKeyE: () => consume('KeyE'),
    consumeLeftClick: () => consume('MouseLeft'),
    press: (digit: string) => pressed.add(`Digit${digit}`),
    pressAll: () => pressed.add('Backquote'),
    pressKey: (code: string) => pressed.add(code),
    pressE: () => pressed.add('KeyE'),
    clickLeft: () => pressed.add('MouseLeft'),
  }
  const ui = {
    render: vi.fn(),
    renderPlacement: vi.fn(),
    showFeedback: vi.fn(),
  }
  const controller = new ArmyCommandController(npcs, 'viking', input as any, ui as any, formation)
  return { controller, input, ui }
}

describe('Army command keyboard mapping and filtering', () => {
  it('uses the requested center directly when the formation is usable', () => {
    const requestedCenter = new THREE.Vector3(12, 0, -8)
    const makeFormation = vi.fn((center: THREE.Vector3) => ({ center: center.clone(), slots: [center.clone()] }))
    const placement = findNearestValidFormation(
      requestedCenter,
      new THREE.Vector3(0, 0, 1),
      makeFormation,
      () => true,
    )

    expect(placement?.center).toEqual(requestedCenter)
    expect(makeFormation).toHaveBeenCalledOnce()
  })

  it('finds the nearest deterministic local-axis candidate and stops early', () => {
    const requestedCenter = new THREE.Vector3()
    const forward = new THREE.Vector3(1, 0, 0)
    const checked: Array<[number, number]> = []
    const placement = findNearestValidFormation(
      requestedCenter,
      forward,
      center => ({ center: center.clone(), slots: [center.clone()] }),
      formation => {
        checked.push([formation.center.x, formation.center.z])
        return formation.center.distanceTo(new THREE.Vector3(0, 0, 2)) < 0.001
      },
    )

    expect(placement?.center).toEqual(new THREE.Vector3(0, 0, 2))
    expect(checked).toEqual([
      [0, 0],
      [0, 2],
    ])
  })

  it('relocates a blocked formation to the nearest legal slots, deterministically', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participants = [placementParticipant('a', -1), placementParticipant('b', 1)]
    const { solve } = placementHarness([blockingBox(-1.2, -0.8, -0.2, 0.2)], participants)
    const first = solve(center)
    const second = solve(center)

    expect(first).not.toBeNull()
    expect(first?.center.equals(center)).toBe(false)
    expect(first?.center.distanceToSquared(center)).toBeCloseTo(4)
    expect(first?.slots).toEqual(second?.slots)
    expect(first?.slots.every(slot => Math.abs(slot.x) >= 1)).toBe(true)
  })

  it('keeps a relocated formation inside the boundary with whole-slot spacing', () => {
    const center = new THREE.Vector3(179, getTerrainHeight(179, 0), 0)
    const participants = Array.from({ length: 5 }, (_, index) => placementParticipant(`p-${index}`, index))
    const { solve } = placementHarness([blockingBox(171.7, 172.3, -0.5, 0.5)], participants)
    const placement = solve(center)

    expect(placement).not.toBeNull()
    expect(placement?.center.z).not.toBe(0)
    expect(placement?.slots.every(slot => Math.abs(slot.x) <= PLAYABLE_WORLD_BOUND && Math.abs(slot.z) <= PLAYABLE_WORLD_BOUND)).toBe(true)
    expect(new Set(placement?.slots.map(slot => `${slot.x},${slot.z}`)).size).toBe(5)
    expect(placement?.slots.slice(1).every((slot, index) => slot.x - placement.slots[index].x === 2)).toBe(true)
  })

  it('uses the mounted footprint to continue past a foot-only valid candidate', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const obstacle = blockingBox(0.6, 0.8, -0.5, 0.5)
    const foot = placementHarness([obstacle], [placementParticipant('foot', 0)])
    const mounted = placementHarness([obstacle], [placementParticipant('mount', 0, true)])

    expect(foot.solve(center)?.center.x).toBe(0)
    expect(mounted.solve(center)?.center.x).not.toBe(0)
  })

  it('keeps mixed ALL preview conservative and confirm validation assignment-aware', () => {
    const center = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    const participants = [placementParticipant('foot', -10), placementParticipant('mount', 10, true)]
    const { solve } = placementHarness([blockingBox(-0.3, -0.1, -0.5, 0.5)], participants)

    expect(solve(center, 'all', true)?.center.equals(center)).toBe(false)
    expect(solve(center, 'all', false)?.center.equals(center)).toBe(true)
  })

  it('rejects only after checking the full nearby radius', () => {
    const center = new THREE.Vector3()
    const checked: number[] = []
    const placement = findNearestValidFormation(
      center,
      new THREE.Vector3(0, 0, 1),
      candidate => ({ center: candidate, slots: [candidate] }),
      formation => { checked.push(formation.center.distanceToSquared(center)); return false },
    )

    expect(placement).toBeNull()
    expect(checked[0]).toBe(0)
    expect(checked.at(-1)).toBe(400)
    expect(checked.every(distance => distance <= 400)).toBe(true)
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
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('viking_spearman')
    expect(preview.mock.calls.at(-1)?.[1]).toHaveLength(11)
    expect((formation as any).previewCenter.equals(requested)).toBe(false)

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
      [blockingBox(-0.3, -0.1, -0.5, 0.5)],
    )
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const preview = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('all')
    const shownSlots = (preview.mock.calls.at(-1)?.[1] as THREE.Vector3[]).map(slot => `${slot.x},${slot.z}`)
    expect(shownSlots).toHaveLength(2)
    expect((formation as any).previewCenter.equals(requested)).toBe(false)

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
    const requested = new THREE.Vector3(0, getTerrainHeight(0, 0), 0)
    vi.spyOn((formation as any).raycaster, 'intersectObject').mockReturnValue([{ point: requested }])
    const solve = vi.spyOn(formation as any, 'findNearestPlacement')
    const make = vi.spyOn(formation as any, 'makeFormation')
    const show = vi.spyOn((formation as any).preview, 'show')

    formation.beginPlacement('viking_spearman')
    expect((formation as any).previewCenter.equals(requested)).toBe(false)
    const counts = [solve.mock.calls.length, make.mock.calls.length, show.mock.calls.length]
    formation.updatePlacement()
    expect([solve.mock.calls.length, make.mock.calls.length, show.mock.calls.length]).toEqual(counts)
  })

  it('generates a centered single row and rotates its row axis with facing', () => {
    const center = new THREE.Vector3(10, 0, 20)
    const slots = generateLineFormationSlots(center, new THREE.Vector3(0, 0, 1), 5, 2)
    expect(slots.map(slot => [slot.x, slot.z])).toEqual([
      [6, 20], [8, 20], [10, 20], [12, 20], [14, 20],
    ])
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).x).toBe(1)
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).y).toBe(0)
    expect(formationRowAxis(new THREE.Vector3(0, 0, 1)).z).toBeCloseTo(0)
    expect(generateLineFormationSlots(center, new THREE.Vector3(1, 0, 0), 1, 2)[0]).toEqual(center)
  })

  it('assigns shuffled units left-to-right by projection with a stable tie-break', () => {
    const center = new THREE.Vector3()
    const slots = generateLineFormationSlots(center, new THREE.Vector3(0, 0, 1), 3, 2)
    const units = [
      { id: 'right', position: new THREE.Vector3(4, 0, 0) },
      { id: 'left', position: new THREE.Vector3(-4, 0, 0) },
      { id: 'middle', position: new THREE.Vector3(0, 0, 0) },
    ]
    const assignments = assignUnitsToSlots(units, slots, formationRowAxis(new THREE.Vector3(0, 0, 1)), center)
    expect(assignments.map(entry => entry.unit.id)).toEqual(['left', 'middle', 'right'])
    expect(assignments.map(entry => entry.slot.x)).toEqual([-2, 0, 2])
  })

  it('uses centered rows of at most ten and preserves spacing at the boundary', () => {
    const center = new THREE.Vector3(0, 0, 0)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 10)).toHaveLength(10)
    const eleven = generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 11)
    expect(eleven.slice(0, 10).every(slot => slot.z > 0)).toBe(true)
    expect(eleven[10].x).toBe(0)
    expect(eleven[10].z).toBeLessThan(0)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 25)).toHaveLength(25)
    expect(generateFormationSlots(center, new THREE.Vector3(0, 0, 1), 200)).toHaveLength(200)
    expect(FORMATION_MAX_COLUMNS).toBe(10)

    const boundarySlots = generateFormationSlots(new THREE.Vector3(179, 0, 0), new THREE.Vector3(0, 0, 1), 5)
    const shift = getFormationBoundaryShift(boundarySlots, 180)
    const shifted = boundarySlots.map(slot => slot.clone().add(shift))
    expect(Math.max(...shifted.map(slot => slot.x))).toBe(180)
    expect(new Set(shifted.map(slot => slot.x)).size).toBe(5)
    expect(shifted[1].distanceTo(shifted[0])).toBeCloseTo(2)
  })

  it('uses fifty columns only for ALL formations and centers each final row', () => {
    const center = new THREE.Vector3()
    const forward = new THREE.Vector3(0, 0, 1)
    const rowCounts = (slots: readonly THREE.Vector3[]) => [...slots.reduce((rows, slot) => {
      const row = Math.round(slot.z * 100) / 100
      rows.set(row, (rows.get(row) ?? 0) + 1)
      return rows
    }, new Map<number, number>()).values()]

    expect(rowCounts(generateFormationSlots(center, forward, 25))).toEqual([10, 10, 5])
    expect(rowCounts(generateFormationSlots(center, forward, 51, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 1])
    expect(rowCounts(generateFormationSlots(center, forward, 120, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 50, 20])
    expect(rowCounts(generateFormationSlots(center, forward, 200, FORMATION_ALL_MAX_COLUMNS))).toEqual([50, 50, 50, 50])

    const all51 = generateFormationSlots(center, forward, 51, FORMATION_ALL_MAX_COLUMNS)
    expect(all51[50].x).toBe(0)
    const nearBoundary = generateFormationSlots(new THREE.Vector3(179, 0, 0), forward, 120, FORMATION_ALL_MAX_COLUMNS)
    const shift = getFormationBoundaryShift(nearBoundary, 180)
    const shifted = nearBoundary.map(slot => slot.clone().add(shift))
    expect(Math.max(...shifted.map(slot => slot.x))).toBe(180)
    expect(new Set(shifted.map(slot => `${slot.x},${slot.z}`)).size).toBe(120)
    expect(shifted[1].distanceTo(shifted[0])).toBeCloseTo(2)
  })

  it('assigns shuffled multi-row units deterministically by rank then row side', () => {
    const center = new THREE.Vector3()
    const forward = new THREE.Vector3(0, 0, 1)
    const slots = generateFormationSlots(center, forward, 11)
    const rowAxis = formationRowAxis(forward)
    const units = Array.from({ length: 11 }, (_, index) => ({
      id: `unit-${index}`,
      position: new THREE.Vector3(index - 5, 0, index % 2 === 0 ? 4 : -4),
    })).reverse()
    const first = assignUnitsToSlots(units, slots, rowAxis, center, forward)
    const second = assignUnitsToSlots([...units].reverse(), slots, rowAxis, center, forward)
    expect(first.map(entry => entry.unit.id)).toEqual(second.map(entry => entry.unit.id))
    expect(first.slice(0, 10)).toHaveLength(10)
    expect(first[10].slot.x).toBe(0)
  })

  it('labels the submenu with the selected unit group', () => {
    expect(armyCommandTargetLabel('viking_spearman')).toBe('槍兵')
    expect(armyCommandTargetLabel('viking_archer')).toBe('弓兵')
    expect(armyCommandTargetLabel('viking_berserker')).toBe('維京資深戰士')
    expect(armyCommandTargetLabel('all')).toBe('全軍命令')
  })

  it('maps command keys to Attack, Charge, Defend, and Formation', () => {
    expect(getCommandFromSubmenuKey('1')).toBe('attack')
    expect(getCommandFromSubmenuKey('2')).toBe('charge')
    expect(getCommandFromSubmenuKey('3')).toBe('defend')
    expect(getCommandFromSubmenuKey('4')).toBe('formation')
    expect(getCommandFromSubmenuKey('5')).toBeNull()
  })

  it('maps Viking and Roman shortcuts to preset ids and ALL', () => {
    expect(getArmyCommandShortcuts('viking').map(entry => entry.target)).toEqual([
      'viking_berserker', 'viking_spearman', 'viking_archer',
      'viking_sword_cavalry', 'viking_lancer', 'viking_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcuts('roman').map(entry => entry.target)).toEqual([
      'roman_heavy_infantry', 'roman_spearman', 'roman_archer', 'roman_javelin_infantry',
      'roman_sword_cavalry', 'roman_lancer', 'roman_horse_archer', 'all',
    ])
    expect(getArmyCommandShortcut('viking', '`')).toBe('all')
    expect(getArmyCommandShortcut('roman', '`')).toBe('all')
    expect(getArmyCommandShortcut('viking', '7')).toBeNull()
    expect(getArmyCommandShortcut('roman', '8')).toBeNull()
  })

  it('uses edge-triggered submenu flow, filters to PLAYER faction, and leaves enemies alone', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const otherAlly = { faction: Faction.PLAYER, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy, otherAlly])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)
    h.controller.update() // Holding the key does not reselect or issue a command.
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()

    h.input.press('3')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('defend')
    expect(otherAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('ALL commands every player-faction NPC while formation is handled by its placement controller', () => {
    const ally = { faction: Faction.PLAYER, presetId: 'viking_spearman', setTacticalOrder: vi.fn() }
    const enemy = { faction: Faction.ENEMY, presetId: 'viking_archer', setTacticalOrder: vi.fn() }
    const h = controllerHarness([ally, enemy])

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(ally.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.pressAll()
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(ally.setTacticalOrder).toHaveBeenCalledWith('charge')
    expect(enemy.setTacticalOrder).not.toHaveBeenCalled()
  })

  it('uses Q to go back from the command menu and consumes invalid submenu digits', () => {
    const h = controllerHarness([])

    h.input.press('2')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.press('6')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(true)

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('returns from formation placement to the command menu with Q', () => {
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    expect(h.controller.isFormationPlacementMode).toBe(true)

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(formation.cancelPlacement).toHaveBeenCalledOnce()
    expect(h.controller.isFormationPlacementMode).toBe(false)
    expect(h.controller.isSubmenuOpen).toBe(true)
    expect(h.controller.selected).toBe('all')

    h.input.pressKey('KeyQ')
    h.controller.update()
    expect(h.controller.isSubmenuOpen).toBe(false)
  })

  it('updates desired state but never dispatches a command to dead NPCs', () => {
    const deadAlly = { faction: Faction.PLAYER, presetId: 'viking_spearman', dead: true, setTacticalOrder: vi.fn() }
    const h = controllerHarness([deadAlly])
    h.input.press('2')
    h.controller.update()
    h.input.press('2')
    h.controller.update()
    expect(deadAlly.setTacticalOrder).not.toHaveBeenCalled()
    expect(h.ui.showFeedback).toHaveBeenCalledWith('槍兵 → 衝鋒')
  })

  it('does not mark a missing ALL preset as formation when confirming placement', () => {
    const spearman = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    const deadArcher = {
      faction: Faction.PLAYER,
      presetId: 'viking_archer',
      dead: true,
      setTacticalOrder: vi.fn(),
    }
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn(),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(() => {
        formation.isPlacementMode = false
        return { accepted: true, count: 1, commandId: 7, participants: [spearman] }
      }),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([spearman, deadArcher], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    h.input.pressE()
    h.controller.update()

    const hud = h.ui.render.mock.calls.at(-1)?.[0] as Array<{ key: string; order: string }>
    expect(hud.find(entry => entry.key === '3')?.order).toBe('attack')
    expect(hud.find(entry => entry.key === '2')?.order).toBe('formation')
    expect(hud.find(entry => entry.key === '`')?.order).toBe('mixed')
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
    const slot = new THREE.Vector3(0, 0, 0)
    expect((formation as any).isSlotBlocked(slot, { isMounted: false })).toBe(false)
    expect((formation as any).isSlotBlocked(slot, { isMounted: true })).toBe(true)
  })

  it('uses a conservative mounted footprint for mixed ALL preview validity', () => {
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
    const participants = [
      { name: 'foot', isMounted: false, combatPosition: new THREE.Vector3(-10, 0, 0) },
      { name: 'mounted', isMounted: true, combatPosition: new THREE.Vector3(10, 0, 0) },
    ]
    const slots = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)]
    expect((formation as any).isFormationBlocked(
      slots,
      participants,
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, 1),
      'all',
      true,
    )).toBe(true)
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
    const validitySpy = vi.fn(() => false)
    const makeFormationSpy = vi.spyOn(formation as any, 'makeFormation')
    const signatureSpy = vi.spyOn(formation as any, 'getParticipantSignature')
    ;(formation as any).isFormationBlocked = validitySpy

    formation.beginPlacement('all')
    expect(validitySpy).toHaveBeenCalledTimes(1)
    expect(makeFormationSpy).toHaveBeenCalledTimes(1)
    expect(signatureSpy).toHaveBeenCalledTimes(1)
    formation.updatePlacement()
    expect(validitySpy).toHaveBeenCalledTimes(1)
    expect(makeFormationSpy).toHaveBeenCalledTimes(1)
    expect(signatureSpy).toHaveBeenCalledTimes(1)
  })

  it('does not show a defend completion message after ALL Formation is overwritten', () => {
    const participant = {
      faction: Faction.PLAYER,
      presetId: 'viking_spearman',
      dead: false,
      setTacticalOrder: vi.fn(),
    }
    let completionHandler: ((commandId: number, target: string, participants: any[], status: string) => void) | undefined
    const formation: any = {
      isPlacementMode: false,
      setCompletionHandler: vi.fn((handler) => { completionHandler = handler }),
      beginPlacement: vi.fn(() => { formation.isPlacementMode = true }),
      updatePlacement: vi.fn(),
      confirmPlacement: vi.fn(() => {
        formation.isPlacementMode = false
        return { accepted: true, count: 1, commandId: 12, participants: [participant] }
      }),
      cancelPlacement: vi.fn(() => { formation.isPlacementMode = false }),
    }
    const h = controllerHarness([participant], formation)

    h.input.pressAll()
    h.controller.update()
    h.input.press('4')
    h.controller.update()
    h.input.clickLeft()
    h.controller.update()
    h.input.pressAll()
    h.controller.update()
    h.input.press('3')
    h.controller.update()

    const feedbackCount = h.ui.showFeedback.mock.calls.length
    completionHandler?.(12, 'all', [participant], 'abandoned')
    expect(h.ui.showFeedback).toHaveBeenCalledTimes(feedbackCount)
  })
})

function createNpc(
  scene: THREE.Scene,
  faction: Faction,
  characterFaction: 'viking' | 'roman',
  presetId: any,
  loadout: any,
  z: number,
  cavalry = false,
) {
  return new NPC(scene, 0, z, faction, characterFaction, AIType.MELEE, String(presetId), 2, cavalry, loadout, presetId)
}

describe('NPC TacticalOrder and active equipment stance', () => {
  it('moves to a formation target without sprinting and clears it on overwrite', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    ally.assignFormationTarget(42, new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, 1))
    ally.update(0.1, player, [ally], [], [], null as any, () => {}, () => {})
    expect(ally.tacticalOrder).toBe('formation')
    expect(ally.isFormationTargetReached(42)).toBe(false)
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeLessThan(-0.1)

    ally.setTacticalOrder('charge')
    expect(ally.formationCommandId).toBeNull()
    expect(ally.tacticalOrder).toBe('charge')
  })

  it('defaults to Attack and performs Viking Veteran Charge -> Attack -> Defend transitions', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    expect(npc.tacticalOrder).toBe('attack')
    expect(npc.activeCombatKind).toBe('sword')
    expect(npc.shieldId).toBe('round_shield_t2')

    npc.setTacticalOrder('charge')
    expect(npc.shieldId).toBeNull()
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('attack')
    expect(npc.shieldId).toBeNull()
    npc.setTacticalOrder('defend')
    expect(npc.shieldId).toBe('round_shield_t2')
  })

  it('switches Spearman Lance ↔ same-tier Sword with live range, damage, and lance state', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_spearman', {
      meleeWeaponId: 'steel_lance', secondaryMeleeWeaponId: 'steel_sword', shieldId: null, mountId: null,
    }, 0)
    expect(npc.meleeWeaponId).toBe('steel_lance')
    expect(npc.isUsingLance).toBe(true)
    expect(npc.meleeAttackRadius).toBe(3.9)

    npc.setTacticalOrder('charge')
    expect(npc.meleeWeaponId).toBe('steel_sword')
    expect(npc.isUsingLance).toBe(false)
    expect(npc.activeCombatKind).toBe('sword')
    expect(npc.meleeAttackRadius).toBe(1.8)
    expect(npc.meleeDamage).toBe(25)

    npc.setTacticalOrder('defend')
    expect(npc.meleeWeaponId).toBe('steel_lance')
    expect(npc.isUsingLance).toBe(true)
    expect(npc.meleeAttackRadius).toBe(3.9)
  })

  it('switches Viking Archer to sticky melee Charge stance without changing ammo', () => {
    const npc = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_archer', {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 0)
    const arrows = (npc as any).arrows
    expect(npc.activeCombatKind).toBe('bow')
    npc.setTacticalOrder('charge')
    expect((npc as any).arrows).toBe(arrows)
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('attack')
    expect(npc.activeCombatKind).toBe('sword')
    npc.setTacticalOrder('defend')
    expect(npc.activeCombatKind).toBe('bow')
    expect((npc as any).arrows).toBe(arrows)
  })

  it('moves a ranged Viking Archer from ATTACK to CHASE immediately on Charge', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const archer = createNpc(scene, Faction.PLAYER, 'viking', 'viking_archer', {
      meleeWeaponId: 'rusty_dagger', rangedWeaponId: 'recurve_longbow', shieldId: null, mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ;(archer as any).state = AIState.ATTACK
    archer.setTacticalOrder('charge')
    expect(archer.currentState).toBe(AIState.CHASE)
    const before = archer.position.z
    archer.update(0.1, player, [archer, enemy], [], [], null as any, () => {}, () => {})
    expect(archer.position.z).toBeGreaterThan(before)
    expect(archer.sprinting).toBe(true)
  })

  it('does not apply Viking foot stance to Roman or Viking cavalry', () => {
    const roman = createNpc(new THREE.Scene(), Faction.PLAYER, 'roman', 'roman_spearman', {
      meleeWeaponId: 'steel_lance', shieldId: null, mountId: null,
    }, 0)
    roman.setTacticalOrder('charge')
    expect(roman.meleeWeaponId).toBe('steel_lance')

    const cavalry = createNpc(new THREE.Scene(), Faction.PLAYER, 'viking', 'viking_lancer', {
      meleeWeaponId: 'steel_lance', shieldId: null, mountId: 'horse',
    }, 0, true)
    cavalry.setTacticalOrder('charge')
    expect(cavalry.meleeWeaponId).toBe('steel_lance')
  })
})

describe('NPC defend and charge movement policy', () => {
  it('Defend holds position outside weapon range', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 20)
    ally.setTacticalOrder('defend')
    const start = ally.position.clone()
    for (let i = 0; i < 20; i++) ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.position.distanceTo(start)).toBeLessThan(0.001)
    expect(ally.currentState).not.toBe(AIState.CHASE)
  })

  it('Charge sprints while stamina is available, then keeps normal chase and regenerates', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    const before = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(true)
    expect(ally.position.z).toBeGreaterThan(before + 4.8 * SPRINT_MULTIPLIER * 0.1 * 1.2)
    expect(ally.staminaValue).toBeCloseTo(100 - STAMINA_DRAIN * 0.1, 5)

    ;(ally as any).stamina = 0
    const exhaustedBefore = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(exhaustedBefore)
    expect(ally.staminaValue).toBeGreaterThan(0)
  })

  it('keeps an active Charge sprint latched below threshold until stamina reaches zero', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    const ally = createNpc(scene, Faction.PLAYER, 'viking', 'viking_berserker', {
      meleeWeaponId: 'steel_sword', shieldId: 'round_shield_t2', mountId: null,
    }, 0)
    const enemy = createNpc(scene, Faction.ENEMY, 'roman', 'roman_heavy_infantry', {
      meleeWeaponId: 'gladius_standard', shieldId: 'scutum_t2', mountId: null,
    }, 40)
    ally.setTacticalOrder('charge')
    ;(ally as any).state = AIState.CHASE
    ;(ally as any).stamina = 11
    for (let i = 0; i < 4; i++) {
      ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
      expect(ally.sprinting).toBe(true)
    }
    expect(ally.staminaValue).toBe(0)
    const beforeNormalChase = ally.position.z
    ally.update(0.1, player, [ally, enemy], [], [], null as any, () => {}, () => {})
    expect(ally.sprinting).toBe(false)
    expect(ally.position.z).toBeGreaterThan(beforeNormalChase)
  })
})
