// Después de `expo export`: prepara la vista previa de cada novela publicada.
//
// La web es una sola página (dist/index.html) y quien pinta el contenido es JavaScript.
// WhatsApp, Discord o Google no lo ejecutan al mirar un enlace: solo leen las etiquetas
// del HTML. Así que un enlace a una novela enseñaba siempre la tarjeta genérica de Immersa.
//
// Este script lee las novelas publicadas (son públicas, no hace falta cuenta) y escribe
// para cada una dist/story/{id}/index.html: la misma página, pero con su título, su
// sinopsis y su portada en las etiquetas. También las añade al sitemap.
//
// Las novelas nuevas no tienen vista previa propia hasta la siguiente publicación de la web.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = 'immersa-94cc9';
const SITE = 'https://immersa.web.app';
const DIST = 'dist';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

// Valor de un campo tal como lo devuelve la API REST de Firestore
const val = f => f?.stringValue ?? f?.booleanValue ?? f?.integerValue ?? null;

async function publishedStories() {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'stories' }],
          where: { fieldFilter: { field: { fieldPath: 'published' }, op: 'EQUAL', value: { booleanValue: true } } },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Firestore respondió ${res.status}`);
  return (await res.json())
    .filter(r => r.document)
    .map(r => {
      const f = r.document.fields ?? {};
      return {
        id: r.document.name.split('/').pop(),
        title: oneLine(val(f.title)),
        author: oneLine(val(f.authorName)),
        synopsis: oneLine(val(f.synopsis)),
        cover: val(f.coverUrl) || '',
        format: val(f.format) || '',
        isAdult: val(f.isAdult) === true,
        updatedAt: val(f.updatedAt) || '',
      };
    })
    // Las +18 no se enseñan a quien no tiene cuenta: tampoco en las vistas previas
    .filter(s => s.title && !s.isAdult);
}

// Cambia el contenido de una etiqueta <meta> (o la URL canónica) de la página base
function setMeta(html, attr, name, content) {
  const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, `$1${esc(content)}$2`) : html;
}

function storyPage(base, s) {
  const url = `${SITE}/story/${s.id}`;
  const title = `${s.title}${s.author ? ` — ${s.author}` : ''} · Immersa`;
  const kind = s.format === 'Webnovel' ? 'Webnovel' : 'Novela interactiva';
  const description = clip(s.synopsis || `${kind}${s.author ? ` de ${s.author}` : ''}. Léela gratis en Immersa.`, 200);
  let html = base
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  html = setMeta(html, 'property', 'og:type', 'book');
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:title', s.title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'name', 'twitter:title', s.title);
  html = setMeta(html, 'name', 'twitter:description', description);
  if (s.cover) {
    html = setMeta(html, 'property', 'og:image', s.cover);
    html = setMeta(html, 'name', 'twitter:image', s.cover);
    // La portada es vertical y no sabemos su tamaño: tarjeta pequeña, sin medidas
    html = setMeta(html, 'name', 'twitter:card', 'summary');
    html = html.replace(/\s*<meta property="og:image:(width|height)" content="[^"]*" \/>/g, '');
  }
  // Texto para quien no ejecuta JavaScript (buscadores sencillos)
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>
      <h1>${esc(s.title)}</h1>
      ${s.author ? `<p>${esc(kind)} de ${esc(s.author)}.</p>` : ''}
      <p>${esc(s.synopsis)}</p>
      <p>Necesitas activar JavaScript para leerla en Immersa.</p>
    </noscript>`);
  return html;
}

const base = readFileSync(join(DIST, 'index.html'), 'utf8');
let stories = [];
try {
  stories = await publishedStories();
} catch (e) {
  // Sin conexión o Firestore caído: la web se publica igual, solo sin vistas previas
  console.warn(`No se pudieron leer las novelas publicadas (${e.message}). Se omiten las vistas previas.`);
}

for (const s of stories) {
  const dir = join(DIST, 'story', s.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), storyPage(base, s));
}

if (stories.length > 0) {
  const sitemapPath = join(DIST, 'sitemap.xml');
  const entries = stories.map(s =>
    `  <url><loc>${SITE}/story/${s.id}</loc>${s.updatedAt ? `<lastmod>${s.updatedAt.slice(0, 10)}</lastmod>` : ''}<priority>0.8</priority></url>`).join('\n');
  writeFileSync(sitemapPath, readFileSync(sitemapPath, 'utf8').replace('</urlset>', `${entries}\n</urlset>`));
}

console.log(`Vistas previas: ${stories.length} ${stories.length === 1 ? 'novela' : 'novelas'}${stories.length ? ` (${stories.map(s => s.title).join(', ')})` : ''}`);
