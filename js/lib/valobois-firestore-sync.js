/**
 * Synchronise l'état Valobois vers Firestore pour les utilisateurs connectés.
 * Chemin : users/{uid}/evaluation/current — champs payloadJson, revision, updatedAt.
 */
(function (global) {
    'use strict';

    var DEBOUNCE_MS = 2000;
    var COL_USERS = 'users';
    var COL_EVAL = 'evaluation';
    var DOC_ID = 'current';

    function evalRef(db, uid) {
        return db.collection(COL_USERS).doc(uid).collection(COL_EVAL).doc(DOC_ID);
    }

    function attachValoboisFirestoreSync(app) {
        var auth = typeof getValoboisAuth === 'function' ? getValoboisAuth() : null;
        var db = typeof getValoboisFirestore === 'function' ? getValoboisFirestore() : null;
        if (!auth || !db) return;

        var hydrateLock = false;
        var scheduledTimer = null;

        function cancelSchedule() {
            if (scheduledTimer) {
                clearTimeout(scheduledTimer);
                scheduledTimer = null;
            }
        }

        function flushCloudSave(appInstance) {
            if (hydrateLock) return;
            var u = auth.currentUser;
            if (!u || !appInstance || !appInstance.data) return;
            var rev = Number(appInstance.data.meta && appInstance.data.meta.revision) || 0;
            var ref = evalRef(db, u.uid);
            var payload = {
                payloadJson: JSON.stringify(appInstance.data),
                revision: rev,
                updatedAt: global.firebase.firestore.FieldValue.serverTimestamp(),
            };
            ref.set(payload).catch(function (e) {
                console.error('Valobois Firestore save', e);
            });
        }

        function scheduleCloudSave(appInstance) {
            if (hydrateLock) return;
            if (!auth.currentUser) return;
            cancelSchedule();
            scheduledTimer = setTimeout(function () {
                scheduledTimer = null;
                flushCloudSave(appInstance);
            }, DEBOUNCE_MS);
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
            try {
                localStorage.setItem(appInstance.storageKey, JSON.stringify(appInstance.data));
            } catch (e) {
                console.error(e);
            }
            var n = appInstance.data.lots.length;
            if (typeof appInstance.currentLotIndex === 'number' && appInstance.currentLotIndex >= n) {
                appInstance.currentLotIndex = Math.max(0, n - 1);
            }
            appInstance.render();
        }

        function clearLocalEvaluationState(appInstance) {
            try {
                localStorage.removeItem(appInstance.storageKey);
            } catch (e) {
                console.error(e);
            }
            appInstance.data = appInstance.createInitialData();
            appInstance.currentLotIndex = 0;
            appInstance.render();
        }

        function hydrateFromCloud(appInstance, user) {
            hydrateLock = true;
            var ref = evalRef(db, user.uid);
            ref.get()
                .then(function (snap) {
                    try {
                        if (!snap.exists) {
                            flushCloudSave(appInstance);
                            return;
                        }
                        var parsed;
                        try {
                            var d = snap.data() || {};
                            parsed = JSON.parse(d.payloadJson || '{}');
                        } catch (e) {
                            console.error('Valobois Firestore parse', e);
                            flushCloudSave(appInstance);
                            return;
                        }
                        if (!parsed.lots || !Array.isArray(parsed.lots)) {
                            flushCloudSave(appInstance);
                            return;
                        }
                        // À la connexion : Firestore fait foi sur le localStorage (la seule comparaison
                        // remoteRev > localRev échouait car chaque saveData() augmente la révision locale).
                        applyRemoteData(appInstance, parsed);
                    } finally {
                        hydrateLock = false;
                    }
                })
                .catch(function (e) {
                    hydrateLock = false;
                    console.error('Valobois Firestore hydrate', e);
                });
        }

        var initialAuthEvent = true;
        auth.onAuthStateChanged(function (user) {
            cancelSchedule();
            if (initialAuthEvent) {
                initialAuthEvent = false;
                if (user) {
                    hydrateFromCloud(app, user);
                }
                return;
            }
            if (!user) {
                clearLocalEvaluationState(app);
                return;
            }
            hydrateFromCloud(app, user);
        });

        global.__valoboisScheduleCloudSave = function (appInstance) {
            if (hydrateLock) return;
            if (!auth.currentUser) return;
            scheduleCloudSave(appInstance);
        };

        global.__valoboisResetFirestoreEvaluation = function (appInstance) {
            cancelSchedule();
            var u = auth.currentUser;
            if (!u || !db || !appInstance) return;
            hydrateLock = true;
            evalRef(db, u.uid)
                .delete()
                .then(function () {
                    hydrateLock = false;
                    flushCloudSave(appInstance);
                })
                .catch(function (e) {
                    hydrateLock = false;
                    console.error('Valobois Firestore reset', e);
                    flushCloudSave(appInstance);
                });
        };
    }

    global.attachValoboisFirestoreSync = attachValoboisFirestoreSync;
})(typeof window !== 'undefined' ? window : globalThis);
