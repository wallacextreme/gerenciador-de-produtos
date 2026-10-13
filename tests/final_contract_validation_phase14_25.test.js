import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
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
import { resolveBusinessRole } from '../src/js/auth/FirebaseAuthProvider.js';
import { checkPermission } from '../src/js/utils/authGuard.js';
import { legacyDataMigrationService } from '../src/js/services/LegacyDataMigrationService.js';
import {
  computeCanonicalPayloadHash,
  classifyRemoteOutcome,
  REMOTE_RECONCILIATION_OUTCOME,
  arePayloadsEquivalent
} from '../src/js/utils/operationIdentity.js';

/**
 * FASE 14.25 — VALIDAÇÃO FINAL DE CONTRATOS, COMPATIBILIDADE OFFLINE E RECUPERAÇÃO SEGURA
 *
 * Suíte de testes adversariais orientada a contratos para validar:
 * 1. Imutabilidade do payload e consolidação controlada pré-despacho vs. imutabilidade pós-despacho;
 * 2. Contrato do método de leitura Firebase nos 6 casos distintos (A-F) e teste integrado de recuperação do ledger;
 * 3. IDs estáveis, concorrência e regras append-only no RTDB Emulator;
 * 4. Integridade e isolamento de registros legados da Outbox;
 * 5. Claims canônicas (tenantId, appRole), rejeição de fallback e isolamento multi-tenant.
 */

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-final-contract-14-25';
const TENANT_A = 'tenantA';
const TENANT_B = 'tenantB';

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

function createSession(uid, tenantId, appRole, extraClaims = {}) {
  const isCanonical = typeof appRole === 'string' && ['admin', 'operator', 'viewer'].includes(appRole);
  return {
    authenticated: Boolean(uid && tenantId),
    uid: uid || null,
    email: uid ? `${uid}@gestaopro.com` : null,
    tenantId: tenantId || null,
    appRole: appRole || 'viewer',
    role: appRole || 'viewer',
    canonicalClaims: Boolean(isCanonical && tenantId),
    requiresMigration: false,
    ...extraClaims
  };
}

async function clearOutbox() {
  const db = await getDB();
  const tx = db.transaction('syncQueue', 'readwrite');
  await tx.objectStore('syncQueue').clear();
  await tx.done;
}

