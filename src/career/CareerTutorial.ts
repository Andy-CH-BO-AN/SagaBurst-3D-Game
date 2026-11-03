import { cloneCareerProfile, ownsCareerHorse, type CareerProfile } from './CareerProfile'
import type { CareerProfileStore } from './CareerProfileStore'
import { careerTutorialStep, type CareerTutorialSession, type CareerTutorialStageId } from './CareerTutorialState'

export type CareerTutorialCommitResult = { ok: true; profile: CareerProfile } | { ok: false; reason: 'load-failed' | 'stale-career' | 'stale-session' | 'rejected' | 'save-failed' }
/** Mutate the latest saved enlistment, so a scene return cannot restore an old full-profile snapshot. */
export function commitCareerTutorial(store: Pick<CareerProfileStore, 'loadChecked' | 'save'>, careerId: string,
  mutate: (profile: CareerProfile) => void | boolean, sessionId?: string): CareerTutorialCommitResult {
  const loaded = store.loadChecked()
  if (loaded.error || !loaded.profile) return { ok: false, reason: 'load-failed' }
  if (loaded.profile.tutorial?.careerId !== careerId) return { ok: false, reason: 'stale-career' }
  if (sessionId !== undefined && loaded.profile.tutorial.session?.id !== sessionId) return { ok: false, reason: 'stale-session' }
  const next = cloneCareerProfile(loaded.profile)
  if (mutate(next) === false) return { ok: false, reason: 'rejected' }
  if (!store.save(next)) return { ok: false, reason: 'save-failed' }
  return { ok: true, profile: next }
}
export function canStartCareerTutorial(profile: CareerProfile): boolean {
  return !profile.activeMission && !profile.activeOutpostMission && !profile.activeRace
    && !profile.careerRetirement && profile.townEvent?.state !== 'hostile'
}
/** Loaded legacy ownership can satisfy guidance, but never invents a purchase/reward receipt. */
export function hasCareerTutorialHorse(profile: CareerProfile): boolean {
  const tutorial = profile.tutorial
  return Boolean(tutorial && (tutorial.purchases.horse || tutorial.legacy && ownsCareerHorse(profile)))
}
export function startCareerTutorial(profile: CareerProfile, stage: CareerTutorialStageId, replay = false): CareerTutorialSession | null {
  const tutorial = profile.tutorial
  if (!tutorial || !canStartCareerTutorial(profile) || tutorial[stage].status === 'locked'
    || tutorial.session && tutorial.session.stage !== stage) return null
  const part = tutorial[stage]
  if (part.status === 'completed' && !replay) return null
  if (replay && part.status !== 'completed' && !part.replay) return null
  if (replay && (part.status === 'completed' || !part.replay)) {
    part.operations = []; part.step = careerTutorialStep(stage, []); part.replay = true
    if (stage === 'town') delete tutorial.duelOutcome
  }
  part.status = 'active'
  if (stage !== 'recruit' && stage !== 'captain') return null
  const session: CareerTutorialSession = { id: crypto.randomUUID(), careerId: tutorial.careerId,
    stage, replay: part.replay, returnFaction: profile.faction }
  tutorial.session = session
  return session
}
export function deferCareerTutorial(profile: CareerProfile, stage: CareerTutorialStageId): void {
  const tutorial = profile.tutorial
  if (!tutorial) return
  if (tutorial[stage].status !== 'completed' && tutorial[stage].status !== 'locked') tutorial[stage].status = 'deferred'
  if (tutorial.session?.stage === stage) delete tutorial.session
}
export { claimCareerTutorialReward, recordCareerTutorialOperation } from './CareerTutorialState'
