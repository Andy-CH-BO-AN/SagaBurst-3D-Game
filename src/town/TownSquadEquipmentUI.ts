import type { CareerProfile } from '../career/CareerProfile'
import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'
import { availableCareerItem, careerItemTotal, careerItemTotals, legacyPersonalEquipment, type PersonalEquipmentSlot } from '../career/CareerInventory'
import { canRecruitPersonalSquad, PERSONAL_SQUAD_PRODUCTS } from '../career/CareerPersonalSquad'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { EquipmentSquadAdapter, EquipmentTownAdapter } from '../ui/EquipmentUI'
import type { BulkEquipmentCategory, TownEquipmentSquadId } from '../career/CareerTownEquipment'
import type { PersonalSquadState } from './TownPersonalSquadController'

export function squadEquipmentUI(read: () => CareerProfile, state: () => PersonalSquadState,
  change: (memberId: string, slot: PersonalEquipmentSlot, id: string | null) => string, bulk?: EquipmentBulkAdapter, management?: () => { allowed: boolean; reason: string }): EquipmentSquadAdapter {
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
    const missionActive = Boolean(profile.activeMission || profile.activeOutpostMission)
    const access = management?.()
    const canChange = currentState === 'RESERVE' && !missionActive && access?.allowed !== false
    heading.textContent += ` · 存活 ${profile.personalSquad?.members.length ?? 0} · 可整補 ${canChange ? profile.personalSquad?.members.length ?? 0 : 0}`
    const lockNotice = access?.allowed === false ? access.reason : missionActive
      ? profile.activeMission?.kind === 'duel' && profile.activeMission.phase === 'RETURNING'
        ? '單挑尚未結算。請先關閉面板，跟隨裁判回營完成結算後，再替小隊換裝。'
        : '任務尚未結算。請先關閉面板，完成任務並返回小鎮結算後，再替小隊換裝。'
      : '全隊回到 HR、進入 RESERVE 後才能換裝。'
    const notice = document.createElement('p'); notice.className = 'inv-item-desc inventory-wide'
    notice.textContent = canChange ? message || '換裝只使用背包可用份數。裝備遠程會退回盾牌；裝備盾牌會退回遠程武器。' : lockNotice
    container.append(notice)
    appendBulkControls(container, bulk, () => canRecruitPersonalSquad(read()) && management?.().allowed !== false && state() === 'RESERVE' && !read().activeMission && !read().activeOutpostMission, lockNotice, value => { message = value; refresh() })
    if (!profile.personalSquad?.members.length) {
      const empty = document.createElement('p'); empty.className = 'inv-item-desc inventory-wide'
      empty.textContent = '尚未雇用隊員。前往人資中心（HR Center）雇用隊員後，可在此管理小隊裝備。'
      container.append(empty)
    }
    for (const [index, member] of (profile.personalSquad?.members ?? []).entries()) {
      const card = document.createElement('article'); card.className = 'inventory-card'; card.dataset.memberId = member.id
      const title = document.createElement('strong'); title.textContent = `${PERSONAL_SQUAD_PRODUCTS.find(item => item.type === member.type)!.name} #${index + 1}`; card.append(title)
      const identity = document.createElement('p'); identity.className = 'inv-item-desc'; identity.textContent = `Actor ID: ${member.id}`; card.append(identity)
      const equipment = member.equipment ?? legacyPersonalEquipment(member.type, profile.faction)
      if (member.type === 'ranger') {
        const fixed = document.createElement('p'); fixed.className = 'inv-item-desc'; fixed.textContent = 'Weapon: Ranger Bow · 固定\nShield: None · 固定'; fixed.style.whiteSpace = 'pre-line'; card.append(fixed)
      }
      for (const slot of (member.type === 'ranger' ? ['mount'] : ['melee', 'ranged', 'shield', 'mount']) as PersonalEquipmentSlot[]) {
        const label = document.createElement('label'); label.className = 'inv-item-desc squad-equipment-slot'; label.style.display = 'block'
        const current = equipment[slot], item = current ? WEAPONS[current] ?? ARMORS[current] : undefined
        label.textContent = SLOT_LABELS[slot] + (item ? ` · T${item.tier}` : current ? current === 'horse' ? ' · T1' : ' · T4' : '') + ': '
        const select = document.createElement('select'); select.className = 'town-button'; select.setAttribute('aria-label', `${title.textContent} ${slot}`)
        const canRemove = slot !== 'melee' && slot !== 'ranged' || Boolean(equipment[slot === 'melee' ? 'ranged' : 'melee'])
        if (canRemove || !equipment[slot]) select.add(new Option('None', ''))
        for (const id of Object.keys(careerItemTotals(profile))) {
          const item = WEAPONS[id] ?? ARMORS[id]
          const fits = slot === 'mount' ? (PLAYER_MOUNT_IDS as readonly string[]).includes(id) : item?.type === (slot === 'shield' ? 'shield' : slot)
          if (!fits || !availableCareerItem(profile, id) && equipment[slot] !== id) continue
          const name = item?.name ?? ({ horse: 'Horse', corgi: 'Corgi', 'black-cat': 'Black Cat', xongkoro: 'xongkoro' } as Record<string, string>)[id]
          const tier = item?.tier ?? (id === 'horse' ? 1 : 4)
          select.add(new Option(`${name} · T${tier} · 可用 ${availableCareerItem(profile, id)} / ${careerItemTotal(profile, id)}`, id))
        }
        select.value = equipment[slot] ?? ''; select.disabled = !canChange; select.title = canChange ? '' : lockNotice
        select.onchange = () => {
          message = canRecruitPersonalSquad(read()) && management?.().allowed !== false && state() === 'RESERVE' && !read().activeMission && !read().activeOutpostMission
            ? change(member.id, slot, select.value || null) : lockNotice
          refresh()
        }
        label.append(select); card.append(label)
      }
      container.append(card)
    }
  } }
}


