import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Game } from '../../src/Game'
import { TownScene } from '../../src/town/TownScene'
import { MountType, MountState } from '../../src/world/Mount'
import type { EagleWingbeatCandidate } from '../../src/audio/SoundManager'

const audio = vi.hoisted(() => ({
  updateHorseGallopLoops: vi.fn(), updateEagleWingbeats: vi.fn<(candidates: EagleWingbeatCandidate[]) => void>(),
  playCareerMissionVoice: vi.fn(),
}))
vi.mock('../../src/audio/SoundManager', () => ({ SoundManager: class {
  updateHorseGallopLoops = audio.updateHorseGallopLoops
  updateEagleWingbeats = audio.updateEagleWingbeats
  playCareerMissionVoice = audio.playCareerMissionVoice
} }))

function eagle() {
  const visual = { isFlapping: true, wingbeatSequence: 7 }
  return { group: new THREE.Group(), type: MountType.XONGKORO, state: MountState.CONTROLLED,
    eagleVisual: visual, dead: false, disposed: false, isAirborne: true, currentLod: 0, movementSpeed: 13,
    setCameraDistance: vi.fn(), update: () => { visual.wingbeatSequence++ } }
}

beforeEach(() => vi.clearAllMocks())

describe('Game and Career eagle sound producers', () => {
  it('Game samples the just-updated flying eagle and marks the player owner through the real interaction caller', () => {
    // Recording visual/actor boundary: zero real actors, mounts or world.
    const mount = eagle()
    const game = Object.assign(Object.create(Game.prototype) as { _updateInteractions(dt: number): void }, {
      mounts: [mount], obstacles: [], camera: { position: new THREE.Vector3(0, 30, 40) }, soundManager: audio,
      player: { currentMount: mount, dead: true }, pickupPromptEl: { classList: { remove: vi.fn() } },
    })
    game._updateInteractions(.016)
    expect(audio.updateEagleWingbeats).toHaveBeenLastCalledWith([{ id: mount, active: true, lod: 0,
      distance: 50, isPlayer: true, sequence: 8 }])
    mount.dead = true
    game._updateInteractions(.016)
    expect(audio.updateEagleWingbeats.mock.lastCall?.[0][0].active).toBe(false)
  })

  it('Career includes personal and riderless eagles once, then stops them when the real scene dispose entry runs', () => {
    const personal = eagle(), riderless = eagle(), grounded = eagle()
    grounded.isAirborne = false; grounded.eagleVisual.isFlapping = false
    const town = Object.assign(Object.create(TownScene.prototype) as {
      updateCareerHorseAudio(): void; playMissionVoice(cue: 'follow'): void; dispose(): void
    }, {
      profile: { faction: 'roman' }, player: { currentMount: personal }, camera: { position: new THREE.Vector3() },
      defense: { active: false }, mission: { fieldNpcs: [] }, personalSquad: { actors: [{ mount: personal }], mounts: [personal] },
      mounts: [personal, grounded], careerMounts: { activeMount: null }, temporaryMounts: { all: [riderless] },
      // Already-disposed guard isolates the initial cancellation boundary from unrelated DOM teardown.
      disposed: true, cancelPendingSpawns: vi.fn(), flushCareerSkillProgression: vi.fn(),
    })
    town.playMissionVoice('follow') // Initialize the same shared SoundManager used by the real Career caller.
    town.updateCareerHorseAudio()
    expect(audio.updateEagleWingbeats.mock.lastCall?.[0]).toEqual([
      { id: personal, active: true, lod: 0, distance: 0, isPlayer: true, sequence: 7 },
      { id: grounded, active: false, lod: 0, distance: 0, isPlayer: false, sequence: 7 },
      { id: riderless, active: true, lod: 0, distance: 0, isPlayer: false, sequence: 7 },
    ])
    town.dispose()
    expect(audio.updateEagleWingbeats).toHaveBeenLastCalledWith([])
  })
})
