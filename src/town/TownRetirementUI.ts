import { careerMissionCompletionsForTier, type CareerProfile } from '../career/CareerProfile'
import { commanderRetirementEligibility } from '../career/CareerRetirement'

const RETIREMENT_DETAIL = '完成十場指揮官任務，並至少一次守住敵軍全線進攻後，即可申請退休。'
const RETIREMENT_DIALOGUE = '十場勝利。連敵軍的全線進攻，也沒能從你手中奪走這座城。\n\n你替這裡流的血已經夠多了。軍隊會記得你，城鎮也會記得你。\n\n交回軍令吧。帶上真正屬於你的士兵，到城外完成最後一次點名。\n\n謝謝你所做的一切。願你往後，不必再為任何人的命令拔劍。'
const RETIREMENT_CONFIRMATION = '退休將永久結束你的 Commander 生涯。\n\n你將失去城鎮部隊指揮權，私人部隊會隨你離開。\n\n此選擇將進入 Career 結局，無法撤回。'

function button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'town-button'; button.textContent = label; button.onclick = action
  parent.append(button)
  return button
}

/** Presentation only; acceptance still belongs to Town's save-first transaction. */
export function appendCommanderRetirementOption(panel: HTMLElement, profile: CareerProfile, actions: {
  openPanel(title: string, text: string): HTMLDivElement
  start(): boolean
  leave(): void
}): void {
  if (profile.rank !== 'commander') return
  const eligibility = commanderRetirementEligibility(profile)
  const detail = document.createElement('p'); detail.className = 'town-summary'; detail.style.whiteSpace = 'pre-line'
  detail.textContent = `退休資格\n\n指揮官任務勝利：${eligibility.commanderVictories} / ${eligibility.requiredVictories}\n守住敵軍全線進攻：${eligibility.fourGateDefenseCompleted ? '已完成' : '未完成'}`
    + (eligibility.eligible ? '\n\n退休資格已完成\n你可以向前任指揮官申請退休。' : '')
  detail.title = RETIREMENT_DETAIL
  panel.append(detail)
  const apply = button(panel, '申請退休', () => {
    if (!eligibility.eligible || profile.careerRetirement) return
    const dialogue = actions.openPanel('前任指揮官', RETIREMENT_DIALOGUE)
    button(dialogue, '申請退休', () => {
      const confirmation = actions.openPanel('申請退休', RETIREMENT_CONFIRMATION)
      const status = document.createElement('p'); confirmation.append(status)
      const accept = button(confirmation, '接受退休', () => {
        if (accept.disabled) return
        accept.disabled = true
        if (!actions.start()) {
          status.textContent = '退休尚未完成。請確認目前沒有任務或競賽，並在存檔可用後重試。'
          accept.disabled = false
          return
        }
        actions.openPanel('申請退休', '城鎮軍令已交回。\n所有私人部隊已改為 Follow。\n前往地圖邊緣的退役集合點。')
      })
      button(confirmation, '暫時留下', actions.leave)
    })
    button(dialogue, '暫時留下', actions.leave)
  })
  apply.title = RETIREMENT_DETAIL
  apply.disabled = !eligibility.eligible || Boolean(profile.careerRetirement)
}

const ENDINGS = {
  fallen: {
    title: '退休結局：光榮退役',
    name: '光榮退役',
    body: '你曾替這座城守住四面城門。\n最後一次，沒有人替你守住退路。\n\n官方記錄宣稱，你在退役途中發動叛亂，最終被城鎮軍隊平定。\n\n軍冊上只留下四個字：\n\n光榮退役\n\n城鎮仍然安全。\n因為它最害怕的人，已經倒下。',
  },
  escaped: {
    title: '退休結局：帶旗離城',
    name: '帶旗離城',
    body: '你曾替這座城守住四面城門。\n最後一次，城門在你身後關上。\n\n五分鐘後，你仍然站著。\n軍權被收回，願意追隨你的人卻沒有散去。\n\n他們想讓你的退休成為一場葬禮。\n你卻帶著自己的旗，活著離開。\n\n從此，你不再為城鎮而戰。\n你只為自己，以及曾選擇站在你身旁的人拔劍。',
  },
} as const

/** No Town scene, actors, storage deletion, or mission result UI is created here. */
export function showCommanderRetirementEnding(profile: CareerProfile, actions: {
  home(): void
  newCareer(): void
}): void {
  const outcome = profile.careerRetirement?.outcome
  if (profile.careerRetirement?.phase !== 'completed' || !outcome) return
  document.exitPointerLock?.()
  const ending = ENDINGS[outcome]
  const screen = document.createElement('div'); screen.id = 'career-retirement-ending'
  screen.style.cssText = 'position:fixed;inset:0;z-index:1000;overflow:auto;box-sizing:border-box;padding:clamp(24px,5vh,70px) max(24px,calc((100vw - 740px)/2));background:radial-gradient(ellipse at 25% 0,#493d2c,#121719 70%);color:#efdfbf;font:16px/1.8 system-ui'
  const label = document.createElement('small'); label.className = 'town-eyebrow'
  label.textContent = outcome === 'escaped' ? 'CAREER COMPLETE · SECRET ENDING' : 'CAREER COMPLETE'
  const title = document.createElement('h1'); title.textContent = ending.title
  title.style.cssText = 'font:700 clamp(26px,4vw,40px)/1.3 Georgia,serif;color:#ffe5af'
  const story = document.createElement('p'); story.textContent = ending.body; story.style.whiteSpace = 'pre-line'
  const stats = document.createElement('p'); stats.className = 'town-summary'; stats.style.whiteSpace = 'pre-line'
  stats.textContent = `Commander Victories：${careerMissionCompletionsForTier(profile, 5)}\n結局：${ending.name}`
  const controls = document.createElement('div')
  screen.append(label, title, story, stats, controls)
  button(controls, '返回主選單', () => { screen.remove(); actions.home() })
  button(controls, '開始新的 Career', () => {
    controls.replaceChildren()
    const warning = document.createElement('p'); warning.textContent = '開始新的 Career 將取代目前已完成的退休存檔。'
    controls.append(warning)
    button(controls, '開始新生涯', () => { screen.remove(); actions.newCareer() })
    button(controls, '取消', () => { screen.remove(); showCommanderRetirementEnding(profile, actions) })
  })
  document.body.append(screen)
}
