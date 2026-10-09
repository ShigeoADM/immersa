// Vista previa de las novelas al compartir su enlace (WhatsApp, Discord, buscadores).
//
// Las novelas que ya existían al publicar la web tienen su página preparada (archivo
// estático, que Hosting sirve primero). Las demás llegan aquí: se lee la novela y se
// devuelve la página de la web con su título, sinopsis y portada en las etiquetas.

import { onRequest } from 'firebase-functions/v2/https';
import { SITE, publishedStory, storyPage } from './story-meta.js';

// Página base de la web, guardada un minuto para no pedirla en cada visita
let base = { html: '', at: 0 };
async function template() {
  if (base.html && Date.now() - base.at < 60_000) return base.html;
  const res = await fetch(`${SITE}/index.html`);
  if (!res.ok) throw new Error(`La web respondió ${res.status}`);
  base = { html: await res.text(), at: Date.now() };
  return base.html;
}

export const storyPreview = onRequest(
  { region: 'us-central1', memory: '256MiB', maxInstances: 5, invoker: 'public' },
  async (req, res) => {
    let html;
    try {
      html = await template();
    } catch (e) {
      console.error('No se pudo leer la página base:', e);
      res.redirect(302, '/');
      return;
    }
    const id = (req.path.match(/^\/story\/([A-Za-z0-9_-]+)/) ?? [])[1];
    try {
      const story = id ? await publishedStory(id) : null;
      if (story) html = storyPage(html, story);
    } catch (e) {
      console.error('No se pudo leer la novela:', e); // se sirve la página genérica
    }
    // Hosting la guarda unos minutos; al publicar la web se vacía sola
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300');
    res.status(200).send(html);
  },
);
