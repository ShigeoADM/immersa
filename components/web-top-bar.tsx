import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { DEV_SITE_URL, IS_DEV_SITE, PROD_SITE_URL } from '@/constants/site';
import { useNotifications } from '@/context/NotificationsContext';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';

// Barra superior de la versión web. Sustituye a las pestañas de abajo de la app:
// en una página web la navegación va arriba. A la derecha: buscar, escribir y la foto
// de perfil, que abre el menú con el resto de secciones.
type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export function WebTopBar() {
  const router = useRouter();
  const { user, publicName, publicAvatar, can } = useAuth();
  const { unreadCount } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);

  // `t` cambia en cada pulsación para que Escribir reaccione aunque ya esté abierto
  const openWrite = (tab: 'new' | 'books') =>
    router.navigate({ pathname: '/(tabs)/write', params: { tab, t: String(Date.now()) } } as unknown as Href);

  const items: { icon: IconName; label: string; badge?: number; onPress: () => void }[] = [
    { icon: 'person',        label: 'Mi Perfil',      onPress: () => router.navigate('/(tabs)/profile' as Href) },
    { icon: 'notifications', label: 'Notificaciones', badge: unreadCount, onPress: () => router.push('/notifications') },
    { icon: 'menu-book',     label: 'Biblioteca',     onPress: () => router.navigate('/(tabs)/explore' as Href) },
    { icon: 'edit',          label: 'Escribir',       onPress: () => openWrite('new') },
    { icon: 'library-books', label: 'Mis Libros',     onPress: () => openWrite('books') },
    // Solo con el permiso de desarrollo: abre la web de pruebas en otra pestaña (o, desde
    // ella, vuelve a la pública)
    ...(can('developer') ? [IS_DEV_SITE
      ? { icon: 'public' as IconName, label: 'Web pública', onPress: () => { (globalThis as any).open(PROD_SITE_URL, '_blank'); } }
      : { icon: 'science' as IconName, label: 'Desarrollo', onPress: () => { (globalThis as any).open(DEV_SITE_URL, '_blank'); } },
    ] : []),
  ];

  // Las dos cierran la sesión actual y llevan a la pantalla de inicio de sesión: la app
  // guarda una sola sesión, así que cambiar de cuenta es entrar con otra.
  const leave = () => { signOut(auth).catch(e => console.error('Error cerrando sesión:', e)); };
  const sessionItems: { icon: IconName; label: string; danger?: boolean }[] = [
    { icon: 'switch-account', label: 'Cambiar de cuenta' },
    { icon: 'logout',         label: 'Cerrar sesión', danger: true },
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => router.navigate('/(tabs)' as Href)}>
          <Image source={require('@/assets/images/logo.png')} style={styles.logo} contentFit="contain" />
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} activeOpacity={0.8} onPress={() => router.push('/search' as Href)}>
            <MaterialIcons name="search" size={24} color={Colors.emerald} />
          </TouchableOpacity>
          {user ? (
            <>
              <TouchableOpacity style={styles.btn} activeOpacity={0.8} onPress={() => openWrite('books')}>
                <MaterialIcons name="edit" size={22} color={Colors.emerald} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatarBtn} activeOpacity={0.8} onPress={() => setMenuOpen(v => !v)}>
                {publicAvatar
                  ? <Image source={{ uri: publicAvatar }} style={styles.avatar} contentFit="cover" />
                  : <Text style={styles.avatarInitial}>{(publicName || '?').charAt(0).toUpperCase()}</Text>}
                {unreadCount > 0 && <View style={styles.avatarDot} />}
              </TouchableOpacity>
            </>
          ) : (
            // Invitado: en vez de escribir y el perfil, entrar o crear una cuenta
            <>
              <TouchableOpacity style={styles.guestBtn} activeOpacity={0.8} onPress={() => router.push('/auth/login')}>
                <Text style={styles.guestBtnText}>Iniciar sesión</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.guestBtn, styles.guestBtnAlt]} activeOpacity={0.8} onPress={() => router.push('/auth/register')}>
                <Text style={[styles.guestBtnText, styles.guestBtnAltText]}>Registrarse</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {menuOpen && (
        <>
          {/* Pulsar fuera cierra el menú */}
          <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} />
          <View style={styles.menu}>
            {items.map(item => (
              <Pressable
                key={item.label}
                style={({ hovered }: any) => [styles.menuItem, hovered && styles.menuItemHover]}
                onPress={() => { setMenuOpen(false); item.onPress(); }}
              >
                <MaterialIcons name={item.icon} size={20} color={Colors.emerald} />
                <Text style={styles.menuLabel}>{item.label}</Text>
                {!!item.badge && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeText}>{item.badge > 9 ? '9+' : item.badge}</Text>
                  </View>
                )}
              </Pressable>
            ))}
            {/* Sesión: abajo del todo, separada del resto y entre sí */}
            {sessionItems.map(item => (
              <React.Fragment key={item.label}>
                <View style={styles.menuDivider} />
                <Pressable
                  style={({ hovered }: any) => [styles.menuItem, hovered && styles.menuItemHover]}
                  onPress={() => { setMenuOpen(false); leave(); }}
                >
                  <MaterialIcons name={item.icon} size={20} color={item.danger ? '#FF6B6B' : Colors.emerald} />
                  <Text style={[styles.menuLabel, item.danger && { color: '#FF6B6B' }]}>{item.label}</Text>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const BTN = 46;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.emerald,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  logo: { height: 54, width: 54, borderRadius: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: {
    width: BTN, height: BTN, borderRadius: 8, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  guestBtn: {
    height: BTN, paddingHorizontal: 18, borderRadius: 8, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
  },
  guestBtnText: { color: Colors.emerald, fontSize: 15, fontWeight: '700' },
  guestBtnAlt: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#000' },
  guestBtnAltText: { color: '#000' },
  avatarBtn: {
    width: BTN, height: BTN, borderRadius: BTN / 2, backgroundColor: '#000',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#000',
  },
  avatar: { width: BTN - 4, height: BTN - 4, borderRadius: (BTN - 4) / 2 },
  avatarInitial: { color: Colors.emerald, fontSize: 20, fontWeight: '700' },
  avatarDot: {
    position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#FF4D4D', borderWidth: 2, borderColor: Colors.emerald,
  },

  backdrop: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0 },
  menu: {
    position: 'absolute', top: '100%', right: 24, marginTop: 8, minWidth: 220,
    backgroundColor: '#141414', borderRadius: 10, borderWidth: 1, borderColor: '#262626',
    paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  menuItemHover: { backgroundColor: '#1F1F1F' },
  menuDivider: { height: 1, backgroundColor: '#262626', marginVertical: 4 },
  menuLabel: { color: '#F0F0F0', fontSize: 15, fontWeight: '500', flex: 1 },
  menuBadge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    backgroundColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center',
  },
  menuBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
