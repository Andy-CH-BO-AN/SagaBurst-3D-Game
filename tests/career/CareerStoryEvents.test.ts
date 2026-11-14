import { describe, expect, it } from 'vitest'
import { acceptArenaStoryTrial, createArenaTrialMission } from '../../src/career/CareerArenaTrials'
import { addCareerItem } from '../../src/career/CareerInventory'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { claimCareerMission, clearCareerMission, cloneCareerProfile, createCareerProfile, promoteCareer, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { careerStoryPurchaseLine, markCareerStoryEagleIntroSeen } from '../../src/career/CareerStoryEvents'
import { selectStoryGuidance, storyDialogueOpen, type StoryGuidanceContext } from '../../src/career/CareerStoryGuidance'
import { applyT4Class } from '../../src/career/CareerT4Promotion'
import { purchaseTownMount } from '../../src/town/TownRules'
import { MemoryStorage } from '../helpers/memoryStorage'

const stats = { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: true }
const rich = (): CareerProfile => { const p = createCareerProfile('roman'); p.totalMerit = p.availableMerit = 20000; return p }
const free: StoryGuidanceContext = { raceHorseReady: true, deferred: new Set(), available: () => true }
/** A pre-feature save: the model never wrote `careerStory`, and the tutorial receipts are the only horse record. */
const legacy = (mutate: (p: CareerProfile) => void): CareerProfile => {
  const p = createCareerProfile('roman'); mutate(p); delete p.careerStory
  return parseCareerProfile(JSON.parse(JSON.stringify(p)))!
}
/** A formal mission settled and its report closed, as the Sergeant's return does. */
function won(profile: CareerProfile, id: string, outcome: 'victory' | 'failure' = 'victory'): CareerProfile {
  const claim = claimCareerMission({ ...profile, activeMission: createActiveCareerMission('career-bandit-camp', 1, 2, 2, id) }, id, outcome, stats)
  return clearCareerMission(claim.profile, id)
}

describe('Career story events: triggers', () => {
  it('offers the Commander invitation only for the first real military-horse purchase', () => {
    const p = rich()
    expect(purchaseTownMount(createCareerProfile('roman'), 'horse').purchased).toBe(false)
    for (const other of ['corgi', 'armored-horse'] as const) expect(purchaseTownMount(p, other).profile.careerStory!.events).toEqual({})
    const first = purchaseTownMount(p, 'horse', 3).profile
    expect(first.careerStory!.events['commander-circuit-race']).toEqual({ status: 'pending' })
    expect(careerStoryPurchaseLine(p, first)).toContain('指揮官聽說你買了戰馬')
    const second = purchaseTownMount(first, 'horse').profile
    expect(careerStoryPurchaseLine(first, second)).toBeNull()
    // The event itself is the receipt: even with no horse and no tutorial record left, a sale and rebuy never reopens it.
    const resold = cloneCareerProfile(second)
    resold.careerStory!.events['commander-circuit-race'] = { status: 'settled' }
    resold.ownedMounts = []; resold.inventory = { version: 1, quantities: {} }; delete resold.selectedMountId; resold.tutorial!.purchases.horse = false
    expect(purchaseTownMount(resold, 'horse').profile.careerStory!.events['commander-circuit-race']).toEqual({ status: 'settled' })
  })

  it('offers the veteran invitation only on the first saved formal victory, not on defeats, trials or tutorial receipts', () => {
    const lost = won(createCareerProfile('roman'), 'lost', 'failure')
    expect(lost.tutorial!.settledMissionIds).toEqual(['lost'])
    expect(lost.careerStory!.events).toEqual({})
    const trial = createCareerProfile('roman')
    trial.activeMission = createArenaTrialMission(trial, 1, 'roman-colosseum', 'plain-trial')!
    expect(claimCareerMission(trial, 'plain-trial', 'victory', stats).profile.careerStory!.events).toEqual({})
    const first = won(lost, 'first')
    expect(first.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'pending' })
    const settled = cloneCareerProfile(first)
    settled.careerStory!.events['veteran-squad-spar'] = { status: 'settled' }
    expect(won(settled, 'second').careerStory!.events['veteran-squad-spar']).toEqual({ status: 'settled' })
  })
})

