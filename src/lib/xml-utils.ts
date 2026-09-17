/**
 * Gemeinsame XML/HTML-Hilfsfunktionen.
 * Werden von xml-builder.ts, ubl-parser.ts und cii-parser.ts importiert.
 */

/** XML-Entity-Escaping für Textnodes */
export function escXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** XML-Entity-Escaping für Attributwerte */
export function escAttr(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** HTML-Entity-Escaping für Viewer-Ausgaben */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Deutsche Zahlenformatierung mit 2 Dezimalstellen */
export function fmt(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Ersten Textinhalt eines XML-Tags im Teilbaum lesen */
export function ublText(root: Element, tag: string): string {
  const els = root.getElementsByTagName(tag)
  return els.length > 0 ? (els[0]?.textContent?.trim() ?? '') : ''
}

/** Alle direkten Kindtexte mit gegebenem Tag-Namen */
export function directChildTexts(root: Element, tag: string): string[] {
  const out: string[] = []
  for (const child of Array.from(root.children)) {
    if (child.tagName === tag) out.push(child.textContent?.trim() ?? '')
  }
  return out
}

/** Unterscheidet UBL-Invoice, CII-CrossIndustryInvoice und unbekannte Formate */
export function detectFormat(doc: Document): 'UBL' | 'CII' | 'UNKNOWN' {
  const rootTag = doc.documentElement?.tagName ?? ''
  if (rootTag === 'Invoice' || rootTag.endsWith(':Invoice')) return 'UBL'
  if (rootTag.includes('CrossIndustryInvoice')) return 'CII'
  return 'UNKNOWN'
}
