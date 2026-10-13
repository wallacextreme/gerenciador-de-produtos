import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get, update, remove } from 'firebase/database';
import { getDB, closeDB } from '../src/js/db/connection.js';
import { authService, AuthService } from '../src/js/services/AuthService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { StockService } from '../src/js/services/StockService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { syncRepository, SyncRepository } from '../src/js/repositories/SyncRepository.js';
import { ImageManifestRepository, imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { LocalImageCache } from '../src/js/services/LocalImageCache.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { FirebaseRealtimeProvider } from '../src/js/sync/FirebaseRealtimeProvider.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { setTenantResolver } from '../src/js/repositories/BaseRepository.js';
import { EventBus, eventBus, EVENTS } from '../src/js/eventBus.js';
import {
  REMOTE_RECONCILIATION_OUTCOME,
  classifyRemoteOutcome,
  arePayloadsEquivalent
} from '../src/js/utils/operationIdentity.js';

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-concurrency-phase14';

let testEnv;
let spawnedProcess = null;

async function isEmulatorRunning(port = EMULATOR_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.inspect/coverage.json`, {
      signal: AbortSignal.timeout(1000)
    });
    return res.ok || res.status === 404 || res.status === 401;
  } catch {
    return false;
  }
}

async function ensureEmulator(port = EMULATOR_PORT) {
  if (await isEmulatorRunning(port)) {
    return;
  }
  const jarPath = join(homedir(), '.cache', 'firebase', 'emulators', 'firebase-database-emulator-v4.11.2.jar');
  if (!existsSync(jarPath)) {
    throw new Error(`Emulador RTDB não encontrado em ${jarPath}.`);
  }
  spawnedProcess = spawn('java', ['-jar', jarPath, '--port', String(port)], {
    stdio: 'ignore',
    detached: true
  });
  spawnedProcess.unref();

  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isEmulatorRunning(port)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout aguardando emulador RTDB subir na porta ${port}`);
}

function createTestSession(uid, tenantId, role, appRole = role) {
  return {
    authenticated: true,
    uid,
    tenantId,
    role,
    appRole,
    claims: {
      tenantId,
      role,
      appRole,
      canonicalClaims: true
    },
    canonicalClaims: true,
    requiresMigration: false
  };
}

function createControllableAuth(initialSession) {
  let session = initialSession;
  return {
    getCurrentSession: () => session,
    getTenantId: () => session?.tenantId || null,
    isConfigured: () => true,
    isAdmin: () => session?.appRole === 'admin',
    isOperator: () => session?.appRole === 'operator',
    isViewer: () => session?.appRole === 'viewer',
    setSession: (newSession) => { session = newSession; },
    onAuthStateChanged: (cb) => {
      try { cb(session); } catch (_) {}
      return () => {};
    }
  };
}

