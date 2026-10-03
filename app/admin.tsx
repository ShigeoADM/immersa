import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import {
  PERMISSIONS, ROLE_LABELS, type Permission, canGrant, canManage,
} from '@/constants/permissions';
import {
  type AdminUser, type Announcement, type AnnouncementType,
  addAdmin, deleteAnnouncement, findUserByEmail, listAnnouncements, listStaff,
  publishAnnouncement, removeAdmin, setAdminPermission,
} from '@/services/admin';
import { type Report, dismissReport, listReports, reportReasonLabel } from '@/services/reports';
import { deleteComment } from '@/services/comments';

const TYPES: { value: AnnouncementType; label: string; icon: string }[] = [
  { value: 'news',  label: 'Noticia',                 icon: 'campaign' },
  { value: 'admin', label: 'Aviso de administración', icon: 'admin-panel-settings' },
];

export default function AdminScreen() {
  const router = useRouter();
  const { user, staff, isStaff, can, loading: authLoading } = useAuth();
  const canAnnounce = can('announcements');
  const canManageAdmins = can('manageAdmins');
  const canModerate = can('deleteStories');
  const [reports, setReports] = useState<Report[]>([]);

  // Publicar aviso
  const [type, setType]   = useState<AnnouncementType>('news');
  const [title, setTitle] = useState('');
  const [body, setBody]   = useState('');
  const [publishing, setPublishing] = useState(false);

  // Listas
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [team, setTeam]                   = useState<AdminUser[]>([]);
  const [loading, setLoading]             = useState(true);

  // Añadir administrador / cambios en curso
  const [email, setEmail]   = useState('');
  const [adding, setAdding] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  // Cada sección solo se carga si se tiene el permiso (si no, las reglas lo rechazarían)
  const load = useCallback(async () => {
    try {
      const [a, t, r] = await Promise.all([
        canAnnounce ? listAnnouncements() : Promise.resolve([]),
        canManageAdmins ? listStaff() : Promise.resolve([]),
        canModerate ? listReports() : Promise.resolve([]),
      ]);
      setAnnouncements(a);
      setTeam(t);
      setReports(r);
    } catch (e) {
      console.error('Error cargando el panel de administración:', e);
    } finally {
      setLoading(false);
    }
  }, [canAnnounce, canManageAdmins, canModerate]);

  useFocusEffect(useCallback(() => { if (isStaff) load(); }, [isStaff, load]));

  // ── Denuncias ─────────────────────────────────────────────────────────────
  const closeReport = async (r: Report) => {
    try {
      await dismissReport(r.id);
      setReports(prev => prev.filter(x => x.id !== r.id));
    } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo cerrar la denuncia.'); }
  };

  const handleDeleteReportedComment = (r: Report) => {
    AppAlert.alert('Borrar comentario', 'Se borrará el comentario denunciado y se cerrará la denuncia.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          try {
            if (r.commentId) await deleteComment(r.storyId, r.commentId);
            // Se cierran todas las denuncias sobre ese mismo comentario
            const same = reports.filter(x => x.type === 'comment' && x.commentId === r.commentId);
            await Promise.all(same.map(x => dismissReport(x.id)));
            setReports(prev => prev.filter(x => !same.includes(x)));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo borrar el comentario.'); }
        },
      },
    ]);
  };

  // ── Avisos ────────────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!title.trim() || !body.trim() || publishing) return;
    setPublishing(true);
    try {
      await publishAnnouncement(type, title, body);
      setTitle(''); setBody('');
      await load();
      AppAlert.alert('Publicado', 'Los usuarios lo recibirán como notificación la próxima vez que abran la app.');
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo publicar el aviso.');
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteAnnouncement = (a: Announcement) => {
    AppAlert.alert('Retirar aviso', `"${a.title}" dejará de enviarse. Quien ya lo recibió lo conserva.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retirar', style: 'destructive',
        onPress: async () => {
          try {
            await deleteAnnouncement(a.id);
            setAnnouncements(prev => prev.filter(x => x.id !== a.id));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo retirar el aviso.'); }
        },
      },
    ]);
  };

  // ── Administradores ───────────────────────────────────────────────────────
  const handleAddAdmin = async () => {
    if (!email.trim() || adding) return;
    setAdding(true);
    try {
      const found = await findUserByEmail(email);
      if (!found) {
        AppAlert.alert('Usuario no encontrado', 'No hay ninguna cuenta registrada con ese correo.');
        return;
      }
      if (found.role) {
        AppAlert.alert('Ya está en el equipo', `${found.name} ya es ${ROLE_LABELS[found.role].toLowerCase()}.`);
        return;
      }
      AppAlert.alert(
        'Nombrar administrador',
        `${found.name} (${found.email}) entrará sin ningún permiso. Después podrás concederle los que quieras.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Nombrar',
            onPress: async () => {
              try {
                await addAdmin(found.uid);
                setTeam(prev => [...prev, { ...found, role: 'admin', permissions: [] }]);
                setEmail('');
              } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo nombrar al administrador.'); }
            },
          },
        ],
      );
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo buscar al usuario.');
    } finally {
      setAdding(false);
    }
  };

  const handleTogglePermission = async (member: AdminUser, permission: Permission) => {
    if (busyUid) return;
    const granted = !member.permissions.includes(permission);
    setBusyUid(member.uid);
    try {
      await setAdminPermission(member.uid, permission, granted);
      setTeam(prev => prev.map(m => m.uid !== member.uid ? m : {
        ...m,
        permissions: granted ? [...m.permissions, permission] : m.permissions.filter(p => p !== permission),
      }));
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo cambiar el permiso.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleRemoveAdmin = (member: AdminUser) => {
    AppAlert.alert('Quitar administrador', `${member.name} perderá todos sus permisos de administración.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar', style: 'destructive',
        onPress: async () => {
          try {
            await removeAdmin(member.uid);
            setTeam(prev => prev.filter(m => m.uid !== member.uid));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo quitar al administrador.'); }
        },
      },
    ]);
  };

  const header = (
    <SafeAreaView edges={['top']} style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Administración</Text>
      <View style={styles.backBtn} />
    </SafeAreaView>
  );

  if (authLoading || !isStaff) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        {header}
        <View style={styles.centered}>
          {authLoading
            ? <ActivityIndicator color={Colors.emerald} />
            : <Text style={styles.muted}>No tienes permisos de administración.</Text>}
        </View>
      </View>
    );
  }

  const canPublish = title.trim().length > 0 && body.trim().length > 0 && !publishing;
  const myPermissions = PERMISSIONS.filter(p => can(p.key));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {header}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* ── Tu rol ── */}
        <View style={styles.roleCard}>
          <MaterialIcons name={staff.role === 'owner' ? 'verified-user' : 'shield'} size={22} color={Colors.emerald} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{staff.role ? ROLE_LABELS[staff.role] : ''}</Text>
            <Text style={styles.rowSub}>
              {staff.role === 'owner'
                ? 'Tienes todos los permisos.'
                : myPermissions.length > 0
                  ? myPermissions.map(p => p.label).join(' · ')
                  : 'Todavía no tienes ningún permiso asignado.'}
            </Text>
          </View>
        </View>

        {/* ── Denuncias ── */}
        {canModerate && (
          <>
            <Text style={styles.sectionTitle}>
              Denuncias{reports.length > 0 ? ` · ${reports.length}` : ''}
            </Text>
            <Text style={styles.hint}>
              Para eliminar una historia, ábrela: verás el botón de moderación (mazo) arriba a la derecha.
            </Text>
            {loading ? (
              <ActivityIndicator color={Colors.emerald} style={{ marginVertical: 12 }} />
            ) : reports.length === 0 ? (
              <Text style={styles.muted}>No hay denuncias pendientes.</Text>
            ) : reports.map(r => (
              <View key={r.id} style={styles.memberCard}>
                <View style={styles.memberHeader}>
                  <MaterialIcons name={r.type === 'comment' ? 'chat-bubble' : 'menu-book'} size={16} color="#FF6B6B" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.type === 'comment' ? 'Comentario en ' : ''}{r.storyTitle || 'Historia'}
                    </Text>
                    <Text style={styles.rowSub}>{reportReasonLabel(r.reason)}</Text>
                  </View>
                  <Text style={styles.rowDate}>{new Date(r.createdAt).toLocaleDateString()}</Text>
                </View>
                {r.commentText ? <Text style={styles.reportQuote} numberOfLines={4}>"{r.commentText}"</Text> : null}
                {r.details ? <Text style={styles.rowSub}>Detalles: {r.details}</Text> : null}
                <View style={styles.permRow}>
                  <TouchableOpacity style={styles.permChip} onPress={() => router.push(`/story/${r.storyId}`)} activeOpacity={0.8}>
                    <MaterialIcons name="open-in-new" size={13} color={Colors.textSecondary} />
                    <Text style={styles.permChipText}>Abrir historia</Text>
                  </TouchableOpacity>
                  {r.type === 'comment' && (
                    <TouchableOpacity style={styles.permChip} onPress={() => handleDeleteReportedComment(r)} activeOpacity={0.8}>
                      <MaterialIcons name="delete-outline" size={13} color="#FF6B6B" />
                      <Text style={[styles.permChipText, { color: '#FF6B6B' }]}>Borrar comentario</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.permChip} onPress={() => closeReport(r)} activeOpacity={0.8}>
                    <MaterialIcons name="check" size={13} color={Colors.textSecondary} />
                    <Text style={styles.permChipText}>Cerrar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Avisos ── */}
        {canAnnounce && (
          <>
            <Text style={styles.sectionTitle}>Publicar aviso</Text>
            <Text style={styles.hint}>Llega a todos los usuarios como notificación.</Text>
            <View style={styles.typeRow}>
              {TYPES.map(t => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeBtn, type === t.value && styles.typeBtnActive]}
                  onPress={() => setType(t.value)}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={t.icon as any} size={15} color={type === t.value ? '#000' : Colors.textSecondary} />
                  <Text style={[styles.typeBtnText, type === t.value && { color: '#000' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Título"
              placeholderTextColor={Colors.textMuted}
              maxLength={80}
            />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={body}
              onChangeText={setBody}
              placeholder="Mensaje"
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, !canPublish && { opacity: 0.4 }]}
              onPress={handlePublish}
              disabled={!canPublish}
              activeOpacity={0.85}
            >
              {publishing
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.primaryBtnText}>Publicar</Text>}
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>Últimos avisos</Text>
            {loading ? (
              <ActivityIndicator color={Colors.emerald} style={{ marginVertical: 12 }} />
            ) : announcements.length === 0 ? (
              <Text style={styles.muted}>Todavía no se ha publicado ningún aviso.</Text>
            ) : announcements.map(a => (
              <View key={a.id} style={styles.row}>
                <MaterialIcons
                  name={a.type === 'admin' ? 'admin-panel-settings' : 'campaign'}
                  size={18}
                  color={a.type === 'admin' ? '#FFD700' : Colors.emerald}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.rowSub} numberOfLines={2}>{a.body}</Text>
                  <Text style={styles.rowDate}>{new Date(a.createdAt).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteAnnouncement(a)} hitSlop={8}>
                  <MaterialIcons name="delete-outline" size={18} color="#FF6B6B" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── Equipo y permisos ── */}
        {canManageAdmins && (
          <>
            <Text style={styles.sectionTitle}>Equipo y permisos</Text>
            <Text style={styles.hint}>
              {staff.role === 'owner'
                ? 'Toca un permiso para concederlo o retirarlo.'
                : 'Puedes conceder los permisos que tú tienes, salvo el de gestionar administradores.'}
            </Text>
            {loading ? (
              <ActivityIndicator color={Colors.emerald} style={{ marginVertical: 12 }} />
            ) : team.map(member => {
              const isMe = member.uid === user?.uid;
              const manageable = !isMe && canManage(staff, member);
              return (
                <View key={member.uid} style={styles.memberCard}>
                  <View style={styles.memberHeader}>
                    <MaterialIcons
                      name={member.role === 'owner' ? 'verified-user' : 'shield'}
                      size={18}
                      color={member.role === 'owner' ? '#FFD700' : Colors.emerald}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {member.name}{isMe ? ' (tú)' : ''}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>{member.email}</Text>
                    </View>
                    {manageable && (
                      <TouchableOpacity onPress={() => handleRemoveAdmin(member)} hitSlop={8}>
                        <MaterialIcons name="person-remove" size={18} color="#FF6B6B" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {member.role === 'owner' ? (
                    <Text style={styles.rowDate}>Dueño · todos los permisos</Text>
                  ) : (
                    <View style={styles.permRow}>
                      {PERMISSIONS.map(p => {
                        const on = member.permissions.includes(p.key);
                        const editable = manageable && canGrant(staff, p.key) && busyUid !== member.uid;
                        return (
                          <TouchableOpacity
                            key={p.key}
                            style={[styles.permChip, on && styles.permChipOn, !editable && { opacity: on ? 0.7 : 0.4 }]}
                            onPress={() => handleTogglePermission(member, p.key)}
                            disabled={!editable}
                            activeOpacity={0.8}
                          >
                            <MaterialIcons
                              name={on ? 'check-circle' : 'radio-button-unchecked'}
                              size={13}
                              color={on ? '#000' : Colors.textSecondary}
                            />
                            <Text style={[styles.permChipText, on && { color: '#000' }]}>{p.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}

            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={email}
                onChangeText={setEmail}
                placeholder="Correo del nuevo administrador"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TouchableOpacity
                style={[styles.addBtn, (!email.trim() || adding) && { opacity: 0.4 }]}
                onPress={handleAddAdmin}
                disabled={!email.trim() || adding}
                activeOpacity={0.85}
              >
                {adding
                  ? <ActivityIndicator size="small" color="#000" />
                  : <MaterialIcons name="person-add" size={18} color="#000" />}
              </TouchableOpacity>
            </View>
          </>
        )}
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
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content:     { padding: 20, paddingBottom: 48 },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 12,
    backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.emerald + '40',
  },
  sectionTitle:{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginTop: 20, marginBottom: 6 },
  hint:        { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },
  muted:       { fontSize: 13, color: Colors.textMuted },
  typeRow:     { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  typeBtnActive: { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  typeBtnText:   { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary, fontSize: 14, marginBottom: 10,
  },
  inputMultiline: { minHeight: 90 },
  primaryBtn: {
    backgroundColor: Colors.emerald, borderRadius: 6, paddingVertical: 12, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: '#000' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border + '60',
  },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  rowSub:   { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  rowDate:  { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  memberCard: {
    padding: 12, marginBottom: 8, gap: 10,
    backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
  },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reportQuote:  { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', lineHeight: 19 },
  permRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  permChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg,
  },
  permChipOn:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  permChipText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  addRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 10 },
  addBtn: {
    width: 44, height: 44, borderRadius: 6, backgroundColor: Colors.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
});
