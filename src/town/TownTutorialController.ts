import { Vector3 } from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { cloneCareerProfile } from '../career/CareerProfile'
import { claimCareerTutorialReward, deferCareerTutorial, hasCareerTutorialHorse, recordCareerTutorialOperation, startCareerTutorial } from '../career/CareerTutorial'
import type { CareerTutorialStageId } from '../career/CareerTutorialState'
import { MissionGuide } from '../career/MissionGuide'
import { careerShopProduct } from '../career/CareerShopCatalog'
import type { CommandWatchtowerLayout } from './TownCommandWatchtowerLayout'
import type { ArmyCommandTarget } from '../battle/CommandTarget'
import type { TacticalOrder } from '../battle/TacticalOrder'
import type { ArmyHudRoster } from '../battle/ArmyCommandHudRoster'
import { townShopProducts } from './TownRules'
import { TownTutorialHUD } from './TownUI'

export interface TownTutorialHost {
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
  closePanel(): void
  openRecruitmentPanel?(): void
  /** Opens a service's original panel, bypassing the optional tutorial dialogue. */
  openServices?(serviceId: string): void
  openPanel?(title: string, text: string): HTMLDivElement
}

/** A small scene adapter owns presentation; the Career model owns progress and rewards. */
export class TownTutorialController {
  private readonly guide = new MissionGuide('career-tutorial-guide')
  private readonly hud = new TownTutorialHUD()
  private readonly careerId: string | undefined
  private towerRouteIndex: number | null = null
  private readonly towerRoute: Vector3[]
  private saveError = ''
  private retryAfter = 0
  private notification = ''
  private notificationUntil = 0
  private busy = false

