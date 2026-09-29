import { installTownStyles, starterThumbnails } from './TownUI'
import { createCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { CampaignSetupUI } from '../ui/CampaignSetupUI'
import { TownScene } from './TownScene'
import { grantStarter, STARTER_WEAPONS, townCampaignTarget } from './TownRules'
import { WEAPONS } from '../rpg/WeaponDatabase'
export const TOWN_ENTRY_KEY = 'sagaburst_career_town'
export function enterCareerTown(container: HTMLElement, launchCampaign: (config: DefenseCampaignLaunchConfig) => Promise<void>, home: () => void): void {
  installTownStyles()
  const store = new CareerProfileStore(), loaded = store.loadChecked()
  const form = document.createElement('div'); form.id = 'career-entry'; form.className = 'town-entry'
  const heading = document.createElement('h1'); heading.textContent = '生涯模式 CAREER'; form.append(heading)
  const status = document.createElement('p'); form.append(status); document.body.append(form)
  const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; form.append(b); return b }
  button('返回主選單', () => { form.remove(); home() })
  if (loaded.error) { status.textContent = loaded.error; return }
  const start = async (profile: CareerProfile): Promise<void> => {
    // Request inside the entry button gesture, before asynchronous loading consumes it.
    if (!location.search.includes('nolock') && navigator.userActivation?.isActive) {
      try { container.requestPointerLock?.()?.catch(() => {}) } catch { /* Town entry free-look remains available. */ }
    }
    form.remove()
    const loading = document.createElement('div'); loading.textContent = '正在載入陣營小鎮、駐軍與居民…'; loading.style.cssText = 'position:fixed;inset:0;z-index:999;background:#191b1c;color:#eee;display:grid;place-items:center'; document.body.append(loading)
    try {
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
      sessionStorage.removeItem('sagaburst_battle_config'); sessionStorage.removeItem('sagaburst_campaign_config')
      const town = await TownScene.create(container, profile, () => {
        const setup = new CampaignSetupUI()
        setup.mount(document.body, async config => {
          sessionStorage.removeItem(TOWN_ENTRY_KEY)
          sessionStorage.setItem('sagaburst_campaign_config', JSON.stringify(config))
          await launchCampaign(config)
        }, () => { setup.destroy(); void start(town.profile) }, townCampaignTarget(town.profile.faction), true)
      }, p => { void start(p) }, message => { loading.textContent = message })
      if (import.meta.env.DEV) (window as unknown as { town: TownScene }).town = town
      loading.remove()
    } catch (error) {
      sessionStorage.removeItem(TOWN_ENTRY_KEY)
      loading.textContent = '小鎮載入失敗：' + String(error)
      const back = document.createElement('button'); back.textContent = '返回主選單'
      back.onclick = () => { sessionStorage.removeItem(TOWN_ENTRY_KEY); loading.remove(); home() }; loading.append(back)
    }
  }
  if (loaded.profile?.starterWeaponId) { void start(loaded.profile); return }
  let faction: 'roman' | 'viking' = loaded.profile?.faction ?? 'roman'
  status.textContent = loaded.profile ? '補選一次起始武器；原有軍功與收藏保留。' : '選擇陣營與一把 T1 起始武器。新角色只配發這一把武器。'
  if (!loaded.profile) {
    const select = document.createElement('select'); select.innerHTML = '<option value="roman">Roman 羅馬</option><option value="viking">Viking 維京</option>'; select.onchange = () => { faction = select.value as typeof faction }; form.append(select)
  }
  const grid = document.createElement('div'); grid.className = 'town-starters'; form.append(grid)
  const thumbnails = starterThumbnails(STARTER_WEAPONS)
  for (const id of STARTER_WEAPONS) {
    const weapon = WEAPONS[id], card = document.createElement('button'); card.className = 'town-starter'
    const image = document.createElement('img'); image.src = thumbnails.get(id)!; image.alt = weapon.name
    const name = document.createElement('strong'); name.textContent = weapon.name
    const description = document.createElement('p'); description.textContent = weapon.description
    const stats = document.createElement('dl')
    for (const [label, value] of [['傷害', weapon.damageMin + '–' + weapon.damageMax], [weapon.type === 'melee' ? '揮擊時間' : '蓄力時間', weapon.speedOrCharge + ' 秒'], [weapon.type === 'melee' ? '距離' : '彈速', weapon.range ? weapon.range + ' m' : weapon.arrowSpeedMin + '–' + weapon.arrowSpeedMax + ' m/s']]) {
      const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label; detail.textContent = value; stats.append(term, detail)
    }
    const choose = document.createElement('p'); choose.textContent = 'T1 · 選擇此武器 →'
    card.append(image, name, description, stats, choose); grid.append(card)
    card.onclick = () => {
      const profile = grantStarter(loaded.profile ?? createCareerProfile(faction), id)
      if (!store.save(profile)) { status.textContent = '保存失敗。角色與配發尚未完成，請重試。'; return }
      void start(profile)
    }
  }
}
