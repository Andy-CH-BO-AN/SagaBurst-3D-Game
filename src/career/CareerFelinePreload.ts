import type { FelineMountVariant } from '../world/BlackCatVisual'
import { felineVariantFromMountId } from '../world/Mount'
import type { CareerProfile } from './CareerProfile'

/**
 * Feline variants a Town scene must be able to construct synchronously at startup:
 * the Town Cat, the player's selected/active/saved-race mount, saved race opponent,
 * and mounts already assigned to squad members or Town actors. Merely owned mounts are
 * deferred until summon, purchase or preview.
 */
export function careerFelineVariants(profile: CareerProfile): Set<FelineMountVariant> {
  const ids: Array<string | null | undefined> = [
    'black-cat',
    profile.selectedMountId,
    profile.activeMission?.mountState?.activeMountId,
    profile.retirementRuntime?.mountState?.activeMountId,
    profile.racePlayerState?.mountId,
    profile.activeRace?.player.mountId,
    profile.activeRace?.opponent.mountId,
    ...(profile.personalSquad?.members ?? []).map(member => member.equipment?.mount),
    ...Object.values(profile.townEquipment ?? {}).flatMap(state => Object.values(state?.actors ?? {}).map(refs => refs.mount?.itemId)),
  ]
  const variants = new Set<FelineMountVariant>()
  for (const id of ids) {
    const variant = felineVariantFromMountId(id)
    if (variant) variants.add(variant)
  }
  return variants
}
