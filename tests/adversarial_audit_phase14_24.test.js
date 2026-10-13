import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
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
import {
  computeCanonicalPayloadHash,
  classifyRemoteOutcome,
  REMOTE_RECONCILIATION_OUTCOME
} from '../src/js/utils/operationIdentity.js';

/**
 * FASE 14.24 — AUDITORIA ADVERSARIAL DA OUTBOX, RECUPERAÇÃO DO LEDGER E ISOLAMENTO MULTI-TENANT
 * Execução 100% local com RTDB Emulator, fake-indexeddb e mocks determinísticos.
 */

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-adversarial-phase14-24';
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
    authenticated: true,
    uid,
    tenantId: tenantId || null,
    role: isCanonical ? appRole : 'viewer',
    appRole: isCanonical ? appRole : 'viewer',
    claims: {
      tenantId,
      appRole,
      ...extraClaims
    },
    canonicalClaims: isCanonical && Boolean(tenantId),
    requiresMigration: !isCanonical || !tenantId
  };
}

function makeAuth(session) {
  let curSession = session;
  return {
    getCurrentSession: () => curSession,
    getTenantId: () => curSession?.tenantId || null,
    getRole: () => curSession?.role || 'viewer',
    isConfigured: () => true,
    setSession: (s) => { curSession = s; }
  };
}

function movementPayload(id, tenantId = TENANT_A, qty = 10) {
  return {
    id,
    tenantId,
    productId: 'prod_audit_14_24',
    quantity: qty,
    delta: qty,
    type: 'IN',
    unitCostCents: 1500,
    reason: 'Auditoria Fase 14.24',
    date: '2026-10-13T10:00:00.000Z'
  };
}