const SLOT_LABELS: Record<PersonalEquipmentSlot, string> = { melee: '近戰 Melee', ranged: '遠程 Ranged', shield: '盾牌 Shield', mount: '坐騎 Mount' }
const BULK_ACTIONS: readonly { category: BulkEquipmentCategory; label: string }[] = [
  { category: 'bow', label: '一鍵換弓' }, { category: 'sword', label: '一鍵換刀' },
  { category: 'axe', label: '一鍵換斧' }, { category: 'spear', label: '一鍵換槍' }, { category: 'mount', label: '一鍵換馬' },
]
export interface EquipmentBulkAdapter {
  change(category: BulkEquipmentCategory): string
  availability?(category: BulkEquipmentCategory): { enabled: boolean; reason?: string }
}

function appendBulkControls(container: HTMLElement, bulk: EquipmentBulkAdapter | undefined, canChange: () => boolean,
  lockReason: string, onMessage: (message: string) => void): void {
  const controls = document.createElement('div'); controls.className = 'squad-bulk-controls inventory-wide'
  controls.setAttribute('aria-label', '小隊一鍵換裝')
  const initiallyAllowed = canChange()
  for (const action of BULK_ACTIONS) {
    const availability = bulk?.availability?.(action.category)
    const reason = !initiallyAllowed ? lockReason : !bulk ? '目前無法批量換裝。' : availability?.enabled === false ? availability.reason ?? '沒有適用裝備。' : ''
    const button = document.createElement('button'); button.className = 'btn-equip'; button.type = 'button'
    button.textContent = action.label; button.dataset.bulkCategory = action.category
    button.disabled = Boolean(reason); button.title = reason
    button.onclick = () => {
      if (!canChange()) { onMessage(lockReason); return }
      const latest = bulk?.availability?.(action.category)
      if (!bulk || latest?.enabled === false) { onMessage(latest?.reason ?? reason); return }
      onMessage(bulk.change(action.category))
    }
    controls.append(button)
  }
  container.append(controls)
}

