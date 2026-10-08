import { describe, expect, it, vi, afterEach, onTestFinished } from 'vitest'
import { damagePlayer } from '../../src/combat/DamageRouter'
import { type CombatEvent } from '../../src/combat/CombatAttribution'
import { MountType } from '../../src/world/Mount'
import { TownScene } from '../../src/town/TownScene'
import { createTownCombatFixture } from '../helpers/townCombatFixture'

import { createMountedCombatActors, createMountedDamageContext as ctx } from '../helpers/mountedCombatActors'
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

afterEach(() => vi.unstubAllGlobals())

const hp = { setFill: vi.fn() } as any

describe('Town mounted damage and HUD wiring', () => {
  it('Player body/shield routing preserves riding and HUD; mount routing preserves Player HP', () => {
    const { rider, mount, player } = fixture(); rider.dismountFromMount(); player.mountVehicle(mount)
    const before = player.hp
    const eventList: CombatEvent[] = []
    damagePlayer(player, 30, hp, null, ctx(player, 'body', undefined, 'projectile', eventList))
    expect(player.hp).toBe(before - 30); expect(mount.currentHp).toBe(100); expect(player.currentMount).toBe(mount)
    damagePlayer(player, 30, hp, null, ctx(player, 'mount', mount, 'projectile', eventList))
    expect(player.hp).toBe(before - 30); expect(mount.currentHp).toBe(70)
    expect(eventList.map(e => 'target' in e && e.target.targetType)).toEqual(['player', 'mount'])
    const nodes = new Map<string, any>()
    for (const id of ['mount-hud', 'mount-name', 'mount-hp-fill']) nodes.set(id, { classList: { toggle: vi.fn() }, style: {} })
    vi.stubGlobal('document', { getElementById: (id: string) => nodes.get(id) ?? null })
    const town = createTownCombatFixture(); town.player = player
    ;(TownScene.prototype as any).updateMountHud.call(town)
    expect(nodes.get('mount-hud').classList.toggle).toHaveBeenLastCalledWith('visible', true)
    expect(nodes.get('mount-hp-fill').style.width).toBe('70%')
  })
})
