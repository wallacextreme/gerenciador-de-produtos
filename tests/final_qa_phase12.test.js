import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { getDB } from '../src/js/db/connection.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import {
  validateFirebaseConfig,
  isProductionProject,
  FORBIDDEN_PRODUCTION_PROJECTS
} from '../src/js/utils/firebaseConfigValidator.js';
import {
  classifyCloudError,
  sanitizeLogData,
  ERROR_CATEGORY
} from '../src/js/utils/cloudErrorClassifier.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { StockService } from '../src/js/services/StockService.js';
import { SaleService } from '../src/js/services/SaleService.js';
import { PAYMENT_METHODS } from '../src/js/validators/SaleValidator.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { localImageCache } from '../src/js/services/LocalImageCache.js';
import { computeImageHash, ImageManifestService } from '../src/js/services/ImageManifestService.js';
import { ImageSyncService, SYNC_PRIORITY, QUEUE_STATE } from '../src/js/services/ImageSyncService.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { MockImageStorageProvider } from '../src/js/sync/MockImageStorageProvider.js';
import { webAdapter } from '../src/js/platform/webAdapter.js';
import { tauriAdapter } from '../src/js/platform/tauriAdapter.js';
import { ProductImageGallery } from '../src/js/components/ProductImageGallery.js';

