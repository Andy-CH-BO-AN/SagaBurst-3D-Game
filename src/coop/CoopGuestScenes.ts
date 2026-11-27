/** Guest entries for host scenes that are not Game battlefields (Town, duel arena, squad trial, prison break). */
import { CareerProfileStore } from '../career/CareerProfileStore'
import { TownScene } from '../town/TownScene'
import { showCoopGuestEnd } from './CoopLaunch'

function loadingOverlay(text: string): { set(text: string): void; remove(): void } {
  const overlay = document.createElement('div')
  overlay.id = 'coop-guest-loading'
  overlay.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#eee;background:#171411;z-index:9998;font:16px system-ui'
  overlay.setAttribute('role', 'status')
  overlay.textContent = text
  document.body.append(overlay)
  return { set: value => { overlay.textContent = value }, remove: () => overlay.remove() }
}

/** The host's Town, built from the in-memory copy of the host's save installed by the launch. */
export async function launchCoopGuestTown(container: HTMLElement): Promise<void> {
  const loading = loadingOverlay('正在進入主機的城鎮…')
  try {
    const profile = new CareerProfileStore().loadChecked().profile
    if (!profile) throw new Error('主機的生涯資料無法讀取')
    const ignore = (): void => {}
    const town = await TownScene.create(container, profile, ignore, ignore, ignore, text => loading.set(text))
    loading.remove()
    if (import.meta.env.DEV) (window as unknown as { town?: TownScene }).town = town
    town.startCoopGuest()
  } catch (error) {
    loading.remove()
    console.error('[coop] guest Town failed', error)
    showCoopGuestEnd('無法載入主機的城鎮')
  }
}

/** The host's duel arena (Colosseum / Valhalla), fighting on the host's side (up to 4v1). */
export async function launchCoopGuestArena(container: HTMLElement): Promise<void> {
  const loading = loadingOverlay('正在前往主機的競技場…')
  try {
    const { CareerDuelArenaScene } = await import('../arena/CareerDuelArenaScene')
    // The host's Town return re-announces the Town, which reloads this page; nothing to do here.
    const arena = await CareerDuelArenaScene.create(container, { returnToTown: () => {} }, text => loading.set(text))
    loading.remove()
    if (import.meta.env.DEV) (window as unknown as { __coopGuestArena?: unknown }).__coopGuestArena = arena
    arena.startCoopGuest()
  } catch (error) {
    loading.remove()
    console.error('[coop] guest arena failed', error)
    showCoopGuestEnd('無法載入主機的競技場')
  }
}

/** The host's Arena Squad Trial, fighting as one more member of the host's team. */
export async function launchCoopGuestTrial(container: HTMLElement): Promise<void> {
  const loading = loadingOverlay('正在前往主機的競技場試煉…')
  try {
    const { CareerArenaCombatScene } = await import('../arena/CareerArenaCombatScene')
    // As in the duel: the host's Town return re-announces the Town and reloads this page.
    const trial = await CareerArenaCombatScene.create(container, { returnToTown: () => {} }, text => loading.set(text))
    loading.remove()
    if (import.meta.env.DEV) (window as unknown as { __coopGuestTrial?: unknown }).__coopGuestTrial = trial
    trial.startCoopGuest()
  } catch (error) {
    loading.remove()
    console.error('[coop] guest trial failed', error)
    showCoopGuestEnd('無法載入主機的競技場試煉')
  }
}

/** The host's prison break, as one more prisoner on the host's side (unarmed until it picks up a sword). */
export async function launchCoopGuestPrison(container: HTMLElement): Promise<void> {
  const loading = loadingOverlay('正在跟隨主機進入關押場景…')
  try {
    const { CareerPrisonBreakScene } = await import('../arena/CareerPrisonBreakScene')
    // The host's return re-announces the Town and reloads this page.
    const prison = await CareerPrisonBreakScene.create(container, { returnToTown: () => {} }, text => loading.set(text))
    loading.remove()
    if (import.meta.env.DEV) (window as unknown as { __coopGuestPrison?: unknown }).__coopGuestPrison = prison
    prison.startCoopGuest()
  } catch (error) {
    loading.remove()
    console.error('[coop] guest prison failed', error)
    showCoopGuestEnd('無法載入主機的關押場景')
  }
}
