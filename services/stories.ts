import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc, writeBatch,
  addDoc, where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { belongsToStory, deleteStoredFile, isStoredFile } from '@/services/media';
import { formatNumber, t, ts } from '@/i18n';

export type DeletedBy = 'author' | 'admin';

// ── Recuento de palabras ─────────────────────────────────────────────────────
export const countWords = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

// Tiempo de lectura estimado (≈ 200 palabras por minuto), mínimo 1 min
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 200));

export const formatReadingStats = (words: number) =>
  t(words === 1 ? 'stats.wordsOne' : 'stats.wordsMany', { n: formatNumber(words), m: readingMinutes(words) });

// ── Orden ────────────────────────────────────────────────────────────────────

// Capítulos: por 'order' (se asigna al reordenar o crear); los antiguos sin 'order'
// quedan al final, por fecha de creación.
export function sortChapters<T extends { order?: number; createdAt?: string }>(chapters: T[]): T[] {
  return [...chapters].sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  });
}

// Guarda 'order' = 1..n según la posición en la lista. Solo escribe los que cambian.
export async function saveOrder(collectionPath: string, items: { id: string; order?: number }[]) {
  const batch = writeBatch(db);
  let changed = 0;
  items.forEach((item, i) => {
    if (item.order !== i + 1) {
      batch.update(doc(db, collectionPath, item.id), { order: i + 1 });
      changed++;
    }
  });
  if (changed > 0) await batch.commit();
}

const pagesPath = (storyId: string, chapterId: string) =>
  `stories/${storyId}/chapters/${chapterId}/pages`;

async function orderedPages(storyId: string, chapterId: string): Promise<QueryDocumentSnapshot[]> {
  const snap = await getDocs(query(collection(db, pagesPath(storyId, chapterId)), orderBy('order', 'asc')));
  return snap.docs;
}

// ── Referencias entre páginas ────────────────────────────────────────────────
// Los enlaces y "Al pasar la página" se guardaban por número de página, que cambia al
// reordenar, duplicar o borrar. Ahora se guardan por id (targetPageId / nextPageId).
// Antes de cualquier operación que cambie el orden, se convierten las referencias
// antiguas de este capítulo a ids (mientras los números aún apuntan bien).
export async function migrateChapterRefsToIds(storyId: string, chapterId: string) {
  const pages = await orderedPages(storyId, chapterId);
  const idsByChapter = new Map<string, string[]>([[chapterId, pages.map(p => p.id)]]);
  const idsOf = async (chId: string) => {
    if (!idsByChapter.has(chId)) {
      idsByChapter.set(chId, (await orderedPages(storyId, chId)).map(p => p.id));
    }
    return idsByChapter.get(chId)!;
  };

  const batch = writeBatch(db);
  let changed = 0;
  for (const p of pages) {
    const d = p.data();
    const update: Record<string, any> = {};

    const links: any[] = Array.isArray(d.links) ? d.links : [];
    if (links.some(l => !l.targetPageId && typeof l.targetPageIndex === 'number')) {
      update.links = await Promise.all(links.map(async l => {
        if (l.targetPageId || typeof l.targetPageIndex !== 'number') return l;
        const id = (await idsOf(l.targetChapterId ?? chapterId))[l.targetPageIndex];
        return id ? { ...l, targetPageId: id } : l;
      }));
    }
    if (typeof d.nextPageIndex === 'number' && !d.nextPageId) {
      const id = pages[d.nextPageIndex]?.id;
      if (id) { update.nextPageId = id; update.nextPageIndex = deleteField(); }
    }

    if (Object.keys(update).length > 0) { batch.update(p.ref, update); changed++; }
  }
  if (changed > 0) await batch.commit();
}

// ¿Usa esta imagen de fondo alguna otra página de la historia? Los fondos se pueden
// reutilizar entre páginas ("Ya subidos" o al duplicar), así que antes de borrar el
// archivo de Storage hay que comprobar que nadie más lo necesita.
// ── Archivos de las páginas (fondos, música, efectos) ────────────────────────
// Un mismo archivo puede estar en varias páginas: al elegirlo en "Ya subidos" o al
// duplicar una página se reutiliza, no se sube otra vez. Por eso un archivo solo se
// borra del almacenamiento cuando ya no lo usa NINGUNA página de la historia.

// Archivos que usa una página
export function pageMediaUrls(page: any): string[] {
  if (!page) return [];
  const urls: unknown[] = [
    page.backgroundUrl,
    page.musicUrl,
    page.sfxUrl,
    ...(Array.isArray(page.sfxCues) ? page.sfxCues.map((c: any) => c?.url) : []),
  ];
  return urls.filter((u): u is string => typeof u === 'string' && !!u);
}

