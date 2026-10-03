import type { Mount } from '../world/Mount'

/** Combat-local interaction eligibility. It never reads or writes a Career profile. */
export class TemporaryBattlefieldMounts {
  private readonly mounts = new Set<Mount>()
  track(mount: Mount, combatId: string): void {
    if (mount.disposed) return
    mount.temporaryCombatId = combatId
    this.mounts.add(mount)
  }
  get all(): ReadonlySet<Mount> { return this.mounts }
  cleanup(): void {
    for (const mount of this.mounts) {
      mount.riderPlayer?.dismountFromMount()
      // Still-mounted NPCs return/depart through the existing controller cleanup.
      // Released Town cavalry may be borrowed, but the original Town mount must survive cleanup.
      if (!mount.riderNpc && !mount.reservedForTown) mount.dispose()
      mount.temporaryCombatId = null
    }
    this.mounts.clear()
  }
}
