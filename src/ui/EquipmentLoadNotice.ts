/** Honest, non-blocking notice: the item has no model and no combat effect until it loads; nothing fake is shown. */
export function showEquipmentLoadNotice(itemName: string): void {
  console.error(`Equipment model unavailable: ${itemName}`)
  if (typeof document === 'undefined' || document.getElementById('equipment-load-notice')) return
  const note = document.createElement('div')
  note.id = 'equipment-load-notice'
  note.setAttribute('role', 'alert')
  note.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:10001;padding:8px 14px;background:#3a2320;color:#fff;border:1px solid #8d5a50;border-radius:6px;font:13px system-ui'
  note.textContent = `${itemName} 模型載入失敗，暫時無法使用這件裝備；系統會自動重試，重新裝備可立即再試。`
  document.body.append(note)
  setTimeout(() => note.remove(), 8000)
}
