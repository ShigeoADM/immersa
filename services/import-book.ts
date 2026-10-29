// Importar un libro entero (formato Webnovel) desde un archivo: .txt, .md, .docx, .odt,
// .rtf, .epub, .html o .pdf.
//
// 1. Se saca el texto del archivo, conservando párrafos y, si el archivo lo trae (Word,
//    ODT, RTF, EPUB, HTML), la negrita y la cursiva con las marcas del editor (**negrita**, *cursiva*).
// 2. Se buscan los encabezados que separan las partes del libro: «Prólogo»,
//    «Capítulo 3», «Capítulo 3: El viaje», «SS. Aiko», «Palabras del autor», «Epílogo»…
//    En Word, ODT, RTF, EPUB y HTML también cuentan los párrafos con estilo de título.
// 3. Cada parte se convierte en un capítulo: el encabezado va al título y el texto, sin
//    repetirlo, al contenido.
//
// Solo funciona en la web (lee los archivos con las herramientas del navegador).

import { unzipSync, strFromU8 } from 'fflate';
import { countWords } from '@/services/stories';
import { stripRichText } from '@/constants/webnovel';
import { ts } from '@/i18n';

export type BookSection = { title: string; content: string; words: number; heading: boolean };

// Marca interna para los títulos que el propio archivo señala como tales (estilo de título)
const FORCED = '\u0001';

// ── Lectura de cada formato ──────────────────────────────────────────────────

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // Muchos caracteres inválidos: probablemente es un .txt antiguo de Windows
  const bad = (utf8.match(/�/g) ?? []).length;
  return bad > 5 ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

// Une tramos de texto con su formato en una línea con marcas, sin marcas vacías ni
// marcas que empiecen o acaben en espacio (el editor no las reconocería)
function joinRuns(runs: { text: string; bold: boolean; italic: boolean }[]): string {
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged.map(r => {
    if ((!r.bold && !r.italic) || !r.text.trim()) return r.text.replace(/\*/g, '');
    const m = r.bold && r.italic ? '***' : r.bold ? '**' : '*';
    const lead = r.text.match(/^\s*/)![0], trail = r.text.match(/\s*$/)![0];
    return `${lead}${m}${r.text.trim().replace(/\*/g, '')}${m}${trail}`;
  }).join('');
}

function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: f => f.name === 'word/document.xml' });
  const doc = files['word/document.xml'];
  if (!doc) throw new Error(ts('Ese archivo no parece un documento de Word (.docx).'));
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const on = (el: Element | null) => !!el && !/^(0|false|none)$/i.test(el.getAttributeNS(W, 'val') ?? el.getAttribute('w:val') ?? '');
  const lines: string[] = [];
  for (const p of Array.from(xml(strFromU8(doc)).getElementsByTagNameNS(W, 'p'))) {
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const styleName = (style?.getAttributeNS(W, 'val') ?? style?.getAttribute('w:val') ?? '').toLowerCase();
    // «Heading1», «Title» y sus versiones en español («Ttulo1» es el nombre interno de «Título 1»)
    const isHeading = /^(heading|ttulo|titulo|título|title)\s*[12]?$/.test(styleName);
    const runs: { text: string; bold: boolean; italic: boolean }[] = [];
    for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
      const rPr = r.getElementsByTagNameNS(W, 'rPr')[0] ?? null;
      const bold = on(rPr?.getElementsByTagNameNS(W, 'b')[0] ?? null);
      const italic = on(rPr?.getElementsByTagNameNS(W, 'i')[0] ?? null);
      let text = '';
      for (const c of Array.from(r.childNodes) as Element[]) {
        if (c.localName === 't') text += c.textContent ?? '';
        else if (c.localName === 'tab') text += ' ';
        else if (c.localName === 'br') text += '\n';
      }
      if (text) runs.push({ text, bold, italic });
    }
    const line = isHeading ? runs.map(r => r.text).join('') : joinRuns(runs);
    lines.push(isHeading && line.trim() ? FORCED + line.trim() : line);
  }
  return lines.join('\n\n');
}

