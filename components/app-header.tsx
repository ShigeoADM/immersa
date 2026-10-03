import React from 'react';
import { View, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';

// Barra verde superior con el logo, igual que la de Descubrir y Escribir.
// Con `onBack`, el logo hace de botón para volver (como en las pantallas de creación).
// `right` son los botones de la derecha, si los hay.
export function AppHeader({ onBack, right }: { onBack?: () => void; right?: React.ReactNode }) {
  const logo = (
    <Image source={require('@/assets/images/logo.png')} style={styles.logo} contentFit="contain" />
  );
  return (
    <SafeAreaView edges={['top']} style={styles.wrap}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />
      <View style={styles.bar}>
        {onBack
          ? <TouchableOpacity onPress={onBack} activeOpacity={0.7}>{logo}</TouchableOpacity>
          : logo}
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
