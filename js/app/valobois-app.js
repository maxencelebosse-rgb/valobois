class ValoboisApp {
    constructor() {
        this.storageKey = 'valobois_v1';
        /** 'guest' = persistance LocalStorage uniquement ; 'cloud' = Firestore uniquement (pas de payload en local). */
        this.persistenceMode = 'guest';
        this.data = this.loadGuestDataFromLocalStorage();
        this.currentLotIndex = 0;
        this.pendingDeleteLotIndex = null;
        this.seuilsCharts = {};
        this.radarChart = null;
        this.ensureTermesBoisDatalist();
        this.ensureEssencesBoisDatalist();
        this.bindEvents();
        this.render();
        if (typeof attachValoboisFirestoreSync === 'function') {
            attachValoboisFirestoreSync(this);
        }
    }

    ensureTermesBoisDatalist() {
        let datalist = document.getElementById('liste-termes-bois');
        if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'liste-termes-bois';
            document.body.appendChild(datalist);
        }
        if (datalist.children.length > 0) return;

        TERMES_BOIS.forEach((terme) => {
            const option = document.createElement('option');
            option.value = terme;
            datalist.appendChild(option);
        });
    }

    ensureEssencesBoisDatalist() {
        let datalistCommon = document.getElementById('liste-essences-communes');
        if (!datalistCommon) {
            datalistCommon = document.createElement('datalist');
            datalistCommon.id = 'liste-essences-communes';
            document.body.appendChild(datalistCommon);
        }

        let datalistScientific = document.getElementById('liste-essences-scientifiques');
        if (!datalistScientific) {
            datalistScientific = document.createElement('datalist');
            datalistScientific.id = 'liste-essences-scientifiques';
            document.body.appendChild(datalistScientific);
        }

        if (datalistCommon.children.length > 0 && datalistScientific.children.length > 0) return;

        const shouldFillCommon = datalistCommon.children.length === 0;
        const scientificNames = new Set(Array.from(datalistScientific.querySelectorAll('option')).map((option) => option.value));
        ESSENCES_BOIS.forEach((essence) => {
            if (shouldFillCommon) {
                const commonOption = document.createElement('option');
                commonOption.value = essence.nomUsuel;
                datalistCommon.appendChild(commonOption);
            }
            if (!scientificNames.has(essence.nomScientifique)) {
                scientificNames.add(essence.nomScientifique);
                const scientificOption = document.createElement('option');
                scientificOption.value = essence.nomScientifique;
                datalistScientific.appendChild(scientificOption);
            }
        });
    }

    findEssenceByCommonName(value) {
        const key = normalizeEssenceLookupKey(value);
        if (!key) return null;
        const detailed = ESSENCES_VALOBOIS_BY_COMMON.get(key);
        if (detailed) return detailed;
        return ESSENCES_BOIS.find((essence) => normalizeEssenceLookupKey(essence.nomUsuel) === key) || null;
    }

    findEssenceByScientificName(value) {
        const key = normalizeEssenceLookupKey(value);
        if (!key) return null;
        const detailed = ESSENCES_VALOBOIS_BY_SCIENTIFIC.get(key);
        if (detailed) return detailed;
        return ESSENCES_BOIS.find((essence) => normalizeEssenceLookupKey(essence.nomScientifique) === key) || null;
    }

    resolveDetailedEssenceForAllotissement(allotissement) {
        if (!allotissement) return null;
        const nomCommun = (allotissement.essenceNomCommun || '').toString().trim();
        const nomScientifique = (allotissement.essenceNomScientifique || '').toString().trim();

        const byCommon = ESSENCES_VALOBOIS_BY_COMMON.get(normalizeEssenceLookupKey(nomCommun));
        if (byCommon) return byCommon;

        const byScientific = ESSENCES_VALOBOIS_BY_SCIENTIFIC.get(normalizeEssenceLookupKey(nomScientifique));
        if (byScientific) return byScientific;

        return null;
    }

    getMasseVolumiqueSourceLabel(allotissement) {
        const detailed = this.resolveDetailedEssenceForAllotissement(allotissement);
        if (!detailed || !detailed.sourceDensite) return '';
        return `Source : ${detailed.sourceDensite}`;
    }

    getSuggestedMasseVolumique(allotissement) {
        if (!allotissement) return DEFAULT_MASSE_VOLUMIQUE;

        const nomCommun = (allotissement.essenceNomCommun || '').toString().trim();
        const nomScientifique = (allotissement.essenceNomScientifique || '').toString().trim();
        const matchByCommon = this.findEssenceByCommonName(nomCommun);

        if (matchByCommon && Number.isFinite(parseFloat(matchByCommon.massevolumique))) {
            return parseFloat(matchByCommon.massevolumique);
        }

        const scientificToCheck = nomScientifique || (matchByCommon && matchByCommon.nomScientifique) || '';
        const matchByScientific = this.findEssenceByScientificName(scientificToCheck);
        if (matchByScientific && Number.isFinite(parseFloat(matchByScientific.massevolumique))) {
            return parseFloat(matchByScientific.massevolumique);
        }

        return DEFAULT_MASSE_VOLUMIQUE;
    }

    applySuggestedMasseVolumique(lot, { force = false } = {}) {
        if (!lot || !lot.allotissement) return DEFAULT_MASSE_VOLUMIQUE;
        const current = this.normalizeAllotissementNumericInput(lot.allotissement.masseVolumique);
        const suggested = this.getSuggestedMasseVolumique(lot.allotissement);
        if (force || current === '') {
            lot.allotissement.masseVolumique = String(suggested);
        }
        return suggested;
    }

    normalizeLotEssenceFields(lot) {
        if (!lot || !lot.allotissement) return;
        const allotissement = lot.allotissement;

        let nomCommun = (allotissement.essenceNomCommun || '').toString().trim();
        let nomScientifique = (allotissement.essenceNomScientifique || '').toString().trim();
        const legacyEssence = (allotissement.essence || '').toString().trim();

        if (!nomCommun && !nomScientifique && legacyEssence) {
            const parts = legacyEssence.split(' - ');
            if (parts.length > 1) {
                nomCommun = parts[0].trim();
                nomScientifique = parts.slice(1).join(' - ').trim();
            } else {
                nomCommun = legacyEssence;
            }
        }

        if (nomCommun && !nomScientifique) {
            const match = this.findEssenceByCommonName(nomCommun);
            if (match) nomScientifique = match.nomScientifique;
        }

        if (nomScientifique && !nomCommun) {
            const match = this.findEssenceByScientificName(nomScientifique);
            if (match) nomCommun = match.nomUsuel;
        }

        allotissement.essenceNomCommun = nomCommun;
        allotissement.essenceNomScientifique = nomScientifique;
        allotissement.essence = [nomCommun, nomScientifique].filter(Boolean).join(' - ');
    }

    normalizeLotAllotissementFields(lot) {
        if (!lot || !lot.allotissement) return;
        const allotissement = lot.allotissement;

        // Migration legacy : ces champs appartiennent au lot (racine), pas à allotissement.
        if ((lot.localisation == null || lot.localisation === '') && allotissement.localisation != null && allotissement.localisation !== '') {
            lot.localisation = String(allotissement.localisation);
        }
        if ((lot.situation == null || lot.situation === '') && allotissement.situation != null && allotissement.situation !== '') {
            lot.situation = String(allotissement.situation);
        }
        if (lot.localisation == null) lot.localisation = '';
        if (lot.situation == null) lot.situation = '';
        delete allotissement.localisation;
        delete allotissement.situation;

        if (allotissement.masseVolumique == null || allotissement.masseVolumique === '') {
            allotissement.masseVolumique = String(this.getSuggestedMasseVolumique(allotissement));
        }
        if (allotissement.humidite == null) allotissement.humidite = 12;
        if (allotissement.fractionCarbonee == null) allotissement.fractionCarbonee = 50;
        if (allotissement.bois == null) allotissement.bois = 100;
        if (allotissement.diametre == null) allotissement.diametre = '';
        if (allotissement.carboneBiogeniqueEstime == null) allotissement.carboneBiogeniqueEstime = '';
        if (!Array.isArray(lot.pieces)) lot.pieces = [];
    }

    createEmptyLot(index) {
    return {
        id: Date.now() + index,
        nom: `Lot ${index + 1}`,
        localisation: '',
        situation: '',
        // LES DONNÉES DE BASE
        allotissement: {
            quantite: '',
            typePiece: '',
            essenceNomCommun: '',
            essenceNomScientifique: '',
            essence: '',
            longueur: '',
            largeur: '',
            hauteur: '',
            diametre: '',
            prixUnite: 'm3',
            prixMarche: '',
            surfacePiece: 0,
            surfaceLot: 0,
            volumePiece: 0,
            volumeLot: 0,
            prixLot: 0,
            prixLotAjusteIntegrite: 0,
            lineaireLot: 0,
            masseVolumique: DEFAULT_MASSE_VOLUMIQUE,
            masseLot: 0,
            humidite: 12,
            fractionCarbonee: 50,
            bois: 100,
            carboneBiogeniqueEstime: '',
            destination: ''
        },
        orientation: 'none',
        volumePiece: 0,
        volumeLot: 0,
        prixLot: 0,
        
        // STRUCTURES DE NOTATION
        inspection: {
            visibilite: null,
            instrumentation: null,
            integrite: { niveau: null, ignore: false, coeff: null }
        },
        bio: {
            purge: null, expansion: null, integriteBio: null, exposition: null, confianceBio: null
        },
        mech: {
            purgeMech: null, feuMech: null, integriteMech: null, expositionMech: null, confianceMech: null
        },
        usage: {
            confianceUsage: null, durabiliteUsage: null, classementUsage: null, humiditeUsage: null, aspectUsage: null
        },
        denat: {
            depollutionDenat: null, contaminationDenat: null, durabiliteConfDenat: null, confianceDenat: null, naturaliteDenat: null
        },
        debit: {
            regulariteDebit: null, volumetrieDebit: null, stabiliteDebit: null, artisanaliteDebit: null, rusticiteDebit: null
        },
        geo: {
            adaptabiliteGeo: null, massiviteGeo: null, deformationGeo: null, industrialiteGeo: null, inclusiviteGeo: null
        },
        essence: {
            confianceEssence: null, rareteEcoEssence: null, masseVolEssence: null, rareteHistEssence: null, singulariteEssence: null
        },
        ancien: {
            confianceAncien: null, amortissementAncien: null, vieillissementAncien: null, microhistoireAncien: null, demontabiliteAncien: null
        },
        traces: {
            confianceTraces: null, etiquetageTraces: null, alterationTraces: null, documentationTraces: null, singularitesTraces: null
        },
        provenance: {
            confianceProv: null, transportProv: null, reputationProv: null, macroProv: null, territorialiteProv: null
        },
        pieces: [],
        criteres: [] 
    };
}

    createEmptyPiece(index) {
        return {
            id: Date.now() + '_p' + index,
            nom: `Pièce ${index + 1}`,
            typePiece: '',
            essenceNomCommun: '',
            essenceNomScientifique: '',
            essence: '',
            longueur: '',
            largeur: '',
            hauteur: '',
            diametre: '',
            prixUnite: '',
            prixMarche: '',
            surfacePiece: 0,
            volumePiece: 0,
            prixPiece: 0,
            prixPieceAjusteIntegrite: 0,
            masseVolumique: '',
            humidite: '',
            fractionCarbonee: '',
            bois: '',
            massePiece: 0,
            carboneBiogeniqueEstime: ''
        };
    }

    createInitialData() {
        return {
            meta: this.getDefaultMeta(),
            ui: this.getDefaultUi(),
            lots: [this.createEmptyLot(0), this.createEmptyLot(1)]
        };
    }

    getDefaultUi(existingUi = {}) {
        const existingCollapsibles = (existingUi && existingUi.collapsibles) || {};
        return {
            collapsibles: {
                apropos: false,
                'reference-operation': false,
                diagnostiqueur: false,
                contacts: false,
                'contexte-technique': false,
                documents: false,
                notes: false,
                ...existingCollapsibles
            }
        };
    }

    getDefaultMeta(existingMeta = {}) {
        const legacyOperateur = (existingMeta.operateur || '').toString();
        return {
            operation: '',
            date: '',
            versionEtude: '',
            statutEtude: 'Pré-diagnostic',
            diagnostiqueurNom: '',
            diagnostiqueurContact: legacyOperateur,
            diagnostiqueurMail: '',
            diagnostiqueurTelephone: '',
            diagnostiqueurAdresse: '',
            maitriseOuvrageNom: '',
            maitriseOuvrageContact: '',
            maitriseOuvrageMail: '',
            maitriseOuvrageTelephone: '',
            maitriseOuvrageAdresse: '',
            maitriseOeuvreNom: '',
            maitriseOeuvreContact: '',
            maitriseOeuvreMail: '',
            maitriseOeuvreTelephone: '',
            maitriseOeuvreAdresse: '',
            entrepriseDeconstructionNom: '',
            entrepriseDeconstructionContact: '',
            entrepriseDeconstructionMail: '',
            entrepriseDeconstructionTelephone: '',
            entrepriseDeconstructionAdresse: '',
            typeBatiment: '',
            periodeConstruction: '',
            phaseIntervention: '',
            localisation: '',
            conditionnementType: '',
            protectionType: '',
            diagnosticStructure: '',
            diagnosticAmiante: '',
            diagnosticPlomb: '',
            commentaires: '',
            ...existingMeta,
            diagnosticStructure: existingMeta.diagnosticStructure || 'Inconnu',
            diagnosticAmiante: existingMeta.diagnosticAmiante || 'Inconnu',
            diagnosticPlomb: existingMeta.diagnosticPlomb || 'Inconnu',
            diagnostiqueurContact: (existingMeta.diagnostiqueurContact || legacyOperateur || '').toString(),
            revision: Number.isFinite(Number(existingMeta.revision)) ? Number(existingMeta.revision) : 0,
        };
    }

    getReferenceGisement(meta = this.data.meta) {
        const source = this.getDefaultMeta(meta || {});
        const operation = (source.operation || 'operation')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase() || 'OPERATION';
        const date = (source.date || '').toString().replace(/-/g, '') || 'SANSDATE';
        return `${operation}_${date}`;
    }

    /** Données invité / export HTML autonome — jamais utilisé pour le corps de l’évaluation en mode cloud. */
    loadGuestDataFromLocalStorage() {
        try {
            // Vérifier d'abord si les données sont injectées dans la page (depuis un fichier HTML téléchargé)
            if (window.__VALOBOIS_DATA__) {
                const data = window.__VALOBOIS_DATA__;
                // Sauvegarder aussi dans localStorage pour la persistance locale
                localStorage.setItem(this.storageKey, JSON.stringify(data));
                return data;
            }

            const raw = localStorage.getItem(this.storageKey);
            if (!raw) return this.createInitialData();
            const parsed = JSON.parse(raw);
            if (!parsed.lots || !Array.isArray(parsed.lots)) {
                return this.createInitialData();
            }
            parsed.meta = this.getDefaultMeta(parsed.meta || {});
            parsed.ui = this.getDefaultUi(parsed.ui || {});
            parsed.lots.forEach((lot) => {
                this.normalizeLotEssenceFields(lot);
                this.normalizeLotAllotissementFields(lot);
            });
            return parsed;
        } catch (e) {
            console.error(e);
            return this.createInitialData();
        }
    }

    loadData() {
        return this.loadGuestDataFromLocalStorage();
    }

    reloadGuestStateFromLocalStorage() {
        this.persistenceMode = 'guest';
        this.data = this.loadGuestDataFromLocalStorage();
        this.currentLotIndex = 0;
        this.render();
    }

    saveData() {
        try {
            this.data.meta = this.getDefaultMeta(this.data.meta || {});
            this.data.meta.revision = (Number(this.data.meta.revision) || 0) + 1;
            if (this.persistenceMode === 'cloud') {
                if (typeof window.__valoboisScheduleCloudSave === 'function') {
                    window.__valoboisScheduleCloudSave(this);
                }
            } else {
                localStorage.setItem(this.storageKey, JSON.stringify(this.data));
            }
        } catch (e) {
            console.error(e);
        }
    }

    getCurrentLot() {
        const lots = this.data.lots || [];
        if (!lots.length) return null;
        if (this.currentLotIndex < 0 || this.currentLotIndex >= lots.length) {
            this.currentLotIndex = 0;
        }
        return lots[this.currentLotIndex];
    }

    getLotIntegrityPriceFactor(lot) {
        const integrite = lot && lot.inspection && lot.inspection.integrite;
        if (!integrite || integrite.ignore || integrite.coeff == null) return 1;
        const coeff = parseFloat(integrite.coeff);
        return Number.isFinite(coeff) ? coeff : 1;
    }

    formatPco2Display(valueKgRaw) {
        const valueKg = Math.max(0, parseFloat(valueKgRaw) || 0);
        if (valueKg >= 1000) {
            return {
                value: (valueKg / 1000).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }),
                unit: 't CO₂ (NF EN 16449)'
            };
        }
        return {
            value: Math.round(valueKg).toLocaleString('fr-FR', { maximumFractionDigits: 0 }),
            unit: 'kg CO₂ (NF EN 16449)'
        };
    }

    formatMasseDisplay(valueKgRaw) {
        const valueKg = Math.max(0, parseFloat(valueKgRaw) || 0);
        if (valueKg >= 1000) {
            return {
                value: (valueKg / 1000).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }),
                unit: 't'
            };
        }
        return {
            value: valueKg.toLocaleString('fr-FR', { maximumFractionDigits: 1 }),
            unit: 'kg'
        };
    }

    updateActiveLotCardDisplays(lot) {
        const lotIndex = this.data.lots.indexOf(lot);
        if (lotIndex < 0) return;
        const card = document.querySelector(`.lot-card[data-lot-index="${lotIndex}"]`);
        if (!card) return;

        const formatGrouped = (value, digits = 0) => (parseFloat(value) || 0).toLocaleString('fr-FR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        const formatOneDecimal = (value) => formatGrouped(value, 1);

        const el = (sel) => card.querySelector(sel);
        const setVal = (sel, v) => { const e = el(sel); if (e) e.value = v; };

        setVal('[data-display="volumePiece"]', formatGrouped(lot.allotissement.volumePiece, 3));
        setVal('[data-display="volumeLot"]', formatOneDecimal(lot.allotissement.volumeLot));
        setVal('[data-display="surfacePiece"]', formatOneDecimal(lot.allotissement.surfacePiece));
        setVal('[data-display="surfaceLot"]', formatOneDecimal(lot.allotissement.surfaceLot));
        setVal('[data-display="prixLot"]', formatGrouped(Math.round(lot.allotissement.prixLot), 0));
        const isIgnored = !!(((lot.inspection || {}).integrite || {}).ignore);
        setVal('[data-display="prixLotAjusteIntegrite"]', isIgnored ? '' : formatGrouped(Math.round(lot.allotissement.prixLotAjusteIntegrite || 0), 0));
        setVal('[data-display="lineaireLot"]', formatOneDecimal(lot.allotissement.lineaireLot));
        const masseLotD = this.formatMasseDisplay(lot.allotissement.masseLot);
        setVal('[data-display="masseLot"]', masseLotD.value);
        const masseLotUnitEl = el('[data-display="masseLotUnit"]');
        if (masseLotUnitEl) masseLotUnitEl.textContent = masseLotD.unit;
        const pco2D = this.formatPco2Display(lot.allotissement.carboneBiogeniqueEstime);
        setVal('[data-display="carboneBiogeniqueEstime"]', pco2D.value);
        const pco2UnitEl = el('[data-display="carboneBiogeniqueEstimeUnit"]');
        if (pco2UnitEl) pco2UnitEl.textContent = pco2D.unit;

        // Mise à jour badge pièces et bouton alerte
        const nbPieces = (lot.pieces || []).length;
        const qTotal = parseFloat(lot.allotissement.quantite) || 0;
        const qEffective = Math.max(qTotal, nbPieces);
        const badgeEl = el('[data-display="piecesBadge"]');
        if (badgeEl) badgeEl.textContent = `${nbPieces}/${qEffective}`;
        const alertBtn = el('[data-lot-alert-btn]');
        if (alertBtn) alertBtn.dataset.alertActive = qTotal > nbPieces ? 'true' : 'false';

        // Mise à jour des dimensions moyennes dans le formulaire lot
        if (nbPieces > 0) {
            const longueurInput = el('input[data-lot-input="longueur"]');
            const largeurInput = el('input[data-lot-input="largeur"]');
            const hauteurInput = el('input[data-lot-input="hauteur"]');
            if (longueurInput && document.activeElement !== longueurInput) {
                longueurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgLongueur || 0)));
            }
            if (largeurInput && document.activeElement !== largeurInput) {
                largeurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgLargeur || 0)));
            }
            if (hauteurInput && document.activeElement !== hauteurInput) {
                hauteurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgHauteur || 0)));
            }
        }

        // Rafraîchir la pièce par défaut dans le détail du lot
        const defaultCard = document.querySelector('[data-default-piece]');
        if (defaultCard) {
            const freshHTML = this.renderDefaultPieceCardHTML(lot);
            const temp = document.createElement('div');
            temp.innerHTML = freshHTML;
            const newCard = temp.firstElementChild;
            if (newCard) defaultCard.replaceWith(newCard);
        }
    }

    isAllotissementNumericField(field) {
        return [
            'quantite',
            'longueur',
            'largeur',
            'hauteur',
            'diametre',
            'prixMarche',
            'masseVolumique',
            'humidite',
            'fractionCarbonee',
            'bois'
        ].includes(field);
    }

    isCarbonPrixNumericField(field) {
        return [
            'prixMarche',
            'masseVolumique',
            'fractionCarbonee',
            'humidite',
            'bois'
        ].includes(field);
    }

    normalizeAllotissementNumericInput(rawValue) {
        const raw = (rawValue == null ? '' : String(rawValue))
            .replace(/[\s\u00A0\u202F]/g, '')
            .replace(/,/g, '.');

        if (!raw) return '';

        let cleaned = raw.replace(/[^0-9.\-]/g, '');
        cleaned = cleaned.replace(/(?!^)-/g, '');

        const firstDot = cleaned.indexOf('.');
        if (firstDot !== -1) {
            cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
        }

        if (cleaned === '-' || cleaned === '.' || cleaned === '-.') return '';
        return cleaned;
    }

    formatAllotissementNumericDisplay(rawValue) {
        const normalized = this.normalizeAllotissementNumericInput(rawValue);
        if (!normalized) return '';

        const negative = normalized.startsWith('-');
        const unsigned = negative ? normalized.slice(1) : normalized;
        const [intPartRaw, decPartRaw] = unsigned.split('.');
        const intPart = (intPartRaw || '0').replace(/^0+(?=\d)/, '');
        const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

        if (decPartRaw != null && decPartRaw !== '') {
            return `${negative ? '-' : ''}${groupedInt},${decPartRaw}`;
        }
        return `${negative ? '-' : ''}${groupedInt}`;
    }

    recalculateLotAllotissement(lot) {
        if (!lot || !lot.allotissement) return;
        const qRaw = parseFloat(lot.allotissement.quantite) || 0;
        const q = Math.max(qRaw, (Array.isArray(lot.pieces) ? lot.pieces.length : 0));
        const L = parseFloat(lot.allotissement.longueur) || 0;
        const l = parseFloat(lot.allotissement.largeur) || 0;
        const h = parseFloat(lot.allotissement.hauteur) || 0;
        const d = parseFloat(lot.allotissement.diametre) || 0;
        const pm = parseFloat(lot.allotissement.prixMarche) || 0;
        const integrityFactor = this.getLotIntegrityPriceFactor(lot);
        const priceUnitRaw = ((lot.allotissement.prixUnite || 'm3') + '').toLowerCase();
        const priceUnit = (priceUnitRaw === 'ml' || priceUnitRaw === 'm2' || priceUnitRaw === 'm3') ? priceUnitRaw : 'm3';
        lot.allotissement.prixUnite = priceUnit;

        lot.allotissement.surfacePiece = (L * l) / 1000000;
        lot.allotissement.surfaceLot = lot.allotissement.surfacePiece * q;
        if (d > 0) {
            const rayon = d / 2;
            lot.allotissement.volumePiece = (Math.PI * rayon * rayon * L) / 1000000000;
        } else {
            lot.allotissement.volumePiece = (L * l * h) / 1000000000;
        }
        lot.allotissement.volumeLot = lot.allotissement.volumePiece * q;
        lot.allotissement.lineaireLot = (q * L) / 1000;

        const pricingBase =
            priceUnit === 'ml' ? lot.allotissement.lineaireLot :
            priceUnit === 'm2' ? lot.allotissement.surfaceLot :
            lot.allotissement.volumeLot;

        lot.allotissement.prixLot = pricingBase * pm;
        lot.allotissement.prixLotAjusteIntegrite = lot.allotissement.prixLot * integrityFactor;

        // Calcul de la masse du lot (Masse volumique en kg/m3 × Volume du lot en m3)
        const rhoMass = parseFloat(lot.allotissement.masseVolumique) || 0;
        const vForMass = parseFloat(lot.allotissement.volumeLot) || 0;
        lot.allotissement.masseLot = rhoMass * vForMass;

        // NF EN 16449:2014 -> cf fixe = 0.5
        const carbonFractionFixed = 0.5;
        const rho = parseFloat(lot.allotissement.masseVolumique) || 0;
        const vGross = parseFloat(lot.allotissement.volumeLot) || 0;
        const woodPct = parseFloat(lot.allotissement.bois);
        const mc = parseFloat(lot.allotissement.humidite);

        const safeWoodPct = Number.isFinite(woodPct) ? woodPct : 100;
        const safeMc = Number.isFinite(mc) ? mc : 12;
        const moistureDenominator = 1 + (safeMc / 100);

        const pco2Kg = moistureDenominator > 0
            ? (44 / 12) * carbonFractionFixed * rho * vGross * (safeWoodPct / 100) / moistureDenominator
            : 0;

        lot.allotissement.carboneBiogeniqueEstime = String(Math.max(0, Math.round(pco2Kg)));

        // ─── Agrégation pièces ───
        if (Array.isArray(lot.pieces) && lot.pieces.length > 0) {
            lot.pieces.forEach(p => this.recalculatePiece(p, lot));
            const numPieces = lot.pieces.length;
            const numDefault = Math.max(0, q - numPieces);

            // Somme des contributions des pièces individuelles
            let sumVolume = 0, sumSurface = 0, sumLineaire = 0;
            let sumPrix = 0, sumPrixAjuste = 0, sumMasse = 0, sumCO2 = 0;
            lot.pieces.forEach(p => {
                sumVolume += p.volumePiece || 0;
                sumSurface += p.surfacePiece || 0;
                sumLineaire += (parseFloat(p.longueur) || 0) / 1000;
                sumPrix += p.prixPiece || 0;
                sumPrixAjuste += p.prixPieceAjusteIntegrite || 0;
                sumMasse += p.massePiece || 0;
                sumCO2 += parseFloat(p.carboneBiogeniqueEstime) || 0;
            });

            // Contributions des pièces "par défaut" (sans formulaire dédié)
            const defaultVolPerPiece = lot.allotissement.volumePiece;
            const defaultSurfPerPiece = lot.allotissement.surfacePiece;
            const defaultLinPerPiece = L / 1000;
            const defaultPricingBase =
                priceUnit === 'ml' ? defaultLinPerPiece :
                priceUnit === 'm2' ? defaultSurfPerPiece :
                defaultVolPerPiece;
            const defaultPrixPerPiece = defaultPricingBase * pm;

            sumVolume += numDefault * defaultVolPerPiece;
            sumSurface += numDefault * defaultSurfPerPiece;
            sumLineaire += numDefault * defaultLinPerPiece;
            sumPrix += numDefault * defaultPrixPerPiece;
            sumPrixAjuste += numDefault * defaultPrixPerPiece * integrityFactor;
            sumMasse += numDefault * (rhoMass * defaultVolPerPiece);
            // CO2 pour pièces par défaut
            const defaultCO2PerPiece = moistureDenominator > 0
                ? (44 / 12) * carbonFractionFixed * rho * defaultVolPerPiece * (safeWoodPct / 100) / moistureDenominator
                : 0;
            sumCO2 += numDefault * defaultCO2PerPiece;

            lot.allotissement.volumeLot = sumVolume;
            lot.allotissement.surfaceLot = sumSurface;
            lot.allotissement.lineaireLot = sumLineaire;
            lot.allotissement.prixLot = sumPrix;
            lot.allotissement.prixLotAjusteIntegrite = sumPrixAjuste;
            lot.allotissement.masseLot = sumMasse;
            lot.allotissement.carboneBiogeniqueEstime = String(Math.max(0, Math.round(sumCO2)));

            // Volume unitaire moyen affiché dans le lot = moyenne pondérée
            if (q > 0) {
                lot.allotissement.volumePiece = sumVolume / q;
                lot.allotissement.surfacePiece = sumSurface / q;
            }

            // Moyenne pondérée des dimensions pour affichage dans le formulaire du lot
            let sumLongueur = 0, sumLargeur = 0, sumHauteur = 0;
            lot.pieces.forEach(p => {
                sumLongueur += parseFloat(p.longueur) || 0;
                sumLargeur += parseFloat(p.largeur) || 0;
                sumHauteur += parseFloat(p.hauteur) || 0;
            });
            sumLongueur += numDefault * L;
            sumLargeur += numDefault * l;
            sumHauteur += numDefault * h;
            if (q > 0) {
                lot.allotissement._avgLongueur = sumLongueur / q;
                lot.allotissement._avgLargeur = sumLargeur / q;
                lot.allotissement._avgHauteur = sumHauteur / q;
            } else {
                lot.allotissement._avgLongueur = L;
                lot.allotissement._avgLargeur = l;
                lot.allotissement._avgHauteur = h;
            }
        } else {
            lot.allotissement._avgLongueur = L;
            lot.allotissement._avgLargeur = l;
            lot.allotissement._avgHauteur = h;
        }
    }

    recalculatePiece(piece, lot) {
        const L = parseFloat(piece.longueur) || 0;
        const l = parseFloat(piece.largeur) || 0;
        const h = parseFloat(piece.hauteur) || 0;
        const d = parseFloat(piece.diametre) || 0;
        const pm = parseFloat(piece.prixMarche || lot.allotissement.prixMarche) || 0;
        const priceUnitRaw = ((piece.prixUnite || lot.allotissement.prixUnite || 'm3') + '').toLowerCase();
        const priceUnit = (priceUnitRaw === 'ml' || priceUnitRaw === 'm2' || priceUnitRaw === 'm3') ? priceUnitRaw : 'm3';
        const integrityFactor = this.getLotIntegrityPriceFactor(lot);

        piece.surfacePiece = (L * l) / 1000000;
        if (d > 0) {
            const rayon = d / 2;
            piece.volumePiece = (Math.PI * rayon * rayon * L) / 1000000000;
        } else {
            piece.volumePiece = (L * l * h) / 1000000000;
        }

        const lineairePiece = L / 1000;
        const pricingBase =
            priceUnit === 'ml' ? lineairePiece :
            priceUnit === 'm2' ? piece.surfacePiece :
            piece.volumePiece;
        piece.prixPiece = pricingBase * pm;
        piece.prixPieceAjusteIntegrite = piece.prixPiece * integrityFactor;

        // Carbone pour cette pièce
        const rho = parseFloat(piece.masseVolumique || lot.allotissement.masseVolumique) || 0;
        piece.massePiece = rho * piece.volumePiece;
        const carbonFractionFixed = 0.5;
        const woodPct = parseFloat(piece.bois !== '' ? piece.bois : lot.allotissement.bois);
        const mc = parseFloat(piece.humidite !== '' ? piece.humidite : lot.allotissement.humidite);
        const safeWoodPct = Number.isFinite(woodPct) ? woodPct : 100;
        const safeMc = Number.isFinite(mc) ? mc : 12;
        const moistureDenominator = 1 + (safeMc / 100);
        const pco2Kg = moistureDenominator > 0
            ? (44 / 12) * carbonFractionFixed * rho * piece.volumePiece * (safeWoodPct / 100) / moistureDenominator
            : 0;
        piece.carboneBiogeniqueEstime = String(Math.max(0, Math.round(pco2Kg)));
    }

    setCurrentLotIndex(index) {
        this.currentLotIndex = index;
        this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
        this.render();
    }

    openDeleteLotModal(index) {
    this.pendingDeleteLotIndex = index;

    const backdrop = document.getElementById('deleteLotConfirmBackdrop');
    const message = document.getElementById('deleteLotConfirmMessage');

    if (backdrop) {
        if (message) {
            message.textContent = `Voulez-vous vraiment supprimer le lot ${index + 1} ?`;
        }
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

    closeDeleteLotModal() {
        const backdrop = document.getElementById('deleteLotConfirmBackdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
        this.pendingDeleteLotIndex = null;
    }

    confirmDeleteLot() {
        if (this.pendingDeleteLotIndex === null) return;
        const index = this.pendingDeleteLotIndex;
        this.pendingDeleteLotIndex = null;

        this.deleteLot(index);
        this.closeDeleteLotModal();
    }

    closeResetConfirmModal() {
        const backdrop = document.getElementById('resetConfirmBackdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
        this.pendingResetConfirmAction = null;
    }

    confirmResetAction() {
        const action = this.pendingResetConfirmAction;
        this.pendingResetConfirmAction = null;
        this.closeResetConfirmModal();
        if (typeof action === 'function') {
            action();
        }
    }

    getNotationResetLabel(row) {
        if (!row) return '';
        const criterionLabel = row.querySelector(':is(.bio-label-box, .mech-label-box, .usage-label-box, .denat-label-box, .debit-label-box, .geo-label-box, .essence-label-box, .ancien-label-box, .traces-label-box, .provenance-label-box)');
        const text = criterionLabel ? (criterionLabel.textContent || '').replace(/\s+/g, ' ').trim() : '';
        return text;
    }

    refreshNotationRowSlider(row) {
        if (!row) return;
        const slider = row.querySelector('.bio-slider, .mech-slider, .usage-slider, .denat-slider, .debit-slider, .geo-slider, .essence-slider, .ancien-slider, .traces-slider, .provenance-slider');
        if (slider && typeof slider.__refreshActiveSliderLabel === 'function') {
            requestAnimationFrame(() => slider.__refreshActiveSliderLabel());
        }
    }

    setupNotationResetConfirmations() {
        const selector = [
            '.bio-reset-btn',
            '.mech-reset-btn',
            '.usage-reset-btn',
            '.denat-reset-btn',
            '.debit-reset-btn',
            '.geo-reset-btn',
            '.essence-reset-btn',
            '.ancien-reset-btn',
            '.traces-reset-btn',
            '.provenance-reset-btn'
        ].join(', ');

        document.querySelectorAll(selector).forEach((btn) => {
            const originalHandler = btn.onclick;
            if (typeof originalHandler !== 'function') return;
            if (btn.__notationResetOriginalHandler === originalHandler) return;

            btn.__notationResetOriginalHandler = originalHandler;
            btn.onclick = (event) => {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                const row = btn.closest('.bio-row, .mech-row, .usage-row, .denat-row, .debit-row, .geo-row, .essence-row, .ancien-row, .traces-row, .provenance-row');
                const criterionLabel = this.getNotationResetLabel(row);
                const message = criterionLabel
                    ? `Voulez-vous vraiment réinitialiser le critere \"${criterionLabel}\" ?`
                    : 'Voulez-vous vraiment réinitialiser ce critere ?';

                this.openResetConfirmModal({
                    title: 'Réinitialiser le critere',
                    message,
                    confirmLabel: 'Oui, réinitialiser',
                    onConfirm: () => {
                        btn.__notationResetOriginalHandler();
                        this.refreshNotationRowSlider(row);
                    }
                });
            };
        });
    }


deleteLot(index) {
    if (!this.data.lots || this.data.lots.length === 0) return;

    this.data.lots.splice(index, 1);

    if (this.data.lots.length === 0) {
        this.data.lots.push(this.createEmptyLot(0));
        this.currentLotIndex = 0;
    } else if (this.currentLotIndex >= this.data.lots.length) {
        this.currentLotIndex = this.data.lots.length - 1;
    }

    this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
    this.render();
}

    setupNotationResetIcons() {
        const resetSelector = [
            '.bio-reset-btn',
            '.mech-reset-btn',
            '.usage-reset-btn',
            '.denat-reset-btn',
            '.debit-reset-btn',
            '.geo-reset-btn',
            '.essence-reset-btn',
            '.ancien-reset-btn',
            '.traces-reset-btn',
            '.provenance-reset-btn',
            '.inspection-reset-btn'
        ].join(', ');

        const iconMarkup = `
  <svg
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <polyline points="3 3 3 8 8 8" />
  </svg>
  <span class="sr-only">Réinitialiser</span>
`;

        document.querySelectorAll(resetSelector).forEach((btn) => {
            if (btn.dataset.iconifiedReset === '1') return;
            btn.classList.add('btn-reset');
            btn.setAttribute('aria-label', 'Réinitialiser le formulaire');
            btn.setAttribute('title', 'Réinitialiser');
            btn.innerHTML = iconMarkup;
            btn.dataset.iconifiedReset = '1';
        });
    }

        setupInspectionIgnoreIcons() {
                const ignoreSelector = '.inspection-ignore-btn';
                const iconMarkup = `
    <svg
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 15.5 15.5 8.5" />
    </svg>
    <span class="sr-only">Ignorer</span>
`;

                document.querySelectorAll(ignoreSelector).forEach((btn) => {
                        if (btn.dataset.iconifiedIgnore === '1') return;
                        btn.classList.add('btn-ignore');
                        btn.setAttribute('aria-label', 'Ignorer ce critere');
                        btn.setAttribute('title', 'Ignorer');
                        btn.innerHTML = iconMarkup;
                        btn.dataset.iconifiedIgnore = '1';
                });
        }

    bindEvents() {
        this.setupNotationResetIcons();
                this.setupInspectionIgnoreIcons();

        // Bouton mode jour / nuit
        const btnThemeToggle = document.getElementById('btnThemeToggle');
        if (btnThemeToggle) {
            const savedTheme = localStorage.getItem('valoboisTheme');
            if (savedTheme !== 'night') {
                document.body.classList.add('day-mode');
                btnThemeToggle.textContent = 'Mode nuit';
            }
            btnThemeToggle.addEventListener('click', () => {
                const isDay = document.body.classList.toggle('day-mode');
                btnThemeToggle.textContent = isDay ? 'Mode nuit' : 'Mode jour';
                localStorage.setItem('valoboisTheme', isDay ? 'day' : 'night');
            });
        }

        // Toggle À propos
        const aproposBtn = document.getElementById('btnAproposToggle');
        const aproposContent = document.getElementById('aproposContent');
        if (aproposBtn && aproposContent) {
            aproposBtn.addEventListener('click', () => {
                const isHidden = aproposContent.hasAttribute('hidden');
                if (!this.data.ui) this.data.ui = this.getDefaultUi();
                if (!this.data.ui.collapsibles) this.data.ui.collapsibles = this.getDefaultUi().collapsibles;
                if (isHidden) {
                    aproposContent.removeAttribute('hidden');
                    aproposBtn.setAttribute('aria-expanded', 'true');
                    this.data.ui.collapsibles.apropos = true;
                } else {
                    aproposContent.setAttribute('hidden', '');
                    aproposBtn.setAttribute('aria-expanded', 'false');
                    this.data.ui.collapsibles.apropos = false;
                }
                this.saveData();
            });
        }

        const accueilCollapsibles = document.querySelectorAll('[data-ui-collapsible]');
        accueilCollapsibles.forEach((detailsEl) => {
            detailsEl.addEventListener('toggle', () => {
                const key = detailsEl.getAttribute('data-ui-collapsible');
                if (!key) return;
                if (!this.data.ui) this.data.ui = this.getDefaultUi();
                if (!this.data.ui.collapsibles) this.data.ui.collapsibles = this.getDefaultUi().collapsibles;
                this.data.ui.collapsibles[key] = detailsEl.open;
                this.saveData();
            });
        });

        // Champs méta
        const metainputs = document.querySelectorAll('[data-meta-field]');
        metainputs.forEach((el) => {
            const handleMetaUpdate = () => {
                const field = el.getAttribute('data-meta-field');
                if (!field) return;
                this.data.meta = this.getDefaultMeta(this.data.meta || {});
                
                // Special handling for statute slider
                if (field === 'statutEtude' && el.type === 'range') {
                    const statutMapValues = ['Pré-diagnostic', 'En cours', 'Finalisé', 'Révision', 'Cloturé'];
                    this.data.meta[field] = statutMapValues[parseInt(el.value)] || '';
                    
                    // Update active label styling
                    const sliderWrapper = el.closest('.bio-slider-wrapper');
                    if (sliderWrapper) {
                        const labels = sliderWrapper.querySelectorAll('.bio-slider-label');
                        labels.forEach((label) => {
                            label.classList.remove('bio-slider-label--active');
                            if (label.getAttribute('data-index') === el.value) {
                                label.classList.add('bio-slider-label--active');
                            }
                        });
                    }
                } else {
                    this.data.meta[field] = el.value;
                }
                
                this.renderAccueilMeta();
                this.saveData();
                const activeLot = this.getCurrentLot(); // On récupère le lot actuel
                if (activeLot) {
                    this.computeOrientation(activeLot);
                }
            };

            el.addEventListener('input', handleMetaUpdate);
            el.addEventListener('change', handleMetaUpdate);
        });

        // Boutons toggle diagnostics (Oui / Non / Inconnu)
        document.querySelectorAll('button[data-meta-toggle-field]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const field = btn.getAttribute('data-meta-toggle-field');
                const value = btn.getAttribute('data-meta-toggle-value');
                if (!field || !value) return;
                this.data.meta = this.getDefaultMeta(this.data.meta || {});
                this.data.meta[field] = value;
                this.syncMetaToggleGroup(field);
                this.saveData();
            });
        });

        // Premier clic sur slider en état neutre: sélectionne le niveau cliqué
        const neutralNotationSliders = document.querySelectorAll('.bio-slider, .mech-slider, .usage-slider, .denat-slider, .debit-slider, .geo-slider, .essence-slider, .ancien-slider, .traces-slider, .provenance-slider');
        neutralNotationSliders.forEach((slider) => {
            const commitNeutralSliderSelection = (event) => {
                const row = slider.closest('.bio-row, .mech-row, .usage-row, .denat-row, .debit-row, .geo-row, .essence-row, .ancien-row, .traces-row, .provenance-row');
                if (!row || !/--disabled\b/.test(row.className)) return;

                const level = this.getSliderLevelFromEvent(slider, event, 3);
                if (level == null) return;

                slider.value = String(level);
                slider.dispatchEvent(new Event('input'));
            };

            slider.addEventListener('click', commitNeutralSliderSelection);
            slider.addEventListener('pointerup', commitNeutralSliderSelection);
            slider.addEventListener('touchend', commitNeutralSliderSelection);
        });

        // Appliquer la logique visuelle du slider "Statut de l'étude" à tous les sliders de notation/inspection
        (function enhanceAllSliders() {
            const sliderWrapperSelectors = [
                '.bio-slider-wrapper',
                '.mech-slider-wrapper',
                '.usage-slider-wrapper',
                '.denat-slider-wrapper',
                '.debit-slider-wrapper',
                '.geo-slider-wrapper',
                '.essence-slider-wrapper',
                '.ancien-slider-wrapper',
                '.traces-slider-wrapper',
                '.provenance-slider-wrapper'
            ];

            // Pour chaque wrapper de slider, si l'affichage visuel (ligne + points) n'existe pas,
            // on le recrée en s'appuyant sur la structure CSS déjà prévue pour le statut.
            document.querySelectorAll(sliderWrapperSelectors.join(',')).forEach((wrapper) => {
                // Ne pas dupliquer si un affichage est déjà présent (statut, inspection, etc.)
                if (wrapper.querySelector('.bio-slider-display--statut, .inspection-slider-display')) return;
                const scale = wrapper.querySelector('.bio-slider-scale, .mech-slider-scale, .usage-slider-scale, .denat-slider-scale, .debit-slider-scale, .geo-slider-scale, .essence-slider-scale, .ancien-slider-scale, .traces-slider-scale, .provenance-slider-scale, .inspection-slider-scale');
                const slider = wrapper.querySelector('input[type="range"]');
                if (!scale || !slider) return;

                const display = document.createElement('div');
                display.className = 'bio-slider-display--statut';
                display.setAttribute('aria-hidden', 'true');

                const line = document.createElement('div');
                line.className = 'bio-slider-display-line--statut';

                // Aligne les crans d'abord sur les steps du slider, sinon sur les labels
                const labels = Array.from(scale.children);
                const min = Number(slider.min);
                const max = Number(slider.max);
                const step = Number(slider.step || 1);
                const stepCount = Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && step > 0
                    ? Math.round((max - min) / step) + 1
                    : NaN;
                const dotCount = Math.max(2, Number.isFinite(stepCount) ? stepCount : labels.length);
                for (let i = 0; i < dotCount; i++) {
                    const dot = document.createElement('span');
                    dot.className = 'bio-slider-dot--statut';
                    line.appendChild(dot);
                }

                display.appendChild(line);
                // Insère avant le slider afin que le DOM corresponde à l'implémentation du statut
                wrapper.insertBefore(display, slider);

                // Applique un style de piste transparente pour éviter un double track visuel
                slider.classList.add('slider--statut-visual');
            });

            // Synchroniser l'état "actif" des labels quand la valeur du slider change
            const fallbackNotesBySliderKey = {
                purge: [-3, 1, 3],
                expansion: [-10, -3, 3],
                integriteBio: [3, 1, -10],
                exposition: [-3, 1, 3],
                confianceBio: [3, 2, 1],

                purgeMech: [-3, 1, 3],
                feuMech: [3, 2, 1],
                integriteMech: [3, -3, -10],
                expositionMech: [-3, 1, 3],
                confianceMech: [3, 2, 1],

                confianceUsage: [3, 2, 1],
                durabiliteUsage: [3, 2, 1],
                classementUsage: [3, 2, 1],
                humiditeUsage: [-3, 3, 1],
                aspectUsage: [3, 2, 1],

                depollutionDenat: [-3, 1, 3],
                contaminationDenat: [-10, 1, 3],
                durabiliteConfDenat: [1, 2, 3],
                confianceDenat: [3, 2, 1],
                naturaliteDenat: [3, 2, 1],

                regulariteDebit: [3, 2, 1],
                volumetrieDebit: [3, 2, 1],
                stabiliteDebit: [3, 2, 1],
                artisanaliteDebit: [3, 2, 1],
                rusticiteDebit: [3, 2, 1],

                adaptabiliteGeo: [3, 2, 1],
                massiviteGeo: [3, 2, 1],
                deformationGeo: [-3, 1, 3],
                industrialiteGeo: [3, 2, 1],
                inclusiviteGeo: [3, 2, 1],

                confianceEssence: [3, 2, 1],
                rareteEcoEssence: [3, 2, 1],
                masseVolEssence: [3, 2, 1],
                rareteHistEssence: [3, 2, 1],
                singulariteEssence: [3, 2, 1],

                confianceAncien: [3, 2, 1],
                amortissementAncien: [3, 1, -3],
                vieillissementAncien: [-3, 1, 3],
                microhistoireAncien: [3, 2, 1],
                demontabiliteAncien: [3, 2, -3],

                confianceTraces: [3, 2, 1],
                etiquetageTraces: [3, 2, 1],
                alterationTraces: [-10, 1, 3],
                documentationTraces: [3, 1, -3],
                singularitesTraces: [3, 2, 1],

                confianceProv: [3, 2, 1],
                transportProv: [-3, 1, 3],
                reputationProv: [3, 2, 1],
                macroProv: [3, 2, 1],
                territorialiteProv: [3, 2, 1],

                visibilite: [1, 2, 3],
                instrumentation: [1, 2, 3],
                integrite: ['0,7', '0,3', '0,1']
            };

            const placeholders = new Set(['', '...', '…', 'Coeff. …']);
            const formatFallbackNote = (value) => {
                if (value == null) return '';
                if (typeof value === 'number') return (value > 0 ? '+' : '') + String(value);
                return String(value);
            };

            const allSliders = document.querySelectorAll('.bio-slider, .mech-slider, .usage-slider, .denat-slider, .debit-slider, .geo-slider, .essence-slider, .ancien-slider, .traces-slider, .provenance-slider, .inspection-slider');

            const refreshAllSliderLabels = () => {
                document.querySelectorAll('.bio-slider, .mech-slider, .usage-slider, .denat-slider, .debit-slider, .geo-slider, .essence-slider, .ancien-slider, .traces-slider, .provenance-slider, .inspection-slider').forEach((sliderEl) => {
                    if (typeof sliderEl.__refreshActiveSliderLabel === 'function') {
                        sliderEl.__refreshActiveSliderLabel();
                    }
                });
            };

            allSliders.forEach((s) => {
                const updateActiveLabel = () => {
                    const wrapper = s.closest(sliderWrapperSelectors.join(',')) || s.closest('.inspection-slider-wrapper');
                    if (!wrapper) return;
                    const scale = wrapper.querySelector('.bio-slider-scale, .mech-slider-scale, .usage-slider-scale, .denat-slider-scale, .debit-slider-scale, .geo-slider-scale, .essence-slider-scale, .ancien-slider-scale, .traces-slider-scale, .provenance-slider-scale, .inspection-slider-scale');
                    if (!scale) return;
                    const labels = Array.from(scale.children);
                    const row = s.closest('.inspection-row, .bio-row, .mech-row, .usage-row, .denat-row, .debit-row, .geo-row, .essence-row, .ancien-row, .traces-row, .provenance-row');
                    const key = s.getAttribute('data-slider');
                    labels.forEach((l) => {
                        l.classList.remove('bio-slider-label--active', 'slider-label--active');
                        l.removeAttribute('data-note');
                    });

                    // Différents sliders utilisent des gammes distinctes :
                    // - notation standard : valeurs 1..3 (3 étapes)
                    // - statut : 0..4 (5 étapes)
                    // - fallback : clamp sur le nombre de labels
                    const val = Number(s.value);
                    let target;
                    if (labels.length === 3) {
                        target = Math.max(0, Math.min(2, val - 1));
                    } else {
                        target = Math.max(0, Math.min(labels.length - 1, val));
                    }

                    const fallbackByStep = key ? fallbackNotesBySliderKey[key] : null;
                    if (Array.isArray(fallbackByStep)) {
                        labels.forEach((labelEl, idx) => {
                            const fallbackNote = formatFallbackNote(fallbackByStep[idx]);
                            if (fallbackNote && !placeholders.has(fallbackNote)) {
                                labelEl.setAttribute('data-note', fallbackNote);
                            }
                        });
                    }

                    if (labels[target]) {
                        labels[target].classList.add('slider-label--active');
                        labels[target].classList.add('bio-slider-label--active');

                        let noteText = '';

                        if (row && key) {
                            const noteBox = row.querySelector(`[data-intensity="${key}"]`);
                            if (noteBox) {
                                noteText = (noteBox.textContent || '').trim();
                            }

                            // Si la ligne est grisée/reset (note box = ...), on calcule une note fallback
                            // à partir du critère et de la position active du slider.
                            if (placeholders.has(noteText)) {
                                if (Array.isArray(fallbackByStep) && fallbackByStep[target] != null) {
                                    noteText = formatFallbackNote(fallbackByStep[target]);
                                }
                            }
                        }

                        if (noteText && !placeholders.has(noteText)) {
                            labels[target].setAttribute('data-note', noteText);
                        }
                    }
                };

                s.__refreshActiveSliderLabel = updateActiveLabel;

                const scheduleUpdateActiveLabel = () => {
                    requestAnimationFrame(updateActiveLabel);
                };

                s.addEventListener('input', scheduleUpdateActiveLabel);
                s.addEventListener('change', scheduleUpdateActiveLabel);
                // initialisation au chargement
                updateActiveLabel();
            });

            // Après reset/ignorer, les classes disabled changent sans événement slider.
            // On force alors une resynchronisation visuelle au frame suivant.
            document.addEventListener('click', (event) => {
                const targetBtn = event.target && event.target.closest
                    ? event.target.closest('.inspection-ignore-btn, .inspection-reset-btn, .bio-reset-btn, .mech-reset-btn, .usage-reset-btn, .denat-reset-btn, .debit-reset-btn, .geo-reset-btn, .essence-reset-btn, .ancien-reset-btn, .traces-reset-btn, .provenance-reset-btn')
                    : null;
                if (!targetBtn) return;
                requestAnimationFrame(refreshAllSliderLabels);
            });
        })();

        // Modale confirmation suppression de lot
        const deleteLotBackdrop = document.getElementById('deleteLotConfirmBackdrop');
        const btnCloseDeleteLotConfirm = document.getElementById('btnCloseDeleteLotConfirm');
        const btnCancelDeleteLot = document.getElementById('btnCancelDeleteLot');
        const btnConfirmDeleteLot = document.getElementById('btnConfirmDeleteLot');
        if (deleteLotBackdrop && btnCloseDeleteLotConfirm && btnCancelDeleteLot && btnConfirmDeleteLot) {
            btnCloseDeleteLotConfirm.addEventListener('click', () => this.closeDeleteLotModal());
            btnCancelDeleteLot.addEventListener('click', () => this.closeDeleteLotModal());
            btnConfirmDeleteLot.addEventListener('click', () => this.confirmDeleteLot());

            deleteLotBackdrop.addEventListener('click', (e) => {
                if (e.target === deleteLotBackdrop) {
                    this.closeDeleteLotModal();
                }
            });
        }

        // Modale alerte pièces non détaillées
        const alertPiecesBackdrop = document.getElementById('alertPiecesModalBackdrop');
        const btnCloseAlertPieces = document.getElementById('btnCloseAlertPiecesModal');
        const btnOkAlertPieces = document.getElementById('btnOkAlertPiecesModal');
        const closeAlertPiecesModal = () => {
            if (alertPiecesBackdrop) { alertPiecesBackdrop.classList.add('hidden'); alertPiecesBackdrop.setAttribute('aria-hidden', 'true'); }
        };
        if (alertPiecesBackdrop) {
            if (btnCloseAlertPieces) btnCloseAlertPieces.addEventListener('click', closeAlertPiecesModal);
            if (btnOkAlertPieces) btnOkAlertPieces.addEventListener('click', closeAlertPiecesModal);
            alertPiecesBackdrop.addEventListener('click', (e) => {
                if (e.target === alertPiecesBackdrop) closeAlertPiecesModal();
            });
        }

        // Modale confirmation suppression de pièce
        this._pendingDeletePiece = null;
        const deletePieceBackdrop = document.getElementById('deletePieceConfirmBackdrop');
        const btnCloseDeletePiece = document.getElementById('btnCloseDeletePieceConfirm');
        const btnCancelDeletePiece = document.getElementById('btnCancelDeletePiece');
        const btnConfirmDeletePiece = document.getElementById('btnConfirmDeletePiece');
        const closeDeletePieceModal = () => {
            if (deletePieceBackdrop) { deletePieceBackdrop.classList.add('hidden'); deletePieceBackdrop.setAttribute('aria-hidden', 'true'); }
        };
        if (deletePieceBackdrop) {
            if (btnCloseDeletePiece) btnCloseDeletePiece.addEventListener('click', closeDeletePieceModal);
            if (btnCancelDeletePiece) btnCancelDeletePiece.addEventListener('click', closeDeletePieceModal);
            deletePieceBackdrop.addEventListener('click', (e) => {
                if (e.target === deletePieceBackdrop) closeDeletePieceModal();
            });
            if (btnConfirmDeletePiece) {
                btnConfirmDeletePiece.addEventListener('click', () => {
                    closeDeletePieceModal();
                    if (this._pendingDeletePiece) {
                        const { lot, pi } = this._pendingDeletePiece;
                        this._pendingDeletePiece = null;
                        lot.pieces.splice(pi, 1);
                        lot.pieces.forEach((p, idx) => { p.nom = `Pièce ${idx + 1}`; });
                        lot.allotissement.quantite = String(lot.pieces.length || '');
                        this.recalculateLotAllotissement(lot);
                        this.saveData();
                        this.renderAllotissement();
                        this.renderDetailLot();
                    }
                });
            }
        }

        // Modale allotissement
        const allotissementBtn = document.getElementById('btnAllotissementInfo');
        const allotissementBackdrop = document.getElementById('allotissementModalBackdrop');
        const allotissementClose = document.getElementById('btnCloseAllotissementModal');
        const allotissementCloseFooter = document.getElementById('btnCloseAllotissementModalFooter');

        if (allotissementBtn && allotissementBackdrop && allotissementClose && allotissementCloseFooter) {
            allotissementBtn.addEventListener('click', () => this.openAllotissementModal());
            allotissementClose.addEventListener('click', () => this.closeAllotissementModal());
            allotissementCloseFooter.addEventListener('click', () => this.closeAllotissementModal());
            allotissementBackdrop.addEventListener('click', (e) => {
                if (e.target === allotissementBackdrop) this.closeAllotissementModal();
            });
        }

        // Modale import documents (placeholder)
        const importButtons = document.querySelectorAll('[data-import-target]');
        const documentsImportBackdrop = document.getElementById('documentsImportModalBackdrop');
        const btnCloseDocumentsImportModal = document.getElementById('btnCloseDocumentsImportModal');
        const btnCloseDocumentsImportModalFooter = document.getElementById('btnCloseDocumentsImportModalFooter');

        if (importButtons.length && documentsImportBackdrop && btnCloseDocumentsImportModal && btnCloseDocumentsImportModalFooter) {
            importButtons.forEach((btn) => {
                btn.addEventListener('click', () => this.openDocumentsImportModal());
            });
            btnCloseDocumentsImportModal.addEventListener('click', () => this.closeDocumentsImportModal());
            btnCloseDocumentsImportModalFooter.addEventListener('click', () => this.closeDocumentsImportModal());
            documentsImportBackdrop.addEventListener('click', (e) => {
                if (e.target === documentsImportBackdrop) this.closeDocumentsImportModal();
            });
        }


        // Modales inspection
        const inspBtn = document.getElementById('btnInspectionInfo');
        const inspBackdrop = document.getElementById('inspectionModalBackdrop');
        const inspClose = document.getElementById('btnCloseInspectionModal');
        const inspCloseFooter = document.getElementById('btnCloseInspectionModalFooter');

        if (inspBtn && inspBackdrop && inspClose && inspCloseFooter) {
            inspBtn.addEventListener('click', () => this.openInspectionModal());
            inspClose.addEventListener('click', () => this.closeInspectionModal());
            inspCloseFooter.addEventListener('click', () => this.closeInspectionModal());
            inspBackdrop.addEventListener('click', (e) => {
                if (e.target === inspBackdrop) this.closeInspectionModal();
            });
        }

        const inspDetailBackdrop = document.getElementById('inspectionDetailModalBackdrop');
        const inspDetailClose = document.getElementById('btnCloseInspectionDetailModal');
        const inspDetailCloseFooter = document.getElementById('btnCloseInspectionDetailModalFooter');

        if (inspDetailBackdrop && inspDetailClose && inspDetailCloseFooter) {
            inspDetailClose.addEventListener('click', () => this.closeInspectionDetailModal());
            inspDetailCloseFooter.addEventListener('click', () => this.closeInspectionDetailModal());
            inspDetailBackdrop.addEventListener('click', (e) => {
                if (e.target === inspDetailBackdrop) this.closeInspectionDetailModal();
            });
        }

        // Modales bio
        const bioBtn = document.getElementById('btnBioInfo');
        const bioBackdrop = document.getElementById('bioModalBackdrop');
        const bioClose = document.getElementById('btnCloseBioModal');
        const bioCloseFooter = document.getElementById('btnCloseBioModalFooter');

        if (bioBtn && bioBackdrop && bioClose && bioCloseFooter) {
            bioBtn.addEventListener('click', () => this.openBioModal());
            bioClose.addEventListener('click', () => this.closeBioModal());
            bioCloseFooter.addEventListener('click', () => this.closeBioModal());
            bioBackdrop.addEventListener('click', (e) => {
                if (e.target === bioBackdrop) this.closeBioModal();
            });
        }

        const bioDetailBackdrop = document.getElementById('bioDetailModalBackdrop');
        const bioDetailClose = document.getElementById('btnCloseBioDetailModal');
        const bioDetailCloseFooter = document.getElementById('btnCloseBioDetailModalFooter');

        if (bioDetailBackdrop && bioDetailClose && bioDetailCloseFooter) {
            bioDetailClose.addEventListener('click', () => this.closeBioDetailModal());
            bioDetailCloseFooter.addEventListener('click', () => this.closeBioDetailModal());
            bioDetailBackdrop.addEventListener('click', (e) => {
                if (e.target === bioDetailBackdrop) this.closeBioDetailModal();
            });
        }

        // Modale mech globale
const mechBtn = document.getElementById('btnMechInfo');
const mechBackdrop = document.getElementById('mechModalBackdrop');
const mechClose = document.getElementById('btnCloseMechModal');
const mechCloseFooter = document.getElementById('btnCloseMechModalFooter');

if (mechBtn && mechBackdrop && mechClose && mechCloseFooter) {
    mechBtn.addEventListener('click', () => this.openMechModal());
    mechClose.addEventListener('click', () => this.closeMechModal());
    mechCloseFooter.addEventListener('click', () => this.closeMechModal());
    mechBackdrop.addEventListener('click', (e) => {
        if (e.target === mechBackdrop) this.closeMechModal();
    });
}

// Modale détail mech
const mechDetailBackdrop = document.getElementById('mechDetailModalBackdrop');
const mechDetailClose = document.getElementById('btnCloseMechDetailModal');
const mechDetailCloseFooter = document.getElementById('btnCloseMechDetailModalFooter');

if (mechDetailBackdrop && mechDetailClose && mechDetailCloseFooter) {
    mechDetailClose.addEventListener('click', () => this.closeMechDetailModal());
    mechDetailCloseFooter.addEventListener('click', () => this.closeMechDetailModal());
    mechDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === mechDetailBackdrop) this.closeMechDetailModal();
    });
}
// Modale usage globale
const usageBtn = document.getElementById('btnUsageInfo');
const usageBackdrop = document.getElementById('usageModalBackdrop');
const usageClose = document.getElementById('btnCloseUsageModal');
const usageCloseFooter = document.getElementById('btnCloseUsageModalFooter');

if (usageBtn && usageBackdrop && usageClose && usageCloseFooter) {
    usageBtn.addEventListener('click', () => this.openUsageModal());
    usageClose.addEventListener('click', () => this.closeUsageModal());
    usageCloseFooter.addEventListener('click', () => this.closeUsageModal());
    usageBackdrop.addEventListener('click', (e) => {
        if (e.target === usageBackdrop) this.closeUsageModal();
    });
}

// Modale détail usage
const usageDetailBackdrop = document.getElementById('usageDetailModalBackdrop');
const usageDetailClose = document.getElementById('btnCloseUsageDetailModal');
const usageDetailCloseFooter = document.getElementById('btnCloseUsageDetailModalFooter');

if (usageDetailBackdrop && usageDetailClose && usageDetailCloseFooter) {
    usageDetailClose.addEventListener('click', () => this.closeUsageDetailModal());
    usageDetailCloseFooter.addEventListener('click', () => this.closeUsageDetailModal());
    usageDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === usageDetailBackdrop) this.closeUsageDetailModal();
    });
}

// Modale denat globale
const denatBtn = document.getElementById('btnDenatInfo');
const denatBackdrop = document.getElementById('denatModalBackdrop');
const denatClose = document.getElementById('btnCloseDenatModal');
const denatCloseFooter = document.getElementById('btnCloseDenatModalFooter');

if (denatBtn && denatBackdrop && denatClose && denatCloseFooter) {
    denatBtn.addEventListener('click', () => this.openDenatModal());
    denatClose.addEventListener('click', () => this.closeDenatModal());
    denatCloseFooter.addEventListener('click', () => this.closeDenatModal());
    denatBackdrop.addEventListener('click', (e) => {
        if (e.target === denatBackdrop) this.closeDenatModal();
    });
}

// Modale détail denat
const denatDetailBackdrop = document.getElementById('denatDetailModalBackdrop');
const denatDetailClose = document.getElementById('btnCloseDenatDetailModal');
const denatDetailCloseFooter = document.getElementById('btnCloseDenatDetailModalFooter');

if (denatDetailBackdrop && denatDetailClose && denatDetailCloseFooter) {
    denatDetailClose.addEventListener('click', () => this.closeDenatDetailModal());
    denatDetailCloseFooter.addEventListener('click', () => this.closeDenatDetailModal());
    denatDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === denatDetailBackdrop) this.closeDenatDetailModal();
    });
}

// Modale debit globale
const debitBtn = document.getElementById('btnDebitInfo');
const debitBackdrop = document.getElementById('debitModalBackdrop');
const debitClose = document.getElementById('btnCloseDebitModal');
const debitCloseFooter = document.getElementById('btnCloseDebitModalFooter');

if (debitBtn && debitBackdrop && debitClose && debitCloseFooter) {
    debitBtn.addEventListener('click', () => this.openDebitModal());
    debitClose.addEventListener('click', () => this.closeDebitModal());
    debitCloseFooter.addEventListener('click', () => this.closeDebitModal());
    debitBackdrop.addEventListener('click', (e) => {
        if (e.target === debitBackdrop) this.closeDebitModal();
    });
}

// Modale détail debit
const debitDetailBackdrop = document.getElementById('debitDetailModalBackdrop');
const debitDetailClose = document.getElementById('btnCloseDebitDetailModal');
const debitDetailCloseFooter = document.getElementById('btnCloseDebitDetailModalFooter');

if (debitDetailBackdrop && debitDetailClose && debitDetailCloseFooter) {
    debitDetailClose.addEventListener('click', () => this.closeDebitDetailModal());
    debitDetailCloseFooter.addEventListener('click', () => this.closeDebitDetailModal());
    debitDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === debitDetailBackdrop) this.closeDebitDetailModal();
    });
}

// Modale geo globale
const geoBtn = document.getElementById('btnGeoInfo');
const geoBackdrop = document.getElementById('geoModalBackdrop');
const geoClose = document.getElementById('btnCloseGeoModal');
const geoCloseFooter = document.getElementById('btnCloseGeoModalFooter');

if (geoBtn && geoBackdrop && geoClose && geoCloseFooter) {
    geoBtn.addEventListener('click', () => this.openGeoModal());
    geoClose.addEventListener('click', () => this.closeGeoModal());
    geoCloseFooter.addEventListener('click', () => this.closeGeoModal());
    geoBackdrop.addEventListener('click', (e) => {
        if (e.target === geoBackdrop) this.closeGeoModal();
    });
}

// Modale détail geo
const geoDetailBackdrop = document.getElementById('geoDetailModalBackdrop');
const geoDetailClose = document.getElementById('btnCloseGeoDetailModal');
const geoDetailCloseFooter = document.getElementById('btnCloseGeoDetailModalFooter');

if (geoDetailBackdrop && geoDetailClose && geoDetailCloseFooter) {
    geoDetailClose.addEventListener('click', () => this.closeGeoDetailModal());
    geoDetailCloseFooter.addEventListener('click', () => this.closeGeoDetailModal());
    geoDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === geoDetailBackdrop) this.closeGeoDetailModal();
    });
}

// Modale essence globale
const essenceBtn = document.getElementById('btnEssenceInfo');
const essenceBackdrop = document.getElementById('essenceModalBackdrop');
const essenceClose = document.getElementById('btnCloseEssenceModal');
const essenceCloseFooter = document.getElementById('btnCloseEssenceModalFooter');

if (essenceBtn && essenceBackdrop && essenceClose && essenceCloseFooter) {
    essenceBtn.addEventListener('click', () => this.openEssenceModal());
    essenceClose.addEventListener('click', () => this.closeEssenceModal());
    essenceCloseFooter.addEventListener('click', () => this.closeEssenceModal());
    essenceBackdrop.addEventListener('click', (e) => {
        if (e.target === essenceBackdrop) this.closeEssenceModal();
    });
}

// Modale détail essence
const essenceDetailBackdrop = document.getElementById('essenceDetailModalBackdrop');
const essenceDetailClose = document.getElementById('btnCloseEssenceDetailModal');
const essenceDetailCloseFooter = document.getElementById('btnCloseEssenceDetailModalFooter');

if (essenceDetailBackdrop && essenceDetailClose && essenceDetailCloseFooter) {
    essenceDetailClose.addEventListener('click', () => this.closeEssenceDetailModal());
    essenceDetailCloseFooter.addEventListener('click', () => this.closeEssenceDetailModal());
    essenceDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === essenceDetailBackdrop) this.closeEssenceDetailModal();
    });
}

// Modale ancien globale
const ancienBtn = document.getElementById('btnAncienInfo');
const ancienBackdrop = document.getElementById('ancienModalBackdrop');
const ancienClose = document.getElementById('btnCloseAncienModal');
const ancienCloseFooter = document.getElementById('btnCloseAncienModalFooter');

if (ancienBtn && ancienBackdrop && ancienClose && ancienCloseFooter) {
    ancienBtn.addEventListener('click', () => this.openAncienModal());
    ancienClose.addEventListener('click', () => this.closeAncienModal());
    ancienCloseFooter.addEventListener('click', () => this.closeAncienModal());
    ancienBackdrop.addEventListener('click', (e) => {
        if (e.target === ancienBackdrop) this.closeAncienModal();
    });
}

// Modale détail ancien
const ancienDetailBackdrop = document.getElementById('ancienDetailModalBackdrop');
const ancienDetailClose = document.getElementById('btnCloseAncienDetailModal');
const ancienDetailCloseFooter = document.getElementById('btnCloseAncienDetailModalFooter');

if (ancienDetailBackdrop && ancienDetailClose && ancienDetailCloseFooter) {
    ancienDetailClose.addEventListener('click', () => this.closeAncienDetailModal());
    ancienDetailCloseFooter.addEventListener('click', () => this.closeAncienDetailModal());
    ancienDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === ancienDetailBackdrop) this.closeAncienDetailModal();
    });
}

// Modale traces globale
const tracesBtn = document.getElementById('btnTracesInfo');
const tracesBackdrop = document.getElementById('tracesModalBackdrop');
const tracesClose = document.getElementById('btnCloseTracesModal');
const tracesCloseFooter = document.getElementById('btnCloseTracesModalFooter');

if (tracesBtn && tracesBackdrop && tracesClose && tracesCloseFooter) {
    tracesBtn.addEventListener('click', () => this.openTracesModal());
    tracesClose.addEventListener('click', () => this.closeTracesModal());
    tracesCloseFooter.addEventListener('click', () => this.closeTracesModal());
    tracesBackdrop.addEventListener('click', (e) => {
        if (e.target === tracesBackdrop) this.closeTracesModal();
    });
}

// Modale détail traces
const tracesDetailBackdrop = document.getElementById('tracesDetailModalBackdrop');
const tracesDetailClose = document.getElementById('btnCloseTracesDetailModal');
const tracesDetailCloseFooter = document.getElementById('btnCloseTracesDetailModalFooter');

if (tracesDetailBackdrop && tracesDetailClose && tracesDetailCloseFooter) {
    tracesDetailClose.addEventListener('click', () => this.closeTracesDetailModal());
    tracesDetailCloseFooter.addEventListener('click', () => this.closeTracesDetailModal());
    tracesDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === tracesDetailBackdrop) this.closeTracesDetailModal();
    });
}

        // Modale provenance globale
const provBtn = document.getElementById('btnProvenanceInfo');
const provBackdrop = document.getElementById('provenanceModalBackdrop');
const provClose = document.getElementById('btnCloseProvenanceModal');
const provCloseFooter = document.getElementById('btnCloseProvenanceModalFooter');

if (provBtn && provBackdrop && provClose && provCloseFooter) {
    provBtn.addEventListener('click', () => this.openProvenanceModal());
    provClose.addEventListener('click', () => this.closeProvenanceModal());
    provCloseFooter.addEventListener('click', () => this.closeProvenanceModal());
    provBackdrop.addEventListener('click', (e) => {
        if (e.target === provBackdrop) this.closeProvenanceModal();
    });
}

// Modale détail provenance
const provDetailBackdrop = document.getElementById('provenanceDetailModalBackdrop');
const provDetailClose = document.getElementById('btnCloseProvenanceDetailModal');
const provDetailCloseFooter = document.getElementById('btnCloseProvenanceDetailModalFooter');

if (provDetailBackdrop && provDetailClose && provDetailCloseFooter) {
    provDetailClose.addEventListener('click', () => this.closeProvenanceDetailModal());
    provDetailCloseFooter.addEventListener('click', () => this.closeProvenanceDetailModal());
    provDetailBackdrop.addEventListener('click', (e) => {
        if (e.target === provDetailBackdrop) this.closeProvenanceDetailModal();
    });
}

        // Seuils modale
        const seuilsBtn = document.getElementById('btnSeuilsInfo');
        const seuilsBackdrop = document.getElementById('seuilsModalBackdrop');
        const seuilsClose = document.getElementById('btnCloseSeuilsModal');
        const seuilsCloseFooter = document.getElementById('btnCloseSeuilsModalFooter');

        if (seuilsBtn && seuilsBackdrop && seuilsClose && seuilsCloseFooter) {
            seuilsBtn.addEventListener('click', () => this.openSeuilsModal());
            seuilsClose.addEventListener('click', () => this.closeSeuilsModal());
            seuilsCloseFooter.addEventListener('click', () => this.closeSeuilsModal());
            seuilsBackdrop.addEventListener('click', (e) => {
                if (e.target === seuilsBackdrop) this.closeSeuilsModal();
            });
        }

        // Radar modales
        const radarBtn = document.getElementById('btnRadarInfo');
        const radarBackdrop = document.getElementById('radarModalBackdrop');
        const radarClose = document.getElementById('btnCloseRadarModal');
        const radarCloseFooter = document.getElementById('btnCloseRadarModalFooter');

        if (radarBtn && radarBackdrop && radarClose && radarCloseFooter) {
            radarBtn.addEventListener('click', () => this.openRadarModal());
            radarClose.addEventListener('click', () => this.closeRadarModal());
            radarCloseFooter.addEventListener('click', () => this.closeRadarModal());
            radarBackdrop.addEventListener('click', (e) => {
                if (e.target === radarBackdrop) this.closeRadarModal();
            });
        }

// Modale Orientation
const orientBtn = document.getElementById('btnOrientationInfo');
const orientBackdrop = document.getElementById('orientationModalBackdrop');
const orientClose = document.getElementById('btnCloseOrientationModal');
const orientCloseFooter = document.getElementById('btnCloseOrientationModalFooter');

if (orientBtn && orientBackdrop && orientClose && orientCloseFooter) {
    orientBtn.addEventListener('click', () => this.openOrientationModal());
    orientClose.addEventListener('click', () => this.closeOrientationModal());
    orientCloseFooter.addEventListener('click', () => this.closeOrientationModal());
    orientBackdrop.addEventListener('click', (e) => {
        if (e.target === orientBackdrop) this.closeOrientationModal();
    });
}        

// Modale Évaluation de l'opération
const evalOpBtn = document.getElementById('btnEvalOpInfo');
const evalOpBackdrop = document.getElementById('evalOpModalBackdrop');
const evalOpClose = document.getElementById('btnCloseEvalOpModal');
const evalOpCloseFooter = document.getElementById('btnCloseEvalOpModalFooter');

if (evalOpBtn && evalOpBackdrop && evalOpClose && evalOpCloseFooter) {
    evalOpBtn.addEventListener('click', () => this.openEvalOpModal());
    evalOpClose.addEventListener('click', () => this.closeEvalOpModal());
    evalOpCloseFooter.addEventListener('click', () => this.closeEvalOpModal());
    evalOpBackdrop.addEventListener('click', (e) => {
        if (e.target === evalOpBackdrop) this.closeEvalOpModal();
    });
}

        // CTA bas de page
        const btnResetAll = document.getElementById('btnResetAll');
        const btnSaveAll = document.getElementById('btnSaveAll');
        const btnEtiqueter = document.getElementById('btnEtiqueter');
        const btnExportPdf = document.getElementById('btnExportPdf');

        if (btnResetAll) btnResetAll.addEventListener('click', () => this.openResetConfirmModal());
        if (btnSaveAll) btnSaveAll.addEventListener('click', () => this.openSaveConfirmModal());
        if (btnEtiqueter) btnEtiqueter.addEventListener('click', () => this.openEtiqueterModal());
        if (btnExportPdf) btnExportPdf.addEventListener('click', () => this.openExportPdfModal());

        const resetBackdrop = document.getElementById('resetConfirmBackdrop');
        const btnCloseResetConfirm = document.getElementById('btnCloseResetConfirm');
        const btnCancelReset = document.getElementById('btnCancelReset');
        const btnConfirmReset = document.getElementById('btnConfirmReset');

        if (resetBackdrop && btnCloseResetConfirm && btnCancelReset && btnConfirmReset) {
            btnCloseResetConfirm.addEventListener('click', () => this.closeResetConfirmModal());
            btnCancelReset.addEventListener('click', () => this.closeResetConfirmModal());
            resetBackdrop.addEventListener('click', (e) => {
                if (e.target === resetBackdrop) this.closeResetConfirmModal();
            });
            btnConfirmReset.addEventListener('click', () => this.confirmResetAction());
        }

        const saveBackdrop = document.getElementById('saveConfirmBackdrop');
        const btnCloseSaveConfirm = document.getElementById('btnCloseSaveConfirm');
        const btnCancelSave = document.getElementById('btnCancelSave');
        const btnConfirmSave = document.getElementById('btnConfirmSave');

        if (saveBackdrop && btnCloseSaveConfirm && btnCancelSave && btnConfirmSave) {
            const closeSave = () => {
                saveBackdrop.classList.add('hidden');
                saveBackdrop.setAttribute('aria-hidden', 'true');
            };
            btnCloseSaveConfirm.addEventListener('click', closeSave);
            btnCancelSave.addEventListener('click', closeSave);
            saveBackdrop.addEventListener('click', (e) => {
                if (e.target === saveBackdrop) closeSave();
            });
            btnConfirmSave.addEventListener('click', async () => {
                await this.saveAsHtmlFile();
                closeSave();
            });
        }

        const exportPdfBackdrop = document.getElementById('exportPdfBackdrop');
        const btnCloseExportPdf = document.getElementById('btnCloseExportPdf');
        const btnCancelExportPdf = document.getElementById('btnCancelExportPdf');
        const btnRunExport = document.getElementById('btnRunExport');
        const exportFileFormatSelect = document.getElementById('exportFileFormatSelect');
        const exportContentModeSelect = document.getElementById('exportContentModeSelect');
        const exportLotsHint = document.getElementById('exportLotsHint');
        const exportPdfLotsList = document.getElementById('exportPdfLotsList');

        if (exportPdfBackdrop && btnCloseExportPdf && btnCancelExportPdf && btnRunExport && exportFileFormatSelect && exportContentModeSelect && exportPdfLotsList) {
            const closeExportPdf = () => this.closeExportPdfModal();
            const updateExportLotsState = () => {
                const requiresLotSelection = exportContentModeSelect.value === 'lots-selectionnes';
                const lotCheckboxes = exportPdfLotsList.querySelectorAll('[data-export-pdf-lot]');
                lotCheckboxes.forEach((checkbox) => {
                    checkbox.disabled = !requiresLotSelection;
                });
                exportPdfLotsList.style.opacity = requiresLotSelection ? '1' : '0.55';
                if (exportLotsHint) {
                    exportLotsHint.textContent = requiresLotSelection
                        ? 'Sélectionner le ou les lots, puis choisir le format de fichier.'
                        : 'Mode synthèse: tous les lots sont inclus automatiquement.';
                }
            };

            btnCloseExportPdf.addEventListener('click', closeExportPdf);
            btnCancelExportPdf.addEventListener('click', closeExportPdf);
            exportPdfBackdrop.addEventListener('click', (e) => {
                if (e.target === exportPdfBackdrop) closeExportPdf();
            });

            exportContentModeSelect.addEventListener('change', updateExportLotsState);

            btnRunExport.addEventListener('click', () => {
                const mode = exportContentModeSelect.value === 'lots-selectionnes' ? 'lots-selectionnes' : 'synthese';
                const format = exportFileFormatSelect.value === 'csv' ? 'csv' : 'pdf';
                let selectedLotIndices = [];

                if (mode === 'lots-selectionnes') {
                    selectedLotIndices = this.getSelectedExportPdfLotIndices();
                    if (!selectedLotIndices.length) {
                        alert('Sélectionne au moins un lot à exporter.');
                        return;
                    }
                }

                if (format === 'pdf') {
                    closeExportPdf();
                    this.exportToPdf(mode, selectedLotIndices);
                } else {
                    closeExportPdf();
                    this.exportToCsv(mode, selectedLotIndices);
                }
            });

            updateExportLotsState();
        }

        const etiqueterBackdrop = document.getElementById('etiqueterBackdrop');
        const btnCloseEtiqueter = document.getElementById('btnCloseEtiqueter');
        const btnCancelEtiqueter = document.getElementById('btnCancelEtiqueter');
        const btnRunEtiqueter = document.getElementById('btnRunEtiqueter');

        if (etiqueterBackdrop && btnCloseEtiqueter && btnCancelEtiqueter && btnRunEtiqueter) {
            const closeEtiqueter = () => this.closeEtiqueterModal();

            btnCloseEtiqueter.addEventListener('click', closeEtiqueter);
            btnCancelEtiqueter.addEventListener('click', closeEtiqueter);
            etiqueterBackdrop.addEventListener('click', (e) => {
                if (e.target === etiqueterBackdrop) closeEtiqueter();
            });

            btnRunEtiqueter.addEventListener('click', () => {
                const selectedLotIndices = this.getSelectedEtiqueterLotIndices();
                if (!selectedLotIndices.length) {
                    alert('Sélectionne au moins un lot pour exporter les étiquettes.');
                    return;
                }

                closeEtiqueter();
                this.exportEtiquettes(selectedLotIndices);
            });
        }
    }

    /* ---- Modales helpers ---- */

    openAllotissementModal() {
        const b = document.getElementById('allotissementModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeAllotissementModal() {
        const b = document.getElementById('allotissementModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    openInspectionModal() {
        const b = document.getElementById('inspectionModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeInspectionModal() {
        const b = document.getElementById('inspectionModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    syncMetaToggleGroup(field) {
        const current = (this.data.meta && this.data.meta[field]) || '';
        document.querySelectorAll(`button[data-meta-toggle-field="${field}"]`).forEach((btn) => {
            btn.setAttribute('aria-pressed', btn.getAttribute('data-meta-toggle-value') === current ? 'true' : 'false');
        });
    }

    openDocumentsImportModal() {
        const b = document.getElementById('documentsImportModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeDocumentsImportModal() {
        const b = document.getElementById('documentsImportModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    linkifyText(value) {
        const text = String(value || '');
        const linkRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|doi:\s*10\.\d{4,9}\/[^\s<>"']+|10\.\d{4,9}\/[^\s<>"']+)/gi;
        let lastIndex = 0;
        let html = '';

        text.replace(linkRegex, (fullMatch, _tokenGroup, offset) => {
            let token = fullMatch;
            let trailing = '';

            while (/[),.;:!?]$/.test(token)) {
                trailing = token.slice(-1) + trailing;
                token = token.slice(0, -1);
            }

            const trimmedToken = token.trim();
            let href = trimmedToken;
            let label = trimmedToken;

            if (/^www\./i.test(trimmedToken)) {
                href = 'https://' + trimmedToken;
            } else if (/^doi:\s*/i.test(trimmedToken)) {
                const doiValue = trimmedToken.replace(/^doi:\s*/i, '').trim();
                href = 'https://doi.org/' + doiValue;
                label = 'doi:' + doiValue;
            } else if (/^10\.\d{4,9}\//i.test(trimmedToken)) {
                href = 'https://doi.org/' + trimmedToken;
            }

            html += this.escapeHtml(text.slice(lastIndex, offset));
            html += `<a class="detail-modal-link" href="${this.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(label)}</a>`;
            html += this.escapeHtml(trailing);
            lastIndex = offset + fullMatch.length;
            return fullMatch;
        });

        html += this.escapeHtml(text.slice(lastIndex));
        return html;
    }

    normalizeDetailTitle(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    renderDetailModalContent(contentEl, rawText) {
        if (!contentEl) return;

        const modalRoot = contentEl.closest('.modal');
        const modalTitleEl = modalRoot ? modalRoot.querySelector('.modal-header h2') : null;
        const modalTitleNormalized = this.normalizeDetailTitle(modalTitleEl ? modalTitleEl.textContent : '');

        const text = (rawText || 'À renseigner').toString().trim();
        if (!text) {
            contentEl.innerHTML = '<div class="detail-modal-paragraph"><p>À renseigner</p></div>';
            return;
        }

        const blocks = text
            .split(/\n\s*\n+/)
            .map((block) => block.trim())
            .filter(Boolean);

        const referenceChunks = [];

        const scaleRegex = /(?:Une?|Un|Des)\s+[^\n]*«\s*(fort(?:e|es|s)?|moyen(?:ne|nes|s)?|faible(?:s)?)\s*»[^\n]*\[[^\]]+\][^\n]*\.?/gi;
        const referenceTokenRegex = /(https?:\/\/|\bwww\.|\bdoi\s*:|\b10\.\d{4,9}\/)/i;
        const bibliographicRegex = /\((?:\d{4}(?:[^)]*)|s\.\s*d\.)\)/i;
        const normRegex = /\b(FD|NF|EN|ISO|FWPA|STI|STII|STIII|C\d{2}|D\d{2})\b/i;
        const scaleLineRegex = /(?:Une?|Un|Des)\s+.*«\s*(fort(?:e|es|s)?|moyen(?:ne|nes|s)?|faible(?:s)?)\s*».*\[[^\]]+\]/i;

        const isReferenceLine = (line) => {
            const clean = String(line || '').trim();
            if (!clean) return false;
            if (/^Noter\b/i.test(clean)) return false;
            if (/^(Voir\b|Références?|Bibliographie|Sources?)\s*/i.test(clean)) return true;
            if (referenceTokenRegex.test(clean)) return true;
            if (bibliographicRegex.test(clean) && /^[*]?[A-ZÀ-ÖØ-Ý]/.test(clean)) return true;
            if (/^(Se référer\b|Normes?)\s*/i.test(clean)) return true;
            if (normRegex.test(clean) && clean.length < 180) return true;
            if (/^\*+/.test(clean)) return true;
            if (/^[A-ZÀ-ÖØ-Ý][a-zA-Zà-öø-ÿ]+,\s/.test(clean) && /\b\d{4}\b/.test(clean)) return true;
            return false;
        };

        const classFromLevelLabel = (levelRaw) => {
            const level = String(levelRaw || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
            return /^fort/.test(level)
                ? 'forte'
                : /^moy/.test(level)
                    ? 'moyenne'
                    : /^faibl/.test(level)
                        ? 'faible'
                        : 'moyenne';
        };

        const extractScaleScore = (sentence) => {
            const scoreMatch = String(sentence || '').match(/\[\s*([+-]?\d+(?:[.,]\d+)?)\s*\]/);
            if (!scoreMatch) return NaN;
            return parseFloat(String(scoreMatch[1]).replace(',', '.'));
        };

        const toScaleItem = (sentence, levelRaw, forcedClassName) => {
            const level = String(levelRaw || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
            const safeSentence = this.linkifyText(sentence.replace(/\s+/g, ' ').trim());
            const className = forcedClassName || classFromLevelLabel(level);
            const normalizedLabel = level.replace(/[^a-z]/g, '');
            const label = normalizedLabel
                ? normalizedLabel.charAt(0).toUpperCase() + normalizedLabel.slice(1)
                : (className.charAt(0).toUpperCase() + className.slice(1));
            return `<div class="detail-modal-scale-item"><span class="detail-modal-scale-pill detail-modal-scale-pill--${className}">${label}</span><span>${safeSentence}</span></div>`;
        };

        const html = blocks.map((block) => {
            let currentBlock = block;
            const firstLine = currentBlock.split('\n')[0].trim();
            const firstLineNoDot = firstLine.replace(/\.$/, '').trim();
            const firstLineNormalized = this.normalizeDetailTitle(firstLineNoDot);

            // Si le premier titre du bloc duplique le titre de la modale, on le retire du corps.
            if (modalTitleNormalized && firstLineNormalized && firstLineNormalized === modalTitleNormalized) {
                const remaining = currentBlock.split('\n').slice(1).join('\n').trim();
                if (remaining) {
                    currentBlock = remaining;
                }
            }

            const rawLines = currentBlock
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            const referenceLines = [];
            const contentLines = [];

            rawLines.forEach((line, index) => {
                const nextLine = rawLines[index + 1] || '';
                const isCitationBeforeUrl = bibliographicRegex.test(line) && referenceTokenRegex.test(nextLine);
                const isScaleLine = scaleLineRegex.test(line);
                if (!isScaleLine && (isReferenceLine(line) || isCitationBeforeUrl)) {
                    referenceLines.push(line);
                } else {
                    contentLines.push(line);
                }
            });

            if (referenceLines.length) {
                referenceChunks.push(referenceLines.map((line) => this.linkifyText(line)).join('<br>'));
            }

            currentBlock = contentLines.join('\n').trim();
            if (!currentBlock) return '';

            const inlineText = currentBlock.replace(/\s*\n\s*/g, ' ').trim();
            const linesHtml = currentBlock
                .split('\n')
                .map((line) => this.linkifyText(line.trim()))
                .filter(Boolean)
                .join('<br>');

            if (!inlineText) return '';

            if (/^Noter\b/i.test(inlineText)) {
                return `<div class="detail-modal-instruction"><p>${linesHtml}</p></div>`;
            }

            if (/^(Attention|À noter|Exemple)\s*:/i.test(inlineText)) {
                return `<div class="detail-modal-note"><p>${linesHtml}</p></div>`;
            }

            if (inlineText.length <= 80 && /^[A-ZÀ-ÖØ-Ý]/.test(inlineText) && /\.$/.test(inlineText)) {
                const subtitle = inlineText.slice(0, -1).trim();
                const subtitleNormalized = this.normalizeDetailTitle(subtitle);
                if (modalTitleNormalized && subtitleNormalized === modalTitleNormalized) {
                    return '';
                }
                return `<h3 class="detail-modal-subtitle">${this.escapeHtml(subtitle)}</h3>`;
            }

            const scaleEntries = [];
            const textWithoutScale = currentBlock.replace(scaleRegex, (match, level) => {
                scaleEntries.push({
                    sentence: match,
                    level,
                    score: extractScaleScore(match)
                });
                return '';
            }).trim();

            const scaleItems = scaleEntries.map((entry) => {
                const finiteScores = scaleEntries
                    .map((item) => item.score)
                    .filter((value) => Number.isFinite(value));

                let className = classFromLevelLabel(entry.level);
                if (finiteScores.length) {
                    const minScore = Math.min(...finiteScores);
                    const maxScore = Math.max(...finiteScores);
                    if (minScore !== maxScore && Number.isFinite(entry.score)) {
                        className = entry.score === maxScore
                            ? 'forte'
                            : entry.score === minScore
                                ? 'faible'
                                : 'moyenne';
                    } else if (minScore === maxScore && Number.isFinite(entry.score)) {
                        className = 'moyenne';
                    }
                }

                return toScaleItem(entry.sentence, entry.level, className);
            });

            if (scaleItems.length >= 2) {
                const intro = textWithoutScale
                    ? `<div class="detail-modal-paragraph"><p>${textWithoutScale.split('\n').map((line) => this.linkifyText(line.trim())).filter(Boolean).join('<br>')}</p></div>`
                    : '';
                return `${intro}<div class="detail-modal-scale">${scaleItems.join('')}</div>`;
            }

            return `<div class="detail-modal-paragraph"><p>${linesHtml}</p></div>`;
        }).join('');

        const mainHtml = html || '<div class="detail-modal-paragraph"><p>À renseigner</p></div>';

        const mergedReferenceChunks = [];
        for (let i = 0; i < referenceChunks.length; i += 1) {
            const current = referenceChunks[i] || '';
            const next = referenceChunks[i + 1] || '';
            const currentHasLink = /<a\b/i.test(current);
            const nextIsLinkOnly = /^\s*<a\b[^>]*>[^<]+<\/a>\s*$/i.test(next);

            if (!currentHasLink && nextIsLinkOnly) {
                mergedReferenceChunks.push(current + '<br>' + next);
                i += 1;
            } else {
                mergedReferenceChunks.push(current);
            }
        }

        const referencesHtml = mergedReferenceChunks.length
            ? mergedReferenceChunks.map((chunk) => `<p>${chunk}</p>`).join('')
            : '<p class="detail-modal-references-empty">Aucune référence renseignée pour ce critère.</p>';

        contentEl.innerHTML = `${mainHtml}<details class="detail-modal-references"><summary>Références et ressources</summary>${referencesHtml}</details>`;
    }

    openInspectionDetailModal(fieldKey) {
        const backdrop = document.getElementById('inspectionDetailModalBackdrop');
        const titleEl = document.getElementById('inspectionDetailModalTitle');
        const contentEl = document.getElementById('inspectionDetailModalContent');

        const titles = {
            visibilite: 'Visibilité - Accessibilité',
            instrumentation: 'Instrumentation',
            integrite: 'Intégrité générale'
        };

        if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, 'À renseigner');

        if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    closeInspectionDetailModal() {
        const b = document.getElementById('inspectionDetailModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    openBioModal() {
        const b = document.getElementById('bioModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeBioModal() {
        const b = document.getElementById('bioModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    openBioDetailModal(fieldKey) {
        const backdrop = document.getElementById('bioDetailModalBackdrop');
        const titleEl = document.getElementById('bioDetailModalTitle');
        const contentEl = document.getElementById('bioDetailModalContent');

        const titles = {
            purge: 'Purge',
            expansion: 'Expansion',
            integriteBio: 'Intégrité',
            exposition: 'Exposition',
            confianceBio: 'Confiance'
        };

        const contents = {
            purge: `Purge.
Noter le degré de purge des dégradations biologiques nécessaire pour le réusage des bois évalués.

Une purge « forte » vaut pour la réalisation de coupes transversales (réduction de la longueur) des pièces de bois d’une dégradation à plus de 50 cm de leurs extrémités [-3].
Une purge « moyenne » vaut pour la coupe des extrémités de bois inférieure à 50 cm [+1].
Une purge « faible » vaut pour la réalisation du retrait de dégradations superficielles, limitées à l’aubier [+3].

Voir : François Privat. Faisabilité du recyclage en boucle fermée des déchets post-consommateurs en bois massif. Génie des procédés. École centrale de Nantes, 2019.`,
            expansion: `Expansion.

Noter le degré d’expansion des dégradations biologiques des bois évalués dans sa dimension environnementale.

Une expansion « forte » vaut pour : des infections ou infestations sur plus de la moitié de la longueur du bois et/ou plus de la moitié du lot évalué, et/ou d’une activité fongique ou animale manifeste (ex : sporulations, larves, insectes, en particulier termites ou mérule*) [-10].
Une expansion « moyenne » vaut pour des infections, infestations ou moisissures localisées là où se situent les pièces de bois évaluées, sans activité manifeste [-3].
Une expansion « faible » vaut pour une absence de dégradations ou pour des infections, infestations ou moisissures (bleuissement, tâches) de surface et ponctuelles, limitées à l’aubier, sans activité manifeste [+3].

*Ministère de la Transition écologique. (2023, 30 janvier). Termites, insectes xylophages et champignons lignivores. Ministère de la Transition écologique et de la Cohésion des territoires.
https://www.ecologie.gouv.fr/politiques-publiques/termites-insectes-xylophages-champignons-lignivores

Agence Qualité Construction. (2024, janvier). Les attaques des bois par les agents biologiques. Collection Fiches Pathologie bâtiment.
https://qualiteconstruction.com/ressource/fiches-pathologie-batiment/attaques-bois-agents-biologiques/

Agence Qualité Construction. (2017). Le risque de mérule dans le bâtiment : mesures préventives.
https://qualiteconstruction.com/wp-content/uploads/2024/05/Plaquette-Risque-Merule-Batiment-Mesures-Preventives-AQC.pdf

ADEME. (s. d.). Bois contaminé (termites). Que faire de mes déchets ?
https://quefairedemesdechets.ademe.fr/dechet/bois-contamine-termites/`,
            integriteBio: `Noter le degré d’atteinte à l’intégrité des bois par des dégradations biologiques.

Une intégrité biologique « forte » vaut pour une absence de dégradation [+3].
Une intégrité biologique « moyenne » vaut pour des altérations d’ordres biologiques superficielles limitées aux premières cernes de l’aubier [+1].
Une intégrité biologique « faible » vaut pour des altérations biologiques à cœur manifestes sur plus d’un tiers de la longueur des éléments évalués [-10].

(Choix des dimensions à spécifier).

Witomski, P., Olek, W. & Bonarski, J. T. (2016). inputs in strength of Scots pine wood (Pinus silvestris L.) decayed by brown rot (Coniophora puteana) and white rot (Trametes versicolor). Construction and Building Materials, 102. https://doi.org/10.1016/j.conbuildmat.2015.10.109`,
            exposition: `Exposition biologique.

Noter le niveau d’exposition biologique historique des bois évalués au regard de leur classe d’emploi.

Une exposition biologique « forte » vaut pour les classes 5, 4 et 3.2 (ex : terrasse) [-3].
Une exposition biologique « moyenne » vaut pour la classe 3.1 (ex: bardage) [+1].
Une exposition biologique « faible » vaut pour les classes 2 et 1 (ex: charpente en toiture; solivage) [+3].

Se rapporter à la norme NF-EN-335.

Attention, l’estimation de la classe n’est pas que situationnelle (localisation dans le bâtiment) mais aussi contextuelle relative à l’usage du bâtiment. Exemple : un solivage d’un ouvrage en friche peut ainsi être réévalué en classe 2 voir 3 si des flaques peuvent être observées sur les sols intérieurs.`,
            confianceBio: `Confiance.

Noter le niveau de confiance dans l’identification des dégradations biologiques des bois évalués.

Une confiance « forte » vaut pour une certitude [3].
Une confiance « moyenne » vaut pour un doute [2].
Une confiance « faible » implique d’engager une étude complémentaire [1].`
        };

        if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
        this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

        if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    closeBioDetailModal() {
        const b = document.getElementById('bioDetailModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

openMechModal() {
        const backdrop = document.getElementById('mechModalBackdrop');
        if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

closeMechModal() {
    const backdrop = document.getElementById('mechModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openMechDetailModal(fieldKey) {
    const backdrop = document.getElementById('mechDetailModalBackdrop');
    const titleEl = document.getElementById('mechDetailModalTitle');
    const contentEl = document.getElementById('mechDetailModalContent');

    const titles = {
        purgeMech: 'Purge',
        feuMech: 'Feu',
        integriteMech: 'Intégrité',
        expositionMech: 'Exposition',
        confianceMech: 'Confiance'
    };

    const contents = {
        purgeMech: `Purge.

Noter le degré de purge des dégradations mécaniques nécessaire pour le réusage des bois évalués.

Une purge mécanique « forte » vaut pour la réalisation de coupes transversales (réduction de la longueur) sur des pièces de bois à l’intégrité biologique faible et à l’intégrité mécanique faible [-3].
Une intégrité mécanique « moyenne » vaut pour la coupe des extrémités des bois, sur une longueur totale inférieure à un cinquième de la pièce, avec une intégrité biologique moyenne et une intégrité mécanique moyenne [+1].
Une intégrité mécanique « faible » vaut pour l’absence de l’élimination des défauts du bois par des coupes transversales (en dehors d’une purge de propreté, moins de 5 cm en bout des pièces) induit par une intégrité biologique et mécanique forte [+3].

Ridout, B. (2001). Timber Decay in Buildings: The Conservation Approach to Treatment. APT Bulletin: The Journal of Preservation Technology, 32(1), 58–60. https://doi.org/10.2307/1504694.
(Préconise à minima la purge des éléments endommagés).`,
        feuMech: `Feu.

Noter la tenue au feu potentielle des pièces évaluées.

Une tenue au feu « forte » vaut pour des pièces de bois combinant plusieurs de ces éléments : une volumétrie forte, une humidité moyenne, une massivité forte, une masse volumique forte à moyenne, une expansion des dégradations biologiques faible [+3].
Une tenue au feu « moyenne » vaut pour des pièces de bois combinant plusieurs de ces éléments : une volumétrie moyenne, une humidité moyenne, une massivité moyenne, une masse volumique faible, expansion des dégradations biologiques moyenne [+2].
Une tenue au feu « faible » vaut pour des pièces de bois combinant plusieurs de ces éléments : une volumétrie faible, une humidité faible, une massivité faible, une masse volumique faible, expansion des dégradations biologiques forte [+1].

Voir : Uldry, A., Husted, B. P., Pope, I., & Ottosen, L. M. (2024). A Review of the Applicability of Non-destructive Testing for the Determination of the Fire Performance of Reused Structural Timber. Journal of Nondestructive Evaluation, 43(4). https://doi.org/10.1007/s10921-024-01120-6

Jurecki, A., Wieruszewski, M., & Grześkowiak, W. (2024). Comparative Analysis of the Flammability Characteristics of Historic Oak Wood from 1869 and Contemporary Wood. In Wood & Fire Safety 2024 (p. 370‑377). Springer Nature Switzerland. https://doi.org/10.1007/978-3-031-59177-8_43

Jing, C., Renner, J. S., & Xu, Q. (2024). Research on the Fire Performance of Aged and Modern Wood. In Wood & Fire Safety 2024 (p. 378‑386). Springer Nature Switzerland. https://doi.org/10.1007/978-3-031-59177-8_44`,
        integriteMech: `Intégrité mécanique.

Noter l’intégrité mécanique des bois évalués.

Une intégrité mécanique « forte » vaut pour une absence de dégradations ou pour des dégradations superficielles, locales, limitées aux premières cernes de l’aubier, aux arêtes, aux extrémités des pièces sur moins d’un cinquième de la longueur totale du bois, répondants aux critères les plus défavorables de classement visuel des normes relatives à l’essence évaluée [+3].
Une intégrité mécanique « moyenne » vaut pour des bois disposant d’assemblages taillés dans la pièce (ex : entailles, poches, mortaises, encoches, mi-bois, percements de boulons, vis ou clous, de charbon*…), des fentes de séchage non traversantes [-3].
Une intégrité mécanique « faible » vaut pour : des dégradations, qui ne sont pas des assemblages ou ne portent pas sur ceux-ci, réparties sur plus de la moitié de la longueur ou de la section de la pièce (ex : tronçonnage partiel, arrachements …); pour des signes de ruptures/cassures qui portent atteintes à la résistance mécanique générale de la pièce, des fentes traversantes ou décollement de cerne [-10].

*Des bois ayant subi une combustion superficielle restent réutilisables dans la mesure où l’humidité n’est pas trop faible et l’état microscopique du bois est aussi évalué. Ne sont pas ici évaluées les dégradations mécaniques liées aux traitements, ni les dégradations internes des bois et/ou propres à leur croissance : nœuds et groupes de nœuds, échauffures, roulures, gélivures, pente de fil, bois de réaction ou de tension…(Voir : publication à propos).

Voir : Forest Wood Products Australia. (2025). FWPA standard G01.`,
        expositionMech: `Exposition mécanique.

Noter le niveau d’exposition mécanique historique des bois évalués au regard du couplage mécano-sportif.

Une exposition mécanique « forte » vaut pour des pièces situées en classes d’emploi 5, 4, 3.2 et 3.1 et classe 2 en cas de sous-dimensionnement manifeste de la charpente [-3].
Une exposition mécanique « moyenne » vaut pour des pièces : soumises à leur seul « poids propre » en classes 3.2 et 3.1 ou situées en classe 2 combinée à de fortes sollicitations dynamiques et statiques (ex : territoires venteux, neigeux, passage d’engin, lieu de stockage) [+1].
Une exposition mécanique « faible » vaut pour les classes 1 à 2 combinée à des faibles sollicitations dynamiques et statiques [+3].

Pour les équivalences se rapporter aux classes d’emploi NF-EN-335.

Attention, l’estimation de la classe n’est pas que situationnelle (localisation dans le bâtiment) mais aussi contextuelle relative à l’usage du bâtiment.

Exemple : un solivage d’un ouvrage en friche peut ainsi être réévalué en classe 2 voir 3 si des flaques peuvent être observées sur les sols intérieurs.

Voir, en lien avec l’humidité : Teodorescu, I., Erbaşu, R., Branco, J. M., & Tăpuşi, D. (2021). Study in the inputs of the moisture content in wood. IOP Conference Series: Earth and Environmental Science, 664(1), 012017. https://doi.org/10.1088/1755-1315/664/1/012017).

Définir un % de charge moyen sur la durée d’usage pour statuer sur le dimensionnement et son influence.`,
        confianceMech: `Confiance.

Noter le niveau de confiance dans l’identification des dégradations mécaniques des bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeMechDetailModal() {
    const backdrop = document.getElementById('mechDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openUsageModal() {
    const backdrop = document.getElementById('usageModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeUsageModal() {
    const backdrop = document.getElementById('usageModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openUsageDetailModal(fieldKey) {
    const backdrop = document.getElementById('usageDetailModalBackdrop');
    const titleEl = document.getElementById('usageDetailModalTitle');
    const contentEl = document.getElementById('usageDetailModalContent');

    const titles = {
        confianceUsage: 'Confiance',
        durabiliteUsage: 'Durabilité naturelle',
        classementUsage: 'Classement estimé',
        humiditeUsage: 'Humidité',
        aspectUsage: 'Aspect'
    };

    const contents = {
        confianceUsage: `Confiance.

Noter le niveau de confiance de la résistance mécanique des bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        durabiliteUsage: `Durabilité naturelle.

Noter la durabilité naturelle de l’essence de bois identifiée.

Cette durabilité biologique globale est appréciée à partir des classes de l’EN 350 vis‑à‑vis des champignons, termites, coléoptères et xylophages marins (agents biologiques).

Une durabilité naturelle « forte » vaut pour les bois des essences de classe 1 ou 2 vis‑à‑vis des champignons et ne présentant pas de classe supérieure à 2 et A pour les autres agents biologiques [+3].
Une durabilité naturelle « moyenne » vaut pour les bois des essences de classe 3 vis‑à‑vis des champignons, et/ou présentant au plus une classe 3 ou M pour un autre agent biologique, sans classe 4 ou 5 [+2].
Une durabilité naturelle « faible » vaut pour les essences de classes 4 ou 5 vis‑à‑vis des champignons et/ou présentant au moins une classe 4, 5 ou S pour l’un des autres agents biologiques [+1].

À noter : La présence d’aubier peut être prise en compte : lorsque la largeur de l’aubier est identifiable et supérieure ou égale à 5 cm, ou est indiqué comme « non résistant » dans l’EN 350, la note est abaissée d’un niveau.`,
        classementUsage: `Noter la classe mécanique estimée des bois évalués (couramment relative à la flexion sur chant).

Un classement estimé « fort » vaut pour : un classement visuel STI, un classement de résistance supérieur ou égal à C30 (résineux); un classement visuel 1 (chêne), un classement de résistance supérieur ou égal à D30 (feuillus) [+3].
Un classement estimé « moyen » vaut pour : un classement visuel STII et STIII, un classement de résistance strictement inférieur à C30 et supérieur ou égal à C18 (résineux, peuplier et châtaigner); un classement visuel 2 et 3 (chêne), un classement de résistance strictement inférieur à D30 et supérieur ou égal à D18 (feuillus) [+2].
Un classement estimé « faible » vaut pour : un classement visuel strictement inférieur à STIII, un classement de résistance strictement inférieur à C18 (résineux et peuplier); un déclassement visuel (chêne), un classement de résistance strictement inférieur à D18 (feuillus) [+1].

Les estimations peuvent être effectuées visuellement ou à l’aide d’instruments dédiés.

Les estimations instrumentés sont donc ici simplifiées pour correspondre aux classement visuels.

Ce classement ne vaut pas pour une mesure à la rupture et ne vaut pas uniformément pour l’ensemble des formes de sollicitations du bois ni de toutes les essences.

Se référer aux normes :
• NF EN 14081-1,
• EN 338,
• NF EN 1912 (Compatibilité Europe et Canada),
• NF B52-001-1 (Voir en particulier l’Annexe A « Correspondance entre les catégories visuelles et les classes de résistance mécanique »)
• NF B52-001-2 en vue de compléter la catégorisation.

Pour rappel sur l’usage du classement voir : Ridley-Ellis, D., Stapel, P., & Baño, V. (2015, April 15-17). Strength grading of sawn timber in Europe - an explanation for engineers.. COST Action FP 1004 - Final Meeting. http://researchrepository.napier.ac.uk/id/eprint/8232.

Attention, il n’y a pas de consensus sur le transfert d’usage des méthodes conçu pour le bois neuf vers le bois d’occasion : Arriaga, F., Osuna-Sequera, C., Bobadilla, I., & Esteban, M. (2022). Prediction of the mechanical properties of timber members in existing structures using the dynamic modulus of elasticity and visual grading parameters. Construction and Building Materials, 322, 126512. https://doi.org/10.1016/j.conbuildmat.2022.126512

Kauniste, M., Saarelaan, T., Just, A., & Tuhkanen, E. (2025). Assessment of strength and stiffness properties of reclaimed structural timber of norway spruce. In World Conference on Timber Engineering 2025 (p. 3484‑3493). World Conference On Timber Engineering 2025. World Conference on Timber Engineering 2025. https://doi.org/10.52202/080513-0427`,
        humiditeUsage: `Humidité.

Noter l’humidité des bois évalués.

Une humidité « forte » vaut pour des pièces de bois dont l’humidité mesurée est supérieure à 22%* [-3].
Une humidité « moyenne » vaut pour des pièces de bois dont l’humidité est strictement inférieure à 22% et strictement supérieure à 8% [+3].
Une humidité « faible » vaut pour des pièces de bois dont l’humidité est strictement inférieure à 8%** [+1].

Se référer aux normes :
NF EN 384 (Plages courantes des tests 8 à 18%).
FD P20-651 (20%).
NF EN 335 d'après ISO 3130 (20%).
NF P03-200 (20%).

*22% étant le seuil maximum pour des Fermettes ou « commercialement sec », voir norme NF B51-002. 14081-1 : max 24% pour une mesure ponctuel.

Voir aussi 13183-2 et 13183-3. L'équilibre hygroscopique des bois est aussi fonction de la région géographique.

À savoir que l'humidité relevée peut ne pas refléter l'humidité à cœur des bois évalués, qui sont susceptibles d'être plus secs. La mesure de cette valeur étant aussi variable selon les conditions climatiques de la mesure, du matériel employé et de la zone de mesure.

**8% étant un seuil pour un usage en parqueterie. Une humidité inférieure ou égale à 8% correspond à des conditions climatiques plus particulières aux ouvrages de menuiserie.

Voir B.3 de l'Annexe B de la norme NF P63-202-1.

Voir l'Annexe B de la norme EN 942. Pour la mesure de l'humidité se rapporter à la série de normes NF EN 13183. Pour une approche par lot voir : ISO 4470.

Pour la technique in-situ voir la NF EN 13183-2.
Fu, Z., Chen, J., Zhang, Y., Xie, F., & Lu, Y. (2023). Review on Wood Deformation and Cracking during Moisture Loss. Polymers, 15(15), 3295. https://doi.org/10.3390/polym15153295

Glass, S.V.; Zelinka, S.L. 2021. Chapter 4: Moisture relations and physical properties of wood. In: Wood handbook—wood as an engineering material. General Technical Report FPL-GTR-282. Madison, WI: U.S. Department of Agriculture, Forest Service, Forest Products Laboratory.

24,3% étant une valeur extrême d'équilibre, au-delà une humidification d'eau liquide est fort probable.

En principe une humidité forte dégrade significativement les propriétés mécaniques des bois.
Roshchuk, M., Homon, S., Pavluk, A., Gomon, S., Drobyshynets, S., Romaniuk, M., Smal, M., & Dziubynska, O. (2024). Effect of long-term moisture on the mechanical properties of wood: an experimental study. Procedia Structural Integrity, 59, 718‑723. https://doi.org/10.1016/j.prostr.2024.04.102

Serdar, B., Sagiroglu Demirci, O., Ozturk, M., Aksoy, E., & Kara Alasalvar, M. A. (2025). The Effect of Different Relative Humidity Conditions on Mechanical Properties of Historical Fir Wood Under the Influence of Natural Aging. Drvna Industrija, 76(3), 287‑298. https://doi.org/10.5552/drvind.2025.0211

En principe une humidité faible resserre les fibres et accentue la résistance du bois.
Zhou, J., Tian, Q., Nie, J., Cao, P., & Tan, Z. (2024). Mechanical properties and damage mechanisms of woods under extreme environmental conditions. Case Studies in Construction Materials, 20, e03146. https://doi.org/10.1016/j.cscm.2024.e03146

Kherais, M., Csébfalvi, A., Len, A., Fülöp, A., & Pál-Schreiner, J. (2024). The effect of moisture content on the mechanical properties of wood structure. Pollack Periodica, 19(1), 41‑46. https://doi.org/10.1556/606.2023.00917

Jaskowska-Lemańska, J., & Przesmycka, E. (2020). Semi-Destructive and Non-Destructive Tests of Timber Structure of Various Moisture Contents. Materials, 14(1), 96. https://doi.org/10.3390/ma14010096`,
        aspectUsage: `Noter l’aspect des bois évalués pour en déterminer les usages possibles.

Un aspect « fort » vaut pour des bois de classes d’aspects 0A, 0B, 1 (résineux) ou QPA, QBA, QB1 et QFA QFA1-a/b (chêne) ou FBA, FB1, FSA, FS1, FF1, FDA (hêtre) ou A (bois rond résineux et feuillus) [+3].
Un aspect « moyen » vaut pour des bois de classes d’aspects 2 (résineux) ou QP1, QB2 et QF2 (chêne) ou FB2, FS2, FF2, FD1 (hêtre) ou B (bois rond résineux et feuillus) [+2].
Un aspect « faible » vaut pour des bois de classes d’aspects 3A et 3B (résineux) ou QPC, QB3 et QF3 (chêne) ou FB3, FS3, FF3, FD2 (hêtre) ou C et D (bois rond résineux et feuillus) [+1].

Se référer aux normes :
NF B52-001-1 (Voir en particulier l’Annexe A « Correspondance entre les catégories visuelles et les classes de résistance mécanique »).
Voir EN-975-1/2 : chêne-hêtre / peuplier,
NF B53-801 (châtaigner),
NF EN-1611-1 (résineux : épicéas, sapins, pins, douglas et mélèzes),
EN 1927-1/2/3 (bois rond résineux : épicéas-sapins / pins / mélèzes-douglas),
EN 1316-1/2 (bois rond feuillus : chêne-hêtre/peuplier).

Compte tenu d’un objectif d’allongement de la durée d’usage du bois, ne sont pas prises en compte ici les normes relatives aux produits de logistique (ex : NF EN 12246).

Pour les différentes dénominations de défauts se reporter à la série de normes ISO dédiées : ISO 737, ISO 1029, ISO 1030, ISO 1031, ISO 2299, ISO 2300, ISO 2301, ISO 8904.`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeUsageDetailModal() {
    const backdrop = document.getElementById('usageDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openDenatModal() {
    const backdrop = document.getElementById('denatModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeDenatModal() {
    const backdrop = document.getElementById('denatModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openDenatDetailModal(fieldKey) {
    const backdrop = document.getElementById('denatDetailModalBackdrop');
    const titleEl = document.getElementById('denatDetailModalTitle');
    const contentEl = document.getElementById('denatDetailModalContent');

    const titles = {
        depollutionDenat: 'Dépollution',
        contaminationDenat: 'Contamination',
        durabiliteConfDenat: 'Durabilité conférée',
        confianceDenat: 'Confiance',
        naturaliteDenat: 'Naturalité'
    };

    const contents = {
        depollutionDenat: `Dépollution.

Noter le degré de dépollution nécessaire à la réappropriation des bois évalués.

Une dépollution « forte » vaut pour des bois disposant de dégradations biologiques, nécessitant une purge forte, et d’une intégrité faible (ex: pourriture à cœur), ou des peints ou traités, en surface (non imprégnés), mécaniquement extractibles* (ex : peinture plombée) [-3].
Une dépollution « moyenne » vaut pour des bois nécessitant un nettoyage conséquent lié à la présence de poussières (brossage, eau à haute pression) et autres formes de polluants assimilés (poussière de plâtre, boue, terres*, moisissures superficielles, liés à la déconstruction) et/ou des corps étrangers de surface (clous, vis et autres formes de connecteurs métalliques, ou d’objets liés à l’usage du bâtiment, etc…) [+1].
Une dépollution « faible » vaut pour des bois conservés à l’état brut, exempts de polluants (y compris traitements préventifs ou curatifs), et nécessitant peu de nettoyage [+3].

* Voir : François Privat. Faisabilité du recyclage en boucle fermée des déchets post-consommateurs en bois massif. Génie des procédés. École centrale de Nantes, 2019, page 36.`,
        contaminationDenat: `Contamination.

Noter le degré de contamination des bois évalués.

Une contamination « forte » vaut pour : des bois dits de classe C*, défini comme des déchets dangereux (ex : créosote); des bois imprégnés dont l’agent de traitement est inconnu, retiré du marché, ou dont la teneur de certaines substances est supérieure aux exigences de recyclage en panneaux* et impropre à la combustion** dans certaines installations dédiées; des bois pour lesquels une expansion forte des dégradations biologiques (termites et mérules en particulier) est constatée [-10].
Une contamination « moyenne » vaut pour des bois imprégnés dont les agents employés sont encore présent sur le marché, ou pour lesquels une dépollution forte est possible; ou dits de classes BR1, BR2 [+1].
Une contamination « faible » vaut pour de bois de classe A, dépollution moyenne et faible [+3].

Voir : FCBA, Référentiel de classification des déchets bois (2022). EPF, EN ISO 17225-1, Ineris (2021), etc.`,
        durabiliteConfDenat: `Durabilité conférée.

Noter la durabilité conférée des bois évalués.

Une durabilité conférée « forte » vaut pour des bois disposant de traitement les élevant à une classe équivalente à une durabilité naturelle forte [+1].
Une durabilité conférée « moyenne » vaut pour des bois disposant de traitement les élevant à une classe équivalente à une durabilité naturelle moyenne [+2].
Une durabilité conférée « faible » vaut pour des bois conservés à l’état brut ne disposant pas de traitements [+3].`,
        confianceDenat: `Confiance.

    Noter le niveau de confiance de la dénaturation des bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
    Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        naturaliteDenat: `Naturalité.

Noter le degré de naturalité des bois évalués.

Une naturalité « forte » vaut pour des bois bruts et ronds [+3].
Une naturalité « moyenne » vaut pour des bois bruts, libre de finition [+2].
Une naturalité « faible » vaut pour des bois peints, traités, dont l’apparence n’est pas celle du bois au terme de sa première transformation en dehors des modifications d’aspect liées au vieillissement naturel (poussière, assombrissement, grisaillement, etc.) [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeDenatDetailModal() {
    const backdrop = document.getElementById('denatDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openDebitModal() {
    const backdrop = document.getElementById('debitModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeDebitModal() {
    const backdrop = document.getElementById('debitModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openDebitDetailModal(fieldKey) {
    const backdrop = document.getElementById('debitDetailModalBackdrop');
    const titleEl = document.getElementById('debitDetailModalTitle');
    const contentEl = document.getElementById('debitDetailModalContent');

    const titles = {
        regulariteDebit: 'Régularité',
        volumetrieDebit: 'Volumétrie',
        stabiliteDebit: 'Stabilité',
        artisanaliteDebit: 'Artisanalité',
        rusticiteDebit: 'Rusticité'
    };

    const contents = {
        regulariteDebit: `Régularité.

Noter le degré de régularité du débit des bois évalués.

Une régularité « forte », ou parallélépipédique forte vaut pour des pièces de bois dont les arêtes sont parallèles et/ou perpendiculaires entre elles et des extrémités anguleuses sur moins de 25 cm [+3].
Une régularité « moyenne » vaut pour des pièces qui comportent des flaches localisés et des extrémités anguleuses sur plus de 26 cm [+2].
Une régularité « faible » vaut pour des pièces qui comportent plusieurs flaches étendus toute la longueur de la pièce, demi-rond ou rond [+1].`,
        volumetrieDebit: `Volumétrie.

Noter l’importance de la volumétrie des bois évalués.

Une volumétrie « forte » vaut pour des pièces de bois d’un volume strictement supérieur à 0,1 m³ [+3].
Une volumétrie « moyenne » vaut pour des pièces d’un volume inférieur ou égal à 0,1 m³ et strictement supérieur à 0,05 m³ [+2].
Une volumétrie « faible » vaut pour des pièces d’un volume strictement inférieur à 0,05 m³ [+1].`,
        stabiliteDebit: `Stabilité.

Noter le rapport entre élancement et stabilité des bois évalués.

Une stabilité « forte » vaut pour des pièces de bois dont le rapport L/h est inférieur ou égal à 18, et le rapport b/h supérieur ou égal à 0,4 [+3].
Une stabilité « moyenne » vaut pour des pièces de bois dont le rapport L/h est inférieur ou égal à 28 et strictement supérieur à 18, et le rapport b/h supérieur ou égal à 0,25 et strictement inférieur à 0,4 [+2].
Une stabilité « faible » vaut pour des pièces de bois dont le rapport L/h est strictement supérieur à 18 et le rapport b/h strictement inférieur à 0,25 [+1].

Nécessite de calculer L/h et de contrôler « h/b », si très élevé, dégrader d’un niveau.`,
        artisanaliteDebit: `Artisanalité.

Noter le degré d’artisanat des bois évalués.

Une artisanalité « forte » vaut pour : des bois de charpente débités à la main et/ou faisant partie intégrante d’un système constructif propre (ex : ferme…) dont les assemblages « bois-bois » sont principalement chevillés [+3].
Une artisanalité « moyenne » vaut pour des bois de charpente sciés faisant partie intégrante d’un système constructif (ex : arbalétrier) [+2].
Une artisanalité « faible » vaut pour des bois sciés unitaires (ex : solive, chevron, panne, poteau…) [+1].`,
        rusticiteDebit: `Rusticité.

Noter le degré de rusticité des bois évalués.

Une rusticité « forte » vaut pour des bois ronds à demi-rond, débités à la main, écorcés et/ou sommairement sciés sur deux faces ou moins, droits ou courbes [+3].
Une rusticité « moyenne » vaut pour des bois de charpente débités à la main à section parallélépipédique, droits ou courbes [+2].
Une rusticité « faible » vaut pour des bois sciés et bruts [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeDebitDetailModal() {
    const backdrop = document.getElementById('debitDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openGeoModal() {
    const backdrop = document.getElementById('geoModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeGeoModal() {
    const backdrop = document.getElementById('geoModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openGeoDetailModal(fieldKey) {
    const backdrop = document.getElementById('geoDetailModalBackdrop');
    const titleEl = document.getElementById('geoDetailModalTitle');
    const contentEl = document.getElementById('geoDetailModalContent');

    const titles = {
        adaptabiliteGeo: 'Adaptabilité',
        massiviteGeo: 'Massivité',
        deformationGeo: 'Déformation',
        industrialiteGeo: 'Industrialité',
        inclusiviteGeo: 'Inclusivité'
    };

    const contents = {
        adaptabiliteGeo: `Adaptabilité.

Noter le degré d’adaptabilité de la géométrie des bois évalués.

Une adaptabilité « forte » vaut pour des pièces de bois sans singularités sur leurs chants et à régularité forte [+3].
Une adaptabilité « moyenne » vaut pour des pièces de bois qui comportent des parties taillées sur leur chant pour des assemblages [+2].
Une adaptabilité « faible » vaut pour des pièces qui comportent des flaches étendus sur toute la longueur de la pièce et plus de la moitié du chant, demi-rond, rond, ou qui comportent des parties taillées pour des assemblages sur plus de la moitié de leur longueur [+1].`,
        massiviteGeo: `Massivité.

Noter l’importance de la massivité des bois évalués.

Une massivité « forte » vaut pour les pièces de bois massif et de Bois Massif Abouté (BMA) d’une épaisseur strictement supérieure à 75 mm, pour les pièces en BLC avec lamelles > 35 mm et chant > 150 mm, ou pour les pièces en BLC avec lamelles ≤ 35 mm et chant > 210 mm [+3].
Une massivité « moyenne » vaut pour des configurations intermédiaires (28–75 mm, etc.) [+2].
Une massivité « faible » vaut pour les pièces les plus fines (≤ 28 mm) [+1].`,
        deformationGeo: `Déformation.

Noter l’importance des déformations des bois évalués.

Une déformation « forte » vaut pour des pièces présentant torsion, gauchissement, flèche, tuilage marqués [-3].
Une déformation « moyenne » vaut pour des déformations partielles sur la longueur (purge possible) [+1].
Une déformation « faible » vaut pour des pièces respectant les critères usuels de flèche/gauchissement des normes [+3].`,
        industrialiteGeo: `Industrialité.

Noter le degré d’industrialité des bois évalués.

Une industrialité « forte » vaut pour des bois BMA/BMR et BLC [+3].
Une industrialité « moyenne » vaut pour des bois BBS, BRS et bois d’ossature ou de fermette [+2].
Une industrialité « faible » vaut pour les bois brut frais de sciage ou débités à la main [+1].`,
        inclusiviteGeo: `Inclusivité.

Noter le degré d’inclusivité des bois évalués.

Une inclusivité « forte » vaut pour des bois sciés, droits, régularité forte et unitaire, avec taux de similarité élevé [+3].
Une inclusivité « moyenne » vaut pour des bois sciés à régularité moyenne/unitaire ou intégrés à un système constructif, taux de similarité moyen à élevé [+2].
Une inclusivité « faible » vaut pour des bois à régularité faible ou rusticité forte/moyenne, taux de similarité moyen à faible [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeGeoDetailModal() {
    const backdrop = document.getElementById('geoDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}



openEssenceModal() {
    const backdrop = document.getElementById('essenceModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeEssenceModal() {
    const backdrop = document.getElementById('essenceModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openEssenceDetailModal(fieldKey) {
    const backdrop = document.getElementById('essenceDetailModalBackdrop');
    const titleEl = document.getElementById('essenceDetailModalTitle');
    const contentEl = document.getElementById('essenceDetailModalContent');

    const titles = {
        confianceEssence: 'Confiance',
        rareteEcoEssence: 'Rareté',
        masseVolEssence: 'Masse volumique',
        rareteHistEssence: 'Rareté commerciale',
        singulariteEssence: 'Singularité'
    };

    const contents = {
        confianceEssence: `Confiance.

Noter le niveau de confiance de la reconnaissance de l’essence et des caractéristiques notées ci-après qui lui sont relatives.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        rareteEcoEssence: `Rareté.

Noter le niveau de rareté de l’essence. Cette notation est fonction de l’aire géographique continentale de la localisation de cette évaluation.

Une rareté « forte » est attribuée à une essence qui ne pousse pas sur l’aire géographique, rare et le plus souvent importée [+3].
Une rareté « moyenne » est attribuée à une essence peu commune sur l’aire géographique [+2].
Un niveau « faible » est attribué à une essence commune sur l’aire géographique [+1].`,
        masseVolEssence: `Masse volumique.

Noter le niveau de la masse volumique « ρ » du bois.

Une masse volumique « forte » vaut pour des bois très lourds à lourds dont ρ > 750 kg/m³ [+3].
Une masse volumique « moyenne » vaut pour des bois mi-lourds à légers dont ρ est entre 450 et 750 kg/m³ [+2].
Une masse volumique « faible » vaut pour des bois très légers dont ρ < 450 kg/m³ [+1].`,
        rareteHistEssence: `Rareté commerciale.

Noter le niveau de rareté commerciale de l’essence au regard du marché et de l’évolution de son exploitation.

Une rareté commerciale « forte » est attribuée à une essence rare qui n’est plus ou pas disponible sur le marché [+3].
Une rareté commerciale « moyenne » est attribuée à une essence peu commune sur le marché [+2].
Un niveau commercial « faible » est attribué à une essence commune sur le marché [+1].`,
        singulariteEssence: `Singularité essence.

Noter le niveau de singularité de l’essence au regard de ses particularités esthétiques : grain ou veinage, fil, couleur, odeur, forme et dessin.

Une singularité « forte » est donnée aux essences à attributs esthétiques reconnus et recherchés (ex : noyer, olivier) [+3].
Une singularité « moyenne » est donnée aux essences aux attributs esthétiques reconnaissables à l’œil nu (ex : pins) [+2].
Une singularité « faible » est donnée aux essences aux attributs esthétiques peu spécifiques (ex : bois blancs) [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeEssenceDetailModal() {
    const backdrop = document.getElementById('essenceDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openAncienModal() {
    const backdrop = document.getElementById('ancienModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeAncienModal() {
    const backdrop = document.getElementById('ancienModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openAncienDetailModal(fieldKey) {
    const backdrop = document.getElementById('ancienDetailModalBackdrop');
    const titleEl = document.getElementById('ancienDetailModalTitle');
    const contentEl = document.getElementById('ancienDetailModalContent');

    const titles = {
        confianceAncien: 'Confiance',
        amortissementAncien: 'Amortissement',
        vieillissementAncien: 'Vieillissement',
        microhistoireAncien: 'Micro-histoire',
        demontabiliteAncien: 'Démontabilité'
    };

    const contents = {
        confianceAncien: `Confiance.

Noter le niveau de confiance dans l’identification de l’ancienneté des bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        amortissementAncien: `Amortissement.

Noter le degré d’amortissement biologique des bois évalués.
Noter le rapport entre l’âge estimé de l’arbre lors de son abattage et la durée d’usage du bois.

Un amortissement « fort » vaut pour un rapport ≥ 1 [+3].
Un amortissement « moyen » vaut pour un rapport entre 0,5 et 1 [+1].
Un amortissement « faible » vaut pour un rapport ≤ 0,5 [-3].`,
        vieillissementAncien: `Vieillissement.

Noter le degré de vieillissement des bois évalués.

Un vieillissement « fort » vaut pour des bois très anciens avec fortes déformations, fortes expositions et intégrité dégradée [-3].
Un vieillissement « moyen » vaut pour des bois de 51–149 ans environ, déformations moyennes, expositions moyennes [+1].
Un vieillissement « faible » vaut pour des bois récents (< 50 ans) avec déformations faibles et exposition modérée [+3].`,
        microhistoireAncien: `Micro-histoire.

Noter le niveau d’information relatif à la micro-histoire des bois.

Une micro-histoire « forte » vaut pour des bois associés à des histoires ou systèmes constructifs à forte valeur patrimoniale [+3].
Une micro-histoire « moyenne » vaut pour une inscription plutôt locale ou partielle [+2].
Une micro-histoire « faible » vaut pour des bois à origine inconnue ou très incertaine [+1].`,
        demontabiliteAncien: `Démontabilité.

Noter la démontabilité et la remontabilité des bois évalués.

Une démontabilité « forte » vaut pour des systèmes avec assemblages accessibles, démontables, réemployables et pièces manuportables [+3].
Une démontabilité « moyenne » vaut pour des systèmes partiellement démontables, avec certains assemblages réemployables [+1].
Une démontabilité « faible » vaut pour des systèmes avec assemblages inaccessibles, collés ou très difficiles à démonter sans dégâts [-3].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeAncienDetailModal() {
    const backdrop = document.getElementById('ancienDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openTracesModal() {
    const backdrop = document.getElementById('tracesModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeTracesModal() {
    const backdrop = document.getElementById('tracesModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openTracesDetailModal(fieldKey) {
    const backdrop = document.getElementById('tracesDetailModalBackdrop');
    const titleEl = document.getElementById('tracesDetailModalTitle');
    const contentEl = document.getElementById('tracesDetailModalContent');

    const titles = {
        confianceTraces: 'Confiance',
        etiquetageTraces: 'Étiquetage',
        alterationTraces: 'Altération',
        documentationTraces: 'Documentation',
        singularitesTraces: 'Singularités'
    };

    const contents = {
        confianceTraces: `Confiance.

Noter le niveau de confiance de la tracéologie effectuée sur les bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        etiquetageTraces: `Étiquetage.

Noter la qualité de l’étiquetage des pièces de bois évaluées.

Un étiquetage « fort » vaut pour un marquage descriptif ou un marquage CE [+3].
Un étiquetage « moyen » vaut pour toute forme de labellisation connue [+2].
Un étiquetage « faible » vaut pour une absence de traçabilité [+1].`,
        alterationTraces: `Altération.

Noter les altérations imputables à la récupération des éléments.

Une altération « forte » vaut pour des bois présentant ruptures, cassures, morsures d’engin, auréoles, tâches d’huiles ou d’hydrocarbures [-10].
Une altération « moyenne » vaut pour des bois avec coins et arêtes enfoncés ou arrachés sur les premières cernes [+1].
Une altération « faible » vaut pour des bois ne présentant pas ces signes [+3].`,
        documentationTraces: `Documentation.

Noter la disponibilité d’une documentation permettant d’évaluer des critères physiques/chimiques des bois et les usages antérieurs de l’ouvrage.

Une documentation « forte » vaut pour des éléments mécaniques, historiques ou écologiques détaillés [+3].
Une documentation « moyenne » vaut pour une origine connue mais des éléments d’usage partiels [+1].
Une documentation « faible » vaut pour une origine inconnue ou incertaine [-3].`,
        singularitesTraces: `Singularité tracéologique.

Noter les singularités des bois évalués au regard des diverses traces participant à leur micro-histoire.

Une singularité « forte » vaut pour des bois avec marques de production ou de charpente, sculptures, etc. [+3].
Une singularité « moyenne » vaut pour des éléments visibles anecdotiques [+2].
Une singularité « faible » vaut pour des bois sans éléments visibles de singularité [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeTracesDetailModal() {
    const backdrop = document.getElementById('tracesDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openProvenanceModal() {
    const backdrop = document.getElementById('provenanceModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeProvenanceModal() {
    const backdrop = document.getElementById('provenanceModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openProvenanceDetailModal(fieldKey) {
    const backdrop = document.getElementById('provenanceDetailModalBackdrop');
    const titleEl = document.getElementById('provenanceDetailModalTitle');
    const contentEl = document.getElementById('provenanceDetailModalContent');

    const titles = {
        confianceProv: 'Confiance',
        transportProv: 'Transport',
        reputationProv: 'Réputation',
        macroProv: 'Macro-histoire',
        territorialiteProv: 'Territorialité'
    };

    const contents = {
        confianceProv: `Confiance.

Noter le niveau de confiance de la tracéologie effectuée sur les bois évalués.

Une confiance « forte » vaut pour une certitude [+3].
Une confiance « moyenne » vaut pour un doute [+2].
Une confiance « faible » implique d’engager une étude complémentaire [+1].`,
        transportProv: `Transport.

Noter l’impact du transport parcouru ou à parcourir des éléments bois évalués.

Un transport « fort » vaut pour des bois transportés sur une distance intercontinentale [-3].
Un transport « moyen » vaut pour des bois transportés dans un rayon continental [+1].
Une distance « faible » vaut pour des bois réemployés, réutilisés ou recyclés sur site [+3].`,
        reputationProv: `Réputation.

Noter la réputation des bois au regard de l’origine géographique des arbres et des qualités qui lui sont attribuées.

Une réputation « forte » vaut pour des bois issus de forêts spécifiques reconnues (Tronçais, Bercé, Lyons, etc.) [+3].
Une réputation « moyenne » vaut pour des bois de massifs reconnus (Vosges, Jura supérieur, etc.) [+2].
Une réputation « faible » vaut pour des bois dont l’origine est peu valorisée [+1].`,
        macroProv: `Macro-histoire.

Noter le niveau d’inscription des bois dans une macro-histoire.

Une macro-histoire « forte » vaut pour des bois combinant amortissement biologique fort, réputation forte, micro-histoire forte, rareté commerciale forte [+3].
Une macro-histoire « moyenne » vaut pour des bois combinant les niveaux moyens de ces critères [+2].
Une macro-histoire « faible » vaut pour des bois dont l’origine est inconnue ou incertaine [+1].`,
        territorialiteProv: `Territorialité.

Noter la territorialité des bois au regard des éléments caractéristiques du territoire d’extraction et de transformation.

Une territorialité « forte » vaut pour des bois combinant essence/singularités, système constructif et traces spécifiques à un territoire donné [+3].
Une territorialité « moyenne » vaut pour des bois présentant un seul de ces éléments [+2].
Une territorialité « faible » vaut pour des bois sans rattachement territorial caractéristique [+1].`
    };

    if (titleEl) titleEl.textContent = titles[fieldKey] || 'Détail';
    this.renderDetailModalContent(contentEl, contents[fieldKey] || 'À renseigner');

    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeProvenanceDetailModal() {
    const backdrop = document.getElementById('provenanceDetailModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

    openSeuilsModal() {
        const b = document.getElementById('seuilsModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeSeuilsModal() {
        const b = document.getElementById('seuilsModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

    openRadarModal() {
        const b = document.getElementById('radarModalBackdrop');
        if (b) {
            b.classList.remove('hidden');
            b.setAttribute('aria-hidden', 'false');
        }
    }

    closeRadarModal() {
        const b = document.getElementById('radarModalBackdrop');
        if (b) {
            b.classList.add('hidden');
            b.setAttribute('aria-hidden', 'true');
        }
    }

openOrientationModal() {
    const backdrop = document.getElementById('orientationModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeOrientationModal() {
    const backdrop = document.getElementById('orientationModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

openEvalOpModal() {
    const backdrop = document.getElementById('evalOpModalBackdrop');
    if (backdrop) {
        backdrop.classList.remove('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
    }
}

closeEvalOpModal() {
    const backdrop = document.getElementById('evalOpModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('hidden');
        backdrop.setAttribute('aria-hidden', 'true');
    }
}

    openResetConfirmModal(options = {}) {
        const {
            title = 'Réinitialiser',
            message = 'Voulez-vous vraiment réinitialiser toutes les données de cette évaluation ?',
            confirmLabel = 'Oui, réinitialiser',
            onConfirm = () => this.resetAllData()
        } = options;

        const backdrop = document.getElementById('resetConfirmBackdrop');
        const titleEl = document.getElementById('resetConfirmTitle');
        const messageEl = document.getElementById('resetConfirmMessage');
        const confirmBtn = document.getElementById('btnConfirmReset');

        if (backdrop) {
            this.pendingResetConfirmAction = onConfirm;
            if (titleEl) titleEl.textContent = title;
            if (messageEl) messageEl.textContent = message;
            if (confirmBtn) confirmBtn.textContent = confirmLabel;
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    openSaveConfirmModal() {
        const backdrop = document.getElementById('saveConfirmBackdrop');
        if (backdrop) {
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    openExportPdfModal() {
        const backdrop = document.getElementById('exportPdfBackdrop');
        if (backdrop) {
            this.renderExportPdfLotOptions();
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    closeExportPdfModal() {
        const backdrop = document.getElementById('exportPdfBackdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
    }

    openEtiqueterModal() {
        const backdrop = document.getElementById('etiqueterBackdrop');
        if (backdrop) {
            this.renderEtiqueterLotOptions();
            backdrop.classList.remove('hidden');
            backdrop.setAttribute('aria-hidden', 'false');
        }
    }

    closeEtiqueterModal() {
        const backdrop = document.getElementById('etiqueterBackdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
            backdrop.setAttribute('aria-hidden', 'true');
        }
    }

    renderExportPdfLotOptions() {
        const list = document.getElementById('exportPdfLotsList');
        if (!list) return;

        const lots = this.data.lots || [];
        list.innerHTML = '';

        lots.forEach((lot, index) => {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '8px';
            label.style.padding = '8px 10px';
            label.style.border = '1px solid #E6E6E6';
            label.style.borderRadius = '8px';
            label.style.cursor = 'pointer';
            label.style.background = '#FAFAFA';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = String(index);
            checkbox.setAttribute('data-export-pdf-lot', 'true');
            checkbox.checked = index === this.currentLotIndex;

            const lotName = (lot.nom || '').trim() || ('Lot ' + (index + 1));
            const typePiece = ((lot.allotissement && lot.allotissement.typePiece) || '').trim();
            const orientation = lot.orientationLabel && lot.orientationLabel !== '…' ? ' · ' + lot.orientationLabel : '';
            const typePieceTerm = typePiece ? ' · ' + typePiece : '';

            const text = document.createElement('span');
            text.textContent = lotName + typePieceTerm + orientation;

            label.appendChild(checkbox);
            label.appendChild(text);
            list.appendChild(label);
        });
    }

    getSelectedExportPdfLotIndices() {
        return Array.from(document.querySelectorAll('[data-export-pdf-lot]'))
            .filter((input) => input.checked)
            .map((input) => parseInt(input.value, 10))
            .filter((value) => Number.isInteger(value) && value >= 0);
    }

    renderEtiqueterLotOptions() {
        const list = document.getElementById('etiqueterLotsList');
        const hint = document.getElementById('etiqueterLotsHint');
        if (!list) return;

        const lots = this.data.lots || [];
        list.innerHTML = '';

        if (!lots.length) {
            const emptyText = document.createElement('p');
            emptyText.style.margin = '0';
            emptyText.style.fontSize = '13px';
            emptyText.style.color = '#666666';
            emptyText.textContent = 'Aucun lot disponible.';
            list.appendChild(emptyText);
            if (hint) hint.textContent = 'Ajoutez un lot avant de lancer un export d\'étiquettes.';
            return;
        }

        if (hint) hint.textContent = 'Sélectionner un ou plusieurs lots puis lancer l\'export.';

        lots.forEach((lot, index) => {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '8px';
            label.style.padding = '8px 10px';
            label.style.border = '1px solid #E6E6E6';
            label.style.borderRadius = '8px';
            label.style.cursor = 'pointer';
            label.style.background = '#FAFAFA';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = String(index);
            checkbox.setAttribute('data-export-etiquette-lot', 'true');
            checkbox.checked = index === this.currentLotIndex;

            const lotName = this.getPdfLotLabel(lot, index);
            const typePiece = ((lot.allotissement && lot.allotissement.typePiece) || '').trim();
            const orientation = lot.orientationLabel && lot.orientationLabel !== '…' ? ' · ' + lot.orientationLabel : '';
            const typePieceTerm = typePiece ? ' · ' + typePiece : '';

            const text = document.createElement('span');
            text.textContent = lotName + typePieceTerm + orientation;

            label.appendChild(checkbox);
            label.appendChild(text);
            list.appendChild(label);
        });
    }

    getSelectedEtiqueterLotIndices() {
        return Array.from(document.querySelectorAll('[data-export-etiquette-lot]'))
            .filter((input) => input.checked)
            .map((input) => parseInt(input.value, 10))
            .filter((value) => Number.isInteger(value) && value >= 0);
    }

    render() {
        this.renderAccueilMeta();
        this.renderInspection();
        this.renderAllotissement();
        this.renderDetailLot();
        this.renderBio();
        this.renderMech();
        this.renderUsage();
        this.renderDenat();
        this.renderDebit();
        this.renderGeo();
        this.renderEssence();
        this.renderAncien();
        this.renderTraces();
        this.renderProvenance();
        this.renderSeuils();
        this.renderRadar();
        this.renderOrientation();
        this.renderEvalOp();
        this.setupNotationResetConfirmations();

        document.querySelectorAll('.bio-slider, .mech-slider, .usage-slider, .denat-slider, .debit-slider, .geo-slider, .essence-slider, .ancien-slider, .traces-slider, .provenance-slider, .inspection-slider').forEach((slider) => {
            if (typeof slider.__refreshActiveSliderLabel === 'function') {
                slider.__refreshActiveSliderLabel();
            }
        });
    }

    renderAccueilMeta() {
        this.data.meta = this.getDefaultMeta(this.data.meta || {});
        this.data.ui = this.getDefaultUi(this.data.ui || {});
        const meta = this.data.meta;
        const ui = this.data.ui;

        document.querySelectorAll('[data-ui-collapsible]').forEach((detailsEl) => {
            const key = detailsEl.getAttribute('data-ui-collapsible');
            if (!key) return;
            const shouldBeOpen = ui.collapsibles[key] !== false;
            if (detailsEl.open !== shouldBeOpen) detailsEl.open = shouldBeOpen;
        });

        const aproposBtn = document.getElementById('btnAproposToggle');
        const aproposContent = document.getElementById('aproposContent');
        if (aproposBtn && aproposContent) {
            const shouldShowApropos = ui.collapsibles.apropos === true;
            if (shouldShowApropos) {
                aproposContent.removeAttribute('hidden');
                aproposBtn.setAttribute('aria-expanded', 'true');
            } else {
                aproposContent.setAttribute('hidden', '');
                aproposBtn.setAttribute('aria-expanded', 'false');
            }
        }

        document.querySelectorAll('[data-meta-field]').forEach((el) => {
            const field = el.getAttribute('data-meta-field');
            if (!field) return;
            const nextValue = meta[field] || '';
            
            // Special handling for statute slider
            if (field === 'statutEtude' && el.type === 'range') {
                const statutMapValues = ['Pré-diagnostic', 'En cours', 'Finalisé', 'Révision', 'Cloturé'];
                const sliderIndex = statutMapValues.indexOf(nextValue);
                if (el.value !== String(sliderIndex >= 0 ? sliderIndex : 0)) {
                    el.value = String(sliderIndex >= 0 ? sliderIndex : 0);
                }
                
                // Initialize active label styling
                const sliderWrapper = el.closest('.bio-slider-wrapper');
                if (sliderWrapper) {
                    const labels = sliderWrapper.querySelectorAll('.bio-slider-label');
                    labels.forEach((label) => {
                        label.classList.remove('bio-slider-label--active');
                        if (label.getAttribute('data-index') === el.value) {
                            label.classList.add('bio-slider-label--active');
                        }
                    });
                }
            } else if (el.value !== nextValue) {
                el.value = nextValue;
            }
        });

        const refInput = document.getElementById('inputReferenceGisement');
        if (refInput) refInput.value = this.getReferenceGisement(meta);

        // Sync boutons toggle diagnostics
        ['diagnosticStructure', 'diagnosticAmiante', 'diagnosticPlomb'].forEach((field) => {
            this.syncMetaToggleGroup(field);
        });
    }

    renderDefaultPieceCardHTML(lot) {
        const formatGrouped = (value, digits = 0) => (parseFloat(value) || 0).toLocaleString('fr-FR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        const formatOneDecimal = (value) => formatGrouped(value, 1);

        const a = lot.allotissement;
        const qRaw = parseFloat(a.quantite) || 0;
        const q = Math.max(qRaw, (lot.pieces || []).length);
        const numDefault = Math.max(0, q - (lot.pieces || []).length);
        const isDisabled = numDefault <= 0;

        const L = parseFloat(a.longueur) || 0;
        const l = parseFloat(a.largeur) || 0;
        const h = parseFloat(a.hauteur) || 0;
        const d = parseFloat(a.diametre) || 0;

        const hasDiametre = (a.diametre || '') !== '' && a.diametre != null;
        const hasLH = ((a.largeur || '') !== '' && a.largeur != null) || ((a.hauteur || '') !== '' && a.hauteur != null);

        // Calculs locaux pour affichage
        let volPiece, surfPiece;
        if (d > 0) {
            volPiece = (Math.PI * (d/2) * (d/2) * L) / 1000000000;
        } else {
            volPiece = (L * l * h) / 1000000000;
        }
        surfPiece = (L * l) / 1000000;

        const isSurfaceMuted = hasDiametre || (h > 55 || (l > 0 && h > 0 && l / h <= 4));

        const pm = parseFloat(a.prixMarche) || 0;
        const priceUnit = ((a.prixUnite || 'm3') + '').toLowerCase();
        const lineaire = L / 1000;
        const pricingBase = priceUnit === 'ml' ? lineaire : priceUnit === 'm2' ? surfPiece : volPiece;
        const prixPiece = pricingBase * pm;
        const integrityFactor = this.getLotIntegrityPriceFactor(lot);
        const prixAjuste = prixPiece * integrityFactor;
        const isIgnored = !!(((lot.inspection || {}).integrite || {}).ignore);
        const integriteData = (lot.inspection && lot.inspection.integrite) || {};
        const integrityLabel = integriteData.ignore ? 'Ignoré'
            : integriteData.niveau === 'forte' ? `Forte (${integriteData.coeff ?? '...'})`
            : integriteData.niveau === 'moyenne' ? `Moyenne (${integriteData.coeff ?? '...'})`
            : integriteData.niveau === 'faible' ? `Faible (${integriteData.coeff ?? '...'})`
            : '...';

        const rho = parseFloat(a.masseVolumique) || 0;
        const massePiece = rho * volPiece;
        const masseD = this.formatMasseDisplay(massePiece);
        const carbonFractionFixed = 0.5;
        const woodPct = parseFloat(a.bois);
        const mc = parseFloat(a.humidite);
        const safeWoodPct = Number.isFinite(woodPct) ? woodPct : 100;
        const safeMc = Number.isFinite(mc) ? mc : 12;
        const moistureDenominator = 1 + (safeMc / 100);
        const pco2Kg = moistureDenominator > 0
            ? (44 / 12) * carbonFractionFixed * rho * volPiece * (safeWoodPct / 100) / moistureDenominator : 0;
        const pco2D = this.formatPco2Display(pco2Kg);

        return `
        <div class="piece-card piece-card--default${isDisabled ? ' piece-card--disabled' : ''}" data-default-piece>
            <div class="piece-card-header">
                <span class="piece-card-title">Pièce par défaut</span>
                <span class="piece-default-count">${isDisabled ? 'Aucune' : (numDefault + ' pièce' + (numDefault > 1 ? 's' : ''))}</span>
            </div>
            <div class="piece-form-grid">
                <div class="lot-group">
                    <p class="lot-group-title">Dimensions, volume, surface</p>
                    <div class="lot-inline-grid lot-inline-grid--lot-dimensions">
                        <div class="lot-dimension-field">
                            <label class="lot-field-label">Longueur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${L > 0 ? 'true' : 'false'}">
                                <input type="text" class="lot-input" value="${this.formatAllotissementNumericDisplay(a.longueur)}" readonly tabindex="-1">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed">
                                <label class="lot-field-label">Volume unitaire</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${isDisabled ? '' : formatGrouped(volPiece, 3)}" readonly>
                                    <span class="lot-input-unit">m3</span>
                                </div>
                            </div>
                        </div>
                        <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                            <label class="lot-field-label">Largeur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${l > 0 ? 'true' : 'false'}">
                                <input type="text" class="lot-input" value="${this.formatAllotissementNumericDisplay(a.largeur)}" readonly tabindex="-1">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed"${isSurfaceMuted ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Surface unitaire</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${isDisabled || isSurfaceMuted ? '' : formatOneDecimal(surfPiece)}" readonly>
                                    <span class="lot-input-unit">m2</span>
                                </div>
                            </div>
                        </div>
                        <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                            <label class="lot-field-label">Épaisseur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${h > 0 ? 'true' : 'false'}">
                                <input type="text" class="lot-input" value="${this.formatAllotissementNumericDisplay(a.hauteur)}" readonly tabindex="-1">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed"${hasLH ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Diamètre</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${this.formatAllotissementNumericDisplay(a.diametre)}" readonly tabindex="-1">
                                    <span class="lot-input-unit">mm</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="lot-group">
                    <p class="lot-group-title">Prix</p>
                    <div class="lot-price-summary-row">
                        <div class="lot-field-block">
                            <label class="lot-field-label">Prix unitaire</label>
                            <div class="lot-input-with-unit">
                                <input type="text" class="lot-input" value="${isDisabled ? '' : formatGrouped(Math.round(prixPiece), 0)}" readonly>
                                <span class="lot-input-unit">€</span>
                            </div>
                        </div>
                        <div class="lot-field-block">
                            <label class="lot-field-label">Prix ajusté</label>
                            <div class="lot-input-with-unit">
                                <input type="text" class="lot-input" value="${isDisabled || isIgnored ? '' : formatGrouped(Math.round(prixAjuste), 0)}" readonly>
                                <span class="lot-input-unit">€</span>
                            </div>
                        </div>
                        <div class="lot-field-block">
                            <label class="lot-field-label">Intégrité</label>
                            <input type="text" class="lot-input" value="${integrityLabel}" readonly>
                        </div>
                    </div>
                </div>
                <div class="lot-group">
                    <p class="lot-group-title">Carbone</p>
                    <div class="lot-inline-grid lot-inline-grid--2">
                        <div class="lot-field-block">
                            <label class="lot-field-label">Masse</label>
                            <div class="lot-input-with-unit">
                                <input type="text" class="lot-input" value="${isDisabled ? '' : masseD.value}" readonly>
                                <span class="lot-input-unit">${masseD.unit}</span>
                            </div>
                        </div>
                        <div class="lot-field-block">
                            <label class="lot-field-label">PCO₂</label>
                            <div class="lot-input-with-unit">
                                <input type="text" class="lot-input" value="${isDisabled ? '' : pco2D.value}" readonly>
                                <span class="lot-input-unit">${pco2D.unit}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderPieceCardHTML(piece, pieceIndex, lot) {
        const formatGrouped = (value, digits = 0) => (parseFloat(value) || 0).toLocaleString('fr-FR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        const formatOneDecimal = (value) => formatGrouped(value, 1);

        const pEffTypePiece = piece.typePiece || lot.allotissement.typePiece || '';
        const pEffEssenceCommun = piece.essenceNomCommun || lot.allotissement.essenceNomCommun || '';
        const pEffEssenceScientifique = piece.essenceNomScientifique || lot.allotissement.essenceNomScientifique || '';
        const pPriceUnit = ((piece.prixUnite || lot.allotissement.prixUnite || 'm3') + '').toLowerCase();
        const pPrixMarche = piece.prixMarche !== '' ? piece.prixMarche : lot.allotissement.prixMarche;
        const pMasseVol = piece.masseVolumique !== '' ? piece.masseVolumique : lot.allotissement.masseVolumique;
        const pHumidite = piece.humidite !== '' ? piece.humidite : lot.allotissement.humidite;
        const pFractionC = piece.fractionCarbonee !== '' ? piece.fractionCarbonee : lot.allotissement.fractionCarbonee;
        const pBois = piece.bois !== '' ? piece.bois : lot.allotissement.bois;
        const pco2Display = this.formatPco2Display(piece.carboneBiogeniqueEstime);
        const masseDisplay = this.formatMasseDisplay(piece.massePiece);
        const integriteData = (lot.inspection && lot.inspection.integrite) || {};
        const integrityLabel = integriteData.ignore ? 'Ignoré'
            : integriteData.niveau === 'forte' ? `Forte (${integriteData.coeff ?? '...'})`
            : integriteData.niveau === 'moyenne' ? `Moyenne (${integriteData.coeff ?? '...'})`
            : integriteData.niveau === 'faible' ? `Faible (${integriteData.coeff ?? '...'})`
            : '...';

        const hasDiametre = piece.diametre !== '' && piece.diametre != null;
        const hasLH = (piece.largeur !== '' && piece.largeur != null) || (piece.hauteur !== '' && piece.hauteur != null);
        const _lDim = parseFloat(piece.largeur) || 0;
        const _hDim = parseFloat(piece.hauteur) || 0;
        const isSurfaceMutedByShape = _hDim > 55 || (_lDim > 0 && _hDim > 0 && _lDim / _hDim <= 4);
        const isSurfaceMuted = hasDiametre || isSurfaceMutedByShape;

        return `
        <div class="piece-card" data-piece-index="${pieceIndex}">
            <div class="piece-card-header">
                <span class="piece-card-title">${piece.nom || ('Pièce ' + (pieceIndex + 1))}</span>
                <button class="piece-delete-btn" type="button" data-piece-delete="${pieceIndex}">✕</button>
            </div>
            <div class="piece-form-grid">
                <div class="lot-group" style="margin-bottom: 4px;">
                    <p class="lot-group-title">Type de pièce, essence</p>
                    <div class="lot-field-block">
                        <div class="lot-essence-picker">
                            <input type="text" class="lot-input" value="${pEffTypePiece}" placeholder="Type de pièce (hérité du lot si vide)" data-piece-input="typePiece" list="liste-termes-bois" autocomplete="off">
                        </div>
                    </div>
                    <div class="lot-inline-grid lot-inline-grid--lot-essence">
                        <input type="text" class="lot-input lot-input--essence-common" value="${pEffEssenceCommun}" placeholder="Essence (nom commun)" data-piece-input="essenceNomCommun" list="liste-essences-communes" autocomplete="off">
                        <input type="text" class="lot-input lot-input--essence-scientific" value="${pEffEssenceScientifique}" placeholder="Essence (nom scientifique)" data-piece-input="essenceNomScientifique" list="liste-essences-scientifiques" autocomplete="off">
                    </div>
                </div>
                <div class="lot-group">
                    <p class="lot-group-title">Dimensions, volume, surface</p>
                    <div class="lot-inline-grid lot-inline-grid--lot-dimensions">
                        <div class="lot-dimension-field">
                            <label class="lot-field-label">Longueur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${piece.longueur !== '' && piece.longueur != null ? 'true' : 'false'}">
                                <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(piece.longueur)}" data-piece-input="longueur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed">
                                <label class="lot-field-label">Volume unitaire</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${formatGrouped(piece.volumePiece, 3)}" readonly data-piece-display="volumePiece">
                                    <span class="lot-input-unit">m3</span>
                                </div>
                            </div>
                        </div>
                        <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                            <label class="lot-field-label">Largeur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${piece.largeur !== '' && piece.largeur != null ? 'true' : 'false'}">
                                <input type="text" inputmode="decimal" class="lot-input lot-input--with-placeholder" value="${this.formatAllotissementNumericDisplay(piece.largeur)}" placeholder="Face, Plat…" data-piece-input="largeur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed"${isSurfaceMuted ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Surface unitaire</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${isSurfaceMuted ? '' : formatOneDecimal(piece.surfacePiece)}" readonly data-piece-display="surfacePiece">
                                    <span class="lot-input-unit">m2</span>
                                </div>
                            </div>
                        </div>
                        <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                            <label class="lot-field-label">Épaisseur</label>
                            <div class="lot-dimension-input-wrap" data-has-value="${piece.hauteur !== '' && piece.hauteur != null ? 'true' : 'false'}">
                                <input type="text" inputmode="decimal" class="lot-input lot-input--with-placeholder" value="${this.formatAllotissementNumericDisplay(piece.hauteur)}" placeholder="Chant, Rive…" data-piece-input="hauteur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                <span class="lot-dimension-unit">mm</span>
                            </div>
                            <div class="lot-dimension-computed"${hasLH ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Diamètre</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(piece.diametre)}" data-piece-input="diametre">
                                    <span class="lot-input-unit">mm</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="lot-group">
                    <p class="lot-group-title">Prix</p>
                    <div class="lot-field-block">
                        <label class="lot-field-label lot-field-label--subsection">Prix du marché</label>
                        <div class="lot-price-market-row">
                            <div class="lot-input-with-unit">
                                <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(pPrixMarche)}" data-piece-input="prixMarche">
                                <span class="lot-input-unit" data-piece-display="prixMarcheUnit">€/${pPriceUnit}</span>
                            </div>
                            <div class="lot-price-unit-toggle" role="group" aria-label="Unité de prix">
                                <button type="button" class="lot-price-unit-btn" data-piece-price-unit="ml" aria-pressed="${pPriceUnit === 'ml' ? 'true' : 'false'}">au ml</button>
                                <button type="button" class="lot-price-unit-btn" data-piece-price-unit="m2" aria-pressed="${pPriceUnit === 'm2' ? 'true' : 'false'}">au m2</button>
                                <button type="button" class="lot-price-unit-btn" data-piece-price-unit="m3" aria-pressed="${pPriceUnit !== 'ml' && pPriceUnit !== 'm2' ? 'true' : 'false'}">au m3</button>
                            </div>
                        </div>
                    </div>
                    <div class="lot-price-summary-row">
                        <div class="lot-field-block">
                            <label class="lot-field-label">Prix de la pièce</label>
                            <div class="lot-input-with-unit lot-input-with-unit--compact">
                                <input type="text" class="lot-input" value="${formatGrouped(Math.round(piece.prixPiece || 0), 0)}" readonly data-piece-display="prixPiece">
                                <span class="lot-input-unit">€</span>
                            </div>
                        </div>
                        <div class="lot-field-block"${integriteData.ignore ? ' data-muted="true"' : ''}>
                            <label class="lot-field-label">Prix ajusté</label>
                            <div class="lot-input-with-unit lot-input-with-unit--compact">
                                <input type="text" class="lot-input" value="${integriteData.ignore ? '' : formatGrouped(Math.round(piece.prixPieceAjusteIntegrite || 0), 0)}" readonly data-piece-display="prixPieceAjuste">
                                <span class="lot-input-unit">€</span>
                            </div>
                        </div>
                        <div class="lot-field-block">
                            <label class="lot-field-label">Intégrité lot</label>
                            <input type="text" class="lot-input" value="${integrityLabel}" readonly data-piece-display="integriteLot">
                        </div>
                    </div>
                </div>
                <div class="lot-group">
                    <p class="lot-group-title">Carbone</p>
                    <div class="lot-carbon-input-row">
                        <div class="lot-carbon-mass-row">
                            <div class="lot-field-block">
                                <label class="lot-field-label">Masse volumique</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact lot-input-with-unit--mass-density">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(pMasseVol)}" data-piece-input="masseVolumique">
                                    <span class="lot-input-unit">kg/m3</span>
                                </div>
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label">Masse pièce</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" class="lot-input" value="${masseDisplay.value}" readonly data-piece-display="massePiece">
                                    <span class="lot-input-unit" data-piece-display="massePieceUnit">${masseDisplay.unit}</span>
                                </div>
                            </div>
                        </div>
                        <div class="lot-carbon-other-row">
                            <div class="lot-field-block">
                                <label class="lot-field-label">Fraction C</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(pFractionC)}" data-piece-input="fractionCarbonee">
                                    <span class="lot-input-unit">%</span>
                                </div>
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label">Humidité</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(pHumidite)}" data-piece-input="humidite">
                                    <span class="lot-input-unit">%</span>
                                </div>
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label">Bois</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(pBois)}" data-piece-input="bois">
                                    <span class="lot-input-unit">%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="lot-carbon-summary-row">
                        <div class="lot-field-block">
                            <label class="lot-field-label">PCO₂ pièce</label>
                            <div class="lot-input-with-unit">
                                <input type="text" class="lot-input" value="${pco2Display.value}" readonly data-piece-display="carboneBiogeniqueEstime">
                                <span class="lot-input-unit" data-piece-display="carboneBiogeniqueEstimeUnit">${pco2Display.unit}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    renderAllotissement () {
    const rail = document.getElementById('lotRail');
    const sliderTrack = document.getElementById('lotSliderTrack');
    const lotLabel = document.getElementById('activeLotLabel');

    if (!rail || !sliderTrack) return;

    rail.innerHTML = '';
    sliderTrack.innerHTML = '';

    const lots = this.data.lots;
    const currentLot = this.getCurrentLot();

    // Titre de l'en-tête
    if (lotLabel && currentLot) {
        const index = lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? `Lot ${index + 1}` : 'Lot';
    }

    // BOUCLE SUR CHAQUE LOT
    lots.forEach((lot, index) => {
        const formatGrouped = (value, digits = 0) => (parseFloat(value) || 0).toLocaleString('fr-FR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        const formatOneDecimal = (value) => formatGrouped(value, 1);

        this.normalizeLotEssenceFields(lot);
        this.normalizeLotAllotissementFields(lot);
        this.recalculateLotAllotissement(lot);

        const card = document.createElement('div');
        card.className = 'lot-card ' + (index === this.currentLotIndex ? 'lot-card--active' : 'lot-card--passive');
        card.dataset.lotIndex = String(index);

        const lotOrientationLabel = lot.orientationLabel || '…';
        const lotOrientationClass = lot.orientationCode ? `lot-orientation--${lot.orientationCode}` : 'lot-orientation--none';
        const lotDisplayName = (!lot.nom || lot.nom === 'Nouveau Lot') ? `Lot ${index + 1}` : lot.nom;
        const priceUnit = ((lot.allotissement.prixUnite || 'm3') + '').toLowerCase();
        const pco2Display = this.formatPco2Display(lot.allotissement.carboneBiogeniqueEstime);
        const masseLotDisplay = this.formatMasseDisplay(lot.allotissement.masseLot);
        const masseVolumiqueSourceLabel = this.getMasseVolumiqueSourceLabel(lot.allotissement);
        const integriteData = (lot.inspection && lot.inspection.integrite) || {};
        const lotIntegrityLabel = integriteData.ignore
            ? 'Ignoré'
            : integriteData.niveau === 'forte'
                ? `Forte (${integriteData.coeff ?? '...'})`
                : integriteData.niveau === 'moyenne'
                    ? `Moyenne (${integriteData.coeff ?? '...'})`
                    : integriteData.niveau === 'faible'
                        ? `Faible (${integriteData.coeff ?? '...'})`
                        : '...';

        const hasDiametre = lot.allotissement.diametre !== '' && lot.allotissement.diametre != null;
        const hasLargeurHauteur = (lot.allotissement.largeur !== '' && lot.allotissement.largeur != null) || (lot.allotissement.hauteur !== '' && lot.allotissement.hauteur != null);
        const _lDim = parseFloat(lot.allotissement.largeur) || 0;
        const _hDim = parseFloat(lot.allotissement.hauteur) || 0;
        const isSurfaceMutedByShape = _hDim > 55 || (_lDim > 0 && _hDim > 0 && _lDim / _hDim <= 4);
        const isSurfaceMuted = hasDiametre || isSurfaceMutedByShape;

        card.innerHTML = `
            <div class="lot-card-header">
                <div class="lot-card-header-left">
                    <p class="lot-name-label" aria-label="Nom du lot">${lotDisplayName}</p>
                    <span class="lot-orientation-badge ${lotOrientationClass}" data-lot-orientation-badge>${lotOrientationLabel}</span>
                </div>
                <button class="lot-delete-btn" type="button">✕</button>
            </div>
            <div class="lot-form-grid mt-16">
                <div class="lot-field-block lot-field-block--full">
                    <div class="lot-group" style="margin-bottom: 6px;">
                        <div class="lot-inline-grid lot-inline-grid--2">
                            <div class="lot-field-block">
                                <label class="lot-field-label lot-field-label--hidden">Bâtiment, zone, espace…</label>
                                <input type="text" class="lot-input" value="${lot.localisation || ''}" placeholder="Bâtiment, zone, espace…" data-lot-input="localisation">
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label lot-field-label--hidden">Situation</label>
                                <input type="text" class="lot-input" value="${lot.situation || ''}" placeholder="Situation du lot" data-lot-input="situation" list="liste-situations" autocomplete="off">
                            </div>
                        </div>
                    </div>
                    <div class="lot-group">
                        <p class="lot-group-title">Groupe : type de pièce, quantité, essence</p>
                        <div class="lot-type-qty-grid">
                            <div class="lot-field-block">
                                <label class="lot-field-label lot-field-label--hidden">Quantité</label>
                                <div class="lot-qty-row">
                                    <input type="text" inputmode="numeric" class="lot-input lot-input--qty" value="${this.formatAllotissementNumericDisplay(lot.allotissement.quantite)}" placeholder="Quantité" data-lot-input="quantite">
                                    <span class="lot-pieces-badge" data-display="piecesBadge">${lot.pieces.length}/${Math.max(parseFloat(lot.allotissement.quantite) || 0, lot.pieces.length)}</span>
                                    <button type="button" class="lot-alert-btn" data-alert-active="${(parseFloat(lot.allotissement.quantite) || 0) > lot.pieces.length ? 'true' : 'false'}" data-lot-alert-btn>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                    </button>
                                </div>
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label lot-field-label--hidden">Type de pièce</label>
                                <div class="lot-essence-picker">
                                    <input
                                        type="text"
                                        class="lot-input"
                                        value="${lot.allotissement.typePiece || ''}"
                                        placeholder="Type de pièce"
                                        data-lot-input="typePiece"
                                        list="liste-termes-bois"
                                        autocomplete="off">
                                </div>
                            </div>
                        </div>
                        <label class="lot-field-label lot-field-label--subsection lot-field-label--hidden">Essence</label>
                        <div class="lot-inline-grid lot-inline-grid--lot-essence">
                            <input type="text" class="lot-input lot-input--essence-common" value="${lot.allotissement.essenceNomCommun || ''}" placeholder="Essence (nom commun)" data-lot-input="essenceNomCommun" list="liste-essences-communes" autocomplete="off">
                            <input type="text" class="lot-input lot-input--essence-scientific" value="${lot.allotissement.essenceNomScientifique || ''}" placeholder="Essence (nom scientifique)" data-lot-input="essenceNomScientifique" list="liste-essences-scientifiques" autocomplete="off">
                        </div>
                    </div>
                    <div class="lot-group">
                        <p class="lot-group-title">Groupe : dimensions, volumes, surface</p>
                        <div class="lot-inline-grid lot-inline-grid--lot-dimensions">
                            <div class="lot-dimension-field">
                                <label class="lot-field-label">Longueur</label>
                                <div class="lot-dimension-input-wrap" data-has-value="${lot.allotissement.longueur !== '' && lot.allotissement.longueur != null ? 'true' : 'false'}">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.longueur)}" data-lot-input="longueur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                    <span class="lot-dimension-unit">mm</span>
                                </div>
                                <div class="lot-dimension-computed">
                                    <label class="lot-field-label">Volume unitaire</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" class="lot-input" value="${formatGrouped(lot.allotissement.volumePiece, 3)}" readonly data-display="volumePiece">
                                        <span class="lot-input-unit">m3</span>
                                    </div>
                                </div>
                                <div class="lot-dimension-computed">
                                    <label class="lot-field-label">Volume du lot</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" class="lot-input" value="${formatOneDecimal(lot.allotissement.volumeLot)}" readonly data-display="volumeLot">
                                        <span class="lot-input-unit">m3</span>
                                    </div>
                                </div>
                            </div>
                            <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Largeur/Hauteur</label>
                                <div class="lot-dimension-input-wrap" data-has-value="${lot.allotissement.largeur !== '' && lot.allotissement.largeur != null ? 'true' : 'false'}">
                                    <input type="text" inputmode="decimal" class="lot-input lot-input--with-placeholder" value="${this.formatAllotissementNumericDisplay(lot.allotissement.largeur)}" placeholder="Face, Plat…" data-lot-input="largeur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                    <span class="lot-dimension-unit">mm</span>
                                </div>
                                <div class="lot-dimension-computed"${isSurfaceMuted ? ' data-muted="true"' : ''}>
                                    <label class="lot-field-label">Surface unitaire</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" class="lot-input" value="${isSurfaceMuted ? '' : formatOneDecimal(lot.allotissement.surfacePiece)}" readonly data-display="surfacePiece">
                                        <span class="lot-input-unit">m2</span>
                                    </div>
                                </div>
                                <div class="lot-dimension-computed"${isSurfaceMuted ? ' data-muted="true"' : ''}>
                                    <label class="lot-field-label">Surface du lot</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" class="lot-input" value="${isSurfaceMuted ? '' : formatOneDecimal(lot.allotissement.surfaceLot)}" readonly data-display="surfaceLot">
                                        <span class="lot-input-unit">m2</span>
                                    </div>
                                </div>
                            </div>
                            <div class="lot-dimension-field"${hasDiametre ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Épaisseur</label>
                                <div class="lot-dimension-input-wrap" data-has-value="${lot.allotissement.hauteur !== '' && lot.allotissement.hauteur != null ? 'true' : 'false'}">
                                    <input type="text" inputmode="decimal" class="lot-input lot-input--with-placeholder" value="${this.formatAllotissementNumericDisplay(lot.allotissement.hauteur)}" placeholder="Chant, Rive…" data-lot-input="hauteur" oninput="this.parentElement.dataset.hasValue = this.value !== '' ? 'true' : 'false'">
                                    <span class="lot-dimension-unit">mm</span>
                                </div>
                                <div class="lot-dimension-computed"${hasLargeurHauteur ? ' data-muted="true"' : ''}>
                                    <label class="lot-field-label">Diamètre</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.diametre)}" data-lot-input="diametre">
                                        <span class="lot-input-unit">mm</span>
                                    </div>
                                </div>
                                <div class="lot-dimension-computed">
                                    <label class="lot-field-label">Linéaire du lot</label>
                                    <div class="lot-input-with-unit">
                                        <input type="text" class="lot-input" value="${formatOneDecimal(lot.allotissement.lineaireLot)}" readonly data-display="lineaireLot">
                                        <span class="lot-input-unit">m</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="lot-group">
                        <p class="lot-group-title">Groupe : prix</p>
                        <div class="lot-field-block">
                            <label class="lot-field-label lot-field-label--subsection">Prix du marché</label>
                            <div class="lot-price-market-row">
                                <div class="lot-input-with-unit">
                                    <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.prixMarche)}" data-lot-input="prixMarche">
                                    <span class="lot-input-unit" data-display="prixMarcheUnit">€/${priceUnit}</span>
                                </div>
                                <div class="lot-price-unit-toggle" role="group" aria-label="Unité de prix du marché">
                                    <button type="button" class="lot-price-unit-btn" data-price-unit="ml" aria-pressed="${priceUnit === 'ml' ? 'true' : 'false'}">au ml</button>
                                    <button type="button" class="lot-price-unit-btn" data-price-unit="m2" aria-pressed="${priceUnit === 'm2' ? 'true' : 'false'}">au m2</button>
                                    <button type="button" class="lot-price-unit-btn" data-price-unit="m3" aria-pressed="${priceUnit !== 'ml' && priceUnit !== 'm2' ? 'true' : 'false'}">au m3</button>
                                </div>
                            </div>
                        </div>
                        <div class="lot-price-summary-row">
                            <div class="lot-field-block">
                                <label class="lot-field-label">Prix du lot</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" class="lot-input" value="${formatGrouped(Math.round(lot.allotissement.prixLot || 0), 0)}" readonly data-display="prixLot">
                                    <span class="lot-input-unit">€</span>
                                </div>
                            </div>
                            <div class="lot-field-block" data-display="prixLotAjusteBlock"${integriteData.ignore ? ' data-muted="true"' : ''}>
                                <label class="lot-field-label">Prix ajusté</label>
                                <div class="lot-input-with-unit lot-input-with-unit--compact">
                                    <input type="text" class="lot-input" value="${integriteData.ignore ? '' : formatGrouped(Math.round(lot.allotissement.prixLotAjusteIntegrite || 0), 0)}" readonly data-display="prixLotAjusteIntegrite">
                                    <span class="lot-input-unit">€</span>
                                </div>
                            </div>
                            <div class="lot-field-block">
                                <label class="lot-field-label">Intégrité lot</label>
                                <input type="text" class="lot-input" value="${lotIntegrityLabel}" readonly data-display="integriteLot">
                            </div>
                        </div>
                    </div>
                    <div class="lot-group">
                        <p class="lot-group-title">Groupe : carbone</p>
                        <div class="lot-carbon-input-row">
                            <div class="lot-carbon-mass-row">
                                <div class="lot-field-block">
                                    <label class="lot-field-label">Masse volumique</label>
                                    <div class="lot-input-with-unit lot-input-with-unit--compact lot-input-with-unit--mass-density">
                                        <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.masseVolumique ?? 510)}" data-lot-input="masseVolumique">
                                        <span class="lot-input-unit">kg/m3</span>
                                    </div>
                                    <p class="lot-field-meta" data-display="masseVolumiqueSource">${masseVolumiqueSourceLabel}</p>
                                </div>
                                <div class="lot-field-block">
                                    <label class="lot-field-label">Masse du lot</label>
                                    <div class="lot-input-with-unit lot-input-with-unit--compact">
                                        <input type="text" class="lot-input" value="${masseLotDisplay.value}" readonly data-display="masseLot">
                                        <span class="lot-input-unit" data-display="masseLotUnit">${masseLotDisplay.unit}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="lot-carbon-other-row">
                                <div class="lot-field-block">
                                    <label class="lot-field-label">Fraction C</label>
                                    <div class="lot-input-with-unit lot-input-with-unit--compact">
                                        <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.fractionCarbonee ?? 50)}" data-lot-input="fractionCarbonee">
                                        <span class="lot-input-unit">%</span>
                                    </div>
                                </div>
                                <div class="lot-field-block">
                                    <label class="lot-field-label">Humidité</label>
                                    <div class="lot-input-with-unit lot-input-with-unit--compact">
                                        <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.humidite ?? 12)}" data-lot-input="humidite">
                                        <span class="lot-input-unit">%</span>
                                    </div>
                                </div>
                                <div class="lot-field-block">
                                    <label class="lot-field-label">Bois</label>
                                    <div class="lot-input-with-unit lot-input-with-unit--compact">
                                        <input type="text" inputmode="decimal" class="lot-input" value="${this.formatAllotissementNumericDisplay(lot.allotissement.bois ?? 100)}" data-lot-input="bois">
                                        <span class="lot-input-unit">%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="lot-carbon-summary-row">
                            <div class="lot-field-block">
                                <label class="lot-field-label">PCO₂ : masse de CO₂ séquestré estimée</label>
                                <div class="lot-input-with-unit">
                                    <input type="text" class="lot-input" value="${pco2Display.value}" readonly data-display="carboneBiogeniqueEstime">
                                    <span class="lot-input-unit" data-display="carboneBiogeniqueEstimeUnit">${pco2Display.unit}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <details class="lot-group lot-group--collapsible accueil-collapsible">
                        <summary class="accueil-collapsible-summary">Destination du lot</summary>
                        <div class="lot-group-content">
                            <div class="lot-field-block">
                                <input type="text" class="lot-input" value="${lot.allotissement.destination ?? ''}" placeholder="Entreprise" data-lot-input="destination">
                                <input type="text" class="lot-input" value="${lot.allotissement.destinationAdresse || ''}" placeholder="Adresse" data-lot-input="destinationAdresse">
                                <input type="text" class="lot-input" value="${lot.allotissement.destinationContact || ''}" placeholder="Personne contact" data-lot-input="destinationContact">
                                <input type="email" class="lot-input" value="${lot.allotissement.destinationMail || ''}" placeholder="Mail" data-lot-input="destinationMail">
                                <input type="tel" class="lot-input" value="${lot.allotissement.destinationTelephone || ''}" placeholder="Téléphone" data-lot-input="destinationTelephone">
                            </div>
                        </div>
                    </details>
                </div>
            </div>
        `;

        // Gestion du clic pour activer le lot
        card.addEventListener('click', () => {
            if (this.currentLotIndex !== index) this.setCurrentLotIndex(index);
        });

        // Permet de déplier/replier le bloc Destination sans changer la sélection du lot
        card.querySelectorAll('.lot-group--collapsible').forEach((detailsEl) => {
            detailsEl.addEventListener('click', (e) => e.stopPropagation());
        });

        // Suppression
        card.querySelector('.lot-delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openDeleteLotModal(index);
        });

        // Calculs et sauvegarde auto
        const updateCalculs = () => {
            this.recalculateLotAllotissement(lot);

            card.querySelector('[data-display="volumePiece"]').value = formatGrouped(lot.allotissement.volumePiece, 3);
            card.querySelector('[data-display="volumeLot"]').value = formatOneDecimal(lot.allotissement.volumeLot);
            const diametreActif = (lot.allotissement.diametre || '') !== '';
            const _lv = parseFloat(lot.allotissement.largeur) || 0;
            const _hv = parseFloat(lot.allotissement.hauteur) || 0;
            const surfaceMutedByShape = _hv > 55 || (_lv > 0 && _hv > 0 && _lv / _hv <= 4);
            const surfaceMuted = diametreActif || surfaceMutedByShape;
            card.querySelector('[data-display="surfacePiece"]').value = surfaceMuted ? '' : formatOneDecimal(lot.allotissement.surfacePiece);
            card.querySelector('[data-display="surfaceLot"]').value = surfaceMuted ? '' : formatOneDecimal(lot.allotissement.surfaceLot);
            const _spEl = card.querySelector('[data-display="surfacePiece"]')?.closest('.lot-dimension-computed');
            const _slEl = card.querySelector('[data-display="surfaceLot"]')?.closest('.lot-dimension-computed');
            if (_spEl) _spEl.dataset.muted = surfaceMuted ? 'true' : 'false';
            if (_slEl) _slEl.dataset.muted = surfaceMuted ? 'true' : 'false';
            card.querySelector('[data-display="prixLot"]').value = formatGrouped(Math.round(lot.allotissement.prixLot), 0);
            const isIntegriteIgnored = !!(((lot.inspection || {}).integrite || {}).ignore);
            card.querySelector('[data-display="prixLotAjusteIntegrite"]').value = isIntegriteIgnored
                ? ''
                : formatGrouped(Math.round(lot.allotissement.prixLotAjusteIntegrite || 0), 0);
            const prixAjusteBlock = card.querySelector('[data-display="prixLotAjusteBlock"]');
            if (prixAjusteBlock) {
                prixAjusteBlock.dataset.muted = isIntegriteIgnored ? 'true' : 'false';
            }
            card.querySelector('[data-display="lineaireLot"]').value = formatOneDecimal(lot.allotissement.lineaireLot);
            const masseLotDisplay = this.formatMasseDisplay(lot.allotissement.masseLot);
            card.querySelector('[data-display="masseLot"]').value = masseLotDisplay.value;
            const masseLotUnitEl = card.querySelector('[data-display="masseLotUnit"]');
            if (masseLotUnitEl) masseLotUnitEl.textContent = masseLotDisplay.unit;
            const masseVolumiqueSourceEl = card.querySelector('[data-display="masseVolumiqueSource"]');
            if (masseVolumiqueSourceEl) {
                masseVolumiqueSourceEl.textContent = this.getMasseVolumiqueSourceLabel(lot.allotissement);
            }
            const pco2Display = this.formatPco2Display(lot.allotissement.carboneBiogeniqueEstime);
            card.querySelector('[data-display="carboneBiogeniqueEstime"]').value = pco2Display.value;
            const pco2UnitEl = card.querySelector('[data-display="carboneBiogeniqueEstimeUnit"]');
            if (pco2UnitEl) pco2UnitEl.textContent = pco2Display.unit;

            // Mise à jour badge pièces et bouton alerte
            const nbPieces = (lot.pieces || []).length;
            const qTotal = parseFloat(lot.allotissement.quantite) || 0;
            const qEffective = Math.max(qTotal, nbPieces);
            const badgeEl = card.querySelector('[data-display="piecesBadge"]');
            if (badgeEl) badgeEl.textContent = `${nbPieces}/${qEffective}`;
            const alertBtnUpd = card.querySelector('[data-lot-alert-btn]');
            if (alertBtnUpd) alertBtnUpd.dataset.alertActive = qTotal > nbPieces ? 'true' : 'false';

            // Mise à jour des dimensions moyennes dans le formulaire lot
            if (nbPieces > 0) {
                const longueurInput = card.querySelector('input[data-lot-input="longueur"]');
                const largeurInput = card.querySelector('input[data-lot-input="largeur"]');
                const hauteurInput = card.querySelector('input[data-lot-input="hauteur"]');
                if (longueurInput && document.activeElement !== longueurInput) {
                    longueurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgLongueur || 0)));
                }
                if (largeurInput && document.activeElement !== largeurInput) {
                    largeurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgLargeur || 0)));
                }
                if (hauteurInput && document.activeElement !== hauteurInput) {
                    hauteurInput.value = this.formatAllotissementNumericDisplay(String(Math.round(lot.allotissement._avgHauteur || 0)));
                }
            }

            // Rafraîchir la pièce par défaut
            const defaultCard = document.querySelector('[data-default-piece]');
            if (defaultCard) {
                const freshHTML = this.renderDefaultPieceCardHTML(lot);
                const temp = document.createElement('div');
                temp.innerHTML = freshHTML;
                const newCard = temp.firstElementChild;
                if (newCard) defaultCard.replaceWith(newCard);
            }

            const integrite = (lot.inspection && lot.inspection.integrite) || {};
            card.querySelector('[data-display="integriteLot"]').value = integrite.ignore
                ? 'Ignoré'
                : integrite.niveau === 'forte'
                    ? `Forte (${integrite.coeff ?? '...'})`
                    : integrite.niveau === 'moyenne'
                        ? `Moyenne (${integrite.coeff ?? '...'})`
                        : integrite.niveau === 'faible'
                            ? `Faible (${integrite.coeff ?? '...'})`
                            : '...';
            
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderEvalOp(); // Met à jour la synthèse en temps réel
        };

        const syncPriceUnitButtons = () => {
            const selectedUnit = ((lot.allotissement.prixUnite || 'm3') + '').toLowerCase();
            card.querySelectorAll('button[data-price-unit]').forEach((button) => {
                button.setAttribute('aria-pressed', button.dataset.priceUnit === selectedUnit ? 'true' : 'false');
            });
            const unitDisplay = card.querySelector('[data-display="prixMarcheUnit"]');
            if (unitDisplay) unitDisplay.textContent = '€/' + selectedUnit;
        };

        card.querySelectorAll('button[data-price-unit]').forEach((button) => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const nextUnit = (button.dataset.priceUnit || '').toLowerCase();
                if (nextUnit !== 'ml' && nextUnit !== 'm2' && nextUnit !== 'm3') return;
                lot.allotissement.prixUnite = nextUnit;
                syncPriceUnitButtons();
                updateCalculs();
            });
        });

        syncPriceUnitButtons();

        // Bouton alerte pièces non détaillées
        const alertBtn = card.querySelector('[data-lot-alert-btn]');
        if (alertBtn) {
            alertBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const backdrop = document.getElementById('alertPiecesModalBackdrop');
                if (backdrop) { backdrop.classList.remove('hidden'); backdrop.setAttribute('aria-hidden', 'false'); }
            });
        }

        // Branchement des inputs
        card.querySelectorAll('input[data-lot-input]').forEach(input => {
            const updateField = (e) => {
                const field = e.target.dataset.lotInput;
                if (!field) return;
                if (this.isAllotissementNumericField(field)) {
                    const normalized = this.normalizeAllotissementNumericInput(e.target.value);
                    lot.allotissement[field] = normalized;
                    if (field === 'masseVolumique' && normalized === '' && (e.type === 'blur' || e.type === 'change')) {
                        const suggested = this.applySuggestedMasseVolumique(lot, { force: true });
                        lot.allotissement[field] = String(suggested);
                    }
                    // Quantité : si vidée et qu'il y a des pièces, afficher pieces.length
                    let qtyOverridden = false;
                    if (field === 'quantite' && normalized === '' && (e.type === 'blur' || e.type === 'change')) {
                        const nbPieces = (lot.pieces || []).length;
                        if (nbPieces > 0) {
                            e.target.value = this.formatAllotissementNumericDisplay(String(nbPieces));
                            qtyOverridden = true;
                        }
                    }
                    // Harmonisation Prix/Carbone :
                    // - pendant la saisie (input), on laisse le texte tel que tapé
                    // - au blur/change, on applique le format d'affichage
                    const shouldFormatDisplay =
                        e.type === 'change' ||
                        e.type === 'blur' ||
                        !this.isCarbonPrixNumericField(field);

                    if (shouldFormatDisplay && !qtyOverridden) {
                        e.target.value = this.formatAllotissementNumericDisplay(lot.allotissement[field]);
                    }
                } else {
                    if (field === 'localisation' || field === 'situation') {
                        lot[field] = e.target.value;
                    } else {
                        lot.allotissement[field] = e.target.value;
                    }
                }

                if (field === 'diametre') {
                    const hasDiameter = (lot.allotissement.diametre || '') !== '';
                    const largeurInput = card.querySelector('input[data-lot-input="largeur"]');
                    const hauteurInput = card.querySelector('input[data-lot-input="hauteur"]');
                    if (hasDiameter) {
                        lot.allotissement.largeur = '';
                        lot.allotissement.hauteur = '';
                        if (largeurInput) {
                            largeurInput.value = '';
                            if (largeurInput.parentElement && largeurInput.parentElement.classList.contains('lot-dimension-input-wrap')) {
                                largeurInput.parentElement.dataset.hasValue = 'false';
                            }
                        }
                        if (hauteurInput) {
                            hauteurInput.value = '';
                            if (hauteurInput.parentElement && hauteurInput.parentElement.classList.contains('lot-dimension-input-wrap')) {
                                hauteurInput.parentElement.dataset.hasValue = 'false';
                            }
                        }
                    }
                    if (largeurInput) {
                        const largeurField = largeurInput.closest('.lot-dimension-field');
                        if (largeurField) largeurField.dataset.muted = hasDiameter ? 'true' : 'false';
                    }
                    if (hauteurInput) {
                        const hauteurField = hauteurInput.closest('.lot-dimension-field');
                        if (hauteurField) hauteurField.dataset.muted = hasDiameter ? 'true' : 'false';
                    }
                    const surfacePieceComputed = card.querySelector('[data-display="surfacePiece"]')?.closest('.lot-dimension-computed');
                    const surfaceLotComputed = card.querySelector('[data-display="surfaceLot"]')?.closest('.lot-dimension-computed');
                    if (surfacePieceComputed) surfacePieceComputed.dataset.muted = hasDiameter ? 'true' : 'false';
                    if (surfaceLotComputed) surfaceLotComputed.dataset.muted = hasDiameter ? 'true' : 'false';
                }

                if (field === 'largeur' || field === 'hauteur') {
                    const hasLargeurHauteurNow = (lot.allotissement.largeur || '') !== '' || (lot.allotissement.hauteur || '') !== '';
                    const diametreInput = card.querySelector('input[data-lot-input="diametre"]');
                    if (hasLargeurHauteurNow) {
                        lot.allotissement.diametre = '';
                        if (diametreInput) diametreInput.value = '';
                        const surfacePieceComputed = card.querySelector('[data-display="surfacePiece"]')?.closest('.lot-dimension-computed');
                        const surfaceLotComputed = card.querySelector('[data-display="surfaceLot"]')?.closest('.lot-dimension-computed');
                        if (surfacePieceComputed) surfacePieceComputed.dataset.muted = 'false';
                        if (surfaceLotComputed) surfaceLotComputed.dataset.muted = 'false';
                    }
                    if (diametreInput) {
                        const diametreComputed = diametreInput.closest('.lot-dimension-computed');
                        if (diametreComputed) diametreComputed.dataset.muted = hasLargeurHauteurNow ? 'true' : 'false';
                    }
                }

                if (field === 'essenceNomCommun') {
                    const nomCommun = (lot.allotissement.essenceNomCommun || '').toString().trim();
                    const match = this.findEssenceByCommonName(nomCommun);
                    if (match) {
                        lot.allotissement.essenceNomScientifique = match.nomScientifique;
                        const scientificInput = card.querySelector('input[data-lot-input="essenceNomScientifique"]');
                        if (scientificInput) scientificInput.value = match.nomScientifique;
                    }
                    const shouldApplyMasseSuggestion = e.type !== 'input' || !!match;
                    if (shouldApplyMasseSuggestion) {
                        const masseInput = card.querySelector('input[data-lot-input="masseVolumique"]');
                        this.applySuggestedMasseVolumique(lot, { force: true });
                        if (masseInput) {
                            masseInput.value = this.formatAllotissementNumericDisplay(lot.allotissement.masseVolumique);
                        }
                    }
                }

                if (field === 'essenceNomScientifique') {
                    const nomScientifique = (lot.allotissement.essenceNomScientifique || '').toString().trim();
                    const match = this.findEssenceByScientificName(nomScientifique);
                    if (match) {
                        lot.allotissement.essenceNomCommun = match.nomUsuel;
                        const commonInput = card.querySelector('input[data-lot-input="essenceNomCommun"]');
                        if (commonInput) commonInput.value = match.nomUsuel;
                    }
                    const shouldApplyMasseSuggestion = e.type !== 'input' || !!match;
                    if (shouldApplyMasseSuggestion) {
                        const masseInput = card.querySelector('input[data-lot-input="masseVolumique"]');
                        this.applySuggestedMasseVolumique(lot, { force: true });
                        if (masseInput) {
                            masseInput.value = this.formatAllotissementNumericDisplay(lot.allotissement.masseVolumique);
                        }
                    }
                }

                lot.allotissement.essence = [
                    (lot.allotissement.essenceNomCommun || '').toString().trim(),
                    (lot.allotissement.essenceNomScientifique || '').toString().trim()
                ].filter(Boolean).join(' - ');
                updateCalculs();
            };
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('focus', (e) => {
                const field = e.target.dataset.lotInput;
                if (!field || !this.isAllotissementNumericField(field)) return;
                e.target.value = this.normalizeAllotissementNumericInput(e.target.value);

                // Démutage automatique au clic : vider le mode opposé et lever le grisage
                if ((field === 'largeur' || field === 'hauteur') && (lot.allotissement.diametre || '') !== '') {
                    lot.allotissement.diametre = '';
                    const diametreInput = card.querySelector('input[data-lot-input="diametre"]');
                    if (diametreInput) diametreInput.value = '';
                    const diametreComputed = diametreInput && diametreInput.closest('.lot-dimension-computed');
                    if (diametreComputed) diametreComputed.dataset.muted = 'false';
                    const largeurField = card.querySelector('input[data-lot-input="largeur"]')?.closest('.lot-dimension-field');
                    const hauteurField = card.querySelector('input[data-lot-input="hauteur"]')?.closest('.lot-dimension-field');
                    if (largeurField) largeurField.dataset.muted = 'false';
                    if (hauteurField) hauteurField.dataset.muted = 'false';
                    const surfacePieceComputed = card.querySelector('[data-display="surfacePiece"]')?.closest('.lot-dimension-computed');
                    const surfaceLotComputed = card.querySelector('[data-display="surfaceLot"]')?.closest('.lot-dimension-computed');
                    if (surfacePieceComputed) surfacePieceComputed.dataset.muted = 'false';
                    if (surfaceLotComputed) surfaceLotComputed.dataset.muted = 'false';
                }

                if (field === 'diametre') {
                    const hasLH = (lot.allotissement.largeur || '') !== '' || (lot.allotissement.hauteur || '') !== '';
                    if (hasLH) {
                        lot.allotissement.largeur = '';
                        lot.allotissement.hauteur = '';
                        const largeurInput = card.querySelector('input[data-lot-input="largeur"]');
                        const hauteurInput = card.querySelector('input[data-lot-input="hauteur"]');
                        if (largeurInput) {
                            largeurInput.value = '';
                            if (largeurInput.parentElement?.classList.contains('lot-dimension-input-wrap'))
                                largeurInput.parentElement.dataset.hasValue = 'false';
                        }
                        if (hauteurInput) {
                            hauteurInput.value = '';
                            if (hauteurInput.parentElement?.classList.contains('lot-dimension-input-wrap'))
                                hauteurInput.parentElement.dataset.hasValue = 'false';
                        }
                        const largeurField = largeurInput?.closest('.lot-dimension-field');
                        const hauteurField = hauteurInput?.closest('.lot-dimension-field');
                        if (largeurField) largeurField.dataset.muted = 'false';
                        if (hauteurField) hauteurField.dataset.muted = 'false';
                        const diametreComputed = e.target.closest('.lot-dimension-computed');
                        if (diametreComputed) diametreComputed.dataset.muted = 'false';
                        updateCalculs();
                    }
                }
            });
            input.addEventListener('input', updateField);
            input.addEventListener('change', updateField);
            input.addEventListener('blur', updateField);
        });

        rail.appendChild(card);

        // Points de navigation
        const dot = document.createElement('div');
        dot.className = 'lot-slider-dot ' + (index === this.currentLotIndex ? 'lot-slider-dot--active' : '');
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setCurrentLotIndex(index);
        });
        sliderTrack.appendChild(dot);
    });

    // BOUTON AJOUTER (HORS DE LA BOUCLE FOREACH)
    const btnAdd = document.getElementById('btnAddLot');
    if (btnAdd) {
        const newBtnAdd = btnAdd.cloneNode(true);
        btnAdd.parentNode.replaceChild(newBtnAdd, btnAdd);
        newBtnAdd.addEventListener('click', () => {
            const newIdx = this.data.lots.length;
            this.data.lots.push(this.createEmptyLot(newIdx));
            this.setCurrentLotIndex(newIdx);
        });
    }
}    

    renderDetailLot() {
        const section = document.getElementById('detailLotSection');
        const pieceRail = document.getElementById('pieceRail');
        const lotLabel = document.getElementById('detailLotActiveLotLabel');
        const lot = this.getCurrentLot();

        if (!section || !pieceRail) return;

        if (!lot) {
            section.style.display = 'none';
            return;
        }

        if (!Array.isArray(lot.pieces)) lot.pieces = [];

        section.style.display = '';
        const lotIndex = this.data.lots.indexOf(lot);
        if (lotLabel) lotLabel.textContent = lotIndex >= 0 ? `Lot ${lotIndex + 1}` : 'Lot';

        const formatGrouped = (value, digits = 0) => (parseFloat(value) || 0).toLocaleString('fr-FR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        const formatOneDecimal = (value) => formatGrouped(value, 1);

        // Rendre la pièce par défaut + les pièces détaillées
        pieceRail.innerHTML = this.renderDefaultPieceCardHTML(lot) + lot.pieces.map((p, pi) => this.renderPieceCardHTML(p, pi, lot)).join('');

        // Bouton ajouter pièce
        const btnAdd = document.getElementById('btnAddPiece');
        if (btnAdd) {
            const newBtn = btnAdd.cloneNode(true);
            btnAdd.parentNode.replaceChild(newBtn, btnAdd);
            newBtn.addEventListener('click', () => {
                const newPiece = this.createEmptyPiece(lot.pieces.length);
                lot.pieces.push(newPiece);
                const curQ = parseFloat(lot.allotissement.quantite) || 0;
                if (lot.pieces.length > curQ) {
                    lot.allotissement.quantite = String(lot.pieces.length);
                }
                this.recalculateLotAllotissement(lot);
                this.saveData();
                this.renderAllotissement();
                this.renderDetailLot();
            });
        }

        // Branchement des événements pour chaque carte pièce
        pieceRail.querySelectorAll('.piece-card').forEach((pieceCard) => {
            const pi = parseInt(pieceCard.dataset.pieceIndex, 10);
            const piece = lot.pieces[pi];
            if (!piece) return;

            // Bouton supprimer
            const delBtn = pieceCard.querySelector('[data-piece-delete]');
            if (delBtn) {
                delBtn.addEventListener('click', () => {
                    const pieceName = piece.nom || `Pièce ${pi + 1}`;
                    const msgEl = document.getElementById('deletePieceConfirmMessage');
                    if (msgEl) msgEl.textContent = `Voulez-vous vraiment supprimer « ${pieceName} » ?`;
                    this._pendingDeletePiece = { lot, pi };
                    const backdrop = document.getElementById('deletePieceConfirmBackdrop');
                    if (backdrop) { backdrop.classList.remove('hidden'); backdrop.setAttribute('aria-hidden', 'false'); }
                });
            }

            // Mise à jour affichages pièce
            const updatePieceDisplays = () => {
                this.recalculateLotAllotissement(lot);
                this.saveData();
                // Met à jour les champs calculés de cette pièce
                const qVP = pieceCard.querySelector('[data-piece-display="volumePiece"]');
                if (qVP) qVP.value = formatGrouped(piece.volumePiece, 3);
                const qSP = pieceCard.querySelector('[data-piece-display="surfacePiece"]');
                if (qSP) qSP.value = formatOneDecimal(piece.surfacePiece);
                const qPP = pieceCard.querySelector('[data-piece-display="prixPiece"]');
                if (qPP) qPP.value = formatGrouped(Math.round(piece.prixPiece || 0), 0);
                const qPA = pieceCard.querySelector('[data-piece-display="prixPieceAjuste"]');
                const isIgnored = !!(((lot.inspection || {}).integrite || {}).ignore);
                if (qPA) qPA.value = isIgnored ? '' : formatGrouped(Math.round(piece.prixPieceAjusteIntegrite || 0), 0);
                const masseD = this.formatMasseDisplay(piece.massePiece);
                const qMP = pieceCard.querySelector('[data-piece-display="massePiece"]');
                if (qMP) qMP.value = masseD.value;
                const qMPU = pieceCard.querySelector('[data-piece-display="massePieceUnit"]');
                if (qMPU) qMPU.textContent = masseD.unit;
                const pco2D = this.formatPco2Display(piece.carboneBiogeniqueEstime);
                const qCO2 = pieceCard.querySelector('[data-piece-display="carboneBiogeniqueEstime"]');
                if (qCO2) qCO2.value = pco2D.value;
                const qCO2U = pieceCard.querySelector('[data-piece-display="carboneBiogeniqueEstimeUnit"]');
                if (qCO2U) qCO2U.textContent = pco2D.unit;
                // Met à jour les totaux du lot dans la carte allotissement active
                this.updateActiveLotCardDisplays(lot);
            };

            // Boutons unité de prix pièce
            pieceCard.querySelectorAll('button[data-piece-price-unit]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nextUnit = (btn.dataset.piecePriceUnit || '').toLowerCase();
                    if (nextUnit !== 'ml' && nextUnit !== 'm2' && nextUnit !== 'm3') return;
                    piece.prixUnite = nextUnit;
                    pieceCard.querySelectorAll('button[data-piece-price-unit]').forEach((b) => {
                        b.setAttribute('aria-pressed', b.dataset.piecePriceUnit === nextUnit ? 'true' : 'false');
                    });
                    const unitDisp = pieceCard.querySelector('[data-piece-display="prixMarcheUnit"]');
                    if (unitDisp) unitDisp.textContent = '€/' + nextUnit;
                    updatePieceDisplays();
                });
            });

            // Branchement des inputs pièce
            pieceCard.querySelectorAll('input[data-piece-input]').forEach(input => {
                const updatePieceField = (e) => {
                    const field = e.target.dataset.pieceInput;
                    if (!field) return;

                    if (this.isAllotissementNumericField(field)) {
                        const normalized = this.normalizeAllotissementNumericInput(e.target.value);
                        piece[field] = normalized;
                        const shouldFormatDisplay = e.type === 'change' || e.type === 'blur' || !this.isCarbonPrixNumericField(field);
                        if (shouldFormatDisplay) {
                            e.target.value = this.formatAllotissementNumericDisplay(piece[field]);
                        }
                    } else {
                        piece[field] = e.target.value;
                    }

                    // Exclusion mutuelle diamètre/largeur-hauteur
                    if (field === 'diametre') {
                        const hasDiam = (piece.diametre || '') !== '';
                        if (hasDiam) {
                            piece.largeur = ''; piece.hauteur = '';
                            const lI = pieceCard.querySelector('input[data-piece-input="largeur"]');
                            const hI = pieceCard.querySelector('input[data-piece-input="hauteur"]');
                            if (lI) { lI.value = ''; if (lI.parentElement?.classList.contains('lot-dimension-input-wrap')) lI.parentElement.dataset.hasValue = 'false'; }
                            if (hI) { hI.value = ''; if (hI.parentElement?.classList.contains('lot-dimension-input-wrap')) hI.parentElement.dataset.hasValue = 'false'; }
                        }
                        const lField = pieceCard.querySelector('input[data-piece-input="largeur"]')?.closest('.lot-dimension-field');
                        const hField = pieceCard.querySelector('input[data-piece-input="hauteur"]')?.closest('.lot-dimension-field');
                        if (lField) lField.dataset.muted = hasDiam ? 'true' : 'false';
                        if (hField) hField.dataset.muted = hasDiam ? 'true' : 'false';
                    }

                    if (field === 'largeur' || field === 'hauteur') {
                        const hasLH = (piece.largeur || '') !== '' || (piece.hauteur || '') !== '';
                        if (hasLH) {
                            piece.diametre = '';
                            const dI = pieceCard.querySelector('input[data-piece-input="diametre"]');
                            if (dI) dI.value = '';
                        }
                        const dComp = pieceCard.querySelector('input[data-piece-input="diametre"]')?.closest('.lot-dimension-computed');
                        if (dComp) dComp.dataset.muted = hasLH ? 'true' : 'false';
                    }

                    // Synchronisation essence
                    if (field === 'essenceNomCommun') {
                        const nm = (piece.essenceNomCommun || '').toString().trim();
                        const match = this.findEssenceByCommonName(nm);
                        if (match) {
                            piece.essenceNomScientifique = match.nomScientifique;
                            const sci = pieceCard.querySelector('input[data-piece-input="essenceNomScientifique"]');
                            if (sci) sci.value = match.nomScientifique;
                        }
                    }
                    if (field === 'essenceNomScientifique') {
                        const nm = (piece.essenceNomScientifique || '').toString().trim();
                        const match = this.findEssenceByScientificName(nm);
                        if (match) {
                            piece.essenceNomCommun = match.nomUsuel;
                            const com = pieceCard.querySelector('input[data-piece-input="essenceNomCommun"]');
                            if (com) com.value = match.nomUsuel;
                        }
                    }

                    piece.essence = [
                        (piece.essenceNomCommun || '').toString().trim(),
                        (piece.essenceNomScientifique || '').toString().trim()
                    ].filter(Boolean).join(' - ');

                    updatePieceDisplays();
                };
                input.addEventListener('click', (e) => e.stopPropagation());
                input.addEventListener('focus', (e) => {
                    const field = e.target.dataset.pieceInput;
                    if (!field || !this.isAllotissementNumericField(field)) return;
                    e.target.value = this.normalizeAllotissementNumericInput(e.target.value);
                });
                input.addEventListener('input', updatePieceField);
                input.addEventListener('change', updatePieceField);
                input.addEventListener('blur', updatePieceField);
            });
        });
    }
        
renderInspection() {
    const section = document.getElementById('inspectionSection');
    const lotLabel = document.getElementById('inspectionActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';

    if (!currentLot.inspection) {
        currentLot.inspection = {
            visibilite: null,
            instrumentation: null,
            integrite: { niveau: null, ignore: false, coeff: null }
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? `Lot ${index + 1}` : 'Lot –';
    }

    this.updateInspectionSimple('visibilite', currentLot);
    this.updateInspectionSimple('instrumentation', currentLot);
    this.updateInspectionIntegrite(currentLot);
}

getInspectionToneFromLevel(level) {
    if (!level) return null;
    const normalized = String(level).toLowerCase();
    if (normalized === 'forte' || normalized === 'fort') return 'high';
    if (normalized === 'moyenne' || normalized === 'moyen') return 'mid';
    if (normalized === 'faible') return 'low';
    return null;
}

getNoteToneFromIntensity(intensityMap, intensity) {
    if (!intensityMap || intensity == null) return null;
    const values = Array.from(new Set(Object.values(intensityMap)
        .map((v) => parseFloat(v))
        .filter((v) => Number.isFinite(v))))
        .sort((a, b) => b - a);

    if (!values.length) return null;
    const value = parseFloat(intensity);
    if (!Number.isFinite(value)) return null;

    const max = values[0];
    const min = values[values.length - 1];

    if (value === max) return 'high';
    if (value === min) return 'low';
    return 'mid';
}

setRowNoteTone(row, tone) {
    if (!row) return;
    if (!tone) {
        delete row.dataset.noteTone;
        return;
    }
    row.dataset.noteTone = tone;
}

setRowNoteToneFromIntensity(row, intensityMap, intensity) {
    this.setRowNoteTone(row, this.getNoteToneFromIntensity(intensityMap, intensity));
}

getClientXFromEvent(event) {
    if (!event) return null;
    if (typeof event.clientX === 'number') return event.clientX;
    if (event.changedTouches && event.changedTouches.length && typeof event.changedTouches[0].clientX === 'number') {
        return event.changedTouches[0].clientX;
    }
    if (event.touches && event.touches.length && typeof event.touches[0].clientX === 'number') {
        return event.touches[0].clientX;
    }
    return null;
}

getSliderLevelFromEvent(slider, event, steps = 3) {
    if (!slider || !event) return null;
    const clientX = this.getClientXFromEvent(event);
    if (clientX == null) return null;
    const rect = slider.getBoundingClientRect();
    if (!rect.width) return null;
    const ratio = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    return Math.max(1, Math.min(steps, Math.round(ratio * (steps - 1)) + 1));
}

updateInspectionSimple(key, lot) {
    const section = document.getElementById('inspectionSection');
    if (!section) return;

    const row = section.querySelector(`.inspection-row[data-inspection-field="${key}"]`);
    if (!row) return;

    const slider       = row.querySelector('.inspection-slider');
    const valueBox     = row.querySelector(`.inspection-value-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.inspection-intensity-box[data-intensity="${key}"]`);
    const resetBtn     = row.querySelector('.inspection-reset-btn');
    const infoBtn      = row.querySelector('.inspection-info-small-btn');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const nameToLevel  = { forte: 1,   moyenne: 2,   faible: 3   };

    const stored = lot.inspection[key];
    const currentLevel = stored ? nameToLevel[stored] : null;

    // affichage initial
    if (valueBox) {
        valueBox.textContent = currentLevel ? levelToLabel[currentLevel] : '…';
    }
    if (intensityBox) {
        intensityBox.textContent = currentLevel ? '+' + String(currentLevel) : '…';
    }
    if (slider) {
        slider.value = currentLevel || 2;
    }
    row.classList.toggle('inspection-row--disabled', !currentLevel);
    this.setRowNoteTone(row, this.getInspectionToneFromLevel(stored));

    // réaction au slider
    if (slider) {
        const handleSliderChange = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];

            lot.inspection[key] =
                v === 1 ? 'forte' :
                v === 2 ? 'moyenne' :
                          'faible';

            if (valueBox)     valueBox.textContent = label;
            if (intensityBox) intensityBox.textContent = '+' + String(v);
            row.classList.remove('inspection-row--disabled');
            this.setRowNoteTone(row, this.getInspectionToneFromLevel(lot.inspection[key]));

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
        };

        const commitIfFirstInteraction = (event) => {
            if (!lot.inspection[key]) {
                const picked = this.getSliderLevelFromEvent(slider, event, 3);
                if (picked != null) {
                    slider.value = String(picked);
                }
                handleSliderChange({ target: slider });
            }
        };

        slider.oninput = handleSliderChange;
        slider.onchange = handleSliderChange;
        slider.onclick = commitIfFirstInteraction;
        slider.onpointerup = commitIfFirstInteraction;
        slider.ontouchend = commitIfFirstInteraction;
    }

    // bouton Réinitialiser
    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.inspection[key] = null;
            if (slider)       slider.value = 2;
            if (valueBox)     valueBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '…';
            row.classList.add('inspection-row--disabled');
            this.setRowNoteTone(row, null);

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
        };
    }

    // bouton info
    if (infoBtn) {
        infoBtn.onclick = () => this.openInspectionDetailModal(key);
    }
}

updateInspectionIntegrite(lot) {
    const section = document.getElementById('inspectionSection');
    if (!section) return;

    const row = section.querySelector('.inspection-row[data-inspection-field="integrite"]');
    if (!row) return;

    const slider   = row.querySelector('.inspection-slider');
    const valueBox = row.querySelector('.inspection-value-box[data-display="integrite"]');
    const coeffBox = row.querySelector('.inspection-intensity-box[data-intensity="integrite"]');
    const resetBtn = row.querySelector('.inspection-reset-btn');
    const ignoreBtn = row.querySelector('.inspection-ignore-btn');
    const infoBtn   = row.querySelector('.inspection-info-small-btn');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToCoeff = { 1: 0.7,    2: 0.3,       3: 0.1      };
    const nameToLevel  = { forte: 1,  moyenne: 2,   faible: 3   };

    if (!lot.inspection.integrite) {
        lot.inspection.integrite = { niveau: null, ignore: false, coeff: null };
    }
    const data = lot.inspection.integrite;
    const currentLevel = data.niveau ? nameToLevel[data.niveau] : null;

    const ignoreBox = row.querySelector('.inspection-ignore-box');

    const refreshUI = () => {
        if (data.ignore) {
            if (valueBox) valueBox.textContent = '…';
            if (coeffBox) coeffBox.textContent = 'Coeff. …';
            row.classList.add('inspection-row--disabled');
            row.classList.add('inspection-row--ignored');
            this.setRowNoteTone(row, null);
            if (ignoreBox) ignoreBox.textContent = 'Ignoré';
        } else if (data.niveau) {
            if (valueBox) {
                valueBox.textContent =
                    data.niveau === 'forte'   ? 'Forte'  :
                    data.niveau === 'moyenne' ? 'Moyenne':
                                                 'Faible';
            }
            if (coeffBox) {
                coeffBox.textContent = `Coeff. ${data.coeff.toString().replace('.', ',')}`;
            }
            row.classList.remove('inspection-row--disabled');
            row.classList.remove('inspection-row--ignored');
            this.setRowNoteTone(row, this.getInspectionToneFromLevel(data.niveau));
        } else {
            if (valueBox) valueBox.textContent = '…';
            if (coeffBox) coeffBox.textContent = 'Coeff. …';
            row.classList.add('inspection-row--disabled');
            row.classList.remove('inspection-row--ignored');
            this.setRowNoteTone(row, null);
        }
    };

    if (slider) {
        slider.value = currentLevel || 2;
        const handleIntegriteSliderChange = (e) => {
            const v = parseInt(e.target.value, 10);
            data.niveau = v === 1 ? 'forte' : v === 2 ? 'moyenne' : 'faible';
            data.coeff  = levelToCoeff[v];
            data.ignore = false;

            refreshUI();
            this.recalculateLotAllotissement(lot);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderAllotissement();
            this.renderEvalOp();
        };

        const commitIntegriteIfFirstInteraction = (event) => {
            if (!data.niveau || data.ignore) {
                const picked = this.getSliderLevelFromEvent(slider, event, 3);
                if (picked != null) {
                    slider.value = String(picked);
                }
                handleIntegriteSliderChange({ target: slider });
            }
        };

        slider.oninput = handleIntegriteSliderChange;
        slider.onchange = handleIntegriteSliderChange;
        slider.onclick = commitIntegriteIfFirstInteraction;
        slider.onpointerup = commitIntegriteIfFirstInteraction;
        slider.ontouchend = commitIntegriteIfFirstInteraction;
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            data.niveau = null;
            data.coeff  = null;
            data.ignore = false;
            if (slider) slider.value = 2;
            refreshUI();
            this.recalculateLotAllotissement(lot);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderAllotissement();
            this.renderEvalOp();
        };
    }

    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            data.ignore = true;
            data.niveau = null;
            data.coeff  = null;
            if (slider) slider.value = 2;
            refreshUI();
            this.recalculateLotAllotissement(lot);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderAllotissement();
            this.renderEvalOp();
        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openInspectionDetailModal('integrite');
    }

    refreshUI();
}

/* ---- Bio ---- */

renderBio() {
    const section  = document.getElementById('bioSection');
    const lotLabel = document.getElementById('bioActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.bio) {
        currentLot.bio = {
            purge: null,
            expansion: null,
            integriteBio: null,
            exposition: null,
            confianceBio: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = ['purge', 'expansion', 'integriteBio', 'exposition', 'confianceBio'];

    fields.forEach((key) => {
        const row = section.querySelector(`.bio-row[data-bio-field="${key}"]`);
        if (!row) return;
        this.updateBioRow(row, key, currentLot);
    });
}

updateBioRow(row, key, lot) {
    const slider         = row.querySelector('.bio-slider');
    const levelBox       = row.querySelector(`.bio-level-box[data-display="${key}"]`);
    const intensityBox   = row.querySelector(`.bio-intensity-box[data-intensity="${key}"]`);
    const resetBtn       = row.querySelector('.bio-reset-btn');
    const infoBtn        = row.querySelector('.bio-info-small-btn');
    const confianceTitle = row.querySelector('[data-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const intensityMaps = {
        purge:        { Forte: -3,  Moyenne:  1, Faible:  3 },
        expansion:    { Forte: -10, Moyenne: -3, Faible:  3 },
        integriteBio: { Forte:  3,  Moyenne:  1, Faible: -10 },
        exposition:   { Forte: -3,  Moyenne:  1, Faible:  3 },
        confianceBio: { Forte:  3,  Moyenne:  2, Faible:  1 }
    };

    const current = lot.bio[key];

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            val = current.niveau === 'Forte' ? 1
                : current.niveau === 'Moyenne' ? 2
                : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];
            const intensity = intensityMaps[key]
                ? (intensityMaps[key][label] != null ? intensityMaps[key][label] : null)
                : null;

            lot.bio[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? '+' : '';
                    intensityBox.textContent = sign + intensity;
                } else {
                    intensityBox.textContent = '...';
                }
            }

            row.classList.remove('bio-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceBio' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('bio-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('bio-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot();
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();
        };
    }

    if (levelBox) {
        levelBox.textContent = current && current.niveau ? current.niveau : '…';
    }
    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? '+' : '';
            intensityBox.textContent = sign + val;
        } else {
            intensityBox.textContent = '...';
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.bio[key] = null;
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            row.classList.add('bio-row--disabled');
            this.setRowNoteTone(row, null);

            if (key === 'confianceBio' && confianceTitle) {
                confianceTitle.classList.remove('bio-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot();
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();
        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openBioDetailModal(key);
    }

    if (!current) {
        row.classList.add('bio-row--disabled');
    } else {
        row.classList.remove('bio-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceBio' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('bio-label-confiance--low');
        } else {
            confianceTitle.classList.remove('bio-label-confiance--low');
        }
    }
}

    /* ---- Mech ---- */

renderMech() {
    const section = document.getElementById('mechSection');
    const lotLabel = document.getElementById('mechActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.mech) {
        currentLot.mech = {
            purgeMech: null,
            feuMech: null,
            integriteMech: null,
            expositionMech: null,
            confianceMech: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = ['purgeMech', 'feuMech', 'integriteMech', 'expositionMech', 'confianceMech'];

    fields.forEach((key) => {
        const row = section.querySelector(`.mech-row[data-mech-field="${key}"]`);
        if (!row) return;
        this.updateMechRow(row, key, currentLot);
    });

}

updateMechRow(row, key, lot) {
    const slider = row.querySelector('.mech-slider');
    const levelBox = row.querySelector(`.mech-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.mech-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.mech-reset-btn');
    const infoBtn = row.querySelector('.mech-info-small-btn');
    const confianceTitle = row.querySelector('[data-mech-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const intensityMaps = {
        purgeMech: { Forte: -3, Moyenne: 1, Faible: 3 },
        feuMech: { Forte: 3, Moyenne: 2, Faible: 1 },
        integriteMech: { Forte: 3, Moyenne: -3, Faible: -10 },
        expositionMech: { Forte: -3, Moyenne: 1, Faible: 3 },
        confianceMech: { Forte: 3, Moyenne: 2, Faible: 1 }
    };

    // Initialisation
    const current = lot.mech[key];
    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            val = current.niveau === 'Forte' ? 1 : (current.niveau === 'Moyenne' ? 2 : 3);
        }
        slider.value = val;

        // EVENEMENT SLIDER
        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];
            const score = intensityMaps[key][label];

            lot.mech[key] = { niveau: label, valeur: score };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) intensityBox.textContent = (score > 0 ? '+' : '') + score;
            
            row.classList.remove('mech-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], score);
            
            this.saveData();
            // SECURITÉ : Utiliser "lot" (le paramètre) ou "activeLot"
            const activeLot = this.getCurrentLot();
            if (activeLot) this.computeOrientation(activeLot);
        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val;   // juste la note
        } else {
            intensityBox.textContent = "...";        // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.mech[key] = null;
            row.classList.add('mech-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceMech' && confianceTitle) {
                confianceTitle.classList.remove('mech-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openMechDetailModal(key);
    }

    if (!current) {
        row.classList.add('mech-row--disabled');
    } else {
        row.classList.remove('mech-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceMech' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('mech-label-confiance--low');
        } else {
            confianceTitle.classList.remove('mech-label-confiance--low');
        }
    }
}    

    /* ---- Usage ---- */

renderUsage(){
    const section = document.getElementById('usageSection');
    const lotLabel = document.getElementById('usageActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.usage) {
        currentLot.usage = {
            confianceUsage: null,
            durabiliteUsage: null,
            classementUsage: null,
            humiditeUsage: null,
            aspectUsage: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'confianceUsage',
        'durabiliteUsage',
        'classementUsage',
        'humiditeUsage',
        'aspectUsage'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.usage-row[data-usage-field="${key}"]`);
        if (!row) return;
        this.updateUsageRow(row, key, currentLot);
    });
}

updateUsageRow(row, key, lot) {
    const slider = row.querySelector('.usage-slider');
    const levelBox = row.querySelector(`.usage-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.usage-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.usage-reset-btn');
    const infoBtn = row.querySelector('.usage-info-small-btn');
    const confianceTitle = row.querySelector('[data-usage-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToLabelFM = { 1: 'Fort', 2: 'Moyen', 3: 'Faible' }; // pour les champs "Fort/Moyen/Faible"

    const intensityMaps = {
        confianceUsage: { Forte: 3, Moyenne: 2, Faible: 1 },
        durabiliteUsage: { Forte: 3, Moyenne: 2, Faible: 1 },
        classementUsage: { Fort: 3, Moyen: 2, Faible: 1 },
        humiditeUsage: { Forte: -3, Moyenne: 3, Faible: 1 },
        aspectUsage: { Fort: 3, Moyen: 2, Faible: 1 }
    };

    const current = lot.usage[key];

    const isFortMoyenFaible = key === 'classementUsage' || key === 'aspectUsage';

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = lbl === 'Forte' || lbl === 'Fort' ? 1 :
                  lbl === 'Moyenne' || lbl === 'Moyen' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = isFortMoyenFaible ? levelToLabelFM[v] : levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.usage[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
  if (intensity != null) {
    const sign = intensity > 0 ? "+" : "";
    intensityBox.textContent = sign + intensity; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }
} 
    row.classList.remove('usage-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceUsage' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('usage-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('usage-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
  if (current && current.valeur != null) {
    const val = current.valeur;
    const sign = val > 0 ? "+" : "";
    intensityBox.textContent = sign + val; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }
}


    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.usage[key] = null;
            row.classList.add('usage-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceUsage' && confianceTitle) {
                confianceTitle.classList.remove('usage-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openUsageDetailModal(key);
    }

    if (!current) {
        row.classList.add('usage-row--disabled');
    } else {
        row.classList.remove('usage-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceUsage' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('usage-label-confiance--low');
        } else {
            confianceTitle.classList.remove('usage-label-confiance--low');
        }
    }
}

    /* ---- Dénaturation ---- */

renderDenat() {
    const section = document.getElementById('denatSection');
    const lotLabel = document.getElementById('denatActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.denat) {
        currentLot.denat = {
            depollutionDenat: null,
            contaminationDenat: null,
            durabiliteConfDenat: null,
            confianceDenat: null,
            naturaliteDenat: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'depollutionDenat',
        'contaminationDenat',
        'durabiliteConfDenat',
        'confianceDenat',
        'naturaliteDenat'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.denat-row[data-denat-field="${key}"]`);
        if (!row) return;
        this.updateDenatRow(row, key, currentLot);
    });
}

updateDenatRow(row, key, lot) {
    const slider = row.querySelector('.denat-slider');
    const levelBox = row.querySelector(`.denat-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.denat-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.denat-reset-btn');
    const infoBtn = row.querySelector('.denat-info-small-btn');
    const confianceTitle = row.querySelector('[data-denat-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToLabelFM = { 1: 'Fort', 2: 'Moyen', 3: 'Faible' };

    const intensityMaps = {
        depollutionDenat: { Forte: -3, Moyenne: 1, Faible: 3 },
        contaminationDenat: { Forte: -10, Moyenne: 1, Faible: 3 },
        durabiliteConfDenat: { Forte: 1, Moyenne: 2, Faible: 3 },
        confianceDenat: { Forte: 3, Moyenne: 2, Faible: 1 },
        naturaliteDenat: { Forte: 3, Moyenne: 2, Faible: 1 }
    };

    const current = lot.denat[key];
    const isFortMoyenFaible = key === 'durabiliteConfDenat';

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = lbl === 'Forte' || lbl === 'Fort' ? 1 :
                  lbl === 'Moyenne' || lbl === 'Moyen' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = isFortMoyenFaible ? levelToLabelFM[v] : levelToLabel[v];
            const map = intensityMaps[key];
            const mapLabel = levelToLabel[v];
            const intensity = map && map[mapLabel] != null ? map[mapLabel] : null;

            lot.denat[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? "+" : "";
                    intensityBox.textContent = sign + intensity;   // juste la note
                } else {
                    intensityBox.textContent = "...";        // note en attente
                }
            }

            row.classList.remove('denat-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceDenat' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('denat-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('denat-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
  if (current && current.valeur != null) {
    const val = current.valeur;
    const sign = val > 0 ? "+" : "";
    intensityBox.textContent = sign + val; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }
}


    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.denat[key] = null;
            row.classList.add('denat-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceDenat' && confianceTitle) {
                confianceTitle.classList.remove('denat-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openDenatDetailModal(key);
    }

    if (!current) {
        row.classList.add('denat-row--disabled');
    } else {
        row.classList.remove('denat-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceDenat' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('denat-label-confiance--low');
        } else {
            confianceTitle.classList.remove('denat-label-confiance--low');
        }
    }
}

    /* ---- Débit ---- */

renderDebit() {
    const section = document.getElementById('debitSection');
    const lotLabel = document.getElementById('debitActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.debit) {
        currentLot.debit = {
            regulariteDebit: null,
            volumetrieDebit: null,
            stabiliteDebit: null,
            artisanaliteDebit: null,
            rusticiteDebit: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'regulariteDebit',
        'volumetrieDebit',
        'stabiliteDebit',
        'artisanaliteDebit',
        'rusticiteDebit'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.debit-row[data-debit-field="${key}"]`);
        if (!row) return;
        this.updateDebitRow(row, key, currentLot);
    });
}

updateDebitRow(row, key, lot) {
    const slider = row.querySelector('.debit-slider');
    const levelBox = row.querySelector(`.debit-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.debit-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.debit-reset-btn');
    const infoBtn = row.querySelector('.debit-info-small-btn');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };

    const intensityMaps = {
        regulariteDebit: { Forte: 3, Moyenne: 2, Faible: 1 },
        volumetrieDebit: { Forte: 3, Moyenne: 2, Faible: 1 },
        stabiliteDebit: { Forte: 3, Moyenne: 2, Faible: 1 },
        artisanaliteDebit: { Forte: 3, Moyenne: 2, Faible: 1 },
        rusticiteDebit: { Forte: 3, Moyenne: 2, Faible: 1 }
    };

    const current = lot.debit[key];
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = lbl === 'Forte' ? 1 : lbl === 'Moyenne' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.debit[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
  if (intensity != null) {
    const sign = intensity > 0 ? "+" : "";
    intensityBox.textContent = sign + intensity; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }
   
            row.classList.remove('debit-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
  if (current && current.valeur != null) {
    const val = current.valeur;
    const sign = val > 0 ? "+" : "";
    intensityBox.textContent = sign + val; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }
    }



    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.debit[key] = null;
            row.classList.add('debit-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openDebitDetailModal(key);
    }

    if (!current) {
        row.classList.add('debit-row--disabled');
    } else {
        row.classList.remove('debit-row--disabled');
    }
}
}

updateProvenanceRow(row, key, lot) {
    const slider = row.querySelector('.provenance-slider');
    const levelBox = row.querySelector(`.provenance-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.provenance-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.provenance-reset-btn');
    const infoBtn = row.querySelector('.provenance-info-small-btn');
    const confianceTitle = row.querySelector('[data-provenance-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToLabelFM = { 1: 'Fort', 2: 'Moyen', 3: 'Faible' };

    const intensityMaps = {
        confianceProv: { Forte: 3, Moyenne: 2, Faible: 1 },
        transportProv: { Fort: -3, Moyen: 1, Faible: 3 },
        reputationProv: { Forte: 3, Moyenne: 2, Faible: 1 },
        macroProv: { Forte: 3, Moyenne: 2, Faible: 1 },
        territorialiteProv: { Forte: 3, Moyenne: 2, Faible: 1 }
    };
    
    const current = lot.provenance[key];
    const useFM = key === 'transportProv';

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val =
                lbl === 'Forte' || lbl === 'Fort' ? 1 :
                lbl === 'Moyenne' || lbl === 'Moyen' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = useFM ? levelToLabelFM[v] : levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.provenance[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
  if (intensity != null) {
    const sign = intensity > 0 ? "+" : "";
    intensityBox.textContent = sign + intensity; // juste la note
  } else {
    intensityBox.textContent = "..."; // note en attente
  }

    row.classList.remove('provenance-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceProv' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('provenance-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('provenance-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();

        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val; // juste la note
        } else {
            intensityBox.textContent = "..."; // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.provenance[key] = null;
            row.classList.add('provenance-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceProv' && confianceTitle) {
                confianceTitle.classList.remove('provenance-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openProvenanceDetailModal(key);
    }

    if (!current) {
        row.classList.add('provenance-row--disabled');
    } else {
        row.classList.remove('provenance-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceProv' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('provenance-label-confiance--low');
        } else {
            confianceTitle.classList.remove('provenance-label-confiance--low');
        }
    }
}
}
/* ---- Géométrie ---- */

renderGeo() {
    const section = document.getElementById('geoSection');
    const lotLabel = document.getElementById('geoActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.geo) {
        currentLot.geo = {
            adaptabiliteGeo: null,
            massiviteGeo: null,
            deformationGeo: null,
            industrialiteGeo: null,
            inclusiviteGeo: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'adaptabiliteGeo',
        'massiviteGeo',
        'deformationGeo',
        'industrialiteGeo',
        'inclusiviteGeo'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.geo-row[data-geo-field="${key}"]`);
        if (!row) return;
        this.updateGeoRow(row, key, currentLot);
    });
}
updateGeoRow(row, key, lot) {
    const slider = row.querySelector('.geo-slider');
    const levelBox = row.querySelector(`.geo-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.geo-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.geo-reset-btn');
    const infoBtn = row.querySelector('.geo-info-small-btn');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };

    const intensityMaps = {
        adaptabiliteGeo: { Forte: 3, Moyenne: 2, Faible: 1 },
        massiviteGeo: { Forte: 3, Moyenne: 2, Faible: 1 },
        deformationGeo: { Forte: -3, Moyenne: 1, Faible: 3 },
        industrialiteGeo: { Forte: 3, Moyenne: 2, Faible: 1 },
        inclusiviteGeo: { Forte: 3, Moyenne: 2, Faible: 1 }
    };

    const current = lot.geo[key];

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = lbl === 'Forte' ? 1 : lbl === 'Moyenne' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.geo[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? "+" : "";
                    intensityBox.textContent = sign + intensity; // juste la note
                } else {
                    intensityBox.textContent = "..."; // note en attente
                }
            }

            row.classList.remove('geo-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();
        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val; // juste la note
        } else {
            intensityBox.textContent = "..."; // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.geo[key] = null;
            row.classList.add('geo-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openGeoDetailModal(key);
    }

    if (!current) {
        row.classList.add('geo-row--disabled');
    } else {
        row.classList.remove('geo-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);
}


renderEssence() {
    const section = document.getElementById('essenceSection');
    const lotLabel = document.getElementById('essenceActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.essence) {
        currentLot.essence = {
            confianceEssence: null,
            rareteEcoEssence: null,
            masseVolEssence: null,
            rareteHistEssence: null,
            singulariteEssence: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'confianceEssence',
        'rareteEcoEssence',
        'masseVolEssence',
        'rareteHistEssence',
        'singulariteEssence'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.essence-row[data-essence-field="${key}"]`);
        if (!row) return;
        this.updateEssenceRow(row, key, currentLot);
    });
}
updateEssenceRow(row, key, lot) {
    const slider = row.querySelector('.essence-slider');
    const levelBox = row.querySelector(`.essence-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.essence-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.essence-reset-btn');
    const infoBtn = row.querySelector('.essence-info-small-btn');
    const confianceTitle = row.querySelector('[data-essence-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };

    const intensityMaps = {
        confianceEssence: { Forte: 3, Moyenne: 2, Faible: 1 },
        rareteEcoEssence: { Forte: 3, Moyenne: 2, Faible: 1 },
        masseVolEssence: { Forte: 3, Moyenne: 2, Faible: 1 },
        rareteHistEssence: { Forte: 3, Moyenne: 2, Faible: 1 },
        singulariteEssence: { Forte: 3, Moyenne: 2, Faible: 1 }
    };

    const current = lot.essence[key];

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = lbl === 'Forte' ? 1 : lbl === 'Moyenne' ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.essence[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? "+" : "";
                    intensityBox.textContent = sign + intensity; // juste la note
                } else {
                    intensityBox.textContent = "..."; // note en attente
                }
            }

            row.classList.remove('essence-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceEssence' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('essence-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('essence-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();
        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val; // juste la note
        } else {
            intensityBox.textContent = "..."; // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.essence[key] = null;
            row.classList.add('essence-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceEssence' && confianceTitle) {
                confianceTitle.classList.remove('essence-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openEssenceDetailModal(key);
    }

    if (!current) {
        row.classList.add('essence-row--disabled');
    } else {
        row.classList.remove('essence-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceEssence' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('essence-label-confiance--low');
        } else {
            confianceTitle.classList.remove('essence-label-confiance--low');
        }
    }
}

renderAncien() {
    const section = document.getElementById('ancienSection');
    const lotLabel = document.getElementById('ancienActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.ancien) {
        currentLot.ancien = {
            confianceAncien: null,
            amortissementAncien: null,
            vieillissementAncien: null,
            microhistoireAncien: null,
            demontabiliteAncien: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'confianceAncien',
        'amortissementAncien',
        'vieillissementAncien',
        'microhistoireAncien',
        'demontabiliteAncien'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.ancien-row[data-ancien-field="${key}"]`);
        if (!row) return;
        this.updateAncienRow(row, key, currentLot);
    });
}
updateAncienRow(row, key, lot) {
    const slider = row.querySelector('.ancien-slider');
    const levelBox = row.querySelector(`.ancien-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.ancien-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.ancien-reset-btn');
    const infoBtn = row.querySelector('.ancien-info-small-btn');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToLabelFM = { 1: 'Fort', 2: 'Moyen', 3: 'Faible' };

    const intensityMaps = {
        confianceAncien: { Forte: 3, Moyenne: 2, Faible: 1 },
        amortissementAncien: { Fort: 3, Moyen: 1, Faible: -3 },
        vieillissementAncien: { Forte: -3, Moyenne: 1, Faible: 3 },
        microhistoireAncien: { Forte: 3, Moyenne: 2, Faible: 1 },
        demontabiliteAncien: { Forte: 3, Moyenne: 2, Faible: -3 }
    };

    const current = lot.ancien[key];
    const useFM = key === 'amortissementAncien';

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val = (lbl === 'Forte' || lbl === 'Fort') ? 1 :
                  (lbl === 'Moyenne' || lbl === 'Moyen') ? 2 : 3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            const label = useFM ? levelToLabelFM[v] : levelToLabel[v];
            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.ancien[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? "+" : "";
                    intensityBox.textContent = sign + intensity; // juste la note
                } else {
                    intensityBox.textContent = "..."; // note en attente
                }
            }

            row.classList.remove('ancien-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();
        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val; // juste la note
        } else {
            intensityBox.textContent = "..."; // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.ancien[key] = null;
            row.classList.add('ancien-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);
            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openAncienDetailModal(key);
    }

    if (!current) {
        row.classList.add('ancien-row--disabled');
    } else {
        row.classList.remove('ancien-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);
}

    /* ---- Traces ---- */

renderTraces() {
    const section = document.getElementById('tracesSection');
    const lotLabel = document.getElementById('tracesActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.traces) {
        currentLot.traces = {
            confianceTraces: null,
            etiquetageTraces: null,
            alterationTraces: null,
            documentationTraces: null,
            singularitesTraces: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'confianceTraces',
        'etiquetageTraces',
        'alterationTraces',
        'documentationTraces',
        'singularitesTraces'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.traces-row[data-traces-field="${key}"]`);
        if (!row) return;
        this.updateTracesRow(row, key, currentLot);
    });
}
updateTracesRow(row, key, lot) {
    const slider = row.querySelector('.traces-slider');
    const levelBox = row.querySelector(`.traces-level-box[data-display="${key}"]`);
    const intensityBox = row.querySelector(`.traces-intensity-box[data-intensity="${key}"]`);
    const resetBtn = row.querySelector('.traces-reset-btn');
    const infoBtn = row.querySelector('.traces-info-small-btn');
    const confianceTitle = row.querySelector('[data-traces-confiance-title]');

    const levelToLabel = { 1: 'Forte', 2: 'Moyenne', 3: 'Faible' };
    const levelToLabelPlural = { 1: 'Fortes', 2: 'Moyennes', 3: 'Faibles' };

    const intensityMaps = {
        confianceTraces: { Forte: 3, Moyenne: 2, Faible: 1 },
        etiquetageTraces: { Fort: 3, Moyen: 2, Faible: 1 },
        alterationTraces: { Forte: -10, Moyenne: 1, Faible: 3 },
        documentationTraces: { Forte: 3, Moyenne: 1, Faible: -3 },
        singularitesTraces: { Fortes: 3, Moyennes: 2, Faibles: 1 }
    };

    const current = lot.traces[key];

    const useFM = key === 'etiquetageTraces';
    const usePlural = key === 'singularitesTraces';

    if (slider) {
        let val = 2;
        if (current && current.niveau) {
            const lbl = current.niveau;
            val =
                lbl === 'Forte' || lbl === 'Fort' || lbl === 'Fortes' ? 1 :
                lbl === 'Moyenne' || lbl === 'Moyen' || lbl === 'Moyennes' ? 2 :
                3;
        }
        slider.value = val;

        slider.oninput = (e) => {
            const v = parseInt(e.target.value, 10);
            let label;
            if (usePlural) {
                label = levelToLabelPlural[v];
            } else if (useFM) {
                label = v === 1 ? 'Fort' : v === 2 ? 'Moyen' : 'Faible';
            } else {
                label = levelToLabel[v];
            }

            const map = intensityMaps[key] || {};
            const intensity = map[label] != null ? map[label] : null;

            lot.traces[key] = { niveau: label, valeur: intensity };

            if (levelBox) levelBox.textContent = label;
            if (intensityBox) {
                if (intensity != null) {
                    const sign = intensity > 0 ? "+" : "";
                    intensityBox.textContent = sign + intensity; // juste la note
                } else {
                    intensityBox.textContent = "..."; // note en attente
                }
            }

            row.classList.remove('traces-row--disabled');
            this.setRowNoteToneFromIntensity(row, intensityMaps[key], intensity);

            if (key === 'confianceTraces' && confianceTitle) {
                if (label === 'Faible') {
                    confianceTitle.classList.add('traces-label-confiance--low');
                } else {
                    confianceTitle.classList.remove('traces-label-confiance--low');
                }
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }
            this.renderSeuils();
            this.renderEvalOp();

        };
    }

    if (levelBox) {
        if (current && current.niveau) {
            levelBox.textContent = current.niveau;
        } else {
            levelBox.textContent = '…';
        }
    }

    if (intensityBox) {
        if (current && current.valeur != null) {
            const val = current.valeur;
            const sign = val > 0 ? "+" : "";
            intensityBox.textContent = sign + val; // juste la note
        } else {
            intensityBox.textContent = "..."; // note en attente
        }
    }

    if (resetBtn) {
        resetBtn.onclick = () => {
            lot.traces[key] = null;
            row.classList.add('traces-row--disabled');
            if (slider) slider.value = 2;
            if (levelBox) levelBox.textContent = '…';
            if (intensityBox) intensityBox.textContent = '...';
            this.setRowNoteTone(row, null);

            if (key === 'confianceTraces' && confianceTitle) {
                confianceTitle.classList.remove('traces-label-confiance--low');
            }

            this.saveData();
            const activeLot = this.getCurrentLot(); // On récupère le lot actuel
            if (activeLot) {
                this.computeOrientation(activeLot);
            }

        };
    }

    if (infoBtn) {
        infoBtn.onclick = () => this.openTracesDetailModal(key);
    }

    if (!current) {
        row.classList.add('traces-row--disabled');
    } else {
        row.classList.remove('traces-row--disabled');
    }
    this.setRowNoteToneFromIntensity(row, intensityMaps[key], current && current.valeur != null ? current.valeur : null);

    if (key === 'confianceTraces' && confianceTitle) {
        if (current && current.niveau === 'Faible') {
            confianceTitle.classList.add('traces-label-confiance--low');
        } else {
            confianceTitle.classList.remove('traces-label-confiance--low');
        }
    }
}

renderProvenance() {
    const section = document.getElementById('provenanceSection');
    const lotLabel = document.getElementById('provenanceActiveLotLabel');
    const currentLot = this.getCurrentLot();

    if (!section) return;

    if (!currentLot) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    if (!currentLot.provenance) {
        currentLot.provenance = {
            confianceProv: null,
            transportProv: null,
            reputationProv: null,
            macroProv: null,
            territorialiteProv: null
        };
    }

    if (lotLabel) {
        const index = this.data.lots.indexOf(currentLot);
        lotLabel.textContent = index >= 0 ? 'Lot ' + (index + 1) : 'Lot …';
    }

    const fields = [
        'confianceProv',
        'transportProv',
        'reputationProv',
        'macroProv',
        'territorialiteProv'
    ];

    fields.forEach((key) => {
        const row = section.querySelector(`.provenance-row[data-provenance-field="${key}"]`);
        if (!row) return;
        this.updateProvenanceRow(row, key, currentLot);
    });
}

    /* ---- Calculs valeurs + Seuils ---- */

getRawValueScoresForLot(lot) {
    const totals = { economique: 0, ecologique: 0, mecanique: 0, historique: 0, esthetique: 0 };
    if (!lot) return totals;

    const getVal = (entry) => {
        if (!entry) return 0;
        if (typeof entry === 'number') return entry;
        if (typeof entry === 'object') return parseFloat(entry.valeur) || 0;
        return 0;
    };

    const mapping = [
        ['bio',        'purge',               'economique'],
        ['bio',        'expansion',           'ecologique'],
        ['bio',        'integriteBio',        'mecanique'],
        ['bio',        'exposition',          'historique'],
        ['bio',        'confianceBio',        'esthetique'],

        ['mech',       'purgeMech',           'economique'],
        ['mech',       'feuMech',             'ecologique'],
        ['mech',       'integriteMech',       'mecanique'],
        ['mech',       'expositionMech',      'historique'],
        ['mech',       'confianceMech',       'esthetique'],

        ['usage',      'confianceUsage',      'economique'],
        ['usage',      'durabiliteUsage',     'ecologique'],
        ['usage',      'classementUsage',     'mecanique'],
        ['usage',      'humiditeUsage',       'historique'],
        ['usage',      'aspectUsage',         'esthetique'],

        ['denat',      'depollutionDenat',    'economique'],
        ['denat',      'contaminationDenat',  'ecologique'],
        ['denat',      'durabiliteConfDenat', 'mecanique'],
        ['denat',      'confianceDenat',      'historique'],
        ['denat',      'naturaliteDenat',     'esthetique'],

        ['debit',      'regulariteDebit',     'economique'],
        ['debit',      'volumetrieDebit',     'ecologique'],
        ['debit',      'stabiliteDebit',      'mecanique'],
        ['debit',      'artisanaliteDebit',   'historique'],
        ['debit',      'rusticiteDebit',      'esthetique'],

        ['geo',        'adaptabiliteGeo',     'economique'],
        ['geo',        'massiviteGeo',        'ecologique'],
        ['geo',        'deformationGeo',      'mecanique'],
        ['geo',        'industrialiteGeo',    'historique'],
        ['geo',        'inclusiviteGeo',      'esthetique'],

        ['essence',    'confianceEssence',    'economique'],
        ['essence',    'rareteEcoEssence',    'ecologique'],
        ['essence',    'masseVolEssence',     'mecanique'],
        ['essence',    'rareteHistEssence',   'historique'],
        ['essence',    'singulariteEssence',  'esthetique'],

        ['ancien',     'confianceAncien',     'economique'],
        ['ancien',     'amortissementAncien', 'ecologique'],
        ['ancien',     'vieillissementAncien','mecanique'],
        ['ancien',     'microhistoireAncien', 'historique'],
        ['ancien',     'demontabiliteAncien', 'esthetique'],

        ['traces',     'confianceTraces',     'economique'],
        ['traces',     'etiquetageTraces',    'ecologique'],
        ['traces',     'alterationTraces',    'mecanique'],
        ['traces',     'documentationTraces', 'historique'],
        ['traces',     'singularitesTraces',  'esthetique'],

        ['provenance', 'confianceProv',       'economique'],
        ['provenance', 'transportProv',       'ecologique'],
        ['provenance', 'reputationProv',      'mecanique'],
        ['provenance', 'macroProv',           'historique'],
        ['provenance', 'territorialiteProv',  'esthetique']
    ];

    mapping.forEach(([section, field, category]) => {
        const sectionData = lot[section];
        if (!sectionData) return;
        totals[category] += getVal(sectionData[field]);
    });

    // Compatibilité avec un ancien format basé sur lot.criteres
    if (Array.isArray(lot.criteres)) {
        lot.criteres.forEach((c) => {
            const note = parseFloat(c && c.note) || 0;
            const category = c && c.valeur;
            if (Object.prototype.hasOwnProperty.call(totals, category)) {
                totals[category] += note;
            }
        });
    }

    return totals;
}

getValueScoresForLot(lot) {
    const totals = this.getRawValueScoresForLot(lot);
    Object.keys(totals).forEach((k) => {
        if (totals[k] < 0) totals[k] = 0;
    });
    return totals;
}  

hasAnyNotationForLot(lot) {
    if (!lot) return false;

    const mapping = [
        ['bio',        'purge'],
        ['bio',        'expansion'],
        ['bio',        'integriteBio'],
        ['bio',        'exposition'],
        ['bio',        'confianceBio'],

        ['mech',       'purgeMech'],
        ['mech',       'feuMech'],
        ['mech',       'integriteMech'],
        ['mech',       'expositionMech'],
        ['mech',       'confianceMech'],

        ['usage',      'confianceUsage'],
        ['usage',      'durabiliteUsage'],
        ['usage',      'classementUsage'],
        ['usage',      'humiditeUsage'],
        ['usage',      'aspectUsage'],

        ['denat',      'depollutionDenat'],
        ['denat',      'contaminationDenat'],
        ['denat',      'durabiliteConfDenat'],
        ['denat',      'confianceDenat'],
        ['denat',      'naturaliteDenat'],

        ['debit',      'regulariteDebit'],
        ['debit',      'volumetrieDebit'],
        ['debit',      'stabiliteDebit'],
        ['debit',      'artisanaliteDebit'],
        ['debit',      'rusticiteDebit'],

        ['geo',        'adaptabiliteGeo'],
        ['geo',        'massiviteGeo'],
        ['geo',        'deformationGeo'],
        ['geo',        'industrialiteGeo'],
        ['geo',        'inclusiviteGeo'],

        ['essence',    'confianceEssence'],
        ['essence',    'rareteEcoEssence'],
        ['essence',    'masseVolEssence'],
        ['essence',    'rareteHistEssence'],
        ['essence',    'singulariteEssence'],

        ['ancien',     'confianceAncien'],
        ['ancien',     'amortissementAncien'],
        ['ancien',     'vieillissementAncien'],
        ['ancien',     'microhistoireAncien'],
        ['ancien',     'demontabiliteAncien'],

        ['traces',     'confianceTraces'],
        ['traces',     'etiquetageTraces'],
        ['traces',     'alterationTraces'],
        ['traces',     'documentationTraces'],
        ['traces',     'singularitesTraces'],

        ['provenance', 'confianceProv'],
        ['provenance', 'transportProv'],
        ['provenance', 'reputationProv'],
        ['provenance', 'macroProv'],
        ['provenance', 'territorialiteProv']
    ];

    for (const [section, field] of mapping) {
        const sectionData = lot[section];
        if (!sectionData) continue;
        const entry = sectionData[field];
        if (!entry) continue;

        if (typeof entry === 'number') return true;
        if (typeof entry === 'object' && entry.valeur != null) return true;
    }

    if (Array.isArray(lot.criteres) && lot.criteres.length > 0) return true;
    return false;
}

hasNotationForCategory(lot, category) {
    if (!lot) return false;

    const mapping = [
        ['bio',        'purge',               'economique'],
        ['bio',        'expansion',           'ecologique'],
        ['bio',        'integriteBio',        'mecanique'],
        ['bio',        'exposition',          'historique'],
        ['bio',        'confianceBio',        'esthetique'],

        ['mech',       'purgeMech',           'economique'],
        ['mech',       'feuMech',             'ecologique'],
        ['mech',       'integriteMech',       'mecanique'],
        ['mech',       'expositionMech',      'historique'],
        ['mech',       'confianceMech',       'esthetique'],

        ['usage',      'confianceUsage',      'economique'],
        ['usage',      'durabiliteUsage',     'ecologique'],
        ['usage',      'classementUsage',     'mecanique'],
        ['usage',      'humiditeUsage',       'historique'],
        ['usage',      'aspectUsage',         'esthetique'],

        ['denat',      'depollutionDenat',    'economique'],
        ['denat',      'contaminationDenat',  'ecologique'],
        ['denat',      'durabiliteConfDenat', 'mecanique'],
        ['denat',      'confianceDenat',      'historique'],
        ['denat',      'naturaliteDenat',     'esthetique'],

        ['debit',      'regulariteDebit',     'economique'],
        ['debit',      'volumetrieDebit',     'ecologique'],
        ['debit',      'stabiliteDebit',      'mecanique'],
        ['debit',      'artisanaliteDebit',   'historique'],
        ['debit',      'rusticiteDebit',      'esthetique'],

        ['geo',        'adaptabiliteGeo',     'economique'],
        ['geo',        'massiviteGeo',        'ecologique'],
        ['geo',        'deformationGeo',      'mecanique'],
        ['geo',        'industrialiteGeo',    'historique'],
        ['geo',        'inclusiviteGeo',      'esthetique'],

        ['essence',    'confianceEssence',    'economique'],
        ['essence',    'rareteEcoEssence',    'ecologique'],
        ['essence',    'masseVolEssence',     'mecanique'],
        ['essence',    'rareteHistEssence',   'historique'],
        ['essence',    'singulariteEssence',  'esthetique'],

        ['ancien',     'confianceAncien',     'economique'],
        ['ancien',     'amortissementAncien', 'ecologique'],
        ['ancien',     'vieillissementAncien','mecanique'],
        ['ancien',     'microhistoireAncien', 'historique'],
        ['ancien',     'demontabiliteAncien', 'esthetique'],

        ['traces',     'confianceTraces',     'economique'],
        ['traces',     'etiquetageTraces',    'ecologique'],
        ['traces',     'alterationTraces',    'mecanique'],
        ['traces',     'documentationTraces', 'historique'],
        ['traces',     'singularitesTraces',  'esthetique'],

        ['provenance', 'confianceProv',       'economique'],
        ['provenance', 'transportProv',       'ecologique'],
        ['provenance', 'reputationProv',      'mecanique'],
        ['provenance', 'macroProv',           'historique'],
        ['provenance', 'territorialiteProv',  'esthetique']
    ];

    for (const [section, field, mappedCategory] of mapping) {
        if (mappedCategory !== category) continue;
        const entry = lot[section] && lot[section][field];
        if (!entry) continue;
        if (typeof entry === 'number') return true;
        if (typeof entry === 'object' && entry.valeur != null) return true;
    }

    if (Array.isArray(lot.criteres)) {
        for (const critere of lot.criteres) {
            const value = parseFloat(critere && critere.note);
            if (critere && critere.valeur === category && !Number.isNaN(value)) {
                return true;
            }
        }
    }

    return false;
}

renderSeuils() {
    const lot = this.getCurrentLot();
    if (!lot) return; // Sécurité si aucun lot

    const seuilsLotLabel = document.getElementById('seuilsActiveLotLabel');
    const lots = this.data.lots || [];
    const lotIndex = lots.indexOf(lot);
    if (seuilsLotLabel) {
        const defaultName = lotIndex >= 0 ? 'Lot ' + (lotIndex + 1) : 'Lot …';
        const lotName = (lot.nom || '').trim();
        seuilsLotLabel.textContent = lotName ? lotName : defaultName;
    }
    
    const rawScores = this.getRawValueScoresForLot(lot);
    const scores = this.getValueScoresForLot(lot);
    const hasNotation = this.hasAnyNotationForLot(lot);
    const root = document.getElementById('seuils-section');
    if (!root) return;

    const categories = [
        { key: 'economique', label: 'Économique' },
        { key: 'ecologique', label: 'Écologique' },
        { key: 'mecanique', label: 'Mécanique' },
        { key: 'historique', label: 'Historique' },
        { key: 'esthetique', label: 'Esthétique' }
    ];

    categories.forEach(cat => {
        const rawScore = rawScores[cat.key] || 0;
        const score = scores[cat.key] || 0;
        const hasCategoryNotation = this.hasNotationForCategory(lot, cat.key);
        const isAlertState = hasCategoryNotation && rawScore <= 0;
        // Le score max est de 30 (10 critères x 3 points max)
        const percent = Math.min(100, Math.round((score / 30) * 100));
        
        // Mise à jour du pourcentage
        const pctEl = root.querySelector(`[data-seuils-percent="${cat.key}"]`);
        if (pctEl) pctEl.textContent = hasNotation ? `${percent}%` : "…";

        // Mise à jour du score numérique
        const scoreEl = root.querySelector(`[data-seuils-score="${cat.key}"]`);
        if (scoreEl) scoreEl.textContent = hasNotation ? `${score} / 30` : "…";

        // Mise à jour de la jauge canvas
        const gauge = root.querySelector(`[data-seuils-gauge="${cat.key}"]`);
        if (gauge && gauge.getContext) {
            const rect = gauge.getBoundingClientRect();
            const width = Math.max(1, Math.floor(rect.width || gauge.clientWidth || 28));
            const height = Math.max(1, Math.floor(rect.height || gauge.clientHeight || 132));
            if (gauge.width !== width) gauge.width = width;
            if (gauge.height !== height) gauge.height = height;

            const ctx = gauge.getContext('2d');
            if (!ctx) return;

            let track = isAlertState ? "#D55E00" : "#E6E6E6";
            let fill = "#E6E6E6";
            if (score > 0 && percent >= 70) fill = "#009E73";
            else if (score > 0 && percent >= 50) fill = "#56B4E9";
            else if (score > 0 && percent >= 30) fill = "#E69F00";
            else if (score > 0) fill = "#D55E00";

            const barWidth = Math.max(10, Math.min(18, Math.round(width * 0.7)));
            const barX = Math.round((width - barWidth) / 2);
            const radius = Math.min(barWidth / 2, 8);
            const filledHeight = Math.max(0, Math.min(height, Math.round((percent / 100) * height)));

            const roundedRect = (x, y, w, h, r) => {
                const rr = Math.min(r, w / 2, h / 2);
                ctx.beginPath();
                ctx.moveTo(x + rr, y);
                ctx.arcTo(x + w, y, x + w, y + h, rr);
                ctx.arcTo(x + w, y + h, x, y + h, rr);
                ctx.arcTo(x, y + h, x, y, rr);
                ctx.arcTo(x, y, x + w, y, rr);
                ctx.closePath();
            };

            ctx.clearRect(0, 0, width, height);

            ctx.fillStyle = track;
            roundedRect(barX, 0, barWidth, height, radius);
            ctx.fill();

            if (filledHeight > 0) {
                ctx.fillStyle = fill;
                roundedRect(barX, height - filledHeight, barWidth, filledHeight, radius);
                ctx.fill();
            }
        }
    });
}

  /* ---- Radar ---- */

renderRadar() {
    const lot = this.getCurrentLot();
    if (!lot) return;

    const radarLotLabel = document.getElementById('radarActiveLotLabel');
    const lots = this.data.lots || [];
    const lotIndex = lots.indexOf(lot);
    if (radarLotLabel) {
        const defaultName = lotIndex >= 0 ? 'Lot ' + (lotIndex + 1) : 'Lot …';
        const lotName = (lot.nom || '').trim();
        radarLotLabel.textContent = lotName ? lotName : defaultName;
    }

    const scores = this.getValueScoresForLot(lot);
    const labels = ['Économique', 'Écologique', 'Mécanique', 'Historique', 'Esthétique'];
    const toPercent = (score) => Math.min(100, Math.max(0, Math.round((score / 30) * 100)));
    const data = [
        toPercent(scores.economique || 0),
        toPercent(scores.ecologique || 0),
        toPercent(scores.mecanique || 0),
        toPercent(scores.historique || 0),
        toPercent(scores.esthetique || 0)
        ];    

    const canvas = document.getElementById('radarChart') || document.getElementById('radarChartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (!this.radarChart) {
            this.radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Valeurs du lot',
                        data,
                        backgroundColor: 'rgba(0, 0, 0, 0.15)',
                        borderColor: '#000000',
                        borderWidth: 1,
                        pointBackgroundColor: '#000000'
                    }
                ]
            },
                options: {
                    responsive: true,
                    scales: {
                        r: {
                            suggestedMin: 0,
                            suggestedMax: 100,
                            ticks: {
                                display: false
                            },
                            grid: {
                                color: 'rgba(0,0,0,0.15)'
                            },
                            angleLines: {
                                color: 'rgba(0,0,0,0.15)'
                            }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        } else {
            this.radarChart.data.datasets[0].data = data;
            this.radarChart.update();
        }

        const bodyText = document.getElementById('radarBodyText');
        if (bodyText) {
            const avg =
                data.reduce((acc, v) => acc + v, 0) / (data.length || 1);
            let synth = 'Profil non renseigné.';
            if (avg > 0 && avg <= 33) synth = 'Profil globalement faible.';
            else if (avg > 33 && avg <= 66) synth = 'Profil globalement moyen.';
            else if (avg > 66) synth = 'Profil globalement fort.';
            bodyText.textContent = synth;
        }
    }

    renderOrientation() {
        const section = document.getElementById('orientationSection');
    const lotLabel = document.getElementById('orientationActiveLotLabel');
    const container = document.getElementById('orientationLotsContainer');
    const scrollbarThumb = document.getElementById('orientationScrollbarThumb');

    if (!section || !container) return;

    const lots = this.data.lots || [];
    if (!lots.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // Lot actif global (le même index que dans le reste de l’app)
    const currentLot = this.getCurrentLot();
    const activeIndex = currentLot ? lots.indexOf(currentLot) : 0;

    if (lotLabel) {
        lotLabel.textContent = activeIndex >= 0 ? 'Lot ' + (activeIndex + 1) : 'Lot …';
    }

    container.innerHTML = '';

    lots.forEach((lot, index) => {
        const card = document.createElement('div');
        card.className = 'orientation-lot-card';
        if (index === activeIndex) {
            card.classList.add('orientation-lot-card--active');
        }
        card.dataset.lotIndex = String(index);

        const header = document.createElement('div');
        header.className = 'orientation-lot-header';

        const nameBox = document.createElement('div');
        nameBox.className = 'orientation-lot-name';
        nameBox.textContent = 'Lot ' + (index + 1);

        const orientationBox = document.createElement('div');
        orientationBox.className = 'orientation-lot-orientation';

        const label = lot.orientationLabel || '…';
        const normalized = (label || '').toLowerCase();

        let extraClass = 'orientation-lot-orientation--none';
        if (normalized === 'réemploi' || normalized === 'reemploi') {
            extraClass = 'orientation-lot-orientation--reemploi';
        } else if (normalized === 'réutilisation' || normalized === 'reutilisation') {
            extraClass = 'orientation-lot-orientation--reutilisation';
        } else if (normalized === 'recyclage') {
            extraClass = 'orientation-lot-orientation--recyclage';
        } else if (normalized === 'combustion') {
            extraClass = 'orientation-lot-orientation--combustion';
        }
        orientationBox.classList.add(extraClass);
        orientationBox.textContent = label || '…';

        header.appendChild(nameBox);
        header.appendChild(orientationBox);

        const grid = document.createElement('div');
        grid.className = 'orientation-lot-grid';

        const info = lot.allotissement || lot.allot || {};

        const formatGroupedValue = (value, digits = 0) => {
            const num = parseFloat(value);
            if (!Number.isFinite(num)) return '';
            return num.toLocaleString('fr-FR', {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            });
        };

        const qty = info.quantite != null ? info.quantite : (info.quantitePieces != null ? info.quantitePieces : '');
        const qtyLabel = qty === '' ? '' : formatGroupedValue(qty, 0);
        const typePiece = info.typePiece != null ? info.typePiece : (info.typePieces != null ? info.typePieces : '');
        const essence = info.essenceNomCommun != null ? info.essenceNomCommun : (info.essence != null ? info.essence : '');
        const volumeLot = info.volumeLot != null ? info.volumeLot : (info.volume_m3 != null ? info.volume_m3 : '');
        const volumeLotLabel = volumeLot === '' ? '' : formatGroupedValue(volumeLot, 1);
        const surfaceLot = info.surfaceLot != null ? info.surfaceLot : (info.surface_m2 != null ? info.surface_m2 : '');
        const surfaceLotLabel = surfaceLot === '' ? '' : formatGroupedValue(surfaceLot, 1);
        const lineaireLot = info.lineaireLot != null ? info.lineaireLot : (info.lineaire_ml != null ? info.lineaire_ml : '');
        const lineaireLotLabel = lineaireLot === '' ? '' : formatGroupedValue(lineaireLot, 1);
        const priceUnitRaw = info.prixUnite != null ? info.prixUnite : (info.prix_unite != null ? info.prix_unite : 'm3');
        const priceUnit = ((priceUnitRaw || 'm3') + '').toLowerCase();
        const prixLot = info.prixLot != null ? info.prixLot : (info.prix_total != null ? info.prix_total : '');
        const prixLotLabel = prixLot === '' ? '' : formatGroupedValue(Math.round(parseFloat(prixLot) || 0), 0);

        const fieldDefs = [
            { label: 'Quantité', value: qtyLabel },
            { label: 'Type de pièce', value: typePiece },
            { label: 'Essence', value: essence }
        ];

        if (priceUnit === 'ml') {
            fieldDefs.push({ label: 'Linéaire du lot', value: lineaireLotLabel ? lineaireLotLabel + ' m' : '' });
        } else if (priceUnit === 'm2') {
            fieldDefs.push({ label: 'Surface du lot', value: surfaceLotLabel ? surfaceLotLabel + ' m2' : '' });
        }

        fieldDefs.push(
            { label: 'Volume du lot', value: volumeLotLabel ? volumeLotLabel + ' m³' : '' },
            { label: 'Prix du lot', value: prixLotLabel ? prixLotLabel + ' €' : '' }
        );

        fieldDefs.forEach((f) => {
            const box = document.createElement('div');
            box.className = 'orientation-field-box';
            box.innerHTML = `${f.label}<br><span>${f.value || '—'}</span>`;
            grid.appendChild(box);
        });

        card.appendChild(header);
        card.appendChild(grid);

        // clic sur la carte => input le lot actif
        card.addEventListener('click', () => {
            this.setCurrentLotIndex(index);
            this.render(); // re‑rendu global (y compris Orientation)
        });

        container.appendChild(card);
    });

    // Scrollbar custom synchronisée
    const scroller = container;

    const updateThumb = () => {
        if (!scrollbarThumb) return;
        const maxScroll = scroller.scrollWidth - scroller.clientWidth;
        if (maxScroll <= 0) {
            scrollbarThumb.style.width = '100%';
            scrollbarThumb.style.left = '0';
            return;
        }
        const ratioVisible = scroller.clientWidth / scroller.scrollWidth;
        const thumbWidth = Math.max(ratioVisible * 100, 10);
        const scrollRatio = scroller.scrollLeft / maxScroll;
        const maxLeft = 100 - thumbWidth;
        scrollbarThumb.style.width = thumbWidth + '%';
        scrollbarThumb.style.left = (scrollRatio * maxLeft) + '%';
    };

    scroller.addEventListener('scroll', updateThumb);
    window.addEventListener('resize', updateThumb);
    updateThumb();
    }

    computeOrientation(lot) {
        const scores = this.getValueScoresForLot(lot);
        const avg = (scores.economique + scores.ecologique + scores.mecanique + scores.historique + scores.esthetique) / 5;
        const percentage = (avg / 30) * 100;

        let label = "…";
        let code = "none";

        if (avg > 0 || avg < 0) {
            if (percentage >= 70) {
                label = "Réemploi";
                code = "reemploi";
            } else if (percentage >= 50) {
                label = "Réutilisation";
                code = "reutilisation";
            } else if (percentage >= 30) {
                label = "Recyclage";
                code = "recyclage";
            } else {
                label = "Combustion";
                code = "combustion";
            }
        }

        lot.orientationLabel = label;
        lot.orientationCode = code;

        const lotIndex = this.data.lots.indexOf(lot);
        if (lotIndex >= 0) {
            this.updateAllotissementOrientationBadge(lotIndex);
        }

        this.renderOrientation();
        this.renderSeuils();
        this.renderRadar();
        this.renderEvalOp(); 
    } 
    
    updateAllotissementOrientationBadge(lotIndex) {
        const rail = document.getElementById('lotRail');
        if (!rail) return;

        const card = rail.querySelector(`.lot-card[data-lot-index="${lotIndex}"]`);
        if (!card) return;

        const badge = card.querySelector('[data-lot-orientation-badge]');
        if (!badge) return;

        const lot = this.data.lots[lotIndex];
        const label = (lot && lot.orientationLabel) ? lot.orientationLabel : '…';
        const code = (lot && lot.orientationCode) ? lot.orientationCode : 'none';

        badge.classList.remove(
            'lot-orientation--reemploi',
            'lot-orientation--reutilisation',
            'lot-orientation--recyclage',
            'lot-orientation--combustion',
            'lot-orientation--none'
        );

        badge.classList.add(`lot-orientation--${code}`);
        badge.textContent = label;
    }

    /* ---- Évaluation de l’opération ---- */
    renderEvalOp() {
        const lots = this.data.lots;
        if (!lots || lots.length === 0) return;
        const root = document.getElementById('eval-op-section');
        if (!root) return;

        let volReemploi = 0, priceReemploi = 0;
        let volReutil = 0, priceReutil = 0;
        let volRecyc = 0, priceRecyc = 0;
        let volIncin = 0, priceIncin = 0;
        let totalVolGlobal = 0;
        let bilanMonetaireGlobal = 0;

        this.data.lots.forEach(lot => {
            const allotissement = lot.allotissement || {};
            const v = parseFloat(allotissement.volumeLot) || 0;
            const p = parseFloat(allotissement.prixLot) || 0;
            totalVolGlobal += v;

            if (lot.orientationLabel === "Combustion") {
                bilanMonetaireGlobal -= p;
                volIncin += v;
                priceIncin += p;
            } else {
                bilanMonetaireGlobal += p;
                if (lot.orientationLabel === "Réemploi") {
                    volReemploi += v; priceReemploi += p;
                } else if (lot.orientationLabel === "Réutilisation") {
                    volReutil += v; priceReutil += p;
                } else if (lot.orientationLabel === "Recyclage") {
                    volRecyc += v; priceRecyc += p;
                }
            }
        });

        const circularite = totalVolGlobal > 0 ? ((volReemploi + volReutil) / totalVolGlobal) * 100 : 0;

        const setVal = (key, val) => {
            const el = root.querySelector(`[data-eval="${key}"]`);
            if (el) el.textContent = val;
        };

        const fmt = (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
        const fmtVol = (v) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v) + " m³";

        setVal('vol-reemploi', fmtVol(volReemploi));
        setVal('prix-reemploi', fmt(priceReemploi));
        setVal('vol-reutil', fmtVol(volReutil));
        setVal('prix-reutil', fmt(priceReutil));
        setVal('vol-recyc', fmtVol(volRecyc));
        setVal('prix-recyc', fmt(priceRecyc));
        setVal('vol-incin', fmtVol(volIncin));
        setVal('prix-incin', fmt(priceIncin));
        setVal('circularite', new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(circularite) + "%");
        setVal('bilan-monetaire', fmt(bilanMonetaireGlobal));

    } // FERMETURE DE renderEvalOp

    /* ---- Reset / Save / Export ---- */
    resetAllData() {
        if (this.persistenceMode === 'guest') {
            try {
                localStorage.removeItem(this.storageKey);
            } catch (e) {
                console.error(e);
            }
        }
        this.data = this.createInitialData();
        this.currentLotIndex = 0;
        if (typeof window.__valoboisResetFirestoreEvaluation === 'function') {
            window.__valoboisResetFirestoreEvaluation(this);
        }
        this.saveData();
        this.render();
    }

    async saveAsHtmlFile() {
        let filename = prompt('Nom du fichier à télécharger :', 'valobois_evaluation_' + new Date().toISOString().slice(0, 10));
        if (filename === null) return;

        filename = (filename.trim() || 'valobois_evaluation_' + new Date().toISOString().slice(0, 10)).replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';

        try {
            if (typeof window.buildValoboisStandaloneHtml !== 'function') {
                throw new Error('buildValoboisStandaloneHtml manquant');
            }
            const html = await window.buildValoboisStandaloneHtml({ data: this.data });
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);
            alert('Export HTML impossible. Servez l’application via HTTP (pas file://) ou exécutez npm run build:standalone.');
        }
    }

    async exportEtiquettes(lotIndices = []) {
        const validLotIndices = Array.isArray(lotIndices)
            ? lotIndices.filter((i) => Number.isInteger(i) && this.data.lots[i])
            : [];

        if (!validLotIndices.length) {
            alert('Aucun lot valide sélectionné pour l\'export des étiquettes.');
            return;
        }

        if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            alert('Export PDF indisponible (bibliothèque jsPDF manquante).');
            return;
        }

        try {
            for (let i = 0; i < validLotIndices.length; i += 1) {
                const lotIndex = validLotIndices[i];
                const svg = this.buildEtiquetteSvgPage(lotIndex);
                const lotLabel = this.getPdfLotLabel(this.data.lots[lotIndex], lotIndex);
                const safeLabel = lotLabel.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
                await this.downloadEtiquettePdf(svg, `valobois_etiquettes_${safeLabel}.pdf`);
            }
        } catch (error) {
            console.error(error);
            alert('Une erreur est survenue pendant la génération des étiquettes PDF.');
        }
    }

    async downloadEtiquettePdf(svgMarkup, filename) {
        const { jsPDF } = window.jspdf || window;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);

        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Impossible de charger le SVG des étiquettes.'));
                img.src = svgUrl;
            });

            const canvas = document.createElement('canvas');
            const upscale = 2;
            canvas.width = Math.max(1, Math.round(image.naturalWidth * upscale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * upscale));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Contexte canvas indisponible pour l\'export PDF.');

            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
            const drawWidth = canvas.width * ratio;
            const drawHeight = canvas.height * ratio;
            const x = (pageWidth - drawWidth) / 2;
            const y = (pageHeight - drawHeight) / 2;

            pdf.addImage(dataUrl, 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST');
            pdf.save(filename);
        } finally {
            URL.revokeObjectURL(svgUrl);
        }
    }

    buildEtiquetteSvgPage(lotIndex) {
        const lot   = this.data.lots[lotIndex] || {};
        const allot = lot.allotissement || {};
        const meta  = this.data.meta || {};
        const orientation = this.getPdfOrientationSummary(lot);

        /* ── Page A4 (mm) ── */
        const PW = 210, PH = 297;
        const PAGE_MARGIN = 15;
        const COLS = 3, ROWS = 5, SZ = 51, GAP = 2;
        const areaW = COLS * SZ + (COLS - 1) * GAP;
        const areaH = ROWS * SZ + (ROWS - 1) * GAP;
        const printableW = PW - (PAGE_MARGIN * 2);
        const printableH = PH - (PAGE_MARGIN * 2);
        const ox = PAGE_MARGIN + Math.max(0, (printableW - areaW) / 2);
        const oy = PAGE_MARGIN + Math.max(0, (printableH - areaH) / 2);

        /* ── Helpers ── */
        const e = (s) => String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        /* ── Données du lot ── */
        const lotRef    = this.getPdfLotLabel(lot, lotIndex);
        const typePiece = (allot.typePiece || '').trim();
        const essComm   = (allot.essenceNomCommun || '').trim();
        const qty       = parseFloat(allot.quantite) || 0;
        const vol       = parseFloat(allot.volumeLot) || 0;
        const opLoc     = (meta.localisation || '').trim();
        const diagMail  = (meta.diagnostiqueurMail || meta.diagnostiqueurEmail || '').trim();
        const deconMail = (meta.entrepriseDeconstructionMail || meta.entrepriseDeconstructionEmail || meta.deconstructeurMail || '').trim();
        const destination = (allot.destination || '').trim();

        /* ── Orientation ── */
        const OC = { reemploi: '#009E73', reutilisation: '#56B4E9', recyclage: '#E69F00', combustion: '#D55E00', none: '#CCCCCC' };
        const oCode  = orientation.code || 'none';
        const oColor = OC[oCode] || '#CCCCCC';
        const oLabel = orientation.label || '—';

        /* ── Chaînes ── */
        const volStr = vol > 0 ? `${Math.round(vol)}\u202fm\u00b3` : '';
        const qtyStr = qty > 0 ? `${qty}\u202fpi\u00e8ce${qty > 1 ? 's' : ''}` : '';

        /* ── Typographie ── */
        const FF = 'Roboto,Arial,sans-serif';
        const F  = { ref: 3.6, header: 4.2, main: 3.2, essence: 3.0, small: 2.0, tiny: 1.7 };
        const C  = { dark: '#111111', mid: '#333333', muted: '#555555', light: '#777777' };

        /* ── Constructeur d'une étiquette 51×51 mm ── */
        const buildLabel = (lx, ly, uid) => {
            const R  = 2;
            const HH = 9;
            const MARGIN = 2;
            const out = [];

            /* ClipPath arrondi */
            out.push(`<clipPath id="cp${uid}"><rect x="${lx}" y="${ly}" width="${SZ}" height="${SZ}" rx="${R}"/></clipPath>`);

            /* Fond blanc + bord */
            out.push(`<rect x="${lx}" y="${ly}" width="${SZ}" height="${SZ}" rx="${R}" fill="white" stroke="#CCCCCC" stroke-width="0.3"/>`);

            /* ══════ BLOC 1 : EN-TÊTE (1/5) ══════ */
            out.push(`<rect x="${lx}" y="${ly}" width="${SZ}" height="${HH}" rx="${R}" fill="${oColor}"/>`);
            out.push(`<rect x="${lx}" y="${ly + R}" width="${SZ}" height="${HH - R}" fill="${oColor}"/>`);
            out.push(`<text x="${lx + 2.5}" y="${ly + HH - 2.2}" font-family="${FF}" font-size="${F.header}" font-weight="700" fill="${C.dark}">${e(lotRef)}</text>`);
            if (volStr) {
                out.push(`<text x="${lx + SZ - 2.5}" y="${ly + 3.2}" font-family="${FF}" font-size="${F.main}" font-weight="700" fill="${C.dark}" text-anchor="end">${e(volStr)}</text>`);
            }
            out.push(`<text x="${lx + SZ - 2.5}" y="${ly + HH - 2.2}" font-family="${FF}" font-size="${F.main}" font-weight="700" fill="${C.dark}" text-anchor="end">${e(oLabel)}</text>`);

            /* ── Contenu clippé ── */
            out.push(`<g clip-path="url(#cp${uid})">`);

/* ══════ BLOC 2 : TYPE + ESSENCE (1/5) ══════ */
            const bloc2Top = ly + HH + MARGIN;
            const bloc2Y1 = bloc2Top + 2.5;
            if (typePiece) {
                out.push(`<text x="${lx + SZ - 2.5}" y="${bloc2Y1}" font-family="${FF}" font-size="${F.main}" fill="${C.mid}" text-anchor="end">${e(typePiece)}</text>`);
            }
            const bloc2Y2 = bloc2Y1 + F.main + 1.0;
            if (essComm) {
                out.push(`<text x="${lx + SZ - 2.5}" y="${bloc2Y2}" font-family="${FF}" font-size="${F.essence}" fill="${C.muted}" text-anchor="end">${e(essComm)}</text>`);
            }

            /* ══════ BLOC 3 : PIED 4 LIGNES (1/5) ══════ */
            const bloc3Top = bloc2Top + 9 + MARGIN;
            const FS = F.tiny;
            const FLD = FS + 0.9;
            const foot1Y = bloc3Top + 1.5;
            out.push(`<text x="${lx + 2.5}" y="${foot1Y}" font-family="${FF}" font-size="${FS}" fill="${C.mid}"><tspan font-weight="400">Origine\u202f: </tspan><tspan font-weight="700">${e(opLoc || '\u2014')}</tspan></text>`);
            const foot2Y = foot1Y + FLD;
            out.push(`<text x="${lx + 2.5}" y="${foot2Y}" font-family="${FF}" font-size="${FS}" fill="${C.mid}"><tspan font-weight="400">Diagnostiqueur\u202f: </tspan><tspan font-weight="700">${e(diagMail || '\u2014')}</tspan></text>`);
            const foot3Y = foot2Y + FLD;
            out.push(`<text x="${lx + 2.5}" y="${foot3Y}" font-family="${FF}" font-size="${FS}" fill="${C.mid}"><tspan font-weight="400">D\u00e9constructeur\u202f: </tspan><tspan font-weight="700">${e(deconMail || '\u2014')}</tspan></text>`);
            const foot4Y = foot3Y + FLD;
            out.push(`<text x="${lx + 2.5}" y="${foot4Y}" font-family="${FF}" font-size="${FS}" fill="${C.mid}"><tspan font-weight="400">Destination\u202f: </tspan><tspan font-weight="700">${e(destination || '\u2014')}</tspan></text>`);

            /* ══════ BLOC 4 : N° PIÈCE (PIED) (2/5) ══════ */
            const bloc4Top = bloc3Top + 9 + MARGIN;
            const zoneLabel = bloc4Top + 2.5;
            out.push(`<text x="${lx + 2.5}" y="${zoneLabel}" font-family="${FF}" font-size="${F.tiny}" fill="${C.light}">N\u00b0 pi\u00e8ce</text>`);
            const handTopY = zoneLabel + 2.0;
            const handBottomY = ly + SZ - 2.0;
            const splitX = lx + SZ * 0.62;
            out.push(`<rect x="${lx + 2.5}" y="${handTopY}" width="${splitX - (lx + 2.5)}" height="${handBottomY - handTopY}" fill="none" stroke="#B8B8B8" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`);
            if (qtyStr) {
                out.push(`<text x="${lx + SZ - 2.5}" y="${handTopY + 3.0}" font-family="${FF}" font-size="${F.main}" fill="${C.mid}" text-anchor="end">${e(qtyStr)}</text>`);
            }

            out.push('</g>');
            return out.join('');
        };

        /* ── Traits de découpe pointillés ── */
        const dash = `stroke="#CCCCCC" stroke-width="0.25" stroke-dasharray="1.5 1.5"`;
        const marks = [];
        for (let c = 1; c < COLS; c++) {
            const cx = ox + c * (SZ + GAP) - GAP / 2;
            marks.push(`<line x1="${cx}" y1="${oy}" x2="${cx}" y2="${oy + areaH}" ${dash}/>`);
        }
        for (let r = 1; r < ROWS; r++) {
            const ry = oy + r * (SZ + GAP) - GAP / 2;
            marks.push(`<line x1="${ox}" y1="${ry}" x2="${ox + areaW}" y2="${ry}" ${dash}/>`);
        }

        /* ── Grille d'étiquettes ── */
        const cells = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const uid = r * COLS + c;
                cells.push(buildLabel(ox + c * (SZ + GAP), oy + r * (SZ + GAP), uid));
            }
        }

        /* ── Note de page ── */
        const today = new Date().toLocaleDateString('fr-FR');
        const pageNoteY = Math.min(PH - PAGE_MARGIN, oy + areaH + 2);
        const pageNote = `<text x="${PW / 2}" y="${pageNoteY}" font-family="Roboto,Arial,sans-serif" font-size="2.1" fill="#BBBBBB" text-anchor="middle">VALOBOIS \u00B7 ${e(lotRef)} \u00B7 ${COLS * ROWS} \u00E9tiquettes \u00B7 ${today}</text>`;

        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}mm" height="${PH}mm" viewBox="0 0 ${PW} ${PH}">`,
            `<rect width="${PW}" height="${PH}" fill="#F4F4F4"/>`,
            '<defs></defs>',
            marks.join('\n'),
            cells.join('\n'),
            pageNote,
            '</svg>'
        ].join('\n');
    }

    createPdfBaseRoot(titleText) {
        const exportRoot = document.createElement('div');
        exportRoot.style.position = 'fixed';
        exportRoot.style.left = '-20000px';
        exportRoot.style.top = '0';
        exportRoot.style.width = '1120px';
        exportRoot.style.padding = '32px';
        exportRoot.style.background = '#ffffff';
        exportRoot.style.color = '#111111';
        exportRoot.style.boxSizing = 'border-box';
        exportRoot.style.display = 'flex';
        exportRoot.style.flexDirection = 'column';
        exportRoot.style.gap = '24px';
        exportRoot.setAttribute('data-pdf-export-root', 'true');

        const title = document.createElement('div');
        title.textContent = titleText;
        title.style.fontSize = '24px';
        title.style.fontWeight = '700';
        title.style.textAlign = 'center';
        title.style.marginBottom = '4px';
        exportRoot.appendChild(title);

        document.body.appendChild(exportRoot);
        return exportRoot;
    }

    syncCloneCanvases(sourceRoot, cloneRoot) {
        if (!sourceRoot || !cloneRoot) return;
        const sourceCanvases = sourceRoot.querySelectorAll('canvas');
        const cloneCanvases = cloneRoot.querySelectorAll('canvas');
        sourceCanvases.forEach((sourceCanvas, index) => {
            const cloneCanvas = cloneCanvases[index];
            if (!cloneCanvas) return;
            cloneCanvas.width = sourceCanvas.width;
            cloneCanvas.height = sourceCanvas.height;
            cloneCanvas.style.width = sourceCanvas.style.width || sourceCanvas.clientWidth + 'px';
            cloneCanvas.style.height = sourceCanvas.style.height || sourceCanvas.clientHeight + 'px';
            const ctx = cloneCanvas.getContext('2d');
            if (ctx) ctx.drawImage(sourceCanvas, 0, 0);
        });
    }

    getPdfMaxBytes() {
        return 5 * 1024 * 1024;
    }

    getDataUrlSizeBytes(dataUrl) {
        const commaIndex = dataUrl.indexOf(',');
        const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
        return Math.ceil((base64.length * 3) / 4);
    }

    resizeCanvas(sourceCanvas, scale) {
        const width = Math.max(1, Math.round(sourceCanvas.width * scale));
        const height = Math.max(1, Math.round(sourceCanvas.height * scale));
        const resizedCanvas = document.createElement('canvas');
        resizedCanvas.width = width;
        resizedCanvas.height = height;
        const ctx = resizedCanvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(sourceCanvas, 0, 0, width, height);
        }
        return resizedCanvas;
    }

    createCompressedImageData(sourceCanvas, targetBytes) {
        let workingCanvas = sourceCanvas;
        let scale = 1;
        let quality = 0.82;
        let attempts = 0;
        let dataUrl = workingCanvas.toDataURL('image/jpeg', quality);
        let sizeBytes = this.getDataUrlSizeBytes(dataUrl);

        while (sizeBytes > targetBytes && attempts < 10) {
            const shouldDownscale = scale > 0.42;
            if (shouldDownscale) {
                scale *= sizeBytes > targetBytes * 1.8 ? 0.8 : 0.9;
                workingCanvas = this.resizeCanvas(sourceCanvas, scale);
            }

            if (quality > 0.46) {
                quality -= sizeBytes > targetBytes * 1.5 ? 0.1 : 0.06;
            }

            quality = Math.max(0.46, quality);
            dataUrl = workingCanvas.toDataURL('image/jpeg', quality);
            sizeBytes = this.getDataUrlSizeBytes(dataUrl);
            attempts += 1;
        }

        return {
            dataUrl,
            width: workingCanvas.width,
            height: workingCanvas.height,
            sizeBytes
        };
    }

    formatPdfDecimal(value, minimumFractionDigits = 0, maximumFractionDigits = 0) {
        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits,
            maximumFractionDigits
        }).format(Number.isFinite(value) ? value : 0);
    }

    formatPdfVolume(value) {
        return this.formatPdfDecimal(parseFloat(value) || 0, 1, 1) + ' m³';
    }

    formatPdfCurrency(value) {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
        }).format(parseFloat(value) || 0);
    }

    formatPdfPercent(value) {
        return this.formatPdfDecimal(parseFloat(value) || 0, 1, 1) + ' %';
    }

    formatPdfSignedScore(value) {
        if (value == null || value === '') return '—';
        const number = parseFloat(value);
        if (!Number.isFinite(number)) return '—';
        return (number > 0 ? '+' : '') + String(number).replace('.', ',');
    }

    getPdfLotLabel(lot, index) {
        return ((lot && lot.nom) || '').trim() || ('Lot ' + (index + 1));
    }

    getPdfCategoryDefinitions() {
        return [
            { key: 'economique', label: 'Économique' },
            { key: 'ecologique', label: 'Écologique' },
            { key: 'mecanique', label: 'Mécanique' },
            { key: 'historique', label: 'Historique' },
            { key: 'esthetique', label: 'Esthétique' }
        ];
    }

    getPdfSectionDefinitions() {
        return [
            {
                key: 'inspection',
                title: 'Inspection',
                rows: [
                    { key: 'visibilite', label: 'Visibilité - Accessibilité' },
                    { key: 'instrumentation', label: 'Instrumentation' },
                    { key: 'integrite', label: 'Intégrité générale' }
                ]
            },
            {
                key: 'bio',
                title: 'Biologique',
                rows: [
                    { key: 'purge', label: 'Purge' },
                    { key: 'expansion', label: 'Expansion' },
                    { key: 'integriteBio', label: 'Intégrité' },
                    { key: 'exposition', label: 'Exposition' },
                    { key: 'confianceBio', label: 'Confiance' }
                ]
            },
            {
                key: 'mech',
                title: 'Mécanique',
                rows: [
                    { key: 'purgeMech', label: 'Purge' },
                    { key: 'feuMech', label: 'Feu' },
                    { key: 'integriteMech', label: 'Intégrité' },
                    { key: 'expositionMech', label: 'Exposition' },
                    { key: 'confianceMech', label: 'Confiance' }
                ]
            },
            {
                key: 'usage',
                title: 'Usage',
                rows: [
                    { key: 'confianceUsage', label: 'Confiance' },
                    { key: 'durabiliteUsage', label: 'Durabilité naturelle' },
                    { key: 'classementUsage', label: 'Classement estimé' },
                    { key: 'humiditeUsage', label: 'Humidité' },
                    { key: 'aspectUsage', label: 'Aspect' }
                ]
            },
            {
                key: 'denat',
                title: 'Dénaturation',
                rows: [
                    { key: 'depollutionDenat', label: 'Dépollution' },
                    { key: 'contaminationDenat', label: 'Contamination' },
                    { key: 'durabiliteConfDenat', label: 'Durabilité conférée' },
                    { key: 'confianceDenat', label: 'Confiance' },
                    { key: 'naturaliteDenat', label: 'Naturalité' }
                ]
            },
            {
                key: 'debit',
                title: 'Débit',
                rows: [
                    { key: 'regulariteDebit', label: 'Régularité' },
                    { key: 'volumetrieDebit', label: 'Volumétrie' },
                    { key: 'stabiliteDebit', label: 'Stabilité' },
                    { key: 'artisanaliteDebit', label: 'Artisanalité' },
                    { key: 'rusticiteDebit', label: 'Rusticité' }
                ]
            },
            {
                key: 'geo',
                title: 'Géométrie',
                rows: [
                    { key: 'adaptabiliteGeo', label: 'Adaptabilité' },
                    { key: 'massiviteGeo', label: 'Massivité' },
                    { key: 'deformationGeo', label: 'Déformation' },
                    { key: 'industrialiteGeo', label: 'Industrialité' },
                    { key: 'inclusiviteGeo', label: 'Inclusivité' }
                ]
            },
            {
                key: 'essence',
                title: 'Essence',
                rows: [
                    { key: 'confianceEssence', label: 'Confiance' },
                    { key: 'rareteEcoEssence', label: 'Rareté' },
                    { key: 'masseVolEssence', label: 'Masse volumique' },
                    { key: 'rareteHistEssence', label: 'Rareté commerciale' },
                    { key: 'singulariteEssence', label: 'Singularité' }
                ]
            },
            {
                key: 'ancien',
                title: 'Ancienneté',
                rows: [
                    { key: 'confianceAncien', label: 'Confiance' },
                    { key: 'amortissementAncien', label: 'Amortissement' },
                    { key: 'vieillissementAncien', label: 'Vieillissement' },
                    { key: 'microhistoireAncien', label: 'Micro-histoire' },
                    { key: 'demontabiliteAncien', label: 'Démontabilité' }
                ]
            },
            {
                key: 'traces',
                title: 'Traces',
                rows: [
                    { key: 'confianceTraces', label: 'Confiance' },
                    { key: 'etiquetageTraces', label: 'Étiquetage' },
                    { key: 'alterationTraces', label: 'Altération' },
                    { key: 'documentationTraces', label: 'Documentation' },
                    { key: 'singularitesTraces', label: 'Singularités' }
                ]
            },
            {
                key: 'provenance',
                title: 'Provenance',
                rows: [
                    { key: 'confianceProv', label: 'Confiance' },
                    { key: 'transportProv', label: 'Transport' },
                    { key: 'reputationProv', label: 'Réputation' },
                    { key: 'macroProv', label: 'Macro-histoire' },
                    { key: 'territorialiteProv', label: 'Territorialité' }
                ]
            }
        ];
    }

    getPdfOrientationSummary(lot) {
        const scores = this.getValueScoresForLot(lot);
        const total = Object.values(scores).reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        const average = total / 5;
        const percentage = (average / 30) * 100;

        let label = '…';
        let code = 'none';
        if (average > 0 || average < 0) {
            if (percentage >= 70) {
                label = 'Réemploi';
                code = 'reemploi';
            } else if (percentage >= 50) {
                label = 'Réutilisation';
                code = 'reutilisation';
            } else if (percentage >= 30) {
                label = 'Recyclage';
                code = 'recyclage';
            } else {
                label = 'Combustion';
                code = 'combustion';
            }
        }

        return {
            label: lot && lot.orientationLabel ? lot.orientationLabel : label,
            code: lot && lot.orientationCode ? lot.orientationCode : code,
            percentage,
            average,
            scores
        };
    }

    getPdfOperationSummary() {
        const lots = this.data.lots || [];
        let volReemploi = 0;
        let priceReemploi = 0;
        let volReutil = 0;
        let priceReutil = 0;
        let volRecyc = 0;
        let priceRecyc = 0;
        let volIncin = 0;
        let priceIncin = 0;
        let totalVolGlobal = 0;
        let bilanMonetaireGlobal = 0;

        lots.forEach((lot) => {
            const allotissement = lot.allotissement || {};
            const volume = parseFloat(allotissement.volumeLot) || 0;
            const price = parseFloat(allotissement.prixLot) || 0;
            const orientation = this.getPdfOrientationSummary(lot).label;
            totalVolGlobal += volume;

            if (orientation === 'Combustion') {
                bilanMonetaireGlobal -= price;
                volIncin += volume;
                priceIncin += price;
            } else {
                bilanMonetaireGlobal += price;
                if (orientation === 'Réemploi') {
                    volReemploi += volume;
                    priceReemploi += price;
                } else if (orientation === 'Réutilisation') {
                    volReutil += volume;
                    priceReutil += price;
                } else if (orientation === 'Recyclage') {
                    volRecyc += volume;
                    priceRecyc += price;
                }
            }
        });

        const circularite = totalVolGlobal > 0 ? ((volReemploi + volReutil) / totalVolGlobal) * 100 : 0;

        return {
            orientations: [
                { label: 'Réemploi', volume: volReemploi, price: priceReemploi },
                { label: 'Réutilisation', volume: volReutil, price: priceReutil },
                { label: 'Recyclage', volume: volRecyc, price: priceRecyc },
                { label: 'Combustion', volume: volIncin, price: priceIncin }
            ],
            totalVolume: totalVolGlobal,
            circularite,
            bilanMonetaire: bilanMonetaireGlobal
        };
    }

    createPdfCard(titleText) {
        const card = document.createElement('section');
        card.style.border = '1px solid #d7d0c4';
        card.style.borderRadius = '12px';
        card.style.padding = '12px';
        card.style.background = '#fffdf8';
        card.style.boxSizing = 'border-box';
        card.style.breakInside = 'avoid';
        card.style.pageBreakInside = 'avoid';

        if (titleText) {
            const title = document.createElement('div');
            title.textContent = titleText;
            title.style.fontSize = '13px';
            title.style.fontWeight = '700';
            title.style.marginBottom = '8px';
            title.style.letterSpacing = '0.02em';
            card.appendChild(title);
        }

        return card;
    }

    appendPdfKeyValueGrid(card, pairs, columns = 2) {
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
        grid.style.gap = '8px';

        pairs.forEach((pair) => {
            const box = document.createElement('div');
            box.style.border = '1px solid #e7e1d6';
            box.style.borderRadius = '10px';
            box.style.padding = '8px';
            box.style.background = '#ffffff';

            const label = document.createElement('div');
            label.textContent = pair.label;
            label.style.fontSize = '9px';
            label.style.textTransform = 'uppercase';
            label.style.letterSpacing = '0.05em';
            label.style.color = '#6a6257';
            label.style.marginBottom = '4px';

            const value = document.createElement('div');
            value.textContent = pair.value || '—';
            value.style.fontSize = '12px';
            value.style.fontWeight = '600';
            value.style.lineHeight = '1.25';

            box.appendChild(label);
            box.appendChild(value);
            grid.appendChild(box);
        });

        card.appendChild(grid);
    }

    appendPdfTable(card, headers, rows, options = {}) {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontSize = options.fontSize || '10px';
        table.style.lineHeight = options.lineHeight || '1.25';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.textAlign = 'left';
            th.style.padding = options.compact ? '4px 5px' : '6px 7px';
            th.style.borderBottom = '1px solid #d7d0c4';
            th.style.color = '#6a6257';
            th.style.fontWeight = '700';
            th.style.background = '#f6f1e8';
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach((rowValues, rowIndex) => {
            const row = document.createElement('tr');
            if (rowIndex % 2 === 1) {
                row.style.background = '#fcfaf5';
            }
            rowValues.forEach((value) => {
                const td = document.createElement('td');
                td.textContent = value == null || value === '' ? '—' : String(value);
                td.style.padding = options.compact ? '4px 5px' : '6px 7px';
                td.style.borderBottom = '1px solid #eee7db';
                td.style.verticalAlign = 'top';
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        card.appendChild(table);
    }

    getPdfNotationRowValue(lot, sectionKey, fieldKey) {
        if (sectionKey === 'inspection') {
            const inspection = (lot && lot.inspection) || {};

            if (fieldKey === 'integrite') {
                const integrite = inspection.integrite || {};
                if (integrite.ignore) {
                    return { niveau: 'Ignoré', note: '—' };
                }
                if (!integrite.niveau) {
                    return { niveau: '—', note: '—' };
                }
                const label = integrite.niveau === 'forte'
                    ? 'Forte'
                    : integrite.niveau === 'moyenne'
                        ? 'Moyenne'
                        : 'Faible';
                return {
                    niveau: label,
                    note: integrite.coeff != null ? ('Coeff. ' + String(integrite.coeff).replace('.', ',')) : '—'
                };
            }

            const value = inspection[fieldKey];
            if (!value) {
                return { niveau: '—', note: '—' };
            }
            const level = value === 'forte' ? 'Forte' : value === 'moyenne' ? 'Moyenne' : 'Faible';
            const note = value === 'forte' ? '1' : value === 'moyenne' ? '2' : '3';
            return { niveau: level, note };
        }

        const section = lot && lot[sectionKey];
        const entry = section && section[fieldKey];
        if (!entry || (!entry.niveau && entry.valeur == null)) {
            return { niveau: '—', note: '—' };
        }

        return {
            niveau: entry.niveau || '—',
            note: this.formatPdfSignedScore(entry.valeur)
        };
    }

    createPdfSynthesisRoot() {
        const exportRoot = this.createPdfBaseRoot('Synthèse de l’évaluation');

        const metaCard = this.createPdfCard('Opération');
        const meta = this.data.meta || {};
        this.appendPdfKeyValueGrid(metaCard, [
            { label: 'Référence gisement', value: this.getReferenceGisement(meta) || '—' },
            { label: 'Opération', value: meta.operation || '—' },
            { label: 'Diagnostiqueur', value: meta.diagnostiqueurContact || '—' },
            { label: 'Localisation', value: meta.localisation || '—' },
            { label: 'Date', value: meta.date || '—' }
        ], 5);

        const lotsCard = this.createPdfCard('Synthèse des lots');
        const lotRows = (this.data.lots || []).map((lot, index) => {
            const allotissement = lot.allotissement || {};
            const orientation = this.getPdfOrientationSummary(lot);
            return [
                this.getPdfLotLabel(lot, index),
                allotissement.typePiece || '—',
                allotissement.essenceNomCommun || '—',
                this.formatPdfVolume(allotissement.volumeLot),
                this.formatPdfCurrency(allotissement.prixLot),
                orientation.label,
                this.formatPdfPercent(orientation.percentage),
                ...this.getPdfCategoryDefinitions().map((category) => this.formatPdfDecimal(parseFloat(orientation.scores[category.key]) || 0, 0, 0) + '/30')
            ];
        });
        this.appendPdfTable(
            lotsCard,
            ['Lot', 'Type', 'Essence', 'Volume', 'Prix', 'Orientation', 'Taux', 'Éco', 'Écolo', 'Méca', 'Hist', 'Esth'],
            lotRows.length ? lotRows : [['Aucun lot', '', '', '', '', '', '', '', '', '', '', '']],
            { fontSize: '9px', compact: true }
        );

        const evalCard = this.createPdfCard('Évaluation de l’opération');
        const operationSummary = this.getPdfOperationSummary();
        const evalRows = operationSummary.orientations.map((item) => [
            item.label,
            this.formatPdfVolume(item.volume),
            this.formatPdfCurrency(item.price)
        ]);
        evalRows.push([
            'Circularité',
            this.formatPdfPercent(operationSummary.circularite),
            this.formatPdfCurrency(operationSummary.bilanMonetaire)
        ]);
        this.appendPdfTable(evalCard, ['Orientation', 'Volume', 'Prix / bilan'], evalRows, { fontSize: '10px' });

        exportRoot.appendChild(metaCard);
        exportRoot.appendChild(lotsCard);
        exportRoot.appendChild(evalCard);
        return exportRoot;
    }

    createPdfActiveLotRoot(lotIndex = this.currentLotIndex) {
        const currentLot = this.data.lots && this.data.lots[lotIndex];
        if (!currentLot) return null;

        const exportRoot = this.createPdfBaseRoot(this.getPdfLotLabel(currentLot, lotIndex));
        exportRoot.style.width = '980px';
        exportRoot.style.padding = '16px';
        exportRoot.style.gap = '12px';

        const exportTitle = exportRoot.firstElementChild;
        if (exportTitle) {
            exportTitle.style.fontSize = '18px';
            exportTitle.style.marginBottom = '2px';
        }

        // ══ MOITIÉ HAUTE : quart gauche | quart droit ══
        const topRow = document.createElement('div');
        topRow.style.display = 'grid';
        topRow.style.gridTemplateColumns = '1fr 1fr';
        topRow.style.gap = '12px';
        topRow.style.alignItems = 'stretch';

        // ══ QUART HAUT GAUCHE : méta opération + fiche lot + inspection + évaluation ══
        const leftCol = document.createElement('div');
        leftCol.style.display = 'flex';
        leftCol.style.flexDirection = 'column';
        leftCol.style.gap = '10px';

        const meta = this.data.meta || {};
        const metaCard = this.createPdfCard('Opération');
        metaCard.style.padding = '9px';
        this.appendPdfKeyValueGrid(metaCard, [
            { label: 'Référence gisement', value: this.getReferenceGisement(meta) || '—' },
            { label: 'Opération', value: meta.operation || '—' },
            { label: 'Diagnostiqueur', value: meta.diagnostiqueurContact || '—' },
            { label: 'Localisation', value: meta.localisation || '—' },
            { label: 'Date', value: meta.date || '—' }
        ], 2);
        if (meta.commentaires && meta.commentaires.trim()) {
            const commentWrap = document.createElement('div');
            commentWrap.style.marginTop = '6px';
            const commentLabel = document.createElement('div');
            commentLabel.textContent = 'Commentaires';
            commentLabel.style.fontSize = '9px';
            commentLabel.style.textTransform = 'uppercase';
            commentLabel.style.letterSpacing = '0.05em';
            commentLabel.style.color = '#6a6257';
            commentLabel.style.fontWeight = '700';
            commentLabel.style.marginBottom = '2px';
            const commentText = document.createElement('div');
            commentText.textContent = meta.commentaires;
            commentText.style.fontSize = '8px';
            commentText.style.lineHeight = '1.4';
            commentWrap.appendChild(commentLabel);
            commentWrap.appendChild(commentText);
            metaCard.appendChild(commentWrap);
        }

        const allotissement = currentLot.allotissement || {};
        const integrity = currentLot.inspection && currentLot.inspection.integrite;
        const lotCard = this.createPdfCard('Fiche lot');
        lotCard.style.padding = '9px';
        this.appendPdfKeyValueGrid(lotCard, [
            { label: 'Type de pièces', value: allotissement.typePiece || '—' },
            { label: 'Essence', value: allotissement.essenceNomCommun || '—' },
            { label: 'Quantité', value: allotissement.quantite != null && allotissement.quantite !== '' ? String(allotissement.quantite) : '—' },
            { label: 'Dimensions (mm)', value: [allotissement.longueur, allotissement.largeur, allotissement.hauteur].some((v) => v != null && v !== '')
                ? [allotissement.longueur || '0', allotissement.largeur || '0', allotissement.hauteur || '0'].join(' × ')
                : '—' },
            { label: 'Volume lot', value: this.formatPdfVolume(allotissement.volumeLot) },
            { label: 'Prix marché /m³', value: this.formatPdfCurrency(parseFloat(allotissement.prixMarche) || 0) },
            { label: 'Coeff. intégrité', value: integrity && integrity.ignore ? 'Ignoré' : integrity && integrity.coeff != null ? String(integrity.coeff).replace('.', ',') : '—' },
            { label: 'Prix lot', value: this.formatPdfCurrency(allotissement.prixLot) }
        ], 2);

        const radarCard = this.createPdfCard('');
        radarCard.style.padding = '6px';
        radarCard.style.display = 'flex';
        radarCard.style.flexDirection = 'column';
        radarCard.style.justifyContent = 'flex-start';
        radarCard.style.alignItems = 'stretch';
        radarCard.style.width = '100%';
        radarCard.style.minWidth = '0';
        radarCard.style.alignSelf = 'stretch';
        radarCard.style.height = '400px';
        radarCard.style.maxHeight = '400px';
        radarCard.style.overflow = 'hidden';
        const radarTitle = document.createElement('div');
        radarTitle.textContent = 'Radar';
        radarTitle.style.fontSize = '13px';
        radarTitle.style.fontWeight = '700';
        radarTitle.style.textAlign = 'left';
        radarTitle.style.margin = '0 0 4px 0';
        radarTitle.style.flexShrink = '0';
        radarCard.appendChild(radarTitle);
        const radarSource = document.getElementById('radarSection');
        if (radarSource) {
            const radarClone = radarSource.cloneNode(true);
            radarClone.style.marginTop = '0';
            radarClone.style.border = '0';
            radarClone.style.boxShadow = 'none';
            radarClone.style.background = 'transparent';
            radarClone.style.width = '100%';
            radarClone.style.height = 'calc(100% - 18px)';
            radarClone.style.maxWidth = 'none';
            radarClone.style.display = 'flex';
            radarClone.style.flexDirection = 'column';
            radarClone.style.flex = '1 1 auto';
            radarClone.style.minHeight = '0';
            radarClone.style.justifyContent = 'center';
            radarClone.style.alignItems = 'center';
            radarClone.querySelectorAll('button').forEach((btn) => btn.remove());
            const radarHdr = radarClone.querySelector('.radar-header');
            if (radarHdr) radarHdr.remove();
            const canvasWrapper = radarClone.querySelector('.radar-canvas-wrapper');
            if (canvasWrapper) {
                canvasWrapper.style.width = '100%';
                canvasWrapper.style.height = '100%';
                canvasWrapper.style.maxWidth = 'none';
                canvasWrapper.style.maxHeight = 'none';
                canvasWrapper.style.margin = '0 auto';
                canvasWrapper.style.display = 'flex';
                canvasWrapper.style.justifyContent = 'center';
                canvasWrapper.style.alignItems = 'center';
                canvasWrapper.style.overflow = 'hidden';
            }
            const radarCanvas = radarClone.querySelector('canvas');
            if (radarCanvas) {
                radarCanvas.style.display = 'block';
                radarCanvas.style.maxWidth = '100%';
                radarCanvas.style.maxHeight = '100%';
                radarCanvas.style.width = '100%';
                radarCanvas.style.height = '100%';
                radarCanvas.style.objectFit = 'contain';
                radarCanvas.style.margin = '0 auto';
            }
            const radarBodyText = radarClone.querySelector('#radarBodyText');
            if (radarBodyText) {
                radarBodyText.style.display = 'none';
            }
            radarCard.appendChild(radarClone);
            this.syncCloneCanvases(radarSource, radarClone);
        }

        // ══ QUART HAUT DROIT : jauges + radar ══
        const rightCol = document.createElement('div');
        rightCol.style.display = 'flex';
        rightCol.style.flexDirection = 'column';
        rightCol.style.gap = '10px';
        rightCol.style.height = '100%';

        const inspectionCard = this.createPdfCard('Inspection');
        inspectionCard.style.padding = '9px';
        this.appendPdfTable(
            inspectionCard,
            ['Critère', 'Niveau', 'Note'],
            this.getPdfSectionDefinitions()
                .find((s) => s.key === 'inspection')
                .rows.map((rowDef) => {
                    const rv = this.getPdfNotationRowValue(currentLot, 'inspection', rowDef.key);
                    return [rowDef.label, rv.niveau, rv.note];
                }),
            { fontSize: '8px', compact: true, lineHeight: '1.2' }
        );

        let jaugesCard = null;
        const seuilsSource = document.getElementById('seuils-section');
        if (seuilsSource) {
            const pdfGaugeLayout = {
                cardMinHeight: '250px',
                bodyGap: '8px',
                itemGap: '4px',
                percentRow: '24px',
                gaugeRow: '210px',
                labelRow: '18px',
                scoreRow: '22px',
                gaugeWidth: '48px',
                percentTextSize: '12px',
                labelTextSize: '10px',
                scoreTextSize: '10px'
            };

            jaugesCard = this.createPdfCard('Jauges');
            jaugesCard.style.padding = '9px';
            jaugesCard.style.minHeight = pdfGaugeLayout.cardMinHeight;
            jaugesCard.style.flex = '1 1 auto';
            jaugesCard.style.display = 'flex';
            jaugesCard.style.flexDirection = 'column';
            jaugesCard.style.width = '100%';
            jaugesCard.style.minWidth = '0';
            jaugesCard.style.alignSelf = 'stretch';
            const jaugesCardTitle = jaugesCard.firstElementChild;
            if (jaugesCardTitle) {
                jaugesCardTitle.style.marginBottom = '6px';
                jaugesCardTitle.style.flexShrink = '0';
            }
            const seuilsClone = seuilsSource.cloneNode(true);
            seuilsClone.style.marginTop = 'auto';
            seuilsClone.style.border = '0';
            seuilsClone.style.boxShadow = 'none';
            seuilsClone.style.background = 'transparent';
            seuilsClone.style.padding = '0';
            seuilsClone.style.width = '100%';
            seuilsClone.style.flex = '0 0 auto';
            seuilsClone.style.display = 'flex';
            seuilsClone.style.flexDirection = 'column';
            seuilsClone.querySelectorAll('button').forEach((btn) => btn.remove());
            const seuilsHdr = seuilsClone.querySelector('.seuils-header');
            if (seuilsHdr) seuilsHdr.remove();
            const seuilsBody = seuilsClone.querySelector('.seuils-body');
            if (seuilsBody) {
                seuilsBody.style.flex = '0 0 auto';
                seuilsBody.style.display = 'grid';
                seuilsBody.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
                seuilsBody.style.alignItems = 'end';
                seuilsBody.style.gap = pdfGaugeLayout.bodyGap;
                seuilsBody.style.justifyContent = 'center';
                seuilsBody.style.justifyItems = 'stretch';
                seuilsBody.style.marginTop = '0';
            }
            seuilsClone.querySelectorAll('.seuils-item').forEach((item) => {
                item.style.padding = '2px';
                item.style.gap = pdfGaugeLayout.itemGap;
                item.style.display = 'grid';
                item.style.gridTemplateRows = `${pdfGaugeLayout.percentRow} ${pdfGaugeLayout.gaugeRow} ${pdfGaugeLayout.labelRow} ${pdfGaugeLayout.scoreRow}`;
                item.style.alignItems = 'end';
                item.style.justifyItems = 'center';
                item.style.justifyContent = 'stretch';
            });
            seuilsClone.querySelectorAll('.seuils-item-header').forEach((el) => {
                el.style.display = 'flex';
                el.style.alignItems = 'center';
                el.style.justifyContent = 'center';
                el.style.width = '100%';
                el.style.height = pdfGaugeLayout.percentRow;
                el.style.minHeight = pdfGaugeLayout.percentRow;
                el.style.maxHeight = pdfGaugeLayout.percentRow;
                el.style.textAlign = 'center';
                el.style.gridRow = '1';
            });
            seuilsClone.querySelectorAll('.seuils-percent').forEach((el) => {
                el.style.display = 'inline-block';
                el.style.width = '100%';
                el.style.textAlign = 'center';
                el.style.fontWeight = '700';
                el.style.color = '#000000';
                el.style.fontSize = pdfGaugeLayout.percentTextSize;
                el.style.lineHeight = '1';
                el.style.whiteSpace = 'nowrap';
            });
            seuilsClone.querySelectorAll('.seuils-label').forEach((el) => {
                el.style.display = 'block';
                el.style.minHeight = pdfGaugeLayout.labelRow;
                el.style.width = '100%';
                el.style.textAlign = 'center';
                el.style.fontWeight = '700';
                el.style.color = '#111111';
                el.style.gridRow = '3';
                el.style.fontSize = pdfGaugeLayout.labelTextSize;
                el.style.lineHeight = '1.1';
            });
            seuilsClone.querySelectorAll('.seuils-gauge-wrapper').forEach((el) => {
                el.style.gridRow = '2';
                el.style.alignSelf = 'end';
                el.style.height = pdfGaugeLayout.gaugeRow;
                el.style.width = pdfGaugeLayout.gaugeWidth;
            });
            seuilsClone.querySelectorAll('.seuils-score-box').forEach((el) => {
                el.style.gridRow = '4';
                el.style.fontSize = pdfGaugeLayout.scoreTextSize;
                el.style.lineHeight = '1.1';
            });
            jaugesCard.appendChild(seuilsClone);
            this.syncCloneCanvases(seuilsSource, seuilsClone);

            // Important: la copie des canvas remet la taille source.
            // On redimensionne ici le canvas exporté pour que gaugeRow/gaugeWidth pilotent bien le visuel.
            const targetGaugeWidth = Math.max(1, Math.round(parseFloat(pdfGaugeLayout.gaugeWidth) || 1));
            const targetGaugeHeight = Math.max(1, Math.round(parseFloat(pdfGaugeLayout.gaugeRow) || 1));
            const sourceGaugeCanvases = seuilsSource.querySelectorAll('.seuils-gauge-canvas');
            const cloneGaugeCanvases = seuilsClone.querySelectorAll('.seuils-gauge-canvas');
            cloneGaugeCanvases.forEach((cloneCanvas, index) => {
                const sourceCanvas = sourceGaugeCanvases[index];
                cloneCanvas.width = targetGaugeWidth;
                cloneCanvas.height = targetGaugeHeight;
                cloneCanvas.style.width = '100%';
                cloneCanvas.style.height = '100%';
                const ctx = cloneCanvas.getContext('2d');
                if (ctx && sourceCanvas) {
                    ctx.clearRect(0, 0, targetGaugeWidth, targetGaugeHeight);
                    ctx.drawImage(sourceCanvas, 0, 0, targetGaugeWidth, targetGaugeHeight);
                }
            });
        }

        const evalCard = this.createPdfCard('Évaluation de l’opération');
        evalCard.style.padding = '9px';
        const opSummary = this.getPdfOperationSummary();
        const evalRows = opSummary.orientations.map((item) => [
            item.label,
            this.formatPdfVolume(item.volume),
            this.formatPdfCurrency(item.price)
        ]);
        evalRows.push(['Circularité', this.formatPdfPercent(opSummary.circularite), this.formatPdfCurrency(opSummary.bilanMonetaire)]);
        this.appendPdfTable(evalCard, ['Orientation', 'Volume', 'Prix / bilan'], evalRows, { fontSize: '8px', compact: true, lineHeight: '1.2' });

        leftCol.appendChild(metaCard);
        leftCol.appendChild(lotCard);
        leftCol.appendChild(inspectionCard);
        leftCol.appendChild(evalCard);

        if (jaugesCard) rightCol.appendChild(jaugesCard);
        radarCard.style.marginTop = 'auto';
        rightCol.appendChild(radarCard);

        topRow.appendChild(leftCol);
        topRow.appendChild(rightCol);

        // ══ MOITIÉ BASSE : 10 blocs de notation en 5 colonnes × 2 lignes ══
        const bottomGrid = document.createElement('div');
        bottomGrid.style.display = 'grid';
        bottomGrid.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
        bottomGrid.style.gap = '8px';
        bottomGrid.style.alignItems = 'start';

        this.getPdfSectionDefinitions()
            .filter((s) => s.key !== 'inspection')
            .forEach((sectionDef) => {
                const sCard = this.createPdfCard(sectionDef.title);
                sCard.style.padding = '7px';
                this.appendPdfTable(
                    sCard,
                    ['Critère', 'Niveau', 'Note'],
                    sectionDef.rows.map((rowDef) => {
                        const rv = this.getPdfNotationRowValue(currentLot, sectionDef.key, rowDef.key);
                        return [rowDef.label, rv.niveau, rv.note];
                    }),
                    { fontSize: '7.5px', compact: true, lineHeight: '1.15' }
                );
                bottomGrid.appendChild(sCard);
            });

        exportRoot.appendChild(topRow);
        exportRoot.appendChild(bottomGrid);

        return exportRoot;
    }

    addPdfPageNumbers(pdf) {
        const totalPages = pdf.getNumberOfPages();
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 20;
        const pageLabelY = pageHeight - (margin / 2);

        for (let page = 1; page <= totalPages; page += 1) {
            pdf.setPage(page);
            pdf.setFontSize(9);
            pdf.setTextColor(70, 70, 70);
            pdf.text(`Page ${page} / ${totalPages}`, pageWidth / 2, pageLabelY, { align: 'center' });
        }
    }

    normalizeDecimalForCsv(value) {
        if (value == null) return '';
        if (typeof value === 'number') return Number.isFinite(value) ? value : '';
        return String(value).replace(/(\d),(\d)/g, '$1.$2');
    }

    escapeCsvValue(value) {
        const normalized = value == null ? '' : String(value);
        return '"' + normalized.replace(/"/g, '""') + '"';
    }

    downloadCsvFile(filename, headers, rows) {
        const lines = [];
        lines.push(headers.map((h) => this.escapeCsvValue(h)).join(';'));
        rows.forEach((row) => {
            lines.push(row.map((cell) => this.escapeCsvValue(cell)).join(';'));
        });

        const csvContent = '\uFEFF' + lines.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    buildCsvRowsForLots(lotIndices) {
        const categories = this.getPdfCategoryDefinitions();
        const sections = this.getPdfSectionDefinitions();
        const meta = this.data.meta || {};

        const headers = ['Champ'].concat(
            lotIndices.map((index) => this.getPdfLotLabel(this.data.lots[index], index))
        );

        const fieldDefs = [
            { label: 'Référence gisement', getValue: () => this.getReferenceGisement(meta) || '' },
            { label: 'Opération', getValue: () => meta.operation || '' },
            { label: 'Diagnostiqueur', getValue: () => meta.diagnostiqueurContact || '' },
            { label: 'Localisation', getValue: () => meta.localisation || '' },
            { label: 'Date', getValue: () => meta.date || '' },
            { label: 'Commentaires', getValue: () => meta.commentaires || '' },
            { label: 'Type de pièces', getValue: (lot) => ((lot && lot.allotissement) || {}).typePiece || '' },
            { label: 'Essence', getValue: (lot) => {
                const allotissement = (lot && lot.allotissement) || {};
                return allotissement.essenceNomCommun || allotissement.essence || '';
            } },
            { label: 'Quantité', getValue: (lot) => {
                const v = ((lot && lot.allotissement) || {}).quantite;
                return v != null ? v : '';
            } },
            { label: 'Longueur (mm)', getValue: (lot) => {
                const v = ((lot && lot.allotissement) || {}).longueur;
                return v != null ? v : '';
            } },
            { label: 'Largeur (mm)', getValue: (lot) => {
                const v = ((lot && lot.allotissement) || {}).largeur;
                return v != null ? v : '';
            } },
            { label: 'Hauteur (mm)', getValue: (lot) => {
                const v = ((lot && lot.allotissement) || {}).hauteur;
                return v != null ? v : '';
            } },
            { label: 'Volume lot (m3)', getValue: (lot) => parseFloat((((lot && lot.allotissement) || {}).volumeLot)) || 0 },
            { label: 'Prix marché (/m3)', getValue: (lot) => parseFloat((((lot && lot.allotissement) || {}).prixMarche)) || 0 },
            { label: 'Prix lot (€)', getValue: (lot) => Math.round(parseFloat((((lot && lot.allotissement) || {}).prixLot)) || 0) },
            { label: 'Orientation', getValue: (lot) => this.getPdfOrientationSummary(lot).label },
            { label: 'Orientation (%)', getValue: (lot) => this.formatPdfDecimal(this.getPdfOrientationSummary(lot).percentage, 1, 1) }
        ];

        categories.forEach((category) => {
            fieldDefs.push({
                label: `Score ${category.label} (/30)`,
                getValue: (lot) => parseFloat(this.getPdfOrientationSummary(lot).scores[category.key]) || 0
            });
        });

        sections.forEach((section) => {
            section.rows.forEach((rowDef) => {
                fieldDefs.push({
                    label: `${section.title} - ${rowDef.label} (Niveau)`,
                    getValue: (lot) => this.getPdfNotationRowValue(lot, section.key, rowDef.key).niveau || ''
                });
                fieldDefs.push({
                    label: `${section.title} - ${rowDef.label} (Note)`,
                    getValue: (lot) => this.getPdfNotationRowValue(lot, section.key, rowDef.key).note || ''
                });
            });
        });

        const rows = fieldDefs.map((field) => {
            const row = [field.label];
            lotIndices.forEach((index) => {
                row.push(this.normalizeDecimalForCsv(field.getValue(this.data.lots[index], index)));
            });
            return row;
        });

        return { headers, rows };
    }

    exportToCsv(mode = 'synthese', lotIndices = []) {
        let validLotIndices = [];

        if (mode === 'synthese') {
            validLotIndices = (this.data.lots || []).map((_, index) => index);
        } else {
            validLotIndices = Array.isArray(lotIndices)
                ? lotIndices.filter((index) => Number.isInteger(index) && this.data.lots[index])
                : [];
        }

        if (!validLotIndices.length) {
            alert('Aucun lot valide sélectionné pour l’export CSV.');
            return;
        }

        const { headers, rows } = this.buildCsvRowsForLots(validLotIndices);
        const stamp = new Date().toISOString().slice(0, 10);
        const suffix = mode === 'synthese'
            ? 'synthese'
            : (validLotIndices.length > 1 ? 'lots_selectionnes' : 'lot_selectionne');

        this.downloadCsvFile(`valobois_evaluation_${suffix}_${stamp}.csv`, headers, rows);
    }

    exportToPdf(mode = 'synthese', lotIndices = []) {
        if (typeof html2canvas === 'undefined' || (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined')) {
            alert('Export PDF indisponible (bibliothèques manquantes).');
            return;
        }

        if (mode === 'lots-selectionnes') {
            this.exportSelectedLotsToPdf(lotIndices);
            return;
        }

        const root = this.createPdfSynthesisRoot();
        if (!root) {
            alert('Export PDF indisponible (contenu introuvable).');
            return;
        }

        html2canvas(root, {
            scrollY: -window.scrollY,
            scale: 1.4,
            backgroundColor: '#ffffff'
        }).then((canvas) => {
            const targetBytes = Math.floor(this.getPdfMaxBytes() * 0.78);
            const compressedImage = this.createCompressedImageData(canvas, targetBytes);
            const { jsPDF } = window.jspdf || window;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const contentWidth = pageWidth - (margin * 2);
            const contentHeight = pageHeight - (margin * 2);
            const imgWidth = contentWidth;
            const imgHeight = compressedImage.height * imgWidth / compressedImage.width;
            let position = margin;
            let heightLeft = imgHeight;
            pdf.addImage(compressedImage.dataUrl, 'JPEG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
            heightLeft -= contentHeight;
            while (heightLeft > 0) {
                pdf.addPage();
                position = margin - (imgHeight - heightLeft);
                pdf.addImage(compressedImage.dataUrl, 'JPEG', margin, position, imgWidth, imgHeight, undefined, 'FAST');
                heightLeft -= contentHeight;
            }
            this.addPdfPageNumbers(pdf);
            const now = new Date();
            const stamp = now.toISOString().slice(0, 10);
            pdf.save(`valobois_evaluation_synthese_${stamp}.pdf`);
        }).catch((error) => {
            console.error(error);
            alert('Une erreur est survenue pendant la génération du PDF.');
        }).finally(() => {
            if (root && root.parentNode) {
                root.parentNode.removeChild(root);
            }
        });

    }

    async exportSelectedLotsToPdf(lotIndices) {
        const validLotIndices = Array.isArray(lotIndices) ? lotIndices.filter((index) => Number.isInteger(index) && this.data.lots[index]) : [];
        if (!validLotIndices.length) {
            alert('Aucun lot valide sélectionné pour l’export.');
            return;
        }

        const previousLotIndex = this.currentLotIndex;
        const { jsPDF } = window.jspdf || window;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const perLotTargetBytes = Math.max(350 * 1024, Math.floor((this.getPdfMaxBytes() * 0.82) / validLotIndices.length));

        try {
            for (let pageIndex = 0; pageIndex < validLotIndices.length; pageIndex += 1) {
                const lotIndex = validLotIndices[pageIndex];
                this.currentLotIndex = lotIndex;
                this.render();

                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

                const root = this.createPdfActiveLotRoot(lotIndex);
                if (!root) continue;

                try {
                    const canvas = await html2canvas(root, {
                        scrollY: -window.scrollY,
                        scale: 1.25,
                        backgroundColor: '#ffffff'
                    });

                    const compressedImage = this.createCompressedImageData(canvas, perLotTargetBytes);
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    const margin = 10;
                    const contentWidth = pageWidth - (margin * 2);
                    const contentHeight = pageHeight - (margin * 2);
                    const ratio = Math.min(contentWidth / compressedImage.width, contentHeight / compressedImage.height);
                    const imgWidth = compressedImage.width * ratio;
                    const imgHeight = compressedImage.height * ratio;
                    const x = margin + ((contentWidth - imgWidth) / 2);
                    const y = margin;

                    if (pageIndex > 0) pdf.addPage();
                    pdf.addImage(compressedImage.dataUrl, 'JPEG', x, y, imgWidth, imgHeight, undefined, 'FAST');
                } finally {
                    if (root.parentNode) root.parentNode.removeChild(root);
                }
            }

            this.addPdfPageNumbers(pdf);

            const stamp = new Date().toISOString().slice(0, 10);
            const suffix = validLotIndices.length > 1 ? 'lots_selectionnes' : 'lot_selectionne';
            pdf.save(`valobois_evaluation_${suffix}_${stamp}.pdf`);
        } catch (error) {
            console.error(error);
            alert('Une erreur est survenue pendant la génération du PDF.');
        } finally {
            this.currentLotIndex = previousLotIndex;
            this.render();
        }
    }
   
} // FERMETURE DE LA CLASSE ValoboisApp

window.addEventListener('DOMContentLoaded', () => {
    new ValoboisApp();
});
