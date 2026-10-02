// Assemble les manuels (docs/manuels/*.md) en un seul document Word : docs/manuels/Manuels-utilisateurs.docx
//   node scripts/build-manuels-docx.mjs
// Sous-ensemble de Markdown pris en charge : titres #/##/###, paragraphes, listes à puces (2 niveaux) et numérotées, tableaux,
// citations (>), gras, italique, code en ligne, liens externes. Les liens entre manuels deviennent du texte simple.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'docs', 'manuels')
const GREEN = '166534', LIGHT = 'E8F1EA', GREY = '6B7280', FONT = 'Calibri'
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN       // A4, marges 2 cm

// ------------------------------------------
// Inline : **gras**, *italique*, `code`, [texte](url)
// ------------------------------------------
const TOKEN = /(\*\*(?:[^*]|\*(?!\*))+\*\*|`[^`]+`|\*[^*\s](?:[^*]*[^*\s])?\*|\[[^\]]+\]\([^)]+\))/g
function inline(text, style = {}) {
  const out = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...style }))
    const t = m[0]
    if (t.startsWith('**')) out.push(...inline(t.slice(2, -2), { ...style, bold: true }))
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', size: 19, shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }, ...style }))
    else if (t.startsWith('[')) {
      const [, label, url] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (/^https?:\/\//.test(url)) out.push(new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink', font: FONT, color: '0563C1', underline: {} })] }))
      else out.push(...inline(label, style))                                  // lien interne : texte simple
    } else out.push(...inline(t.slice(1, -1), { ...style, italics: true }))
    last = m.index + t.length
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...style }))
  return out
}

// ------------------------------------------
// Blocs
// ------------------------------------------
const cellsOf = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const isSep = line => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)
const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' }
const borders = { top: border, bottom: border, left: border, right: border }

function table(rows) {
  const head = rows[0], body = rows.slice(1)
  const n = head.length
  const weights = head.map((_, c) => Math.min(40, Math.max(9, Math.max(...rows.map(r => (r[c] ?? '').length)))))
  const total = weights.reduce((a, b) => a + b, 0)
  let widths = weights.map(w => Math.floor((w / total) * CONTENT_W))
  widths[n - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0)
  const mk = (text, w, header) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders,
    shading: header ? { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { after: 0 }, children: inline(text, { size: 19, bold: header }) })],
  })
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: head.map((h, c) => mk(h, widths[c], true)) }),
           ...body.map(r => new TableRow({ cantSplit: true, children: head.map((_, c) => mk(r[c] ?? '', widths[c], false)) }))],
  })
}

function convert(md, { firstH1AsHeading = true } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    let m
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const level = m[1].length
      out.push(new Paragraph({
        heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1],
        pageBreakBefore: level === 1 && firstH1AsHeading, keepNext: true,
        spacing: { before: level === 1 ? 0 : level === 2 ? 320 : 220, after: 120 },
        children: [new TextRun({ text: m[2].replace(/[*`]/g, ''), font: FONT, bold: true, color: GREEN, size: [36, 28, 24][level - 1] })],
      }))
      i++
    } else if (line.trim().startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const rows = [cellsOf(line)]
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cellsOf(lines[i++]))
      out.push(table(rows), new Paragraph({ spacing: { after: 120 }, children: [] }))
    } else if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      for (const q of quote) {
        if (!q.trim()) continue
        const b = q.match(/^\s*[-*]\s+(.*)$/)
        out.push(new Paragraph({
          spacing: { after: 60 }, indent: { left: 360 + (b ? 280 : 0), hanging: b ? 220 : 0 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 8 } },
          shading: { type: ShadingType.CLEAR, fill: 'F4F8F5', color: 'auto' },
          children: inline((b ? '• ' : '') + (b ? b[1] : q), { size: 21 }),
        }))
      }
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    } else if ((m = line.match(/^(\s*)[-*]\s+(.*)$/))) {
      const level = m[1].length >= 2 ? 1 : 0
      out.push(new Paragraph({ numbering: { reference: 'puces', level }, spacing: { after: 60 }, children: inline(m[2]) }))
      i++
    } else if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
      const level = m[1].length >= 2 ? 1 : 0
      out.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 360 + level * 360, hanging: 360 }, children: [new TextRun({ text: `${m[2]}.\t`, font: FONT, bold: true, color: GREEN }), ...inline(m[3])], tabStops: [{ type: 'left', position: 360 + level * 360 }] }))
      i++
    } else {
      const para = [line.trim()]
      i++
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||>|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim())
      out.push(new Paragraph({ spacing: { after: 120, line: 276 }, children: inline(para.join(' ')) }))
    }
  }
  return out
}

