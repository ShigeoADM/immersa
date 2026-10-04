// Operaciones de administración. La app solo las ofrece a quien tiene el permiso
// (constants/permissions.ts), pero quien las autoriza de verdad son las reglas de
// Firestore (firestore.rules).

import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  limit, orderBy, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { type Permission, type Role } from '@/constants/permissions';
import { deleteStoryWithCascade } from '@/services/stories';

export type AnnouncementType = 'news' | 'admin';

export interface Announcement {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  createdAt: string;
}

export interface AdminUser {
  uid: string;
  name: string;
  email: string;
  role: Role | null;
  permissions: Permission[];
}

const toAdminUser = (uid: string, d: any): AdminUser => {
  const role: Role | null = d?.role === 'owner' || d?.role === 'admin' ? d.role : null;
  return {
    uid,
    name: d?.displayName || d?.username || 'Sin nombre',
    email: d?.email ?? '',
    role,
    permissions: role && Array.isArray(d?.permissions) ? d.permissions : [],
  };
};

// ── Noticias y avisos ────────────────────────────────────────────────────────
// Cada móvil los convierte en notificación al sincronizar (services/notifications.ts).
export async function publishAnnouncement(type: AnnouncementType, title: string, body: string) {
  await addDoc(collection(db, 'announcements'), {
    type,
    title: title.trim(),
    body: body.trim(),
    createdAt: new Date().toISOString(),
    authorUid: auth.currentUser?.uid ?? null,
  });
}

export async function listAnnouncements(max = 10): Promise<Announcement[]> {
  const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) }));
}

// Quita el aviso para quien aún no lo haya recibido (no lo borra de quien ya lo tiene)
export const deleteAnnouncement = (id: string) => deleteDoc(doc(db, 'announcements', id));

// ── Administradores ──────────────────────────────────────────────────────────
// Dueño primero, después los administradores por nombre
export async function listStaff(): Promise<AdminUser[]> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['owner', 'admin'])));
  return snap.docs
    .map(d => toAdminUser(d.id, d.data()))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1));
}

export async function findUserByEmail(email: string): Promise<AdminUser | null> {
  const wanted = email.trim();
  for (const candidate of [wanted, wanted.toLowerCase()]) {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', candidate), limit(1)));
    if (!snap.empty) return toAdminUser(snap.docs[0].id, snap.docs[0].data());
  }
  return null;
}

// Nombra administrador (sin permisos: se conceden después, uno a uno)
export const addAdmin = (uid: string) =>
  updateDoc(doc(db, 'users', uid), { role: 'admin', permissions: [] });

export const removeAdmin = (uid: string) =>
  updateDoc(doc(db, 'users', uid), { role: deleteField(), permissions: deleteField() });

export const setAdminPermission = (uid: string, permission: Permission, granted: boolean) =>
  updateDoc(doc(db, 'users', uid), {
    permissions: granted ? arrayUnion(permission) : arrayRemove(permission),
  });

// ── Moderación ───────────────────────────────────────────────────────────────
// Elimina una historia como administrador. Los lectores reciben el aviso de
// "eliminada por un administrador" (lápida) y el autor una notificación con el motivo.
// ── Lápidas de historias borradas ────────────────────────────────────────────
// Sirven para avisar a los lectores que tenían la historia guardada (ver
// services/notifications.ts). Pasado un tiempo ya han abierto la app y recibido el
// aviso, así que las antiguas se borran. Lo hace quien modera, al abrir el panel.
export const TOMBSTONE_MAX_DAYS = 60;

export async function purgeOldTombstones(): Promise<number> {
  // Un día de margen sobre la regla de Firestore, que compara solo por fecha
  const cutoff = new Date(Date.now() - (TOMBSTONE_MAX_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
  const snap = await getDocs(query(
    collection(db, 'deletedStories'), where('deletedAt', '<', cutoff), limit(200),
  ));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  return snap.size;
}

export async function adminDeleteStory(storyId: string, reason: string) {
  const snap = await getDoc(doc(db, 'stories', storyId));
  if (!snap.exists()) return;
  const { title, uid: authorUid } = snap.data() as { title?: string; uid?: string };

  await deleteStoryWithCascade(storyId, 'admin');

  if (authorUid && authorUid !== auth.currentUser?.uid) {
    const motive = reason.trim() ? ` Motivo: ${reason.trim()}` : '';
    await setDoc(doc(db, 'users', authorUid, 'notifications', `story_removed_${storyId}`), {
      type: 'admin',
      title: 'Tu novela ha sido eliminada',
      body: `Tu novela "${title ?? ''}" ha sido eliminada por un administrador.${motive}`,
      createdAt: new Date().toISOString(),
      read: false,
      storyId,
      fromUid: auth.currentUser?.uid ?? null,
    });
  }
}
