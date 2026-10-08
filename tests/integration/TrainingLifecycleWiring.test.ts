import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import { Player } from '../../src/player/Player'
import { MountType } from '../../src/world/Mount'
import { AimTargetRegistry } from '../../src/world/AimTargetRegistry'
import { CombatEventStream, type CombatEvent } from '../../src/combat/CombatAttribution'
import { SkillManager } from '../../src/rpg/SkillManager'
import { createTrainingInventory } from '../../src/training/TrainingGroundPlan'
import type { TrainingGround } from '../../src/training/TrainingGround'
import { SaveManager, DEFAULT_SAVE } from '../../src/save/SaveManager'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createGameTestFixture } from '../helpers/gameFixture'
import { MemoryStorage, installStorageGlobals } from '../helpers/memoryStorage'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: { ready: true, createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual },
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/XongkoroVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/XongkoroVisual')>()),
  XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble,
}))
vi.mock('../../src/ui/TrainingGroundUI', () => ({ TrainingGroundUI: class {
  damage: string | null = null
  setDamage(text: string | null) { this.damage = text }
  updateLabels() {}
  dispose() {}
} }))

interface TrainingGameApi {
  _initializeTrainingGround(): void
  _mountPlayer(mount: import('../../src/world/Mount').Mount): void
  _resetTraining(): void
  _refillTraining(): void
  _saveGame(): void
  _loadGame(): void
  _awardPlayerSkillXpFromEvent(event: CombatEvent): void
  _applyPlayerSkillAward(award: { skill: 'blocking'; xp: number }): void
}

/** 1 real Player + 4 real Mounts, zero NPC/TownWorld/GLBs; only visual/UI boundaries replaced. */
function fixture() {
  const scene = new THREE.Scene(), player = new Player(scene), storage = new MemoryStorage()
  onTestFinished(() => player.dispose())
  onTestFinished(installStorageGlobals({ localStorage: storage }))
  const node = () => ({ textContent: '', style: { display: '', width: '' }, classList: { add() {}, remove() {}, toggle() {} } })
  const skills = new SkillManager()
  const fields = {
    isTrainingGround: true, scene, player, mounts: [] as import('../../src/world/Mount').Mount[], npcs: [],
    trainingGround: null as TrainingGround | null, trainingUI: null as { damage: string | null; dispose(): void } | null,
    trainingDamageUnsubscribe: undefined as (() => void) | undefined,
    combatEvents: new CombatEventStream(), _aimTargetRegistry: new AimTargetRegistry(),
    controlsHint: node(), lockOverlay: node(), mountNameEl: node(), mountHpFill: node(), mountHud: node(), enemyHud: node(),
    deathBanner: node(), spectatorBadge: node(), deathBannerTimer: null,
    camera: new THREE.PerspectiveCamera(58, 1, .1, 500), obstacles: [], arrows: [] as { destroy(): void }[],
    input: { clear() {}, keys: {}, isRightMouseDown: false, consumeMouseDelta: () => ({ dx: 0, dy: 0 }) },
    damageNumbers: { clear() {} }, hpBar: { setFill() {} }, staminaBar: { setFill() {} }, quiverUI: { setArrowCount() {} },
    controlMode: 'player', equipmentUI: { visible: false }, inventoryManager: createTrainingInventory(), skillManager: skills,
    saveManager: new SaveManager(storage), defenseCampaignConfig: null, soundManager: { playSkillLevelUp() {} },
  }
  // Prototype seam exposes just these production methods; Game itself is never mocked.
  const game = createGameTestFixture(fields) as unknown as typeof fields & TrainingGameApi
  onTestFinished(() => {
    game.trainingDamageUnsubscribe?.(); game.trainingUI?.dispose(); game.trainingGround?.dispose(); game._aimTargetRegistry.clear()
  })
  game._initializeTrainingGround()
  return { game, player, storage, skills }
}

