import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppAlert } from '@/components/app-dialog';
import { LEGAL_CONTACT_EMAIL } from '@/constants/legal';
import { t, useLang } from '@/i18n';

// Aviso de traducción automática.
//
// La versión en japonés se ha traducido con IA y nadie que hable japonés la ha revisado.
// La primera vez que la web se pone en japonés en un dispositivo (porque se elige, o
// porque el navegador está en japonés) se avisa de ello y se da el correo para comunicar
// errores. El mismo texto queda fijo bajo el selector de idioma en Ajustes.
//
// No pinta nada: solo lanza el aviso.

const KEY = 'immersa_ja_notice_seen';

export function LanguageNotice() {
  const lang = useLang();
  const firstRun = useRef(true);
  useEffect(() => {
    const atStart = firstRun.current;
    firstRun.current = false;
    if (lang !== 'ja') return;
    let cancelled = false;
    // Al abrir la web se espera a que termine la bienvenida animada
    const timer = setTimeout(async () => {
      try {
        if (cancelled || await AsyncStorage.getItem(KEY)) return;
        await AsyncStorage.setItem(KEY, '1');
      } catch { /* sin almacenamiento: se avisa igualmente */ }
      if (cancelled) return;
      AppAlert.alert(t('lang.aiTitle'), t('lang.aiBody', { email: LEGAL_CONTACT_EMAIL }), [{ text: t('common.ok') }]);
    }, atStart ? 3400 : 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [lang]);
  return null;
}