describe('FASE 14.19 — Auditoria Independente, Concorrência entre Abas, Serialização do Outbox e Robustez', () => {
  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);

    let rulesContent = readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: {
        host: '127.0.0.1',
        port: EMULATOR_PORT,
        rules: rulesContent
      }
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
    if (spawnedProcess && spawnedProcess.pid) {
      try { process.kill(spawnedProcess.pid); } catch (_) {}
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearDatabase();
    }
    const db = await getDB();
    const stores = ['products', 'stockMovements', 'sales', 'purchases', 'suppliers', 'settings', 'syncQueue', 'imageManifest'];
    for (const s of stores) {
      try {
        await db.clear(s);
      } catch (_) {}
    }
  });

  afterEach(async () => {
    setTenantResolver(() => authService.getTenantId());
    authService.setProvider(null);
  });

  // =========================================================================
  // GRUPO A: Serialização por Entidade e Ordem Causal do Outbox (Seção 4.1 e 4.3)
  // =========================================================================
  describe('Grupo A — Serialização por Entidade e Ordem Causal do Outbox', () => {
    it('19.1: Duas chamadas simultâneas de processQueue() não enviam a mesma operação duas vezes e não violam idempotência', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p1419_1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_p1419_1', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider1 = new FirebaseRealtimeProvider(null, auth);
      provider1.db = adminCtx.database();
      provider1._initialized = true;
      provider1._connected = true;

      const provider2 = new FirebaseRealtimeProvider(null, auth);
      provider2.db = adminCtx.database();
      provider2._initialized = true;
      provider2._connected = true;

      const engine1 = new SyncEngine(provider1, auth);
      const engine2 = new SyncEngine(provider2, auth);
      await engine1.init();
      await engine2.init();
      engine1.autoSync = false;
      engine2.autoSync = false;

      // Cria um item na Outbox
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_concurrent_1',
        action: 'CREATE',
        payload: {
          id: 'prod_concurrent_1',
          name: 'Item Concorrente 1',
          salePriceCents: 10000,
          purchasePriceCents: 6000,
          tenantId: 'tenantA',
          version: 1
        },
        tenantId: 'tenantA'
      });

      // Dispara processQueue() em ambas as instâncias simultaneamente
      const [res1, res2] = await Promise.all([
        engine1.processQueue(),
        engine2.processQueue()
      ]);

      // Exatamente UMA instância deve ter processado o item com sucesso; a outra pula porque já estava claimed
      expect(res1.success + res2.success).toBe(1);

      // No RTDB Emulator, deve existir exatamente um registro
      const snap = await get(ref(adminCtx.database(), 'tenants/tenantA/products/prod_concurrent_1'));
      expect(snap.exists()).toBe(true);
      expect(snap.val().name).toBe('Item Concorrente 1');
      expect(snap.val().version).toBe(1);

      // Na fila local, o item deve estar SYNCED
      const updatedItem = await syncRepository.findById(item.id);
      expect(updatedItem.status).toBe('SYNCED');

      engine1.destroy();
      engine2.destroy();
    });

    it('19.2: Duas atualizações dependentes da mesma entidade são processadas em estrita ordem causal FIFO (v1->v2 antes de v2->v3)', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p1419_2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_p1419_2', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const engine = new SyncEngine(provider, auth);
      await engine.init();
      engine.autoSync = false;

      // Inicializa produto no RTDB em v1
      await set(ref(adminCtx.database(), 'tenants/tenantA/products/prod_causal_1'), {
        id: 'prod_causal_1',
        name: 'Original v1',
        salePriceCents: 5000,
        purchasePriceCents: 3000,
        tenantId: 'tenantA',
        version: 1
      });

      // Enfileira dois updates com dependência causal
      const item1 = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_causal_1',
        action: 'UPDATE',
        payload: {
          id: 'prod_causal_1',
          name: 'Intermediário v2',
          salePriceCents: 6000,
          purchasePriceCents: 3000,
          tenantId: 'tenantA',
          baseVersion: 1,
          version: 2
        },
        tenantId: 'tenantA'
      });

      // Simula que item 1 está em voo
      item1.inFlight = true;
      await syncRepository.update(item1);

      // Enfileira item 2 dependente de v2
      const item2 = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_causal_1',
        action: 'UPDATE',
        payload: {
          id: 'prod_causal_1',
          name: 'Final v3',
          salePriceCents: 7000,
          purchasePriceCents: 3000,
          tenantId: 'tenantA',
          baseVersion: 2,
          version: 3
        },
        tenantId: 'tenantA'
      });

      // Libera item1 e processa a fila
      item1.inFlight = false;
      await syncRepository.update(item1);

      const resSync = await engine.processQueue();
      expect(resSync.success).toBe(2);

      // Nó remoto deve ter chegado em v3 com o nome final
      const snap = await get(ref(adminCtx.database(), 'tenants/tenantA/products/prod_causal_1'));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(3);
      expect(snap.val().name).toBe('Final v3');
      expect(snap.val().salePriceCents).toBe(7000);

      engine.destroy();
    });

    it('19.3: Falha na sincronização de um produto não bloqueia entidades independentes na fila', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p1419_3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_p1419_3', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const engine = new SyncEngine(provider, auth);
      await engine.init();
      engine.autoSync = false;

      // Item 1 inválido (falhará pelas regras de segurança: preço negativo)
      const badItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_bad_1',
        action: 'CREATE',
        payload: {
          id: 'prod_bad_1',
          name: 'Item Inválido',
          salePriceCents: -500,
          tenantId: 'tenantA'
        },
        tenantId: 'tenantA'
      });

      // Item 2 válido (entidade independente: prod_good_2)
      const goodItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_good_2',
        action: 'CREATE',
        payload: {
          id: 'prod_good_2',
          name: 'Item Válido',
          salePriceCents: 8500,
          purchasePriceCents: 4000,
          tenantId: 'tenantA',
          version: 1
        },
        tenantId: 'tenantA'
      });

      const resSync = await engine.processQueue();
      expect(resSync.failed).toBe(1);
      expect(resSync.success).toBe(1);

      // Item 1 falhou
      const checkBad = await syncRepository.findById(badItem.id);
      expect(checkBad.status).toBe('FAILED');

      // Item 2 sincronizou com sucesso no RTDB
      const checkGood = await syncRepository.findById(goodItem.id);
      expect(checkGood.status).toBe('SYNCED');

      const snapGood = await get(ref(adminCtx.database(), 'tenants/tenantA/products/prod_good_2'));
      expect(snapGood.exists()).toBe(true);
      expect(snapGood.val().name).toBe('Item Válido');

      engine.destroy();
    });

    it('19.4: Duas atualizações offline consolidadas sob sincronizações concorrentes convergem para v2 e próxima edição gera v3', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p1419_4', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_p1419_4', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const engine = new SyncEngine(provider, auth);
      await engine.init();
      engine.autoSync = false;

      // Cria produto inicial sincronizado em v1
      const prodId = await ProductService.createProduct({
        name: 'Item Coalescente Inicial',
        salePriceCents: 20000,
        purchasePriceCents: 12000,
        tenantId: 'tenantA'
      });
      await engine.processQueue();

      // Duas edições offline
      await ProductService.updateProduct(prodId, {
        name: 'Item Coalescente Edição 1',
        salePriceCents: 22000,
        purchasePriceCents: 12000,
        tenantId: 'tenantA'
      });
      await ProductService.updateProduct(prodId, {
        name: 'Item Coalescente Edição 2',
        salePriceCents: 25000,
        purchasePriceCents: 12000,
        tenantId: 'tenantA'
      });

      // Sincronização concorrente disparada em paralelo
      const [resA, resB] = await Promise.all([
        engine.processQueue(),
        engine.processQueue()
      ]);
      expect(resA.success + resB.success).toBe(1);

      // Verifica versão remota
      const snapRemote = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
      expect(snapRemote.val().version).toBe(2);
      expect(snapRemote.val().name).toBe('Item Coalescente Edição 2');

      // Verifica versão local reconciliada
      const prodLocal = await productRepository.findById(prodId);
      expect(prodLocal.version).toBe(2);
      expect(prodLocal.baseVersion).toBe(1);

      // Próxima edição pós-sync deve gerar baseVersion: 2, version: 3
      await ProductService.updateProduct(prodId, {
        name: 'Item Coalescente Edição 3 Pós-Sync',
        salePriceCents: 30000,
        purchasePriceCents: 12000,
        tenantId: 'tenantA'
      });

      const resSync3 = await engine.processQueue();
      expect(resSync3.success).toBe(1);

      const snapRemote3 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
      expect(snapRemote3.val().version).toBe(3);
      expect(snapRemote3.val().name).toBe('Item Coalescente Edição 3 Pós-Sync');

      engine.destroy();
    });
  });

  // =========================================================================
  // GRUPO B: Concorrência no Enfileiramento `enqueue` (Seção 4.2)
  // =========================================================================
  describe('Grupo B — Concorrência no Enfileiramento enqueue', () => {
    it('19.5: Duas chamadas de enqueue com o mesmo operationId e mesmo payload retornam idempotentemente sem duplicar', async () => {
      const opId = 'op_idem_identical_123';
      const payload = {
        id: 'p_op_1',
        name: 'Produto Idempotente',
        salePriceCents: 4500,
        tenantId: 'tenantA'
      };

      const [item1, item2] = await Promise.all([
        syncRepository.enqueue({
          entityType: 'products',
          entityId: 'p_op_1',
          action: 'CREATE',
          payload,
          tenantId: 'tenantA',
          operationId: opId
        }),
        syncRepository.enqueue({
          entityType: 'products',
          entityId: 'p_op_1',
          action: 'CREATE',
          payload,
          tenantId: 'tenantA',
          operationId: opId
        })
      ]);

      expect(item1.id).toBe(item2.id);

      const all = await syncRepository.findAll();
      const matching = all.filter(i => i.operationId === opId || i.id === item1.id);
      expect(matching.length).toBe(1);
    });

    it('19.6: Duas chamadas com o mesmo operationId e payload divergente lançam erro de conflito', async () => {
      const opId = 'op_divergent_123';

      await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_op_div',
        action: 'CREATE',
        payload: { id: 'p_op_div', name: 'Original', salePriceCents: 1000, tenantId: 'tenantA' },
        tenantId: 'tenantA',
        operationId: opId
      });

      await expect(
        syncRepository.enqueue({
          entityType: 'products',
          entityId: 'p_op_div',
          action: 'CREATE',
          payload: { id: 'p_op_div', name: 'Divergente', salePriceCents: 9999, tenantId: 'tenantA' },
          tenantId: 'tenantA',
          operationId: opId
        })
      ).rejects.toThrow('possui payload divergente');
    });

    it('19.7: CREATE e UPDATE concorrendo antes do despacho coalescem em um único CREATE sem baseVersion residual', async () => {
      const [cr, up] = await Promise.all([
        syncRepository.enqueue({
          entityType: 'products',
          entityId: 'prod_cr_up',
          action: 'CREATE',
          payload: { id: 'prod_cr_up', name: 'Criado', salePriceCents: 5000, tenantId: 'tenantA' },
          tenantId: 'tenantA'
        }),
        syncRepository.enqueue({
          entityType: 'products',
          entityId: 'prod_cr_up',
          action: 'UPDATE',
          payload: { id: 'prod_cr_up', name: 'Criado e Editado', salePriceCents: 6000, tenantId: 'tenantA' },
          tenantId: 'tenantA'
        })
      ]);

      const all = await syncRepository.findAll();
      const items = all.filter(i => i.entityId === 'prod_cr_up' && i.status === 'PENDING');
      expect(items.length).toBe(1);

      const finalItem = items[0];
      expect(finalItem.action).toBe('CREATE');
      expect(finalItem.payload.name).toBe('Criado e Editado');
      expect(finalItem.payload.salePriceCents).toBe(6000);
      expect(finalItem.payload.version).toBe(1);
      expect(finalItem.payload.baseVersion).toBeUndefined();
    });

    it('19.8: UPDATE concorrendo com item em voo (SYNCING) gera novo item PENDING sem corromper a operação em voo', async () => {
      const item1 = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_inflight_conc',
        action: 'UPDATE',
        payload: { id: 'prod_inflight_conc', name: 'Em Voo', salePriceCents: 1000, tenantId: 'tenantA', version: 2 },
        tenantId: 'tenantA'
      });

      // Simula que item1 foi reservado para envio (claimForDispatch)
      const claimed = await syncRepository.claimForDispatch(item1.id);
      expect(claimed).not.toBeNull();
      expect(claimed.status).toBe('SYNCING');
      expect(claimed.inFlight).toBe(true);

      // Agora chega uma nova edição enquanto item1 está em voo
      const item2 = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_inflight_conc',
        action: 'UPDATE',
        payload: { id: 'prod_inflight_conc', name: 'Edição Nova', salePriceCents: 2000, tenantId: 'tenantA', version: 3 },
        tenantId: 'tenantA'
      });

      expect(item2.id).not.toBe(item1.id);
      expect(item2.status).toBe('PENDING');
      expect(item2.inFlight).toBe(false);

      const freshItem1 = await syncRepository.findById(item1.id);
      expect(freshItem1.status).toBe('SYNCING');
      expect(freshItem1.payload.name).toBe('Em Voo');
    });
  });

  // =========================================================================
  // GRUPO C: Concorrência entre Abas e Contextos Independentes (Seções 5.1 a 5.3)
  // =========================================================================
  describe('Grupo C — Concorrência entre Abas e Contextos Independentes', () => {
    it('19.9: Duas abas editando a mesma entidade: Aba A salva primeiro (v1->v2), Aba B tenta salvar com baseVersion 1 e CAS local bloqueia', async () => {
      authService.setProvider(createControllableAuth(createTestSession('u1', 'tenantA', 'admin')));
      setTenantResolver(() => 'tenantA');

      const prodId = await ProductService.createProduct({
        name: 'Item Multi-Aba',
        salePriceCents: 10000,
        purchasePriceCents: 6000,
        tenantId: 'tenantA'
      });

      // Aba A e Aba B leram o produto em v1
      const prodAbaA = await productRepository.findById(prodId);
      const prodAbaB = await productRepository.findById(prodId);
      expect(prodAbaA.version).toBe(1);
      expect(prodAbaB.version).toBe(1);

      // Aba A salva a alteração com sucesso
      await ProductService.updateProduct(prodId, {
        ...prodAbaA,
        name: 'Aba A Editou Primeiro'
      });

      // O produto local agora está em v2
      const prodLocal = await productRepository.findById(prodId);
      expect(prodLocal.version).toBe(2);

      // Aba B tenta salvar utilizando o estado obsoleto de quando leu (v1)
      await expect(
        ProductService.updateProduct(prodId, {
          ...prodAbaB,
          name: 'Aba B Tentou Sobrescrever'
        })
      ).rejects.toThrow('Conflito de concorrência local (CAS)');

      // O estado de Aba A permanece protegido no banco
      const finalProd = await productRepository.findById(prodId);
      expect(finalProd.name).toBe('Aba A Editou Primeiro');
      expect(finalProd.version).toBe(2);
    });

    it('19.10: Ciclo de vida do EventBus: destroy() fecha canal e limpa listeners sem afetar outra instância', () => {
      const busA = new EventBus();
      const busB = new EventBus();

      let receivedA = 0;
      let receivedB = 0;

      busA.on(EVENTS.PRODUCT_UPDATED, () => { receivedA++; });
      busB.on(EVENTS.PRODUCT_UPDATED, () => { receivedB++; });

      busA.emit(EVENTS.PRODUCT_UPDATED, { id: 'p1' });
      expect(receivedA).toBe(1);

      // Destrói busA
      busA.destroy();

      // Dispara em busB: busB deve continuar funcionando normalmente
      busB.emit(EVENTS.PRODUCT_UPDATED, { id: 'p2' });
      expect(receivedB).toBe(1);

      // busA não deve disparar mais
      busA.emit(EVENTS.PRODUCT_UPDATED, { id: 'p3' });
      expect(receivedA).toBe(1);

      busB.destroy();
    });

    it('19.11: Isolamento estrito entre abas em tenants distintos: operações de Tenant A não são processadas por Tenant B', async () => {
      const adminCtxA = testEnv.authenticatedContext('admin_A', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const adminCtxB = testEnv.authenticatedContext('admin_B', { tenantId: 'tenantB', role: 'admin', appRole: 'admin' });

      const authA = createControllableAuth(createTestSession('admin_A', 'tenantA', 'admin', 'admin'));
      const authB = createControllableAuth(createTestSession('admin_B', 'tenantB', 'admin', 'admin'));

      const providerB = new FirebaseRealtimeProvider(null, authB);
      providerB.db = adminCtxB.database();
      providerB._initialized = true;
      providerB._connected = true;

      const engineB = new SyncEngine(providerB, authB);
      await engineB.init();
      engineB.autoSync = false;

      // Cria operação no Tenant A
      await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_tenantA_only',
        action: 'CREATE',
        payload: { id: 'prod_tenantA_only', name: 'Segredo Tenant A', salePriceCents: 5000, tenantId: 'tenantA' },
        tenantId: 'tenantA'
      });

      // Tenant B executa processQueue
      const resB = await engineB.processQueue();
      expect(resB.processed).toBe(0);
      expect(resB.success).toBe(0);

      // Confirma que Tenant B não enviou o item de Tenant A para seu próprio banco
      const snapB = await get(ref(adminCtxB.database(), 'tenants/tenantB/products/prod_tenantA_only'));
      expect(snapB.exists()).toBe(false);

      engineB.destroy();
    });
  });

  // =========================================================================
  // GRUPO D: Matriz Completa de Recuperação de Operações Desconhecidas (Seção 6.1)
  // =========================================================================
  describe('Grupo D — Matriz Completa de Recuperação de Operações Desconhecidas', () => {
    it('19.12: Cenário A — Registro realmente ausente (RECORD_ABSENT) transiciona para PENDING', async () => {
      const mockProvider = {
        get: async () => null,
        isConfigured: () => true
      };
      const engine = new SyncEngine(mockProvider);

      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_absent_1',
        action: 'CREATE',
        payload: { id: 'p_absent_1', name: 'Item Ausente', salePriceCents: 1000 },
        tenantId: 'tenantA'
      });
      item.remoteOutcomeUnknown = true;
      await syncRepository.update(item);

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(true);
      expect(res.outcome).toBe('RECORD_ABSENT');

      const updated = await syncRepository.findById(item.id);
      expect(updated.status).toBe('PENDING');
      expect(updated.remoteOutcomeUnknown).toBe(false);
    });

    it('19.13: Cenário B — Registro equivalente (RECORD_EQUIVALENT) finaliza como SYNCED', async () => {
      const mockProvider = {
        get: async () => ({ id: 'mov_eq_1', quantity: 5, delta: 5, type: 'IN', version: 1 }),
        isConfigured: () => true
      };
      const engine = new SyncEngine(mockProvider);

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_eq_1',
        action: 'CREATE',
        payload: { id: 'mov_eq_1', quantity: 5, delta: 5, type: 'IN' },
        tenantId: 'tenantA'
      });
      item.remoteOutcomeUnknown = true;
      await syncRepository.update(item);

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(true);
      expect(res.outcome).toBe('RECORD_EQUIVALENT');

      const updated = await syncRepository.findById(item.id);
      expect(updated.status).toBe('SYNCED');
      expect(updated.remoteAckReceived).toBe(true);
    });

    it('19.14: Cenário C — Registro existente com payload divergente (RECORD_DIVERGENT) bloqueia com requiresResolution', async () => {
      const mockProvider = {
        get: async () => ({ id: 'mov_div_1', quantity: 10, delta: 10, type: 'IN' }), // quantidade 10
        isConfigured: () => true
      };
      const engine = new SyncEngine(mockProvider);

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_div_1',
        action: 'CREATE',
        payload: { id: 'mov_div_1', quantity: 2, delta: 2, type: 'IN' }, // quantidade local 2
        tenantId: 'tenantA'
      });
      item.remoteOutcomeUnknown = true;
      await syncRepository.update(item);

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(false);
      expect(res.outcome).toBe('RECORD_DIVERGENT');

      const updated = await syncRepository.findById(item.id);
      expect(updated.status).toBe('FAILED');
      expect(updated.requiresResolution).toBe(true);
      expect(updated.permanentFailure).toBe(true);
    });

    it('19.15: Cenário D — Leitura negada por autorização (PERMISSION_DENIED) bloqueia sem retry cego', async () => {
      const mockProvider = {
        get: async () => {
          const err = new Error('PERMISSION_DENIED: Client lacks permission');
          err.code = 'permission_denied';
          throw err;
        },
        isConfigured: () => true
      };
      const engine = new SyncEngine(mockProvider);

      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_perm_denied',
        action: 'CREATE',
        payload: { id: 'p_perm_denied', name: 'Perm Denied', salePriceCents: 1000 },
        tenantId: 'tenantA'
      });
      item.remoteOutcomeUnknown = true;
      await syncRepository.update(item);

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(false);
      expect(res.outcome).toBe('PERMISSION_DENIED');

      const updated = await syncRepository.findById(item.id);
      expect(updated.status).toBe('FAILED');
      expect(updated.requiresResolution).toBe(true);
      expect(updated.errorCategory).toBe('security');
    });

    it('19.16: Cenário E — Falha transitória de leitura (INACCESSIBLE) bloqueia sem considerar ausente', async () => {
      const mockProvider = {
        get: async () => {
          throw new Error('Network timeout connecting to emulator');
        },
        isConfigured: () => true
      };
      const engine = new SyncEngine(mockProvider);

      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_transient_1',
        action: 'CREATE',
        payload: { id: 'p_transient_1', name: 'Transient', salePriceCents: 1000 },
        tenantId: 'tenantA'
      });
      item.remoteOutcomeUnknown = true;
      await syncRepository.update(item);

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(false);
      expect(res.outcome).toBe('INACCESSIBLE');

      const updated = await syncRepository.findById(item.id);
      // FASE 14.23: falha de leitura não é ausência nem bloqueio imediato: PENDING + desconhecido + backoff
      expect(updated.status).toBe('PENDING');
      expect(updated.requiresResolution).toBe(false);
      expect(updated.remoteOutcomeUnknown).toBe(true);
      expect(updated.errorCategory).toBe('unknown_remote_outcome');
      expect(updated.reconcileAttempts).toBe(1);
      expect(updated.nextReconcileAt).toBeTruthy();
    });
  });

  // =========================================================================
  // GRUPO E: Auditoria da Reconciliação Local Pós-ACK (Seção 7)
  // =========================================================================
  describe('Grupo E — Auditoria da Reconciliação Local Pós-ACK', () => {
    it('19.17: Edição local B feita durante o voo da atualização A: ACK de A não regride versão local nem apaga alteração B', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p1419_e1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_p1419_e1', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const engine = new SyncEngine(provider, auth);
      await engine.init();
      engine.autoSync = false;

      // 1. Cria produto inicial sincronizado em v1
      const prodId = await ProductService.createProduct({
        name: 'Produto Base v1',
        salePriceCents: 10000,
        purchasePriceCents: 6000,
        tenantId: 'tenantA'
      });
      await engine.processQueue();

      // 2. Atualização A colocada em voo
      await ProductService.updateProduct(prodId, {
        name: 'Produto Atualização A em Voo',
        salePriceCents: 12000,
        purchasePriceCents: 6000,
        tenantId: 'tenantA'
      });

      const pendingA = await syncRepository.getPending();
      const itemA = pendingA.find(i => i.entityId === prodId);
      expect(itemA).toBeDefined();

      // Simula que itemA é reservado e enviado
      const claimedA = await syncRepository.claimForDispatch(itemA.id);
      expect(claimedA).not.toBeNull();

      // 3. Enquanto A está em voo, usuário faz edição B localmente
      await ProductService.updateProduct(prodId, {
        name: 'Produto Edição B Posterior',
        salePriceCents: 15000,
        purchasePriceCents: 6000,
        tenantId: 'tenantA'
      });

      // Versão local foi para v3 (baseVersion: 2)
      const prodBeforeAck = await productRepository.findById(prodId);
      expect(prodBeforeAck.version).toBe(3);
      expect(prodBeforeAck.name).toBe('Produto Edição B Posterior');

      // 4. Item A recebe ACK remoto e servidor fica em v2
      await set(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`), claimedA.payload);
      await syncRepository.markSynced(claimedA.id);

      // 5. Executa reconciliação de itemA
      await engine._reconcileLocalProductVersion(claimedA);

      // 6. Confirma que a edição B NÃO foi regredida nem apagada
      const prodAfterAckA = await productRepository.findById(prodId);
      expect(prodAfterAckA.version).toBe(3);
      expect(prodAfterAckA.name).toBe('Produto Edição B Posterior');
      expect(prodAfterAckA.salePriceCents).toBe(15000);

      // 7. Retoma a sincronização para enviar item B
      const resSyncB = await engine.processQueue();
      expect(resSyncB.success).toBe(1);

      // 8. Estado final no RTDB converge para v3 com os dados da Edição B
      const snapFinal = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
      expect(snapFinal.val().version).toBe(3);
      expect(snapFinal.val().name).toBe('Produto Edição B Posterior');
      expect(snapFinal.val().salePriceCents).toBe(15000);

      engine.destroy();
    });
  });

  // =========================================================================
  // GRUPO F: Ciclo de Vida do SyncEngine (Seção 9)
  // =========================================================================
  describe('Grupo F — Ciclo de Vida do SyncEngine', () => {
    it('19.18: init() reentrante não duplica listeners; destroy() e re-init preservam a integridade da fila', async () => {
      const auth = createControllableAuth(createTestSession('u_life', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      const engine = new SyncEngine(mockProvider, auth);
      engine.autoSync = false;

      // Múltiplos inits
      await engine.init();
      await engine.init();
      await engine.init();

      expect(engine._initialized).toBe(true);

      // Enfileira item
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_lifecycle_1',
        action: 'CREATE',
        payload: { id: 'p_lifecycle_1', name: 'Item Ciclo de Vida', salePriceCents: 5000 },
        tenantId: 'tenantA'
      });

      // Destrói engine
      engine.destroy();
      expect(engine._initialized).toBe(false);

      // Item na Outbox deve permanecer intacto após o destroy
      const itemStillThere = await syncRepository.findById(item.id);
      expect(itemStillThere).not.toBeNull();
      expect(itemStillThere.status).toBe('PENDING');

      // Re-inicializa e processa normalmente
      await engine.init();
      expect(engine._initialized).toBe(true);

      const resSync = await engine.processQueue();
      expect(resSync.success).toBe(1);

      const itemSynced = await syncRepository.findById(item.id);
      expect(itemSynced.status).toBe('SYNCED');

      engine.destroy();
    });
  });

  // =========================================================================
  // GRUPO G: Recuperação de Claims Presas e Lease de Despacho (FASE 14.20)
  // =========================================================================
  describe('Grupo G — Recuperação de Claims Presas e Lease de Despacho (FASE 14.20)', () => {
    it('20.1: Encerramento com dispatchStarted === false (reserva criada sem envio) recupera diretamente para PENDING', async () => {
      const auth = createControllableAuth(createTestSession('u_g1', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      const engine = new SyncEngine(mockProvider, auth);
      engine.autoSync = false;

      // 1. Enfileira item
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_crash_before_send',
        action: 'CREATE',
        payload: { id: 'p_crash_before_send', name: 'Reserva sem Envio', salePriceCents: 5000 },
        tenantId: 'tenantA'
      });

      // 2. Instância A reserva o item (claimForDispatch) mas cai antes de recordDispatchStarted
      const claimed = await syncRepository.claimForDispatch(item.id, 'instance_A');
      expect(claimed).not.toBeNull();
      expect(claimed.status).toBe('SYNCING');
      expect(claimed.inFlight).toBe(true);
      expect(claimed.dispatchStarted).toBe(false);

      // 3. Nova instância recuperadora executa a recuperação com lease expirado / force
      const engineRecovery = new SyncEngine(mockProvider, auth);
      const res = await engineRecovery.recoverInterruptedInFlight({ force: true });
      expect(res.recovered).toBe(1);

      // 4. Item volta para PENDING sem envio cego
      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.status).toBe('PENDING');
      expect(freshItem.inFlight).toBe(false);
      expect(freshItem.claimedBy).toBeNull();
      expect(freshItem.claimAttemptId).toBeNull();
      // FASE 14.23: envio comprovadamente não iniciado não exige leitura remota (sem inFlightInterrupted)
      expect(freshItem.releasedBeforeDispatch).toBe(true);
      expect(freshItem.remoteOutcomeUnknown).toBeFalsy();

      engine.destroy();
      engineRecovery.destroy();
    });

    it('20.2: Encerramento com dispatchStarted === true (envio iniciado) reconcilia com provedor antes de retentar', async () => {
      const auth = createControllableAuth(createTestSession('u_g2', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      const engine = new SyncEngine(mockProvider, auth);
      engine.autoSync = false;

      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_crash_during_send',
        action: 'CREATE',
        payload: { id: 'p_crash_during_send', name: 'Envio em Andamento', salePriceCents: 6000 },
        tenantId: 'tenantA'
      });

      // Reserva e marca envio iniciado
      const claimed = await syncRepository.claimForDispatch(item.id, 'instance_A');
      await syncRepository.recordDispatchStarted(item.id, claimed.claimAttemptId);

      const itemBeforeCrash = await syncRepository.findById(item.id);
      expect(itemBeforeCrash.dispatchStarted).toBe(true);

      // Provedor não possui o registro (RECORD_ABSENT comprovado por consulta)
      mockProvider.get = async () => null;

      const engineRecovery = new SyncEngine(mockProvider, auth);
      const res = await engineRecovery.recoverInterruptedInFlight({ force: true });
      expect(res.recovered).toBe(1);

      // Item recuperado inicialmente requer reconciliação remota comprovada
      const itemAfterCrash = await syncRepository.findById(item.id);
      expect(itemAfterCrash.status).toBe('PENDING');
      expect(itemAfterCrash.remoteOutcomeUnknown).toBe(true);

      // Reconciliação com o provedor confirma ausência (RECORD_ABSENT) e limpa remoteOutcomeUnknown para retry limpo
      const reconRes = await engineRecovery.autoReconcileUnknownOutboxItem(item.id);
      expect(reconRes.reconciled).toBe(true);
      expect(reconRes.outcome).toBe('RECORD_ABSENT');

      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.status).toBe('PENDING');
      expect(freshItem.remoteOutcomeUnknown).toBe(false);

      engine.destroy();
      engineRecovery.destroy();
    });

    it('20.3: ACK remoto durável persistido antes do crash finaliza como SYNCED sem re-despacho', async () => {
      const auth = createControllableAuth(createTestSession('u_g3', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      let pushCalled = false;
      mockProvider.pushChange = async () => { pushCalled = true; return { success: true }; };

      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_ack_persisted_crash',
        action: 'CREATE',
        payload: { id: 'p_ack_persisted_crash', name: 'ACK Gravado', salePriceCents: 7000 },
        tenantId: 'tenantA'
      });

      const claimed = await syncRepository.claimForDispatch(item.id, 'instance_A');
      await syncRepository.recordDispatchStarted(item.id, claimed.claimAttemptId);

      // Grava ACK durável (simula queda logo após recordRemoteAck)
      await syncRepository.recordRemoteAck(item.id, claimed.claimAttemptId, {
        success: true,
        remoteVersion: 'v1_durable'
      });

      // Força simulação de interrupção em voo preservando o ACK persistido
      const itemToCrash = await syncRepository.findById(item.id);
      itemToCrash.inFlight = true;
      itemToCrash.status = 'SYNCING';
      await syncRepository.update(itemToCrash);

      const engineRecovery = new SyncEngine(mockProvider, auth);
      const res = await engineRecovery.recoverInterruptedInFlight({ force: true });
      expect(res.recovered).toBe(1);

      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.status).toBe('SYNCED');
      expect(freshItem.remoteAckReceived).toBe(true);
      expect(pushCalled).toBe(false); // Não realizou re-despacho duplicado na nuvem

      engineRecovery.destroy();
    });

    it('20.4: Lease ativo de Instância A impede que Instância B assuma prematuramente a mesma claim', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_lease_active',
        action: 'CREATE',
        payload: { id: 'p_lease_active', name: 'Lease Ativo', salePriceCents: 8000 },
        tenantId: 'tenantA'
      });

      // Instância A obtém lease com 60 segundos de validade
      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance_A', { leaseDurationMs: 60000 });
      expect(claimedA).not.toBeNull();
      expect(claimedA.claimedBy).toBe('instance_A');

      // Instância B tenta reivindicar imediatamente
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance_B');
      expect(claimedB).toBeNull(); // Rejeitado porque lease de A ainda está ativo!

      // Recuperação não-forçada respeita lease ativo
      const auth = createControllableAuth(createTestSession('u_g4', 'tenantA', 'admin'));
      const engineB = new SyncEngine(new MockRealtimeProvider(), auth);
      engineB.id = 'instance_B';

      const res = await engineB.recoverInterruptedInFlight({ force: false });
      expect(res.recovered).toBe(0);
      expect(res.blocked).toBe(0);

      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.claimedBy).toBe('instance_A');
      expect(freshItem.status).toBe('SYNCING');

      engineB.destroy();
    });

    it('20.5: Expiração do lease permite que Instância B assuma a claim com novo claimAttemptId', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_lease_expired',
        action: 'CREATE',
        payload: { id: 'p_lease_expired', name: 'Lease Expirável', salePriceCents: 9000 },
        tenantId: 'tenantA'
      });

      // Instância A obtém claim com lease de 1ms (expira instantaneamente)
      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance_A', { leaseDurationMs: 1 });
      expect(claimedA).not.toBeNull();
      const attemptA = claimedA.claimAttemptId;

      // Aguarda 10ms para garantir expiração
      await new Promise(r => setTimeout(r, 15));

      // Instância B assume a claim expirada
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance_B', { isRecovery: true });
      expect(claimedB).not.toBeNull();
      expect(claimedB.claimedBy).toBe('instance_B');
      expect(claimedB.claimAttemptId).not.toBe(attemptA);
    });

    it('20.6: Resposta atrasada (ACK tardio) de Instância A com tentativa suplantada não sobrescreve estado de B', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_delayed_ack',
        action: 'UPDATE',
        payload: { id: 'p_delayed_ack', name: 'Operação com Concorrência de Leases', salePriceCents: 1000 },
        tenantId: 'tenantA'
      });

      // 1. Instância A reserva (attemptA)
      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance_A', { leaseDurationMs: 1 });
      const attemptA = claimedA.claimAttemptId;

      await new Promise(r => setTimeout(r, 15));

      // 2. Instância B assume a recuperação (attemptB)
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance_B', { isRecovery: true });
      const attemptB = claimedB.claimAttemptId;
      expect(attemptB).not.toBe(attemptA);

      // 3. Instância B detecta conflito e marca FAILED com requiresResolution = true
      await syncRepository.markFailed(
        item.id,
        'Conflito remoto detectado por Instância B',
        5,
        true,
        { errorCategory: 'payload_divergence_conflict', requiresResolution: true }
      );

      const stateAfterB = await syncRepository.findById(item.id);
      expect(stateAfterB.status).toBe('FAILED');
      expect(stateAfterB.requiresResolution).toBe(true);

      // 4. Instância A recebe resposta atrasada e tenta registrar ACK
      const ackResultA = await syncRepository.recordRemoteAck(item.id, attemptA, {
        success: true,
        remoteVersion: 'v_delayed_from_server'
      });

      // Deve detectar que a tentativa foi suplantada (superseded: true)
      expect(ackResultA.superseded).toBe(true);
      expect(ackResultA.recorded).toBe(true);

      // 5. O estado no IndexedDB NÃO foi corrompido de volta para SYNCED pela resposta atrasada de A
      const finalState = await syncRepository.findById(item.id);
      expect(finalState.status).toBe('FAILED');
      expect(finalState.requiresResolution).toBe(true);
      // E a prova da gravação remota foi preservada duravelmente sem ser perdida
      expect(finalState.remoteAckReceived).toBe(true);
      expect(finalState.remoteVersion).toBe('v_delayed_from_server');
    });
  });

  // =========================================================================
  // GRUPO H: Matriz de Reconciliação Específica por Entidade e Ação (FASE 14.20)
  // =========================================================================
  describe('Grupo H — Matriz de Reconciliação Específica por Entidade e Ação (FASE 14.20)', () => {
    it('20.7: CREATE com registro remoto ausente é classificado como RECORD_ABSENT e permite retentativa', async () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_h1',
        action: 'CREATE',
        localPayload: { id: 'p_h1', name: 'Item H1', salePriceCents: 5000 },
        remoteRecord: null
      });

      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT);
      expect(outcome.isAbsent).toBe(true);
    });

    it('20.8: UPDATE de produto sobre registro remoto ausente bloqueia com UPDATE_ON_ABSENT_RECORD e requiresResolution', async () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_h2',
        action: 'UPDATE',
        localPayload: { id: 'p_h2', name: 'Item H2 Modificado', salePriceCents: 6000, version: 2 },
        remoteRecord: null
      });

      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.UPDATE_ON_ABSENT_RECORD);
      expect(outcome.requiresResolution).toBe(true);

      // Testa no motor de reconciliação automática
      const auth = createControllableAuth(createTestSession('u_h2', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      mockProvider.get = async () => null;

      const engine = new SyncEngine(mockProvider, auth);
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_h2',
        action: 'UPDATE',
        payload: { id: 'p_h2', name: 'Item H2 Modificado', salePriceCents: 6000, version: 2 },
        tenantId: 'tenantA'
      });

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(false);
      expect(res.outcome).toBe('UPDATE_ON_ABSENT_RECORD');

      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.status).toBe('FAILED');
      expect(freshItem.requiresResolution).toBe(true);
      expect(freshItem.errorCategory).toBe('missing_record');

      engine.destroy();
    });

    it('20.9: DELETE com registro remoto ausente ou já deletado conclui como ALREADY_DELETED (SYNCED)', async () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_h3',
        action: 'DELETE',
        localPayload: { id: 'p_h3' },
        remoteRecord: null
      });

      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED);

      // Testa reconciliação automática
      const auth = createControllableAuth(createTestSession('u_h3', 'tenantA', 'admin'));
      const mockProvider = new MockRealtimeProvider({ tenantId: 'tenantA' });
      mockProvider.get = async () => null;

      const engine = new SyncEngine(mockProvider, auth);
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_h3',
        action: 'DELETE',
        payload: { id: 'p_h3' },
        tenantId: 'tenantA'
      });

      const res = await engine.autoReconcileUnknownOutboxItem(item.id);
      expect(res.reconciled).toBe(true);
      expect(res.outcome).toBe('ALREADY_DELETED');

      const freshItem = await syncRepository.findById(item.id);
      expect(freshItem.status).toBe('SYNCED');
      expect(freshItem.remoteAckReceived).toBe(true);

      engine.destroy();
    });

    it('20.10: Leitura negada ou erro de rede NUNCA é classificada como ausência (RECORD_ABSENT)', () => {
      const permErr = new Error('PERMISSION_DENIED: client not authorized');
      const outcomePerm = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_h4',
        action: 'CREATE',
        localPayload: { id: 'p_h4' },
        remoteRecord: null,
        readError: permErr
      });
      expect(outcomePerm.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED);
      expect(outcomePerm.isAbsent).toBe(false);

      const netErr = new Error('Network timeout: unable to reach host');
      const outcomeNet = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_h4',
        action: 'CREATE',
        localPayload: { id: 'p_h4' },
        remoteRecord: null,
        readError: netErr
      });
      expect(outcomeNet.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE);
      expect(outcomeNet.isAbsent).toBe(false);
    });
  });

  // =========================================================================
  // GRUPO I: Integridade de ImageManifestRepository e Isolamento Multi-Tenant (FASE 14.20)
  // =========================================================================
  describe('Grupo I — Integridade de ImageManifestRepository e Isolamento Multi-Tenant (FASE 14.20)', () => {
    it('20.11: Colisão de photoId entre tenants em ImageManifestRepository.upsert é bloqueada', async () => {
      const repo = new ImageManifestRepository();

      // Tenant A grava manifesto
      await repo.create({
        photoId: 'photo_col_1',
        productId: 'prod_tenant_A',
        tenantId: 'tenantA',
        hash: 'hash_tenant_a',
        width: 800,
        height: 600
      });

      // Tenant B tenta fazer upsert com o mesmo photoId
      await expect(
        repo.upsert({
          photoId: 'photo_col_1',
          productId: 'prod_tenant_B',
          tenantId: 'tenantB',
          hash: 'hash_tenant_b'
        })
      ).rejects.toThrow('Violação de isolamento multi-tenant');

      // O registro de Tenant A no IndexedDB permanece inalterado
      const db = await getDB();
      const rawInDB = await db.get('imageManifest', 'photo_col_1');
      expect(rawInDB.tenantId).toBe('tenantA');
      expect(rawInDB.productId).toBe('prod_tenant_A');
      expect(rawInDB.hash).toBe('hash_tenant_a');
    });

    it('20.12: Colisão de photoId associado a produto diferente no mesmo tenant é bloqueada', async () => {
      const repo = new ImageManifestRepository();

      await repo.create({
        photoId: 'photo_col_prod',
        productId: 'prod_1',
        tenantId: 'tenantA',
        hash: 'hash_prod_1'
      });

      // Mesmo tenant, produto diferente com mesmo photoId
      await expect(
        repo.upsert({
          photoId: 'photo_col_prod',
          productId: 'prod_2',
          tenantId: 'tenantA',
          hash: 'hash_prod_2'
        })
      ).rejects.toThrow('Conflito de integridade');
    });

    it('20.13: Chamadas concorrentes de upsert para o mesmo manifesto preservam integridade e metadados', async () => {
      const repo = new ImageManifestRepository();

      const [res1, res2] = await Promise.all([
        repo.upsert({
          photoId: 'photo_concurrent_1',
          productId: 'prod_conc',
          tenantId: 'tenantA',
          hash: 'hash_initial',
          width: 800
        }),
        repo.upsert({
          photoId: 'photo_concurrent_1',
          productId: 'prod_conc',
          tenantId: 'tenantA',
          hash: 'hash_initial',
          width: 800
        })
      ]);

      expect(res1.photoId).toBe('photo_concurrent_1');
      expect(res2.photoId).toBe('photo_concurrent_1');

      const saved = await repo.findByPhotoId('photo_concurrent_1', { tenantId: 'tenantA' });
      expect(saved).not.toBeNull();
      expect(saved.productId).toBe('prod_conc');
      expect(saved.tenantId).toBe('tenantA');
    });

    it('20.14: LocalImageCache.put com colisão de photoId entre tenants é bloqueado e não sobrescreve binários', async () => {
      const cache = new LocalImageCache();
      const blobA = new Blob(['imagem_tenant_a_bytes'], { type: 'image/webp' });
      const blobB = new Blob(['imagem_tenant_b_bytes'], { type: 'image/webp' });

      // Tenant A grava no cache
      await cache.put({
        photoId: 'photo_cache_iso',
        productId: 'prod_A',
        tenantId: 'tenantA',
        blob: blobA
      });

      // Tenant B tenta gravar com o mesmo photoId
      await expect(
        cache.put({
          photoId: 'photo_cache_iso',
          productId: 'prod_B',
          tenantId: 'tenantB',
          blob: blobB
        })
      ).rejects.toThrow('Violação de isolamento multi-tenant');

      // O registro em cache continua pertencendo intacto a Tenant A
      const metaA = await cache.getMetadata('photo_cache_iso', { tenantId: 'tenantA' });
      expect(metaA).not.toBeNull();
      expect(metaA.tenantId).toBe('tenantA');

      const metaB = await cache.getMetadata('photo_cache_iso', { tenantId: 'tenantB' });
      expect(metaB).toBeNull();
    });
  });

  // =========================================================================
  // GRUPO J: Ciclo de Vida e Isolamento de Múltiplas Instâncias de AuthService e EventBus (FASE 14.20)
  // =========================================================================
  describe('Grupo J — Ciclo de Vida e Isolamento de Múltiplas Instâncias de AuthService e EventBus (FASE 14.20)', () => {
    it('20.15: Duas instâncias independentes de AuthService: destroy() em B não afeta sessão de A', () => {
      const authA = new AuthService();
      const authB = new AuthService();

      authA.currentSession = { uid: 'uA', tenantId: 'tenantA', role: 'admin', authenticated: true };
      authA.state = 'AUTHENTICATED';

      authB.currentSession = { uid: 'uB', tenantId: 'tenantB', role: 'operator', authenticated: true };
      authB.state = 'AUTHENTICATED';

      let listenerACalled = false;
      authA.onAuthStateChanged(() => { listenerACalled = true; });

      // B é destruído / encerrado
      authB.destroy();

      expect(authB.currentSession).toBeNull();
      expect(authB.state).toBe('UNAUTHENTICATED');

      // A permanece 100% autônomo e autenticado
      expect(authA.getTenantId()).toBe('tenantA');
      expect(authA.isAuthenticated()).toBe(true);
      expect(listenerACalled).toBe(true);
    });

    it('20.16: Eventos recebidos via BroadcastChannel não são considerados confirmação de gravação remota', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_bc_event',
        action: 'CREATE',
        payload: { id: 'p_bc_event', name: 'Item Evento', salePriceCents: 5000 },
        tenantId: 'tenantA'
      });

      // Dispara evento via EventBus como se outra aba tivesse emitido
      eventBus.emit(EVENTS.PRODUCT_UPDATED, { id: 'p_bc_event', origin: 'remote' });

      // O item na Outbox permanece PENDING e NÃO SYNCED
      const itemInDB = await syncRepository.findById(item.id, { allowCrossTenant: true });
      expect(itemInDB.status).toBe('PENDING');
      expect(itemInDB.remoteAckReceived).toBe(false);
    });
  });

  // =========================================================================
  // GRUPO K: SEGURANÇA DE ACKS ATRASADOS E TENTATIVAS SUPERADAS (FASE 14.21 - SEÇÃO 4)
  // =========================================================================
  describe('Grupo K: Segurança de ACKs Atrasados e Tentativas Superadas (Fase 14.21)', () => {
    it('21.1: ACK atrasado de tentativa superada NÃO sobrescreve bloqueio de conflito (FAILED + requiresResolution) estabelecido pela tentativa atual', async () => {
      // 1. Instância A reserva item com attempt-A
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_late_ack_1',
        action: 'UPDATE',
        payload: { id: 'prod_late_ack_1', name: 'Original', salePriceCents: 1000, version: 2, baseVersion: 1 },
        tenantId: 'tenant-test'
      });

      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance-A', { leaseDurationMs: 10 });
      expect(claimedA).not.toBeNull();
      const attemptA = claimedA.claimAttemptId;
      await syncRepository.recordDispatchStarted(item.id, attemptA);

      // 2. Simula expiração do lease e Instância B assume com attempt-B
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance-B', { isRecovery: true, leaseDurationMs: 30000 });
      expect(claimedB).not.toBeNull();
      const attemptB = claimedB.claimAttemptId;
      expect(attemptB).not.toBe(attemptA);

      // 3. Instância B identifica conflito de versão e marca FAILED com requiresResolution: true
      await syncRepository.markFailed(
        item.id,
        'Conflito detectado: versão remota divergiu da esperada',
        5,
        true,
        { errorCategory: 'version_conflict', requiresResolution: true },
        attemptB
      );

      const stateAfterB = await syncRepository.findTechnicalRecord(item.id);
      expect(stateAfterB.status).toBe('FAILED');
      expect(stateAfterB.requiresResolution).toBe(true);

      // 4. Resposta remota tardia da tentativa A chega
      const ackLateA = await syncRepository.recordRemoteAck(item.id, attemptA, { success: true, remoteVersion: 2 });
      expect(ackLateA.superseded).toBe(true);

      // 5. Verifica que o ACK de A foi registrado em staleAttemptAcks e NÃO sobrescreveu o bloqueio de B
      const finalState = await syncRepository.findTechnicalRecord(item.id);
      expect(finalState.status).toBe('FAILED');
      expect(finalState.requiresResolution).toBe(true);
      expect(finalState.staleAttemptAcks).toBeDefined();
      expect(finalState.staleAttemptAcks.length).toBe(1);
      expect(finalState.staleAttemptAcks[0].attemptId).toBe(attemptA);
      expect(finalState.staleAttemptAcks[0].success).toBe(true);
    });

    it('21.2: Tentativa antiga superada tentando chamar markSynced diretamente é rejeitada e preserva o estado da tentativa atual', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_stale_mark_synced',
        action: 'UPDATE',
        payload: { id: 'prod_stale_mark_synced', name: 'Produto', salePriceCents: 2000, version: 2 },
        tenantId: 'tenant-test'
      });

      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance-A', { leaseDurationMs: 10 });
      const attemptA = claimedA.claimAttemptId;

      // Instância B assume a concessão
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance-B', { isRecovery: true });
      const attemptB = claimedB.claimAttemptId;

      // Tentativa A atrasada tenta marcar como sincronizado
      const markRes = await syncRepository.markSynced(item.id, { remoteVersion: 2 }, attemptA);
      expect(markRes.success).toBe(false);
      expect(markRes.superseded).toBe(true);

      const currentState = await syncRepository.findTechnicalRecord(item.id);
      expect(currentState.status).toBe('SYNCING');
      expect(currentState.claimAttemptId).toBe(attemptB);
      expect(currentState.staleAttemptAcks.some(a => a.attemptId === attemptA)).toBe(true);
    });

    it('21.3: ACK atrasado não desbloqueia operação quando B identificou payload divergente ou falta de permissão', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_div_ack',
        action: 'UPDATE',
        payload: { id: 'prod_div_ack', name: 'Item', salePriceCents: 3000 },
        tenantId: 'tenant-test'
      });

      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance-A', { leaseDurationMs: 10 });
      const attemptA = claimedA.claimAttemptId;

      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance-B', { isRecovery: true });
      const attemptB = claimedB.claimAttemptId;

      // B bloqueia por falta de autorização
      await syncRepository.markFailed(item.id, 'PERMISSION_DENIED', 5, true, { errorCategory: 'security', requiresResolution: true }, attemptB);

      // Resposta tardia de A chega com sucesso
      await syncRepository.recordRemoteAck(item.id, attemptA, { success: true });

      const finalState = await syncRepository.findTechnicalRecord(item.id);
      expect(finalState.status).toBe('FAILED');
      expect(finalState.requiresResolution).toBe(true);
      expect(finalState.errorCategory).toBe('security');
    });

    it('21.4: ACK atrasado de tentativa superada enquanto B ainda não transmitiu a mutação não contamina lease de B', async () => {
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_b_pending_tx',
        action: 'CREATE',
        payload: { id: 'prod_b_pending_tx', name: 'Item Novo', salePriceCents: 4000 },
        tenantId: 'tenant-test'
      });

      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance-A', { leaseDurationMs: 10 });
      const attemptA = claimedA.claimAttemptId;

      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance-B', { isRecovery: true });
      const attemptB = claimedB.claimAttemptId;
      expect(claimedB.dispatchStarted).toBe(false);

      // Resposta tardia de A chega
      const ackLateA = await syncRepository.recordRemoteAck(item.id, attemptA, { success: true });
      expect(ackLateA.superseded).toBe(true);

      // O lease de B permanece intacto com status SYNCING e attemptB
      const stateDuringB = await syncRepository.findTechnicalRecord(item.id);
      expect(stateDuringB.claimAttemptId).toBe(attemptB);
      expect(stateDuringB.status).toBe('SYNCING');
      expect(stateDuringB.dispatchStarted).toBe(false);
    });
  });

  // =========================================================================
  // GRUPO L: ISOLAMENTO MULTI-TENANT E IMUTABILIDADE DA OUTBOX (FASE 14.21 - SEÇÃO 5)
  // =========================================================================
  describe('Grupo L: Isolamento Multi-Tenant do SyncRepository e Imutabilidade (Fase 14.21)', () => {
    it('21.5: findById respeita o tenant da sessão ativa e retorna null para operação de outro tenant', async () => {
      const itemTenantA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_iso_a',
        action: 'CREATE',
        payload: { id: 'prod_iso_a', name: 'Item A', salePriceCents: 1000 },
        tenantId: 'tenant-A'
      });

      // Sessão ativa em tenant-A: encontra normalmente
      setTenantResolver(() => 'tenant-A');
      const foundInA = await syncRepository.findById(itemTenantA.id);
      expect(foundInA).not.toBeNull();
      expect(foundInA.id).toBe(itemTenantA.id);

      // Sessão ativa em tenant-B: isolamento impede leitura e retorna null
      setTenantResolver(() => 'tenant-B');
      const foundInB = await syncRepository.findById(itemTenantA.id);
      expect(foundInB).toBeNull();

      // Consulta técnica explícita para recuperação interna (bypass) encontra o registro
      const foundTech = await syncRepository.findById(itemTenantA.id, { allowCrossTenant: true });
      expect(foundTech).not.toBeNull();
      expect(foundTech.tenantId).toBe('tenant-A');
    });

    it('21.6: update rejeita tentativa de alterar payload comercial de outro tenant', async () => {
      const itemTenantA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_iso_payload',
        action: 'CREATE',
        payload: { id: 'prod_iso_payload', name: 'Item Original', salePriceCents: 1000 },
        tenantId: 'tenant-A'
      });

      // Sessão ativa do tenant-B tenta alterar o payload do item do tenant-A
      setTenantResolver(() => 'tenant-B');
      const maliciousData = {
        ...itemTenantA,
        payload: { id: 'prod_iso_payload', name: 'Item Adulterado por B', salePriceCents: 9999 }
      };

      await expect(syncRepository.update(maliciousData)).rejects.toThrow('Violação de isolamento multi-tenant');

      // Tentativa técnica com isTechnicalUpdate: true também proíbe alterar o payload comercial
      await expect(syncRepository.update(maliciousData, { isTechnicalUpdate: true })).rejects.toThrow('não pode alterar o payload comercial');
    });

    it('21.7: update rejeita estritamente qualquer alteração de tenantId, operationId, entityType ou entityId', async () => {
      setTenantResolver(() => 'tenant-A');
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_immut_test',
        action: 'CREATE',
        payload: { id: 'prod_immut_test', name: 'Item', salePriceCents: 1000 },
        tenantId: 'tenant-A'
      });

      // 1. Alteração de tenantId
      await expect(syncRepository.update({ ...item, tenantId: 'tenant-HACKED' })).rejects.toThrow('alteração de tenantId em item da Outbox é estritamente proibida');

      // 2. Alteração de operationId
      await expect(syncRepository.update({ ...item, operationId: 'op_hacked' })).rejects.toThrow('alteração de operationId em item da Outbox é estritamente proibida');

      // 3. Alteração de entityType
      await expect(syncRepository.update({ ...item, entityType: 'sales' })).rejects.toThrow('alteração de entityType em item da Outbox é estritamente proibida');

      // 4. Alteração de entityId
      await expect(syncRepository.update({ ...item, entityId: 'prod_different' })).rejects.toThrow('alteração de entityId em item da Outbox é estritamente proibida');
    });

    it('21.8: Troca de sessão preserva operação do tenant original e permite retomada quando tenant original retorna', async () => {
      // 1. Tenant A cria operação
      setTenantResolver(() => 'tenant-A');
      const itemA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_switch_resume',
        action: 'CREATE',
        payload: { id: 'prod_switch_resume', name: 'Item A', salePriceCents: 5000 },
        tenantId: 'tenant-A'
      });

      // 2. Sessão muda para Tenant B
      setTenantResolver(() => 'tenant-B');
      const pendingB = await syncRepository.getPending();
      expect(pendingB.some(p => p.id === itemA.id)).toBe(false);

      // 3. Sessão retorna para Tenant A
      setTenantResolver(() => 'tenant-A');
      const pendingA = await syncRepository.getPending();
      const resumedItem = pendingA.find(p => p.id === itemA.id);
      expect(resumedItem).toBeDefined();
      expect(resumedItem.tenantId).toBe('tenant-A');
      expect(resumedItem.status).toBe('PENDING');
    });
  });

  // =========================================================================
  // GRUPO M: MATRIZ DE RECONCILIAÇÃO POR ENTIDADE E AÇÃO (FASE 14.21 - SEÇÃO 6)
  // =========================================================================
  describe('Grupo M: Matriz Canônica de Reconciliação por Entidade e Ação (Fase 14.21)', () => {
    it('21.9: Falhas de leitura remota (PERMISSION_DENIED, INACCESSIBLE, timeout) NUNCA são classificadas como ausência', () => {
      // 1. PERMISSION_DENIED
      const permErr = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p1',
        action: 'CREATE',
        localPayload: { name: 'Item' },
        readError: { code: 'PERMISSION_DENIED', message: 'Permission denied' }
      });
      expect(permErr.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED);
      expect(permErr.isAbsent).toBe(false);
      expect(permErr.requiresResolution).toBe(true);

      // 2. INACCESSIBLE / Timeout
      const netErr = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p1',
        action: 'CREATE',
        localPayload: { name: 'Item' },
        readError: { message: 'Network timeout after 10000ms' }
      });
      expect(netErr.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE);
      expect(netErr.isAbsent).toBe(false);
      expect(netErr.requiresResolution).toBe(true);
    });

    it('21.10: Reconciliação de registro com tenant divergente é classificada como RECORD_DIVERGENT com bloqueio', () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_div_tenant',
        action: 'UPDATE',
        localPayload: { id: 'p_div_tenant', name: 'Item', tenantId: 'tenant-A' },
        remoteRecord: { id: 'p_div_tenant', name: 'Item', tenantId: 'tenant-B' }
      });
      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(outcome.isAbsent).toBe(false);
      expect(outcome.requiresResolution).toBe(true);
      expect(outcome.divergentFields.some(d => d.field === 'tenantId')).toBe(true);
      expect(outcome.reason).toContain('Violação multi-tenant');
    });

    it('21.11: Ausência confirmada (null) em UPDATE de produto resulta em UPDATE_ON_ABSENT_RECORD e bloqueia', () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_absent_update',
        action: 'UPDATE',
        localPayload: { id: 'p_absent_update', name: 'Item', version: 2 },
        remoteRecord: null
      });
      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.UPDATE_ON_ABSENT_RECORD);
      expect(outcome.isAbsent).toBe(true);
      expect(outcome.requiresResolution).toBe(true);
    });

    it('21.12: Ausência confirmada (null) em DELETE resulta em ALREADY_DELETED e conclui sem erro', () => {
      const outcome = classifyRemoteOutcome({
        entityType: 'products',
        entityId: 'p_absent_del',
        action: 'DELETE',
        localPayload: { id: 'p_absent_del' },
        remoteRecord: null
      });
      expect(outcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED);
      expect(outcome.isAbsent).toBe(true);
      expect(outcome.requiresResolution).toBe(false);
      expect(outcome.isEquivalent).toBe(true);
    });

    it('21.13: Ledger append-only com registro remoto equivalente conclui sem duplicar; divergente bloqueia colisão', () => {
      const ledgerPayload = {
        id: 'mov_ledger_1',
        productId: 'prod_1',
        quantity: 10,
        delta: 10,
        type: 'IN',
        tenantId: 'tenant-test'
      };

      // Equivalente
      const eqOutcome = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: 'mov_ledger_1',
        action: 'CREATE',
        localPayload: ledgerPayload,
        remoteRecord: { ...ledgerPayload, _serverTimestamp: 12345 }
      });
      expect(eqOutcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT);
      expect(eqOutcome.isEquivalent).toBe(true);

      // Divergente (mesmo ID mas quantidade diferente)
      const divOutcome = classifyRemoteOutcome({
        entityType: 'stockMovements',
        entityId: 'mov_ledger_1',
        action: 'CREATE',
        localPayload: ledgerPayload,
        remoteRecord: { ...ledgerPayload, quantity: 20, delta: 20 }
      });
      expect(divOutcome.outcome).toBe(REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT);
      expect(divOutcome.isEquivalent).toBe(false);
    });
  });

  // =========================================================================
  // GRUPO N: AUDITORIA DE IMAGEMANIFEST E LOCALIMAGECACHE (FASE 14.21 - SEÇÃO 7)
  // =========================================================================
  describe('Grupo N: Integridade e Isolamento de Manifestos e Cache de Imagens (Fase 14.21)', () => {
    it('21.14: saveAll com uma entrada válida e outra de outro tenant faz rollback total de todas as entradas', async () => {
      setTenantResolver(() => 'tenant-A');
      const manifestRepo = new ImageManifestRepository();

      // Entrada 1 prévia pertence a tenant-B
      await manifestRepo.create({
        photoId: 'photo_existing_b',
        productId: 'prod_b',
        tenantId: 'tenant-B',
        version: 1
      });

      // Lote com entrada válida para tenant-A e colisão com tenant-B
      const batch = [
        { photoId: 'photo_new_a1', productId: 'prod_a1', tenantId: 'tenant-A' },
        { photoId: 'photo_existing_b', productId: 'prod_b', tenantId: 'tenant-A' } // Invasão de photoId do tenant-B
      ];

      await expect(manifestRepo.saveAll(batch)).rejects.toThrow('Violação de isolamento multi-tenant');

      // Verifica rollback atômico: photo_new_a1 NÃO foi gravada no IndexedDB!
      const checkA1 = await manifestRepo.findByPhotoId('photo_new_a1', { tenantId: 'tenant-A' });
      expect(checkA1).toBeNull();

      // Registro do tenant-B permanece intacto
      const checkB = await manifestRepo.findByPhotoId('photo_existing_b', { tenantId: 'tenant-B' });
      expect(checkB).not.toBeNull();
      expect(checkB.tenantId).toBe('tenant-B');
    });

    it('21.15: LocalImageCache.getMetadata com tenant divergente retorna null garantindo isolamento', async () => {
      const cache = new LocalImageCache();
      const manifestRepo = new ImageManifestRepository();

      await manifestRepo.create({
        photoId: 'photo_secret_a',
        productId: 'prod_secret',
        tenantId: 'tenant-A',
        version: 1,
        hash: 'abc123hash',
        sizeBytes: 1024,
        mimeType: 'image/webp'
      });

      // Consulta no tenant correto
      const metaA = await cache.getMetadata('photo_secret_a', { tenantId: 'tenant-A' });
      expect(metaA).not.toBeNull();
      expect(metaA.photoId).toBe('photo_secret_a');

      // Consulta em tenant divergente: isolamento estrito retorna null
      const metaB = await cache.getMetadata('photo_secret_a', { tenantId: 'tenant-B' });
      expect(metaB).toBeNull();
    });

    it('21.16: LocalImageCache.put com colisão multi-tenant em productImages ou imageManifest aborta atomicamente', async () => {
      const cache = new LocalImageCache();
      const manifestRepo = new ImageManifestRepository();

      // Cria manifesto prévio para tenant-A
      await manifestRepo.create({
        photoId: 'photo_shared_collision',
        productId: 'prod_orig',
        tenantId: 'tenant-A',
        version: 1
      });

      // Tenant-B tenta executar put() no cache com o mesmo photoId
      const blob = new Blob(['imagem de teste'], { type: 'image/webp' });
      await expect(cache.put({
        photoId: 'photo_shared_collision',
        productId: 'prod_orig',
        tenantId: 'tenant-B',
        blob
      })).rejects.toThrow('Violação de isolamento multi-tenant');

      // Verifica que tenant-B não gravou dados em productImages
      const db = await getDB();
      const rawImg = await db.get('productImages', 'photo_shared_collision');
      expect(rawImg).toBeUndefined();
    });
  });

  // =========================================================================
  // GRUPO O: Conflito após ACK Atrasado e Recuperação por 3ª Instância (Fase 14.22 - Seção 4)
  // =========================================================================
  describe('Grupo O: Conflito após ACK Atrasado e Recuperação por 3ª Instância (Fase 14.22)', () => {
    it('22.1: Cenário obrigatório: conflito após ACK atrasado + interrupção + 3ª instância preserva FAILED e requiresResolution', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_ack_conflict_crash',
        action: 'UPDATE',
        payload: { id: 'prod_ack_conflict_crash', name: 'Versão 2 Desejada', salePriceCents: 6000, version: 2, baseVersion: 1 },
        tenantId: 'tenant-matriz'
      });

      // 1. Instância A adquire titularidade
      const claimedA = await syncRepository.claimForDispatch(item.id, 'instance-A', { leaseDurationMs: 50 });
      expect(claimedA).toBeDefined();
      const attemptA = claimedA.claimAttemptId;

      // 2. Prazo de concessão de A expira
      await new Promise(r => setTimeout(r, 60));

      // 3. Instância B assume com attempt-B e detecta divergência com servidor remoto
      const claimedB = await syncRepository.claimForDispatch(item.id, 'instance-B', {
        leaseDurationMs: 15000,
        now: Date.now() + 100
      });
      expect(claimedB).toBeDefined();
      expect(claimedB.claimAttemptId).not.toBe(attemptA);
      const attemptB = claimedB.claimAttemptId;

      // Instância B marca FAILED com requiresResolution: true
      await syncRepository.markFailed(
        item.id,
        'Conflito detectado por B: payload divergente no servidor',
        5,
        true,
        { errorCategory: 'payload_divergence_conflict', requiresResolution: true },
        attemptB
      );

      const stateB = await syncRepository.findById(item.id);
      expect(stateB.status).toBe('FAILED');
      expect(stateB.requiresResolution).toBe(true);

      // 4. A resposta atrasada de A chega agora
      const ackResultA = await syncRepository.recordRemoteAck(item.id, attemptA, {
        success: true,
        remoteVersion: 2
      });
      expect(ackResultA.superseded).toBe(true);
      expect(ackResultA.recorded).toBe(true);

      // Estado durável após ACK de A: permanece FAILED e bloqueado
      const stateAfterLateAck = await syncRepository.findById(item.id);
      expect(stateAfterLateAck.status).toBe('FAILED');
      expect(stateAfterLateAck.requiresResolution).toBe(true);
      expect(stateAfterLateAck.remoteAckReceived).toBe(true);
      expect(stateAfterLateAck.staleAttemptAcks).toHaveLength(1);

      // 5. O processo é interrompido novamente (queda/crash) antes de finalizar
      // 6. Terceira instância inicia recuperação do mesmo banco persistente
      const engine3 = new SyncEngine();
      engine3.id = 'instance-C-crash-recovery';
      await engine3.recoverInterruptedInFlight({ force: true });

      // Comprova que a 3ª instância NÃO transicionou o item bloqueado para SYNCED
      const stateAfterInst3 = await syncRepository.findById(item.id);
      expect(stateAfterInst3.status).toBe('FAILED');
      expect(stateAfterInst3.requiresResolution).toBe(true);
      expect(stateAfterInst3.remoteAckReceived).toBe(true);
      expect(stateAfterInst3.staleAttemptAcks).toHaveLength(1);
    });

    it('22.2: ACK de operação realmente aplicada remotamente mas perdida localmente conclui como SYNCED via reconciliação sem duplicação', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const auth = createControllableAuth(createTestSession('user_matriz', 'tenant-matriz', 'admin'));
      const mockProvider = new MockRealtimeProvider();
      mockProvider.setTenantId('tenant-matriz');

      const prodPayload = {
        id: 'prod_ack_really_applied',
        name: 'Item Confirmado',
        salePriceCents: 4500,
        version: 1,
        updatedAt: new Date().toISOString()
      };
      // Simula que o backend remoto recebeu e persistiu com sucesso
      await mockProvider.create('products', prodPayload.id, prodPayload);

      // Localmente o item ficou pendente com resultado remoto desconhecido
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_ack_really_applied',
        action: 'CREATE',
        payload: prodPayload,
        tenantId: 'tenant-matriz'
      });
      await syncRepository.update({
        ...item,
        dispatchStarted: true,
        remoteOutcomeUnknown: true
      }, { isTechnicalUpdate: true });

      let pushCalls = 0;
      const origPush = mockProvider.pushChange.bind(mockProvider);
      mockProvider.pushChange = async (...args) => {
        pushCalls++;
        return origPush(...args);
      };

      const engine = new SyncEngine(mockProvider, auth);
      await engine.processQueue();

      // Finalizou como SYNCED via reconciliação
      const finalItem = await syncRepository.findById(item.id);
      expect(finalItem.status).toBe('SYNCED');
      expect(finalItem.remoteAckReceived).toBe(true);
      // Zero chamadas duplicadas de envio remoto
      expect(pushCalls).toBe(0);
    });
  });

  // =========================================================================
  // GRUPO P: Invariantes do Ledger Append-Only sob Falhas e Ausência (Fase 14.22 - Seção 5)
  // =========================================================================
  describe('Grupo P: Invariantes do Ledger Append-Only sob Falhas e Ausência (Fase 14.22)', () => {
    it('22.3: processQueue repetido com Timeout no ledger append-only adia a leitura com backoff, nunca reenvia e só despacha após ausência comprovada', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const auth = createControllableAuth(createTestSession('user_matriz', 'tenant-matriz', 'admin'));
      const mockProvider = new MockRealtimeProvider();
      mockProvider.setTenantId('tenant-matriz');

      const movPayload = {
        id: 'mov_timeout_test',
        productId: 'prod_ledger',
        quantity: 15,
        delta: 15,
        type: 'IN',
        tenantId: 'tenant-matriz'
      };

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_timeout_test',
        action: 'CREATE',
        payload: movPayload,
        tenantId: 'tenant-matriz'
      });
      await syncRepository.update({
        ...item,
        status: 'PENDING',
        dispatchStarted: true,
        remoteOutcomeUnknown: true,
        remoteAckReceived: false
      }, { isTechnicalUpdate: true });

      let dispatchCalls = 0;
      mockProvider.create = async () => {
        dispatchCalls++;
        return { success: true };
      };
      // Força timeout na consulta remota
      mockProvider.get = async () => {
        throw new Error('ETIMEDOUT: Connection timed out after 10000ms');
      };

      const engine = new SyncEngine(mockProvider, auth);
      let clock = Date.now();
      engine._now = () => clock;
      await engine.processQueue();

      // FASE 14.23: timeout de LEITURA adia a reconciliação com backoff; não é ausência e não reenvia a escrita
      const state1 = await syncRepository.findById(item.id);
      expect(state1.status).toBe('PENDING');
      expect(state1.requiresResolution).toBe(false);
      expect(state1.remoteOutcomeUnknown).toBe(true);
      expect(state1.errorCategory).toBe('unknown_remote_outcome');
      expect(state1.reconcileAttempts).toBe(1);
      expect(dispatchCalls).toBe(0);

      // Reinicialização imediata: dentro da janela de backoff nem a leitura é repetida
      const engineRestarted = new SyncEngine(mockProvider, auth);
      engineRestarted._now = () => clock;
      await engineRestarted.processQueue();
      const state2 = await syncRepository.findById(item.id);
      expect(state2.reconcileAttempts).toBe(1);
      expect(state2.status).toBe('PENDING');
      expect(dispatchCalls).toBe(0);

      // Após o backoff, novo timeout: segunda tentativa de LEITURA, ainda sem escrita
      clock += 120000;
      await engineRestarted.processQueue();
      const state3 = await syncRepository.findById(item.id);
      expect(state3.reconcileAttempts).toBe(2);
      expect(state3.status).toBe('PENDING');
      expect(state3.remoteOutcomeUnknown).toBe(true);
      expect(dispatchCalls).toBe(0);

      // Leitura autorizada passa a retornar null: ausência comprovada autoriza o despacho do CREATE
      delete mockProvider.get; // volta a leitura real do provider (autorizada; retorna null pois nada foi gravado)
      clock += 120000;
      await engineRestarted.processQueue();
      expect(mockProvider.pushedChanges.length).toBe(1);
      const finalRemote = await mockProvider.get('stockMovements', 'mov_timeout_test');
      expect(finalRemote).not.toBeNull();
      expect(finalRemote.delta).toBe(15);
      const finalItem = await syncRepository.findById(item.id);
      expect(finalItem.status).toBe('SYNCED');
    });

    it('22.4: Leitura remota negada (PERMISSION_DENIED) no ledger bloqueia sem classificar como ausência', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const auth = createControllableAuth(createTestSession('user_matriz', 'tenant-matriz', 'admin'));
      const mockProvider = new MockRealtimeProvider();
      mockProvider.setTenantId('tenant-matriz');

      const movPayload = {
        id: 'mov_perm_test',
        productId: 'prod_ledger',
        quantity: 5,
        delta: -5,
        type: 'OUT',
        tenantId: 'tenant-matriz'
      };

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_perm_test',
        action: 'CREATE',
        payload: movPayload,
        tenantId: 'tenant-matriz'
      });
      await syncRepository.update({
        ...item,
        status: 'PENDING',
        dispatchStarted: true,
        remoteOutcomeUnknown: true,
        remoteAckReceived: false
      }, { isTechnicalUpdate: true });

      let dispatchCalls = 0;
      mockProvider.create = async () => {
        dispatchCalls++;
        return { success: true };
      };
      mockProvider.get = async () => {
        const err = new Error('PERMISSION_DENIED: User not allowed to read /inventory');
        err.code = 'PERMISSION_DENIED';
        throw err;
      };

      const engine = new SyncEngine(mockProvider, auth);
      await engine.processQueue();

      const finalState = await syncRepository.findById(item.id);
      expect(finalState.status).toBe('FAILED');
      expect(finalState.requiresResolution).toBe(true);
      expect(finalState.errorCategory).toBe('security');
      expect(dispatchCalls).toBe(0);
    });

    it('22.5: Leitura autorizada confirmando ausência (RECORD_ABSENT) no ledger prossegue para despacho único', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const auth = createControllableAuth(createTestSession('user_matriz', 'tenant-matriz', 'admin'));
      const mockProvider = new MockRealtimeProvider();
      mockProvider.setTenantId('tenant-matriz');

      const movPayload = {
        id: 'mov_absent_clean_dispatch',
        productId: 'prod_ledger',
        quantity: 8,
        delta: 8,
        type: 'IN',
        tenantId: 'tenant-matriz'
      };

      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_absent_clean_dispatch',
        action: 'CREATE',
        payload: movPayload,
        tenantId: 'tenant-matriz'
      });
      await syncRepository.update({
        ...item,
        status: 'PENDING',
        dispatchStarted: true,
        remoteOutcomeUnknown: true,
        remoteAckReceived: false
      }, { isTechnicalUpdate: true });

      let pushCalls = 0;
      const origPush = mockProvider.pushChange.bind(mockProvider);
      mockProvider.pushChange = async (...args) => {
        pushCalls++;
        return origPush(...args);
      };
      // Leitura autorizada confirmando ausência do nó remoto
      mockProvider.get = async () => null;

      const engine = new SyncEngine(mockProvider, auth);
      await engine.processQueue();

      const finalState = await syncRepository.findById(item.id);
      expect(finalState.status).toBe('SYNCED');
      expect(pushCalls).toBe(1);
    });
  });

  // =========================================================================
  // GRUPO Q: Isolamento de Troca de Sessão e Imutabilidade Técnica (Fase 14.22 - Seção 6)
  // =========================================================================
  describe('Grupo Q: Isolamento de Troca de Sessão e Imutabilidade Técnica (Fase 14.22)', () => {
    it('22.6: Troca completa de sessão Tenant A -> B -> A com ACK atrasado: dados de A permanecem imutáveis para B e retomam para A', async () => {
      // 1. Tenant A cria operação e entra em voo
      setTenantResolver(() => 'tenant-A');
      const itemA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_tenant_switch_full',
        action: 'CREATE',
        payload: { id: 'prod_tenant_switch_full', name: 'Item Tenant A', salePriceCents: 9000, tenantId: 'tenant-A' },
        tenantId: 'tenant-A'
      });
      const claimedA = await syncRepository.claimForDispatch(itemA.id, 'instance-A', { leaseDurationMs: 30000 });
      expect(claimedA).toBeDefined();

      // 2. Contexto ativo muda para Tenant B
      setTenantResolver(() => 'tenant-B');
      const pendingB = await syncRepository.getPending();
      expect(pendingB.some(p => p.id === itemA.id)).toBe(false);

      // Tentativa de consulta direta em B sem bypass retorna null
      const directGetB = await syncRepository.findById(itemA.id);
      expect(directGetB).toBeNull();

      // Tentativa de B alterar payload comercial de A é rejeitada
      await expect(syncRepository.update({
        ...claimedA,
        payload: { id: 'prod_tenant_switch_full', name: 'Invasão Tenant B', salePriceCents: 100 }
      })).rejects.toThrow('Violação de isolamento multi-tenant');

      // 3. ACK tardio de A chega via recordRemoteAck
      const ackResult = await syncRepository.recordRemoteAck(itemA.id, claimedA.claimAttemptId, {
        success: true,
        remoteVersion: 1
      });
      expect(ackResult.recorded).toBe(true);

      // 4. Motor de sincronização sob Tenant B tenta processar fila
      const mockProviderB = new MockRealtimeProvider();
      const engineB = new SyncEngine(mockProviderB);
      await engineB.processQueue();

      // Operação de A permanece intacta e pertencente a A
      const stateUnderB = await syncRepository.findTechnicalRecord(itemA.id);
      expect(stateUnderB.tenantId).toBe('tenant-A');
      expect(stateUnderB.payload.name).toBe('Item Tenant A');

      // 5. Sessão de B termina e Tenant A é restaurado
      setTenantResolver(() => 'tenant-A');
      const stateUnderA = await syncRepository.findById(itemA.id);
      expect(stateUnderA).toBeDefined();
      expect(stateUnderA.tenantId).toBe('tenant-A');
      expect(stateUnderA.status).toBe('SYNCED');
    });

    it('22.7: update rejeita estritamente alteração de canonicalPayloadHash preservando integridade criptográfica', async () => {
      setTenantResolver(() => 'tenant-matriz');
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_hash_immutability',
        action: 'CREATE',
        payload: { id: 'prod_hash_immutability', name: 'Original', salePriceCents: 2000 },
        tenantId: 'tenant-matriz'
      });

      expect(item.canonicalPayloadHash).toBeDefined();
      const originalHash = item.canonicalPayloadHash;

      await expect(syncRepository.update({
        ...item,
        canonicalPayloadHash: 'can_sha256_fake_tampered_hash_000000000000000000000000000000000000'
      })).rejects.toThrow('Violação de integridade: alteração de canonicalPayloadHash');

      const verified = await syncRepository.findById(item.id);
      expect(verified.canonicalPayloadHash).toBe(originalHash);
    });
  });
});


