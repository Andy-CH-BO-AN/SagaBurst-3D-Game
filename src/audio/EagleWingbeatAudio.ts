import type { Mount } from '../world/Mount'
import type { SoundManager, EagleWingbeatCandidate } from './SoundManager'

type AudibleEagle = Pick<Mount, 'dead' | 'disposed' | 'isAirborne' | 'currentLod' | 'group'> & {
  eagleVisual: Pick<NonNullable<Mount['eagleVisual']>, 'wingbeatSequence' | 'isFlapping'> | null
}

/** Shared scene bridge includes unmanned eagles while their actual wings still flap. */
export function updateEagleWingbeatAudio(sound: Pick<SoundManager, 'updateEagleWingbeats'> | null,
  mounts: readonly (AudibleEagle | null | undefined)[], listener: { x: number; y: number; z: number },
  playerMount: AudibleEagle | null): void {
  if (!sound) return
  const candidates: EagleWingbeatCandidate[] = []
  const visited = new Set<AudibleEagle>()
  for (const mount of mounts) {
    if (!mount?.eagleVisual || visited.has(mount)) continue
    visited.add(mount)
    const position = mount.group.position
    candidates.push({ id: mount, active: !mount.dead && !mount.disposed && mount.isAirborne && mount.eagleVisual.isFlapping,
      lod: mount.currentLod, distance: Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z),
      isPlayer: mount === playerMount, sequence: mount.eagleVisual.wingbeatSequence })
  }
  sound.updateEagleWingbeats(candidates)
}
