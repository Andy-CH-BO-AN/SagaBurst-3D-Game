import './battle-setup.css'

export interface MainMenuActions {
  onCustomBattle: () => void
  onCampaign: () => void
  onReference: () => void
}

export class MainMenuUI {
  private container: HTMLElement | null = null

  mount(
    parent: HTMLElement = document.body,
    actions: MainMenuActions,
  ): void {
    this.destroy()
    const container = document.createElement('div')
    container.id = 'main-menu-container'
    container.innerHTML = `
      <div class="setup-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">CHOOSE YOUR MODE</div>
      </div>

      <div class="main-menu-grid">
        <button type="button" class="main-menu-card" id="main-menu-custom">
          <strong>自訂戰鬥</strong>
          <span>CUSTOM BATTLE</span>
          <small>自由配置雙方兵力、兵種與裝備</small>
        </button>
        <button type="button" class="main-menu-card campaign" id="main-menu-campaign">
          <strong>戰役</strong>
          <span>CAMPAIGN</span>
          <small>率領軍隊守住前哨站，逐關迎戰更強敵軍</small>
        </button>
        <button type="button" class="main-menu-card reference" id="main-menu-reference">
          <strong>兵種與武器</strong>
          <span>UNITS & WEAPONS</span>
          <small>查看兵種特性、戰鬥數值、武器與盾牌資料</small>
        </button>
        <a class="main-menu-card" href="?devmodels=black-cat&nolock" style="text-decoration:none">
          <strong>黑貓坐騎</strong>
          <span>MOONSHADOW</span>
          <small>查看月影旅者的外觀、步態與騎乘</small>
        </a>
        <a class="main-menu-card" href="?devmodels=corgi&nolock" style="text-decoration:none">
          <strong>柯基坐騎</strong>
          <span>GILDED GUARDIAN</span>
          <small>查看赤金衛士的具裝、步態與騎乘</small>
        </a>
      </div>
    `
    parent.appendChild(container)
    this.container = container

    container.querySelector('#main-menu-custom')?.addEventListener('click', actions.onCustomBattle)
    container.querySelector('#main-menu-campaign')?.addEventListener('click', actions.onCampaign)
    container.querySelector('#main-menu-reference')?.addEventListener('click', actions.onReference)
  }

  destroy(): void {
    this.container?.remove()
    this.container = null
  }
}
