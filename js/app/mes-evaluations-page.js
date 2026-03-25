(function () {
    'use strict';

    var COL_USERS = 'users';
    var COL_EVAL = 'evaluations';
    /** Même clé que dans valobois-firestore-sync.js — survivra si le serveur réécrit l’URL vers `/` sans ?eval=. */
    var SESSION_INTENT_NEW_EVAL = 'valobois_intent_new_eval';
    var SESSION_PENDING_EVAL_ID = 'valobois_pending_eval_id';

    function bindNewEvaluationIntentLink() {
        var link = document.getElementById('mesEvalNewEvalLink');
        if (!link) return;
        link.addEventListener('click', function () {
            try {
                sessionStorage.setItem(SESSION_INTENT_NEW_EVAL, '1');
                sessionStorage.removeItem(SESSION_PENDING_EVAL_ID);
            } catch (e) {
                /* ignore */
            }
        });
    }

    /** Même onglet : si la query ?eval= est perdue à l’arrivée sur l’éditeur, le sync réinjecte l’id. */
    function bindOpenExistingEvalIntentDelegation(listEl) {
        if (!listEl) return;
        listEl.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a.mes-eval-item-link') : null;
            if (!a || !a.getAttribute('href')) return;
            try {
                var u = new URL(a.getAttribute('href'), window.location.href);
                var ev = u.searchParams.get('eval');
                if (ev != null && String(ev).trim() !== '' && String(ev).trim() !== 'new') {
                    sessionStorage.setItem(SESSION_PENDING_EVAL_ID, String(ev).trim());
                }
            } catch (err) {
                /* ignore */
            }
        });
    }

    function showError(el, msg) {
        if (!el) return;
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    function displayNameFromDoc(d) {
        if (!d) return 'Évaluation';
        var name = d.operationName;
        if (name != null && String(name).trim()) return String(name).trim();
        try {
            var parsed = JSON.parse(d.payloadJson || '{}');
            var op = parsed.meta && parsed.meta.operation;
            if (op != null && String(op).trim()) return String(op).trim();
        } catch (e) {
            /* ignore */
        }
        return 'Évaluation';
    }

    function formatDate(ts) {
        if (!ts || typeof ts.toDate !== 'function') return '';
        try {
            return ts.toDate().toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
            });
        } catch (e) {
            return '';
        }
    }

    function redirectToAuth() {
        var ret = encodeURIComponent('mes-evaluations.html');
        window.location.replace('auth.html?return=' + ret);
    }

    function initThemeToggle() {
        var btn = document.getElementById('btnThemeToggle');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var isDay = document.body.classList.toggle('day-mode');
            btn.textContent = isDay ? 'Mode nuit' : 'Mode jour';
            try {
                localStorage.setItem('valoboisTheme', isDay ? 'day' : 'night');
            } catch (e) {
                /* ignore */
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initThemeToggle();
        bindNewEvaluationIntentLink();
        var errEl = document.getElementById('mesEvalError');
        var hintEl = document.getElementById('mesEvalConfigHint');
        var loadingEl = document.getElementById('mesEvalLoading');
        var listEl = document.getElementById('mesEvalList');
        var emptyEl = document.getElementById('mesEvalEmpty');
        var toolbarEl = document.getElementById('mesEvalToolbar');

        bindOpenExistingEvalIntentDelegation(listEl);

        var auth = typeof getValoboisAuth === 'function' ? getValoboisAuth() : null;
        var db = typeof getValoboisFirestore === 'function' ? getValoboisFirestore() : null;

        if (!auth || !db) {
            if (hintEl) hintEl.hidden = false;
            if (loadingEl) loadingEl.classList.add('hidden');
            showError(errEl, 'Firebase n’est pas configuré ou Firestore est indisponible.');
            return;
        }
        if (hintEl) hintEl.hidden = true;

        function setLoaded() {
            if (loadingEl) loadingEl.classList.add('hidden');
            if (toolbarEl) toolbarEl.classList.remove('hidden');
        }

        function fetchAndRenderEvaluations(user) {
            if (!listEl || !emptyEl) return;
            showError(errEl, '');
            var col = db.collection(COL_USERS).doc(user.uid).collection(COL_EVAL);
            col
                .orderBy('updatedAt', 'desc')
                .get()
                .then(function (snap) {
                    setLoaded();

                    listEl.textContent = '';
                    if (!snap.docs.length) {
                        listEl.classList.add('hidden');
                        emptyEl.classList.remove('hidden');
                        return;
                    }
                    emptyEl.classList.add('hidden');
                    listEl.classList.remove('hidden');

                    snap.docs.forEach(function (docSnap) {
                        var d = docSnap.data() || {};
                        var id = docSnap.id;
                        var title = displayNameFromDoc(d);
                        var dateStr = formatDate(d.updatedAt);

                        var li = document.createElement('li');
                        li.className = 'mes-eval-item';

                        var inner = document.createElement('div');
                        inner.className = 'mes-eval-item-inner';

                        var main = document.createElement('div');
                        main.className = 'mes-eval-item-main';

                        var link = document.createElement('a');
                        link.className = 'mes-eval-item-link';
                        link.href = 'index.html?eval=' + encodeURIComponent(id);

                        var titleEl = document.createElement('span');
                        titleEl.className = 'mes-eval-item-title';
                        titleEl.textContent = title;

                        link.appendChild(titleEl);
                        if (dateStr) {
                            var dateSpan = document.createElement('span');
                            dateSpan.className = 'mes-eval-item-date';
                            dateSpan.textContent = dateStr;
                            link.appendChild(dateSpan);
                        }
                        main.appendChild(link);

                        var actions = document.createElement('div');
                        actions.className = 'mes-eval-item-actions';

                        var delBtn = document.createElement('button');
                        delBtn.type = 'button';
                        delBtn.className = 'btn btn-secondary mes-eval-delete-btn';
                        delBtn.textContent = 'Supprimer';
                        delBtn.setAttribute('aria-label', 'Supprimer l’évaluation « ' + title + ' »');
                        delBtn.addEventListener('click', function (e) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                                !window.confirm(
                                    'Supprimer cette évaluation ? Cette action est définitive.'
                                )
                            ) {
                                return;
                            }
                            delBtn.disabled = true;
                            col
                                .doc(id)
                                .delete()
                                .then(function () {
                                    fetchAndRenderEvaluations(user);
                                })
                                .catch(function (delErr) {
                                    delBtn.disabled = false;
                                    console.error('Mes évaluations — suppression', delErr);
                                    showError(
                                        errEl,
                                        'Suppression impossible. Vérifiez votre connexion ou les droits Firestore.'
                                    );
                                });
                        });
                        actions.appendChild(delBtn);

                        inner.appendChild(main);
                        inner.appendChild(actions);
                        li.appendChild(inner);
                        listEl.appendChild(li);
                    });
                })
                .catch(function (e) {
                    setLoaded();
                    console.error('Mes évaluations', e);
                    showError(
                        errEl,
                        'Impossible de charger la liste. Si le message mentionne un index, créez l’index Firestore indiqué dans la console.'
                    );
                });
        }

        auth.onAuthStateChanged(function (user) {
            if (!user) {
                redirectToAuth();
                return;
            }
            fetchAndRenderEvaluations(user);
        });
    });
})();
