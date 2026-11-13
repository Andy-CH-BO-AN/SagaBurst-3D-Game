import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { showEquipmentLoadNotice } from '../../src/ui/EquipmentLoadNotice'
import { BYZANTINE_EQUIPMENT_RETRY_MS, BYZANTINE_EQUIPMENT_WAIT_MS, byzantineEquipmentStatus, isEquipmentDemanded, resetHighTierEquipmentForTest } from '../../src/world/HighTierEquipment'
import { AIState, AIType, Faction, NPC } from '../../src/world/NPC'

vi.mock('../../src/ui/EquipmentLoadNotice', () => ({ showEquipmentLoadNotice: vi.fn() }))
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async parseAsync() { return { scene: { traverse() { } } } }
  }
}))
const gltfLoads = { next: [] as Array<() => Promise<unknown>>, count: 0 }
const SHIELD = 'byzantine_eagle_shield_t5'
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })

interface GatedActor {
  meleeWeaponId: string | null
  shieldId: string | null
  hasActiveShield: boolean
  rebuildShield: ReturnType<typeof vi.fn>
  _adoptLoadedEquipment(): void
  dispose(): void
}
/** Real equipment slots and adoption; mesh rebuilding is the external boundary. */
function actorHolding(shieldId: string | null): GatedActor {
  const actor = Object.assign(Object.create(NPC.prototype) as GatedActor, {
    _tier: 5, _faction: Faction.ENEMY, _aiType: AIType.MELEE, state: AIState.IDLE, rangedActive: false, townArmed: false,
    heldMeleeWeaponId: 'steel_lance', selectedMeleeWeaponId: 'steel_lance', heldShieldId: null, selectedShieldId: null,
    animator: { cancel: vi.fn(), setEquipment: vi.fn() }, rebuildShield: vi.fn(),
    combatEventBindings: [], pendingFall: { clear: vi.fn() }, mount: null, rig: { animation: { stop: vi.fn() } },
    characterVisualGroup: { traverse: vi.fn(), removeFromParent: vi.fn() },
    alertSprite: { material: { map: { dispose: vi.fn() }, dispose: vi.fn() } },
    group: { removeFromParent: vi.fn() },
  })
  if(shieldId) actor.shieldId = shieldId
  return actor
}

describe('NPC 裝備採用與需求生命週期', () => {
  beforeEach(() => {
    vi.useFakeTimers(); resetHighTierEquipmentForTest()
    gltfLoads.count = 0; gltfLoads.next = []
    vi.stubGlobal('fetch', () => { gltfLoads.count++; return (gltfLoads.next.shift() ?? (() => new Promise(() => { })))() })
  })
  afterEach(() => { resetHighTierEquipmentForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.mocked(showEquipmentLoadNotice).mockClear() })

  it('NPC 盾牌未載入時不能格擋，正式採用就緒裝備後才生效', async () => {
    gltfLoads.next.push(() => Promise.reject(new Error('404')))
    const spawned = actorHolding(null), reequipped = actorHolding('scutum_t1')
    spawned.shieldId = SHIELD
    reequipped.shieldId = SHIELD
    await vi.advanceTimersByTimeAsync(0)
    expect(byzantineEquipmentStatus(SHIELD)).toBe('failed')

    expect([spawned.shieldId, spawned.hasActiveShield]).toEqual([null, false])
    expect([reequipped.shieldId, reequipped.hasActiveShield]).toEqual(['scutum_t1', true])
    expect(spawned.meleeWeaponId).toBe('steel_lance')
    spawned._adoptLoadedEquipment()
    expect(spawned.rebuildShield).not.toHaveBeenCalled()
    expect(gltfLoads.count).toBe(1)

    gltfLoads.next.push(() => Promise.resolve(response()))
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_RETRY_MS)
    spawned._adoptLoadedEquipment()
    expect(gltfLoads.count).toBe(2)
    await vi.advanceTimersByTimeAsync(0)

    for(const actor of [spawned, reequipped]) {
      actor._adoptLoadedEquipment()
      expect(actor.rebuildShield).toHaveBeenCalledTimes(1)
      expect([actor.shieldId, actor.hasActiveShield]).toEqual([SHIELD, true])
    }
    expect(spawned.meleeWeaponId).toBe('steel_lance')
  })

  it('NPC 換盾保留其他持有者需求，最後持有者離場後解除需求', async () => {
    const first = actorHolding(SHIELD), second = actorHolding(SHIELD)
    first.shieldId = 'scutum_t1'
    expect(isEquipmentDemanded(SHIELD)).toBe(true)
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(byzantineEquipmentStatus(SHIELD)).toBe('failed')
    expect(showEquipmentLoadNotice).toHaveBeenCalledTimes(1)
    vi.mocked(showEquipmentLoadNotice).mockClear()
    second.dispose()
    expect(isEquipmentDemanded(SHIELD)).toBe(false)
    await vi.advanceTimersByTimeAsync(BYZANTINE_EQUIPMENT_RETRY_MS + BYZANTINE_EQUIPMENT_WAIT_MS)
    expect(showEquipmentLoadNotice).not.toHaveBeenCalled()
    first.dispose()
  })
  it('兩名 NPC 共用盾牌需求時，離場只釋放自己的需求', () => {
    const first = actorHolding(SHIELD), second = actorHolding(SHIELD)
    first.dispose()
    expect(isEquipmentDemanded(SHIELD)).toBe(true)
    second.dispose()
    expect(isEquipmentDemanded(SHIELD)).toBe(false)
  })
})
