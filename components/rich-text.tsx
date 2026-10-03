import React from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { parseRichText } from '@/constants/webnovel';

// Pinta el contenido de un capítulo Webnovel: un párrafo por línea, con **negrita**
// y *cursiva*. Las líneas en blanco no se pintan (el espaciado lo da paragraphSpacing).
export const RichText = React.memo(function RichText({ content, style, paragraphSpacing }: {
  content: string;
  style: TextStyle;
  paragraphSpacing: number;
}) {
  const paragraphs = content.split('\n').filter(line => line.trim().length > 0);
  return (
    <View>
      {paragraphs.map((line, i) => (
        <Text key={i} style={[style, { marginBottom: paragraphSpacing }]}>
          {parseRichText(line).map((seg, j) =>
            seg.bold || seg.italic
              ? <Text
                  key={j}
                  style={{
                    fontWeight: seg.bold ? '700' : undefined,
                    fontStyle: seg.italic ? 'italic' : undefined,
                  }}
                >{seg.text}</Text>
              : seg.text
          )}
        </Text>
      ))}
    </View>
  );
});
