-- ==============================================================================
-- GestãoPro — Supabase Keep-Alive Heartbeat (PHASE 16 / Anti-Pause Definitivo)
-- ==============================================================================
-- POR QUE ESTE ARQUIVO EXISTE:
--   O plano Free do Supabase pausa projetos sem ATIVIDADE REAL NO BANCO por 7 dias.
--   Listar buckets do Storage ou receber 404 do cache do PostgREST NÃO conta
--   (evidência: projeto pausou entre 22/10 e 25/10/2026 mesmo com pings a cada 3 dias).
--   Esta migração cria uma RPC que executa uma GRAVAÇÃO real (UPSERT) no PostgreSQL.
--
-- SEGURANÇA:
--   * A tabela tem RLS LIGADO e NENHUMA policy -> anon/authenticated não leem nem gravam nela.
--   * Apenas a função SECURITY DEFINER grava, sempre na linha id = 1 (tabela de 1 linha).
--   * search_path vazio + nomes totalmente qualificados (evita sequestro de search_path).
--   * ping_source limitado a 40 caracteres e sanitizado.
--
-- IDEMPOTENTE: pode ser executado várias vezes sem efeito colateral.
-- ==============================================================================

-- 1. Tabela de heartbeat (sempre uma única linha)
CREATE TABLE IF NOT EXISTS public._keep_alive_heartbeat (
    id          integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_ping   timestamptz NOT NULL DEFAULT now(),
    ping_count  bigint      NOT NULL DEFAULT 0,
    source      text        NOT NULL DEFAULT 'init'
);

COMMENT ON TABLE public._keep_alive_heartbeat IS
  'GestãoPro keep-alive: linha única atualizada pela RPC rpc_keep_alive para gerar atividade real e impedir pausa do Free Tier.';

-- 2. RLS ligado e SEM policies (acesso direto bloqueado para anon/authenticated)
ALTER TABLE public._keep_alive_heartbeat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._keep_alive_heartbeat FROM anon, authenticated, PUBLIC;

-- 3. RPC de gravação real
CREATE OR REPLACE FUNCTION public.rpc_keep_alive(ping_source text DEFAULT 'unknown')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_source text;
    v_row    public._keep_alive_heartbeat%ROWTYPE;
BEGIN
    v_source := left(regexp_replace(coalesce(ping_source, 'unknown'), '[^A-Za-z0-9._:-]', '', 'g'), 40);
    IF v_source = '' THEN
        v_source := 'unknown';
    END IF;

    INSERT INTO public._keep_alive_heartbeat AS hb (id, last_ping, ping_count, source)
    VALUES (1, now(), 1, v_source)
    ON CONFLICT (id) DO UPDATE
        SET last_ping  = now(),
            ping_count = hb.ping_count + 1,
            source     = EXCLUDED.source
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'status',      'alive',
        'project',     'gestaopro-staging-storage',
        'timestamp',   v_row.last_ping,
        'total_pings', v_row.ping_count,
        'source',      v_row.source
    );
END;
$$;

COMMENT ON FUNCTION public.rpc_keep_alive(text) IS
  'GestãoPro keep-alive: UPSERT real em _keep_alive_heartbeat. Chamado por GitHub Actions, cron-job.org e pelo app.';

REVOKE ALL ON FUNCTION public.rpc_keep_alive(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_keep_alive(text) TO anon, authenticated;

-- 4. Função legada (compatibilidade com workflow/app antigos): agora também grava de verdade
CREATE OR REPLACE FUNCTION public.keep_alive()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.rpc_keep_alive('legacy');
$$;

REVOKE ALL ON FUNCTION public.keep_alive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keep_alive() TO anon, authenticated;

-- 5. Recarrega o cache de schema do PostgREST para expor as RPCs imediatamente
NOTIFY pgrst, 'reload schema';
