import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { CareerArenaSession } from '../../src/arena/CareerArenaSession'
import { SkillManager } from '../../src/rpg/SkillManager'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { ARENA_TRIAL_DEFINITIONS, ARENA_TRIAL_TIERS, ARENA_TRIAL_TIME_LIMIT_SECONDS, arenaTrialBlocker, arenaTrialRestorablePlan, arenaTrialRoster, acceptArenaStoryTrial, arenaTrialTeamSizes, arenaTrialUnitSpec, createArenaTrialMission, resolveArenaTrialEnd, type ArenaTrialTier } from '../../src/career/CareerArenaTrials'
import { claimCareerMission, createCareerProfile, promoteCareer, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { assignArenaTrialSlots, planArenaTrialFormation } from '../../src/arena/ArenaTrialFormation'
import { createColosseumObstacles } from '../../src/arena/ColosseumLayout'
import { createValhallaObstacles } from '../../src/arena/ValhallaLayout'
import { Faction } from '../../src/world/NPC'
import { MemoryStorage } from '../helpers/memoryStorage'
import { PlayerInput } from '../../src/player/PlayerInput'
import { ArenaOpeningGate, type ArenaOpeningHost } from '../../src/arena/ArenaOpeningGate'

// Replace only the rendered panel; arena input, menu listeners and countdown decisions remain real.
vi.mock('../../src/ui/EquipmentUI', () => ({ EquipmentUI: class {
  visible = false
  open() { this.visible = true }
  close() { this.visible = false }
} }))

const stats = { damageDealt: 400, damageTaken: 10, kills: 3, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }

function profileAt(rank: CareerProfile['rank']): CareerProfile {
  let profile = createCareerProfile('roman')
  profile.totalMerit = profile.availableMerit = 80000
  while (profile.rank !== rank) profile = promoteCareer(profile)!
  return profile
}

/**
 * Thin scene caller for the opening gate: the real bindInput listeners and advancePhase hand the pointer-lock events
 * and frames to the gate, and the real checkpoint caller pauses the countdown on a refused prison save.
 */
function prisonOpeningHarness(seconds: number) {
  const win = Object.assign(new EventTarget(), { location: { search: '' } })
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as EventTarget | null })
  const canvas = Object.assign(new EventTarget(), { requestPointerLock: vi.fn(() => Promise.reject(new Error('denied'))) })
  vi.stubGlobal('window', win); vi.stubGlobal('location', win.location); vi.stubGlobal('document', doc)
  const input = new PlayerInput(), listeners = new AbortController()
  const attack = vi.fn(), save = vi.fn()
  const scene = Object.assign(Object.create(CareerArenaCombatScene.prototype) as {
    bindInput(): void; advancePhase(dt: number): void; opening: ArenaOpeningGate; openingHost(): ArenaOpeningHost
  }, {
    renderer: { domElement: canvas }, input, listeners, camera: {}, sound: { unlockAudio() {} },
    openingHud: { update() {} }, started: true, panel: null, localProfile: { activeMission: { prisonBreak: {} } },
    resumeGrace: true, pickupRetry: null, player: { dead: true }, bodies: [{ npc: { dead: false, setTacticalOrder: attack } }],
    persistProgress: save, encounter: { resolveResult: () => false, clearPickupFocus() {}, settlementPending: false },
  })
  scene.opening = new ArenaOpeningGate(scene.openingHost(), seconds)
  onTestFinished(() => { listeners.abort(); input.dispose(); vi.unstubAllGlobals() })
  scene.bindInput()
  return { scene, canvas, doc, attack, save, win, input }
}

/** The gate is driven through a host double that obeys the real pointer-lock rule: only a lock held by this canvas counts. */
function gateHarness(seconds: number, lockOptional = false, input?: PlayerInput) {
  const state = { lockedBy: null as 'canvas' | 'other' | null, retryPending: false, guest: false }
  const record = { lockRequests: 0, gestures: 0, clears: 0, fightStarts: 0, held: [] as number[], rendered: [] as [string, number][] }
  const host: ArenaOpeningHost = {
    isGuest: () => state.guest, blocked: () => false, lockOptional: () => lockOptional,
    hasPointerLock: () => state.lockedBy === 'canvas',
    requestPointerLock: () => { record.lockRequests++ }, unlockAudio() {},
    clearInput: () => { record.clears++ }, consumeLeftGesture: () => { record.gestures++; input?.consumeLeftGesture() }, resetClock() {},
    render: (phase, remaining) => { record.rendered.push([phase, remaining]) },
    holdOpening: dt => { record.held.push(dt); return state.retryPending },
    fightStarted: () => { record.fightStarts++ },
  }
  const gate = new ArenaOpeningGate(host, seconds)
  const lock = (lockedBy: 'canvas' | 'other' | null) => { state.lockedBy = lockedBy; gate.lockChanged() }
  return { gate, state, record, lock }
}

