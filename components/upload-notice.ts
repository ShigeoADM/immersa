import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppAlert } from '@/components/app-dialog';

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
    'Antes de subir archivos',
    'Puedes subir las imágenes, la música y los sonidos que quieras, siempre que no sean ilegales.\n\n'
    + 'Si usas material de otra persona y quien tiene sus derechos nos pide retirarlo, tendremos que '
    + 'quitarlo de tu historia. Te avisaremos antes para que puedas cambiarlo.\n\n'
    + 'Lo más seguro es usar material propio o con licencia libre, y nombrar a sus autores en los créditos.',
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Entendido',
        onPress: () => {
          seen = true;
          AsyncStorage.setItem(KEY, '1').catch(() => {});
          upload();
        },
      },
    ],
  );
}
