import { outpostCheckpointHeight } from '../campaign/OutpostRampartGarrison'
import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { getTerrainHeight } from '../world/Terrain'
import type { PersonalActorCheckpoint, PersonalActorPosition } from './CareerPersonalSquadMission'
import { ARMORS } from '../rpg/ArmorDatabase'

function position(point: THREE.Vector3, yaw: number): PersonalActorPosition {
  return { x: point.x, y: point.y, z: point.z, yaw }
}

/** Durability of the shield the actor was given. A shield whose model is still loading has no held state yet, so its
 * recorded durability (restored or never damaged) is read by id; the held value alone would save a loading shield as 0. */
function savedShieldDurability(npc: NPC): number {
  const id = npc.requestedShieldId
  if (!id) return npc.shield.shieldImpactRemaining
  return npc.shield.captureDurability()[id] ?? ARMORS[id]?.shieldImpactMax ?? 0
}

/** Restores durability by the actor's requested shield id, so a shield that arrives later keeps the saved value. */
function restoreShieldDurability(npc: NPC, value: number): void {
  const id = npc.requestedShieldId
  if (!id) { npc.shield.shieldImpactRemaining = Math.min(npc.shield.shieldImpactMax, value); return }
  npc.shield.restoreDurability({ ...npc.shield.captureDurability(), [id]: value })
}

/** Borrowed residents retain their own gear and mount; this is a save, never a refit. */
export function snapshotCommandActor(npc: NPC, homeMount?: Mount,
  status: PersonalActorCheckpoint['status'] = npc.dead ? 'dead' : 'deployed'): PersonalActorCheckpoint {
  const mount = homeMount ?? npc.mount ?? undefined
  return { status: npc.dead ? 'dead' : status, hp: npc.hp,
    position: position(npc.combatPosition, npc.mount?.group.rotation.y ?? npc.group.rotation.y),
    ammo: npc.combatAmmo, shieldImpact: savedShieldDurability(npc), order: npc.tacticalOrder,
    ...(npc.isOutpostRampartGarrisonActive ? { outpostRampartGarrison: true } : {}),
    ...(npc.isTownRampartGarrisonActive ? { townRampartGarrison: true } : {}),
    ...(npc.isMountedTownRampartGarrisonEnabled ? { townRampartMounted: true } : {}),
    ...(npc.isFalling ? { fall: npc.fallSnapshot } : {}),
    ...(npc.combatFormationCheckpoint ? { formation: npc.combatFormationCheckpoint } : {}),
    ...(mount ? { mount: { armorImpactRemaining: mount.armorImpactRemaining, hp: mount.dead ? 0 : mount.currentHp, mounted: npc.mount === mount,
      position: position(mount.group.position, mount.group.rotation.y),
      ...(mount.flight ? { flight: mount.flight.snapshot() } : {}) } } : {}),
  }
}

