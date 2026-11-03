// .xlsx without a library (#43): writing a workbook with a note, a header, text columns and dropdowns, and reading the cells back.
// Reading copes with what Excel, LibreOffice and Numbers write on saving: shared strings, inline strings, numbers and booleans.
import { readZip, writeZip } from './zip.ts';

export interface SheetColumn {
  header: string;
  width?: number;
  /** Stored as text, so Excel keeps 06-numbers and times as typed. */
  text?: boolean;
  /** A dropdown with these values. */
  list?: string[];
}

export interface SheetSpec {
  name: string;
  /** Row 1: what goes on this sheet. Row 2 is the header, data starts on row 3. */
  note: string;
  columns: SheetColumn[];
  rows: (string | number | null)[][];
}

/** Rows that can get a dropdown: enough for an event, without making the file large. */
const VALIDATED_ROWS = 1000;
const LISTS_SHEET = 'Lijsten';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  // Control characters aren't allowed in XML; a tab and new lines are.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const columnIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Styles: 0 normal, 1 bold (header), 2 text, 3 grey italic (note). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><color rgb="FF6B7079"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function cell(ref: string, value: string | number | null, style: number) {
  if (value === null || value === '') return '';
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
}

function worksheet(sheet: SheetSpec, listRanges: Map<number, string>) {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"${c.text ? ' style="2"' : ''}/>`).join('');
  const rows = [
    `<row r="1">${cell('A1', sheet.note, 3)}</row>`,
    `<row r="2">${sheet.columns.map((c, i) => cell(`${columnName(i)}2`, c.header, 1)).join('')}</row>`,
    ...sheet.rows.map((row, r) => `<row r="${r + 3}">${row.map((v, i) => cell(`${columnName(i)}${r + 3}`, v, sheet.columns[i]?.text ? 2 : 0)).join('')}</row>`),
  ];
  const validations = [...listRanges].map(([i, range]) =>
    `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${columnName(i)}3:${columnName(i)}${VALIDATED_ROWS}"><formula1>${range}</formula1></dataValidation>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>${validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : ''}</worksheet>`;
}

export function writeXlsx(sheets: SheetSpec[]): Buffer {
  // Every dropdown reads its values from a column on a hidden sheet: no limit on length, and commas in names are fine.
  const lists: string[][] = [];
  const ranges = sheets.map((sheet) => new Map(sheet.columns.flatMap((c, i) => {
    if (!c.list?.length) return [];
    lists.push(c.list);
    const col = columnName(lists.length - 1);
    return [[i, `${LISTS_SHEET}!$${col}$1:$${col}$${c.list.length}`] as [number, string]];
  })));
  const listRows = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, r) => lists.map((l) => l[r] ?? null));
  const all = [...sheets.map((s, i) => ({ name: s.name, xml: worksheet(s, ranges[i]!), hidden: false })),
    ...(lists.length ? [{ name: LISTS_SHEET, xml: worksheet({ name: LISTS_SHEET, note: '', columns: [], rows: [] }, new Map()).replace(/<sheetData>.*<\/sheetData>/s,
      `<sheetData>${listRows.map((row, r) => `<row r="${r + 1}">${row.map((v, i) => cell(`${columnName(i)}${r + 1}`, v, 0)).join('')}</row>`).join('')}</sheetData>`), hidden: true }] : [])];

  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${all.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${all.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${all.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${all.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: STYLES },
    ...all.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ];
  return writeZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.text, 'utf8') })));
}

// ---- Reading ----

const unescape = (text: string) => text
  .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!;
  });

const attributes = (tag: string) => new Map([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1]!, unescape(m[2]!)]));
/** All text of a string item, without the phonetic runs Japanese Excel adds. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('');

/** Every sheet by name, as rows of cell texts; row 1 is index 0. Numbers come as Excel writes them (e.g. a time as a fraction of a day). */
export function readXlsx(file: Buffer): Map<string, string[][]> {
  const zip = readZip(file);
  const read = (path: string) => zip.get(path)?.toString('utf8');
  const workbook = read('xl/workbook.xml');
  if (!workbook) throw new Error('Dit is geen Excel-bestand (.xlsx)');
  const rels = new Map([...(read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const a = attributes(m[0]);
    const target = a.get('Target') ?? '';
    return [a.get('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`];
  }));
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));

  const sheets = new Map<string, string[][]>();
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attributes(m[0]);
    const xml = read(rels.get(a.get('r:id') ?? '') ?? '');
    if (!xml) continue;
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attributes(row[1]!).get('r')) - 1;
      const cells: string[] = [];
      let next = 0;
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ca = attributes(c[1]!);
        const ref = ca.get('r');
        const col = ref ? columnIndex(ref.replace(/\d+/g, '')) : next;
        next = col + 1;
        const body = c[2] ?? '';
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const type = ca.get('t');
        cells[col] = type === 's' ? shared[Number(value)] ?? ''
          : type === 'inlineStr' ? textOf(body)
          : type === 'b' ? (value === '1' ? 'ja' : 'nee')
          : value !== undefined ? unescape(value) : '';
      }
      rows[Number.isNaN(r) ? rows.length : r] = Array.from(cells, (v) => v ?? '');
    }
    sheets.set(a.get('name') ?? '', Array.from(rows, (row) => row ?? []));
  }
  return sheets;
}
