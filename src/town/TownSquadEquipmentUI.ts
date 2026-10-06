import type { CareerProfile } from '../career/CareerProfile'
import { availableCareerItem, careerItemTotal, careerItemTotals, initialPersonalEquipment, type PersonalEquipmentSlot } from '../career/CareerInventory'
import { canRecruitPersonalSquad, PERSONAL_SQUAD_PRODUCTS } from '../career/CareerPersonalSquad'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { EquipmentSquadAdapter } from '../ui/EquipmentUI'
import type { PersonalSquadState } from './TownPersonalSquadController'

export function squadEquipmentUI(read: () => CareerProfile, state: () => PersonalSquadState,
  change: (memberId: string, slot: PersonalEquipmentSlot, id: string | null) => string): EquipmentSquadAdapter {
  let message = ''
  return { render(container, refresh) {
    const profile = read(), currentState = state()
    if (!canRecruitPersonalSquad(profile)) {
      const locked = document.createElement('p'); locked.className = 'inv-item-desc inventory-wide'
      locked.textContent = '升任隊長（Captain）後，可到人資中心（HR Center）雇用隊員。'
      container.append(locked)
      return
    }
    const heading = document.createElement('div'); heading.className = 'modal-section-title inventory-wide'
    heading.textContent = `Personal Squad · ${profile.personalSquad?.members.length ?? 0}/30 · ${currentState}`; container.append(heading)
    const notice = document.createElement('p'); notice.className = 'inv-item-desc inventory-wide'
    notice.textContent = message || (currentState === 'RESERVE' ? '換裝只使用背包可用份數。裝備遠程會退回盾牌；裝備盾牌會退回遠程武器。' : '全隊回到 HR、進入 RESERVE 後才能換裝。')
    container.append(notice)
    if (!profile.personalSquad?.members.length) {
      const empty = document.createElement('p'); empty.className = 'inv-item-desc inventory-wide'
      empty.textContent = '尚未雇用隊員。前往人資中心（HR Center）雇用隊員後，可在此管理小隊裝備。'
      container.append(empty)
    }
    for (const [index, member] of (profile.personalSquad?.members ?? []).entries()) {
      const card = document.createElement('article'); card.className = 'inventory-card'; card.dataset.memberId = member.id
      const title = document.createElement('strong'); title.textContent = `${PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)!.name} #${index + 1}`; card.append(title)
      const equipment = member.equipment ?? initialPersonalEquipment(member.type, profile.faction)
      if (member.type === 'ranger') {
        const fixed = document.createElement('p'); fixed.className = 'inv-item-desc'; fixed.textContent = 'Weapon: Ranger Bow · 固定\nShield: None · 固定'; fixed.style.whiteSpace = 'pre-line'; card.append(fixed)
      }
      for (const slot of (member.type === 'ranger' ? ['mount'] : ['melee', 'ranged', 'shield', 'mount']) as PersonalEquipmentSlot[]) {
        const label = document.createElement('label'); label.className = 'inv-item-desc squad-equipment-slot'; label.style.display = 'block'
        label.textContent = ({ melee: '近戰 Melee', ranged: '遠程 Ranged', shield: '盾牌 Shield', mount: '坐騎 Mount' })[slot] + ': '
        const select = document.createElement('select'); select.className = 'town-button'; select.setAttribute('aria-label', `${title.textContent} ${slot}`)
        const canRemove = slot !== 'melee' && slot !== 'ranged' || Boolean(equipment[slot === 'melee' ? 'ranged' : 'melee'])
        if (canRemove || !equipment[slot]) select.add(new Option('None', ''))
        for (const id of Object.keys(careerItemTotals(profile))) {
          const item = WEAPONS[id] ?? ARMORS[id]
          const fits = slot === 'mount' ? ['horse', 'black-cat', 'corgi'].includes(id) : item?.type === (slot === 'shield' ? 'shield' : slot)
          if (!fits || !availableCareerItem(profile, id) && equipment[slot] !== id) continue
          const name = item?.name ?? ({ horse: 'Horse', corgi: 'Corgi', 'black-cat': 'Black Cat' } as Record<string, string>)[id]
          select.add(new Option(`${name} · 可用 ${availableCareerItem(profile, id)} / ${careerItemTotal(profile, id)}`, id))
        }
        select.value = equipment[slot] ?? ''; select.disabled = currentState !== 'RESERVE'
        select.onchange = () => { message = change(member.id, slot, select.value || null); refresh() }
        label.append(select); card.append(label)
      }
      container.append(card)
    }
  } }
}
