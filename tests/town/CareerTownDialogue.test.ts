import { careerItemTotal } from '../../src/career/CareerInventory'
import { describe, expect, it } from 'vitest'
import { CAREER_TOWN_DIALOGUE, selectTownDialogue, formatTownDialogue, TownAmbientDialogue, type DialogueRole } from '../../src/career/CareerTownDialogue'
import { CAREER_RANKS, cloneCareerProfile, createCareerProfile } from '../../src/career/CareerProfile'
import { parseCareerProfile } from '../../src/career/CareerProfileStore'
import { grantStarter, STARTER_WEAPONS, purchaseTownHorse, productStatus, TOWN_PRODUCTS, settleTown } from '../../src/town/TownRules'
import { TownEquipment } from '../../src/town/TownEquipment'
import { townMeleeBuildingContact, townMeleeContact } from '../../src/town/TownCombat'
import { Faction, NPC, AIType } from '../../src/world/NPC'
import { Player } from '../../src/player/Player'
import { resolveEntityCollision, resolveObstacleCollision } from '../../src/world/Terrain'
import * as THREE from 'three'

describe('Peaceful dialogue', () => {
  it.each(['merchant', 'ranger', 'cat', 'captain', 'deployment'] as DialogueRole[])('%s has distinct faction voices and rank greetings', npcRole => {
    for (const rank of CAREER_RANKS) {
      const base = { npcRole, playerRank: rank }
      expect(selectTownDialogue({ ...base, townFaction: 'roman' })).not.toBe(selectTownDialogue({ ...base, townFaction: 'viking' }))
    }
    for (const faction of ['roman', 'viking'] as const) expect(new Set(Object.values(CAREER_TOWN_DIALOGUE[faction].speakers[npcRole].greetingByRank)).size).toBeGreaterThanOrEqual(3)
  })
  it('shows introductions only with firstMeet and persists faction-specific flags', () => {
    const p = createCareerProfile('roman'); p.townDialogueSeen = ['roman:merchant', 'roman:soldier-outpost']
    const loaded = parseCareerProfile(p)!, copy = cloneCareerProfile(loaded)
    copy.townDialogueSeen!.push('viking:merchant')
    expect(loaded.townDialogueSeen).toEqual(['roman:merchant', 'roman:soldier-outpost'])
    const context = { townFaction: 'roman' as const, npcRole: 'merchant' as const, playerRank: 'recruit' as const }
    const first = CAREER_TOWN_DIALOGUE.roman.speakers.merchant.firstMeet
    expect(selectTownDialogue({ ...context, firstMeet: true })).toContain(first)
    expect(selectTownDialogue(context)).not.toContain(first)
  })
  it.each(['roman', 'viking'] as const)('%s separates product failure reasons and uses narration for the cat', townFaction => {
    const context = { townFaction, npcRole: 'cat' as const, playerRank: 'recruit' as const }
    const lines = [selectTownDialogue({ ...context, isOwned: true }, 'product'), selectTownDialogue({ ...context, tierUnlocked: false }, 'product'), selectTownDialogue({ ...context, tierUnlocked: true, hasEnoughMerit: false }, 'product')]
    expect(new Set(lines).size).toBe(3)
    for (const line of lines) { expect(line).toContain('黑貓'); expect(line).not.toMatch(/[「」]/) }
    const mission = selectTownDialogue({ ...context, npcRole: 'deployment', playerRank: 'soldier' }, 'soldierFirstOutpost')
    expect(mission).toContain('其中一名士兵'); expect(mission).toContain('Outpost Duty')
  })
  it('formats merit from current rules and never invents a new rank', () => {
    const line = selectTownDialogue({ townFaction: 'roman', npcRole: 'captain', playerRank: 'veteran', nextRank: 'captain', promotionEligible: true }, 'promotion')
    expect(formatTownDialogue(line, { required: 5000, nextRank: 'captain' })).toContain('5000')
    expect(CAREER_RANKS).toHaveLength(5)
  })
  it('allows at most one ambient speaker every twelve seconds across all civilians', () => {
    const ambient = new TownAmbientDialogue()
    expect(ambient.take(0, 'roman', 'recruit')).toBeNull()
    expect(Array.from({ length: 20 }, () => ambient.take(5, 'roman', 'recruit')).filter(Boolean)).toHaveLength(1)
    expect(ambient.take(16.99, 'roman', 'recruit')).toBeNull()
    expect(ambient.take(17, 'viking', 'commander')).toBeTruthy()
  })
})

