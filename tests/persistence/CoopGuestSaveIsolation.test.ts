import { afterEach, describe, expect, it } from 'vitest'
import { CAREER_STORAGE_KEY, CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { consumeCoopGuestLaunch, coopGuestPlayerSource, exitCoopGuestMission, isCoopGuestLaunch, parseCoopLaunchPayload } from '../../src/coop/CoopLaunch'
import { COOP_PROTOCOL_VERSION } from '../../src/coop/CoopProtocol'
import { installGameStorageOverride } from '../../src/save/GameStorage'
import { MemoryStorage } from '../helpers/memoryStorage'

const globals = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage; window?: unknown }

afterEach(() => {
  installGameStorageOverride(null)
  delete globals.localStorage; delete globals.sessionStorage; delete globals.window
})

describe('Co-op guest save isolation', () => {
  it('plays on a memory copy of the host save and restores the guest session on exit', () => {
    // The guest's own character: a Roman in the host's Viking mission.
    const guestProfile = createCareerProfile('roman')
    const guestOwn = JSON.stringify(guestProfile)
    const local = new MemoryStorage({ initialValues: [[CAREER_STORAGE_KEY, guestOwn]] })
    const session = new MemoryStorage({ initialValues: [['sagaburst_career_town', '1']] })
    globals.localStorage = local; globals.sessionStorage = session
    const hostProfile = createCareerProfile('viking')
    const hostBytes = new CareerProfileStore(new MemoryStorage()).save(hostProfile) ? JSON.stringify(hostProfile) : ''
    session.setItem('sagaburst_coop_session_backup', JSON.stringify({ sagaburst_career_town: '1' }))
    session.setItem('sagaburst_coop_guest_launch', JSON.stringify({
      id: 'm1', version: COOP_PROTOCOL_VERSION, scene: 'game', config: { careerMissionId: 'm1' },
      local: { [CAREER_STORAGE_KEY]: hostBytes }, session: { sagaburst_campaign_config_v2: 'host', foreign: 'x' },
    }))

    expect(consumeCoopGuestLaunch()).toEqual({ scene: 'game', config: { careerMissionId: 'm1' } })
    expect(isCoopGuestLaunch()).toBe(true)
    // The guest page sees only the host's mission session, never its own Town entry or foreign keys.
    expect(session.getItem('sagaburst_career_town')).toBeNull()
    expect(session.getItem('sagaburst_campaign_config_v2')).toBe('host')
    expect(session.getItem('foreign')).toBeNull()
    const store = new CareerProfileStore()
    expect(store.load()?.faction).toBe('viking')
    expect(store.save({ ...store.load()!, totalMerit: 999 })).toBe(true)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(guestOwn)
    // Its own character builds the Player; its changes stay in this page.
    const character = coopGuestPlayerSource(store.load())!
    expect(character.read().faction).toBe('roman')
    expect(character.commit({ ...character.read(), selectedMountId: undefined })).toBe(true)
    expect(local.getItem(CAREER_STORAGE_KEY)).toBe(guestOwn)

    globals.window = { location: { pathname: '/', assign: () => {} } }
    exitCoopGuestMission()
    session.setItem('sagaburst_campaign_config_v2', 'written by pagehide')
    expect(consumeCoopGuestLaunch()).toBeNull()
    expect(session.getItem('sagaburst_career_town')).toBe('1')
    expect(session.getItem('sagaburst_campaign_config_v2')).toBeNull()
    expect(session.getItem('sagaburst_coop_session_backup')).toBeNull()
  })

  it('accepts only the known host scenes, with a launch config for battlefields alone', () => {
    const base = { id: 'x', version: COOP_PROTOCOL_VERSION, local: {}, session: {} }
    expect(parseCoopLaunchPayload({ ...base, scene: 'trial' })?.scene).toBe('trial')
    expect(parseCoopLaunchPayload({ ...base, scene: 'trial', config: {} })).toBeNull()
    expect(parseCoopLaunchPayload({ ...base, scene: 'game' })).toBeNull()
    expect(parseCoopLaunchPayload({ ...base, scene: 'prison' })).toBeNull()
  })
})