// ------------------------------------------
// Assemblage
// ------------------------------------------
const files = readdirSync(dir).filter(f => /^\d{2}-.*\.md$/.test(f)).sort()
const titles = files.map(f => readFileSync(join(dir, f), 'utf8').match(/^#\s+(.*)$/m)[1])
const readme = readFileSync(join(dir, 'README.md'), 'utf8').replace(/^#\s+.*\n/, '')

const cover = [
  new Paragraph({ spacing: { before: 2600 }, children: [new TextRun({ text: 'RÉPUBLIQUE DU SÉNÉGAL', font: FONT, bold: true, color: GREEN, size: 24 })] }),
  new Paragraph({ spacing: { after: 900 }, children: [new TextRun({ text: 'Un Peuple — Un But — Une Foi', font: FONT, color: GREY, size: 22 })] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'Manuels utilisateurs', font: FONT, bold: true, size: 64 })] }),
  new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: 'Plateforme intégrée de pilotage du cycle des marchés publics', font: FONT, size: 32, color: GREEN })] }),
  new Paragraph({ spacing: { after: 1800 }, children: [new TextRun({ text: 'De la programmation budgétaire à la clôture du marché', font: FONT, size: 24, color: GREY })] }),
  new Paragraph({ children: [new TextRun({ text: 'Version 1.0 — Octobre 2026', font: FONT, size: 22 })] }),
  new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Document établi d\'après le code et les règles de gestion de l\'application. Captures d\'écran à ajouter après la première recette utilisateur ; valeurs réglementaires à confirmer par la DCMP.', font: FONT, size: 19, color: GREY, italics: true })] }),
]
const sommaire = [
  new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, spacing: { after: 200 }, children: [new TextRun({ text: 'Sommaire', font: FONT, bold: true, color: GREEN, size: 36 })] }),
  new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: 'Présentation et cycle de vie d\'un marché', font: FONT, size: 24 })] }),
  ...titles.map(t => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: t, font: FONT, size: 24 })] })),
]
const body = [
  new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, spacing: { after: 160 }, children: [new TextRun({ text: 'Présentation', font: FONT, bold: true, color: GREEN, size: 36 })] }),
  ...convert(readme, { firstH1AsHeading: false }),
  ...files.flatMap(f => convert(readFileSync(join(dir, f), 'utf8'))),
]

const doc = new Document({
  creator: 'Plateforme des marchés publics', title: 'Manuels utilisateurs', description: 'Manuels par profil, plan de formation et parcours de recette',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: 'puces', levels: [
    { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } }, run: { color: GREEN } } },
    { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 270 } }, run: { color: GREEN } } },
  ] }] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Manuels utilisateurs — Plateforme des marchés publics', font: FONT, size: 17, color: GREY })] })] }), first: new Header({ children: [new Paragraph({ children: [] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Page ', font: FONT, size: 17, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 17, color: GREY })] })] }), first: new Footer({ children: [new Paragraph({ children: [] })] }) },
    children: [...cover, ...sommaire, ...body],
  }],
})

const target = join(dir, 'Manuels-utilisateurs.docx')
writeFileSync(target, await Packer.toBuffer(doc))
console.log(`écrit : ${target} (${files.length} manuels)`)
