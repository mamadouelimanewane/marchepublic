-- ==========================================
-- Migration 0016 : Inclusion des PME — dossier permanent du fournisseur et alertes d'appels d'offres
--   • Coffre de pièces administratives réutilisables (quitus fiscal, RCCM, CNSS…) avec dates de validité et vérification
--   • Alertes par secteur / nature / montant, par e-mail, SMS ou WhatsApp, via une file d'envoi (outbox) indépendante du fournisseur
-- ==========================================

INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('FOURNISSEUR_PIECES_REQUISES', 'QUITUS_FISCAL,RCCM,ATTESTATION_CNSS', 'Pièces administratives exigées pour être réputé en règle (types séparés par des virgules)'),
  ('ALERTE_PIECE_JOURS', '30', 'Alerte avant expiration d''une pièce du dossier fournisseur (jours)'),
  ('URL_PORTAIL', 'https://marchepublic.example', 'URL publique du portail, insérée dans les alertes — à remplacer par l''adresse réelle')
ON CONFLICT (cle) DO NOTHING;

-- ------------------------------------------
-- 1. DOSSIER PERMANENT DU FOURNISSEUR
-- ------------------------------------------
CREATE TABLE supplier_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  type TEXT NOT NULL CHECK (type IN ('QUITUS_FISCAL', 'RCCM', 'NINEA', 'ATTESTATION_CNSS', 'ATTESTATION_BANCAIRE', 'REFERENCE_MARCHE', 'AUTRE')),
  titre TEXT NOT NULL CHECK (char_length(titre) BETWEEN 3 AND 200),
  date_emission DATE,
  date_expiration DATE,
  storage_path TEXT NOT NULL,
  file_hash TEXT NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  statut TEXT NOT NULL DEFAULT 'DEPOSE' CHECK (statut IN ('DEPOSE', 'VERIFIE', 'REFUSE')),
  motif_refus TEXT,
  verifie_par UUID REFERENCES users(id),
  verifie_le TIMESTAMPTZ,
  alerte_expiration_envoyee BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_expiration IS NULL OR date_emission IS NULL OR date_expiration >= date_emission)
);
CREATE INDEX idx_supplier_docs_user ON supplier_documents (user_id, type, date_expiration DESC);
ALTER TABLE supplier_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_docs_owner_select" ON supplier_documents FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "supplier_docs_staff_select" ON supplier_documents FOR SELECT USING (bidder_visible_to_staff(user_id));
CREATE POLICY "supplier_docs_oversight_select" ON supplier_documents FOR SELECT USING (is_regulateur() OR current_user_role() = 'COUR_COMPTES');
CREATE POLICY "supplier_docs_owner_insert" ON supplier_documents FOR INSERT WITH CHECK (user_id = auth.uid() AND current_user_role() = 'SOUMISSIONNAIRE');
CREATE POLICY "supplier_docs_owner_delete" ON supplier_documents FOR DELETE USING (user_id = auth.uid() AND statut = 'DEPOSE');
REVOKE UPDATE ON supplier_documents FROM anon, authenticated;

-- Le fournisseur ne s'attribue jamais un statut vérifié : tout dépôt part de DEPOSE.
CREATE OR REPLACE FUNCTION supplier_documents_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND TG_OP = 'INSERT' THEN
    NEW.statut := 'DEPOSE'; NEW.motif_refus := NULL; NEW.verifie_par := NULL; NEW.verifie_le := NULL; NEW.alerte_expiration_envoyee := false;
    IF (storage.foldername(NEW.storage_path))[1] IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'INVALID_PATH: le fichier doit se trouver dans votre dossier personnel';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_supplier_documents_guard BEFORE INSERT ON supplier_documents FOR EACH ROW EXECUTE FUNCTION supplier_documents_guard();
