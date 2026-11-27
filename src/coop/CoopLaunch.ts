/**
 * Mission hand-off between the host page and its guests.
 *
 * Host: every Career combat launch is announced with the launch config and a
 * copy of the host's saves, so each guest can build the identical scene. Only
 * the scene's audience (`CoopAudience`) follows; the other guests are told to wait.
 * Guest: the announcement is parked in sessionStorage and the page reloads into
 * it. While it runs, game saves live only in memory and the guest's own
 * sessionStorage is backed up, then restored when the guest leaves.
 */
import type { CareerCombatLaunch } from '../career/CaptainBattleLaunch'
import type { CareerPersonalSquadMember } from '../career/CareerPersonalSquad'
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { resolveCareerHeroAsset } from '../career/CareerPlayerProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { normalizeSkillState, type SkillState, type SkillStateInput } from '../rpg/SkillManager'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../career/CareerProfileStore'
import { DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY } from '../campaign/CampaignProgress'
import { installGameStorageOverride, MemoryStorage } from '../save/GameStorage'
import { SAVE_KEY } from '../save/SaveManager'
import { coopSession, type CoopMessage } from './CoopLink'
import { COOP_PROTOCOL_VERSION } from './CoopProtocol'
import { CoopAudience, initialCoopAudience, type CoopSceneKind } from './CoopAudience'
import { showCoopToast } from './CoopLobbyUI'

export type { CoopSceneKind } from './CoopAudience'

const GUEST_LAUNCH_KEY = 'sagaburst_coop_guest_launch'
const GUEST_SESSION_BACKUP_KEY = 'sagaburst_coop_session_backup'
const GUEST_RESTORE_KEY = 'sagaburst_coop_session_restore'
/** Host: the Town launch id announced as the host left its mission; the Town page re-announces under it. */
const HOST_TOWN_RETURN_KEY = 'sagaburst_coop_town_return'
/** Host: the seats following the current launch, kept across the host's own page reload (Town return). */
const HOST_AUDIENCE_KEY = 'sagaburst_coop_audience'
/** Host: the guest seat of the last one-partner scene, who stays the partner when there is a choice. */
const HOST_PARTNER_KEY = 'sagaburst_coop_partner'
const COOP_SESSION_KEYS = new Set([GUEST_LAUNCH_KEY, GUEST_SESSION_BACKUP_KEY, GUEST_RESTORE_KEY, HOST_TOWN_RETURN_KEY, HOST_AUDIENCE_KEY, HOST_PARTNER_KEY, 'sagaburst_coop_link'])
const SHARED_LOCAL_KEYS = [CAREER_STORAGE_KEY, SAVE_KEY, DEFENSE_CAMPAIGN_PROGRESS_STORAGE_KEY]

const COOP_SCENES: ReadonlySet<string> = new Set<CoopSceneKind>(['game', 'town', 'arena', 'trial', 'prison'])

export interface CoopLaunchPayload {
  scene: CoopSceneKind
  id: string
  version: number
  /** Battlefield launch config; only for scene 'game'. */
  config?: CareerCombatLaunch
  local: Record<string, string | null>
  session: Record<string, string>
}

function sessionEntries(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && !COOP_SESSION_KEYS.has(key)) out[key] = storage.getItem(key) ?? ''
  }
  return out
}

function replaceSessionEntries(storage: Storage, entries: Record<string, string>): void {
  for (const key of Object.keys(sessionEntries(storage))) storage.removeItem(key)
  for (const [key, value] of Object.entries(entries)) storage.setItem(key, value)
}

/** Validates the peer-supplied payload shape; contents are re-validated by the normal save parsers. */
export function parseCoopLaunchPayload(value: unknown): CoopLaunchPayload | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Partial<CoopLaunchPayload>
  if (typeof p.id !== 'string' || p.version !== COOP_PROTOCOL_VERSION) return null
  if (typeof p.scene !== 'string' || !COOP_SCENES.has(p.scene)) return null
  if (p.scene === 'game' ? !p.config || typeof p.config !== 'object' : p.config !== undefined) return null
  if (!p.local || typeof p.local !== 'object' || !p.session || typeof p.session !== 'object') return null
  const local: Record<string, string | null> = {}
  for (const key of SHARED_LOCAL_KEYS) {
    const raw = (p.local as Record<string, unknown>)[key]
    local[key] = typeof raw === 'string' ? raw : null
  }
  const session: Record<string, string> = {}
  for (const [key, raw] of Object.entries(p.session)) {
    if (typeof raw === 'string' && key.startsWith('sagaburst') && !COOP_SESSION_KEYS.has(key)) session[key] = raw
  }
  return { id: p.id, version: p.version, scene: p.scene, ...(p.config ? { config: p.config } : {}), local, session }
}

