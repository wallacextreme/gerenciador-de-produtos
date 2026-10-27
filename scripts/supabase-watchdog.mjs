#!/usr/bin/env node
/**
 * GestãoPro — Supabase Watchdog (PHASE 16 / Anti-Pause Definitivo)
 * ----------------------------------------------------------------
 * Usa a Supabase Management API (token pessoal `SUPABASE_ACCESS_TOKEN`) para:
 *   ensure-active            -> verifica o status do projeto; se PAUSADO, chama
 *                               POST /v1/projects/{ref}/restore e aguarda ficar
 *                               ACTIVE_HEALTHY e o endereço público responder.
 *   apply-migration <arquivo> -> executa o SQL no banco (POST /database/query).
 *   status                   -> apenas imprime o status atual.
 *
 * Sem token: registra aviso e sai com 0 (o keep-alive comum continua funcionando).
 * O token NUNCA é impresso nos logs.
 *
 * Códigos de saída: 0 = ok/sem token, 1 = falha, 4 = token inválido/sem permissão.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger, resolveConfig, loadDotEnvFallback } from './supabase-keep-alive.mjs';

export const MANAGEMENT_API = 'https://api.supabase.com';
export const WD_EXIT = Object.freeze({ OK: 0, FAILED: 1, AUTH: 4 });

export const PAUSED_STATES = new Set(['INACTIVE', 'PAUSED']);
export const TRANSITION_STATES = new Set(['RESTORING', 'COMING_UP', 'RESTARTING', 'UPGRADING', 'RESIZING', 'PAUSING', 'GOING_DOWN']);
export const FATAL_STATES = new Set(['REMOVED', 'INIT_FAILED', 'RESTORE_FAILED']);

/** Extrai o project ref de https://<ref>.supabase.co */
export function projectRefFromUrl(url) {
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

export function createWatchdog(options = {}) {
  const {
    env = process.env,
    fileEnv = {},
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    sink = console,
    pollIntervalMs = 20000,
    maxWaitMs = 12 * 60 * 1000,
    clock = () => Date.now()
  } = options;

  const cfg = resolveConfig(env, fileEnv);
  const token = String(env.SUPABASE_ACCESS_TOKEN || '').trim();
  const ref = String(env.SUPABASE_PROJECT_REF || '').trim() || projectRefFromUrl(cfg.url);
  const log = createLogger([token, cfg.key], sink);

  async function api(method, path, body) {
    const res = await fetchImpl(`${MANAGEMENT_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { status: res.status, ok: res.ok, json, text };
  }

  function authError(status) {
    return status === 401 || status === 403;
  }

  async function getStatus() {
    const r = await api('GET', `/v1/projects/${ref}`);
    if (authError(r.status)) {
      const err = new Error(`Token sem permissão na Management API (HTTP ${r.status}).`);
      err.exitCode = WD_EXIT.AUTH;
      throw err;
    }
    if (!r.ok) throw new Error(`Falha ao consultar status do projeto (HTTP ${r.status}): ${String(r.text).slice(0, 200)}`);
    return String(r.json?.status || 'UNKNOWN').toUpperCase();
  }

  /** Aguarda o endereço público responder (qualquer resposta HTTP = DNS/gateway no ar). */
  async function waitPublicEndpoint(deadline) {
    while (clock() < deadline) {
      try {
        const res = await fetchImpl(`${cfg.url}/auth/v1/health`, { headers: cfg.key ? { apikey: cfg.key } : {} });
        if (res.status < 500) {
          log.info(`Endereço público respondendo (HTTP ${res.status}).`);
          return true;
        }
      } catch (_) { /* DNS ainda propagando */ }
      await sleep(pollIntervalMs);
    }
    return false;
  }

  async function ensureActive() {
    if (!token) {
      log.warn('SUPABASE_ACCESS_TOKEN não configurado: auto-restore DESLIGADO (keep-alive comum continua ativo).');
      return { exitCode: WD_EXIT.OK, skipped: true };
    }
    if (!ref) {
      log.error('Não foi possível determinar o project ref (SUPABASE_PROJECT_REF / SUPABASE_URL).');
      return { exitCode: WD_EXIT.FAILED };
    }

    const deadline = clock() + maxWaitMs;
    let status = await getStatus();
    log.info(`Status do projeto ${ref}: ${status}`);
    let restored = false;

    if (FATAL_STATES.has(status)) {
      log.error(`Projeto em estado fatal (${status}). Intervenção manual necessária no painel do Supabase.`);
      return { exitCode: WD_EXIT.FAILED, status };
    }

    if (PAUSED_STATES.has(status)) {
      log.warn('Projeto PAUSADO. Solicitando restauração automática...');
      const r = await api('POST', `/v1/projects/${ref}/restore`, {});
      if (authError(r.status)) {
        log.error(`Token sem permissão para restaurar (HTTP ${r.status}).`);
        return { exitCode: WD_EXIT.AUTH, status };
      }
      if (!r.ok) {
        log.error(`Restore recusado (HTTP ${r.status}): ${String(r.text).slice(0, 300)}`);
        return { exitCode: WD_EXIT.FAILED, status };
      }
      restored = true;
      log.info('Restore aceito pelo Supabase. Aguardando ACTIVE_HEALTHY...');
      status = 'RESTORING';
    }

    while (status !== 'ACTIVE_HEALTHY' && clock() < deadline) {
      if (FATAL_STATES.has(status)) {
        log.error(`Restauração falhou (${status}).`);
        return { exitCode: WD_EXIT.FAILED, status, restored };
      }
      await sleep(pollIntervalMs);
      status = await getStatus();
      log.info(`Status: ${status}`);
    }

    if (status !== 'ACTIVE_HEALTHY') {
      log.error(`Tempo esgotado aguardando ACTIVE_HEALTHY (último status: ${status}).`);
      return { exitCode: WD_EXIT.FAILED, status, restored };
    }

    const reachable = await waitPublicEndpoint(deadline);
    if (!reachable) {
      log.error('Projeto ACTIVE_HEALTHY, mas o endereço público ainda não responde.');
      return { exitCode: WD_EXIT.FAILED, status, restored };
    }
    log.info(restored ? 'Projeto RESTAURADO automaticamente e respondendo.' : 'Projeto ativo e saudável.');
    return { exitCode: WD_EXIT.OK, status, restored };
  }

  async function applyMigration(sql) {
    if (!token) {
      log.warn('SUPABASE_ACCESS_TOKEN não configurado: migração automática indisponível.');
      return { exitCode: WD_EXIT.OK, skipped: true };
    }
    if (!sql || !sql.trim()) {
      log.error('SQL vazio.');
      return { exitCode: WD_EXIT.FAILED };
    }
    const r = await api('POST', `/v1/projects/${ref}/database/query`, { query: sql });
    if (authError(r.status)) {
      log.error(`Token sem permissão para executar SQL (HTTP ${r.status}).`);
      return { exitCode: WD_EXIT.AUTH };
    }
    if (!r.ok) {
      log.error(`Migração falhou (HTTP ${r.status}): ${String(r.text).slice(0, 400)}`);
      return { exitCode: WD_EXIT.FAILED };
    }
    log.info(`Migração aplicada com sucesso (HTTP ${r.status}).`);
    return { exitCode: WD_EXIT.OK };
  }

  async function status() {
    if (!token) {
      log.warn('SUPABASE_ACCESS_TOKEN não configurado.');
      return { exitCode: WD_EXIT.OK, skipped: true };
    }
    const s = await getStatus();
    log.info(`Status do projeto ${ref}: ${s}`);
    return { exitCode: WD_EXIT.OK, status: s };
  }

  return { ensureActive, applyMigration, status, ref, log };
}

// ---- Execução via CLI -----------------------------------------------------------
const isMain = (() => {
  try { return import.meta.url === pathToFileURL(process.argv[1] || '').href; } catch (_) { return false; }
})();

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [command = 'ensure-active', arg] = process.argv.slice(2);
  const wd = createWatchdog({ env: process.env, fileEnv: loadDotEnvFallback(root) });

  const run = async () => {
    if (command === 'ensure-active') return wd.ensureActive();
    if (command === 'status') return wd.status();
    if (command === 'apply-migration') {
      const file = resolve(root, arg || 'supabase/migrations/20261027000000_keep_alive_heartbeat.sql');
      return wd.applyMigration(readFileSync(file, 'utf8'));
    }
    wd.log.error(`Comando desconhecido: ${command}`);
    return { exitCode: WD_EXIT.FAILED };
  };

  run()
    .then((r) => {
      if (process.env.GITHUB_STEP_SUMMARY) {
        try {
          appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `- Watchdog \`${command}\`: exit ${r.exitCode}${r.status ? ` · status ${r.status}` : ''}${r.restored ? ' · **RESTAURADO automaticamente**' : ''}${r.skipped ? ' · (sem token, ignorado)' : ''}\n`);
        } catch (_) { /* ignora */ }
      }
      process.exit(r.exitCode);
    })
    .catch((err) => { wd.log.error(err?.message || String(err)); process.exit(err?.exitCode || WD_EXIT.FAILED); });
}
