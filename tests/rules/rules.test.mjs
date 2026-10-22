// Pruebas de las reglas de Firestore y Storage con el emulador local.
// Proyecto ficticio "demo-immersa": no se conecta a nada real.
//
//   cd tests/rules && npm install && npm test   (necesita Java 17 o superior)
//
// Cada caso dice si la operación debe permitirse o bloquearse. Si cambias las reglas,
// todas deben seguir saliendo OK (y conviene añadir casos para lo nuevo).
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, addDoc, collection, writeBatch, increment } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
import fs from 'node:fs';

const DIR = process.env.RULES_DIR ?? '.';
// El emulador dice en qué puerto está cada servicio
const hostPort = (v, port) => { const [h, p] = (v || `127.0.0.1:${port}`).split(":"); return { host: h, port: Number(p) }; };
const env = await initializeTestEnvironment({
  projectId: 'demo-immersa',
  firestore: { rules: fs.readFileSync(`${DIR}/firestore.rules`, 'utf8'), ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) },
  storage: { rules: fs.readFileSync(`${DIR}/storage.rules`, 'utf8'), ...hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199) },
});

await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'stories/s1'), { uid: 'author', published: true, title: 'Historia', likeCount: 0 });
  await setDoc(doc(db, 'stories/s1/chapters/c1'), { title: 'Cap 1', likeCount: 0 });
  await setDoc(doc(db, 'stories/draft'), { uid: 'author', published: false, title: 'Borrador' });
  await setDoc(doc(db, 'stories/other'), { uid: 'someone', published: true, title: 'De otro', likeCount: 0 });
  await setDoc(doc(db, 'users/author'), {});
  await setDoc(doc(db, 'users/fan'), {});
  await setDoc(doc(db, 'users/mod'), { role: 'admin', permissions: ['deleteStories'] });
  await setDoc(doc(db, 'users/boss'), { role: 'owner' });
  await setDoc(doc(db, 'profiles/author'), { displayName: 'Autor' });
  await setDoc(doc(db, 'profiles/author/followers/fan'), { createdAt: 'x' });
  await uploadBytes(ref(ctx.storage(), 'covers/author/old.webp'), new Uint8Array([1, 2, 3]), { contentType: 'image/webp' });
});

const anon = env.unauthenticatedContext();
const author = env.authenticatedContext('author');
const fan = env.authenticatedContext('fan');
const stranger = env.authenticatedContext('stranger');
const mod = env.authenticatedContext('mod');
const boss = env.authenticatedContext('boss');

const now = new Date().toISOString();
const notif = (extra = {}) => ({ type: 'like', title: 'Nuevo me gusta', body: 'A Fan le gusta "Historia".', tx: { title: 'Nuevo me gusta', p: { name: 'Fan' } }, storyId: 's1', fromUid: 'fan', createdAt: now, read: false, ...extra });
const notifNoStory = (extra = {}) => { const n = notif(extra); delete n.storyId; return n; };
const comment = (extra = {}) => ({ uid: 'fan', userName: 'Fan', userAvatar: '', text: '¡Me encanta!', createdAt: now, chapterId: 'c1', pageId: 'p1', chapterNumber: 1, pageNumber: 2, ...extra });
const report = (extra = {}) => ({ type: 'story', storyId: 's1', storyTitle: 'Historia', targetUid: 'author', reason: 'spam', details: 'texto', reporterUid: 'fan', createdAt: now, ...extra });

const results = [];
async function check(name, expectOk, fn) {
  let ok;
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); ok = true; } catch { ok = false; }
  results.push({ name, ok });
}

// ── Firestore: lo que la app hace y debe seguir funcionando ──
await check('Sin cuenta se lee una historia publicada', true, () => getDoc(doc(anon.firestore(), 'stories/s1')));
await check('Sin cuenta NO se lee un borrador', false, () => getDoc(doc(anon.firestore(), 'stories/draft')));
await check('Notificación de "me gusta" normal', true, () => setDoc(doc(fan.firestore(), 'users/author/notifications/n1'), notif()));
await check('Notificación de seguidor (sí le sigue)', true, () => setDoc(doc(fan.firestore(), 'users/author/notifications/n2'), notifNoStory({ type: "follow", title: 'Nuevo seguidor', body: 'Fan ha empezado a seguirte.' })).catch(e => { throw e; }));
await check('Notificación de comentario normal', true, () => setDoc(doc(fan.firestore(), 'users/author/notifications/n3'), notif({ type: 'comment', title: 'Nuevo comentario en "Historia"', body: 'Fan: ¡Me encanta!' })));
await check('Aviso de moderación (moderador)', true, () => setDoc(doc(mod.firestore(), 'users/author/notifications/n4'), notif({ type: 'admin', fromUid: 'mod', title: 'Tu novela ha sido eliminada', body: 'Motivo: …' })));
await check('Comentario normal', true, () => addDoc(collection(fan.firestore(), 'stories/s1/comments'), comment()));
await check('Denuncia normal', true, () => setDoc(doc(fan.firestore(), 'reports/story_s1_fan'), report()));
await check('El autor lee sus notificaciones', true, () => getDoc(doc(author.firestore(), 'users/author/notifications/n1')));

