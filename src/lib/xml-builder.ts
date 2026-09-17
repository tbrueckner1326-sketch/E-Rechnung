/**
 * XRechnung-XML-Generierung (UBL 2.1 / EN 16931 / XRechnung 3.0.2).
 *
 * buildXml() ist eine reine Funktion — kein DOM-Zugriff.
 * Eingabe: InvoiceData-Objekt (zusammengestellt von der UI-Schicht).
 * Ausgabe: vollständige UBL-Invoice-XML als String.
 */

import type { InvoiceData, InvoiceLine, TaxGroup } from '../types/invoice'
import { escXml } from './xml-utils'

// ── Interne Hilfsfunktionen ───────────────────────────────────────────────────

function partyBlock(tag: string, p: { name: string; street: string; zip: string; city: string; country: string; email: string; vat?: string }, taxScheme: string): string {
  return `
    <cac:${tag}>
      <cac:Party>
        <cbc:EndpointID schemeID="EM">${escXml(p.email)}</cbc:EndpointID>
        <cac:PartyName><cbc:Name>${escXml(p.name)}</cbc:Name></cac:PartyName>
        <cac:PostalAddress>
          <cbc:StreetName>${escXml(p.street)}</cbc:StreetName>
          <cbc:CityName>${escXml(p.city)}</cbc:CityName>
          <cbc:PostalZone>${escXml(p.zip)}</cbc:PostalZone>
          <cac:Country><cbc:IdentificationCode>${escXml(p.country || 'DE')}</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>
        ${taxScheme}
        <cac:PartyLegalEntity><cbc:RegistrationName>${escXml(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
        <cac:Contact><cbc:ElectronicMail>${escXml(p.email)}</cbc:ElectronicMail></cac:Contact>
      </cac:Party>
    </cac:${tag}>`
}

function taxSchemeBlock(companyId: string): string {
  if (!companyId) return ''
  return `<cac:PartyTaxScheme><cbc:CompanyID>${escXml(companyId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
}

function taxSubtotalsXml(byGroup: Record<string, TaxGroup>, exemptionText: string): string {
  return Object.values(byGroup)
    .sort((a, b) => b.rate - a.rate)
    .map((gr) => {
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
}

function invoiceLinesXml(lines: InvoiceLine[]): string {
  return lines
    .map(
      (l, i) => `
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
}

function paymentTermsNote(data: InvoiceData): string {
  const { invId, issueDate, dueDate, terms, skonto, totals } = data
  let text = terms || `Zahlbar bis ${dueDate || issueDate} ohne Abzug.`
  if (skonto.percent > 0 && skonto.days > 0) {
    const skAmount = totals.gross * (skonto.percent / 100)
    const skDate = new Date(issueDate)
    skDate.setDate(skDate.getDate() + skonto.days)
    const skDateStr = skDate.toLocaleDateString('de-DE')
    text += ` Bei Zahlung innerhalb von ${skonto.days} Tagen (bis ${skDateStr}) gewähren wir ${skonto.percent.toFixed(2)} % Skonto (${skAmount.toFixed(2)} €); Zahlbetrag dann ${(totals.gross - skAmount).toFixed(2)} €.`
  }
  // invId wird referenziert für PaymentID unten — kein Linting-Warning
  void invId
  return text
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

/**
 * Erzeugt eine gültige XRechnung-XML (UBL 2.1, EN 16931, XRechnung 3.0.2).
 *
 * Wichtige Compliance-Details:
 * - §13b (Reverse-Charge, Kategorie "AE"): TaxExemptionReason NUR in TaxSubtotal,
 *   NICHT auf Zeilenebene → verhindert BR-AE-02 / UBL-CR-600/601
 * - Käufer-USt-IdNr. ist bei AE-Kategorie Pflicht (BR-AE-02)
 */
export function buildXml(data: InvoiceData): string {
  const { seller, buyer, sellerIban, sellerBic, buyerRef, invId, issueDate, dueDate, period, rc, totals } = data
  const effectiveDueDate = dueDate || issueDate
  const exemptionText = rc.active
    ? rc.note || 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.'
    : ''

  const supplierTax = taxSchemeBlock(seller.vat ?? '')
  const buyerTax = taxSchemeBlock(buyer.vat ?? '')

  const notes: string[] = []
  if (period) notes.push(`Leistungszeitraum: ${escXml(period)}`)
  if (rc.active) notes.push(escXml(exemptionText))
  const noteXml = notes.map((n) => `<cbc:Note>${n}</cbc:Note>`).join('\n  ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escXml(invId)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${effectiveDueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${noteXml}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escXml(buyerRef)}</cbc:BuyerReference>
  ${partyBlock('AccountingSupplierParty', seller, supplierTax)}
  ${partyBlock('AccountingCustomerParty', buyer, buyerTax)}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="Überweisung">58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${escXml(invId)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escXml(sellerIban.replace(/\s+/g, ''))}</cbc:ID>
      <cbc:Name>${escXml(seller.name)}</cbc:Name>
      ${sellerBic ? `<cac:FinancialInstitutionBranch><cbc:ID>${escXml(sellerBic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>${escXml(paymentTermsNote(data))}</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${totals.totalTax.toFixed(2)}</cbc:TaxAmount>
    ${taxSubtotalsXml(totals.byGroup, exemptionText)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${totals.net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${totals.net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${totals.gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${totals.gross.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${invoiceLinesXml(totals.lines)}
</Invoice>`
}
