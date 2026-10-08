import { ts } from '@/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppAlert } from '@/components/app-dialog';
import { UPLOAD_NOTICE } from '@/constants/legal';

// Aviso sobre derechos de autor: sale una sola vez, la primera vez que alguien va a subir
// una imagen o un audio desde este dispositivo.

const KEY = 'immersa_upload_notice_v1';
let seen = false;
AsyncStorage.getItem(KEY).then(v => { if (v) seen = true; }).catch(() => {});

// Ejecuta `upload` (abrir el selector de archivos). La primera vez enseña antes el aviso
// y solo sigue si se acepta.
export function withUploadNotice(upload: () => void) {
  if (seen) { upload(); return; }
  AppAlert.alert(
    ts('Antes de subir archivos'),
    UPLOAD_NOTICE.map(x => ts(x)).join('\n\n'),
    [
      { text: ts('Cancelar'), style: 'cancel' },
      {
        text: ts('Entendido'),
        onPress: () => {
          seen = true;
          AsyncStorage.setItem(KEY, '1').catch(() => {});
          upload();
        },
      },
    ],
  );
}
