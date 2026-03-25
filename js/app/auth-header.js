(function () {
    'use strict';

    function renderAuthStatus(container, user) {
        container.textContent = '';
        if (user && user.email) {
            container.appendChild(document.createTextNode(user.email + ' · '));
            var a = document.createElement('a');
            a.href = 'auth.html';
            a.textContent = 'Compte';
            container.appendChild(a);
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
            renderAuthStatus(el, user);
        });
    });
})();
