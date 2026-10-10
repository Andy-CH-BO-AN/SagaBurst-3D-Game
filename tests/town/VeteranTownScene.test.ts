import { createTownCombatFixture } from '../helpers/townCombatFixture'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { veteranPlayerSpawn, veteranPlayerYaw } from '../../src/career/BanditMissionController'
import { TownScene } from '../../src/town/TownScene'
import { Player } from '../../src/player/Player'
import { createCareerProfile, type CareerRank } from '../../src/career/CareerProfile'
import { townRoster, withTownCommandSquadRoster } from '../../src/town/TownRules'
import { AIType, Faction, NPC } from '../../src/world/NPC'

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
function board(rank: CareerRank, page?: string, completed: string[] = [], tierCompletions: Partial<Record<1 | 2 | 3, number>> = {}) {
  vi.stubGlobal('document', { createElement: () => new Element() })
  const profile = createCareerProfile('roman')
  profile.rank = rank
  profile.completedCareerMissionTemplateIds = completed
  if (Object.keys(tierCompletions).length > 0) profile.careerMissionCompletionsByTier = tierCompletions
  const panel = new Element()
  const town = createTownCombatFixture() as any
  Object.assign(town, {
    profile, player: { arrowCount: 30 }, deploymentPage: page,
    // Mission board observes population data only; no actor construction or simulation.
    residents: withTownCommandSquadRoster('roman', townRoster()).map(spec => ({ spec, npc: { combatantId: spec.id } })),
    skills: { skillState: profile.skills }, careerSkillSaveTimer: null,
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
    expect(tabs.map(element => element.textContent.split(' · 升階')[0])).toEqual(['菜兵任務', '士兵任務', '老兵任務', '隊長任務', '1v1 Duel · 單挑'])
    expect(tabs.find(element => element.textContent.startsWith('隊長任務'))!.disabled).toBe(rank !== 'captain' && rank !== 'commander')
  })

  it.each(['veteran', 'captain', 'commander'] as const)('defaults %s to its newest unlocked page and allows selecting older pages', rank => {
    const { town, elements } = board(rank)
    const expectedPage = rank === 'veteran' ? 'veteran' : 'captain'
    const expectedTab = rank === 'veteran' ? '老兵任務' : '隊長任務'
    expect(town.deploymentPage).toBe(expectedPage)
    expect(elements.find(element => element.textContent === expectedTab)!.attributes['aria-pressed']).toBe('true')
    if (rank !== 'veteran') expect(elements.some(element => element.textContent.includes('指揮北門 19 名'))).toBe(true)
    expect(board(rank, 'recruit').town.deploymentPage).toBe('recruit')
    expect(board(rank, 'soldier').town.deploymentPage).toBe('soldier')
    expect(board(rank, 'veteran').town.deploymentPage).toBe('veteran')
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

  it('shows Veteran Home Defense locked at four Tier 3 wins and unlocked at five without a mount', () => {
    const locked = board('veteran', 'veteran', [], { 1: 99, 2: 88, 3: 4 })
    const lockedRow = locked.elements.find(element => element.children.some(child => child.textContent === '守衛家園 · 老兵守城'))
    expect(lockedRow).toBeDefined()
    expect(lockedRow!.all().some(element => element.textContent.includes('4/5'))).toBe(true)
    expect(lockedRow!.children.find(element => element.onclick)?.disabled).toBe(true)

    const unlocked = board('veteran', 'veteran', [], { 1: 99, 2: 88, 3: 5 })
    const unlockedRow = unlocked.elements.find(element => element.children.some(child => child.textContent === '守衛家園 · 老兵守城'))
    expect(unlockedRow).toBeDefined()
    expect(unlockedRow!.children.find(element => element.onclick)?.disabled).toBe(false)
    expect(unlocked.town.profile.ownedMounts).toEqual([])
    const details = unlockedRow!.all().map(element => element.textContent).join(' ')
    expect(details).toContain('守護 vinum 村')
    expect(details).toContain('友軍 209 人（含玩家；AI 守軍 208）')
    expect(details).toContain('敵軍 120 人（T3 騎兵、4 名 T4 隊長）')
    expect(details).not.toMatch(/63|64|T2 騎兵/)
  })

  it('does not count lower-tier victories toward Veteran Home Defense and keeps completed saves replayable', () => {
    const locked = board('veteran', 'veteran', [], { 1: 500, 2: 500, 3: 4 })
    const row = locked.elements.find(element => element.children.some(child => child.textContent === '守衛家園 · 老兵守城'))
    expect(row?.all().some(element => element.textContent.includes('4/5'))).toBe(true)
    expect(row?.children.find(element => element.onclick)?.disabled).toBe(true)

    const completed = board('veteran', 'veteran', ['veteran-town-defense-01'], { 3: 5 })
    const completedRow = completed.elements.find(element => element.children.some(child => child.textContent === '守衛家園 · 老兵守城'))
    expect(completedRow).toBeDefined()
    expect(completedRow!.children.find(element => element.onclick)?.disabled).toBe(false)
  })

  it('routes the Veteran Home Defense card through the existing town-defense acceptMission path', () => {
    const { town, elements } = board('veteran', 'veteran', [], { 3: 5 })
    const acceptMission = vi.fn()
    town.acceptMission = acceptMission
    const row = elements.find(element => element.children.some(child => child.textContent === '守衛家園 · 老兵守城'))!
    row.children.find(element => element.onclick)!.onclick!()
    expect(acceptMission).toHaveBeenCalledExactlyOnceWith('veteran-town-defense-01')
  })

  it.each([[], ['veteran-town-defense-01']])('accepts Veteran Home Defense with completion history %j', completed => {
    const { town } = board('veteran', 'veteran', completed, { 3: 5 })
    const profile = town.profile
    town.residents = townRoster().map(spec => ({ spec, npc: {} }))
    town.store = { load: () => profile }
    town.event = { hostile: false }
    town.player = { dead: false }
    town.defense = { startActiveMission: vi.fn(() => true) }
    town.inventory = { prepareForCombat: vi.fn() }
    town.closePanel = vi.fn()
    town.playTownDefenseAlert = vi.fn()
    town.dispose = vi.fn()
    town.onRestart = vi.fn()
    town.notice = ''
    town.commit = vi.fn((next: typeof profile) => { town.profile = next; return true })

    town.acceptMission('veteran-town-defense-01')

    expect(town.profile.activeMission).toMatchObject({ templateId: 'veteran-town-defense-01', kind: 'town-defense' })
    expect(town.defense.startActiveMission).not.toHaveBeenCalled()
    expect(town.inventory.prepareForCombat).not.toHaveBeenCalled()
    expect(town.dispose).toHaveBeenCalledOnce()
    expect(town.onRestart).toHaveBeenCalledExactlyOnceWith(town.profile)
  })
})

describe('Veteran field scene checkpoint presentation', () => {
  it.each(['veteran-village-intercept', 'veteran-spear-line-hunt'])(
    'borrows only living mounted Town cavalry when accepting %s', templateId => {
    const profile = createCareerProfile('roman')
    Object.assign(profile, { rank: 'veteran', totalMerit: 900, ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept', 'veteran-outpost-assault',
    ] })
    const residents = townRoster().map(spec => ({ spec, npc: { combatantId: spec.id, dead: false, mount: null },
      homeMount: spec.mounted && spec.duty === 'training' ? { dead: false } : undefined }))
    residents.find(resident => resident.spec.id === 'cavalry-training:melee_cavalry:0')!.npc.dead = true
    residents.find(resident => resident.spec.id === 'cavalry-training:lancer_cavalry:0')!.homeMount!.dead = true
    residents.find(resident => resident.spec.id === 'cavalry-training:ranged_cavalry:0')!.homeMount = undefined
    const town = Object.create(TownScene.prototype) as any
    Object.assign(town, { profile, residents, player: { dead: false }, event: { hostile: false },
      store: { loadChecked: () => ({ profile }) }, commit: vi.fn(next => { town.profile = next; return true }),
      mission: { startActiveMission: vi.fn(() => true) }, careerMounts: { activate: vi.fn() },
      inventory: { prepareForCombat: vi.fn() }, closePanel: vi.fn(), playMissionVoice: vi.fn(),
    })
    town.acceptVeteranCareerMission(templateId)
    const active = town.profile.activeMission
    expect(active).toMatchObject({ veteranRosterVersion: 3, phase: 'ASSEMBLING' })
    const borrowed = active.borrowedActorIds.filter((id: string) => id.startsWith('cavalry-training:'))
    expect(borrowed).toHaveLength(47)
    for (const id of ['cavalry-training:melee_cavalry:0', 'cavalry-training:lancer_cavalry:0', 'cavalry-training:ranged_cavalry:0']) expect(borrowed).not.toContain(id)
    expect(active.friendlyActorIds).toHaveLength(49)
    expect(town.mission.startActiveMission).toHaveBeenCalledOnce()
  })

  it('saves Veteran VI and replaces the own-town scene with the enemy-territory mission scene', () => {
    const profile = createCareerProfile('roman')
    Object.assign(profile, { rank: 'veteran', totalMerit: 900, ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept', 'veteran-outpost-assault', 'veteran-spear-line-hunt',
    ] })
    const town = createTownCombatFixture() as any
    const player = { dead: false, group: new THREE.Group(), faceDirection: vi.fn() }
    Object.assign(town, { profile, player, residents: [], event: { hostile: false }, store: { loadChecked: () => ({ profile }), save: () => true },
      skills: { skillState: { ...profile.skills, ranged: { level: 2, xp: 37 } } }, careerSkillSaveTimer: null,
      mission: { startActiveMission: () => true }, careerMounts: { activate: vi.fn() }, inventory: { prepareForCombat: vi.fn() },
      closePanel: vi.fn(), playMissionVoice: vi.fn(), dispose: vi.fn(), onRestart: vi.fn(),
    })
    const start = vi.spyOn(town.mission, 'startActiveMission')
    town.acceptVeteranCareerMission('veteran-tragedy-of-the-scouts')
    expect(town.profile.activeMission).toMatchObject({ templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field' })
    expect(town.profile.faction).toBe('roman')
    expect(town.dispose).toHaveBeenCalledOnce()
    expect(town.onRestart).toHaveBeenCalledExactlyOnceWith(town.profile)
    expect(town.onRestart.mock.calls[0][0].skills.ranged).toEqual({ level: 2, xp: 37 })
    expect(start).not.toHaveBeenCalled()
    expect(town.careerMounts.activate).not.toHaveBeenCalled()
  })

  it('keeps the own-town scene when accepting Veteran VI cannot be saved', () => {
    const profile = createCareerProfile('roman')
    Object.assign(profile, { rank: 'veteran', totalMerit: 900, ownedMounts: ['horse'], completedCareerMissionTemplateIds: [
      'veteran-dread-outpost', 'veteran-scout-hunters', 'veteran-village-intercept', 'veteran-outpost-assault', 'veteran-spear-line-hunt',
    ] })
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile, residents: [], player: { dead: false }, event: { hostile: false },
      store: { loadChecked: () => ({ profile }) }, commit: vi.fn(() => false),
      mission: { startActiveMission: vi.fn() }, dispose: vi.fn(), onRestart: vi.fn(),
    })
    town.acceptVeteranCareerMission('veteran-tragedy-of-the-scouts')
    expect(town.profile.activeMission).toBeUndefined()
    expect(town.dispose).not.toHaveBeenCalled()
    expect(town.onRestart).not.toHaveBeenCalled()
    expect(town.mission.startActiveMission).not.toHaveBeenCalled()
  })

  it('restores the scout Player beside the squad even at the initial assembling checkpoint', async () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'scout-start', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field', targetCampId: 0,
      phase: 'ASSEMBLING', targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 0 }
    const town = createTownCombatFixture() as any
    const player = { group: new THREE.Group(), faceDirection: vi.fn(), currentMount: null }
    Object.assign(town, { profile, player, mission: { startActiveMission: vi.fn() }, careerMounts: { restoreActiveMount: vi.fn() }, inventory: { prepareForCombat: vi.fn() } })
    town.mission.spawnBatches = []
    town.defense ??= { spawnBatches: [] }
    town.defense.spawnBatches = []
    await town.restoreActiveCareerMission()
    const spawn = veteranPlayerSpawn('veteran-tragedy-of-the-scouts')
    expect(player.group.position.x).toBeCloseTo(spawn.x)
    expect(player.group.position.z).toBeCloseTo(spawn.z)
  })

  it('restores Player and owned mount facing the shared field approach rather than the old Sweep heading', async () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'field-facing', templateId: 'veteran-scout-hunters', kind: 'veteran-field',
      targetCampId: 0, phase: 'MARCHING', targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 1 }
    const mount = { group: new THREE.Group() }
    const player = { group: new THREE.Group(), faceDirection: vi.fn(), currentMount: null as any }
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile, player, mission: { startActiveMission: vi.fn() },
      careerMounts: { restoreActiveMount: vi.fn(() => { player.currentMount = mount }) }, inventory: { prepareForCombat: vi.fn() } })
    town.mission.spawnBatches = []
    town.defense ??= { spawnBatches: [] }
    town.defense.spawnBatches = []
    await town.restoreActiveCareerMission()
    const yaw = veteranPlayerYaw('veteran-scout-hunters')
    expect(player.faceDirection).toHaveBeenCalledExactlyOnceWith(Math.sin(yaw), Math.cos(yaw))
    expect(mount.group.rotation.y).toBe(yaw)
  })

  it('restores wounded player HP and stamina before continuing the saved battle', async () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = {
      id: 'wounded-veteran', templateId: 'veteran-scout-hunters', kind: 'veteran-field', targetCampId: 0, phase: 'ENGAGING',
      targetActorIds: ['enemy'], friendlyActorIds: ['captain'], playerHp: 42, playerStamina: 18, acceptedAt: 0,
    }
    const player = { group: new THREE.Group(), faceDirection: vi.fn(), setHp: vi.fn(), setStamina: vi.fn(), currentMount: null }
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile, player, mission: { startActiveMission: vi.fn() }, careerMounts: { restoreActiveMount: vi.fn() }, inventory: { prepareForCombat: vi.fn() } })
    town.mission.spawnBatches = []
    town.defense ??= { spawnBatches: [] }
    town.defense.spawnBatches = []
    await town.restoreActiveCareerMission()
    expect(player.setHp).toHaveBeenCalledExactlyOnceWith(42)
    expect(player.setStamina).toHaveBeenCalledExactlyOnceWith(18)
  })
  it('renders survival countdown from persisted elapsed time, including the terminal zero', () => {
    const town = createTownCombatFixture() as any
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


describe('Veteran VI enemy Town building damage', () => {
  it('damages an enemy-owned building without cancelling the scout mission or creating a home-town incident', () => {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'enemy-town-scouts', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field',
      targetCampId: 0, phase: 'ENGAGING', targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 1 }
    const hp = { root: new THREE.Group(), destroyed: false, takeDamage: vi.fn(() => ({ appliedDamage: 5 })) }
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile, event: { hostile: false }, store: { save: () => true },
      defense: { active: undefined, assault: false }, mission: { cleanupMission: vi.fn(), provokeCamp: vi.fn() },
      world: { buildings: [{ id: 'hall', ownerFaction: Faction.ENEMY, hp }], obstacles: [], refreshDamage: vi.fn() },
      navigation: { sync: vi.fn() }, damageNumbers: { spawn: vi.fn() }, clearMissionCombatShots: vi.fn(),
      persistCasualties: vi.fn(), activateHostility: vi.fn(() => { town.event.hostile = true }),
    })
    town.damageBuilding(0, 5)
    expect(town.profile.activeMission?.id).toBe('enemy-town-scouts')
    expect(town.profile.townEvent).toBeUndefined()
    expect(town.event.hostile).toBe(false)
    expect(town.mission.cleanupMission).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
    expect(hp.takeDamage).toHaveBeenCalledExactlyOnceWith(5)
  })
})


