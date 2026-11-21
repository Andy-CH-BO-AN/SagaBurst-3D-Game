import { Vector3 } from 'three'
import { expect, it } from 'vitest'
import { isWithinEngagementRange, pursuitMayBreachGate, type EngagementActor, type PursuitGateActor } from '../../src/navigation/PursuitPolicy'

// Map half-extent 200 m: the horizontal diagonal squared, as the battlefield opt-in defines it.
const DIAGONAL_SQ = 400 * 400 * 2

function actor(tacticalOrder: string, at: Vector3, over: Partial<EngagementActor> = {}): EngagementActor {
  return { tacticalOrder, combatPosition: at, holdsRampartPosition: false, alertRange: 300, ...over }
}

it('追擊策略：Attack 以整張地圖對角線判斷接敵、Follow／Rampart／受限單位維持原半徑，且只有自由的 Attack／Charge 可攻擊關閉的城門', () => {
  const origin = new Vector3(-200, 0, -200), far = new Vector3(200, 80, 200)
  const within = (a: EngagementActor, rangeSq: number | null, confined: boolean, chasing: boolean, to = far) =>
    isWithinEngagementRange(a, rangeSq, confined, to, chasing)
  for (const chasing of [false, true]) {
    // 400 m on both axes is ~566 m: beyond the 300 m alert and 450 m chase radii, inside the map diagonal.
    expect(within(actor('attack', origin), null, false, chasing)).toBe(false)
    expect(within(actor('attack', origin), DIAGONAL_SQ, false, chasing)).toBe(true)
    // Height never counts toward the horizontal diagonal; a hair past the corner is out.
    expect(within(actor('attack', origin), DIAGONAL_SQ, false, chasing, new Vector3(200.1, 0, 200.1))).toBe(false)
    expect(within(actor('charge', origin), null, false, chasing)).toBe(true)
    expect(within(actor('follow', origin), DIAGONAL_SQ, false, chasing)).toBe(false)
    expect(within(actor('attack', origin), DIAGONAL_SQ, true, chasing)).toBe(false)
    expect(within(actor('attack', origin, { holdsRampartPosition: true }), DIAGONAL_SQ, false, chasing)).toBe(false)
  }
  // Without the battlefield policy: alert radius when idle, 1.5x detection once chasing, fixed Follow rings.
  const target = (x: number) => new Vector3(x, 0, 0), here = new Vector3()
  expect(within(actor('defend', here, { alertRange: 40 }), null, false, false, target(40))).toBe(true)
  expect(within(actor('defend', here, { alertRange: 40 }), null, false, false, target(41))).toBe(false)
  expect(within(actor('defend', here), null, false, true, target(450))).toBe(true)
  expect(within(actor('defend', here), null, false, true, target(451))).toBe(false)
  expect(within(actor('follow', here), null, false, false, target(24))).toBe(true)
  expect(within(actor('follow', here), null, false, false, target(25))).toBe(false)
  expect(within(actor('follow', here), null, false, true, target(36))).toBe(true)
  expect(within(actor('follow', here), null, false, true, target(37))).toBe(false)
  // Closed-gate breach is open only to free Attack/Charge pursuit; mission travel, encounters,
  // rampart duty and an active siege task keep their own owners.
  const free: PursuitGateActor = { missionMovement: false, holdsRampartPosition: false, hasSiegeObstacle: false, tacticalOrder: 'attack' }
  expect(pursuitMayBreachGate(free, false)).toBe(true)
  expect(pursuitMayBreachGate({ ...free, tacticalOrder: 'charge' }, false)).toBe(true)
  for (const order of ['defend', 'follow']) expect(pursuitMayBreachGate({ ...free, tacticalOrder: order }, false)).toBe(false)
  expect(pursuitMayBreachGate({ ...free, missionMovement: true }, false)).toBe(false)
  expect(pursuitMayBreachGate(free, true)).toBe(false)
  expect(pursuitMayBreachGate({ ...free, holdsRampartPosition: true }, false)).toBe(false)
  expect(pursuitMayBreachGate({ ...free, hasSiegeObstacle: true }, false)).toBe(false)
})
