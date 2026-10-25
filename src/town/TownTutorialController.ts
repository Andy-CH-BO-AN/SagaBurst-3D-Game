import { Vector3 } from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { cloneCareerProfile } from '../career/CareerProfile'
import { claimCareerTutorialReward, deferCareerTutorial, recordCareerTutorialOperation, startCareerTutorial } from '../career/CareerTutorial'
import type { CareerTutorialStageId } from '../career/CareerTutorialState'
import { MissionGuide } from '../career/MissionGuide'
import { careerShopProduct } from '../career/CareerShopCatalog'
import { PERSONAL_SQUAD_LIMIT, PERSONAL_SQUAD_PRODUCTS } from '../career/CareerPersonalSquad'
import type { CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'
import type { ArmyCommandTarget } from '../battle/CommandTarget'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { ArmyHudRoster } from '../battle/ArmyCommandHudRoster'
import { commanderTownSquadLabel } from '../career/CommanderTownSquadLabels'
import { townShopProducts } from './TownRules'

interface TownTutorialHost {
  profile(): CareerProfile
  commit(profile: CareerProfile): boolean
  peaceful(): boolean
  blocked(): boolean
  playerPosition(): Vector3
  playerHorse(): boolean
  cameraYaw(): number
  npcPosition(id: string): Vector3 | null
  tower: CommandWatchtowerLayout
  roster(): ArmyHudRoster
  launch(stage: 'recruit' | 'captain', replay: boolean): boolean
  duel(): void
}

/** A small scene adapter owns presentation; the Career model owns progress and rewards. */
export class TownTutorialController {
  private readonly guide = new MissionGuide('career-tutorial-guide')
  private readonly hint = document.createElement('div')
  private readonly careerId: string | undefined
  private towerRouteIndex: number | null = null
  private readonly towerRoute: Vector3[]
  private saveError = ''
  private retryAfter = 0

  constructor(private readonly host: TownTutorialHost) {
    this.careerId = host.profile().tutorial?.careerId
    this.hint.id = 'career-tutorial-hint'
    this.hint.style.cssText = 'position:fixed;right:16px;top:110px;max-width:330px;padding:12px;background:#141b1ccc;color:#fff4d7;border:1px solid #c4ab7666;border-radius:6px;font:14px/1.5 system-ui;white-space:pre-line;pointer-events:none;z-index:93'
    document.body.append(this.hint)
    const tower = host.tower
    const center = (surface: CommandWatchtowerLayout['entrance']) => new Vector3(
      surface.startX + surface.dirX * surface.length / 2, (surface.startY + surface.topY) / 2 + .9,
      surface.startZ + surface.dirZ * surface.length / 2)
    const end = (surface: CommandWatchtowerLayout['entrance']) => new Vector3(
      surface.startX + surface.dirX * surface.length, surface.topY + .9, surface.startZ + surface.dirZ * surface.length)
    this.towerRoute = [new Vector3(tower.entrance.startX, tower.entrance.startY + .9, tower.entrance.startZ), end(tower.entrance), center(tower.landings[0])]
    tower.ramps.forEach((ramp, index) => this.towerRoute.push(end(ramp), center(tower.landings[index + 1])))
    this.towerRoute.push(center(tower.platform[1]), center(tower.platform[2]), center(tower.platform[0]))
  }

  private change(mutate: (profile: CareerProfile) => boolean | void): boolean {
    if (performance.now() < this.retryAfter) return false
    const profile = this.host.profile()
    if (!this.careerId || profile.tutorial?.careerId !== this.careerId) return false
    const next = cloneCareerProfile(profile)
    if (mutate(next) === false) return false
    const saved = this.host.commit(next)
    this.saveError = saved ? '' : '教學進度保存失敗，尚未完成／領獎；請留在此處，將稍後重試。'
    this.retryAfter = saved ? 0 : performance.now() + 1500
    if (!saved) { this.hint.hidden = false; this.hint.textContent = this.saveError }
    return saved
  }
  private record(stage: CareerTutorialStageId, operation: string): boolean {
    return this.change(profile => recordCareerTutorialOperation(profile, stage, operation))
  }
  private activeStage(): CareerTutorialStageId | null {
    const t = this.host.profile().tutorial
    if (!t) return null
    if (t.commander.status === 'active' || t.commander.status === 'available') return 'commander'
    if (t.captain.status === 'available') return 'captain'
    if (t.hr.status === 'available' || t.hr.status === 'active') return 'hr'
    if (t.town.status === 'available' || t.town.status === 'active') return 'town'
    return null
  }

  update(): void {
    const h = this.host, t = h.profile().tutorial
    if (!t || !h.peaceful() || h.blocked()) { this.guide.hide(); this.hint.hidden = true; return }
    this.hint.hidden = false
    const stage = this.activeStage()
    let target: Vector3 | null = null, label = '', interact = true, text = ''
    const npc = (id: string, name: string) => { target = h.npcPosition(id); label = name }
    if (stage === 'town') {
      const step = t.town.step
      if (step === 'weapon' && t.purchases.weaponIds.length) {
        this.change(profile => { recordCareerTutorialOperation(profile, 'town', 'weapon'); claimCareerTutorialReward(profile, 'weapon') })
        return
      }
      if (step === 'duel' && t.duelOutcome && !t.town.replay) { this.record('town', 'duel'); return }
      if (step === 'horse' && t.purchases.horse) {
        this.change(profile => { recordCareerTutorialOperation(profile, 'town', 'horse'); claimCareerTutorialReward(profile, 'horse') })
        return
      }
      if (step === 'horse-use' && h.playerHorse()) { this.record('town', 'horse-use'); return }
      if (step === 'weapon') { npc('merchant', '武器店主'); text = '購買一把武器\n交易保存後獎勵 20 軍功。購買後按 Tab 查看／裝備新武器。' }
      else if (step === 'duel') { npc('captain', '騎兵隊長'); text = '新兵切磋\n靠近隊長按 E，選「新兵切磋」。不需要坐騎；勝負皆可繼續。' }
      else if (step === 'horse') {
        const vendor = ['ranger', 'cat', 'eagle-trainer'].find(id => townShopProducts(id).some(item => item.id === 'horse'))
        if (vendor) npc(vendor, '軍用戰馬商人')
        const price = careerShopProduct('horse')!.price
        text = `購買第一匹普通馬 · ${price} 軍功\n${h.profile().availableMerit < price ? '目前可用軍功不足，可先做任務再回來。' : '成功購買並保存後獎勵 50 軍功。'}`
      } else if (step === 'horse-use') {
        text = '第一匹馬已登記\n按 Tab 選擇召喚普通馬，靠近按 E 騎乘。\n可參加：士官長 → 1v1 → Racing／繞城賽馬。比賽可稍後再玩。'
        interact = false
      } else if (step === 'horse-intro') {
        const affordable = h.profile().availableMerit >= careerShopProduct('horse')!.price
        if (t.settledMissionIds.length >= 2 && (affordable || t.purchases.horse)) {
          npc('deployment', '士官長'); text = '已完成兩次正式實戰，回士官長了解第一匹馬。'
        } else text = `正式實戰 ${Math.min(2, t.settledMissionIds.length)} / 2\n找士官長接受目前軍階的戰鬥任務，勝負皆計入。${!affordable && !t.purchases.horse ? '\n先累積足夠的可用軍功，再向士官長了解買馬。' : ''}`
      } else { npc('deployment', '士官長'); text = step === 'report' ? '城鎮報到\n找士官長開始新兵引導。' : step === 'duel-intro' ? '武器購買已保存 · 獎勵只領一次\n回士官長了解與隊長切磋。' : '切磋已結束\n回士官長了解正式戰鬥任務。' }
    } else if (stage === 'captain') { npc('deployment', '士官長'); text = '你現在可以指揮部隊\n找士官長開始「隊長指揮訓練」：30 名 AI，玩家額外計算。' }
    else if (stage === 'hr') {
      if (t.hr.step === 'recruited' && h.profile().personalSquad?.members.length) { this.record('hr', 'recruited'); return }
      if (t.hr.step === 'recruited') {
        npc('hr-officer', '人力資源官 HR Officer')
        text = `建立自己的私人小隊\nHR 私兵與正式城防隊不同，上限 ${PERSONAL_SQUAD_LIMIT} 人。\n第一位可選普通士兵：${PERSONAL_SQUAD_PRODUCTS[0].price} 軍功。\n${h.profile().availableMerit < PERSONAL_SQUAD_PRODUCTS[0].price ? '軍功不足，可先做任務，再回來招募。' : '也可招募目前合法的其他類型。'}`
      } else { text = '選擇 Personal Squad → Follow me\n選目標與下命令是兩層操作。讓你招募的私兵實際出發。\nDismiss 讓他們回 HR；Tab 可管理已解鎖的私人小隊裝備。'; interact = false }
    } else if (stage === 'commander') {
      const step = t.commander.step
      interact = false
      if (step.startsWith('tower-')) {
        if (this.towerRouteIndex === null) {
          this.towerRouteIndex = 0
          if (step !== 'tower-entrance') {
            const position = h.playerPosition()
            let nearest = Infinity
            this.towerRoute.forEach((point, index) => { const distance = position.distanceToSquared(point); if (distance < nearest) { nearest = distance; this.towerRouteIndex = index } })
          }
        }
        target = this.towerRoute[this.towerRouteIndex]
        label = this.towerRouteIndex === 0 ? '指揮塔入口' : this.towerRouteIndex === this.towerRoute.length - 1 ? '指揮塔頂觀察區' : '指揮塔坡道／平台'
        if (h.playerPosition().distanceTo(target) < 2.2) {
          if (step === 'tower-entrance' && !this.record('commander', 'tower-entrance')) return
          if (this.towerRouteIndex < this.towerRoute.length - 1) this.towerRouteIndex++
          else {
            if (h.profile().tutorial!.commander.step === 'tower-ramp' && !this.record('commander', 'tower-ramp')) return
            if (!this.record('commander', 'tower-top')) return
          }
        }
        text = '前往指揮塔\n沿指標走入口、坡道與平台，抵達塔頂可站立區域。先讓部隊留在地面。'
      } else {
        const roster = h.roster()
        const squads = [...new Set(roster.members.map(member => member.squadId).filter(id => typeof id === 'number'))]
        const summary = squads.map(id => `${commanderTownSquadLabel(id)} ${roster.members.filter(m => m.squadId === id && ['deployed', 'training'].includes(m.state)).length}/${roster.members.filter(m => m.squadId === id).length}`).join(' · ')
        text = `四門八支正式地面小隊\n${summary}\n` + (step === 'all' || step === 'defend' ? '按 Q 進入指揮 → 選 ALL 全軍 → 下達 Defend。只會控制目前合法授權且可接受命令的對象。' : '選其中一支正式小隊 → Formation，在塔外合法地面空地放置預覽並確認。\nQ 返回選目標，可切回 ALL。')
          + '\nFollow 讓部隊隨行；Dismiss 由原流程讓正式部隊回崗、私兵回 HR。離塔後仍有原本指揮權。'
      }
    }
    this.hint.textContent = text + (this.saveError ? '\n' + this.saveError : '')
    this.hint.hidden = !text && !this.saveError
    this.guide.updateTutorial(h.playerPosition(), h.cameraYaw(), target, label, interact)
  }

  commandAccepted(event: { order: TacticalOrder | 'dismiss'; target: ArmyCommandTarget; participantCount: number }): void {
    if (!this.host.peaceful() || event.participantCount <= 0) return
    const t = this.host.profile().tutorial
    if (!t) return
    if ((t.hr.status === 'active' || t.hr.status === 'available') && event.order === 'follow' && event.target === 'squad:personal') {
      if (t.hr.step === 'recruited' && this.host.profile().personalSquad?.members.length) this.record('hr', 'recruited')
      this.record('hr', 'follow')
    }
    if (t.commander.status !== 'active') return
    if (event.target === 'all' && event.order === 'defend') {
      if (t.commander.step === 'all') this.record('commander', 'all')
      this.record('commander', 'defend')
    } else if (/^squad:[1-8]$/.test(event.target) && event.order === 'formation') {
      const squadId = Number(event.target.slice(6))
      const authority = this.host.profile().townCommandSquad
      if (authority?.commandRank !== 'commander' || !authority.squads?.some(squad => squad.squadId === squadId)) return
      if (t.commander.step === 'squad') this.record('commander', 'squad')
      this.record('commander', 'formation')
    }
  }

  appendPanel(panel: HTMLElement, serviceId: string): void {
    const h = this.host, t = h.profile().tutorial
    if (!t || !h.peaceful()) return
    const addText = (text: string) => { const p = document.createElement('p'); p.className = 'town-summary'; p.style.whiteSpace = 'pre-line'; p.textContent = text; panel.append(p) }
    const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.className = 'town-button'; b.textContent = label; b.onclick = action; panel.append(b) }
    const activate = (stage: CareerTutorialStageId) => this.change(profile => { startCareerTutorial(profile, stage); return true })
    if (serviceId === 'captain' && t.town.step === 'duel' && ['active', 'available'].includes(t.town.status)) {
      addText('新兵切磋 · 由真正的騎兵隊長使用步戰近戰裝備陪練。勝利 500 軍功；正常失敗 20 軍功。取消與載入失敗不結算；不影響正式 T1–T5 解鎖。')
      button('新兵切磋 · 開始', () => h.duel())
    }
    if (serviceId !== 'deployment') return
    const status = (value: string) => ({ locked: '尚未開放', available: '可開始', active: '進行中', deferred: '稍後繼續', completed: '已完成' }[value] ?? value)
    const steps: Record<string, string> = { report: '向士官長報到', weapon: '購買武器', 'duel-intro': '了解隊長切磋', duel: '與隊長切磋', missions: '認識正式任務', 'horse-intro': '兩次正式實戰與馬店介紹', horse: '購買普通馬', 'horse-use': '召喚與騎乘普通馬', recruited: '招募至少一名私兵', follow: '對私人小隊下達 Follow me', 'tower-entrance': '前往指揮塔入口', 'tower-ramp': '沿坡道上塔', 'tower-top': '抵達塔頂', all: '打開 ALL 全軍命令', defend: '全軍 Defend', squad: '選擇正式小隊', formation: '在合法地面列陣', complete: '已完成' }
    addText(`生涯教學 · 新兵 ${status(t.recruit.status)} · 隊長 ${status(t.captain.status)} · 指揮官 ${status(t.commander.status)}\nHP 是生命；體力用於攻擊、格擋與奔跑。累積軍功決定升階資格，可用軍功用於交易。達門檻後仍需找 NPC 正式接受任命。`)
    if (t.town.status !== 'locked' && t.town.status !== 'completed' && t.town.status !== 'deferred') {
      if (t.town.step === 'report') {
        addText('歡迎報到。先到武器店實際購買一把可用武器；起始配發與訓練場借用品不算。成功購買後按 Tab 查看與裝備。')
        this.record('town', 'report')
      } else if (t.town.step === 'duel-intro') {
        addText('接著找騎兵隊長，選「新兵切磋」。這場不用馬，勝負皆可繼續；每次角色生涯只發一次教學獎勵。')
        this.record('town', 'duel-intro')
      } else if (t.town.step === 'missions') {
        addText('之後可找士官長 → 1v1，選擇兵種並依序挑戰 T1–T5。\n現在可從下方目前軍階任務頁接受正式戰鬥；正常結算兩次後，我再介紹馬店。')
        this.record('town', 'missions')
      } else if (t.town.step === 'horse-intro' && t.settledMissionIds.length >= 2 && (t.purchases.horse || h.profile().availableMerit >= careerShopProduct('horse')!.price)) {
        addText(`你已完成兩次實戰。普通馬售價 ${careerShopProduct('horse')!.price} 可用軍功；擁有後可召喚、騎乘，也能參加士官長 → 1v1 → Racing／繞城賽馬。成功買馬後另有一次性 50 軍功獎勵。`)
        this.record('town', 'horse-intro')
      }
    }
    for (const [stage, label] of [['recruit', '操作練習'], ['captain', '隊長指揮訓練']] as const) {
      if (t[stage].status === 'locked') continue
      const replay = t[stage].status === 'completed'
      button(`${replay ? '重播' : '繼續'}${label}${replay ? ' · 不重複發獎' : ''}`, () => h.launch(stage, replay))
    }
    for (const [stage, label] of [['town', '城鎮新兵引導'], ['hr', 'HR 私人小隊引導'], ['commander', '指揮塔與全軍指揮']] as const) {
      if (t[stage].status === 'locked') continue
      addText(`${label}：${t[stage].status === 'completed' ? '已完成' : steps[t[stage].step] ?? status(t[stage].status)}`)
      if (t[stage].status !== 'completed') {
        if (t[stage].status === 'deferred' || t[stage].status === 'available') button(`開始／繼續${label}`, () => { activate(stage); this.appendStatus(panel, `${label}已繼續，關閉面板後依指標操作。`) })
        else button(`${label} · 稍後繼續`, () => { this.change(profile => { deferCareerTutorial(profile, stage) }); this.appendStatus(panel, '教學已暫停，可繼續一般生涯任務，之後再找士官長。') })
      } else button(`重播${label} · 不重複發獎`, () => { this.change(profile => { startCareerTutorial(profile, stage, true) }); this.towerRouteIndex = null; this.appendStatus(panel, '已開始重播，已領獎勵不會重複發放。') })
    }
  }
  private appendStatus(panel: HTMLElement, text: string): void { const p = document.createElement('p'); p.textContent = this.saveError || text; panel.append(p) }
  dispose(): void { this.guide.dispose(); this.hint.remove() }
}