function readEpub(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const container = xml(text('META-INF/container.xml'));
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error(ts('Ese archivo no parece un libro EPUB.'));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = xml(text(opfPath));
  const items: Record<string, string> = {};
  for (const it of Array.from(opf.getElementsByTagName('item'))) items[it.getAttribute('id') ?? ''] = it.getAttribute('href') ?? '';
  const out: string[] = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const href = items[ref.getAttribute('idref') ?? ''];
    if (!href) continue;
    out.push(...htmlLines(new DOMParser().parseFromString(text(base + decodeURI(href)), 'text/html')));
  }
  return out.join('\n\n');
}

// Párrafos de una página web (un capítulo de EPUB o un .html): los títulos h1-h3 cuentan
// como encabezados
function htmlLines(html: Document): string[] {
  const out: string[] = [];
  for (const el of Array.from(html.body?.querySelectorAll('h1, h2, h3, p, div:not(:has(p, div))') ?? [])) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) { const t = el.textContent?.trim(); if (t) out.push(FORCED + t); continue; }
    const runs: { text: string; bold: boolean; italic: boolean }[] = [];
    const walk = (n: Node, bold: boolean, italic: boolean) => {
      if (n.nodeType === 3) { runs.push({ text: n.textContent ?? '', bold, italic }); return; }
      const t = (n as Element).tagName?.toLowerCase();
      if (t === 'br') { runs.push({ text: '\n', bold, italic }); return; }
      if (t === 'script' || t === 'style') return;
      const b = bold || t === 'b' || t === 'strong', i = italic || t === 'i' || t === 'em';
      n.childNodes.forEach(c => walk(c, b, i));
    };
    walk(el, false, false);
    out.push(joinRuns(runs));
  }
  return out;
}

function readHtml(bytes: Uint8Array): string {
  return htmlLines(new DOMParser().parseFromString(decodeText(bytes), 'text/html')).join('\n\n');
}

// ODT (LibreOffice, y lo que descarga Google Docs como «OpenDocument»): content.xml, con
// los formatos en estilos con nombre. Los text:h y los párrafos con estilo de título son
// encabezados; las notas al pie se saltan.
function readOdt(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: f => f.name === 'content.xml' || f.name === 'styles.xml' });
  if (!files['content.xml']) throw new Error(ts('Ese archivo no parece un documento OpenDocument (.odt).'));
  const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
  const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
  // Formato de cada estilo (heredando del estilo padre)
  const styles: Record<string, { bold?: boolean; italic?: boolean; parent?: string }> = {};
  for (const name of ['styles.xml', 'content.xml']) {
    if (!files[name]) continue;
    for (const s of Array.from(xml(strFromU8(files[name])).getElementsByTagNameNS(STYLE, 'style'))) {
      const props = s.getElementsByTagNameNS(STYLE, 'text-properties')[0];
      const weight = props?.getAttributeNS(FO, 'font-weight'), fstyle = props?.getAttributeNS(FO, 'font-style');
      styles[s.getAttributeNS(STYLE, 'name') ?? ''] = {
        bold: weight ? weight === 'bold' || Number(weight) >= 600 : undefined,
        italic: fstyle ? fstyle === 'italic' || fstyle === 'oblique' : undefined,
        parent: s.getAttributeNS(STYLE, 'parent-style-name') ?? undefined,
      };
    }
  }
  const fmt = (name: string | null, key: 'bold' | 'italic', inherited: boolean): boolean => {
    for (let n = name, depth = 0; n && styles[n] && depth < 10; n = styles[n].parent ?? null, depth++) {
      if (styles[n][key] !== undefined) return styles[n][key]!;
    }
    return inherited;
  };
  const headingStyle = (name: string | null) => {
    for (let n = name, depth = 0; n && depth < 10; n = styles[n]?.parent ?? null, depth++) {
      if (/^(title|heading(_20_[12])?|t[ií]tulo(_20_[12])?)$/i.test(n)) return true;
    }
    return false;
  };
  const lines: string[] = [];
  const paragraph = (p: Element, heading: boolean) => {
    const runs: { text: string; bold: boolean; italic: boolean }[] = [];
    const walk = (n: Node, bold: boolean, italic: boolean) => {
      if (n.nodeType === 3) { runs.push({ text: n.textContent ?? '', bold, italic }); return; }
      const el = n as Element;
      if (el.namespaceURI === TEXT) {
        if (el.localName === 's') { runs.push({ text: ' '.repeat(Number(el.getAttributeNS(TEXT, 'c') ?? 1) || 1), bold, italic }); return; }
        if (el.localName === 'tab') { runs.push({ text: ' ', bold, italic }); return; }
        if (el.localName === 'line-break') { runs.push({ text: '\n', bold, italic }); return; }
        if (el.localName === 'note' || el.localName === 'bookmark' || el.localName === 'soft-page-break') return;
      }
      const style = el.getAttributeNS(TEXT, 'style-name');
      const b = style ? fmt(style, 'bold', bold) : bold, i = style ? fmt(style, 'italic', italic) : italic;
      n.childNodes.forEach(c => walk(c, b, i));
    };
    const style = p.getAttributeNS(TEXT, 'style-name');
    walk(p, fmt(style, 'bold', false), fmt(style, 'italic', false));
    if (heading || headingStyle(style)) {
      const t = runs.map(r => r.text).join('').trim();
      lines.push(t ? FORCED + t : '');
    } else lines.push(joinRuns(runs));
  };
  const visit = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.namespaceURI === TEXT && c.localName === 'h') paragraph(c, true);
      else if (c.namespaceURI === TEXT && c.localName === 'p') paragraph(c, false);
      else if (!(c.namespaceURI === TEXT && c.localName === 'note')) visit(c);
    }
  };
  const body = xml(strFromU8(files['content.xml'])).getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0', 'text')[0];
  if (body) visit(body);
  return lines.join('\n\n');
}

