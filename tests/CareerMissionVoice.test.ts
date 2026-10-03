import { withMissionCheckpoint } from './helpers/missionCheckpoint'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TownScene } from '../src/town/TownScene'
import { BanditMissionController } from '../src/career/BanditMissionController'
import { createCareerProfile } from '../src/career/CareerProfile'
import { createActiveCareerMission } from '../src/career/CareerMissionState'
import { townRoster } from '../src/town/TownRules'

const audio = vi.hoisted(() => ({ playCareerMissionVoice: vi.fn(), playTownAlarm: vi.fn(async () => true), playCommanderCommand: vi.fn(), cancelCareerAudio: vi.fn() }))
vi.mock('../src/audio/SoundManager', () => ({ SoundManager: class {
  playCareerMissionVoice = audio.playCareerMissionVoice
  playTownAlarm = audio.playTownAlarm
  playCommanderCommand = audio.playCommanderCommand
  cancelCareerAudio = audio.cancelCareerAudio
} }))

function townHarness(faction: 'roman' | 'viking' = 'roman') {
  const town = Object.create(TownScene.prototype) as any
  town.profile = createCareerProfile(faction)
  town.profile.totalMerit = 120; town.profile.careerMissionCompletions = 5
  town.store = { load: () => town.profile }
  town.event = { hostile: false }
  town.player = { dead: false }
  town.residents = townRoster().map(spec => ({ spec }))
  town.commit = vi.fn(next => { town.profile = next; return true })
  town.mission = {
    fieldNpcs: [], friendlies: [{ dead: false }], chooseCamp: () => 0,
    createMission: (template: any) => createActiveCareerMission(template.id, 0, 3, 0, 'voice-test', template.kind),
    startActiveMission: vi.fn(() => true),
    get phase() { return town.profile.activeMission?.phase },
    startReturning: vi.fn(() => { town.profile.activeMission.phase = 'RETURNING'; return true }),
  }
  town.defense = { startActiveMission: vi.fn(() => true) }
  town.inventory = { prepareForCombat: vi.fn() }
  town.careerMounts = { restoreActiveMount: vi.fn() }
  town.openPanel = vi.fn(() => ({})); town.closePanel = vi.fn()
  town.button = vi.fn()
  town.disposed = false
  return town
}

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); audio.playTownAlarm.mockResolvedValue(true) })
afterEach(() => vi.useRealTimers())

