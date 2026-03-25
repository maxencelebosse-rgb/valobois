(function () {
    'use strict';

    function renderAuthStatus(container, user, authInstance) {
        container.textContent = '';
        if (user && user.email) {
            container.appendChild(document.createTextNode(user.email + ' · '));
            var listLink = document.createElement('a');
            listLink.href = 'mes-evaluations.html';
            listLink.textContent = 'Mes évaluations';
            container.appendChild(listLink);
            container.appendChild(document.createTextNode(' · '));
            var signOutBtn = document.createElement('button');
            signOutBtn.type = 'button';
            signOutBtn.className = 'auth-banner-signout';
            signOutBtn.textContent = 'Se déconnecter';
            signOutBtn.addEventListener('click', function () {
                if (!authInstance) return;
                authInstance
                    .signOut()
                    .then(function () {
                        try {
                            localStorage.removeItem('valobois_firestore_eval_id');
                        } catch (e) {
                            console.error(e);
                        }
                    })
                    .catch(function (err) {
                        console.error(err);
                    });
            });
            container.appendChild(signOutBtn);
            return;
        }
        container.appendChild(document.createTextNode('Non connecté · '));
        var link = document.createElement('a');
        link.href = 'auth.html';
        link.textContent = 'Connexion';
        container.appendChild(link);
    }

    document.addEventListener('DOMContentLoaded', function () {
        var el = document.getElementById('auth-header-status');
        if (!el) return;

        var auth = typeof getValoboisAuth === 'function' ? getValoboisAuth() : null;
        if (!auth) {
            el.innerHTML = '';
            var linkOnly = document.createElement('a');
            linkOnly.href = 'auth.html';
            linkOnly.textContent = 'Connexion';
            el.appendChild(linkOnly);
            return;
        }

        auth.onAuthStateChanged(function (user) {
            renderAuthStatus(el, user, auth);
        });
    });
})();
