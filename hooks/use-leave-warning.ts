import { useEffect } from 'react';
import { Platform } from 'react-native';

// Web: si hay cambios sin guardar, el navegador pregunta antes de cerrar o recargar la
// pestaña. (Salir con la flecha de la app ya lo confirma cada editor por su cuenta.)
// En el móvil no hace nada.
export function useLeaveWarning(isDirtyRef: { current: boolean }) {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const win = globalThis as any;
    const onLeave = (e: any) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = ''; // algunos navegadores lo necesitan para enseñar el aviso
    };
    win.addEventListener('beforeunload', onLeave);
    return () => win.removeEventListener('beforeunload', onLeave);
  }, [isDirtyRef]);
}
