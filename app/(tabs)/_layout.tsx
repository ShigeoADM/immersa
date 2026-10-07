import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-is-desktop';

// Escritorio: Descubrir ocupa todo el ancho; el resto de secciones van en una columna centrada.
// La columna se consigue con márgenes interiores y no estrechando la pantalla: la
// pantalla tiene que tapar entera a la sección anterior, que sigue montada debajo.
const WEB_COLUMN = {
  backgroundColor: Colors.bg,
  paddingHorizontal: 'max(0px, calc((100% - 760px) / 2))',
} as any;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();

  // En escritorio la navegación va en la barra superior (WebTopBar, en el layout raíz)
  // y no hay pestañas abajo
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.emerald,
        tabBarInactiveTintColor: Colors.textMuted,
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.bg },
        tabBarButton: HapticTab,
        tabBarStyle: isDesktop ? { display: 'none' } : {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          // En el navegador la etiqueta necesita algo más de alto que en la app
          height: (Platform.OS === 'web' ? 68 : 56) + insets.bottom,
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 10 : 4),
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Descubrir',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          sceneStyle: isDesktop ? WEB_COLUMN : undefined,
          title: 'Biblioteca',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="book.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="write"
        options={{
          sceneStyle: isDesktop ? WEB_COLUMN : undefined,
          title: 'Escribir',
          tabBarButtonTestID: 'tut-write', // el tutorial señala este botón (components/tutorial.tsx)
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="pencil" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          sceneStyle: isDesktop ? WEB_COLUMN : undefined,
          title: 'Perfil',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
