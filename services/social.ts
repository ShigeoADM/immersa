// Me gusta en historias y seguir a autores.
//
//   · Me gusta: se dan por CAPÍTULO, no por historia.
//       stories/{storyId}/chapters/{chapterId}/likes/{uid}
//       + contador del capítulo (chapters/{chapterId}.likeCount)
//       + contador de la historia (stories/{storyId}.likeCount), que es el total.
//     Se escriben juntos (batch); las reglas solo aceptan que los contadores cambien de
//     uno en uno y acompañados del propio "me gusta", así no se pueden inflar.
//     Además se apunta en users/{uid}/likedStories/{storyId} (con la lista de capítulos)
//     para poder listar "las historias que me gustan" sin recorrer todas las historias.
//     Las versiones antiguas daban un único me gusta por historia
//     (stories/{storyId}/likes/{uid}); esos siguen contando en el total.
//   · Seguir: users/{uid}/following/{autor} (a quién sigo, para los avisos) y
//     profiles/{autor}/followers/{uid} (quién le sigue, para el contador público).

import {
  arrayRemove, arrayUnion, collection, count as aggCount, deleteDoc, doc, getAggregateFromServer, getCountFromServer, getDoc,
  getDocs, increment, serverTimestamp, setDoc, sum, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { type PublicProfile, getPublicProfile } from '@/services/profiles';

type Me = { uid: string; name: string };

// Aviso a otro usuario con id fijo: como mucho uno por persona y motivo (si ya existe,
// las reglas rechazan sobrescribirlo y se ignora).
async function notifyOnce(toUid: string, id: string, me: Me, n: Record<string, unknown>) {
  if (toUid === me.uid) return;
  try {
    await setDoc(doc(db, 'users', toUid, 'notifications', id), {
      ...n, fromUid: me.uid, createdAt: new Date().toISOString(), read: false,
    });
  } catch { /* ya avisado antes */ }
}

// ── Me gusta por capítulo ────────────────────────────────────────────────────
export async function hasLikedChapter(storyId: string, chapterId: string, uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'stories', storyId, 'chapters', chapterId, 'likes', uid))).exists();
}

// ¿Le ha gustado algún capítulo de esta historia?
export async function hasLikedStory(storyId: string, uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'users', uid, 'likedStories', storyId))).exists();
}

export async function setChapterLike(
  storyId: string, chapterId: string, like: boolean, me: Me,
  story: { authorUid?: string | null; title?: string; coverUrl?: string | null; coverThumbUrl?: string | null; format?: string },
) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const likeRef  = doc(db, 'stories', storyId, 'chapters', chapterId, 'likes', me.uid);
  const likedRef = doc(db, 'users', me.uid, 'likedStories', storyId);
  if (like) {
    batch.set(likeRef, { createdAt: now });
    batch.set(likedRef, {
      storyId, title: story.title ?? '', coverUrl: story.coverUrl ?? null, coverThumbUrl: story.coverThumbUrl ?? null,
      format: story.format ?? '', createdAt: now, chapters: arrayUnion(chapterId),
    }, { merge: true });
  } else {
    batch.delete(likeRef);
    batch.set(likedRef, { chapters: arrayRemove(chapterId) }, { merge: true });
  }
  const delta = increment(like ? 1 : -1);
  batch.update(doc(db, 'stories', storyId, 'chapters', chapterId), { likeCount: delta });
  // lastLikedChapter le dice a las reglas qué "me gusta" acompaña al cambio del total
  batch.update(doc(db, 'stories', storyId), { likeCount: delta, lastLikedChapter: chapterId });
  await batch.commit();

  if (!like) {
    // Si ya no le gusta ningún capítulo, la historia sale de su lista de "me gusta"
    try {
      const left = (await getDoc(likedRef)).data()?.chapters;
      if (!Array.isArray(left) || left.length === 0) await deleteDoc(likedRef);
    } catch { /* se limpiará al listar */ }
  } else if (story.authorUid) {
    notifyOnce(story.authorUid, `like_${storyId}_${chapterId}_${me.uid}`, me, {
      type: 'like',
      title: 'Nuevo me gusta',
      body: `A ${me.name} le gusta un capítulo de "${story.title ?? 'tu novela'}".`,
      tx: { title: 'Nuevo me gusta', body: 'A {name} le gusta un capítulo de "{story}".', p: { name: me.name, story: story.title ?? '' } },
      storyId,
    });
  }
}

