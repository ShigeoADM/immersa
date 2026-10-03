import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc, writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/config/firebase';

export type DeletedBy = 'author' | 'admin';

// ── Recuento de palabras ─────────────────────────────────────────────────────
export const countWords = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

// Tiempo de lectura estimado (≈ 200 palabras por minuto), mínimo 1 min
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 200));

export const formatReadingStats = (words: number) =>
  `${words.toLocaleString('es-ES')} ${words === 1 ? 'palabra' : 'palabras'} · ~${readingMinutes(words)} min`;

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
export async function isBackgroundUsedElsewhere(storyId: string, url: string, exceptPageId: string) {
  const chapters = await getDocs(collection(db, 'stories', storyId, 'chapters'));
  for (const ch of chapters.docs) {
    const pages = await getDocs(collection(db, 'stories', storyId, 'chapters', ch.id, 'pages'));
    if (pages.docs.some(p => p.id !== exceptPageId && p.data().backgroundUrl === url)) return true;
  }
  return false;
}

// Duplica una página justo detrás de la original (con todo su contenido).
export async function duplicatePage(storyId: string, chapterId: string, pageId: string) {
  await migrateChapterRefsToIds(storyId, chapterId);
  const pages = await orderedPages(storyId, chapterId);
  const idx = pages.findIndex(p => p.id === pageId);
  if (idx < 0) throw new Error('La página ya no existe');

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
export async function deleteChapterWithCascade(storyId: string, chapterId: string) {
  const pagesSnap = await getDocs(collection(db, 'stories', storyId, 'chapters', chapterId, 'pages'));
  for (const pg of pagesSnap.docs) {
    await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId, 'pages', pg.id));
  }
  await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId));
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

  const chaptersSnap = await getDocs(collection(db, 'stories', storyId, 'chapters'));
  for (const ch of chaptersSnap.docs) {
    await deleteChapterWithCascade(storyId, ch.id);
  }
  for (const sub of ['comments', 'likes', 'readers', 'saves']) {
    const snap = await getDocs(collection(db, 'stories', storyId, sub));
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  }
  await deleteDoc(doc(db, 'stories', storyId));
}
