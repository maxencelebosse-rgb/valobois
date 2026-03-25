/**
 * Configuration Firebase Web (clés publiques, visibles côté client).
 */
(function (global) {
    'use strict';

    global.valoboisFirebaseConfig =
        global.__VALOBOIS_FIREBASE_CONFIG__ || {
            apiKey: "AIzaSyCahUhOWfXOjnq8-HywaHslF6ejhb0TvrA",
            authDomain: "architecture-inventory.firebaseapp.com",
            projectId: "architecture-inventory",
            storageBucket: "architecture-inventory.appspot.com",
            messagingSenderId: "530247714085",
            appId: "1:530247714085:web:b7ac783a85b057476906cc"
        };
})(typeof window !== 'undefined' ? window : globalThis);