// ── Me gusta por historia (formato antiguo; se conserva para poder retirarlos) ──
export async function hasLiked(storyId: string, uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'stories', storyId, 'likes', uid))).exists();
}

export interface LikedStory {
  storyId: string;
  title: string;
  coverUrl: string | null;
  coverThumbUrl?: string | null;
  format: string;
  createdAt: string;
}

export async function setLike(
  storyId: string, like: boolean, me: Me,
  story: { authorUid?: string | null; title?: string; coverUrl?: string | null; coverThumbUrl?: string | null; format?: string },
) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const likeRef  = doc(db, 'stories', storyId, 'likes', me.uid);
  const likedRef = doc(db, 'users', me.uid, 'likedStories', storyId);
  if (like) {
    batch.set(likeRef, { createdAt: now });
    batch.set(likedRef, {
      storyId, title: story.title ?? '', coverUrl: story.coverUrl ?? null, coverThumbUrl: story.coverThumbUrl ?? null,
      format: story.format ?? '', createdAt: now,
    });
  } else {
    batch.delete(likeRef);
    batch.delete(likedRef);
  }
  batch.update(doc(db, 'stories', storyId), { likeCount: increment(like ? 1 : -1) });
  await batch.commit();

  if (like && story.authorUid) {
    notifyOnce(story.authorUid, `like_${storyId}_${me.uid}`, me, {
      type: 'like',
      title: 'Nuevo me gusta',
      body: `A ${me.name} le gusta "${story.title ?? 'tu novela'}".`,
      tx: { title: 'Nuevo me gusta', body: 'A {name} le gusta "{story}".', p: { name: me.name, story: story.title ?? '' } },
      storyId,
    });
  }
}

// ── Seguir autores ───────────────────────────────────────────────────────────
export async function isFollowing(uid: string, authorUid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'users', uid, 'following', authorUid))).exists();
}

export async function getFollowerCount(authorUid: string): Promise<number> {
  return (await getCountFromServer(collection(db, 'profiles', authorUid, 'followers'))).data().count;
}

export async function setFollow(me: Me, authorUid: string, follow: boolean) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const followingRef = doc(db, 'users', me.uid, 'following', authorUid);
  const followerRef  = doc(db, 'profiles', authorUid, 'followers', me.uid);
  if (follow) {
    // lastNotifiedAt: solo se avisará de las historias que publique a partir de ahora
    batch.set(followingRef, { createdAt: now, lastNotifiedAt: now });
    batch.set(followerRef, { createdAt: now });
  } else {
    batch.delete(followingRef);
    batch.delete(followerRef);
  }
  await batch.commit();

  if (follow) {
    notifyOnce(authorUid, `follow_${me.uid}`, me, {
      type: 'follow',
      title: 'Nuevo seguidor',
      body: `${me.name} ha empezado a seguirte.`,
      tx: { title: 'Nuevo seguidor', body: '{name} ha empezado a seguirte.', p: { name: me.name } },
    });
  }
}

// ── Listas del propio usuario ────────────────────────────────────────────────
export const getFollowingCount = async (uid: string) =>
  (await getCountFromServer(collection(db, 'users', uid, 'following'))).data().count;

export const getLikedCount = async (uid: string) =>
  (await getCountFromServer(collection(db, 'users', uid, 'likedStories'))).data().count;

// Autores que sigo, con su perfil público (más recientes primero)
export async function listFollowing(uid: string): Promise<PublicProfile[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'following'));
  const docs = [...snap.docs].sort((a, b) => (b.data().createdAt ?? '').localeCompare(a.data().createdAt ?? ''));
  return Promise.all(docs.map(async d =>
    (await getPublicProfile(d.id).catch(() => null))
      ?? { uid: d.id, displayName: 'Usuario', avatarUrl: '', bio: '', role: null, email: null }
  ));
}

