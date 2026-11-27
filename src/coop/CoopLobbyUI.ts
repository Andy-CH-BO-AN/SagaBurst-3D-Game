/** LAN co-op lobby, guest waiting room and the always-on link badge. */
import { COOP_MAX_GUESTS, coopSession, DEFAULT_COOP_PORT, parseCoopAddress } from './CoopLink'

const STYLE_ID = 'coop-lobby-style'
function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .coop-panel{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:#171411;color:#efe3cc;font:15px/1.6 system-ui;overflow:auto;padding:24px;box-sizing:border-box}
    .coop-card{width:min(560px,100%);display:flex;flex-direction:column;gap:14px;padding:28px;border:1px solid #6d5532;border-radius:12px;background:#211b14}
    .coop-card h1{margin:0;font-size:26px;letter-spacing:.06em}
    .coop-card p{margin:0}
    .coop-muted{color:#b9a888;font-size:13px}
    .coop-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .coop-row input{flex:1;min-width:160px;padding:9px 11px;border-radius:6px;border:1px solid #6d5532;background:#15110c;color:#f3e7cf;font:inherit}
    .coop-btn{padding:9px 16px;border-radius:6px;border:1px solid #a07a3e;background:#3a2c18;color:#f6e9cf;font:inherit;cursor:pointer}
    .coop-btn:hover{background:#4b3920}
    .coop-btn.secondary{background:transparent;border-color:#6d5532}
    .coop-status{padding:10px 12px;border-radius:6px;background:#15110c;border:1px solid #3c3020;white-space:pre-line}
    .coop-error{color:#f19a7c}
    #coop-badge{position:fixed;top:8px;right:8px;z-index:9500;padding:4px 10px;border-radius:999px;background:rgba(20,16,12,.82);border:1px solid #8a6a3a;color:#f1e6d2;font:12px system-ui;pointer-events:none}
  `
  document.head.append(style)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function statusText(): string {
  const link = coopSession(), state = link.state
  if (state.status === 'connecting') return '連線中…'
  if (!link.role) return state.error ? '' : '尚未建立連線。'
  if (state.status !== 'connected') return '連線已中斷。'
  if (link.isHost) {
    const addresses = state.addresses?.length ? state.addresses.map(a => `${a}`).join('、') : '（找不到區網 IP，請在系統設定查看本機 IP）'
    const guests = link.peers.length
    return `房間已建立（連接埠 ${state.port}）\n請隊友輸入這台電腦的 IP：${addresses}\n${guests
      ? `✔ ${guests}／${COOP_MAX_GUESTS} 位隊友已加入。進入生涯模式後，所有隊友都會跟著你出戰；城鎮與競技場目前只有第一位隊友同行。`
      : `等待隊友加入…（最多 ${COOP_MAX_GUESTS} 位）`}`
  }
  const seat = link.seat ? `（隊友 ${link.seat}）` : ''
  return link.peerConnected ? `已連線到主機 ${state.address}${seat}。` : `已連上 ${state.address}，等待主機回應…`
}

/** Main-menu entry: create or join a room. */
export function showCoopLobby(onBack: () => void, onEnterCareer: () => void, onGuestJoined: () => void): () => void {
  installStyles()
  const link = coopSession()
  const panel = el('section', { className: 'coop-panel', id: 'coop-lobby' })
  const card = el('div', { className: 'coop-card' })
  const status = el('p', { className: 'coop-status' })
  const error = el('p', { className: 'coop-error' })
  const address = el('input', { placeholder: '主機 IP，例如 192.168.1.20', value: link.state.address && link.state.role === 'guest' ? link.state.address : '' })
  address.setAttribute('aria-label', '主機 IP')
  const hostButton = el('button', { className: 'coop-btn', textContent: '建立房間（我當主機）' })
  const joinButton = el('button', { className: 'coop-btn', textContent: '加入' })
  const careerButton = el('button', { className: 'coop-btn', textContent: '進入生涯模式' })
  const leaveButton = el('button', { className: 'coop-btn secondary', textContent: '中斷連線' })
  const backButton = el('button', { className: 'coop-btn secondary', textContent: '返回主選單' })
  const desktop = Boolean((window as unknown as { sagaburstCoop?: unknown }).sagaburstCoop)
  card.append(
    el('h1', { textContent: '區網合作 CO-OP' }),
    el('p', { className: 'coop-muted', textContent: '最多四台電腦（主機加 3 位隊友）連同一個 WiFi／區網。所有隊友都會跟著主機進入同一個戰場；城鎮、競技場、試煉與越獄目前只支援主機加 1 位隊友（城鎮裡可以一起走動；競技場單挑變成 2v1；賽馬三人同場，最快的人才有獎勵），其他隊友在等待畫面等主機下次出戰。主機照自己的階級指揮任務部隊與私兵；隊友只能指揮自己的 HR 私兵（隊友會帶自己存檔裡的私兵參戰）。除了隊友贏得的賽馬獎勵，合作模式不會寫入隊友的存檔。' }),
    el('div', { className: 'coop-row' }, hostButton),
    el('div', { className: 'coop-row' }, address, joinButton),
    status, error,
    el('div', { className: 'coop-row' }, careerButton, leaveButton, backButton),
    el('p', { className: 'coop-muted', textContent: desktop
      ? `桌面版會自動在連接埠 ${DEFAULT_COOP_PORT} 開房；第一次建立房間時，作業系統可能詢問是否允許區網連線，請選允許。`
      : `網頁版需要主機先在專案目錄執行 npm run coop:hub，並用 npm run dev -- --host 讓隊友開啟主機的網址。` }),
  )
  panel.append(card)
  document.body.append(panel)

  const render = (): void => {
    status.textContent = statusText()
    status.hidden = !status.textContent
    error.textContent = link.state.error ?? ''
    error.hidden = !link.state.error || link.connected
    const busy = link.state.status === 'connecting'
    hostButton.disabled = joinButton.disabled = busy
    careerButton.hidden = !(link.isHost && link.connected)
    leaveButton.hidden = !link.role
    if (link.isGuest && link.connected) { dispose(); onGuestJoined() }
  }
  const offChange = link.onChange(render)
  hostButton.onclick = () => { void link.host(DEFAULT_COOP_PORT) }
  const join = (): void => {
    const target = parseCoopAddress(address.value)
    if (!target) { error.textContent = '主機位址格式不正確，請輸入主機的 IP，例如 192.168.1.20'; error.hidden = false; return }
    void link.join(target.host, target.port)
  }
  joinButton.onclick = join
  address.onkeydown = event => { if (event.key === 'Enter') join() }
  leaveButton.onclick = () => { void link.leave() }
  careerButton.onclick = () => { dispose(); onEnterCareer() }
  backButton.onclick = () => { dispose(); onBack() }
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    offChange()
    panel.remove()
  }
  render()
  return dispose
}

/** Guest between missions: nothing to do but wait for the host's launch. */
export function showCoopGuestWaiting(onLeave: () => void): () => void {
  installStyles()
  const link = coopSession()
  const panel = el('section', { className: 'coop-panel', id: 'coop-guest-waiting' })
  const status = el('p', { className: 'coop-status' })
  const leave = el('button', { className: 'coop-btn secondary', textContent: '離開房間' })
  panel.append(el('div', { className: 'coop-card' },
    el('h1', { textContent: '等待主機' }),
    el('p', { className: 'coop-muted', textContent: '主機進入生涯模式後，你會自動跟著主機出戰；城鎮與競技場一次只有一位隊友同行，其他隊友在這裡等主機下次出戰。' }),
    status, el('div', { className: 'coop-row' }, leave)))
  document.body.append(panel)
  const render = (): void => {
    status.textContent = link.connected ? statusText() : '與主機的連線已中斷；可離開房間後重新加入。'
  }
  const offChange = link.onChange(render)
  render()
  leave.onclick = () => { offChange(); panel.remove(); void link.leave().then(onLeave) }
  return () => { offChange(); panel.remove() }
}

/** Small persistent indicator of the co-op link in every scene. */
export function mountCoopBadge(): void {
  installStyles()
  const link = coopSession()
  const render = (): void => {
    let badge = document.getElementById('coop-badge')
    if (!link.role) { badge?.remove(); return }
    if (!badge) { badge = el('div', { id: 'coop-badge' }); document.body.append(badge) }
    const who = link.isHost ? '主機' : '隊友'
    const peers = link.isHost
      ? (link.peers.length ? `${link.peers.length} 位隊友已連線` : '等待隊友')
      : (link.peerConnected ? '主機已連線' : '等待主機')
    badge.textContent = !link.connected ? `CO-OP ${who} · 連線中斷` : `CO-OP ${who}${!link.isHost && link.seat ? ` ${link.seat}` : ''} · ${peers}`
  }
  link.onChange(render)
  render()
}

/** A short notice over any scene (co-op awards and results). */
export function showCoopToast(text: string, seconds = 8): void {
  installStyles()
  const toast = el('div', { className: 'coop-toast', textContent: text })
  toast.style.cssText = 'position:fixed;top:48px;left:50%;transform:translateX(-50%);z-index:9600;padding:10px 18px;border-radius:8px;background:rgba(20,16,12,.9);border:1px solid #a07a3e;color:#f6e9cf;font:15px system-ui;pointer-events:none;max-width:min(90vw,640px);text-align:center'
  document.body.append(toast)
  setTimeout(() => toast.remove(), seconds * 1000)
}
