import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { t } from '@/i18n';

// Transición de capítulo: la ilustración del capítulo a pantalla completa con su rótulo
// ("Capítulo 3" y el título). El autor decide cómo es todo: qué dice el rótulo, dónde va,
// color, tamaño, tipografía, cómo aparece y cómo entra la ilustración.
//
// Este componente solo dibuja. Lo usan el lector (a toda la ventana) y el editor de
// capítulo (en pequeño, como vista previa): al ser el mismo, lo que se ve al editar es lo
// que verá el lector. Todo se mide respecto a una pantalla de referencia de 844×390 y se
// escala al tamaño real.

export const INTRO_FONTS = [
  { key: 'sans',      label: 'Sencilla',     web: 'system-ui, "Segoe UI", Roboto, sans-serif', native: 'sans-serif' },
  { key: 'serif',     label: 'Clásica',      web: 'Georgia, "Times New Roman", serif',          native: 'serif' },
  { key: 'mono',      label: 'Máquina',      web: '"Courier New", monospace',                   native: 'monospace' },
  { key: 'montserrat', label: 'Montserrat',  web: 'Montserrat, sans-serif',                     native: 'sans-serif' },
  { key: 'playfair',  label: 'Playfair',     web: '"Playfair Display", serif',                  native: 'serif' },
  { key: 'cinzel',    label: 'Cinzel',       web: 'Cinzel, serif',                              native: 'serif' },
  { key: 'bebas',     label: 'Bebas',        web: '"Bebas Neue", sans-serif',                   native: 'sans-serif-condensed' },
  { key: 'script',    label: 'Manuscrita',   web: '"Dancing Script", cursive',                  native: 'cursive' },
  { key: 'elite',     label: 'Mecanografiada', web: '"Special Elite", monospace',               native: 'monospace' },
  { key: 'pixel',     label: 'Píxel',        web: '"Press Start 2P", monospace',                native: 'monospace' },
] as const;
export type IntroFont = typeof INTRO_FONTS[number]['key'];

export const INTRO_TEXT_ANIMS = [
  { key: 'none', label: 'Sin animación' }, { key: 'fade', label: 'Fundido' },
  { key: 'up', label: 'Sube' }, { key: 'down', label: 'Baja' },
  { key: 'left', label: 'Desde la derecha' }, { key: 'right', label: 'Desde la izquierda' },
  { key: 'zoom', label: 'Crece' }, { key: 'shrink', label: 'Encoge' },
  { key: 'type', label: 'Letra a letra' },
] as const;
export type IntroTextAnim = typeof INTRO_TEXT_ANIMS[number]['key'];

export const INTRO_IMAGE_ANIMS = [
  { key: 'none', label: 'Sin animación' }, { key: 'fade', label: 'Fundido' },
  { key: 'zoomIn', label: 'Acercamiento lento' }, { key: 'zoomOut', label: 'Alejamiento lento' },
  { key: 'fromRight', label: 'Entra por la derecha' }, { key: 'fromLeft', label: 'Entra por la izquierda' },
  { key: 'fromTop', label: 'Entra por arriba' }, { key: 'fromBottom', label: 'Entra por abajo' },
  { key: 'panRight', label: 'Paneo a la derecha' }, { key: 'panLeft', label: 'Paneo a la izquierda' },
  { key: 'flash', label: 'Destello' }, { key: 'grow', label: 'Crece desde el centro' },
] as const;
export type IntroImageAnim = typeof INTRO_IMAGE_ANIMS[number]['key'];

export const INTRO_SPEEDS = [
  { key: 'fast', label: 'Rápida', ms: 400 }, { key: 'normal', label: 'Normal', ms: 900 }, { key: 'slow', label: 'Lenta', ms: 1800 },
] as const;
export type IntroSpeed = typeof INTRO_SPEEDS[number]['key'];

export const INTRO_BACKDROPS = [
  { key: 'none', label: 'Nada' }, { key: 'shadow', label: 'Sombra' }, { key: 'band', label: 'Recuadro oscuro' },
  { key: 'light', label: 'Recuadro claro' },
] as const;
export type IntroBackdrop = typeof INTRO_BACKDROPS[number]['key'];

