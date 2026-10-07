import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href, type Router } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { DesktopColumn } from '@/components/desktop-column';
import { BUILD_LABEL } from '@/constants/site';
import { startTutorial } from '@/components/tutorial';

// Desarrollo: pantalla privada, solo para cuentas con el permiso 'developer'.
//
// Aquí se prueban las novedades antes de ponerlas a la vista de todos. Lo que está a
// medias se abre desde un botón de esta lista y no aparece en ningún otro sitio de la
// app; cuando está terminado, se incrusta donde toque y se quita de aquí.
//
// Para añadir una prueba: una entrada en EXPERIMENTS con lo que hace al pulsarla.

type Experiment = { title: string; description: string; icon: keyof typeof MaterialIcons.glyphMap; run: (router: Router) => void };

const EXPERIMENTS: Experiment[] = [
  {
    title: 'Pruebas Tutorial',
    description: 'El recorrido guiado para nuevos usuarios. Empieza en la página de inicio.',
    icon: 'school',
    run: router => { router.navigate('/(tabs)' as Href); startTutorial(); },
  },
];

export default function DevScreen() {
  const router = useRouter();
  const { user, loading, staffReady, can } = useAuth();
  const checking = loading || (!!user && !staffReady);
  const allowed = !!user && can('developer');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Desarrollo</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <DesktopColumn maxWidth={900}>
        {checking ? null : !allowed ? (
          <View style={styles.centered}>
            <MaterialIcons name="lock" size={32} color={Colors.textMuted} />
            <Text style={styles.empty}>Esta sección es solo para el equipo de desarrollo.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.intro}>
              Lo que se está construyendo se prueba aquí antes de que lo vea nadie más. Solo ven esta pantalla
              las cuentas con el permiso de desarrollo.
            </Text>
            {EXPERIMENTS.length === 0 ? (
              <View style={styles.emptyBox}>
                <MaterialIcons name="science" size={30} color={Colors.textMuted} />
                <Text style={styles.empty}>Ahora mismo no hay nada en pruebas.</Text>
              </View>
            ) : (
              EXPERIMENTS.map(e => (
                <TouchableOpacity key={e.title} style={styles.card} onPress={() => e.run(router)} activeOpacity={0.8}>
                  <MaterialIcons name={e.icon} size={24} color={Colors.emerald} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{e.title}</Text>
                    <Text style={styles.cardText}>{e.description}</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={Colors.textMuted} />
                </TouchableOpacity>
              ))
            )}
            {BUILD_LABEL ? <Text style={styles.build}>Versión publicada: {BUILD_LABEL}</Text> : null}
          </ScrollView>
        )}
      </DesktopColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { padding: 20, paddingBottom: 60, gap: 14 },
  intro: { fontSize: 13, lineHeight: 19, color: Colors.textSecondary },
  emptyBox: {
    alignItems: 'center', gap: 10, paddingVertical: 48, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  empty: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  cardText: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  build: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 10 },
});
