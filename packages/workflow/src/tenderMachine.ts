import { createMachine, assign, type StateFrom } from 'xstate'

// ==========================================
// TYPES DES 15 PHASES
// ==========================================
export type TenderPhase =
  | 'PHASE_1_PROGRAMMATION'
  | 'PHASE_2_REDACTION'
  | 'PHASE_3_VALIDATION_PRIORI'
  | 'PHASE_4_PUBLICATION'
  | 'PHASE_5_CLARIFICATIONS'
  | 'PHASE_6_DEPOT_OFFRES'
  | 'PHASE_7_OUVERTURE_PLIS'
  | 'PHASE_8_EVALUATION'
  | 'PHASE_9_ATTRIBUTION_PROVISOIRE'
  | 'PHASE_10_RECOURS'
  | 'PHASE_11_ATTRIBUTION_DEFINITIVE'
  | 'PHASE_12_SIGNATURE_CONTRAT'
  | 'PHASE_13_EXECUTION'
  | 'PHASE_14_RECEPTION_PAIEMENT'
  | 'PHASE_15_CLOTURE_ARCHIVAGE'

// ==========================================
// CONTEXTE DE LA MACHINE À ÉTATS
// ==========================================
export interface TenderContext {
  tenderId: string
  institutionId: string
  currentPhase: TenderPhase
  montantEstime: number
  montantInitial?: number
  montantAvenantsCumule: number  // Contrôle 30%
  montantSoustraitCumule: number // Contrôle 40%
  datePublicationAt?: Date
  dateLimitDepotAt?: Date
  hasAppealPending: boolean       // HARD LOCK Phase 11
  arcopDecision?: 'REJETE' | 'IRRECEVABLE' | 'FAVORABLE' | 'EN_COURS'
  dcmpAvisReceived: boolean       // Avis DCMP reçu
  offresChiffrees: boolean        // Offres chiffrées (Phase 6)
  plisDecryptedAt?: Date          // Déchiffrement effectué (Phase 7)
  pvOuvertureGenere: boolean      // PV ouverture généré
  contractSigned: boolean
  error?: string
}

// ==========================================
// ÉVÉNEMENTS (Transitions)
// ==========================================
export type TenderEvent =
  | { type: 'VALIDER_PPM' }
  | { type: 'FINALISER_DAO' }
  | { type: 'RECEVOIR_AVIS_DCMP'; avis: 'FAVORABLE' | 'DEFAVORABLE' | 'COMPLEMENTAIRE' }
  | { type: 'PUBLIER_AO' }
  | { type: 'OUVRIR_DEPOT' }
  | { type: 'FERMER_DEPOT' }
  | { type: 'DECLENCHER_OUVERTURE'; userId: string; presidentId: string }  // Multi-signature
  | { type: 'FINALISER_EVALUATION' }
  | { type: 'PRONONCER_ATTRIBUTION_PROVISOIRE'; attributaireId: string; montant: number }
  | { type: 'OUVRIR_PERIODE_RECOURS' }
  | { type: 'SIGNALER_RECOURS_DEPOSE' }
  | { type: 'CLORE_PERIODE_RECOURS' }
  | { type: 'DECISION_ARCOP'; decision: 'REJETE' | 'IRRECEVABLE' | 'FAVORABLE'; note?: string }
  | { type: 'CONFIRMER_ATTRIBUTION_DEFINITIVE' }
  | { type: 'SIGNER_CONTRAT' }
  | { type: 'DEMARRER_EXECUTION' }
  | { type: 'CONSTATER_RECEPTION_PROVISOIRE' }
  | { type: 'CONSTATER_RECEPTION_DEFINITIVE' }
  | { type: 'CLORE_MARCHE' }

