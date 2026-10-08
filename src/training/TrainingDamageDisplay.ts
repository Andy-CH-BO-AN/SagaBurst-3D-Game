import type { CombatEvent } from '../combat/CombatAttribution'
import { WEAPONS } from '../rpg/WeaponDatabase'

export function trainingDamageText(event: CombatEvent, mountName?: string): string | null {
  if (event.type !== 'damage_applied' || event.target.targetType !== 'training') return null
  const source = event.method === 'mount-impact' || event.attackSource === 'xongkoro'
    ? `Mount: ${mountName ?? 'xongkoro'}`
    : `Weapon: ${WEAPONS[event.weaponId ?? '']?.name ?? '—'}`
  const method = { melee: 'Melee · 近戰', projectile: 'Ranged · 遠程', 'mount-impact': 'Mount Impact · 衝撞', siege: 'Siege', fall: 'Fall' }[event.method]
  return `${source}\nTarget: ${event.target.name}\nDamage: ${Number(event.appliedDamage.toFixed(2))}\nDamage Type: ${method}${event.contactKind ? `\nHit: ${event.contactKind}` : ''}`
}
