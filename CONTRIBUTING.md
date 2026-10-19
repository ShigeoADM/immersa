# Colaborar con Immersa · Contributing

*English below.*

## Español

¡Gracias por querer ayudar! Antes de empezar, lee la [licencia](LICENSE.md): el código es visible, pero no es código abierto. Puedes modificarlo para proponer mejoras a Immersa, no para usarlo en otro proyecto. **Al enviar una aportación aceptas el punto 3 de la licencia** (cedes los derechos sobre ella al titular de Immersa).

### Cómo proponer un cambio

1. Abre primero un *issue* contando qué quieres cambiar, sobre todo si es algo grande. Así evitamos trabajo que luego no encaje.
2. Haz un *fork*, crea una rama y trabaja en ella.
3. Comprueba que el proyecto compila sin errores nuevos: `npx tsc --noEmit -p .`
4. Abre un *pull request* explicando qué cambia y cómo probarlo. Capturas o un vídeo corto ayudan mucho.

Publicar la web (immersa.web.app) lo hace solo el titular.

### Preparar el entorno

Necesitas Node.js 20 o superior.

1. `npm install`
2. **Usa tu propio proyecto de Firebase de pruebas**, nunca el de Immersa:
   - Crea un proyecto gratuito en https://console.firebase.google.com con *Authentication* (correo y contraseña) y *Firestore*.
   - Copia `.env.example` como `.env` y rellénalo con los datos de la app web de tu proyecto.
   - Publica en tu proyecto las reglas de `firestore.rules` (y `storage.rules` si usas Storage).
   - Sin `.env`, la app se conecta al proyecto real de Immersa: no lo hagas para desarrollar.
3. `npx expo start --web`

### Normas del código

- Los comentarios y los textos de la interfaz se escriben en español.
- Todo texto visible pasa por el sistema de idiomas (`i18n/`): `t('clave')` o `ts('Texto en español')`, con su traducción al inglés y al japonés.
- La web es la prioridad: lo que se cambie tiene que funcionar en navegador de escritorio y de móvil.
- Cambios pequeños y centrados en una cosa: son más fáciles de revisar.

## English

Thanks for wanting to help! Before you start, read the [license](LICENSE.md): the code is visible, but it is not open source. You may modify it to propose improvements to Immersa, not to use it in another project. **By submitting a contribution you accept section 3 of the license** (you assign its rights to the owner of Immersa).

### How to propose a change

1. Open an issue first describing what you want to change, especially for anything large.
2. Fork the repository, create a branch and work on it.
3. Check that the project builds without new errors: `npx tsc --noEmit -p .`
4. Open a pull request explaining what changes and how to test it. Screenshots or a short video help a lot.

Only the owner publishes the website (immersa.web.app).

### Setting up

You need Node.js 20 or newer.

1. `npm install`
2. **Use your own Firebase test project**, never Immersa's:
   - Create a free project at https://console.firebase.google.com with Authentication (email and password) and Firestore.
   - Copy `.env.example` to `.env` and fill it in with your project's web app settings.
   - Publish the rules from `firestore.rules` (and `storage.rules` if you use Storage) to your project.
   - Without `.env` the app connects to Immersa's real project: don't do that for development.
3. `npx expo start --web`

### Code guidelines

- Code comments and interface texts are written in Spanish.
- Every visible text goes through the language system (`i18n/`): `t('key')` or `ts('Texto en español')`, with its English and Japanese translations.
- The website comes first: changes must work in desktop and mobile browsers.
- Keep changes small and focused on one thing: they are easier to review.