describe('Veteran VI decorative Town services', () => {
  function scoutScene() {
    const profile = createCareerProfile('roman')
    profile.activeMission = { id: 'scout-services', templateId: 'veteran-tragedy-of-the-scouts', kind: 'veteran-field',
      targetCampId: 0, phase: 'ENGAGING', targetActorIds: ['enemy'], friendlyActorIds: ['captain'], acceptedAt: 1 }
    const cat = { group: new THREE.Group(), dead: false, currentHp: 100, riderNpc: null, takeDamage: vi.fn() }
    const player = { dead: false, group: new THREE.Group(), combatPosition: new THREE.Vector3() }
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile, player, cat, stableHorses: [], residents: [],
      mission: { friendlies: [], fieldNpcs: [] }, defense: { fieldNpcs: [] },
      world: { obstacles: [] }, prepareDamage: vi.fn(() => true), activateHostility: vi.fn(),
      persistCasualties: vi.fn(), damageNumbers: { spawn: vi.fn() },
    })
    return { town, cat, player }
  }

  it('ignores a hit on the hidden decorative cat without producing a home-town incident', () => {
    const { town, cat } = scoutScene()
    town.hitResident(cat, 10)
    expect(town.prepareDamage).not.toHaveBeenCalled()
    expect(cat.takeDamage).not.toHaveBeenCalled()
    expect(town.activateHostility).not.toHaveBeenCalled()
    expect(town.profile.activeMission.id).toBe('scout-services')
  })

  it('does not collide with the hidden decorative cat in enemy territory', () => {
    const { town, player } = scoutScene()
    player.group.position.set(.4, 1.2, 0)
    town.resolveBodies()
    expect(player.group.position.x).toBe(.4)
    expect(player.group.position.z).toBe(0)
  })
})


