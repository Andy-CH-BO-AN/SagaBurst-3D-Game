/**
 * main.ts
 * Vite entry point.
 * Implements Custom Battle Setup official entrance with developer bypass and untrusted sessionStorage validation.
 */
import { Game } from './Game'
import { BattleConfig, validateBattleConfig } from './battle/BattleConfig'
import { BattleSetupUI } from './ui/BattleSetupUI'
import { MainMenuUI } from './ui/MainMenuUI'
import { CampaignSetupUI } from './ui/CampaignSetupUI'
import { BattleReferenceUI } from './ui/BattleReferenceUI'
import {
  validateDefenseCampaignLaunchConfig,
  type DefenseCampaignLaunchConfig,
} from './campaign/DefenseCampaignLaunch'

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
): Promise<void> {
  const loading = document.createElement('div')
  loading.id = 'asset-loading-status'
  loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#eee;background:#171411;z-index:9998;font:16px system-ui'
  loading.textContent = '正在載入寫實人物與戰馬資產…'
  document.body.appendChild(loading)

  try {
    ;(window as any).game = await Game.create(container!, battleConfig, campaignConfig)
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

async function bootstrap(): Promise<void> {
  const query = new URLSearchParams(window.location.search)
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
  let savedCampaign: DefenseCampaignLaunchConfig | null = null
  try {
    const raw = sessionStorage.getItem('sagaburst_campaign_config')
    if (raw) {
      const parsed = JSON.parse(raw)
      const validation = validateDefenseCampaignLaunchConfig(parsed)
      if (validation.valid) {
        savedCampaign = parsed
      } else {
        console.warn('Invalid sessionStorage campaign config, clearing:', validation.errors)
        sessionStorage.removeItem('sagaburst_campaign_config')
      }
    }
  } catch (err) {
    console.warn('Failed to parse sessionStorage campaign config:', err)
    sessionStorage.removeItem('sagaburst_campaign_config')
  }

  if (savedCampaign) {
    await launchGame(undefined, savedCampaign)
    return
  }

  let savedConfig: BattleConfig | null = null
  try {
    const raw = sessionStorage.getItem('sagaburst_battle_config')
    if (raw) {
      const parsed = JSON.parse(raw)
      const validation = validateBattleConfig(parsed)
      if (validation.valid) {
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

  if (savedConfig) {
    await launchGame(savedConfig)
    return
  }

  // 3. Official entry: choose Custom Battle or Campaign first.
  const showHome = (): void => {
    const menu = new MainMenuUI()
    menu.mount(document.body, {
      onCustomBattle: () => {
        menu.destroy()
        const setupUI = new BattleSetupUI()
        setupUI.mount(
          document.body,
          async (config) => {
            try {
              sessionStorage.removeItem('sagaburst_campaign_config')
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
        const campaignUI = new CampaignSetupUI()
        campaignUI.mount(
          document.body,
          async (config) => {
            try {
              sessionStorage.removeItem('sagaburst_battle_config')
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
        )
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

  showHome()
}

void bootstrap()
