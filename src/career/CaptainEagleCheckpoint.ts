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
    mountActorId?: string
    mountHp?: number
    mount?: PersonalActorCheckpoint['mount']
    homeMount?: PersonalActorCheckpoint['mount']
    fall?: PersonalActorCheckpoint['fall']
  }
  ready: boolean
  playerStats: PlayerBattleStatsCheckpoint
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0
const totals = ['damageDealt', 'damageTaken', 'kills', 'structureDamage', 'structuresDestroyed', 'gateBreaches'] as const

export function parseCaptainEagleCheckpoint(value: unknown, maxActors = 128): CaptainEagleCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CaptainEagleCheckpoint>
  const player = raw.player
  if (!player || !nonnegative(player.hp) || !nonnegative(player.stamina) || typeof player.dead !== 'boolean'
    || !nonnegative(player.ammo) || !nonnegative(player.shieldImpact) || typeof raw.ready !== 'boolean'
    || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors) || Object.keys(raw.actors).length > maxActors
    || !raw.playerStats || totals.some(key => !nonnegative(raw.playerStats?.[key]))) return undefined
  const actorPlayer = parseCommandActorCheckpoint({ status: player.dead ? 'dead' : 'deployed',
    position: player.position, mount: player.mount, fall: player.fall })
  if (!actorPlayer?.position || player.mount && !actorPlayer.mount || player.fall && !actorPlayer.fall
    || player.mountHp !== undefined && !nonnegative(player.mountHp)) return undefined
  if (player.mountActorId !== undefined && (typeof player.mountActorId !== 'string' || !player.mountActorId || player.mountActorId.length > 200)) return undefined
  const homeMount = parseCommandActorCheckpoint({ status: 'deployed', mount: player.homeMount })?.mount
  if (player.homeMount && !homeMount) return undefined
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
    ...(player.mountActorId ? { mountActorId: player.mountActorId } : {}),
    ...(player.mountHp !== undefined ? { mountHp: player.mountHp } : {}),
    ...(homeMount ? { homeMount } : {}),
    ...(actorPlayer.mount ? { mount: actorPlayer.mount } : {}), ...(actorPlayer.fall ? { fall: actorPlayer.fall } : {}),
  }, playerStats: {
    damageDealt: raw.playerStats.damageDealt, damageTaken: raw.playerStats.damageTaken,
    kills: Math.floor(raw.playerStats.kills), structureDamage: raw.playerStats.structureDamage,
    structuresDestroyed: Math.floor(raw.playerStats.structuresDestroyed), gateBreaches: Math.floor(raw.playerStats.gateBreaches),
  } }
}

type CheckpointMount = NonNullable<PersonalActorCheckpoint['mount']>
type Vector = { readonly x: number; readonly y: number; readonly z: number }

/** The live mount state a field-battle checkpoint records (structural, so no scene types are needed here). */
export interface CheckpointMountSource {
  readonly dead: boolean
  readonly currentHp: number
  readonly armorImpactRemaining: number
  readonly group: { readonly position: Vector; readonly rotation: { readonly y: number } }
  readonly flight: { snapshot(): NonNullable<CheckpointMount['flight']> } | null
}

/** A mount's saved HP (0 once dead), armour, rider state, place and, for a flier, its flight. */
export function snapshotCheckpointMount(mount: CheckpointMountSource, mounted: boolean): CheckpointMount {
  return {
    hp: mount.dead ? 0 : mount.currentHp, armorImpactRemaining: mount.armorImpactRemaining, mounted,
    position: { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z, yaw: mount.group.rotation.y },
    ...(mount.flight ? { flight: mount.flight.snapshot() } : {}),
  }
}

/** The live player state every field-battle checkpoint starts from. */
export interface CheckpointPlayerSource {
  readonly hp: number
  readonly staminaValue: number
  readonly dead: boolean
  readonly position: Vector
  readonly group: { readonly rotation: { readonly y: number } }
  readonly arrowCount: number
  readonly shield: { readonly shieldImpactRemaining: number }
}

/** HP, stamina, death, place and supplies; mount and fall details are added by the caller. */
export function snapshotCheckpointPlayer(player: CheckpointPlayerSource): Pick<CaptainEagleCheckpoint['player'],
  'hp' | 'stamina' | 'dead' | 'position' | 'ammo' | 'shieldImpact'> {
  return {
    hp: player.hp, stamina: player.staminaValue, dead: player.dead,
    position: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.group.rotation.y },
    ammo: player.arrowCount, shieldImpact: player.shield.shieldImpactRemaining,
  }
}
