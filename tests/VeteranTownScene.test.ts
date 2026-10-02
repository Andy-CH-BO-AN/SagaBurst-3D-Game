import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sweepPlayerSpawn, SWEEP_CENTER } from '../src/career/CavalrySweep'
import { TownScene } from '../src/town/TownScene'
import { createCareerProfile, type CareerRank } from '../src/career/CareerProfile'

class Element {
  children: Element[] = []
  textContent = ''
  className = ''
  disabled = false
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  onclick?: () => void
  append(...nodes: Element[]) { this.children.push(...nodes) }
  setAttribute(key: string, value: string) { this.attributes[key] = value }
  all(): Element[] { return [this, ...this.children.flatMap(child => child.all())] }
}

afterEach(() => vi.unstubAllGlobals())
function board(rank: CareerRank, page?: string, completed: string[] = []) {
  vi.stubGlobal('document', { createElement: () => new Element() })
  const profile = createCareerProfile('roman')
  profile.rank = rank
  profile.completedCareerMissionTemplateIds = completed
  const panel = new Element()
  const town = Object.create(TownScene.prototype) as any
  Object.assign(town, {
    profile, player: { arrowCount: 30 }, deploymentPage: page,
    openPanel: () => panel,
    button: (parent: Element, label: string, onclick: () => void) => {
      const button = new Element(); button.textContent = label; button.onclick = onclick; parent.append(button)
    },
  })
  town.openDeploymentPanel('', {}, false)
  return { town, panel, elements: panel.all() }
}

describe('Veteran mission board integration', () => {
  it.each(['recruit', 'soldier', 'veteran', 'captain', 'commander'] as const)('renders Veteran tab with correct rank lock for %s', rank => {
    const { elements } = board(rank)
    const tab = elements.find(element => element.textContent.startsWith('老兵任務'))
    expect(tab).toBeDefined()
    expect(tab!.disabled).toBe(rank === 'recruit' || rank === 'soldier')
    const tabs = elements.filter(element => 'aria-pressed' in element.attributes)
    expect(tabs.map(element => element.textContent.split(' · 升階')[0])).toEqual(['菜兵任務', '士兵任務', '老兵任務', '1v1 Duel · 單挑'])
  })

  it.each(['veteran', 'captain', 'commander'] as const)('defaults %s to Veteran and allows selecting older pages', rank => {
    const { town, elements } = board(rank)
    expect(town.deploymentPage).toBe('veteran')
    expect(elements.find(element => element.textContent === '老兵任務')!.attributes['aria-pressed']).toBe('true')
    expect(board(rank, 'recruit').town.deploymentPage).toBe('recruit')
    expect(board(rank, 'soldier').town.deploymentPage).toBe('soldier')
    expect(board(rank, 'duel').town.deploymentPage).toBe('duel')
  })

  it('opens Veteran by default after promotion while preserving deliberate page changes at the same rank', () => {
    const { town } = board('soldier', 'recruit')
    town.store = { save: vi.fn(() => true) }
    expect(town.commit({ ...town.profile, rank: 'veteran' })).toBe(true)
    town.openDeploymentPanel('', {}, false)
    expect(town.deploymentPage).toBe('veteran')
    town.deploymentPage = 'recruit'
    town.commit({ ...town.profile, availableMerit: 50 })
    town.openDeploymentPanel('', {}, false)
    expect(town.deploymentPage).toBe('recruit')
  })

  it('shows mounted Veteran missions with a disabled mount requirement', () => {
    const { elements } = board('veteran', 'veteran', ['veteran-dread-outpost'])
    expect(elements.some(element => element.textContent === '需要坐騎' && element.disabled)).toBe(true)
  })
})

describe('Veteran field scene checkpoint presentation', () => {
  it('places the Player with the scout squad immediately when accepting Veteran VI', () => {
    const profile = createCareerProfile('roman')
    Object.assign(profile, { rank: 'veteran', totalMerit: 900, ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept', 'veteran-outpost-assault', 'veteran-spear-line-hunt',
    ] })
    const town = Object.create(TownScene.prototype) as any
    const player = { dead: false, group: new THREE.Group(), faceDirection: vi.fn() }
    Object.assign(town, { profile, player, event: { hostile: false }, store: { loadChecked: () => ({ profile }), save: () => true },
      mission: { startActiveMission: () => true }, careerMounts: { activate: vi.fn() }, inventory: { prepareForCombat: vi.fn() },
      closePanel: vi.fn(), playMissionVoice: vi.fn(),
    })
    town.acceptVeteranCareerMission('veteran-tragedy-of-the-scouts')
    const spawn = sweepPlayerSpawn(SWEEP_CENTER.clone().add(new THREE.Vector3(-18, 0, 0)))
    expect(player.group.position.x).toBeCloseTo(spawn.x)
    expect(player.group.position.z).toBeCloseTo(spawn.z)
    expect(town.careerMounts.activate).toHaveBeenCalledOnce()
  })

  it('restores the scout Player beside the squad even at the initial assembling checkpoint', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'scout-start', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field', targetCampId: 0,
      phase: 'ASSEMBLING', targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 0 }
    const town = Object.create(TownScene.prototype) as any
    const player = { group: new THREE.Group(), faceDirection: vi.fn(), currentMount: null }
    Object.assign(town, { profile, player, mission: { startActiveMission: vi.fn() }, careerMounts: { restoreActiveMount: vi.fn() }, inventory: { prepareForCombat: vi.fn() } })
    town.restoreActiveCareerMission()
    const spawn = sweepPlayerSpawn(SWEEP_CENTER.clone().add(new THREE.Vector3(-18, 0, 0)))
    expect(player.group.position.x).toBeCloseTo(spawn.x)
    expect(player.group.position.z).toBeCloseTo(spawn.z)
  })

  it('restores wounded player HP and stamina before continuing the saved battle', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = {
      id: 'wounded-veteran', templateId: 'veteran-scout-hunters', kind: 'veteran-field', targetCampId: 0, phase: 'ENGAGING',
      targetActorIds: ['enemy'], friendlyActorIds: ['captain'], playerHp: 42, playerStamina: 18, acceptedAt: 0,
    }
    const player = { group: new THREE.Group(), faceDirection: vi.fn(), setHp: vi.fn(), setStamina: vi.fn(), currentMount: null }
    const town = Object.create(TownScene.prototype) as any
    Object.assign(town, { profile, player, mission: { startActiveMission: vi.fn() }, careerMounts: { restoreActiveMount: vi.fn() }, inventory: { prepareForCombat: vi.fn() } })
    town.restoreActiveCareerMission()
    expect(player.setHp).toHaveBeenCalledExactlyOnceWith(42)
    expect(player.setStamina).toHaveBeenCalledExactlyOnceWith(18)
  })
  it('renders survival countdown from persisted elapsed time, including the terminal zero', () => {
    const town = Object.create(TownScene.prototype) as any
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'survival', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field', phase: 'ENGAGING', targetCampId: 0, targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 0 }
    town.profile = profile
    expect(town.veteranMissionHud()).toContain('SURVIVE 02:00')
    profile.activeMission.survivalElapsed = 119.9
    expect(town.veteranMissionHud()).toContain('SURVIVE 00:01')
    profile.activeMission.survivalElapsed = 120
    expect(town.veteranMissionHud()).toContain('SURVIVE 00:00')
  })
})