export interface TownEquipmentOption { id: string | null; label: string }
export interface TownEquipmentSlotView { id: string | null; label: string; tier?: number }
export interface TownEquipmentMemberView {
  id: string
  name: string
  tier: number
  equipment: Record<PersonalEquipmentSlot, TownEquipmentSlotView>
  readOnly?: boolean
  reason?: string
  lockedSlots?: readonly PersonalEquipmentSlot[]
  fixedEquipment?: readonly string[]
}
export interface TownEquipmentSquadView {
  id: TownEquipmentSquadId
  name: string
  total: number
  alive: number
  refittable: number
  members: readonly TownEquipmentMemberView[]
  reason?: string
}
export interface TownEquipmentUIBindings {
  access?(): { allowed: boolean; reason: string }
  read(): { allowed: boolean; reason: string; squads: readonly TownEquipmentSquadView[] }
  personal: EquipmentSquadAdapter
  options(squadId: TownEquipmentSquadId, actorId: string, slot: PersonalEquipmentSlot): readonly TownEquipmentOption[]
  change(squadId: TownEquipmentSquadId, actorId: string, slot: PersonalEquipmentSlot, id: string | null): string
  bulk(squadId: TownEquipmentSquadId, category: BulkEquipmentCategory): string
  bulkAvailability?(squadId: TownEquipmentSquadId, category: BulkEquipmentCategory): { enabled: boolean; reason?: string }
}

