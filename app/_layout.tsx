import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import * as Notifications from 'expo-notifications';
import { Platform, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/context/AuthContext';
// También registra la tarea de segundo plano (TaskManager.defineTask al cargar el módulo)
import { NotificationsProvider } from '@/context/NotificationsContext';
import { AppDialogHost } from '@/components/app-dialog';

const ImmersaTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0A0A0A',
    card: '#121212',
    text: '#F0F0F0',
    border: '#1E1E1E',
    primary: '#00C878',
    notification: '#00C878',
  },
};

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;

  // Pintar la barra de navegación Android del mismo color oscuro que la app.
  // El fondo raíz (detrás de todas las pantallas) era blanco: asomaba un frame en
  // cada transición y al girar al lector. app.json lo fija en la app exportada;
  // aquí también para Expo Go.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync('#0A0A0A').catch(() => {});
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync('#121212');
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  // Redirigir solo cuando el navegador ya está montado: un replace durante el
  // montaje inicial dejaba en Android una transición a medias que bloqueaba
  // los toques hasta pulsar "atrás".
  useEffect(() => {
    if (loading || !navReady) return;
    const inAuth = segments[0] === 'auth';
    if (!user && !inAuth) {
      router.replace('/auth/login');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, loading, navReady]);   // ← sin 'segments': evita bucles de navegación

  // Tocar una notificación del móvil abre la pantalla de notificaciones (también si
  // la app estaba cerrada: useLastNotificationResponse la recuerda).
  // Va aquí y no en NotificationsProvider: useRootNavigationState actualiza el store del
  // router durante el render, y usarlo en un hijo de RootNavigator provocaba un bucle
  // infinito de renders ("Maximum update depth exceeded").
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!navReady || !user || !lastResponse) return;
    router.push('/notifications');
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [lastResponse, navReady, user]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NotificationsProvider>
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0A0A0A' } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      <Stack.Screen name="create/moderno-details" options={{ headerShown: false }} />
      <Stack.Screen name="create/editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/chapter-editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/page-editor" options={{ headerShown: false }} />
      <Stack.Screen name="create/chapter-editor-webnovel" options={{ headerShown: false }} />
      <Stack.Screen name="reader/webnovel" options={{ headerShown: false }} />
      <Stack.Screen name="reader/page-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="story/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/settings" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="user/[uid]" options={{ headerShown: false }} />
    </Stack>
    {/* Pantalla de carga encima del Stack mientras Firebase resuelve la sesión */}
    {loading && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0A' }]} />}
    </NotificationsProvider>
  );
}

// En expo-router v4 la clave es initialRouteName ('anchor' es de versiones posteriores)
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  return (
    // flex: 1 es lo correcto para GestureHandlerRootView en la raíz.
    // absoluteFill (position: absolute) puede dejar mal inicializado
    // el gesture responder system en Android en el primer mount.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider value={ImmersaTheme}>
          <RootNavigator />
          {/* Diálogos con la estética de la app (sustituyen a los Alert nativos) */}
          <AppDialogHost />
          <StatusBar style="light" backgroundColor="#0A0A0A" />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
