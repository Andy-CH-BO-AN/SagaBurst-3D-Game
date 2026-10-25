import { canRecruitPersonalSquad, PERSONAL_SQUAD_LIMIT } from '../career/CareerPersonalSquad'
import { PERSONAL_RECRUITMENT_ROLES, PERSONAL_ROLE_NAMES, resolvePersonalRecruitment, type PersonalRecruitmentChoice } from '../career/CareerRecruitmentCatalog'
import type { CareerProfile } from '../career/CareerProfile'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'

export function personalRecruitmentPresentation(profile: CareerProfile, choice: PersonalRecruitmentChoice, serviceAvailable: boolean) {
  const product = resolvePersonalRecruitment(profile.faction, choice)
  const count = profile.personalSquad?.members.length ?? 0
  const reason = !serviceAvailable ? '目前人資服務不可用。' : !product ? '請選擇合法的人物、英雄類型與兵種。'
    : !canRecruitPersonalSquad(profile, product.type) ? product.type === 'commander' ? '需正式任命為 Commander。' : '需正式任命為 Captain。'
    : count >= PERSONAL_SQUAD_LIMIT ? '私人部隊已達 30 人上限。'
    : profile.availableMerit < product.price ? '可用軍功不足。' : undefined
  if (!product) return { product, reason, summary: reason! }
  const item = (id: string | null) => {
    const data = id ? WEAPONS[id] ?? ARMORS[id] : undefined
    return data ? `${data.name} · T${data.tier}` : '無'
  }
  const hero = product.heroArchetype === 'captain' ? '隊長 Captain' : product.heroArchetype === 'ranger' ? '遊俠 Ranger'
    : product.heroArchetype === 'commander' ? '指揮官 Commander' : '普通士兵'
  return { product, reason, summary: [
    `${profile.faction === 'roman' ? '羅馬 Roman' : '維京 Viking'} · 人物 T${product.characterTier} · ${hero} · ${PERSONAL_ROLE_NAMES[product.recruitmentRole]}`,
    `招募 ${product.price.toLocaleString()} Merit · 基礎 Max HP ${product.maxHp}`,
    `主武器：${item(product.equipment.ranged ?? product.equipment.melee)}`,
    ...(product.equipment.ranged ? [`備用近戰：${item(product.equipment.melee)}`] : []),
    `盾牌：${item(product.equipment.shield)} · 坐騎：${product.equipment.mount ? '一般馬' : '無坐騎'}`,
    `私人部隊 ${count} / ${PERSONAL_SQUAD_LIMIT} · 可用軍功 ${profile.availableMerit.toLocaleString()}`,
    ...(reason ? [reason] : []),
  ].join('\n') }
}

/** The panel only submits a choice; the transaction resolves price and grants again. */
export function appendPersonalRecruitmentConfigurator(parent: HTMLElement, options: {
  readProfile(): CareerProfile
  serviceAvailable(): boolean
  choice: PersonalRecruitmentChoice
  onChoice(choice: PersonalRecruitmentChoice): void
  recruit(choice: PersonalRecruitmentChoice): void
}): void {
  const row = document.createElement('article'); row.className = 'town-product'
  const select = (labelText: string, entries: readonly (readonly [string, string])[]) => {
    const label = document.createElement('label'); label.textContent = labelText
    const input = document.createElement('select'); input.className = 'town-purchase-select'; input.setAttribute('aria-label', labelText)
    for (const [value, text] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option) }
    label.append(input); row.append(label); return { label, input }
  }
  const tier = select('人物 Tier', [1, 2, 3, 4, 5].map(value => [String(value), `T${value}`]))
  const hero = select('T4 英雄類型', [['captain', '隊長 Captain'], ['ranger', '遊俠 Ranger']])
  const role = select('招募兵種', PERSONAL_RECRUITMENT_ROLES.map(value => [value, PERSONAL_ROLE_NAMES[value]]))
  tier.input.value = String(options.choice.characterTier)
  hero.input.value = options.choice.heroArchetype === 'ranger' ? 'ranger' : 'captain'
  role.input.value = options.choice.recruitmentRole
  const summary = document.createElement('p'); summary.className = 'town-summary'; summary.style.whiteSpace = 'pre-line'; summary.setAttribute('aria-live', 'polite')
  const button = document.createElement('button'); button.className = 'town-button'; button.textContent = 'Recruit · 招募'
  let choice = options.choice
  const refresh = () => {
    const characterTier = Number(tier.input.value) as PersonalRecruitmentChoice['characterTier']
    hero.label.hidden = characterTier !== 4; hero.input.disabled = characterTier !== 4
    choice = { characterTier, recruitmentRole: role.input.value as PersonalRecruitmentChoice['recruitmentRole'],
      ...(characterTier === 4 ? { heroArchetype: hero.input.value as 'captain' | 'ranger' } : characterTier === 5 ? { heroArchetype: 'commander' as const } : {}) }
    options.onChoice(choice)
    const view = personalRecruitmentPresentation(options.readProfile(), choice, options.serviceAvailable())
    summary.textContent = view.summary; button.disabled = Boolean(view.reason); button.title = view.reason ?? ''
  }
  for (const control of [tier.input, hero.input, role.input]) control.onchange = refresh
  button.onclick = () => {
    refresh()
    if (!button.disabled) options.recruit(choice)
  }
  row.append(summary, button); parent.append(row); refresh()
}
