import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';
import {
  REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason, type ReportTarget, sendReport,
} from '@/services/reports';
import { ts, useT } from '@/i18n';

// Diálogo para denunciar una historia o un comentario: motivo + detalles opcionales.
// `target` a null lo cierra.
export function ReportModal({ target, onClose }: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const [reason, setReason]   = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  // Mensaje final (enviada / ya denunciado / error) que sustituye al formulario
  const [result, setResult]   = useState<string | null>(null);

  // Cada vez que se abre para un contenido nuevo, empieza en blanco
  useEffect(() => {
    if (target) { setReason(null); setDetails(''); setResult(null); setSending(false); }
  }, [target]);

  const handleSend = async () => {
    if (!target || !reason || sending) return;
    setSending(true);
    try {
      const sent = await sendReport(target, reason, details);
      setResult(sent
        ? ts('Gracias. El equipo de moderación revisará tu denuncia.')
        : ts('Ya habías denunciado este contenido. El equipo de moderación lo revisará.'));
    } catch (e: any) {
      setResult(e?.message ?? ts('No se pudo enviar la denuncia. Inténtalo de nuevo.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={!!target}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>
            {target?.type === 'comment' ? ts('Denunciar comentario') : ts('Denunciar historia')}
          </Text>

          {result ? (
            <>
              <Text style={styles.text}>{result}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onClose} activeOpacity={0.8}>
                  <Text style={[styles.btnText, { color: '#000' }]}>{ts('Cerrar')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {target?.type === 'comment' && (
                <Text style={styles.quote} numberOfLines={3}>"{target.commentText}"</Text>
              )}
              <Text style={styles.text}>{ts('¿Por qué lo denuncias?')}</Text>
              {REPORT_REASONS.map(r => (
                <TouchableOpacity key={r.key} style={styles.reason} onPress={() => setReason(r.key)} activeOpacity={0.7}>
                  <MaterialIcons
                    name={reason === r.key ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={18}
                    color={reason === r.key ? Colors.emerald : Colors.textMuted}
                  />
                  <Text style={styles.reasonText}>{ts(r.label)}</Text>
                </TouchableOpacity>
              ))}
              <TextInput
                style={styles.input}
                value={details}
                onChangeText={setDetails}
                placeholder={ts('Detalles (opcional)')}
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                maxLength={REPORT_DETAILS_MAX}
              />
              <View style={styles.actions}>
                <TouchableOpacity style={styles.btn} onPress={onClose} disabled={sending} activeOpacity={0.8}>
                  <Text style={styles.btnText}>{ts('Cancelar')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnDanger, (!reason || sending) && { opacity: 0.4 }]}
                  onPress={handleSend}
                  disabled={!reason || sending}
                  activeOpacity={0.8}
                >
                  {sending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[styles.btnText, { color: '#fff' }]}>{ts('Denunciar')}</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: {
    width: '100%', maxWidth: 400, gap: 8,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 20, borderWidth: 1, borderColor: Colors.border,
  },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  text:  { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  quote: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', lineHeight: 19 },
  reason:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  reasonText: { fontSize: 14, color: Colors.textPrimary },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary, fontSize: 14, minHeight: 64, marginTop: 4,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  btn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, minWidth: 90, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  btnPrimary: { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  btnDanger:  { backgroundColor: '#D9363E', borderColor: '#D9363E' },
  btnText:    { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
});
