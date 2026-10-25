import { stageMissionReturnRebuild } from '../career/CareerMissionReturnRecovery'
import { townRoster } from './TownRules'
import { createCareerBridgeBattleLaunch, isCareerBridgeBattle } from '../career/CareerBridgeBattle'
import { installTownStyles } from './TownUI'
import type { CareerProfile } from '../career/CareerProfile'
import { createAndSaveCareer } from '../career/CareerCreation'
import { showCommanderRetirementEnding } from './TownRetirementUI'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { CAREER_RECOVERY_NOTICE_KEY } from '../career/CareerMissionRecovery'
import { createCaptainEagleLaunch, createCaptainFrontlineLaunch, type CareerCombatLaunch } from '../career/CaptainBattleLaunch'
import { CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_FRONTLINE_COMMAND_ID } from '../career/CaptainMissionCatalog'
import { clearCareerMission } from '../career/CareerProfile'
import { CAREER_OUTPOST_SESSION_KEY } from '../career/CareerOutpostMission'
import { refitTownCommandForSceneChange } from '../career/SquadRefit'
import { resolveCareerTownSceneContext } from '../career/CareerFieldSceneContext'
import { COMMANDER_LAST_STAND_ID } from '../career/CommanderMissionCatalog'
import { createCareerCommanderOutpostLaunch } from '../career/CommanderOutpost'
import { TownScene } from './TownScene'
import { canStartCareerTutorial, commitCareerTutorial, startCareerTutorial } from '../career/CareerTutorial'
import type { CareerTutorialLaunch } from '../career/CareerTutorialLaunch'
export const TOWN_ENTRY_KEY = 'sagaburst_career_town'
export function enterCareerTown(container: HTMLElement, launchCampaign: (config: CareerCombatLaunch) => Promise<void>, home: () => void,
  onMissionLaunchError?: (missionId: string, error: unknown) => void,
  launchTutorial?: (context: CareerTutorialLaunch) => Promise<void>): void {
  installTownStyles()
  const store = new CareerProfileStore(), loaded = store.loadChecked()
  const form = document.createElement('div'); form.id = 'career-entry'; form.className = 'town-entry'
  const heading = document.createElement('h1'); heading.textContent = '生涯模式 CAREER'; form.append(heading)
  const status = document.createElement('p'); form.append(status); document.body.append(form)
  const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; form.append(b); return b }
  button('返回主選單', () => { form.remove(); home() })
  if (loaded.error) { status.textContent = loaded.error; return }
  const start = async (profile: CareerProfile): Promise<void> => {
    if (profile.careerRetirement?.phase === 'completed') {
      form.remove()
      showCommanderRetirementEnding(profile, {
        home: () => { sessionStorage.removeItem(TOWN_ENTRY_KEY); home() },
        newCareer: () => showCreator(profile),
      })
      return
    }
    // Routing is a capability saved on this enlistment, never inferred from a free-mode URL.
    if (launchTutorial && profile.tutorial && canStartCareerTutorial(profile)) {
      if (!profile.tutorial.session && !profile.tutorial.legacy && profile.tutorial.recruit.status === 'available') {
        const started = commitCareerTutorial(store, profile.tutorial.careerId, next => Boolean(startCareerTutorial(next, 'recruit')))
        if (!started.ok) {
          status.textContent = '無法保存新兵教學，尚未離開角色建立畫面。請重試。'
          button('重試進入新兵教學', () => { void start(profile) })
          return
        }
        profile = started.profile
      }
      const session = profile.tutorial?.session
      if (session) {
        form.remove()
        await launchTutorial({ careerId: session.careerId, sessionId: session.id, stage: session.stage })
        return
      }
    }
    const active = profile.activeMission
    const captainLaunch = active?.templateId === CAPTAIN_FRONTLINE_COMMAND_ID && active.kind === 'captain-outpost-defense'
      ? () => createCaptainFrontlineLaunch(profile)
      : active?.templateId === CAPTAIN_EAGLE_BATTLE_ID && active.kind === 'captain-eagle-battle' ? () => createCaptainEagleLaunch(profile)
      : isCareerBridgeBattle(active) ? () => createCareerBridgeBattleLaunch(profile)
      : active?.templateId === COMMANDER_LAST_STAND_ID && active.kind === 'commander-outpost-last-stand' ? () => createCareerCommanderOutpostLaunch(profile) : null
    if (active && captainLaunch) {
      if (profile.claimedBattleIds.includes(active.id)) {
        const cleared = stageMissionReturnRebuild(clearCareerMission(profile, active.id), townRoster().map(spec => ({ spec })), active.personalSquad)
        if (!store.save(cleared)) {
          status.textContent = '無法保存正式任務返回狀態，請重試。'
          button('重試返回小鎮', () => { void start(profile) })
          return
        }
        profile = cleared
      } else {
        form.remove()
        sessionStorage.setItem(CAREER_OUTPOST_SESSION_KEY, active.id)
        sessionStorage.removeItem(TOWN_ENTRY_KEY)
        try { await launchCampaign(captainLaunch()) }
        catch (error) {
          if (onMissionLaunchError) onMissionLaunchError(active.id, error)
          else { form.append(status); status.textContent = String(error); document.body.append(form) }
        }
        return
      }
    }
    // Request inside the entry button gesture, before asynchronous loading consumes it.
    if (!location.search.includes('nolock') && navigator.userActivation?.isActive) {
      try { container.requestPointerLock?.()?.catch(() => {}) } catch { /* Canvas click retries pointer lock after loading. */ }
    }
    form.remove()
    const loading = document.createElement('div'); loading.id = 'career-town-loading'; loading.textContent = profile.activeMission?.siege ? '正在部署攻守部隊與四門城防…' : '正在載入陣營小鎮、駐軍與居民…'; loading.style.cssText = 'position:fixed;inset:0;z-index:999;background:#191b1c;color:#eee;display:grid;place-items:center'; document.body.append(loading)
    const transition = (value: CareerProfile, proceed: (next: CareerProfile) => void, deathReturn = false): void => {
      const next = refitTownCommandForSceneChange(value)
      if (deathReturn) delete next.playerAerialState
      if (store.save(next)) { proceed(next); return }
      loading.textContent = '無法保存城防整補，尚未轉場。'
      document.body.append(loading)
      const retry = document.createElement('button'); retry.textContent = '重試轉場'
      retry.onclick = () => transition(value, proceed, deathReturn); loading.append(retry)
    }
    try {
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
      sessionStorage.removeItem('sagaburst_battle_config'); sessionStorage.removeItem('sagaburst_campaign_config')
      const town = await TownScene.create(container, profile, config => {
        if (!config?.careerMissionId) return
        // Keep the launch gesture on the persistent container across scene loading.
        if (!location.search.includes('nolock')) {
          try { container.requestPointerLock?.()?.catch(() => {}) } catch { /* Canvas click retries if denied. */ }
        }
        const missionId = config.careerMissionId
        transition(store.loadChecked().profile ?? profile, () => {
          sessionStorage.setItem(CAREER_OUTPOST_SESSION_KEY, missionId)
          sessionStorage.removeItem(TOWN_ENTRY_KEY)
          void launchCampaign(config)
        })
      }, (p, reason) => {
        if (p.careerRetirement?.phase === 'completed') { void start(p); return }
        const before = resolveCareerTownSceneContext(profile), after = resolveCareerTownSceneContext(p)
        if (reason === 'death-return' || before.worldFaction !== after.worldFaction) {
          transition(p, next => { void start(next) }, reason === 'death-return')
        } else void start(p)
      }, () => {
        sessionStorage.removeItem(TOWN_ENTRY_KEY)
        home()
      }, message => { loading.textContent = message }, (stage, replay) => {
        if (!launchTutorial || !profile.tutorial) return false
        const started = commitCareerTutorial(store, profile.tutorial.careerId, next => Boolean(startCareerTutorial(next, stage, replay)))
        if (!started.ok) return false
        const session = started.profile.tutorial!.session!
        // Town disposes its listeners and renderer before the next scene is constructed.
        queueMicrotask(() => { void launchTutorial({ careerId: session.careerId, sessionId: session.id, stage: session.stage }) })
        return true
      })
      if (import.meta.env.DEV) (window as unknown as { town: TownScene }).town = town
      loading.remove()
      town.start()
      const recoveredMessage = sessionStorage.getItem(CAREER_RECOVERY_NOTICE_KEY)
      if (recoveredMessage) {
        sessionStorage.removeItem(CAREER_RECOVERY_NOTICE_KEY)
        const note = document.createElement('div')
        note.id = 'career-recovery-notice'
        note.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10001;background:#212c25;color:#fff;border:1px solid #677d69;border-radius:6px;padding:12px;font:15px system-ui;max-width:90vw'
        note.textContent = recoveredMessage
        const close = document.createElement('button')
        close.textContent = '×'; close.setAttribute('aria-label', '關閉通知')
        close.style.cssText = 'margin-left:16px;color:#fff;background:transparent;border:0;font-size:20px;cursor:pointer'
        close.onclick = () => note.remove()
        note.append(close); document.body.append(note)
      }
    } catch (error) {
      const missionId = profile.activeMission?.id ?? profile.activeOutpostMission?.id
      if (missionId && onMissionLaunchError) {
        loading.remove()
        onMissionLaunchError(missionId, error)
        return
      }
      sessionStorage.removeItem(TOWN_ENTRY_KEY)
      loading.textContent = '小鎮載入失敗：' + String(error)
      const back = document.createElement('button'); back.textContent = '返回主選單'
      back.onclick = () => { sessionStorage.removeItem(TOWN_ENTRY_KEY); loading.remove(); home() }; loading.append(back)
    }
  }
  const showCreator = (replacement?: CareerProfile): void => {
    form.replaceChildren(heading, status)
    document.body.append(form)
    button(replacement ? '取消' : '返回主選單', () => {
      form.remove()
      if (replacement) void start(replacement)
      else home()
    })
    let faction: 'roman' | 'viking' = 'roman'
    status.textContent = '選擇陣營後進入新兵訓練。練習裝備免費借用；完成可領 100 軍功，再到武器店購買第一把永久武器。'
    const select = document.createElement('select')
    select.setAttribute('aria-label', '選擇陣營')
    select.innerHTML = '<option value="roman">Roman 羅馬</option><option value="viking">Viking 維京</option>'
    select.onchange = () => { faction = select.value as typeof faction }
    form.append(select)
    const enlist = button('開始新兵訓練', () => {
      const fresh = store.loadChecked()
      const sameEnding = !replacement || fresh.profile?.tutorial?.careerId === replacement.tutorial?.careerId
        && fresh.profile?.careerRetirement?.acceptedAt === replacement.careerRetirement?.acceptedAt
        && fresh.profile?.careerRetirement?.outcome === replacement.careerRetirement?.outcome
      const profile = !fresh.error && sameEnding
        ? createAndSaveCareer(fresh.profile, faction, Boolean(replacement), next => store.save(next)) : null
      if (!profile) { status.textContent = '保存失敗或原存檔已更新。角色尚未建立，原存檔保留，請重試。'; return }
      enlist.disabled = select.disabled = true
      void start(profile)
    })
  }
  if (loaded.profile) { void start(loaded.profile); return }
  showCreator()
}
