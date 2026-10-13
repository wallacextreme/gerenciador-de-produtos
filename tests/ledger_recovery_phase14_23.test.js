import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get } from 'firebase/database';
import { getDB } from '../src/js/db/connection.js';
import { authService } from '../src/js/services/AuthService.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { FirebaseRealtimeProvider } from '../src/js/sync/FirebaseRealtimeProvider.js';
import { setTenantResolver } from '../src/js/repositories/BaseRepository.js';

/**
 * FASE 14.23 — Máquina de estados única para resultados remotos desconhecidos (ledger append-only).
 * Todos os cenários usam exclusivamente o RTDB Emulator local e dados fictícios.
 * Verificam-se o conteúdo REMOTO real e o estado persistido no Outbox.
 */

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-ledger-recovery-14-23';
const TENANT = 'tenantA';

let testEnv;
let spawnedProcess = null;

async function isEmulatorRunning(port = EMULATOR_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.inspect/coverage.json`, { signal: AbortSignal.timeout(1000) });
    return res.ok || res.status === 404 || res.status === 401;
  } catch {
    return false;
  }
}

async function ensureEmulator(port = EMULATOR_PORT) {
  if (await isEmulatorRunning(port)) return;
  const jarPath = join(homedir(), '.cache', 'firebase', 'emulators', 'firebase-database-emulator-v4.11.2.jar');
  if (!existsSync(jarPath)) throw new Error(`Emulador RTDB não encontrado em ${jarPath}.`);
  spawnedProcess = spawn('java', ['-jar', jarPath, '--port', String(port)], { stdio: 'ignore', detached: true });
  spawnedProcess.unref();
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isEmulatorRunning(port)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout aguardando emulador RTDB na porta ${port}`);
}

function createTestSession(uid, tenantId, appRole) {
  return {
    authenticated: true, uid, tenantId, role: appRole, appRole,
    claims: { tenantId, role: appRole, appRole, canonicalClaims: true },
    canonicalClaims: true, requiresMigration: false
  };
}

function createAuth(session) {
  return {
    getCurrentSession: () => session,
    getTenantId: () => session?.tenantId || null,
    isConfigured: () => true,
    isAdmin: () => session?.appRole === 'admin',
    isOperator: () => session?.appRole === 'operator',
    isViewer: () => session?.appRole === 'viewer',
    onAuthStateChanged: (cb) => { try { cb(session); } catch (_) {} return () => {}; }
  };
}

let seq = 0;
function newMovementId(label) {
  seq++;
  return `mov_${label}_${seq}_${Date.now()}`;
}

function movPayload(id, overrides = {}) {
  return { id, productId: 'prod_ledger', quantity: 5, delta: 5, type: 'IN', referenceId: 'ref_1', referenceType: 'PURCHASE', ...overrides };
}