// RTF (WordPad, TextEdit, programas de escritura antiguos): se recorre el código a mano.
// Se conservan párrafos, negrita y cursiva; los párrafos con nivel de esquema 1 (estilo de
// título) son encabezados. Tablas de fuentes, imágenes, cabeceras y demás se saltan.
const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'fldinst', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator',
  'shp', 'shpinst', 'nonshppict', 'pntext', 'pntxta', 'pntxtb', 'listtext', 'bkmkstart', 'bkmkend', 'filetbl',
  'revtbl', 'userprops', 'docvar', 'annotation', 'atnid', 'atnauthor', 'mmathPr', 'wgrffmtfilter', 'pgdsctbl',
]);
const RTF_CHARS: Record<string, string> = {
  tab: ' ', emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ',
};
const CODEPAGES: Record<number, string> = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 65001: 'utf-8' };

function readRtf(bytes: Uint8Array): string {
  let src = '';
  for (let k = 0; k < bytes.length; k++) src += String.fromCharCode(bytes[k]);
  if (!src.startsWith('{\\rtf')) throw new Error(ts('Ese archivo no parece un documento RTF.'));
  let decoder = new TextDecoder('windows-1252');
  type State = { bold: boolean; italic: boolean; skip: boolean; uc: number };
  let st: State = { bold: false, italic: false, skip: false, uc: 1 };
  const stack: State[] = [];
  const lines: string[] = [];
  let runs: { text: string; bold: boolean; italic: boolean }[] = [];
  let heading = false;
  let pending: number[] = []; // bytes \'hh seguidos (los caracteres japoneses ocupan dos)
  let skipChars = 0;          // caracteres de reserva tras un \u
  const flush = () => {
    if (!pending.length) return;
    const text = decoder.decode(new Uint8Array(pending));
    pending = [];
    if (!st.skip) runs.push({ text, bold: st.bold, italic: st.italic });
  };
  const put = (text: string) => {
    flush();
    if (skipChars > 0) { skipChars--; return; }
    if (!st.skip) runs.push({ text, bold: st.bold, italic: st.italic });
  };
  const endParagraph = () => {
    flush();
    if (heading) { const t = runs.map(r => r.text).join('').trim(); lines.push(t ? FORCED + t : ''); }
    else lines.push(joinRuns(runs));
    runs = [];
  };
  let i = 0;
  let groupStart = false; // justo después de «{»: la primera palabra puede ser un destino
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') { flush(); stack.push({ ...st }); groupStart = true; i++; continue; }
    if (ch === '}') { flush(); st = stack.pop() ?? st; groupStart = false; i++; continue; }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (ch !== '\\') { put(ch); groupStart = false; i++; continue; }
    const next = src[i + 1];
    if (next === "'") {
      const byte = parseInt(src.substr(i + 2, 2), 16);
      i += 4;
      if (skipChars > 0) { skipChars--; continue; }
      if (!isNaN(byte)) pending.push(byte);
      continue;
    }
    if (next === '*') { st.skip = true; i += 2; continue; }
    if (next === '\\' || next === '{' || next === '}') { put(next); i += 2; continue; }
    if (next === '~') { put(' '); i += 2; continue; }
    if (next === '_') { put('-'); i += 2; continue; }
    if (next === '\r' || next === '\n') { if (!st.skip) endParagraph(); i += 2; continue; }
    if (!/[a-zA-Z]/.test(next ?? '')) { i += 2; continue; }
    const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40))!;
    const word = m[1], param = m[2] !== undefined ? Number(m[2]) : null;
    i += 1 + m[0].length;
    const wasGroupStart = groupStart;
    groupStart = false;
    if (RTF_SKIP.has(word) && wasGroupStart) { st.skip = true; continue; }
    switch (word) {
      case 'par': case 'sect': case 'page': if (!st.skip) endParagraph(); break;
      case 'line': put('\n'); break;
      case 'pard': flush(); heading = false; break;
      case 'outlinelevel': heading = param === 0; break;
      case 'b': flush(); st.bold = param !== 0; break;
      case 'i': flush(); st.italic = param !== 0; break;
      case 'plain': flush(); st.bold = false; st.italic = false; break;
      case 'uc': st.uc = param ?? 1; break;
      case 'u': put(String.fromCharCode(param! < 0 ? param! + 65536 : param!)); skipChars = st.uc; break;
      case 'ansicpg': try { decoder = new TextDecoder(CODEPAGES[param!] ?? `windows-${param}`); } catch { /* se queda en 1252 */ } break;
      case 'bin': i += param ?? 0; break;
      default: if (RTF_CHARS[word]) put(RTF_CHARS[word]);
    }
  }
  endParagraph();
  return lines.join('\n\n');
}

