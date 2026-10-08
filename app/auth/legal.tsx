import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';
import { LEGAL_DOCS, LEGAL_UPDATED_AT, type LegalDoc } from '@/constants/legal';
import { ts, useT } from '@/i18n';

// Términos de uso y política de privacidad. Está bajo /auth para poder leerse sin
// haber iniciado sesión (desde el registro).
export default function LegalScreen() {
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const key: LegalDoc = doc === 'privacy' || doc === 'uploads' ? doc : 'terms';
  const { title, sections } = LEGAL_DOCS[key];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.backBtn} />
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.updated}>Última actualización: {LEGAL_UPDATED_AT}</Text>
        {sections.map(s => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  content:     { padding: 22, paddingBottom: 48 },
  updated:     { fontSize: 12, color: Colors.textMuted, marginBottom: 18 },
  section:     { marginBottom: 20 },
  sectionTitle:{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 6 },
  body:        { fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
});