// ==========================================
// MACHINE À ÉTATS PRINCIPALE (XState v5)
// Conforme Décret n°2022-2295
// ==========================================
export const tenderMachine = createMachine({
  id: 'tenderWorkflow',
  initial: 'PHASE_1_PROGRAMMATION',
  types: {} as {
    context: TenderContext
    events: TenderEvent
  },
  context: ({ input }: { input: Partial<TenderContext> }) => ({
    tenderId: input.tenderId ?? '',
    institutionId: input.institutionId ?? '',
    currentPhase: 'PHASE_1_PROGRAMMATION' as TenderPhase,
    montantEstime: input.montantEstime ?? 0,
    montantAvenantsCumule: 0,
    montantSoustraitCumule: 0,
    hasAppealPending: false,
    dcmpAvisReceived: false,
    offresChiffrees: false,
    pvOuvertureGenere: false,
    contractSigned: false,
  }),

  states: {
    // ==================
    // PHASE 1 : Programmation budgétaire & PPM
    // ==================
    PHASE_1_PROGRAMMATION: {
      meta: {
        label: 'Programmation budgétaire',
        actors: ['SERVICE_DEMANDEUR', 'PRM'],
        description: 'Inscription du besoin dans le budget-programme et le PPM',
      },
      on: {
        VALIDER_PPM: {
          target: 'PHASE_2_REDACTION',
          guard: ({ context }) => context.montantEstime > 0,
          actions: assign({ currentPhase: 'PHASE_2_REDACTION' }),
        },
      },
    },

    // ==================
    // PHASE 2 : Rédaction TDR / DAO
    // ==================
    PHASE_2_REDACTION: {
      meta: {
        label: 'Rédaction TDR/DAO',
        actors: ['SERVICE_DEMANDEUR', 'CPM', 'PRM'],
        description: 'Élaboration du dossier - TDR ou DAO selon la nature du marché',
      },
      on: {
        FINALISER_DAO: {
          target: 'PHASE_3_VALIDATION_PRIORI',
          actions: assign({ currentPhase: 'PHASE_3_VALIDATION_PRIORI' }),
        },
      },
    },

    // ==================
    // PHASE 3 : Contrôle a priori (DCMP / Bailleur)
    // ==================
    PHASE_3_VALIDATION_PRIORI: {
      meta: {
        label: 'Contrôle a priori DCMP',
        actors: ['PRM', 'DCMP', 'BAILLEUR'],
        description: 'Avis de non-objection DCMP obligatoire avant publication',
      },
      on: {
        RECEVOIR_AVIS_DCMP: [
          {
            // Avis favorable → publication possible
            guard: ({ event }) => event.avis === 'FAVORABLE',
            target: 'PHASE_4_PUBLICATION',
            actions: assign({
              currentPhase: 'PHASE_4_PUBLICATION',
              dcmpAvisReceived: true,
            }),
          },
          {
            // Avis défavorable → retour rédaction
            guard: ({ event }) => event.avis === 'DEFAVORABLE',
            target: 'PHASE_2_REDACTION',
            actions: assign({
              currentPhase: 'PHASE_2_REDACTION',
              dcmpAvisReceived: false,
            }),
          },
          {
            // Avis complémentaire → retour en rédaction pour correction
            guard: ({ event }) => event.avis === 'COMPLEMENTAIRE',
            target: 'PHASE_2_REDACTION',
            actions: assign({ currentPhase: 'PHASE_2_REDACTION', dcmpAvisReceived: false }),
          },
        ],
      },
    },

    // ==================
    // PHASE 4 : Publication de l'AO
    // ==================
    PHASE_4_PUBLICATION: {
      meta: {
        label: 'Publication AO',
        actors: ['CPM'],
        description: 'Publication multicanal - Portail national + Plateforme',
      },
      on: {
        PUBLIER_AO: {
          target: 'PHASE_5_CLARIFICATIONS',
          guard: ({ context }) => context.dcmpAvisReceived,
          actions: assign({
            currentPhase: 'PHASE_5_CLARIFICATIONS',
            datePublicationAt: new Date(),
          }),
        },
      },
    },

    // ==================
    // PHASE 5 : Retrait et clarifications
    // ==================
    PHASE_5_CLARIFICATIONS: {
      meta: {
        label: 'Retrait et clarifications',
        actors: ['CPM', 'SOUMISSIONNAIRE'],
        description: 'Téléchargement DAO, Q&R, additifs horodatés',
      },
      on: {
        OUVRIR_DEPOT: {
          target: 'PHASE_6_DEPOT_OFFRES',
          actions: assign({ currentPhase: 'PHASE_6_DEPOT_OFFRES' }),
        },
      },
    },

    // ==================
    // PHASE 6 : Dépôt des offres (Coffre-fort cryptographique)
    // ==================
    PHASE_6_DEPOT_OFFRES: {
      meta: {
        label: 'Dépôt des offres',
        actors: ['SOUMISSIONNAIRE'],
        description: 'Dépôt sécurisé AES-256. Offres chiffrées jusqu\'à Phase 7.',
        critical: true,
      },
      entry: assign({ offresChiffrees: true }),
      on: {
        FERMER_DEPOT: {
          // GUARD : La date limite doit être dépassée (vérification côté serveur aussi)
          guard: ({ context }) =>
            context.dateLimitDepotAt ? new Date() >= context.dateLimitDepotAt : false,
          target: 'PHASE_7_OUVERTURE_PLIS',
          actions: assign({ currentPhase: 'PHASE_7_OUVERTURE_PLIS' }),
        },
      },
    },

    // ==================
    // PHASE 7 : Ouverture officielle des plis (Multi-signature)
    // CRITIQUE : Déchiffrement des offres financières
    // ==================
    PHASE_7_OUVERTURE_PLIS: {
      meta: {
        label: 'Ouverture des plis',
        actors: ['CPM', 'COMMISSION'],
        description: 'Déchiffrement des offres par action conjointe. PV généré automatiquement.',
        critical: true,
      },
      on: {
        DECLENCHER_OUVERTURE: {
          // GUARD : Requiert l'action de DEUX personnes (CPM + Président Commission)
          guard: ({ event }) => Boolean(event.userId && event.presidentId && event.userId !== event.presidentId),
          target: 'PHASE_8_EVALUATION',
          actions: assign({
            currentPhase: 'PHASE_8_EVALUATION',
            offresChiffrees: false,
            plisDecryptedAt: new Date(),
            pvOuvertureGenere: true,
          }),
        },
      },
    },

    // ==================
    // PHASE 8 : Évaluation technique et financière
    // ==================
    PHASE_8_EVALUATION: {
      meta: {
        label: 'Évaluation des offres',
        actors: ['COMMISSION', 'EVALUATEUR'],
        description: 'Notation pondérée. Masquage des identités si requis.',
      },
      on: {
        FINALISER_EVALUATION: {
          target: 'PHASE_9_ATTRIBUTION_PROVISOIRE',
          guard: ({ context }) => context.pvOuvertureGenere,
          actions: assign({ currentPhase: 'PHASE_9_ATTRIBUTION_PROVISOIRE' }),
        },
      },
    },

    // ==================
    // PHASE 9 : Attribution provisoire
    // ==================
    PHASE_9_ATTRIBUTION_PROVISOIRE: {
      meta: {
        label: 'Attribution provisoire',
        actors: ['PRM', 'CPM'],
        description: 'Décision provisoire + notification à tous les candidats',
      },
      on: {
        PRONONCER_ATTRIBUTION_PROVISOIRE: {
          target: 'PHASE_10_RECOURS',
          actions: assign(({ event }) => ({
            currentPhase: 'PHASE_10_RECOURS' as TenderPhase,
            montantInitial: event.montant,
          })),
        },
      },
    },

    // ==================
    // PHASE 10 : Délai de recours (ARCOP)
    // HARD LOCK : Phase 11 impossible si recours actif
    // ==================
    PHASE_10_RECOURS: {
      meta: {
        label: 'Délai de recours ARCOP',
        actors: ['SOUMISSIONNAIRE', 'ARCOP'],
        description: 'Délai légal de recours. Attribution définitive bloquée si recours pending.',
        hardLock: true,
      },
      on: {
        SIGNALER_RECOURS_DEPOSE: {
          actions: assign({ hasAppealPending: true }),
        },
        DECISION_ARCOP: [
          {
            // Recours rejeté ou irrecevable → Phase 11 débloquée
            guard: ({ event }) =>
              event.decision === 'REJETE' || event.decision === 'IRRECEVABLE',
            target: 'PHASE_11_ATTRIBUTION_DEFINITIVE',
            actions: assign(({ event }) => ({
              currentPhase: 'PHASE_11_ATTRIBUTION_DEFINITIVE' as TenderPhase,
              hasAppealPending: false,
              arcopDecision: event.decision,
            })),
          },
          {
            // Recours favorable → Reprise de la procédure (Phase 8)
            guard: ({ event }) => event.decision === 'FAVORABLE',
            target: 'PHASE_8_EVALUATION',
            actions: assign(({ event }) => ({
              currentPhase: 'PHASE_8_EVALUATION' as TenderPhase,
              hasAppealPending: false,
              arcopDecision: event.decision,
            })),
          },
        ],
        CLORE_PERIODE_RECOURS: {
          // Pas de recours déposé dans le délai légal
          guard: ({ context }) => !context.hasAppealPending,
          target: 'PHASE_11_ATTRIBUTION_DEFINITIVE',
          actions: assign({
            currentPhase: 'PHASE_11_ATTRIBUTION_DEFINITIVE',
            hasAppealPending: false,
          }),
        },
      },
    },

    // ==================
    // PHASE 11 : Attribution définitive
    // ==================
    PHASE_11_ATTRIBUTION_DEFINITIVE: {
      meta: {
        label: 'Attribution définitive',
        actors: ['PRM', 'DCMP'],
        description: 'Confirmation après purge des recours. Approbation autorité compétente.',
      },
      // GUARD GLOBAL : Impossible si recours encore actif
      entry: ({ context }) => {
        if (context.hasAppealPending) {
          throw new Error(
            'HARD_LOCK: Attribution définitive impossible. Un recours ARCOP est en cours.'
          )
        }
      },
      on: {
        CONFIRMER_ATTRIBUTION_DEFINITIVE: {
          guard: ({ context }) => !context.hasAppealPending,
          target: 'PHASE_12_SIGNATURE_CONTRAT',
          actions: assign({ currentPhase: 'PHASE_12_SIGNATURE_CONTRAT' }),
        },
      },
    },

    // ==================
    // PHASE 12 : Signature du contrat
    // ==================
    PHASE_12_SIGNATURE_CONTRAT: {
      meta: {
        label: 'Signature du contrat',
        actors: ['PRM', 'ATTRIBUTAIRE', 'TRESOR'],
        description: 'Génération contrat, garanties, signature ADIE, visa budgétaire',
      },
      on: {
        SIGNER_CONTRAT: {
          target: 'PHASE_13_EXECUTION',
          actions: assign({ currentPhase: 'PHASE_13_EXECUTION', contractSigned: true }),
        },
      },
    },

    // ==================
    // PHASE 13 : Exécution (OS, Avenants 30%, Sous-traitance 40%)
    // ==================
    PHASE_13_EXECUTION: {
      meta: {
        label: 'Exécution du marché',
        actors: ['PRM', 'ATTRIBUTAIRE', 'CPM'],
        description: 'Ordres de Service. HARD LOCK: Avenant > 30% | Sous-traitance > 40%',
        hardLock: true,
      },
      on: {
        CONSTATER_RECEPTION_PROVISOIRE: {
          guard: ({ context }) => {
            const ratio30 = context.montantInitial
              ? context.montantAvenantsCumule / context.montantInitial
              : 0
            const ratio40 = context.montantInitial
              ? context.montantSoustraitCumule / context.montantInitial
              : 0
            if (ratio30 > 0.3) throw new Error('AVENANT_30_EXCEEDED')
            if (ratio40 > 0.4) throw new Error('SOUSTRAITANCE_40_EXCEEDED')
            return context.contractSigned
          },
          target: 'PHASE_14_RECEPTION_PAIEMENT',
          actions: assign({ currentPhase: 'PHASE_14_RECEPTION_PAIEMENT' }),
        },
      },
    },

    // ==================
    // PHASE 14 : Réception et paiement
    // ==================
    PHASE_14_RECEPTION_PAIEMENT: {
      meta: {
        label: 'Réception et paiement',
        actors: ['COMMISSION_RECEPTION', 'TRESOR'],
        description: 'PV réception provisoire/définitive. Décomptes → SIGFIP.',
      },
      on: {
        CONSTATER_RECEPTION_DEFINITIVE: {
          target: 'PHASE_15_CLOTURE_ARCHIVAGE',
          actions: assign({ currentPhase: 'PHASE_15_CLOTURE_ARCHIVAGE' }),
        },
      },
    },

    // ==================
    // PHASE 15 : Clôture et archivage (WORM)
    // ==================
    PHASE_15_CLOTURE_ARCHIVAGE: {
      meta: {
        label: 'Clôture et archivage',
        actors: ['CPM', 'ADMIN'],
        description: 'Archive WORM immuable. Évaluation prestataire. Export PDF/A.',
      },
      type: 'final',
    },
  },
})

