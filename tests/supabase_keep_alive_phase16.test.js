import { describe, it, expect } from 'bun:test';
import {
  runKeepAlive,
  resolveConfig,
  assertPublicKey,
  parseEnvFile,
  fetchWithRetry,
  createLogger,
  EXIT,
  DEFAULT_SUPABASE_URL
} from '../scripts/supabase-keep-alive.mjs';
import { createWatchdog, projectRefFromUrl, WD_EXIT } from '../scripts/supabase-watchdog.mjs';

const KEY = 'sb_publishable_TESTKEY_abcdefghijklmnop';
const URL_ = 'https://fujgtzxzspqhvvbzmqzv.supabase.co';
const ENV = { SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY, PING_SOURCE: 'unit-test' };

function jsonResponse(status, obj) {
  return new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function dnsError() {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND' };
  return err;
}

function captureSink() {
  const lines = [];
  return { lines, sink: { log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) } };
}

const noSleep = async () => {};

describe('FASE 16 — Script supabase-keep-alive.mjs', () => {
  it('16.1 parseEnvFile lê KEY=VALUE, ignora comentários e remove aspas', () => {
    const env = parseEnvFile('# c\nA=1\nB="dois"\n\nC = tres\nINVALID');
    expect(env).toEqual({ A: '1', B: 'dois', C: 'tres' });
  });

  it('16.2 resolveConfig prioriza ambiente, usa fallback .env (VITE_*) e URL padrão', () => {
    expect(resolveConfig({}, { VITE_SUPABASE_PUBLISHABLE_KEY: KEY }).url).toBe(DEFAULT_SUPABASE_URL);
    const cfg = resolveConfig({ SUPABASE_URL: URL_ + '/' }, { VITE_SUPABASE_PUBLISHABLE_KEY: KEY });
    expect(cfg.url).toBe(URL_);
    expect(cfg.key).toBe(KEY);
    expect(cfg.bucket).toBe('product-images');
  });

  it('16.3 assertPublicKey recusa chaves administrativas (sb_secret / service_role)', () => {
    expect(() => assertPublicKey('sb_secret_abc123456789')).toThrow(/recusada/);
    const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    expect(() => assertPublicKey(`eyJhbGciOiJIUzI1NiJ9.${payload}.sig`)).toThrow(/recusada/);
    expect(() => assertPublicKey(KEY)).not.toThrow();
    expect(() => assertPublicKey('')).toThrow(/ausente/);
  });

  it('16.4 Sucesso: RPC grava (total_pings recente) + Storage 200 => exit 0, só header apikey', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/rest/v1/rpc/rpc_keep_alive')) {
        return jsonResponse(200, { status: 'alive', timestamp: new Date().toISOString(), total_pings: 42, source: 'unit-test' });
      }
      if (url.includes('/storage/v1/object/list/product-images')) return jsonResponse(200, []);
      throw new Error('URL inesperada ' + url);
    };
    const { sink } = captureSink();
    const { exitCode, results } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink });
    expect(exitCode).toBe(EXIT.OK);
    expect(results.rpc.totalPings).toBe(42);
    expect(JSON.parse(calls[0].init.body)).toEqual({ ping_source: 'unit-test' });
    expect(calls[0].init.headers.apikey).toBe(KEY);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls.some((c) => c.url.endsWith('/rpc/keep_alive'))).toBe(false);
  });

  it('16.5 RPC ausente (PGRST202) => tenta legado e sai com DEGRADED (2)', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/rpc/rpc_keep_alive')) return jsonResponse(404, { code: 'PGRST202', message: 'Could not find the function' });
      if (url.endsWith('/rpc/keep_alive')) return jsonResponse(404, { code: 'PGRST202' });
      return jsonResponse(200, []);
    };
    const { sink, lines } = captureSink();
    const { exitCode } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink });
    expect(exitCode).toBe(EXIT.DEGRADED);
    expect(lines.join('\n')).toMatch(/20261027000000_keep_alive_heartbeat/);
  });

  it('16.6 Falha de DNS passageira (2x) é absorvida pelas novas tentativas => exit 0', async () => {
    let rpcCalls = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/rpc/rpc_keep_alive')) {
        rpcCalls++;
        if (rpcCalls <= 2) { const e = new TypeError('fetch failed'); e.cause = { code: 'EAI_AGAIN' }; throw e; }
        return jsonResponse(200, { status: 'alive', timestamp: new Date().toISOString(), total_pings: 7 });
      }
      return jsonResponse(200, []);
    };
    const { sink } = captureSink();
    const { exitCode } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink });
    expect(rpcCalls).toBe(3);
    expect(exitCode).toBe(EXIT.OK);
  });

  it('16.7 DNS NXDOMAIN persistente (projeto pausado) => exit PAUSED (3)', async () => {
    const fetchImpl = async () => { throw dnsError(); };
    const { sink } = captureSink();
    const { exitCode, results } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink });
    expect(exitCode).toBe(EXIT.PAUSED);
    expect(results.paused).toBe(true);
  });

  it('16.8 HTTP 540 persistente (projeto pausado) => exit PAUSED (3)', async () => {
    const fetchImpl = async () => jsonResponse(540, { message: 'Project paused' });
    const { sink } = captureSink();
    const { exitCode } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink, retry: { attempts: 2 } });
    expect(exitCode).toBe(EXIT.PAUSED);
  });

  it('16.9 Tudo falhando com 500 => exit FAILED (1)', async () => {
    const fetchImpl = async () => jsonResponse(500, { message: 'boom' });
    const { sink } = captureSink();
    const { exitCode } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink, retry: { attempts: 2 } });
    expect(exitCode).toBe(EXIT.FAILED);
  });

  it('16.10 Timestamp antigo na resposta NÃO conta como gravação real', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/rpc/rpc_keep_alive')) return jsonResponse(200, { status: 'alive', timestamp: '2020-01-01T00:00:00Z', total_pings: 1 });
      if (url.endsWith('/rpc/keep_alive')) return jsonResponse(500, {});
      return jsonResponse(200, []);
    };
    const { sink } = captureSink();
    const { exitCode } = await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink, retry: { attempts: 1 } });
    expect(exitCode).toBe(EXIT.FAILED);
  });

  it('16.11 A chave NUNCA aparece nos logs, mesmo em erros que a contenham', async () => {
    const fetchImpl = async () => { throw new Error(`falhou com apikey=${KEY}`); };
    const { sink, lines } = captureSink();
    await runKeepAlive({ env: ENV, fetchImpl, sleep: noSleep, sink, retry: { attempts: 1 } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(createLogger([KEY]).redact(`x ${KEY} y`)).toBe('x *** y');
  });

  it('16.12 Chave administrativa no ambiente => exit FAILED sem nenhuma requisição', async () => {
    let called = false;
    const fetchImpl = async () => { called = true; return jsonResponse(200, {}); };
    const { sink } = captureSink();
    const { exitCode } = await runKeepAlive({ env: { ...ENV, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_123456789abc' }, fetchImpl, sleep: noSleep, sink });
    expect(exitCode).toBe(EXIT.FAILED);
    expect(called).toBe(false);
  });

  it('16.13 fetchWithRetry aplica espera crescente (2s, 4s, 8s...)', async () => {
    const waits = [];
    const fetchImpl = async () => jsonResponse(503, {});
    const { res } = await fetchWithRetry('https://x', {}, { fetchImpl, sleep: async (ms) => waits.push(ms), attempts: 4, baseDelayMs: 2000 });
    expect(res.status).toBe(503);
    expect(waits).toEqual([2000, 4000, 8000]);
  });
});

describe('FASE 16 — Watchdog supabase-watchdog.mjs (Management API simulada)', () => {
  const TOKEN = 'sbp_token_de_teste_1234567890abcdef';

  function mgmtMock(statusSequence, { restoreStatus = 200, queryStatus = 201 } = {}) {
    const calls = [];
    let i = 0;
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers });
      if (url.endsWith('/restore')) return jsonResponse(restoreStatus, {});
      if (url.endsWith('/database/query')) return jsonResponse(queryStatus, []);
      if (url.includes('api.supabase.com/v1/projects/')) {
        const s = statusSequence[Math.min(i++, statusSequence.length - 1)];
        if (typeof s === 'number') return jsonResponse(s, { message: 'auth' });
        return jsonResponse(200, { status: s });
      }
      if (url.endsWith('/auth/v1/health')) return jsonResponse(200, {});
      throw new Error('URL inesperada ' + url);
    };
    return { calls, fetchImpl };
  }

  const baseEnv = { ...ENV, SUPABASE_ACCESS_TOKEN: TOKEN };

  it('16.20 projectRefFromUrl extrai o ref do projeto', () => {
    expect(projectRefFromUrl(URL_)).toBe('fujgtzxzspqhvvbzmqzv');
    expect(projectRefFromUrl('https://exemplo.com')).toBe('');
  });

  it('16.21 Sem token => ignora com aviso e exit 0 (não quebra o keep-alive)', async () => {
    const { sink, lines } = captureSink();
    const wd = createWatchdog({ env: ENV, fetchImpl: async () => { throw new Error('não deveria chamar'); }, sleep: noSleep, sink });
    const r = await wd.ensureActive();
    expect(r.exitCode).toBe(WD_EXIT.OK);
    expect(r.skipped).toBe(true);
    expect(lines.join('\n')).toMatch(/auto-restore DESLIGADO/);
  });

  it('16.22 Projeto ativo => não chama restore', async () => {
    const { calls, fetchImpl } = mgmtMock(['ACTIVE_HEALTHY']);
    const { sink } = captureSink();
    const r = await createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).ensureActive();
    expect(r.exitCode).toBe(WD_EXIT.OK);
    expect(r.restored).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
  });

  it('16.23 Projeto pausado => restore => RESTORING => ACTIVE_HEALTHY => exit 0', async () => {
    const { calls, fetchImpl } = mgmtMock(['INACTIVE', 'RESTORING', 'COMING_UP', 'ACTIVE_HEALTHY']);
    const { sink, lines } = captureSink();
    const r = await createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).ensureActive();
    expect(r.exitCode).toBe(WD_EXIT.OK);
    expect(r.restored).toBe(true);
    const restoreCall = calls.find((c) => c.url.endsWith('/v1/projects/fujgtzxzspqhvvbzmqzv/restore'));
    expect(restoreCall.method).toBe('POST');
    expect(restoreCall.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('16.24 Restore que nunca termina => timeout => exit 1', async () => {
    const { fetchImpl } = mgmtMock(['INACTIVE', 'RESTORING']);
    let t = 0;
    const { sink } = captureSink();
    const wd = createWatchdog({ env: baseEnv, fetchImpl, sleep: async () => { t += 60000; }, clock: () => t, maxWaitMs: 5 * 60000, sink });
    const r = await wd.ensureActive();
    expect(r.exitCode).toBe(WD_EXIT.FAILED);
  });

  it('16.25 Token inválido (401) => exit AUTH (4)', async () => {
    const { fetchImpl } = mgmtMock([401]);
    const { sink } = captureSink();
    await expect(createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).ensureActive()).rejects.toMatchObject({ exitCode: WD_EXIT.AUTH });
  });

  it('16.26 Estado fatal (REMOVED) => exit 1 sem tentar restore', async () => {
    const { calls, fetchImpl } = mgmtMock(['REMOVED']);
    const { sink } = captureSink();
    const r = await createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).ensureActive();
    expect(r.exitCode).toBe(WD_EXIT.FAILED);
    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
  });

  it('16.27 apply-migration envia o SQL para /database/query', async () => {
    const { calls, fetchImpl } = mgmtMock(['ACTIVE_HEALTHY']);
    const { sink } = captureSink();
    const r = await createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).applyMigration('select 1;');
    expect(r.exitCode).toBe(WD_EXIT.OK);
    const q = calls.find((c) => c.url.endsWith('/database/query'));
    expect(JSON.parse(q.body)).toEqual({ query: 'select 1;' });
  });

  it('16.28 apply-migration com erro SQL => exit 1', async () => {
    const { fetchImpl } = mgmtMock(['ACTIVE_HEALTHY'], { queryStatus: 400 });
    const { sink } = captureSink();
    const r = await createWatchdog({ env: baseEnv, fetchImpl, sleep: noSleep, sink }).applyMigration('select broken;');
    expect(r.exitCode).toBe(WD_EXIT.FAILED);
  });
});

describe('FASE 16 — Contrato da migração SQL de heartbeat', () => {
  const sql = require('node:fs').readFileSync(require('node:path').resolve(import.meta.dir, '../supabase/migrations/20261027000000_keep_alive_heartbeat.sql'), 'utf8');

  it('16.40 RLS ligado e nenhuma policy liberando anon na tabela', () => {
    expect(sql).toMatch(/ALTER TABLE public\._keep_alive_heartbeat ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\._keep_alive_heartbeat FROM anon, authenticated, PUBLIC/);
  });

  it('16.41 Funções SECURITY DEFINER com search_path vazio', () => {
    const definers = sql.match(/SECURITY DEFINER\s+SET search_path = ''/g) || [];
    expect(definers.length).toBe(2);
  });

  it('16.42 RPC faz UPSERT real e limita o tamanho da origem', () => {
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(sql).toMatch(/ping_count = hb\.ping_count \+ 1/);
    expect(sql).toMatch(/left\(/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rpc_keep_alive\(text\) TO anon, authenticated/);
  });
});
