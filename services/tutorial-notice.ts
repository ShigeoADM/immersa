import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';

// Aviso fijo "Tutorial Immersa" de la pantalla de notificaciones.
//
// No es una notificación de verdad (no se guarda en la base de datos ni se puede borrar):
// forma parte de la app. Sale arriba del todo y ofrece hacer el tutorial o descubrir la
// web por cuenta propia. Cuenta como "sin leer" hasta que se abre una vez.
//
// EN PRUEBAS: por ahora solo la ven las cuentas con el permiso de desarrollo.

const key = (uid: string) => `immersa_tutorial_notice_seen:${uid}`;

// Cuentas que ya la han abierto (en este dispositivo)
let seen: Record<string, boolean> = {};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSeen = () => seen;

export function markTutorialNoticeSeen(uid: string) {
  if (seen[uid]) return;
  seen = { ...seen, [uid]: true };
  listeners.forEach(l => l());
  AsyncStorage.setItem(key(uid), '1').catch(() => {});
}

export function useTutorialNotice(): { visible: boolean; unread: boolean } {
  const { user, can } = useAuth();
  const all = useSyncExternalStore(subscribe, getSeen, getSeen);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid || uid in seen) return;
    AsyncStorage.getItem(key(uid)).then(v => {
      seen = { ...seen, [uid]: !!v };
      listeners.forEach(l => l());
    }).catch(() => {});
  }, [uid]);

  // El tutorial señala elementos de la página web: en la app del móvil aún no existe
  const visible = Platform.OS === 'web' && !!uid && can('developer');
  // (hasta saber si ya se abrió, no se marca como sin leer: evita un aviso que parpadea)
  return { visible, unread: visible && all[uid!] === false };
}
