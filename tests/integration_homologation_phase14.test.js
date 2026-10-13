import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get, update, remove } from 'firebase/database';
import { getDB } from '../src/js/db/connection.js';
import { authService } from '../src/js/services/AuthService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { StockService } from '../src/js/services/StockService.js';
import { SaleService } from '../src/js/services/SaleService.js';
import { PurchaseService } from '../src/js/services/PurchaseService.js';
import { SupplierService } from '../src/js/services/SupplierService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { FirebaseRealtimeProvider } from '../src/js/sync/FirebaseRealtimeProvider.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { setTenantResolver } from '../src/js/repositories/BaseRepository.js';
import { eventBus } from '../src/js/eventBus.js';

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-integration-phase14';

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
    throw new Error(`Emulator JAR não encontrado em ${jarPath}`);
  }
  spawnedProcess = spawn('java', ['-jar', jarPath, '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    detached: false
  });
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    if (await isEmulatorRunning(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Falha ao iniciar Realtime Database Emulator em 15 segundos');
}

function createTestSession(uid, tenantId, role, appRole) {
  return {
    uid,
    tenantId,
    role,
    appRole,
    canonicalClaims: true,
    requiresMigration: false,
    authenticated: true
  };
}

function createControllableAuth(initialSession) {
  let session = initialSession;
  const listeners = new Set();
  return {
    isConfigured: () => true,
    getCurrentSession: () => session,
    getTenantId: () => session?.tenantId || null,
    setSession: (s) => {
      session = s;
      listeners.forEach(cb => { try { cb(session); } catch (_) {} });
    },
    onAuthStateChanged: (cb) => {
      listeners.add(cb);
      if (session) cb(session);
      return () => listeners.delete(cb);
    },
    getIdToken: async () => session ? `mock-token-${session.appRole}` : null
  };
}

describe('FASE 14.16 — Integração Ponta a Ponta, Compatibilidade do Aplicativo e Homologação Local', () => {
  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    const rulesPath = join(process.cwd(), 'database.rules.json');
    const rulesContent = readFileSync(rulesPath, 'utf-8');

    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: {
        host: '127.0.0.1',
        port: EMULATOR_PORT,
        rules: rulesContent
      }
    });
  });

  afterEach(async () => {
    setTenantResolver(() => authService.getTenantId());
    authService.setProvider(null);
  });

  afterAll(async () => {
    setTenantResolver(() => authService.getTenantId());
    authService.setProvider(null);
    if (testEnv) {
      await testEnv.cleanup();
    }
    if (spawnedProcess) {
      try { spawnedProcess.kill(); } catch {}
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearDatabase();
    }
    const defaultAuth = createControllableAuth(createTestSession('admin_default', 'tenantA', 'admin', 'admin'));
    authService.setProvider(defaultAuth);
    setTenantResolver(() => 'tenantA');

    // Limpar listeners do EventBus entre testes para evitar vazamento de instâncias anteriores de SyncEngine
    eventBus.listeners.clear();

    // Limpar stores locais do IndexedDB
    const db = await getDB();
    const stores = ['products', 'stockMovements', 'sales', 'purchases', 'suppliers', 'settings', 'syncQueue', 'imageManifest'];
    for (const store of stores) {
      try {
        await db.clear(store);
      } catch (_) {}
    }
  });

  // =========================================================================
  // ETAPA B: Validar Produtos com o Contrato Estrito da Fase 14.15
  // =========================================================================
  describe('Etapa B — Produtos com Contrato Estrito (Criação, Atualização e Exclusão)', () => {
    it('B.1: Criação pelo serviço: persiste no IndexedDB com version: 1, enfileira no Outbox e sincroniza com sucesso no RTDB Emulator', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_b1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_b1', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // 1. Criar produto pelo ProductService real
      const productId = await ProductService.createProduct({
        name: 'Monitor Gamer 144Hz',
        productCode: 'MON-144',
        salePriceCents: 129900,
        purchasePriceCents: 85000,
        tenantId: 'tenantA'
      });

      // 2. Verificar persistência local no IndexedDB
      const localProduct = await productRepository.findById(productId);
      expect(localProduct).toBeDefined();
      expect(localProduct.name).toBe('Monitor Gamer 144Hz');
      expect(localProduct.version).toBe(1);

      // 3. Verificar enfileiramento no Outbox
      const pending = await syncRepository.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].entityType).toBe('products');
      expect(pending[0].entityId).toBe(productId);
      expect(pending[0].action).toBe('CREATE');
      expect(pending[0].payload.version).toBe(1);
      expect(pending[0].payload.salePriceCents).toBe(129900);

      // 4. Disparar sincronização com o emulador
      const syncRes = await syncEngine.processQueue();
      expect(syncRes.success).toBe(1);
      expect(syncRes.failed).toBe(0);

      // 5. Verificar estado remoto no RTDB Emulator com regras reais
      const remoteSnap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(remoteSnap.exists()).toBe(true);
      const remoteData = remoteSnap.val();
      expect(remoteData.name).toBe('Monitor Gamer 144Hz');
      expect(remoteData.version).toBe(1);
      expect(remoteData.salePriceCents).toBe(129900);

      // 6. Confirmar que Outbox transicionou para SYNCED
      const syncedItem = await syncRepository.findById(pending[0].id);
      expect(syncedItem.status).toBe('SYNCED');
      expect(syncedItem.remoteAckReceived).toBe(true);

      syncEngine.destroy();
    });

    it('B.2: Atualização sequencial: v1 -> v2 e v2 -> v3 avançam monotonicamente com baseVersion estrito', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_b2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_b2', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // Criar produto inicial v1
      const productId = await ProductService.createProduct({
        name: 'Teclado Mecânico RGB',
        salePriceCents: 35000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Atualização 1: v1 -> v2
      await ProductService.updateProduct(productId, {
        name: 'Teclado Mecânico RGB Pro',
        salePriceCents: 39900,
        tenantId: 'tenantA'
      });
      const resV2 = await syncEngine.processQueue();
      expect(resV2.success).toBe(1);

      let snap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.val().version).toBe(2);
      expect(snap.val().baseVersion).toBe(1);
      expect(snap.val().salePriceCents).toBe(39900);

      // Atualização 2: v2 -> v3
      await ProductService.updateProduct(productId, {
        name: 'Teclado Mecânico RGB Pro v3',
        salePriceCents: 45000,
        tenantId: 'tenantA'
      });
      const resV3 = await syncEngine.processQueue();
      expect(resV3.success).toBe(1);

      snap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.val().version).toBe(3);
      expect(snap.val().baseVersion).toBe(2);
      expect(snap.val().salePriceCents).toBe(45000);

      syncEngine.destroy();
    });

    it('B.3: Tentativa de atualização baseada em baseVersion obsoleta resulta em conflito e bloqueia Outbox sem sobrescrita silenciosa', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_b3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_b3', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      const productId = await ProductService.createProduct({
        name: 'Mouse Óptico',
        salePriceCents: 15000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Servidor avança para v2 por outra operação
      await ProductService.updateProduct(productId, {
        name: 'Mouse Óptico Avançado',
        salePriceCents: 18000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Cliente tenta enviar mutação com baseVersion: 1 obsoleto
      const staleItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId: productId,
        action: 'UPDATE',
        payload: {
          id: productId,
          name: 'Mouse Desatualizado',
          salePriceCents: 12000,
          baseVersion: 1, // Obsoleto! Remoto já está em v2
          version: 2
        },
        tenantId: 'tenantA'
      });

      const resStale = await syncEngine.processQueue();
      expect(resStale.failed).toBe(1);

      // Confirmar que o item da Outbox foi retido com requiresResolution = true
      const failedItem = await syncRepository.findById(staleItem.id);
      expect(failedItem.status).toBe('FAILED');
      expect(failedItem.requiresResolution).toBe(true);
      expect(failedItem.errorCategory).toBe('version_conflict');

      // Servidor permanece íntegro com a versão v2
      const snap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.val().version).toBe(2);
      expect(snap.val().name).toBe('Mouse Óptico Avançado');

      syncEngine.destroy();
    });

    it('B.4: Exclusão lógica por operador: executa soft-delete com CAS e é aceita no RTDB Emulator', async () => {
      const opCtx = testEnv.authenticatedContext('op_b4', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });
      const auth = createControllableAuth(createTestSession('op_b4', 'tenantA', 'operator', 'operator'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = opCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // Criar produto como operador
      const productId = await ProductService.createProduct({
        name: 'Cadeira Gamer',
        salePriceCents: 89000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Soft-delete pelo ProductService
      const delSuccess = await ProductService.deleteProduct(productId);
      expect(delSuccess).toBe(true);

      // Aguarda persistência assíncrona do evento no Outbox
      let pendingDel = [];
      for (let i = 0; i < 15; i++) {
        pendingDel = await syncRepository.getPending();
        if (pendingDel.length > 0) break;
        await new Promise(r => setTimeout(r, 20));
      }
      expect(pendingDel.length).toBe(1);

      const delRes = await syncEngine.processQueue();
      expect(delRes.success).toBe(1);

      const snap = await get(ref(opCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.exists()).toBe(true);
      expect(snap.val().deletedAt).toBeDefined();
      expect(snap.val().version).toBe(2);

      syncEngine.destroy();
    });

    it('B.5: Exclusão física por operador via remove() é categoricamente rejeitada pelo servidor RTDB', async () => {
      const opCtx = testEnv.authenticatedContext('op_b5', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });
      const adminCtx = testEnv.authenticatedContext('admin_b5', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });

      // Admin semeia produto válido
      await set(ref(adminCtx.database(), 'tenants/tenantA/products/prod_phys_test'), {
        id: 'prod_phys_test',
        name: 'Item Físico',
        salePriceCents: 5000,
        version: 1
      });

      // Operador tenta exclusão física direta
      let opFailed = false;
      try {
        await remove(ref(opCtx.database(), 'tenants/tenantA/products/prod_phys_test'));
      } catch (err) {
        opFailed = true;
      }
      expect(opFailed).toBe(true);

      // Produto permanece no servidor
      const snap = await get(ref(adminCtx.database(), 'tenants/tenantA/products/prod_phys_test'));
      expect(snap.exists()).toBe(true);

      // Administrador tem permissão para exclusão física
      await remove(ref(adminCtx.database(), 'tenants/tenantA/products/prod_phys_test'));
      const afterAdmin = await get(ref(adminCtx.database(), 'tenants/tenantA/products/prod_phys_test'));
      expect(afterAdmin.exists()).toBe(false);
    });
  });

  // =========================================================================
  // ETAPA C: Validar o Ciclo de Vida do Outbox
  // =========================================================================
  describe('Etapa C — Ciclo de Vida do Outbox (Offline, Ordenação, Interrupção e Idempotência)', () => {
    it('C.1: Criação Offline -> Armazena PENDING no Outbox -> Restaura conexão -> Sincroniza com versão inicial correta', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_c1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_c1', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = false; // Dispositivo Offline!

      const syncEngine = new SyncEngine(provider, auth);
      syncEngine.autoSync = false;
      await syncEngine.init();

      // Criar produto offline
      const productId = await ProductService.createProduct({
        name: 'Headset Sem Fio',
        salePriceCents: 49900,
        tenantId: 'tenantA'
      });

      // Confirmar salvo localmente
      const local = await productRepository.findById(productId);
      expect(local).toBeDefined();

      // Confirmar pendente no Outbox
      const pending = await syncRepository.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('PENDING');

      // Restaurar conectividade
      provider._connected = true;
      const syncRes = await syncEngine.processQueue();
      expect(syncRes.success).toBe(1);

      // Confirmar remoto criado na v1
      const snap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(1);

      // Confirmar Outbox finalizado
      const updatedItem = await syncRepository.findById(pending[0].id);
      expect(updatedItem.status).toBe('SYNCED');

      syncEngine.destroy();
    });

    it('C.2: Múltiplas edições offline no mesmo produto são processadas em sequência correta sem saltos', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_c2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_c2', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = false; // Offline

      const syncEngine = new SyncEngine(provider, auth);
      syncEngine.autoSync = false;
      await syncEngine.init();

      // Criação offline (v1)
      const productId = await ProductService.createProduct({
        name: 'Gabinete ATX',
        salePriceCents: 30000,
        tenantId: 'tenantA'
      });

      // Edição offline 1 (v2)
      await ProductService.updateProduct(productId, {
        name: 'Gabinete ATX Vidro Temperado',
        salePriceCents: 35000,
        tenantId: 'tenantA'
      });

      // Edição offline 2 (v3)
      await ProductService.updateProduct(productId, {
        name: 'Gabinete ATX RGB 4 Fans',
        salePriceCents: 42000,
        tenantId: 'tenantA'
      });

      // Aguarda microtask para consolidação assíncrona do segundo update no Outbox
      await new Promise(r => setTimeout(r, 60));

      // Reconectar e sincronizar
      provider._connected = true;
      const res = await syncEngine.processQueue();
      expect(res.success).toBeGreaterThanOrEqual(1);

      // Servidor cria remotamente na v1 inicial, preservando o estado comercial consolidado mais recente
      const snap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(1);
      expect(snap.val().name).toBe('Gabinete ATX RGB 4 Fans');
      expect(snap.val().salePriceCents).toBe(42000);

      syncEngine.destroy();
    });

    it('C.3: Interrupção in-flight: item com remoteAckReceived = true finaliza como SYNCED; item sem ACK é recuperado para auditoria', async () => {
      const auth = createControllableAuth(createTestSession('admin_c3', 'tenantA', 'admin', 'admin'));
      const provider = new MockRealtimeProvider();
      provider.setConnected(true);

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // Item 1: Sofreu crash mas já tinha remoteAckReceived = true
      const itemAck = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p_crash_ack',
        action: 'CREATE',
        payload: { name: 'Item Ack', salePriceCents: 1000 },
        tenantId: 'tenantA'
      });
      itemAck.inFlight = true;
      itemAck.remoteAckReceived = true;
      itemAck.remoteVersion = 'v1_ack';
      await syncRepository.update(itemAck);

      // Item 2: Movimentação de estoque interrompida sem ACK remoto
      const itemLedger = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov_crash_unknown',
        action: 'CREATE',
        payload: { productId: 'p1', delta: 5, type: 'IN' },
        tenantId: 'tenantA'
      });
      itemLedger.inFlight = true;
      itemLedger.remoteAckReceived = false;
      await syncRepository.update(itemLedger);

      // Executa rotina de recuperação pós-falha
      const recovery = await syncEngine.recoverInterruptedInFlight();
      expect(recovery.recovered).toBe(1);
      // FASE 14.23: ledger com envio iniciado não é bloqueado nem reenviado: aguarda reconciliação por leitura
      expect(recovery.blocked).toBe(0);
      expect(recovery.awaitingReconciliation).toBe(1);

      const checkAck = await syncRepository.findById(itemAck.id);
      expect(checkAck.status).toBe('SYNCED');

      const checkLedger = await syncRepository.findById(itemLedger.id);
      expect(checkLedger.status).toBe('PENDING');
      expect(checkLedger.requiresResolution).toBe(false);
      expect(checkLedger.remoteOutcomeUnknown).toBe(true);
      expect(checkLedger.errorCategory).toBe('unknown_remote_outcome');

      syncEngine.destroy();
    });

    it('C.4: Idempotência de retentativa: payload idêntico é reconhecido como SYNCED sem duplicação; payload divergente gera conflito', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_c4', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_c4', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      // 1. Criar produto inicial
      const createRes = await provider.pushChange({
        id: 'mut_idem_1',
        entityType: 'products',
        entityId: 'prod_idem_test',
        action: 'CREATE',
        payload: { id: 'prod_idem_test', name: 'Fonte 650W', salePriceCents: 35000, version: 1 },
        tenantId: 'tenantA'
      });
      expect(createRes.success).toBe(true);

      // 2. Retentativa com payload idêntico: reconhece alreadyApplied
      const retrySame = await provider.pushChange({
        id: 'mut_idem_2',
        entityType: 'products',
        entityId: 'prod_idem_test',
        action: 'CREATE',
        payload: { id: 'prod_idem_test', name: 'Fonte 650W', salePriceCents: 35000, version: 1 },
        tenantId: 'tenantA'
      });
      expect(retrySame.success).toBe(true);
      expect(retrySame.alreadyApplied).toBe(true);

      // 3. Retentativa de criação com payload divergente: gera conflito de payload
      let divFailed = false;
      try {
        await provider.pushChange({
          id: 'mut_idem_3',
          entityType: 'products',
          entityId: 'prod_idem_test',
          action: 'CREATE',
          payload: { id: 'prod_idem_test', name: 'Fonte 850W Platinum', salePriceCents: 75000, version: 1 },
          tenantId: 'tenantA'
        });
      } catch (err) {
        divFailed = true;
        expect(err.code).toBe('concurrency_conflict');
      }
      expect(divFailed).toBe(true);
    });
  });

  // =========================================================================
  // ETAPA D: Concorrência entre Dispositivos
  // =========================================================================
  describe('Etapa D — Concorrência entre Dispositivos e Resolução de Conflitos', () => {
    it('D.1: Dois clientes concorrentes na v1: Cliente A avança para v2, Cliente B aborta com conflito e retém dados locais', async () => {
      const clientACtx = testEnv.authenticatedContext('client_a', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });
      const clientBCtx = testEnv.authenticatedContext('client_b', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });
      const adminCtx = testEnv.authenticatedContext('admin_d1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });

      // Criar produto inicial v1 no servidor
      await set(ref(adminCtx.database(), 'tenants/tenantA/products/p_race_d1'), {
        id: 'p_race_d1',
        name: 'Placa Mãe B550',
        salePriceCents: 70000,
        version: 1,
        tenantId: 'tenantA'
      });

      const authA = createControllableAuth(createTestSession('client_a', 'tenantA', 'operator', 'operator'));
      const providerA = new FirebaseRealtimeProvider(null, authA);
      providerA.db = clientACtx.database();
      providerA._initialized = true;
      providerA._connected = true;

      const authB = createControllableAuth(createTestSession('client_b', 'tenantA', 'operator', 'operator'));
      const providerB = new FirebaseRealtimeProvider(null, authB);
      providerB.db = clientBCtx.database();
      providerB._initialized = true;
      providerB._connected = true;

      // Cliente A envia atualização v1 -> v2 com sucesso
      const resA = await providerA.pushChange({
        id: 'mut_a',
        entityType: 'products',
        entityId: 'p_race_d1',
        action: 'UPDATE',
        payload: { id: 'p_race_d1', name: 'Placa Mãe B550 Wifi', salePriceCents: 75000, baseVersion: 1, version: 2 },
        tenantId: 'tenantA'
      });
      expect(resA.success).toBe(true);

      // Cliente B tenta enviar sua própria atualização baseada em v1
      let bConflict = false;
      try {
        await providerB.pushChange({
          id: 'mut_b',
          entityType: 'products',
          entityId: 'p_race_d1',
          action: 'UPDATE',
          payload: { id: 'p_race_d1', name: 'Placa Mãe B550 Steel', salePriceCents: 72000, baseVersion: 1, version: 2 },
          tenantId: 'tenantA'
        });
      } catch (err) {
        bConflict = true;
        expect(err.code).toBe('concurrency_conflict');
      }
      expect(bConflict).toBe(true);

      // Servidor manteve os dados do Cliente A
      const snap = await get(ref(adminCtx.database(), 'tenants/tenantA/products/p_race_d1'));
      expect(snap.val().version).toBe(2);
      expect(snap.val().name).toBe('Placa Mãe B550 Wifi');
    });

    it('D.2: Reconciliação explícita de Outbox: inspeciona divergência e aceita versão remota autoritativa', async () => {
      const auth = createControllableAuth(createTestSession('admin_d2', 'tenantA', 'admin', 'admin'));
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      // Semear estado remoto no provedor
      mock._getStore('products').set('prod_recon_1', {
        id: 'prod_recon_1',
        name: 'Cooler Duplo Remoto',
        salePriceCents: 22000,
        version: 2
      });

      const syncEngine = new SyncEngine(mock, auth);
      await syncEngine.init();

      // Enfileirar item com conflito de concorrência
      const conflictedItem = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'prod_recon_1',
        action: 'UPDATE',
        payload: { id: 'prod_recon_1', name: 'Cooler Local Divergente', salePriceCents: 19000, baseVersion: 1, version: 2 },
        tenantId: 'tenantA'
      });

      // Tentar processar: gera conflito na Outbox
      await syncEngine.processQueue();
      const failed = await syncRepository.findById(conflictedItem.id);
      expect(failed.status).toBe('FAILED');
      expect(failed.requiresResolution).toBe(true);

      // Inspecionar item divergente
      const inspection = await syncEngine.inspectOutboxItem(conflictedItem.id);
      expect(inspection.entityId).toBe('prod_recon_1');
      expect(inspection.comparisonOutcome).toBe('VERSION_CONFLICT');

      // Administrador decide aceitar a versão remota autoritativa
      const reconResult = await syncEngine.reconcileOutboxItem(conflictedItem.id, 'ACCEPT_REMOTE', {
        reason: 'Preço remoto de R$ 220,00 validado pelo gerente'
      });
      expect(reconResult.success).toBe(true);

      const resolved = await syncRepository.findById(conflictedItem.id);
      expect(resolved.status).toBe('SYNCED');

      syncEngine.destroy();
    });
  });

  // =========================================================================
  // ETAPA E: Vendas, Compras e Estoque
  // =========================================================================
  describe('Etapa E — Vendas, Compras e Ledger de Estoque', () => {
    it('E.1: Venda pelo SaleService gera venda e movimento no ledger com snapshot preservado e sincroniza no RTDB', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_e1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_e1', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // Criar produto com saldo 20
      const productId = await ProductService.createProduct({
        name: 'SSD 500GB',
        salePriceCents: 25000,
        purchasePriceCents: 15000,
        tenantId: 'tenantA'
      });
      await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 20,
        unitCostCents: 15000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Executar Venda de 3 unidades
      const saleResult = await SaleService.recordSale({
        productId,
        quantity: 3,
        unitSalePriceCents: 25000,
        customerName: 'Cliente Homologação',
        tenantId: 'tenantA'
      });
      expect(saleResult.saleId).toBeDefined();

      const syncRes = await syncEngine.processQueue();
      expect(syncRes.success).toBeGreaterThanOrEqual(1);

      // Verificar registro da venda no RTDB Emulator
      const saleSnap = await get(ref(adminCtx.database(), `tenants/tenantA/sales/${saleResult.saleId}`));
      expect(saleSnap.exists()).toBe(true);
      expect(saleSnap.val().quantity).toBe(3);
      expect(saleSnap.val().totalSaleCents).toBe(75000);

      // Exclusão física da venda é bloqueada pelas regras para qualquer papel
      let delFailed = false;
      try {
        await remove(ref(adminCtx.database(), `tenants/tenantA/sales/${saleResult.saleId}`));
      } catch (_) {
        delFailed = true;
      }
      expect(delFailed).toBe(true);

      syncEngine.destroy();
    });

    it('E.2: Compra pelo PurchaseService requer admin, persiste no RTDB com totalAmountCents e proíbe exclusão física', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_e2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_e2', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      // Criar fornecedor e produto
      const supplierId = await SupplierService.createSupplier({
        name: 'Distribuidora Tech',
        tenantId: 'tenantA'
      });
      const productId = await ProductService.createProduct({
        name: 'Memória RAM 16GB',
        salePriceCents: 32000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      // Executar Compra de 10 unidades
      const purchaseResult = await PurchaseService.recordPurchase({
        productId,
        supplierId,
        quantity: 10,
        unitCostCents: 18000,
        tenantId: 'tenantA'
      });
      expect(purchaseResult.purchaseId).toBeDefined();

      await syncEngine.processQueue();

      const purSnap = await get(ref(adminCtx.database(), `tenants/tenantA/purchases/${purchaseResult.purchaseId}`));
      expect(purSnap.exists()).toBe(true);
      expect(purSnap.val().quantity).toBe(10);
      expect(purSnap.val().totalAmountCents).toBe(180000);

      // Exclusão física da compra é proibida pelas regras
      let delFailed = false;
      try {
        await remove(ref(adminCtx.database(), `tenants/tenantA/purchases/${purchaseResult.purchaseId}`));
      } catch (_) {
        delFailed = true;
      }
      expect(delFailed).toBe(true);

      syncEngine.destroy();
    });

    it('E.3: Ledger /inventory é estritamente append-only: rejeita update parcial e remoção física', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_e3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const auth = createControllableAuth(createTestSession('admin_e3', 'tenantA', 'admin', 'admin'));
      authService.setProvider(auth);
      setTenantResolver(() => 'tenantA');

      const provider = new FirebaseRealtimeProvider(null, auth);
      provider.db = adminCtx.database();
      provider._initialized = true;
      provider._connected = true;

      const syncEngine = new SyncEngine(provider, auth);
      await syncEngine.init();

      const productId = await ProductService.createProduct({
        name: 'Cabo HDMI 2.1',
        salePriceCents: 4500,
        tenantId: 'tenantA'
      });

      const mov = await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 50,
        unitCostCents: 2000,
        tenantId: 'tenantA'
      });
      await syncEngine.processQueue();

      const movSnap = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${mov.movementId}`));
      expect(movSnap.exists()).toBe(true);
      expect(movSnap.val().delta).toBe(50);

      // Tentativa de update no movimento existente
      let updateFailed = false;
      try {
        await update(ref(adminCtx.database(), `tenants/tenantA/inventory/${mov.movementId}`), { delta: 100 });
      } catch (_) {
        updateFailed = true;
      }
      expect(updateFailed).toBe(true);

      // Tentativa de remoção do movimento
      let removeFailed = false;
      try {
        await remove(ref(adminCtx.database(), `tenants/tenantA/inventory/${mov.movementId}`));
      } catch (_) {
        removeFailed = true;
      }
      expect(removeFailed).toBe(true);

      syncEngine.destroy();
    });
  });

  // =========================================================================
  // ETAPA F: Fornecedores, Configurações e Manifestos de Imagem
  // =========================================================================
  describe('Etapa F — Fornecedores, Configurações e Manifestos de Imagem', () => {
    it('F.1: Fornecedor e Configurações: admin lê e grava com sucesso; operador é rejeitado pelo RTDB Emulator', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_f1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const opCtx = testEnv.authenticatedContext('op_f1', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });

      // Admin grava configuração
      await set(ref(adminCtx.database(), 'tenants/tenantA/settings/companyName'), {
        id: 'companyName',
        value: 'Auto Peças Modelo'
      });
      const settingSnap = await get(ref(adminCtx.database(), 'tenants/tenantA/settings/companyName'));
      expect(settingSnap.val().value).toBe('Auto Peças Modelo');

      // Operador tenta alterar configuração: rejeitado
      let opSettingFailed = false;
      try {
        await set(ref(opCtx.database(), 'tenants/tenantA/settings/companyName'), {
          id: 'companyName',
          value: 'Nome Hackeado'
        });
      } catch (_) {
        opSettingFailed = true;
      }
      expect(opSettingFailed).toBe(true);

      // Admin cadastra fornecedor
      await set(ref(adminCtx.database(), 'tenants/tenantA/suppliers/sup_01'), {
        id: 'sup_01',
        name: 'Fornecedor Central',
        tenantId: 'tenantA'
      });

      // Operador tenta cadastrar fornecedor: rejeitado
      let opSupFailed = false;
      try {
        await set(ref(opCtx.database(), 'tenants/tenantA/suppliers/sup_02'), {
          id: 'sup_02',
          name: 'Fornecedor Ilegal',
          tenantId: 'tenantA'
        });
      } catch (_) {
        opSupFailed = true;
      }
      expect(opSupFailed).toBe(true);
    });

    it('F.2: Manifestos de imagem: schema estrito (id, productId, url, version) e isolamento multi-tenant', async () => {
      const opCtx = testEnv.authenticatedContext('op_f2', { tenantId: 'tenantA', role: 'operator', appRole: 'operator' });
      const tenantBCtx = testEnv.authenticatedContext('admin_b_f2', { tenantId: 'tenantB', role: 'admin', appRole: 'admin' });

      // Operador do Tenant A grava manifesto com schema válido
      await set(ref(opCtx.database(), 'tenants/tenantA/imageManifest/photo_01'), {
        id: 'photo_01',
        productId: 'prod_01',
        url: 'https://storage.local/photo_01.webp',
        version: 1
      });

      const snap = await get(ref(opCtx.database(), 'tenants/tenantA/imageManifest/photo_01'));
      expect(snap.exists()).toBe(true);
      expect(snap.val().productId).toBe('prod_01');

      // Tenant B não consegue ler o manifesto de Tenant A
      let bReadFailed = false;
      try {
        await get(ref(tenantBCtx.database(), 'tenants/tenantA/imageManifest/photo_01'));
      } catch (_) {
        bReadFailed = true;
      }
      expect(bReadFailed).toBe(true);
    });
  });

  // =========================================================================
  // ETAPA G: Autorização e Isolamento Entre Tenants
  // =========================================================================
  describe('Etapa G — Autorização e Isolamento Multi-Tenant Estrito', () => {
    it('G.1: Usuário do Tenant A é categoricamente bloqueado de ler ou escrever em nós do Tenant B', async () => {
      const adminACtx = testEnv.authenticatedContext('admin_g1_a', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
      const adminBCtx = testEnv.authenticatedContext('admin_g1_b', { tenantId: 'tenantB', role: 'admin', appRole: 'admin' });

      // Tenant B grava produto
      await set(ref(adminBCtx.database(), 'tenants/tenantB/products/prod_b_secret'), {
        id: 'prod_b_secret',
        name: 'Segredo Comercial Tenant B',
        salePriceCents: 99900,
        version: 1,
        tenantId: 'tenantB'
      });

      // Tenant A tenta ler produto de Tenant B
      let readFailed = false;
      try {
        await get(ref(adminACtx.database(), 'tenants/tenantB/products/prod_b_secret'));
      } catch (_) {
        readFailed = true;
      }
      expect(readFailed).toBe(true);

      // Tenant A tenta escrever produto em Tenant B
      let writeFailed = false;
      try {
        await set(ref(adminACtx.database(), 'tenants/tenantB/products/prod_hack'), {
          id: 'prod_hack',
          name: 'Produto Intruso',
          salePriceCents: 1000,
          version: 1,
          tenantId: 'tenantB'
        });
      } catch (_) {
        writeFailed = true;
      }
      expect(writeFailed).toBe(true);
    });

    it('G.2: Usuário autenticado sem custom claims canônicas suficientes (viewer/unmigrated) é bloqueado em todas as escritas', async () => {
      // Usuário autenticado com papel viewer
      const viewerCtx = testEnv.authenticatedContext('user_viewer_g2', { tenantId: 'tenantA', role: 'viewer', appRole: 'viewer' });

      let failProduct = false;
      try {
        await set(ref(viewerCtx.database(), 'tenants/tenantA/products/prod_viewer_bad'), {
          id: 'prod_viewer_bad',
          name: 'Tentativa Viewer',
          salePriceCents: 1000,
          version: 1
        });
      } catch (_) {
        failProduct = true;
      }
      expect(failProduct).toBe(true);

      let failSale = false;
      try {
        await set(ref(viewerCtx.database(), 'tenants/tenantA/sales/sale_viewer_bad'), {
          id: 'sale_viewer_bad',
          productId: 'p1',
          quantity: 1,
          totalSaleCents: 1000
        });
      } catch (_) {
        failSale = true;
      }
      expect(failSale).toBe(true);
    });
  });

  // =========================================================================
  // ETAPA H: Compatibilidade e Paridade de Provedores
  // =========================================================================
  describe('Etapa H — Compatibilidade e Paridade de Provedores (Firebase vs Mock)', () => {
    it('H.1: Paridade em criação e repetição idempotente', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      const res1 = await mock.pushChange({
        id: 'mut_par_1',
        entityType: 'products',
        entityId: 'p_par_1',
        action: 'CREATE',
        payload: { id: 'p_par_1', name: 'Item Paridade', salePriceCents: 5000, version: 1 }
      });
      expect(res1.success).toBe(true);

      // Repetição com payload equivalente: reconhece alreadyApplied
      const res2 = await mock.pushChange({
        id: 'mut_par_2',
        entityType: 'products',
        entityId: 'p_par_1',
        action: 'CREATE',
        payload: { id: 'p_par_1', name: 'Item Paridade', salePriceCents: 5000, version: 1 }
      });
      expect(res2.success).toBe(true);
      expect(res2.alreadyApplied).toBe(true);
    });

    it('H.2: Paridade na rejeição de atualização com baseVersion obsoleto (version_conflict)', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('p_par_ver', {
        id: 'p_par_ver',
        name: 'Item v2',
        salePriceCents: 6000,
        version: 2
      });

      let failed = false;
      try {
        await mock.pushChange({
          id: 'mut_par_stale',
          entityType: 'products',
          entityId: 'p_par_ver',
          action: 'UPDATE',
          payload: { id: 'p_par_ver', name: 'Item Mut', salePriceCents: 7000, baseVersion: 1, version: 2 }
        });
      } catch (err) {
        failed = true;
        expect(err.code).toBe('concurrency_conflict');
        expect(err.errorCategory).toBe('version_conflict');
      }
      expect(failed).toBe(true);
    });

    it('H.3: Paridade na proteção contra mutação de registros legados não-versionados (unversioned_legacy_conflict)', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('p_par_legacy', {
        id: 'p_par_legacy',
        name: 'Item Sem Versao',
        salePriceCents: 4000
        // version ausente
      });

      let failed = false;
      try {
        await mock.pushChange({
          id: 'mut_par_leg',
          entityType: 'products',
          entityId: 'p_par_legacy',
          action: 'UPDATE',
          payload: { id: 'p_par_legacy', name: 'Tentativa Mutacao', salePriceCents: 4500 }
        });
      } catch (err) {
        failed = true;
        expect(err.code).toBe('concurrency_conflict');
        expect(err.errorCategory).toBe('unversioned_legacy_conflict');
      }
      expect(failed).toBe(true);
    });
  });

  // =========================================================================
  // FASE 14.17: CONSISTÊNCIA DE VERSIONAMENTO NO OUTBOX, COALESCÊNCIA E RECUPERAÇÃO
  // =========================================================================
  describe('FASE 14.17 — Consistência de Versionamento no Outbox, Coalescência e Recuperação Comercial', () => {
    // -----------------------------------------------------------------------
    // GRUPO A: Coalescência e Versões
    // -----------------------------------------------------------------------
    describe('Grupo A — Coalescência e Versões', () => {
      it('A.1: Criar e editar produto offline uma vez preserva version: 1, remove baseVersion e sincroniza com sucesso', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_a1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_a1', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = false; // Simula provedor offline

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        // 1. Cria produto localmente (v1)
        const productId = await ProductService.createProduct({
          name: 'Monitor Gamer 24 Pol',
          salePriceCents: 120000,
          purchasePriceCents: 80000,
          minimumStock: 2,
          maximumStock: 10,
          tenantId: 'tenantA'
        });

        // 2. Primeira alteração comercial offline via updateProduct
        await ProductService.updateProduct(productId, {
          name: 'Monitor Gamer 24 Pol 144Hz',
          salePriceCents: 125000,
          tenantId: 'tenantA'
        });

        await new Promise(r => setTimeout(r, 60));

        // 3. Confirma versão e conteúdo persistidos localmente no IndexedDB durante modo offline
        const localBeforeSync = await productRepository.findById(productId);
        expect(localBeforeSync.version).toBe(2);
        expect(localBeforeSync.baseVersion).toBe(1);
        expect(localBeforeSync.name).toBe('Monitor Gamer 24 Pol 144Hz');
        expect(localBeforeSync.salePriceCents).toBe(125000);

        // 4. Inspeciona operações gravadas no Outbox: consolidado no CREATE com version: 1 e sem baseVersion
        const pendingItems = await syncRepository.getPending();
        expect(pendingItems.length).toBe(1);
        expect(pendingItems[0].action).toBe('CREATE');
        expect(pendingItems[0].payload.version).toBe(1);
        expect(pendingItems[0].payload.baseVersion).toBeUndefined();
        expect(pendingItems[0].payload.name).toBe('Monitor Gamer 24 Pol 144Hz');
        expect(pendingItems[0].payload.salePriceCents).toBe(125000);

        // 5. Restaura acesso ao RTDB Emulator e sincroniza
        provider._connected = true;
        const syncResult = await syncEngine.processQueue();
        expect(syncResult.success).toBe(1);

        // 6. Lê do RTDB Emulator e confirma que produto local foi reconciliado/normalizado para v1
        const rtdbSnap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
        expect(rtdbSnap.exists()).toBe(true);
        expect(rtdbSnap.val().version).toBe(1);
        expect(rtdbSnap.val().baseVersion).toBeUndefined();

        const localAfterSync = await productRepository.findById(productId);
        expect(localAfterSync.version).toBe(1);
        expect(localAfterSync.baseVersion).toBeUndefined();
        expect(rtdbSnap.val().name).toBe(localAfterSync.name);
        expect(rtdbSnap.val().salePriceCents).toBe(localAfterSync.salePriceCents);

        // 7. Nova edição pós-sincronização avança monotonicamente para v2 com baseVersion: 1
        await ProductService.updateProduct(productId, {
          name: 'Monitor Gamer 24 Pol 165Hz IPS',
          salePriceCents: 130000,
          tenantId: 'tenantA'
        });

        const postSyncLocal = await productRepository.findById(productId);
        expect(postSyncLocal.version).toBe(2);
        expect(postSyncLocal.baseVersion).toBe(1);

        const syncResult2 = await syncEngine.processQueue();
        expect(syncResult2.success).toBe(1);

        const rtdbSnap2 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
        expect(rtdbSnap2.val().version).toBe(2);
        expect(rtdbSnap2.val().baseVersion).toBe(1);
        expect(rtdbSnap2.val().name).toBe('Monitor Gamer 24 Pol 165Hz IPS');

        syncEngine.destroy();
      });

      it('A.2: Criar e editar produto offline várias vezes (4 edições) consolida sem divergência de versão', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_a2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_a2', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = false; // Offline

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        const productId = await ProductService.createProduct({
          name: 'Notebook Pro 14',
          salePriceCents: 500000,
          purchasePriceCents: 350000,
          tenantId: 'tenantA'
        });

        // 4 edições consecutivas offline com valores dinâmicos
        const revisions = [
          { name: 'Notebook Pro 14 16GB', salePriceCents: 520000 },
          { name: 'Notebook Pro 14 32GB', salePriceCents: 580000 },
          { name: 'Notebook Pro 14 32GB 1TB', salePriceCents: 620000 },
          { name: 'Notebook Pro 14 M-Max 32GB 1TB', salePriceCents: 650000 }
        ];

        for (const rev of revisions) {
          await ProductService.updateProduct(productId, {
            ...rev,
            tenantId: 'tenantA'
          });
        }

        await new Promise(r => setTimeout(r, 60));

        // Confirma localmente no IndexedDB durante modo offline (4 incrementos monotônicos)
        const localProdBeforeSync = await productRepository.findById(productId);
        expect(localProdBeforeSync.version).toBe(5);
        expect(localProdBeforeSync.baseVersion).toBe(4);
        expect(localProdBeforeSync.name).toBe('Notebook Pro 14 M-Max 32GB 1TB');
        expect(localProdBeforeSync.salePriceCents).toBe(650000);

        // Confirma no Outbox: consolidado no CREATE inicial com version: 1 e sem baseVersion
        const pending = await syncRepository.getPending();
        expect(pending.length).toBe(1);
        expect(pending[0].action).toBe('CREATE');
        expect(pending[0].payload.version).toBe(1);
        expect(pending[0].payload.baseVersion).toBeUndefined();
        expect(pending[0].payload.name).toBe('Notebook Pro 14 M-Max 32GB 1TB');

        // Reconecta e sincroniza
        provider._connected = true;
        const res = await syncEngine.processQueue();
        expect(res.success).toBe(1);

        // Verifica estado no RTDB Emulator e confirma normalização do registro local pós-sync
        const rtdbSnap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
        expect(rtdbSnap.val().version).toBe(1);
        expect(rtdbSnap.val().baseVersion).toBeUndefined();
        expect(rtdbSnap.val().name).toBe('Notebook Pro 14 M-Max 32GB 1TB');
        expect(rtdbSnap.val().salePriceCents).toBe(650000);

        const localProdAfterSync = await productRepository.findById(productId);
        expect(localProdAfterSync.version).toBe(1);
        expect(localProdAfterSync.baseVersion).toBeUndefined();

        // Confirma que próxima edição online funciona de v1 -> v2 perfeitamente
        await ProductService.updateProduct(productId, {
          name: 'Notebook Pro 14 M-Max 32GB 2TB',
          salePriceCents: 700000,
          tenantId: 'tenantA'
        });

        const res2 = await syncEngine.processQueue();
        expect(res2.success).toBe(1);

        const rtdbSnap2 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
        expect(rtdbSnap2.val().version).toBe(2);
        expect(rtdbSnap2.val().baseVersion).toBe(1);
        expect(rtdbSnap2.val().salePriceCents).toBe(700000);

        syncEngine.destroy();
      });

      it('A.3: Regressão decisiva: criação nunca começa em versão > 1 e baseVersion obsoleta gera conflito CAS', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_a3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        // 1. Criação direta com version: 2 no RTDB Emulator DEVE ser rejeitada pelas regras de segurança
        let createV2Failed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/prod_reg_v2'), {
            id: 'prod_reg_v2',
            name: 'Produto Invalido V2',
            salePriceCents: 1000,
            version: 2
          });
        } catch (err) {
          createV2Failed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(createV2Failed).toBe(true);

        // 2. Criação direta com baseVersion: 1 DEVE ser rejeitada pelas regras de segurança
        let createBaseFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/prod_reg_base'), {
            id: 'prod_reg_base',
            name: 'Produto Invalido Base',
            salePriceCents: 1000,
            version: 1,
            baseVersion: 1
          });
        } catch (err) {
          createBaseFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(createBaseFailed).toBe(true);

        // 3. Criação válida v1 aceita
        await set(ref(db, 'tenants/tenantA/products/prod_reg_ok'), {
          id: 'prod_reg_ok',
          name: 'Produto Valido V1',
          salePriceCents: 1000,
          version: 1
        });

        // 4. Tentativa de update com baseVersion incompatível (ex: esperado 1, propõe baseVersion: 2) DEVE falhar
        let updateConflictFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/prod_reg_ok'), {
            id: 'prod_reg_ok',
            name: 'Tentativa Conflito',
            salePriceCents: 1500,
            baseVersion: 2, // Servidor está na v1!
            version: 3
          });
        } catch (err) {
          updateConflictFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(updateConflictFailed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // GRUPO B: Outbox e Interrupções
    // -----------------------------------------------------------------------
    describe('Grupo B — Outbox e Interrupções', () => {
      it('B.1: Operação pendente antes do envio e classificação de interrupção in-flight', async () => {
        const item = await syncRepository.enqueue({
          entityType: 'products',
          entityId: 'p_out_1',
          action: 'CREATE',
          payload: { id: 'p_out_1', name: 'Item Pendente', salePriceCents: 5000, version: 1 },
          tenantId: 'tenantA'
        });

        expect(item.status).toBe('PENDING');
        expect(item.inFlight).toBe(false);

        // Simula interrupção no meio do envio (crash window)
        item.inFlight = true;
        item.remoteAckReceived = false;
        await syncRepository.update(item);

        const auth = createControllableAuth(createTestSession('admin_b1', 'tenantA', 'admin', 'admin'));
        const provider = new MockRealtimeProvider();
        const syncEngine = new SyncEngine(provider, auth);

        const rec = await syncEngine.recoverInterruptedInFlight();
        expect(rec.recovered).toBe(1);

        const recoveredItem = await syncRepository.findById(item.id);
        expect(recoveredItem.status).toBe('PENDING');
        expect(recoveredItem.remoteOutcomeUnknown).toBe(true);
        expect(recoveredItem.inFlightInterrupted).toBe(true);

        syncEngine.destroy();
      });

      it('B.2: ACK confirmado remotamente antes de confirmação local é recuperado sem duplicação', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_b2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_b2', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        // Pré-grava registro no RTDB (como se o backend tivesse recebido e o cliente caído antes de gravar o ACK)
        await set(ref(adminCtx.database(), 'tenants/tenantA/products/p_ack_crash'), {
          id: 'p_ack_crash',
          name: 'Item Gravado Remoto',
          salePriceCents: 9900,
          version: 1
        });

        // Enfileira item que sofreu crash
        const item = await syncRepository.enqueue({
          entityType: 'products',
          entityId: 'p_ack_crash',
          action: 'CREATE',
          payload: { id: 'p_ack_crash', name: 'Item Gravado Remoto', salePriceCents: 9900, version: 1 },
          tenantId: 'tenantA'
        });
        item.inFlight = true;
        item.remoteOutcomeUnknown = true;
        item.inFlightInterrupted = true;
        await syncRepository.update(item);

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        const res = await syncEngine.processQueue();
        expect(res.success).toBe(1);

        const syncedItem = await syncRepository.findById(item.id);
        expect(syncedItem.status).toBe('SYNCED');
        expect(syncedItem.remoteAckReceived).toBe(true);

        syncEngine.destroy();
      });

      it('B.3: Rejeição de autorização e conflito de versão não são mascarados como sucesso', async () => {
        // Usuário operador tentando modificar configurações (requer admin)
        const operAuth = createControllableAuth(createTestSession('oper_b3', 'tenantA', 'operator', 'operator'));
        authService.setProvider(operAuth);
        setTenantResolver(() => 'tenantA');

        const provider = new MockRealtimeProvider();
        provider.setConnected(true);

        const syncEngine = new SyncEngine(provider, operAuth);
        await syncEngine.init();

        const itemSec = await syncRepository.enqueue({
          entityType: 'settings',
          entityId: 'companyName',
          action: 'UPDATE',
          payload: { key: 'companyName', value: 'Nova Empresa' },
          tenantId: 'tenantA'
        });

        const res = await syncEngine.processQueue();
        expect(res.failed).toBe(1);

        const failedItem = await syncRepository.findById(itemSec.id);
        expect(failedItem.status).toBe('FAILED');
        expect(failedItem.permanentFailure).toBe(true);
        expect(failedItem.errorCategory).toBe('security');

        syncEngine.destroy();
      });
    });

    // -----------------------------------------------------------------------
    // GRUPO C: Venda, Compra e Ledger (/inventory)
    // -----------------------------------------------------------------------
    describe('Grupo C — Venda, Compra e Ledger de Estoque', () => {
      it('C.1: Fluxo de venda gera venda e movimento no ledger com imutabilidade e vinculação', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_c1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_c1', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        // 1. Cria produto com saldo
        const prodId = await ProductService.createProduct({
          name: 'Teclado Mecânico Pro',
          salePriceCents: 25000,
          purchasePriceCents: 15000,
          tenantId: 'tenantA'
        });
        await StockService.recordMovement({
          productId: prodId,
          quantity: 10,
          type: 'IN',
          reason: 'Saldo inicial',
          tenantId: 'tenantA'
        });

        // 2. Realiza venda comercial
        const sale = await SaleService.recordSale({
          productId: prodId,
          quantity: 3,
          customerName: 'Cliente Teste F14',
          tenantId: 'tenantA'
        });

        expect(sale.id).toBeDefined();
        expect(sale.stockMovementId).toBeDefined();
        expect(sale.totalSaleCents).toBe(75000);
        expect(sale.unitCostCents).toBe(15000);

        // 3. Sincroniza todas as operações no RTDB Emulator
        const res = await syncEngine.processQueue();
        expect(res.success).toBeGreaterThanOrEqual(3);

        // 4. Valida persistência remota no RTDB Emulator
        const rtdbSale = await get(ref(adminCtx.database(), `tenants/tenantA/sales/${sale.id}`));
        expect(rtdbSale.exists()).toBe(true);
        expect(rtdbSale.val().quantity).toBe(3);
        expect(rtdbSale.val().totalSaleCents).toBe(75000);

        const rtdbMov = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${sale.stockMovementId}`));
        expect(rtdbMov.exists()).toBe(true);
        expect(rtdbMov.val().type).toBe('SALE');
        expect(rtdbMov.val().delta).toBe(-3);
        expect(rtdbMov.val().referenceId).toBe(sale.id);

        syncEngine.destroy();
      });

      it('C.2: Falha parcial de rede durante envio do ledger é recuperada sem duplicação', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_c2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_c2', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const db = adminCtx.database();
        const saleId = 'sale_partial_test';
        const movementId = 'mov_partial_test';

        // 1. Simula cenário onde a venda já foi confirmada no RTDB
        await set(ref(db, `tenants/tenantA/sales/${saleId}`), {
          id: saleId,
          productId: 'prod_p',
          quantity: 2,
          unitSalePriceCents: 5000,
          unitCostCents: 3000,
          totalSaleCents: 10000,
          date: new Date().toISOString()
        });

        // 2. O movimento do ledger falhou antes de receber ACK e ficou inFlightInterrupted
        const movItem = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movementId,
          action: 'CREATE',
          payload: {
            id: movementId,
            productId: 'prod_p',
            quantity: 2,
            delta: -2,
            type: 'SALE',
            referenceId: saleId,
            referenceType: 'SALE',
            date: new Date().toISOString()
          },
          tenantId: 'tenantA'
        });
        movItem.status = 'PENDING';
        movItem.remoteOutcomeUnknown = true;
        movItem.inFlightInterrupted = true;
        await syncRepository.update(movItem);

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = db;
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        // 3. Executa processamento da fila: detecta RECORD_ABSENT no RTDB e despacha com sucesso
        const res = await syncEngine.processQueue();
        expect(res.success).toBe(1);

        const rtdbMov = await get(ref(db, `tenants/tenantA/inventory/${movementId}`));
        expect(rtdbMov.exists()).toBe(true);
        expect(rtdbMov.val().id).toBe(movementId);

        // 4. Executa retentativa: o registro já existe no RTDB e é equivalente -> reconcilia sem duplicação
        const retryRes = await provider.pushChange(movItem);
        expect(retryRes.success).toBe(true);
        expect(retryRes.alreadyApplied).toBe(true);

        syncEngine.destroy();
      });

      it('C.3: Tentativa de sobrescrever ledger com payload divergente é categoricamente rejeitada', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_c3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();
        const movementId = 'mov_immutable_test';

        // Grava movimento no ledger append-only
        await set(ref(db, `tenants/tenantA/inventory/${movementId}`), {
          id: movementId,
          productId: 'prod_imm',
          quantity: 5,
          delta: 5,
          type: 'IN',
          date: new Date().toISOString()
        });

        // Tentativa de update com valor divergente no RTDB Emulator
        let overwriteFailed = false;
        try {
          await update(ref(db, `tenants/tenantA/inventory/${movementId}`), {
            quantity: 10,
            delta: 10
          });
        } catch (err) {
          overwriteFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(overwriteFailed).toBe(true);

        // Tentativa de delete no RTDB Emulator
        let deleteFailed = false;
        try {
          await remove(ref(db, `tenants/tenantA/inventory/${movementId}`));
        } catch (err) {
          deleteFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(deleteFailed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // GRUPO D: Regras e Isolamento
    // -----------------------------------------------------------------------
    describe('Grupo D — Regras Diretas do RTDB Emulator e Isolamento', () => {
      it('D.1: Contrato estrito version/baseVersion em produtos', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_d1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        // 1. Criar com version: 1 -> OK
        await set(ref(db, 'tenants/tenantA/products/p_d1'), {
          id: 'p_d1',
          name: 'Produto D1',
          salePriceCents: 5000,
          version: 1
        });

        // 2. Atualizar com baseVersion: 1 e version: 2 -> OK
        await set(ref(db, 'tenants/tenantA/products/p_d1'), {
          id: 'p_d1',
          name: 'Produto D1 Atualizado',
          salePriceCents: 6000,
          baseVersion: 1,
          version: 2
        });

        // 3. Atualizar pulando versão (baseVersion: 2, version: 4) -> REJEITADO
        let skipFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/p_d1'), {
            id: 'p_d1',
            name: 'Produto D1 Salto',
            salePriceCents: 7000,
            baseVersion: 2,
            version: 4
          });
        } catch (err) {
          skipFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(skipFailed).toBe(true);

        // 4. Atualizar com baseVersion obsoleta (baseVersion: 1, version: 2) quando já está na v2 -> REJEITADO
        let staleFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/p_d1'), {
            id: 'p_d1',
            name: 'Produto D1 Obsoleto',
            salePriceCents: 7000,
            baseVersion: 1,
            version: 2
          });
        } catch (err) {
          staleFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(staleFailed).toBe(true);
      });

      it('D.2: Imutabilidade de vendas e compras impede adulteração de valores comerciais', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_d2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        // Venda inicial
        await set(ref(db, 'tenants/tenantA/sales/s_d2'), {
          id: 's_d2',
          productId: 'prod_d2',
          quantity: 2,
          totalSaleCents: 20000,
          date: '2026-10-12T10:00:00.000Z'
        });

        // Tentativa de alterar totalSaleCents da venda
        let tamperSaleFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/sales/s_d2'), {
            id: 's_d2',
            productId: 'prod_d2',
            quantity: 2,
            totalSaleCents: 5000,
            date: '2026-10-12T10:00:00.000Z'
          });
        } catch (err) {
          tamperSaleFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(tamperSaleFailed).toBe(true);

        // Compra inicial
        await set(ref(db, 'tenants/tenantA/purchases/pur_d2'), {
          id: 'pur_d2',
          totalAmountCents: 50000
        });

        // Tentativa de alterar totalAmountCents da compra
        let tamperPurFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/purchases/pur_d2'), {
            id: 'pur_d2',
            totalAmountCents: 10000
          });
        } catch (err) {
          tamperPurFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(tamperPurFailed).toBe(true);
      });

      it('D.3: Isolamento multi-tenant estrito entre Tenant A e Tenant B', async () => {
        const tenantAAdmin = testEnv.authenticatedContext('admin_tenant_a', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const dbA = tenantAAdmin.database();

        // Admin do Tenant A grava no Tenant A -> OK
        await set(ref(dbA, 'tenants/tenantA/products/prod_iso_a'), {
          id: 'prod_iso_a',
          name: 'Produto Tenant A',
          salePriceCents: 1000,
          version: 1
        });

        // Admin do Tenant A tenta ler nó do Tenant B -> REJEITADO
        let crossReadFailed = false;
        try {
          await get(ref(dbA, 'tenants/tenantB/products/prod_iso_b'));
        } catch (err) {
          crossReadFailed = true;
          expect(err.message.toLowerCase()).toContain('permission denied');
        }
        expect(crossReadFailed).toBe(true);

        // Admin do Tenant A tenta escrever em nó do Tenant B -> REJEITADO
        let crossWriteFailed = false;
        try {
          await set(ref(dbA, 'tenants/tenantB/products/prod_hack'), {
            id: 'prod_hack',
            name: 'Produto Invasor',
            salePriceCents: 1000,
            version: 1
          });
        } catch (err) {
          crossWriteFailed = true;
          expect(err.message.toLowerCase()).toContain('permission denied');
        }
        expect(crossWriteFailed).toBe(true);
      });
    });
  });

  // =========================================================================
  // FASE 14.18 — Contrato Canônico de Schema, Reconciliação de Versões e Recuperação do Ledger
  // =========================================================================
  describe('FASE 14.18 — Contrato Canônico de Schema, Reconciliação de Versões e Recuperação do Ledger', () => {
    // -----------------------------------------------------------------------
    // PARTE 1: Schema Canônico Real do Produto
    // -----------------------------------------------------------------------
    describe('Parte 1 — Schema Canônico Real do Produto', () => {
      it('18.1: Produto criado via ProductService é avaliado pelas regras reais do RTDB Emulator e possui salePriceCents', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_1', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_1', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        const productId = await ProductService.createProduct({
          name: 'Placa de Vídeo RTX 4070',
          salePriceCents: 450000,
          purchasePriceCents: 350000,
          category: 'Hardware',
          tenantId: 'tenantA'
        });

        // Sincroniza com RTDB Emulator
        const res = await syncEngine.processQueue();
        expect(res.success).toBe(1);

        // Inspeciona nó real no RTDB Emulator com regras reais
        const rtdbSnap = await get(ref(adminCtx.database(), `tenants/tenantA/products/${productId}`));
        expect(rtdbSnap.exists()).toBe(true);
        const data = rtdbSnap.val();
        expect(data.id).toBe(productId);
        expect(data.name).toBe('Placa de Vídeo RTX 4070');
        expect(data.salePriceCents).toBe(450000);
        expect(data.version).toBe(1);
        expect(data.baseVersion).toBeUndefined();

        // Compara com IndexedDB local
        const localProd = await productRepository.findById(productId);
        expect(localProd.version).toBe(1);
        expect(localProd.salePriceCents).toBe(450000);
        expect(localProd.baseVersion).toBeUndefined();

        syncEngine.destroy();
      });

      it('18.2: Testes negativos no RTDB Emulator: ausência de salePriceCents, tipo inválido e preço negativo são rejeitados', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_2', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        // 1. Ausência de salePriceCents
        let missingPriceFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/p_neg_1'), {
            id: 'p_neg_1',
            name: 'Produto Sem Preco',
            version: 1
          });
        } catch (err) {
          missingPriceFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(missingPriceFailed).toBe(true);

        // 2. Preço de venda com tipo inválido (string)
        let stringPriceFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/p_neg_2'), {
            id: 'p_neg_2',
            name: 'Produto Preco String',
            salePriceCents: '4500',
            version: 1
          });
        } catch (err) {
          stringPriceFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(stringPriceFailed).toBe(true);

        // 3. Preço negativo
        let negPriceFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/products/p_neg_3'), {
            id: 'p_neg_3',
            name: 'Produto Preco Negativo',
            salePriceCents: -100,
            version: 1
          });
        } catch (err) {
          negPriceFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(negPriceFailed).toBe(true);

        // 4. Escrita cross-tenant
        let crossTenantFailed = false;
        try {
          await set(ref(db, 'tenants/tenantB/products/p_neg_4'), {
            id: 'p_neg_4',
            name: 'Produto Invasor',
            salePriceCents: 1000,
            version: 1
          });
        } catch (err) {
          crossTenantFailed = true;
          expect(err.message.toLowerCase()).toContain('permission denied');
        }
        expect(crossTenantFailed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // PARTE 2: Coalescência UPDATE + UPDATE e Concorrência (Seção 4)
    // -----------------------------------------------------------------------
    describe('Parte 2 — Coalescência UPDATE + UPDATE e Concorrência', () => {
      it('18.3: Múltiplas edições offline de produto sincronizado consolidam em baseVersion: 1, version: 2 e reconciliam localmente', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_3', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_3', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        // 1. Cria produto inicial v1 e sincroniza
        const prodId = await ProductService.createProduct({
          name: 'Teclado Mecânico Base',
          salePriceCents: 20000,
          tenantId: 'tenantA'
        });
        await syncEngine.processQueue();

        const snapV1 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
        expect(snapV1.val().version).toBe(1);

        // 2. Simula modo offline
        provider._connected = false;

        // 3. Executa 4 edições offline consecutivas
        const revisions = [
          { name: 'Teclado Mecânico Rev 1', salePriceCents: 21000 },
          { name: 'Teclado Mecânico Rev 2', salePriceCents: 22000 },
          { name: 'Teclado Mecânico Rev 3', salePriceCents: 23000 },
          { name: 'Teclado Mecânico Rev 4', salePriceCents: 24000 }
        ];

        for (const rev of revisions) {
          await ProductService.updateProduct(prodId, { ...rev, tenantId: 'tenantA' });
        }

        // Aguarda transações do IndexedDB
        await new Promise(r => setTimeout(r, 60));

        // 4. Inspeciona Outbox: consolidado em 1 único UPDATE com baseVersion: 1, version: 2
        const pending = await syncRepository.getPending();
        expect(pending.length).toBe(1);
        expect(pending[0].action).toBe('UPDATE');
        expect(pending[0].payload.baseVersion).toBe(1);
        expect(pending[0].payload.version).toBe(2);
        expect(pending[0].payload.name).toBe('Teclado Mecânico Rev 4');
        expect(pending[0].payload.salePriceCents).toBe(24000);

        // 5. Reconecta e sincroniza
        provider._connected = true;
        const resSync = await syncEngine.processQueue();
        expect(resSync.success).toBe(1);

        // 6. Confirma RTDB Emulator: avançou para version: 2 com baseVersion: 1
        const snapV2 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
        expect(snapV2.val().version).toBe(2);
        expect(snapV2.val().baseVersion).toBe(1);
        expect(snapV2.val().name).toBe('Teclado Mecânico Rev 4');
        expect(snapV2.val().salePriceCents).toBe(24000);

        // 7. Confirma que produto local foi reconciliado para version: 2 e baseVersion: 1
        const localProd = await productRepository.findById(prodId);
        expect(localProd.version).toBe(2);
        expect(localProd.baseVersion).toBe(1);

        // 8. Executa próxima edição online e confirma que avança v2 -> v3 sem conflito CAS
        await ProductService.updateProduct(prodId, {
          name: 'Teclado Mecânico Rev 5 Online',
          salePriceCents: 25000,
          tenantId: 'tenantA'
        });

        const resSync2 = await syncEngine.processQueue();
        expect(resSync2.success).toBe(1);

        const snapV3 = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
        expect(snapV3.val().version).toBe(3);
        expect(snapV3.val().baseVersion).toBe(2);
        expect(snapV3.val().name).toBe('Teclado Mecânico Rev 5 Online');

        syncEngine.destroy();
      });

      it('18.4: Concorrência entre edição local e ACK remoto em voo preserva a edição mais recente (Seção 4.4)', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_4', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_4', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        // 1. Produto inicial criado e sincronizado na v1
        const prodId = await ProductService.createProduct({
          name: 'Mouse Gamer Inicial',
          salePriceCents: 15000,
          tenantId: 'tenantA'
        });
        await syncEngine.processQueue();

        // Desconecta temporariamente para enfileirar a Edição 1 sem disparo automático imediato
        provider._connected = false;

        // 2. Usuário faz Edição 1
        await ProductService.updateProduct(prodId, {
          name: 'Mouse Gamer Em Voo',
          salePriceCents: 16000,
          tenantId: 'tenantA'
        });

        await new Promise(r => setTimeout(r, 60));

        // Simula que a Edição 1 entrou em voo (inFlight = true, status = SYNCING)
        const pendingBefore = await syncRepository.getPending();
        expect(pendingBefore.length).toBe(1);
        const item1 = pendingBefore[0];
        item1.inFlight = true;
        item1.status = 'SYNCING';
        await syncRepository.update(item1);

        // 3. Enquanto Edição 1 está em voo, usuário faz Edição 2 localmente
        await ProductService.updateProduct(prodId, {
          name: 'Mouse Gamer Edicao Posterior',
          salePriceCents: 18000,
          tenantId: 'tenantA'
        });

        await new Promise(r => setTimeout(r, 60));

        // 4. Confirma que enqueue NÃO coalesceu no item em voo, mas criou um segundo item PENDING
        const allItems = await syncRepository.findAll(false);
        const productItems = allItems.filter(i => i.entityId === prodId && i.status !== 'SYNCED');
        expect(productItems.length).toBe(2);

        const inFlightItem = productItems.find(i => i.id === item1.id);
        const subsequentItem = productItems.find(i => i.id !== item1.id);
        expect(inFlightItem.inFlight).toBe(true);
        expect(subsequentItem.status).toBe('PENDING');
        expect(subsequentItem.payload.name).toBe('Mouse Gamer Edicao Posterior');

        // 5. Edição 1 recebe ACK remoto do RTDB
        await set(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`), {
          id: prodId,
          name: 'Mouse Gamer Em Voo',
          salePriceCents: 16000,
          baseVersion: 1,
          version: 2
        });
        await syncRepository.markSynced(item1.id, { remoteVersion: 'v2' });

        // 6. SyncEngine executa reconciliação de versão para item1
        await syncEngine._reconcileLocalProductVersion(item1);

        // O resultado da primeira confirmação NÃO pode sobrescrever a edição posterior mais recente!
        const localProdAfterAck1 = await productRepository.findById(prodId);
        expect(localProdAfterAck1.name).toBe('Mouse Gamer Edicao Posterior');
        expect(localProdAfterAck1.salePriceCents).toBe(18000);
        expect(localProdAfterAck1.version).toBe(3);

        // 7. Reconecta e executa segunda sincronização: despacha a Edição 2 com sucesso
        provider._connected = true;
        const resSync2 = await syncEngine.processQueue();
        expect(resSync2.success).toBe(1);

        // RTDB Emulator termina com os valores finais da Edição 2 na v3
        const snapFinal = await get(ref(adminCtx.database(), `tenants/tenantA/products/${prodId}`));
        expect(snapFinal.val().version).toBe(3);
        expect(snapFinal.val().baseVersion).toBe(2);
        expect(snapFinal.val().name).toBe('Mouse Gamer Edicao Posterior');
        expect(snapFinal.val().salePriceCents).toBe(18000);

        syncEngine.destroy();
      });
    });

    // -----------------------------------------------------------------------
    // PARTE 3: Schema Efetivo do Ledger /inventory (Seção 6)
    // -----------------------------------------------------------------------
    describe('Parte 3 — Schema Efetivo do Ledger /inventory', () => {
      it('18.5: Movimento válido no ledger com quantity, delta, type é aceito pelo RTDB Emulator', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_5', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        await set(ref(db, 'tenants/tenantA/inventory/mov_p1418_val'), {
          id: 'mov_p1418_val',
          productId: 'prod_inv_1',
          quantity: 25,
          delta: 25,
          type: 'IN',
          unitCostCents: 1000,
          createdAt: new Date().toISOString()
        });

        const snap = await get(ref(db, 'tenants/tenantA/inventory/mov_p1418_val'));
        expect(snap.exists()).toBe(true);
        expect(snap.val().quantity).toBe(25);
        expect(snap.val().delta).toBe(25);
      });

      it('18.6: Testes negativos no ledger: sem quantity, delta invertido e campos extras rejeitados', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_6', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const db = adminCtx.database();

        // 1. Sem quantity
        let noQtyFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/inventory/mov_neg_noqty'), {
            id: 'mov_neg_noqty',
            productId: 'prod_inv_1',
            delta: 5,
            type: 'IN'
          });
        } catch (err) {
          noQtyFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(noQtyFailed).toBe(true);

        // 2. Quantity zero ou negativa
        let negQtyFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/inventory/mov_neg_zeroqty'), {
            id: 'mov_neg_zeroqty',
            productId: 'prod_inv_1',
            quantity: 0,
            delta: 0,
            type: 'IN'
          });
        } catch (err) {
          negQtyFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(negQtyFailed).toBe(true);

        // 3. Delta com sinal incompatível com o tipo (tipo IN exige delta positivo)
        let mismatchDeltaFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/inventory/mov_neg_mismatch'), {
            id: 'mov_neg_mismatch',
            productId: 'prod_inv_1',
            quantity: 10,
            delta: -10, // Inválido para tipo IN
            type: 'IN'
          });
        } catch (err) {
          mismatchDeltaFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(mismatchDeltaFailed).toBe(true);

        // 4. Campo extra proibido pelo schema fechado ($other: false)
        let extraFieldFailed = false;
        try {
          await set(ref(db, 'tenants/tenantA/inventory/mov_neg_extra'), {
            id: 'mov_neg_extra',
            productId: 'prod_inv_1',
            quantity: 10,
            delta: 10,
            type: 'IN',
            unauthorizedExtraField: 'bad_data'
          });
        } catch (err) {
          extraFieldFailed = true;
          expect(err.message).toContain('PERMISSION_DENIED');
        }
        expect(extraFieldFailed).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // PARTE 4: Recuperação do Ledger: Ausência de Gravação vs ACK Perdido (Seção 7)
    // -----------------------------------------------------------------------
    describe('Parte 4 — Recuperação de Ledger: Cenários A, B, C e D', () => {
      it('18.7: Cenário A — Movimento ainda não gravado remotamente (RECORD_ABSENT) cria exatamente uma gravação', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_7', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_7', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);

        const movId = 'mov_rec_scen_a';
        const item = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movId,
          action: 'CREATE',
          payload: { id: movId, productId: 'prod_scen_a', quantity: 5, delta: 5, type: 'IN' },
          tenantId: 'tenantA'
        });
        item.inFlight = true;
        item.remoteOutcomeUnknown = true;
        await syncRepository.update(item);

        // Executa autoReconcile: consulta RTDB e detecta RECORD_ABSENT
        const rec = await syncEngine.autoReconcileUnknownOutboxItem(item.id);
        expect(rec.reconciled).toBe(true);
        expect(rec.outcome).toBe('RECORD_ABSENT');

        const itemAfterRec = await syncRepository.findById(item.id);
        expect(itemAfterRec.status).toBe('PENDING');

        // Retoma sincronização: cria o registro no RTDB
        const resSync = await syncEngine.processQueue();
        expect(resSync.success).toBe(1);

        const snap = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`));
        expect(snap.exists()).toBe(true);
        expect(snap.val().quantity).toBe(5);

        syncEngine.destroy();
      });

      it('18.8: Cenário B — Movimento gravado remotamente mas ACK local perdido (RECORD_EQUIVALENT) finaliza como SYNCED', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_8', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_8', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);

        const movId = 'mov_rec_scen_b';
        // Pré-grava movimento no RTDB (simula que a escrita ocorreu antes do crash do cliente)
        await set(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`), {
          id: movId,
          productId: 'prod_scen_b',
          quantity: 12,
          delta: -12,
          type: 'OUT',
          createdAt: new Date().toISOString()
        });

        // Enfileira item local que perdeu o ACK
        const item = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movId,
          action: 'CREATE',
          payload: { id: movId, productId: 'prod_scen_b', quantity: 12, delta: -12, type: 'OUT' },
          tenantId: 'tenantA'
        });
        item.inFlight = true;
        item.remoteOutcomeUnknown = true;
        await syncRepository.update(item);

        // Executa autoReconcile: consulta RTDB e detecta RECORD_EQUIVALENT
        const rec = await syncEngine.autoReconcileUnknownOutboxItem(item.id);
        expect(rec.reconciled).toBe(true);
        expect(rec.outcome).toBe('RECORD_EQUIVALENT');

        const itemSynced = await syncRepository.findById(item.id);
        expect(itemSynced.status).toBe('SYNCED');
        expect(itemSynced.remoteAckReceived).toBe(true);

        syncEngine.destroy();
      });

      it('18.9: Cenário C — Mesmo identificador com conteúdo divergente (RECORD_DIVERGENT) bloqueia operação', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_9', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_9', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);

        const movId = 'mov_rec_scen_c';
        // Pré-grava movimento no RTDB com quantity: 5
        await set(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`), {
          id: movId,
          productId: 'prod_scen_c',
          quantity: 5,
          delta: 5,
          type: 'IN',
          createdAt: new Date().toISOString()
        });

        // Mutação local tenta gravar com quantity: 50 (divergência!)
        const item = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movId,
          action: 'CREATE',
          payload: { id: movId, productId: 'prod_scen_c', quantity: 50, delta: 50, type: 'IN' },
          tenantId: 'tenantA'
        });
        item.inFlight = true;
        item.remoteOutcomeUnknown = true;
        await syncRepository.update(item);

        // Executa autoReconcile: detecta divergência e bloqueia!
        const rec = await syncEngine.autoReconcileUnknownOutboxItem(item.id);
        expect(rec.reconciled).toBe(false);
        expect(rec.outcome).toBe('RECORD_DIVERGENT');

        const blockedItem = await syncRepository.findById(item.id);
        expect(blockedItem.status).toBe('FAILED');
        expect(blockedItem.requiresResolution).toBe(true);
        expect(blockedItem.errorCategory).toBe('payload_divergence_conflict');

        // Registro remoto permanece intacto com os dados originais
        const snap = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`));
        expect(snap.val().quantity).toBe(5);

        syncEngine.destroy();
      });

      it('18.10: Cenário D — Corrida entre dois clientes na recuperação converge para o mesmo registro sem duplicar', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_10', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_10', 'tenantA', 'admin', 'admin'));
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

        const syncEngine1 = new SyncEngine(provider1, auth);
        const syncEngine2 = new SyncEngine(provider2, auth);

        const movId = 'mov_race_scen_d';
        const payload = { id: movId, productId: 'prod_race_d', quantity: 8, delta: 8, type: 'IN' };

        // Cliente 1 enfileira e despacha
        const item1 = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movId,
          action: 'CREATE',
          payload,
          tenantId: 'tenantA'
        });
        await syncEngine1.processQueue();

        const snapAfter1 = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`));
        expect(snapAfter1.exists()).toBe(true);

        // Cliente 2 enfileira o mesmo movimento e tenta reconciliar
        const item2 = await syncRepository.enqueue({
          entityType: 'stockMovements',
          entityId: movId,
          action: 'CREATE',
          payload,
          tenantId: 'tenantA'
        });
        item2.inFlight = true;
        item2.remoteOutcomeUnknown = true;
        await syncRepository.update(item2);

        const rec2 = await syncEngine2.autoReconcileUnknownOutboxItem(item2.id);
        expect(rec2.reconciled).toBe(true);
        expect(rec2.outcome).toBe('RECORD_EQUIVALENT');

        const item2Final = await syncRepository.findById(item2.id);
        expect(item2Final.status).toBe('SYNCED');

        syncEngine1.destroy();
        syncEngine2.destroy();
      });
    });

    // -----------------------------------------------------------------------
    // PARTE 5: Integridade de Venda e Compra sob Falha Parcial (Seção 8)
    // -----------------------------------------------------------------------
    describe('Parte 5 — Integridade de Venda e Compra sob Falha Parcial', () => {
      it('18.11: Falha parcial durante envio de venda e ledger: recuperação não duplica nem perde integridade', async () => {
        const adminCtx = testEnv.authenticatedContext('admin_p1418_11', { tenantId: 'tenantA', role: 'admin', appRole: 'admin' });
        const auth = createControllableAuth(createTestSession('admin_p1418_11', 'tenantA', 'admin', 'admin'));
        authService.setProvider(auth);
        setTenantResolver(() => 'tenantA');

        const provider = new FirebaseRealtimeProvider(null, auth);
        provider.db = adminCtx.database();
        provider._initialized = true;
        provider._connected = true;

        const syncEngine = new SyncEngine(provider, auth);
        await syncEngine.init();

        const prodId = await ProductService.createProduct({
          name: 'Item de Venda',
          salePriceCents: 5000,
          purchasePriceCents: 3000,
          tenantId: 'tenantA'
        });
        await syncEngine.processQueue();

        // Adiciona estoque inicial para permitir a venda comercial
        await StockService.recordMovement({
          productId: prodId,
          quantity: 10,
          type: 'IN',
          unitCostCents: 3000,
          tenantId: 'tenantA'
        });
        await syncEngine.processQueue();
        syncEngine.autoSync = false;

        // Cria venda comercial via SaleService.recordSale
        const saleRecord = await SaleService.recordSale({
          productId: prodId,
          quantity: 2,
          unitSalePriceCents: 5000,
          totalSaleCents: 10000,
          paymentMethod: 'PIX',
          tenantId: 'tenantA'
        });
        const saleId = saleRecord.id || saleRecord.saleId;

        // Aguarda listeners assíncronos do eventBus enfileirarem na Outbox
        await new Promise(r => setTimeout(r, 50));

        // Identifica os itens gerados na Outbox (Venda e Movimento de Estoque correspondente)
        const allQueue = await syncRepository.findAll();
        const saleItem = allQueue.find(i => i.entityType === 'sales' && i.entityId === saleId);
        const movItem = allQueue.find(i => (i.entityType === 'stockMovements' || i.entityType === 'inventory') && (i.payload?.referenceId === saleId || i.entityId === `mov_sale_${saleId}`));
        expect(saleItem).toBeDefined();
        expect(movItem).toBeDefined();

        const movId = movItem.entityId;

        // 1. Simula que a Venda foi confirmada remotamente
        await set(ref(adminCtx.database(), `tenants/tenantA/sales/${saleId}`), saleItem.payload);
        await syncRepository.markSynced(saleItem.id);

        // 2. Simula que o Movimento ficou pendente com resultado desconhecido (crash window)
        movItem.inFlight = true;
        movItem.remoteOutcomeUnknown = true;
        await syncRepository.update(movItem);

        // 3. Executa autoReconcile: detecta que movimento não existe no RTDB (RECORD_ABSENT)
        const rec = await syncEngine.autoReconcileUnknownOutboxItem(movItem.id);
        expect(rec.reconciled).toBe(true);
        expect(rec.outcome).toBe('RECORD_ABSENT');

        // 4. Retoma sincronização da fila
        const resSync = await syncEngine.processQueue();
        expect(resSync.success).toBe(1);

        // 5. Confirma existência de exatamente uma venda e um movimento no RTDB
        const rtdbSale = await get(ref(adminCtx.database(), `tenants/tenantA/sales/${saleId}`));
        const rtdbMov = await get(ref(adminCtx.database(), `tenants/tenantA/inventory/${movId}`));
        expect(rtdbSale.exists()).toBe(true);
        expect(rtdbMov.exists()).toBe(true);
        expect(rtdbMov.val().quantity).toBe(2);
        expect(rtdbMov.val().delta).toBe(-2);
        expect(rtdbMov.val().type).toBe('SALE');

        syncEngine.destroy();
      });
    });
  });
});
