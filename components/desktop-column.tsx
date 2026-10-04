import React from 'react';
import { View } from 'react-native';
import { useIsDesktop } from '@/hooks/use-is-desktop';

// En escritorio, centra su contenido en una columna; en móvil no cambia nada.
// Se usa en pantallas cuya cabecera va de lado a lado pero cuyo contenido (formularios,
// listas) quedaría raro estirado a toda la ventana.
export function DesktopColumn({ children, maxWidth = 760 }: { children: React.ReactNode; maxWidth?: number }) {
  const isDesktop = useIsDesktop();
  return (
    <View style={isDesktop ? { flex: 1, width: '100%', maxWidth, alignSelf: 'center' } : { flex: 1 }}>
      {children}
    </View>
  );
}
