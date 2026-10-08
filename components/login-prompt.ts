import { AppAlert } from '@/components/app-dialog';
import { t } from '@/i18n';

// Aviso para invitados (web sin cuenta) cuando intentan algo que necesita cuenta:
// dar me gusta, comentar, guardar… No se les saca de donde están: se les pregunta, y
// solo si aceptan se va a la pantalla de inicio de sesión. Cancelar, o tocar fuera del
// aviso, lo cierra y se sigue leyendo.
export function promptLogin(goToLogin: () => void, reason = 'Necesitas una cuenta para hacer esto.') {
  AppAlert.alert(t('login.promptTitle'), reason, [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('common.login'), onPress: goToLogin },
  ]);
}
