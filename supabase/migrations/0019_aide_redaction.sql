-- ==========================================
-- Migration 0019 : Aide à la rédaction des TDR / DAO
--   • les consignes des modèles quittent le texte du document (`consigne`) : une section non rédigée reste VIDE
--   • variables de fusion {{reference}}, {{autorite}}… résolues à la création du document (côté application)
--   • la validation PRM est refusée en base tant que le document contient des textes à compléter,
--     des sections obligatoires vides ou des clauses types obligatoires manquantes (DAO)
-- ==========================================

-- 1. Modèles : consigne séparée du contenu, amorces factuelles à variables
UPDATE document_templates SET sections = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN document_templates.type = 'TDR' AND s->>'id' = 'contexte' THEN
        (s - 'contenu') || jsonb_build_object('consigne', s->>'contenu',
          'contenu', E'{{autorite}} conduit le projet « {{intitule}} » (réf. {{reference}}), financé sur la ligne {{ligne_budgetaire}} de l''exercice {{annee}}.\n\nBesoin exprimé : {{besoin}}\n\nJustification : {{justification}}')
      WHEN document_templates.type = 'TDR' AND s->>'id' = 'budget' THEN
        (s - 'contenu') || jsonb_build_object('consigne', s->>'contenu',
          'contenu', 'Estimation prévisionnelle : {{montant_estime}} FCFA, imputée sur la ligne budgétaire {{ligne_budgetaire}} (exercice {{annee}}).')
      WHEN document_templates.type = 'DAO' AND s->>'id' = 'ccap' THEN
        (s - 'contenu') || jsonb_build_object('consigne', s->>'contenu',
          'contenu', 'Les clauses administratives particulières applicables au marché « {{intitule}} » sont reprises dans les clauses types insérées ci-après.')
      ELSE (s - 'contenu') || jsonb_build_object('consigne', s->>'contenu', 'contenu', '')
    END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(document_templates.sections) WITH ORDINALITY AS e(s, ord)
) WHERE NOT (sections->0 ? 'consigne');

-- 2. Contrôle des bloquants (miroir de `lintDocument` côté application, codes BLOQUANT)
CREATE OR REPLACE FUNCTION document_blocking_issues(p_tender UUID, p_type TEXT, p_contenu JSONB)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp SET row_security = off AS $$
DECLARE
  v_sections JSONB := COALESCE(p_contenu->'sections', '[]'::jsonb);
  v_nature nature_marche := (SELECT nature_marche FROM tenders WHERE id = p_tender);
  v_issues TEXT[] := ARRAY[]::text[]; s JSONB; c RECORD;
  v_ph TEXT := '\[●\]|\{\{[^}]*\}\}|\[\s*à compléter\s*\]|\[\s*a completer\s*\]';
BEGIN
  IF jsonb_typeof(v_sections) <> 'array' OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sections) x WHERE btrim(COALESCE(x->>'contenu', '')) <> '') THEN
    v_issues := v_issues || 'EMPTY'::text;
  END IF;
  IF jsonb_typeof(v_sections) = 'array' THEN
    FOR s IN SELECT * FROM jsonb_array_elements(v_sections) LOOP
      IF (COALESCE(s->>'titre', '') || E'\n' || COALESCE(s->>'contenu', '')) ~* v_ph THEN v_issues := v_issues || ('PLACEHOLDER:'::text || COALESCE(s->>'id', '')); END IF;
      IF COALESCE((s->>'obligatoire')::boolean, false) AND char_length(btrim(COALESCE(s->>'contenu', ''))) < 40 THEN v_issues := v_issues || ('MANDATORY_SHORT:'::text || COALESCE(s->>'id', '')); END IF;
    END LOOP;
  END IF;
  IF p_type = 'DAO' THEN
    FOR c IN SELECT code FROM clause_templates WHERE is_active AND obligatoire AND (natures IS NULL OR v_nature = ANY (natures)) LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sections) x WHERE x->>'id' = 'clause-' || c.code) THEN v_issues := v_issues || ('MISSING_CLAUSE:'::text || c.code); END IF;
    END LOOP;
  END IF;
  RETURN v_issues;
END $$;
REVOKE ALL ON FUNCTION document_blocking_issues(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION document_blocking_issues(UUID, TEXT, JSONB) TO authenticated;

-- 3. Garde du circuit : le PRM ne valide pas un document incomplet
CREATE OR REPLACE FUNCTION tender_documents_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_app BOOLEAN := current_user IN ('authenticated', 'anon'); v_role TEXT := current_user_role(); v_issues TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_app THEN
      NEW.circuit_statut := 'REDACTION'; NEW.is_locked := false; NEW.locked_at := NULL; NEW.locked_by := NULL;
      NEW.is_signed := false; NEW.version := 1; NEW.created_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: les documents ne sont jamais supprimés (traçabilité, CDC §9)';
  END IF;

  IF OLD.is_locked AND v_app THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document verrouillé (transmis à la DCMP ou publié)';
  END IF;
  IF v_app THEN
    IF NEW.is_locked IS DISTINCT FROM OLD.is_locked OR NEW.is_signed IS DISTINCT FROM OLD.is_signed
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at OR NEW.tender_id IS DISTINCT FROM OLD.tender_id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id OR NEW.type IS DISTINCT FROM OLD.type THEN
      RAISE EXCEPTION 'FORBIDDEN_COLUMN: colonnes de verrouillage/version non modifiables';
    END IF;
    IF NEW.circuit_statut IS DISTINCT FROM OLD.circuit_statut THEN
      IF NOT (
        (OLD.circuit_statut = 'REDACTION' AND NEW.circuit_statut = 'RELECTURE_CPM' AND v_role IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM'))
        OR (OLD.circuit_statut = 'RELECTURE_CPM' AND NEW.circuit_statut = 'VALIDE_PRM' AND v_role = 'PRM')
        OR (OLD.circuit_statut = 'RELECTURE_CPM' AND NEW.circuit_statut = 'REDACTION' AND v_role IN ('CPM', 'PRM'))
        OR (OLD.circuit_statut = 'VALIDE_PRM' AND NEW.circuit_statut = 'REDACTION' AND v_role = 'PRM')) THEN
        RAISE EXCEPTION 'CIRCUIT_INVALID: passage % → % non autorisé pour le rôle %', OLD.circuit_statut, NEW.circuit_statut, v_role;
      END IF;
      IF NEW.circuit_statut = 'VALIDE_PRM' AND NEW.type IN ('TDR', 'DAO') THEN
        v_issues := document_blocking_issues(NEW.tender_id, NEW.type::text, NEW.contenu);
        IF cardinality(v_issues) > 0 THEN
          RAISE EXCEPTION 'DOCUMENT_INCOMPLETE: validation impossible — %', array_to_string(v_issues, ', ');
        END IF;
      END IF;
    END IF;
    IF NEW.contenu IS DISTINCT FROM OLD.contenu AND OLD.circuit_statut NOT IN ('REDACTION', 'RELECTURE_CPM') THEN
      RAISE EXCEPTION 'CIRCUIT_INVALID: le contenu n''est modifiable qu''en rédaction ou relecture';
    END IF;
  END IF;
  IF OLD.file_hash IS NOT NULL AND NEW.file_hash IS DISTINCT FROM OLD.file_hash THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: l''empreinte du fichier ne peut plus changer';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;
