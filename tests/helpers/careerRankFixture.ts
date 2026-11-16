import type { CareerProfile, CareerRank } from '../../src/career/CareerProfile'

/** Explicit current saved class records for an already appointed fixture; grants are prepared separately. */
export function careerRankFixture(faction: CareerProfile['faction'], rank: CareerRank): Pick<CareerProfile,
  'rank' | 'eliteClass' | 'unlockedCareerClasses' | 't4Specialization' | 'unlockedT4Classes'> {
  const t4 = faction === 'roman' ? 'paladin' : 'varangian'
  return { rank, eliteClass: null,
    ...(rank === 'captain' || rank === 'commander' ? { t4Specialization: t4, unlockedT4Classes: [t4] } : {}),
    ...(rank === 'commander' ? { unlockedCareerClasses: [faction === 'roman' ? 'roman-commander' : 'viking-commander'] } : {}),
  }
}
