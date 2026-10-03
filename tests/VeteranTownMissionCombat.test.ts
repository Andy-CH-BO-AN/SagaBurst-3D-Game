import * as THREE from 'three'
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
  it('preserves the existing Ranger behavior when Bandits approach the home Town', () => {
    const h = combatFixture()
    const bandit = combatActor('ambient-bandit', Faction.BANDIT)
    const ranger = combatActor('ranger', Faction.TOWN)
    h.field.ambientBandits = [bandit]
    h.field.fieldNpcs = [bandit]
    h.simulation.residents = [combatResident(ranger, 'ranger')]

    h.combat.update(.02, 0, 1)

    expect(ranger.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.combat.isExternalThreatDefender(ranger)).toBe(false)
  })

  it('allows the native enemy Ranger to defend its Town against nearby scouts', () => {
    const h = combatFixture()
    const scout = combatActor('captain', Faction.TOWN)
    const ranger = combatActor('enemy-town:ranger', Faction.ENEMY)
    ranger.group.position.set(0, 0, 19)
    h.player.combatPosition.set(1000, 0, 0)
    h.field.friendlies = [scout]
    h.field.fieldNpcs = [scout]
    h.simulation.residents = [combatResident(ranger, 'ranger')]
    activateVeteranField(h, 'ENGAGING', 'veteran-tragedy-of-the-scouts')

    h.combat.update(.02, 0, 1)

    expect(ranger.beginExternalThreat).toHaveBeenCalledOnce()
    expect(h.combat.enemyTownHostiles).toContain(ranger)
  })

  it('moves friendly mission actors toward muster without enabling combat during ASSEMBLING', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN), enemy = combatActor('enemy', Faction.ENEMY)
    const friendlyMount = combatMount(), enemyMount = combatMount()
    friendly.mount = friendlyMount; friendlyMount.riderNpc = friendly
    enemy.mount = enemyMount; enemyMount.riderNpc = enemy
    h.field.friendlies = [friendly]; h.field.missionBandits = [enemy]; h.field.fieldNpcs = [enemy, friendly]
    activateVeteranField(h, 'ASSEMBLING')

    h.combat.update(.02, 0, 1)

    for (const actor of [friendly, enemy]) {
      if (actor === friendly) {
        expect(actor.update).toHaveBeenCalledOnce()
        expect(actor.update.mock.calls[0]?.[2]).toEqual([])
        expect(actor.update.mock.calls[0]?.[11]).toBeNull()
      } else {
        expect(actor.update).not.toHaveBeenCalled()
        expect(actor.updateTownPeace).toHaveBeenCalledOnce()
      }
    }
    expect(friendlyMount.beginControlledFrame).not.toHaveBeenCalled()
    expect(enemyMount.beginControlledFrame).toHaveBeenCalledOnce()
    expect(enemyMount.finishControlledFrame).toHaveBeenCalledExactlyOnceWith(.02, h.simulation.obstacles)
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
      expect(peers).toEqual([])
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

  it('activates each held Veteran enemy squad once a friendly reaches its leader', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN)
    const nearLeader = combatActor('near-leader', Faction.ENEMY)
    const nearMember = combatActor('near-member', Faction.ENEMY)
    const farLeader = combatActor('far-leader', Faction.ENEMY)
    const farMember = combatActor('far-member', Faction.ENEMY)
    friendly.group.position.set(0, 0, 0)
    nearLeader.group.position.set(49, 0, 0)
    nearMember.group.position.set(50, 0, 1)
    farLeader.group.position.set(100, 0, 0)
    farMember.group.position.set(101, 0, 1)
    h.field.friendlies = [friendly]
    h.field.missionBandits = [nearLeader, nearMember, farLeader, farMember]
    h.field.fieldNpcs = [...h.field.missionBandits, friendly]
    activateVeteranField(h, 'MARCHING')
    ;(h.field.active as any).engagedEnemySquadIds = []
    h.player.combatPosition.set(1000, 0, 0)
    h.field.veteranEnemySquads = [
      { squadId: 1, leader: nearLeader, members: [nearLeader, nearMember] },
      { squadId: 2, leader: farLeader, members: [farLeader, farMember] },
    ]

    h.combat.update(.02, 0, 1)

    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenCalledExactlyOnceWith(1)
    expect(nearLeader.update).toHaveBeenCalledOnce()
    expect(nearMember.update).toHaveBeenCalledOnce()
    expect(farLeader.update).not.toHaveBeenCalled()
    expect(farMember.update).not.toHaveBeenCalled()
    const towardFriendly = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), farLeader.group.rotation.y)
    expect(towardFriendly.x).toBeLessThan(-.9)
    expect(h.field.active).toMatchObject({ engagedEnemySquadIds: [1] })

    nearLeader.update.mockClear(); nearMember.update.mockClear()
    farLeader.group.position.x = 49
    farMember.group.position.x = 50
    h.combat.update(.02, 0, 2)
    h.combat.update(.02, 0, 3)
    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenCalledTimes(2)
    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenLastCalledWith(2)
    expect(farLeader.update).toHaveBeenCalledTimes(2)
    expect(farMember.update).toHaveBeenCalledTimes(2)
  })

  it('keeps ENGAGING enemy squads held until each leader is within 50m', () => {
    const h = combatFixture()
    const friendly = combatActor('friendly', Faction.TOWN)
    const firstLeader = combatActor('near-leader', Faction.ENEMY), firstMember = combatActor('near-member', Faction.ENEMY)
    const secondLeader = combatActor('far-leader', Faction.ENEMY), secondMember = combatActor('far-member', Faction.ENEMY)
    friendly.group.position.set(0, 0, 0)
    firstLeader.group.position.set(10, 0, 0); firstMember.group.position.set(11, 0, 0)
    secondLeader.group.position.set(100, 0, 0); secondMember.group.position.set(101, 0, 0)
    h.field.friendlies = [friendly]
    h.field.missionBandits = [firstLeader, firstMember, secondLeader, secondMember]
    h.field.fieldNpcs = [...h.field.missionBandits, friendly]
    activateVeteranField(h, 'ENGAGING')
    ;(h.field.active as any).engagedEnemySquadIds = [1]
    h.field.veteranEnemySquads = [
      { squadId: 1, leader: firstLeader, members: [firstLeader, firstMember] },
      { squadId: 2, leader: secondLeader, members: [secondLeader, secondMember] },
    ]

    h.combat.update(.02, 0, 1)

    expect(firstLeader.update).toHaveBeenCalledOnce()
    expect(firstMember.update).toHaveBeenCalledOnce()
    expect(secondLeader.update).not.toHaveBeenCalled()
    expect(secondMember.update).not.toHaveBeenCalled()
    expect(secondLeader.updateTownPeace).toHaveBeenCalledOnce()
    expect(h.field.markVeteranEnemySquadEngaged).not.toHaveBeenCalled()

    secondLeader.group.position.x = 49
    h.combat.update(.02, 0, 2)
    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenCalledExactlyOnceWith(2)
    expect(secondLeader.update).toHaveBeenCalledOnce()
  })

  it('keeps every mission enemy targetable by friendly actors after Charge while held squads stay peaceful', () => {
    const h = combatFixture()
    const friendly = combatActor('ranged-friendly', Faction.TOWN)
    const heldLeader = combatActor('held-leader', Faction.ENEMY)
    const heldMember = combatActor('held-member', Faction.ENEMY)
    friendly.group.position.set(0, 0, 0)
    heldLeader.group.position.set(100, 0, 0)
    heldMember.group.position.set(102, 0, 0)
    h.field.friendlies = [friendly]
    h.field.missionBandits = [heldLeader, heldMember]
    h.field.fieldNpcs = [...h.field.missionBandits, friendly]
    h.field.veteranEnemySquads = [{ squadId: 4, leader: heldLeader, members: [heldLeader, heldMember] }]
    activateVeteranField(h, 'ENGAGING')
    ;(h.field.active as any).engagedEnemySquadIds = []
    friendly.update.mockImplementation((_dt, _player, _peers, _nearby, _obstacles, _hp, _hit, _fire, _skip, _distance, _collector, hostileGrid) => {
      expect(hostileGrid).toBeTruthy()
      expect(hostileGrid!.findNearest(friendly.combatPosition, candidate => candidate === heldLeader)).toBe(heldLeader)
    })

    h.combat.update(.02, 0, 1)

    expect(friendly.update).toHaveBeenCalledOnce()
    expect(heldLeader.updateTownPeace).toHaveBeenCalledOnce()
    expect(heldMember.updateTownPeace).toHaveBeenCalledOnce()
    expect(h.field.markVeteranEnemySquadEngaged).not.toHaveBeenCalled()
  })

  it('activates only nearby enemy Town guards against VI scouts and the Player', () => {
    const h = combatFixture()
    const scout = combatActor('scout', Faction.TOWN)
    const cavalry = combatActor('enemy-field-rider', Faction.ENEMY)
    const nearbyGuard = combatActor('enemy-town:near-guard', Faction.ENEMY)
    const distantGuard = combatActor('enemy-town:far-guard', Faction.ENEMY)
    const civilian = combatActor('enemy-town:civilian', Faction.ENEMY)
    const merchant = combatActor('enemy-town:merchant', Faction.ENEMY)
    scout.group.position.set(180, 0, 180)
    cavalry.group.position.set(8, 0, 95)
    nearbyGuard.group.position.set(0, 0, 8)
    distantGuard.group.position.set(-40, 0, 8)
    civilian.group.position.set(0, 0, 10)
    merchant.group.position.set(0, 0, 9)
    h.field.friendlies = [scout]
    h.field.missionBandits = [cavalry]
    h.field.fieldNpcs = [scout, cavalry]
    const nearbyResident = combatResident(nearbyGuard, 'melee_infantry')
    const distantResident = combatResident(distantGuard, 'melee_infantry')
    const civilianResident = combatResident(civilian, 'civilian')
    const merchantResident = combatResident(merchant, 'merchant')
    h.simulation.residents = [nearbyResident, distantResident, civilianResident, merchantResident]
    activateVeteranField(h, 'ENGAGING', 'veteran-tragedy-of-the-scouts')
    h.player.combatPosition.set(0, 0, 0)

    h.combat.update(.02, 0, 1)

    expect(nearbyGuard.beginExternalThreat).toHaveBeenCalledOnce()
    expect(nearbyGuard.update).toHaveBeenCalledOnce()
    expect(distantGuard.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(distantResident, .02)
    expect(civilian.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(civilianResident, .02)
    expect(merchant.beginExternalThreat).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(merchantResident, .02)
    expect(h.combat.enemyTownHostiles).toContain(nearbyGuard)
    expect(h.combat.enemyTownHostiles).not.toContain(distantGuard)
  })

  it('activates an enemy squad near the Player during ASSEMBLING but ignores peaceful Town bystanders', () => {
    const h = combatFixture()
    const enemyLeader = combatActor('enemy-leader', Faction.ENEMY)
    const enemyMember = combatActor('enemy-member', Faction.ENEMY)
    const peaceful = combatActor('town-bystander', Faction.TOWN)
    enemyLeader.group.position.set(49, 0, 0)
    enemyMember.group.position.set(50, 0, 1)
    peaceful.group.position.set(48, 0, 0)
    h.field.missionBandits = [enemyLeader, enemyMember]
    h.field.fieldNpcs = [enemyLeader, enemyMember]
    h.field.veteranEnemySquads = [{ squadId: 3, leader: enemyLeader, members: [enemyLeader, enemyMember] }]
    h.simulation.residents = [combatResident(peaceful)]
    h.player.combatPosition.set(0, 0, 0)
    activateVeteranField(h, 'ASSEMBLING')
    ;(h.field.active as any).engagedEnemySquadIds = []

    h.combat.update(.02, 0, 1)

    expect(h.field.markVeteranEnemySquadEngaged).toHaveBeenCalledExactlyOnceWith(3)
    expect(enemyLeader.update).toHaveBeenCalledOnce()
    expect(enemyMember.update).toHaveBeenCalledOnce()
    expect(peaceful.update).not.toHaveBeenCalled()
    expect(h.simulation.peaceResident).toHaveBeenCalledWith(combatResident(peaceful), .02)
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
    h.field.veteranEnemySquads = [{ squadId: 1, leader: missionEnemy, members: [missionEnemy] }]
    h.field.fieldNpcs = [missionEnemy, borrowedAlly]
    h.field.ambientBandits = [combatActor('ambient-bandit', Faction.BANDIT)]
    h.simulation.residents = [combatResident(borrowedAlly), combatResident(bystander)]
    activateVeteranField(h)
    ;(h.field.active as any).engagedEnemySquadIds = [1]
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
