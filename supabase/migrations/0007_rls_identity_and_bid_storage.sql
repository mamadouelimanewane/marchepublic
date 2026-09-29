-- Resolve the authenticated user's role and institution from the trusted profile row.
-- Never trust client supplied headers or custom PostgreSQL session variables for RLS.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT COALESCE((SELECT u.role FROM public.users u WHERE u.id = auth.uid() AND u.is_active), '')
$$;

CREATE OR REPLACE FUNCTION current_institution_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT (SELECT u.institution_id FROM public.users u WHERE u.id = auth.uid() AND u.is_active)
$$;

GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION current_institution_id() TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('bids', 'bids', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Supplier profiles contain private business data (email, NINEA, RCCM).
DROP POLICY IF EXISTS "users_soumissionnaire_select" ON public.users;

-- Permit authenticated suppliers to store an encrypted envelope under their own tender folder.
-- The bucket must be private; no public read policy is created here.
CREATE POLICY "bid_files_insert_owner" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bids'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND current_user_role() = 'SOUMISSIONNAIRE'
    AND EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id::text = (storage.foldername(name))[1]
        AND t.current_phase = 'PHASE_6_DEPOT_OFFRES'
        AND t.date_limite_depot IS NOT NULL
        AND now() < t.date_limite_depot
    )
  );

CREATE POLICY "bid_files_read_owner" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bids'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
