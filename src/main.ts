import { createCaptainEagleLaunch, createCaptainFrontlineLaunch, type CareerCombatLaunch } from './career/CaptainBattleLaunch'
import { CAPTAIN_EAGLE_BATTLE_ID, CAPTAIN_FRONTLINE_COMMAND_ID } from './career/CaptainMissionCatalog'
/**
 * main.ts
 * Vite entry point.
 * Implements Custom Battle Setup official entrance with developer bypass and untrusted sessionStorage validation.
 */
import { Game } from './Game'
import { enterCareerTown, TOWN_ENTRY_KEY } from './town/CareerTownEntry'
import { CAREER_OUTPOST_SESSION_KEY, clearCareerOutpost } from './career/CareerOutpostMission'
import { createCareerOutpostLaunch } from './career/CareerOutpostLaunch'
import { clearCareerMission } from './career/CareerProfile'
import { createCareerVeteranOutpostLaunch, isCareerVeteranOutpostMission, shouldResumeCareerVeteranOutpost } from './career/CareerVeteranOutpost'
import { createCareerCommanderOutpostLaunch, isCareerCommanderOutpostMission } from './career/CommanderOutpost'
import { CareerProfileStore } from './career/CareerProfileStore'
import { recoverFailedCareerMission, CAREER_RECOVERY_NOTICE_KEY } from './career/CareerMissionRecovery'
import { BattleConfig, validateBattleConfig } from './battle/BattleConfig'
import { BattleSetupUI } from './ui/BattleSetupUI'
import { MainMenuUI } from './ui/MainMenuUI'
import { CampaignSetupUI } from './ui/CampaignSetupUI'
import { BattleReferenceUI } from './ui/BattleReferenceUI'
import {
  validateDefenseCampaignLaunchConfig,
  type DefenseCampaignLaunchConfig,
} from './campaign/DefenseCampaignLaunch'
import {
  DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY,
  isDefenseCampaignStageUnlocked,
  parseDefenseCampaignSetupTarget,
  type DefenseCampaignSetupTarget,
} from './campaign/CampaignProgress'

if (import.meta.env.DEV) void import('./debug/EquipmentRenderCensus')
if (import.meta.env.DEV) void import('./debug/MainPassCensus')
if (import.meta.env.DEV) void import('./debug/HorseCorneaTransmissionControl')
if (import.meta.env.DEV) void import('./debug/ShadowPassCensus')

let currentCareerMissionId: string | undefined
let recoveringCareerMission = false

function showCareerRecoveryError(message: string, retry: () => void): void {
  document.getElementById('asset-loading-status')?.remove()
  document.getElementById('career-recovery-error')?.remove()
  const panel = document.createElement('div')
  panel.id = 'career-recovery-error'
  panel.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#171411;color:#eee;display:grid;place-content:center;gap:14px;padding:20px;font:16px system-ui;text-align:center'
  const info = document.createElement('p'); info.textContent = message
  const button = document.createElement('button')
  button.textContent = '重試返回城鎮'
  button.onclick = retry
  panel.append(info, button)
  document.body.appendChild(panel)
}

function handleCareerMissionError(missionId: string, error: unknown): void {
  if (recoveringCareerMission) return
  console.error('[Career] Technical mission deployment failure', { missionId }, error)
  const store = new CareerProfileStore()
  const loaded = store.loadChecked()
  // A late callback must not clear a newer accepted mission.
  if (loaded.profile && loaded.profile.activeMission?.id !== missionId
    && loaded.profile.activeOutpostMission?.id !== missionId) return
  const game = (window as unknown as { game?: unknown }).game
  if (game instanceof Game) game.abortCareerDeployment()
  const recovered = recoverFailedCareerMission(store, missionId)
  if (recovered === 'stale') return
  if (recovered !== 'recovered') {
    showCareerRecoveryError('任務部署失敗，但生涯存檔尚未能安全保存。原始存檔未刪除。', () => handleCareerMissionError(missionId, error))
    return
  }
  recoveringCareerMission = true
  try {
    document.exitPointerLock?.()
    sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
    sessionStorage.removeItem('sagaburst_campaign_config')
    sessionStorage.removeItem('sagaburst_battle_config')
    sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
    sessionStorage.setItem(CAREER_RECOVERY_NOTICE_KEY, '任務部署失敗，已返回城鎮。角色、私兵與軍功資料均已保留。')
    sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    // Reload disposes even a partially constructed WebGL scene and all stale RAF jobs.
    window.location.assign(window.location.pathname)
  } catch (routeError) {
    recoveringCareerMission = false
    console.error('[Career] Could not navigate back to Town', routeError)
    showCareerRecoveryError('任務已安全取消，但無法自動返回城鎮。', () => window.location.assign(window.location.pathname))
  }
}

