/** Town's periodic personal/command checkpoint, saved even when nothing critical changed. */
export const TOWN_PERSONAL_CHECKPOINT_SECONDS = 5
/** A critical lifecycle change (death, order, owner, formation arrival…) waits at most this long
 * after the previous successful save, so bursts of changes coalesce into one Career write. */
export const TOWN_PERSONAL_CRITICAL_MIN_SECONDS = 2

/**
 * `elapsed` counts from the last successful save. Forced saves (pagehide, return, scene exit) and
 * retirement flows are never delayed.
 */
export function townPersonalCheckpointDue(elapsed: number, criticalChanged: boolean, force: boolean, retirement: boolean): boolean {
  if (force || elapsed >= TOWN_PERSONAL_CHECKPOINT_SECONDS) return true
  if (!criticalChanged) return false
  return retirement || elapsed >= TOWN_PERSONAL_CRITICAL_MIN_SECONDS
}
