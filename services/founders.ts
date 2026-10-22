// Autores fundadores: founders/{uid}. La insignia la da y la quita solo el dueño de
// Immersa, a mano (desde el perfil de cada usuario), para reconocer a los primeros autores
// que publican algo que merece la pena. Las reglas no dejan a nadie más tocar la lista.

import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';

// Son pocos documentos: se leen todos de una vez y se guardan unos minutos
const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; ids: Set<string> } | null = null;
let loading: Promise<Set<string>> | null = null;
const listeners = new Set<() => void>();

export function getFounders(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.ids);
  if (!loading) {
    loading = getDocs(collection(db, 'founders'))
      .then(snap => {
        cache = { at: Date.now(), ids: new Set(snap.docs.map(d => d.id)) };
        listeners.forEach(l => l());
        return cache.ids;
      })
      .catch(() => cache?.ids ?? new Set<string>())
      .finally(() => { loading = null; });
  }
  return loading;
}

// Dar o quitar la insignia (solo el dueño)
export async function setFounder(uid: string, founder: boolean) {
  const ref = doc(db, 'founders', uid);
  if (founder) await setDoc(ref, { since: new Date().toISOString() });
  else await deleteDoc(ref);
  const ids = new Set(cache?.ids ?? []);
  if (founder) ids.add(uid); else ids.delete(uid);
  cache = { at: Date.now(), ids };
  listeners.forEach(l => l());
}

// ¿Es fundador? Se actualiza solo cuando se carga la lista o cambia
export function useIsFounder(uid?: string | null): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick(n => n + 1);
    listeners.add(l);
    getFounders();
    return () => { listeners.delete(l); };
  }, []);
  return !!uid && !!cache?.ids.has(uid);
}