/** Used only while restoring a scene. Runtime handovers never move or heal the actor. */
export function restoreCommandActor(npc: NPC, saved: PersonalActorCheckpoint, homeMount?: Mount): void {
  npc.releaseOutpostRampartGarrison?.()
  npc.restoreCombatHealth(saved.status === 'dead' ? 0 : saved.hp ?? npc.hp)
  if (saved.ammo !== undefined) npc.restoreCombatAmmo(saved.ammo)
  if (saved.shieldImpact !== undefined) restoreShieldDurability(npc, saved.shieldImpact)
  const mount = homeMount ?? npc.mount ?? undefined
  if (mount && saved.mount) {
    mount.restoreArmor(saved.mount.armorImpactRemaining)
    const p = saved.mount.position
    mount.group.position.set(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z); mount.group.rotation.y = p.yaw
    if (saved.mount.hp <= 0) { if (!mount.dead) mount.takeDamage(mount.maxHp + 1); if (npc.mount === mount) npc.dismountFromMount() }
    else {
      mount.currentHp = Math.min(mount.maxHp, saved.mount.hp)
      if (!saved.mount.mounted && npc.mount === mount) npc.dismountFromMount()
      // A partially recovered scene may not have a garrison snapshot to bind this pair first.
      // Bind the same grounded asset before its saved airborne phase makes boarding illegal.
      if (saved.mount.mounted && !npc.dead && npc.mount !== mount) npc.mountVehicle(mount)
      if (saved.mount.flight && mount.flight) mount.flight.restore(saved.mount.flight)
    }
  }
  if (saved.position) {
    const p = saved.position
    npc.group.position.set(p.x, outpostCheckpointHeight(p.x, p.z, p.y, saved.outpostRampartGarrison, npc.characterFaction), p.z); npc.group.rotation.y = p.yaw
  }
  if (saved.fall) { npc.dismountFromMount(); npc.restorePendingFall(saved.fall) }
  if (!npc.dead && saved.formation) {
    const f = saved.formation, p = f.position
    npc.assignFormationTarget(f.commandId, new THREE.Vector3(p.x, p.y ?? getTerrainHeight(p.x, p.z), p.z),
      new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), f.speedLimit, f.arrivalOrder, f.reached)
  } else if (!npc.dead && saved.order && saved.order !== 'follow') npc.setTacticalOrder(saved.order)
  if (!npc.dead && !saved.formation && saved.outpostRampartGarrison && (!saved.order || saved.order === 'defend' || saved.order === 'attack'))
    npc.activateOutpostRampartGarrison(saved.order === 'attack' ? 'attack' : 'defend')
  if (!npc.dead && (!npc.isMounted || saved.townRampartMounted) && !saved.formation && saved.townRampartGarrison
    && (!saved.order || saved.order === 'defend' || saved.order === 'attack'))
    npc.activateTownRampartGarrison(saved.order === 'attack' ? 'attack' : 'defend', saved.townRampartMounted === true)
}

/** Stages restored resources before a service transaction mutates the live army. */
export function refitCommandCheckpoint(npc: NPC, homeMount?: Mount,
  status: PersonalActorCheckpoint['status'] = 'deployed'): PersonalActorCheckpoint {
  const saved = snapshotCommandActor(npc, homeMount, status)
  saved.status = status; saved.hp = npc.maxHp; saved.ammo = npc.combatAmmoCapacity
  saved.shieldImpact = npc.shield.shieldImpactMax
  if (saved.fall && saved.position) saved.position.y = getTerrainHeight(saved.position.x, saved.position.z)
  delete saved.fall
  const mount = homeMount ?? npc.mount
  if (saved.mount && mount) {
    saved.mount.hp = mount.maxHp
    saved.mount.armorImpactRemaining = mount.armorImpactMax
    if (mount.dead || npc.dead) {
      saved.mount.mounted = true
      delete saved.mount.flight
      saved.mount.position.y = getTerrainHeight(saved.mount.position.x, saved.mount.position.z)
    }
  }
  return saved
}

/** Full, explicit service repair. Live flight and accepted orders survive a refit. */
export function refitCommandActor(npc: NPC, homeMount?: Mount): void {
  const saved = snapshotCommandActor(npc, homeMount)
  const mount = homeMount ?? npc.mount ?? undefined
  const remount = Boolean(mount && (saved.mount?.mounted || mount.dead || npc.dead))
  if (mount && (mount.dead || npc.dead && mount.isAirborne)) {
    if (npc.mount === mount) npc.dismountFromMount()
    const p = mount.group.position
    // A grounded corpse keeps its floor (HR hall); a fallen eagle returns to the terrain.
    mount.restoreForTown(p.x, p.z, mount.group.rotation.y, mount.isFlyingMount ? undefined : p.y)
  } else if (mount) mount.currentHp = mount.maxHp
  npc.refitCombat()
  saved.status = 'deployed'; saved.hp = npc.maxHp
  saved.ammo = npc.combatAmmo; saved.shieldImpact = npc.shield.shieldImpactMax
  if (saved.fall && saved.position) saved.position.y = getTerrainHeight(saved.position.x, saved.position.z)
  delete saved.fall
  if (saved.mount && mount) {
    saved.mount.hp = mount.maxHp
    saved.mount.armorImpactRemaining = mount.armorImpactMax
    saved.mount.mounted = remount
    // A revived eagle starts on the ground; restoring its corpse flight would undo recovery.
    saved.mount.position = position(mount.group.position, mount.group.rotation.y)
    saved.mount.flight = mount.flight?.snapshot()
  }
  restoreCommandActor(npc, saved, mount)
}
