/**
 * UBL-Parser: liest eine UBL-Invoice-XML (EN 16931 / XRechnung) ein
 * und gibt ein typisiertes NormalizedInvoice-Objekt zurück.
 *
 * Kein DOM-Zugriff außerhalb des übergebenen Document-Objekts.
 */

import type { NormalizedInvoice, InvoiceLine, Party, ReverseCharge, UnitCode } from '../types/invoice'
import { ublText, directChildTexts, detectFormat } from './xml-utils'

export { detectFormat }

// ── Interne Helfer ────────────────────────────────────────────────────────────

function parsePartyUBL(partyParentEl: Element): Party | null {
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
    vat: ublText(p, 'cbc:CompanyID') || undefined,
  }
}

function parseLinesUBL(root: Element): InvoiceLine[] {
  const lineEls = root.getElementsByTagName('cac:InvoiceLine')
  const lines: InvoiceLine[] = []

  for (const le of Array.from(lineEls)) {
    const desc = ublText(le, 'cbc:Name')
    const qtyEls = le.getElementsByTagName('cbc:InvoicedQuantity')
    const qty = qtyEls.length > 0 ? parseFloat(qtyEls[0]?.textContent ?? '0') || 0 : 0
    const rawUnit = qtyEls.length > 0 ? (qtyEls[0]?.getAttribute('unitCode') ?? 'C62') : 'C62'
    // Unbekannte Unit-Codes fallen auf C62 zurück
    const unit: UnitCode = ['H87', 'HUR', 'DAY', 'MTK', 'MTR', 'C62'].includes(rawUnit)
      ? (rawUnit as UnitCode)
      : 'C62'

    const catEls = le.getElementsByTagName('cac:ClassifiedTaxCategory')
    let category: 'S' | 'Z' | 'AE' = 'S'
    let vat = 0
    if (catEls.length > 0) {
      const idEl = (catEls[0] as Element).getElementsByTagName('cbc:ID')
      const rawCat = idEl.length > 0 ? (idEl[0]?.textContent?.trim() ?? 'S') : 'S'
      if (rawCat === 'AE' || rawCat === 'Z' || rawCat === 'S') category = rawCat
      const pctEl = (catEls[0] as Element).getElementsByTagName('cbc:Percent')
      if (pctEl.length > 0) vat = parseFloat(pctEl[0]?.textContent ?? '0') || 0
    }

    const priceEls = le.getElementsByTagName('cbc:PriceAmount')
    const price = priceEls.length > 0 ? parseFloat(priceEls[0]?.textContent ?? '0') || 0 : 0
    const net = qty * price

    lines.push({ desc, qty, unit, vat, category, price, net })
  }
  return lines
}

function detectReverseChargeUBL(root: Element): ReverseCharge {
  const cats = root.getElementsByTagName('cac:TaxCategory')
  for (const c of Array.from(cats)) {
    const idEl = (c as Element).getElementsByTagName('cbc:ID')
    if (idEl.length > 0 && idEl[0]?.textContent?.trim() === 'AE') {
      const reasonEl = (c as Element).getElementsByTagName('cbc:TaxExemptionReason')
      return {
        active: true,
        note: reasonEl.length > 0 ? (reasonEl[0]?.textContent?.trim() ?? '') : '',
      }
    }
  }
  return { active: false, note: '' }
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

/**
 * Parst ein UBL-Invoice-Dokument und gibt ein NormalizedInvoice zurück.
 * Unterstützt UBL mit und ohne Namespace-Präfixe (z. B. "ubl:Invoice").
 */
export function normalizeUBL(doc: Document): NormalizedInvoice {
  const root = doc.documentElement

  const supplierParent = root.getElementsByTagName('cac:AccountingSupplierParty')[0]
  const customerParent = root.getElementsByTagName('cac:AccountingCustomerParty')[0]
  const seller = supplierParent ? parsePartyUBL(supplierParent as Element) : null
  const buyer = customerParent ? parsePartyUBL(customerParent as Element) : null

  let iban = ''
  let bic = ''
  const pmEls = root.getElementsByTagName('cac:PaymentMeans')
  if (pmEls.length > 0) {
    const acctEls = (pmEls[0] as Element).getElementsByTagName('cac:PayeeFinancialAccount')
    if (acctEls.length > 0) {
      const idEls = (acctEls[0] as Element).getElementsByTagName('cbc:ID')
      if (idEls.length > 0) iban = idEls[0]?.textContent?.trim() ?? ''
      const branchEls = (acctEls[0] as Element).getElementsByTagName('cac:FinancialInstitutionBranch')
      if (branchEls.length > 0) {
        const bicEls = (branchEls[0] as Element).getElementsByTagName('cbc:ID')
        if (bicEls.length > 0) bic = bicEls[0]?.textContent?.trim() ?? ''
      }
    }
  }

  const ptEls = root.getElementsByTagName('cac:PaymentTerms')
  const terms = ptEls.length > 0 ? ublText(ptEls[0] as Element, 'cbc:Note') : ''

  let totals = { net: '', gross: '' }
  const lmtEls = root.getElementsByTagName('cac:LegalMonetaryTotal')
  if (lmtEls.length > 0) {
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
