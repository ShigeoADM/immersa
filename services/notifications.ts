// ─── Sistema de notificaciones ────────────────────────────────────────────────
//
// Sin servidor: cada móvil sincroniza SUS propias notificaciones.
//   · Al abrir la app, al volver a ella y en segundo plano (cada ≥15 min, cuando el
//     sistema lo permita) se ejecuta syncNotifications().
//   · Todas las notificaciones viven en users/{uid}/notifications/{id}.
//   · Las nuevas desde la última sincronización se muestran como notificación nativa.
//
// Fuentes:
//   · Historias borradas: lápidas en deletedStories/{storyId} (services/stories.ts).
//   · Noticias / avisos de administración: colección global announcements/{id},
//     que se crea desde la consola de Firebase con { title, body, createdAt, type }.
//   · Capítulo nuevo: al publicar un capítulo la historia apunta la fecha
//     (lastChapterAt); cada lector la compara con la última que vio.
//   · Historia nueva de un autor seguido: se consultan sus historias publicadas.
//   · Likes, comentarios y seguidores: los escribe el móvil de quien los hace en las
//     notificaciones del destinatario (las reglas solo lo permiten para esos tipos).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  setDoc, updateDoc, where, writeBatch, type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';

export type NotificationType =
  | 'story_deleted' | 'chapter' | 'new_story'   // sobre historias que sigues
  | 'like' | 'comment' | 'reply' | 'follow'     // de otros usuarios hacia ti
  | 'news' | 'admin';                           // del equipo

// Plantilla (en español, con {huecos}) de los avisos que escribe la app: la pantalla de
// notificaciones la traduce al idioma de quien lo lee. title/body quedan como respaldo.
export type NotificationTx = { title?: string; body?: string; p?: Record<string, string | number> };

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string; // ISO
  read: boolean;
  storyId?: string;
  fromUid?: string;
  tx?: NotificationTx;
}

export const BACKGROUND_SYNC_TASK = 'immersa-notifications-sync';

const lastShownKey = (uid: string) => `notifications:lastShownAt:${uid}`;
const lastNewsKey  = (uid: string) => `notifications:lastNewsAt:${uid}`;

const notificationsCol = (uid: string) => collection(db, 'users', uid, 'notifications');

// En web no hay notificaciones del sistema ni tareas en segundo plano: la lista de
// notificaciones dentro de la app funciona igual, pero no se avisa fuera de ella.
const IS_WEB = Platform.OS === 'web';

