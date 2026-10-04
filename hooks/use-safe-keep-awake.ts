import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// Mantiene la pantalla encendida mientras la pantalla que lo usa está abierta.
// Como useKeepAwake de Expo, pero sin romper nada si el sistema lo deniega: en un
// navegador el permiso puede negarse (ahorro de batería, pestaña en segundo plano) y
// el hook original dejaba un error sin capturar.
export function useSafeKeepAwake(tag = 'immersa-reader') {
  useEffect(() => {
    activateKeepAwakeAsync(tag).catch(() => {});
    return () => { deactivateKeepAwake(tag).catch(() => {}); };
  }, [tag]);
}
