// Vista previa de una novela: su título, sinopsis y portada en las etiquetas de la página.
// Lo usa scripts/prerender-stories.mjs al publicar la web.

export const PROJECT = 'immersa-94cc9';
export const SITE = 'https://immersa.web.app';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

// Valor de un campo tal como lo devuelve la API REST de Firestore
export const val = f => f?.stringValue ?? f?.booleanValue ?? f?.integerValue ?? null;

export async function publishedStories() {
  const res = await fetch(
    `${DOCS}:runQuery`,
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
    .map(r => fromDocument(r.document))
    // Las +18 no se enseñan a quien no tiene cuenta: tampoco en las vistas previas
    .filter(s => s.title && !s.isAdult);
}

// Cambia el contenido de una etiqueta <meta> (o la URL canónica) de la página base
function setMeta(html, attr, name, content) {
  const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, `$1${esc(content)}$2`) : html;
}

export function storyPage(base, s) {
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


function fromDocument(d) {
  const f = d.fields ?? {};
  return {
    id: d.name.split('/').pop(),
    title: oneLine(val(f.title)),
    author: oneLine(val(f.authorName)),
    synopsis: oneLine(val(f.synopsis)),
    cover: val(f.coverUrl) || '',
    format: val(f.format) || '',
    isAdult: val(f.isAdult) === true,
    published: val(f.published) === true,
    updatedAt: val(f.updatedAt) || '',
  };
}

// Una novela publicada y apta para todos los públicos; null si no existe, no está
// publicada o es +18 (esas se quedan con la tarjeta genérica de Immersa)
export async function publishedStory(id) {
  const res = await fetch(`${DOCS}/stories/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const s = fromDocument(await res.json());
  return s.published && s.title && !s.isAdult ? s : null;
}