  constructor(private readonly host: TownTutorialHost) {
    this.careerId = host.profile().tutorial?.careerId
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
    this.saveError = saved ? '' : '教學進度保存失敗，尚未完成。購買／導航會自動重試；對話按「重試」，軍令請再次下達。'
    this.retryAfter = saved ? 0 : performance.now() + 1500
    if (!saved) this.hud.render('', '', this.saveError, this.host.blocked())
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
    if (!t || t.careerId !== this.careerId || !h.peaceful()) {
      this.notification = ''; this.notificationUntil = 0
      this.guide.hide(); this.hud.render('', '', '', true); return
    }
    if (h.blocked()) { this.guide.hide(); this.hud.render('', '', this.saveError, true); return }
    if (t.town.status === 'deferred' && t.purchases.weaponIds.length && t.rewards.weapon === undefined && !t.town.replay) {
      this.change(profile => { claimCareerTutorialReward(profile, 'weapon') })
    }
    const stage = this.activeStage()
    let target: Vector3 | null = null, label = '', interact = true, text = ''
    const npc = (id: string, name: string) => { target = h.npcPosition(id); label = name }

    if (stage === 'town') {
      let step = t.town.step
      if (step === 'weapon' && h.profile().tutorial?.purchases.weaponIds.length) {
        let granted = 0
        const ok = this.change(profile => {
          recordCareerTutorialOperation(profile, 'town', 'weapon')
          granted = claimCareerTutorialReward(profile, 'weapon')
        })
        if (ok) {
          this.notification = granted > 0 ? `武器購買完成！獲得 ${granted} 軍功。` : '武器購買完成！'
          this.notificationUntil = performance.now() + 3500
        }
        step = h.profile().tutorial?.town.step ?? step
      }
      if (step === 'duel' && h.profile().tutorial?.duelOutcome && !h.profile().tutorial?.town.replay) {
        this.record('town', 'duel')
        step = h.profile().tutorial?.town.step ?? step
      }
      if (step === 'horse' && hasCareerTutorialHorse(h.profile())) {
        let granted = 0
        const ok = this.change(profile => {
          recordCareerTutorialOperation(profile, 'town', 'horse')
          granted = claimCareerTutorialReward(profile, 'horse')
        })
        if (ok) {
          this.notification = granted > 0 ? `戰馬購買完成！獲得 ${granted} 軍功。` : '已確認你擁有戰馬，不補發軍功。'
          this.notificationUntil = performance.now() + 3500
        }
        step = h.profile().tutorial?.town.step ?? step
      }
      if (step === 'horse-use' && h.playerHorse()) {
        this.record('town', 'horse-use')
        step = h.profile().tutorial?.town.step ?? step
      }

      if (step === 'weapon') {
        npc('merchant', '武器店主')
        text = '前往武器店購買第一把武器\n買好後按 Tab 開啟背包裝備；也可先找士官長空手接任務。'
      } else if (step === 'duel') {
        npc('captain', '騎兵隊長')
        text = '挑戰騎兵隊長\n靠近隊長按 E 開始切磋。'
      } else if (step === 'horse') {
        const vendor = ['ranger', 'cat', 'eagle-trainer'].find(id => townShopProducts(id).some(item => item.id === 'horse'))
        if (vendor) npc(vendor, '軍用戰馬商人')
        text = '購買第一匹戰馬\n順著指標前往馬店購買普通馬'
      } else if (step === 'horse-use') {
        text = '購買第一匹戰馬\n按 Tab → 坐騎，召喚並騎乘。'
        interact = false
      } else if (step === 'horse-intro') {
        const horsePrice = careerShopProduct('horse')!.price
        const affordable = h.profile().availableMerit >= horsePrice
        const hasHorse = hasCareerTutorialHorse(h.profile())
        if (t.settledMissionIds.length >= 2 && (affordable || hasHorse)) {
          npc('deployment', '士官長')
          text = hasHorse ? '返回士官長\n已完成兩次實戰，回士官長了解戰馬與賽馬' : '返回士官長\n已完成兩次實戰，回士官長了解購買戰馬'
        } else if (t.settledMissionIds.length >= 2) {
          text = `累積購馬軍功\n已完成 2/2 次實戰，目前軍功不足（戰馬需 ${horsePrice} 軍功）。`
          interact = false
        } else {
          text = `完成正式戰鬥任務\n找士官長接受正式任務（已完成 ${Math.min(2, t.settledMissionIds.length)} / 2 次）`
          interact = false
        }
      } else if (step === 'report') {
        npc('deployment', '士官長')
        text = '向士官長報到\n按 E 與士官長交談'
      } else if (step === 'duel-intro') {
        npc('deployment', '士官長')
        text = '返回士官長\n按 E 向士官長回報，了解下一步'
      } else if (step === 'missions') {
        npc('deployment', '士官長')
        text = '返回士官長\n切磋已結束，按 E 向士官長回報，接取第一個任務'
      } else {
        npc('deployment', '士官長')
        text = '向士官長報到'
      }
    } else if (stage === 'captain') {
      npc('deployment', '士官長')
      text = '率領 30 人完成指揮演練\n找士官長開始隊長指揮訓練'
    } else if (stage === 'hr') {
      if (t.hr.step === 'recruited' && h.profile().personalSquad?.members.length) { this.record('hr', 'recruited'); return }
      if (t.hr.step === 'recruited') {
        npc('hr-officer', '人力資源官')
        text = '招募第一位戰友\n前往 HR Center 挑選戰友'
      } else {
        text = '對戰友下達隨行命令\n按 Q 進入指揮 → 選擇 Personal Squad → Follow me'
        interact = false
      }
    } else if (stage === 'commander') {
      const step = t.commander.step
      interact = false
      if (t.commander.status === 'available') {
        npc('deployment', '士官長')
        interact = true
        text = '登上指揮塔，號令全軍\n向士官長了解指揮塔'
      } else if (step.startsWith('tower-')) {
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
        text = '登上指揮塔，號令全軍\n沿入口與坡道前往塔頂'
      } else {
        text = (step === 'all' || step === 'defend')
          ? '登上指揮塔，號令全軍\n按 Q 進入指揮 → 選 ALL 全軍 → 下達 Defend'
          : '登上指揮塔，號令全軍\n選取任一小隊 → Formation 列陣'
      }
    }

    const notice = performance.now() < this.notificationUntil ? this.notification : ''
    this.hud.render(text, notice, this.saveError, false)
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

  hasDialogue(serviceId: string): boolean {
    const h = this.host, t = h.profile().tutorial
    if (!t || !h.peaceful()) return false
    if (serviceId === 'deployment') {
      // Deferred (including legacy) tutorials never intercept the Sergeant; see appendPanel's resume buttons.
      if ((t.town.status === 'available' || t.town.status === 'active') && this.townDialogueReady()) return true
      if (t.captain.status === 'available') return true
      if (t.commander.status === 'available') return true
      return false
    }
    if (serviceId === 'captain') {
      return t.town.step === 'duel' && ['active', 'available'].includes(t.town.status)
    }
    if (serviceId === 'hr-officer') {
      return t.hr.status === 'available' || t.hr.status === 'deferred'
    }
    if (serviceId === 'commander') {
      return t.commander.status === 'available' || t.commander.status === 'deferred'
    }
    return false
  }

  /** True when the current Town step is one the Sergeant explains in person (and its conditions are met). */
  private townDialogueReady(): boolean {
    const h = this.host, t = h.profile().tutorial
    if (!t) return false
    const step = t.town.step
    if (step === 'report' || step === 'duel-intro' || step === 'missions') return true
    if (step !== 'horse-intro') return false
    const affordable = h.profile().availableMerit >= careerShopProduct('horse')!.price
    return t.settledMissionIds.length >= 2 && (affordable || hasCareerTutorialHorse(h.profile()))
  }

  private servicesButton(panel: HTMLElement, serviceId: string): void {
    const label = serviceId === 'deployment' ? '查看任務與其他服務' : serviceId === 'hr-officer' ? '其他服務' : '任命／其他服務'
    this.button(panel, label, () => this.host.openServices?.(serviceId))
  }

  private resumable(status: string): boolean {
    return status === 'available' || status === 'deferred'
  }

  private saveAndClose(
    button: HTMLButtonElement,
    panel: HTMLElement,
    mutate: (profile: CareerProfile) => boolean | void,
    onSuccess?: () => void,
    retryLabel = '重試'
  ): void {
    if (this.busy) return
    this.busy = true
    this.retryAfter = 0
    button.disabled = true
    const saved = this.change(mutate)
    if (saved) {
      this.busy = false
      this.host.closePanel()
      onSuccess?.()
    } else {
      this.busy = false
      button.disabled = false
      button.textContent = retryLabel
      this.showError(panel, this.saveError || '進度保存失敗，請點擊重試。')
    }
  }

  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'town-button'
    b.textContent = label
    b.onclick = action
    parent.append(b)
    return b
  }

