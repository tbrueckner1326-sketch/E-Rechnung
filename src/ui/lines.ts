/**
 * DOM-Logik für Rechnungspositionen (Zeilen-Tabelle).
 * Kein Geschäftslogik-Code — XML-Generierung und Parsing liegen in src/lib/.
 */

import type { InvoiceLine, Totals, UnitCode, TaxCategory, TaxGroup } from '../types/invoice'
import { escXml, fmt } from '../lib/xml-utils'

let lineCount = 0

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

export function isReverseCharge(): boolean {
  const el = document.getElementById('rc_active') as HTMLInputElement | null
  return el?.checked ?? false
}

/** Setzt linesBody zurück und resettet den Zähler. */
export function resetLines(): void {
  ;(document.getElementById('linesBody') as HTMLElement).innerHTML = ''
  lineCount = 0
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

export function addLine(vals?: {
  desc?: string
  qty?: number
  unit?: string
  price?: number
  vat?: number
}): void {
  const v = {
    desc: vals?.desc ?? '',
    qty: vals?.qty ?? 1,
    unit: vals?.unit ?? 'H87',
    price: vals?.price ?? 0,
    vat: vals?.vat ?? 19,
  }
  lineCount++
  const id = 'line' + lineCount
  const tr = document.createElement('tr')
  tr.id = id
  const rc = isReverseCharge()
  tr.innerHTML = `
    <td><textarea class="l-desc" rows="1" placeholder="z. B. Vermessungsleistung Bauabschnitt 2">${escXml(v.desc)}</textarea></td>
    <td><input type="number" class="l-qty" value="${v.qty}" step="0.01" min="0"></td>
    <td>
      <select class="l-unit">
        <option value="H87" ${v.unit === 'H87' ? 'selected' : ''}>Stück</option>
        <option value="HUR" ${v.unit === 'HUR' ? 'selected' : ''}>Stunde</option>
        <option value="DAY" ${v.unit === 'DAY' ? 'selected' : ''}>Tag</option>
        <option value="MTK" ${v.unit === 'MTK' ? 'selected' : ''}>m²</option>
        <option value="MTR" ${v.unit === 'MTR' ? 'selected' : ''}>m</option>
        <option value="C62" ${v.unit === 'C62' ? 'selected' : ''}>Pauschale</option>
      </select>
    </td>
    <td><input type="number" class="l-price" value="${v.price}" step="0.01"></td>
    <td>
      <select class="l-vat" ${rc ? 'disabled' : ''}>
        <option value="19" ${v.vat == 19 ? 'selected' : ''}>19 %</option>
        <option value="7" ${v.vat == 7 ? 'selected' : ''}>7 %</option>
        <option value="0" ${v.vat == 0 ? 'selected' : ''}>0 %</option>
      </select>
    </td>
    <td class="l-net">0,00</td>
    <td class="col-rm"><button class="rm" data-line-id="${id}" title="Position entfernen">×</button></td>
  `
  tr.querySelector('.l-qty')!.addEventListener('change', () => recalc())
  tr.querySelector('.l-price')!.addEventListener('change', () => recalc())
  tr.querySelector('.l-vat')!.addEventListener('change', () => recalc())
  tr.querySelector('.rm')!.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    removeLine(btn.dataset['lineId']!)
  })
  document.getElementById('linesBody')!.appendChild(tr)
  recalc()
}

export function removeLine(id: string): void {
  const el = document.getElementById(id)
  if (el) el.remove()
  recalc()
}

export function getLines(): InvoiceLine[] {
  const rows = document.querySelectorAll('#linesBody tr')
  const out: InvoiceLine[] = []
  const rc = isReverseCharge()
  rows.forEach((tr) => {
    const desc = (tr.querySelector('.l-desc') as HTMLTextAreaElement).value.trim()
    const qty = parseFloat((tr.querySelector('.l-qty') as HTMLInputElement).value) || 0
    const rawUnit = (tr.querySelector('.l-unit') as HTMLSelectElement).value
    const unit: UnitCode = ['H87', 'HUR', 'DAY', 'MTK', 'MTR', 'C62'].includes(rawUnit)
      ? (rawUnit as UnitCode)
      : 'C62'
    const price = parseFloat((tr.querySelector('.l-price') as HTMLInputElement).value) || 0
    const vat = rc ? 0 : parseFloat((tr.querySelector('.l-vat') as HTMLSelectElement).value)
    const category: TaxCategory = rc ? 'AE' : vat === 0 ? 'Z' : 'S'
    const net = qty * price
    ;(tr.querySelector('.l-net') as HTMLElement).textContent = fmt(net)
    out.push({ desc, qty, unit, price, vat, category, net })
  })
  return out
}

export function recalc(): Totals {
  const lines = getLines()
  const net = lines.reduce((a, l) => a + l.net, 0)
  const byGroup: Record<string, TaxGroup> = {}
  lines.forEach((l) => {
    const key = l.category + '|' + l.vat
    if (!byGroup[key]) byGroup[key] = { rate: l.vat, category: l.category, base: 0 }
    byGroup[key]!.base += l.net
  })

  ;(document.getElementById('t_net') as HTMLElement).textContent = fmt(net) + ' €'
  const taxRowsEl = document.getElementById('taxRows')!
  taxRowsEl.innerHTML = ''
  let totalTax = 0
  const grandRow = document.querySelector('.totals table tr.grand')!
  Object.values(byGroup)
    .sort((a, b) => b.rate - a.rate)
    .forEach((g) => {
      const tax = g.base * (g.rate / 100)
      totalTax += tax
      const label = g.category === 'AE' ? 'Reverse-Charge (§13b, 0 %)' : `zzgl. USt ${g.rate} %`
      const row = document.createElement('tr')
      row.innerHTML = `<td>${label}</td><td>${fmt(tax)} €</td>`
      grandRow.parentElement!.insertBefore(row, grandRow)
    })
  const gross = net + totalTax

  ;(document.getElementById('t_gross') as HTMLElement).textContent = fmt(gross) + ' €'

  const skPercent = parseFloat((document.getElementById('sk_percent') as HTMLInputElement).value) || 0
  const skDays = parseInt((document.getElementById('sk_days') as HTMLInputElement).value) || 0
  const skHint = document.getElementById('sk_hint') as HTMLElement
  if (skPercent > 0 && skDays > 0) {
    const skAmount = gross * (skPercent / 100)
    skHint.textContent = `Skontobetrag bei fristgerechter Zahlung: ${fmt(skAmount)} € (verbleibender Betrag: ${fmt(gross - skAmount)} €).`
  } else {
    skHint.textContent = ''
  }

  return { lines, net, byGroup, totalTax, gross }
}
