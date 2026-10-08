import React, { useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useT } from '@/i18n';

export type BirthDateParts = { day: string; month: string; year: string };
export const EMPTY_BIRTH_DATE: BirthDateParts = { day: '', month: '', year: '' };

// Fecha de nacimiento en tres campos numéricos (día / mes / año). Salta al siguiente
// campo al completar el anterior.
export function BirthDateInput({ value, onChange }: {
  value: BirthDateParts;
  onChange: (v: BirthDateParts) => void;
}) {
  const t = useT();
  const monthRef = useRef<TextInput>(null);
  const yearRef  = useRef<TextInput>(null);
  const digits = (s: string) => s.replace(/[^0-9]/g, '');

  return (
    <View style={styles.row}>
      <TextInput
        style={[styles.input, styles.short]}
        value={value.day}
        onChangeText={t => {
          const day = digits(t);
          onChange({ ...value, day });
          if (day.length === 2) monthRef.current?.focus();
        }}
        placeholder={t('birth.day')}
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        maxLength={2}
      />
      <Text style={styles.sep}>/</Text>
      <TextInput
        ref={monthRef}
        style={[styles.input, styles.short]}
        value={value.month}
        onChangeText={t => {
          const month = digits(t);
          onChange({ ...value, month });
          if (month.length === 2) yearRef.current?.focus();
        }}
        placeholder={t('birth.month')}
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        maxLength={2}
      />
      <Text style={styles.sep}>/</Text>
      <TextInput
        ref={yearRef}
        style={[styles.input, styles.long]}
        value={value.year}
        onChangeText={t => onChange({ ...value, year: digits(t) })}
        placeholder={t('birth.year')}
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        maxLength={4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 4,
    paddingHorizontal: 12, paddingVertical: 12, color: Colors.textPrimary, fontSize: 15, textAlign: 'center',
  },
  short: { width: 62 },
  long:  { width: 88 },
  sep:   { color: Colors.textMuted, fontSize: 16 },
});
