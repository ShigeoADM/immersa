import React, { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useT } from '@/i18n';

// Bienvenida de la versión web. Al abrir la página se ve el fondo de la app con la
// palabra "Bienvenido" en verde: entra con un barrido de arriba abajo, se queda un
// momento y se desvanece despacio, dejando ver el inicio que ya está cargado debajo.
// Sale una vez por visita (por pestaña), no en cada recarga. Un clic la salta.

const SESSION_KEY = 'immersa-welcome-shown';
const FONT_URL = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap';
const SWEEP_MS = 800;   // barrido de entrada
const HOLD_MS  = 650;   // tiempo en pantalla
const FADE_MS  = 1100;  // desvanecimiento de salida

type Phase = 'hidden' | 'ready' | 'in' | 'out' | 'done';

function alreadyShown(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

export function WelcomeSplash() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>(() => (alreadyShown() ? 'done' : 'ready'));

  useEffect(() => {
    if (phase !== 'ready') return;
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* sin almacenamiento */ }

    // Tipografía: se carga antes de empezar para que la palabra no cambie de forma a
    // media animación. Si tarda, se empieza igualmente con la del sistema.
    if (!document.getElementById('immersa-welcome-font')) {
      const link = document.createElement('link');
      link.id = 'immersa-welcome-font';
      link.rel = 'stylesheet';
      link.href = FONT_URL;
      document.head.appendChild(link);
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      if (cancelled) return;
      setPhase('in');
      timers.push(setTimeout(() => setPhase('out'), SWEEP_MS + HOLD_MS));
      timers.push(setTimeout(() => setPhase('done'), SWEEP_MS + HOLD_MS + FADE_MS));
    };
    const fontReady = (document as any).fonts?.load?.('800 64px Montserrat') ?? Promise.resolve();
    Promise.race([fontReady, new Promise(r => setTimeout(r, 900))]).then(
      () => timers.push(setTimeout(start, 60)),
      start,
    );
    return () => { cancelled = true; timers.forEach(clearTimeout); };
    // Solo al montar: las fases siguientes las mueven los temporizadores
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'done') return null;

  const visible = phase === 'in' || phase === 'out';
  return (
    <Pressable
      onPress={() => setPhase('done')}
      style={[
        styles.overlay,
        {
          opacity: phase === 'out' ? 0 : 1,
          transitionProperty: 'opacity',
          transitionDuration: `${FADE_MS}ms`,
          transitionTimingFunction: 'ease-in-out',
          cursor: 'default',
        } as any,
      ]}
    >
      <Text
        style={[
          styles.word,
          {
            // Barrido: la palabra aparece por arriba, descubriéndose de arriba abajo
            // mientras baja ligeramente hasta su sitio
            clipPath: visible ? 'inset(0 0 0% 0)' : 'inset(0 0 100% 0)',
            transform: [{ translateY: visible ? 0 : -28 }],
            transitionProperty: 'clip-path, transform',
            transitionDuration: `${SWEEP_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
          } as any,
        ]}
      >
        {t('splash.welcome')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
    backgroundColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center',
  },
  word: {
    fontFamily: 'Montserrat, "Segoe UI", system-ui, sans-serif',
    fontWeight: '800',
    fontSize: 'clamp(40px, 9vw, 96px)' as any,
    letterSpacing: 1,
    color: '#00C878',
    paddingHorizontal: 8,
  },
});
