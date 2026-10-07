import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as THREE from 'three'
import { type CombatContact } from '../../src/combat/ShieldBlocking'
import { damageMount, damageNpc } from '../../src/combat/DamageRouter'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'
import { NPC } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { createTownCombatFixture } from '../helpers/townCombatFixture'

import { createMountedCombatActors, createMountedDamageContext as ctx } from '../helpers/mountedCombatActors'
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

describe('Town mounted lance damage wiring', () => {
  it.each(['mount', 'rider', 'dismounted'] as const)('Town foot lance applies anti-cavalry only to physical cavalry contacts: %s', target => {
    const { rider, mount, player } = fixture()
    rider.shield.shieldImpactRemaining = 0
    if (target === 'dismounted') {
      rider.dismountFromMount(); rider.group.position.set(0, 50, 0); mount.group.position.x = 20
    }
    const y = target === 'mount' ? 50.8 : rider.group.position.y + 1.2
    player.setPosition(0, 50.9, 3)
    player.weaponSweep.capture(new THREE.Vector3(-1, y, 3), new THREE.Vector3(1, y, 3))
    player.weaponSweep.capture(new THREE.Vector3(-1, y, -3), new THREE.Vector3(1, y, -3))
    vi.spyOn(player, 'isHitFrame').mockReturnValue(true)
    const town = createTownCombatFixture(), weapon = WEAPONS.steel_lance
    town.player = player; town.inventory = { meleeEnabled: true, equippedMelee: weapon, shieldEnabled: false }
    town.skills = { getMultiplier: () => 1 }; town.previousTip = new THREE.Vector3()
    town.world = { buildings: [], targets: [] }; town.residents = []
    town.mission = { ambientBandits: [], missionBandits: [rider] }; town.defense = { playerEnemies: [] }
    town.combatMountGrid.insert(mount)
    town.hitBattlefieldMount = (horse: Mount, amount: number) => damageMount(horse, amount)
    town.hitFieldNpc = (npc: NPC, amount: number, _method: string, _source: NPC, contact: CombatContact) => damageNpc(npc, amount, ctx(player, contact.kind, contact.mount))
    const riderHp = rider.hp
    town.melee()
    const expected = weapon.damageMax * (target === 'dismounted' ? 1 : 2)
    expect(mount.currentHp).toBe(target === 'mount' ? 100 - expected : 100)
    expect(rider.hp).toBe(target === 'mount' ? riderHp : riderHp - expected)
  })
})