// Lo que guarda el capítulo en introStyle (todo opcional: lo que falte usa el valor de fábrica)
export type IntroStyle = {
  line1?: string; hide1?: boolean;   // primera línea: sin texto propio = "Capítulo N"
  line2?: string; hide2?: boolean;   // segunda línea: sin texto propio = título del capítulo
  x?: number; y?: number;            // posición del rótulo, en % de la pantalla
  align?: 'left' | 'center' | 'right';
  color1?: string; color2?: string;
  size?: number;                     // 1 = tamaño normal
  font?: IntroFont;
  backdrop?: IntroBackdrop;
  textAnim?: IntroTextAnim;
  textDelay?: number;                // segundos desde que aparece la ilustración
  imageAnim?: IntroImageAnim;
  imageSpeed?: IntroSpeed;
  imageFit?: 'contain' | 'cover';
};

export const INTRO_DEFAULTS = {
  x: 6, y: 84, align: 'left', color2: '#FFFFFF', size: 1, font: 'sans', backdrop: 'shadow',
  textAnim: 'fade', textDelay: 0.6, imageAnim: 'fade', imageSpeed: 'normal', imageFit: 'contain',
} as const;

// Web: las tipografías que no trae el sistema se piden a Google Fonts la primera vez
let fontsRequested = false;
export function ensureIntroFonts() {
  if (Platform.OS !== 'web' || fontsRequested) return;
  fontsRequested = true;
  const doc = (globalThis as any).document;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Playfair+Display:wght@400;700'
    + '&family=Cinzel:wght@400;700&family=Bebas+Neue&family=Dancing+Script:wght@400;700&family=Special+Elite'
    + '&family=Press+Start+2P&display=swap';
  doc.head.appendChild(link);
}

const fontFamilyOf = (key?: string) => {
  const f = INTRO_FONTS.find(x => x.key === key) ?? INTRO_FONTS[0];
  return Platform.OS === 'web' ? f.web : f.native;
};

