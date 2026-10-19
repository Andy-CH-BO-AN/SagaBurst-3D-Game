import type { Mount } from '../world/Mount'
import type { NPC } from '../world/NPC'
import { getTerrainHeight } from '../world/Terrain'
import { townStationSpec, type TownGarrisonStation } from './TownGarrison'

interface TownHome { duty?: import('./TownRules').TownDuty; x: number; y?: number; z: number; yaw?: number; garrison?: TownGarrisonStation }

/** A reached flag or matching XZ cannot establish arrival on a different floor. */
export function townResidentAtHome(npc: Pick<NPC, 'combatPosition' | 'isMounted'>, home: TownHome,
  radius = npc.isMounted ? 1.2 : 1): boolean {
  const p = npc.combatPosition
  return (p.x - home.x) ** 2 + (p.z - home.z) ** 2 <= radius ** 2
    && Math.abs(p.y - (home.y ?? getTerrainHeight(home.x, home.z))) < 1.3
}

export function activateTownResidentHome(npc: Pick<NPC, 'dead' | 'combatPosition' | 'isMounted' | 'rangedWeaponId' | 'activateTownRampartGarrison'>,
  home: TownHome): void {
  if (!npc.dead && (home.garrison?.kind === 'rampart' || home.duty === 'watchtower_guard') && !npc.isMounted && npc.rangedWeaponId && townResidentAtHome(npc, home))
    npc.activateTownRampartGarrison()
}

/** Explicit mission restoration only, never ordinary travel or arrival recovery.
 * Resolve native equipment before choosing the layer; a revived home mount also
 * needs its reserved ground fallback rather than an elevated ranged station.
 */
export function restoreTownResidentHome<T extends TownHome>(resident: { spec: T; npc: NPC; homeMount?: Mount }): T {
  const { npc, homeMount } = resident
  npc.dismountFromMount()
  npc.restoreCombatLoadout()
  const home = townStationSpec(resident.spec, Boolean(homeMount), Boolean(npc.rangedWeaponId))
  resident.spec = home
  npc.restoreForTown({ x: home.x, y: home.y, z: home.z, yaw: home.yaw ?? Math.PI })
  npc.group.rotation.y = home.yaw ?? Math.PI
  if (homeMount) {
    homeMount.restoreForTown(home.x, home.z, home.yaw ?? Math.PI)
    npc.mountVehicle(homeMount)
  }
  return home
}
