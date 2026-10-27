#!/usr/bin/env node
/**
 * GestãoPro — Supabase Keep-Alive (PHASE 16 / Anti-Pause Definitivo)
 * ------------------------------------------------------------------
 * Gera ATIVIDADE REAL no projeto Supabase para impedir a pausa do Free Tier:
 *   1. RPC `rpc_keep_alive` (UPSERT real no PostgreSQL via PostgREST);
 *   2. Fallback para a RPC legada `keep_alive` caso a migração ainda não exista;
 *   3. Leitura real no Storage (`object/list/<bucket>` consulta storage.objects).
 *
 * Zero dependências (fetch nativo do Node 18+). Pode ser importado em testes.
 *
 * Códigos de saída:
 *   0 = sucesso (gravação real confirmada no banco)
 *   1 = falha
 *   2 = degradado: RPC `rpc_keep_alive` ausente (aplicar migração 20261027000000)
 *   3 = projeto PAUSADO / endereço inexistente (acionar watchdog / restore)
 *
 * Variáveis de ambiente:
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY | SUPABASE_ANON_KEY | VITE_SUPABASE_PUBLISHABLE_KEY
 *   SUPABASE_STORAGE_BUCKET | VITE_SUPABASE_STORAGE_BUCKET (padrão: product-images)
 *   PING_SOURCE (padrão: script)
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_SUPABASE_URL = 'https://fujgtzxzspqhvvbzmqzv.supabase.co';
export const DEFAULT_BUCKET = 'product-images';

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, DEGRADED: 2, PAUSED: 3 });

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 540, 544, 546]);
const PAUSED_HTTP = new Set([540]);
const DNS_NOT_FOUND = new Set(['ENOTFOUND']);
const TRANSIENT_NET = new Set(['EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT']);

/** Lê um arquivo .env simples (KEY=VALUE) sem dependências. */
export function parseEnvFile(content) {
  const out = {};
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Carrega .env.staging / .env.local / .env (somente o que não estiver no ambiente). */
export function loadDotEnvFallback(rootDir) {
  const merged = {};
  for (const name of ['.env', '.env.local', '.env.staging']) {
    const p = resolve(rootDir, name);
    if (existsSync(p)) {
      try { Object.assign(merged, parseEnvFile(readFileSync(p, 'utf8'))); } catch (_) { /* ignora */ }
    }
  }
  return merged;
}

/** Resolve a configuração final a partir do ambiente (+ fallback .env). */
export function resolveConfig(env = {}, fileEnv = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = env[k] ?? fileEnv[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const url = (pick('SUPABASE_URL', 'VITE_SUPABASE_URL') || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key = pick('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY');
  const bucket = pick('SUPABASE_STORAGE_BUCKET', 'VITE_SUPABASE_STORAGE_BUCKET') || DEFAULT_BUCKET;
  const source = (pick('PING_SOURCE') || 'script').slice(0, 40);
  return { url, key, bucket, source };
}

/** Bloqueia chaves administrativas: o keep-alive só pode usar a chave pública. */
export function assertPublicKey(key) {
  if (!key) throw new Error('Chave pública do Supabase ausente (SUPABASE_PUBLISHABLE_KEY).');
  const lower = key.toLowerCase();
  if (lower.startsWith('sb_secret_') || lower.includes('service_role')) {
    throw new Error('Chave administrativa recusada: o keep-alive deve usar apenas a chave publishable/anon.');
  }
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (payload && payload.role === 'service_role') {
        throw new Error('Chave administrativa recusada: o keep-alive deve usar apenas a chave publishable/anon.');
      }
    } catch (err) {
      if (/recusada/.test(err.message)) throw err;
    }
  }
}

function nowBRT() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/** Logger que nunca imprime segredos. */
export function createLogger(secrets = [], sink = console) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  const redact = (msg) => list.reduce((acc, s) => acc.split(s).join('***'), String(msg));
  return {
    info: (m) => sink.log(`[${nowBRT()} BRT] ${redact(m)}`),
    warn: (m) => sink.warn(`[${nowBRT()} BRT] AVISO: ${redact(m)}`),
    error: (m) => sink.error(`[${nowBRT()} BRT] ERRO: ${redact(m)}`),
    redact
  };
}

function errorCode(err) {
  return err?.cause?.code || err?.code || err?.cause?.errno || '';
}

