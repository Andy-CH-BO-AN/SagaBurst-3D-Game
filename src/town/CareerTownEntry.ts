import { createCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import type { DefenseCampaignLaunchConfig } from '../campaign/DefenseCampaignLaunch'
import { CampaignSetupUI } from '../ui/CampaignSetupUI'
import { TownScene } from './TownScene'
import { grantStarter, STARTER_WEAPONS, townCampaignTarget } from './TownRules'
import { WEAPONS } from '../rpg/WeaponDatabase'
export const TOWN_ENTRY_KEY = 'sagaburst_career_town'
export function enterCareerTown(container: HTMLElement, launchCampaign: (config: DefenseCampaignLaunchConfig) => Promise<void>, home: () => void): void {
  const store = new CareerProfileStore(), loaded = store.loadChecked()
  const form = document.createElement('div'); form.id = 'career-entry'; form.style.cssText = 'position:fixed;inset:0;background:#171b1f;color:#e6d5b4;z-index:1000;padding:8vh 15vw;font:18px system-ui;line-height:2'
  const heading = document.createElement('h1'); heading.textContent = '生涯模式 CAREER'; form.append(heading)
  const status = document.createElement('p'); form.append(status); document.body.append(form)
  const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'padding:14px;margin:10px'; b.onclick = action; form.append(b); return b }
  button('返回主選單', () => { form.remove(); home() })
  if (loaded.error) { status.textContent = loaded.error; return }
  const start = async (profile: CareerProfile): Promise<void> => {
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
      }, p => { void start(p) })
      if (import.meta.env.DEV) (window as unknown as { town: TownScene }).town = town
      loading.remove()
    } catch (error) { loading.textContent = '小鎮載入失敗：' + String(error); const back = document.createElement('button'); back.textContent = '返回主選單'; back.onclick = () => { loading.remove(); home() }; loading.append(back) }
  }
  if (loaded.profile?.starterWeaponId) { void start(loaded.profile); return }
  let faction: 'roman' | 'viking' = loaded.profile?.faction ?? 'roman'
  status.textContent = loaded.profile ? '補選一次起始武器；原有軍功與收藏保留。' : '選擇陣營與一把 T1 起始武器。新角色只配發這一把武器。'
  if (!loaded.profile) {
    const select = document.createElement('select'); select.innerHTML = '<option value="roman">Roman 羅馬</option><option value="viking">Viking 維京</option>'; select.onchange = () => { faction = select.value as typeof faction }; form.append(select)
  }
  for (const id of STARTER_WEAPONS) button(WEAPONS[id].name, () => {
    const profile = grantStarter(loaded.profile ?? createCareerProfile(faction), id)
    if (!store.save(profile)) { status.textContent = '保存失敗。角色與配發尚未完成，請重試。'; return }
    void start(profile)
  })
}
