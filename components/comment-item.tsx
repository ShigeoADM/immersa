import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';
import type { Role } from '@/constants/permissions';
import type { StoryComment } from '@/services/comments';
import { RoleBadge } from '@/components/role-badge';
import { ts, useT } from '@/i18n';

// Un comentario: avatar a la izquierda, nombre arriba a la izquierda,
// "Cap. 1 · Pág. 3" arriba a la derecha y el texto debajo.
export function CommentItem({ comment, role, showLocation = true, canDelete, onDelete, onReport, onPressUser, colors }: {
  comment: StoryComment;
  role?: Role | null;       // rol actual de quien comenta (insignia DUEÑO / ADMIN)
  showLocation?: boolean;
  canDelete?: boolean;
  onDelete?: (comment: StoryComment) => void;
  onReport?: (comment: StoryComment) => void;   // si se pasa, muestra el botón de denunciar
  onPressUser?: (uid: string) => void;
  colors?: { name: string; text: string; muted: string }; // para fondos que no son el oscuro
}) {
  const initial = comment.userName.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={() => onPressUser?.(comment.uid)} disabled={!onPressUser} activeOpacity={0.7}>
        {comment.userAvatar
          ? <Image source={{ uri: comment.userAvatar }} style={styles.avatar} contentFit="cover" transition={150} />
          : <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
        }
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => onPressUser?.(comment.uid)}
            disabled={!onPressUser}
            activeOpacity={0.7}
          >
            <Text style={[styles.name, colors && { color: colors.name }]} numberOfLines={1}>{comment.userName}</Text>
            <RoleBadge role={role} size="sm" />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            {showLocation && (
              // Webnovel no tiene páginas: los comentarios son del capítulo
              <Text style={styles.location}>
                Cap. {comment.chapterNumber}{comment.pageNumber > 0 ? ` · Pág. ${comment.pageNumber}` : ''}
              </Text>
            )}
            {onReport && (
              <TouchableOpacity onPress={() => onReport(comment)} hitSlop={8}>
                <MaterialIcons name="outlined-flag" size={15} color={colors?.muted ?? Colors.textMuted} />
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity onPress={() => onDelete?.(comment)} hitSlop={8}>
                <MaterialIcons name="delete-outline" size={15} color={colors?.muted ?? Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={[styles.text, colors && { color: colors.text }]}>{comment.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.card },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  avatarInitial:  { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  body:   { flex: 1, gap: 3 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameRow:  { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:     { flexShrink: 1, fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  location: { fontSize: 11, fontWeight: '600', color: Colors.emerald },
  text:     { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});
