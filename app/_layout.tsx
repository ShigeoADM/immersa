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
import { WebTopBar } from '@/components/web-top-bar';
import { WelcomeSplash } from '@/components/welcome-splash';
import { DevSiteOverlay } from '@/components/dev-site';
import { IS_DEV_SITE } from '@/constants/site';
import { useIsDesktop } from '@/hooks/use-is-desktop';

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

// Web: barras de desplazamiento finas y oscuras, a juego con la app, en vez de las
// claras del navegador. Solo aparecen al pasar el ratón por la zona que se desplaza.
const WEB_SCROLLBAR_CSS = `
  * { scrollbar-width: thin; scrollbar-color: #2E2E2E transparent; }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #2E2E2E; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
  *::-webkit-scrollbar-thumb:hover { background: #00C878; border: 2px solid transparent; background-clip: padding-box; }
  *::-webkit-scrollbar-corner { background: transparent; }
  input:focus, textarea:focus { outline: 1px solid rgba(0, 200, 120, 0.7); outline-offset: 0; }
`;

// En la web se puede entrar sin cuenta ("invitado"): explorar, buscar, ver fichas y leer.
// La app de móvil sigue pidiendo iniciar sesión.
// (en la web de desarrollo no: ahí hay que entrar con una cuenta de desarrollador)
const GUESTS_ALLOWED = Platform.OS === 'web' && !IS_DEV_SITE;
function isPublicRoute(segments: string[]): boolean {
  const [first, second] = segments;
  if (first === undefined) return true;                              // raíz (redirige al inicio)
  if (first === '(tabs)') return second === undefined || second === 'index'; // solo Descubrir
  return ['auth', 'search', 'story', 'reader', 'user'].includes(first);
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const isDesktop = useIsDesktop();

  // Pintar la barra de navegación Android del mismo color oscuro que la app.
  // El fondo raíz (detrás de todas las pantallas) era blanco: asomaba un frame en
  // cada transición y al girar al lector. app.json lo fija en la app exportada;
  // aquí también para Expo Go.
  useEffect(() => {
    if (Platform.OS !== 'web') SystemUI.setBackgroundColorAsync('#0A0A0A').catch(() => {});
    if (Platform.OS === 'web') {
      const doc = (globalThis as any).document;
      if (doc && !doc.getElementById('immersa-scrollbars')) {
        const style = doc.createElement('style');
        style.id = 'immersa-scrollbars';
        style.textContent = WEB_SCROLLBAR_CSS;
        doc.head.appendChild(style);
      }
    }
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
    if (!user && !inAuth && !GUESTS_ALLOWED) {
      router.replace('/auth/login');
    } else if (user && inAuth) {
      // Web: si el invitado venía de otra pantalla (una ficha, un lector), se vuelve a
      // ella cerrando las pantallas de acceso que tenga encima. Si no, al inicio.
      const routes = (rootNavState as any)?.routes ?? [];
      let authOnTop = 0;
      for (let i = routes.length - 1; i >= 0 && String(routes[i].name).startsWith('auth/'); i--) authOnTop++;
      if (GUESTS_ALLOWED && authOnTop > 0 && authOnTop < routes.length) {
        router.dismiss(authOnTop);
      } else {
        router.replace('/(tabs)');
      }
    }
  }, [user, loading, navReady]);   // ← sin 'segments': evita bucles de navegación

  // Web: un invitado puede explorar y leer, pero las secciones personales (biblioteca,
  // escribir, perfil, notificaciones…) le llevan a iniciar sesión.
  const route = segments.join('/');
  useEffect(() => {
    if (!GUESTS_ALLOWED || loading || !navReady || user) return;
    if (!isPublicRoute(segments as string[])) router.replace('/auth/login');
  }, [route, user, loading, navReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tocar una notificación del móvil abre la pantalla de notificaciones (también si
  // la app estaba cerrada: useLastNotificationResponse la recuerda).
  // Va aquí y no en NotificationsProvider: useRootNavigationState actualiza el store del
  // router durante el render, y usarlo en un hijo de RootNavigator provocaba un bucle
  // infinito de renders ("Maximum update depth exceeded").
  // (En web no existe: la plataforma no cambia durante la ejecución, así que el hook
  // se llama siempre o nunca.)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const lastResponse = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!navReady || !user || !lastResponse) return;
    router.push('/notifications');
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [lastResponse, navReady, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // A toda la ventana: las secciones principales, la ficha de una historia, los
  // lectores y las pantallas de creación. El resto va en una columna centrada.
  const fullWidth = (['(tabs)', 'create', 'reader', 'story', 'notifications', 'search', 'admin', 'dev', 'profile'] as string[])
    .includes(segments[0] as string);

  // Escritorio: la barra superior acompaña a todas las secciones menos el inicio de sesión,
  // los lectores y las pantallas de creación, que tienen su propia cabecera
  const section = segments[0] as string | undefined;
  const showWebTopBar = isDesktop && (!!user || GUESTS_ALLOWED)
    && section !== 'auth' && section !== 'reader' && section !== 'create';

  return (
    <NotificationsProvider>
    <View style={isDesktop ? styles.webBackdrop : styles.fill}>
    {showWebTopBar && <View style={styles.webTopBar}><WebTopBar /></View>}
    <View style={!isDesktop ? styles.fill : fullWidth ? styles.webFull : styles.webColumn}>
    <Stack screenOptions={{ contentStyle: { backgroundColor: '#0A0A0A' } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false }} />
      <Stack.Screen name="auth/legal" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      <Stack.Screen name="create/moderno-details" options={{ headerShown: false }} />
      <Stack.Screen name="create/editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/chapter-editor-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="create/media-manager" options={{ headerShown: false }} />
      <Stack.Screen name="create/page-editor" options={{ headerShown: false }} />
      <Stack.Screen name="create/chapter-editor-webnovel" options={{ headerShown: false }} />
      <Stack.Screen name="reader/webnovel" options={{ headerShown: false }} />
      <Stack.Screen name="reader/page-moderno" options={{ headerShown: false }} />
      <Stack.Screen name="story/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/settings" options={{ headerShown: false }} />
      <Stack.Screen name="profile/lists" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="dev" options={{ headerShown: false }} />
      <Stack.Screen name="search" options={{ headerShown: false }} />
      <Stack.Screen name="user/[uid]" options={{ headerShown: false }} />
    </Stack>
    </View>
    </View>
    {/* Pantalla de carga encima del Stack mientras Firebase resuelve la sesión */}
    {loading && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0A' }]} />}
    {/* Web: bienvenida animada al abrir la página (en la app no pinta nada) */}
    <WelcomeSplash />
    {/* Web de desarrollo: etiqueta y cierre del paso a quien no tiene el permiso */}
    <DevSiteOverlay />
    </NotificationsProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Web: el fondo de la app ocupa toda la ventana
  webBackdrop: { flex: 1, alignItems: 'center', backgroundColor: '#0A0A0A' },
  // Web: en PC el contenido va centrado, con el ancho de un móvil grande, sin bordes
  // que lo delimiten. En un móvil (ventana estrecha) ocupa todo el ancho.
  webColumn: { flex: 1, width: '100%', maxWidth: 760 },
  // Web: la barra superior va de lado a lado y por encima del contenido (su menú se
  // despliega sobre la pantalla)
  webTopBar: { width: '100%', zIndex: 100 },
  // Web: pantallas que ocupan toda la ventana (el fondo centra a sus hijos, así que
  // hay que pedir el ancho completo de forma explícita)
  webFull: { flex: 1, width: '100%' },
});

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
