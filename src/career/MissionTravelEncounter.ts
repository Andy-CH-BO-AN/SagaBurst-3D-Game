import * as THREE from 'three'
import type { Player } from '../player/Player'
import type { NPC } from '../world/NPC'
import type { SpatialGrid } from '../world/SpatialGrid'
import { OUTSKIRTS_ALERT_RANGE, OUTSKIRTS_ENCOUNTER_LEASH, OUTSKIRTS_SENSOR_INTERVAL } from '../town/TownOutskirtsRules'
import { townWartimeHostile } from '../town/TownWartime'

export interface MissionTravelThreats {
  owns(actor: NPC): boolean
  squadMembersFor?(actor: NPC): readonly NPC[]
}

const SUPPORT_COMMAND = -3
const distanceSq = (a: THREE.Vector3, b: THREE.Vector3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2

/** A runtime interruption only. The mission owns its roster, route and eventual resume orders. */
export class MissionTravelEncounter {
  constructor(private readonly canCommandActor: (actor: NPC) => boolean = () => true) {}

  private origin: THREE.Vector3 | null = null
  private readonly threats = new Set<NPC>()
  private readonly participants = new Set<NPC>()
  private readonly supportTargets = new Map<NPC, THREE.Vector3>()
  private readonly nearby: NPC[] = []
  private readonly center = new THREE.Vector3()
  private sensorRemaining = 0

  get active(): boolean { return this.origin !== null }
  get engagementOrigin(): THREE.Vector3 | null { return this.origin?.clone() ?? null }
  get hostileActors(): readonly NPC[] { return [...this.threats] }
  owns(actor: NPC): boolean { return this.active && this.participants.has(actor) }

  noteHit(target: NPC | Player, source: NPC, members: readonly NPC[], player: Player, runtime: MissionTravelThreats): boolean {
    if ((target !== player && !members.includes(target as NPC)) || !runtime.owns(source)
      || !(target === player ? source.hostileToPlayer : townWartimeHostile(target, source))) return false
    if (!this.active) this.begin(target.combatPosition, members)
    // A later hit cannot move the origin or pull this engagement toward a remote fight.
    this.addSquad(source, members, player, runtime)
    this.commandMembers(members)
    return true
  }

  prepareFrame(dt: number, members: readonly NPC[], player: Player, grid: SpatialGrid<NPC>, runtime: MissionTravelThreats): void {
    this.sensorRemaining -= Math.max(0, dt)
    const observers = [...members.filter(actor => !actor.dead), ...(player.dead ? [] : [player])]
    if (this.sensorRemaining <= 0 && observers.length) {
      this.sensorRemaining = OUTSKIRTS_SENSOR_INTERVAL
      let range = OUTSKIRTS_ENCOUNTER_LEASH
      if (this.origin) this.center.copy(this.origin)
      else {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        for (const actor of observers) {
          const p = actor.combatPosition
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
        }
        this.center.set((minX + maxX) / 2, observers[0].combatPosition.y, (minZ + maxZ) / 2)
        range = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2) + OUTSKIRTS_ALERT_RANGE
      }
      // One broad-phase query for the whole travel group, including a detached Player.
      for (const threat of grid.getNearbyInto(this.center, range, this.nearby)) {
        if (!this.valid(threat, members, player, runtime)) continue
        const observer = observers.find(actor => (actor === player ? threat.hostileToPlayer : townWartimeHostile(actor, threat))
          && distanceSq(actor.combatPosition, threat.combatPosition) <= OUTSKIRTS_ALERT_RANGE ** 2)
        if (!observer) continue
        if (!this.active) this.begin(observer.combatPosition, members)
        this.addSquad(threat, members, player, runtime)
      }
    }
    if (!this.active) return
    for (const threat of this.threats) if (!this.valid(threat, members, player, runtime)) this.threats.delete(threat)
    if (!this.threats.size || !observers.length) { this.clear(); return }
    this.commandMembers(members)
  }

  /** Used both at normal encounter end and when formal combat supersedes travel. */
  clear(): void {
    for (const actor of this.participants) actor.clearEncounter()
    this.origin = null
    this.threats.clear()
    this.participants.clear()
    this.supportTargets.clear()
    this.sensorRemaining = 0
  }

  private begin(position: THREE.Vector3, members: readonly NPC[]): void {
    this.origin = position.clone()
    for (const actor of members) {
      if (actor.dead) continue
      this.participants.add(actor)
      if (!this.canCommandActor(actor)) continue
      actor.clearEncounter()
      actor.setTacticalOrder('charge')
    }
  }

  private valid(threat: NPC, members: readonly NPC[], player: Player, runtime: MissionTravelThreats): boolean {
    return !threat.dead && runtime.owns(threat) && threat.encounterAggroState !== 'returning'
      && ((!player.dead && threat.hostileToPlayer) || members.some(actor => !actor.dead && townWartimeHostile(actor, threat)))
      && (!this.origin || distanceSq(threat.combatPosition, this.origin) <= OUTSKIRTS_ENCOUNTER_LEASH ** 2)
  }

  private addSquad(source: NPC, members: readonly NPC[], player: Player, runtime: MissionTravelThreats): void {
    for (const threat of runtime.squadMembersFor?.(source) ?? [source]) {
      if (this.valid(threat, members, player, runtime)) this.threats.add(threat)
    }
  }

  private commandMembers(members: readonly NPC[]): void {
    if (!this.origin) return
    const supportTarget = this.threats.values().next().value?.combatPosition ?? this.origin
    for (const actor of this.participants) {
      if (actor.dead || !members.includes(actor) || !this.canCommandActor(actor)) continue
      if (distanceSq(actor.combatPosition, this.origin) <= OUTSKIRTS_ENCOUNTER_LEASH ** 2) {
        if (actor.tacticalOrder !== 'charge') actor.setTacticalOrder('charge')
        this.supportTargets.delete(actor)
      } else {
        // Support the fight directly; reaching the origin is never a resume prerequisite.
        const target = supportTarget
        const previous = this.supportTargets.get(actor)
        if (!previous || distanceSq(previous, target) > 64 || actor.formationCommandId !== SUPPORT_COMMAND) {
          actor.assignFormationTarget(SUPPORT_COMMAND, target, target.clone().sub(actor.combatPosition).setY(0).normalize())
          this.supportTargets.set(actor, target.clone())
        }
      }
    }
  }
}
