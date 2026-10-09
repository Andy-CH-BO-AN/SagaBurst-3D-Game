import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { TownScene } from '../../src/town/TownScene'
import { Mount, MountState, MountType } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import type { NPC } from '../../src/world/NPC'
import { createCareerProfile } from '../../src/career/CareerProfile'

// Zero actor constructors, TownWorld, GLB or simulation. Real Mount eligibility/name
// getters over data only; Player commands and dialog rendering are boundary doubles.
function mountData(type = MountType.HORSE, x = 0, z = 1): Mount {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  return Object.assign(Object.create(Mount.prototype) as Mount, {
    type, group, state: MountState.IDLE,
    disposed: false, reservedForTown: false, temporaryCombatId: null,
    riderNpc: null, riderPlayer: null, currentHp: 42, maxHp: 100,
    flight: { phase: 'grounded' },
  })
}

interface InteractionEntry {
  key(event: KeyboardEvent): void
  interaction(): void
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function fixture() {
  const player: Mutable<Pick<Player, 'dead' | 'isMounted' | 'isFalling' | 'currentMount' | 'position' | 'facingYaw' | 'combatPosition' | 'mountVehicle' | 'dismountFromMount'>> = {
    dead: false, isMounted: false, isFalling: false, currentMount: null as Mount | null,
    position: new THREE.Vector3(0, .9, 0), facingYaw: 0,
    get combatPosition() { return this.position },
    mountVehicle(mount: Mount) { this.currentMount = mount; this.isMounted = true },
    dismountFromMount() { this.currentMount = null; this.isMounted = false },
  }
  const hint = { textContent: '', style: { display: '' } }
  const event = { hostile: false, allActors: new Map<string, { dead: boolean }>() }
  const defense = { active: false, servicesLocked: false }
  const careerMounts = { activeMount: null as Mount | null }
  const temporaryMounts = { all: [] as Mount[] }
  const outskirts = { mounts: [] as Mount[] }
  const residents = ['captain', 'deployment', 'merchant', 'ranger', 'hr-officer', 'eagle-trainer'].map(id => ({
    spec: { id }, npc: { combatPosition: new THREE.Vector3(20, 0, 20) },
  }))
  const world = { obstacles: [] as Array<{ box: THREE.Box3 }>, buildings: [] }
  const equipment = { visible: false }
  const personalCommands = { isFormationPlacementMode: false }
  const dialog = { openedFor: null as string | null }
  // Only selection/input/hint/service methods execute, never the scene constructor.
  const town = Object.assign(Object.create(TownScene.prototype) as InteractionEntry, {
    player, hint, event, defense, careerMounts, temporaryMounts, outskirts, residents, world,
    equipment, personalCommands, profile: createCareerProfile('roman'),
    cat: mountData(MountType.BLACK_CAT, 20, 20), panel: null,
    talk(id: string) { dialog.openedFor = id },
  })
  const pressE = () => {
    const key = { code: 'KeyE', repeat: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    town.key(key as unknown as KeyboardEvent) // Native event boundary, no browser DOM required.
    return key
  }
  const nearNpc = (id = 'captain') => residents.find(r => r.spec.id === id)!.npc.combatPosition.set(0, 0, 2)
  return { town, player, hint, event, defense, careerMounts, temporaryMounts, outskirts, residents, world, equipment, personalCommands, dialog, pressE, nearNpc }
}

describe('Career town E interaction selection and hint', () => {
  it.each(['captain', 'merchant', 'hr-officer'])('mounted player talks to nearby %s without dismounting', id => {
    const h = fixture(), mount = mountData()
    h.player.mountVehicle(mount); h.nearNpc(id)
    h.town.interaction()
    expect(h.hint.textContent).toMatch(/^E 與 .+ 交談$/)
    h.pressE()
    expect(h.dialog.openedFor).toBe(id)
    expect(h.player.currentMount).toBe(mount)
    expect(h.player.isMounted).toBe(true)
  })

  it.each([
    [MountType.HORSE, '戰馬'], [MountType.BLACK_CAT, '黑貓'],
    [MountType.CORGI, '柯基'], [MountType.XONGKORO, 'xongkoro'],
  ] as const)('%s dismounts away from NPCs and remounts the same active instance with its name and HP intact', (type, name) => {
    const h = fixture(), mount = mountData(type), originalPosition = mount.group.position.clone()
    h.careerMounts.activeMount = mount; h.player.mountVehicle(mount)
    h.town.interaction(); expect(h.hint.textContent).toBe('E 下馬')
    h.pressE(); expect(h.player.isMounted).toBe(false)
    h.town.interaction(); expect(h.hint.textContent).toBe(`E 騎乘 ${name}`)
    h.pressE()
    expect(h.player.currentMount).toBe(mount)
    expect(h.careerMounts.activeMount).toBe(mount)
    expect(mount.currentHp).toBe(42)
    expect(mount.group.position).toEqual(originalPosition)
  })

  it('walking NPC dialog wins over the active mount and stale NPC targets are refreshed on E', () => {
    const h = fixture(), mount = mountData()
    h.careerMounts.activeMount = mount; h.nearNpc()
    h.town.interaction(); expect(h.hint.textContent).toBe('E 與 騎兵隊長 交談')
    h.pressE(); expect(h.dialog.openedFor).toBe('captain'); expect(h.player.isMounted).toBe(false)
    h.dialog.openedFor = null; h.nearNpc().set(20, 0, 20)
    h.pressE()
    expect(h.dialog.openedFor).toBeNull(); expect(h.player.currentMount).toBe(mount)
  })

  it('chooses the nearest eligible own or battlefield mount and refreshes the 3m boundary on E', () => {
    const h = fixture(), own = mountData(MountType.HORSE, 0, 2.99), leftover = mountData(MountType.CORGI)
    h.careerMounts.activeMount = own; h.temporaryMounts.all = [own, leftover]; h.outskirts.mounts = [leftover]
    h.town.interaction(); expect(h.hint.textContent).toBe('E 騎乘 柯基')
    h.pressE(); expect(h.player.currentMount).toBe(leftover)
    h.player.dismountFromMount(); h.temporaryMounts.all = []; h.outskirts.mounts = []
    h.town.interaction(); expect(h.hint.textContent).toBe('E 騎乘 戰馬')
    own.group.position.z = 3.01
    h.pressE(); expect(h.player.isMounted).toBe(false); expect(h.hint.textContent).toBe('')
  })

  it('rejects dead, disposed, occupied and reserved mounts from every candidate source', () => {
    const h = fixture(), dead = mountData(), disposed = mountData(), occupied = mountData(), controlled = mountData(), reserved = mountData()
    dead.state = MountState.DEAD; disposed.disposed = true
    occupied.riderNpc = {} as NPC // Identity only; no NPC behavior is called.
    controlled.state = MountState.CONTROLLED; reserved.reservedForTown = true
    h.careerMounts.activeMount = dead; h.temporaryMounts.all = [disposed, occupied]; h.outskirts.mounts = [controlled, reserved]
    h.town.interaction(); expect(h.hint.textContent).toBe('')
    h.pressE(); expect(h.player.isMounted).toBe(false)
  })

  it.each(['airborne', 'elevated'] as const)('%s eagle cannot be remounted from ground', state => {
    const h = fixture(), eagle = mountData(MountType.XONGKORO)
    if (state === 'airborne') Object.assign(eagle.flight!, { phase: 'flying' })
    else eagle.group.position.y = 20
    h.careerMounts.activeMount = eagle
    h.town.interaction(); expect(h.hint.textContent).toBe('')
    h.pressE(); expect(h.player.isMounted).toBe(false)
  })

  it('grounded eagle seat permits NPC dialog but flight and falling suppress it', () => {
    const h = fixture(), eagle = mountData(MountType.XONGKORO)
    h.player.mountVehicle(eagle); h.player.position.y = 8; h.nearNpc()
    h.town.interaction(); expect(h.hint.textContent).toBe('E 與 騎兵隊長 交談')
    h.pressE(); expect(h.dialog.openedFor).toBe('captain'); expect(h.player.currentMount).toBe(eagle)
    h.dialog.openedFor = null; Object.assign(eagle.flight!, { phase: 'flying' })
    h.town.interaction(); expect(h.hint.textContent).toBe('E 下馬')
    h.pressE(); expect(h.dialog.openedFor).toBeNull(); expect(h.player.isMounted).toBe(false)
    h.player.isFalling = true; h.careerMounts.activeMount = mountData()
    h.town.interaction(); expect(h.hint.textContent).toBe('')
    h.pressE(); expect(h.dialog.openedFor).toBeNull(); expect(h.player.isMounted).toBe(false)
  })

  it.each(['height', 'facing', 'distance', 'obstacle', 'hostile', 'defense', 'service'] as const)('NPC %s restriction still prevents dialog', restriction => {
    const h = fixture(); h.nearNpc()
    if (restriction === 'height') h.player.position.y = 20
    if (restriction === 'facing') h.player.facingYaw = Math.PI
    if (restriction === 'distance') h.nearNpc().z = 2.7
    if (restriction === 'obstacle') h.world.obstacles.push({ box: new THREE.Box3(new THREE.Vector3(-1, 0, .5), new THREE.Vector3(1, 3, 1)) })
    if (restriction === 'hostile') h.event.hostile = true
    if (restriction === 'defense') h.defense.active = true
    if (restriction === 'service') h.event.allActors.set('captain', { dead: true })
    h.town.interaction(); expect(h.hint.textContent).not.toMatch(/交談/)
    h.pressE(); expect(h.dialog.openedFor).toBeNull()
  })

  it('Formation placement retains E ownership even beside an NPC while mounted', () => {
    const h = fixture(), mount = mountData()
    h.player.mountVehicle(mount); h.nearNpc(); h.personalCommands.isFormationPlacementMode = true
    const key = h.pressE()
    expect(key.preventDefault).not.toHaveBeenCalled(); expect(key.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(h.dialog.openedFor).toBeNull(); expect(h.player.currentMount).toBe(mount)
  })

  it('equipment and dead-player gates retain E ownership', () => {
    const h = fixture(); h.careerMounts.activeMount = mountData(); h.nearNpc()
    h.equipment.visible = true; h.pressE()
    h.equipment.visible = false; h.player.dead = true; h.pressE()
    h.town.interaction()
    expect(h.dialog.openedFor).toBeNull(); expect(h.player.isMounted).toBe(false)
    expect(h.hint.style.display).toBe('none')
  })
})
