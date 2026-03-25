/**
 * Initialise l’app Firebase par défaut une seule fois et renvoie firebase.auth().
 * Nécessite les scripts compat firebase-app et firebase-auth, et valoboisFirebaseConfig.
 */
(function (global) {
    'use strict';

    function getValoboisAuth() {
        if (!global.firebase) {
            return null;
        }
        var cfg = global.valoboisFirebaseConfig;
        if (!cfg || !cfg.apiKey || cfg.apiKey === 'REPLACE_ME') {
            return null;
        }
        var app;
        try {
            app = global.firebase.app();
        } catch (e) {
            app = global.firebase.initializeApp(cfg);
        }
        return app.auth();
    }

    global.getValoboisAuth = getValoboisAuth;
})(typeof window !== 'undefined' ? window : globalThis);
