// Denuncias de historias y comentarios: reports/{id}.
// Las crea cualquier usuario; las ve y resuelve el equipo de moderación (permiso
// 'deleteStories') desde el panel de administración.

import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';

export const REPORT_REASONS = [
  { key: 'adult',     label: 'Contenido +18 sin marcar' },
  { key: 'minors',    label: 'Contenido sexual con menores' },
  { key: 'hate',      label: 'Odio, acoso o amenazas' },
  { key: 'copyright', label: 'Plagio o derechos de autor' },
  { key: 'spam',      label: 'Spam o engaño' },
  { key: 'other',     label: 'Otro motivo' },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]['key'];

export const REPORT_DETAILS_MAX = 300;
export const reportReasonLabel = (key: string) =>
  REPORT_REASONS.find(r => r.key === key)?.label ?? key;

export type ReportTarget =
  | { type: 'story'; storyId: string; storyTitle: string; targetUid?: string | null }
  | { type: 'comment'; storyId: string; storyTitle: string; commentId: string; commentText: string; targetUid?: string | null };

export interface Report {
  id: string;
  type: 'story' | 'comment';
  storyId: string;
  storyTitle: string;
  commentId?: string;
  commentText?: string;
  targetUid?: string | null;
  reason: ReportReason;
  details: string;
  reporterUid: string;
  createdAt: string;
}

// Una denuncia por usuario y contenido: el id es fijo, así no se puede repetir.
// Devuelve false si ese usuario ya lo había denunciado.
export async function sendReport(target: ReportTarget, reason: ReportReason, details: string): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Inicia sesión para denunciar.');
  const targetId = target.type === 'comment' ? target.commentId : target.storyId;
  try {
    await setDoc(doc(db, 'reports', `${target.type}_${targetId}_${uid}`), {
      ...target,
      targetUid: target.targetUid ?? null,
      reason,
      details: details.trim().slice(0, REPORT_DETAILS_MAX),
      reporterUid: uid,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch (e: any) {
    // Las reglas no dejan sobrescribir una denuncia existente
    if (e?.code === 'permission-denied') return false;
    throw e;
  }
}

export async function listReports(max = 50): Promise<Report[]> {
  const snap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Report, 'id'>) }));
}

// Cerrar una denuncia (ya atendida o descartada)
export const dismissReport = (id: string) => deleteDoc(doc(db, 'reports', id));
