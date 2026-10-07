// Roles y permisos de administración.
//
//   · owner  (dueño): tiene todos los permisos. Solo se asigna desde la consola de
//     Firebase y nadie puede modificarlo desde la app.
//   · admin: tiene únicamente los permisos de su lista `permissions`.
//
// Se guardan en users/{uid}: { role: 'owner' | 'admin', permissions: Permission[] }.
// La app usa esto para decidir qué MOSTRAR; lo que de verdad se permite lo imponen
// las reglas de Firestore (firestore.rules), que repiten esta misma lógica.

export type Role = 'owner' | 'admin';
export type Permission = 'deleteStories' | 'announcements' | 'manageAdmins' | 'developer';

export const PERMISSIONS: { key: Permission; label: string; description: string }[] = [
  { key: 'deleteStories', label: 'Moderar contenido',         description: 'Atender denuncias y borrar historias y comentarios' },
  { key: 'announcements', label: 'Publicar avisos',           description: 'Enviar noticias y avisos a todos' },
  { key: 'manageAdmins',  label: 'Gestionar administradores', description: 'Nombrar admins y cambiar sus permisos' },
  { key: 'developer',     label: 'Desarrollo',                description: 'Entrar en la web de desarrollo y probar las novedades antes de publicarlas' },
];

export const ROLE_LABELS: Record<Role, string> = { owner: 'Dueño', admin: 'Administrador' };

export interface Staff {
  role: Role | null;
  permissions: Permission[];
}

export const hasPermission = (staff: Staff, permission: Permission) =>
  staff.role === 'owner' || (staff.role === 'admin' && staff.permissions.includes(permission));

// ¿Puede `actor` conceder o retirar `permission` a otro administrador?
//   · El dueño, cualquiera.
//   · Un gestor, solo permisos que él mismo tiene, y nunca el de gestionar administradores.
export const canGrant = (actor: Staff, permission: Permission) =>
  actor.role === 'owner' ||
  (hasPermission(actor, 'manageAdmins') && permission !== 'manageAdmins' && actor.permissions.includes(permission));

// ¿Puede `actor` modificar (permisos o baja) a `target`?
//   · Nadie al dueño. · El dueño, a cualquier admin.
//   · Un gestor, solo a admins "por debajo" de él: que no sean gestores y que no tengan
//     ningún permiso que el gestor no tenga.
export const canManage = (actor: Staff, target: Staff) =>
  target.role !== 'owner' && (
    actor.role === 'owner' ||
    (hasPermission(actor, 'manageAdmins')
      && !target.permissions.includes('manageAdmins')
      && target.permissions.every(p => actor.permissions.includes(p)))
  );
