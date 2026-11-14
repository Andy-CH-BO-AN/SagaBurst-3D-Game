import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { CareerArenaSession } from '../../src/arena/CareerArenaSession'
import { SkillManager } from '../../src/rpg/SkillManager'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ARENA_TRIAL_DEFINITIONS, ARENA_TRIAL_TIERS, ARENA_TRIAL_TIME_LIMIT_SECONDS, arenaTrialBlocker, arenaTrialRestorablePlan, arenaTrialRoster,
  acceptArenaStoryTrial, arenaTrialTeamSizes, arenaTrialUnitSpec, createArenaTrialMission, resolveArenaTrialEnd, type ArenaTrialTier,
} from '../../src/career/CareerArenaTrials'
import { claimCareerMission, createCareerProfile, promoteCareer, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { assignArenaTrialSlots, planArenaTrialFormation } from '../../src/arena/ArenaTrialFormation'
import { createColosseumObstacles } from '../../src/arena/ColosseumLayout'
import { createValhallaObstacles } from '../../src/arena/ValhallaLayout'
import { Faction } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'
import { PlayerInput } from '../../src/player/PlayerInput'

const stats = { damageDealt: 400, damageTaken: 10, kills: 3, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }

function profileAt(rank: CareerProfile['rank']): CareerProfile {
  let profile = createCareerProfile('roman')
  profile.totalMerit = profile.availableMerit = 80000
  while (profile.rank !== rank) profile = promoteCareer(profile)!
  return profile
}

/** Exercises the actual scene input and phase methods without constructing a rendered scene. */
function openingHarness(search: string, seconds: number, prison = false) {
  const win = Object.assign(new EventTarget(), { location: { search } })
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as EventTarget | null })
  const canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn(() => Promise.reject(new Error('denied'))) })
  vi.stubGlobal('window', win); vi.stubGlobal('location', win.location); vi.stubGlobal('document', doc)
  const input = new PlayerInput(), listeners = new AbortController()
  onTestFinished(() => { listeners.abort(); input.dispose(); vi.unstubAllGlobals() })
  const attack = vi.fn(), save = vi.fn(), checkpoint = vi.fn(), openingHud = { update: vi.fn() }
  const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
    bindInput(): void; advancePhase(dt: number): void; phase: string; countdownRemaining: number
  }, {
    renderer: { domElement: canvas }, input, listeners, camera: {}, sound: { unlockAudio() {} },
    openingHud, started: true, panel: null, localProfile: { activeMission: prison ? { prisonBreak: {} } : {} },
    phase: 'waiting', countdownRemaining: seconds, resumeGrace: prison, pickupRetry: null,
    player: { dead: prison }, bodies: [{ npc: { dead: false, setTacticalOrder: attack } }],
    resolvePrisonResult: () => false, checkpointFight: checkpoint, persistProgress: save, saveProgressWithRetry: save,
  })
  scene.bindInput()
  return { scene, input, canvas, win, doc, attack, save, checkpoint, openingHud }
}