describe('Training lifecycle and persistence wiring', () => {
  it('initializes static targets and all mounts without enemies, refills while mounted and resets an airborne/dead eagle repeatedly in place', () => {
    const { game, player } = fixture()
    expect(game.npcs).toEqual([])
    expect(game.mounts.map(m => m.type).sort()).toEqual(['BLACK_CAT', 'CORGI', 'HORSE', 'xongkoro'].sort())
    expect(game.trainingGround!.dummies).toHaveLength(11)
    const identities = game.mounts.map(m => m.group.uuid), targets = game.trainingGround!.dummies.map(d => d.group.uuid)
    const sceneCount = game.scene.children.length
    const horse = game.mounts.find(m => m.type === MountType.HORSE)!
    game._mountPlayer(horse)
    player.setHp(10); player.setArrowCount(0); player.rebuildShield('round_shield_t3'); player.shield.absorb(0, 20)
    horse.currentHp = 10
    game._refillTraining()
    expect(player.hp).toBe(player.maxHp); expect(player.arrowCount).toBe(30)
    expect(player.shield.shieldImpactRemaining).toBe(20)
    expect(player.currentMount).toBe(horse); expect(horse.currentHp).toBe(horse.maxHp)
    game._resetTraining()
    const eagle = game.mounts.find(m => m.type === MountType.XONGKORO)!
    game._mountPlayer(eagle)
    eagle.setFlightIntent({ yaw: Math.PI, pitch: .32, takeoff: true })
    eagle.finishControlledFrame(.1, [])
    expect(eagle.isAirborne).toBe(true)
    eagle.takeDamage(1000)
    expect(player.isFalling).toBe(true)
    const projectile = { destroy: vi.fn() }; game.arrows.push(projectile)
    game.trainingUI!.damage = 'old damage'
    for (let i = 0; i < 3; i++) game._resetTraining()
    expect(player.currentMount).toBeNull(); expect(player.isMounted).toBe(false); expect(player.isFalling).toBe(false)
    expect(eagle.flight?.phase).toBe('grounded'); expect(eagle.dead).toBe(false); expect(eagle.riderPlayer).toBeNull()
    expect(game.arrows).toEqual([]); expect(projectile.destroy).toHaveBeenCalledOnce()
    expect(game.trainingUI!.damage).toBeNull()
    expect(game.scene.children.length).toBe(sceneCount)
    expect(game.mounts.map(m => m.group.uuid)).toEqual(identities)
    expect(game.trainingGround!.dummies.map(d => d.group.uuid)).toEqual(targets)
    expect(game.mounts.every(m => m.visualHold && m.currentHp === m.maxHp)).toBe(true)
    expect(player.position.x).toBe(105); expect(player.position.z).toBe(47)
  })

  it('blocks all combat/blocking XP and RPG save/load writes while preserving a real serialized Career profile', () => {
    // Persistence/progression guards need zero actors, assets or training props.
    const storage = new MemoryStorage(), skills = new SkillManager()
    onTestFinished(installStorageGlobals({ localStorage: storage }))
    const player = { position: new THREE.Vector3(105, 0, 47), dead: false }
    const fields = { isTrainingGround: true, player, controlMode: 'player', skillManager: skills, inventoryManager: createTrainingInventory(), saveManager: new SaveManager(storage), defenseCampaignConfig: null }
    const game = createGameTestFixture(fields) as unknown as typeof fields & TrainingGameApi
    const career = new CareerProfileStore(storage), profile = createCareerProfile('roman')
    expect(career.save(profile)).toBe(true)
    expect(game.saveManager.save({ ...DEFAULT_SAVE, position: { x: 1, y: 2, z: 3 } })).toBe(true)
    const serialized = Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!)])
    const before = skills.skillState, storedProfile = career.loadChecked().profile
    for (const method of ['melee', 'projectile', 'mount-impact'] as const) {
      game._awardPlayerSkillXpFromEvent({ type: 'damage_applied', method, source: { actorId: 'player', actorType: 'player', allegiance: 'PLAYER' as import('../../src/world/NPC').Faction, characterFaction: 'viking' }, target: { targetId: 'mount:training', targetType: 'mount', name: 'parked mount' }, requestedDamage: 100, appliedDamage: 100 })
    }
    game._applyPlayerSkillAward({ skill: 'blocking', xp: 1000 })
    game._saveGame(); game._loadGame()
    expect(skills.skillState).toEqual(before)
    expect(player.position.x).toBe(105)
    expect(Array.from({ length: storage.length }, (_, index) => [storage.key(index), storage.getItem(storage.key(index)!)] )).toEqual(serialized)
    expect(career.loadChecked().profile).toEqual(storedProfile)
  })
})
