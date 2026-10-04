import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  Canvas, Paragraph, Skia, PaintStyle, StrokeJoin, TextDecoration,
  type SkPaint, type SkParagraph, type SkTextStyle,
} from '@shopify/react-native-skia';

// Texto con borde de verdad, dibujado con Skia.
//
// React Native no tiene trazo de texto: el borde se simulaba apilando copias negras
// del texto desplazadas alrededor, y con letras de trazo fino salía dentado. Aquí el
// texto se dibuja dos veces sobre un lienzo: primero su contorno (trazo) y encima el
// relleno. El salto de línea lo calcula Skia (SkParagraph), igual que un Text normal.

export type OutlineSegment = {
  text: string;
  color?: string;         // relleno; por defecto el del estilo
  outlineColor?: string;  // borde; por defecto el del estilo
  bold?: boolean;         // peso máximo (enlaces)
  underline?: boolean;
  // Tramo pulsable (enlace). Recibe la posición del toque en la pantalla.
  onPress?: (pageX: number, pageY: number) => void;
};

export type OutlineStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: number;    // 400, 700…
  color: string;
  outlineColor?: string;
  outlineWidth?: number;  // grosor del borde hacia fuera de la letra
};

// Un pincel de trazo por color y grosor (se reutilizan entre repintados)
const strokePaints = new Map<string, SkPaint>();
function strokePaint(color: string, outlineWidth: number): SkPaint {
  const key = `${color}|${outlineWidth}`;
  let paint = strokePaints.get(key);
  if (!paint) {
    paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    // El trazo va centrado en el contorno: la mitad interior queda bajo el relleno
    paint.setStrokeWidth(outlineWidth * 2);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(color));
    strokePaints.set(key, paint);
  }
  return paint;
}

function buildParagraph(
  segments: OutlineSegment[], st: OutlineStyle, layer: 'outline' | 'fill', width: number,
): SkParagraph {
  const outlineWidth = st.outlineWidth ?? 2;
  const builder = Skia.ParagraphBuilder.Make({});
  for (const seg of segments) {
    if (!seg.text) continue;
    const base: SkTextStyle = {
      fontFamilies: [st.fontFamily],
      fontSize: st.fontSize,
      fontStyle: { weight: (seg.bold ? 900 : st.fontWeight ?? 400) as any },
    };
    // Solo se añaden si tienen valor: Skia nativo falla con una propiedad a undefined
    if (st.lineHeight) base.heightMultiplier = st.lineHeight / st.fontSize;
    if (st.letterSpacing !== undefined) base.letterSpacing = st.letterSpacing;
    if (layer === 'outline') {
      builder.pushStyle(base, strokePaint(seg.outlineColor ?? st.outlineColor ?? '#000', outlineWidth));
    } else {
      const color = Skia.Color(seg.color ?? st.color);
      builder.pushStyle({
        ...base,
        color,
        ...(seg.underline ? { decoration: TextDecoration.Underline, decorationColor: color } : {}),
      });
    }
    builder.addText(seg.text);
    builder.pop();
  }
  const paragraph = builder.build();
  paragraph.layout(width);
  return paragraph;
}

type Props = {
  segments: OutlineSegment[];
  style: OutlineStyle;
  // true: ocupa solo lo que mide el texto en una línea (etiquetas). Por defecto ocupa
  // todo el ancho disponible y salta de línea.
  inline?: boolean;
};

export function OutlineText({ segments, style, inline }: Props) {
  const [boxWidth, setBoxWidth] = useState(0);
  // Margen del lienzo alrededor del texto, para que el borde no se corte en los lados
  const pad = Math.ceil(style.outlineWidth ?? 2) + 1;

  const drawn = useMemo(() => {
    const available = inline ? 10000 : boxWidth - pad * 2;
    if (available <= 0) return null;
    let fill = buildParagraph(segments, style, 'fill', available);
    let width = available;
    if (inline) {
      // Se mide en una línea y se vuelve a componer con ese ancho justo
      width = Math.ceil(fill.getLongestLine()) + 1;
      fill = buildParagraph(segments, style, 'fill', width);
    }
    const outline = buildParagraph(segments, style, 'outline', width);
    const height = Math.ceil(fill.getHeight());

    // Zonas pulsables: los rectángulos que ocupa cada enlace (uno por línea)
    const hits: { key: string; x: number; y: number; w: number; h: number; onPress: NonNullable<OutlineSegment['onPress']> }[] = [];
    let offset = 0;
    segments.forEach((seg, i) => {
      if (seg.onPress && seg.text) {
        fill.getRectsForRange(offset, offset + seg.text.length).forEach((r, j) => {
          hits.push({ key: `${i}-${j}`, x: r.x, y: r.y, w: r.width, h: r.height, onPress: seg.onPress! });
        });
      }
      offset += seg.text.length;
    });
    return { fill, outline, width, height, hits };
  }, [segments, style, inline, boxWidth, pad]);

  const canvasWidth  = drawn ? drawn.width + pad * 2 : 0;
  const canvasHeight = drawn ? drawn.height + pad * 2 : 0;

  return (
    <View
      style={inline ? { width: canvasWidth, height: canvasHeight } : { width: '100%', height: canvasHeight }}
      onLayout={inline ? undefined : e => setBoxWidth(Math.floor(e.nativeEvent.layout.width))}
    >
      {drawn && (
        <>
          {/* El lienzo no recibe toques: pasan al contenedor (avanzar párrafo) */}
          <View pointerEvents="none" style={{ width: canvasWidth, height: canvasHeight }}>
            <Canvas style={{ width: canvasWidth, height: canvasHeight }}>
              <Paragraph paragraph={drawn.outline} x={pad} y={pad} width={drawn.width} />
              <Paragraph paragraph={drawn.fill} x={pad} y={pad} width={drawn.width} />
            </Canvas>
          </View>
          {drawn.hits.map(h => (
            <Pressable
              key={h.key}
              style={{ position: 'absolute', left: pad + h.x, top: pad + h.y, width: h.w, height: h.h }}
              hitSlop={6}
              onPress={e => h.onPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}
            />
          ))}
        </>
      )}
    </View>
  );
}
