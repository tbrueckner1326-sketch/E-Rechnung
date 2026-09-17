// UN/ECE Einheitencodes (verwendeter Subset)
export const UNIT_CODES = ['H87', 'HUR', 'DAY', 'MTK', 'MTR', 'C62'] as const
export type UnitCode = (typeof UNIT_CODES)[number]

// UBL/EN-16931-Steuerkategorien
export type TaxCategory = 'S' | 'Z' | 'AE'

export interface InvoiceLine {
  desc: string
  qty: number
  unit: UnitCode
  price: number
  vat: number // 0 | 7 | 19
  category: TaxCategory
  net: number // qty * price
}

export interface Party {
  name: string
  street: string
  zip: string
  city: string
  country: string
  email: string
  vat?: string
}

export interface ReverseCharge {
  active: boolean
  note: string
}

export interface TaxGroup {
  rate: number
  category: TaxCategory
  base: number
}

export interface Totals {
  net: number
  byGroup: Record<string, TaxGroup> // Schlüssel: "S|19", "AE|0" etc.
  totalTax: number
  gross: number
  lines: InvoiceLine[]
}

export interface Skonto {
  percent: number
  days: number
}

export interface InvoiceData {
  // Verkäufer
  seller: Party
  sellerIban: string
  sellerBic: string
  // Käufer
  buyer: Party
  buyerRef: string
  // Kopfdaten
  invId: string
  issueDate: string // YYYY-MM-DD
  dueDate: string
  period: string
  terms: string
  // Sonderfälle
  rc: ReverseCharge
  skonto: Skonto
  // Positionen + berechnete Summen
  lines: InvoiceLine[]
  totals: Totals
}

// Ausgabe der UBL-Parser (normalizeUBL)
export interface NormalizedInvoice {
  format: 'UBL'
  invId: string
  issueDate: string
  dueDate: string
  buyerRef: string
  seller: Party | null
  buyer: Party | null
  iban: string
  bic: string
  terms: string
  totals: { net: string; gross: string }
  notes: string[]
  rc: ReverseCharge
  lines: InvoiceLine[]
}

// Ausgabe des CII-Parsers (normalizeCII) — nur Kopfdaten, keine Positionen
export interface NormalizedCII {
  format: 'CII'
  invId: string
  issueDate: string
  sellerName: string
  buyerName: string
  net: string
  tax: string
  gross: string
}
