import { Vector3, Box3 } from 'three'
import { Mount, MountState } from '../../src/world/Mount'
import { finishMountGroundMotion, settleMountOnTerrain } from '../../src/world/MountGroundBody'
import type { NPC } from '../../src/world/NPC'
import type { Player } from '../../src/player/Player'
import { resolveMountImpacts, checkMountImpact, applyMountImpactKnockback, type MountImpactOptions } from '../../src/combat/MountImpact'
import { damagePlayer } from '../../src/combat/DamageRouter'
import { claimFlatTerrainOverride, getTerrainHeight, releaseFlatTerrainOverride } from '../../src/world/Terrain'
import { Faction } from '../../src/combat/CombatFaction'
import { describe, expect, it, onTestFinished } from 'vitest'
import { MountArmor, mountImpactMultiplier } from '../../src/combat/MountArmor'
import { calculateLanceChargeDamage, calculateMountImpactDamage } from '../../src/combat/CombatBalance'
import type { CombatDamageContext } from '../../src/combat/CombatAttribution'
const context = (weaponId: string, method: CombatDamageContext['method'] = 'melee'): CombatDamageContext => ({
  weaponId, method, source: { actorId: 'attacker', actorType: 'npc', allegiance: Faction.ENEMY, characterFaction: 'roman', isMounted: true },
})

