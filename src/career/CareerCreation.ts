import { createCareerProfile, type CareerProfile } from './CareerProfile'
import type { CharacterFaction } from '../world/CharacterVisuals'

/** Single-save creation transaction, shared by ordinary creation and confirmed ending replacement.
 * New recruits own no permanent equipment; training supplies scene-local borrowed gear.
 * Nothing is deleted first, so cancellation and a refused write retain the previous save.
 */
export function createAndSaveCareer(
  current: CareerProfile | null,
  faction: CharacterFaction,
  replaceCompleted: boolean,
  save: (profile: CareerProfile) => boolean,
): CareerProfile | null {
  if (current && (!replaceCompleted || current.careerRetirement?.phase !== 'completed')) return null
  const next = createCareerProfile(faction)
  next.inventory = { version: 1, quantities: {} }
  next.equipment = {}
  return save(next) ? next : null
}
