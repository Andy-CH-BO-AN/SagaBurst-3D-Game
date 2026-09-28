import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../src/Game'
import { createCampaignOutpost } from '../src/campaign/CampaignOutpost'

function setup(faction: 'roman' | 'viking' = 'roman') {
  const outpost = createCampaignOutpost(new THREE.Scene(), faction)
  const away = new THREE.Vector3(0, 0, 140 * (faction === 'roman' ? -1 : 1))
  // Exercise the real keyboard/spawn methods without constructing a WebGL game.
  const game = Object.assign(Object.create(Game.prototype), {
    previewCampaignGate: outpost.gateController,
    defenseCampaignConfig: { defenderFaction: faction },
    campaignAttackersStarted: false,
    campaignSpawnWave: 'attackers',
    campaignSpawnQueue: [{}, {}],
    campaignSpawnQueueIndex: 0,
    controlMode: 'player',
    player: { dead: false, combatPosition: away.clone() },
    equipmentUI: { visible: false },
    npcs: [],
    mounts: [],
    _showNotify: vi.fn(),
  })
  game._spawnNpc = vi.fn(() => {
    const npc = { dead: false, combatPosition: away.clone(), setTacticalOrder: vi.fn() }
    game.npcs.push(npc)
    return npc
  })
  let keydown: (event: unknown) => void = () => {}
  vi.stubGlobal('window', {
    addEventListener: (_type: string, listener: typeof keydown) => { keydown = listener },
  })
  game._setupShortcuts()
  const pressG = (repeat = false) => keydown({ code: 'KeyG', repeat, preventDefault: vi.fn() })
  return { game, outpost, pressG }
}

afterEach(() => vi.unstubAllGlobals())

describe('campaign defender gate input', () => {
  it.each(['roman', 'viking'] as const)('unlocks %s G input on the first actual attacker spawn', faction => {
    const { game, outpost, pressG } = setup(faction)
    const gate = outpost.gateController
    pressG()
    expect(gate.state).toBe('closed')
    expect(gate.breached).toBe(false)
    game._spawnNextDefenseCampaignNpc()
    expect(game.campaignSpawnQueueIndex).toBe(1)
    expect(game.campaignSpawnWave).toBe('attackers')
    pressG()
    expect(gate.state).toBe('open')
    expect(gate.breached).toBe(true)
    expect(outpost.obstacles.some(o => o.damageable === outpost.gate)).toBe(false)
    // Losing the first attacker while later attackers are queued must not relock it.
    game.npcs[0].dead = true
    pressG()
    expect(gate.state).toBe('closed')
    pressG()
    expect(gate.state).toBe('open')
  })

  it('does not unlock when spawn throws before creating an attacker', () => {
    const { game, pressG, outpost } = setup()
    game._spawnNpc.mockImplementation(() => { throw new Error('spawn failed') })
    expect(() => game._spawnNextDefenseCampaignNpc()).toThrow('spawn failed')
    pressG()
    expect(outpost.gateController.state).toBe('closed')
  })

  it.each(['player', 'npc', 'mount'])('cannot close the gate through a living %s', actor => {
    const { game, outpost, pressG } = setup()
    game._spawnNextDefenseCampaignNpc()
    pressG()
    const position = outpost.gateController.collisionBox.getCenter(new THREE.Vector3())
    if (actor === 'player') game.player.combatPosition.copy(position)
    if (actor === 'npc') game.npcs[0].combatPosition.copy(position)
    if (actor === 'mount') game.mounts.push({ dead: false, group: { position } })
    pressG()
    expect(outpost.gateController.state).toBe('open')
    expect(game._showNotify).toHaveBeenLastCalledWith('🚪 門口有人或馬，無法關門')
  })

  it('ignores held keys, equipment menus, dead players and spectators', () => {
    const { game, outpost, pressG } = setup()
    game._spawnNextDefenseCampaignNpc()
    pressG(true)
    expect(outpost.gateController.state).toBe('closed')
    game.equipmentUI.visible = true
    pressG()
    expect(outpost.gateController.state).toBe('closed')
    game.equipmentUI.visible = false
    game.player.dead = true
    pressG()
    expect(outpost.gateController.state).toBe('closed')
    game.player.dead = false
    game.controlMode = 'spectator'
    pressG()
    expect(outpost.gateController.state).toBe('closed')
  })

  it('never restores a destroyed gate with G', () => {
    const { game, outpost, pressG } = setup()
    game._spawnNextDefenseCampaignNpc()
    outpost.gate.destroy()
    pressG()
    expect(outpost.gateController.state).toBe('destroyed')
    expect(outpost.gate.root.parent).toBeNull()
  })
})
