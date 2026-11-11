import type { MountType } from '../world/Mount'
import { XONGKORO } from '../movement/XongkoroConfig'
import { mountArmorImpactMax, mountImpactMultiplier } from './MountArmor'

/** Every runtime mount type, as the string its enum carries. Type-only, so this pure module never loads Mount. */
export type MountKind = `${MountType}`
export type GroundMountKind = Exclude<MountKind, 'xongkoro'>

/** Base speed (m/s) and max HP of each ground mount; Mount reads these in its constructor, so UI and Gameplay share one source. */
const GROUND_BASE: Readonly<Record<GroundMountKind, { readonly baseSpeed: number; readonly maxHp: number }>> = {
  HORSE: { baseSpeed: 12, maxHp: 100 },
  ARMORED_HORSE: { baseSpeed: 10.5, maxHp: 600 },
  BLACK_CAT: { baseSpeed: 13.2, maxHp: 100 },
  WHITE_CAT: { baseSpeed: 13.2, maxHp: 100 },
  ORANGE_CAT: { baseSpeed: 12, maxHp: 150 },
  SERVAL: { baseSpeed: 15, maxHp: 100 },
  CARACAL: { baseSpeed: 15, maxHp: 100 },
  CORGI: { baseSpeed: 12, maxHp: 100 },
  SNOW_LEOPARD: { baseSpeed: 12.8, maxHp: 500 },
}

/** The only rider-dependent ground speed: a Byzantine cataphract hero rides the armored horse faster. */
export const MOUNT_RIDER_SPEED_EXCEPTIONS: Readonly<Partial<Record<GroundMountKind, { readonly heroAssetId: string; readonly speed: number; readonly riderName: string }>>> = {
  ARMORED_HORSE: { heroAssetId: 'byzantine-cataphract-t5', speed: 12, riderName: '拜占庭鐵甲重騎兵' },
}

export interface GroundMountStats {
  readonly kind: 'ground'
  /** m/s, for the given rider. */
  readonly baseSpeed: number
  /** Maximum, not current, HP. */
  readonly maxHp: number
  /** Barding impact durability maximum, not what is left of it. */
  readonly armorMax: number
  readonly impactMultiplier: number
}
export interface FlyingMountStats {
  readonly kind: 'flying'
  /** m/s */
  readonly cruiseSpeed: number
  readonly sprintSpeed: number
  readonly maxHp: number
  readonly armorMax: number
  readonly attackDamage: number
  readonly attackCooldown: number
}
export type MountStats = GroundMountStats | FlyingMountStats

export const isFlyingMountKind = (kind: MountKind): kind is 'xongkoro' => kind === 'xongkoro'

/** Ground speed for a rider; `riderHeroAssetId` is the Player's real hero asset, or null/undefined for any other rider. */
export function mountGroundSpeed(kind: GroundMountKind, riderHeroAssetId?: string | null): number {
  const exception = MOUNT_RIDER_SPEED_EXCEPTIONS[kind]
  return exception && riderHeroAssetId === exception.heroAssetId ? exception.speed : GROUND_BASE[kind].baseSpeed
}

/** Authoritative starting stats of a mount type. Never constructs a Mount, Scene or model. */
export function mountStats(kind: MountKind, riderHeroAssetId?: string | null): MountStats {
  if (isFlyingMountKind(kind)) {
    return { kind: 'flying', cruiseSpeed: XONGKORO.cruiseSpeed, sprintSpeed: XONGKORO.sprintSpeed, maxHp: XONGKORO.maxHp,
      armorMax: mountArmorImpactMax(kind), attackDamage: XONGKORO.attackDamage, attackCooldown: XONGKORO.attackCooldown }
  }
  return { kind: 'ground', baseSpeed: mountGroundSpeed(kind, riderHeroAssetId), maxHp: GROUND_BASE[kind].maxHp,
    armorMax: mountArmorImpactMax(kind), impactMultiplier: mountImpactMultiplier(kind) }
}
