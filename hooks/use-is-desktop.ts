import { Platform, useWindowDimensions } from 'react-native';

// Versión de escritorio: la web abierta en una ventana ancha (un ordenador).
// La app de móvil y la web abierta desde un móvil usan el diseño de móvil de siempre:
// pestañas abajo, cabeceras propias y pantallas a todo el ancho.
export const DESKTOP_MIN_WIDTH = 900;

export function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