// ── Firestore: abusos que deberían bloquearse ──
await check('ABUSO: notificación "me gusta" falsa de una historia ajena', false, () => setDoc(doc(stranger.firestore(), 'users/author/notifications/x1'), notif({ fromUid: 'stranger', storyId: 'other' })));
await check('ABUSO: notificación sin historia (texto libre de phishing)', false, () => setDoc(doc(stranger.firestore(), 'users/author/notifications/x2'), notifNoStory({ fromUid: "stranger", title: 'Tu cuenta será borrada', body: 'Entra en http://phishing.example' })));
await check('ABUSO: notificación con campo extra (enlace)', false, () => setDoc(doc(fan.firestore(), 'users/author/notifications/x3'), notif({ link: 'http://phishing.example' })));
await check('ABUSO: notificación con texto enorme', false, () => setDoc(doc(fan.firestore(), 'users/author/notifications/x4'), notif({ body: 'x'.repeat(5000) })));
await check('ABUSO: "nuevo seguidor" sin seguirle', false, () => setDoc(doc(stranger.firestore(), 'users/author/notifications/x5'), notifNoStory({ type: "follow", fromUid: "stranger" })));
await check('ABUSO: aviso de moderación sin ser moderador', false, () => setDoc(doc(fan.firestore(), 'users/author/notifications/x6'), notif({ type: 'admin' })));
await check('ABUSO: comentario con campo extra', false, () => addDoc(collection(fan.firestore(), 'stories/s1/comments'), comment({ isStaff: true })));
await check('ABUSO: comentario con nombre enorme', false, () => addDoc(collection(fan.firestore(), 'stories/s1/comments'), comment({ userName: 'x'.repeat(500) })));
await check('ABUSO: comentario en nombre de otro', false, () => addDoc(collection(fan.firestore(), 'stories/s1/comments'), comment({ uid: 'author' })));
await check('ABUSO: denuncia con texto enorme', false, () => setDoc(doc(fan.firestore(), 'reports/story_other_fan'), report({ storyId: 'other', details: 'x'.repeat(5000) })));
await check('ABUSO: leer los datos privados de otro usuario', false, () => getDoc(doc(fan.firestore(), 'users/author')));
await check('ABUSO: darse permisos de administrador', false, () => setDoc(doc(fan.firestore(), 'users/fan'), { role: 'admin', permissions: ['deleteStories'] }));
await check('ABUSO: inflar los "me gusta" sin dar me gusta', false, () => setDoc(doc(fan.firestore(), 'stories/s1'), { uid: 'author', published: true, title: 'Historia', likeCount: 999 }));

// ── Insignia de fundador ──
await check('El dueño da la insignia de fundador', true, () => setDoc(doc(boss.firestore(), 'founders/author'), { since: now }));
await check('Cualquiera ve quién es fundador', true, () => getDoc(doc(anon.firestore(), 'founders/author')));
await check('ABUSO: darse a sí mismo la insignia', false, () => setDoc(doc(fan.firestore(), 'founders/fan'), { since: now }));
await check('ABUSO: un admin da la insignia (solo el dueño)', false, () => setDoc(doc(mod.firestore(), 'founders/fan'), { since: now }));

// ── Storage ──
const st = c => c.storage();
const bytes = new Uint8Array([1, 2, 3, 4]);
await check('Portada en WebP (su dueño)', true, () => uploadBytes(ref(st(author), 'covers/author/c.webp'), bytes, { contentType: 'image/webp' }));
await check('Fondo de página (autor de la historia)', true, () => uploadBytes(ref(st(author), 'pages/s1/c1/f.jpg'), bytes, { contentType: 'image/jpeg' }));
await check('Música MP3 (autor)', true, () => uploadBytes(ref(st(author), 'music/s1/c1/m.mp3'), bytes, { contentType: 'audio/mpeg' }));
await check('Efecto de sonido OGG (autor)', true, () => uploadBytes(ref(st(author), 'sfx/s1/c1/s.ogg'), bytes, { contentType: 'audio/ogg' }));
await check('Cualquiera descarga un archivo público', true, () => getBytes(ref(st(anon), 'covers/author/old.webp')));
await check('ABUSO: subir un fondo a la historia de otro', false, () => uploadBytes(ref(st(stranger), 'pages/s1/c1/x.jpg'), bytes, { contentType: 'image/jpeg' }));
await check('ABUSO: subir una página web como portada', false, () => uploadBytes(ref(st(author), 'covers/author/x.html'), bytes, { contentType: 'text/html' }));
await check('ABUSO: subir un ejecutable como música', false, () => uploadBytes(ref(st(author), 'music/s1/c1/x.exe'), bytes, { contentType: 'application/octet-stream' }));
await check('ABUSO: subir un SVG (puede llevar código) como fondo', false, () => uploadBytes(ref(st(author), 'pages/s1/c1/x.svg'), bytes, { contentType: 'image/svg+xml' }));

for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.name}`);
console.log(`\n${results.filter(r => r.ok).length}/${results.length} como se espera`);
await env.cleanup();