/** Classifica uma falha de rede. */
export function classifyNetworkError(err) {
  const code = String(errorCode(err));
  if (DNS_NOT_FOUND.has(code)) return 'dns_not_found';
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  if (TRANSIENT_NET.has(code)) return 'transient';
  return 'transient';
}

/**
 * fetch com timeout + novas tentativas com espera crescente.
 * Retorna { res, body, json } ou lança erro com `.kind` ('dns_not_found' | 'timeout' | 'transient' | 'http').
 */
export async function fetchWithRetry(url, init, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    attempts = 5,
    baseDelayMs = 2000,
    timeoutMs = 15000,
    logger = null,
    label = url
  } = opts;

  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { ...init, signal: controller?.signal });
      const body = await res.text();
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch (_) { json = null; }
      if (RETRYABLE_HTTP.has(res.status) && attempt < attempts) {
        lastErr = Object.assign(new Error(`HTTP ${res.status}`), { kind: 'http', status: res.status, body });
        logger?.warn(`${label}: HTTP ${res.status} (tentativa ${attempt}/${attempts}), tentando novamente...`);
      } else {
        return { res, body, json };
      }
    } catch (err) {
      const kind = classifyNetworkError(err);
      lastErr = Object.assign(new Error(err?.message || String(err)), { kind, code: errorCode(err) });
      logger?.warn(`${label}: falha de rede [${kind}${lastErr.code ? ' ' + lastErr.code : ''}] (tentativa ${attempt}/${attempts})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (attempt < attempts) await sleep(baseDelayMs * Math.pow(2, attempt - 1));
  }
  throw lastErr || new Error('Falha desconhecida');
}

function headersFor(key, extra = {}) {
  return { apikey: key, Accept: 'application/json', ...extra };
}

/**
 * Executa o keep-alive completo.
 * @returns {Promise<{ exitCode: number, results: Object }>}
 */
export async function runKeepAlive(options = {}) {
  const {
    env = (typeof process !== 'undefined' ? process.env : {}),
    fileEnv = {},
    fetchImpl = globalThis.fetch,
    sleep,
    sink = console,
    retry = {},
    clock = () => Date.now()
  } = options;

  const cfg = resolveConfig(env, fileEnv);
  const log = createLogger([cfg.key], sink);
  const results = { url: cfg.url, source: cfg.source, rpc: null, legacy: null, storage: null, paused: false };

  try {
    assertPublicKey(cfg.key);
  } catch (err) {
    log.error(err.message);
    return { exitCode: EXIT.FAILED, results };
  }

  const net = { fetchImpl, sleep, logger: log, ...retry };
  log.info(`Keep-Alive GestãoPro -> ${cfg.url} (origem: ${cfg.source})`);

  // ---- 1. RPC de gravação real ------------------------------------------------
  let dbActivityConfirmed = false;
  let rpcMissing = false;
  try {
    const { res, json, body } = await fetchWithRetry(`${cfg.url}/rest/v1/rpc/rpc_keep_alive`, {
      method: 'POST',
      headers: headersFor(cfg.key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ping_source: cfg.source })
    }, { ...net, label: 'RPC rpc_keep_alive' });

    results.rpc = { status: res.status };
    if (res.ok && json && json.status === 'alive') {
      const ts = Date.parse(json.timestamp);
      const fresh = Number.isFinite(ts) && Math.abs(clock() - ts) < 10 * 60 * 1000;
      results.rpc.totalPings = json.total_pings;
      results.rpc.fresh = fresh;
      if (fresh && Number(json.total_pings) >= 1) {
        dbActivityConfirmed = true;
        log.info(`PostgreSQL OK: gravação real confirmada (total_pings=${json.total_pings}, last_ping=${json.timestamp})`);
      } else {
        log.warn(`RPC respondeu, mas o timestamp não é recente (${json.timestamp}).`);
      }
    } else if (res.status === 404 && /PGRST202/.test(body || '')) {
      rpcMissing = true;
      log.warn('RPC rpc_keep_alive NÃO existe no banco (PGRST202). Aplique a migração 20261027000000_keep_alive_heartbeat.sql.');
    } else if (PAUSED_HTTP.has(res.status)) {
      results.paused = true;
      log.error(`RPC rpc_keep_alive: HTTP ${res.status} (projeto pausado).`);
    } else {
      log.error(`RPC rpc_keep_alive falhou: HTTP ${res.status} ${String(body || '').slice(0, 200)}`);
    }
  } catch (err) {
    results.rpc = { error: err.message, kind: err.kind };
    if (err.kind === 'dns_not_found' || (err.kind === 'http' && PAUSED_HTTP.has(err.status))) results.paused = true;
    log.error(`RPC rpc_keep_alive inacessível: ${err.message}`);
  }

  // ---- 2. Fallback: RPC legada ------------------------------------------------
  if (!dbActivityConfirmed && !results.paused) {
    try {
      const { res, body } = await fetchWithRetry(`${cfg.url}/rest/v1/rpc/keep_alive`, {
        method: 'POST',
        headers: headersFor(cfg.key, { 'Content-Type': 'application/json' }),
        body: '{}'
      }, { ...net, attempts: 2, label: 'RPC legada keep_alive' });
      results.legacy = { status: res.status };
      if (res.ok) {
        log.info('Fallback: RPC legada keep_alive respondeu 200 (consulta real executada).');
        if (!rpcMissing) dbActivityConfirmed = true;
        else results.legacy.note = 'rpc_keep_alive ausente; legado executou consulta';
      } else {
        log.warn(`Fallback legado: HTTP ${res.status} ${String(body || '').slice(0, 160)}`);
      }
    } catch (err) {
      results.legacy = { error: err.message, kind: err.kind };
      if (err.kind === 'dns_not_found') results.paused = true;
    }
  }

  // ---- 3. Storage (leitura real em storage.objects) ---------------------------
  if (!results.paused) {
    try {
      const { res, body } = await fetchWithRetry(`${cfg.url}/storage/v1/object/list/${encodeURIComponent(cfg.bucket)}`, {
        method: 'POST',
        headers: headersFor(cfg.key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix: '', limit: 1, offset: 0 })
      }, { ...net, label: 'Storage object/list' });
      results.storage = { status: res.status };
      if (res.ok) log.info(`Storage OK: HTTP ${res.status} (bucket ${cfg.bucket})`);
      else log.warn(`Storage respondeu HTTP ${res.status} ${String(body || '').slice(0, 160)}`);
    } catch (err) {
      results.storage = { error: err.message, kind: err.kind };
      if (err.kind === 'dns_not_found') results.paused = true;
      log.warn(`Storage inacessível: ${err.message}`);
    }
  }

  // ---- Resultado --------------------------------------------------------------
  let exitCode;
  if (results.paused) {
    exitCode = EXIT.PAUSED;
    log.error('Projeto Supabase PAUSADO ou endereço inexistente (DNS NXDOMAIN). Acione o watchdog/restore.');
  } else if (dbActivityConfirmed) {
    exitCode = EXIT.OK;
    log.info('Keep-Alive concluído com SUCESSO: contador de inatividade zerado.');
  } else if (rpcMissing) {
    exitCode = EXIT.DEGRADED;
    log.error('Keep-Alive DEGRADADO: sem gravação real no banco até a migração ser aplicada.');
  } else {
    exitCode = EXIT.FAILED;
    log.error('Keep-Alive FALHOU: nenhuma atividade real confirmada no banco.');
  }
  results.exitCode = exitCode;
  return { exitCode, results };
}

function writeStepSummary(results) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const icon = { 0: '✅', 1: '❌', 2: '⚠️', 3: '⏸️' }[results.exitCode] || '❔';
  const lines = [
    `### ${icon} Supabase Keep-Alive (${results.source})`,
    '',
    '| Etapa | Resultado |',
    '|---|---|',
    `| RPC rpc_keep_alive | ${results.rpc?.status ?? results.rpc?.kind ?? '-'}${results.rpc?.totalPings ? ` (total_pings=${results.rpc.totalPings})` : ''} |`,
    `| RPC legada | ${results.legacy?.status ?? results.legacy?.kind ?? 'não necessária'} |`,
    `| Storage | ${results.storage?.status ?? results.storage?.kind ?? '-'} |`,
    `| Código de saída | ${results.exitCode} |`,
    ''
  ];
  try { appendFileSync(file, lines.join('\n') + '\n'); } catch (_) { /* ignora */ }
}

// ---- Execução via CLI -----------------------------------------------------------
const isMain = (() => {
  try { return import.meta.url === pathToFileURL(process.argv[1] || '').href; } catch (_) { return false; }
})();

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const fileEnv = loadDotEnvFallback(root);
  runKeepAlive({ env: process.env, fileEnv })
    .then(({ exitCode, results }) => { writeStepSummary(results); process.exit(exitCode); })
    .catch((err) => { console.error('Erro inesperado no keep-alive:', err?.message || err); process.exit(EXIT.FAILED); });
}
