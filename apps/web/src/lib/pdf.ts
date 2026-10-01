// Génération de PDF (A4) à partir d'un modèle de blocs — sans navigateur ni police externe (polices PDF standard).
// Chaque document porte en pied de page son identifiant et l'empreinte SHA-256 de son contenu : un tirage papier
// peut être comparé au document régénéré par la plateforme.
import { createHash } from 'node:crypto'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export type Block =
  | { t: 'h1'; text: string }
  | { t: 'h2'; text: string }
  | { t: 'p'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'table'; head: string[]; rows: string[][]; widths?: number[] }
  | { t: 'signatures'; labels: string[] }
  | { t: 'spacer'; h?: number }

export interface PdfModel {
  title: string
  subtitle?: string
  reference: string
  blocks: Block[]
}

/** Les polices standard n'encodent que WinAnsi : on remplace proprement les caractères hors jeu. */
export function sanitize(text: string): string {
  return text
    .replace(/[→⇒]/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/Σ/g, 'Somme')
    .replace(/[‘’]/g, "'").replace(/[  ]/g, ' ').replace(/‑/g, '-').replace(/[✓✔]/g, 'oui')
    .replace(/[\r\t]/g, ' ')
    // dernier filet : tout caractère non représentable en WinAnsi devient « ? »
    .replace(/[^\n -~ -ÿŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/g, '?')
}

export function contentHash(model: PdfModel): string {
  return createHash('sha256').update(JSON.stringify({ r: model.reference, t: model.title, b: model.blocks })).digest('hex')
}

const PAGE = { w: 595.28, h: 841.89 }
const M = { l: 50, r: 50, t: 60, b: 60 }
const INK = rgb(0.1, 0.1, 0.1)
const GREEN = rgb(0.08, 0.4, 0.2)

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of sanitize(text).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue }
      if (line) lines.push(line)
      // mot plus long qu'une ligne : coupe dure
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length - 1
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
        lines.push(rest.slice(0, cut)); rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

export async function renderPdf(model: PdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(sanitize(model.title)); doc.setProducer('Plateforme des marchés publics du Sénégal'); doc.setCreator('Plateforme des marchés publics du Sénégal')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const hash = contentHash(model)
  const width = PAGE.w - M.l - M.r

  let page: PDFPage
  let y = 0
  const newPage = () => { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - M.t }
  const ensure = (h: number) => { if (y - h < M.b) newPage() }
  const text = (s: string, x: number, size: number, f: PDFFont = font, color = INK) => page.drawText(s, { x, y, size, font: f, color })

  newPage()
  // En-tête institutionnel
  text('REPUBLIQUE DU SENEGAL', M.l, 9, bold, GREEN); y -= 11
  text('Un Peuple - Un But - Une Foi', M.l, 8, font); y -= 26
  for (const l of wrap(model.title.toUpperCase(), bold, 15, width)) { ensure(20); text(l, M.l, 15, bold); y -= 20 }
  if (model.subtitle) for (const l of wrap(model.subtitle, font, 10, width)) { ensure(14); text(l, M.l, 10, font, rgb(0.35, 0.35, 0.35)); y -= 14 }
  y -= 4
  page!.drawLine({ start: { x: M.l, y }, end: { x: PAGE.w - M.r, y }, thickness: 1, color: GREEN }); y -= 18

  for (const b of model.blocks) {
    switch (b.t) {
      case 'h1': y -= 6; for (const l of wrap(b.text, bold, 13, width)) { ensure(34); text(l, M.l, 13, bold, GREEN); y -= 18 } break
      case 'h2': y -= 4; for (const l of wrap(b.text, bold, 11, width)) { ensure(30); text(l, M.l, 11, bold); y -= 15 } break
      case 'p': for (const l of wrap(b.text, font, 10, width)) { ensure(14); text(l, M.l, 10); y -= 13.5 } y -= 5; break
      case 'list':
        for (const item of b.items) {
          const lines = wrap(item, font, 10, width - 14)
          lines.forEach((l, i) => { ensure(14); if (i === 0) text('-', M.l + 2, 10); text(l, M.l + 14, 10); y -= 13.5 })
        }
        y -= 5; break
      case 'kv':
        for (const [k, v] of b.rows) {
          const lines = wrap(v || '-', font, 10, width - 150)
          ensure(14 * lines.length)
          text(sanitize(k), M.l, 9.5, bold, rgb(0.3, 0.3, 0.3))
          lines.forEach(l => { text(l, M.l + 150, 10); y -= 13.5 })
        }
        y -= 5; break
      case 'table': {
        const n = b.head.length
        const raw = b.widths ?? Array(n).fill(1)
        const total = raw.reduce((a, c) => a + c, 0)
        const cw = raw.map(w => (w / total) * width)
        const drawRow = (cells: string[], f: PDFFont, fill: boolean) => {
          const wrapped = cells.map((c, i) => wrap(c ?? '', f, 8.5, cw[i] - 8))
          const h = Math.max(...wrapped.map(w => w.length)) * 11 + 8
          ensure(h)
          if (fill) page.drawRectangle({ x: M.l, y: y - h + 11, width, height: h, color: rgb(0.9, 0.95, 0.9) })
          let x = M.l
          wrapped.forEach((lines, i) => { lines.forEach((l, j) => page.drawText(l, { x: x + 4, y: y - j * 11, size: 8.5, font: f, color: INK })); x += cw[i] })
          page.drawLine({ start: { x: M.l, y: y - h + 11 }, end: { x: M.l + width, y: y - h + 11 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) })
          y -= h
        }
        drawRow(b.head, bold, true)
        b.rows.forEach(r => drawRow(r, font, false))
        y -= 8; break
      }
      case 'signatures':
        ensure(90); y -= 18
        b.labels.forEach((label, i) => {
          const x = M.l + i * (width / b.labels.length)
          page.drawText(sanitize(label), { x, y, size: 9.5, font: bold, color: INK })
          page.drawLine({ start: { x, y: y - 60 }, end: { x: x + width / b.labels.length - 20, y: y - 60 }, thickness: 0.5, color: INK })
        })
        y -= 80; break
      case 'spacer': y -= b.h ?? 10; break
    }
  }

  const pages = doc.getPages()
  pages.forEach((p, i) => {
    const foot = sanitize(`${model.reference}  -  page ${i + 1}/${pages.length}  -  empreinte SHA-256 du contenu : ${hash.slice(0, 24)}`)
    p.drawText(foot, { x: M.l, y: 30, size: 7, font, color: rgb(0.45, 0.45, 0.45) })
  })
  return doc.save()
}