// ── Host ──────────────────────────────────────────────────────────────────

let hostLaunch: CoopLaunchPayload | null = null
let hostAudience: CoopAudience | null = null
let hostListening = false

/** Host: whether this guest seat follows the host's current scene (its messages are the scene's to use). */
export function isCoopSeatAdmitted(seat: number): boolean { return hostAudience?.has(seat) ?? false }

function storedAudience(id: string, scene: CoopSceneKind): CoopAudience | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(HOST_AUDIENCE_KEY) ?? 'null') as { id?: unknown; scene?: unknown; seats?: unknown } | null
    if (!stored || stored.id !== id || stored.scene !== scene || !Array.isArray(stored.seats)) return null
    return new CoopAudience(scene, stored.seats.filter((seat): seat is number => Number.isInteger(seat)))
  } catch { return null }
}

function storedPartner(): number | null {
  try {
    const seat = Number(sessionStorage.getItem(HOST_PARTNER_KEY))
    return Number.isInteger(seat) && seat > 0 ? seat : null
  } catch { return null }
}

function rememberAudience(): void {
  if (!hostLaunch || !hostAudience) return
  try {
    sessionStorage.setItem(HOST_AUDIENCE_KEY, JSON.stringify({ id: hostLaunch.id, scene: hostLaunch.scene, seats: hostAudience.seats }))
    if (hostAudience.capacity === 1 && hostAudience.seats.length) sessionStorage.setItem(HOST_PARTNER_KEY, String(hostAudience.seats[0]))
  } catch (error) { console.warn('[coop] could not keep the scene audience', error) }
}

/** Host: the current launch for a guest of the scene's audience; any other guest is told to wait. */
function deliverCoopLaunch(seat: number): void {
  const link = coopSession()
  if (!hostLaunch || !hostAudience) return
  if (hostAudience.admit(seat, link.peers)) {
    rememberAudience()
    link.send({ t: 'launch', payload: hostLaunch }, seat)
  } else link.send({ t: 'wait', scene: hostLaunch.scene }, seat)
}

/** Host: record the mission the guests should join, and send it to every guest that is there. */
export function announceCoopLaunch(config: CareerCombatLaunch): void { announceCoopScene('game', config) }

/** Host: the guest follows into this scene (Town and arenas are announced by their entry). */
export function announceCoopScene(scene: CoopSceneKind, config?: CareerCombatLaunch): void {
  const link = coopSession()
  if (!link.isHost) return
  let returnId: string | null = null
  try { returnId = sessionStorage.getItem(HOST_TOWN_RETURN_KEY); sessionStorage.removeItem(HOST_TOWN_RETURN_KEY) } catch { returnId = null }
  const local: Record<string, string | null> = {}
  for (const key of SHARED_LOCAL_KEYS) local[key] = localStorage.getItem(key)
  hostLaunch = {
    // The Town the guest already joined when the host left its mission keeps that id: the guest stays put.
    id: scene === 'town' && returnId ? returnId : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    version: COOP_PROTOCOL_VERSION, scene, ...(config ? { config: structuredClone(config) } : {}), local, session: sessionEntries(sessionStorage),
  }
  hostAudience = storedAudience(hostLaunch.id, scene) ?? initialCoopAudience(scene, link.peers, storedPartner())
  rememberAudience()
  if (!hostListening) {
    hostListening = true
    // A guest that (re)joins or reloads says hello; give it the running mission (or tell it to wait).
    link.on('hello', (_message, from) => deliverCoopLaunch(from))
  }
  for (const seat of link.peers) deliverCoopLaunch(seat)
}

/**
 * Host: leaving a mission for the Town. The guest follows now, in parallel with the host's own Town load,
 * from the return save just written; the host's Town re-announces under the same id when it is ready.
 */
export function announceCoopTownReturn(): void {
  if (!coopSession().isHost) return
  announceCoopScene('town')
  try { if (hostLaunch) sessionStorage.setItem(HOST_TOWN_RETURN_KEY, hostLaunch.id) }
  catch (error) { console.warn('[coop] could not keep the Town return id', error) }
}

// ── Guest ─────────────────────────────────────────────────────────────────

let guestLaunchId: string | null = null
let guestOwnSquad: CareerPersonalSquadMember[] = []
let guestOwnProfile: CareerProfile | null = null
let guestScene: CoopSceneKind | null = null

