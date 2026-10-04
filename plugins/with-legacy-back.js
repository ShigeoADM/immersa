const { withAndroidManifest } = require('expo/config-plugins');

// Al orientar la app a Android 16 (API 36), el gesto de "atrás predictivo" se activa
// solo. Con él, el sistema deja de avisar a la app del botón atrás por la vía clásica,
// que es la que usan los avisos de "cambios sin guardar" y el lector. Se deja
// desactivado de forma explícita para que "atrás" funcione igual que hasta ahora.
module.exports = function withLegacyBack(config) {
  return withAndroidManifest(config, cfg => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) application.$['android:enableOnBackInvokedCallback'] = 'false';
    return cfg;
  });
};
