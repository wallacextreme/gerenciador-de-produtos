import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
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
import {
  computeCanonicalPayloadHash,
  arePayloadsEquivalent,
  getDivergentFields,
  classifyRemoteOutcome,
  REMOTE_RECONCILIATION_OUTCOME,
  verifyPayloadIntegrity
} from '../src/js/utils/operationIdentity.js';

/**
 * FASE 14.26 — Auditoria de Integridade do Payload, Serialização RTDB e Reconciliação Round-Trip
 *
 * Valida o ciclo de vida completo de movimentações de estoque (stockMovements/inventory):
 * 1. Payload comercial original
 * 2. Payload consolidado na Outbox
 * 3. Payload canônico e hash criptográfico (SHA-256)
 * 4. Payload serializado e enviado ao Firebase Realtime Database
 * 5. Registro recuperado por FirebaseRealtimeProvider.get()
 * 6. Classificação de reconciliação (RECORD_EQUIVALENT vs RECORD_DIVERGENT vs RECORD_ABSENT)
 * 7. ACK persistido e estado terminal da Outbox
 */

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-payload-roundtrip-14-26';
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

function createTestSession(uid, tenantId, appRole) {
  return {
    authenticated: true,
    uid,
    tenantId,
    role: appRole,
    appRole,
    claims: { tenantId, role: appRole, appRole, canonicalClaims: true },
    canonicalClaims: true,
    requiresMigration: false
  };
}

function createControllableAuth(session) {
  return {
    getCurrentSession: () => session,
    getTenantId: () => session?.tenantId || null,
    isConfigured: () => true,
    isAdmin: () => session?.appRole === 'admin',
    isOperator: () => session?.appRole === 'operator',
    isViewer: () => session?.appRole === 'viewer',
    onAuthStateChanged: (cb) => {
      try { cb(session); } catch (_) {}
      return () => {};
    }
  };
}

let seq = 0;
function newId(prefix = 'mov') {
  seq++;
  return `${prefix}_14_26_${seq}_${Date.now()}`;
}

function validCommercialMovement(id, overrides = {}) {
  return {
    id,
    productId: 'prod_notebook_gamer',
    quantity: 10,
    delta: -10,
    type: 'OUT',
    referenceId: 'sale_ref_999',
    referenceType: 'SALE',
    notes: 'Saída por venda balcão #999',
    unitCostCents: 350000,
    reason: 'Venda de mercadoria',
    date: '2026-10-13T10:00:00.000Z',
    ...overrides
  };
}