// Archivos propios de un capítulo: su ilustración y la música de su transición
export function chapterMediaUrls(chapter: any): string[] {
  if (!chapter) return [];
  return [chapter.coverUrl, chapter.introMusicUrl].filter((u): u is string => typeof u === 'string' && !!u);
}

// Todos los archivos que usan las páginas de la historia (menos las indicadas)
async function mediaInUse(storyId: string, exceptPageIds: string[] = []): Promise<Set<string>> {
  const used = new Set<string>();
  const chapters = await getDocs(collection(db, 'stories', storyId, 'chapters'));
  for (const ch of chapters.docs) {
    chapterMediaUrls(ch.data()).forEach(u => used.add(u));
    const pages = await getDocs(collection(db, 'stories', storyId, 'chapters', ch.id, 'pages'));
    pages.docs.forEach(p => {
      if (!exceptPageIds.includes(p.id)) pageMediaUrls(p.data()).forEach(u => used.add(u));
    });
  }
  return used;
}

// Borra del almacenamiento los archivos de la lista que ya no usa ninguna página.
// `exceptPageIds`: páginas que no cuentan (la que se está borrando, por ejemplo).
// Nunca lanza: si algo falla, el archivo se queda y ya está.
export async function deleteUnusedMedia(storyId: string, urls: Iterable<string>, exceptPageIds: string[] = []) {
  // Solo los de esta historia: los de una copia importada pertenecen a la original
  const candidates = [...new Set(urls)].filter(u => belongsToStory(u, storyId));
  if (candidates.length === 0) return;
  try {
    const used = await mediaInUse(storyId, exceptPageIds);
    await Promise.all(candidates.filter(u => !used.has(u)).map(deleteStoredFile));
  } catch (e) {
    console.error('Error limpiando archivos sin usar:', e);
  }
}

export async function isBackgroundUsedElsewhere(storyId: string, url: string, exceptPageId: string) {
  return (await mediaInUse(storyId, [exceptPageId])).has(url);
}

// Duplica una página justo detrás de la original (con todo su contenido).
export async function duplicatePage(storyId: string, chapterId: string, pageId: string) {
  await migrateChapterRefsToIds(storyId, chapterId);
  const pages = await orderedPages(storyId, chapterId);
  const idx = pages.findIndex(p => p.id === pageId);
  if (idx < 0) throw new Error(ts('La página ya no existe'));

  const batch = writeBatch(db);
  const copyRef = doc(collection(db, pagesPath(storyId, chapterId)));
  batch.set(copyRef, { ...pages[idx].data(), order: idx + 2, createdAt: new Date().toISOString() });
  // Renumerar: las de detrás de la original se desplazan una posición
  pages.forEach((p, i) => {
    const want = i <= idx ? i + 1 : i + 2;
    if (p.data().order !== want) batch.update(p.ref, { order: want });
  });
  await batch.commit();
}

// Borra capítulo + todas sus páginas
export async function deleteChapterWithCascade(storyId: string, chapterId: string, cleanMedia = true) {
  const pagesSnap = await getDocs(collection(db, 'stories', storyId, 'chapters', chapterId, 'pages'));
  const media = pagesSnap.docs.flatMap(pg => pageMediaUrls(pg.data()));
  if (cleanMedia) {
    try {
      media.push(...chapterMediaUrls((await getDoc(doc(db, 'stories', storyId, 'chapters', chapterId))).data()));
    } catch { /* sin su ilustración: se quedará en el almacenamiento */ }
  }
  for (const pg of pagesSnap.docs) {
    await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId, 'pages', pg.id));
  }
  // Los "me gusta" del capítulo (si fallara, no impide borrar el capítulo)
  try {
    const likesSnap = await getDocs(collection(db, 'stories', storyId, 'chapters', chapterId, 'likes'));
    for (const like of likesSnap.docs) await deleteDoc(like.ref);
  } catch (e) {
    console.error('Error borrando los me gusta del capítulo:', e);
  }
  await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId));
  // Los archivos de sus páginas que no use ningún otro capítulo
  if (cleanMedia) await deleteUnusedMedia(storyId, media);
}

