// Importar un libro entero (formato Webnovel) desde un archivo: .txt, .md, .docx, .epub o .pdf.
//
// 1. Se saca el texto del archivo, conservando párrafos y, si el archivo lo trae (Word,
//    EPUB), la negrita y la cursiva con las marcas del editor (**negrita**, *cursiva*).
// 2. Se buscan los encabezados que separan las partes del libro: «Prólogo»,
//    «Capítulo 3», «Capítulo 3: El viaje», «SS. Aiko», «Palabras del autor», «Epílogo»…
//    En Word y EPUB también cuentan los párrafos con estilo de título.
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
    const html = new DOMParser().parseFromString(text(base + decodeURI(href)), 'text/html');
    for (const el of Array.from(html.body?.querySelectorAll('h1, h2, h3, p, div:not(:has(p, div))') ?? [])) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-3]$/.test(tag)) { const t = el.textContent?.trim(); if (t) out.push(FORCED + t); continue; }
      const runs: { text: string; bold: boolean; italic: boolean }[] = [];
      const walk = (n: Node, bold: boolean, italic: boolean) => {
        if (n.nodeType === 3) { runs.push({ text: n.textContent ?? '', bold, italic }); return; }
        const t = (n as Element).tagName?.toLowerCase();
        if (t === 'br') { runs.push({ text: '\n', bold, italic }); return; }
        const b = bold || t === 'b' || t === 'strong', i = italic || t === 'i' || t === 'em';
        n.childNodes.forEach(c => walk(c, b, i));
      };
      walk(el, false, false);
      out.push(joinRuns(runs));
    }
  }
  return out.join('\n\n');
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
