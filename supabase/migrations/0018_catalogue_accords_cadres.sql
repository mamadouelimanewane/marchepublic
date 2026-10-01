-- ==========================================
-- Migration 0018 : Catalogue électronique d'accords-cadres (marchés à commandes)
--   • un accord-cadre naît d'un marché passé en mode ACCORD_CADRE et contractualisé (phase ≥ 13)
--   • les titulaires publient des articles à prix négociés, décrits par des ATTRIBUTS STANDARDISÉS (pas de texte libre)
--   • les autorités passent des commandes au prix du catalogue, plafonnées par le montant de l'accord
--   • prix publics ; hausses de prix plafonnées et historisées
-- ==========================================

INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('CATALOGUE_HAUSSE_MAX_PCT', '10', 'Hausse maximale d''un prix de catalogue en une révision (%)')
ON CONFLICT (cle) DO NOTHING;

-- ------------------------------------------
-- 1. Accords-cadres
-- ------------------------------------------
CREATE TABLE framework_agreements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  tender_id UUID NOT NULL UNIQUE REFERENCES tenders(id),
  reference TEXT NOT NULL UNIQUE,
  titre TEXT NOT NULL CHECK (char_length(titre) BETWEEN 5 AND 200),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  plafond_montant BIGINT NOT NULL CHECK (plafond_montant > 0),
  montant_commande BIGINT NOT NULL DEFAULT 0 CHECK (montant_commande >= 0),
  beneficiaires UUID[],                                  -- institutions autorisées à commander en plus de l'autorité propriétaire
  statut TEXT NOT NULL DEFAULT 'ACTIF' CHECK (statut IN ('ACTIF', 'SUSPENDU', 'CLOS')),
  created_by UUID REFERENCES users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (date_fin > date_debut),
  CHECK (montant_commande <= plafond_montant)
);
ALTER TABLE framework_agreements ENABLE ROW LEVEL SECURITY;

