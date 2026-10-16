import type { CareerProfile } from '../career/CareerProfile'
import { availableCareerItem, careerItemTotals, legacyPersonalEquipment, type PersonalEquipmentSlot } from '../career/CareerInventory'
import { PLAYER_MOUNT_IDS } from '../battle/BattleConfig'
import { bulkCareerEquipment, canManageCareerEquipment, careerEquipmentCategory, changeTownEquipment, resolveTownActorEquipment, townEquipmentSquads,
  type BulkEquipmentCategory, type TownEquipmentContext, type TownEquipmentSquadId } from '../career/CareerTownEquipment'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { squadEquipmentUI, townEquipmentUI, bulkEquipmentMessage, type TownEquipmentMemberView, type TownEquipmentUIBindings } from './TownSquadEquipmentUI'
import type { TownCombatResident } from './TownMissionCombat'

export interface TownEquipmentUIResident {
  spec: Pick<TownCombatResident['spec'], 'id'>
  npc: Pick<TownCombatResident['npc'], 'name' | 'dead'>
}

const MOUNT_NAMES: Record<string, string> = { horse: '軍用戰馬', corgi: '柯基英雄坐騎', 'black-cat': '黑貓英雄坐騎', xongkoro: '巨鷹 xongkoro' }
const itemName = (id: string | null | undefined) => id ? (WEAPONS[id] ?? ARMORS[id])?.name ?? MOUNT_NAMES[id] ?? id : 'None'