/** Views and permissions come from the Town domain; the Personal panel reuses its original adapter. */
export function townEquipmentUI(bindings: TownEquipmentUIBindings): EquipmentTownAdapter {
  let selected: TownEquipmentSquadId | undefined, message = ''
  return {
    access: () => { const view = bindings.access?.() ?? bindings.read(); return { allowed: view.allowed, reason: view.reason } },
    render(container, refresh) {
      const view = bindings.read()
      if (!view.allowed) {
        const notice = document.createElement('p'); notice.className = 'inv-item-desc inventory-wide'
        notice.textContent = view.reason; container.append(notice); return
      }
      if (!view.squads.some(squad => squad.id === selected)) selected = view.squads[0]?.id
      const tabs = document.createElement('div'); tabs.className = 'town-equipment-tabs'; tabs.setAttribute('role', 'tablist')
      tabs.setAttribute('aria-label', '全城裝備小隊')
      view.squads.forEach((squad, index) => {
        const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'equipment-tab'
        tab.textContent = squad.name; tab.dataset.squadId = String(squad.id); tab.id = `town-equipment-squad-${squad.id}`
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'town-equipment-current')
        tab.setAttribute('aria-selected', String(squad.id === selected)); tab.tabIndex = squad.id === selected ? 0 : -1
        tab.onclick = () => { selected = squad.id; message = ''; refresh() }
        tab.onkeydown = event => {
          let next: number
          switch (event.key) {
            case 'ArrowRight': next = (index + 1) % view.squads.length; break
            case 'ArrowLeft': next = (index + view.squads.length - 1) % view.squads.length; break
            case 'Home': next = 0; break
            case 'End': next = view.squads.length - 1; break
            default: return
          }
          event.preventDefault(); selected = view.squads[next].id; message = ''; refresh()
          document.getElementById(`town-equipment-squad-${selected}`)?.focus()
        }
        tabs.append(tab)
      })
      container.append(tabs)
      const squad = view.squads.find(squad => squad.id === selected)
      if (!squad) return
      const panel = document.createElement('div'); panel.id = 'town-equipment-current'
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `town-equipment-squad-${squad.id}`)
      container.append(panel)
      const heading = document.createElement('div'); heading.className = 'modal-section-title'
      heading.textContent = `${squad.name} · 總人數 ${squad.total} · 存活 ${squad.alive} · 可整補 ${squad.refittable}`
      panel.append(heading)
      if (squad.id === 'personal') { bindings.personal.render(panel, refresh); return }
      const notice = document.createElement('p'); notice.className = 'inv-item-desc squad-equipment-summary'
      notice.setAttribute('role', 'status'); notice.textContent = message || squad.reason || '全隊規劃，不降低任何成員的裝備 Tier；成功保存後套用。'
      panel.append(notice)
      const currentSquad = () => bindings.read().squads.find(current => current.id === squad.id)
      const initiallyAllowed = view.allowed && Boolean(squad.refittable) && !squad.reason
      const canChange = () => {
        const latest = bindings.read(), current = latest.squads.find(current => current.id === squad.id)
        return latest.allowed && Boolean(current?.refittable) && !current?.reason
      }
      appendBulkControls(panel, {
        change: category => bindings.bulk(squad.id, category),
        availability: category => bindings.bulkAvailability?.(squad.id, category) ?? { enabled: true },
      }, canChange, squad.reason || '此小隊目前沒有可整補成員。', value => { message = value; refresh() })
      const members = document.createElement('div'); members.className = 'inventory-grid town-equipment-members'; panel.append(members)
      for (const member of squad.members) {
        const card = document.createElement('article'); card.className = 'inventory-card'; card.dataset.memberId = member.id
        const title = document.createElement('strong'); title.textContent = member.id === 'merchant' ? '武器商人 · 固定 T5 武器／T4 盾牌' : `${member.name} · ${member.tier ? `T${member.tier}` : '未配武器'}`
        card.append(title)
        const identity = document.createElement('p'); identity.className = 'inv-item-desc'; identity.textContent = `Actor ID: ${member.id}`; card.append(identity)
        if (member.fixedEquipment?.length) {
          const fixed = document.createElement('p'); fixed.className = 'inv-item-desc squad-equipment-summary'
          fixed.textContent = member.fixedEquipment.join('\n'); card.append(fixed)
        }
        if (member.reason) { const reason = document.createElement('p'); reason.className = 'inv-item-desc'; reason.textContent = member.reason; card.append(reason) }
        for (const slot of ['melee', 'ranged', 'shield', 'mount'] as const) {
          const equipped = member.equipment[slot]
          const label = document.createElement('label'); label.className = 'inv-item-desc squad-equipment-slot'
          label.textContent = `${SLOT_LABELS[slot]}${equipped.tier ? ` · T${equipped.tier}` : ''}: `
          if (member.readOnly || member.lockedSlots?.includes(slot)) {
            const fixed = document.createElement('span'); fixed.textContent = `${equipped.label} · 固定`; label.append(fixed)
          } else {
            const select = document.createElement('select'); select.className = 'town-button'
            select.setAttribute('aria-label', `${member.name} ${member.id} ${slot}`)
            const options = bindings.options(squad.id, member.id, slot)
            for (const option of options) select.add(new Option(option.label, option.id ?? ''))
            if (!options.some(option => option.id === equipped.id)) select.add(new Option(equipped.label, equipped.id ?? ''))
            select.value = equipped.id ?? ''; select.disabled = !initiallyAllowed || Boolean(member.reason)
            select.title = member.reason || (!initiallyAllowed ? squad.reason || '目前無法整補。' : '')
            select.onchange = () => {
              const latest = currentSquad()?.members.find(current => current.id === member.id)
              message = !canChange() ? squad.reason || '目前無法整補。' : !latest || latest.readOnly || latest.reason || latest.lockedSlots?.includes(slot)
                ? latest?.reason || '此成員裝備不可修改。' : bindings.change(squad.id, member.id, slot, select.value || null)
              refresh()
            }
            label.append(select)
          }
          card.append(label)
        }
        members.append(card)
      }
    },
  }
}

/** Shared wording for HR and Town results, including no-op and failed atomic saves. */
export function bulkEquipmentMessage(result: { changed: boolean; reason?: string; summary: { equipped: number; upgraded: number; unchanged: number; insufficient: number; ineligible: number } }): string {
  const heading = result.changed ? '換裝已保存。' : result.reason === 'no-op' ? '已達最佳分配，保持原裝備。'
    : result.reason === 'no-available-item' ? '無適用庫存，保持原裝備。'
    : result.reason === 'save-failed' ? '保存失敗，所有裝備保持不變。' : '目前無法換裝，所有裝備保持不變。'
  const summary = result.summary
  return `${heading}\n成功換裝：${result.changed ? summary.equipped : 0} 人 · 升級：${result.changed ? summary.upgraded : 0} 人\n保持不變：${summary.unchanged} 人 · 裝備不足：${summary.insufficient} 人 · 不適用／無法整補：${summary.ineligible} 人`
}