CREATE TRIGGER trig_audit_supplier_documents AFTER INSERT OR UPDATE OR DELETE ON supplier_documents FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Stockage privé : le fichier n'est lisible que par qui peut lire la ligne correspondante (RLS ci-dessus).
INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-docs', 'supplier-docs', false) ON CONFLICT (id) DO UPDATE SET public = false;
CREATE POLICY "supplier_files_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'supplier-docs' AND (storage.foldername(name))[1] = auth.uid()::text AND current_user_role() = 'SOUMISSIONNAIRE');
CREATE POLICY "supplier_files_read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'supplier-docs' AND EXISTS (SELECT 1 FROM supplier_documents d WHERE d.storage_path = name));

-- Vérification par l'administration (ADMIN ou DCMP) : toute décision de refus est motivée.
CREATE OR REPLACE FUNCTION review_supplier_document(p_doc UUID, p_statut TEXT, p_motif TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_d supplier_documents%ROWTYPE;
BEGIN
  IF current_user_role() NOT IN ('ADMIN', 'DCMP') THEN RAISE EXCEPTION 'FORBIDDEN: vérification réservée à l''administration'; END IF;
  IF p_statut NOT IN ('VERIFIE', 'REFUSE') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_statut = 'REFUSE' AND char_length(COALESCE(p_motif, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif de refus obligatoire'; END IF;
  SELECT * INTO v_d FROM supplier_documents WHERE id = p_doc FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
  IF v_d.statut <> 'DEPOSE' THEN RAISE EXCEPTION 'INVALID_STATE: pièce déjà traitée (%)', v_d.statut; END IF;
  UPDATE supplier_documents SET statut = p_statut, motif_refus = CASE WHEN p_statut = 'REFUSE' THEN p_motif END, verifie_par = auth.uid(), verifie_le = NOW() WHERE id = p_doc;
  PERFORM notify_user(v_d.user_id, NULL, 'PIECE_' || p_statut, CASE WHEN p_statut = 'VERIFIE' THEN 'Pièce vérifiée' ELSE 'Pièce refusée' END,
                      v_d.titre || COALESCE(' : ' || p_motif, ''));
END $$;
GRANT EXECUTE ON FUNCTION review_supplier_document(UUID, TEXT, TEXT) TO authenticated;

-- État des pièces requises d'un fournisseur à une date donnée (ex. la date limite de dépôt).
-- Accessible au titulaire, au personnel qui peut voir ce candidat (après ouverture), aux régulateurs et à l'administration.
CREATE OR REPLACE FUNCTION supplier_pieces(p_user UUID, p_at DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (type TEXT, situation TEXT, date_expiration DATE, doc_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
#variable_conflict use_variable
DECLARE v_type TEXT;
BEGIN
  IF NOT (p_user = auth.uid() OR bidder_visible_to_staff(p_user) OR is_regulateur() OR current_user_role() IN ('COUR_COMPTES', 'ADMIN')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  FOREACH v_type IN ARRAY string_to_array(COALESCE((SELECT valeur FROM config_seuils WHERE cle = 'FOURNISSEUR_PIECES_REQUISES'), ''), ',') LOOP
    type := trim(v_type);
    SELECT d.id, d.date_expiration,
           CASE WHEN d.statut = 'VERIFIE' AND (d.date_expiration IS NULL OR d.date_expiration >= p_at) THEN 'VALIDE'
                WHEN d.statut = 'VERIFIE' THEN 'EXPIRE'
                WHEN d.statut = 'DEPOSE' THEN 'NON_VERIFIE'
                ELSE 'REFUSE' END
      INTO doc_id, date_expiration, situation
      FROM supplier_documents d WHERE d.user_id = p_user AND d.type = type
      ORDER BY (d.statut = 'VERIFIE' AND (d.date_expiration IS NULL OR d.date_expiration >= p_at)) DESC, d.created_at DESC LIMIT 1;
    IF NOT FOUND THEN situation := 'ABSENT'; doc_id := NULL; date_expiration := NULL; END IF;
    RETURN NEXT;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION supplier_pieces(UUID, DATE) TO authenticated;

-- ------------------------------------------
-- 2. FILE D'ENVOI (outbox) : e-mail, SMS, WhatsApp — le canal réel est branché par le worker
-- ------------------------------------------
CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tender_id UUID REFERENCES tenders(id) ON DELETE SET NULL,
  canal TEXT NOT NULL CHECK (canal IN ('EMAIL', 'SMS', 'WHATSAPP')),
  destinataire TEXT NOT NULL,
  sujet TEXT NOT NULL,
  corps TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'PENDING' CHECK (statut IN ('PENDING', 'SENT', 'FAILED')),
  tentatives INTEGER NOT NULL DEFAULT 0,
  derniere_erreur TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox_messages (created_at) WHERE statut = 'PENDING';
ALTER TABLE outbox_messages ENABLE ROW LEVEL SECURITY;                 -- aucune politique : service uniquement
REVOKE ALL ON outbox_messages FROM anon, authenticated;

CREATE TABLE tender_alert_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  corps_metier_id UUID REFERENCES corps_metiers(id),
  nature nature_marche,
  montant_min BIGINT CHECK (montant_min IS NULL OR montant_min >= 0),
  canal TEXT NOT NULL DEFAULT 'EMAIL' CHECK (canal IN ('EMAIL', 'SMS', 'WHATSAPP')),
  destinataire TEXT NOT NULL,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dest_format CHECK ((canal = 'EMAIL' AND destinataire ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') OR (canal <> 'EMAIL' AND destinataire ~ '^\+?[0-9]{8,15}$'))
);
ALTER TABLE tender_alert_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_subs_owner" ON tender_alert_subscriptions FOR ALL
  USING (user_id = auth.uid() AND current_user_role() = 'SOUMISSIONNAIRE')
  WITH CHECK (user_id = auth.uid() AND current_user_role() = 'SOUMISSIONNAIRE');

CREATE OR REPLACE FUNCTION alert_subs_limit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF (SELECT COUNT(*) FROM tender_alert_subscriptions WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'LIMIT_REACHED: 10 alertes maximum par compte';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_alert_subs_limit BEFORE INSERT ON tender_alert_subscriptions FOR EACH ROW EXECUTE FUNCTION alert_subs_limit();

-- Appelée à la publication d'un avis : une notification par candidat concerné, un message par abonnement.
CREATE OR REPLACE FUNCTION enqueue_tender_alerts(p_tender UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE t tenders%ROWTYPE; v_url TEXT; v_n INTEGER := 0; s RECORD;
BEGIN
  SELECT * INTO t FROM tenders WHERE id = p_tender;
  IF NOT FOUND OR t.date_publication IS NULL THEN RETURN 0; END IF;
  v_url := COALESCE((SELECT valeur FROM config_seuils WHERE cle = 'URL_PORTAIL'), '') || '/avis/' || t.id;
  FOR s IN
    SELECT sub.*, u.full_name FROM tender_alert_subscriptions sub JOIN users u ON u.id = sub.user_id
     WHERE sub.actif AND u.is_active AND u.role = 'SOUMISSIONNAIRE'
       AND (sub.corps_metier_id IS NULL OR sub.corps_metier_id = t.corps_metier_id)
       AND (sub.nature IS NULL OR sub.nature = t.nature_marche)
       AND (sub.montant_min IS NULL OR COALESCE(t.montant_estime, 0) >= sub.montant_min)
       AND (NOT t.is_reserve_pme OR u.is_pme OR u.is_ess)                     -- marché réservé : seuls les éligibles sont alertés
       AND (NOT t.is_reserve_pme_feminine OR u.is_pme_feminine)
  LOOP
    INSERT INTO outbox_messages (user_id, tender_id, canal, destinataire, sujet, corps)
    VALUES (s.user_id, p_tender, s.canal, s.destinataire, 'Nouvel appel d''offres ' || t.reference,
            'Nouvel appel d''offres ' || t.reference || ' : ' || left(t.title, 90) || '. Limite de dépôt : '
            || COALESCE(to_char(t.date_limite_depot AT TIME ZONE 'UTC', 'DD/MM/YYYY'), 'à préciser') || '. ' || v_url);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO notifications (user_id, tender_id, kind, titre, message)
  SELECT DISTINCT sub.user_id, p_tender, 'ALERTE_AO', 'Nouvel appel d''offres correspondant à vos alertes', t.reference || ' — ' || left(t.title, 120)
    FROM tender_alert_subscriptions sub JOIN users u ON u.id = sub.user_id
   WHERE sub.actif AND u.is_active
     AND (sub.corps_metier_id IS NULL OR sub.corps_metier_id = t.corps_metier_id) AND (sub.nature IS NULL OR sub.nature = t.nature_marche)
     AND (sub.montant_min IS NULL OR COALESCE(t.montant_estime, 0) >= sub.montant_min)
     AND (NOT t.is_reserve_pme OR u.is_pme OR u.is_ess) AND (NOT t.is_reserve_pme_feminine OR u.is_pme_feminine);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION enqueue_tender_alerts(UUID) FROM PUBLIC, anon, authenticated;

-- Worker (service_role) : récupère un lot de messages d'un ou plusieurs canaux, sans conflit entre exécutions parallèles.
CREATE OR REPLACE FUNCTION claim_outbox(p_canaux TEXT[], p_limit INTEGER DEFAULT 50)
RETURNS SETOF outbox_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM outbox_messages WHERE statut = 'PENDING' AND canal = ANY (p_canaux) AND tentatives < 3
     ORDER BY created_at LIMIT LEAST(GREATEST(p_limit, 1), 200) FOR UPDATE SKIP LOCKED)
  UPDATE outbox_messages o SET tentatives = o.tentatives + 1 FROM picked WHERE o.id = picked.id RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION mark_outbox(p_id UUID, p_ok BOOLEAN, p_erreur TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  UPDATE outbox_messages SET
    statut = CASE WHEN p_ok THEN 'SENT' WHEN tentatives >= 3 THEN 'FAILED' ELSE 'PENDING' END,
    derniere_erreur = CASE WHEN p_ok THEN NULL ELSE left(p_erreur, 500) END,
    sent_at = CASE WHEN p_ok THEN NOW() END
  WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION claim_outbox(TEXT[], INTEGER), mark_outbox(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_outbox(TEXT[], INTEGER), mark_outbox(UUID, BOOLEAN, TEXT) TO service_role;

-- Alertes d'expiration des pièces (tâche quotidienne) : une seule alerte par pièce.
CREATE OR REPLACE FUNCTION notify_expiring_documents()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE d RECORD; n INTEGER := 0;
BEGIN
  FOR d IN SELECT sd.id, sd.user_id, sd.titre, sd.date_expiration, u.email FROM supplier_documents sd JOIN users u ON u.id = sd.user_id
            WHERE sd.statut = 'VERIFIE' AND NOT sd.alerte_expiration_envoyee AND sd.date_expiration IS NOT NULL
              AND sd.date_expiration <= CURRENT_DATE + config_num('ALERTE_PIECE_JOURS', 30)::int LOOP
    PERFORM notify_user(d.user_id, NULL, 'PIECE_EXPIRE', 'Pièce bientôt expirée', d.titre || ' expire le ' || to_char(d.date_expiration, 'DD/MM/YYYY') || '. Déposez la version à jour pour rester éligible.');
    INSERT INTO outbox_messages (user_id, canal, destinataire, sujet, corps)
    VALUES (d.user_id, 'EMAIL', d.email, 'Pièce de votre dossier bientôt expirée', d.titre || ' expire le ' || to_char(d.date_expiration, 'DD/MM/YYYY') || '. Déposez la version à jour sur la plateforme.');
    UPDATE supplier_documents SET alerte_expiration_envoyee = true WHERE id = d.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION notify_expiring_documents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notify_expiring_documents() TO service_role;
