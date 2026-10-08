import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { ts, useT } from '@/i18n';

// Diálogos con la estética de la app, en lugar de los nativos (blancos en Android).
// Se usa igual que Alert.alert:
//
//   AppAlert.alert('Título', 'Mensaje', [
//     { text: 'Cancelar', style: 'cancel' },
//     { text: 'Borrar', style: 'destructive', onPress: () => … },
//   ]);
//
// <AppDialogHost /> pinta el diálogo. Hay uno en la raíz de la app y otro dentro de cada
// Modal propio desde el que se pueden lanzar avisos: en iOS no se puede abrir un Modal
// desde la raíz mientras hay otro abierto. Siempre lo muestra el último que se montó.

export type AppAlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type DialogRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  cancelable: boolean;
  accent: string; // color del botón principal
};

// Color de acento de los diálogos según la pantalla enfocada (p. ej. morado en la zona
// de creación de Webnovel). Es una pila porque al navegar la pantalla nueva se enfoca
// antes de que la anterior pierda el foco; manda la última en enfocarse.
const accentStack: string[] = [];

export function useDialogAccent(color: string) {
  useFocusEffect(useCallback(() => {
    accentStack.push(color);
    return () => {
      const i = accentStack.lastIndexOf(color);
      if (i !== -1) accentStack.splice(i, 1);
    };
  }, [color]));
}

let nextId = 1;
let queue: DialogRequest[] = [];
// Un "host" por <AppDialogHost /> montado; el último de la lista es el que muestra
const hosts: { id: number; update: () => void }[] = [];
const notify = () => hosts.forEach(h => h.update());

export const AppAlert = {
  alert(title: string, message?: string, buttons?: AppAlertButton[], options?: { cancelable?: boolean }) {
    if (hosts.length === 0) { Alert.alert(title, message, buttons, options); return; } // sin host montado
    queue = [...queue, {
      id: nextId++,
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: ts('Aceptar') }],
      cancelable: options?.cancelable ?? true,
      accent: accentStack[accentStack.length - 1] ?? Colors.emerald,
    }];
    notify();
  },
};

export function AppDialogHost() {
  const hostId = useRef(nextId++).current;
  const [, forceRender] = useState(0);

  useEffect(() => {
    hosts.push({ id: hostId, update: () => forceRender(n => n + 1) });
    notify();
    return () => {
      const i = hosts.findIndex(h => h.id === hostId);
      if (i !== -1) hosts.splice(i, 1);
      notify();
    };
  }, [hostId]);

  const isTop = hosts.length > 0 && hosts[hosts.length - 1].id === hostId;
  const current = isTop ? queue[0] : undefined;

  const close = (button?: AppAlertButton) => {
    queue = queue.slice(1);
    notify();
    button?.onPress?.();
  };

  // Botón atrás del móvil / tocar fuera: equivale a "Cancelar" si lo hay
  const dismiss = () => {
    if (!current || !current.cancelable) return;
    close(current.buttons.find(b => b.style === 'cancel'));
  };

  const stacked = (current?.buttons.length ?? 0) > 2;

  return (
    <Modal
      visible={!!current}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={dismiss}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={dismiss}>
        {/* El toque dentro de la caja no cierra el diálogo */}
        <TouchableOpacity style={styles.box} activeOpacity={1} onPress={() => {}}>
          {current && (
            <>
              <Text style={styles.title}>{current.title}</Text>
              {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
              <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
                {current.buttons.map((b, i) => {
                  const kind = b.style ?? 'default';
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.button,
                        kind === 'default' && { backgroundColor: current.accent, borderColor: current.accent },
                        kind === 'destructive' && styles.buttonDestructive,
                        stacked && styles.buttonStacked,
                      ]}
                      onPress={() => close(b)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.buttonText,
                          kind === 'default' && styles.buttonTextPrimary,
                          kind === 'destructive' && styles.buttonTextDestructive,
                        ]}
                        numberOfLines={1}
                      >
                        {b.text ?? ts('Aceptar')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  box: {
    width: '100%', maxWidth: 380, gap: 10,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 20,
    borderWidth: 1, borderColor: Colors.border,
  },
  title:   { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  message: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  buttonsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  button: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, minWidth: 84, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  buttonStacked:     { minWidth: 0 },
  buttonDestructive: { backgroundColor: '#D9363E', borderColor: '#D9363E' },
  buttonText:            { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  buttonTextPrimary:     { color: '#000' },
  buttonTextDestructive: { color: '#fff' },
});
