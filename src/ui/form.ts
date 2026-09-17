/**
 * DOM-Logik für das Rechnungsformular.
 * Liest und schreibt Formularfelder; delegiert Berechnung an lines.ts und lib/.
 */

import type { InvoiceData, NormalizedInvoice, Party } from '../types/invoice'
import { addLine, recalc, isReverseCharge, getLines, resetLines } from './lines'

// ── Status-Helfer ─────────────────────────────────────────────────────────────

export function setStatus(msg: string, cls?: string): void {
  const el = document.getElementById('status') as HTMLElement
  el.textContent = msg
  el.className = cls ?? ''
}

export function setImportStatus(msg: string, cls?: string): void {
  const el = document.getElementById('importStatus') as HTMLElement
  el.textContent = msg
  el.className = cls ?? ''
}

export function setViewerStatus(msg: string, cls?: string): void {
  const el = document.getElementById('viewerStatus') as HTMLElement
  el.textContent = msg
  el.className = cls ?? ''
}

// ── Formular-Logik ────────────────────────────────────────────────────────────

export function toggleReverseCharge(): void {
  const active = isReverseCharge()
  ;(document.getElementById('rc_noteWrap') as HTMLElement).style.display = active ? 'block' : 'none'
  ;(document.getElementById('b_vat_req') as HTMLElement).style.display = active ? 'inline' : 'none'
  document.querySelectorAll<HTMLSelectElement>('.l-vat').forEach((sel) => {
    sel.disabled = active
  })
  recalc()
}

export function validate(): string[] {
  const missing: string[] = []
  const requiredFields: [string, string][] = [
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
  requiredFields.forEach(([id, label]) => {
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

/** Liest alle Formularfelder und gibt ein typisiertes InvoiceData-Objekt zurück. */
export function getFormData(): InvoiceData {
  const g = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim()
  const totals = recalc()

  const seller: Party = {
    name: g('s_name'),
    street: g('s_street'),
    zip: g('s_zip'),
    city: g('s_city'),
    country: g('s_country') || 'DE',
    email: g('s_email'),
    vat: g('s_vat') || undefined,
  }

  const buyer: Party = {
    name: g('b_name'),
    street: g('b_street'),
    zip: g('b_zip'),
    city: g('b_city'),
    country: g('b_country') || 'DE',
    email: g('b_email'),
    vat: g('b_vat') || undefined,
  }

  return {
    seller,
    sellerIban: g('s_iban'),
    sellerBic: g('s_bic'),
    buyer,
    buyerRef: g('b_ref'),
    invId: g('inv_id'),
    issueDate: g('inv_date'),
    dueDate: g('inv_due'),
    period: g('inv_period'),
    terms: g('inv_terms'),
    rc: {
      active: isReverseCharge(),
      note: g('rc_note'),
    },
    skonto: {
      percent: parseFloat((document.getElementById('sk_percent') as HTMLInputElement).value) || 0,
      days: parseInt((document.getElementById('sk_days') as HTMLInputElement).value) || 0,
    },
    lines: totals.lines,
    totals,
  }
}

/** Befüllt das Formular aus einer eingelesenen UBL-Rechnung. */
export function fillFormFromUBL(data: NormalizedInvoice): void {
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

  const periodNote = data.notes.find((n) => n.startsWith('Leistungszeitraum:'))
  if (periodNote) setVal('inv_period', periodNote.replace('Leistungszeitraum:', '').trim())

  const rcCheckbox = document.getElementById('rc_active') as HTMLInputElement
  rcCheckbox.checked = data.rc.active
  if (data.rc.active && data.rc.note) setVal('rc_note', data.rc.note)
  toggleReverseCharge()

  resetLines()
  if (data.lines.length > 0) {
    data.lines.forEach((l) =>
      addLine({ desc: l.desc, qty: l.qty, unit: l.unit, price: l.price, vat: data.rc.active ? 0 : l.vat })
    )
  } else {
    addLine()
  }
  recalc()
}
