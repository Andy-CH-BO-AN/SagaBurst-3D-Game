import * as THREE from 'three'
import { vi } from 'vitest'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import type { UnitLoadout } from '../../src/battle/UnitPresetCatalog'
import { Faction } from '../../src/world/NPC'
import type { CharacterFaction } from '../../src/world/CharacterVisuals'
import type { TownActorSpec } from '../../src/town/TownRules'
import type { createVeteranRoster } from '../../src/career/VeteranMission'

/** Actor doubles replace render assets, health changes and movement with explicit test inputs.
 * moveToFormationTarget snaps to an assigned goal; it does not exercise real locomotion.
 */
export class FieldTestMount {
  readonly group = new THREE.Group()
  readonly baseSpeed = 12
  readonly maxHp = 100
  currentHp = 100
  disposed = false
  get dead(): boolean { return this.currentHp <= 0 }
  takeDamage(amount: number): boolean { this.currentHp = Math.max(0, this.currentHp - amount); return true }
  dispose(): void { this.disposed = true }
}

export class FieldTestNpc {
  readonly group = new THREE.Group()
  dead = false
  respawnEnabled = true
  mount: FieldTestMount | null = null
  presetId?: NpcSpawnSpec['presetId']
  tier: 1 | 2 | 3 | 4
  squadId?: NpcSpawnSpec['squadId']
  tacticalOrder = 'attack'
  hp = 100
  readonly maxHp = 100
  disposed = false
  temporaryTier?: 1 | 2 | 3 | 4
  temporarySquad?: NpcSpawnSpec['squadId']
  temporaryLoadout?: UnitLoadout
  originalLoadout: UnitLoadout = { meleeWeaponId: 'old-town-sword' }
  formationTarget: { commandId: number; position: THREE.Vector3; facing: THREE.Vector3; reached: boolean } | null = null
  restoreCombatLoadout = vi.fn(() => {
    if (this.temporaryTier !== undefined) this.tier = this.originalTier
    this.squadId = this.originalSquad
    this.temporaryTier = undefined
    this.temporarySquad = undefined
    this.temporaryLoadout = undefined
  })
  private readonly originalTier: 1 | 2 | 3 | 4
  private readonly originalSquad: NpcSpawnSpec['squadId']

  constructor(
    readonly combatantId: string,
    readonly name = 'Test cavalry',
    readonly faction: Faction = Faction.TOWN,
    readonly characterFaction: 'roman' | 'viking' = 'roman',
    tier: 1 | 2 | 3 | 4 = 2,
    squadId?: NpcSpawnSpec['squadId'],
    x = 0,
    z = 0,
  ) {
    this.tier = tier
    this.originalTier = tier
    this.squadId = squadId
    this.originalSquad = squadId
    this.group.position.set(x, 0, z)
  }

  get combatPosition(): THREE.Vector3 { return this.mount && !this.mount.dead ? this.mount.group.position : this.group.position }
  get isMounted(): boolean { return Boolean(this.mount && !this.mount.dead) }
  get hpRatio(): number { return this.hp / this.maxHp }
  applyTemporaryCombatLoadout(loadout: UnitLoadout, tier?: 1 | 2 | 3 | 4, squadId?: NpcSpawnSpec['squadId']): void {
    this.temporaryTier = tier
    this.temporarySquad = squadId
    this.temporaryLoadout = { ...loadout }
    if (tier !== undefined) this.tier = tier
    if (squadId !== undefined) this.squadId = squadId
  }
  mountVehicle(mount: FieldTestMount): void { this.mount = mount }
  dismountFromMount(): void { this.mount = null }
  restoreCombatHealth(hp: number): void { if (hp <= 0) { this.hp = 0; this.dead = true } else if (!this.dead) this.hp = Math.min(this.maxHp, hp) }
  takeDamage(amount: number): boolean { this.hp = Math.max(0, this.hp - amount); if (!this.hp) this.dead = true; return true }
  assignFormationTarget = vi.fn((commandId: number, position: THREE.Vector3, facing: THREE.Vector3) => {
    this.formationTarget = { commandId, position: position.clone(), facing: facing.clone(), reached: false }
    this.tacticalOrder = 'formation'
  })
  followTarget: FieldTestNpc | null = null
  assignFollowTarget = vi.fn((leader: FieldTestNpc) => {
    this.followTarget = leader
    this.formationTarget = null
    this.tacticalOrder = 'follow'
  })
  get hostileToPlayer(): boolean { return this.faction === Faction.BANDIT || this.faction === Faction.ENEMY }
  encounterAggroState = 'alerted'
  clearEncounter(): void { this.encounterAggroState = 'idle' }
  isFormationTargetReached(commandId: number): boolean { return this.formationTarget?.commandId === commandId && this.formationTarget.reached }
  get formationCommandId(): number | null { return this.formationTarget?.commandId ?? null }
  moveToFormationTarget(): number {
    if (!this.formationTarget) return 0
    const before = this.combatPosition.clone()
    this.group.position.copy(this.formationTarget.position)
    if (this.mount) this.mount.group.position.copy(this.formationTarget.position)
    this.formationTarget.reached = true
    return before.distanceTo(this.combatPosition)
  }
  setTacticalOrder(order: string): void { this.tacticalOrder = order }
  dispose(): void { this.disposed = true }
}

const townRoleFor = (role: string): TownActorSpec['role'] => role as TownActorSpec['role']

export class FieldTestPlayer {
  readonly group = new THREE.Group()
  dead = false
  hp = 100
  staminaValue = 100
  get combatPosition(): THREE.Vector3 { return this.group.position }
}

export function buildVeteranResidents(roster: ReturnType<typeof createVeteranRoster>, faction: CharacterFaction = 'roman') {
  return roster.friendly.filter(unit => unit.source === 'town').map((unit, index) => {
    const npc = new FieldTestNpc(unit.actorId, unit.heroRole === 'ranger' ? 'Maki' : unit.heroRole === 'captain' ? 'Captain' : 'Town cavalry', Faction.TOWN, faction, 2)
    npc.group.position.set(-24 + (index % 6) * 8, 0, 18 + Math.floor(index / 6) * 7)
    const homeMount = unit.mounted ? new FieldTestMount() : undefined
    if (homeMount) { homeMount.group.position.copy(npc.group.position); npc.mountVehicle(homeMount) }
    const spec = { id: unit.actorId, role: townRoleFor(unit.townRole!), x: npc.group.position.x, z: npc.group.position.z, index }
    return { spec, npc, homeMount }
  })
}