  private showError(panel: HTMLElement, text: string): void {
    let err = panel.querySelector<HTMLElement>('.town-save-error')
    if (!err) {
      err = document.createElement('p')
      err.className = 'town-summary town-save-error'
      err.style.color = '#ff8888'
      panel.append(err)
    }
    err.textContent = text
  }

  renderDialogue(panel: HTMLElement, serviceId: string, only?: CareerTutorialStageId): boolean {
    const h = this.host, t = h.profile().tutorial
    if (!t || !h.peaceful()) return false

    // Clean placeholder elements
    panel.querySelectorAll('button, nav, article, .town-mission-tabs, .town-products, .town-shop-tabs, .town-shop-categories').forEach(el => el.remove())
    const titleEl = panel.querySelector('h2')
    const bodyEl = panel.querySelector('p')

    if (serviceId === 'deployment') {
      if (titleEl) titleEl.textContent = '士官長'
      if ((!only || only === 'town') && t.town.status !== 'locked' && t.town.status !== 'completed') {
        const step = t.town.step
        if (step === 'report') {
          if (bodyEl) {
            bodyEl.textContent = '「新兵，歡迎加入軍團！空手也可以用左鍵拳擊並接取任務。\n\n建議去武器店挑一把趁手的武器，也可以稍後再買。首次購買獎勵會保留。」'
          }
          const accept = this.button(panel, '好，我這就去', () => {
            this.saveAndClose(accept, panel, p => recordCareerTutorialOperation(p, 'town', 'report'))
          })
          this.button(panel, '我晚點再去', () => this.host.closePanel())
          const unarmed = this.button(panel, '先空手接任務，稍後買武器', () => {
            this.saveAndClose(unarmed, panel, p => { deferCareerTutorial(p, 'town') }, () => this.host.openServices?.('deployment'))
          })
          this.servicesButton(panel, 'deployment')
          return true
        }
        if (step === 'duel-intro') {
          if (bodyEl) {
            bodyEl.textContent = '「武器買好了？很好！不過裝備再好，也得有本事使用。\n\n我替你安排了一場與騎兵隊長的切磋。別擔心，輸了也有 20 軍功，贏了可是有 500 軍功。\n\n敢不敢接受挑戰？」'
          }
          const accept = this.button(panel, '當然，帶路吧！', () => {
            this.saveAndClose(accept, panel, p => recordCareerTutorialOperation(p, 'town', 'duel-intro'))
          })
          this.button(panel, '稍後再挑戰', () => this.host.closePanel())
          this.servicesButton(panel, 'deployment')
          return true
        }
        if (step === 'missions') {
          if (bodyEl) {
            bodyEl.textContent = '「不錯，至少你已經知道真正的戰鬥是怎麼回事了。\n\n接下來去接幾個正式任務，累積軍功。等你有能力買馬，再回來找我。\n\n另外，想繼續切磋，也可以隨時找我安排。」'
          }
          const accept = this.button(panel, '明白，我去接任務', () => {
            this.saveAndClose(accept, panel, p => recordCareerTutorialOperation(p, 'town', 'missions'))
          })
          this.button(panel, '稍後再說', () => this.host.closePanel())
          this.servicesButton(panel, 'deployment')
          return true
        }
        if (step === 'horse-intro') {
          const affordable = h.profile().availableMerit >= careerShopProduct('horse')!.price
          const hasHorse = hasCareerTutorialHorse(h.profile())
          if (t.settledMissionIds.length >= 2 && (affordable || hasHorse)) {
            if (bodyEl) {
              bodyEl.textContent = hasHorse
                ? '「你已經完成兩次實戰，也已經擁有了戰馬！按 Tab 查看坐騎，召喚後即可騎乘。隨時可以找我參加繞城賽馬。」'
                : '「你已經完成兩次實戰，累積了足夠的軍功。\n\n是時候給自己配備一匹真正的戰馬了！順著指標前往馬店挑選一匹普通馬，買下後我會額外發放 50 軍功作為裝備補助。」'
            }
            const accept = this.button(panel, hasHorse ? '明白了' : '好，我去挑選戰馬', () => {
              this.saveAndClose(accept, panel, p => recordCareerTutorialOperation(p, 'town', 'horse-intro'))
            })
            this.button(panel, '稍後再去', () => this.host.closePanel())
            this.servicesButton(panel, 'deployment')
            return true
          }
        }
      }
      if ((!only || only === 'captain') && this.resumable(t.captain.status)) {
        if (bodyEl) {
          bodyEl.textContent = '「恭喜你晉升為騎兵隊長！從現在開始，你將擁有指揮三十名士兵的權限。\n\n我為你準備了一場指揮演練，熟悉如何帶領部隊變換隊形與發動衝鋒。準備好了嗎？」'
        }
        const launchBtn = this.button(panel, '開始 30 人指揮演練', () => {
          if (this.busy) return
          this.busy = true
          launchBtn.disabled = true
          const ok = h.launch('captain', false)
          this.busy = false
          if (!ok) {
            launchBtn.disabled = false
            this.showError(panel, '演練轉場失敗，請稍後重試。')
          }
        })
        this.button(panel, '稍後再訓練', () => {
          this.change(p => { deferCareerTutorial(p, 'captain') })
          this.host.closePanel()
        })
        this.servicesButton(panel, 'deployment')
        return true
      }
      if ((!only || only === 'commander') && this.resumable(t.commander.status)) {
        if (bodyEl) {
          bodyEl.textContent = '「指揮官，全軍現在聽候你的調遣！登上指揮塔頂，你將俯瞰整個城鎮的四門防線，號令所有城防小隊。\n\n準備好登上指揮塔號令全軍了嗎？」'
        }
        const accept = this.button(panel, '前往指揮塔', () => {
          this.saveAndClose(accept, panel, p => {
            startCareerTutorial(p, 'commander')
            return p.tutorial?.commander.status === 'active'
          })
        })
        this.button(panel, '稍後再說', () => {
          this.change(p => { deferCareerTutorial(p, 'commander') })
          this.host.closePanel()
        })
        this.servicesButton(panel, 'deployment')
        return true
      }
    }

    if (serviceId === 'captain' && t.town.step === 'duel' && ['active', 'available'].includes(t.town.status)) {
      if (titleEl) titleEl.textContent = '騎兵隊長'
      if (bodyEl) {
        bodyEl.textContent = '「聽說士官長派你來接受訓練？很好，讓我看看你的實力。準備好了嗎？」'
      }
      this.button(panel, '開始切磋', () => h.duel())
      this.button(panel, '還沒準備好', () => this.host.closePanel())
      this.servicesButton(panel, 'captain')
      return true
    }

    if (serviceId === 'hr-officer' && this.resumable(t.hr.status)) {
      if (titleEl) titleEl.textContent = 'HR Officer · 人力資源官'
      if (bodyEl) {
        bodyEl.textContent = '「隊長，恭喜你組建自己的部隊！在 HR Center，你可以招募專屬於你的私人戰友，上限 30 人。\n\n挑選第一位戰友加入你的隊伍吧！」'
      }
      const accept = this.button(panel, '開始招募戰友', () => {
        this.saveAndClose(accept, panel, p => {
          startCareerTutorial(p, 'hr')
          return p.tutorial?.hr.status === 'active'
        }, () => this.host.openRecruitmentPanel?.())
      })
      this.button(panel, '稍後再招募', () => this.host.closePanel())
      this.servicesButton(panel, 'hr-officer')
      return true
    }

    if (serviceId === 'commander' && this.resumable(t.commander.status)) {
      if (titleEl) titleEl.textContent = h.profile().faction === 'roman' ? '羅馬指揮官' : '維京指揮官'
      if (bodyEl) {
        bodyEl.textContent = '「指揮官，全軍現在聽候你的調遣！登上指揮塔頂，你將俯瞰整個城鎮的四門防線，號令所有城防小隊。\n\n準備好登上指揮塔號令全軍了嗎？」'
      }
      const accept = this.button(panel, '前往指揮塔', () => {
        this.saveAndClose(accept, panel, p => {
          startCareerTutorial(p, 'commander')
          return p.tutorial?.commander.status === 'active'
        })
      })
      this.button(panel, '稍後再說', () => {
        this.change(p => { deferCareerTutorial(p, 'commander') })
        this.host.closePanel()
      })
      this.servicesButton(panel, 'commander')
      return true
    }

    return false
  }