// PDF: el lector de PDF de Mozilla se carga solo al importar uno (no pesa en la web)
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsLoading: Promise<any> | null = null;
function loadPdfJs(): Promise<any> {
  const g = globalThis as any;
  if (g.pdfjsLib) return Promise.resolve(g.pdfjsLib);
  if (!pdfjsLoading) {
    pdfjsLoading = new Promise((resolve, reject) => {
      const s = g.document.createElement('script');
      s.src = `${PDFJS}/pdf.min.js`;
      s.onload = () => { g.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; resolve(g.pdfjsLib); };
      s.onerror = () => { pdfjsLoading = null; reject(new Error(ts('No se pudo cargar el lector de PDF. Comprueba la conexión.'))); };
      g.document.head.appendChild(s);
    });
  }
  return pdfjsLoading;
}

async function readPdf(bytes: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  // Líneas de cada página, con su altura y posición, para rehacer los párrafos
  const pages: { text: string; y: number; h: number }[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const lines: { text: string; y: number; h: number }[] = [];
    for (const it of content.items as any[]) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]), h = Math.abs(it.transform[3]) || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < h * 0.5) last.text += it.str;
      else lines.push({ text: it.str, y, h });
    }
    pages.push(lines.filter(l => l.text.trim()));
  }
  // Cabeceras y pies repetidos en muchas páginas (título del libro, número de página)
  const seen: Record<string, number> = {};
  for (const p of pages) for (const t of new Set(p.map(l => l.text.trim()))) seen[t] = (seen[t] ?? 0) + 1;
  const repeated = (t: string) => /^\d{1,4}$/.test(t) || (pages.length >= 4 && seen[t] >= Math.max(3, pages.length * 0.3));
  const paras: string[] = [];
  let cur = '';
  for (const p of pages) {
    const lines = p.filter(l => !repeated(l.text.trim()));
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const gap = prev ? prev.y - l.y : Infinity;
      const newPara = !prev || gap > l.h * 1.7 || /[.!?…:»"”)]$/.test(prev.text.trim()) && l.text.trim().length < 70 && gap > l.h * 1.25;
      if (newPara && cur.trim()) { paras.push(cur.trim()); cur = ''; }
      cur += (cur && !cur.endsWith('-') ? ' ' : '') + l.text.trim();
    });
  }
  if (cur.trim()) paras.push(cur.trim());
  return paras.join('\n\n');
}

