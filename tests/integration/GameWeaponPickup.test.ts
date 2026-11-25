import { describe, expect, it } from 'vitest'
import { runBattlefieldMountFrame } from '../../src/battle/BattlefieldMountFrame'
import { commanderOutpostCombatLocked } from '../../src/career/CommanderOutpost'
import {
  PlayerInteractionController, type InteractionMount, type InteractionPickup,
} from '../../src/world/PlayerInteractionController'

describe('Battlefield mount frame', () => {
  it('lets E dismount and remount during the Last Stand ceasefire while suppressing impact damage', () => {
    const mount: InteractionMount = {
      group: { position: { x: 0, y: 0, z: 1.4 } }, availableForPlayer: true, coopPuppet: false, displayName: '馬',
    }
    const player = {
      position: { x: 0, y: 0, z: 0 }, isMounted: true, currentMount: mount as InteractionMount | null,
      arrowCount: 0,
      setArrowCount(count: number) { this.arrowCount = count },
      dismountFromMount() { this.isMounted = false; this.currentMount = null },
    }
    const state = { prompt: null as string | null, released: [] as InteractionMount[], impactChecks: 0 }
    const interactions = new PlayerInteractionController<InteractionPickup, InteractionMount>({
      player: () => player,
      pickups: () => [],
      mounts: () => [mount],
      inventory: () => { throw new Error('Mount interaction accessed the inventory') },
      customPickupPolicy: () => false,
      hud: { show: text => { state.prompt = text }, notify() {} },
      quiver: { setArrowCount() {} },
      onDismounted: previous => { state.released.push(previous) },
      mountPlayer: next => { player.currentMount = next; player.isMounted = true },
    })
    let preparing = true
    let pressed = false
    const effects = {
      updateInteractions: () => interactions.update(pressed, Math.PI),
      isCombatLocked: () => commanderOutpostCombatLocked({
        coopGuest: false, launch: { careerCommanderOutpost: {} },
        runtime: { getSnapshot: () => ({ activePhase: preparing ? 'deployment' : 'assault' }) },
        deploymentBatch: { ready: true },
      }),
      updateImpactDamage: () => { state.impactChecks++ },
      persistPersonalOutpost() {},
    }
    const frame = (keyPressed = false) => {
      pressed = keyPressed
      runBattlefieldMountFrame(1 / 60, effects)
    }

    frame()
    expect(state.prompt).toBe('[E] 下騎')
    frame(true)
    expect(player.isMounted).toBe(false)
    expect(state.released).toEqual([mount])
    expect(state.prompt).toBe('[E] 騎乘：馬')
    frame(true)
    expect(player.currentMount).toBe(mount)
    expect(state.impactChecks).toBe(0)

    preparing = false
    frame()
    expect(state.impactChecks).toBe(1)
  })
})