  hasReviewOptions(): boolean {
    const t = this.host.profile().tutorial
    if (!t) return false
    return t.recruit.status === 'completed'
      || t.town.status === 'completed'
      || t.captain.status === 'completed'
      || t.hr.status === 'completed'
      || t.commander.status === 'completed'
  }

  renderReviewContent(panel: HTMLElement): void {
    const h = this.host, t = h.profile().tutorial
    const heading = document.createElement('h3'); heading.textContent = '重溫入伍旅程'; panel.append(heading)
    const desc = document.createElement('p'); desc.className = 'town-summary'
    desc.textContent = (!t || !this.hasReviewOptions())
      ? '目前尚無已完成的訓練課程可供重溫。'
      : '重溫過去的訓練課程。重播不重複發放軍功獎勵。'
    panel.append(desc)
    if (!t || !this.hasReviewOptions()) return

    if (t.recruit.status === 'completed') {
      this.button(panel, '重播操作練習', () => h.launch('recruit', true))
    }
    const replay = (label: string, stage: 'town' | 'hr' | 'commander') => {
      const b = this.button(panel, label, () => this.saveAndClose(b, panel, p => {
        startCareerTutorial(p, stage, true)
        return p.tutorial?.[stage].status === 'active'
      }, () => { if (stage === 'commander') this.towerRouteIndex = null }))
    }
    if (t.town.status === 'completed') replay('重播城鎮訓練', 'town')
    if (t.captain.status === 'completed') {
      this.button(panel, '重播隊長指揮演練', () => h.launch('captain', true))
    }
    if (t.hr.status === 'completed') replay('重播 HR 私人小隊引導', 'hr')
    if (t.commander.status === 'completed') replay('重播指揮塔引導', 'commander')
  }