describe('FASE 14.26 — Auditoria de Integridade do Payload, Serialização RTDB e Reconciliação Round-Trip', () => {
  let authA;
  let adminCtxA;
  let adminDbA;
  let clock;

  function makeEngine(customAuth = authA, customDb = adminDbA) {
    const provider = new FirebaseRealtimeProvider(null, customAuth);
    provider.db = customDb;
    provider._initialized = true;
    provider._connected = true;

    const spy = { pushCalls: 0, getCalls: 0, getMode: 'real', getError: null };
    const realPush = provider.pushChange.bind(provider);
    const realGet = provider.get.bind(provider);

    provider.pushChange = async (item) => {
      spy.pushCalls++;
      return realPush(item);
    };

    provider.get = async (entityType, entityId) => {
      spy.getCalls++;
      if (spy.getMode === 'throw') throw spy.getError;
      return realGet(entityType, entityId);
    };

    const engine = new SyncEngine(provider, customAuth);
    engine.autoSync = false;
    engine._now = () => clock;
    return { engine, provider, spy };
  }

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
    SyncEngine.destroyAll();
    authService.destroy();
    setTenantResolver(() => authService.getTenantId());
    if (testEnv) await testEnv.cleanup();
    if (spawnedProcess && spawnedProcess.pid) {
      try { process.kill(spawnedProcess.pid); } catch (_) {}
    }
  });

  beforeEach(async () => {
    SyncEngine.destroyAll();
    await testEnv.clearDatabase();
    const db = await getDB();
    for (const store of ['products', 'stockMovements', 'settings', 'syncQueue', 'imageManifest']) {
      try { await db.clear(store); } catch (_) {}
    }

    authA = createControllableAuth(createTestSession('admin_1426_A', TENANT_A, 'admin'));
    adminCtxA = testEnv.authenticatedContext('admin_1426_A', { tenantId: TENANT_A, role: 'admin', appRole: 'admin' });
    adminDbA = adminCtxA.database();
    authService.setProvider(authA);
    setTenantResolver(() => TENANT_A);
    clock = Date.now();
  });

  describe('1. Verificação A e B — Ciclo Completo de Round-Trip e Equivalência das Representações', () => {
    it('1.1 Cenário Principal: criação -> Outbox -> hash canônico -> pushChange sanitizado -> RTDB -> get() -> reconciliação equivalente -> ACK terminal sem 2ª gravação', async () => {
      const movementId = newId('mov_main');
      const commercial = validCommercialMovement(movementId);

      // 1. Enfileiramento na Outbox com payload comercial + tenantId
      const opId = `op_${movementId}`;
      const outboxItem = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A,
        operationId: opId
      });

      // 2. Comprovação da identidade estável e do hash canônico na Outbox
      expect(outboxItem.id).toBeDefined();
      expect(outboxItem.entityId).toBe(movementId);
      expect(outboxItem.operationId).toBe(opId);
      expect(outboxItem.status).toBe('PENDING');
      expect(outboxItem.inFlight).toBe(false);
      expect(outboxItem.dispatchStarted).toBeFalsy();

      const expectedInitialHash = computeCanonicalPayloadHash('stockMovements', outboxItem.payload, { tenantId: TENANT_A });
      expect(outboxItem.canonicalPayloadHash).toBe(expectedInitialHash);
      expect(outboxItem.canonicalPayloadHash.startsWith('can_sha256_')).toBe(true);

      const integrity = verifyPayloadIntegrity('stockMovements', outboxItem.payload, outboxItem.canonicalPayloadHash);
      expect(integrity.valid).toBe(true);

      // 3. Envio pelo método real FirebaseRealtimeProvider.pushChange()
      const { provider, spy } = makeEngine();
      const pushResult = await provider.pushChange(outboxItem);

      expect(pushResult.success).toBe(true);
      expect(pushResult.remoteId).toBe(movementId);
      expect(spy.pushCalls).toBe(1);

      // 4. Verificação direta do nó armazenado no RTDB Emulator
      const rawRemoteSnap = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`));
      expect(rawRemoteSnap.exists()).toBe(true);
      const rawRemoteVal = rawRemoteSnap.val();

      // Comprova que tenantId NÃO foi gravado no corpo JSON do nó remoto (respeitando o schema restrito)
      expect(rawRemoteVal.tenantId).toBeUndefined();
      // Comprova que todos os campos de negócio foram fielmente gravados
      expect(rawRemoteVal.id).toBe(movementId);
      expect(rawRemoteVal.productId).toBe('prod_notebook_gamer');
      expect(rawRemoteVal.quantity).toBe(10);
      expect(rawRemoteVal.delta).toBe(-10);
      expect(rawRemoteVal.type).toBe('OUT');
      expect(rawRemoteVal.referenceId).toBe('sale_ref_999');
      expect(rawRemoteVal.referenceType).toBe('SALE');
      expect(rawRemoteVal.notes).toBe('Saída por venda balcão #999');
      expect(rawRemoteVal.unitCostCents).toBe(350000);
      expect(rawRemoteVal.version).toBe(1);
      expect(rawRemoteVal.sourceDeviceId).toBeDefined();

      // 5. Leitura pelo método real FirebaseRealtimeProvider.get('stockMovements', movementId)
      const retrieved = await provider.get('stockMovements', movementId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(movementId);
      expect(retrieved.delta).toBe(-10);
      expect(retrieved.tenantId).toBeUndefined();

      // 6. Classificação do registro recuperado usando classifyRemoteOutcome()
      const localWithTenant = { ...outboxItem.payload, tenantId: TENANT_A };
      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: localWithTenant,
        remoteRecord: retrieved
      });

      // A ausência de tenantId no corpo do nó remoto NÃO pode produzir divergência falsa
      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(classification.isEquivalent).toBe(true);
      expect(classification.divergentFields).toHaveLength(0);

      // Comprova arePayloadsEquivalent diretamente
      expect(arePayloadsEquivalent('stockMovements', localWithTenant, retrieved)).toBe(true);
      expect(getDivergentFields('stockMovements', localWithTenant, retrieved)).toHaveLength(0);

      // 7. Persistência do ACK na Outbox: conduz ao estado terminal SYNCED sem segunda gravação
      await syncRepository.recordRemoteAck(outboxItem.id, 'attempt_main_01', pushResult);
      await syncRepository.markSynced(outboxItem.id, pushResult);

      const finalItem = await syncRepository.findById(outboxItem.id);
      expect(finalItem.status).toBe('SYNCED');
      expect(finalItem.inFlight).toBe(false);
      expect(finalItem.remoteAckReceived).toBe(true);
      expect(finalItem.operationId).toBe(opId);
      expect(finalItem.canonicalPayloadHash).toBe(expectedInitialHash);
    });

    it('1.2 Reexecução após perda de ACK: escrita aplicada + confirmação perdida é recuperada via leitura sem gerar novo lançamento', async () => {
      const movementId = newId('mov_lost_ack');
      const commercial = validCommercialMovement(movementId, { delta: 15, quantity: 15, type: 'IN' });

      // Enfileira operação na Outbox
      const outboxItem = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A,
        operationId: `op_${movementId}`
      });

      // Simula que a 1ª execução realizou a escrita no RTDB, mas sofreu interrupção antes de registrar o ACK
      const { provider } = makeEngine();
      await provider.pushChange(outboxItem);

      // Confirma que o registro existe no RTDB
      const snapInitial = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`));
      expect(snapInitial.exists()).toBe(true);

      // Atualiza o estado da Outbox simulando queda no crash-window com envio iniciado e sem ACK
      await syncRepository.update({
        ...outboxItem,
        status: 'SYNCING',
        inFlight: true,
        claimedBy: 'worker_crashed',
        claimAttemptId: 'att_crashed',
        dispatchStarted: true,
        remoteAckReceived: false,
        remoteOutcomeUnknown: false
      }, { isTechnicalUpdate: true });

      // 2ª execução: inicializa nova instância do motor
      const { engine: engine2, spy: spy2 } = makeEngine();

      // Executa rotina pós-falha
      const rec = await engine2.recoverInterruptedInFlight({ force: true });
      expect(rec.awaitingReconciliation).toBe(1);

      const midState = await syncRepository.findById(outboxItem.id);
      expect(midState.status).toBe('PENDING');
      expect(midState.remoteOutcomeUnknown).toBe(true);

      // Processa a fila: SyncEngine deve reconciliar por LEITURA e concluir SYNCED SEM chamar pushChange()
      const processRes = await engine2.processQueue();
      expect(processRes.success).toBe(1);
      expect(spy2.getCalls).toBe(1); // Realizou leitura de reconciliação
      expect(spy2.pushCalls).toBe(0); // ZERO chamadas de escrita

      // Confirma que a Outbox transitou para SYNCED
      const doneItem = await syncRepository.findById(outboxItem.id);
      expect(doneItem.status).toBe('SYNCED');
      expect(doneItem.remoteAckReceived).toBe(true);
      expect(doneItem.remoteOutcomeUnknown).toBe(false);

      // Confirma que o RTDB ainda contém EXATAMENTE 1 registro para este ID e nenhum segundo movimento foi criado
      const snapAfter = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`));
      expect(snapAfter.exists()).toBe(true);
      expect(snapAfter.val().delta).toBe(15);

      const allMovementsSnap = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory`));
      const allMovements = Object.keys(allMovementsSnap.val() || {});
      expect(allMovements).toHaveLength(1);
      expect(allMovements[0]).toBe(movementId);
    });
  });

  describe('2. Verificação C — Contrato Estrito de Leitura (FirebaseRealtimeProvider.get) e Ausência Comprovada', () => {
    it('2.1 Caso A — Ausência confirmada: nó inexistente retorna null e classifyRemoteOutcome classifica RECORD_ABSENT', async () => {
      const { provider } = makeEngine();
      const nonExistentId = newId('mov_absent');

      const res = await provider.get('stockMovements', nonExistentId);
      expect(res).toBeNull();

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: nonExistentId,
        action: 'CREATE',
        localPayload: validCommercialMovement(nonExistentId),
        remoteRecord: res
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT);
      expect(classification.isAbsent).toBe(true);
      expect(classification.isEquivalent).toBe(false);
      expect(classification.requiresResolution).toBe(false);
    });

    it('2.2 Caso B — Registro existente e equivalente: retorna dados do nó e classifica RECORD_EQUIVALENT', async () => {
      const movementId = newId('mov_exist_eq');
      const commercial = validCommercialMovement(movementId);
      const { provider } = makeEngine();

      await provider.pushChange({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      const retrieved = await provider.get('stockMovements', movementId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(movementId);

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: commercial,
        remoteRecord: retrieved
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(classification.isEquivalent).toBe(true);
    });

    it('2.3 Caso C — Registro existente e divergente: detecta disparidade comercial e classifica RECORD_DIVERGENT', async () => {
      const movementId = newId('mov_exist_div');
      const commercialLocal = validCommercialMovement(movementId, { type: 'IN', delta: 10, quantity: 10 });
      const { provider } = makeEngine();

      // Grava no RTDB com quantidade e delta diferentes (válido pelo schema para type: 'IN')
      await provider.pushChange({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercialLocal, delta: 99, quantity: 99, tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      const retrieved = await provider.get('stockMovements', movementId);
      expect(retrieved.delta).toBe(99);

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: commercialLocal,
        remoteRecord: retrieved
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(classification.isEquivalent).toBe(false);
      expect(classification.requiresResolution).toBe(true);
      expect(classification.divergentFields.map(d => d.field)).toContain('delta');
      expect(classification.divergentFields.map(d => d.field)).toContain('quantity');
    });

    it('2.4 Caso D — Permissão negada: propaga erro de segurança, nunca converte em null e classifica PERMISSION_DENIED', async () => {
      const movementId = newId('mov_perm_denied');
      const { provider } = makeEngine();

      // Simula erro de segurança no método get
      const secError = new Error('Permission denied at /tenants/tenantA/inventory');
      secError.code = 'permission_denied';

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: validCommercialMovement(movementId),
        remoteRecord: null,
        readError: secError
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED);
      expect(classification.requiresResolution).toBe(true);
      expect(classification.isAbsent).toBe(false);
      expect(classification.isEquivalent).toBe(false);
    });

    it('2.5 Caso E — Falha transitória de transporte / Timeout: classifica INACCESSIBLE e não autoriza escrita', async () => {
      const movementId = newId('mov_transient');
      const netError = new Error('ETIMEDOUT: Connection timed out to remote database');

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: validCommercialMovement(movementId),
        remoteRecord: null,
        readError: netError
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE);
      expect(classification.isAbsent).toBe(false);
      expect(classification.isEquivalent).toBe(false);
      expect(classification.requiresResolution).toBe(true);
    });

    it('2.6 Caso F — Provedor sem capacidade de leitura: SyncEngine adia com backoff e nunca despacha ledger às cegas', async () => {
      const movementId = newId('mov_no_get');
      const outboxItem = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Marca item com desfecho desconhecido
      await syncRepository.update({
        ...outboxItem,
        dispatchStarted: true,
        remoteOutcomeUnknown: true,
        remoteAckReceived: false
      }, { isTechnicalUpdate: true });

      // Provedor que não tem get() implementado
      const blindProvider = {
        getProviderName: () => 'BlindProvider',
        getTenantId: () => TENANT_A,
        isConfigured: () => true,
        pushChange: async () => { throw new Error('PUSH_NUNCA_DEVE_SER_CHAMADO'); }
      };

      const engine = new SyncEngine(blindProvider, authA);
      engine.autoSync = false;
      engine._now = () => clock;

      const res = await engine.processQueue();
      expect(res.success).toBe(0);

      const after = await syncRepository.findById(outboxItem.id);
      expect(after.status).toBe('PENDING');
      expect(after.remoteOutcomeUnknown).toBe(true);
      expect(after.reconcileAttempts).toBe(1);
      expect(after.nextReconcileAt).toBeDefined();
    });
  });

  describe('3. Repetição, Concorrência e Regras Append-Only', () => {
    it('3.1 Duas chamadas sequenciais de pushChange com o mesmo payload retornam alreadyApplied: true na 2ª sem duplicar', async () => {
      const movementId = newId('mov_idemp');
      const { provider, spy } = makeEngine();
      const changeItem = {
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_A },
        tenantId: TENANT_A
      };

      // 1ª chamada
      const res1 = await provider.pushChange(changeItem);
      expect(res1.success).toBe(true);
      expect(res1.alreadyApplied).toBeFalsy();

      // 2ª chamada da MESMA operação com o mesmo payload
      const res2 = await provider.pushChange(changeItem);
      expect(res2.success).toBe(true);
      expect(res2.alreadyApplied).toBe(true); // Reconhecido como já aplicado!
      expect(res2.remoteId).toBe(movementId);

      // Comprova que há apenas 1 registro no caminho remoto
      const snap = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`));
      expect(snap.exists()).toBe(true);
    });

    it('3.2 Duas instâncias disputando a mesma operação: leases atômicos impedem despacho simultâneo', async () => {
      const movementId = newId('mov_lease_race');
      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Instância A reserva o item com lease válido por 30s
      const claimedA = await syncRepository.claimForDispatch(item.id, 'worker_A', {
        leaseDurationMs: 30000
      });
      expect(claimedA).not.toBeNull();
      expect(claimedA.claimedBy).toBe('worker_A');
      expect(claimedA.inFlight).toBe(true);

      // Instância B tenta reservar o mesmo item enquanto o lease de A estiver ativo
      const claimedB = await syncRepository.claimForDispatch(item.id, 'worker_B', {
        leaseDurationMs: 30000
      });
      expect(claimedB).toBeNull(); // Nenhuma concessão para B!
    });

    it('3.3 ACK atrasado de tentativa anterior (superseded) não altera nem reverte a nova tentativa ativa', async () => {
      const movementId = newId('mov_stale_ack');
      const outboxItem = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Tentativa 1 (Instância A) com lease curto de 100ms
      const claimedA = await syncRepository.claimForDispatch(outboxItem.id, 'worker_A', {
        leaseDurationMs: 100
      });
      expect(claimedA).not.toBeNull();
      const attemptAId = claimedA.claimAttemptId;

      // Espera expirar o lease curto
      await new Promise(r => setTimeout(r, 150));

      // Tentativa 2 (Instância B assume após expiração do lease de A)
      const claimedB = await syncRepository.claimForDispatch(outboxItem.id, 'worker_B', {
        leaseDurationMs: 30000
      });
      expect(claimedB).not.toBeNull();
      const attemptBId = claimedB.claimAttemptId;
      expect(attemptBId).not.toBe(attemptAId);
      expect(claimedB.claimedBy).toBe('worker_B');

      // Agora chega o ACK tardio da tentativa 1 (Instância A)
      const ackResA = await syncRepository.recordRemoteAck(outboxItem.id, attemptAId, {
        success: true,
        remoteVersion: 'rev_stale_A'
      });

      expect(ackResA.superseded).toBe(true); // Reconhecido como suplantado!
      expect(ackResA.recorded).toBe(true);

      // O item na Outbox permanece de propriedade da Instância B e NÃO foi finalizado para SYNCED prematuramente
      const currentItem = await syncRepository.findById(outboxItem.id);
      expect(currentItem.claimedBy).toBe('worker_B');
      expect(currentItem.claimAttemptId).toBe(attemptBId);
      expect(currentItem.status).toBe('SYNCING');
      expect(currentItem.staleAttemptAcks).toHaveLength(1);
      expect(currentItem.staleAttemptAcks[0].attemptId).toBe(attemptAId);
    });

    it('3.4 Regras append-only do RTDB Emulator: sobrescrita e remoção direta são categoricamente rejeitadas pelo servidor', async () => {
      const movementId = newId('mov_rtdb_append');
      const commercial = validCommercialMovement(movementId);
      const { provider } = makeEngine();

      // Gravação inicial bem-sucedida
      await provider.pushChange({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Tentativa de sobrescrever diretamente o nó via set() com dados alterados
      const directOverwriteAttempt = set(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`), {
        ...commercial,
        delta: 9999
      });
      await assertFails(directOverwriteAttempt);

      // Tentativa de remover o nó via set(null)
      const directDeleteAttempt = set(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`), null);
      await assertFails(directDeleteAttempt);

      // Comprova que o registro permanece inalterado com seu valor original
      const snap = await get(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`));
      expect(snap.val().delta).toBe(-10);
    });
  });

  describe('4. Verificação D — Tenant e Caminho Remoto', () => {
    it('4.1 pushChange recusa despachar item de outro tenant sob sessão ativa', async () => {
      const movementId = newId('mov_cross_push');
      const { provider } = makeEngine(); // Sessão pertence a TENANT_A

      const crossTenantItem = {
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_B },
        tenantId: TENANT_B // Pertence a TENANT_B!
      };

      await expect(provider.pushChange(crossTenantItem)).rejects.toThrow(/Violação de isolamento multi-tenant/i);
    });

    it('4.2 Leitura cross-tenant no RTDB Emulator é estritamente bloqueada por regras de segurança', async () => {
      const movementId = newId('mov_tenant_iso');
      const { provider } = makeEngine();

      // Grava no Tenant A
      await provider.pushChange({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...validCommercialMovement(movementId), tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Cria contexto para Tenant B
      const userCtxB = testEnv.authenticatedContext('user_B', { tenantId: TENANT_B, role: 'admin', appRole: 'admin' });
      const userDbB = userCtxB.database();

      // Tentativa de ler o caminho de Tenant A usando a sessão de Tenant B deve falhar com assertFails
      const crossReadAttempt = get(ref(userDbB, `tenants/${TENANT_A}/inventory/${movementId}`));
      await assertFails(crossReadAttempt);

      // Leitura dentro do próprio Tenant B retorna nulo (ausente em B)
      const readInB = await get(ref(userDbB, `tenants/${TENANT_B}/inventory/${movementId}`));
      expect(readInB.exists()).toBe(false);
    });

    it('4.3 Schema estrito: tentativa de gravar propriedades não previstas ($other: false) é rejeitada pelo RTDB', async () => {
      const movementId = newId('mov_schema_hack');
      const invalidDataWithExtraProp = {
        ...validCommercialMovement(movementId),
        unauthorizedExtraField: 'HACKED_DATA'
      };

      // Escrita direta com campo proibido deve falhar pelas regras do banco
      const writeAttempt = set(ref(adminDbA, `tenants/${TENANT_A}/inventory/${movementId}`), invalidDataWithExtraProp);
      await assertFails(writeAttempt);
    });
  });

  describe('5. Verificação E — Versionamento e Compatibilidade de Registros Legados', () => {
    it('5.1 Registro legado sem campo version é comparado com segurança e reconhecido como equivalente nos campos de negócio', () => {
      const movementId = newId('mov_leg_ver');
      const commercial = validCommercialMovement(movementId);

      // Simula registro legado recuperado do RTDB que não continha version ou sourceDeviceId
      const legacyRemoteRecord = {
        id: movementId,
        productId: commercial.productId,
        quantity: commercial.quantity,
        delta: commercial.delta,
        type: commercial.type,
        referenceId: commercial.referenceId,
        referenceType: commercial.referenceType,
        notes: commercial.notes,
        unitCostCents: commercial.unitCostCents,
        reason: commercial.reason,
        date: commercial.date
      };

      const isEq = arePayloadsEquivalent('stockMovements', commercial, legacyRemoteRecord);
      expect(isEq).toBe(true);

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: commercial,
        remoteRecord: legacyRemoteRecord
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(classification.isEquivalent).toBe(true);
    });

    it('5.2 Disparidade em campos comerciais de registro legado gera RECORD_DIVERGENT e exige resolução', () => {
      const movementId = newId('mov_leg_diff');
      const commercial = validCommercialMovement(movementId, { delta: -5 });

      const legacyRemoteDivergent = {
        id: movementId,
        productId: commercial.productId,
        quantity: 50, // divergente
        delta: -50,   // divergente
        type: commercial.type
      };

      const isEq = arePayloadsEquivalent('stockMovements', commercial, legacyRemoteDivergent);
      expect(isEq).toBe(false);

      const classification = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        localPayload: commercial,
        remoteRecord: legacyRemoteDivergent
      });

      expect(classification.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(classification.requiresResolution).toBe(true);
    });
  });

  describe('6. Verificação F — Integridade dos Marcadores da Outbox Pós-Reconciliação', () => {
    it('6.1 Marcadores da Outbox permanecem íntegros e consistentes após ciclo de reconciliação', async () => {
      const movementId = newId('mov_markers');
      const commercial = validCommercialMovement(movementId);

      const opId = `op_markers_${movementId}`;
      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A,
        operationId: opId
      });

      // Realiza escrita e simula perda de ACK
      const { provider } = makeEngine();
      await provider.pushChange(item);

      // Marca como em voo com despacho iniciado
      await syncRepository.update({
        ...item,
        status: 'SYNCING',
        inFlight: true,
        dispatchStarted: true,
        remoteAckReceived: false,
        remoteOutcomeUnknown: true
      }, { isTechnicalUpdate: true });

      // Executa motor
      const { engine } = makeEngine();
      await engine.processQueue();

      // Inspeciona item pós-reconciliação
      const after = await syncRepository.findById(item.id);
      expect(after.status).toBe('SYNCED');
      expect(after.inFlight).toBe(false);
      expect(after.remoteAckReceived).toBe(true);
      expect(after.remoteOutcomeUnknown).toBe(false);
      expect(after.requiresResolution).toBe(false);
      expect(after.operationId).toBe(opId);
      expect(after.canonicalPayloadHash).toBeDefined();

      // Confirma que a integridade criptográfica é preservada
      const integrityCheck = verifyPayloadIntegrity('stockMovements', after.payload, after.canonicalPayloadHash);
      expect(integrityCheck.valid).toBe(true);
    });

    it('6.2 Registro SYNCED ignora ACKs posteriores tardios sem reabrir nem alterar dados', async () => {
      const movementId = newId('mov_synced_closed');
      const commercial = validCommercialMovement(movementId);

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { ...commercial, tenantId: TENANT_A },
        tenantId: TENANT_A
      });

      // Conclui como SYNCED
      await syncRepository.markSynced(item.id, { remoteVersion: 'v_done' });

      // Tentativa de registrar ACK tardio posterior
      const ackLate = await syncRepository.recordRemoteAck(item.id, 'attempt_late', {
        success: true,
        remoteVersion: 'v_late'
      });
      expect(ackLate.recorded).toBe(false);

      const check = await syncRepository.findById(item.id);
      expect(check.status).toBe('SYNCED');
      expect(check.remoteVersion).toBe('v_done');
    });
  });
});