// Borra historia + todos sus capítulos + todas sus páginas.
// Antes deja una "lápida" en deletedStories/{storyId} con el título y quién la borró:
// cuando cada lector abre la app, la suya la usa para avisarle y limpiar su biblioteca
// (ver services/notifications.ts). Así no hace falta un servidor que avise a todos.
export async function deleteStoryWithCascade(storyId: string, deletedBy: DeletedBy = 'author') {
  const storySnap = await getDoc(doc(db, 'stories', storyId));
  await setDoc(doc(db, 'deletedStories', storyId), {
    title: storySnap.data()?.title ?? '',
    uid: storySnap.data()?.uid ?? null,
    deletedBy,
    deletedAt: new Date().toISOString(),
  });

  // Archivos de la historia (fondos, música, efectos y portada). Se recogen antes de
  // borrar nada y se eliminan mientras la historia aún existe: las reglas del
  // almacenamiento comprueban quién es su autor. Si la borra moderación no hay permiso
  // sobre los archivos y se quedan.
  // Los de una copia importada (que son de la historia original) no se tocan.
  const media: string[] = [];
  const chaptersSnap = await getDocs(collection(db, 'stories', storyId, 'chapters'));
  for (const ch of chaptersSnap.docs) {
    media.push(...chapterMediaUrls(ch.data()));
    const pagesSnap = await getDocs(collection(db, 'stories', storyId, 'chapters', ch.id, 'pages'));
    pagesSnap.docs.forEach(pg => media.push(...pageMediaUrls(pg.data())));
  }
  const files = [...new Set(media)].filter(u => belongsToStory(u, storyId));
  const cover = storySnap.data()?.coverUrl;
  if (isStoredFile(cover) && !(await coverUsedByAnotherStory(storySnap.data()?.uid, cover, storyId))) files.push(cover);
  await Promise.all(files.map(deleteStoredFile));

  for (const ch of chaptersSnap.docs) {
    await deleteChapterWithCascade(storyId, ch.id, false);
  }
  for (const sub of ['comments', 'likes', 'readers', 'saves']) {
    const snap = await getDocs(collection(db, 'stories', storyId, sub));
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  }
  await deleteDoc(doc(db, 'stories', storyId));
}

// ¿Usa esa portada otra historia del mismo autor? (Pasa con las copias importadas.)
// Ante la duda responde que sí: es preferible dejar un archivo de más a borrar uno en uso.
export async function coverUsedByAnotherStory(uid: string | undefined | null, coverUrl: string, exceptStoryId?: string) {
  if (!uid) return true;
  try {
    const snap = await getDocs(query(collection(db, 'stories'), where('uid', '==', uid), where('coverUrl', '==', coverUrl)));
    return snap.docs.some(d => d.id !== exceptStoryId);
  } catch {
    return true;
  }
}

// ── Importar una copia de seguridad ──────────────────────────────────────────
// Crea una historia NUEVA (sin publicar) a partir del archivo que descarga "Exportar".
// No toca la original. Capítulos y páginas conservan sus identificadores, así que los
// enlaces entre páginas siguen funcionando. Las imágenes y audios no se copian: la
// historia nueva apunta a los mismos archivos.
export async function importStory(data: any, uid: string): Promise<{ id: string; title: string; format: string }> {
  if (!data || data.app !== 'Immersa' || typeof data.story !== 'object' || !Array.isArray(data.chapters)) {
    throw new Error(ts('Ese archivo no es una copia de seguridad de Immersa.'));
  }
  const now = new Date().toISOString();
  const {
    id: originalId, likeCount: _l, lastLikedChapter: _c, publishedAt: _p, lastChapterAt: _a, lastChapterTitle: _t,
    ...story
  } = data.story;
  // Si la original sigue existiendo, la copia se distingue por el título
  let title = String(story.title ?? 'Sin título');
  try {
    if (originalId && (await getDoc(doc(db, 'stories', String(originalId)))).exists()) title = `${title} (copia)`;
  } catch { /* no es nuestra o no se puede leer: se deja el título */ }
  const format = story.format === 'Webnovel' ? 'Webnovel' : 'Moderno';

  const storyRef = await addDoc(collection(db, 'stories'), {
    ...story, title, format, uid, published: false, createdAt: story.createdAt ?? now, updatedAt: now,
  });

  // Primero los capítulos y después sus páginas, en tandas (Firestore admite 500 por tanda)
  const writes: { path: string[]; data: any }[] = [];
  const pageWrites: { path: string[]; data: any }[] = [];
  data.chapters.forEach((ch: any, ci: number) => {
    if (!ch || typeof ch !== 'object') return;
    const { id, pages, likeCount: _cl, publishedAt: _cp, ...chapter } = ch;
    const chapterId = String(id ?? `cap${ci + 1}`);
    writes.push({ path: ['chapters', chapterId], data: { ...chapter, published: false } });
    (Array.isArray(pages) ? pages : []).forEach((pg: any, pi: number) => {
      if (!pg || typeof pg !== 'object') return;
      const { id: pageId, ...page } = pg;
      pageWrites.push({ path: ['chapters', chapterId, 'pages', String(pageId ?? `pag${pi + 1}`)], data: page });
    });
  });
  for (const list of [writes, pageWrites]) {
    for (let i = 0; i < list.length; i += 400) {
      const batch = writeBatch(db);
      list.slice(i, i + 400).forEach(w => batch.set(doc(db, 'stories', storyRef.id, ...w.path), w.data));
      await batch.commit();
    }
  }
  return { id: storyRef.id, title, format };
}
