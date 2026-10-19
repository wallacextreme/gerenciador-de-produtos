-- ==============================================================================
-- GestãoPro — Supabase Keep-Alive RPC (PHASE 14.1 / Keep-Alive)
-- Função leve sem escrita em disco para zerar o contador de inatividade via PostgREST
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.keep_alive()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', 'alive',
    'project', 'gestaopro-staging-storage',
    'checked_at', now()
  );
$$;

REVOKE ALL ON FUNCTION public.keep_alive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keep_alive() TO anon, authenticated;
