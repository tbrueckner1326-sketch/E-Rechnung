import { describe, test, expect } from 'vitest'
import { buildXml } from '../src/lib/xml-builder'
import type { InvoiceData } from '../src/types/invoice'

// ── Testdaten ─────────────────────────────────────────────────────────────────

const baseSeller = {
  name: 'Testlieferant GmbH',
  street: 'Teststraße 1',
  zip: '10115',
  city: 'Berlin',
  country: 'DE',
  email: 'lieferant@test.de',
  vat: 'DE123456789',
}

const baseBuyer = {
  name: 'Testkunde AG',
  street: 'Kundenweg 5',
  zip: '80331',
  city: 'München',
  country: 'DE',
  email: 'kunde@test.de',
}

function makeData(overrides: Partial<InvoiceData> = {}): InvoiceData {
  const line = {
    desc: 'Beratungsleistung',
    qty: 10,
    unit: 'HUR' as const,
    price: 10,
    vat: 19,
    category: 'S' as const,
    net: 100,
  }
  return {
    seller: baseSeller,
    sellerIban: 'DE12345678901234567890',
    sellerBic: '',
    buyer: baseBuyer,
    buyerRef: 'LEITWEG-123',
    invId: 'TEST-2026-001',
    issueDate: '2026-09-17',
    dueDate: '2026-10-01',
    period: '',
    terms: '',
    rc: { active: false, note: '' },
    skonto: { percent: 0, days: 0 },
    lines: [line],
    totals: {
      net: 100,
      byGroup: { 'S|19': { rate: 19, category: 'S', base: 100 } },
      totalTax: 19,
      gross: 119,
      lines: [line],
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildXml', () => {
  test('buildXml_standard19_enthaeltKorrekteBetraege', () => {
    // Arrange
    const data = makeData()

    // Act
    const xml = buildXml(data)

    // Assert
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>')
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>')
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>')
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>')
    expect(xml).toContain('<cbc:ID>S</cbc:ID>')
    expect(xml).toContain('<cbc:Percent>19.00</cbc:Percent>')
  })

  test('buildXml_reverseCharge_enthaeltAEKategorieUndBefreiungstext', () => {
    // Arrange
    const rcLine = {
      desc: 'Bauarbeiten Abschnitt 1',
      qty: 1,
      unit: 'C62' as const,
      price: 5000,
      vat: 0,
      category: 'AE' as const,
      net: 5000,
    }
    const data = makeData({
      rc: {
        active: true,
        note: 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.',
      },
      lines: [rcLine],
      totals: {
        net: 5000,
        byGroup: { 'AE|0': { rate: 0, category: 'AE', base: 5000 } },
        totalTax: 0,
        gross: 5000,
        lines: [rcLine],
      },
    })

    // Act
    const xml = buildXml(data)

    // Assert
    expect(xml).toContain('<cbc:ID>AE</cbc:ID>')
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>')
    expect(xml).toContain('§ 13b')
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">5000.00</cbc:PayableAmount>')
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>')
  })

  test('buildXml_reverseCharge_keinTaxExemptionReasonInInvoiceLine', () => {
    // BR-AE-02-Compliance: TaxExemptionReason darf NUR in TaxSubtotal stehen, nicht in InvoiceLine
    // Arrange
    const rcLine = {
      desc: 'Bauarbeiten',
      qty: 1,
      unit: 'C62' as const,
      price: 1000,
      vat: 0,
      category: 'AE' as const,
      net: 1000,
    }
    const data = makeData({
      rc: { active: true, note: 'Steuerschuldnerschaft gemäß § 13b UStG.' },
      lines: [rcLine],
      totals: {
        net: 1000,
        byGroup: { 'AE|0': { rate: 0, category: 'AE', base: 1000 } },
        totalTax: 0,
        gross: 1000,
        lines: [rcLine],
      },
    })

    // Act
    const xml = buildXml(data)

    // Assert: TaxExemptionReason erscheint genau einmal (im TaxSubtotal)
    const matches = xml.match(/<cbc:TaxExemptionReason>/g)
    expect(matches).toHaveLength(1)

    // InvoiceLine-Block enthält kein TaxExemptionReason
    const invoiceLineStart = xml.indexOf('<cac:InvoiceLine>')
    const invoiceLineEnd = xml.indexOf('</cac:InvoiceLine>')
    const invoiceLineBlock = xml.slice(invoiceLineStart, invoiceLineEnd)
    expect(invoiceLineBlock).not.toContain('TaxExemptionReason')
  })

  test('buildXml_skonto_enthaeltSkontoTextInZahlungsbedingungen', () => {
    // Arrange
    const data = makeData({
      skonto: { percent: 2, days: 14 },
    })

    // Act
    const xml = buildXml(data)

    // Assert
    expect(xml).toContain('Skonto')
    expect(xml).toContain('2.00 %')
    expect(xml).toContain('14 Tagen')
  })

  test('buildXml_xmlSonderzeichen_werdenKorrektEscaped', () => {
    // Arrange
    const lineWithSpecialChars = {
      desc: 'Leistung <A&B> "Test"',
      qty: 1,
      unit: 'C62' as const,
      price: 100,
      vat: 19,
      category: 'S' as const,
      net: 100,
    }
    const data = makeData({
      lines: [lineWithSpecialChars],
      totals: {
        net: 100,
        byGroup: { 'S|19': { rate: 19, category: 'S', base: 100 } },
        totalTax: 19,
        gross: 119,
        lines: [lineWithSpecialChars],
      },
    })

    // Act
    const xml = buildXml(data)

    // Assert: Rohzeichen dürfen nicht im XML-Text vorkommen
    const nameStart = xml.indexOf('<cbc:Name>Leistung')
    const nameEnd = xml.indexOf('</cbc:Name>', nameStart)
    const nameBlock = xml.slice(nameStart, nameEnd)
    expect(nameBlock).toContain('&lt;')
    expect(nameBlock).toContain('&amp;')
    expect(nameBlock).toContain('&gt;')
    // Rohe Sonderzeichen dürfen nicht unescaped im XML-Text vorkommen
    expect(nameBlock).not.toContain('<A&B>')
  })

  test('buildXml_multiMwSt_zweiTaxSubtotalBloecke', () => {
    // Arrange
    const line19 = {
      desc: 'Pos 1',
      qty: 1,
      unit: 'C62' as const,
      price: 100,
      vat: 19,
      category: 'S' as const,
      net: 100,
    }
    const line7 = {
      desc: 'Pos 2',
      qty: 1,
      unit: 'C62' as const,
      price: 50,
      vat: 7,
      category: 'S' as const,
      net: 50,
    }
    const data = makeData({
      lines: [line19, line7],
      totals: {
        net: 150,
        byGroup: {
          'S|19': { rate: 19, category: 'S', base: 100 },
          'S|7': { rate: 7, category: 'S', base: 50 },
        },
        totalTax: 22.5,
        gross: 172.5,
        lines: [line19, line7],
      },
    })

    // Act
    const xml = buildXml(data)

    // Assert
    const subtotalCount = (xml.match(/<cac:TaxSubtotal>/g) ?? []).length
    expect(subtotalCount).toBe(2)
    expect(xml).toContain('<cbc:Percent>19.00</cbc:Percent>')
    expect(xml).toContain('<cbc:Percent>7.00</cbc:Percent>')
  })
})