describe('Arena Squad Trials', () => {
  it('waits for actual pointer lock and starts fighting only after the full opening countdown', () => {
    const h = openingHarness('', 5)
    h.scene.advancePhase(8)
    h.canvas.dispatchEvent(new Event('click')) // A rejected request must not start the clock.
    h.scene.advancePhase(8)
    expect(h.canvas.requestPointerLock).toHaveBeenCalledOnce()
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['waiting', 5])
    h.doc.pointerLockElement = new EventTarget(); h.doc.dispatchEvent(new Event('pointerlockchange'))
    expect(h.scene.phase).toBe('waiting') // Lock held by a different element is not control of this arena.
    h.canvas.dispatchEvent(new Event('click'))
    expect(h.canvas.requestPointerLock).toHaveBeenCalledTimes(2)
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['countdown', 5])
    h.scene.advancePhase(1)
    expect(h.scene.countdownRemaining).toBe(4)
    h.doc.pointerLockElement = null; h.doc.dispatchEvent(new Event('pointerlockchange'))
    expect(h.scene.phase).toBe('paused')
    expect(h.openingHud.update).toHaveBeenLastCalledWith('paused', 4)
    h.scene.advancePhase(8)
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['paused', 4])
    expect(h.attack).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled()
    h.canvas.dispatchEvent(new Event('click')) // Another rejected lock does not consume the remaining seconds.
    h.scene.advancePhase(8)
    expect(h.scene.countdownRemaining).toBe(4)
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['countdown', 4])
    h.scene.advancePhase(1)
    expect(h.scene.countdownRemaining).toBe(3)
    h.doc.pointerLockElement = new EventTarget() // Recheck the canvas even before a change event arrives.
    h.scene.advancePhase(8)
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['paused', 3])
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    for (const expected of [2, 1]) { h.scene.advancePhase(1); expect(Math.ceil(h.scene.countdownRemaining)).toBe(expected) }
    expect(h.attack).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled()
    h.scene.advancePhase(1)
    expect(h.scene.phase).toBe('fight')
    expect(h.attack).toHaveBeenCalledOnce(); expect(h.save).toHaveBeenCalledOnce()
    h.doc.pointerLockElement = null; h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.canvas.dispatchEvent(new Event('click'))
    expect(h.scene.phase).toBe('fight')
  })

  it('keeps a prison resume countdown paused after a checkpoint save fails and is retried', () => {
    const h = openingHarness('', 3, true)
    let retry: () => void = () => { throw new Error('retry not installed') }
    Object.assign(h.doc, { exitPointerLock() { h.doc.pointerLockElement = null; h.doc.dispatchEvent(new Event('pointerlockchange')) } })
    Object.assign(h.scene, {
      knocked: new Set(), player: { dead: true, hp: 0, isGrounded: true, currentMount: null },
      lastPlayerSignature: 'true|0', checkpointClock: 0,
      clearPickupFocus() {}, openPanel() { Object.assign(h.scene, { panel: {} }) },
      closePanel() { Object.assign(h.scene, { panel: null }) },
      button(_label: string, action: () => void) { retry = action },
    })
    Reflect.deleteProperty(h.scene, 'checkpointFight')
    Reflect.deleteProperty(h.scene, 'saveProgressWithRetry')
    h.save.mockReturnValueOnce(false).mockReturnValue(true)
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.scene.advancePhase(1)
    expect(h.scene.countdownRemaining).toBe(2)
    h.scene.advancePhase(1) // The real checkpoint caller fails its save and opens the retry panel.
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['paused', 2])
    expect(h.save).toHaveBeenCalledTimes(1)
    retry()
    expect(h.save).toHaveBeenCalledTimes(2)
    h.scene.advancePhase(8)
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['paused', 2])
    expect(h.attack).not.toHaveBeenCalled()
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.scene.advancePhase(1.9)
    expect(h.scene.phase).toBe('countdown'); expect(h.attack).not.toHaveBeenCalled()
    h.scene.advancePhase(0.11)
    expect(h.scene.phase).toBe('fight'); expect(h.attack).toHaveBeenCalledOnce()
  })

  it('starts a fallen prisoner’s restored three-second grace in nolock without passing the click to combat', () => {
    const h = openingHarness('?nolock', 3, true)
    h.scene.advancePhase(8)
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['waiting', 3])
    expect(h.checkpoint).toHaveBeenCalled() // Waiting does not remove the existing resume checkpoint path.
    h.win.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }))
    h.canvas.dispatchEvent(new Event('click'))
    expect(h.input.consumeLeftClick()).toBe(false)
    expect(h.input.isLeftMouseDown).toBe(false)
    expect([h.scene.phase, h.scene.countdownRemaining]).toEqual(['countdown', 3])
    h.scene.advancePhase(2.9)
    expect(h.scene.phase).toBe('countdown'); expect(h.attack).not.toHaveBeenCalled()
    h.scene.advancePhase(0.11)
    expect(h.scene.phase).toBe('fight'); expect(h.attack).toHaveBeenCalledOnce()
    expect(h.save).toHaveBeenCalledOnce()
    h.canvas.dispatchEvent(new Event('click'))
    expect(h.scene.phase).toBe('fight')
  })

  it('fields the five agreed team sizes with same-culture bodies split only by team allegiance', () => {
    expect(ARENA_TRIAL_TIERS.map(tier => arenaTrialTeamSizes(tier))).toEqual([
      { friendly: 20, enemy: 15 }, { friendly: 20, enemy: 15 }, { friendly: 12, enemy: 20 }, { friendly: 20, enemy: 10 }, { friendly: 8, enemy: 20 }])
    for (const tier of ARENA_TRIAL_TIERS) for (const entry of arenaTrialRoster('m', tier)) {
      const spec = arenaTrialUnitSpec(entry.actorId, 'viking', entry.team === 'friendly' ? Faction.PLAYER : Faction.ENEMY, entry.group)
      expect([spec.faction, spec.characterFaction, spec.characterTier, spec.cavalry, spec.loadout?.mountId]).toEqual([
        entry.team === 'friendly' ? Faction.PLAYER : Faction.ENEMY, 'viking', entry.group.tier, false, null])
      if (entry.group.tier >= 4) expect(spec.visualAssetId).toBeDefined()
    }
    const heavyT5 = arenaTrialUnitSpec('x', 'roman', Faction.ENEMY, ARENA_TRIAL_DEFINITIONS[4].enemy[0])
    expect(heavyT5.visualAssetId).toBe('byzantine-cataphract-t5')
  })

  it('lays out every team on both arenas with legal, separate slots and archers behind the melee ranks', () => {
    for (const [arenaId, obstacles] of [['roman-colosseum', createColosseumObstacles()], ['viking-valhalla', createValhallaObstacles()]] as const) {
      const formation = planArenaTrialFormation(arenaId, obstacles, 19, 20)!
      expect(formation).not.toBeNull()
      const all = [formation.player, ...formation.friendly, ...formation.enemy]
      let closest = Infinity
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
        closest = Math.min(closest, Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z))
      expect(closest, arenaId).toBeGreaterThan(2)
      expect(Math.min(...formation.enemy.map(s => s.z)) - Math.max(...formation.friendly.map(s => s.z))).toBeGreaterThan(8)
      const roster = arenaTrialRoster('m', 1)
      const slots = assignArenaTrialSlots(roster, planArenaTrialFormation(arenaId, obstacles, 19, 15)!)
      const frontZ = (role: string) => Math.max(...roster.filter(e => e.team === 'friendly' && e.group.role === role).map(e => slots.get(e.actorId)!.z))
      expect(frontZ('archer')).toBeLessThan(frontZ('melee'))
    }
  })

  it('restores the original actor identities and knockouts in an already accepted pre-rebalance trial', () => {
    const profile = profileAt('commander')
    const mission = createArenaTrialMission(profile, 5, 'viking-valhalla', 'legacy-trial')!
    mission.friendlyActorIds = Array.from({ length: 4 }, (_, i) => `legacy-trial:friendly:${i}`)
    delete mission.arenaTrial!.rosterVersion
    Object.assign(mission.arenaTrial!, { stage: 'engaged', combatElapsed: 12, actors: {
      'legacy-trial:friendly:2': { status: 'knocked', hp: 0, x: 1, z: 2, yaw: 0 },
    } })
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save({ ...profile, activeMission: mission })).toBe(true)
    const restored = store.load()!.activeMission!, state = restored.arenaTrial!
    expect(restored.friendlyActorIds).toEqual(mission.friendlyActorIds)
    expect(state.rosterVersion).toBeUndefined()
    const friendly = arenaTrialRoster(restored.id, 5, state.rosterVersion ?? 1).filter(entry => entry.team === 'friendly')
    expect(friendly.map(entry => Boolean(entry.group.heavy))).toEqual([true, true, false, false])
    expect(arenaTrialRestorablePlan(restored, state).map(entry => entry.actorId)).not.toContain('legacy-trial:friendly:2')
  })

  it('ends only when a team is out: a fallen player alone does not lose while a friendly body stands', () => {
    expect(resolveArenaTrialEnd({ friendlyActive: 3, enemyActive: 4, playerKnocked: true }, 30)).toBeNull()
    expect(resolveArenaTrialEnd({ friendlyActive: 0, enemyActive: 4, playerKnocked: false }, 30)).toBeNull()
    expect(resolveArenaTrialEnd({ friendlyActive: 3, enemyActive: 0, playerKnocked: true }, 30)).toEqual({ outcome: 'victory' })
    // The loss keeps its reason, so a timeout with fighters standing is never reported as elimination.
    expect(resolveArenaTrialEnd({ friendlyActive: 3, enemyActive: 2, playerKnocked: false }, ARENA_TRIAL_TIME_LIMIT_SECONDS)).toEqual({ outcome: 'failure', reason: 'timeout' })
    expect(resolveArenaTrialEnd({ friendlyActive: 0, enemyActive: 2, playerKnocked: true }, 30)).toEqual({ outcome: 'failure', reason: 'eliminated' })
    expect(resolveArenaTrialEnd({ friendlyActive: 0, enemyActive: 0, playerKnocked: true }, 30)).toEqual({ outcome: 'victory' })
  })

  it('gates acceptance by rank, and a mid-fight save restores only the standing actors', () => {
    expect(createArenaTrialMission(profileAt('recruit'), 2, 'roman-colosseum')).toBeNull()
    expect(arenaTrialBlocker({ ...profileAt('captain'), activeMission: createArenaTrialMission(profileAt('captain'), 4, 'roman-colosseum')! }, 1)).not.toBeNull()
    const profile = profileAt('commander')
    const mission = createArenaTrialMission(profile, 5, 'viking-valhalla', 'trial-fixed')!
    const [downFriend, downEnemy] = [mission.friendlyActorIds[0], mission.targetActorIds[0]]
    mission.arenaTrial = { ...mission.arenaTrial!, stage: 'engaged', combatElapsed: 12, actors: {
      [downFriend]: { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }, [downEnemy]: { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 },
      [mission.targetActorIds[1]]: { status: 'active', hp: 77, x: 3, z: 4, yaw: 1 } },
    player: { knocked: true, hp: 0, stamina: 50, x: 1, z: -14, yaw: 0 } }
    const storage = new MemoryStorage()
    const store = new CareerProfileStore(storage)
    expect(store.save({ ...profile, activeMission: mission })).toBe(true)
    const restored = store.load()!.activeMission!
    const plan = arenaTrialRestorablePlan(restored, restored.arenaTrial!)
    expect(plan.map(entry => entry.actorId)).not.toContain(downFriend)
    expect(plan.map(entry => entry.actorId)).not.toContain(downEnemy)
    expect(plan).toHaveLength(mission.friendlyActorIds.length + mission.targetActorIds.length - 2)
    expect(plan.find(entry => entry.actorId === mission.targetActorIds[1])?.saved).toMatchObject({ hp: 77, x: 3 })
    expect(restored.arenaTrial?.player?.knocked).toBe(true)
    const settled = { ...restored, arenaTrial: { ...restored.arenaTrial!, endReason: 'timeout' as const } }
    expect(store.save({ ...profile, activeMission: settled })).toBe(true)
    expect(store.load()!.activeMission!.arenaTrial!.endReason).toBe('timeout')
    const tampered = JSON.parse(storage.getItem('sagaburst_career_v1')!)
    tampered.activeMission.arenaTrial.actors['not-in-roster'] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }
    storage.setItem('sagaburst_career_v1', JSON.stringify(tampered))
    expect(store.load()?.activeMission).toBeUndefined()
  })

  it('saves height, ammo and shield durability exactly, keeping zero as spent and older saves loadable', () => {
    const profile = profileAt('commander')
    const mission = createArenaTrialMission(profile, 5, 'viking-valhalla', 'trial-gear')!
    const [archer] = mission.friendlyActorIds
    mission.arenaTrial = { ...mission.arenaTrial!, stage: 'engaged', combatElapsed: 5, actors: {
      [archer]: { status: 'active', hp: 40, x: 8, z: -20, yaw: 1, y: 5.5, ammo: 0, shieldImpact: 0 },
      [mission.friendlyActorIds[1]]: { status: 'active', hp: 90, x: 1, z: -20, yaw: 0 } },
    player: { knocked: false, hp: 33, stamina: 20, x: 0, z: -14, yaw: 0, y: 3.95, ammo: 0, shieldImpact: 0, shieldDurability: { shield_a: 0, shield_b: 12 },
      fall: { velocityY: -12.5, grounded: false, apexY: 17.9 } } }
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save({ ...profile, activeMission: mission })).toBe(true)
    const restored = store.load()!.activeMission!.arenaTrial!
    expect(restored.actors[archer]).toMatchObject({ y: 5.5, ammo: 0, shieldImpact: 0 })
    expect(restored.actors[mission.friendlyActorIds[1]]).not.toHaveProperty('ammo')
    expect(restored.player).toMatchObject({ y: 3.95, ammo: 0, shieldImpact: 0, shieldDurability: { shield_a: 0, shield_b: 12 } })
    expect(restored.player?.fall).toEqual({ velocityY: -12.5, grounded: false, apexY: 17.9 })
    const bad = JSON.parse(storage.getItem('sagaburst_career_v1')!)
    bad.activeMission.arenaTrial.player.fall.grounded = 'no'
    storage.setItem('sagaburst_career_v1', JSON.stringify(bad))
    expect(store.load()?.activeMission).toBeUndefined()
    bad.activeMission.arenaTrial.player.fall.grounded = false
    bad.activeMission.arenaTrial.player.ammo = -1
    storage.setItem('sagaburst_career_v1', JSON.stringify(bad))
    expect(store.load()?.activeMission).toBeUndefined()
  })

  it('settles once with normal merit and leaves formal progress, duel progress and death counts untouched', () => {
    const profile = profileAt('captain')
    const mission = createArenaTrialMission(profile, 4, 'roman-colosseum', 'trial-claim')!
    const before = { ...profile, activeMission: mission }
    const first = claimCareerMission(before, mission.id, 'victory', stats)
    expect(first.meritAwarded).toBeGreaterThan(0)
    expect(first.profile.totalMerit).toBe(profile.totalMerit + first.meritAwarded)
    expect(first.profile.lifetimeStats.deaths).toBe(profile.lifetimeStats.deaths)
    expect(first.profile.duelHighestDefeatedTierByPreset).toEqual(profile.duelHighestDefeatedTierByPreset)
    expect(first.profile.completedCareerMissionTemplateIds).toEqual(profile.completedCareerMissionTemplateIds)
    expect(first.profile.careerMissionCompletionsByTier).toEqual(profile.careerMissionCompletionsByTier)
    const again = claimCareerMission(first.profile, mission.id, 'victory', stats)
    expect(again).toMatchObject({ alreadyClaimed: true, meritAwarded: 0 })
    expect(again.profile.totalMerit).toBe(first.profile.totalMerit)
    expect(arenaTrialBlocker(profileAt('commander'), 5 as ArenaTrialTier)).toBeNull()
  })

  it('settles the veteran invitation at a fixed 1,000 or 100 in the same claim, once, and leaves ordinary trials and formal counts alone', () => {
    const base = profileAt('recruit')
    base.careerStory = { version: 1, events: { 'veteran-squad-spar': { status: 'pending' } } }
    const ordinary = { ...base, activeMission: createArenaTrialMission(base, 1, 'roman-colosseum', 'plain')! }
    const plain = claimCareerMission(ordinary, 'plain', 'victory', stats)
    expect(plain.meritAwarded).not.toBe(1000)
    expect(plain.profile.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'pending' })
    const accepted = acceptArenaStoryTrial(base, 'viking-valhalla', 'spar')!
    expect(accepted.activeMission).toMatchObject({ templateId: 'career-arena-trial-t1', arenaTrial: { tier: 1, arenaId: 'viking-valhalla' } })
    expect(accepted.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'active', sourceId: 'spar' })
    expect(acceptArenaStoryTrial(accepted, 'roman-colosseum', 'again')).toBeNull()
    const win = claimCareerMission(accepted, 'spar', 'victory', stats)
    expect(win.meritAwarded).toBe(1000)
    expect(win.profile.activeMission!.result!.merit).toEqual({ damage: 0, kills: 0, contribution: 1000, total: 1000 })
    expect([win.profile.totalMerit, win.profile.availableMerit]).toEqual([base.totalMerit + 1000, base.availableMerit + 1000])
    expect(win.profile.careerMissionCompletions).toBeUndefined()
    expect(win.profile.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'settled', sourceId: 'spar', outcome: 'victory', merit: 1000 })
    expect(claimCareerMission(win.profile, 'spar', 'victory', stats)).toMatchObject({ alreadyClaimed: true, meritAwarded: 0 })
    const loss = claimCareerMission(accepted, 'spar', 'failure', { ...stats, survived: false })
    expect(loss.meritAwarded).toBe(100)
    expect([loss.profile.totalMerit, loss.profile.availableMerit]).toEqual([base.totalMerit + 100, base.availableMerit + 100])
    expect(loss.profile.lifetimeStats.deaths).toBe(base.lifetimeStats.deaths)
    expect(loss.profile.careerStory!.events['veteran-squad-spar']).toMatchObject({ status: 'settled', outcome: 'defeat', merit: 100 })
  })

  it('正式試煉場景沿共用 Session 凍結保存失敗的結算，重試不換結果也不重發軍功', () => {
    vi.stubGlobal('document', { exitPointerLock() {}, getElementById: () => null })
    onTestFinished(() => { vi.unstubAllGlobals() })
    const profile = profileAt('captain')
    profile.activeMission = createArenaTrialMission(profile, 3, 'roman-colosseum', 'session-trial')!
    const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const result = vi.fn(), live = { ...stats }, capture = vi.fn(() => ({ player: { ...live }, squads: [] }))
    const player = { dead: false, spectatorOnly: false, hp: 100, blockingLevel: 1, clearTownAction() {}, setHp() {}, setMaxHp() {} }
    const session = new CareerArenaSession(profile, { noun: '試煉', store, skills: new SkillManager(), sound: {} as never,
      input: { clear() {} }, player: () => player,
      panel: { isOpen: false, show() {}, button() {}, close() {} }, openResult: result, leave() {} })
    const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as { finish(outcome: 'victory' | 'failure'): void; update(dt: number): void }, {
      session, tracker: { snapshot: capture }, bodies: [], player, disposed: false,
      arena: { update() {} }, damageNumbers: { update() {} }, camera: {},
    })
    storage.failWrites = true
    scene.finish('victory')
    expect(session.pendingSettlement?.player.damageDealt).toBe(400)
    expect(result).not.toHaveBeenCalled()
    scene.update(1 / 60) // The real scene freezes before reaching any player, AI or projectile step.
    live.damageDealt = 2000
    storage.failWrites = false
    scene.finish('failure')
    const saved = store.load()!
    expect(saved.activeMission!.result).toMatchObject({ outcome: 'victory', stats: { damageDealt: 400 } })
    expect(result).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledOnce()
    scene.finish('victory')
    expect(store.load()!.totalMerit).toBe(saved.totalMerit)
  })

})
