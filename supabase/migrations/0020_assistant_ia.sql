-- ==========================================
-- Migration 0020 : Assistant IA de rédaction (journal et quota)
--   • chaque appel au modèle est enregistré (qui, quand, quel document, volumes) — jamais le contenu des échanges
--   • quota quotidien par agent (paramètre AI_QUOTA_JOUR), appliqué ici et non dans l'application
--   • réservé au personnel de l'autorité, sur un TDR/DAO modifiable de son institution
-- ==========================================

INSERT INTO config_seuils (cle, valeur, description) VALUES
  ('AI_QUOTA_JOUR', '30', 'Nombre maximal de requêtes à l''assistant IA par agent et par jour')
ON CONFLICT (cle) DO NOTHING;

CREATE TABLE ai_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  tender_id UUID NOT NULL REFERENCES tenders(id),
  document_id UUID NOT NULL REFERENCES tender_documents(id),
  kind TEXT NOT NULL CHECK (kind IN ('REDIGER_SECTION', 'RELIRE_DOCUMENT')),
  model TEXT NOT NULL,
  input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
  output_chars INTEGER,
  statut TEXT NOT NULL DEFAULT 'EN_COURS' CHECK (statut IN ('EN_COURS', 'OK', 'ERREUR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_requests_user_day ON ai_requests (user_id, created_at);
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_requests_select" ON ai_requests FOR SELECT USING (user_id = auth.uid() OR is_regulateur() OR current_user_role() = 'ADMIN' AND institution_id = current_institution_id());
REVOKE INSERT, UPDATE, DELETE ON ai_requests FROM anon, authenticated;
CREATE TRIGGER trig_audit_ai_requests AFTER INSERT ON ai_requests FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Réserve une requête : contrôle des droits, du verrouillage du document et du quota. Renvoie l'identifiant à clôturer.
CREATE OR REPLACE FUNCTION claim_ai_request(p_document UUID, p_kind TEXT, p_model TEXT, p_input_chars INTEGER)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d tender_documents%ROWTYPE; v_phase tender_phase; v_used INTEGER; v_quota INTEGER := config_num('AI_QUOTA_JOUR', 30)::int; v_id UUID;
BEGIN
  IF current_user_role() NOT IN ('SERVICE_DEMANDEUR', 'CPM', 'PRM') THEN RAISE EXCEPTION 'FORBIDDEN: assistant réservé au personnel de rédaction'; END IF;
  SELECT * INTO d FROM tender_documents WHERE id = p_document;
  IF NOT FOUND OR d.institution_id IS DISTINCT FROM current_institution_id() OR d.type NOT IN ('TDR', 'DAO') THEN RAISE EXCEPTION 'FORBIDDEN: document inaccessible'; END IF;
  SELECT current_phase INTO v_phase FROM tenders WHERE id = d.tender_id;
  IF d.is_locked OR d.circuit_statut NOT IN ('REDACTION', 'RELECTURE_CPM') OR v_phase NOT IN ('PHASE_1_PROGRAMMATION', 'PHASE_2_REDACTION') THEN
    RAISE EXCEPTION 'INVALID_STATE: le document n''est plus en rédaction';
  END IF;
  SELECT count(*) INTO v_used FROM ai_requests WHERE user_id = auth.uid() AND statut <> 'ERREUR' AND created_at > NOW() - interval '24 hours';
  IF v_used >= v_quota THEN RAISE EXCEPTION 'QUOTA_EXCEEDED: limite de % requêtes par 24 h atteinte pour l''assistant IA', v_quota; END IF;
  INSERT INTO ai_requests (user_id, institution_id, tender_id, document_id, kind, model, input_chars)
  VALUES (auth.uid(), d.institution_id, d.tender_id, d.id, p_kind, left(p_model, 80), GREATEST(p_input_chars, 0)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION finish_ai_request(p_id UUID, p_ok BOOLEAN, p_output_chars INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE ai_requests SET statut = CASE WHEN p_ok THEN 'OK' ELSE 'ERREUR' END, output_chars = p_output_chars
  WHERE id = p_id AND user_id = auth.uid() AND statut = 'EN_COURS'
$$;
-- Les requêtes en erreur ne consomment pas de quota (elles restent tracées).
CREATE OR REPLACE FUNCTION ai_quota_remaining()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT GREATEST(config_num('AI_QUOTA_JOUR', 30)::int - count(*)::int, 0) FROM ai_requests WHERE user_id = auth.uid() AND statut <> 'ERREUR' AND created_at > NOW() - interval '24 hours'
$$;
REVOKE ALL ON FUNCTION claim_ai_request(UUID, TEXT, TEXT, INTEGER), finish_ai_request(UUID, BOOLEAN, INTEGER), ai_quota_remaining() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_ai_request(UUID, TEXT, TEXT, INTEGER), finish_ai_request(UUID, BOOLEAN, INTEGER), ai_quota_remaining() TO authenticated;
