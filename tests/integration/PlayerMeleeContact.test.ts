import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Game } from '../../src/Game'
import { Player } from '../../src/player/Player'
import type { PlayerInput } from '../../src/player/PlayerInput'
import type { StaminaBar } from '../../src/ui/StaminaBar'
import type { QuiverUI } from '../../src/ui/QuiverUI'
import type { SoundManager } from '../../src/audio/SoundManager'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { CombatEventStream, type CombatEvent } from '../../src/combat/CombatAttribution'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { SpatialGrid } from '../../src/world/SpatialGrid'

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))

type UpdateBoundaryArgs = [
  number,
  Pick<PlayerInput, 'keys' | 'isLeftMouseDown' | 'isRightMouseDown' | 'consumeLeftClick' | 'consumeLeftClickRelease'>,
  number, THREE.Vector3, [], Pick<StaminaBar, 'setFill'>,
  Pick<QuiverUI, 'setAiming' | 'setChargeRatio' | 'setShieldBlocked'>,
  Pick<SoundManager, 'playBowRelease'>, InventoryManager,
]

function fixture(mounted: boolean, x: number, z: number) {
  const scene = new THREE.Scene()
  const player = new Player(scene)
  onTestFinished(() => player.dispose())
  player.setPosition(0, 50.95, 0)
  player.faceDirection(0, 1)
  const target = new NPC(scene, x, z, Faction.ENEMY, 'roman', AIType.MELEE, 'Target', 1, false,
    { meleeWeaponId: 'steel_sword', rangedWeaponId: null, shieldId: null, mountId: null })
  onTestFinished(() => target.dispose())
  target.group.position.set(x, 50, z)
  const inventory = new InventoryManager({ meleeWeaponId: 'heavy_lance', rangedWeaponId: 'wooden_shortbow', shieldId: null })
  inventory.rangedEnabled = false
  const mount = mounted ? new Mount(scene, MountType.HORSE, 0, 0, 50) : null
  if (mount) {
    onTestFinished(() => mount.dispose())
    player.mountVehicle(mount)
    expect(mount.horseVisual).not.toBeNull()
  }
  const events: CombatEvent[] = []
  const combatEvents = new CombatEventStream()
  onTestFinished(combatEvents.subscribe(event => events.push(event)))
  const npcGrid = new SpatialGrid<NPC>()
  npcGrid.insert(target)
  const combatMountGrid = new SpatialGrid<Mount>()
  if (mount) combatMountGrid.insert(mount)
  const caller = {
    player, controlMode: 'player' as const, inventoryManager: inventory,
    skillManager: { getMultiplier: () => 1 },
    npcGrid, combatMountGrid, combatEvents,
    _nearbyNpcBuffer: [] as NPC[], meleeMountCandidates: [] as Mount[],
    _tmpGripPos: new THREE.Vector3(),
    soundManager: { playLanceImpact: vi.fn(), playSwordHit: vi.fn() },
    damageNumbers: { spawn: vi.fn() },
    _showEnemyHud: vi.fn(),
    _tryDamageObstacleWithMelee: vi.fn(() => false),
  }
  // Private caller seam only: this fixture lists the dependencies consumed by the real entry.
  const checkHits = (Game.prototype as unknown as {
    _checkPlayerMeleeHits(this: typeof caller): void
  })._checkPlayerMeleeHits
  const update = (click: boolean) => {
    const args: UpdateBoundaryArgs = [
      .01, { keys: {}, isLeftMouseDown: false, isRightMouseDown: false,
        consumeLeftClick: () => click, consumeLeftClickRelease: () => false },
      0, new THREE.Vector3(0, 51, 10), [], { setFill() {} },
      { setAiming() {}, setChargeRatio() {}, setShieldBlocked() {} },
      { playBowRelease() {} }, inventory,
    ]
    // DOM/input/audio boundaries omit private UI/listener/audio state; Player.update remains real.
    player.update(...args as unknown as Parameters<Player['update']>)
  }
  const armAttack = () => {
    update(true)
    for (let frame = 1; frame <= 60 && !player.isHitFrame(inventory.equippedMelee); frame++) update(false)
    expect(player.isHitFrame(inventory.equippedMelee), `mounted=${mounted}; attack must enter its hit window within 60 frames`).toBe(true)
  }
  return { player, target, mount, inventory, events, caller, armAttack, checkHits: () => checkHits.call(caller) }
}

