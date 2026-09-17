// @ts-nocheck
// Temporärer Shim: enthält die bisherige JS-Logik aus xrechnung-generator.html.
// Wird schrittweise durch Importe aus src/lib/ ersetzt (Issues #4, #5, #7, #8).

import JSZip from 'jszip'

// CDN-Fallback für pdf.js bleibt bis Issue #8 aktiv
declare const pdfjsLib: any
const pdfWorkerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
}

let lineCount = 0

function addLine(vals?: any) {
  vals = vals || { desc: '', qty: 1, unit: 'H87', price: 0, vat: 19 }
  lineCount++
  const id = 'line' + lineCount
  const tr = document.createElement('tr')
  tr.id = id
  tr.innerHTML = `
    <td><textarea class="l-desc" rows="1" placeholder="z. B. Vermessungsleistung Bauabschnitt 2">${escXml(vals.desc)}</textarea></td>
    <td><input type="number" class="l-qty" value="${vals.qty}" step="0.01" min="0"></td>
    <td>
      <select class="l-unit">
        <option value="H87" ${vals.unit === 'H87' ? 'selected' : ''}>Stück</option>
        <option value="HUR" ${vals.unit === 'HUR' ? 'selected' : ''}>Stunde</option>
        <option value="DAY" ${vals.unit === 'DAY' ? 'selected' : ''}>Tag</option>
        <option value="MTK" ${vals.unit === 'MTK' ? 'selected' : ''}>m²</option>
        <option value="MTR" ${vals.unit === 'MTR' ? 'selected' : ''}>m</option>
        <option value="C62" ${vals.unit === 'C62' ? 'selected' : ''}>Pauschale</option>
      </select>
    </td>
    <td><input type="number" class="l-price" value="${vals.price}" step="0.01"></td>
    <td>
      <select class="l-vat" ${(document.getElementById('rc_active') as HTMLInputElement)?.checked ? 'disabled' : ''}>
        <option value="19" ${vals.vat == 19 ? 'selected' : ''}>19 %</option>
        <option value="7" ${vals.vat == 7 ? 'selected' : ''}>7 %</option>
        <option value="0" ${vals.vat == 0 ? 'selected' : ''}>0 %</option>
      </select>
    </td>
    <td class="l-net">0,00</td>
    <td class="col-rm"><button class="rm" data-line-id="${id}" title="Position entfernen">×</button></td>
  `
  tr.querySelector('.l-qty')!.addEventListener('change', recalc)
  tr.querySelector('.l-price')!.addEventListener('change', recalc)
  tr.querySelector('.l-vat')!.addEventListener('change', recalc)
  tr.querySelector('.rm')!.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    removeLine(btn.dataset.lineId!)
  })
  document.getElementById('linesBody')!.appendChild(tr)
  recalc()
}