export function isCoopGuestLaunch(): boolean { return guestLaunchId !== null }
/** The host launch this guest page mirrors, or null outside co-op. */
export function coopGuestLaunchId(): string | null { return guestLaunchId }
/** The host scene this guest page mirrors, or null outside co-op. */
export function coopGuestScene(): CoopSceneKind | null { return guestScene }

/** A scene's source for the player character, separate from the profile that builds the world. */
export interface CoopPlayerSource {
  read(): CareerProfile
  /** Equipment / mount changes stay in this page: the guest's own save is never written by them. */
  commit(next: CareerProfile): boolean
  /** Skill progress is the guest's own: it is written (skills only) into the guest's own save. */
  commitSkills(skills: SkillState): boolean
}

/** Per skill, the further of the two (level, then XP): a save never loses progress made elsewhere. */
export function mergeSkillProgress(saved: SkillStateInput | undefined, gained: SkillState): SkillState {
  const out = normalizeSkillState(gained)
  const prior = normalizeSkillState(saved)
  for (const id of Object.keys(out) as (keyof SkillState)[]) {
    const a = out[id], b = prior[id]
    if (b.level > a.level || b.level === a.level && b.xp > a.xp) out[id] = { ...b }
  }
  return out
}

/**
 * Co-op guest: writes its skill progress into its own Career save. Only `skills` changes; the rest of
 * the guest's save (merit, equipment, missions) is left exactly as it is. False outside a guest page, when
 * this computer has no Career save, or when that save now belongs to another career.
 */
export function commitCoopGuestSkills(skills: SkillState): boolean {
  if (!guestLaunchId || !guestOwnProfile) return false
  const store = new CareerProfileStore(localStorage)
  const latest = store.loadChecked().profile
  if (!latest || latest.tutorial?.careerId !== guestOwnProfile.tutorial?.careerId) return false
  const next = cloneCareerProfile(latest)
  next.skills = mergeSkillProgress(latest.skills, skills)
  if (!store.save(next)) return false
  guestOwnProfile = next
  return true
}

/**
 * Co-op guest: its own character (faction look, hero/tier, HP, skills, equipment, mounts) from its own
 * save, inside the host's world. The host's current mission/race state is carried over so mission
 * rules (unarmed duel, race lock) still apply to it; the guest's own mount outing state is not.
 * Null outside a co-op guest page or when this computer has no Career save.
 */
export function coopGuestPlayerSource(host: CareerProfile | null | undefined): CoopPlayerSource | null {
  if (!guestLaunchId || !guestOwnProfile) return null
  let working = cloneCareerProfile(guestOwnProfile)
  working.activeMission = host?.activeMission ? { ...structuredClone(host.activeMission), mountState: undefined } : undefined
  working.activeOutpostMission = host?.activeOutpostMission ? structuredClone(host.activeOutpostMission) : undefined
  working.activeRace = host?.activeRace ? structuredClone(host.activeRace) : undefined
  return {
    read: () => working,
    commit: next => { working = next; return true },
    commitSkills: skills => {
      // The working copy follows at once (max HP reads it); the save is retried on the next flush if it fails.
      working = { ...cloneCareerProfile(working), skills: normalizeSkillState(skills) }
      return commitCoopGuestSkills(skills)
    },
  }
}

/** Assets the guest's own character needs before its scene builds the Player (hero body, gear, mount). */
export function coopGuestCharacterAssets(): { hero: HeroAssetId | null; equipmentIds: string[]; mountId: string | null } | null {
  if (!guestLaunchId || !guestOwnProfile) return null
  const equipment = guestOwnProfile.equipment
  return { hero: resolveCareerHeroAsset(guestOwnProfile) ?? null,
    equipmentIds: [equipment?.melee, equipment?.ranged, equipment?.shield].filter((id): id is string => Boolean(id)),
    mountId: guestOwnProfile.selectedMountId ?? null }
}

/** The guest's own HR personal squad (read-only from its own Career save); the guest commands only these. */
export function coopGuestOwnSquad(): readonly CareerPersonalSquadMember[] { return guestOwnSquad }

const WAIT_SCENE_NAMES: Readonly<Record<CoopSceneKind, string>> = { game: '戰場', town: '城鎮', arena: '競技場', trial: '競技場試煉', prison: '關押場景' }

/** Guest: why it is not following the host into `scene`. */
export function coopWaitReason(scene: unknown): string {
  const name = typeof scene === 'string' && scene in WAIT_SCENE_NAMES ? WAIT_SCENE_NAMES[scene as CoopSceneKind] : '這個場景'
  return `主機進入的${name}目前只支援主機加 1 位隊友；主機下次出戰時你會自動加入`
}

