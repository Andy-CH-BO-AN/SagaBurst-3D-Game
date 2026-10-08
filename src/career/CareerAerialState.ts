import type { Player } from '../player/Player'
import type { Mount } from '../world/Mount'
import { parseFallingRiderSnapshot, type FallingRiderSnapshot } from '../movement/FallingRider'
import { parseEagleFlightSnapshot, type EagleFlightSnapshot } from '../movement/EagleFlightController'

export interface AerialPosition { x: number; y: number; z: number; yaw: number }
export interface CareerAerialState {
  sceneKey: string
  position: AerialPosition
  hp: number
  dead: boolean
  fall?: FallingRiderSnapshot
  mount?: { position: AerialPosition; hp: number; flight: EagleFlightSnapshot }
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function position(value: unknown): AerialPosition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<AerialPosition>
  return finite(raw.x) && finite(raw.y) && finite(raw.z) && finite(raw.yaw)
    ? { x: raw.x, y: raw.y, z: raw.z, yaw: raw.yaw } : undefined
}
export function parseCareerAerialState(value: unknown): CareerAerialState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CareerAerialState>, point = position(raw.position)
  if (typeof raw.sceneKey !== 'string' || !point || !finite(raw.hp) || raw.hp < 0 || typeof raw.dead !== 'boolean') return undefined
  const fall = parseFallingRiderSnapshot(raw.fall), flight = parseEagleFlightSnapshot(raw.mount?.flight), mountPosition = position(raw.mount?.position)
  if (raw.fall && !fall || raw.mount && (!flight || !mountPosition || !finite(raw.mount.hp) || raw.mount.hp < 0)) return undefined
  return { sceneKey: raw.sceneKey, position: point, hp: raw.hp, dead: raw.dead,
    ...(fall ? { fall } : {}), ...(flight && mountPosition && raw.mount ? { mount: { hp: raw.mount.hp, position: mountPosition, flight } } : {}) }
}
export function captureCareerAerialState(player: Player, sceneKey: string): CareerAerialState | undefined {
  const mount = player.currentMount
  if (!player.isFalling && !mount?.isAirborne) return undefined
  return { sceneKey, hp: player.hp, dead: player.dead,
    position: { x: player.group.position.x, y: player.group.position.y, z: player.group.position.z, yaw: player.group.rotation.y },
    ...(player.isFalling ? { fall: player.fallSnapshot } : {}),
    ...(mount?.flight && !mount.dead ? { mount: { hp: mount.currentHp,
      position: { x: mount.group.position.x, y: mount.group.position.y, z: mount.group.position.z, yaw: mount.group.rotation.y },
      flight: mount.flight.snapshot() } } : {}) }
}
/** Called after ordinary HP/death restoration. Attaching precedes restoring the airborne phase. */
export function restoreCareerAerialState(player: Player, mount: Mount | null, saved: CareerAerialState | undefined, sceneKey: string): boolean {
  if (!saved || saved.sceneKey !== sceneKey) return false
  if (saved.fall) player.dismountFromMount()
  if (saved.mount && mount?.flight && !mount.dead && !saved.dead && !saved.fall) {
    if (player.currentMount !== mount) player.mountVehicle(mount)
    const p = saved.mount.position
    mount.group.position.set(p.x, p.y, p.z)
    mount.currentHp = Math.min(mount.maxHp, saved.mount.hp)
    mount.flight.restore(saved.mount.flight)
    mount.group.rotation.set(-saved.mount.flight.pitch, saved.mount.flight.yaw, saved.mount.flight.bank, 'YXZ')
  }
  const p = saved.position
  player.group.position.set(p.x, p.y, p.z); player.group.rotation.y = p.yaw
  player.setHp(saved.hp)
  if (saved.fall) player.restorePendingFall(saved.fall)
  return true
}
