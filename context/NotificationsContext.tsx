import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import {
  registerBackgroundSync, setupNotificationPermissions, syncNotifications,
} from '@/services/notifications';

interface NotificationsContextType {
  unreadCount: number;
}

const NotificationsContext = createContext<NotificationsContextType>({ unreadCount: 0 });

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  // Contador de no leídas en tiempo real
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    return onSnapshot(
      query(collection(db, 'users', user.uid, 'notifications'), where('read', '==', false)),
      snap => setUnreadCount(snap.size),
      e => console.error('Error escuchando notificaciones:', e),
    );
  }, [user]);

  // Permisos, tarea en segundo plano y sincronización al entrar y al volver a la app
  useEffect(() => {
    if (!user) return;
    const sync = () => syncNotifications(user.uid)
      .catch(e => console.error('Error sincronizando notificaciones:', e));

    (async () => {
      try {
        if (await setupNotificationPermissions()) await registerBackgroundSync();
      } catch (e) {
        // En Expo Go la tarea en segundo plano puede no estar disponible
        console.warn('Notificaciones en segundo plano no disponibles:', e);
      }
      sync();
    })();

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });
    return () => sub.remove();
  }, [user]);

  return (
    <NotificationsContext.Provider value={{ unreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