describe('Veteran VI native Town combat routing', () => {
  function fixture() {
    const scene = new THREE.Scene()
    const guard = new NPC(scene, 0, 1, Faction.ENEMY, 'viking', AIType.MELEE, 'Native guard', 2, false, undefined, undefined, undefined, 'enemy-town:melee_infantry-0')
    const scout = new NPC(scene, 0, 1, Faction.TOWN, 'roman', AIType.MELEE, 'Scout', 4, false, undefined, undefined, undefined, 'captain')
    const town = createTownCombatFixture() as any
    Object.assign(town, { profile: { faction: 'roman', activeMission: { kind: 'veteran-field', templateId: 'veteran-tragedy-of-the-scouts' } },
      world: { buildings: [], obstacles: [], targets: [] },
      mission: { ambientBandits: [], missionBandits: [], friendlies: [scout], combatPeersFor: () => [scout] },
      missionCombat: { enemyTownHostiles: [guard], isExternalThreatDefender: () => false },
      defense: { active: false, playerEnemies: [] }, residents: [{ spec: { id: guard.combatantId, role: 'melee_infantry' }, npc: guard }],
      cat: null, stableHorses: [], inventory: { meleeEnabled: true, equippedMelee: { range: 1.8, damageMax: 12, combatKind: 'sword' } },
      skills: { getOneHandedMultiplier: () => 1, getMultiplier: () => 1 },
      player: { group: { position: new THREE.Vector3(0, .9, 0) }, dead: false, position: new THREE.Vector3(0, .9, 0), facingYaw: 0,
        getSwordTipPosition: () => new THREE.Vector3(0, 1.2, 2), getWeaponGripPosition: () => new THREE.Vector3(0, 1.2, .2),
        weaponSweep: { traceFirst: (targets: NPC[]) => ({ kind: 'body', time: .5, target: targets[0] }), trace: () => ({ kind: 'body', time: .5 }), contact: { kind: 'body', time: .5 } }, isHitFrame: () => true, markHitProcessed: vi.fn() },
      previousTip: new THREE.Vector3(), hasPreviousTip: false, hitFieldNpc: vi.fn(), hitResident: vi.fn(),
    })
    Object.setPrototypeOf(town.player, Player.prototype)
    return { town, guard, scout }
  }

  it('routes Player melee against a native enemy guard as mission combat rather than a home-town crime', () => {
    const { town, guard, scout } = fixture()
    town.melee()
    expect(town.hitFieldNpc).toHaveBeenCalledWith(guard, expect.any(Number), 'melee', undefined, expect.objectContaining({ kind: 'body' }))
    expect(town.hitResident).not.toHaveBeenCalled()
    guard.dispose(); scout.dispose()
  })

  it.each(['guard', 'scout'] as const)('routes %s projectiles between native guards and scouts', shooter => {
    const { town, guard, scout } = fixture()
    town.player.position.set(30, .9, 30)
    town.player.group.position.copy(town.player.position)
    const source = shooter === 'guard' ? guard : scout
    const target = shooter === 'guard' ? scout : guard
    let alive = true
    const center = target.combatPosition.clone().add(new THREE.Vector3(0, 1, 0))
    const arrow = { mesh: { position: center.clone().add(new THREE.Vector3(0, 0, -1)) }, damage: 12,
      update() { this.mesh.position.copy(center).z += 1 }, destroy() { alive = false }, get isAlive() { return alive } }
    town.shots = [{ arrow, training: false, player: false, source, age: 0 }]
    town.updateShots(.1)
    expect(town.hitFieldNpc).toHaveBeenCalledExactlyOnceWith(target, 12, 'projectile', source, expect.objectContaining({ kind: 'body' }))
    expect(town.hitResident).not.toHaveBeenCalled()
    guard.dispose(); scout.dispose()
  })
})