export function ChapterIntroView({
  image, style, number, title, accent, replayKey, hint,
}: {
  image: string;
  style?: IntroStyle | null;
  number: number;
  title: string;
  accent: string;         // color de la primera línea si el autor no eligió otro
  replayKey?: number;     // al cambiar, las animaciones empiezan de nuevo
  hint?: string;          // aviso discreto abajo ("Toca para empezar")
}) {
  const c = { ...INTRO_DEFAULTS, ...(style ?? {}) };
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [block, setBlock] = useState({ width: 0, height: 0 });
  const scale = size.width ? Math.min(size.width / 844, size.height / 390) : 0;

  const line1 = c.hide1 ? '' : (c.line1?.trim() || t('reader.chapterN', { n: number }));
  const line2 = c.hide2 ? '' : (c.line2?.trim() || title);

  useEffect(ensureIntroFonts, []);

  // ── Animaciones ────────────────────────────────────────────────────────────
  const img = useRef({
    opacity: new Animated.Value(0), scale: new Animated.Value(1),
    tx: new Animated.Value(0), ty: new Animated.Value(0), flash: new Animated.Value(0),
  }).current;
  const txt = useRef({
    opacity: new Animated.Value(0), scale: new Animated.Value(1),
    tx: new Animated.Value(0), ty: new Animated.Value(0),
  }).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const [typed, setTyped] = useState<number | null>(null); // "letra a letra": letras visibles

  // Nada empieza hasta que la ilustración está descargada (o pasan unos segundos): si no,
  // el rótulo aparecería sobre negro y la animación de entrada se perdería.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    const done = () => { if (alive) setLoaded(true); };
    Image.prefetch(image).then(done, done);
    const t = setTimeout(done, 6000);
    return () => { alive = false; clearTimeout(t); };
  }, [image]);
  const ready = size.width > 0 && loaded;
  const animKey = `${replayKey ?? 0}|${c.imageAnim}|${c.imageSpeed}|${c.textAnim}|${c.textDelay}|${ready}`;
  useEffect(() => {
    if (!ready) return;
    const native = Platform.OS !== 'web';
    const ms = INTRO_SPEEDS.find(s => s.key === c.imageSpeed)?.ms ?? 900;
    const t = (v: Animated.Value, to: number, duration: number, easing = Easing.out(Easing.cubic)) =>
      Animated.timing(v, { toValue: to, duration, easing, useNativeDriver: native });
    const running: Animated.CompositeAnimation[] = [];
    const run = (a: Animated.CompositeAnimation) => { running.push(a); a.start(); };

    // Ilustración
    img.opacity.setValue(1); img.scale.setValue(1); img.tx.setValue(0); img.ty.setValue(0); img.flash.setValue(0);
    const slow = Easing.inOut(Easing.quad);
    switch (c.imageAnim) {
      case 'fade':       img.opacity.setValue(0); run(t(img.opacity, 1, ms)); break;
      case 'zoomIn':     img.opacity.setValue(0); run(t(img.opacity, 1, ms)); run(t(img.scale, 1.14, ms * 10, slow)); break;
      case 'zoomOut':    img.opacity.setValue(0); img.scale.setValue(1.16); run(t(img.opacity, 1, ms)); run(t(img.scale, 1, ms * 10, slow)); break;
      case 'fromRight':  img.tx.setValue(size.width);   run(t(img.tx, 0, ms)); break;
      case 'fromLeft':   img.tx.setValue(-size.width);  run(t(img.tx, 0, ms)); break;
      case 'fromTop':    img.ty.setValue(-size.height); run(t(img.ty, 0, ms)); break;
      case 'fromBottom': img.ty.setValue(size.height);  run(t(img.ty, 0, ms)); break;
      case 'panRight':   img.opacity.setValue(0); img.scale.setValue(1.12); img.tx.setValue(-size.width * 0.05);
                         run(t(img.opacity, 1, ms)); run(t(img.tx, size.width * 0.05, ms * 10, slow)); break;
      case 'panLeft':    img.opacity.setValue(0); img.scale.setValue(1.12); img.tx.setValue(size.width * 0.05);
                         run(t(img.opacity, 1, ms)); run(t(img.tx, -size.width * 0.05, ms * 10, slow)); break;
      case 'flash':      img.flash.setValue(1); run(t(img.flash, 0, ms * 1.2)); break;
      case 'grow':       img.opacity.setValue(0); img.scale.setValue(0.6); run(t(img.opacity, 1, ms * 0.7)); run(t(img.scale, 1, ms)); break;
    }

    // Rótulo
    const delay = Math.max(0, (c.textDelay ?? 0) * 1000);
    const dist = 26 * scale;
    txt.opacity.setValue(c.textAnim === 'none' || c.textAnim === 'type' ? 1 : 0);
    txt.scale.setValue(1); txt.tx.setValue(0); txt.ty.setValue(0);
    setTyped(c.textAnim === 'type' ? 0 : null);
    if (c.textAnim === 'none' && delay > 0) txt.opacity.setValue(0);
    let typeTimer: any = null;
    const textTimer = setTimeout(() => {
      const d = 750;
      switch (c.textAnim) {
        case 'none':   txt.opacity.setValue(1); break;
        case 'fade':   run(t(txt.opacity, 1, d)); break;
        case 'up':     txt.ty.setValue(dist);  run(t(txt.opacity, 1, d)); run(t(txt.ty, 0, d)); break;
        case 'down':   txt.ty.setValue(-dist); run(t(txt.opacity, 1, d)); run(t(txt.ty, 0, d)); break;
        case 'left':   txt.tx.setValue(dist * 2);  run(t(txt.opacity, 1, d)); run(t(txt.tx, 0, d)); break;
        case 'right':  txt.tx.setValue(-dist * 2); run(t(txt.opacity, 1, d)); run(t(txt.tx, 0, d)); break;
        case 'zoom':   txt.scale.setValue(0.7); run(t(txt.opacity, 1, d)); run(t(txt.scale, 1, d)); break;
        case 'shrink': txt.scale.setValue(1.5); run(t(txt.opacity, 1, d)); run(t(txt.scale, 1, d)); break;
        case 'type':   typeTimer = setInterval(() => setTyped(n => (n ?? 0) + 1), 55); break;
      }
    }, delay);

    hintOpacity.setValue(0);
    run(Animated.timing(hintOpacity, { toValue: 1, duration: 600, delay: delay + 1400, useNativeDriver: native }));

    return () => {
      clearTimeout(textTimer);
      if (typeTimer) clearInterval(typeTimer);
      running.forEach(a => a.stop());
    };
  }, [animKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Letra a letra": primero se escribe la primera línea y luego la segunda
  const shown1 = typed === null ? line1 : line1.slice(0, typed);
  const shown2 = typed === null ? line2 : line2.slice(0, Math.max(0, typed - line1.length));

  // ── Rótulo ─────────────────────────────────────────────────────────────────
  const fontFamily = fontFamilyOf(c.font);
  const shadow = c.backdrop === 'shadow'
    ? { textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 * scale }, textShadowRadius: 7 * scale }
    : null;
  const boxed = c.backdrop === 'band' || c.backdrop === 'light';
  const anchor = c.align === 'center' ? 0.5 : c.align === 'right' ? 1 : 0;
  // El rótulo se mide a su ancho natural (dentro de una fila tan ancha como la pantalla) y
  // luego se desplaza hasta su sitio: así no se parte en dos líneas por estar cerca de un borde.
  const blockStyle = useMemo(() => ({
    alignSelf: 'flex-start' as const,
    maxWidth: size.width * 0.92,
    transform: [
      { translateX: (c.x / 100) * size.width - anchor * block.width },
      { translateY: (c.y / 100) * size.height - block.height / 2 },
    ],
    // Hasta saber cuánto mide no se puede colocar: se mide sin verse
    opacity: block.width ? 1 : 0,
  }), [c.x, c.y, anchor, size.width, size.height, block.width, block.height]);

  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000', overflow: 'hidden' }]}
      onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      pointerEvents="none"
    >
      {ready && (
        <Animated.View
          style={[StyleSheet.absoluteFill, {
            opacity: img.opacity,
            transform: [{ translateX: img.tx }, { translateY: img.ty }, { scale: img.scale }],
          }]}
        >
          {/* Si la ilustración no llena la pantalla, la misma imagen desenfocada rellena los lados */}
          {c.imageFit !== 'cover' && (
            <Image source={{ uri: image }} style={{ ...StyleSheet.absoluteFillObject, opacity: 0.4 }} resizeMode="cover" blurRadius={30} />
          )}
          <Image source={{ uri: image }} style={{ ...StyleSheet.absoluteFillObject }} resizeMode={c.imageFit === 'cover' ? 'cover' : 'contain'} />
        </Animated.View>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: img.flash }]} />

      {ready && (line1 || line2) ? (
        <View style={styles.blockRow}>
        <View style={blockStyle} onLayout={e => setBlock({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          <Animated.View
            style={[
              { opacity: txt.opacity, transform: [{ translateX: txt.tx }, { translateY: txt.ty }, { scale: txt.scale }] },
              { alignItems: c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start' },
              boxed && {
                backgroundColor: c.backdrop === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.6)',
                paddingHorizontal: 16 * scale * c.size, paddingVertical: 10 * scale * c.size, borderRadius: 6 * scale,
              },
            ]}
          >
            {line1 ? (
              // El texto completo, invisible, reserva el sitio: "letra a letra" no mueve el rótulo
              <View>
                <Text style={[{ fontFamily, fontSize: 13 * scale * c.size, fontWeight: '700', letterSpacing: 2 * scale * c.size, textTransform: 'uppercase', opacity: 0 }]}>{line1}</Text>
                <Text style={[StyleSheet.absoluteFill, { fontFamily, fontSize: 13 * scale * c.size, fontWeight: '700', letterSpacing: 2 * scale * c.size, textTransform: 'uppercase', color: c.color1 || accent, textAlign: c.align }, shadow]}>{shown1}</Text>
              </View>
            ) : null}
            {line2 ? (
              <View style={{ marginTop: line1 ? 4 * scale * c.size : 0 }}>
                <Text style={[{ fontFamily, fontSize: 26 * scale * c.size, fontWeight: '700', opacity: 0, textAlign: c.align }]}>{line2}</Text>
                <Text style={[StyleSheet.absoluteFill, { fontFamily, fontSize: 26 * scale * c.size, fontWeight: '700', color: c.color2, textAlign: c.align }, shadow]}>{shown2}</Text>
              </View>
            ) : null}
          </Animated.View>
        </View>
        </View>
      ) : null}

      {hint && ready ? (
        <Animated.Text style={[styles.hint, { opacity: hintOpacity, fontSize: Math.max(10, 11 * scale), bottom: 10 * scale }]}>
          {hint}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blockRow: { position: 'absolute', left: 0, top: 0, right: 0 },
  hint: {
    position: 'absolute', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 },
  },
});
