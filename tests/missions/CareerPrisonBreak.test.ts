import { describe, expect, it } from 'vitest'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { beginPrisonBreak, claimCareerFieldResult, claimPrisonSword, crossedPrisonExit, prisonOutcome, prisonRoster, prisonTaunt, prisonUnitSpec, type PrisonBattleId } from '../../src/career/CareerPrisonBreak'
import { WEAPONS } from '../../src/rpg/WeaponDatabase'

const stats = { damageDealt: 10, damageTaken: 100, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0, survived: false }
function captured(templateId: PrisonBattleId, faction: 'roman' | 'viking', captor: 'roman' | 'viking') {
  const profile = createCareerProfile(faction)
  profile.activeMission = { ...createActiveCareerMission('recruit-bandits-01', 0, 1, 0, 'original'), templateId,
    kind: templateId === 'commander-iron-legion' ? 'commander-iron-legion' : 'heavy-cavalry-field' }
  return claimCareerFieldResult(profile, 'original', 'failure', stats, stats, captor).profile
}

describe('Career prison break decisions', () => {
  it('三關與兩文化皆為玩家另加 30 名徒手戰俘，以及俘虜方的五名實際兵種看守', () => {
    const rows = [ ['soldier-iron-encounter', 3, 2], ['veteran-iron-tide', 4, 3], ['commander-iron-legion', 5, 4] ] as const
    for (const [id, tier, basic] of rows) for (const captor of ['roman', 'viking'] as const) {
      const faction = captor === 'roman' ? 'viking' : 'roman'
      const state = captured(id, faction, captor).activeMission!.prisonBreak!
      expect(state.combat.arenaId).toBe(captor === 'roman' ? 'roman-colosseum' : 'viking-valhalla')
      const roster = prisonRoster(state), friends = roster.filter(e => e.team === 'friendly'), guards = roster.filter(e => e.team === 'enemy')
      expect(friends.map(e => e.tier)).toEqual([tier, ...Array(29).fill(basic)])
      expect(guards.map(e => [e.tier, e.role])).toEqual([[tier, 'melee'], [tier, 'melee'], [tier, 'spear'], [tier, 'archer'], [tier, captor === 'roman' ? 'javelin' : 'archer']])
      for (const entry of roster) {
        const spec = prisonUnitSpec(state, entry, faction)
        expect(spec.cavalry).toBe(false)
        expect(spec.characterTier).toBe(entry.tier)
        expect(spec.characterFaction).toBe(entry.team === 'friendly' ? faction : captor)
        if (entry.team === 'friendly') expect(spec.loadout).toEqual({ meleeWeaponId: null, rangedWeaponId: null, shieldId: null, mountId: null })
        else if (entry.role === 'archer' || entry.role === 'javelin') expect(WEAPONS[spec.loadout!.rangedWeaponId!].combatKind).toBe(entry.role === 'javelin' ? 'javelin' : 'bow')
      }
    }
  })

  it('僅新結算的指定正式敗北建立被俘資格，友軍勝利、試煉 KO、其他任務及重複結算皆不建立', () => {
    const profile = captured('soldier-iron-encounter', 'roman', 'viking')
    delete profile.activeMission!.prisonBreak
    expect(claimCareerFieldResult(profile, 'original', 'failure', stats, stats, 'viking').profile.activeMission!.prisonBreak).toBeUndefined()
    for (const [templateId, kind, outcome] of [
      ['soldier-iron-encounter', 'heavy-cavalry-field', 'victory'],
      ['captain-steel-avalanche', 'heavy-cavalry-field', 'failure'],
      ['career-arena-trial-t1', 'arena-squad-trial', 'failure'],
      ['recruit-bandits-01', 'bandit', 'failure'],
    ] as const) {
      const next = createCareerProfile('roman')
      next.activeMission = { ...profile.activeMission!, templateId, kind, result: undefined }
      expect(claimCareerFieldResult(next, 'original', outcome, stats, stats, 'viking').profile.activeMission?.prisonBreak).toBeUndefined()
    }
    expect(beginPrisonBreak(profile)).toBeNull()
  })

  it('每把劍與拾取者都只能取得一次，死亡戰俘與看守不能拾取', () => {
    const state = beginPrisonBreak(captured('veteran-iron-tide', 'roman', 'viking'))!.activeMission!.prisonBreak!
    const friends = prisonRoster(state).filter(e => e.team === 'friendly')
    const claimed = claimPrisonSword(state, 0, 'player')!
    expect(state.swords).toEqual({})
    expect(claimPrisonSword(claimed, 0, friends[0].actorId)).toBeNull()
    expect(claimPrisonSword(claimed, 1, 'player')).toBeNull()
    expect(claimPrisonSword(claimed, 6, friends[0].actorId)).toBeNull()
    expect(claimPrisonSword(claimed, 1, `${state.missionId}:guard:0`)).toBeNull()
    claimed.combat.actors[friends[0].actorId] = { status: 'knocked', hp: 0, x: 0, z: 0, yaw: 0 }
    expect(claimPrisonSword(claimed, 1, friends[0].actorId)).toBeNull()
    expect(claimPrisonSword(claimed, 1, friends[1].actorId)!.swords).toEqual({ 0: 'player', 1: friends[1].actorId })
  })

  it('全隊越獄：玩家倒下仍有隊友不結算，開門不結算，活隊員實際過門成功，全員倒下才失敗', () => {
    const progress = { playerDead: true, friendlyAlive: 1, gateOpen: false, playerCrossed: false, friendlyCrossed: false }
    expect(prisonOutcome(progress)).toBeNull()
    expect(prisonOutcome({ ...progress, gateOpen: true })).toBeNull()
    expect(prisonOutcome({ ...progress, friendlyCrossed: true })).toBeNull()
    expect(prisonOutcome({ ...progress, gateOpen: true, friendlyCrossed: true })).toBe('victory')
    expect(prisonOutcome({ ...progress, gateOpen: true, playerCrossed: true })).toBeNull()
    expect(prisonOutcome({ ...progress, playerDead: false, gateOpen: true, playerCrossed: true })).toBe('victory')
    expect(prisonOutcome({ ...progress, playerDead: false, friendlyAlive: 0 })).toBeNull()
    expect(prisonOutcome({ ...progress, friendlyAlive: 0 })).toBe('failure')
    expect(prisonOutcome({ ...progress, friendlyAlive: 0, gateOpen: true, friendlyCrossed: true })).toBe('failure')
    for (const [arena, z] of [['roman-colosseum', -20.45], ['viking-valhalla', -38.65]] as const) {
      expect(crossedPrisonExit(arena, { x: 0, y: .95, z: z + 1 }, { x: 0, y: .95, z: z - 1 })).toBe(true)
      expect(crossedPrisonExit(arena, { x: 8, y: .95, z: z + 1 }, { x: 8, y: .95, z: z - 1 })).toBe(false)
      expect(crossedPrisonExit(arena, { x: 0, y: 6, z: z + 1 }, { x: 0, y: 6, z: z - 1 })).toBe(false)
      expect(crossedPrisonExit(arena, { x: 0, y: .95, z: z - 1 }, { x: 0, y: .95, z: z + 1 })).toBe(false)
    }
  })

  it('僅門未開且有站立看守時嘲諷，無活看守與開門後皆無字幕', () => {
    for (const faction of ['roman', 'viking'] as const) {
      expect(prisonTaunt(faction, false, 1)).toBeTruthy()
      expect(prisonTaunt(faction, false, 0)).toBeNull()
      expect(prisonTaunt(faction, true, 1)).toBeNull()
    }
  })
})