  openReviewPanel(): void {
    const h = this.host, t = h.profile().tutorial
    if (!t || !this.hasReviewOptions()) return
    const panel = this.host.openPanel?.('重溫入伍旅程', '')
    if (!panel) return
    this.renderReviewContent(panel)
    this.button(panel, '返回', () => {
      this.host.openServices?.('deployment')
    })
  }

  /** `bypass` is set while the player explicitly opened the regular service panel; tutorial dialogue must not clear it. */
  appendPanel(panel: HTMLElement, serviceId: string, bypass = false): void {
    if (!bypass && this.hasDialogue(serviceId)) {
      this.renderDialogue(panel, serviceId)
      return
    }
    if (serviceId !== 'deployment') return
    const t = this.host.profile().tutorial
    if (t && this.host.peaceful()) {
      if (t.town.step === 'weapon' && t.town.status !== 'deferred') {
        const skip = this.button(panel, '延後購買武器教學（保留首次購買獎勵）', () => this.saveAndClose(skip, panel, p => { deferCareerTutorial(p, 'town') }))
      }
      const resume = (label: string, stage: 'town' | 'captain' | 'commander') => this.button(panel, label, () => {
        const next = this.host.openPanel?.('士官長', '')
        if (next) this.renderDialogue(next, 'deployment', stage)
      })
      if (t.town.status === 'deferred') {
        if (this.townDialogueReady()) resume('繼續新兵訓練', 'town')
        else {
          // Navigation-only steps (or horse-intro before its conditions): reactivate in place, keeping step/operations.
          const b = this.button(panel, '繼續新兵訓練', () => this.saveAndClose(b, panel, p => {
            startCareerTutorial(p, 'town')
            return p.tutorial?.town.status === 'active'
          }))
        }
      }
      if (t.captain.status === 'deferred') resume('繼續 30 人指揮演練', 'captain')
      if (t.commander.status === 'deferred') resume('繼續指揮塔訓練', 'commander')
    }
  }

  dispose(): void {
    this.guide.dispose()
    this.hud.dispose()
  }
}