// Historias que me gustan (más recientes primero). Las que ya no existen se quitan.
export async function listLikedStories(uid: string): Promise<LikedStory[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'likedStories'));
  const alive = await Promise.all(snap.docs.map(async d => {
    try {
      if (!(await getDoc(doc(db, 'stories', d.id))).exists()) {
        await deleteDoc(d.ref);
        return null;
      }
    } catch { /* sin permiso (p. ej. despublicada) o sin red: se conserva */ }
    return { ...(d.data() as LikedStory), storyId: d.id };
  }));
  return alive
    .filter((s): s is LikedStory => s !== null)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

// ── Estadísticas de una historia (para su autor) ─────────────────────────────
// La biblioteca de cada usuario es privada, así que no se puede contar desde ahí.
// Cada lector tiene una ficha mínima en la historia:
//   stories/{id}/readers/{uid} → { views, lastAt }   lecturas y cuándo salió de leer
//   stories/{id}/saves/{uid}                          la tiene en "Leer más tarde"
// Solo las ven el autor y moderación, y en la app salen como recuento.
//
// Lecturas: releer cuenta, pero con tope para que no se inflen entrando y saliendo:
//   · la primera vez cuenta siempre;
//   · después, solo si han pasado 10 minutos desde que salió de la lectura;
//   · el autor cuenta una única vez en su propia historia.
// Las reglas de Firestore imponen lo mismo con la hora del servidor.
export const VIEW_COOLDOWN_MS = 10 * 60 * 1000;
const readingNow = new Set<string>(); // historias con una sesión de lectura abierta

const readerRef = (storyId: string, uid: string) => doc(db, 'stories', storyId, 'readers', uid);

// Al entrar a leer. Se puede llamar varias veces en la misma sesión: solo actúa la primera.
export async function enterReading(storyId: string, uid: string, authorUid?: string | null) {
  if (readingNow.has(storyId)) return;
  readingNow.add(storyId);
  try {
    const ref = readerRef(storyId, uid);
    const snap = await getDoc(ref);
    const d = snap.data();
    if (!snap.exists() || typeof d?.views !== 'number') {
      await setDoc(ref, { views: 1, lastAt: serverTimestamp() }); // primera lectura
    } else if (uid !== authorUid && Date.now() - (d.lastAt?.toMillis?.() ?? 0) >= VIEW_COOLDOWN_MS) {
      await updateDoc(ref, { views: increment(1), lastAt: serverTimestamp() });
    }
  } catch { /* la estadística no debe estorbar la lectura */ }
}

// Al salir de leer (o pasar la app a segundo plano): apunta la hora, desde la que
// empiezan a contar los 10 minutos. `endSession` cierra la sesión de lectura.
export async function leaveReading(storyId: string, uid: string, endSession = true) {
  if (endSession) readingNow.delete(storyId);
  try {
    await updateDoc(readerRef(storyId, uid), { lastAt: serverTimestamp() });
  } catch { /* aún no tiene ficha de lector, o sin red */ }
}

export async function setSaved(storyId: string, uid: string, saved: boolean) {
  const ref = doc(db, 'stories', storyId, 'saves', uid);
  try {
    if (saved) await setDoc(ref, { at: new Date().toISOString() });
    else await deleteDoc(ref);
  } catch { /* la estadística no debe impedir guardar la historia */ }
}

export interface StoryStats { views: number; readers: number; saves: number; comments: number }

export async function getStoryStats(storyId: string): Promise<StoryStats> {
  const count = async (sub: string) =>
    (await getCountFromServer(collection(db, 'stories', storyId, sub))).data().count;
  // Lecturas = suma de las de cada lector; lectores = cuántas personas distintas
  const [reading, saves, comments] = await Promise.all([
    getAggregateFromServer(collection(db, 'stories', storyId, 'readers'), {
      readers: aggCount(), views: sum('views'),
    }),
    count('saves'),
    count('comments'),
  ]);
  return { views: reading.data().views ?? 0, readers: reading.data().readers, saves, comments };
}
