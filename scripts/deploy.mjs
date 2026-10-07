// Publica la web.
//
//   node scripts/deploy.mjs dev    → web de desarrollo (immersa-94cc9.web.app): para probar
//   node scripts/deploy.mjs prod   → web pública (immersa.web.app)
//
// Las novedades van primero a desarrollo; cuando están probadas se publican en la pública.
// Hace lo mismo en los dos casos: construye la web, prepara las vistas previas de las
// novelas y la sube al sitio elegido. La versión (commit y hora) queda escrita en la web;
// la de desarrollo la enseña en su etiqueta.

import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const target = process.argv[2];
if (target !== 'dev' && target !== 'prod') {
  console.error('Uso: node scripts/deploy.mjs dev|prod');
  process.exit(1);
}

const sh = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const out = cmd => execSync(cmd).toString().trim();

const dirty = out('git status --porcelain') !== '';
const when = new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const build = `${out('git rev-parse --short HEAD')}${dirty ? '+' : ''} · ${when}`;

rmSync('dist', { recursive: true, force: true });
sh('npx expo export --platform web', { EXPO_PUBLIC_BUILD: build });
sh('node scripts/prerender-stories.mjs');
sh(`npx firebase-tools deploy --only hosting:${target} --project immersa-94cc9`);
console.log(`\nPublicado en ${target === 'dev' ? 'DESARROLLO (https://immersa-94cc9.web.app)' : 'la web PÚBLICA (https://immersa.web.app)'} · ${build}`);
