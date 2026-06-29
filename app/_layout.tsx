import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/context/AuthContext';

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

  // Pintar la barra de navegación Android del mismo color oscuro que la app
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync('#121212');
      NavigationBar.setButtonStyleAsync('light');
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === 'auth';
    if (!user && !inAuth) {
      router.replace('/auth/login');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, loading]);   // ← sin 'segments': evita bucles de navegación

  // Mientras Firebase resuelve el estado de auth, no renderizar el Stack.
  // Esto evita que expo-router monte las tabs y las reemplace inmediatamente,
  // lo que dejaba el gesture responder system en estado inconsistente en Android.
  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#0A0A0A' }} />;
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      <Stack.Screen name="create/moderno-details" options={{ headerShown: false }} />
      <Stack.Screen name="create/editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/chapter-editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/page-editor" options={{ headerShown: false }} />
      <Stack.Screen name="reader/page-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="story/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/settings" options={{ headerShown: false }} />
    </Stack>
  );
}

export const unstable_settings = {
  anchor: '(tabs)',
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
          <StatusBar style="light" backgroundColor="#0A0A0A" />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
