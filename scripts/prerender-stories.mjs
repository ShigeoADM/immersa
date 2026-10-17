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
import { SITE, publishedStories, storyPage } from './story-meta.mjs';

const DIST = 'dist';

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