describe('Mount armor', () => {
  it('uses existing weapon tier Impact for sword, axe, mounted lance, bow and javelin', () => {
    // Independent database expectations; each row checks the shared Impact contract, not another damage formula.
    const impacts: Array<[string, number]> = [['steel_sword', 1], ['viking_axe_t1', 2], ['viking_axe_t2', 4], ['viking_axe_t3', 8], ['paladin_mace_t4', 12], ['axe_t5', 15], ['hunting_spear', 10], ['steel_lance', 20], ['heavy_lance', 40], ['spear_t4', 60], ['spear_t5', 80], ['bow_t5', 1], ['legionary_pilum', 1]]
    for (const [weapon, impact] of impacts) {
      const armor = new MountArmor('ARMORED_HORSE')
      expect(armor.absorbWeapon(80, context(weapon)), weapon).toEqual({ blockedImpact: Math.min(50, impact), damage: impact <= 50 ? 0 : 80 * (impact - 50) / impact })
    }
  })
  it('bypasses barding for environmental and natural attacks without spending durability', () => {
    const armor = new MountArmor('SNOW_LEOPARD')
    expect(armor.absorbWeapon(80, context('axe_t5', 'fall'))).toEqual({ damage: 80, blockedImpact: 0 })
    expect(armor.absorbWeapon(80, context('axe_t5', 'mount-impact'))).toEqual({ damage: 80, blockedImpact: 0 })
    expect(armor.absorbWeapon(80, { ...context('axe_t5'), attackSource: 'xongkoro' })).toEqual({ damage: 80, blockedImpact: 0 })
    expect(armor.remaining).toBe(50)
    expect(new MountArmor('HORSE').absorbWeapon(80, context('axe_t5'))).toEqual({ damage: 80, blockedImpact: 0 })
  })
  it('preserves depleted armor on restore and refills only on explicit service reset', () => {
    expect(new MountArmor('HORSE').max).toBe(0)
    expect(new MountArmor('ARMORED_HORSE').max).toBe(50)
    const armor = new MountArmor('SNOW_LEOPARD')
    expect(armor.max).toBe(50)
    armor.restore(0); expect(armor.remaining).toBe(0)
    expect(armor.absorbWeapon(20, context('axe_t5'))).toEqual({ damage: 20, blockedImpact: 0 })
    armor.reset(); expect(armor.remaining).toBe(50)
    armor.restore(-5); expect(armor.remaining).toBe(0)
    armor.restore(90); expect(armor.remaining).toBe(50)
    armor.restore(); expect(armor.remaining).toBe(50)
  })
  it('resolves impact with type multiplier, allegiance, cooldown and lance suppression across routes', () => {
    for (const route of ['player-npc', 'npc-player', 'npc-npc'] as const) {
      const actor = (id: string, faction: Faction) => ({
        combatantId: id, name: id, faction, characterFaction: 'roman' as const, hp: 200, maxHp: 200,
        dead: false, isMounted: false, mount: null, currentMount: null, targetable: true, spectatorOnly: false,
        group: { uuid: id, position: new Vector3() }, combatPosition: new Vector3(), position: new Vector3(),
        get hpRatio() { return this.hp / this.maxHp },
        takeDamage(amount: number) { this.hp -= amount; return true },
      })
      const player = actor('player', Faction.PLAYER) as unknown as Player
      const target = actor('target', Faction.ENEMY) as unknown as NPC
      const ally = actor('ally', route === 'npc-player' ? Faction.ENEMY : Faction.PLAYER) as unknown as NPC
      const mount = {
        state: MountState.CONTROLLED, dead: false, isFlyingMount: false, skipImpactThisFrame: false,
        movementSpeed: 12, isSprinting: false, impactMultiplier: 2.5,
        group: { position: new Vector3(0, 0, 1) }, previousPosition: new Vector3(0, 0, -1),
        impactTimes: new Map<object, number>(), canImpact: Mount.prototype.canImpact,
        riderFaction: route === 'npc-player' ? Faction.ENEMY : Faction.PLAYER,
        riderNpc: route === 'player-npc' ? null : ally,
      } as unknown as Mount
      if (route === 'player-npc') player.currentMount = mount
      const options: MountImpactOptions = { playerDamageMultiplier: 1.2,
        onDamagePlayer: (amount, context) => damagePlayer(player, amount, { setFill() {} }, null, context) }
      const npcs = route === 'npc-player' ? [ally] : [target, ally]
      resolveMountImpacts([mount], player, npcs, 0, options)
      expect(route === 'npc-player' ? player.hp : target.hp).toBe(route === 'player-npc' ? 122 : 135)
      expect(ally.hp).toBe(200)
      resolveMountImpacts([mount], player, npcs, .1, options)
      expect(route === 'npc-player' ? player.hp : target.hp).toBe(route === 'player-npc' ? 122 : 135)
      mount.skipImpactThisFrame = true
      resolveMountImpacts([mount], player, npcs, 1, options)
      expect(route === 'npc-player' ? player.hp : target.hp).toBe(route === 'player-npc' ? 122 : 135)
    }
  })
  it('suppresses an embedded mount correction sweep and still damages a bandit during ordinary charge travel', () => {
    const groundOwner = {}
    claimFlatTerrainOverride(groundOwner, 0)
    onTestFinished(() => { releaseFlatTerrainOverride(groundOwner) })
    const actor = (id: string, faction: Faction) => ({
      combatantId: id, name: id, faction, characterFaction: 'roman' as const, hp: 200, maxHp: 200,
      dead: false, isMounted: false, mount: null, currentMount: null, targetable: true, spectatorOnly: false,
      group: { uuid: id, position: new Vector3() }, combatPosition: new Vector3(), position: new Vector3(),
      get hpRatio() { return this.hp / this.maxHp },
      takeDamage(amount: number) { this.hp -= amount; return true },
    })
    const player = actor('player', Faction.PLAYER) as unknown as Player
    const bandit = actor('recruit-bandits-01:bandit:0', Faction.BANDIT) as unknown as NPC
    const ally = actor('field-ally', Faction.PLAYER) as unknown as NPC
    const mount = {
      state: MountState.CONTROLLED, dead: false, isFlyingMount: false, skipImpactThisFrame: false,
      movementSpeed: 0, isSprinting: false, impactMultiplier: 2.5,
      group: { position: new Vector3(0, 0, -1) }, previousPosition: new Vector3(0, 0, -1),
      impactTimes: new Map<object, number>(), canImpact: Mount.prototype.canImpact, riderFaction: Faction.PLAYER, riderNpc: null,
    } as unknown as Mount
    player.currentMount = mount
    const events: { type: string; source: { actorId: string }; method: string }[] = []
    const hits: string[] = []
    const options: MountImpactOptions = { playerDamageMultiplier: 1.2,
      onDamagePlayer: (amount, context) => damagePlayer(player, amount, { setFill() {} }, null, context),
      combatEvents: event => events.push(event as never), onPlayerMountHitNpcAudio: (_damage, _mount, npc) => hits.push(npc.combatantId) }
    const blocker = { isBarricade: false, box: new Box3(new Vector3(-5, -2, -6), new Vector3(5, 6, 1)) }
    const position = mount.group.position
    const dt = 1 / 60
    mount.movementSpeed = finishMountGroundMotion(position, mount.previousPosition,
      settleMountOnTerrain(position, 0, dt), dt, [blocker]).movementSpeed
    expect(mount.group.position.z).toBeGreaterThanOrEqual(blocker.box.max.z + 1)
    expect(mount.movementSpeed).toBe(0)
    expect(checkMountImpact(mount, bandit.combatPosition, .5)).toBe(false)
    resolveMountImpacts([mount], player, [ally, bandit], 0, options)
    expect(bandit.hp).toBe(200)

    mount.previousPosition.set(0, 0, -1)
    position.set(0, 0, 1)
    const chargeDt = 1 / 6
    mount.movementSpeed = finishMountGroundMotion(position, mount.previousPosition,
      settleMountOnTerrain(position, 0, chargeDt), chargeDt, []).movementSpeed
    resolveMountImpacts([mount], player, [ally, bandit], 1, options)
    expect(bandit.hp).toBe(122)
    expect(ally.hp).toBe(200)
    expect(hits).toEqual(['recruit-bandits-01:bandit:0'])
    expect(events.find(event => event.type === 'damage_applied')).toMatchObject({ source: { actorId: 'player' }, method: 'mount-impact' })
  })

  it('stops infantry impact displacement at physical walls and navigable foundations', () => {
    const y = getTerrainHeight(0, 0), position = new Vector3(0, y, 0)
    const target = { dead: false, isMounted: false, group: { position } } as unknown as NPC
    const mount = { impactMultiplier: 2.5, movementSpeed: 12, group: { position: new Vector3(0, y, .1) }, previousPosition: new Vector3(0, y, -.1) } as unknown as Mount
    const box = new Box3(new Vector3(-2, y - 2, .65), new Vector3(2, y + 4, .8))
    for (const obstacle of [
      { isBarricade: false, box },
      { isBarricade: false, box, navigationPassable: true, solidBelow: y - 2,
        walkSurface: { startX: 0, startZ: .65, startY: y + 1, topY: y + 4,
          dirX: 0, dirZ: 1, length: .2, landing: 0, halfWidth: 2 } },
    ]) {
      position.set(0, y, 0)
      applyMountImpactKnockback(mount, target, { worldBound: 10, obstacles: [obstacle] })
      expect(position.z).toBeGreaterThan(0)
      expect(position.z).toBeLessThan(.16)
    }
  })
  it('multiplies only the rounded impact formula while preserving sprint and lance skipImpact', () => {
    expect(calculateMountImpactDamage(12, false, mountImpactMultiplier('HORSE'))).toBe(26)
    expect(calculateMountImpactDamage(12, false, mountImpactMultiplier('ARMORED_HORSE'))).toBe(65)
    expect(calculateMountImpactDamage(12, true, mountImpactMultiplier('SNOW_LEOPARD'))).toBe(88)
    expect(calculateMountImpactDamage(12, true, mountImpactMultiplier('ARMORED_HORSE'))).toBe(88)
    expect(calculateLanceChargeDamage(80, 'lance', true, 10.5 * 1.5)).toEqual({ damage: 240, isCharge: true, skipImpact: true })
  })
})