window.addEventListener('error', e => {
  if (currentCareerMissionId && !recoveringCareerMission) {
    e.preventDefault()
    handleCareerMissionError(currentCareerMissionId, e.error ?? new Error(e.message))
    return
  }
  const errDiv = document.createElement('div')
  errDiv.style.cssText = 'position:absolute;top:10px;left:10px;color:red;z-index:9999;background:rgba(0,0,0,.8);padding:10px'
  errDiv.textContent = `Error: ${e.message} ${e.filename}:${e.lineno}`
  document.body.appendChild(errDiv)
})

window.addEventListener('unhandledrejection', e => {
  if (!currentCareerMissionId || recoveringCareerMission) return
  e.preventDefault()
  handleCareerMissionError(currentCareerMissionId, e.reason)
})

const container = document.getElementById('canvas-container')
if (!container) throw new Error('#canvas-container not found')

async function launchGame(
  battleConfig?: BattleConfig,
  campaignConfig?: DefenseCampaignLaunchConfig,
  trainingGround = false,
): Promise<void> {
  const missionId = campaignConfig?.careerMissionId ?? battleConfig?.careerEagleMissionId
  currentCareerMissionId = missionId
  const loading = document.createElement('div')
  loading.id = 'asset-loading-status'
  loading.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#eee;background:#171411;z-index:9998;font:16px system-ui'
  loading.setAttribute('role', 'status')
  loading.textContent = battleConfig?.careerEagleMissionId ? '正在部署巨鷹空戰部隊…' : campaignConfig?.careerMissionId ? '正在載入 Outpost 任務、駐軍與敵軍…' : '正在載入寫實人物與戰馬資產…'
  document.body.appendChild(loading)

  try {
    // Let the overlay paint before cached assets lead into synchronous scene creation.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const game = await Game.create(container!, battleConfig, campaignConfig, text => { loading.textContent = text }, trainingGround)
    ;(window as unknown as { game: unknown }).game = game
    if (missionId && game instanceof Game) game.onCareerDeploymentError = error => handleCareerMissionError(missionId, error)
    loading.remove()
  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error))
    loading.remove()
    if (missionId) { handleCareerMissionError(missionId, e); return }
    const errDiv = document.createElement('div')
    errDiv.style.position = 'absolute'
    errDiv.style.top = '10px'
    errDiv.style.left = '10px'
    errDiv.style.color = 'red'
    errDiv.style.zIndex = '9999'
    errDiv.style.backgroundColor = 'rgba(0,0,0,0.8)'
    errDiv.style.padding = '10px'
    errDiv.textContent = `寫實資產載入失敗：${e.message}`
    document.body.appendChild(errDiv)
  }
}

function launchCareerCombat(config: CareerCombatLaunch): Promise<void> {
  return config.type === 'captain-eagle' ? launchGame(config.battle) : launchGame(undefined, config)
}

/** Catch errors in launch builders too, before launchGame gets a config. */
async function resumeStoredCareerMission(missionId: string, build: () => CareerCombatLaunch): Promise<void> {
  try { await launchCareerCombat(build()) }
  catch (error) { handleCareerMissionError(missionId, error) }
}