describe('Arena Squad Trials', () => {
  it('waits for actual pointer lock and starts fighting only after the full opening countdown', () => {
    const h = gateHarness(5)
    h.gate.advance(8)
    h.gate.click() // A rejected request must not start the clock.
    h.gate.advance(8)
    expect(h.record.lockRequests).toBe(1)
    expect([h.gate.phase, h.gate.remaining]).toEqual(['waiting', 5])
    h.lock('other')
    expect(h.gate.phase).toBe('waiting') // Lock held by a different element is not control of this arena.
    h.gate.click()
    expect(h.record.lockRequests).toBe(2)
    h.lock('canvas')
    expect([h.gate.phase, h.gate.remaining]).toEqual(['countdown', 5])
    h.gate.advance(1)
    expect(h.gate.remaining).toBe(4)
    h.lock(null)
    expect(h.gate.phase).toBe('paused')
    expect(h.record.rendered.at(-1)).toEqual(['paused', 4])
    h.gate.advance(8)
    expect([h.gate.phase, h.gate.remaining]).toEqual(['paused', 4])
    h.gate.click() // Another rejected lock does not consume the remaining seconds.
    h.gate.advance(8)
    expect(h.gate.remaining).toBe(4)
    h.lock('canvas')
    expect([h.gate.phase, h.gate.remaining]).toEqual(['countdown', 4])
    h.gate.advance(1)
    expect(h.gate.remaining).toBe(3)
    h.state.lockedBy = 'other' // Recheck the canvas even before a change event arrives.
    h.gate.advance(8)
    expect([h.gate.phase, h.gate.remaining]).toEqual(['paused', 3])
    h.lock('canvas')
    for (const expected of [2, 1]) { h.gate.advance(1); expect(Math.ceil(h.gate.remaining)).toBe(expected) }
    expect(h.record.fightStarts).toBe(0)
    h.gate.advance(1)
    expect(h.gate.phase).toBe('fight')
    expect(h.record.fightStarts).toBe(1)
    h.lock(null)
    h.gate.click()
    expect(h.gate.phase).toBe('fight')
    expect(h.record.fightStarts).toBe(1)
  })

  it('opens in ?nolock on the click that also belongs to the opening, and a pending save retry holds the countdown', () => {
    const win = Object.assign(new EventTarget(), { location: { search: '?nolock' } })
    vi.stubGlobal('window', win); vi.stubGlobal('document', new EventTarget())
    const input = new PlayerInput()
    onTestFinished(() => { input.dispose(); vi.unstubAllGlobals() })
    const h = gateHarness(3, true, input)
    h.gate.advance(8)
    expect([h.gate.phase, h.gate.remaining]).toEqual(['waiting', 3])
    expect(h.record.held).toEqual([8]) // Waiting still gives the host its resume-checkpoint turn.
    win.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }))
    expect(input.isLeftMouseDown).toBe(true)
    h.gate.click()
    expect(input.consumeLeftClick()).toBe(false) // The opening click must not start an attack.
    expect(input.isLeftMouseDown).toBe(false)
    expect(h.record.gestures).toBe(1)
    expect(h.record.lockRequests).toBe(0)
    expect([h.gate.phase, h.gate.remaining]).toEqual(['countdown', 3])
    h.state.retryPending = true
    h.gate.advance(8)
    expect(h.gate.remaining).toBe(3)
    h.state.retryPending = false
    h.gate.advance(2.9)
    expect(h.gate.phase).toBe('countdown'); expect(h.record.fightStarts).toBe(0)
    h.gate.advance(0.11)
    expect(h.gate.phase).toBe('fight'); expect(h.record.fightStarts).toBe(1)
    h.gate.click()
    expect(h.gate.phase).toBe('fight')
    expect(h.record.lockRequests).toBe(0)
  })

  it('advances a prison resume countdown to live combat without auto-saving mid-countdown', () => {
    const h = prisonOpeningHarness(3)
    h.doc.pointerLockElement = new EventTarget() // Input counts as locked, but not by this arena's canvas.
    h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.win.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0 }))
    expect(h.input.isLeftMouseDown).toBe(true)
    h.canvas.dispatchEvent(new Event('click')) // The opening click is the opening's, not an attack.
    expect(h.input.isLeftMouseDown).toBe(false)
    h.doc.pointerLockElement = null; h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.doc.pointerLockElement = h.canvas; h.doc.dispatchEvent(new Event('pointerlockchange'))
    h.scene.advancePhase(1)
    expect(h.scene.opening.remaining).toBe(2)
    h.scene.advancePhase(1)
    expect([h.scene.opening.phase, h.scene.opening.remaining]).toEqual(['countdown', 1])
    expect(h.attack).not.toHaveBeenCalled()
    expect(h.save).not.toHaveBeenCalled()
    h.scene.advancePhase(1.1)
    expect(h.scene.opening.phase).toBe('fight')
    expect(h.attack).toHaveBeenCalledOnce()
    expect(h.save).not.toHaveBeenCalled()
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

  it('fits trial deployment capacity in both arenas and places Recruit archers behind melee', () => {
    const roster = arenaTrialRoster('m', 1)
    const friendly = roster.filter(entry => entry.team === 'friendly')
    const enemy = roster.filter(entry => entry.team === 'enemy')
    const teamSizes = ARENA_TRIAL_TIERS.map(arenaTrialTeamSizes)
    const maxFriendlyNpcs = Math.max(...teamSizes.map(size => size.friendly - 1))
    const maxEnemies = Math.max(...teamSizes.map(size => size.enemy))
    for (const [arenaId, obstacles] of [['roman-colosseum', createColosseumObstacles()], ['viking-valhalla', createValhallaObstacles()]] as const) {
      const fullFormation = planArenaTrialFormation(arenaId, obstacles, maxFriendlyNpcs, maxEnemies)!
      expect(fullFormation.friendly).toHaveLength(maxFriendlyNpcs)
      expect(fullFormation.enemy).toHaveLength(maxEnemies)
      const all = [fullFormation.player, ...fullFormation.friendly, ...fullFormation.enemy]
      let closest = Infinity
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
        closest = Math.min(closest, Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z))
      expect(closest, arenaId).toBeGreaterThan(2)
      expect(Math.min(...fullFormation.enemy.map(s => s.z)) - Math.max(...fullFormation.friendly.map(s => s.z))).toBeGreaterThan(8)
      const recruitFormation = planArenaTrialFormation(arenaId, obstacles, friendly.length, enemy.length)!
      const slots = assignArenaTrialSlots(roster, recruitFormation)
      expect(new Set(slots.keys())).toEqual(new Set(roster.map(entry => entry.actorId)))
      const assignedPositions = Array.from(slots.values(), slot => `${slot.x},${slot.z}`)
      expect(new Set(assignedPositions).size).toBe(roster.length)
      const frontZ = (role: 'archer' | 'melee') => Math.max(...friendly.filter(entry => entry.group.role === role).map(entry => slots.get(entry.actorId)!.z))
      expect(frontZ('archer')).toBeLessThan(frontZ('melee'))
    }
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
    const tampered = JSON.parse(storage.getItem('sagaburst_career_v2')!)
    tampered.activeMission.arenaTrial.actors['not-in-roster'] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }
    storage.setItem('sagaburst_career_v2', JSON.stringify(tampered))
    expect(store.load()?.activeMission).toBeUndefined()
  })

  it('saves height, ammo and shield durability exactly, keeping zero as spent and rejecting malformed checkpoints', () => {
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
    const bad = JSON.parse(storage.getItem('sagaburst_career_v2')!)
    bad.activeMission.arenaTrial.player.fall.grounded = 'no'
    storage.setItem('sagaburst_career_v2', JSON.stringify(bad))
    expect(store.load()?.activeMission).toBeUndefined()
    bad.activeMission.arenaTrial.player.fall.grounded = false
    bad.activeMission.arenaTrial.player.ammo = -1
    storage.setItem('sagaburst_career_v2', JSON.stringify(bad))
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
    const player = { dead: false, spectatorOnly: false, hp: 100, blockingLevel: 1, armorBreakLevel: 1, clearTownAction() {}, setHp() {}, setMaxHp() {} }
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