// Cómo se muestran las notificaciones con la app abierta
if (!IS_WEB) Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ── Permisos y canal ─────────────────────────────────────────────────────────
export async function setupNotificationPermissions(): Promise<boolean> {
  if (IS_WEB) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#00C878',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// ── Capítulo nuevo ───────────────────────────────────────────────────────────
// La historia guarda cuándo se publicó su último capítulo (lastChapterAt). Si es
// posterior a lo último que este lector vio, se le avisa. Devuelve true si creó aviso.
async function notifyNewChapter(
  uid: string, entryRef: DocumentReference, entry: any, storyId: string, story: any,
): Promise<boolean> {
  const latest: string | undefined = story.lastChapterAt;
  if (!latest || story.uid === uid || !(entry.isReading || entry.isInterested)) return false;

  // Sin referencia previa se usa la última lectura o cuándo se guardó la historia
  const seen: string = entry.notifiedChapterAt ?? entry.lastReadAt ?? entry.addedAt ?? latest;
  if (latest <= seen) {
    if (!entry.notifiedChapterAt) await updateDoc(entryRef, { notifiedChapterAt: latest });
    return false;
  }

  const chapterTitle = story.lastChapterTitle ? `: ${story.lastChapterTitle}` : '';
  await setDoc(doc(db, 'users', uid, 'notifications', `chapter_${storyId}_${latest}`), {
    type: 'chapter',
    title: 'Nuevo capítulo',
    body: `"${story.title ?? entry.title ?? ''}" tiene un capítulo nuevo${chapterTitle}.`,
    tx: {
      title: 'Nuevo capítulo',
      body: story.lastChapterTitle ? '"{story}" tiene un capítulo nuevo: {chapter}.' : '"{story}" tiene un capítulo nuevo.',
      p: { story: story.title ?? entry.title ?? '', chapter: story.lastChapterTitle ?? '' },
    },
    createdAt: new Date().toISOString(),
    read: false,
    storyId,
  });
  await updateDoc(entryRef, { notifiedChapterAt: latest });
  return true;
}

// ── Historias nuevas de autores seguidos ─────────────────────────────────────
// Como mucho cada 30 min: una consulta por autor seguido.
const FOLLOWING_CHECK_MS = 30 * 60 * 1000;
const followingCheckKey = (uid: string) => `notifications:followingCheckAt:${uid}`;

async function syncFollowing(uid: string): Promise<number> {
  const key = followingCheckKey(uid);
  const last = Number(await AsyncStorage.getItem(key)) || 0;
  if (Date.now() - last < FOLLOWING_CHECK_MS) return 0;
  await AsyncStorage.setItem(key, String(Date.now()));

  const followingSnap = await getDocs(collection(db, 'users', uid, 'following'));
  let created = 0;
  await Promise.all(followingSnap.docs.map(async f => {
    const authorUid = f.id;
    const since: string = f.data().lastNotifiedAt ?? f.data().createdAt ?? '';
    try {
      const storiesSnap = await getDocs(query(
        collection(db, 'stories'), where('uid', '==', authorUid), where('published', '==', true),
      ));
      const fresh = storiesSnap.docs.filter(s => (s.data().publishedAt ?? '') > since);
      if (fresh.length === 0) return;
      for (const s of fresh) {
        const d = s.data();
        await setDoc(doc(db, 'users', uid, 'notifications', `new_story_${s.id}`), {
          type: 'new_story',
          title: 'Nueva historia',
          body: `${d.authorName ?? 'Un autor que sigues'} ha publicado "${d.title ?? ''}".`,
          tx: {
            title: 'Nueva historia',
            body: d.authorName ? '{author} ha publicado "{story}".' : 'Un autor que sigues ha publicado "{story}".',
            p: { author: d.authorName ?? '', story: d.title ?? '' },
          },
          createdAt: new Date().toISOString(),
          read: false,
          storyId: s.id,
          fromUid: authorUid,
        });
        created++;
      }
      await updateDoc(f.ref, { lastNotifiedAt: new Date().toISOString() });
    } catch { /* sin red o sin permiso: se reintenta en la próxima comprobación */ }
  }));
  return created;
}

// ── Historias borradas ───────────────────────────────────────────────────────
// Quita de la biblioteca las historias que ya no existen y crea el aviso
// correspondiente si estaban en "Seguir leyendo" o "Leer más tarde".
async function cleanupDeletedStoriesImpl(uid: string): Promise<number> {
  const librarySnap = await getDocs(collection(db, 'users', uid, 'library'));
  let created = 0;

  await Promise.all(librarySnap.docs.map(async entry => {
    const storyId = entry.id;
    const e = entry.data();
    try {
      const storySnap = await getDoc(doc(db, 'stories', storyId));
      if (storySnap.exists()) {
        if (await notifyNewChapter(uid, entry.ref, e, storyId, storySnap.data())) created++;
        return;
      }
    } catch {
      return; // sin red o sin permiso: no tocar nada
    }

    let title: string = e.title ?? '';
    let deletedBy: 'author' | 'admin' | null = null;
    try {
      const tomb = await getDoc(doc(db, 'deletedStories', storyId));
      if (tomb.exists()) {
        const t = tomb.data();
        title = t.title || title;
        deletedBy = t.deletedBy === 'admin' ? 'admin' : 'author';
      }
    } catch { /* sin lápida (historias borradas antes de existir este sistema) */ }

    if (e.isReading || e.isInterested) {
      const where_ = e.isReading ? 'que estabas leyendo' : 'que tenías guardada';
      const by = deletedBy === 'admin' ? ' por un administrador'
               : deletedBy === 'author' ? ' por el autor'
               : '';
      // id determinista: si se ejecuta dos veces no se duplica el aviso
      const ref = doc(db, 'users', uid, 'notifications', `story_deleted_${storyId}`);
      if (!(await getDoc(ref)).exists()) {
        await setDoc(ref, {
          type: 'story_deleted',
          title: 'Novela eliminada',
          body: `La novela "${title}" ${where_} ha sido eliminada${by}.`,
          tx: { title: 'Novela eliminada', body: `La novela "{story}" ${where_} ha sido eliminada${by}.`, p: { story: title } },
          createdAt: new Date().toISOString(),
          read: false,
          storyId,
        });
        created++;
      }
    }
    await deleteDoc(entry.ref);
  }));

  return created;
}

// La biblioteca y la sincronización pueden pedir la limpieza a la vez: se comparte.
const cleanupInFlight = new Map<string, Promise<number>>();
export function cleanupDeletedStories(uid: string): Promise<number> {
  let p = cleanupInFlight.get(uid);
  if (!p) {
    p = cleanupDeletedStoriesImpl(uid).finally(() => cleanupInFlight.delete(uid));
    cleanupInFlight.set(uid, p);
  }
  return p;
}

// ── Noticias y avisos de administración ──────────────────────────────────────
// Copia a las notificaciones del usuario los anuncios publicados desde la última vez.
async function syncAnnouncements(uid: string): Promise<number> {
  const key = lastNewsKey(uid);
  const last = await AsyncStorage.getItem(key);
  if (!last) {
    // Primera vez en este móvil: no inundar con anuncios antiguos
    await AsyncStorage.setItem(key, new Date().toISOString());
    return 0;
  }
  const snap = await getDocs(query(
    collection(db, 'announcements'),
    where('createdAt', '>', last),
    orderBy('createdAt', 'asc'),
    limit(20),
  ));
  for (const a of snap.docs) {
    const d = a.data();
    await setDoc(doc(db, 'users', uid, 'notifications', `announcement_${a.id}`), {
      type: d.type === 'admin' ? 'admin' : 'news',
      title: d.title ?? 'Novedades',
      body: d.body ?? '',
      createdAt: new Date().toISOString(),
      publishedAt: d.createdAt,
      read: false,
    });
  }
  if (!snap.empty) {
    await AsyncStorage.setItem(key, snap.docs[snap.docs.length - 1].data().createdAt);
  }
  return snap.size;
}

// ── Notificaciones nativas ───────────────────────────────────────────────────
// Muestra en la barra del móvil las notificaciones creadas desde la última vez.
async function showNewNativeNotifications(uid: string): Promise<void> {
  const key = lastShownKey(uid);
  const last = await AsyncStorage.getItem(key);
  if (!last) return;

  const snap = await getDocs(query(
    notificationsCol(uid),
    where('createdAt', '>', last),
    orderBy('createdAt', 'asc'),
    limit(10),
  ));
  if (snap.empty) return;

  const granted = !IS_WEB && (await Notifications.getPermissionsAsync()).granted;
  if (granted) {
    for (const n of snap.docs) {
      const d = n.data();
      if (d.read) continue;
      await Notifications.scheduleNotificationAsync({
        content: { title: d.title, body: d.body, data: { notificationId: n.id } },
        trigger: null,
      });
    }
  }
  // Aunque no haya permiso, avanzar el cursor: si lo concede luego, no recibe atrasadas
  await AsyncStorage.setItem(key, snap.docs[snap.docs.length - 1].data().createdAt);
}

// ── Sincronización completa ──────────────────────────────────────────────────
export async function syncNotifications(uid: string): Promise<number> {
  // El cursor de "mostradas" se fija ANTES de crear avisos nuevos, para que los que
  // se generen en esta misma sincronización sí lleguen como notificación nativa.
  const shownKey = lastShownKey(uid);
  if (!(await AsyncStorage.getItem(shownKey))) {
    await AsyncStorage.setItem(shownKey, new Date().toISOString());
  }
  const created =
    (await cleanupDeletedStories(uid)) +
    (await syncAnnouncements(uid)) +
    (await syncFollowing(uid).catch(() => 0));
  await showNewNativeNotifications(uid);
  return created;
}

// ── Segundo plano ────────────────────────────────────────────────────────────
// defineTask debe ejecutarse al cargar el módulo (lo importa app/_layout.tsx).
if (!IS_WEB) TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return BackgroundFetch.BackgroundFetchResult.NoData;
    const created = await syncNotifications(user.uid);
    return created > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  if (IS_WEB) return;
  const status = await BackgroundFetch.getStatusAsync();
  if (status !== BackgroundFetch.BackgroundFetchStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) return;
  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: 15 * 60, // el sistema decide cuándo; este es el mínimo
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

// ── Acciones sobre notificaciones ────────────────────────────────────────────
export const markNotificationRead = (uid: string, id: string) =>
  updateDoc(doc(db, 'users', uid, 'notifications', id), { read: true });

export const deleteNotification = (uid: string, id: string) =>
  deleteDoc(doc(db, 'users', uid, 'notifications', id));

export async function markAllNotificationsRead(uid: string) {
  const snap = await getDocs(query(notificationsCol(uid), where('read', '==', false)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
}

// Para likes y comentarios (cuando existan): avisa al autor desde el móvil de quien
// da like / comenta. Las reglas de Firestore solo permiten crear estos tipos en las
// notificaciones de otro usuario, y con fromUid = quien lo envía.
export async function notifyUser(
  toUid: string,
  n: { type: 'like' | 'comment' | 'reply' | 'follow'; title: string; body: string; storyId?: string; commentId?: string; tx?: NotificationTx },
) {
  const me = auth.currentUser;
  if (!me || me.uid === toUid) return;
  await addDoc(notificationsCol(toUid), {
    ...n,
    fromUid: me.uid,
    createdAt: new Date().toISOString(),
    read: false,
  });
}
