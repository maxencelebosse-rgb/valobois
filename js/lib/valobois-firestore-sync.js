/**
 * Mode invité : pas de Firestore (LocalStorage dans ValoboisApp).
 * Mode connecté sur index.html : données uniquement Firestore users/{uid}/evaluations/{evalId}.
 * L’id d’évaluation vient de ?eval= dans l’URL (pas de localStorage pour le payload).
 */
(function (global) {
    'use strict';

    var DEBOUNCE_MS = 500;
    var COL_USERS = 'users';
    var COL_EVAL = 'evaluations';
    var LISTING_PAGE = 'mes-evaluations.html';
    var SESSION_INTENT_NEW_EVAL = 'valobois_intent_new_eval';
    /** Id doc Firestore à réappliquer en ?eval= si la navigation a perdu la query (ex. réécriture vers `/`). */
    var SESSION_PENDING_EVAL_ID = 'valobois_pending_eval_id';

    /** Si l’URL n’a pas d’eval, restaure depuis session (puis replaceState). Contre-indiqué si on ouvre une nouvelle éval. */
    function promotePendingEvalIdFromSession(skipNewEvalIntentFlag) {
        if (skipNewEvalIntentFlag) {
            try {
                global.sessionStorage.removeItem(SESSION_PENDING_EVAL_ID);
            } catch (e) {
                /* ignore */
            }
            return;
        }
        if (getEvalIdFromUrl()) {
            try {
                global.sessionStorage.removeItem(SESSION_PENDING_EVAL_ID);
            } catch (e) {
                /* ignore */
            }
            return;
        }
        try {
            var pending = global.sessionStorage.getItem(SESSION_PENDING_EVAL_ID);
            if (!pending || !String(pending).trim()) return;
            global.sessionStorage.removeItem(SESSION_PENDING_EVAL_ID);
            var id = String(pending).trim();
            if (!id || id === 'new') return;
            setEvalInUrl(id);
        } catch (e) {
            /* ignore */
        }
    }

    function evalCollection(db, uid) {
        return db.collection(COL_USERS).doc(uid).collection(COL_EVAL);
    }

    function evalRef(db, uid, evalId) {
        return evalCollection(db, uid).doc(evalId);
    }

    function getEvalIdFromUrl() {
        try {
            var u = new URL(global.location.href);
            var raw = u.searchParams.get('eval');
            if (raw == null || raw === '') return '';
            var id = String(raw).trim();
            if (!id || id === 'new') return '';
            return id;
        } catch (e) {
            return '';
        }
    }

    /** True tant que ?eval=new est dans l’URL (ex. scripts defer ont couru avant le redirect inline). */
    function urlIndicatesNewEval() {
        try {
            return new URL(global.location.href).searchParams.get('eval') === 'new';
        } catch (e) {
            return false;
        }
    }

    function setEvalInUrl(evalId) {
        try {
            var u = new URL(global.location.href);
            u.searchParams.set('eval', evalId);
            global.history.replaceState({}, '', u.pathname + u.search + u.hash);
        } catch (e) {
            /* ignore */
        }
    }

    function isIndexEditorPage() {
        try {
            var path = (global.location.pathname || '').toLowerCase();
            if (path === '' || path === '/') return true;
            if (path.endsWith('/index.html')) return true;
            if (path.endsWith('index.html')) return true;
            return false;
        } catch (e) {
            return true;
        }
    }

    function consumeNewEvalHash() {
        try {
            if (global.location.hash === '#valobois_new_eval') {
                try {
                    global.sessionStorage.removeItem(SESSION_INTENT_NEW_EVAL);
                } catch (eS) {
                    /* ignore */
                }
                var u = new URL(global.location.href);
                u.hash = '';
                global.history.replaceState({}, '', u.pathname + u.search + u.hash);
                return true;
            }
        } catch (e) {
            /* ignore */
        }
        return false;
    }

    function consumeNewEvalIntentFromSession() {
        try {
            if (global.sessionStorage.getItem(SESSION_INTENT_NEW_EVAL) === '1') {
                global.sessionStorage.removeItem(SESSION_INTENT_NEW_EVAL);
                return true;
            }
        } catch (e) {
            /* ignore */
        }
        return false;
    }

    function redirectToListing() {
        try {
            global.location.replace(LISTING_PAGE);
        } catch (e) {
            global.location.href = LISTING_PAGE;
        }
    }

    function operationNameFromApp(appInstance) {
        var op = appInstance && appInstance.data && appInstance.data.meta && appInstance.data.meta.operation;
        var s = (op == null ? '' : String(op)).trim();
        return s || 'Sans nom';
    }

    function attachValoboisFirestoreSync(app) {
        var skipNewEvalIntent =
            urlIndicatesNewEval() || consumeNewEvalHash() || consumeNewEvalIntentFromSession();
        promotePendingEvalIdFromSession(skipNewEvalIntent);

        var auth = typeof getValoboisAuth === 'function' ? getValoboisAuth() : null;
        var db = typeof getValoboisFirestore === 'function' ? getValoboisFirestore() : null;

        if (!auth || !db) {
            if (app.persistenceMode === 'cloud') {
                app.persistenceMode = 'guest';
                if (typeof app.reloadGuestStateFromLocalStorage === 'function') {
                    app.reloadGuestStateFromLocalStorage();
                }
            }
            return;
        }

        if (auth.currentUser && isIndexEditorPage()) {
            if (getEvalIdFromUrl() || skipNewEvalIntent) {
                app.persistenceMode = 'cloud';
            }
        }

        var loading = false;
        var scheduledTimer = null;
        var lastAuthUid = null;
        var deferredSaveApp = null;

        function cancelSchedule() {
            if (scheduledTimer) {
                clearTimeout(scheduledTimer);
                scheduledTimer = null;
            }
        }

        function finishLoading() {
            loading = false;
            if (deferredSaveApp && auth.currentUser) {
                var pending = deferredSaveApp;
                deferredSaveApp = null;
                cancelSchedule();
                scheduledTimer = setTimeout(function () {
                    scheduledTimer = null;
                    flushToFirestore(pending);
                }, DEBOUNCE_MS);
            }
        }

        function applyRemoteData(appInstance, parsed) {
            if (!parsed || !parsed.lots || !Array.isArray(parsed.lots)) return;
            appInstance.data = parsed;
            appInstance.data.meta = appInstance.getDefaultMeta(appInstance.data.meta || {});
            appInstance.data.ui = appInstance.getDefaultUi(appInstance.data.ui || {});
            appInstance.data.lots.forEach(function (lot) {
                appInstance.normalizeLotEssenceFields(lot);
                appInstance.normalizeLotAllotissementFields(lot);
            });
            var n = appInstance.data.lots.length;
            if (typeof appInstance.currentLotIndex === 'number' && appInstance.currentLotIndex >= n) {
                appInstance.currentLotIndex = Math.max(0, n - 1);
            }
            appInstance.render();
        }

        function flushToFirestore(appInstance) {
            if (loading) return;
            var u = auth.currentUser;
            if (!u || !appInstance || !appInstance.data) return;
            var evalId = getEvalIdFromUrl();
            if (!evalId) return;
            var rev = Number(appInstance.data.meta && appInstance.data.meta.revision) || 0;
            var payload = {
                payloadJson: JSON.stringify(appInstance.data),
                revision: rev,
                updatedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
                operationName: operationNameFromApp(appInstance),
            };
            evalRef(db, u.uid, evalId)
                .set(payload)
                .catch(function (e) {
                    console.error('Valobois Firestore save', e);
                });
        }

        function scheduleCloudSave(appInstance) {
            if (!auth.currentUser) return;
            if (loading) {
                deferredSaveApp = appInstance;
                return;
            }
            deferredSaveApp = null;
            cancelSchedule();
            scheduledTimer = setTimeout(function () {
                scheduledTimer = null;
                flushToFirestore(appInstance);
            }, DEBOUNCE_MS);
        }

        function resetLocalDraftToBlank(appInstance) {
            if (!appInstance || typeof appInstance.createInitialData !== 'function') return;
            try {
                if (global.window && global.window.__VALOBOIS_DATA__) {
                    try {
                        delete global.window.__VALOBOIS_DATA__;
                    } catch (x) {
                        global.window.__VALOBOIS_DATA__ = undefined;
                    }
                }
            } catch (e2) {
                /* ignore */
            }
            appInstance.data = appInstance.createInitialData();
            appInstance.currentLotIndex = 0;
            appInstance.render();
        }

        function enterGuestMode(appInstance) {
            appInstance.persistenceMode = 'guest';
            try {
                localStorage.removeItem('valobois_firestore_eval_id');
            } catch (e) {
                /* ignore */
            }
            cancelSchedule();
            deferredSaveApp = null;
            if (typeof appInstance.reloadGuestStateFromLocalStorage === 'function') {
                appInstance.reloadGuestStateFromLocalStorage();
            }
        }

        function enterCloudModeOnIndex(appInstance, user) {
            if (!isIndexEditorPage()) {
                finishLoading();
                return;
            }

            var evalId = getEvalIdFromUrl();

            if (!evalId && !skipNewEvalIntent) {
                redirectToListing();
                finishLoading();
                return;
            }

            appInstance.persistenceMode = 'cloud';

            try {
                localStorage.removeItem('valobois_v1');
                localStorage.removeItem('valobois_firestore_eval_id');
            } catch (e) {
                /* ignore */
            }

            loading = true;

            if (skipNewEvalIntent) {
                resetLocalDraftToBlank(appInstance);
                var newId = evalCollection(db, user.uid).doc().id;
                setEvalInUrl(newId);
                var rev = Number(appInstance.data.meta && appInstance.data.meta.revision) || 0;
                var payload = {
                    payloadJson: JSON.stringify(appInstance.data),
                    revision: rev,
                    updatedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
                    operationName: operationNameFromApp(appInstance),
                };
                evalRef(db, user.uid, newId)
                    .set(payload)
                    .then(function () {
                        finishLoading();
                    })
                    .catch(function (e) {
                        console.error('Valobois Firestore create eval', e);
                        finishLoading();
                    });
                return;
            }

            evalRef(db, user.uid, evalId)
                .get()
                .then(function (snap) {
                    if (!snap.exists) {
                        var empty = appInstance.createInitialData();
                        applyRemoteData(appInstance, empty);
                        return evalRef(db, user.uid, evalId).set({
                            payloadJson: JSON.stringify(appInstance.data),
                            revision: Number(appInstance.data.meta && appInstance.data.meta.revision) || 0,
                            updatedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
                            operationName: operationNameFromApp(appInstance),
                        });
                    }
                    var d = snap.data() || {};
                    var parsed;
                    try {
                        parsed = JSON.parse(d.payloadJson || '{}');
                    } catch (parseErr) {
                        console.error('Valobois Firestore parse', parseErr);
                        return;
                    }
                    if (parsed.lots && Array.isArray(parsed.lots)) {
                        applyRemoteData(appInstance, parsed);
                    }
                })
                .catch(function (e) {
                    console.error('Valobois Firestore hydrate', e);
                })
                .then(function () {
                    finishLoading();
                });
        }

        var initialAuthEvent = true;
        auth.onAuthStateChanged(function (user) {
            if (initialAuthEvent) {
                initialAuthEvent = false;
                if (user) {
                    lastAuthUid = user.uid;
                    cancelSchedule();
                    enterCloudModeOnIndex(app, user);
                } else {
                    enterGuestMode(app);
                }
                return;
            }
            if (!user) {
                lastAuthUid = null;
                enterGuestMode(app);
                return;
            }
            if (user.uid === lastAuthUid) {
                return;
            }
            lastAuthUid = user.uid;
            cancelSchedule();
            enterCloudModeOnIndex(app, user);
        });

        global.__valoboisScheduleCloudSave = function (appInstance) {
            if (appInstance && appInstance.persistenceMode !== 'cloud') return;
            if (loading) {
                deferredSaveApp = appInstance;
                return;
            }
            if (!auth.currentUser) return;
            scheduleCloudSave(appInstance);
        };

        global.__valoboisResetFirestoreEvaluation = function (appInstance) {
            cancelSchedule();
            deferredSaveApp = null;
            var u = auth.currentUser;
            if (!u || !db || !appInstance) return;
            var evalId = getEvalIdFromUrl();
            if (!evalId) return;
            loading = true;
            evalRef(db, u.uid, evalId)
                .delete()
                .then(function () {
                    loading = false;
                    flushToFirestore(appInstance);
                })
                .catch(function (e) {
                    loading = false;
                    console.error('Valobois Firestore reset', e);
                    flushToFirestore(appInstance);
                });
        };
    }

    global.attachValoboisFirestoreSync = attachValoboisFirestoreSync;
})(typeof window !== 'undefined' ? window : globalThis);
