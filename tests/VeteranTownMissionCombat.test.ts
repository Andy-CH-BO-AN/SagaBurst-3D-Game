import { describe, expect, it } from 'vitest'
import { Faction, type NPC } from '../src/world/NPC'
import { combatActor, combatFixture, combatMount, combatResident } from './helpers/townMissionCombat'

function activateVeteranField(
  h: ReturnType<typeof combatFixture>,
  phase: 'ASSEMBLING' | 'MARCHING' | 'ENGAGING' = 'ENGAGING',
  templateId = 'veteran-scout-hunters',
) {
  h.field.active = { kind: 'veteran-field', phase, templateId } as any
}

describe('Veteran Town mission combat', () => {
  it('keeps both rosters peaceful during ASSEMBLING while advancing their mounts', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN), enemy = combatActor('enemy', Faction.ENEMY)
    const friendlyMount = combatMount(), enemyMount = combatMount()
    friendly.mount = friendlyMount; friendlyMount.riderNpc = friendly
    enemy.mount = enemyMount; enemyMount.riderNpc = enemy
    h.field.friendlies = [friendly]; h.field.missionBandits = [enemy]; h.field.fieldNpcs = [enemy, friendly]
    activateVeteranField(h, 'ASSEMBLING')

    h.combat.update(.02, 0, 1)

    for (const actor of [friendly, enemy]) {
      expect(actor.update).not.toHaveBeenCalled()
      expect(actor.updateTownPeace).toHaveBeenCalledOnce()
    }
    for (const mount of [friendlyMount, enemyMount]) {
      expect(mount.beginControlledFrame).toHaveBeenCalledOnce()
      expect(mount.finishControlledFrame).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
    }
    expect(h.simulation.hitNpc).not.toHaveBeenCalled()
    expect(h.simulation.damagePlayer).not.toHaveBeenCalled()
  })

  it('marches friendlies while enemies stay peaceful until ENGAGING', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN), enemy = combatActor('enemy', Faction.ENEMY)
    const enemyMount = combatMount()
    enemy.mount = enemyMount; enemyMount.riderNpc = enemy
    h.field.friendlies = [friendly]; h.field.missionBandits = [enemy]; h.field.fieldNpcs = [enemy, friendly]
    activateVeteranField(h, 'MARCHING')
    friendly.update.mockImplementation((_dt, _player, peers, nearby) => {
      expect(peers).toEqual([friendly])
      expect(nearby).not.toContain(enemy)
    })

    h.combat.update(.02, 0, 1)

    expect(friendly.update).toHaveBeenCalledOnce()
    expect(enemy.update).not.toHaveBeenCalled()
    expect(enemy.updateTownPeace).toHaveBeenCalledOnce()
    expect(enemyMount.beginControlledFrame).toHaveBeenCalledOnce()
    expect(enemyMount.finishControlledFrame).toHaveBeenCalledOnce()
    expect(h.simulation.hitNpc).not.toHaveBeenCalled()
    expect(h.simulation.damagePlayer).not.toHaveBeenCalled()
  })

  it('lets Veteran VI engage immediately without the ordinary field phase gate', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN), enemy = combatActor('enemy', Faction.ENEMY)
    h.field.friendlies = [friendly]; h.field.missionBandits = [enemy]; h.field.fieldNpcs = [enemy, friendly]
    activateVeteranField(h, 'ASSEMBLING', 'veteran-tragedy-of-the-scouts')

    h.combat.update(.02, 0, 1)

    expect(friendly.update).toHaveBeenCalledOnce()
    expect(enemy.update).toHaveBeenCalledOnce()
    expect(friendly.updateTownPeace).not.toHaveBeenCalled()
    expect(enemy.updateTownPeace).not.toHaveBeenCalled()
  })

  it('routes mounted impacts between mission rosters and gives each NPC its hostile grid', () => {
    const h = combatFixture()
    const borrowedAlly = combatActor('borrowed-ally', Faction.TOWN)
    const missionEnemy = combatActor('mission-enemy', Faction.ENEMY)
    const bystander = combatActor('peaceful-resident', Faction.TOWN)
    const friendlyMount = combatMount(), enemyMount = combatMount()
    borrowedAlly.mount = friendlyMount; friendlyMount.riderNpc = borrowedAlly
    missionEnemy.mount = enemyMount; enemyMount.riderNpc = missionEnemy
    missionEnemy.hostileToPlayer = true
    h.player.combatPosition.set(0, 0, 0)
    h.field.friendlies = [borrowedAlly]
    h.field.missionBandits = [missionEnemy]
    h.field.fieldNpcs = [missionEnemy, borrowedAlly]
    h.field.ambientBandits = [combatActor('ambient-bandit', Faction.BANDIT)]
    h.simulation.residents = [combatResident(borrowedAlly), combatResident(bystander)]
    activateVeteranField(h)
    borrowedAlly.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, _hit, _fire, _skip, _distance, _collector, hostileGrid) => {
      expect(hostileGrid).toBeTruthy()
      expect(hostileGrid!.findNearest(borrowedAlly.combatPosition, candidate => !candidate.dead && candidate.faction !== borrowedAlly.faction)).toBe(missionEnemy)
    })
    missionEnemy.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, _hit, _fire, _skip, _distance, _collector, hostileGrid) => {
      expect(hostileGrid).toBeTruthy()
      expect(hostileGrid!.findNearest(missionEnemy.combatPosition, candidate => !candidate.dead && candidate.faction !== missionEnemy.faction)).toBe(borrowedAlly)
    })

    h.combat.update(.02, 0, 4)

    expect(h.simulation.hitNpc).toHaveBeenCalledWith(missionEnemy, expect.any(Number), 'mount-impact', borrowedAlly)
    expect(h.simulation.hitNpc).toHaveBeenCalledWith(borrowedAlly, expect.any(Number), 'mount-impact', missionEnemy)
    expect(h.simulation.damagePlayer).toHaveBeenCalledWith(missionEnemy, expect.any(Number), 'mount-impact')
    expect(borrowedAlly.update).toHaveBeenCalledOnce()
    expect(missionEnemy.update).toHaveBeenCalledOnce()
    expect(bystander.update).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledExactlyOnceWith(combatResident(bystander), .02)
    expect(bystander.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.field.combatPeersFor).not.toHaveBeenCalled()
  })

  it('releases stale threat bookkeeping without resetting a borrowed leader mission order', () => {
    const h = combatFixture()
    const ambient = combatActor('ambient-bandit', Faction.BANDIT)
    const borrowedLeader = combatActor('captain', Faction.TOWN)
    const missionEnemy = combatActor('mission-enemy', Faction.ENEMY)
    const borrowedResident = combatResident(borrowedLeader, 'captain')
    let order = 'external-threat'
    borrowedLeader.endExternalThreat.mockImplementation(() => { order = 'attack' })
    h.field.fieldNpcs = [ambient]
    h.field.ambientBandits = [ambient]
    h.simulation.residents = [borrowedResident]
    h.combat.update(.02, 0, 1)
    expect(h.combat.isExternalThreatDefender(borrowedLeader)).toBe(true)

    activateVeteranField(h)
    h.field.friendlies = [borrowedLeader]
    h.field.missionBandits = [missionEnemy]
    h.field.fieldNpcs = [missionEnemy, borrowedLeader]
    h.field.updateFlow.mockImplementation(() => { order = 'follow' })
    h.combat.update(.02, 0, 2)

    expect(order).toBe('follow')
    expect(borrowedLeader.endExternalThreat).not.toHaveBeenCalled()
    expect(h.combat.isExternalThreatDefender(borrowedLeader)).toBe(false)
  })

  it('ends existing external threats on Veteran entry and never treats nonborrowed residents as defenders', () => {
    const h = combatFixture()
    const ambient = combatActor('ambient-bandit', Faction.BANDIT)
    const missionEnemy = combatActor('mission-enemy', Faction.ENEMY)
    const borrowedAlly = combatActor('borrowed-ally', Faction.TOWN)
    const bystander = combatActor('peaceful-resident', Faction.TOWN)
    const bystanderResident = combatResident(bystander)
    h.field.fieldNpcs = [ambient]
    h.field.ambientBandits = [ambient]
    h.simulation.residents = [bystanderResident]
    h.combat.update(.02, 0, 1)
    expect(h.combat.isExternalThreatDefender(bystander)).toBe(true)
    expect(bystander.beginExternalThreat).toHaveBeenCalledOnce()

    activateVeteranField(h)
    h.field.friendlies = [borrowedAlly]
    h.field.missionBandits = [missionEnemy]
    h.field.fieldNpcs = [missionEnemy, borrowedAlly]
    expect(h.combat.isExternalThreatDefender(bystander)).toBe(false)
    h.combat.update(.02, 0, 2)

    expect(bystander.endExternalThreat).toHaveBeenCalledOnce()
    expect(bystander.beginExternalThreat).toHaveBeenCalledOnce()
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(bystanderResident, .02)
  })
})
