// Générateur minimal de classeur Excel (.xlsx) : une feuille, en-tête figé et filtré, montants au format « 1 234 567 ».
// Les textes sont écrits en chaînes en ligne (jamais en formules) : une cellule commençant par « = » reste du texte,
// ce qui neutralise l'injection de formules à l'ouverture dans un tableur.
import { strToU8, zipSync } from 'fflate'

export type Cell = string | number | null | undefined

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
// Caractères interdits en XML 1.0 : on les retire plutôt que de produire un fichier que le tableur refuserait.
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

export const xmlEscape = (s: string) =>
  s.replace(ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** A, B, …, Z, AA, AB… (index à partir de 0). */
export function columnName(index: number): string {
  let n = index, out = ''
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}

/** Nom d'onglet valide : 31 caractères au plus, sans [ ] : * ? / et sans apostrophe en début ou fin. */
export function sheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31)
  return cleaned || 'Feuille1'
}

const cell = (ref: string, value: Cell, style: number): string => {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style === 3 ? 3 : 2}"><v>${value}</v></c>`
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`
}

export function buildXlsx(opts: { sheet: string; header: string[]; rows: Cell[][]; widths?: number[]; moneyColumns?: number[] }): Uint8Array {
  const money = new Set(opts.moneyColumns ?? [])
  const lastCol = columnName(Math.max(opts.header.length - 1, 0))
  const lastRow = opts.rows.length + 1
  const cols = (opts.widths ?? opts.header.map(h => Math.max(10, Math.min(h.length + 4, 40))))
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const head = `<row r="1">${opts.header.map((h, c) => cell(`${columnName(c)}1`, h, 1)).join('')}</row>`
  const body = opts.rows.map((r, i) => {
    const n = i + 2
    return `<row r="${n}">${opts.header.map((_, c) => cell(`${columnName(c)}${n}`, r[c], money.has(c) ? 3 : 0)).join('')}</row>`
  }).join('')

  const sheet = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<dimension ref="A1:${lastCol}${lastRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>`
    + `<autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`

  // styles : 0 normal · 1 en-tête (gras, fond vert) · 2 nombre · 3 montant (#,##0)
  const styles = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
    + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill></fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName(opts.sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  return zipSync(files)
}
