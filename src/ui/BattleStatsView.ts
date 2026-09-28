import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'

function whole(value: number): string {
  return Math.round(value).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')
}

export function renderBattleStats(
  snapshot: BattleStatsSnapshot | undefined,
  showSquads: boolean,
): string {
  if (!snapshot) return ''

  const player = snapshot.player
  const squadRows = showSquads
    ? snapshot.squads
      .filter(squad => squad.startingMembers > 0)
      .map(squad => `
        <div class="battle-stats-squad-row">
          <b>第 ${squad.squadId} 隊</b>
          <span>傷害 ${whole(squad.damageDealt)}</span>
          <span>擊殺 ${squad.kills}</span>
          <span>建物 ${whole(squad.structureDamage)}</span>
          <span>破門 ${squad.gateBreaches}</span>
          <span>存活 ${squad.survivors}/${squad.startingMembers}</span>
        </div>
      `)
      .join('')
    : ''

  return `
    <section class="battle-stats-result">
      <h2>戰鬥統計 <small>BATTLE STATS</small></h2>
      <div class="battle-stats-player-title">玩家統計 <small>PLAYER</small></div>
      <div class="battle-stats-player-grid">
        <div><small>個人傷害</small><b>${whole(player.damageDealt)}</b></div>
        <div><small>擊殺</small><b>${player.kills}</b></div>
        <div><small>承受傷害</small><b>${whole(player.damageTaken)}</b></div>
        <div><small>建物傷害</small><b>${whole(player.structureDamage)}</b></div>
        <div><small>破門</small><b>${player.gateBreaches}</b></div>
        <div><small>存活</small><b>${player.survived ? '✓' : '✕'}</b></div>
      </div>
      ${squadRows ? `
        <div class="battle-stats-squad-list">
          <div class="battle-stats-squad-title">小隊統計 <small>SQUADS</small></div>
          ${squadRows}
        </div>
      ` : ''}
    </section>
  `
}