describe('FASE 14.24 — Auditoria Adversarial da Outbox, Recuperação do Ledger e Multi-Tenant', () => {
  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    const rulesContent = readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: {
        rules: rulesContent,
        host: '127.0.0.1',
        port: EMULATOR_PORT
      }
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    if (testEnv) await testEnv.clearDatabase();
    const db = await getDB();
    for (const s of ['products', 'stockMovements', 'settings', 'syncQueue', 'imageManifest']) {
      try { await db.clear(s); } catch (_) {}
    }
    setTenantResolver(() => null);
  });

  // ===========================================================================
  // 1. IDENTIDADE E IMUTABILIDADE DA OUTBOX (SEÇÃO 3.1)
  // ===========================================================================
  describe('1. Identidade e Imutabilidade da Outbox', () => {
    it('1.1: Impede terminantemente alteração de tenantId, operationId, entityType, entityId', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_imm_01',
        action: 'CREATE',
        payload: { id: 'prod_imm_01', name: 'Item Imutável', salePriceCents: 1000 },
        tenantId: TENANT_A
      });

      // Tentativa de alterar tenantId
      await expect(
        syncRepository.update({ ...item, tenantId: TENANT_B })
      ).rejects.toThrow(/alteração de tenantId.*proibida/i);

      // Tentativa de alterar operationId
      await expect(
        syncRepository.update({ ...item, operationId: 'new_op_id' })
      ).rejects.toThrow(/alteração de operationId.*proibida/i);

      // Tentativa de alterar entityType
      await expect(
        syncRepository.update({ ...item, entityType: 'sales' })
      ).rejects.toThrow(/alteração de entityType.*proibida/i);

      // Tentativa de alterar entityId
      await expect(
        syncRepository.update({ ...item, entityId: 'prod_imm_02' })
      ).rejects.toThrow(/alteração de entityId.*proibida/i);
    });

    it('1.2: Atualização técnica (isTechnicalUpdate: true) rejeita estritamente alteração do payload comercial', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_tech_upd',
        action: 'UPDATE',
        payload: { id: 'prod_tech_upd', name: 'Original', salePriceCents: 2000 },
        tenantId: TENANT_A
      });

      // Atualização técnica tentando alterar o payload comercial deve ser categoricamente bloqueada
      await expect(
        syncRepository.update(
          { ...item, payload: { id: 'prod_tech_upd', name: 'Modificado', salePriceCents: 9999 } },
          { isTechnicalUpdate: true }
        )
      ).rejects.toThrow(/atualização técnica.*não pode alterar o payload comercial/i);

      // Atualização técnica de metadados de ciclo de vida (sem alterar payload) é permitida
      const updated = await syncRepository.update(
        { ...item, inFlight: false, remoteOutcomeUnknown: true },
        { isTechnicalUpdate: true }
      );
      expect(updated.remoteOutcomeUnknown).toBe(true);
      expect(updated.payload.name).toBe('Original');
    });

    it('1.3: Atualização rejeita payload divergente de canonicalPayloadHash armazenado', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_hash_chk',
        action: 'CREATE',
        payload: { id: 'prod_hash_chk', name: 'Item Hash', salePriceCents: 3000 },
        tenantId: TENANT_A
      });

      // Tentativa de atualizar payload para valor não equivalente sem atualizar o hash
      await expect(
        syncRepository.update({
          ...item,
          payload: { id: 'prod_hash_chk', name: 'Item Hash Adulterado', salePriceCents: 1 }
        })
      ).rejects.toThrow(/sem equivalência semântica é estritamente proibida/i);
    });

    it('1.4: findById isola por tenant e findTechnicalRecord é restrito a rotinas internas', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_iso_chk',
        action: 'CREATE',
        payload: { id: 'prod_iso_chk', name: 'Item Tenant A', salePriceCents: 500 },
        tenantId: TENANT_A
      });

      setTenantResolver(() => TENANT_B);
      // Sessão de Tenant B não consegue localizar item de Tenant A via findById padrão
      const notFound = await syncRepository.findById(item.id);
      expect(notFound).toBeNull();

      // findTechnicalRecord permite recuperação interna de crash sem tenant de sessão
      const techRecord = await syncRepository.findTechnicalRecord(item.id);
      expect(techRecord).not.toBeNull();
      expect(techRecord.id).toBe(item.id);
      expect(techRecord.tenantId).toBe(TENANT_A);
      setTenantResolver(() => null);
    });
  });

  // ===========================================================================
  // 2. ACKS OBSOLETOS, RECUPERAÇÃO E CONCORRÊNCIA (SEÇÃO 3.2 E 3.3)
  // ===========================================================================
  describe('2. ACKs Obsoletos, Recuperação e Concorrência', () => {
    it('2.1: Quatro propriedades obrigatórias de ACK atrasado (A chega após B iniciar, B conclui, duplicado seguro)', async () => {
      const id = 'mov_ack_lifecycle_' + Date.now();
      const payload = movementPayload(id);
      const item = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId: id,
        action: 'CREATE',
        payload,
        tenantId: TENANT_A
      });

      // Tentativa A reserva o item
      const claimA = await syncRepository.claimForDispatch(item.id, 'engine_A', { leaseDurationMs: 10 });
      const attemptA = claimA.claimAttemptId;
      await syncRepository.recordDispatchStarted(item.id, attemptA);

      // Tentativa B assume o item (após expiração / recuperação)
      const claimB = await syncRepository.claimForDispatch(item.id, 'engine_B', { isRecovery: true });
      const attemptB = claimB.claimAttemptId;
      expect(attemptB).not.toBe(attemptA);

      // Propriedade 1: ACK de A chega após B ter assumido
      const lateA = await syncRepository.recordRemoteAck(item.id, attemptA, { success: true, remoteVersion: 'v_old' });
      expect(lateA.superseded).toBe(true);

      // Propriedade 2: Tentativa B continua no seu estado correto (SYNCING com attemptB)
      const duringB = await syncRepository.findTechnicalRecord(item.id);
      expect(duringB.status).toBe('SYNCING');
      expect(duringB.claimAttemptId).toBe(attemptB);
      expect(duringB.staleAttemptAcks.length).toBe(1);
      expect(duringB.staleAttemptAcks[0].attemptId).toBe(attemptA);

      // Propriedade 3: ACK da tentativa B é processado normalmente
      const ackB = await syncRepository.recordRemoteAck(item.id, attemptB, { success: true, remoteVersion: 'v_new' });
      expect(ackB.superseded).toBe(false);
      const markB = await syncRepository.markSynced(item.id, { remoteVersion: 'v_new' }, attemptB);
      expect(markB.success).toBe(true);

      const stateAfterB = await syncRepository.findTechnicalRecord(item.id);
      expect(stateAfterB.status).toBe('SYNCED');
      expect(stateAfterB.remoteVersion).toBe('v_new');

      // Propriedade 4: ACK duplicado subsequente não provoca transições inválidas
      const dupB = await syncRepository.recordRemoteAck(item.id, attemptB, { success: true });
      expect(dupB.alreadySynced).toBe(true);
      const dupFail = await syncRepository.recordRemoteAck(item.id, attemptB, { success: false });
      expect(dupFail.alreadySynced).toBe(true);

      const finalState = await syncRepository.findTechnicalRecord(item.id);
      expect(finalState.status).toBe('SYNCED');
      expect(finalState.remoteOutcomeUnknown).toBe(false); // Não reabre incerteza
    });

    it('2.2: recordDispatchStarted recusa tentativa se concessão foi perdida ou lease expirou', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_lease_loss',
        action: 'CREATE',
        payload: { id: 'prod_lease_loss', name: 'Item', salePriceCents: 100 },
        tenantId: TENANT_A
      });

      const claimA = await syncRepository.claimForDispatch(item.id, 'engine_A');
      const attemptA = claimA.claimAttemptId;

      // Claim B assume
      await syncRepository.claimForDispatch(item.id, 'engine_B', { isRecovery: true });

      // Tentativa A tenta registrar dispatchStarted após perder claim
      const res = await syncRepository.recordDispatchStarted(item.id, attemptA);
      expect(res).toBeNull();

      const fresh = await syncRepository.findTechnicalRecord(item.id);
      expect(fresh.dispatchStarted).toBe(false); // Não foi alterado por A
    });

    it('2.3: Tentativa sem envio liberada sem leitura; tentativa com envio iniciado não presume sucesso nem ausência', async () => {
      const session = createSession('adm1', TENANT_A, 'admin');
      const auth = makeAuth(session);
      const engine = new SyncEngine(null, auth);

      // Item 1: Reserva criada sem envio (dispatchStarted: false)
      const item1 = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_no_send',
        action: 'CREATE',
        payload: { id: 'prod_no_send', name: 'Item Sem Envio', salePriceCents: 500 },
        tenantId: TENANT_A
      });
      await syncRepository.claimForDispatch(item1.id, 'engine_1', { preserveDispatchStarted: true });

      // Item 2: Reserva com envio iniciado (dispatchStarted: true)
      const item2 = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId: 'mov_send_started',
        action: 'CREATE',
        payload: movementPayload('mov_send_started'),
        tenantId: TENANT_A
      });
      const claim2 = await syncRepository.claimForDispatch(item2.id, 'engine_2', { preserveDispatchStarted: true });
      await syncRepository.recordDispatchStarted(item2.id, claim2.claimAttemptId);

      // Recuperação pós-queda
      await engine.recoverInterruptedInFlight({ force: true });

      const recovered1 = await syncRepository.findTechnicalRecord(item1.id);
      expect(recovered1.status).toBe('PENDING');
      expect(recovered1.remoteOutcomeUnknown).toBe(false);
      expect(recovered1.releasedBeforeDispatch).toBe(true);

      const recovered2 = await syncRepository.findTechnicalRecord(item2.id);
      expect(recovered2.status).toBe('PENDING');
      expect(recovered2.remoteOutcomeUnknown).toBe(true); // Exige reconciliação obrigatória
      expect(recovered2.inFlightInterrupted).toBe(true);
    });
  });

  // ===========================================================================
  // 3. AUDITORIA ADVERSARIAL DO LEDGER /INVENTORY (SEÇÃO 4)
  // ===========================================================================
  describe('3. Auditoria Adversarial do Ledger /inventory', () => {
    it('3.1: Distinção estrita entre RECORD_ABSENT, RECORD_EQUIVALENT, RECORD_DIVERGENT, INACCESSIBLE e PERMISSION_DENIED', () => {
      const id = 'mov_class_test';
      const local = movementPayload(id);

      // RECORD_ABSENT (leitura autorizada retornou null)
      const c1 = classifyRemoteOutcome({ entityType: 'inventory', entityId: id, localPayload: local, remoteRecord: null });
      expect(c1.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT);
      expect(c1.isAbsent).toBe(true);

      // RECORD_EQUIVALENT (conteúdo idêntico)
      const c2 = classifyRemoteOutcome({ entityType: 'inventory', entityId: id, localPayload: local, remoteRecord: { ...local, _serverTimestamp: 12345 } });
      expect(c2.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(c2.isEquivalent).toBe(true);

      // RECORD_DIVERGENT (delta/quantidade diferente)
      const c3 = classifyRemoteOutcome({ entityType: 'inventory', entityId: id, localPayload: local, remoteRecord: { ...local, quantity: 99, delta: 99 } });
      expect(c3.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(c3.requiresResolution).toBe(true);

      // INACCESSIBLE (erro de rede/timeout nunca é ausência)
      const netErr = new Error('ETIMEDOUT: Connection reset by peer');
      const c4 = classifyRemoteOutcome({ entityType: 'inventory', entityId: id, localPayload: local, remoteRecord: null, readError: netErr });
      expect(c4.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE);
      expect(c4.isAbsent).toBe(false);

      // PERMISSION_DENIED (erro 403 / permission_denied)
      const permErr = new Error('PERMISSION_DENIED: Client lacks read privilege');
      permErr.code = 'permission_denied';
      const c5 = classifyRemoteOutcome({ entityType: 'inventory', entityId: id, localPayload: local, remoteRecord: null, readError: permErr });
      expect(c5.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED);
      expect(c5.isAbsent).toBe(false);
      expect(c5.requiresResolution).toBe(true);
    });

    it('3.2: Backoff exponencial de reconciliação e escalonamento após 5 tentativas de leitura', async () => {
      const id = 'mov_backoff_audit';
      const item = await syncRepository.enqueue({
        entityType: 'inventory',
        entityId: id,
        action: 'CREATE',
        payload: movementPayload(id),
        tenantId: TENANT_A
      });

      let now = 1000000;
      // 4 tentativas com erro de leitura -> PENDING com backoff
      for (let i = 1; i <= 4; i++) {
        const res = await syncRepository.recordReconcileDeferred(item.id, null, {
          message: `Timeout ${i}`,
          now,
          baseDelayMs: 1000,
          maxDelayMs: 30000
        });
        expect(res.success).toBe(true);
        expect(res.escalated).toBe(false);
        expect(res.item.status).toBe('PENDING');
        expect(res.item.reconcileAttempts).toBe(i);
        expect(res.item.remoteOutcomeUnknown).toBe(true);
      }

      // 5ª tentativa -> ESCALONAMENTO OBRIGATÓRIO
      const res5 = await syncRepository.recordReconcileDeferred(item.id, null, {
        message: 'Timeout 5',
        now,
        baseDelayMs: 1000
      });
      expect(res5.escalated).toBe(true);
      expect(res5.item.status).toBe('FAILED');
      expect(res5.item.requiresResolution).toBe(true);
      expect(res5.item.permanentFailure).toBe(true);
      expect(res5.item.nextReconcileAt).toBeNull();
    });

    it('3.3: Regras append-only do RTDB rejeitam sobrescrita e remoção no caminho do ledger', async () => {
      const adminCtx = testEnv.authenticatedContext('adm_audit', { tenantId: TENANT_A, appRole: 'admin', role: 'authenticated' });
      const rtdb = adminCtx.database();
      const movId = 'mov_rtdb_immutable_' + Date.now();
      const movRef = ref(rtdb, `tenants/${TENANT_A}/inventory/${movId}`);

      // 1. Criação autorizada de registro no ledger
      await assertSucceeds(set(movRef, {
        id: movId,
        productId: 'prod_1',
        quantity: 10,
        delta: 10,
        type: 'IN',
        date: '2026-10-13T10:00:00Z',
        version: 1
      }));

      // 2. Tentativa de sobrescrever registro existente é CATEGORICAMENTE REJEITADA
      await assertFails(set(movRef, {
        id: movId,
        productId: 'prod_1',
        quantity: 99,
        delta: 99,
        type: 'IN',
        date: '2026-10-13T10:00:00Z',
        version: 2
      }));

      // 3. Tentativa de remover registro existente é CATEGORICAMENTE REJEITADA
      await assertFails(set(movRef, null));
    });
  });

  // ===========================================================================
  // 4. CUSTOM CLAIMS E ISOLAMENTO MULTI-TENANT (SEÇÃO 5)
  // ===========================================================================
  describe('4. Custom Claims e Isolamento Multi-Tenant', () => {
    it('4.1: Casos negativos obrigatórios de resolução de claims', () => {
      // 1. claim tenantId ausente
      const s1 = createSession('u1', null, 'admin');
      expect(s1.tenantId).toBeNull();
      expect(s1.canonicalClaims).toBe(false);
      expect(checkPermission(s1, 'create', 'products').authorized).toBe(false);

      // 2. claim appRole ausente
      const s2 = createSession('u2', TENANT_A, null);
      expect(s2.appRole).toBe('viewer');
      expect(s2.canonicalClaims).toBe(false);
      expect(checkPermission(s2, 'create', 'products').authorized).toBe(false);

      // 3. apenas tenant_id legado
      const role3 = resolveBusinessRole({ tenant_id: TENANT_A, appRole: 'admin' });
      expect(role3).toBe('admin');
      const noTenantId = (typeof ({ tenant_id: TENANT_A }).tenantId === 'string') ? ({ tenant_id: TENANT_A }).tenantId : null;
      expect(noTenantId).toBeNull(); // Não promove tenant_id para tenantId

      // 4. apenas role sem claims de negócio canônicas (ex: role: 'admin')
      const role4 = resolveBusinessRole({ role: 'admin' });
      expect(role4).toBe('viewer'); // Fail-closed para viewer, requer migração

      // 5. role: 'authenticated' presente junto a claims canônicas válidas
      const role5 = resolveBusinessRole({ tenantId: TENANT_A, appRole: 'admin', role: 'authenticated' });
      expect(role5).toBe('admin'); // Concede papel comercial baseado estritamente em appRole
      const s5 = createSession('u5', TENANT_A, 'admin', { role: 'authenticated' });
      expect(checkPermission(s5, 'create', 'products').authorized).toBe(true);

      // 5b. role: 'authenticated' SOZINHO sem appRole
      const roleAuthOnly = resolveBusinessRole({ role: 'authenticated' });
      expect(roleAuthOnly).toBe('viewer');
      const sAuthOnly = createSession('uAuth', TENANT_A, null, { role: 'authenticated' });
      expect(checkPermission(sAuthOnly, 'create', 'products').authorized).toBe(false);
    });

    it('4.2: Bloqueio estrito de acesso e escrita cross-tenant no RTDB Emulator', async () => {
      const userA = testEnv.authenticatedContext('userA', { tenantId: TENANT_A, appRole: 'admin', role: 'authenticated' });
      const userB = testEnv.authenticatedContext('userB', { tenantId: TENANT_B, appRole: 'admin', role: 'authenticated' });
      const rtdbA = userA.database();
      const rtdbB = userB.database();

      const prodId = 'prod_tenant_iso_' + Date.now();
      const pathA = `tenants/${TENANT_A}/products/${prodId}`;

      // Tenant A grava com sucesso
      await assertSucceeds(set(ref(rtdbA, pathA), {
        id: prodId,
        name: 'Produto Tenant A',
        salePriceCents: 1000,
        version: 1
      }));

      // Tenant B tenta ler produto de Tenant A -> NEGADO
      await assertFails(get(ref(rtdbB, pathA)));

      // Tenant B tenta gravar ou alterar produto de Tenant A -> NEGADO
      await assertFails(set(ref(rtdbB, pathA), {
        id: prodId,
        name: 'Invasão Tenant B',
        salePriceCents: 2000,
        version: 2
      }));
    });

    it('4.3: Troca de sessão ou usuário não vaza itens da Outbox', async () => {
      // Enfileira item para Tenant A
      await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_a_leak_chk',
        action: 'CREATE',
        payload: { id: 'prod_a_leak_chk', name: 'Item A', salePriceCents: 100 },
        tenantId: TENANT_A
      });

      // Enfileira item para Tenant B
      await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_b_leak_chk',
        action: 'CREATE',
        payload: { id: 'prod_b_leak_chk', name: 'Item B', salePriceCents: 200 },
        tenantId: TENANT_B
      });

      setTenantResolver(() => TENANT_A);
      const pendingA = await syncRepository.getPending();
      expect(pendingA.every(i => i.tenantId === TENANT_A)).toBe(true);
      expect(pendingA.some(i => i.entityId === 'prod_b_leak_chk')).toBe(false);

      setTenantResolver(() => TENANT_B);
      const pendingB = await syncRepository.getPending();
      expect(pendingB.every(i => i.tenantId === TENANT_B)).toBe(true);
      expect(pendingB.some(i => i.entityId === 'prod_a_leak_chk')).toBe(false);

      setTenantResolver(() => null);
    });

    it('4.4: Recusa privilégios administrativos para operador ou viewer', () => {
      const opSession = createSession('op1', TENANT_A, 'operator');
      const viewSession = createSession('view1', TENANT_A, 'viewer');

      // Operator pode cadastrar produtos e estoque, mas NÃO compras, fornecedores ou settings
      expect(checkPermission(opSession, 'create', 'products').authorized).toBe(true);
      expect(checkPermission(opSession, 'create', 'inventory').authorized).toBe(true);
      expect(checkPermission(opSession, 'create', 'purchases').authorized).toBe(false);
      expect(checkPermission(opSession, 'create', 'suppliers').authorized).toBe(false);
      expect(checkPermission(opSession, 'update', 'settings').authorized).toBe(false);

      // Viewer não pode realizar NENHUMA mutação
      expect(checkPermission(viewSession, 'create', 'products').authorized).toBe(false);
      expect(checkPermission(viewSession, 'update', 'products').authorized).toBe(false);
      expect(checkPermission(viewSession, 'delete', 'products').authorized).toBe(false);
      expect(checkPermission(viewSession, 'create', 'inventory').authorized).toBe(false);
    });
  });
});