/** Both views share the profile, transaction entry and Personal adapter. No UI-owned roster exists. */
export function createTownCareerEquipmentUI(read: () => CareerProfile, context: () => TownEquipmentContext,
  residents: () => readonly TownEquipmentUIResident[], save: (profile: CareerProfile) => boolean,
  apply: (previous: CareerProfile, current: CareerProfile, actorIds: readonly string[]) => number) {
  const bulk = (target: TownEquipmentSquadId, category: BulkEquipmentCategory): string => {
    const previous = read(), result = bulkCareerEquipment(read, context(), target, category, save)
    const pending = result.changed ? apply(previous, read(), result.changedActorIds) : 0
    return bulkEquipmentMessage(result) + (pending ? `\n${pending} 人配置已保存，待下次回城套用。` : '')
  }
  const personal = squadEquipmentUI(read, () => context().personalState, (id, slot, item) => {
    const result = changeTownEquipment(read, context(), id, slot, item, save)
    return result.changed ? '裝備已保存，下次部署使用新配置。' : result.reason === 'save-failed' ? '保存失敗，所有裝備保持不變。' : '無法換裝：請確認權限、已回營與可用份數。'
  }, { change: category => bulk('personal', category) }, () => {
    const gate = canManageCareerEquipment(read(), context(), 'personal')
    return { allowed: !gate, reason: gate === 'enemy-town' ? '返回家鄉城鎮後才能整補換裝。'
      : gate === 'rank-locked' ? '升任 Captain 後才能管理 HR 私兵。' : gate === 'not-safe' ? '目前正在交戰，和平整補時才能換裝。'
      : gate === 'mission-active' ? '任務尚未結算，返回本城後才能整補換裝。' : '全隊回到 HR、進入 RESERVE 後才能換裝。' }
  })
  const bindings: TownEquipmentUIBindings = {
    personal,
    access() {
      const profile = read(), state = context()
      return { allowed: profile.rank === 'commander' && state.townFaction === profile.faction,
        reason: profile.rank !== 'commander' ? '正式升任 Commander 後可管理全城裝備。' : state.townFaction !== profile.faction ? '只能管理家鄉城鎮的裝備。' : '' }
    },
    read() {
      const profile = read(), state = context(), live = new Map(residents().map(resident => [resident.spec.id, resident]))
      const allowed = profile.rank === 'commander' && state.townFaction === profile.faction
      const reason = profile.rank !== 'commander' ? '正式升任 Commander 後可管理全城裝備。' : state.townFaction !== profile.faction ? '只能管理家鄉城鎮的裝備。' : ''
      const unavailable = profile.activeMission || profile.activeOutpostMission ? '任務尚未結算，返回本城後才能整補換裝。' : !state.peaceful || profile.townEvent?.state === 'hostile' ? '目前正在交戰，和平整補時才能換裝。' : ''
      const squads = townEquipmentSquads(profile).map(squad => {
        const members: TownEquipmentMemberView[] = squad.id === 'personal' ? [] : squad.actorIds.map(id => {
          const resolved = resolveTownActorEquipment(profile, profile.faction, id), resident = live.get(id)
          const ids = { melee: resolved.loadout.meleeWeaponId ?? null, ranged: resolved.loadout.rangedWeaponId ?? null,
            shield: resolved.loadout.shieldId ?? null, mount: resolved.loadout.mountId ?? null }
          const equipment = Object.fromEntries((['melee', 'ranged', 'shield', 'mount'] as const).map(slot => {
            const item = ids[slot], tier = item ? slot === 'mount' ? resolved.mountTier : (WEAPONS[item] ?? ARMORS[item])?.tier : undefined
            return [slot, { id: item, label: itemName(item), tier }]
          })) as TownEquipmentMemberView['equipment']
          const merchant = resolved.spec.role === 'merchant'
          return { id, name: resident?.npc.name ?? id, tier: resolved.tier, equipment, readOnly: resolved.readOnly,
            lockedSlots: resolved.fixedWeapons ? ['melee', 'ranged', 'shield'] : resolved.spec.eagle ? ['mount'] : undefined,
            reason: !resident ? '不在目前場景，保存配置唯讀。' : resident.npc.dead ? '已陣亡，整補後才能換裝。'
              : !state.safeActorIds.has(id) ? '正在交戰、返回或飛行，整補完成後才能換裝。' : undefined,
            fixedEquipment: merchant ? [itemName(resolved.loadout.meleeWeaponId) + ' · T5', itemName(resolved.loadout.secondaryMeleeWeaponId) + ' · T5', itemName(resolved.loadout.shieldId) + ' · T4'] : undefined }
        })
        return { ...squad, total: squad.actorIds.length,
          alive: squad.id === 'personal' ? profile.personalSquad?.members.length ?? 0 : squad.actorIds.filter(id => live.has(id) && !live.get(id)!.npc.dead).length,
          refittable: unavailable ? 0 : squad.actorIds.filter(id => state.safeActorIds.has(id)
            && (squad.id === 'personal' || live.has(id) && !live.get(id)!.npc.dead)).length,
          members, reason: unavailable || undefined }
      })
      return { allowed, reason, squads }
    },
    options(target, actorId, slot) {
      const profile = read()
      const current = target === 'personal' ? (profile.personalSquad?.members.find(member => member.id === actorId)?.equipment
        ?? legacyPersonalEquipment('soldier', profile.faction))[slot] : (() => {
        const loadout = resolveTownActorEquipment(profile, profile.faction, actorId).loadout
        return slot === 'melee' ? loadout.meleeWeaponId : slot === 'ranged' ? loadout.rangedWeaponId : slot === 'shield' ? loadout.shieldId : loadout.mountId
      })()
      const loadout = target === 'personal' ? undefined : resolveTownActorEquipment(profile, profile.faction, actorId).loadout
      const canRemove = target === 'civilian' || slot !== 'melee' && slot !== 'ranged' || Boolean(slot === 'melee' ? loadout?.rangedWeaponId : loadout?.meleeWeaponId)
      const options: { id: string | null; label: string }[] = canRemove ? [{ id: null, label: 'None' }] : []
      for (const id of Object.keys(careerItemTotals(profile)).sort()) {
        const item = WEAPONS[id] ?? ARMORS[id]
        const fits = slot === 'mount' ? (PLAYER_MOUNT_IDS as readonly string[]).includes(id) && (target === 'personal' || careerEquipmentCategory(id) === 'mount') : item?.type === slot
        if (fits && (actorId !== 'merchant' || slot !== 'mount' || id === 'horse') && (availableCareerItem(profile, id) > 0 || current === id)) options.push({ id, label: `${itemName(id)}${item ? ` · T${item.tier}` : ''} · 可用 ${availableCareerItem(profile, id)}` })
      }
      return options
    },
    change(_target, actorId, slot: PersonalEquipmentSlot, id) {
      const previous = read(), result = changeTownEquipment(read, context(), actorId, slot, id, save)
      const pending = result.changed ? apply(previous, read(), [actorId]) : 0
      return result.changed ? pending ? '配置已保存，待下次回城套用。' : '裝備已保存並套用。'
        : result.reason === 'save-failed' ? '保存失敗，所有裝備保持不變。' : result.reason === 'no-op' ? '保持原裝備。' : '目前無法換裝，請確認整補狀態與可用份數。'
    },
    bulk,
  }
  return { personal, town: townEquipmentUI(bindings) }
}
