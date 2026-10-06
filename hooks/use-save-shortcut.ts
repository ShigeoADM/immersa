import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// Web: Ctrl+S (o Cmd+S en Mac) guarda, en vez de abrir el "Guardar página" del navegador.
// En el móvil no hace nada.
export function useSaveShortcut(onSave: () => void) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = globalThis as any;
    const onKey = (e: any) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, []);
}