describe('FASE 14.25 — Validação Final de Contratos e Compatibilidade Offline', () => {
  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: {
        host: '127.0.0.1',
        port: EMULATOR_PORT,
        rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8')
      }
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
    if (spawnedProcess && spawnedProcess.pid) {
      try { process.kill(spawnedProcess.pid); } catch (_) {}
    }
  });

  let activeSession = null;
  function setSession(s) {
    activeSession = s;
    authService.getCurrentSession = () => activeSession;
    authService.getTenantId = () => activeSession?.tenantId || null;
    authService.getRole = () => activeSession?.role || 'viewer';
    setTenantResolver(() => activeSession?.tenantId || null);
  }

  beforeEach(async () => {
    await clearOutbox();
    setSession(createSession('u_admin_a', TENANT_A, 'admin'));
  });

  // =========================================================================
  // SEÇÃO 1: VERIFICAÇÃO A — Imutabilidade do payload e operações offline
  // =========================================================================
  describe('1. Verificação A — Imutabilidade do Payload e Consolidação Offline', () => {
    it('1.1 Consolidação legítima pré-despacho: CREATE seguido de UPDATE mescla payload, recomputa hash e preserva identity estável', async () => {
      // 1. Cria operação CREATE na Outbox
      const stableOpId = 'op_create_notebook_' + Date.now();
      const entityId = 'prod_nb_01';
      const initialPayload = {
        id: entityId,
        tenantId: TENANT_A,
        name: 'Notebook Gamer',
        salePriceCents: 500000,
        costPriceCents: 350000,
        currentStock: 10
      };

      const itemCreate = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'CREATE',
        payload: initialPayload,
        operationId: stableOpId
      });

      // 2. Confirma que a operação ainda não foi despachada e que não existe desfecho desconhecido
      expect(itemCreate.status).toBe('PENDING');
      expect(itemCreate.inFlight).toBe(false);
      expect(itemCreate.dispatchStarted).toBeFalsy();
      expect(itemCreate.remoteOutcomeUnknown).toBeFalsy();
      expect(itemCreate.remoteAckReceived).toBeFalsy();
      expect(itemCreate.operationId).toBe(stableOpId);

      const initialHash = computeCanonicalPayloadHash('products', itemCreate.payload);
      expect(itemCreate.canonicalPayloadHash).toBe(initialHash);

      // 3. Executa o fluxo real de consolidação de um UPDATE compatível
      const updatePayload = {
        salePriceCents: 550000,
        notes: 'Preço promocional ajustado antes do sync'
      };

      const coalescedItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'UPDATE',
        payload: updatePayload,
        operationId: 'op_update_temporary_id'
      });

      // 4. Confirma respeito aos contratos anteriores: ação CREATE, version: 1, sem baseVersion
      expect(coalescedItem.id).toBe(itemCreate.id);
      expect(coalescedItem.action).toBe('CREATE');
      expect(coalescedItem.payload.name).toBe('Notebook Gamer');
      expect(coalescedItem.payload.salePriceCents).toBe(550000);
      expect(coalescedItem.payload.costPriceCents).toBe(350000);
      expect(coalescedItem.payload.version).toBe(1);
      expect(coalescedItem.payload.baseVersion).toBeUndefined();

      // 5. Confirma que o payload canônico e seu hash permanecem sincronizados
      const newExpectedHash = computeCanonicalPayloadHash('products', coalescedItem.payload);
      expect(coalescedItem.canonicalPayloadHash).toBe(newExpectedHash);
      expect(coalescedItem.canonicalPayloadHash).not.toBe(initialHash);

      // 6. Confirma que a operação não foi enviada prematuramente e que sua identidade estável foi rigorosamente mantida
      expect(coalescedItem.dispatchStarted).toBeFalsy();
      expect(coalescedItem.operationId).toBe(stableOpId);

      const all = await syncRepository.findAll(false);
      expect(all.length).toBe(1);
    });

    it('1.2 Operação com despacho iniciado (dispatchStarted: true) recusa consolidação e preserva imutabilidade do original', async () => {
      const entityId = 'prod_locked_01';
      const originalPayload = { id: entityId, tenantId: TENANT_A, name: 'Monitor 4K', salePriceCents: 200000 };
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'CREATE',
        payload: originalPayload,
        operationId: 'op_monitor_orig'
      });

      // Simula início de despacho registrado duravelmente
      await syncRepository.update({
        ...item,
        dispatchStarted: true,
        status: 'PENDING' // Mesmo se redefinido para PENDING em crash recovery
      }, { isTechnicalUpdate: true });

      // Tentativa de novo UPDATE não deve coalescer no item cujo despacho já foi iniciado
      const updateItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'UPDATE',
        payload: { salePriceCents: 220000 },
        operationId: 'op_monitor_subsequent'
      });

      expect(updateItem.id).not.toBe(item.id);
      expect(updateItem.action).toBe('UPDATE');

      // O item original permanece estritamente intacto
      const preserved = await syncRepository.findById(item.id);
      expect(preserved.payload.salePriceCents).toBe(200000);
      expect(preserved.dispatchStarted).toBe(true);

      const all = await syncRepository.findAll(false);
      expect(all.length).toBe(2);

      // Ordem causal FIFO: a segunda operação detecta predecessora não sincronizada
      const hasPredecessor = await syncRepository.hasUnsyncedPredecessorOrInFlight(
        'products', entityId, TENANT_A, updateItem.id, updateItem.createdAt
      );
      expect(hasPredecessor).toBe(true);
    });

    it('1.3 Operação com resultado remoto desconhecido (remoteOutcomeUnknown: true) recusa consolidação', async () => {
      const entityId = 'prod_unknown_01';
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'CREATE',
        payload: { id: entityId, tenantId: TENANT_A, name: 'Cadeira Ergonômica', salePriceCents: 120000 }
      });

      await syncRepository.update({
        ...item,
        remoteOutcomeUnknown: true
      }, { isTechnicalUpdate: true });

      const second = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'UPDATE',
        payload: { salePriceCents: 130000 }
      });

      expect(second.id).not.toBe(item.id);
      const original = await syncRepository.findById(item.id);
      expect(original.payload.salePriceCents).toBe(120000);
      expect(original.remoteOutcomeUnknown).toBe(true);
    });

    it('1.4 Operações em voo (inFlight: true), bloqueadas (requiresResolution: true) ou SYNCED recusam consolidação', async () => {
      const entityId = 'prod_states_01';
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'CREATE',
        payload: { id: entityId, tenantId: TENANT_A, name: 'Teclado Mecânico', salePriceCents: 40000 }
      });

      // Caso 1: requiresResolution = true
      await syncRepository.update({
        ...item,
        requiresResolution: true,
        status: 'FAILED'
      }, { isTechnicalUpdate: true });

      const opBlocked = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'UPDATE',
        payload: { salePriceCents: 45000 }
      });
      expect(opBlocked.id).not.toBe(item.id);

      // Caso 2: markSynced conclui item; novo enqueue é criado como operação separada
      await syncRepository.markSynced(item.id, { remoteVersion: 'v1' });
      const opSynced = await syncRepository.enqueue({
        entityType: 'products',
        entityId,
        action: 'UPDATE',
        payload: { salePriceCents: 50000 }
      });
      expect(opSynced.id).not.toBe(item.id);
      expect(opSynced.action).toBe('UPDATE');
    });

    it('1.5 Atualização técnica legítima recusa alteração de identidade, hash canônico e payload comercial divergente', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_tech_test',
        action: 'CREATE',
        payload: { id: 'prod_tech_test', tenantId: TENANT_A, name: 'Mouse Sem Fio', salePriceCents: 8000 }
      });

      // Tentativa de alterar tenantId em atualização técnica
      await expect(syncRepository.update({
        ...item,
        tenantId: TENANT_B
      }, { isTechnicalUpdate: true })).rejects.toThrow(/alteração de tenantId.*estritamente proibida/i);

      // Tentativa de alterar operationId
      await expect(syncRepository.update({
        ...item,
        operationId: 'op_tampered_id'
      }, { isTechnicalUpdate: true })).rejects.toThrow(/alteração de operationId.*estritamente proibida/i);

      // Tentativa de alterar canonicalPayloadHash
      await expect(syncRepository.update({
        ...item,
        canonicalPayloadHash: '0000000000000000000000000000000000000000000000000000000000000000'
      }, { isTechnicalUpdate: true })).rejects.toThrow(/alteração de canonicalPayloadHash.*estritamente proibida/i);

      // Tentativa de alterar payload comercial em atualização técnica
      await expect(syncRepository.update({
        ...item,
        payload: { ...item.payload, salePriceCents: 99999 }
      }, { isTechnicalUpdate: true })).rejects.toThrow(/atualização técnica.*não pode alterar o payload comercial/i);

      // Atualização técnica legítima de metadados de ciclo de vida é aceita
      const updated = await syncRepository.update({
        ...item,
        claimedBy: 'worker_01',
        claimExpiresAt: new Date(Date.now() + 60000).toISOString(),
        reconcileAttempts: 1
      }, { isTechnicalUpdate: true });

      expect(updated.claimedBy).toBe('worker_01');
      expect(updated.reconcileAttempts).toBe(1);
    });

    it('1.6 Registro já SYNCED não pode ser reivindicado, despachado, reaberto por ACK nem ter payload alterado', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_synced_guard',
        action: 'CREATE',
        payload: { id: 'prod_synced_guard', tenantId: TENANT_A, name: 'Headset Pro', salePriceCents: 15000 }
      });

      await syncRepository.markSynced(item.id, { remoteVersion: 'v1' });

      // 1. claimForDispatch recusa item já sincronizado
      const claimRes = await syncRepository.claimForDispatch(item.id, 'worker_new');
      expect(claimRes).toBeNull();

      // 2. recordDispatchStarted recusa início de envio em item já sincronizado
      const dispatchStartedRes = await syncRepository.recordDispatchStarted(item.id, 'att_new');
      expect(dispatchStartedRes).toBeNull();

      // 3. ACK tardio não reabre o item
      const ackRes = await syncRepository.recordRemoteAck(item.id, 'att_old', { success: true });
      expect(ackRes.alreadySynced).toBe(true);
      const afterAck = await syncRepository.findById(item.id);
      expect(afterAck.status).toBe('SYNCED');

      // 4. Alteração de payload comercial é estritamente proibida
      await expect(syncRepository.update({
        ...item,
        payload: { ...item.payload, salePriceCents: 99999 }
      })).rejects.toThrow(/alteração de payload em item da Outbox sem equivalência semântica é estritamente proibida/i);
    });
  });

  // =========================================================================
  // SEÇÃO 2: VERIFICAÇÃO B — Contrato do método de leitura Firebase (Casos A-F)
  // =========================================================================
  describe('2. Verificação B — Contrato do Método de Leitura Firebase e Reconciliação', () => {
    it('2.1 Caso A — Ausência confirmada: nó inexistente retorna null e classifyRemoteOutcome classifica RECORD_ABSENT', async () => {
      const provider = new FirebaseRealtimeProvider();
      provider.db = testEnv.authenticatedContext('u_admin_a', { tenantId: TENANT_A, appRole: 'admin' }).database();
      provider.getTenantId = () => TENANT_A;
      provider.isConfigured = () => true;

      const entityId = 'mov_absent_' + Date.now();
      const readResult = await provider.get('inventory', entityId);
      expect(readResult).toBeNull();

      const comparison = classifyRemoteOutcome({
        entityType: 'inventory',
        entityId,
        action: 'CREATE',
        localPayload: { id: entityId, tenantId: TENANT_A, productId: 'p1', delta: 10 },
        remoteRecord: readResult
      });

      expect(comparison.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT);
      expect(comparison.isAbsent).toBe(true);
      expect(comparison.isEquivalent).toBe(false);
      expect(comparison.requiresResolution).toBe(false);
    });

    it('2.2 Caso B — Registro existente e equivalente: nó existente com payload idêntico classifica RECORD_EQUIVALENT', async () => {
      const db = testEnv.authenticatedContext('u_admin_a', { tenantId: TENANT_A, appRole: 'admin' }).database();
      const provider = new FirebaseRealtimeProvider();
      provider.db = db;
      provider.getTenantId = () => TENANT_A;
      provider.isConfigured = () => true;

      const entityId = 'mov_equiv_' + Date.now();
      const record = {
        id: entityId,
        productId: 'prod_100',
        type: 'IN',
        quantity: 15,
        delta: 15,
        reason: 'PURCHASE',
        date: new Date().toISOString()
      };

      // Grava no emulador RTDB
      await set(ref(db, `tenants/${TENANT_A}/inventory/${entityId}`), record);

      const readResult = await provider.get('inventory', entityId);
      expect(readResult).not.toBeNull();
      expect(readResult.delta).toBe(15);

      const comparison = classifyRemoteOutcome({
        entityType: 'inventory',
        entityId,
        action: 'CREATE',
        localPayload: { ...record, tenantId: TENANT_A },
        remoteRecord: readResult
      });

      expect(comparison.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(comparison.isEquivalent).toBe(true);
      expect(Boolean(comparison.isAbsent)).toBe(false);
      expect(Boolean(comparison.requiresResolution)).toBe(false);
    });

    it('2.3 Caso C — Registro existente e divergente: nó com delta ou produto divergente classifica RECORD_DIVERGENT com bloqueio', async () => {
      const db = testEnv.authenticatedContext('u_admin_a', { tenantId: TENANT_A, appRole: 'admin' }).database();
      const provider = new FirebaseRealtimeProvider();
      provider.db = db;
      provider.getTenantId = () => TENANT_A;
      provider.isConfigured = () => true;

      const entityId = 'mov_diverg_' + Date.now();
      const remoteRecord = {
        id: entityId,
        productId: 'prod_100',
        type: 'IN',
        quantity: 50,
        delta: 50, // Delta no servidor é 50
        reason: 'PURCHASE',
        date: new Date().toISOString()
      };
      await set(ref(db, `tenants/${TENANT_A}/inventory/${entityId}`), remoteRecord);

      const localPayload = {
        id: entityId,
        tenantId: TENANT_A,
        productId: 'prod_100',
        delta: 20, // Local achava que era 20
        type: 'IN',
        reason: 'PURCHASE'
      };

      const readResult = await provider.get('inventory', entityId);
      const comparison = classifyRemoteOutcome({
        entityType: 'inventory',
        entityId,
        action: 'CREATE',
        localPayload,
        remoteRecord: readResult
      });

      expect(comparison.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(comparison.isEquivalent).toBe(false);
      expect(comparison.isAbsent).toBe(false);
      expect(comparison.requiresResolution).toBe(true);
      expect(comparison.divergentFields.some(d => d.field === 'delta')).toBe(true);
    });

    it('2.4 Caso D — Permissão negada: erro de autorização é classificado PERMISSION_DENIED e não é confundido com null', async () => {
      const permissionError = new Error('Client doesn\'t have permission to access the desired data. (permission_denied)');
      permissionError.code = 'PERMISSION_DENIED';

      const comparison = classifyRemoteOutcome({
        entityType: 'inventory',
        entityId: 'mov_denied_01',
        action: 'CREATE',
        localPayload: { id: 'mov_denied_01', tenantId: TENANT_A },
        remoteRecord: null,
        readError: permissionError
      });

      expect(comparison.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED);
      expect(comparison.isAbsent).toBe(false);
      expect(comparison.isEquivalent).toBe(false);
      expect(comparison.requiresResolution).toBe(true);
    });

    it('2.5 Caso E — Falha transitória de transporte: erro de rede/timeout classifica INACCESSIBLE e não autoriza escrita', async () => {
      const networkError = new Error('Network timeout after 5000ms: ETMOUT');

      const comparison = classifyRemoteOutcome({
        entityType: 'inventory',
        entityId: 'mov_net_01',
        action: 'CREATE',
        localPayload: { id: 'mov_net_01', tenantId: TENANT_A },
        remoteRecord: null,
        readError: networkError
      });

      expect(comparison.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE);
      expect(comparison.isAbsent).toBe(false);
      expect(comparison.isEquivalent).toBe(false);
      expect(comparison.requiresResolution).toBe(true);
    });

    it('2.6 Caso F — Provedor sem capacidade confiável de leitura: nunca realiza reenvio cego de ledger', async () => {
      const providerWithoutGet = {
        getProviderName: () => 'BlindProvider',
        isConfigured: () => true,
        pushChange: async () => ({ success: true })
      };

      const syncEngine = new SyncEngine(providerWithoutGet, authService);
      const entityId = 'mov_blind_01';
      const item = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId,
        action: 'CREATE',
        payload: { id: entityId, tenantId: TENANT_A, productId: 'prod_b1', type: 'IN', quantity: 5, delta: 5, date: new Date().toISOString() }
      });

      // Simula que o item teve despacho iniciado e crash subsequente
      await syncRepository.update({
        ...item,
        dispatchStarted: true,
        remoteOutcomeUnknown: true
      }, { isTechnicalUpdate: true });

      let pushCalled = false;
      providerWithoutGet.pushChange = async () => {
        pushCalled = true;
        return { success: true };
      };

      const res = await syncEngine.processQueue();
      expect(pushCalled).toBe(false); // NUNCA chama pushChange às cegas!
      expect(res.reconcileDeferred).toBe(1);

      const checked = await syncRepository.findById(item.id);
      expect(checked.status).toBe('PENDING');
      expect(checked.remoteOutcomeUnknown).toBe(true);
      expect(checked.nextReconcileAt).not.toBeNull();
    });

    it('2.7 Teste Integrado Obrigatório: despacho iniciado + resposta perdida -> leitura falha bloqueia pushChange -> leitura autorizada com ausência confirmada autoriza escrita única', async () => {
      const db = testEnv.authenticatedContext('u_admin_a', { tenantId: TENANT_A, appRole: 'admin' }).database();
      const realProvider = new FirebaseRealtimeProvider();
      realProvider.db = db;
      realProvider.getTenantId = () => TENANT_A;
      realProvider.isConfigured = () => true;

      let pushCalls = 0;
      let shouldReadFail = false;

      const testProvider = {
        getProviderName: () => 'TestRealtimeProvider',
        isConfigured: () => true,
        get: async (entityType, entityId) => {
          if (shouldReadFail) {
            throw new Error('Connection reset by peer (transitória de transporte)');
          }
          return await realProvider.get(entityType, entityId);
        },
        pushChange: async (changeItem) => {
          pushCalls++;
          return await realProvider.pushChange(changeItem);
        }
      };

      const engine = new SyncEngine(testProvider, authService);
      const entityId = 'mov_full_recovery_' + Date.now();

      // 1. Operação de estoque criada
      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId,
        action: 'CREATE',
        payload: {
          id: entityId,
          productId: 'prod_rec',
          type: 'IN',
          quantity: 8,
          delta: 8,
          reason: 'CYCLE_TEST',
          date: new Date().toISOString()
        },
        tenantId: TENANT_A
      });

      // 2. Simula perda de confirmação do resultado após início de despacho
      await syncRepository.update({
        ...item,
        dispatchStarted: true,
        remoteOutcomeUnknown: true,
        inFlight: true,
        claimedBy: 'crashed_worker',
        claimAttemptId: 'att_crashed'
      }, { isTechnicalUpdate: true });

      // 3. Item é recuperado após interrupção
      const rec = await engine.recoverInterruptedInFlight({ force: true });
      expect(rec.awaitingReconciliation).toBe(1);

      // 4. A reconciliação remota falha por erro transitório de transporte
      shouldReadFail = true;

      // 5. Ciclo seguinte de sincronização é executado
      const cycle1 = await engine.processQueue();

      // 6. Comprova que a nova execução NÃO chama pushChange() enquanto o resultado for desconhecido
      expect(pushCalls).toBe(0);
      expect(cycle1.reconcileDeferred).toBe(1);

      const afterCycle1 = await syncRepository.findById(item.id);
      expect(afterCycle1.status).toBe('PENDING');
      expect(afterCycle1.remoteOutcomeUnknown).toBe(true);

      // 7. Repete o cenário com leitura autorizada que confirma a ausência real do registro
      shouldReadFail = false;
      // Zera o nextReconcileAt para permitir nova tentativa de leitura imediata
      await syncRepository.update({
        ...afterCycle1,
        nextReconcileAt: null
      }, { isTechnicalUpdate: true });

      const cycle2 = await engine.processQueue();

      // Agora a ausência foi comprovada, autorizando exatamente UMA escrita legítima
      expect(pushCalls).toBe(1);
      expect(cycle2.success).toBe(1);

      const completed = await syncRepository.findById(item.id);
      expect(completed.status).toBe('SYNCED');
      expect(completed.remoteAckReceived).toBe(true);

      // Confirma que o registro existe no RTDB e tem o delta esperado
      const remoteRecord = await realProvider.get('inventory', entityId);
      expect(remoteRecord).not.toBeNull();
      expect(remoteRecord.delta).toBe(8);
    });
  });

  // =========================================================================
  // SEÇÃO 3: VERIFICAÇÃO C — IDs estáveis e concorrência no ledger
  // =========================================================================
  describe('3. Verificação C — IDs Estáveis e Concorrência no Ledger Append-Only', () => {
    it('3.1 Duas instâncias não despacham simultaneamente a mesma operação sob leases válidos', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId: 'mov_lease_test',
        action: 'CREATE',
        payload: { id: 'mov_lease_test', tenantId: TENANT_A, delta: 10 }
      });

      // Instância A obtém lease de 30s
      const claimA = await syncRepository.claimForDispatch(item.id, 'instance_alpha', { leaseDurationMs: 30000 });
      expect(claimA).not.toBeNull();
      expect(claimA.claimedBy).toBe('instance_alpha');
      expect(claimA.claimAttemptId).toBeDefined();

      // Instância B tenta obter o lease enquanto A está ativo -> DEVE retornar null
      const claimB = await syncRepository.claimForDispatch(item.id, 'instance_beta', { leaseDurationMs: 30000 });
      expect(claimB).toBeNull();
    });

    it('3.2 Tentativa antiga não altera o resultado da tentativa atual (ACK tardio superseded)', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId: 'mov_ack_superseded',
        action: 'CREATE',
        payload: { id: 'mov_ack_superseded', tenantId: TENANT_A, delta: 20 }
      });

      // Tentativa 1 obtém lease
      const claim1 = await syncRepository.claimForDispatch(item.id, 'worker_1', { leaseDurationMs: 100 });
      const attempt1Id = claim1.claimAttemptId;
      await syncRepository.recordDispatchStarted(item.id, attempt1Id);

      // Simula expiração do lease e assunção pela Tentativa 2
      await new Promise(r => setTimeout(r, 150));
      const claim2 = await syncRepository.claimForDispatch(item.id, 'worker_2', { leaseDurationMs: 30000, isRecovery: true });
      const attempt2Id = claim2.claimAttemptId;
      expect(attempt2Id).not.toBe(attempt1Id);

      // ACK da tentativa 1 chega tardiamente
      const staleAckRes = await syncRepository.recordRemoteAck(item.id, attempt1Id, { success: true });
      expect(staleAckRes.superseded).toBe(true);

      // O item continua sob a custódia da tentativa 2 sem ser marcado como SYNCED prematuramente
      const current = await syncRepository.findById(item.id);
      expect(current.status).toBe('SYNCING');
      expect(current.claimedBy).toBe('worker_2');
      expect(current.claimAttemptId).toBe(attempt2Id);
      expect(current.staleAttemptAcks).toBeDefined();
      expect(current.staleAttemptAcks.length).toBe(1);
    });

    it('3.3 Regras append-only do RTDB Emulator impedem sobrescrita e remoção no caminho /inventory', async () => {
      const adminCtx = testEnv.authenticatedContext('u_admin_a', { tenantId: TENANT_A, appRole: 'admin' });
      const db = adminCtx.database();
      const movementId = 'mov_rtdb_contract_' + Date.now();
      const nodeRef = ref(db, `tenants/${TENANT_A}/inventory/${movementId}`);

      const originalData = {
        id: movementId,
        productId: 'prod_immutable',
        type: 'IN',
        quantity: 25,
        delta: 25,
        unitCostCents: 1500,
        date: new Date().toISOString()
      };

      // 1. Escrita inicial (CREATE) deve suceder
      await assertSucceeds(set(nodeRef, originalData));

      // 2. Tentativa de sobrescrever o mesmo movimento deve falhar pelas regras .write: "!data.exists()"
      const alteredData = { ...originalData, delta: 999 };
      await assertFails(set(nodeRef, alteredData));

      // 3. Tentativa de deletar (set null) deve falhar
      await assertFails(set(nodeRef, null));

      // 4. O registro original deve permanecer inalterado com delta: 25
      const snap = await get(nodeRef);
      expect(snap.exists()).toBe(true);
      expect(snap.val().delta).toBe(25);
    });
  });

  // =========================================================================
  // SEÇÃO 4: VERIFICAÇÃO D — Integridade dos dados legados
  // =========================================================================
  describe('4. Verificação D — Integridade dos Dados Legados da Outbox', () => {
    it('4.1 Registros legados sem canonicalPayloadHash ou tenantId são tratados com segurança fail-closed', async () => {
      const db = await getDB();
      const legacyId = 'legacy_no_tenant_' + Date.now();

      // Grava item legado diretamente no IndexedDB simulando versão antiga
      const legacyRawItem = {
        id: legacyId,
        entityType: 'products',
        entityId: 'prod_leg_1',
        action: 'CREATE',
        payload: { name: 'Produto Sem Tenant' },
        status: 'PENDING',
        inFlight: false,
        createdAt: new Date().toISOString()
      };
      await db.put('syncQueue', legacyRawItem);

      // 1. getPending() sob sessão de tenant isola fail-closed e NUNCA retorna o item sem tenant
      const pending = await syncRepository.getPending();
      expect(pending.some(i => i.id === legacyId)).toBe(false);

      // 2. Rotina de segurança de legados identifica o item e marca como FAILED com requiresResolution
      const migrationRes = await legacyDataMigrationService.secureLegacyOutbox();
      expect(migrationRes.securedCount).toBeGreaterThanOrEqual(1);

      const checked = await syncRepository.findById(legacyId, { allowCrossTenant: true });
      expect(checked.status).toBe('FAILED');
      expect(checked.requiresResolution).toBe(true);
      expect(checked.lastError).toMatch(/tenantId comprovado/i);
    });

    it('4.2 Item legado com dispatchStarted ausente assume false e não presume envio realizado', async () => {
      const db = await getDB();
      const legacyId = 'legacy_no_dispatch_' + Date.now();

      const legacyItem = {
        id: legacyId,
        entityType: 'inventory',
        entityId: 'mov_leg_01',
        action: 'CREATE',
        payload: { id: 'mov_leg_01', tenantId: TENANT_A, delta: 5 },
        tenantId: TENANT_A,
        status: 'PENDING',
        inFlight: false,
        createdAt: new Date().toISOString()
      };
      await db.put('syncQueue', legacyItem);

      const claimed = await syncRepository.claimForDispatch(legacyId, 'worker_leg', { preserveDispatchStarted: true });
      expect(claimed.dispatchStarted).toBe(false);
    });

    it('4.3 Registros já SYNCED ignoram ACKs tardios sem reabrir nem alterar dados', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_synced_ack',
        action: 'CREATE',
        payload: { id: 'prod_synced_ack', tenantId: TENANT_A, name: 'Item Concluído' }
      });

      await syncRepository.markSynced(item.id, { remoteVersion: 'v1' });

      // ACK tardio recebido após o item já estar sincronizado
      const ackRes = await syncRepository.recordRemoteAck(item.id, 'old_attempt', { success: true });
      expect(ackRes.alreadySynced).toBe(true);

      const after = await syncRepository.findById(item.id);
      expect(after.status).toBe('SYNCED');
    });
  });

  // =========================================================================
  // SEÇÃO 5: VERIFICAÇÃO E — Claims canônicas e autorização
  // =========================================================================
  describe('5. Verificação E — Claims Canônicas e Isolamento Multi-Tenant', () => {
    it('5.1 tenantId e appRole são canônicos; tenant_id e role técnico não são promovidos', () => {
      // 1. tenant_id snake_case não é promovido a tenantId
      const role1 = resolveBusinessRole({ tenant_id: 'tenant_legacy', role: 'admin' });
      expect(role1).toBe('viewer'); // Sem appRole nem role válido de negócio, vira viewer

      // 2. role: 'authenticated' não concede papel empresarial (rebaixa para viewer)
      const role2 = resolveBusinessRole({ tenantId: TENANT_A, role: 'authenticated' });
      expect(role2).toBe('viewer');

      // 3. Claims canônicas legítimas
      const role3 = resolveBusinessRole({ tenantId: TENANT_A, appRole: 'operator', role: 'authenticated' });
      expect(role3).toBe('operator');
    });

    it('5.2 Outbox não atravessa tenants após troca de sessão de usuário', async () => {
      // Cria item no Tenant A
      const itemA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_tenant_a',
        action: 'CREATE',
        payload: { id: 'prod_tenant_a', tenantId: TENANT_A, name: 'Produto Tenant A' }
      });

      expect(itemA.tenantId).toBe(TENANT_A);

      // Troca sessão ativa para Tenant B
      const sessionB = createSession('u_user_b', TENANT_B, 'admin');
      setSession(sessionB);

      // Consulta de itens da Outbox no Tenant B NÃO deve listar itens do Tenant A
      const itemsTenantB = await syncRepository.findAll(true);
      expect(itemsTenantB.some(i => i.id === itemA.id)).toBe(false);

      // findById isola por tenant da sessão ativa
      const accessedFromB = await syncRepository.findById(itemA.id);
      expect(accessedFromB).toBeNull();
    });

    it('5.3 Sessão sem claims obrigatórias não realiza operações privilegiadas', () => {
      const sessionViewer = createSession('u_anon', TENANT_A, 'viewer');
      const permCreate = checkPermission(sessionViewer, 'CREATE', 'products');
      expect(permCreate.authorized).toBe(false);

      const sessionOperator = createSession('u_op', TENANT_A, 'operator');
      const permAdmin = checkPermission(sessionOperator, 'DELETE', 'purchases');
      expect(permAdmin.authorized).toBe(false);
    });

    it('5.4 Regras do RTDB Emulator bloqueiam leitura e escrita cross-tenant', async () => {
      const userA = testEnv.authenticatedContext('u_user_a', { tenantId: TENANT_A, appRole: 'admin' });
      const userB = testEnv.authenticatedContext('u_user_b', { tenantId: TENANT_B, appRole: 'admin' });

      const nodeTenantA = ref(userA.database(), `tenants/${TENANT_A}/products/p_iso_test`);
      await assertSucceeds(set(nodeTenantA, {
        id: 'p_iso_test',
        tenantId: TENANT_A,
        name: 'Produto A',
        salePriceCents: 1000,
        version: 1
      }));

      // Usuário do Tenant B tenta ler nó do Tenant A -> bloqueado
      const nodeCrossRead = ref(userB.database(), `tenants/${TENANT_A}/products/p_iso_test`);
      await assertFails(get(nodeCrossRead));

      // Usuário do Tenant B tenta escrever nó do Tenant A -> bloqueado
      await assertFails(set(nodeCrossRead, { id: 'p_iso_test', tenantId: TENANT_A, name: 'Hacked', salePriceCents: 1000, version: 1 }));
    });
  });
});
