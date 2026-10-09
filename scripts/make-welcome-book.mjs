// Genera «Bienvenido a Immersa.immersa»: el libro de introducción, listo para importarlo
// desde Escribir → «Importar una copia de seguridad». Lleva el texto, las transiciones,
// el personaje y la decisión; las imágenes y la música se añaden después en el editor.
//
//   node scripts/make-welcome-book.mjs

import { mkdirSync, writeFileSync } from 'node:fs';

const now = new Date().toISOString();
const P = (...paragraphs) => paragraphs.join('\n\n');

// transition = animación al PASAR esta página (hacia la siguiente)
const pages = [
  {
    id: 'p1', bgNone: true, musicUrl: null, transition: 'fadeBlack',
    text: P('Esto parece un libro.', 'Tiene páginas. Tiene texto.', 'Pero le falta algo, ¿verdad?'),
  },
  {
    id: 'p2', transition: 'fade', // ← FONDO 1
    text: P('Así está mejor.', 'En Immersa cada página tiene su lugar: un fondo que acompaña a lo que se cuenta.'),
  },
  {
    id: 'p3', transition: 'curtain', // ← aquí empieza la MÚSICA
    text: P('Y también suena.', 'La música empieza cuando el autor quiere y te sigue de una página a otra.'),
  },
  {
    id: 'p4', transition: 'squaresCenter', // ← FONDO 2
    text: P('Cambiar de escena es pasar la página.', 'Un telón, un destello, un fundido… cada autor elige cómo.'),
  },
  {
    id: 'p5', leftChar: 'Cigüeña', transition: 'fade', // ← FONDO 3 (o ilustración del personaje)
    text: P('—Hola. Soy yo quien te ha estado hablando.', '—Los personajes llevan su nombre, para que siempre sepas quién dice cada cosa.'),
  },
  {
    id: 'p6', leftChar: 'Cigüeña', nextPageId: 'p7a', transition: 'fade',
    text: P('—A veces la historia te deja elegir.', '—¿Qué prefieres tú?'),
    extraBoxes: [
      { text: 'Leer historias',   x: 14, y: 80, w: 32, paragraph: 2, animation: 'pop', targetPageId: 'p7a' },
      { text: 'Escribir la mía',  x: 54, y: 80, w: 32, paragraph: 2, animation: 'pop', targetPageId: 'p7b' },
    ],
  },
  {
    id: 'p7a', leftChar: 'Cigüeña', nextPageId: 'p8', transition: 'fade',
    text: P('—Entonces estás en el sitio adecuado.',
            '—En la portada hay novelas Modernas, como esta, y Webnovels para leer de corrido. Guarda las que te gusten y sigue a sus autores.'),
  },
  {
    id: 'p7b', leftChar: 'Cigüeña', nextPageId: 'p8', transition: 'fade',
    text: P('—Me alegra oírlo.',
            '—Pulsa el lápiz, «Nuevo Libro», y elige formato. Todo lo que has visto aquí —fondos, música, transiciones, decisiones— lo puedes usar tú, gratis y desde el navegador.'),
  },
  {
    id: 'p8', leftChar: 'Cigüeña', // ← FONDO 4 (final)
    text: P('—Eso es todo. El resto lo cuentas tú.', 'Bienvenido a Immersa.'),
  },
].map((p, i) => ({ links: [], order: i + 1, createdAt: now, ...p }));

const data = {
  app: 'Immersa', exportVersion: 1, exportedAt: now,
  story: {
    title: 'Bienvenido a Immersa',
    subtitle: 'Un libro que se explica solo',
    synopsis: 'Cinco minutos para ver qué es una Novela Moderna: páginas con fondo, música, personajes y decisiones. Léelo y luego escribe la tuya.',
    credits: '',
    authorName: 'Immersa',
    format: 'Moderno',
    language: 'Español',
    genres: ['Slice of Life'],
    audience: 'u15',
    isAdult: false,
    adultContent: [],
    status: 'completed',
    coverOrientation: 'vertical',
    coverUrl: '',
    recommendedUiColor: null,
    createdAt: now,
  },
  chapters: [{ id: 'bienvenida', title: 'Bienvenida', order: 1, createdAt: now, pages }],
};

// Mismo formato que services/backup-file.ts (versión 2: sin comprimir)
const MAGIC = [0x49, 0x4d, 0x4d, 0x45, 0x52, 0x53, 0x41];
const KEY = [0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a, 0x7c, 0x15, 0xf3, 0x9c, 0xc0, 0x60, 0x5c, 0xed, 0xc8, 0x34, 0x1b];
const scramble = bytes => bytes.map((b, i) => b ^ KEY[i % KEY.length] ^ (i & 0xff));

const body = scramble(new TextEncoder().encode(JSON.stringify(data)));
const file = new Uint8Array(MAGIC.length + 1 + body.length);
file.set(MAGIC, 0);
file[MAGIC.length] = 2;
file.set(body, MAGIC.length + 1);

mkdirSync('libro-bienvenida', { recursive: true });
writeFileSync('libro-bienvenida/Bienvenido a Immersa.immersa', file);

// Comprobación: se lee de vuelta igual que lo hará la web
const back = JSON.parse(new TextDecoder().decode(scramble(file.subarray(MAGIC.length + 1))));
console.log(`Libro generado: ${back.chapters[0].pages.length} páginas · ${file.length} bytes`);
