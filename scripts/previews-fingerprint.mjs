// Huella de las vistas previas: resume en un código corto lo que aparece en ellas (título,
// autor, sinopsis y portada de cada novela publicada). La tarea automática de GitHub solo
// vuelve a publicar la web si la huella cambia, es decir, si hay una novela nueva,
// retocada o retirada. Así no se guardan en Firebase versiones de la web repetidas.
//
//   node scripts/previews-fingerprint.mjs   → imprime la huella

import { createHash } from 'node:crypto';
import { publishedStories } from './story-meta.mjs';

const stories = await publishedStories();
const data = stories
  .map(s => [s.id, s.title, s.author, s.synopsis, s.cover, s.format].join('\u0001'))
  .sort()
  .join('\u0002');
console.log(createHash('sha256').update(data).digest('hex').slice(0, 16));
