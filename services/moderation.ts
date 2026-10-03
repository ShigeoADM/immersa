// Moderación: bloquear usuarios (cada lector, para sí mismo), suspender cuentas
// (moderadores) y borrar los datos de un usuario (solo el dueño de la app).

import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { deleteStoryWithCascade } from '@/services/stories';

// ── Bloquear ─────────────────────────────────────────────────────────────────
// users/{yo}/blocked/{otro}: dejo de ver sus historias y comentarios. Es privado y
// solo afecta a lo que veo yo; AuthContext lo escucha y las pantallas filtran con ello.
export interface BlockedUser { uid: string; name: string; createdAt: string }

export const blockUser = (myUid: string, target: { uid: string; name: string }) =>
  setDoc(doc(db, 'users', myUid, 'blocked', target.uid), {
    name: target.name, createdAt: new Date().toISOString(),
  });

export const unblockUser = (myUid: string, targetUid: string) =>
  deleteDoc(doc(db, 'users', myUid, 'blocked', targetUid));

export async function listBlocked(myUid: string): Promise<BlockedUser[]> {
  const snap = await getDocs(collection(db, 'users', myUid, 'blocked'));
  return snap.docs
    .map(d => ({ uid: d.id, ...(d.data() as Omit<BlockedUser, 'uid'>) }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

// ── Suspender ────────────────────────────────────────────────────────────────
// users/{uid}.suspended = true: la cuenta puede leer, pero las reglas no le dejan
// publicar ni editar historias, ni comentar. Lo pone y lo quita moderación.
export async function isSuspended(uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'users', uid))).data()?.suspended === true;
}

export async function setSuspended(uid: string, suspended: boolean) {
  const moderator = auth.currentUser?.uid ?? null;
  await updateDoc(doc(db, 'users', uid), suspended
    ? { suspended: true, suspendedAt: new Date().toISOString(), suspendedBy: moderator }
    : { suspended: deleteField(), suspendedAt: deleteField(), suspendedBy: deleteField() });

  // Aviso al usuario (id fijo por estado: no se acumulan avisos repetidos)
  await setDoc(doc(db, 'users', uid, 'notifications', suspended ? 'account_suspended' : 'account_restored'), {
    type: 'admin',
    title: suspended ? 'Cuenta suspendida' : 'Suspensión retirada',
    body: suspended
      ? 'Tu cuenta ha sido suspendida por incumplir las normas. Puedes seguir leyendo, pero no publicar ni comentar.'
      : 'Se ha retirado la suspensión de tu cuenta. Ya puedes volver a publicar y comentar.',
    createdAt: new Date().toISOString(),
    read: false,
    fromUid: moderator,
  }).catch(() => {});
}

// ── Borrar los datos de un usuario ───────────────────────────────────────────
// Para atender peticiones de borrado de cuenta que llegan por correo. Borra sus
// historias (avisando a los lectores), su perfil público y sus datos privados.
// NO puede borrar el acceso (Authentication): eso se hace en la consola de Firebase.
// No borra sus comentarios en historias ajenas ni ajusta los contadores de me gusta.
export async function adminDeleteUserData(uid: string) {
  const quietly = (p: Promise<unknown>) => p.catch(() => {});

  const stories = await getDocs(query(collection(db, 'stories'), where('uid', '==', uid)));
  for (const s of stories.docs) await quietly(deleteStoryWithCascade(s.id, 'admin'));

  const subcollections = ['library', 'notifications', 'following', 'likedStories', 'blocked'];
  for (const sub of subcollections) {
    const snap = await getDocs(collection(db, 'users', uid, sub)).catch(() => null);
    if (snap) await Promise.all(snap.docs.map(d => quietly(deleteDoc(d.ref))));
  }
  const followers = await getDocs(collection(db, 'profiles', uid, 'followers')).catch(() => null);
  if (followers) await Promise.all(followers.docs.map(d => quietly(deleteDoc(d.ref))));

  await quietly(deleteDoc(doc(db, 'profiles', uid)));
  // El documento principal sí debe borrarse: si falla, se avisa
  await deleteDoc(doc(db, 'users', uid));
}
