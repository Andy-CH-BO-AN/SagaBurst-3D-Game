import { CareerProfileStore } from '../career/CareerProfileStore'
import { commanderRetirementEligibility } from '../career/CareerRetirement'
import { createCommanderRetirementQaProfile } from '../career/CareerRetirementQaProfile'
import { TOWN_ENTRY_KEY } from '../town/CareerTownEntry'

interface RetirementQaRuntime {
  testRetirementFallen(): boolean
  testRetirementEscaped(): boolean
}

/** This module is only dynamically imported under both gates; release has no entry or callbacks. */
export function installCareerRetirementQa(): void {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('careerQa') !== 'retirement') return
  if (document.getElementById('career-retirement-qa')) return
  const store = new CareerProfileStore()
  const panel = document.createElement('details'); panel.id = 'career-retirement-qa'; panel.open = true
  panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:10010;max-width:290px;padding:12px;background:#172126ed;border:1px solid #b59352;border-radius:6px;color:#f8e7c0;font:12px/1.5 system-ui'
  const heading = document.createElement('summary'); heading.textContent = 'Career Retirement QA · DEV'
  const summary = document.createElement('p'); summary.style.whiteSpace = 'pre-line'
  const message = document.createElement('p'); message.setAttribute('role', 'status')
  const faction = document.createElement('select'); faction.setAttribute('aria-label', 'QA faction')
  faction.innerHTML = '<option value="roman">Roman 羅馬</option><option value="viking">Viking 維京</option>'
  panel.append(heading, summary, faction)
  const add = (label: string, action: () => void) => {
    const button = document.createElement('button'); button.textContent = label; button.onclick = action
    button.style.cssText = 'display:block;margin-top:8px;max-width:100%;padding:7px;color:#f8e7c0;background:#3d3426;border:1px solid #947448;cursor:pointer'
    panel.append(button); return button
  }
  const create = add('建立 Commander Retirement QA 存檔', () => {
    // Town must already have disposed its save/RAF listeners. Never let an outgoing
    // live scene overwrite this replacement from a delayed checkpoint or pagehide.
    if (!canReplace()) { message.textContent = '請先返回主選單，或在結局畫面重建 QA 存檔。'; return }
    if (!window.confirm('建立 Commander Retirement QA 存檔將取代目前的 Career 存檔。確定要繼續嗎？')) return
    const profile = createCommanderRetirementQaProfile(faction.value === 'viking' ? 'viking' : 'roman')
    if (!store.save(profile)) { message.textContent = 'QA 存檔保存失敗，原存檔已保留。'; return }
    sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    const query = new URLSearchParams(location.search); query.delete('menu')
    location.assign(`${location.pathname}?${query}`)
  })
  const runtime = (): RetirementQaRuntime | undefined => (window as unknown as { town?: RetirementQaRuntime }).town
  const fallen = add('測試 Fallen Ending', () => {
    message.textContent = runtime()?.testRetirementFallen() ? '玩家已進入正常死亡流程；仍有私兵存活時會繼續觀戰。' : '需要仍在進行中的 Final Stand。'
    refresh()
  })
  const escaped = add('測試 Escaped Ending', () => {
    message.textContent = runtime()?.testRetirementEscaped() ? '已保存至 295 秒。讓你或私兵再存活最後 5 秒即可，移動不會暫停倒數。' : '尚未快轉：請確認 Final Stand 正在進行且存檔可用。'
    refresh()
  })
  panel.append(message); document.body.append(panel)
  const canReplace = () => Boolean(document.getElementById('main-menu-container') || document.getElementById('career-retirement-ending'))
  const refresh = () => {
    const loaded = store.loadChecked(), profile = loaded.profile
    const eligible = profile && commanderRetirementEligibility(profile)
    summary.textContent = loaded.error ?? (profile && eligible
      ? `Commander Wins: ${eligible.commanderVictories}\nFour-Gate: ${eligible.fourGateDefenseCompleted ? 'Complete' : 'Incomplete'}\nAvailable Merit: ${profile.availableMerit}\nRetirement: ${profile.careerRetirement?.phase ?? (eligible.eligible ? 'Eligible' : 'Not eligible')}`
      : '尚未建立 Career。預設：Commander、10 勝、Four-Gate 完成、100000 可用軍功、空私人部隊。')
    create.textContent = profile ? '重建 Retirement QA 存檔' : '建立 Commander Retirement QA 存檔'
    create.disabled = !canReplace()
    create.title = create.disabled ? '請先返回主選單，或在結局畫面重建 QA 存檔。' : '取代單一 Career 存檔前會再次確認。'
    fallen.disabled = escaped.disabled = profile?.careerRetirement?.phase !== 'final-stand' || !runtime()
  }
  refresh()
  const timer = window.setInterval(refresh, 1000)
  window.addEventListener('pagehide', () => { window.clearInterval(timer); panel.remove() }, { once: true })
}