/** Guest: park the host's mission and reload into it (ignores the mission already running). */
export function listenForCoopLaunch(): () => void {
  // Another guest is the host's partner in this scene: a guest page ends its scene, the waiting room just says so.
  const offWait = coopSession().on('wait', message => {
    if (isCoopGuestLaunch()) showCoopGuestEnd(coopWaitReason(message.scene))
    else showCoopToast(coopWaitReason(message.scene))
  })
  const offLaunch = coopSession().on('launch', (message: CoopMessage) => {
    const payload = parseCoopLaunchPayload(message.payload)
    if (!payload || payload.id === guestLaunchId || !coopSession().isGuest) return
    try {
      if (sessionStorage.getItem(GUEST_SESSION_BACKUP_KEY) === null) {
        sessionStorage.setItem(GUEST_SESSION_BACKUP_KEY, JSON.stringify(sessionEntries(sessionStorage)))
      }
      sessionStorage.setItem(GUEST_LAUNCH_KEY, JSON.stringify(payload))
    } catch (error) { console.warn('[coop] could not stage mission', error); return }
    document.exitPointerLock?.()
    window.location.assign(window.location.pathname + window.location.search)
  })
  return () => { offWait(); offLaunch() }
}

/**
 * Guest bootstrap, before any other startup routing: finishes a pending exit
 * (after the old page's pagehide writes) or returns the staged mission and
 * switches this page to the host's saves.
 */
export function consumeCoopGuestLaunch(asGuest = true): { scene: CoopSceneKind; config?: CareerCombatLaunch } | null {
  // A staged mission on a page that is no longer a guest (left the room, link lost) is dropped like a finished exit.
  if (sessionStorage.getItem(GUEST_RESTORE_KEY) !== null || !asGuest && sessionStorage.getItem(GUEST_LAUNCH_KEY) !== null) {
    let backup: Record<string, string> = {}
    try {
      const parsed = JSON.parse(sessionStorage.getItem(GUEST_SESSION_BACKUP_KEY) ?? '{}') as unknown
      if (parsed && typeof parsed === 'object') backup = parsed as Record<string, string>
    } catch { backup = {} }
    // A missing or corrupt backup still clears the host's session entries.
    replaceSessionEntries(sessionStorage, backup)
    for (const key of [GUEST_LAUNCH_KEY, GUEST_SESSION_BACKUP_KEY, GUEST_RESTORE_KEY]) sessionStorage.removeItem(key)
    return null
  }
  let payload: CoopLaunchPayload | null = null
  try { payload = parseCoopLaunchPayload(JSON.parse(sessionStorage.getItem(GUEST_LAUNCH_KEY) ?? 'null')) } catch { payload = null }
  if (!payload) return null
  // Read before the override: the guest's own save is never written during co-op.
  try { guestOwnProfile = new CareerProfileStore(localStorage).loadChecked().profile }
  catch { guestOwnProfile = null }
  guestOwnSquad = guestOwnProfile?.personalSquad?.members.map(member => structuredClone(member)) ?? []
  replaceSessionEntries(sessionStorage, payload.session)
  installGameStorageOverride(new MemoryStorage(payload.local))
  guestLaunchId = payload.id
  guestScene = payload.scene
  return { scene: payload.scene, ...(payload.config ? { config: payload.config } : {}) }
}

/** Guest: leave the co-op mission; the next page restores this page's own session data. */
export function exitCoopGuestMission(): void {
  sessionStorage.removeItem(GUEST_LAUNCH_KEY)
  sessionStorage.setItem(GUEST_RESTORE_KEY, '1')
  window.location.assign(window.location.pathname)
}

/** Guest: leave the room itself (the link closes first), then restore this page's own session like any other exit. */
export async function leaveCoopGuestRoom(): Promise<void> {
  try { await coopSession().leave() } catch (error) { console.warn('[coop] leave failed', error) }
  exitCoopGuestMission()
}

export function showCoopGuestEnd(reason: string): void {
  if (document.getElementById('coop-guest-end')) return
  document.exitPointerLock?.()
  const overlay = document.createElement('section')
  overlay.id = 'coop-guest-end'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(10,8,6,.72);color:#f1e6d2;font:16px/1.6 system-ui'
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;gap:14px;align-items:center;padding:28px 36px;border:1px solid #8a6a3a;border-radius:10px;background:#1d1812'
  const text = document.createElement('p')
  text.style.margin = '0'
  text.textContent = `${reason}。`
  const button = document.createElement('button')
  button.className = 'town-button'
  button.textContent = '返回連線等待畫面'
  button.onclick = () => exitCoopGuestMission()
  box.append(text, button)
  overlay.append(box)
  document.body.append(overlay)
}
