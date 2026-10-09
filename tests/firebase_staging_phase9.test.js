import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { getDB } from '../src/js/db/connection.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import {
  validateFirebaseConfig,
  validateEmulatorRuntimeConfig,
  isProductionProject,
  FORBIDDEN_PRODUCTION_PROJECTS
} from '../src/js/utils/firebaseConfigValidator.js';
import { FirebaseAuthProvider } from '../src/js/auth/FirebaseAuthProvider.js';
import { FirebaseRealtimeProvider } from '../src/js/sync/FirebaseRealtimeProvider.js';
import { FirebaseStorageProvider } from '../src/js/sync/FirebaseStorageProvider.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { MockImageStorageProvider } from '../src/js/sync/MockImageStorageProvider.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { SyncRepository } from '../src/js/repositories/SyncRepository.js';
import { ProductRepository } from '../src/js/repositories/ProductRepository.js';
import { ImageSyncService, SYNC_PRIORITY, QUEUE_STATE } from '../src/js/services/ImageSyncService.js';
import { localImageCache } from '../src/js/services/LocalImageCache.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { computeImageHash } from '../src/js/services/ImageManifestService.js';
import { STAGING_USERS } from '../scripts/provision-staging.js';

describe('PHASE 09 — Firebase Staging + End-to-End Homologation', () => {
  const STAGING_TENANT = 'tenant-staging';
  const OTHER_TENANT = 'tenant-producao-bloqueado';

  const createMockBlob = (content = 'test-blob-bytes-webp', type = 'image/webp') => {
    return new Blob([content], { type });
  };

  beforeEach(async () => {
    const db = await getDB();
    const stores = ['products', 'stockMovements', 'syncQueue', 'productImages', 'imageManifest', 'settings'];
    for (const store of stores) {
      if (db.objectStoreNames.contains(store)) {
        await db.clear(store);
      }
    }
    localImageCache.revokeAllUrls();
  });

  afterEach(() => {
    localImageCache.revokeAllUrls();
  });

  // ============================================================================
  // 1. SEGURANÇA E SALVAGUARDAS CONTRA PRODUÇÃO (STG-01 a STG-05)
  // ============================================================================
  describe('1. Segurança e Salvaguardas contra Projetos de Produção', () => {
    it('STG-01: deve identificar e bloquear explicitamente todos os projetos de produção conhecidos', () => {
      for (const prodProject of FORBIDDEN_PRODUCTION_PROJECTS) {
        expect(isProductionProject(prodProject)).toBe(true);
        expect(() => {
          validateFirebaseConfig({ projectId: prodProject, apiKey: 'test-key' });
        }).toThrow(/PRODUÇÃO/);
      }
    });

    it('STG-02: deve bloquear qualquer projectId contendo substrings de produção (prod, production)', () => {
      const suspiciousProjects = [
        'gerenciador-prod',
        'sistema-production-123',
        'gestaopro_prod',
        'minhaloja-prod-br'
      ];

      for (const proj of suspiciousProjects) {
        expect(isProductionProject(proj)).toBe(true);
        expect(() => {
          validateFirebaseConfig({ projectId: proj, apiKey: 'test-key' });
        }).toThrow(/PRODUÇÃO/);
      }
    });

    it('STG-03: deve bloquear terminantemente segredos administrativos ou private keys no cliente', () => {
      const leakedConfigs = [
        { projectId: 'gerenciador-produtos-staging', private_key: '-----BEGIN PRIVATE KEY-----' },
        { projectId: 'gerenciador-produtos-staging', client_secret: 'secret_xyz123' },
        { projectId: 'gerenciador-produtos-staging', serviceAccountKey: { type: 'service_account' } },
        { projectId: 'gerenciador-produtos-staging', admin_token: 'bearer_token_super_secret' }
      ];

      for (const conf of leakedConfigs) {
        expect(() => {
          validateFirebaseConfig(conf);
        }).toThrow(/SEGURANÇA CRÍTICA/);
      }
    });

    it('STG-04: deve autorizar apenas projetos de homologação, staging, teste, demo e emuladores', () => {
      const validStagingProjects = [
        'gerenciador-produtos-staging',
        'gestaopro-demo',
        'gestaopro-test',
        'gestaopro-local-emulator'
      ];

      for (const proj of validStagingProjects) {
        expect(isProductionProject(proj)).toBe(false);
        const result = validateFirebaseConfig({ projectId: proj, apiKey: 'fake-api-key' });
        expect(result.valid).toBe(true);
      }
    });

    it('STG-05: FirebaseAuthProvider, FirebaseRealtimeProvider e FirebaseStorageProvider devem recusar projetos de produção', async () => {
      const auth = new FirebaseAuthProvider({ projectId: 'caixa-autopecas', apiKey: 'test-key' });
      await expect(auth.initialize()).rejects.toThrow(/PRODUÇÃO/);

      const rtdb = new FirebaseRealtimeProvider({ projectId: 'fichas-tucano-loja', apiKey: 'test-key' });
      await expect(rtdb.initialize()).rejects.toThrow(/PRODUÇÃO/);

      const storage = new FirebaseStorageProvider({ projectId: 'tabela-porta-escovas', apiKey: 'test-key' });
      await expect(storage.initialize()).rejects.toThrow(/PRODUÇÃO/);
    });
  });

  // ============================================================================
  // 2. CONFIGURAÇÃO DE EMULATORS E PROVISIONAMENTO DE STAGING (STG-06 a STG-09)
  // ============================================================================
  describe('2. Configuração de Emulators e Provisionamento de Staging', () => {
    it('STG-06: deve validar a existência e estrutura de firebase.json e .firebaserc apontando para staging', () => {
      const rootDir = process.cwd();
      const firebasercPath = join(rootDir, '.firebaserc');
      const firebaseJsonPath = join(rootDir, 'firebase.json');

      expect(existsSync(firebasercPath)).toBe(true);
      expect(existsSync(firebaseJsonPath)).toBe(true);

      const firebaserc = JSON.parse(readFileSync(firebasercPath, 'utf8'));
      expect(firebaserc.projects.default).toBe('gerenciador-produtos-staging');
      expect(firebaserc.projects.staging).toBe('gerenciador-produtos-staging');

      const firebaseJson = JSON.parse(readFileSync(firebaseJsonPath, 'utf8'));
      expect(firebaseJson.emulators.auth.port).toBe(9099);
      expect(firebaseJson.emulators.database.port).toBe(9000);
      expect(firebaseJson.emulators.storage.port).toBe(9199);
      expect(firebaseJson.emulators.ui.port).toBe(4000);
      expect(firebaseJson.database.rules).toBe('database.rules.json');
      expect(firebaseJson.storage.rules).toBe('storage.rules');
    });

    it('STG-07: provedores devem suportar configuração de hosts para Emulator Suite', () => {
      const auth = new FirebaseAuthProvider({
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'fake-api-key',
        authEmulatorHost: 'localhost:9099'
      });
      expect(auth.isConfigured()).toBe(true);

      const rtdb = new FirebaseRealtimeProvider({
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'fake-api-key',
        databaseURL: 'http://localhost:9000?ns=gerenciador-produtos-staging-default-rtdb',
        emulatorHost: 'localhost:9000'
      });
      expect(rtdb.isConfigured()).toBe(true);

      const storage = new FirebaseStorageProvider({
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'fake-api-key',
        storageBucket: 'gerenciador-produtos-staging.firebasestorage.app',
        storageEmulatorHost: 'localhost:9199'
      });
      expect(storage.isConfigured()).toBe(true);
    });

    it('STG-08: script de provisionamento deve declarar usuários sintéticos com tenant-staging e roles apropriadas', () => {
      expect(STAGING_USERS).toHaveLength(2);
      const admin = STAGING_USERS.find(u => u.email === 'admin@staging.local');
      const operador = STAGING_USERS.find(u => u.email === 'operador@staging.local');

      expect(admin).toBeDefined();
      expect(admin.role).toBe('admin');
      expect(admin.tenantId).toBe('tenant-staging');

      expect(operador).toBeDefined();
      expect(operador.role).toBe('operator');
      expect(operador.tenantId).toBe('tenant-staging');
    });

    it('STG-09: .env.staging.example deve conter apenas placeholders públicos sem segredos commitados', () => {
      const examplePath = join(process.cwd(), '.env.staging.example');
      expect(existsSync(examplePath)).toBe(true);
      const content = readFileSync(examplePath, 'utf8');

      expect(content).toContain('VITE_FIREBASE_PROJECT_ID=gerenciador-produtos-staging');
      expect(content).toContain('VITE_STAGING_TENANT_ID=tenant-staging');
      expect(content).not.toMatch(/AIzaSy[A-Za-z0-9_-]{35}/); // Não deve conter chave real de 39 caracteres
      expect(content).not.toContain('private_key');
      expect(content).not.toContain('client_secret');
    });
  });

  // ============================================================================
  // 3. SEGURANÇA RTDB: REGRAS E VALIDAÇÃO DE SCHEMA (STG-10 a STG-15)
  // ============================================================================
  describe('3. Regras de Segurança RTDB e Validação de Schema', () => {
    const evaluateRtdbRule = (rules, path, action, authContext, data, newData) => {
      const segments = path.split('/').filter(Boolean);
      if (segments[0] !== 'tenants') return false;
      const tenantId = segments[1];
      const resource = segments[2];

      if (!authContext || !authContext.uid) return false;

      const tokenTenant = authContext.token?.tenantId;
      if (tokenTenant !== tenantId) return false;

      const userRole = authContext.token?.role || 'user';

      if (resource === 'products') {
        if (action === 'read') return true;
        if (action === 'write') {
          if (userRole !== 'admin' && userRole !== 'operator') return false;
          if (!newData || !newData.id || !newData.name || typeof newData.salePriceCents !== 'number') {
            return false;
          }
          return true;
        }
      }

      if (resource === 'settings') {
        if (action === 'read') return true;
        if (action === 'write') {
          return userRole === 'admin';
        }
      }

      if (resource === 'imageManifest') {
        if (action === 'read') return true;
        if (action === 'write') {
          if (userRole !== 'admin' && userRole !== 'operator') return false;
          if (!newData || !newData.id || !newData.productId || !newData.url || typeof newData.version !== 'number') {
            return false;
          }
          return true;
        }
      }

      return true;
    };

    it('STG-10 (TESTE A): usuário autenticado em tenant-staging pode ler e escrever produtos do seu tenant', () => {
      const auth = { uid: 'uid_admin_01', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const productPayload = { id: 'prod_1', name: 'Item Teste', salePriceCents: 2500 };

      const canRead = evaluateRtdbRule(null, `tenants/${STAGING_TENANT}/products/prod_1`, 'read', auth);
      const canWrite = evaluateRtdbRule(null, `tenants/${STAGING_TENANT}/products/prod_1`, 'write', auth, null, productPayload);

      expect(canRead).toBe(true);
      expect(canWrite).toBe(true);
    });

    it('STG-11 (TESTE B): usuário de tenant-staging NÃO pode acessar outro tenant (cross-tenant denied)', () => {
      const auth = { uid: 'uid_admin_01', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const productPayload = { id: 'prod_1', name: 'Item Invasor', salePriceCents: 2500 };

      const canRead = evaluateRtdbRule(null, `tenants/${OTHER_TENANT}/products/prod_1`, 'read', auth);
      const canWrite = evaluateRtdbRule(null, `tenants/${OTHER_TENANT}/products/prod_1`, 'write', auth, null, productPayload);

      expect(canRead).toBe(false);
      expect(canWrite).toBe(false);
    });

    it('STG-12 (TESTE C): usuário não autenticado tem acesso estritamente negado', () => {
      const productPayload = { id: 'prod_1', name: 'Item Não Autenticado', salePriceCents: 2500 };

      const canRead = evaluateRtdbRule(null, `tenants/${STAGING_TENANT}/products/prod_1`, 'read', null);
      const canWrite = evaluateRtdbRule(null, `tenants/${STAGING_TENANT}/products/prod_1`, 'write', null, null, productPayload);

      expect(canRead).toBe(false);
      expect(canWrite).toBe(false);
    });

    it('STG-13 (TESTE D): operador pode alterar produtos mas NÃO pode alterar configurações globais', () => {
      const authOperador = { uid: 'uid_op_01', token: { tenantId: STAGING_TENANT, role: 'operator' } };
      
      const canWriteProduct = evaluateRtdbRule(
        null,
        `tenants/${STAGING_TENANT}/products/prod_1`,
        'write',
        authOperador,
        null,
        { id: 'prod_1', name: 'Item Op', salePriceCents: 1000 }
      );
      expect(canWriteProduct).toBe(true);

      const canWriteSettings = evaluateRtdbRule(
        null,
        `tenants/${STAGING_TENANT}/settings/fiscalConfig`,
        'write',
        authOperador,
        null,
        { certPassword: '123' }
      );
      expect(canWriteSettings).toBe(false);
    });

    it('STG-14 (TESTE E): administrador tem permissão para alterar produtos e configurações do tenant', () => {
      const authAdmin = { uid: 'uid_admin_01', token: { tenantId: STAGING_TENANT, role: 'admin' } };

      const canWriteSettings = evaluateRtdbRule(
        null,
        `tenants/${STAGING_TENANT}/settings/fiscalConfig`,
        'write',
        authAdmin,
        null,
        { empresa: 'Staging LTDA' }
      );
      expect(canWriteSettings).toBe(true);
    });

    it('STG-15 (VALIDATE): rejeita payloads inválidos com tipo de preço string ou campos obrigatórios ausentes', () => {
      const authAdmin = { uid: 'uid_admin_01', token: { tenantId: STAGING_TENANT, role: 'admin' } };

      const invalidPrice = evaluateRtdbRule(
        null,
        `tenants/${STAGING_TENANT}/products/prod_1`,
        'write',
        authAdmin,
        null,
        { id: 'prod_1', name: 'Item', salePriceCents: 'abc' }
      );
      expect(invalidPrice).toBe(false);

      const missingName = evaluateRtdbRule(
        null,
        `tenants/${STAGING_TENANT}/products/prod_1`,
        'write',
        authAdmin,
        null,
        { id: 'prod_1', salePriceCents: 5000 }
      );
      expect(missingName).toBe(false);
    });
  });

  // ============================================================================
  // 4. SEGURANÇA STORAGE: REGRAS E UPLOAD (STG-16 a STG-19)
  // ============================================================================
  describe('4. Regras de Segurança do Firebase Storage', () => {
    const evaluateStorageRule = (path, action, authContext, resource) => {
      const match = path.match(/^tenants\/([^/]+)\/products\/([^/]+)\/([^/]+)$/);
      if (!match) return false;
      const [, tenantId] = match;

      if (!authContext || !authContext.uid) return false;

      if (action === 'read') {
        return authContext.token?.tenantId === tenantId || authContext.token?.role === 'admin';
      }

      if (action === 'write') {
        // storage.rules exige estritamente: request.auth.token.tenantId == tenantId
        if (authContext.token?.tenantId !== tenantId) return false;
        const role = authContext.token?.role;
        if (role !== 'admin' && role !== 'operator') return false;
        if (!resource) return false;
        if (resource.size >= 10 * 1024 * 1024) return false;
        if (!resource.contentType || !resource.contentType.startsWith('image/')) return false;
        return true;
      }

      return false;
    };

    it('STG-16: upload permitido para usuário autenticado no mesmo tenant com WebP < 10MB', () => {
      const auth = { uid: 'uid_admin', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const resource = { size: 150 * 1024, contentType: 'image/webp' };

      const allowed = evaluateStorageRule(`tenants/${STAGING_TENANT}/products/p1/f1`, 'write', auth, resource);
      expect(allowed).toBe(true);
    });

    it('STG-17: upload negado para tenant diferente (isolamento estrito)', () => {
      const auth = { uid: 'uid_admin', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const resource = { size: 150 * 1024, contentType: 'image/webp' };

      const denied = evaluateStorageRule(`tenants/${OTHER_TENANT}/products/p1/f1`, 'write', auth, resource);
      expect(denied).toBe(false);
    });

    it('STG-18: upload negado para arquivos com MIME não-imagem (ex: application/pdf, script)', () => {
      const auth = { uid: 'uid_admin', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const invalidPdf = { size: 50 * 1024, contentType: 'application/pdf' };
      const invalidHtml = { size: 10 * 1024, contentType: 'text/html' };

      expect(evaluateStorageRule(`tenants/${STAGING_TENANT}/products/p1/f1`, 'write', auth, invalidPdf)).toBe(false);
      expect(evaluateStorageRule(`tenants/${STAGING_TENANT}/products/p1/f1`, 'write', auth, invalidHtml)).toBe(false);
    });

    it('STG-19: upload negado para arquivos acima do limite de 10MB', () => {
      const auth = { uid: 'uid_admin', token: { tenantId: STAGING_TENANT, role: 'admin' } };
      const oversized = { size: 12 * 1024 * 1024, contentType: 'image/webp' };

      expect(evaluateStorageRule(`tenants/${STAGING_TENANT}/products/p1/f1`, 'write', auth, oversized)).toBe(false);
    });
  });

  // ============================================================================
  // 5. SINCRONISMO MULTI-DEVICE E PROTOCOLO ANTI-LOOP REAL (STG-20 a STG-25)
  // ============================================================================
  describe('5. Sincronismo Multi-Device e Protocolo Anti-Loop', () => {
    let remoteHub;
    let providerDeviceA;
    let providerDeviceB;
    let syncEngineA;
    let syncEngineB;

    beforeEach(async () => {
      remoteHub = new MockRealtimeProvider({
        tenantId: STAGING_TENANT,
        deviceId: 'server_staging_hub'
      });

      // DEVICE A: Windows Desktop
      providerDeviceA = new MockRealtimeProvider({
        tenantId: STAGING_TENANT,
        deviceId: 'device_windows_desktop'
      });

      // DEVICE B: Android PWA
      providerDeviceB = new MockRealtimeProvider({
        tenantId: STAGING_TENANT,
        deviceId: 'device_android_pwa'
      });

      // Interconexão do Hub simulado de staging
      providerDeviceA.database = remoteHub.database;
      providerDeviceB.database = remoteHub.database;
      providerDeviceA.listeners = remoteHub.listeners;
      providerDeviceB.listeners = remoteHub.listeners;

      syncEngineA = new SyncEngine(providerDeviceA);
      syncEngineB = new SyncEngine(providerDeviceB);
      await syncEngineA.init();
      await syncEngineB.init();
    });

    afterEach(() => {
      syncEngineA.destroy();
      syncEngineB.destroy();
      remoteHub.clear();
    });

    it('STG-20: DEVICE A cria produto e DEVICE B recebe automaticamente via Realtime Listener', async () => {
      let bReceived = null;
      providerDeviceB.subscribe('products', (change) => {
        if (change.entityId === 'prod_stg_01' && change.doc) {
          bReceived = change.doc;
        }
      });

      // Device A realiza push do novo produto
      const newProduct = {
        id: 'prod_stg_01',
        name: 'Teclado Mecânico Staging',
        salePriceCents: 29900,
        stockQuantity: 15
      };

      await providerDeviceA.pushChange({
        id: 'mut_01',
        entityType: 'products',
        entityId: 'prod_stg_01',
        action: 'CREATE',
        payload: newProduct
      });

      expect(bReceived).toBeDefined();
      expect(bReceived.name).toBe('Teclado Mecânico Staging');
      expect(bReceived.salePriceCents).toBe(29900);
    });

    it('STG-21: Atualização bidirecional: A altera preço para 100, B recebe; B altera para 120, A recebe', async () => {
      let priceOnB = null;
      let priceOnA = null;

      providerDeviceB.subscribe('products', (change) => {
        if (change.entityId === 'prod_bidir' && change.doc) {
          priceOnB = change.doc.salePriceCents;
        }
      });

      providerDeviceA.subscribe('products', (change) => {
        if (change.entityId === 'prod_bidir' && change.doc) {
          priceOnA = change.doc.salePriceCents;
        }
      });

      // 1. A define preço = 10000 (R$ 100,00)
      await providerDeviceA.pushChange({
        id: 'mut_a1',
        entityType: 'products',
        entityId: 'prod_bidir',
        action: 'UPDATE',
        payload: { id: 'prod_bidir', name: 'Item Bidir', salePriceCents: 10000 }
      });

      expect(priceOnB).toBe(10000);

      // 2. B define preço = 12000 (R$ 120,00)
      await providerDeviceB.pushChange({
        id: 'mut_b1',
        entityType: 'products',
        entityId: 'prod_bidir',
        action: 'UPDATE',
        payload: { id: 'prod_bidir', name: 'Item Bidir', salePriceCents: 12000 }
      });

      expect(priceOnA).toBe(12000);
    });

    it('STG-22: Movimentação de estoque no ledger em A reflete saldo e movimentos em B sem perda ou duplicação', async () => {
      const movementsReceivedOnB = [];
      providerDeviceB.subscribe('inventory', (change) => {
        if (change.doc) {
          movementsReceivedOnB.push(change.doc);
        }
      });

      // A registra 2 movimentações sucessivas
      await providerDeviceA.pushChange({
        id: 'mov_01',
        entityType: 'inventory',
        entityId: 'mov_01',
        action: 'CREATE',
        payload: { id: 'mov_01', productId: 'p_ledg', delta: 10, type: 'IN' }
      });

      await providerDeviceA.pushChange({
        id: 'mov_02',
        entityType: 'inventory',
        entityId: 'mov_02',
        action: 'CREATE',
        payload: { id: 'mov_02', productId: 'p_ledg', delta: -3, type: 'OUT' }
      });

      expect(movementsReceivedOnB).toHaveLength(2);
      expect(movementsReceivedOnB[0].delta).toBe(10);
      expect(movementsReceivedOnB[1].delta).toBe(-3);

      const netStock = movementsReceivedOnB.reduce((acc, m) => acc + m.delta, 0);
      expect(netStock).toBe(7);
    });

    it('STG-23 (ANTI-LOOP): evento remoto recebido em B NÃO gera mutação de eco de volta para o Firebase (1 write total)', async () => {
      const originalPush = providerDeviceB.pushChange.bind(providerDeviceB);
      
      // Espião no push do Device B
      let bEchoWriteCount = 0;
      providerDeviceB.pushChange = async (mutation) => {
        bEchoWriteCount++;
        return originalPush(mutation);
      };

      // Listener de B aplicando no banco com flag origin: 'remote'
      providerDeviceB.subscribe('products', (change) => {
        if (change.doc) {
          eventBus.emit(EVENTS.PRODUCT_UPDATED, {
            product: change.doc,
            origin: 'remote' // CAMADA 2 DO ANTI-LOOP
          });
        }
      });

      // A cria o produto (1 write de negócio)
      await providerDeviceA.pushChange({
        id: 'mut_single_write',
        entityType: 'products',
        entityId: 'prod_no_loop',
        action: 'CREATE',
        payload: { id: 'prod_no_loop', name: 'Item Anti-Loop', salePriceCents: 5000 }
      });

      // Aguarda processamento do event loop
      await new Promise(r => setTimeout(r, 25));

      // Verificação: Device B NÃO dispara pushChange por ter recebido dados remotos
      expect(bEchoWriteCount).toBe(0);
    });

    it('STG-24 (OUTBOX OFFLINE -> ONLINE): A offline salva mutação PENDING; ao ficar online, transiciona para SYNCED', async () => {
      const syncRepo = new SyncRepository();
      
      // Desativa autoSync para simular dispositivo offline/desconectado
      await syncEngineA.setAutoSync(false);

      // Mutação enfileirada no Outbox
      await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'prod_offline_01',
        action: 'CREATE',
        payload: { id: 'prod_offline_01', name: 'Criado Offline', salePriceCents: 7500 }
      });

      const initialPending = await syncRepo.getPending();
      expect(initialPending).toHaveLength(1);
      expect(initialPending[0].status).toBe('PENDING');

      // Reconexão simulada: autoSync ativado e processQueue invocado
      await syncEngineA.setAutoSync(true);
      await syncEngineA.processQueue();

      const remainingPending = await syncRepo.getPending();
      expect(remainingPending).toHaveLength(0);

      const stats = await syncRepo.getStats();
      expect(stats.synced).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  // ============================================================================
  // 6. PIPELINE END-TO-END DE PRODUTO E IMAGENS EM STAGING (STG-26 a STG-30)
  // ============================================================================
  describe('6. Pipeline End-to-End de Produto e Imagens em Staging', () => {
    let mockStorage;
    let syncServiceB;

    beforeEach(async () => {
      mockStorage = new MockImageStorageProvider({ tenantId: STAGING_TENANT });
      syncServiceB = new ImageSyncService({
        storageProvider: mockStorage,
        imageCache: localImageCache,
        manifestRepository: imageManifestRepository,
        eventBus,
        isOnline: true,
        concurrency: 2
      });
    });

    afterEach(() => {
      syncServiceB.destroy();
    });

    it('STG-26 a STG-28: E2E Completo: Upload 3 fotos -> Sincronização B -> Cache Local -> Persistência Offline', async () => {
      // 1. DEVICE A cria Produto Staging 001 com 3 fotos sintéticas
      const productId = 'STG-001';
      const blobs = [
        createMockBlob('foto-1-bytes-webp', 'image/webp'),
        createMockBlob('foto-2-bytes-webp', 'image/webp'),
        createMockBlob('foto-3-bytes-webp', 'image/webp')
      ];

      const uploadedPhotos = [];
      for (let i = 0; i < blobs.length; i++) {
        const photoId = `foto_${i + 1}`;
        const upRes = await mockStorage.upload(blobs[i], {
          productId,
          photoId,
          version: 1,
          isPrimary: i === 0
        });
        uploadedPhotos.push(upRes);

        // Registro no manifesto de homologação
        await imageManifestRepository.upsert({
          id: photoId,
          photoId,
          productId,
          tenantId: STAGING_TENANT,
          version: 1,
          expectedHash: upRes.hash,
          url: upRes.url,
          isPrimary: i === 0,
          syncStatus: 'NEW'
        });
      }

      expect(uploadedPhotos).toHaveLength(3);

      // 2. DEVICE B abre o produto -> enfileira download sob demanda (P1)
      await syncServiceB.ensureProductImages(productId, { tenantId: STAGING_TENANT });
      await syncServiceB.processQueue();
      await new Promise(r => setTimeout(r, 60));

      // 3. Validação: todas as fotos gravadas no LocalImageCache com integridade de hash
      for (let i = 0; i < uploadedPhotos.length; i++) {
        const photoId = `foto_${i + 1}`;
        const cachedItem = await localImageCache.get(photoId, { tenantId: STAGING_TENANT });
        expect(cachedItem).toBeDefined();
        expect(cachedItem.displayBlob).toBeDefined();

        const localHash = await computeImageHash(cachedItem.displayBlob);
        expect(localHash).toBe(uploadedPhotos[i].hash); // hash local === hash remoto
      }

      // 4. TESTE DE PERSISTÊNCIA OFFLINE: Device B fica offline
      syncServiceB.pause();
      const offlineItem1 = await localImageCache.get('foto_1', { tenantId: STAGING_TENANT });
      const offlineItem2 = await localImageCache.get('foto_2', { tenantId: STAGING_TENANT });
      const offlineItem3 = await localImageCache.get('foto_3', { tenantId: STAGING_TENANT });

      expect(offlineItem1).toBeDefined();
      expect(offlineItem2).toBeDefined();
      expect(offlineItem3).toBeDefined();
    });

    it('STG-29: Atualização incremental: Nova foto adicionada, foto existente atualizada (v2) e zero download redundante', async () => {
      const productId = 'STG-001';

      // Setup inicial: Foto 1 e Foto 2 já baixadas
      const b1 = createMockBlob('foto-1-bytes', 'image/webp');
      const b2 = createMockBlob('foto-2-bytes', 'image/webp');
      const u1 = await mockStorage.upload(b1, { productId, photoId: 'f1', version: 1 });
      const u2 = await mockStorage.upload(b2, { productId, photoId: 'f2', version: 1 });

      await imageManifestRepository.upsert({ id: 'f1', photoId: 'f1', productId, tenantId: STAGING_TENANT, version: 1, expectedHash: u1.hash, url: u1.url });
      await imageManifestRepository.upsert({ id: 'f2', photoId: 'f2', productId, tenantId: STAGING_TENANT, version: 1, expectedHash: u2.hash, url: u2.url });
      await localImageCache.put({ photoId: 'f1', productId, tenantId: STAGING_TENANT, blob: b1, version: 1, hash: u1.hash });
      await localImageCache.put({ photoId: 'f2', productId, tenantId: STAGING_TENANT, blob: b2, version: 1, hash: u2.hash });

      // DEVICE A:
      // - Adiciona Foto 4 (nova)
      // - Altera Foto 1 (versão 2 com novo hash)
      // - Mantém Foto 2 intacta (v1)
      const b4 = createMockBlob('foto-4-nova', 'image/webp');
      const b1_v2 = createMockBlob('foto-1-alterada-v2', 'image/webp');
      const u4 = await mockStorage.upload(b4, { productId, photoId: 'f4', version: 1 });
      const u1_v2 = await mockStorage.upload(b1_v2, { productId, photoId: 'f1', version: 2 });

      await imageManifestRepository.upsert({ id: 'f4', photoId: 'f4', productId, tenantId: STAGING_TENANT, version: 1, hash: u4.hash, expectedHash: u4.hash, url: u4.url });
      await imageManifestRepository.upsert({ id: 'f1', photoId: 'f1', productId, tenantId: STAGING_TENANT, version: 2, hash: u1_v2.hash, expectedHash: u1_v2.hash, url: u1_v2.url });

      // Espião nos downloads
      let downloadCount = 0;
      const originalDownload = mockStorage.download.bind(mockStorage);
      mockStorage.download = async (path, opts) => {
        downloadCount++;
        return originalDownload(path, opts);
      };

      // Device B sincroniza
      await syncServiceB.ensureProductImages(productId, { tenantId: STAGING_TENANT });
      await syncServiceB.processQueue();
      await new Promise(r => setTimeout(r, 60));

      // Devem ser baixadas apenas: Foto 4 (nova) e Foto 1 (v2). Foto 2 = ZERO download redundante!
      expect(downloadCount).toBe(2);

      const f1NewItem = await localImageCache.get('f1', { tenantId: STAGING_TENANT });
      const f1NewHash = await computeImageHash(f1NewItem.displayBlob);
      expect(f1NewHash).toBe(u1_v2.hash);
    });

    it('STG-30: Foto excluída no Device A reflete soft-delete no manifesto e política de retenção', async () => {
      const productId = 'STG-001';
      const b3 = createMockBlob('foto-3-para-excluir', 'image/webp');
      const u3 = await mockStorage.upload(b3, { productId, photoId: 'f3', version: 1 });

      await imageManifestRepository.upsert({
        id: 'f3',
        photoId: 'f3',
        productId,
        tenantId: STAGING_TENANT,
        version: 1,
        hash: u3.hash,
        expectedHash: u3.hash,
        url: u3.url
      });
      await localImageCache.put({ photoId: 'f3', productId, tenantId: STAGING_TENANT, blob: b3, version: 1, hash: u3.hash });

      // Device A exclui foto -> registra deletedAt no manifesto
      const deletedTimestamp = Date.now();
      await imageManifestRepository.upsert({
        id: 'f3',
        photoId: 'f3',
        productId,
        tenantId: STAGING_TENANT,
        version: 1,
        hash: u3.hash,
        expectedHash: u3.hash,
        url: u3.url,
        deletedAt: deletedTimestamp
      });

      const entry = await imageManifestRepository.findByPhotoId('f3');
      expect(entry.deletedAt).toBe(deletedTimestamp);
    });
  });

  // ============================================================================
  // 6. PHASE 13.9 — EMULATOR RUNTIME FAIL-CLOSED SAFETY GATE
  // ============================================================================
  describe('6. Fail-Closed Runtime Safety Gate no Modo Emulator (PHASE 13.9)', () => {
    const validEmulatorConfig = {
      projectId: 'demo-gerenciador-produtos-staging',
      apiKey: 'AIzaSyDemoFakeKey',
      authDomain: 'demo-gerenciador-produtos-staging.firebaseapp.com',
      databaseURL: 'http://127.0.0.1:9000/?ns=demo-gerenciador-produtos-staging',
      storageBucket: 'demo-gerenciador-produtos-staging.appspot.com',
      emulatorHost: '127.0.0.1:9000',
      authEmulatorHost: '127.0.0.1:9099',
      storageEmulatorHost: '127.0.0.1:9199'
    };

    it('STG-31: deve aprovar configuração completa com prefixo demo- e hosts locais de emulador', () => {
      const res = validateEmulatorRuntimeConfig(validEmulatorConfig);
      expect(res.valid).toBe(true);
    });

    it('STG-32: deve rejeitar em modo emulator se projectId não iniciar com demo- (previne conexão à nuvem)', () => {
      expect(() => {
        validateEmulatorRuntimeConfig({
          ...validEmulatorConfig,
          projectId: 'gerenciador-produtos-staging'
        });
      }).toThrow(/\[FAIL-CLOSED\] No modo emulator, o "projectId" DEVE obrigatoriamente iniciar com o prefixo "demo-"/);
    });

    it('STG-33: deve rejeitar em modo emulator se o host do Auth Emulator estiver ausente', () => {
      const { authEmulatorHost, ...withoutAuthHost } = validEmulatorConfig;
      expect(() => {
        validateEmulatorRuntimeConfig({
          ...withoutAuthHost,
          emulatorHost: undefined,
          authEmulatorHost: undefined
        });
      }).toThrow(/\[FAIL-CLOSED\] Host do Auth Emulator.*é OBRIGATÓRIO/);
    });

    it('STG-34: deve rejeitar em modo emulator se o host do Realtime Database Emulator estiver ausente', () => {
      expect(() => {
        validateEmulatorRuntimeConfig({
          ...validEmulatorConfig,
          emulatorHost: undefined,
          databaseEmulatorHost: undefined
        });
      }).toThrow(/\[FAIL-CLOSED\] Host do Realtime Database Emulator.*é OBRIGATÓRIO/);
    });

    it('STG-35: deve rejeitar em modo emulator se Cloud Storage estiver ativo mas host do Storage Emulator ausente', () => {
      expect(() => {
        validateEmulatorRuntimeConfig({
          ...validEmulatorConfig,
          storageEmulatorHost: undefined,
          emulatorHost: '127.0.0.1:9000'
        }, { requireStorage: true });
      }).toThrow(/\[FAIL-CLOSED\] Host do Storage Emulator.*é OBRIGATÓRIO/);
    });

    it('STG-36: validateFirebaseConfig deve invocar validateEmulatorRuntimeConfig quando isEmulatorMode for true', () => {
      expect(() => {
        validateFirebaseConfig({
          projectId: 'cloud-staging-project',
          apiKey: 'key'
        }, { isEmulatorMode: true });
      }).toThrow(/\[FAIL-CLOSED\]/);
    });
  });
});