function removeLine(id: string) {
  const el = document.getElementById(id)
  if (el) el.remove()
  recalc()
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isReverseCharge(): boolean {
  const el = document.getElementById('rc_active') as HTMLInputElement
  return el?.checked ?? false
}

function toggleReverseCharge() {
  const active = isReverseCharge()
  ;(document.getElementById('rc_noteWrap') as HTMLElement).style.display = active ? 'block' : 'none'
  ;(document.getElementById('b_vat_req') as HTMLElement).style.display = active ? 'inline' : 'none'
  document.querySelectorAll<HTMLSelectElement>('.l-vat').forEach((sel) => {
    sel.disabled = active
  })
  recalc()
}

function getLines() {
  const rows = document.querySelectorAll('#linesBody tr')
  const out: any[] = []
  const rc = isReverseCharge()
  rows.forEach((tr) => {
    const desc = (tr.querySelector('.l-desc') as HTMLTextAreaElement).value.trim()
    const qty = parseFloat((tr.querySelector('.l-qty') as HTMLInputElement).value) || 0
    const unit = (tr.querySelector('.l-unit') as HTMLSelectElement).value
    const price = parseFloat((tr.querySelector('.l-price') as HTMLInputElement).value) || 0
    const vat = rc ? 0 : parseFloat((tr.querySelector('.l-vat') as HTMLSelectElement).value)
    const category = rc ? 'AE' : vat === 0 ? 'Z' : 'S'
    const net = qty * price
    ;(tr.querySelector('.l-net') as HTMLElement).textContent = fmt(net)
    out.push({ desc, qty, unit, price, vat, category, net })
  })
  return out
}

function recalc() {
  const lines = getLines()
  const net = lines.reduce((a, l) => a + l.net, 0)
  const byGroup: Record<string, any> = {}
  lines.forEach((l) => {
    const key = l.category + '|' + l.vat
    if (!byGroup[key]) byGroup[key] = { rate: l.vat, category: l.category, base: 0 }
    byGroup[key].base += l.net
  })
  ;(document.getElementById('t_net') as HTMLElement).textContent = fmt(net) + ' €'
  const taxRowsEl = document.getElementById('taxRows')!
  taxRowsEl.innerHTML = ''
  let totalTax = 0
  const grandRow = document.querySelector('.totals table tr.grand')!
  Object.values(byGroup)
    .sort((a: any, b: any) => b.rate - a.rate)
    .forEach((g: any) => {
      const tax = g.base * (g.rate / 100)
      totalTax += tax
      const label = g.category === 'AE' ? 'Reverse-Charge (§13b, 0 %)' : `zzgl. USt ${g.rate} %`
      const tr = document.createElement('tr')
      tr.innerHTML = `<td>${label}</td><td>${fmt(tax)} €</td>`
      grandRow.parentElement!.insertBefore(tr, grandRow)
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

function escXml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escAttr(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function requiredFields(): [string, string][] {
  return [
    ['s_name', 'Verkäufer: Firmenname'],
    ['s_street', 'Verkäufer: Straße'],
    ['s_zip', 'Verkäufer: PLZ'],
    ['s_city', 'Verkäufer: Ort'],
    ['s_vat', 'Verkäufer: USt-IdNr.'],
    ['s_email', 'Verkäufer: E-Mail'],
    ['s_iban', 'Verkäufer: IBAN'],
    ['b_name', 'Käufer: Firmenname'],
    ['b_street', 'Käufer: Straße'],
    ['b_zip', 'Käufer: PLZ'],
    ['b_city', 'Käufer: Ort'],
    ['b_email', 'Käufer: E-Mail'],
    ['b_ref', 'Käufer: Leitweg-ID/Referenz'],
    ['inv_id', 'Rechnungsnummer'],
    ['inv_date', 'Rechnungsdatum'],
  ]
}

function validate(): string[] {
  const missing: string[] = []
  requiredFields().forEach(([id, label]) => {
    const v = (document.getElementById(id) as HTMLInputElement).value.trim()
    if (!v) missing.push(label)
  })
  const lines = getLines().filter((l) => l.desc)
  if (lines.length === 0) missing.push('mindestens eine Rechnungsposition mit Beschreibung')
  if (isReverseCharge() && !(document.getElementById('rc_note') as HTMLTextAreaElement).value.trim()) {
    missing.push('Hinweistext zu §13b UStG')
  }
  if (isReverseCharge() && !(document.getElementById('b_vat') as HTMLInputElement).value.trim()) {
    missing.push('USt-IdNr. Käufer (Pflicht bei Reverse-Charge, BR-AE-02)')
  }
  return missing
}

// ── Import / Viewer ──────────────────────────────────────────────────────────

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ublText(root: Element, tag: string): string {
  const els = root.getElementsByTagName(tag)
  return els.length ? (els[0] as Element).textContent!.trim() : ''
}

function directChildTexts(root: Element, tag: string): string[] {
  const out: string[] = []
  for (const child of Array.from(root.children)) {
    if (child.tagName === tag) out.push(child.textContent!.trim())
  }
  return out
}

function detectFormat(doc: Document): 'UBL' | 'CII' | 'UNKNOWN' {
  const rootTag = doc.documentElement?.tagName ?? ''
  if (rootTag === 'Invoice' || rootTag.endsWith(':Invoice')) return 'UBL'
  if (rootTag.includes('CrossIndustryInvoice')) return 'CII'
  return 'UNKNOWN'
}

function parsePartyUBL(partyParentEl: Element): any {
  const partyEls = partyParentEl.getElementsByTagName('cac:Party')
  if (!partyEls.length) return null
  const p = partyEls[0] as Element
  return {
    name: ublText(p, 'cbc:Name') || ublText(p, 'cbc:RegistrationName'),
    street: ublText(p, 'cbc:StreetName'),
    city: ublText(p, 'cbc:CityName'),
    zip: ublText(p, 'cbc:PostalZone'),
    country: ublText(p, 'cbc:IdentificationCode') || 'DE',
    email: ublText(p, 'cbc:ElectronicMail') || ublText(p, 'cbc:EndpointID'),
    vat: ublText(p, 'cbc:CompanyID'),
  }
}

function parseLinesUBL(root: Element): any[] {
  const lineEls = root.getElementsByTagName('cac:InvoiceLine')
  const lines: any[] = []
  for (const le of Array.from(lineEls)) {
    const desc = ublText(le, 'cbc:Name')
    const qtyEls = le.getElementsByTagName('cbc:InvoicedQuantity')
    const qty = qtyEls.length ? parseFloat((qtyEls[0] as Element).textContent!) || 0 : 0
    const unit = qtyEls.length ? (qtyEls[0] as Element).getAttribute('unitCode') || 'C62' : 'C62'
    const catEls = le.getElementsByTagName('cac:ClassifiedTaxCategory')
    let category = 'S'
    let vat = 0
    if (catEls.length) {
      const idEl = (catEls[0] as Element).getElementsByTagName('cbc:ID')
      if (idEl.length) category = (idEl[0] as Element).textContent!.trim()
      const pctEl = (catEls[0] as Element).getElementsByTagName('cbc:Percent')
      if (pctEl.length) vat = parseFloat((pctEl[0] as Element).textContent!) || 0
    }
    const priceEls = le.getElementsByTagName('cbc:PriceAmount')
    const price = priceEls.length ? parseFloat((priceEls[0] as Element).textContent!) || 0 : 0
    lines.push({ desc, qty, unit, vat, category, price })
  }
  return lines
}

function detectReverseChargeUBL(root: Element): { active: boolean; note: string } {
  const cats = root.getElementsByTagName('cac:TaxCategory')
  for (const c of Array.from(cats)) {
    const idEl = (c as Element).getElementsByTagName('cbc:ID')
    if (idEl.length && (idEl[0] as Element).textContent!.trim() === 'AE') {
      const reasonEl = (c as Element).getElementsByTagName('cbc:TaxExemptionReason')
      return { active: true, note: reasonEl.length ? (reasonEl[0] as Element).textContent!.trim() : '' }
    }
  }
  return { active: false, note: '' }
}

function normalizeUBL(doc: Document): any {
  const root = doc.documentElement
  const supplierParent = root.getElementsByTagName('cac:AccountingSupplierParty')[0]
  const customerParent = root.getElementsByTagName('cac:AccountingCustomerParty')[0]
  const seller = supplierParent ? parsePartyUBL(supplierParent as Element) : null
  const buyer = customerParent ? parsePartyUBL(customerParent as Element) : null

  let iban = ''
  let bic = ''
  const pmEls = root.getElementsByTagName('cac:PaymentMeans')
  if (pmEls.length) {
    const acctEls = (pmEls[0] as Element).getElementsByTagName('cac:PayeeFinancialAccount')
    if (acctEls.length) {
      const idEls = (acctEls[0] as Element).getElementsByTagName('cbc:ID')
      if (idEls.length) iban = (idEls[0] as Element).textContent!.trim()
      const branchEls = (acctEls[0] as Element).getElementsByTagName('cac:FinancialInstitutionBranch')
      if (branchEls.length) {
        const bicEls = (branchEls[0] as Element).getElementsByTagName('cbc:ID')
        if (bicEls.length) bic = (bicEls[0] as Element).textContent!.trim()
      }
    }
  }

  const ptEls = root.getElementsByTagName('cac:PaymentTerms')
  const terms = ptEls.length ? ublText(ptEls[0] as Element, 'cbc:Note') : ''

  let totals = { net: '', gross: '' }
  const lmtEls = root.getElementsByTagName('cac:LegalMonetaryTotal')
  if (lmtEls.length) {
    const l = lmtEls[0] as Element
    totals = {
      net: ublText(l, 'cbc:TaxExclusiveAmount'),
      gross: ublText(l, 'cbc:TaxInclusiveAmount'),
    }
  }

  return {
    format: 'UBL',
    invId: ublText(root, 'cbc:ID'),
    issueDate: ublText(root, 'cbc:IssueDate'),
    dueDate: ublText(root, 'cbc:DueDate'),
    buyerRef: ublText(root, 'cbc:BuyerReference'),
    seller,
    buyer,
    iban,
    bic,
    terms,
    totals,
    notes: directChildTexts(root, 'cbc:Note'),
    rc: detectReverseChargeUBL(root),
    lines: parseLinesUBL(root),
  }
}

function formatCiiDate(raw: string): string {
  if (raw && raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return raw
}

function normalizeCII(doc: Document): any {
  const root = doc.documentElement
  let invId = ''
  let issueDateRaw = ''
  const docEls = root.getElementsByTagName('rsm:ExchangedDocument')
  if (docEls.length) {
    const d = docEls[0] as Element
    const idEls = d.getElementsByTagName('ram:ID')
    if (idEls.length) invId = (idEls[0] as Element).textContent!.trim()
    const dtEls = d.getElementsByTagName('udt:DateTimeString')
    if (dtEls.length) issueDateRaw = (dtEls[0] as Element).textContent!.trim()
  }
  let sellerName = ''
  let buyerName = ''
  const agreementEls = root.getElementsByTagName('ram:ApplicableHeaderTradeAgreement')
  if (agreementEls.length) {
    const a = agreementEls[0] as Element
    const sellerEls = a.getElementsByTagName('ram:SellerTradeParty')
    if (sellerEls.length) {
      const n = (sellerEls[0] as Element).getElementsByTagName('ram:Name')
      if (n.length) sellerName = (n[0] as Element).textContent!.trim()
    }
    const buyerEls = a.getElementsByTagName('ram:BuyerTradeParty')
    if (buyerEls.length) {
      const n = (buyerEls[0] as Element).getElementsByTagName('ram:Name')
      if (n.length) buyerName = (n[0] as Element).textContent!.trim()
    }
  }
  let net = ''
  let tax = ''
  let gross = ''
  const sumEls = root.getElementsByTagName('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
  if (sumEls.length) {
    const s = sumEls[0] as Element
    const g = (tag: string) => {
      const e = s.getElementsByTagName(tag)
      return e.length ? (e[0] as Element).textContent!.trim() : ''
    }
    net = g('ram:TaxBasisTotalAmount')
    tax = g('ram:TaxTotalAmount')
    gross = g('ram:GrandTotalAmount')
  }
  return { format: 'CII', invId, issueDate: formatCiiDate(issueDateRaw), sellerName, buyerName, net, tax, gross }
}

function renderUblViewer(data: any): string {
  const linesHtml = (data.lines || [])
    .map(
      (l: any) =>
        `<tr><td>${escapeHtml(l.desc)}</td><td>${l.qty} ${escapeHtml(l.unit)}</td><td>${typeof l.vat === 'number' ? l.vat.toFixed(2) : l.vat}%</td><td>${(l.price || 0).toFixed(2)} €</td></tr>`
    )
    .join('')
  return `<div class="viewer-block">
    <h3>Rechnung ${escapeHtml(data.invId)}</h3>
    <p>Datum: ${escapeHtml(data.issueDate)}${data.dueDate ? ' · Fällig: ' + escapeHtml(data.dueDate) : ''}</p>
    <div class="viewer-parties">
      <div><strong>Von:</strong><br>${escapeHtml(data.seller?.name || '–')}<br>${escapeHtml(data.seller?.street || '')}<br>${escapeHtml(data.seller?.zip || '')} ${escapeHtml(data.seller?.city || '')}<br>USt-IdNr.: ${escapeHtml(data.seller?.vat || '–')}</div>
      <div><strong>An:</strong><br>${escapeHtml(data.buyer?.name || '–')}<br>${escapeHtml(data.buyer?.street || '')}<br>${escapeHtml(data.buyer?.zip || '')} ${escapeHtml(data.buyer?.city || '')}</div>
    </div>
    <table class="viewer-table"><thead><tr><th>Beschreibung</th><th>Menge</th><th>USt</th><th>Preis</th></tr></thead><tbody>${linesHtml}</tbody></table>
    <table class="viewer-totals">
      <tr><td>Netto</td><td>${escapeHtml(data.totals?.net) || '–'} €</td></tr>
      <tr><td>Brutto</td><td>${escapeHtml(data.totals?.gross) || '–'} €</td></tr>
    </table>
    ${data.rc?.active ? `<div class="viewer-note">Reverse-Charge (§13b): ${escapeHtml(data.rc.note || '')}</div>` : ''}
    ${data.terms ? `<div class="viewer-note">Zahlungsbedingungen: ${escapeHtml(data.terms)}</div>` : ''}
  </div>`
}

function renderCiiViewer(data: any): string {
  return `<div class="viewer-block">
    <h3>Rechnung ${escapeHtml(data.invId)} <span class="viewer-badge">CII-Format</span></h3>
    <p>Datum: ${escapeHtml(data.issueDate)}</p>
    <div class="viewer-parties">
      <div><strong>Von:</strong><br>${escapeHtml(data.sellerName || '–')}</div>
      <div><strong>An:</strong><br>${escapeHtml(data.buyerName || '–')}</div>
    </div>
    <table class="viewer-totals">
      <tr><td>Netto</td><td>${escapeHtml(data.net) || '–'} €</td></tr>
      <tr><td>USt</td><td>${escapeHtml(data.tax) || '–'} €</td></tr>
      <tr><td>Brutto</td><td>${escapeHtml(data.gross) || '–'} €</td></tr>
    </table>
    <div class="viewer-note">Hinweis: CII-Dokumente (häufig bei ZUGFeRD/Factur-X) werden hier nur mit den wichtigsten Eckdaten angezeigt, ohne Positionsliste.</div>
  </div>`
}

function fillFormFromUBL(data: any) {
  const setVal = (id: string, val: unknown) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    if (el && val) el.value = String(val)
  }
  if (data.seller) {
    setVal('s_name', data.seller.name)
    setVal('s_street', data.seller.street)
    setVal('s_zip', data.seller.zip)
    setVal('s_city', data.seller.city)
    setVal('s_country', data.seller.country)
    setVal('s_vat', data.seller.vat)
    setVal('s_email', data.seller.email)
  }
  setVal('s_iban', data.iban)
  setVal('s_bic', data.bic)
  if (data.buyer) {
    setVal('b_name', data.buyer.name)
    setVal('b_street', data.buyer.street)
    setVal('b_zip', data.buyer.zip)
    setVal('b_city', data.buyer.city)
    setVal('b_country', data.buyer.country)
    setVal('b_email', data.buyer.email)
    setVal('b_vat', data.buyer.vat)
  }
  setVal('inv_id', data.invId)
  setVal('inv_date', data.issueDate)
  setVal('inv_due', data.dueDate)
  setVal('b_ref', data.buyerRef)
  if (data.terms) setVal('inv_terms', data.terms)

  const periodNote = (data.notes || []).find((n: string) => n.startsWith('Leistungszeitraum:'))
  if (periodNote) setVal('inv_period', periodNote.replace('Leistungszeitraum:', '').trim())

  const rcCheckbox = document.getElementById('rc_active') as HTMLInputElement
  rcCheckbox.checked = !!(data.rc && data.rc.active)
  if (data.rc && data.rc.active && data.rc.note) setVal('rc_note', data.rc.note)
  toggleReverseCharge()

  ;(document.getElementById('linesBody') as HTMLElement).innerHTML = ''
  lineCount = 0
  if (data.lines && data.lines.length) {
    data.lines.forEach((l: any) =>
      addLine({ desc: l.desc, qty: l.qty, unit: l.unit, price: l.price, vat: data.rc?.active ? 0 : l.vat })
    )
  } else {
    addLine()
  }
  recalc()
}

function setStatus(msg: string, cls?: string) {
  const el = document.getElementById('status') as HTMLElement
  el.textContent = msg
  el.className = cls || ''
}

function setImportStatus(msg: string, cls?: string) {
  const el = document.getElementById('importStatus') as HTMLElement
  el.textContent = msg
  el.className = cls || ''
}

function setViewerStatus(msg: string, cls?: string) {
  const el = document.getElementById('viewerStatus') as HTMLElement
  el.textContent = msg
  el.className = cls || ''
}

async function handleImportFile(file: File) {
  setImportStatus('Lese Datei …', '')
  try {
    const text = await file.text()
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parseerror').length || doc.getElementsByTagName('parsererror').length) {
      setImportStatus('Datei ist kein gültiges XML.', 'error')
      return
    }
    const fmt = detectFormat(doc)
    if (fmt !== 'UBL') {
      setImportStatus(
        `Nur UBL-XRechnungen können in das Formular übernommen werden (erkanntes Format: ${fmt}). Nutze stattdessen den Viewer unten, um die Rechnung trotzdem anzusehen.`,
        'error'
      )
      return
    }
    const data = normalizeUBL(doc)
    fillFormFromUBL(data)
    setImportStatus(`Rechnung ${data.invId || ''} wurde in das Formular oben übernommen.`, 'ok')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e: unknown) {
    setImportStatus('Fehler beim Einlesen: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

async function extractXmlFromPdf(file: File): Promise<string | null> {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error(
      'PDF-Bibliothek konnte nicht geladen werden (Internetverbindung nötig, um sie beim ersten Mal zu laden).'
    )
  }
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const attachments = await pdf.getAttachments()
  if (!attachments) return null
  const candidates = Object.values(attachments).filter((a: any) => /\.xml$/i.test(a.filename))
  if (!candidates.length) return null
  ;(candidates as any[]).sort((a: any, b: any) => {
    const score = (n: string) => (/factur-x|zugferd|xrechnung|cross.?industry/i.test(n) ? 0 : 1)
    return score(a.filename) - score(b.filename)
  })
  return new TextDecoder('utf-8').decode((candidates[0] as any).content)
}

async function handleViewerFile(file: File) {
  const out = document.getElementById('viewerOutput') as HTMLElement
  out.innerHTML = ''
  setViewerStatus('Lese Datei …', '')
  try {
    let xmlText: string | null
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      xmlText = await extractXmlFromPdf(file)
      if (!xmlText) {
        setViewerStatus('In dieser PDF wurde keine eingebettete Rechnungs-XML (ZUGFeRD/Factur-X) gefunden.', 'error')
        return
      }
    } else {
      xmlText = await file.text()
    }
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
    if (doc.getElementsByTagName('parseerror').length || doc.getElementsByTagName('parsererror').length) {
      setViewerStatus('Eingebettete/gelesene Datei ist kein gültiges XML.', 'error')
      return
    }
    const format = detectFormat(doc)
    if (format === 'UBL') {
      out.innerHTML = renderUblViewer(normalizeUBL(doc))
      setViewerStatus('UBL-Rechnung eingelesen.', 'ok')
    } else if (format === 'CII') {
      out.innerHTML = renderCiiViewer(normalizeCII(doc))
      setViewerStatus('CII-Rechnung eingelesen (eingeschränkte Ansicht).', 'ok')
    } else {
      setViewerStatus('Unbekanntes XML-Format – konnte nicht als Rechnung interpretiert werden.', 'error')
    }
  } catch (e: unknown) {
    setViewerStatus('Fehler beim Lesen: ' + (e instanceof Error ? e.message : String(e)), 'error')
  }
}

function buildXml(): string {
  const g = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim()
  const { lines, net, byGroup, totalTax, gross } = recalc()
  const invDate = g('inv_date')
  const dueDate = g('inv_due') || invDate
  const rc = isReverseCharge()

  const partyBlock = (tag: string, prefix: string, taxScheme: string) => `
    <cac:${tag}>
      <cac:Party>
        <cbc:EndpointID schemeID="EM">${escXml(g(prefix + '_email'))}</cbc:EndpointID>
        <cac:PartyName><cbc:Name>${escXml(g(prefix + '_name'))}</cbc:Name></cac:PartyName>
        <cac:PostalAddress>
          <cbc:StreetName>${escXml(g(prefix + '_street'))}</cbc:StreetName>
          <cbc:CityName>${escXml(g(prefix + '_city'))}</cbc:CityName>
          <cbc:PostalZone>${escXml(g(prefix + '_zip'))}</cbc:PostalZone>
          <cac:Country><cbc:IdentificationCode>${escXml(g(prefix + '_country') || 'DE')}</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>
        ${taxScheme}
        <cac:PartyLegalEntity><cbc:RegistrationName>${escXml(g(prefix + '_name'))}</cbc:RegistrationName></cac:PartyLegalEntity>
        <cac:Contact><cbc:ElectronicMail>${escXml(g(prefix + '_email'))}</cbc:ElectronicMail></cac:Contact>
      </cac:Party>
    </cac:${tag}>`

  const supplierTax = `<cac:PartyTaxScheme><cbc:CompanyID>${escXml(g('s_vat'))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
  const buyerTax = g('b_vat')
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${escXml(g('b_vat'))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : ''

  const exemptionText = rc
    ? g('rc_note') || 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.'
    : ''

  const taxSubtotals = Object.values(byGroup)
    .sort((a: any, b: any) => b.rate - a.rate)
    .map((gr: any) => {
      const tax = gr.base * (gr.rate / 100)
      const exemption =
        gr.category === 'AE'
          ? `<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>${escXml(exemptionText)}</cbc:TaxExemptionReason>`
          : ''
      return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="EUR">${gr.base.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="EUR">${tax.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${gr.category}</cbc:ID>
          <cbc:Percent>${gr.rate.toFixed(2)}</cbc:Percent>
          ${exemption}
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`
    })
    .join('')

  const invoiceLines = lines
    .map(
      (l: any, i: number) => `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${l.unit}">${l.qty}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="EUR">${l.net.toFixed(2)}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Name>${escXml(l.desc)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>${l.category}</cbc:ID>
          <cbc:Percent>${l.vat.toFixed(2)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="EUR">${l.price.toFixed(2)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`
    )
    .join('')

  const paymentMeans = `
    <cac:PaymentMeans>
      <cbc:PaymentMeansCode name="Überweisung">58</cbc:PaymentMeansCode>
      <cbc:PaymentID>${escXml(g('inv_id'))}</cbc:PaymentID>
      <cac:PayeeFinancialAccount>
        <cbc:ID>${escXml(g('s_iban').replace(/\s+/g, ''))}</cbc:ID>
        <cbc:Name>${escXml(g('s_name'))}</cbc:Name>
        ${g('s_bic') ? `<cac:FinancialInstitutionBranch><cbc:ID>${escXml(g('s_bic'))}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
      </cac:PayeeFinancialAccount>
    </cac:PaymentMeans>`

  let paymentTermsText = g('inv_terms') || `Zahlbar bis ${dueDate} ohne Abzug.`
  const skPercent = parseFloat((document.getElementById('sk_percent') as HTMLInputElement).value) || 0
  const skDays = parseInt((document.getElementById('sk_days') as HTMLInputElement).value) || 0
  if (skPercent > 0 && skDays > 0) {
    const skAmount = gross * (skPercent / 100)
    const skDate = new Date(invDate)
    skDate.setDate(skDate.getDate() + skDays)
    const skDateStr = skDate.toLocaleDateString('de-DE')
    paymentTermsText += ` Bei Zahlung innerhalb von ${skDays} Tagen (bis ${skDateStr}) gewähren wir ${skPercent.toFixed(2)} % Skonto (${skAmount.toFixed(2)} €); Zahlbetrag dann ${(gross - skAmount).toFixed(2)} €.`
  }

  const notes: string[] = []
  if (g('inv_period')) notes.push(`Leistungszeitraum: ${escXml(g('inv_period'))}`)
  if (rc) notes.push(escXml(exemptionText))
  const note = notes.map((n) => `<cbc:Note>${n}</cbc:Note>`).join('\n  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escXml(g('inv_id'))}</cbc:ID>
  <cbc:IssueDate>${invDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${note}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escXml(g('b_ref'))}</cbc:BuyerReference>
  ${partyBlock('AccountingSupplierParty', 's', supplierTax)}
  ${partyBlock('AccountingCustomerParty', 'b', buyerTax)}
  ${paymentMeans}
  <cac:PaymentTerms><cbc:Note>${escXml(paymentTermsText)}</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${totalTax.toFixed(2)}</cbc:TaxAmount>
    ${taxSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${gross.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${invoiceLines}
</Invoice>`
}

async function showPreview() {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const xml = buildXml()
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  const pw = document.getElementById('previewWrap') as HTMLDetailsElement
  pw.style.display = 'block'
  pw.open = true
  setStatus('Vorschau aktualisiert.', 'ok')
}

async function copyXml() {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const xml = buildXml()
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  const pw = document.getElementById('previewWrap') as HTMLDetailsElement
  pw.style.display = 'block'
  try {
    await navigator.clipboard.writeText(xml)
    setStatus(
      'XML in Zwischenablage kopiert. In einem Texteditor einfügen und als „rechnung.xml" speichern (Dateityp „Alle Dateien" wählen).',
      'ok'
    )
  } catch {
    setStatus(
      'Kopieren nicht möglich. Bitte den Text in der Vorschau unten manuell markieren und kopieren.',
      'error'
    )
  }
}

async function generate() {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const xml = buildXml()
  const invId =
    (document.getElementById('inv_id') as HTMLInputElement).value.trim().replace(/[^\w.-]+/g, '_') || 'rechnung'
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  const pw = document.getElementById('previewWrap') as HTMLDetailsElement
  pw.style.display = 'block'
  setStatus('Erzeuge Datei …', '')

  let zipBlob: Blob
  try {
    const zip = new JSZip()
    zip.file(`xrechnung_${invId}.xml`, xml)
    zipBlob = await zip.generateAsync({ type: 'blob' })
  } catch (e: unknown) {
    setStatus('Fehler beim Packen der Datei: ' + (e instanceof Error ? e.message : String(e)), 'error')
    return
  }

  try {
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xrechnung_${invId}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setStatus(
      'ZIP-Datei wurde heruntergeladen. Bitte entpacken. Vor dem Versand zusätzlich mit dem KoSIT-Validator prüfen.',
      'ok'
    )
  } catch {
    setStatus(
      'Download nicht möglich. Nutze ersatzweise die XML-Vorschau unten: Text markieren, kopieren und lokal als .xml-Datei speichern.',
      'error'
    )
  }
}

// ── Initialisierung ───────────────────────────────────────────────────────────

document.getElementById('rc_active')!.addEventListener('change', toggleReverseCharge)
document.getElementById('sk_percent')!.addEventListener('change', recalc)
document.getElementById('sk_days')!.addEventListener('change', recalc)
document.getElementById('btnAddLine')!.addEventListener('click', () => addLine())
document.getElementById('btnGenerate')!.addEventListener('click', generate)
document.getElementById('btnPreview')!.addEventListener('click', showPreview)
document.getElementById('btnCopy')!.addEventListener('click', copyXml)
document.getElementById('importFile')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleImportFile(f)
})
document.getElementById('viewerFile')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleViewerFile(f)
})

// pdf.js CDN nachladen (für ZUGFeRD-Viewer)
const pdfScript = document.createElement('script')
pdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'
pdfScript.onload = () => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc
  }
}
document.head.appendChild(pdfScript)

addLine({ desc: '', qty: 1, unit: 'HUR', price: 0, vat: 19 })
;(document.getElementById('inv_date') as HTMLInputElement).valueAsDate = new Date()