export async function readBookFile(file: { name: string; bytes: Uint8Array }): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx') return readDocx(file.bytes);
  if (ext === 'epub') return readEpub(file.bytes);
  if (ext === 'pdf') return readPdf(file.bytes);
  if (ext === 'odt') return readOdt(file.bytes);
  if (ext === 'rtf') return readRtf(file.bytes);
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return readHtml(file.bytes);
  if (ext === 'doc') throw new Error(ts('Los .doc antiguos no se pueden leer. Guárdalo como .docx o como texto (.txt) y vuelve a intentarlo.'));
  return decodeText(file.bytes);
}

// ── Separar en capítulos ─────────────────────────────────────────────────────

const NUM = '(\\d+|[ivxlcdm]+|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|one|two|three|four|five|six|seven|eight|nine|ten)';
const HEADINGS = [
  // Capítulo 3 · Capítulo 3: El viaje · Cap. 3 · Chapter 3 · Episodio 3
  new RegExp(`^(cap[ií]tulo|cap\\.|chapter|episodio|episode)\\s*${NUM}\\b\\s*([.:\\-–—]\\s*\\S.*)?$`, 'i'),
  // 第3話 · 第三章
  /^第[0-9０-９一二三四五六七八九十百]+[話章]/,
  // Prólogo, Epílogo, Interludio, Intermedio, Extra… (solos o con subtítulo)
  /^(pr[oó]logo|ep[ií]logo|interludio|intermedio|extra|especial|prologue|epilogue|interlude)\b\s*([.:\-–—]\s*\S.*)?$/i,
  // SS. Nombre · Side story · Historia corta
  /^(ss\.?\s+\S|side\s*story|historia\s+corta|relato\s+corto)/i,
  // Palabras del autor, Nota(s) del autor, Agradecimientos, Afterword
  /^(palabras|nota|notas|mensaje)\s+(del|de\s+la)\s+autor(a)?\b|^agradecimientos\b|^afterword\b|^author'?s\s+note/i,
];

const looksLikeHeading = (line: string) =>
  line.length <= 90 && !/^[—–-]/.test(line) && HEADINGS.some(re => re.test(line));

// Títulos de capítulo: sin punto final y cortados al máximo que admite el editor
const cleanTitle = (t: string) => t.replace(/[.\s]+$/, '').replace(/\s+/g, ' ').slice(0, 80);

export function splitIntoChapters(raw: string, fallbackTitle: string): BookSection[] {
  const text = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const sections: { title: string | null; lines: string[] }[] = [{ title: null, lines: [] }];
  for (const rawLine of text.split('\n')) {
    const forced = rawLine.startsWith(FORCED);
    const line = rawLine.replace(FORCED, '').trim();
    const plain = line.replace(/\*+/g, '');
    if (plain && (forced || looksLikeHeading(plain))) sections.push({ title: cleanTitle(plain), lines: [] });
    else sections[sections.length - 1].lines.push(rawLine.replace(FORCED, ''));
  }
  const out: BookSection[] = [];
  for (const s of sections) {
    const content = s.lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const words = countWords(stripRichText(content));
    // Encabezados sin texto debajo (un índice, «Volumen 1» seguido de «Prólogo»…): fuera
    if (!words) continue;
    out.push({ title: s.title ?? cleanTitle(fallbackTitle), content, words, heading: s.title !== null });
  }
  return out;
}