describe('FASE 14.23 — Recuperação do ledger append-only: leitura separada da escrita', () => {
  let auth;
  let adminCtx;
  let adminDb;
  let clock;

  /** Cria provider real (RTDB Emulator) com contadores de leitura/escrita e modo de falha de leitura injetável. */
  function makeEngine() {
    const provider = new FirebaseRealtimeProvider(null, auth);
    provider.db = adminDb;
    provider._initialized = true;
    provider._connected = true;

    const spy = { pushCalls: 0, getCalls: 0, getMode: 'real', getError: null };
    const realPush = provider.pushChange.bind(provider);
    const realGet = provider.get.bind(provider);
    provider.pushChange = async (item) => { spy.pushCalls++; return realPush(item); };
    provider.get = async (entityType, entityId) => {
      spy.getCalls++;
      if (spy.getMode === 'throw') throw spy.getError;
      return realGet(entityType, entityId);
    };

    const engine = new SyncEngine(provider, auth);
    engine.autoSync = false;
    engine._now = () => clock;
    return { engine, provider, spy };
  }

  async function remoteMovement(id) {
    const snap = await get(ref(adminDb, `tenants/${TENANT}/inventory/${id}`));
    return snap.exists() ? snap.val() : null;
  }

  async function seedRemote(id, data) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `tenants/${TENANT}/inventory/${id}`), data);
    });
  }

  async function enqueueLedger(id, payload = movPayload(id), state = {}) {
    const item = await syncRepository.enqueue({
      entityType: 'stockMovements', entityId: id, action: 'CREATE', payload, tenantId: TENANT
    });
    if (Object.keys(state).length) {
      await syncRepository.update({ ...item, ...state }, { isTechnicalUpdate: true });
    }
    return item;
  }

  const unknownState = { status: 'PENDING', dispatchStarted: true, remoteOutcomeUnknown: true, remoteAckReceived: false };

  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: { host: '127.0.0.1', port: EMULATOR_PORT, rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') }
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
    if (spawnedProcess && spawnedProcess.pid) { try { process.kill(spawnedProcess.pid); } catch (_) {} }
  });

  beforeEach(async () => {
    await testEnv.clearDatabase();
    const db = await getDB();
    for (const s of ['products', 'stockMovements', 'settings', 'syncQueue', 'imageManifest']) {
      try { await db.clear(s); } catch (_) {}
    }
    auth = createAuth(createTestSession('admin_1423', TENANT, 'admin'));
    adminCtx = testEnv.authenticatedContext('admin_1423', { tenantId: TENANT, role: 'admin', appRole: 'admin' });
    adminDb = adminCtx.database();
    authService.setProvider(auth);
    setTenantResolver(() => TENANT);
    clock = Date.now();
  });

  afterEach(() => {
    setTenantResolver(() => authService.getTenantId());
    authService.setProvider(null);
  });

  it('A. Envio comprovadamente NÃO iniciado: libera para despacho sem leitura remota e grava exatamente uma vez', async () => {
    const id = newMovementId('notstarted');
    const item = await enqueueLedger(id);
    const claimed = await syncRepository.claimForDispatch(item.id, 'crashed_instance');
    expect(claimed.dispatchStarted).toBe(false);

    const { engine, spy } = makeEngine();
    const rec = await engine.recoverInterruptedInFlight({ force: true });
    expect(rec.recovered).toBe(1);
    expect(rec.awaitingReconciliation).toBe(0);

    const afterRecover = await syncRepository.findById(item.id);
    expect(afterRecover.status).toBe('PENDING');
    expect(afterRecover.releasedBeforeDispatch).toBe(true);
    expect(afterRecover.remoteOutcomeUnknown).toBeFalsy();

    await engine.processQueue();
    expect(spy.getCalls).toBe(0);
    expect(spy.pushCalls).toBe(1);
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    const remote = await remoteMovement(id);
    expect(remote.delta).toBe(5);
    expect(remote.productId).toBe('prod_ledger');
  });

  it('B. Envio iniciado + resposta remota perdida: reconcilia por leitura, conclui SYNCED sem nova escrita nem segundo movimento', async () => {
    const id = newMovementId('lostack');
    const item = await enqueueLedger(id);
    const first = makeEngine();
    await first.engine.processQueue();
    expect(first.spy.pushCalls).toBe(1);
    const before = await remoteMovement(id);
    expect(before).not.toBeNull();

    // Simula perda local do ACK: a Outbox volta a "em voo" com envio iniciado e sem ACK.
    const synced = await syncRepository.findById(item.id);
    await syncRepository.update({
      ...synced, status: 'SYNCING', inFlight: true, claimedBy: 'dead', claimAttemptId: 'att_dead',
      dispatchStarted: true, remoteAckReceived: false, remoteOutcomeUnknown: false, syncedAt: null
    }, { isTechnicalUpdate: true });

    const { engine, spy } = makeEngine();
    const rec = await engine.recoverInterruptedInFlight({ force: true });
    expect(rec.awaitingReconciliation).toBe(1);
    expect(rec.blocked).toBe(0);
    const mid = await syncRepository.findById(item.id);
    expect(mid.status).toBe('PENDING');
    expect(mid.remoteOutcomeUnknown).toBe(true);
    expect(mid.requiresResolution).toBe(false);

    await engine.processQueue();
    expect(spy.pushCalls).toBe(0); // nenhuma nova escrita
    expect(spy.getCalls).toBe(1);
    const done = await syncRepository.findById(item.id);
    expect(done.status).toBe('SYNCED');
    expect(done.remoteOutcomeUnknown).toBe(false);

    const after = await remoteMovement(id);
    expect(after).toEqual(before); // conteúdo remoto intacto (sem segundo impacto)
  });

  it('C. Leitura autorizada retorna null: ausência comprovada autoriza o despacho (CREATE de ledger)', async () => {
    const id = newMovementId('absent');
    const item = await enqueueLedger(id, movPayload(id), unknownState);
    expect(await remoteMovement(id)).toBeNull();

    const { engine, spy } = makeEngine();
    await engine.processQueue();
    expect(spy.getCalls).toBe(1);
    expect(spy.pushCalls).toBe(1);
    const done = await syncRepository.findById(item.id);
    expect(done.status).toBe('SYNCED');
    expect(done.remoteOutcomeUnknown).toBe(false);
    expect((await remoteMovement(id)).delta).toBe(5);
  });

  it('D. Timeout repetido na LEITURA: nunca reenvia; backoff respeitado; escala para resolução ao esgotar leituras', async () => {
    const id = newMovementId('timeout');
    const item = await enqueueLedger(id, movPayload(id), unknownState);
    const { engine, spy } = makeEngine();
    spy.getMode = 'throw';
    spy.getError = Object.assign(new Error('ETIMEDOUT: leitura expirou'), { code: 'network_error' });

    let res = await engine.processQueue();
    expect(res.reconcileDeferred).toBe(1);
    let cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('PENDING');
    expect(cur.requiresResolution).toBe(false);
    expect(cur.remoteOutcomeUnknown).toBe(true);
    expect(cur.reconcileAttempts).toBe(1);
    expect(spy.pushCalls).toBe(0);
    expect(await remoteMovement(id)).toBeNull();

    // Dentro da janela de backoff: a leitura nem é repetida
    await engine.processQueue();
    expect(spy.getCalls).toBe(1);

    // Reinicialização do SyncEngine: o backoff persistido sobrevive
    const restarted = makeEngine();
    restarted.spy.getMode = 'throw';
    restarted.spy.getError = spy.getError;
    await restarted.engine.processQueue();
    expect(restarted.spy.getCalls).toBe(0);

    // Após cada backoff, nova tentativa de LEITURA; escrita jamais ocorre
    for (let i = 2; i <= 4; i++) {
      clock += 120000;
      await restarted.engine.processQueue();
      cur = await syncRepository.findById(item.id);
      expect(cur.reconcileAttempts).toBe(i);
      expect(cur.status).toBe('PENDING');
      expect(restarted.spy.pushCalls).toBe(0);
    }

    // Quinta leitura inacessível: esgota -> bloqueio para resolução, ainda sem nenhuma escrita
    clock += 120000;
    res = await restarted.engine.processQueue();
    expect(res.failed).toBe(1);
    cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('FAILED');
    expect(cur.requiresResolution).toBe(true);
    expect(cur.errorCategory).toBe('unknown_remote_outcome');
    expect(restarted.spy.pushCalls).toBe(0);
    expect(await remoteMovement(id)).toBeNull();
  });

  it('E. Leitura negada por permissão: erro de SEGURANÇA (bloqueio), nunca ausência nem retry transitório', async () => {
    const id = newMovementId('perm');
    const item = await enqueueLedger(id, movPayload(id), unknownState);
    const { engine, spy } = makeEngine();
    spy.getMode = 'throw';
    spy.getError = Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });

    const res = await engine.processQueue();
    expect(res.failed).toBe(1);
    const cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('FAILED');
    expect(cur.requiresResolution).toBe(true);
    expect(cur.errorCategory).toBe('security');
    expect(spy.pushCalls).toBe(0);
    expect(await remoteMovement(id)).toBeNull();
  });

  it('F. Registro remoto equivalente (ACK perdido): conclui SYNCED sem duplicação', async () => {
    const id = newMovementId('equiv');
    const payload = movPayload(id);
    await seedRemote(id, { ...payload, tenantId: TENANT });
    const before = await remoteMovement(id);
    const item = await enqueueLedger(id, payload, unknownState);

    const { engine, spy } = makeEngine();
    await engine.processQueue();
    expect(spy.pushCalls).toBe(0);
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    expect(await remoteMovement(id)).toEqual(before);
  });

  const divergences = [
    ['quantidade divergente', { quantity: 9, delta: 9 }],
    ['delta divergente', { delta: 6 }],
    ['produto divergente', { productId: 'prod_other' }],
    ['tenant divergente', { tenantId: 'tenantB' }]
  ];
  for (const [label, remoteOverride] of divergences) {
    it(`G. Registro remoto com ${label}: bloqueia para resolução e preserva o conteúdo remoto`, async () => {
      const id = newMovementId('div');
      const payload = movPayload(id);
      await seedRemote(id, { ...payload, tenantId: TENANT, ...remoteOverride });
      const before = await remoteMovement(id);
      const item = await enqueueLedger(id, payload, unknownState);

      const { engine, spy } = makeEngine();
      const res = await engine.processQueue();
      expect(res.failed).toBe(1);
      expect(spy.pushCalls).toBe(0);
      const cur = await syncRepository.findById(item.id);
      expect(cur.status).toBe('FAILED');
      expect(cur.requiresResolution).toBe(true);
      expect(cur.errorCategory).toBe('payload_divergence_conflict');
      expect(cur.payload.quantity).toBe(5); // conteúdo local preservado
      expect(await remoteMovement(id)).toEqual(before); // conteúdo remoto preservado

      // Ledger nunca pode ser sobrescrito por decisão administrativa
      await expect(engine.reconcileOutboxItem(item.id, 'OVERWRITE_REMOTE')).rejects.toThrow();
      expect(await remoteMovement(id)).toEqual(before);
    });
  }

  it('H. Regras append-only: cliente não consegue sobrescrever movimento existente nem em recuperação', async () => {
    const id = newMovementId('immutable');
    await seedRemote(id, { ...movPayload(id), tenantId: TENANT });
    await assertFails(set(ref(adminDb, `tenants/${TENANT}/inventory/${id}`), movPayload(id, { quantity: 7, delta: 7 })));
    expect((await remoteMovement(id)).quantity).toBe(5);
  });

  it('I. Recuperação após reinicialização do SyncEngine (crash com envio iniciado) usa o estado persistido', async () => {
    const id = newMovementId('restart');
    const item = await enqueueLedger(id);
    await syncRepository.claimForDispatch(item.id, 'engine_that_died');
    await syncRepository.recordDispatchStarted(item.id, (await syncRepository.findById(item.id)).claimAttemptId);

    const { engine, spy } = makeEngine(); // "novo processo"
    const rec = await engine.recoverInterruptedInFlight({ force: true });
    expect(rec.awaitingReconciliation).toBe(1);
    const mid = await syncRepository.findById(item.id);
    expect(mid.remoteOutcomeUnknown).toBe(true);
    expect(mid.dispatchStarted).toBe(true);

    await engine.processQueue();
    expect(spy.getCalls).toBe(1); // reconciliou ANTES de escrever
    expect(spy.pushCalls).toBe(1); // ausência comprovada permitiu o envio
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    expect((await remoteMovement(id)).delta).toBe(5);
  });

  it('J. Duas instâncias reconciliando o mesmo item: uma única conclusão e um único movimento (equivalente)', async () => {
    const id = newMovementId('twoinst');
    const payload = movPayload(id);
    await seedRemote(id, { ...payload, tenantId: TENANT });
    const before = await remoteMovement(id);
    const item = await enqueueLedger(id, payload, unknownState);

    const a = makeEngine();
    const b = makeEngine();
    await Promise.all([a.engine.processQueue(), b.engine.processQueue()]);
    expect(a.spy.pushCalls + b.spy.pushCalls).toBe(0);
    expect(a.spy.getCalls + b.spy.getCalls).toBe(1); // a reserva exclusiva impediu leitura/decisão duplicada
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    expect(await remoteMovement(id)).toEqual(before);
  });

  it('J2. Duas instâncias com ausência comprovada: exatamente uma escrita', async () => {
    const id = newMovementId('twoabsent');
    const item = await enqueueLedger(id, movPayload(id), unknownState);
    const a = makeEngine();
    const b = makeEngine();
    await Promise.all([a.engine.processQueue(), b.engine.processQueue()]);
    expect(a.spy.pushCalls + b.spy.pushCalls).toBe(1);
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    expect((await remoteMovement(id)).delta).toBe(5);
  });

  it('K. ACK antigo após nova tentativa assumir: preservado em staleAttemptAcks, sem transição final indevida', async () => {
    const id = newMovementId('staleack');
    const payload = movPayload(id);
    const item = await enqueueLedger(id, payload);

    // Tentativa A reserva e inicia envio
    const claimA = await syncRepository.claimForDispatch(item.id, 'instance_A', { preserveDispatchStarted: true });
    await syncRepository.recordDispatchStarted(item.id, claimA.claimAttemptId);

    // Recuperadora B assume (lease forçado) e devolve para reconciliação
    const rec = makeEngine();
    await rec.engine.recoverInterruptedInFlight({ force: true });
    const claimB = await syncRepository.claimForDispatch(item.id, 'instance_B', { preserveDispatchStarted: true });
    expect(claimB.claimAttemptId).not.toBe(claimA.claimAttemptId);

    // ACK atrasado de A chega depois
    const late = await syncRepository.recordRemoteAck(item.id, claimA.claimAttemptId, { success: true, remoteVersion: 'v_old' });
    expect(late.superseded).toBe(true);
    const afterLate = await syncRepository.findById(item.id);
    expect(afterLate.status).not.toBe('SYNCED');
    expect(afterLate.claimAttemptId).toBe(claimB.claimAttemptId);
    expect(afterLate.staleAttemptAcks.length).toBe(1);
    expect(afterLate.remoteAckReceived).toBe(true); // evidência histórica, NÃO prova de conclusão atual

    // A tentativa B termina o ciclo; o ACK antigo não substitui a reconciliação por leitura
    await syncRepository.releaseDispatchClaim(item.id, claimB.claimAttemptId);
    const { engine, spy } = makeEngine();
    await engine.processQueue();
    expect(spy.getCalls).toBe(1); // leitura obrigatória apesar de remoteAckReceived === true
    const done = await syncRepository.findById(item.id);
    expect(done.staleAttemptAcks.length).toBe(1); // evidência histórica nunca é descartada
  });

  it('K2. ACK antigo + remoto divergente: permanece bloqueado e a evidência é preservada', async () => {
    const id = newMovementId('staledivergent');
    const payload = movPayload(id);
    await seedRemote(id, { ...payload, tenantId: TENANT, quantity: 8, delta: 8 });
    const before = await remoteMovement(id);
    const item = await enqueueLedger(id, payload, {
      status: 'PENDING', dispatchStarted: true, remoteOutcomeUnknown: true, remoteAckReceived: true,
      staleAttemptAcks: [{ attemptId: 'att_old', recordedAt: new Date().toISOString(), success: true }]
    });

    const { engine, spy } = makeEngine();
    await engine.processQueue();
    expect(spy.pushCalls).toBe(0);
    const cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('FAILED');
    expect(cur.requiresResolution).toBe(true);
    expect(cur.staleAttemptAcks.length).toBe(1);
    expect(await remoteMovement(id)).toEqual(before);
  });

  it('L. Provedor sem capacidade de leitura: ledger com resultado desconhecido nunca é despachado às cegas', async () => {
    const id = newMovementId('noget');
    const item = await enqueueLedger(id, movPayload(id), unknownState);
    let pushes = 0;
    const blind = {
      isConfigured: () => true,
      getProviderName: () => 'SemLeitura',
      pushChange: async () => { pushes++; return { success: true }; }
    };
    const engine = new SyncEngine(blind, auth);
    engine._now = () => clock;
    await engine.processQueue();
    expect(pushes).toBe(0);
    const cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('PENDING');
    expect(cur.remoteOutcomeUnknown).toBe(true);
    expect(cur.reconcileAttempts).toBe(1);
  });

  it('M. Falha de escrita no ledger seguida de leitura indisponível: PENDING + desconhecido (sem FAILED imediato, sem reenvio)', async () => {
    const id = newMovementId('writefail');
    const item = await enqueueLedger(id);
    const { engine, provider, spy } = makeEngine();
    provider.pushChange = async () => {
      spy.pushCalls++;
      throw Object.assign(new Error('Conexão perdida após envio'), { code: 'network_error' });
    };
    spy.getMode = 'throw';
    spy.getError = Object.assign(new Error('read timeout'), { code: 'network_error' });

    await engine.processQueue();
    expect(spy.pushCalls).toBe(1);
    const cur = await syncRepository.findById(item.id);
    expect(cur.status).toBe('PENDING');
    expect(cur.requiresResolution).toBe(false);
    expect(cur.remoteOutcomeUnknown).toBe(true);
    expect(cur.dispatchStarted).toBe(true);

    // Próximo ciclo (após backoff) com leitura disponível e registro ausente: reconciliar antes de escrever
    clock += 120000;
    spy.getMode = 'real';
    const real = makeEngine();
    await real.engine.processQueue();
    expect(real.spy.getCalls).toBe(1);
    expect(real.spy.pushCalls).toBe(1);
    expect((await syncRepository.findById(item.id)).status).toBe('SYNCED');
    expect((await remoteMovement(id)).delta).toBe(5);
  });
});