async function bootstrap(): Promise<void> {
  const query = new URLSearchParams(window.location.search)
  // Legacy public trial links now enter the unified sandbox. This takes priority
  // over Career/session resumes and does not inspect or change those saves.
  if (query.get('training') === '1' || query.get('freeride') === '1') {
    await launchGame(undefined, undefined, true)
    return
  }
  const menuOnly = query.get('menu') === '1'
  if (import.meta.env.DEV && ['viking-t4', 'roman-t4', 'maki-t4', 'roman-t5', 'viking-t5', 'roman-civilian', 'viking-civilian'].includes(query.get('devhero') ?? '')) {
    const { launchVikingHeroPreview, ROMAN_HERO } = await import('./debug/VikingHeroPreview')
    const { HERO_ASSETS } = await import('./world/HeroAssetCatalog')
    const { CIVILIAN_HUMANOID_ASSETS } = await import('./world/HumanoidAssetRegistry')
    const requested = query.get('devhero')
    const descriptor = requested === 'roman-civilian' ? CIVILIAN_HUMANOID_ASSETS.roman
      : requested === 'viking-civilian' ? CIVILIAN_HUMANOID_ASSETS.viking
      : requested === 'roman-t5' ? HERO_ASSETS['roman-hero-t5'].descriptor
      : requested === 'viking-t5' ? HERO_ASSETS['viking-hero-t5'].descriptor
      : requested === 'maki-t4' ? (await import('./world/MakiRangerEquipment')).MAKI_HERO : requested === 'roman-t4' ? ROMAN_HERO : undefined
    await launchVikingHeroPreview(container!, descriptor)
    return
  }
  const isDevCombat = query.has('devcombat')
  const isDevModels = query.has('devmodels')
  const isDamageableTest = import.meta.env.DEV && query.has('damageabletest')
  const isCampaignOutpostPreview = import.meta.env.DEV && query.has('campaignoutpost')

  // 1. Highest priority: Developer scene modes (bypass setup UI)
  // Note: legacyhumanoids is a rendering modifier, not a standalone scene mode
  if (
    isDevCombat
    || isDevModels
    || isDamageableTest
    || isCampaignOutpostPreview
    || (import.meta.env.DEV && query.has('devbowqa'))
  ) {
    await launchGame()
    return
  }

  // 2. Trusted replay / reload state is stored in sessionStorage, but must
  // still pass validation before it can bypass the official menu.
  const careerStore = new CareerProfileStore()
  const outpostProfile = menuOnly ? null : careerStore.loadChecked().profile
  const activeCareerMission = outpostProfile?.activeMission
  const captainStandalone = activeCareerMission?.templateId === CAPTAIN_FRONTLINE_COMMAND_ID && activeCareerMission.kind === 'captain-outpost-defense'
    || activeCareerMission?.templateId === CAPTAIN_EAGLE_BATTLE_ID && activeCareerMission.kind === 'captain-eagle-battle'
  if (outpostProfile && activeCareerMission && captainStandalone) {
    if (outpostProfile.claimedBattleIds.includes(activeCareerMission.id)) {
      if (!careerStore.save(clearCareerMission(outpostProfile, activeCareerMission.id))) throw new Error('無法保存 Captain 任務返回狀態')
      sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    } else {
      await resumeStoredCareerMission(activeCareerMission.id, () => activeCareerMission.kind === 'captain-eagle-battle'
        ? createCaptainEagleLaunch(outpostProfile) : createCaptainFrontlineLaunch(outpostProfile))
      return
    }
  }
  if (outpostProfile && isCareerVeteranOutpostMission(activeCareerMission)) {
    if (shouldResumeCareerVeteranOutpost(activeCareerMission)) {
      await resumeStoredCareerMission(activeCareerMission.id, () => createCareerVeteranOutpostLaunch(outpostProfile))
      return
    }
    if (outpostProfile.claimedBattleIds.includes(activeCareerMission.id)) {
      const cleared = clearCareerMission(outpostProfile, activeCareerMission.id)
      if (!careerStore.save(cleared)) throw new Error('無法保存 Veteran Outpost 返回狀態')
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    } else {
      // A terminal battle whose claim could not be saved must return to its result screen for retry.
      await resumeStoredCareerMission(activeCareerMission.id, () => createCareerVeteranOutpostLaunch(outpostProfile))
      return
    }
  }
  if (outpostProfile && activeCareerMission && isCareerCommanderOutpostMission(activeCareerMission)) {
    if (outpostProfile.claimedBattleIds.includes(activeCareerMission.id)) {
      const cleared = clearCareerMission(outpostProfile, activeCareerMission.id)
      if (!careerStore.save(cleared)) throw new Error('無法保存 Commander Last Stand 返回狀態')
      sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    } else {
      await resumeStoredCareerMission(activeCareerMission.id, () => createCareerCommanderOutpostLaunch(outpostProfile))
      return
    }
  }
  if (outpostProfile?.activeOutpostMission) {
    const mission = outpostProfile.activeOutpostMission
    if (outpostProfile.claimedBattleIds.includes(mission.id)) {
      if (!careerStore.save(clearCareerOutpost(outpostProfile))) throw new Error('無法保存 Outpost 返回狀態')
      sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    } else {
      // Rebuild from Career state rather than trusting a free Campaign setup loadout.
      await resumeStoredCareerMission(mission.id, () => createCareerOutpostLaunch(outpostProfile))
      return
    }
  }
  if (!menuOnly) sessionStorage.removeItem(CAREER_OUTPOST_SESSION_KEY)
  let savedCampaign: DefenseCampaignLaunchConfig | null = null
  try {
    const raw = menuOnly ? null : sessionStorage.getItem('sagaburst_campaign_config')
    if (raw) {
      const parsed = JSON.parse(raw)
      const validation = validateDefenseCampaignLaunchConfig(parsed)
      if (
        validation.valid
        && !parsed.careerMissionId
        && !parsed.careerMissionKind
        && !parsed.careerReliefPhase
        && !parsed.careerVeteranOutpost
        && !parsed.careerCommanderOutpost
        && !parsed.careerPersonalSquad
        && parsed.capabilities === undefined
        && parsed.deploymentSeconds === undefined
        && isDefenseCampaignStageUnlocked(parsed.defenderFaction, parsed.stageId)
      ) {
        savedCampaign = parsed
      } else {
        console.warn('Invalid or locked sessionStorage campaign config, clearing:', validation.errors)
        sessionStorage.removeItem('sagaburst_campaign_config')
      }
    }
  } catch (err) {
    console.warn('Failed to parse sessionStorage campaign config:', err)
    sessionStorage.removeItem('sagaburst_campaign_config')
  }

  const careerResume = !menuOnly && (new CareerProfileStore().loadChecked().profile?.townEvent?.state === 'hostile' || sessionStorage.getItem(TOWN_ENTRY_KEY) === '1')
  if (savedCampaign && !careerResume) {
    await launchGame(undefined, savedCampaign)
    return
  }

  let savedConfig: BattleConfig | null = null
  try {
    const raw = menuOnly ? null : sessionStorage.getItem('sagaburst_battle_config')
    if (raw) {
      const parsed = JSON.parse(raw)
      const validation = validateBattleConfig(parsed)
      if (validation.valid && !parsed.careerEagleMissionId) {
        savedConfig = parsed
      } else {
        console.warn('Invalid sessionStorage battle config, clearing:', validation.errors)
        sessionStorage.removeItem('sagaburst_battle_config')
      }
    }
  } catch (err) {
    console.warn('Failed to parse sessionStorage battle config:', err)
    sessionStorage.removeItem('sagaburst_battle_config')
  }

  if (savedConfig && !careerResume) {
    await launchGame(savedConfig)
    return
  }

  let requestedCampaignSetup: DefenseCampaignSetupTarget | null = null
  try {
    const raw = menuOnly ? null : sessionStorage.getItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
    if (!menuOnly) sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
    if (raw) {
      const parsed = parseDefenseCampaignSetupTarget(JSON.parse(raw))
      if (
        parsed
        && isDefenseCampaignStageUnlocked(parsed.defenderFaction, parsed.stageId)
      ) {
        requestedCampaignSetup = parsed
      }
    }
  } catch (err) {
    console.warn('Failed to parse next campaign setup target:', err)
    sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
  }

  // 3. Official entry: choose Custom Battle or Campaign first.
  let showHome: () => void

  const showCampaignSetup = (initialTarget?: DefenseCampaignSetupTarget): void => {
    const campaignUI = new CampaignSetupUI()
    campaignUI.mount(
      document.body,
      async (config) => {
        try {
          sessionStorage.removeItem('sagaburst_battle_config')
          sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
          sessionStorage.setItem('sagaburst_campaign_config', JSON.stringify(config))
        } catch (e) {
          console.warn('sessionStorage set error', e)
        }
        await launchGame(undefined, config)
      },
      () => {
        campaignUI.destroy()
        showHome()
      },
      initialTarget,
    )
  }

  showHome = (): void => {
    const menu = new MainMenuUI()
    menu.mount(document.body, {
      onTrainingGround: () => { menu.destroy(); void launchGame(undefined, undefined, true) },
      onCareer: () => { menu.destroy(); enterCareerTown(container!, launchCareerCombat, showHome, handleCareerMissionError) },
      onCustomBattle: () => {
        menu.destroy()
        const setupUI = new BattleSetupUI()
        setupUI.mount(
          document.body,
          async (config) => {
            try {
              sessionStorage.removeItem('sagaburst_campaign_config')
              sessionStorage.removeItem(DEFENSE_CAMPAIGN_SETUP_TARGET_STORAGE_KEY)
              sessionStorage.setItem('sagaburst_battle_config', JSON.stringify(config))
            } catch (e) {
              console.warn('sessionStorage set error', e)
            }
            await launchGame(config)
          },
          () => {
            setupUI.destroy()
            showHome()
          },
        )
      },
      onCampaign: () => {
        menu.destroy()
        showCampaignSetup()
      },
      onReference: () => {
        menu.destroy()
        const referenceUI = new BattleReferenceUI()
        referenceUI.mount(document.body, () => {
          referenceUI.destroy()
          showHome()
        })
      },
    })
  }

  if (careerResume) {
    enterCareerTown(container!, launchCareerCombat, showHome, handleCareerMissionError)
  } else if (requestedCampaignSetup) {
    showCampaignSetup(requestedCampaignSetup)
  } else {
    showHome()
  }
}

void bootstrap()
