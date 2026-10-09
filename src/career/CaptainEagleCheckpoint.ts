import type { PlayerBattleStatsCheckpoint } from '../combat/BattleStatsTracker'
import type { PersonalActorCheckpoint, PersonalActorPosition } from './CareerPersonalSquadMission'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'

/** Full aerial state is saved independently of temporary scene actors. */
export interface CaptainEagleCheckpoint {
  actors: Record<string, PersonalActorCheckpoint>
  player: {
    hp: number
    stamina: number
    dead: boolean
    position: PersonalActorPosition
    ammo: number
    shieldImpact: number
    mountHp?: number
    mount?: PersonalActorCheckpoint['mount']
    fall?: PersonalActorCheckpoint['fall']
  }
  ready: boolean
  playerStats: PlayerBattleStatsCheckpoint
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0
const totals = ['damageDealt', 'damageTaken', 'kills', 'structureDamage', 'structuresDestroyed', 'gateBreaches'] as const

export function parseCaptainEagleCheckpoint(value: unknown): CaptainEagleCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CaptainEagleCheckpoint>
  const player = raw.player
  if (!player || !nonnegative(player.hp) || !nonnegative(player.stamina) || typeof player.dead !== 'boolean'
    || !nonnegative(player.ammo) || !nonnegative(player.shieldImpact) || typeof raw.ready !== 'boolean'
    || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors) || Object.keys(raw.actors).length > 128
    || !raw.playerStats || totals.some(key => !nonnegative(raw.playerStats?.[key]))) return undefined
  const actorPlayer = parseCommandActorCheckpoint({ status: player.dead ? 'dead' : 'deployed',
    position: player.position, mount: player.mount, fall: player.fall })
  if (!actorPlayer?.position || player.mount && !actorPlayer.mount || player.fall && !actorPlayer.fall
    || player.mountHp !== undefined && !nonnegative(player.mountHp)) return undefined
  const actors: Record<string, PersonalActorCheckpoint> = {}
  for (const [id, saved] of Object.entries(raw.actors)) {
    if (!id || id.length > 200) return undefined
    const actor = parseCommandActorCheckpoint(saved)
    if (!actor) return undefined
    actors[id] = actor
  }
  return { actors, ready: raw.ready, player: {
    hp: player.hp, stamina: player.stamina, dead: player.dead, position: actorPlayer.position,
    ammo: Math.floor(player.ammo), shieldImpact: player.shieldImpact,
    ...(player.mountHp !== undefined ? { mountHp: player.mountHp } : {}),
    ...(actorPlayer.mount ? { mount: actorPlayer.mount } : {}), ...(actorPlayer.fall ? { fall: actorPlayer.fall } : {}),
  }, playerStats: {
    damageDealt: raw.playerStats.damageDealt, damageTaken: raw.playerStats.damageTaken,
    kills: Math.floor(raw.playerStats.kills), structureDamage: raw.playerStats.structureDamage,
    structuresDestroyed: Math.floor(raw.playerStats.structuresDestroyed), gateBreaches: Math.floor(raw.playerStats.gateBreaches),
  } }
}
