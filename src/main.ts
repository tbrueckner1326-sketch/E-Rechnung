/**
 * Entry-Point: verbindet UI-Schicht (src/ui/) mit Geschäftslogik (src/lib/).
 *
 * Kein Business-Code hier — nur Event-Listener und Initialisierung.
 * TODO #6: normalizeCII / formatCiiDate → src/lib/cii-parser.ts
 * TODO #8: renderUblViewer / renderCiiViewer / extractXmlFromPdf → src/ui/viewer.ts / src/lib/pdf-extractor.ts
 */

import JSZip from 'jszip'
import { buildXml } from './lib/xml-builder'
import { normalizeUBL, detectFormat } from './lib/ubl-parser'
import { escapeHtml } from './lib/xml-utils'
import type { NormalizedCII } from './types/invoice'
import {
  getFormData,
  fillFormFromUBL,
  validate,
  toggleReverseCharge,
  setStatus,
  setImportStatus,
  setViewerStatus,
} from './ui/form'
import { addLine, recalc } from './ui/lines'

// CDN-Fallback für pdf.js — wird in #8 durch pnpm-Paket ersetzt
declare const pdfjsLib: { GlobalWorkerOptions: { workerSrc: string }; getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> } }
interface PdfDoc { getAttachments: () => Promise<Record<string, { filename: string; content: Uint8Array }> | null> }
const pdfWorkerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js'

// ── CII-Parser (TODO #6) ──────────────────────────────────────────────────────