describe('Career story events: saves', () => {
  it('reads old saves without replaying milestones they already passed, and keeps the ones still ahead', () => {
    const owner = legacy(p => { addCareerItem(p, 'horse', 1) })
    expect(owner.careerStory!.events).toEqual({ 'commander-circuit-race': { status: 'settled' } })
    expect(legacy(p => { p.careerMissionCompletions = 1 }).careerStory!.events).toEqual({ 'veteran-squad-spar': { status: 'settled' } })
    expect(legacy(p => { p.completedCareerMissionTemplateIds = ['career-bandit-camp'] }).careerStory!.events['veteran-squad-spar']).toEqual({ status: 'settled' })
    // Settled-by-legacy carries no reward fields, so nothing can be paid out for it later.
    expect(owner.careerStory!.events['commander-circuit-race']).not.toHaveProperty('merit')
    expect(legacy(() => {}).careerStory).toBeUndefined()
    // A save that already has state is authoritative: owning a horse without an event is not re-derived into one.
    const current = createCareerProfile('roman'); addCareerItem(current, 'horse', 1)
    expect(parseCareerProfile(JSON.parse(JSON.stringify(current)))!.careerStory).toEqual(current.careerStory)
    expect(legacy(p => { addCareerItem(p, 'xongkoro', 1) }).careerStory!.eaglePurchased).toBe(true)
    const eligible = legacy(p => { p.totalMerit = p.availableMerit = 900; p.rank = 'soldier' })
    expect(selectStoryGuidance(eligible, free)).toMatchObject({ npc: 'captain', key: 'appoint:soldier' })
  })

  it('restores pending, active and settled invitations, and returns an orphaned accepted one instead of consuming it', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    const profile = won(createCareerProfile('roman'), 'win')
    expect(store.save(profile)).toBe(true)
    expect(store.load()!.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'pending' })
    const accepted = acceptArenaStoryTrial(profile, 'roman-colosseum', 'spar-1')!
    expect(accepted.activeMission).toMatchObject({ id: 'spar-1', kind: 'arena-squad-trial', storyEventId: 'veteran-squad-spar' })
    expect(store.save(accepted)).toBe(true)
    expect(store.load()!.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'active', sourceId: 'spar-1' })
    expect(store.load()!.activeMission!.storyEventId).toBe('veteran-squad-spar')
    const orphan = cloneCareerProfile(accepted); delete orphan.activeMission
    expect(parseCareerProfile(JSON.parse(JSON.stringify(orphan)))!.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'pending' })
    const done = claimCareerMission(accepted, 'spar-1', 'victory', stats).profile
    expect(store.save(done)).toBe(true)
    expect(store.load()!.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'settled', sourceId: 'spar-1', outcome: 'victory', merit: 1000 })
    // A tampered reward is not honoured: the event is closed without one.
    const forged = JSON.parse(JSON.stringify(done)); forged.careerStory.events['veteran-squad-spar'].merit = 99999
    expect(parseCareerProfile(forged)!.careerStory!.events['veteran-squad-spar']).toEqual({ status: 'settled' })
  })
})

describe('Career story guidance', () => {
  it('points once at the Captain when one reward crosses two ranks, then at the next target from the latest profile', () => {
    let p = createCareerProfile('roman'); p.totalMerit = p.availableMerit = 1300
    expect(selectStoryGuidance(p, free)).toMatchObject({ npc: 'captain', key: 'appoint:recruit' })
    p = promoteCareer(p)!
    expect(selectStoryGuidance(p, free)).toMatchObject({ npc: 'captain', key: 'appoint:soldier' })
    p = promoteCareer(p)!
    expect(selectStoryGuidance(p, free)).toBeNull()
    p.totalMerit = p.availableMerit = 5000
    expect(selectStoryGuidance(p, free)).toMatchObject({ npc: 'captain', key: 'appoint:veteran' })
    p = applyT4Class(p, 'paladin')!
    expect(selectStoryGuidance(p, free)).toBeNull()
    p.totalMerit = p.availableMerit = 20000
    expect(selectStoryGuidance(p, free)).toMatchObject({ npc: 'commander', key: 'appoint:captain' })
  })

  it('guides to the first eagle only for a formal officer who can pay and never bought one, and never repeats its opening line', () => {
    const veteran = createCareerProfile('roman'); veteran.totalMerit = veteran.availableMerit = 10000; veteran.rank = 'veteran'
    expect(selectStoryGuidance(veteran, free)?.key).toBe('appoint:veteran')
    const captain = applyT4Class(veteran, 'paladin')!
    const first = selectStoryGuidance(captain, free)
    expect(first).toMatchObject({ npc: 'eagle-trainer', key: 'eagle' })
    expect(first!.opening).toBeTruthy()
    const spent = cloneCareerProfile(captain); spent.availableMerit = 9000
    expect(selectStoryGuidance(spent, free)).toBeNull()
    markCareerStoryEagleIntroSeen(captain)
    expect(selectStoryGuidance(captain, free)).toMatchObject({ key: 'eagle' })
    expect(selectStoryGuidance(captain, free)!.opening).toBeUndefined()
    const bought = cloneCareerProfile(captain); bought.careerStory!.eaglePurchased = true
    expect(selectStoryGuidance(bought, free)).toBeNull()
  })

  it('shows one invitation at a time, yields when deferred without closing it, and pauses for activities or an unavailable NPC', () => {
    const p = won(createCareerProfile('roman'), 'win')
    p.careerStory!.events['commander-circuit-race'] = { status: 'pending' }; addCareerItem(p, 'horse', 1)
    expect(selectStoryGuidance(p, free)).toMatchObject({ npc: 'commander', key: 'story:commander-circuit-race' })
    expect(selectStoryGuidance(p, { ...free, raceHorseReady: false })).toMatchObject({ npc: 'deployment' })
    const later = new Set<StoryGuidanceContext['deferred'] extends ReadonlySet<infer K> ? K : never>(['story:commander-circuit-race'])
    expect(selectStoryGuidance(p, { ...free, deferred: later })).toMatchObject({ npc: 'deployment' })
    later.add('story:veteran-squad-spar')
    expect(selectStoryGuidance(p, { ...free, deferred: later })).toBeNull()
    expect(storyDialogueOpen(p, 'commander')).toBe(true)
    expect(storyDialogueOpen(p, 'deployment')).toBe(true)
    expect(selectStoryGuidance(p, { ...free, available: npc => npc !== 'commander' })).toBeNull()
    for (const busy of [{ activeMission: createActiveCareerMission('career-bandit-camp', 1, 1, 1, 'm') }, { townEvent: { id: 'e', state: 'hostile' as const } }]) {
      expect(selectStoryGuidance({ ...p, ...busy }, free)).toBeNull()
      expect(storyDialogueOpen({ ...p, ...busy }, 'deployment')).toBe(false)
    }
  })
})
