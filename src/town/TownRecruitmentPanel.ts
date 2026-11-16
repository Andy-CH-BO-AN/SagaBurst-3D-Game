import { canRecruitPersonalSquad, PERSONAL_SQUAD_LIMIT } from '../career/CareerPersonalSquad'
import { PERSONAL_RECRUITMENT_ROLES, PERSONAL_ROLE_NAMES, personalHeroOptions, resolvePersonalRecruitment, type PersonalRecruitmentChoice } from '../career/CareerRecruitmentCatalog'
import { heroClassLabel } from '../career/CareerHeroClasses'
import { resolveCharacterIdentity } from '../combat/CharacterIdentity'
import type { CareerProfile } from '../career/CareerProfile'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'

export function personalRecruitmentPresentation(profile: CareerProfile, choice: PersonalRecruitmentChoice, serviceAvailable: boolean) {
  const product = resolvePersonalRecruitment(profile.faction, choice)
  const count = profile.personalSquad?.members.length ?? 0
  const reason = !serviceAvailable ? '人資官目前無法服務。' : !product ? '這個組合無法招募，請重新選擇。'
    : !canRecruitPersonalSquad(profile, product.type) ? product.type === 'commander' ? '需要正式任命為 Commander（指揮官）。' : '需要正式任命為隊長。'
    : count >= PERSONAL_SQUAD_LIMIT ? '私兵已達 30 人上限。'
    : profile.availableMerit < product.price ? `軍功不足，還差 ${(product.price - profile.availableMerit).toLocaleString()} 軍功。` : undefined
  if (!product) return { product, reason, summary: reason! }
  const item = (id: string | null) => {
    const data = id ? WEAPONS[id] ?? ARMORS[id] : undefined
    return data ? `${data.name} · T${data.tier}` : '無'
  }
  const identity = resolveCharacterIdentity({ characterFaction: product.characterFaction, characterTier: product.characterTier,
    heroArchetype: product.heroArchetype, visualAssetId: product.visualAssetId })
  const hero = identity.combatProfileId ? heroClassLabel(identity.combatProfileId) : '普通士兵'
  return { product, reason, summary: [
    `${profile.faction === 'roman' ? '羅馬 Roman' : '維京 Viking'} · 人物 T${product.characterTier} · ${hero} · ${PERSONAL_ROLE_NAMES[product.recruitmentRole]}`,
    `招募費用：${product.price.toLocaleString()} 軍功 · 基礎生命值：${product.maxHp}`,
    `主武器：${item(product.equipment.ranged ?? product.equipment.melee)}`,
    ...(product.equipment.ranged ? [`備用近戰：${item(product.equipment.melee)}`] : []),
    `盾牌：${item(product.equipment.shield)} · 坐騎：${product.equipment.mount ? '軍用戰馬' : '無坐騎'}`,
    `目前私兵：${count} / ${PERSONAL_SQUAD_LIMIT} 人 · 可用軍功：${profile.availableMerit.toLocaleString()}`,
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
  const faction = options.readProfile().faction
  const tier = select('士兵等級', [1, 2, 3, 4, 5].map(value => [String(value), `T${value}`]))
  // Each hero control lists only the recruiting faction's own classes; the tier decides which one is shown.
  const heroSelect = (labelText: string, heroTier: 4 | 5) => select(labelText, personalHeroOptions(faction, heroTier).map(option => [option.key, option.label]))
  const hero4 = heroSelect('T4 英雄類型', 4), hero5 = heroSelect('T5 英雄選項', 5)
  const role = select('招募兵種', PERSONAL_RECRUITMENT_ROLES.map(value => [value, PERSONAL_ROLE_NAMES[value]]))
  const initial = options.choice
  tier.input.value = String(initial.characterTier)
  const initialKey = initial.visualAssetId ?? initial.heroArchetype
  for (const control of [hero4, hero5]) control.input.value = [...control.input.children].some(option => (option as HTMLOptionElement).value === initialKey) ? initialKey! : (control.input.children[0] as HTMLOptionElement).value
  role.input.value = initial.recruitmentRole
  const summary = document.createElement('p'); summary.className = 'town-summary'; summary.style.whiteSpace = 'pre-line'; summary.setAttribute('aria-live', 'polite')
  const button = document.createElement('button'); button.className = 'town-button'; button.textContent = '招募'
  let choice = options.choice
  const refresh = () => {
    const characterTier = Number(tier.input.value) as PersonalRecruitmentChoice['characterTier']
    hero4.label.hidden = characterTier !== 4; hero4.input.disabled = characterTier !== 4
    hero5.label.hidden = characterTier !== 5; hero5.input.disabled = characterTier !== 5
    const picked = characterTier >= 4 ? personalHeroOptions(faction, characterTier).find(option => option.key === (characterTier === 4 ? hero4 : hero5).input.value) : undefined
    choice = { characterTier, recruitmentRole: role.input.value as PersonalRecruitmentChoice['recruitmentRole'],
      ...(picked ? { heroArchetype: picked.heroArchetype, ...(picked.visualAssetId ? { visualAssetId: picked.visualAssetId } : {}) } : {}) }
    options.onChoice(choice)
    const view = personalRecruitmentPresentation(options.readProfile(), choice, options.serviceAvailable())
    summary.textContent = view.summary; button.disabled = Boolean(view.reason); button.title = view.reason ?? ''
  }
  for (const control of [tier.input, hero4.input, hero5.input, role.input]) control.onchange = refresh
  button.onclick = () => {
    refresh()
    if (!button.disabled) options.recruit(choice)
  }
  row.append(summary, button); parent.append(row); refresh()
}
