import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { BUILD_LABEL, IS_DEV_SITE, PROD_SITE_URL } from '@/constants/site';

// Web de desarrollo: una etiqueta fija para no confundirla con la pública y, para quien
// entra sin el permiso de desarrollo, una pantalla que le corta el paso.
//
// En la web pública (y en la app) no pinta nada.
//
// Esto solo decide qué se ENSEÑA: la web de desarrollo usa la misma base de datos, y lo
// que cada cuenta puede hacer lo siguen imponiendo las reglas de Firestore.
export function DevSiteOverlay() {
  const { user, loading, staffReady, can } = useAuth();
  if (!IS_DEV_SITE) return null;

  const checking = loading || (!!user && !staffReady);
  const blocked = !!user && staffReady && !can('developer');

  return (
    <>
      {(checking || blocked) && (
        <View style={styles.wall}>
          {checking ? <ActivityIndicator color={Colors.emerald} /> : (
            <View style={styles.card}>
              <Text style={styles.title}>Zona de desarrollo</Text>
              <Text style={styles.text}>
                Esta es la versión de pruebas de Immersa y tu cuenta no tiene acceso. La web de siempre está en
                immersa.web.app.
              </Text>
              <TouchableOpacity
                style={styles.primary}
                activeOpacity={0.8}
                onPress={() => { (globalThis as any).location.href = PROD_SITE_URL; }}
              >
                <Text style={styles.primaryText}>Ir a Immersa</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} onPress={() => { signOut(auth).catch(() => {}); }}>
                <Text style={styles.link}>Entrar con otra cuenta</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      <View style={styles.badge} pointerEvents="none">
        <Text style={styles.badgeText}>DESARROLLO{BUILD_LABEL ? ` · ${BUILD_LABEL}` : ''}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wall: {
    ...StyleSheet.absoluteFillObject, zIndex: 1000, backgroundColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: { maxWidth: 420, alignItems: 'center', gap: 16 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary },
  text: { fontSize: 14, lineHeight: 21, color: Colors.textSecondary, textAlign: 'center' },
  primary: { paddingVertical: 12, paddingHorizontal: 28, borderRadius: 8, backgroundColor: Colors.emerald },
  primaryText: { fontSize: 14, fontWeight: '700', color: '#000' },
  link: { fontSize: 13, color: Colors.textMuted, textDecorationLine: 'underline' },
  badge: {
    position: 'absolute', left: 8, bottom: 8, zIndex: 1001, paddingVertical: 3, paddingHorizontal: 8,
    borderRadius: 4, backgroundColor: 'rgba(255,170,0,0.92)',
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: '#000' },
});
