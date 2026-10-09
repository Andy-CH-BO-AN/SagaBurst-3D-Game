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
import { CareerProfileStore } from './career/CareerProfileStore'
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

window.addEventListener('error', (e) => {
  const errDiv = document.createElement('div')
  errDiv.style.position = 'absolute'
  errDiv.style.top = '10px'
  errDiv.style.left = '10px'
  errDiv.style.color = 'red'
  errDiv.style.zIndex = '9999'
  errDiv.style.backgroundColor = 'rgba(0,0,0,0.8)'
  errDiv.style.padding = '10px'
  errDiv.innerHTML = `Error: ${e.message}<br>${e.filename}:${e.lineno}`
  document.body.appendChild(errDiv)
})

const container = document.getElementById('canvas-container')
if (!container) throw new Error('#canvas-container not found')

async function launchGame(
  battleConfig?: BattleConfig,
  campaignConfig?: DefenseCampaignLaunchConfig,
  trainingGround = false,
): Promise<void> {
  const loading = document.createElement('div')
  loading.id = 'asset-loading-status'
  loading.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#eee;background:#171411;z-index:9998;font:16px system-ui'
  loading.setAttribute('role', 'status')
  loading.textContent = battleConfig?.careerEagleMissionId ? '正在部署巨鷹空戰部隊…' : campaignConfig?.careerMissionId ? '正在載入 Outpost 任務、駐軍與敵軍…' : '正在載入寫實人物與戰馬資產…'
  document.body.appendChild(loading)

  try {
    // Let the overlay paint before cached assets lead into synchronous scene creation.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    ;(window as any).game = await Game.create(container!, battleConfig, campaignConfig, text => { loading.textContent = text }, trainingGround)
    loading.remove()
  } catch (error: unknown) {
    const e = error instanceof Error ? error : new Error(String(error))
    loading.remove()
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

async function bootstrap(): Promise<void> {
  const query = new URLSearchParams(window.location.search)
  // Legacy public trial links now enter the unified sandbox. This takes priority
  // over Career/session resumes and does not inspect or change those saves.
  if (query.get('training') === '1' || query.get('freeride') === '1') {
    await launchGame(undefined, undefined, true)
    return
  }
  const menuOnly = query.get('menu') === '1'
  if (import.meta.env.DEV && ['viking-t4', 'roman-t4', 'maki-t4'].includes(query.get('devhero') ?? '')) {
    const { launchVikingHeroPreview, ROMAN_HERO } = await import('./debug/VikingHeroPreview')
    const descriptor = query.get('devhero') === 'maki-t4' ? (await import('./world/MakiRangerEquipment')).MAKI_HERO : query.get('devhero') === 'roman-t4' ? ROMAN_HERO : undefined
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
      await launchCareerCombat(activeCareerMission.kind === 'captain-eagle-battle'
        ? createCaptainEagleLaunch(outpostProfile) : createCaptainFrontlineLaunch(outpostProfile))
      return
    }
  }
  if (outpostProfile && isCareerVeteranOutpostMission(activeCareerMission)) {
    if (shouldResumeCareerVeteranOutpost(activeCareerMission)) {
      await launchGame(undefined, createCareerVeteranOutpostLaunch(outpostProfile))
      return
    }
    if (outpostProfile.claimedBattleIds.includes(activeCareerMission.id)) {
      const cleared = clearCareerMission(outpostProfile, activeCareerMission.id)
      if (!careerStore.save(cleared)) throw new Error('無法保存 Veteran Outpost 返回狀態')
      sessionStorage.setItem(TOWN_ENTRY_KEY, '1')
    } else {
      // A terminal battle whose claim could not be saved must return to its result screen for retry.
      await launchGame(undefined, createCareerVeteranOutpostLaunch(outpostProfile))
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
      await launchGame(undefined, createCareerOutpostLaunch(outpostProfile))
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
      onCareer: () => { menu.destroy(); enterCareerTown(container!, launchCareerCombat, showHome) },
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
    enterCareerTown(container!, launchCareerCombat, showHome)
  } else if (requestedCampaignSetup) {
    showCampaignSetup(requestedCampaignSetup)
  } else {
    showHome()
  }
}

void bootstrap()
