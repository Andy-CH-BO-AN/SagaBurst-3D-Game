import { MountType } from '../world/Mount'
import { XONGKORO } from '../movement/XongkoroConfig'
import { InventoryManager } from '../rpg/InventoryManager'
import { WEAPONS, T4_RANGER_BOW_RANGED_ID } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { PlayerHeroId } from '../world/HeroAssetCatalog'

export interface TrainingPoint { x: number; z: number }
export interface TrainingDummyPlacement extends TrainingPoint { distance: number }

/** World metres; the battlefield already has enough space, so its terrain is unchanged. */
export function createTrainingGroundPlan() {
  const referencePoint = { x: 100, z: 40 }
  const dummies: TrainingDummyPlacement[] = [{ ...referencePoint, distance: 0 }]
  for (let distance = 10; distance <= 100; distance += 10) {
    const angle = -1.05 + (distance / 10 - 1) * 2.1 / 9
    dummies.push({ distance, x: referencePoint.x + Math.sin(angle) * distance, z: referencePoint.z - Math.cos(angle) * distance })
  }
  // The 0m melee dummy is at the origin. Shoot from the marked forward edge
  // (outside its body), so it cannot intercept any of the ten ranged lanes.
  const firingPoint = { x: referencePoint.x, z: referencePoint.z - 1.5 }
  const parkingSpacing = Math.max(12, XONGKORO.wingClearance * 2 + 4)
  return {
    referencePoint, firingPoint, dummies,
    playerSpawn: { x: 105, z: 47 },
    weaponArea: { x: 88, z: 47 },
    runwayStart: { x: referencePoint.x, z: referencePoint.z + 125 },
    mounts: Object.values(MountType).map((type, index) => ({
      type, x: 70, z: 60 + index * parkingSpacing, yaw: Math.PI,
    })),
  }
}

/** Free scene-local inventory; still uses the official hero equipment restrictions. */
class TrainingInventory extends InventoryManager {
  constructor(private readonly trainingHero?: PlayerHeroId) {
    super({
    meleeWeaponId: 'steel_sword', rangedWeaponId: trainingHero === 'maki-archer-t4' ? T4_RANGER_BOW_RANGED_ID : 'elven_runebow', shieldId: null,
    }, trainingHero)
  }
  override canEquipWeapon(id: string): boolean {
    if (id === 'maki-ranger-bow' && this.trainingHero !== 'maki-archer-t4') return false
    return super.canEquipWeapon(id)
  }
  override itemAvailability(id: string): string {
    return id === 'maki-ranger-bow' ? '遊俠固定近戰弓 · Esc 可切換練習角色' : '訓練場免費使用'
  }
}

export function createTrainingInventory(heroId?: PlayerHeroId) {
  const inventory = new TrainingInventory(heroId)
  const owned = new Set(inventory.inventoryStacks.map(({ item }) => item.id))
  for (const id of [...Object.keys(WEAPONS), ...Object.keys(ARMORS)]) {
    if (!owned.has(id)) inventory.addWeapon(id)
  }
  return inventory
}
