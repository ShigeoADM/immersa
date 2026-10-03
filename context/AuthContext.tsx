import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { type Permission, type Staff, hasPermission } from '@/constants/permissions';
import { syncPublicProfile } from '@/services/profiles';
import { isAdultFrom } from '@/constants/age';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  // Rol y permisos de administración (users/{uid}.role y .permissions). Solo deciden qué
  // se MUESTRA en la app; lo que se puede hacer de verdad lo imponen las reglas de Firestore.
  staff: Staff;
  isStaff: boolean;                       // dueño o administrador
  can: (permission: Permission) => boolean;
  // Nombre y avatar con los que el usuario aparece ante los demás (comentarios, perfil)
  publicName: string;
  publicAvatar: string;
  // Mayoría de edad según la fecha de nacimiento: true / false, o null si aún no la ha
  // indicado (cuentas anteriores a pedirla en el registro)
  isAdult: boolean | null;
  // Cuenta suspendida por moderación: puede leer, pero no publicar ni comentar
  suspended: boolean;
  // Usuarios que este usuario ha bloqueado (no ve sus historias ni sus comentarios)
  blocked: Set<string>;
}

const NO_STAFF: Staff = { role: null, permissions: [] };

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, staff: NO_STAFF, isStaff: false, can: () => false,
  publicName: '', publicAvatar: '', isAdult: null, suspended: false, blocked: new Set<string>(),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<Staff>(NO_STAFF);
  const [publicInfo, setPublicInfo] = useState({ name: '', avatar: '' });
  const [isAdult, setIsAdult] = useState<boolean | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());

  // Lista de bloqueados, en vivo
  useEffect(() => {
    if (!user) { setBlocked(new Set()); return; }
    return onSnapshot(
      collection(db, 'users', user.uid, 'blocked'),
      snap => setBlocked(new Set(snap.docs.map(d => d.id))),
      () => setBlocked(new Set()),
    );
  }, [user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Se escucha en vivo: un cambio de rol o permisos se refleja sin reiniciar la app
  useEffect(() => {
    if (!user) {
      setStaff(NO_STAFF); setPublicInfo({ name: '', avatar: '' }); setIsAdult(null); setSuspended(false);
      return;
    }
    return onSnapshot(
      doc(db, 'users', user.uid),
      snap => {
        const d = snap.data();
        const role = d?.role === 'owner' || d?.role === 'admin' ? d.role : null;
        setStaff({ role, permissions: role && Array.isArray(d?.permissions) ? d.permissions : [] });
        setPublicInfo({
          name: d?.displayName || d?.username || user.displayName || 'Sin nombre',
          avatar: d?.avatarUrl || user.photoURL || '',
        });
        setIsAdult(isAdultFrom(d?.birthDate));
        setSuspended(d?.suspended === true);
        // Mantener al día el perfil público (lo que ven los demás usuarios)
        syncPublicProfile(user, d).catch(e => console.error('Error sincronizando el perfil público:', e));
      },
      () => setStaff(NO_STAFF),
    );
  }, [user]);

  const can = useCallback((permission: Permission) => hasPermission(staff, permission), [staff]);
  const value = useMemo(
    () => ({
      user, loading, staff, isStaff: staff.role !== null, can,
      publicName: publicInfo.name, publicAvatar: publicInfo.avatar, isAdult, suspended, blocked,
    }),
    [user, loading, staff, can, publicInfo, isAdult, suspended, blocked],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