function formatCiiDate(raw: string): string {
  if (raw && raw.length === 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return raw
}

function normalizeCII(doc: Document): NormalizedCII {
  const root = doc.documentElement
  let invId = ''
  let issueDateRaw = ''
  const docEls = root.getElementsByTagName('rsm:ExchangedDocument')
  if (docEls.length > 0) {
    const d = docEls[0] as Element
    const idEls = d.getElementsByTagName('ram:ID')
    if (idEls.length > 0) invId = (idEls[0] as Element).textContent!.trim()
    const dtEls = d.getElementsByTagName('udt:DateTimeString')
    if (dtEls.length > 0) issueDateRaw = (dtEls[0] as Element).textContent!.trim()
  }
  let sellerName = ''
  let buyerName = ''
  const agreementEls = root.getElementsByTagName('ram:ApplicableHeaderTradeAgreement')
  if (agreementEls.length > 0) {
    const a = agreementEls[0] as Element
    const sellerEls = a.getElementsByTagName('ram:SellerTradeParty')
    if (sellerEls.length > 0) {
      const n = (sellerEls[0] as Element).getElementsByTagName('ram:Name')
      if (n.length > 0) sellerName = (n[0] as Element).textContent!.trim()
    }
    const buyerEls = a.getElementsByTagName('ram:BuyerTradeParty')
    if (buyerEls.length > 0) {
      const n = (buyerEls[0] as Element).getElementsByTagName('ram:Name')
      if (n.length > 0) buyerName = (n[0] as Element).textContent!.trim()
    }
  }
  let net = ''
  let tax = ''
  let gross = ''
  const sumEls = root.getElementsByTagName('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
  if (sumEls.length > 0) {
    const s = sumEls[0] as Element
    const g = (tag: string) => {
      const e = s.getElementsByTagName(tag)
      return e.length > 0 ? (e[0] as Element).textContent!.trim() : ''
    }
    net = g('ram:TaxBasisTotalAmount')
    tax = g('ram:TaxTotalAmount')
    gross = g('ram:GrandTotalAmount')
  }
  return { format: 'CII', invId, issueDate: formatCiiDate(issueDateRaw), sellerName, buyerName, net, tax, gross }
}

// ── Viewer-Renderer (TODO #8) ─────────────────────────────────────────────────

function renderUblViewer(data: ReturnType<typeof normalizeUBL>): string {
  const linesHtml = data.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.desc)}</td><td>${l.qty} ${escapeHtml(l.unit)}</td><td>${l.vat.toFixed(2)}%</td><td>${l.price.toFixed(2)} €</td></tr>`
    )
    .join('')
  return `<div class="viewer-block">
    <h3>Rechnung ${escapeHtml(data.invId)}</h3>
    <p>Datum: ${escapeHtml(data.issueDate)}${data.dueDate ? ' · Fällig: ' + escapeHtml(data.dueDate) : ''}</p>
    <div class="viewer-parties">
      <div><strong>Von:</strong><br>${escapeHtml(data.seller?.name ?? '–')}<br>${escapeHtml(data.seller?.street ?? '')}<br>${escapeHtml(data.seller?.zip ?? '')} ${escapeHtml(data.seller?.city ?? '')}<br>USt-IdNr.: ${escapeHtml(data.seller?.vat ?? '–')}</div>
      <div><strong>An:</strong><br>${escapeHtml(data.buyer?.name ?? '–')}<br>${escapeHtml(data.buyer?.street ?? '')}<br>${escapeHtml(data.buyer?.zip ?? '')} ${escapeHtml(data.buyer?.city ?? '')}</div>
    </div>
    <table class="viewer-table"><thead><tr><th>Beschreibung</th><th>Menge</th><th>USt</th><th>Preis</th></tr></thead><tbody>${linesHtml}</tbody></table>
    <table class="viewer-totals">
      <tr><td>Netto</td><td>${escapeHtml(data.totals.net)} €</td></tr>
      <tr><td>Brutto</td><td>${escapeHtml(data.totals.gross)} €</td></tr>
    </table>
    ${data.rc.active ? `<div class="viewer-note">Reverse-Charge (§13b): ${escapeHtml(data.rc.note)}</div>` : ''}
    ${data.terms ? `<div class="viewer-note">Zahlungsbedingungen: ${escapeHtml(data.terms)}</div>` : ''}
  </div>`
}

function renderCiiViewer(data: NormalizedCII): string {
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

// ── PDF-Extraktion (TODO #8) ──────────────────────────────────────────────────

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
  const candidates = Object.values(attachments).filter((a) => /\.xml$/i.test(a.filename))
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const score = (n: string) => (/factur-x|zugferd|xrechnung|cross.?industry/i.test(n) ? 0 : 1)
    return score(a.filename) - score(b.filename)
  })
  return new TextDecoder('utf-8').decode(candidates[0]!.content)
}

// ── Datei-Handler ─────────────────────────────────────────────────────────────

async function handleImportFile(file: File): Promise<void> {
  setImportStatus('Lese Datei …', '')
  try {
    const text = await file.text()
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parseerror').length || doc.getElementsByTagName('parsererror').length) {
      setImportStatus('Datei ist kein gültiges XML.', 'error')
      return
    }
    const format = detectFormat(doc)
    if (format !== 'UBL') {
      setImportStatus(
        `Nur UBL-XRechnungen können in das Formular übernommen werden (erkanntes Format: ${format}). Nutze stattdessen den Viewer unten, um die Rechnung trotzdem anzusehen.`,
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

async function handleViewerFile(file: File): Promise<void> {
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

// ── Aktionen ──────────────────────────────────────────────────────────────────

async function showPreview(): Promise<void> {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const xml = buildXml(getFormData())
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  const pw = document.getElementById('previewWrap') as HTMLDetailsElement
  pw.style.display = 'block'
  pw.open = true
  setStatus('Vorschau aktualisiert.', 'ok')
}

async function copyXml(): Promise<void> {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const xml = buildXml(getFormData())
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  ;(document.getElementById('previewWrap') as HTMLDetailsElement).style.display = 'block'
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

async function generate(): Promise<void> {
  const missing = validate()
  if (missing.length) {
    setStatus('Fehlende Pflichtangaben: ' + missing.join(', '), 'error')
    return
  }
  const data = getFormData()
  const xml = buildXml(data)
  const invId = data.invId.replace(/[^\w.-]+/g, '_') || 'rechnung'
  ;(document.getElementById('xmlPreview') as HTMLElement).textContent = xml
  ;(document.getElementById('previewWrap') as HTMLDetailsElement).style.display = 'block'
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
document.getElementById('sk_percent')!.addEventListener('change', () => recalc())
document.getElementById('sk_days')!.addEventListener('change', () => recalc())
document.getElementById('btnAddLine')!.addEventListener('click', () => addLine())
document.getElementById('btnGenerate')!.addEventListener('click', () => void generate())
document.getElementById('btnPreview')!.addEventListener('click', () => void showPreview())
document.getElementById('btnCopy')!.addEventListener('click', () => void copyXml())
document.getElementById('importFile')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void handleImportFile(f)
})
document.getElementById('viewerFile')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void handleViewerFile(f)
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
