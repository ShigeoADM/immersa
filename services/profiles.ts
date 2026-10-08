// Perfil público de cada usuario: profiles/{uid}.
//
// El documento users/{uid} es privado (contiene el correo, y Firestore no permite hacer
// público solo parte de un documento). Lo que pueden ver los demás se copia aquí:
// nombre, avatar, bio, rol y, solo si el usuario lo marcó como público, el correo.
//
// Lo mantiene al día la app de cada usuario (AuthContext) cada vez que cambia su
// documento. Las reglas solo aceptan un `role` que coincida con el real de users/{uid}.

import { ts } from '@/i18n';
import type { User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { Role } from '@/constants/permissions';

export interface PublicProfile {
  uid: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  role: Role | null;
  email: string | null; // solo si el usuario lo hizo público
}

const fromData = (uid: string, d: any): PublicProfile => ({
  uid,
  displayName: d?.displayName || ts('Sin nombre'),
  avatarUrl: d?.avatarUrl || '',
  bio: d?.bio || '',
  role: d?.role === 'owner' || d?.role === 'admin' ? d.role : null,
  email: d?.email || null,
});

export async function getPublicProfile(uid: string): Promise<PublicProfile | null> {
  const snap = await getDoc(doc(db, 'profiles', uid));
  return snap.exists() ? fromData(uid, snap.data()) : null;
}

// Rol actual de cada miembro del equipo (uid → rol), para las insignias DUEÑO / ADMIN
// junto a su nombre. No se guarda el rol dentro de cada comentario: se podría falsear y
// quedaría desfasado al quitar un cargo. Son muy pocos documentos y se cachea unos minutos.
const STAFF_CACHE_MS = 5 * 60 * 1000;
let staffCache: { at: number; roles: Map<string, Role> } | null = null;

export async function getStaffRoles(): Promise<Map<string, Role>> {
  if (staffCache && Date.now() - staffCache.at < STAFF_CACHE_MS) return staffCache.roles;
  const snap = await getDocs(query(collection(db, 'profiles'), where('role', 'in', ['owner', 'admin'])));
  const roles = new Map<string, Role>();
  snap.docs.forEach(d => roles.set(d.id, d.data().role as Role));
  staffCache = { at: Date.now(), roles };
  return roles;
}

// Copia a profiles/{uid} los datos públicos de users/{uid}. Solo escribe si cambian.
export async function syncPublicProfile(user: User, userData: any): Promise<PublicProfile> {
  const next: PublicProfile = {
    uid: user.uid,
    displayName: userData?.displayName || userData?.username || user.displayName || 'Sin nombre',
    avatarUrl: userData?.avatarUrl || user.photoURL || '',
    bio: userData?.bio || '',
    role: userData?.role === 'owner' || userData?.role === 'admin' ? userData.role : null,
    email: userData?.emailPublic === true ? (user.email ?? null) : null,
  };

  const ref = doc(db, 'profiles', user.uid);
  const current = await getDoc(ref);
  const c = current.exists() ? fromData(user.uid, current.data()) : null;
  const same = c
    && c.displayName === next.displayName && c.avatarUrl === next.avatarUrl
    && c.bio === next.bio && c.role === next.role && c.email === next.email;

  if (!same) {
    await setDoc(ref, {
      displayName: next.displayName,
      avatarUrl: next.avatarUrl,
      bio: next.bio,
      ...(next.role ? { role: next.role } : {}),   // sin rol → campo ausente
      ...(next.email ? { email: next.email } : {}),
      updatedAt: new Date().toISOString(),
    });
  }
  return next;
}