describe.each([false, true])('Player melee contact wiring mounted=%s', mounted => {
  it.each([
    ['close', .2, 2.2, 140],
    ['extended', .2, 3.3, 140],
    ['beyond blade', .2, 3.6, 200],
    ['behind', .2, -1.5, 200],
    ['side', 2.5, 2.5, 200],
  ] as const)('%s target receives only actual physical lance contact', (_scenario, x, z, expectedHp) => {
    const f = fixture(mounted, x, z)
    f.armAttack()
    // Explicit blade input isolates contact/wiring from authored animation reach.
    f.player.weaponSweep.reset()
    f.player.weaponSweep.capture(new THREE.Vector3(.2, 51, 1), new THREE.Vector3(.2, 51, 3.05))
    f.checkHits()
    expect(f.target.hp).toBe(expectedHp)
    expect(f.player.hp).toBe(200)
    expect(f.mount?.currentHp ?? 100).toBe(100)
    const damageEvents = f.events.filter(event => event.type === 'damage_applied')
    if (expectedHp === 140) {
      expect(damageEvents).toHaveLength(1)
      expect(damageEvents[0]).toMatchObject({ method: 'melee', appliedDamage: 60, target: { targetType: 'npc' } })
      expect(f.caller._showEnemyHud).toHaveBeenCalledWith('Target', .7)
      f.checkHits()
      expect(f.target.hp).toBe(140)
      expect(f.events.filter(event => event.type === 'damage_applied')).toHaveLength(1)
    } else {
      expect(damageEvents).toHaveLength(0)
      expect(f.caller._showEnemyHud).not.toHaveBeenCalled()
    }
  })

  it('consumes the blade samples produced by real Player.update without replacing the sweep', () => {
    const f = fixture(mounted, 4, 4)
    f.armAttack()
    const grip = f.player.getWeaponGripPosition(new THREE.Vector3())
    const tip = f.player.getSwordTipPosition()
    const pointOnBlade = grip.clone().lerp(tip, .5)
    f.target.group.position.set(pointOnBlade.x, pointOnBlade.y - .9, pointOnBlade.z)
    f.caller.npcGrid.clear()
    f.caller.npcGrid.insert(f.target)
    f.checkHits()
    expect(f.target.hp).toBe(140)
    expect(f.events.filter(event => event.type === 'damage_applied')).toHaveLength(1)
    f.checkHits()
    expect(f.target.hp).toBe(140)
  })

  it('catches swept contact when both the previous and final blade miss the target', () => {
    const f = fixture(mounted, .2, 2.5)
    f.armAttack()
    const previousGrip = new THREE.Vector3(.2, 51, 1)
    const previousTip = new THREE.Vector3(.2, 51, 1.5)
    const currentGrip = new THREE.Vector3(.2, 51, 3)
    const currentTip = new THREE.Vector3(.2, 51, 3.5)
    f.player.weaponSweep.reset()
    f.player.weaponSweep.capture(previousGrip, previousTip)
    expect(f.player.weaponSweep.trace(f.target)).toBeUndefined()
    f.player.weaponSweep.reset()
    f.player.weaponSweep.capture(currentGrip, currentTip)
    expect(f.player.weaponSweep.trace(f.target)).toBeUndefined()
    f.player.weaponSweep.reset()
    f.player.weaponSweep.capture(previousGrip, previousTip)
    f.player.weaponSweep.capture(currentGrip, currentTip)
    f.checkHits()
    expect(f.target.hp).toBe(140)
    expect(f.mount?.currentHp ?? 100).toBe(100)
    expect(f.events.filter(event => event.type === 'damage_applied')).toHaveLength(1)
    f.checkHits()
    expect(f.target.hp).toBe(140)
  })
})