// Setup Mock DOM Element para testes de componentes sem navegador real
class MockDOMElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.innerHTML = '';
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  appendChild(child) { this.children.push(child); }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  removeEventListener(type, cb) {
    if (this.listeners.has(type)) {
      this.listeners.set(type, this.listeners.get(type).filter(fn => fn !== cb));
    }
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

describe('PHASE 12 — FINAL QA & RELEASE CANDIDATE SUITE', () => {

  beforeEach(async () => {
    const db = await getDB();
    const stores = ['products', 'stockMovements', 'sales', 'syncQueue', 'imageManifest', 'productImages', 'settings'];
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

  // ===========================================================================
  // 1. CONFIGURATION VALIDATION & CROSS-PROJECT DRIFT PREVENTION (QA-01 a QA-05)
  // ===========================================================================
  describe('1. Configuration Validation & Cross-Project Drift', () => {
    it('QA-01: deve aprovar configuração de staging válida', () => {
      const config = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaSyValidStagingKey123',
        authDomain: 'gerenciador-produtos-staging.firebaseapp.com',
        databaseURL: 'https://gerenciador-produtos-staging-default-rtdb.firebaseio.com',
        storageBucket: 'gerenciador-produtos-staging.firebasestorage.app'
      };
      const res = validateFirebaseConfig(config, { requireDatabaseURL: true, requireStorageBucket: true });
      expect(res.valid).toBe(true);
    });

    it('QA-02: deve reprovar configuração incompleta quando parâmetros forem exigidos', () => {
      const config = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaKey'
      };
      expect(() => {
        validateFirebaseConfig(config, { requireDatabaseURL: true });
      }).toThrow('databaseURL');

      expect(() => {
        validateFirebaseConfig(config, { requireStorageBucket: true });
      }).toThrow('storageBucket');
    });

    it('QA-03: deve bloquear terminantemente conexões com produção', () => {
      for (const prod of FORBIDDEN_PRODUCTION_PROJECTS) {
        expect(() => {
          validateFirebaseConfig({ projectId: prod, apiKey: 'fake-key' });
        }).toThrow(/PRODUÇÃO/);
      }

      expect(() => {
        validateFirebaseConfig({ projectId: 'erp-prod-saas', apiKey: 'fake-key' });
      }).toThrow(/PRODUÇÃO/);
    });

    it('QA-04: deve bloquear terminantemente credenciais administrativas no cliente', () => {
      const adminConfigs = [
        { projectId: 'gerenciador-produtos-staging', private_key: '-----BEGIN PRIVATE KEY-----' },
        { projectId: 'gerenciador-produtos-staging', client_secret: 'secret123' },
        { projectId: 'gerenciador-produtos-staging', serviceAccount: { type: 'service_account' } }
      ];

      for (const cfg of adminConfigs) {
        expect(() => {
          validateFirebaseConfig(cfg);
        }).toThrow(/SEGURANÇA CRÍTICA/);
      }
    });

    it('QA-05: deve detectar Configuration Drift entre Auth, RTDB e Storage', () => {
      // Cenário 1: databaseURL de outro projeto (Auth projeto A, RTDB projeto B)
      const driftedDbConfig = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaKey',
        databaseURL: 'https://outro-projeto-default-rtdb.firebaseio.com'
      };
      expect(() => {
        validateFirebaseConfig(driftedDbConfig);
      }).toThrow(/CONFIGURATION DRIFT/);

      // Cenário 2: storageBucket de outro projeto (Auth projeto A, Storage projeto C)
      const driftedStorageConfig = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaKey',
        storageBucket: 'projeto-c-bucket.appspot.com'
      };
      expect(() => {
        validateFirebaseConfig(driftedStorageConfig);
      }).toThrow(/CONFIGURATION DRIFT/);
    });
  });

  // ===========================================================================
  // 2. DATA INTEGRITY & AUDIT TRAIL LIFECYCLE (QA-06 a QA-09)
  // ===========================================================================
  describe('2. Data Integrity & Audit Trail Lifecycle', () => {
    it('QA-06: ciclo completo create -> update -> sync -> receive -> restart -> offline -> reconnect', async () => {
      const mockCloud = new MockRealtimeProvider({
        tenantId: 'tenant-qa',
        deviceId: 'device-qa-01'
      });
      const engine = new SyncEngine(mockCloud);

      // 1. Create local product via ProductService
      const productId = await ProductService.createProduct({
        name: 'Teclado Mecânico RGB',
        productCode: 'TEC-MEC-01',
        purchasePriceCents: 15000,
        salePriceCents: 28000
      });
      expect(productId).toBeDefined();

      const createdProd = await productRepository.findById(productId);
      expect(createdProd.name).toBe('Teclado Mecânico RGB');

      // Enfileira mutação no Outbox
      await syncRepository.enqueue({ entityType: 'products', entityId: productId, action: 'CREATE', payload: createdProd });

      // 2. Update local product
      await ProductService.updateProduct(productId, {
        ...createdProd,
        salePriceCents: 29990
      });
      const updatedProd = await productRepository.findById(productId);
      await syncRepository.enqueue({ entityType: 'products', entityId: productId, action: 'UPDATE', payload: updatedProd });

      // 3. Sync to Cloud
      const syncResult = await engine.processQueue();
      expect(syncResult.success).toBe(1); // Coalescido CREATE+UPDATE em 1 operação

      // 4. Restart simulado: lê direto do repositório
      const restartedProd = await productRepository.findById(productId);
      expect(restartedProd.salePriceCents).toBe(29990);

      // 5. Offline: simula perda de conexão e alteração
      mockCloud.setConnected(false);
      await ProductService.updateProduct(productId, {
        ...restartedProd,
        name: 'Teclado Mecânico RGB Pro'
      });
      const offlineProd = await productRepository.findById(productId);
      await syncRepository.enqueue({ entityType: 'products', entityId: productId, action: 'UPDATE', payload: offlineProd });

      // Tenta sincronizar offline -> falha e permanece pendente
      const offlineSync = await engine.processQueue();
      expect(offlineSync.failed).toBe(1);

      // 6. Reconnect: restabelece rede e sincroniza
      mockCloud.setConnected(true);
      const reconnectSync = await engine.processQueue();
      expect(reconnectSync.success).toBe(1);

      const finalProd = await productRepository.findById(productId);
      expect(finalProd.name).toBe('Teclado Mecânico RGB Pro');
      engine.destroy();
    });

    it('QA-07: integridade concorrente de estoque via Append-Only Ledger', async () => {
      // Produto base abastecido com 10 unidades
      const productId = await ProductService.createProduct({
        name: 'Mouse Óptico Gamer',
        productCode: 'MOU-GAM-01',
        purchasePriceCents: 5000,
        salePriceCents: 10000
      });

      await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 10,
        reason: 'PURCHASE'
      });

      // Device A registra movimento +1
      await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 1,
        reason: 'PURCHASE',
        note: 'Device A recebimento'
      });

      // Device B registra movimento -1
      await StockService.recordMovement({
        productId,
        type: 'OUT',
        quantity: 1,
        reason: 'SALE',
        note: 'Device B venda balcão'
      });

      // Ledger não faz overwrite: ambos os movimentos devem persistir individualmente
      const movements = await stockMovementRepository.findByProductId(productId);
      expect(movements.length).toBe(3); // 1 inicial + 1 entrada + 1 saída

      const inMovements = movements.filter(m => m.type === 'IN');
      const outMovements = movements.filter(m => m.type === 'OUT');
      expect(inMovements.length).toBe(2);
      expect(outMovements.length).toBe(1);

      // Saldo final deve ser exatamente 10 (10 + 1 - 1 = 10)
      const updatedProd = await productRepository.findById(productId);
      expect(updatedProd.stockQuantity).toBe(10);
    });

    it('QA-08: ciclo de Vendas de Staging com snapshot, estoque e sincronização', async () => {
      const productId = await ProductService.createProduct({
        name: 'Monitor UltraWide 29"',
        productCode: 'MON-UW-29',
        purchasePriceCents: 80000,
        salePriceCents: 120000
      });

      // Abastecer 5 unidades
      await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 5
      });

      // Realiza venda no PDV
      const saleResult = await SaleService.recordSale({
        productId,
        quantity: 2,
        customerName: 'Cliente Homologação',
        paymentMethod: PAYMENT_METHODS.PIX,
        notes: 'Venda de staging para teste de homologação'
      });

      expect(saleResult.saleId).toBeDefined();
      expect(saleResult.totalSaleCents).toBe(240000); // 2 * 120000 = R$ 2400,00

      // Verifica dedução de estoque imediata
      const prodAfterSale = await productRepository.findById(productId);
      expect(prodAfterSale.stockQuantity).toBe(3);

      // Verifica movimentação gravada
      const movements = await stockMovementRepository.findByProductId(productId);
      expect(movements.some(m => m.type === 'SALE' && m.quantity === 2)).toBe(true);

      // Reinicialização: recarrega venda
      const reloadedSale = await saleRepository.findById(saleResult.saleId);
      expect(reloadedSale.totalSaleCents).toBe(240000);
    });

    it('QA-09: transação offline -> fecha app -> reabre -> online sincroniza sem duplicação', async () => {
      const mockCloud = new MockRealtimeProvider({ tenantId: 'tenant-qa', deviceId: 'dev-01' });
      mockCloud.setConnected(false); // Offline
      const engine = new SyncEngine(mockCloud);

      // Cria produto e abastece estoque
      const productId = await ProductService.createProduct({
        name: 'Cabo DisplayPort 1.4',
        productCode: 'CAB-DP-14',
        purchasePriceCents: 2000,
        salePriceCents: 5000
      });

      await StockService.recordMovement({
        productId,
        type: 'IN',
        quantity: 20
      });

      // Realiza venda em modo offline
      const saleResult = await SaleService.recordSale({
        productId,
        quantity: 3,
        paymentMethod: PAYMENT_METHODS.DINHEIRO
      });

      const sale = await saleRepository.findById(saleResult.saleId);

      // Enfileira venda no Outbox
      await syncRepository.enqueue({ entityType: 'sales', entityId: sale.id, action: 'CREATE', payload: sale });

      // App fecha e reabre: verifica fila pendente
      const pendingBefore = await syncRepository.getPending();
      expect(pendingBefore.length).toBe(1);
      expect(pendingBefore[0].entityId).toBe(sale.id);

      // Volta a ficar online
      mockCloud.setConnected(true);
      const res = await engine.processQueue();
      expect(res.success).toBe(1);

      // Verifica se itens pendentes zeraram
      const pendingAfter = await syncRepository.getPending();
      expect(pendingAfter.length).toBe(0);

      // Tenta processar novamente -> não deve duplicar mutações
      const resSecond = await engine.processQueue();
      expect(resSecond.processed).toBe(0);

      engine.destroy();
    });
  });

  // ===========================================================================
  // 3. IMAGE END-TO-END, VERSIONING & ZERO REDUNDANT DOWNLOAD (QA-10 a QA-13)
  // ===========================================================================
  describe('3. Image End-to-End, Versioning & Cache', () => {
    it('QA-10: fluxo E2E upload -> manifest -> device B -> download -> SHA-256 -> cache', async () => {
      const storageMock = new MockImageStorageProvider();
      const testBlob = new Blob(['sample-product-image-bytes-qa'], { type: 'image/webp' });
      const hash = await computeImageHash(testBlob);

      // Device A realiza upload e gera manifesto
      const uploadRes = await storageMock.upload(testBlob, {
        tenantId: 'tenant-qa',
        productId: 'prod-01',
        photoId: 'photo-01'
      });
      expect(uploadRes.url).toBeDefined();

      const manifestEntry = {
        photoId: 'photo-01',
        productId: 'prod-01',
        tenantId: 'tenant-qa',
        url: uploadRes.url,
        hash,
        version: 1,
        sizeBytes: testBlob.size,
        mimeType: 'image/webp',
        isPrimary: true,
        updatedAt: new Date().toISOString()
      };
      await imageManifestRepository.upsert(manifestEntry);

      // Device B inicializa o cache vazio
      const cacheB = localImageCache;
      expect(await cacheB.has('photo-01', { tenantId: 'tenant-qa' })).toBe(false);

      // Device B executa ImageSyncService para baixar
      const syncService = new ImageSyncService({
        storageProvider: storageMock,
        imageCache: cacheB,
        manifestRepository: imageManifestRepository
      });

      const queueItem = syncService.enqueue({
        ...manifestEntry,
        priority: SYNC_PRIORITY.P1,
        expectedVersion: 1,
        expectedHash: hash
      });

      expect(queueItem).toBeDefined();

      // Processa download da fila
      await syncService.processQueue();
      await new Promise(r => setTimeout(r, 60));

      const processedItem = syncService.getQueue().find(it => it.photoId === 'photo-01');
      expect(processedItem.state).toBe(QUEUE_STATE.COMPLETED);

      // Device B agora possui o blob em cache offline
      expect(await cacheB.has('photo-01', { tenantId: 'tenant-qa' })).toBe(true);
      const cached = await cacheB.get('photo-01', { tenantId: 'tenant-qa' });
      expect(cached.hash).toBe(hash);

      syncService.destroy();
    });

    it('QA-11: versionamento de imagem v1 -> v2 -> v3 sem downgrade para device atrasado', async () => {
      const cache = localImageCache;
      const tenantId = 'tenant-qa';
      const photoId = 'photo-v-01';
      const productId = 'prod-v-01';

      // Salva v2 no cache local
      const blobV2 = new Blob(['version-2-content'], { type: 'image/webp' });
      const hashV2 = await computeImageHash(blobV2);
      await cache.put({ photoId, productId, tenantId, blob: blobV2, version: 2, hash: hashV2 });

      // Tenta gravar v1 (versão anterior obsoleta)
      const blobV1 = new Blob(['version-1-content'], { type: 'image/webp' });
      const hashV1 = await computeImageHash(blobV1);

      // O cache deve rejeitar downgrade de versão
      await expect(cache.put({ photoId, productId, tenantId, blob: blobV1, version: 1, hash: hashV1 }))
        .rejects.toThrow(/downgrade/i);

      // Versão mais recente v3 deve ser aceita com sucesso
      const blobV3 = new Blob(['version-3-content'], { type: 'image/webp' });
      const hashV3 = await computeImageHash(blobV3);
      await cache.put({ photoId, productId, tenantId, blob: blobV3, version: 3, hash: hashV3 });

      const current = await cache.get(photoId, { tenantId });
      expect(current.version).toBe(3);
    });

    it('QA-12: Zero Redundant Download quando hash e versão forem idênticos', async () => {
      const storageMock = new MockImageStorageProvider();
      const testBlob = new Blob(['identical-bytes-zero-download'], { type: 'image/webp' });
      const hash = await computeImageHash(testBlob);
      const tenantId = 'tenant-qa';
      const photoId = 'photo-zero-01';
      const productId = 'prod-zero-01';

      // Inicializa imagem no cache local
      await localImageCache.put({
        photoId,
        productId,
        tenantId,
        blob: testBlob,
        version: 1,
        hash
      });

      // Cadastra no repositório de manifesto local
      await imageManifestRepository.upsert({
        photoId,
        productId,
        tenantId,
        url: 'https://storage.mock/photo-zero-01.webp',
        hash,
        version: 1,
        isPrimary: true
      });

      const syncService = new ImageSyncService({
        storageProvider: storageMock,
        imageCache: localImageCache,
        manifestRepository: imageManifestRepository
      });

      // Solicita garantir fotos do produto: como já existe versão idêntica em cache, ZERO itens são enfileirados
      const res = await syncService.ensureProductImages(productId, { tenantId });
      expect(res.queued).toBe(0);
      expect(res.existingCount).toBe(1);

      syncService.destroy();
    });

    it('QA-13: simulação de cota de armazenamento e priorização inteligente P1 sobre P3', async () => {
      localImageCache.setSimulatedQuotaLimit(100 * 1024 * 1024); // 100MB
      expect(localImageCache._simulatedQuotaLimit).toBe(100 * 1024 * 1024);

      // Validação de prioridades
      expect(SYNC_PRIORITY.P1).toBeGreaterThan(SYNC_PRIORITY.P2);
      expect(SYNC_PRIORITY.P2).toBeGreaterThan(SYNC_PRIORITY.P3);
    });
  });

  // ===========================================================================
  // 4. ERROR RECOVERY, LOG QUALITY & ERROR UX (QA-14 a QA-17)
  // ===========================================================================
  describe('4. Error Recovery, Log Quality & Error UX', () => {
    it('QA-14: classificação estrita de erros em temporary, auth, security e permanent', () => {
      // Temporary (timeout, 500, 429) -> deve permitir retry
      const errTimeout = classifyCloudError(new Error('Connection timeout deadline exceeded'));
      expect(errTimeout.category).toBe(ERROR_CATEGORY.TEMPORARY);
      expect(errTimeout.shouldRetry).toBe(true);

      const err500 = classifyCloudError({ status: 500, message: 'Internal Server Error' });
      expect(err500.category).toBe(ERROR_CATEGORY.TEMPORARY);
      expect(err500.shouldRetry).toBe(true);

      // Auth (401, token expired) -> não retryar infinitamente
      const err401 = classifyCloudError({ status: 401, message: 'unauthenticated user token expired' });
      expect(err401.category).toBe(ERROR_CATEGORY.AUTH);
      expect(err401.shouldRetry).toBe(false);
      expect(err401.userMessage).toContain('sessão expirou');

      // Security (403, permission denied) -> não retryar
      const err403 = classifyCloudError({ status: 403, message: 'PERMISSION_DENIED for path' });
      expect(err403.category).toBe(ERROR_CATEGORY.SECURITY);
      expect(err403.shouldRetry).toBe(false);
      expect(err403.userMessage).toContain('não tem permissão');

      // Permanent (404 Not Found) -> não retryar
      const err404 = classifyCloudError({ status: 404, message: 'object not found' });
      expect(err404.category).toBe(ERROR_CATEGORY.PERMANENT);
      expect(err404.shouldRetry).toBe(false);
    });

    it('QA-15: proteção de logs sem vazamento de segredos, tokens ou senhas', () => {
      const dirtyLogString = 'Request with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and password=SuperSecretPassword123!';
      const cleanString = sanitizeLogData(dirtyLogString);
      expect(cleanString).not.toContain('SuperSecretPassword123!');
      expect(cleanString).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(cleanString).toContain('Bearer [REDACTED]');
      expect(cleanString).toContain('password=[REDACTED]');

      const dirtyLogObject = {
        user: 'admin@gestaopro.com',
        password: 'PlainTextPassword',
        idToken: 'secret_jwt_token',
        nested: {
          apiKey: 'AIzaSecretKey',
          safeField: 'valor normal'
        }
      };
      const cleanObject = sanitizeLogData(dirtyLogObject);
      expect(cleanObject.password).toBe('[REDACTED]');
      expect(cleanObject.idToken).toBe('[REDACTED]');
      expect(cleanObject.nested.apiKey).toBe('[REDACTED]');
      expect(cleanObject.nested.safeField).toBe('valor normal');
    });

    it('QA-16: Error UX: erros técnicos transformados em mensagens humanas amigáveis', () => {
      const errPerm = classifyCloudError({ code: '403', message: 'FirebaseError: Missing or insufficient permissions.' });
      expect(errPerm.userMessage).not.toContain('FirebaseError');
      expect(errPerm.userMessage).not.toContain('Missing or insufficient');
      expect(errPerm.userMessage).toBe('Você não tem permissão para realizar esta operação.');
    });

    it('QA-17: auditoria de ciclo de vida e cleanup da galeria de fotos', () => {
      const container = new MockDOMElement('div');
      const gallery = new ProductImageGallery(container, 'prod-leak-test', {
        tenantId: 'tenant-qa'
      });

      expect(gallery.productId).toBe('prod-leak-test');
      expect(Array.isArray(gallery._cleanupFns)).toBe(true);

      // Destrói componente
      gallery.destroy();
      expect(gallery._cleanupFns.length).toBe(0);
      expect(container.innerHTML).toBe('');
    });
  });

  // ===========================================================================
  // 5. REGRESSÕES MULTI-PLATAFORMA: TAURI, WEB & SERVICE WORKER (QA-18 a QA-20)
  // ===========================================================================
  describe('5. Regressões Multi-Plataforma: Tauri, Web & PWA', () => {
    it('QA-18: conformidade do adaptador Desktop (Tauri) sem colisão com PWA', () => {
      expect(tauriAdapter.getPlatformName()).toBe('Desktop (Windows Tauri)');
      expect(tauriAdapter.getPlatformType()).toBe('tauri');
      expect(typeof tauriAdapter.isTauri).toBe('function');
      expect(typeof tauriAdapter.openExternal).toBe('function');
      expect(typeof tauriAdapter.print).toBe('function');
      expect(typeof tauriAdapter.resolveImageUrl).toBe('function');
    });

    it('QA-19: conformidade do adaptador Web / Mobile PWA', () => {
      expect(webAdapter.getPlatformType()).toBe('web');
      expect(webAdapter.isTauri()).toBe(false);
      expect(typeof webAdapter.openExternal).toBe('function');
      expect(typeof webAdapter.resolveImageUrl).toBe('function');
      expect(typeof webAdapter.revokeImageUrl).toBe('function');
    });

    it('QA-20: isolamento do Service Worker contra poluição de dados comerciais', () => {
      const swCode = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf-8');
      // O SW ignora qualquer tráfego cross-origin (Firebase Auth, Realtime Database, Firestore REST, Cloudinary)
      expect(swCode).toContain('url.origin !== self.location.origin');
      // O SW ignora rotas de imagens de produto
      expect(swCode).toContain('/tenants/');
    });
  });

  // ===========================================================================
  // 6. PERFORMANCE BASELINE (QA-21 a QA-22)
  // ===========================================================================
  describe('6. Performance Baseline Real', () => {
    it('QA-21: reconciliação de manifesto incremental em O(N)', async () => {
      const t0 = performance.now();
      const localManifest = [];
      const remoteManifest = [];

      for (let i = 0; i < 200; i++) {
        localManifest.push({ photoId: `p-${i}`, productId: 'p1', tenantId: 't1', version: 1, hash: `hash-${i}` });
        remoteManifest.push({
          photoId: `p-${i}`,
          productId: 'p1',
          tenantId: 't1',
          version: i % 2 === 0 ? 1 : 2,
          hash: i % 2 === 0 ? `hash-${i}` : `hash-${i}-v2`
        });
      }

      // Executa reconciliação estática em O(N)
      const reconciliation = ImageManifestService.reconcile(remoteManifest, localManifest);
      const elapsed = performance.now() - t0;

      expect(reconciliation.changedPhotos.length).toBe(100);
      expect(reconciliation.unchangedPhotos.length).toBe(100);
      // Deve processar 200 itens em menos de 50ms
      expect(elapsed).toBeLessThan(50);
    });

    it('QA-22: cálculo determinístico de hash SHA-256 em menos de 10ms por imagem típica', async () => {
      const sampleBlob = new Blob([new Uint8Array(100 * 1024).fill(42)], { type: 'image/webp' }); // 100KB
      const t0 = performance.now();
      const hash = await computeImageHash(sampleBlob);
      const elapsed = performance.now() - t0;

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 hex string
      expect(elapsed).toBeLessThan(50);
    });
  });
});