describe('Starter and military horse ownership', () => {
  it.each([...STARTER_WEAPONS])('grants only %s and keeps empty hands until an explicit legal equip', id => {
    let p = grantStarter(createCareerProfile('roman'), id)
    const inventory = new TownEquipment(() => p, next => { p = next; return true })
    expect(inventory.inventoryStacks.map(s => s.item.id)).toEqual([id]); expect(inventory.meleeEnabled).toBe(false); expect(inventory.rangedEnabled).toBe(false)
    expect(inventory.equipWeapon(id)).toBe(true)
    if (['wooden_shortbow', 'pilum_basic'].includes(id)) { expect(inventory.meleeEnabled).toBe(false); expect(inventory.rangedEnabled).toBe(true) }
  })
  it('charges repeated horse purchases and preserves lifetime merit', () => {
    const p = createCareerProfile('roman'); p.totalMerit = 3000; p.availableMerit = 2000
    expect(purchaseTownHorse(p, 'horse-t2')).toBeNull()
    const horse = purchaseTownHorse(p, 'horse')!
    expect(horse.availableMerit).toBe(1800); expect(p.ownedMounts).toEqual([])
    expect(horse.ownedMounts).toEqual(['horse']); expect(horse.selectedMountId).toBe('horse')
    expect(horse.totalMerit).toBe(3000)
    expect(careerItemTotal(purchaseTownHorse(horse, 'horse')!, 'horse')).toBe(2)
    horse.rank = 'veteran'
    expect(careerItemTotal(purchaseTownHorse(horse, 'horse')!, 'horse')).toBe(2)
    expect(parseCareerProfile(horse)?.ownedMounts).toEqual(['horse'])
    expect(purchaseTownHorse(horse, 'black-cat')).toBeNull()
  })
  it('does not charge insufficient funds or bypass new enlistment rank with retained ownership', () => {
    const p = createCareerProfile('roman'); p.availableMerit = 199
    expect(purchaseTownHorse(p, 'horse')).toBeNull()
    p.totalMerit = p.availableMerit = 5000; p.rank = 'captain'; p.ownedHorseTiers = [1]; p.ownedMounts = ['horse']; p.townEvent = { id: 'v', state: 'hostile' }
    const next = settleTown(p, 'v', 'town_defeated')
    expect(productStatus(next, TOWN_PRODUCTS.find(p => p.id === 'horse')!)).toBe('已解鎖・餘額足夠')
    expect(productStatus(next, TOWN_PRODUCTS.find(p => p.id === 'corgi')!)).toBe('軍階未解鎖')
    expect(careerItemTotal(purchaseTownHorse(next, 'horse')!, 'horse')).toBe(2); expect(next.ownedHorseTiers).toEqual([1])
  })
})

describe('Town physical contact and allegiance', () => {
  it('building swings use the nearest wall but exclude buildings behind, beyond reach or overhead', () => {
    const origin = new THREE.Vector3(0, .9, 0), grip = new THREE.Vector3(.2, 1.2, .1), tip = new THREE.Vector3(1.5, 1.2, .1)
    const hit = (min: number[], max: number[]) => townMeleeBuildingContact(origin, 0, grip, tip, tip, new THREE.Box3(new THREE.Vector3().fromArray(min), new THREE.Vector3().fromArray(max)), 1.8, false)
    expect(hit([-5, -2, 1], [5, 5, 10])).toBe(true)
    expect(hit([-5, -2, -10], [5, 5, -1])).toBe(false)
    expect(hit([-5, -2, 3], [5, 5, 10])).toBe(false)
    expect(hit([-5, 4, 1], [5, 8, 10])).toBe(false)
  })
  it('first sword contact hits the finite forward arc but never behind or out of range', () => {
    const origin = new THREE.Vector3(0, .9, 0), grip = new THREE.Vector3(.3, 1.3, .3), tip = new THREE.Vector3(1, 1.5, .8)
    const hit = (x: number, z: number) => townMeleeContact(origin, 0, grip, tip, tip, new THREE.Vector3(x, 1, z), 1.8, false)
    expect(hit(0, 1.5)).toBe(true); expect(hit(0, -1)).toBe(false); expect(hit(0, 3)).toBe(false)
    expect(townMeleeContact(origin, 0, grip, new THREE.Vector3(.1, 1.2, 3.8), tip, new THREE.Vector3(0, 1, 3.5), 3.9, true)).toBe(true)
  })
  it('blocks player against anchored civilians and downhill building foundations', () => {
    const position = new THREE.Vector3(.1, .9, 0)
    resolveEntityCollision({ position, radius: .42, height: 1.8, bottomOffset: .9 }, { position: new THREE.Vector3(0, 0, 0), radius: .42, height: 1.8, bottomOffset: 0, anchored: true }, [])
    expect(position.x).toBeCloseTo(.84)
    const obstacles = [{ box: new THREE.Box3(new THREE.Vector3(-2, -100, -2), new THREE.Vector3(2, 8, 2)), isBarricade: false }]
    position.set(1.9, -1, 0); resolveObstacleCollision(position, position.clone(), 0, true, .42, 1.8, .9, obstacles)
    expect(position.x).toBeCloseTo(2.42)
  })
  it('town residents ignore player targeting in peace and acquire the player after effective hostility', () => {
    const scene = new THREE.Scene(), player = new Player(scene), npc = new NPC(scene, 0, 0, Faction.TOWN, 'roman', AIType.MELEE, 'Civilian', 1, false, { meleeWeaponId: null, rangedWeaponId: null, shieldId: null }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'civilian')
    npc.setTownPeaceful(); expect(player.faction).toBe(Faction.PLAYER)
    expect((npc as any)._findTarget(player, [])).toBeNull()
    npc.takeDamage(12); npc.beginTownHostility()
    expect(npc.hp).toBe(38); expect((npc as any)._findTarget(player, []).isPlayer).toBe(true)
    expect(Faction.BANDIT).not.toBe(Faction.TOWN)
  })
})
