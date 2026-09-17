import { describe, test, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { normalizeUBL, detectFormat } from '../src/lib/ubl-parser'
import { buildXml } from '../src/lib/xml-builder'
import type { InvoiceData } from '../src/types/invoice'

// ── Fixtures laden ────────────────────────────────────────────────────────────

function loadFixture(name: string): Document {
  const xml = readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8')
  return new DOMParser().parseFromString(xml, 'application/xml')
}

let docStandard: Document
let docRc: Document

beforeAll(() => {
  docStandard = loadFixture('ubl-standard-19.xml')
  docRc = loadFixture('ubl-reverse-charge.xml')
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  test('detectFormat_ublInvoice_gibtUBLZurueck', () => {
    // Act + Assert
    expect(detectFormat(docStandard)).toBe('UBL')
  })

  test('detectFormat_rcInvoice_gibtUBLZurueck', () => {
    expect(detectFormat(docRc)).toBe('UBL')
  })

  test('detectFormat_unbekannterRoot_gibtUNKNOWNZurueck', () => {
    // Arrange
    const doc = new DOMParser().parseFromString('<UnknownRoot/>', 'application/xml')

    // Act + Assert
    expect(detectFormat(doc)).toBe('UNKNOWN')
  })
})

describe('normalizeUBL – Standard 19 %', () => {
  test('normalizeUBL_standard_invIdKorrekt', () => {
    // Act
    const result = normalizeUBL(docStandard)

    // Assert
    expect(result.format).toBe('UBL')
    expect(result.invId).toBe('TEST-2026-001')
  })

  test('normalizeUBL_standard_lieferantKorrekt', () => {
    // Act
    const result = normalizeUBL(docStandard)

    // Assert
    expect(result.seller?.name).toBe('Testlieferant GmbH')
    expect(result.seller?.vat).toBe('DE123456789')
    expect(result.seller?.city).toBe('Berlin')
  })

  test('normalizeUBL_standard_betraegeKorrekt', () => {
    // Act
    const result = normalizeUBL(docStandard)

    // Assert
    expect(result.totals.net).toBe('100.00')
    expect(result.totals.gross).toBe('119.00')
  })

  test('normalizeUBL_standard_zeilenKorrekt', () => {
    // Act
    const result = normalizeUBL(docStandard)

    // Assert
    expect(result.lines).toHaveLength(1)
    const line = result.lines[0]!
    expect(line.qty).toBe(10)
    expect(line.price).toBe(10)
    expect(line.unit).toBe('HUR')
    expect(line.vat).toBe(19)
    expect(line.category).toBe('S')
  })

  test('normalizeUBL_standard_keinReverseCharge', () => {
    // Act
    const result = normalizeUBL(docStandard)

    // Assert
    expect(result.rc.active).toBe(false)
  })
})

describe('normalizeUBL – Reverse Charge (§ 13b)', () => {
  test('normalizeUBL_reverseCharge_rcAktiv', () => {
    // Act
    const result = normalizeUBL(docRc)

    // Assert
    expect(result.rc.active).toBe(true)
  })

  test('normalizeUBL_reverseCharge_noteEnthaelt13b', () => {
    // Act
    const result = normalizeUBL(docRc)

    // Assert
    expect(result.rc.note).toContain('§ 13b')
  })

  test('normalizeUBL_reverseCharge_zeilenkategorieAE', () => {
    // Act
    const result = normalizeUBL(docRc)

    // Assert
    expect(result.lines[0]?.category).toBe('AE')
    expect(result.lines[0]?.vat).toBe(0)
  })

  test('normalizeUBL_reverseCharge_betraegeKorrekt', () => {
    // Act
    const result = normalizeUBL(docRc)

    // Assert
    expect(result.totals.net).toBe('5000.00')
    expect(result.totals.gross).toBe('5000.00')
  })
})

describe('Round-Trip: buildXml → normalizeUBL', () => {
  test('roundTrip_standard19_kernfelderStimmenUeberein', () => {
    // Arrange
    const line = {
      desc: 'Beratungsleistung',
      qty: 10,
      unit: 'HUR' as const,
      price: 10,
      vat: 19,
      category: 'S' as const,
      net: 100,
    }
    const data: InvoiceData = {
      seller: {
        name: 'Rundtriplieferant GmbH',
        street: 'Teststraße 1',
        zip: '10115',
        city: 'Berlin',
        country: 'DE',
        email: 'rt@test.de',
        vat: 'DE111222333',
      },
      sellerIban: 'DE12345678901234567890',
      sellerBic: '',
      buyer: {
        name: 'Rundtripkunde AG',
        street: 'Kundenweg 5',
        zip: '80331',
        city: 'München',
        country: 'DE',
        email: 'rtkunde@test.de',
      },
      buyerRef: 'RT-REF-001',
      invId: 'RT-2026-001',
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
    }

    // Act
    const xml = buildXml(data)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const result = normalizeUBL(doc)

    // Assert
    expect(result.invId).toBe('RT-2026-001')
    expect(result.totals.net).toBe('100.00')
    expect(result.totals.gross).toBe('119.00')
    expect(result.seller?.name).toBe('Rundtriplieferant GmbH')
    expect(result.lines[0]?.qty).toBe(10)
  })
})
