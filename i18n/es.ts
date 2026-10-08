// Textos de la web en español. Es el idioma de referencia: las claves de este archivo son
// las que existen, y los demás idiomas (en.ts, ja.ts) tienen que traducirlas todas.
//
// {n}, {name}… son huecos que se rellenan al pedir el texto: t('register.minAge', { n: 13 }).

export const es = {
  // ── Comunes ──
  'common.cancel': 'Cancelar',
  'common.login': 'Iniciar sesión',
  'common.register': 'Registrarse',
  'common.language': 'Idioma',

  // ── Navegación ──
  'nav.profile': 'Mi Perfil',
  'nav.notifications': 'Notificaciones',
  'nav.library': 'Biblioteca',
  'nav.write': 'Escribir',
  'nav.myBooks': 'Mis Libros',
  'nav.dev': 'Desarrollo',
  'nav.switchAccount': 'Cambiar de cuenta',
  'nav.logout': 'Cerrar sesión',
  'tabs.discover': 'Descubrir',
  'tabs.library': 'Biblioteca',
  'tabs.write': 'Escribir',
  'tabs.profile': 'Perfil',

  // ── Inicio ──
  'home.popular': 'Más populares',
  'home.moderno': 'Novelas Modernas',
  'home.webnovel': 'Webnovels',
  'home.modernoNew': 'Nuevas Novelas Modernas',
  'home.webnovelNew': 'Nuevos Webnovels',
  'home.empty': 'Nada por aquí todavía…',

  // ── Estado de una historia ──
  'status.ongoing': 'En curso',
  'status.completed': 'Completada',
  'status.hiatus': 'En pausa',
  'status.upcoming': 'Próximamente',

  // ── Buscador ──
  'search.placeholder': 'Título o autor…',
  'search.noAdult': 'Sin +18',
  'search.noMatch': 'Ninguna historia coincide con la búsqueda.',
  'search.noStories': 'Todavía no hay historias publicadas.',

  // ── Iniciar sesión ──
  'login.tagline': 'Bienvenido de nuevo',
  'login.email': 'Correo electrónico',
  'login.emailPlaceholder': 'tu@correo.com',
  'login.password': 'Contraseña',
  'login.forgot': '¿Olvidaste tu contraseña?',
  'login.noAccount': '¿No tienes cuenta? ',
  'login.signUp': 'Regístrate',
  'login.guest': 'Explorar sin cuenta',
  'login.wrong': 'Correo o contraseña incorrectos.',
  'login.typeEmail': 'Escribe tu correo y pulsa de nuevo "¿Olvidaste tu contraseña?".',
  'login.resetTitle': 'Revisa tu correo',
  'login.resetBody': 'Si hay una cuenta con ese correo, te hemos enviado un enlace para crear una contraseña nueva. Mira también en la carpeta de spam.',
  'login.promptTitle': '¿Quieres iniciar sesión?',

  // ── Crear cuenta ──
  'register.tagline': 'Crea tu cuenta',
  'register.username': 'Nombre de usuario',
  'register.usernamePlaceholder': 'tu_nombre',
  'register.passwordPlaceholder': 'Mínimo 6 caracteres',
  'register.confirm': 'Confirmar contraseña',
  'register.confirmPlaceholder': 'Repite tu contraseña',
  'register.birth': 'Fecha de nacimiento',
  'register.birthHint': 'No se muestra a nadie. Se usa para el contenido +18 y no se puede cambiar después.',
  'register.accept1': 'Acepto los ',
  'register.terms': 'términos de uso',
  'register.accept2': ' y la ',
  'register.privacy': 'política de privacidad',
  'register.accept3': '.',
  'register.submit': 'Crear cuenta',
  'register.haveAccount': '¿Ya tienes cuenta? ',
  'register.signIn': 'Inicia sesión',
  'register.mismatch': 'Las contraseñas no coinciden.',
  'register.short': 'La contraseña debe tener al menos 6 caracteres.',
  'register.birthInvalid': 'Introduce una fecha de nacimiento válida.',
  'register.minAge': 'Debes tener al menos {n} años para crear una cuenta.',
  'register.mustAccept': 'Tienes que aceptar los términos de uso y la política de privacidad.',
  'register.emailTaken': 'Ese correo ya está registrado.',
  'register.error': 'Error al crear la cuenta. Inténtalo de nuevo.',

  // ── Bienvenida ──
  'search.countOne': '{n} historia',
  'search.countMany': '{n} historias',
  'splash.welcome': 'Bienvenido',
};

export type TKey = keyof typeof es;
