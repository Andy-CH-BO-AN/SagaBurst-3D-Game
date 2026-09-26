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
        <button type="button" class="main-menu-card" id="main-menu-hero-mounts">
          <strong>英雄坐騎試騎</strong>
          <span>HERO MOUNTS</span>
          <small>選擇黑貓或柯基，進入空場試騎</small>
        </button>
      </div>
    `
    parent.appendChild(container)
    this.container = container

    container.querySelector('#main-menu-custom')?.addEventListener('click', actions.onCustomBattle)
    container.querySelector('#main-menu-campaign')?.addEventListener('click', actions.onCampaign)
    container.querySelector('#main-menu-reference')?.addEventListener('click', actions.onReference)
    container.querySelector('#main-menu-hero-mounts')?.addEventListener('click', () => {
      container.innerHTML = `
        <button type="button" class="setup-back-btn" id="hero-mounts-back">← 回首頁</button>
        <div class="setup-header">
          <h1 class="setup-title">英雄坐騎試騎</h1>
          <div class="setup-subtitle">CHOOSE YOUR MOUNT</div>
        </div>
        <div class="main-menu-grid hero-mount-grid">
          <a class="main-menu-card" href="?freeride=1&mount=black-cat&nolock">
            <strong>黑貓坐騎</strong>
            <span>MOONSHADOW</span>
            <small>騎乘月影旅者，體驗牠的步態與動作</small>
          </a>
          <a class="main-menu-card" href="?freeride=1&mount=corgi&nolock">
            <strong>柯基坐騎</strong>
            <span>GILDED GUARDIAN</span>
            <small>騎乘赤金衛士，體驗牠的具裝與步態</small>
          </a>
        </div>
      `
      container.querySelector('#hero-mounts-back')?.addEventListener('click', () => this.mount(parent, actions))
    })
  }

  destroy(): void {
    this.container?.remove()
    this.container = null
  }
}