// ==========================================
// TYPES EXPORTÉS
// ==========================================
export type TenderMachineState = StateFrom<typeof tenderMachine>

// Helper : Obtenir le label d'une phase
export function getPhaseLabel(phase: TenderPhase): string {
  const labels: Record<TenderPhase, string> = {
    PHASE_1_PROGRAMMATION: '1. Programmation & PPM',
    PHASE_2_REDACTION: '2. Rédaction TDR/DAO',
    PHASE_3_VALIDATION_PRIORI: '3. Contrôle a priori DCMP',
    PHASE_4_PUBLICATION: '4. Publication AO',
    PHASE_5_CLARIFICATIONS: '5. Clarifications & Q&R',
    PHASE_6_DEPOT_OFFRES: '6. Dépôt des offres',
    PHASE_7_OUVERTURE_PLIS: '7. Ouverture des plis',
    PHASE_8_EVALUATION: '8. Évaluation',
    PHASE_9_ATTRIBUTION_PROVISOIRE: '9. Attribution provisoire',
    PHASE_10_RECOURS: '10. Recours ARCOP',
    PHASE_11_ATTRIBUTION_DEFINITIVE: '11. Attribution définitive',
    PHASE_12_SIGNATURE_CONTRAT: '12. Signature contrat',
    PHASE_13_EXECUTION: '13. Exécution',
    PHASE_14_RECEPTION_PAIEMENT: '14. Réception & paiement',
    PHASE_15_CLOTURE_ARCHIVAGE: '15. Clôture & archivage',
  }
  return labels[phase] ?? phase
}

// Helper : Calculer mode de passation selon seuils
export function calculerModePassation(
  montant: number,
  nature: 'TRAVAUX' | 'FOURNITURES' | 'SERVICES_COURANTS' | 'PRESTATIONS_INTELLECTUELLES',
  typeInstitution: 'ETAT' | 'AGENCE'
): 'AOO' | 'AOR' | 'DRP' {
  const seuils = {
    ETAT: { TRAVAUX: 70_000_000, AUTRES: 50_000_000 },
    AGENCE: { TRAVAUX: 100_000_000, AUTRES: 60_000_000 },
  }

  const seuil =
    nature === 'TRAVAUX'
      ? seuils[typeInstitution].TRAVAUX
      : seuils[typeInstitution].AUTRES

  if (montant >= seuil) return 'AOO'
  if (montant >= seuil * 0.5) return 'AOR'
  return 'DRP'
}
