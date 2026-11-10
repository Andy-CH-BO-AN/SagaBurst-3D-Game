export interface TownSaleOption {
  id: string
  name: string
  quantity: number
  refund: number
}

/** Shop and HR bulk actions share the same selection and refund preview. */
export function appendTownSaleDropdown(parent: HTMLElement, options: TownSaleOption[],
  sell: (ids: string[]) => void, unit: '件' | '人' = '件', enabled = true, verb: '賣出' | '遣散' = '賣出'): void {
  if (!options.length) return
  const section = document.createElement('section'); section.className = 'town-sale'
  const label = document.createElement('label'); label.textContent = `批次${verb}`
  const select = document.createElement('select'); select.className = 'town-button town-sale-select'; select.ariaLabel = `批次${verb}項目`
  const selection = () => select.value ? options.filter(item => item.id === select.value) : options
  const totals = (items: TownSaleOption[]) => ({
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    refund: items.reduce((sum, item) => sum + item.refund, 0),
  })
  const all = totals(options)
  for (const item of [{ id: '', name: `全部可${verb}`, quantity: all.count, refund: all.refund }, ...options]) {
    const option = document.createElement('option'); option.value = item.id
    option.textContent = `${item.name} · ${item.quantity} ${unit} · ${item.refund.toLocaleString()} 軍功`
    select.append(option)
  }
  select.value = ''; select.disabled = !enabled
  const button = document.createElement('button'); button.className = 'town-button'; button.disabled = !enabled
  const update = () => {
    const total = totals(selection())
    button.textContent = `${verb} ${total.count} ${unit} · 收回 ${total.refund.toLocaleString()} 軍功`
    button.disabled = !enabled || !total.count
  }
  select.onchange = update
  button.onclick = () => { if (!button.disabled) sell(selection().map(item => item.id)) }
  update(); label.append(select); section.append(label, button); parent.append(section)
}
