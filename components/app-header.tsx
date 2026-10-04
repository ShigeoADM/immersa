import React from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar, Platform } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-is-desktop';

// Barra verde superior con el logo, igual que la de Descubrir y Escribir.
// El logo lleva siempre al inicio. `onBack` se conserva por compatibilidad: las
// pantallas que lo pasan tienen además su propia flecha para volver.
// `right` son los botones de la derecha, si los hay.
export function AppHeader({ onBack, right }: { onBack?: () => void; right?: React.ReactNode }) {
  // En escritorio la cabecera es la barra superior común (WebTopBar)
  const isDesktop = useIsDesktop();
  if (isDesktop) return null;
  const router = useRouter();
  const logo = (
    <Image source={require('@/assets/images/logo.png')} style={styles.logo} contentFit="contain" />
  );
  return (
    <SafeAreaView edges={['top']} style={styles.wrap}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />
      <View style={styles.bar}>
        <TouchableOpacity onPress={() => router.navigate('/(tabs)')} activeOpacity={0.7}>{logo}</TouchableOpacity>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.emerald,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 10,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logo:  { height: 40, width: 40, borderRadius: 6 },
  right: { flexDirection: 'row', gap: 8 },
});
