// Textos legales de la app: términos de uso y política de privacidad.
//
// IMPORTANTE: son una plantilla redactada a partir de lo que la app hace con los datos.
// Deben revisarse (idealmente por un profesional) antes de publicar la app, y
// actualizarse si cambia el tratamiento de datos (publicidad, analítica, pagos…).
//
// Los textos de legal-web/ (para la página web pública) se generan a partir de este
// archivo: si se cambia algo aquí, hay que regenerarlos.

import { ADULT_AGE, MIN_AGE } from '@/constants/age';

// Responsable de la app y del tratamiento de los datos
export const LEGAL_OWNER_NAME = 'Enrique Echevarría Pérez';

// Correo de contacto para cuestiones legales y de privacidad.
export const LEGAL_CONTACT_EMAIL = 'elcodemh@gmail.com';

export const LEGAL_UPDATED_AT = '3 de octubre de 2026';

const CONTACT = LEGAL_CONTACT_EMAIL
  ? `escribiendo a ${LEGAL_CONTACT_EMAIL}`
  : 'a través de los datos de contacto que figuran en la ficha de la app en la tienda';

export type LegalDoc = 'terms' | 'privacy';
export type LegalSection = { title: string; body: string };

export const LEGAL_DOCS: Record<LegalDoc, { title: string; sections: LegalSection[] }> = {
  terms: {
    title: 'Términos de uso',
    sections: [
      {
        title: '1. Qué es Immersa',
        body: `Immersa es un servicio para leer y publicar novelas escritas por sus usuarios, disponible como aplicación móvil y como página web (https://immersa.web.app), desarrollado y operado por ${LEGAL_OWNER_NAME}. Al crear una cuenta o usar la app o la web aceptas estos términos. En la web se puede explorar y leer sin cuenta; para publicar, comentar o guardar historias hace falta registrarse. Si no estás de acuerdo, no la uses.`,
      },
      {
        title: '2. Tu cuenta',
        body: `Para tener una cuenta debes tener al menos ${MIN_AGE} años y dar datos verdaderos, incluida tu fecha de nacimiento. Eres responsable de lo que se haga desde tu cuenta y de mantener tu contraseña en secreto. Puedes eliminar tu cuenta en cualquier momento desde Perfil → Ajustes.`,
      },
      {
        title: '3. El contenido que publicas',
        body: 'Las historias, comentarios, imágenes y audios que subes siguen siendo tuyos. Al publicarlos nos das permiso para almacenarlos y mostrarlos a otros usuarios dentro de la app, únicamente para que el servicio funcione. Solo puedes subir contenido del que seas autor o para el que tengas permiso: no subas obras, imágenes o música de terceros sin autorización.',
      },
      {
        title: '4. Contenido para adultos',
        body: `Si una historia contiene material sexual explícito, gore o violencia extrema, debes marcarla como contenido +18 e indicar el motivo. Ese contenido solo se muestra a usuarios de ${ADULT_AGE} años o más. Marcar mal una historia puede suponer su retirada.

Esto se refiere al texto de la historia. Las imágenes (portadas, fondos y fotos de perfil) nunca pueden mostrar desnudos, actos sexuales ni violencia real, tampoco en historias +18.`,
      },
      {
        title: '5. Lo que no está permitido',
        body: 'No se permite: contenido sexual con menores o que los sexualice; imágenes con desnudos, contenido sexual explícito o violencia real; incitación al odio, acoso o amenazas; contenido ilegal o que promueva actividades ilegales; plagio o infracción de derechos de autor; spam, engaños o suplantación de identidad; intentar manipular estadísticas, acceder a cuentas ajenas o dañar el servicio.',
      },
      {
        title: '6. Moderación y denuncias',
        body: 'Puedes denunciar historias y comentarios desde la propia app. El equipo de moderación puede retirar contenido que incumpla estos términos y, en casos graves o reiterados, suspender o eliminar la cuenta. Cuando se retira una historia se avisa a su autor.',
      },
      {
        title: '7. Disponibilidad y responsabilidad',
        body: 'La app se ofrece tal cual. Hacemos lo posible por que funcione bien, pero no garantizamos que esté siempre disponible ni libre de errores, y puede cambiar o dejar de ofrecerse. El contenido publicado por los usuarios es responsabilidad de quien lo publica y no refleja la opinión de Immersa. Te recomendamos conservar copia de tus textos.',
      },
      {
        title: '8. Cambios en estos términos',
        body: `Podemos actualizar estos términos. Si el cambio es importante, se avisará dentro de la app. Seguir usando la app después del cambio supone aceptarlo. Para cualquier duda puedes contactar ${CONTACT}.`,
      },
    ],
  },
  privacy: {
    title: 'Política de privacidad',
    sections: [
      {
        title: '1. Quién es el responsable',
        body: `${LEGAL_OWNER_NAME} (en adelante, "nosotros") desarrolla y opera la aplicación móvil Immersa y es el responsable del tratamiento de los datos personales de sus usuarios. Esta política explica qué datos recogemos, para qué los usamos y qué puedes hacer con ellos. Al usar Immersa aceptas lo que se describe aquí.`,
      },
      {
        title: '2. Qué datos recogemos',
        body: 'Datos de cuenta: correo electrónico, nombre de usuario, contraseña (cifrada, no podemos verla) y fecha de nacimiento.\n\nDatos de perfil que tú decides añadir: foto, biografía y si quieres mostrar tu correo.\n\nContenido que publicas: historias, capítulos, imágenes, audios y comentarios.\n\nActividad en la app: historias que guardas o lees y por dónde vas, marcadores, me gusta, autores que sigues y notificaciones.\n\nDatos técnicos: los servicios de Google que usa la app pueden registrar automáticamente datos como la dirección IP, el modelo del dispositivo o la versión del sistema operativo, necesarios para prestar el servicio.',
      },
      {
        title: '3. Para qué los usamos',
        body: 'Únicamente para que la app funcione: identificarte, guardar tu progreso de lectura, mostrar tu contenido a otros lectores, avisarte de novedades (capítulos nuevos, comentarios, avisos del equipo), comprobar la edad para el contenido +18, mostrar a cada autor estadísticas agregadas de sus historias y moderar el contenido. No vendemos tus datos, no los usamos para publicidad y la app no incluye herramientas de analítica ni de seguimiento publicitario.',
      },
      {
        title: '4. Qué ven los demás',
        body: 'Es público: tu nombre de usuario, foto, biografía, las historias que publicas, tus comentarios y, si tienes un cargo, tu insignia. Lo ven los demás usuarios y también quien visita la versión web sin cuenta, y puede aparecer en buscadores. Tu correo solo es visible si lo activas en Ajustes; en ese caso también es público.\n\nEs privado: tu fecha de nacimiento, tu biblioteca, tu progreso de lectura, tus marcadores y tus notificaciones. Los autores ven cuántas personas leen o guardan sus historias, pero no quiénes son.',
      },
      {
        title: '5. Dónde se guardan y servicios de terceros',
        body: 'Los datos se almacenan en Firebase, un servicio de Google (autenticación, base de datos, almacenamiento de archivos y alojamiento de la versión web), que actúa como proveedor técnico y puede tratar datos en servidores fuera de tu país con las garantías que exige la normativa. En Android la app usa además los Servicios de Google Play, necesarios para su funcionamiento. La versión web carga una tipografía desde Google Fonts y guarda en tu navegador los datos necesarios para mantener la sesión y tus preferencias de lectura; no usa cookies publicitarias ni de seguimiento.\n\nPuedes consultar cómo tratan los datos en la Política de Privacidad de Google (https://policies.google.com/privacy) y en la página de privacidad y seguridad de Firebase (https://firebase.google.com/support/privacy).\n\nAlgunas preferencias (tema de lectura, tamaño de letra, borradores) se guardan solo en tu dispositivo.',
      },
      {
        title: '6. Permisos que pide la app',
        body: 'Notificaciones: para avisarte de novedades (capítulos nuevos, comentarios, avisos del equipo). Las genera tu propio móvil al comprobar si hay novedades y puedes desactivarlas en los ajustes del sistema en cualquier momento.\n\nGalería de imágenes: solo cuando eliges una foto de perfil, una portada o un fondo para una historia. La app solo accede a la imagen que tú seleccionas.\n\nArchivos de audio: solo cuando eliges una pista de música o un efecto de sonido para una historia.\n\nLa app no accede a tus fotos ni a tus archivos por su cuenta: únicamente a los que tú eliges, y solo se suben cuando los añades.',
      },
      {
        title: '7. Contenido y enlaces externos',
        body: 'Los autores pueden incluir en sus historias imágenes o audios alojados en servicios externos (por ejemplo, un enlace de Google Drive). Al leer esas historias, tu dispositivo se conecta a esos servicios para descargarlos, y estos pueden registrar datos técnicos como tu dirección IP. Esos sitios no están operados por nosotros y se rigen por sus propias políticas de privacidad.',
      },
      {
        title: '8. Seguridad',
        body: 'Aplicamos medidas razonables para proteger tus datos: las conexiones van cifradas, las contraseñas se guardan cifradas y el acceso a la información está limitado por reglas de seguridad (por ejemplo, nadie más puede leer tu biblioteca ni tu fecha de nacimiento). Aun así, ningún método de transmisión por internet ni de almacenamiento electrónico es 100 % seguro, por lo que no podemos garantizar una seguridad absoluta.',
      },
      {
        title: '9. Cuánto tiempo los conservamos',
        body: 'Mientras tengas la cuenta. Al eliminarla desde Perfil → Ajustes se borran tu perfil, tus historias, tu biblioteca, tus notificaciones y tus me gusta. Los comentarios que hayas dejado en historias de otras personas pueden permanecer; si quieres que se retiren, escríbenos.',
      },
      {
        title: '10. Tus derechos',
        body: `Puedes acceder a tus datos, corregirlos, pedir su eliminación, oponerte a su uso o solicitar una copia. La mayoría de estas acciones puedes hacerlas tú mismo desde la app; para el resto, contacta ${CONTACT}. También tienes derecho a reclamar ante la autoridad de protección de datos de tu país.`,
      },
      {
        title: '11. Menores',
        body: `La app no está dirigida a menores de ${MIN_AGE} años y no se permite crear una cuenta por debajo de esa edad. Si descubrimos que un menor de esa edad nos ha facilitado datos, eliminaremos su cuenta. El contenido marcado como +18 solo se muestra a usuarios de ${ADULT_AGE} años o más.`,
      },
      {
        title: '12. Cambios en esta política y contacto',
        body: `Si cambia la forma en que tratamos tus datos, actualizaremos esta política y avisaremos dentro de la app cuando el cambio sea relevante. Para cualquier pregunta sobre esta política puedes contactar ${CONTACT}.`,
      },
    ],
  },
};