-- Le titulaire d'un accord est un attributaire d'un contrat du marché source.
CREATE OR REPLACE FUNCTION is_agreement_supplier(p_agreement UUID, p_user UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT EXISTS (SELECT 1 FROM framework_agreements a JOIN contracts c ON c.tender_id = a.tender_id WHERE a.id = p_agreement AND c.attributaire_id = p_user)
$$;

CREATE OR REPLACE FUNCTION can_order_from(p_agreement UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
  SELECT current_user_role() IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM') AND EXISTS (
    SELECT 1 FROM framework_agreements a WHERE a.id = p_agreement
      AND (a.institution_id = current_institution_id() OR current_institution_id() = ANY (COALESCE(a.beneficiaires, ARRAY[]::uuid[]))))
$$;

CREATE POLICY "agreements_select" ON framework_agreements FOR SELECT USING (
  can_order_from(id) OR is_inst_staff(institution_id) OR is_agreement_supplier(id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES');
REVOKE INSERT, UPDATE, DELETE ON framework_agreements FROM anon, authenticated;
CREATE TRIGGER trig_audit_framework_agreements AFTER INSERT OR UPDATE ON framework_agreements FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE OR REPLACE FUNCTION create_framework_agreement(p_tender UUID, p_titre TEXT, p_debut DATE, p_fin DATE, p_plafond BIGINT, p_beneficiaires UUID[] DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t tenders%ROWTYPE; v_sum BIGINT; v_id UUID;
BEGIN
  SELECT * INTO v_t FROM tenders WHERE id = p_tender FOR UPDATE;
  IF NOT FOUND OR v_t.institution_id IS DISTINCT FROM current_institution_id() OR current_user_role() <> 'PRM' THEN RAISE EXCEPTION 'FORBIDDEN: réservé au PRM de l''autorité contractante'; END IF;
  IF v_t.mode_passation <> 'ACCORD_CADRE' THEN RAISE EXCEPTION 'INVALID_STATE: seul un marché passé en accord-cadre peut alimenter le catalogue'; END IF;
  IF v_t.current_phase < 'PHASE_13_EXECUTION' THEN RAISE EXCEPTION 'INVALID_PHASE: le marché doit être contractualisé (phase 13)'; END IF;
  SELECT COALESCE(SUM(COALESCE(montant_actuel, montant_initial)), 0) INTO v_sum FROM contracts WHERE tender_id = p_tender;
  IF p_plafond > v_sum THEN RAISE EXCEPTION 'PLAFOND_INVALID: le plafond (%) dépasse le montant contractualisé (%)', p_plafond, v_sum; END IF;
  INSERT INTO framework_agreements (institution_id, tender_id, reference, titre, date_debut, date_fin, plafond_montant, beneficiaires)
  VALUES (v_t.institution_id, p_tender, 'AC-' || v_t.reference, p_titre, p_debut, p_fin, p_plafond, p_beneficiaires) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION create_framework_agreement(UUID, TEXT, DATE, DATE, BIGINT, UUID[]) TO authenticated;

-- ------------------------------------------
-- 2. Attributs standardisés (aucun texte libre : comparabilité des offres)
-- ------------------------------------------
CREATE TABLE catalog_attribute_defs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  corps_metier_id UUID REFERENCES corps_metiers(id),     -- NULL = toutes catégories
  cle TEXT NOT NULL CHECK (cle ~ '^[a-z][a-z0-9_]{1,40}$'),
  libelle TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('NOMBRE', 'CHOIX', 'BOOLEEN')),
  options JSONB,
  obligatoire BOOLEAN NOT NULL DEFAULT false,
  CHECK (type <> 'CHOIX' OR jsonb_typeof(options) = 'array')
);
CREATE UNIQUE INDEX uq_attr_def ON catalog_attribute_defs (COALESCE(corps_metier_id, '00000000-0000-0000-0000-000000000000'), cle);
ALTER TABLE catalog_attribute_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attr_defs_read" ON catalog_attribute_defs FOR SELECT USING (true);
CREATE POLICY "attr_defs_admin" ON catalog_attribute_defs FOR ALL USING (current_user_role() = 'ADMIN') WITH CHECK (current_user_role() = 'ADMIN');

INSERT INTO catalog_attribute_defs (corps_metier_id, cle, libelle, type, options, obligatoire)
SELECT NULL, 'origine', 'Origine', 'CHOIX', '["LOCAL","UEMOA","AFRIQUE","IMPORT"]'::jsonb, true
UNION ALL SELECT id, 'garantie_mois', 'Garantie (mois)', 'NOMBRE', NULL, true FROM corps_metiers WHERE code = 'INFORMATIQUE'
UNION ALL SELECT id, 'conformite_normes', 'Conforme aux normes applicables', 'BOOLEEN', NULL, true FROM corps_metiers WHERE code = 'INFORMATIQUE'
UNION ALL SELECT id, 'conditionnement_unites', 'Unités par conditionnement', 'NOMBRE', NULL, true FROM corps_metiers WHERE code = 'FOURNITURES_BUREAU'
UNION ALL SELECT id, 'eco_label', 'Écolabel', 'BOOLEEN', NULL, false FROM corps_metiers WHERE code = 'FOURNITURES_BUREAU'
UNION ALL SELECT id, 'autorisation_mise_sur_le_marche', 'Autorisation de mise sur le marché valide', 'BOOLEEN', NULL, true FROM corps_metiers WHERE code = 'SANTE'
UNION ALL SELECT id, 'chaine_du_froid', 'Chaîne du froid requise', 'BOOLEEN', NULL, false FROM corps_metiers WHERE code = 'SANTE';

CREATE OR REPLACE FUNCTION validate_catalog_attributes(p_corps UUID, p_attrs JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE AS $$
DECLARE d RECORD; k TEXT; v JSONB;
BEGIN
  IF jsonb_typeof(p_attrs) <> 'object' THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID: objet JSON attendu'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_attrs) LOOP
    IF NOT EXISTS (SELECT 1 FROM catalog_attribute_defs x WHERE x.cle = k AND (x.corps_metier_id IS NULL OR x.corps_metier_id = p_corps)) THEN
      RAISE EXCEPTION 'ATTRIBUTES_INVALID: attribut « % » inconnu pour cette catégorie (les attributs libres ne sont pas admis)', k;
    END IF;
  END LOOP;
  FOR d IN SELECT * FROM catalog_attribute_defs x WHERE x.corps_metier_id IS NULL OR x.corps_metier_id = p_corps LOOP
    v := p_attrs -> d.cle;
    IF v IS NULL THEN
      IF d.obligatoire THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID: attribut obligatoire manquant : % (%)', d.libelle, d.cle; END IF;
      CONTINUE;
    END IF;
    IF d.type = 'NOMBRE' AND jsonb_typeof(v) <> 'number' THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID: % doit être un nombre', d.libelle; END IF;
    IF d.type = 'BOOLEEN' AND jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID: % doit être oui/non', d.libelle; END IF;
    IF d.type = 'CHOIX' AND NOT (jsonb_typeof(v) = 'string' AND d.options ? (v #>> '{}')) THEN
      RAISE EXCEPTION 'ATTRIBUTES_INVALID: % : valeur hors liste (%)', d.libelle, d.options;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------
-- 3. Articles du catalogue
-- ------------------------------------------
CREATE TABLE catalog_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agreement_id UUID NOT NULL REFERENCES framework_agreements(id),
  supplier_id UUID NOT NULL REFERENCES users(id) DEFAULT auth.uid(),
  corps_metier_id UUID NOT NULL REFERENCES corps_metiers(id),
  code_article TEXT NOT NULL CHECK (code_article ~ '^[A-Za-z0-9._-]{2,40}$'),
  designation TEXT NOT NULL CHECK (char_length(designation) BETWEEN 5 AND 200),
  unite TEXT NOT NULL CHECK (unite IN ('UNITE', 'KG', 'TONNE', 'LITRE', 'M2', 'M3', 'ML', 'HEURE', 'JOUR', 'FORFAIT', 'LOT')),
  prix_unitaire BIGINT NOT NULL CHECK (prix_unitaire > 0),
  delai_livraison_jours INTEGER NOT NULL DEFAULT 7 CHECK (delai_livraison_jours BETWEEN 0 AND 365),
  attributs JSONB NOT NULL DEFAULT '{}',
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agreement_id, supplier_id, code_article)
);
CREATE INDEX idx_catalog_items_agreement ON catalog_items (agreement_id, actif);
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE catalog_price_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES catalog_items(id),
  ancien_prix BIGINT, nouveau_prix BIGINT NOT NULL,
  changed_by UUID REFERENCES users(id) DEFAULT auth.uid(),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trig_price_history_immutable BEFORE UPDATE OR DELETE ON catalog_price_history FOR EACH ROW EXECUTE FUNCTION block_update_delete();
ALTER TABLE catalog_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "price_history_select" ON catalog_price_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM catalog_items i WHERE i.id = item_id));

CREATE POLICY "catalog_items_select" ON catalog_items FOR SELECT USING (
  can_order_from(agreement_id) OR is_agreement_supplier(agreement_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
  OR EXISTS (SELECT 1 FROM framework_agreements a WHERE a.id = agreement_id AND is_inst_staff(a.institution_id)));
CREATE POLICY "catalog_items_insert" ON catalog_items FOR INSERT WITH CHECK (supplier_id = auth.uid() AND is_agreement_supplier(agreement_id));
CREATE POLICY "catalog_items_update" ON catalog_items FOR UPDATE USING (supplier_id = auth.uid()) WITH CHECK (supplier_id = auth.uid());
REVOKE DELETE ON catalog_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION catalog_items_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_a framework_agreements%ROWTYPE; v_cap NUMERIC := config_num('CATALOGUE_HAUSSE_MAX_PCT', 10);
BEGIN
  SELECT * INTO v_a FROM framework_agreements WHERE id = NEW.agreement_id;
  IF v_a.statut <> 'ACTIF' OR CURRENT_DATE > v_a.date_fin THEN RAISE EXCEPTION 'AGREEMENT_CLOSED: l''accord-cadre n''est plus actif'; END IF;
  PERFORM validate_catalog_attributes(NEW.corps_metier_id, NEW.attributs);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.agreement_id <> OLD.agreement_id OR NEW.supplier_id <> OLD.supplier_id OR NEW.code_article <> OLD.code_article OR NEW.corps_metier_id <> OLD.corps_metier_id THEN
      RAISE EXCEPTION 'IMMUTABLE_RECORD: accord, titulaire, code et catégorie d''un article sont fixes';
    END IF;
    IF NEW.prix_unitaire <> OLD.prix_unitaire THEN
      IF NEW.prix_unitaire > OLD.prix_unitaire * (1 + v_cap / 100.0) THEN
        RAISE EXCEPTION 'PRICE_INCREASE_TOO_HIGH: hausse limitée à % %% par révision (ancien prix %)', v_cap, OLD.prix_unitaire;
      END IF;
      INSERT INTO catalog_price_history (item_id, ancien_prix, nouveau_prix, changed_by) VALUES (OLD.id, OLD.prix_unitaire, NEW.prix_unitaire, auth.uid());
    END IF;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trig_catalog_items_guard BEFORE INSERT OR UPDATE ON catalog_items FOR EACH ROW EXECUTE FUNCTION catalog_items_guard();
CREATE OR REPLACE FUNCTION catalog_items_first_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO catalog_price_history (item_id, ancien_prix, nouveau_prix, changed_by) VALUES (NEW.id, NULL, NEW.prix_unitaire, auth.uid());
  RETURN NEW;
END $$;
CREATE TRIGGER trig_catalog_items_first_price AFTER INSERT ON catalog_items FOR EACH ROW EXECUTE FUNCTION catalog_items_first_price();
CREATE TRIGGER trig_audit_catalog_items AFTER INSERT OR UPDATE ON catalog_items FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- ------------------------------------------
-- 4. Commandes sur accord-cadre
-- ------------------------------------------
CREATE TABLE call_off_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agreement_id UUID NOT NULL REFERENCES framework_agreements(id),
  item_id UUID NOT NULL REFERENCES catalog_items(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  supplier_id UUID NOT NULL REFERENCES users(id),
  quantite NUMERIC(12, 2) NOT NULL CHECK (quantite > 0),
  prix_unitaire BIGINT NOT NULL,                         -- prix figé au moment de la commande
  montant BIGINT NOT NULL CHECK (montant > 0),
  statut TEXT NOT NULL DEFAULT 'COMMANDE' CHECK (statut IN ('COMMANDE', 'LIVRE', 'RECEPTIONNE', 'ANNULE')),
  motif_annulation TEXT,
  commande_par UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  livre_le TIMESTAMPTZ, receptionne_le TIMESTAMPTZ
);
CREATE INDEX idx_call_off_agreement ON call_off_orders (agreement_id, statut);
ALTER TABLE call_off_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_off_select" ON call_off_orders FOR SELECT USING (
  supplier_id = auth.uid() OR is_inst_staff(institution_id) OR is_regulateur() OR current_user_role() = 'COUR_COMPTES'
  OR EXISTS (SELECT 1 FROM framework_agreements a WHERE a.id = agreement_id AND is_inst_staff(a.institution_id)));
REVOKE INSERT, UPDATE, DELETE ON call_off_orders FROM anon, authenticated;
CREATE TRIGGER trig_audit_call_off AFTER INSERT OR UPDATE ON call_off_orders FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE OR REPLACE FUNCTION place_call_off(p_item UUID, p_quantite NUMERIC)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_i catalog_items%ROWTYPE; v_a framework_agreements%ROWTYPE; v_montant BIGINT; v_id UUID;
BEGIN
  SELECT * INTO v_i FROM catalog_items WHERE id = p_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
  SELECT * INTO v_a FROM framework_agreements WHERE id = v_i.agreement_id FOR UPDATE;
  IF NOT can_order_from(v_a.id) THEN RAISE EXCEPTION 'FORBIDDEN: votre autorité ne peut pas commander sur cet accord-cadre'; END IF;
  IF v_a.statut <> 'ACTIF' OR CURRENT_DATE NOT BETWEEN v_a.date_debut AND v_a.date_fin THEN RAISE EXCEPTION 'AGREEMENT_CLOSED: accord-cadre hors période ou suspendu'; END IF;
  IF NOT v_i.actif THEN RAISE EXCEPTION 'ITEM_INACTIVE: article retiré du catalogue'; END IF;
  IF p_quantite IS NULL OR p_quantite <= 0 THEN RAISE EXCEPTION 'INVALID_INPUT: quantité positive requise'; END IF;
  v_montant := ceil(p_quantite * v_i.prix_unitaire);
  IF v_a.montant_commande + v_montant > v_a.plafond_montant THEN
    RAISE EXCEPTION 'PLAFOND_ACCORD_EXCEEDED: la commande (%) dépasse le solde de l''accord-cadre (%)', v_montant, v_a.plafond_montant - v_a.montant_commande;
  END IF;
  INSERT INTO call_off_orders (agreement_id, item_id, institution_id, supplier_id, quantite, prix_unitaire, montant, commande_par)
  VALUES (v_a.id, v_i.id, current_institution_id(), v_i.supplier_id, p_quantite, v_i.prix_unitaire, v_montant, auth.uid()) RETURNING id INTO v_id;
  UPDATE framework_agreements SET montant_commande = montant_commande + v_montant WHERE id = v_a.id;
  PERFORM notify_user(v_i.supplier_id, v_a.tender_id, 'COMMANDE_ACCORD_CADRE', 'Nouvelle commande sur accord-cadre', v_a.reference || ' : ' || p_quantite || ' x ' || v_i.designation);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION progress_call_off(p_order UUID, p_action TEXT, p_motif TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o call_off_orders%ROWTYPE; v_role TEXT := current_user_role();
BEGIN
  SELECT * INTO o FROM call_off_orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF p_action = 'LIVRER' THEN
    IF o.supplier_id <> auth.uid() THEN RAISE EXCEPTION 'FORBIDDEN: seul le titulaire déclare la livraison'; END IF;
    IF o.statut <> 'COMMANDE' THEN RAISE EXCEPTION 'INVALID_STATE: commande déjà %', o.statut; END IF;
    UPDATE call_off_orders SET statut = 'LIVRE', livre_le = NOW() WHERE id = p_order;
  ELSIF p_action = 'RECEPTIONNER' THEN
    IF NOT (v_role IN ('CPM', 'PRM') AND o.institution_id = current_institution_id()) THEN RAISE EXCEPTION 'FORBIDDEN: réservé au CPM/PRM de l''autorité qui a commandé'; END IF;
    IF o.statut <> 'LIVRE' THEN RAISE EXCEPTION 'INVALID_STATE: la livraison n''a pas été déclarée'; END IF;
    UPDATE call_off_orders SET statut = 'RECEPTIONNE', receptionne_le = NOW() WHERE id = p_order;
  ELSIF p_action = 'ANNULER' THEN
    IF NOT (v_role IN ('CPM', 'PRM') AND o.institution_id = current_institution_id()) THEN RAISE EXCEPTION 'FORBIDDEN: réservé au CPM/PRM de l''autorité qui a commandé'; END IF;
    IF o.statut <> 'COMMANDE' THEN RAISE EXCEPTION 'INVALID_STATE: seule une commande non livrée s''annule'; END IF;
    IF char_length(COALESCE(p_motif, '')) < 10 THEN RAISE EXCEPTION 'MOTIVATION_REQUIRED: motif d''annulation obligatoire'; END IF;
    UPDATE call_off_orders SET statut = 'ANNULE', motif_annulation = p_motif WHERE id = p_order;
    UPDATE framework_agreements SET montant_commande = montant_commande - o.montant WHERE id = o.agreement_id;   -- le solde est restitué
  ELSE RAISE EXCEPTION 'INVALID_ACTION'; END IF;
END $$;
GRANT EXECUTE ON FUNCTION place_call_off(UUID, NUMERIC), progress_call_off(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------
-- 5. Publication : accords et prix sont publics (transparence des prix négociés)
-- ------------------------------------------
CREATE OR REPLACE VIEW v_public_accords WITH (security_invoker = false) AS
SELECT a.id, a.reference, a.titre, i.name AS institution, a.date_debut, a.date_fin, a.plafond_montant, a.montant_commande,
       ROUND(100.0 * a.montant_commande / a.plafond_montant, 1) AS taux_consommation, a.statut
FROM framework_agreements a JOIN institutions i ON i.id = a.institution_id;

CREATE OR REPLACE VIEW v_public_catalogue WITH (security_invoker = false) AS
SELECT it.id, a.reference AS accord, a.titre AS accord_titre, i.name AS institution, u.full_name AS fournisseur, cm.libelle AS categorie,
       it.code_article, it.designation, it.unite, it.prix_unitaire, it.delai_livraison_jours, it.attributs
FROM catalog_items it
JOIN framework_agreements a ON a.id = it.agreement_id AND a.statut = 'ACTIF' AND CURRENT_DATE BETWEEN a.date_debut AND a.date_fin
JOIN institutions i ON i.id = a.institution_id JOIN users u ON u.id = it.supplier_id JOIN corps_metiers cm ON cm.id = it.corps_metier_id
WHERE it.actif;
GRANT SELECT ON v_public_accords, v_public_catalogue TO anon, authenticated;
