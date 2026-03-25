(function () {
    'use strict';

    var REDIRECT = 'index.html';

    function mapAuthError(code) {
        var messages = {
            'auth/invalid-email': 'Adresse e-mail invalide.',
            'auth/user-disabled': 'Ce compte a été désactivé.',
            'auth/user-not-found': 'Aucun compte ne correspond à cet e-mail.',
            'auth/wrong-password': 'Mot de passe incorrect.',
            'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
            'auth/email-already-in-use': 'Un compte existe déjà avec cet e-mail.',
            'auth/weak-password': 'Le mot de passe est trop faible (minimum 6 caractères).',
            'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
            'auth/network-request-failed': 'Problème de réseau. Vérifiez votre connexion.',
            'auth/operation-not-allowed': 'La connexion par e-mail n’est pas activée sur ce projet Firebase.',
        };
        return messages[code] || 'Une erreur est survenue. Réessayez.';
    }

    function showError(el, err) {
        if (!el) return;
        var code = err && err.code ? err.code : '';
        el.textContent = code ? mapAuthError(code) : (err && err.message) || 'Erreur inconnue.';
        el.hidden = false;
    }

    function clearError(el) {
        if (!el) return;
        el.textContent = '';
        el.hidden = true;
    }

    function goHome() {
        window.location.href = REDIRECT;
    }

    document.addEventListener('DOMContentLoaded', function () {
        var auth = typeof getValoboisAuth === 'function' ? getValoboisAuth() : null;
        var errEl = document.getElementById('authError');
        var tabSignIn = document.getElementById('tabSignIn');
        var tabSignUp = document.getElementById('tabSignUp');
        var panelSignIn = document.getElementById('panelSignIn');
        var panelSignUp = document.getElementById('panelSignUp');
        var formSignIn = document.getElementById('formSignIn');
        var formSignUp = document.getElementById('formSignUp');
        var configHint = document.getElementById('authConfigHint');

        if (!auth) {
            if (configHint) configHint.hidden = false;
            if (errEl) {
                errEl.hidden = false;
                errEl.textContent =
                    'Firebase n’est pas configuré. Renseignez js/config/firebase-config.js (voir commentaires en tête du fichier).';
            }
            var formsBlockEarly = document.getElementById('authFormsBlock');
            var loggedPanelEarly = document.getElementById('authLoggedInPanel');
            if (formsBlockEarly) formsBlockEarly.classList.add('hidden');
            if (loggedPanelEarly) loggedPanelEarly.classList.add('hidden');
            return;
        }

        if (configHint) configHint.hidden = true;

        var loggedPanel = document.getElementById('authLoggedInPanel');
        var formsBlock = document.getElementById('authFormsBlock');
        var loggedEmailEl = document.getElementById('authLoggedInEmail');

        function updateLoggedInUI(user) {
            if (user && user.email) {
                if (loggedEmailEl) loggedEmailEl.textContent = user.email;
                if (loggedPanel) loggedPanel.classList.remove('hidden');
                if (formsBlock) formsBlock.classList.add('hidden');
            } else {
                if (loggedPanel) loggedPanel.classList.add('hidden');
                if (formsBlock) formsBlock.classList.remove('hidden');
            }
        }

        auth.onAuthStateChanged(updateLoggedInUI);

        function setTab(signIn) {
            clearError(errEl);
            if (tabSignIn) tabSignIn.setAttribute('aria-selected', signIn ? 'true' : 'false');
            if (tabSignUp) tabSignUp.setAttribute('aria-selected', signIn ? 'false' : 'true');
            if (panelSignIn) panelSignIn.classList.toggle('hidden', !signIn);
            if (panelSignUp) panelSignUp.classList.toggle('hidden', signIn);
        }

        if (tabSignIn) {
            tabSignIn.addEventListener('click', function () {
                setTab(true);
            });
        }
        if (tabSignUp) {
            tabSignUp.addEventListener('click', function () {
                setTab(false);
            });
        }

        if (formSignIn) {
            formSignIn.addEventListener('submit', function (e) {
                e.preventDefault();
                clearError(errEl);
                var email = document.getElementById('signInEmail');
                var password = document.getElementById('signInPassword');
                var em = email && email.value ? email.value.trim() : '';
                var pw = password && password.value ? password.value : '';
                auth
                    .signInWithEmailAndPassword(em, pw)
                    .then(function () {
                        goHome();
                    })
                    .catch(function (err) {
                        showError(errEl, err);
                    });
            });
        }

        if (formSignUp) {
            formSignUp.addEventListener('submit', function (e) {
                e.preventDefault();
                clearError(errEl);
                var email = document.getElementById('signUpEmail');
                var password = document.getElementById('signUpPassword');
                var em = email && email.value ? email.value.trim() : '';
                var pw = password && password.value ? password.value : '';
                auth
                    .createUserWithEmailAndPassword(em, pw)
                    .then(function () {
                        goHome();
                    })
                    .catch(function (err) {
                        showError(errEl, err);
                    });
            });
        }

        var btnSignOut = document.getElementById('btnSignOut');
        if (btnSignOut) {
            btnSignOut.addEventListener('click', function () {
                clearError(errEl);
                auth.signOut().catch(function (err) {
                    showError(errEl, err);
                });
            });
        }

        setTab(true);
    });
})();
