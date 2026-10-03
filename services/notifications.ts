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
//   · Likes y comentarios (cuando existan): notifyUser(), que escribe en las
//     notificaciones del destinatario (las reglas solo lo permiten para esos tipos).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query,
  setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';

export type NotificationType = 'story_deleted' | 'like' | 'comment' | 'news' | 'admin';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string; // ISO
  read: boolean;
  storyId?: string;
  fromUid?: string;
}

export const BACKGROUND_SYNC_TASK = 'immersa-notifications-sync';

const lastShownKey = (uid: string) => `notifications:lastShownAt:${uid}`;
const lastNewsKey  = (uid: string) => `notifications:lastNewsAt:${uid}`;

const notificationsCol = (uid: string) => collection(db, 'users', uid, 'notifications');

// Cómo se muestran las notificaciones con la app abierta
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ── Permisos y canal ─────────────────────────────────────────────────────────
export async function setupNotificationPermissions(): Promise<boolean> {
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

// ── Historias borradas ───────────────────────────────────────────────────────
// Quita de la biblioteca las historias que ya no existen y crea el aviso
// correspondiente si estaban en "Seguir leyendo" o "Leer más tarde".
async function cleanupDeletedStoriesImpl(uid: string): Promise<number> {
  const librarySnap = await getDocs(collection(db, 'users', uid, 'library'));
  let created = 0;

  await Promise.all(librarySnap.docs.map(async entry => {
    const storyId = entry.id;
    try {
      if ((await getDoc(doc(db, 'stories', storyId))).exists()) return;
    } catch {
      return; // sin red o sin permiso: no tocar nada
    }

    const e = entry.data();
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

  const { granted } = await Notifications.getPermissionsAsync();
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
    (await syncAnnouncements(uid));
  await showNewNativeNotifications(uid);
  return created;
}

// ── Segundo plano ────────────────────────────────────────────────────────────
// defineTask debe ejecutarse al cargar el módulo (lo importa app/_layout.tsx).
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
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
  n: { type: 'like' | 'comment'; title: string; body: string; storyId?: string },
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