describe('Career mission voice events', () => {
  it.each(['veteran-scout-hunters', 'veteran-village-intercept', 'veteran-spear-line-hunt', 'veteran-tragedy-of-the-scouts'])('leaves persisted mounted leader cues to the mission controller for %s', templateId => {
    const town = townHarness()
    town.playMissionVoice('missionAccepted')
    town.profile.activeMission = {
      id: 'veteran-command', templateId, kind: 'veteran-field', phase: 'ENGAGING', targetCampId: 0,
      targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 0,
      chargedSquadIds: [1, 2], followVoicePlayed: true,
    }
    town.careerCommandCue = null

    town.updateCareerCommandCue()
    town.updateCareerCommandCue()

    expect(audio.playCommanderCommand).not.toHaveBeenCalled()
  })

  it.each(['roman', 'viking'] as const)('plays %s accept once after save and start success for both ordinary mission kinds', faction => {
    for (const id of ['recruit-bandits-01', 'recruit-patrol-01']) {
      audio.playCareerMissionVoice.mockClear()
      const town = townHarness(faction)
      town.acceptMission(id); town.acceptMission(id)
      expect(town.commit).toHaveBeenCalledOnce()
      expect(town.mission.startActiveMission).toHaveBeenCalledOnce()
      expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith(faction, 'missionAccepted')
      expect(town.commit.mock.invocationCallOrder[0]).toBeLessThan(town.mission.startActiveMission.mock.invocationCallOrder[0])
      expect(town.mission.startActiveMission.mock.invocationCallOrder[0]).toBeLessThan(audio.playCareerMissionVoice.mock.invocationCallOrder[0])
    }
  })

  it.each(['save', 'start'])('stays silent on ordinary mission %s failure', failure => {
    const town = townHarness()
    if (failure === 'save') town.commit.mockReturnValue(false)
    else town.mission.startActiveMission.mockReturnValue(false)
    town.acceptMission('recruit-bandits-01')
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    expect(audio.playTownAlarm).not.toHaveBeenCalled()
  })

  it.each(['roman', 'viking'] as const)('starts alarm then %s warning only once after Town Defense starts', async faction => {
    let finishAlarm!: (played: boolean) => void
    audio.playTownAlarm.mockReturnValueOnce(new Promise(resolve => { finishAlarm = resolve }))
    const town = townHarness(faction)
    town.acceptMission('recruit-town-defense-01'); town.acceptMission('recruit-town-defense-01')
    expect(town.defense.startActiveMission).toHaveBeenCalledOnce()
    expect(audio.playTownAlarm).toHaveBeenCalledOnce()
    town.careerCommandCue = null
    town.defense.reserveHasCharged = false
    town.updateCareerCommandCue() // First resumed gameplay frame.
    expect(audio.playCommanderCommand).not.toHaveBeenCalled()
    expect(town.defense.startActiveMission.mock.invocationCallOrder[0]).toBeLessThan(audio.playTownAlarm.mock.invocationCallOrder[0])
    expect(audio.playTownAlarm).toHaveBeenCalledWith(true)
    await vi.advanceTimersByTimeAsync(8000)
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    finishAlarm(true)
    await Promise.resolve()
    expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith(faction, 'townDefense')
    town.profile.activeMission.phase = 'ATTACKING'
    town.updateCareerCommandCue()
    expect(audio.playCommanderCommand).not.toHaveBeenCalled()
    town.defense.reserveHasCharged = true // First effective military hit.
    town.updateCareerCommandCue(); town.updateCareerCommandCue()
    expect(audio.playCommanderCommand).toHaveBeenCalledExactlyOnceWith(faction, 'charge')
  })

  it.each(['save', 'start'])('stays silent on Town Defense %s failure', async failure => {
    const town = townHarness()
    if (failure === 'save') town.commit.mockReturnValue(false)
    else town.defense.startActiveMission.mockReturnValue(false)
    town.acceptMission('recruit-town-defense-01')
    await vi.runAllTimersAsync()
    expect(audio.playTownAlarm).not.toHaveBeenCalled()
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })

  it('waits for alarm completion rather than a guessed timer, including slow lazy loading', async () => {
    let finishAlarm!: (played: boolean) => void
    audio.playTownAlarm.mockReturnValueOnce(new Promise(resolve => { finishAlarm = resolve }))
    const town = townHarness()
    town.acceptMission('recruit-town-defense-01')
    await vi.advanceTimersByTimeAsync(20000)
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
    finishAlarm(true)
    await Promise.resolve()
    expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith('roman', 'townDefense')
  })

  it.each(['disposed', 'settled'])('discards a delayed warning after the scene is %s', async state => {
    let finishAlarm!: (played: boolean) => void
    audio.playTownAlarm.mockReturnValueOnce(new Promise(resolve => { finishAlarm = resolve }))
    const town = townHarness()
    town.acceptMission('recruit-town-defense-01')
    if (state === 'disposed') town.disposed = true
    else delete town.profile.activeMission
    finishAlarm(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })

  it('does not announce a cancelled or unavailable alarm sequence', async () => {
    audio.playTownAlarm.mockResolvedValueOnce(false)
    const town = townHarness()
    town.acceptMission('recruit-town-defense-01')
    await Promise.resolve()
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })

  it.each(['MARCHING', 'PREPARING'])('restores %s without replaying opening speech or alarm', phase => {
    const town = townHarness()
    town.profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    town.profile.activeMission.phase = phase
    town.profile.activeMission.kind = phase === 'PREPARING' ? 'town-defense' : 'bandit'
    town.restoreActiveCareerMission()
    expect((phase === 'PREPARING' ? town.defense : town.mission).startActiveMission).toHaveBeenCalledOnce()
    expect(audio.playTownAlarm).not.toHaveBeenCalled()
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })

  it('cancels old mission audio only after a successful identity-changing save', () => {
    const town = townHarness()
    // Instantiate the same shared audio dependency used by the real scene.
    town.playMissionVoice('missionAccepted')
    town.store.save = vi.fn(() => true)
    town.skills = { skillState: town.profile.skills }
    town.careerSkillSaveTimer = null
    const commit = (TownScene.prototype as any).commit.bind(town)
    const next = { ...town.profile, activeMission: createActiveCareerMission('recruit-bandits-01', 0, 3, 0) }
    town.store.save.mockReturnValueOnce(false)
    expect(commit(next)).toBe(false)
    expect(audio.cancelCareerAudio).not.toHaveBeenCalled()
    expect(commit(next)).toBe(true)
    expect(audio.cancelCareerAudio).toHaveBeenCalledOnce()
    audio.cancelCareerAudio.mockClear()
    expect(commit({ ...next, activeMission: { ...next.activeMission, phase: 'MARCHING' } })).toBe(true)
    expect(audio.cancelCareerAudio).not.toHaveBeenCalled()
    expect(commit({ ...town.profile, activeMission: undefined })).toBe(true)
    expect(audio.cancelCareerAudio).toHaveBeenCalledOnce()
  })

  it.each(['living', 'dead', 'save-failed'])('physical return is voiced only for a living party on success: %s', state => {
    const town = townHarness('viking')
    town.profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
    town.profile.activeMission.phase = 'RESULT'
    town.mission.friendlies = [{ dead: state === 'dead' }]
    if (state === 'save-failed') town.mission.startReturning.mockReturnValue(false)
    const callbacks = new Map<string, () => void>()
    town.button = (_panel: unknown, label: string, callback: () => void) => callbacks.set(label, callback)
    town.openMissionResult({ outcome: 'victory', stats: { survived: true, damageDealt: 20, kills: 1 }, merit: { total: 3 } }, false)
    const returnAction = callbacks.get(state === 'dead' ? '自行走回小鎮' : '跟隊伍走回去')!
    returnAction()
    if (state === 'living') {
      returnAction()
      expect(town.mission.startReturning).toHaveBeenCalledOnce()
      expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith('viking', 'return')
    } else expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })
})

function marchHarness(phase = 'ASSEMBLING', save = true) {
  let profile = createCareerProfile('roman')
  profile.activeMission = createActiveCareerMission('recruit-bandits-01', 0, 3, 0)
  profile.activeMission.phase = phase as any
  const c = withMissionCheckpoint(Object.create(BanditMissionController.prototype)) as any
  const leader = { dead: false, combatPosition: new THREE.Vector3(), setTacticalOrder: vi.fn() }
  c.readProfile = () => profile
  c.commit = vi.fn(next => { if (save) profile = next; return save })
  c.player = () => ({ combatPosition: new THREE.Vector3() })
  c.camps = [{ center: new THREE.Vector3(150, 0, 150), ambient: [], mission: [] }]
  c.friendlies = [leader]; c.leader = leader
  c.route = []; c.routeIndex = 0; c.perceptionElapsed = 0
  c.guide = { update: vi.fn() }; c.tracker = null
  c.detectCampProximity = vi.fn(); c.persistRuntimeProgress = vi.fn(); c.advanceRoute = vi.fn()
  c.marchTarget = () => c.camps[0].center
  c.assignLeader = vi.fn(); c.assignFollowers = vi.fn()
  c.onMarchStarted = vi.fn(() => audio.playCareerMissionVoice(profile.faction, 'follow'))
  return c
}

describe('Captain march transition', () => {
  it('speaks once after a saved ASSEMBLING -> MARCHING transition', () => {
    const c = marchHarness()
    c.updateFlow(.016, 0); c.updateFlow(.016, 0)
    expect(c.phase).toBe('MARCHING')
    expect(audio.playCareerMissionVoice).toHaveBeenCalledExactlyOnceWith('roman', 'follow')
    expect(c.commit.mock.invocationCallOrder[0]).toBeLessThan(audio.playCareerMissionVoice.mock.invocationCallOrder[0])
  })
  it('does not speak when the phase save fails', () => {
    const c = marchHarness('ASSEMBLING', false)
    c.updateFlow(.016, 0)
    expect(c.phase).toBe('ASSEMBLING')
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })
  it('does not announce follow for an already marching reload', () => {
    const c = marchHarness('MARCHING')
    c.updateFlow(.016, 0); c.updateFlow(.016, 0)
    expect(audio.playCareerMissionVoice).not.toHaveBeenCalled()
  })
})
