import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { getDB, closeDB } from '../src/js/db/connection.js';
import { DB_NAME, DB_VERSION, migrations } from '../src/js/db/migrations.js';
import { BaseRepository, setTenantResolver, getCurrentTenant } from '../src/js/repositories/BaseRepository.js';
import { authService } from '../src/js/services/AuthService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { productImageRepository } from '../src/js/repositories/ProductImageRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { LocalImageCache } from '../src/js/services/LocalImageCache.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { legacyDataMigrationService } from '../src/js/services/LegacyDataMigrationService.js';

describe('FASE 14.8 — Legacy IndexedDB Data Compatibility, Tenant Attribution & Outbox Recovery Safety', () => {
  let activeTenant = null;
  let activeSession = null;
  let mockAuthService;

  beforeEach(async () => {
    activeTenant = null;
    activeSession = null;

    mockAuthService = {
      isConfigured: () => true,
      getCurrentSession: () => activeSession,
      getTenantId: () => activeTenant,
      getIdToken: async () => activeSession ? `token-${activeSession.role}` : null
    };

    setTenantResolver(() => activeTenant);

    const db = await getDB();
    await db.clear('products');
    await db.clear('stockMovements');
    await db.clear('sales');
    await db.clear('purchases');
    await db.clear('suppliers');
    await db.clear('syncQueue');
    await db.clear('imageManifest');
    await db.clear('productImages');
  });

  afterEach(async () => {
    setTenantResolver(() => authService.getTenantId());
  });

  // =========================================================================
  // 1. MIGRAÇÃO DE INDEXEDDB E PRESERVAÇÃO DE ESQUEMA E DADOS
  // =========================================================================
  describe('1. Migração de IndexedDB, Evolução de Versões e Preservação de Dados', () => {
    it('deve simular upgrade a partir da v1/v2 preservando registros, chaves primárias e integridade comercial', async () => {
      const TEST_DB_NAME = 'test_legacy_upgrade_db';

      // 1. Abre banco na versão 1 simulando estado legado antes das fases recentes
      let legacyDb = await openDB(TEST_DB_NAME, 1, {
        upgrade(db) {
          migrations[1](db);
        }
      });
      expect(legacyDb.version).toBe(1);

      // 2. Insere dados legados em v1 (sem tenantId)
      await legacyDb.add('products', {
        id: 'prod-legacy-1',
        name: 'Furadeira de Impacto Legada',
        productCode: 'FUR-001',
        salePriceCents: 25000,
        currentStock: 15,
        createdAt: '2025-01-10T10:00:00.000Z'
      });

      await legacyDb.add('sales', {
        id: 'sale-legacy-1',
        productId: 'prod-legacy-1',
        quantity: 2,
        totalCents: 50000,
        createdAt: '2025-01-11T12:00:00.000Z'
      });

      await legacyDb.add('syncQueue', {
        id: 'queue-legacy-1',
        entityType: 'products',
        entityId: 'prod-legacy-1',
        action: 'UPDATE',
        payload: { salePriceCents: 25000 },
        status: 'PENDING',
        attempts: 0,
        createdAt: '2025-01-11T14:00:00.000Z'
      });

      legacyDb.close();

      // 3. Executa upgrade para a versão atual (DB_VERSION = 3)
      const upgradedDb = await openDB(TEST_DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, tx) {
          for (let v = oldVersion + 1; v <= newVersion; v++) {
            if (migrations[v]) migrations[v](db, tx);
          }
        }
      });
      expect(upgradedDb.version).toBe(DB_VERSION);

      // 4. Comprova preservação integral dos registros existentes e suas chaves primárias
      const prod = await upgradedDb.get('products', 'prod-legacy-1');
      expect(prod).toBeDefined();
      expect(prod.name).toBe('Furadeira de Impacto Legada');
      expect(prod.salePriceCents).toBe(25000);
      expect(prod.tenantId).toBeUndefined(); // Dados legados não são inventados na migration de schema

      const sale = await upgradedDb.get('sales', 'sale-legacy-1');
      expect(sale).toBeDefined();
      expect(sale.totalCents).toBe(50000);

      const queueItem = await upgradedDb.get('syncQueue', 'queue-legacy-1');
      expect(queueItem).toBeDefined();
      expect(queueItem.action).toBe('UPDATE');

      // 5. Novas stores e índices foram criados com sucesso
      expect(upgradedDb.objectStoreNames.contains('imageManifest')).toBe(true);
      expect(upgradedDb.objectStoreNames.contains('nfe_imports')).toBe(true);

      upgradedDb.close();
    });

    it('LegacyDataMigrationService: migra com segurança registros com proveniência inequívoca', async () => {
      const db = await getDB();

      // Produto legado sem tenantId
      await db.add('products', {
        id: 'prod-with-photos',
        name: 'Produto Com Fotos',
        productCode: 'PROD-PHOTO-1',
        salePriceCents: 10000
      });

      // Manifesto de imagem associado ao produto com tenant inequívoco
      await db.add('imageManifest', {
        photoId: 'photo-101',
        id: 'photo-101',
        productId: 'prod-with-photos',
        tenantId: 'tenant-matriz',
        version: 1
      });

      // Movimentação de estoque referenciando o produto
      await db.add('stockMovements', {
        id: 'mov-101',
        productId: 'prod-with-photos',
        type: 'IN',
        quantity: 20
      });

      // Produto ambíguo sem manifesto e sem relacionamento com tenant
      await db.add('products', {
        id: 'prod-ambiguous-orphan',
        name: 'Produto Órfão Ambíguo',
        productCode: 'ORF-999'
      });

      // 1. Auditoria inicial
      const auditBefore = await legacyDataMigrationService.auditLegacyData();
      expect(auditBefore.stores.products.unassigned).toBe(2);

      // 2. Executa migração segura de registros inequívocos
      const result = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(result.migratedCount).toBeGreaterThanOrEqual(2); // produto e estoque

      // 3. Comprova que o produto com foto foi atribuído ao tenant-matriz com proveniência documentada
      const migratedProd = await db.get('products', 'prod-with-photos');
      expect(migratedProd.tenantId).toBe('tenant-matriz');
      expect(migratedProd.tenantStatus).toBe('RESOLVED');
      expect(migratedProd.tenantAttributionSource).toBe('IMAGE_MANIFEST_PROVENANCE');
      expect(migratedProd.tenantAttributionAt).toBeDefined();

      // 4. Comprova que o movimento herdou o tenant do produto pai
      const migratedMov = await db.get('stockMovements', 'mov-101');
      expect(migratedMov.tenantId).toBe('tenant-matriz');
      expect(migratedMov.tenantStatus).toBe('RESOLVED');

      // 5. Comprova que o produto ambíguo NÃO foi atribuído por suposição
      const orphanProd = await db.get('products', 'prod-ambiguous-orphan');
      expect(orphanProd.tenantId).toBeUndefined();

      // 6. Marca registros ambíguos como PENDING_ATTRIBUTION
      await legacyDataMigrationService.markAmbiguousRecords();
      const orphanAfter = await db.get('products', 'prod-ambiguous-orphan');
      expect(orphanAfter.tenantStatus).toBe('PENDING_ATTRIBUTION');
      expect(orphanAfter.requiresResolution).toBe(true);

      // 7. Reexecução é estritamente idempotente (sem duplicação de dados)
      const rerun = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(rerun.migratedCount).toBe(0); // Nenhum registro novo a migrar

      const allProds = await db.getAll('products');
      expect(allProds.length).toBe(2); // Quantidade inalterada
    });
  });

  // =========================================================================
  // 2. BASE REPOSITORY E ISOLAMENTO MULTI-TENANT LOCAL
  // =========================================================================
  describe('2. BaseRepository e Repositórios Especializados: Isolamento e Registros Legados', () => {
    it('Registros do Tenant A continuam visíveis para A e invisíveis para B', async () => {
      activeTenant = 'tenant-A';
      await productRepository.create({
        id: 'prod-A-1',
        name: 'Produto Tenant A',
        salePriceCents: 5000
      });

      activeTenant = 'tenant-B';
      await productRepository.create({
        id: 'prod-B-1',
        name: 'Produto Tenant B',
        salePriceCents: 8000
      });

      // Tenant A consulta
      activeTenant = 'tenant-A';
      const prodsA = await productRepository.findAll();
      expect(prodsA.length).toBe(1);
      expect(prodsA[0].id).toBe('prod-A-1');
      expect(await productRepository.findById('prod-B-1')).toBeNull();

      // Tenant B consulta
      activeTenant = 'tenant-B';
      const prodsB = await productRepository.findAll();
      expect(prodsB.length).toBe(1);
      expect(prodsB[0].id).toBe('prod-B-1');
      expect(await productRepository.findById('prod-A-1')).toBeNull();
    });

    it('Registros legados sem tenant NÃO vazam para o tenant ativo e são protegidos contra alteração', async () => {
      const db = await getDB();
      // Insere diretamente registro legado sem tenantId
      await db.add('products', {
        id: 'prod-legacy-untagged',
        name: 'Produto Legado Não Atribuído',
        productCode: 'LEG-123',
        salePriceCents: 3000
      });

      // Sessão ativa do Tenant A
      activeTenant = 'tenant-A';
      const prods = await productRepository.findAll();
      expect(prods.find(p => p.id === 'prod-legacy-untagged')).toBeUndefined();
      expect(await productRepository.findById('prod-legacy-untagged')).toBeNull();

      // Tentativa de busca especializada por código do produto legado retorna null
      expect(await productRepository.findByProductCode('LEG-123')).toBeNull();

      // Tentativa de update pelo Tenant A sobre registro legado não atribuído é bloqueada
      await expect(productRepository.update({
        id: 'prod-legacy-untagged',
        name: 'Tentativa de Apropriação por Tenant A'
      })).rejects.toThrow(/Acesso negado: registro legado não atribuído/);

      // Exclusão por tenant retorna false sem deletar o registro físico
      const softDel = await productRepository.softDelete('prod-legacy-untagged');
      expect(softDel).toBe(false);

      const hardDel = await productRepository.hardDelete('prod-legacy-untagged');
      expect(hardDel).toBe(false);

      // O registro físico permanece 100% intacto no IndexedDB
      const rawRecord = await db.get('products', 'prod-legacy-untagged');
      expect(rawRecord).toBeDefined();
      expect(rawRecord.name).toBe('Produto Legado Não Atribuído');

      // Disponível apenas através de método de auditoria e recuperação administrativa
      const unassigned = await productRepository.findUnassignedLegacy();
      expect(unassigned.some(p => p.id === 'prod-legacy-untagged')).toBe(true);
    });

    it('Repositórios Especializados mantêm estritamente o isolamento multi-tenant', async () => {
      const db = await getDB();

      // Insere compras, vendas, estoque e imagens pertencentes a Tenant A e Tenant B
      await db.add('purchases', { id: 'pur-A', productId: 'p1', supplierId: 's1', tenantId: 'tenant-A', date: '2026-01-01' });
      await db.add('purchases', { id: 'pur-B', productId: 'p1', supplierId: 's1', tenantId: 'tenant-B', date: '2026-01-02' });
      await db.add('purchases', { id: 'pur-legacy', productId: 'p1', supplierId: 's1', date: '2026-01-03' }); // untagged

      await db.add('sales', { id: 'sale-A', productId: 'p1', tenantId: 'tenant-A', date: '2026-01-01' });
      await db.add('sales', { id: 'sale-B', productId: 'p1', tenantId: 'tenant-B', date: '2026-01-02' });
      await db.add('sales', { id: 'sale-legacy', productId: 'p1', date: '2026-01-03' });

      await db.add('stockMovements', { id: 'mov-A', productId: 'p1', type: 'IN', quantity: 10, tenantId: 'tenant-A' });
      await db.add('stockMovements', { id: 'mov-B', productId: 'p1', type: 'IN', quantity: 20, tenantId: 'tenant-B' });
      await db.add('stockMovements', { id: 'mov-legacy', productId: 'p1', type: 'IN', quantity: 30 });

      await db.add('productImages', { id: 'img-A', productId: 'p1', tenantId: 'tenant-A', isPrimary: true });
      await db.add('productImages', { id: 'img-B', productId: 'p1', tenantId: 'tenant-B', isPrimary: true });
      await db.add('productImages', { id: 'img-legacy', productId: 'p1', isPrimary: true });

      // Tenant A consulta
      activeTenant = 'tenant-A';
      const purchasesA = await purchaseRepository.findByProductId('p1');
      expect(purchasesA.length).toBe(1);
      expect(purchasesA[0].id).toBe('pur-A');

      const salesA = await saleRepository.findByProductId('p1');
      expect(salesA.length).toBe(1);
      expect(salesA[0].id).toBe('sale-A');

      const movsA = await stockMovementRepository.findByProductId('p1');
      expect(movsA.length).toBe(1);
      expect(movsA[0].id).toBe('mov-A');

      const imgsA = await productImageRepository.findByProductId('p1');
      expect(imgsA.length).toBe(1);
      expect(imgsA[0].id).toBe('img-A');

      // Tenant B consulta
      activeTenant = 'tenant-B';
      const purchasesB = await purchaseRepository.findByProductId('p1');
      expect(purchasesB.length).toBe(1);
      expect(purchasesB[0].id).toBe('pur-B');

      const imgsB = await productImageRepository.findByProductId('p1');
      expect(imgsB.length).toBe(1);
      expect(imgsB[0].id).toBe('img-B');
    });
  });

  // =========================================================================
  // 3. OUTBOX SAFETY, RECUPERAÇÃO DE FALHAS E RETRYFAILED()
  // =========================================================================
  describe('3. Outbox Safety, Recuperação de Falhas e Proteção contra Despacho Inseguro', () => {
    let mockCloud;
    let syncEngine;

    beforeEach(async () => {
      mockCloud = new MockRealtimeProvider({ tenantId: 'tenant-matriz' });
      syncEngine = new SyncEngine(mockCloud, mockAuthService);
      await syncEngine.init();
    });

    afterEach(() => {
      if (syncEngine) syncEngine.destroy();
    });

    it('retryFailed(): reativa apenas erros transitórios elegíveis com tenant e permissão compatíveis', async () => {
      activeTenant = 'tenant-matriz';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-matriz' };

      // 1. Falha transitória de rede
      const itemNetwork = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p-net-1',
        action: 'CREATE',
        payload: { name: 'Produto Rede' },
        tenantId: 'tenant-matriz'
      });
      await syncRepository.markFailed(itemNetwork.id, 'Timeout de conexão', 1, false, { errorCategory: 'temporary' });

      // 2. Falha permanente de schema / 400 Bad Request
      const itemBadPayload = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p-bad-1',
        action: 'CREATE',
        payload: { malformed: true },
        tenantId: 'tenant-matriz'
      });
      await syncRepository.markFailed(itemBadPayload.id, '400 Bad Request: Schema validation failed', 1, true, { errorCategory: 'permanent' });

      // Executa retryFailed() sob sessão admin
      const res = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(res.retriedCount).toBe(1);
      expect(res.skippedCount).toBe(1);

      // Falha temporária foi reativada para PENDING
      const afterNet = await syncRepository.findById(itemNetwork.id);
      expect(afterNet.status).toBe('PENDING');
      expect(afterNet.attempts).toBe(0);

      // Falha de validação/schema permanece FAILED e preservada na fila sem loop
      const afterBad = await syncRepository.findById(itemBadPayload.id);
      expect(afterBad.status).toBe('FAILED');
      expect(afterBad.permanentFailure).toBe(true);
    });

    it('retryFailed(): bloqueia reativação de item de outro tenant ou sem tenant comprovado', async () => {
      const db = await getDB();
      // Item legado da Outbox sem tenant
      await db.add('syncQueue', {
        id: 'outbox-no-tenant',
        entityType: 'products',
        entityId: 'p-legacy',
        action: 'CREATE',
        status: 'FAILED',
        permanentFailure: true,
        attempts: 1,
        lastError: 'Erro antigo',
        createdAt: '2025-01-01'
      });

      // Item de outro tenant (tenant-B)
      await db.add('syncQueue', {
        id: 'outbox-tenant-b',
        entityType: 'products',
        entityId: 'p-b',
        action: 'CREATE',
        tenantId: 'tenant-B',
        status: 'FAILED',
        permanentFailure: true,
        attempts: 1,
        lastError: 'Timeout',
        createdAt: '2025-01-01'
      });

      // Usuário ativo pertence a tenant-A
      activeTenant = 'tenant-A';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-A' };

      const res = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(res.retriedCount).toBe(0);

      // Nenhum item foi reativado sob o tenant incorreto
      const itemNoTenant = await db.get('syncQueue', 'outbox-no-tenant');
      expect(itemNoTenant.status).toBe('FAILED');

      const itemB = await db.get('syncQueue', 'outbox-tenant-b');
      expect(itemB.status).toBe('FAILED');
    });

    it('retryFailed(): nova validação de papel impede que usuário sem permissão reative operações sensíveis', async () => {
      activeTenant = 'tenant-matriz';
      // Sessão atual é VIEWER (somente leitura)
      activeSession = { authenticated: true, role: 'viewer', appRole: 'viewer', tenantId: 'tenant-matriz' };

      const itemPurchase = await syncRepository.enqueue({
        entityType: 'purchases',
        entityId: 'pur-fail-1',
        action: 'CREATE',
        payload: { totalCents: 10000 },
        tenantId: 'tenant-matriz'
      });
      await syncRepository.markFailed(itemPurchase.id, 'Timeout de conexão', 1, false, { errorCategory: 'temporary' });

      // Viewer tenta executar retryFailed
      const resViewer = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(resViewer.retriedCount).toBe(0);
      expect(resViewer.skippedCount).toBe(1);
      expect(resViewer.skippedItems[0].reason).toBe('INSUFFICIENT_ROLE_PERMISSIONS');

      // O item continua FAILED
      const itemStillFailed = await syncRepository.findById(itemPurchase.id);
      expect(itemStillFailed.status).toBe('FAILED');

      // Sessão é regularizada para ADMIN
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-matriz' };
      const resAdmin = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(resAdmin.retriedCount).toBe(1);

      const itemRecovered = await syncRepository.findById(itemPurchase.id);
      expect(itemRecovered.status).toBe('PENDING');
      expect(itemRecovered.attempts).toBe(0);
    });

    it('processQueue(): protege contra troca de tenant durante operações assíncronas em voo', async () => {
      activeTenant = 'tenant-A';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-A' };

      const itemA = await syncRepository.enqueue({
        entityType: 'products',
        entityId: 'p-in-flight-1',
        action: 'CREATE',
        payload: { name: 'Produto Tenant A' },
        tenantId: 'tenant-A'
      });

      // Hook no provedor simulando latência onde o usuário troca de tenant no meio da requisição
      mockCloud.pushChange = async (change) => {
        // Simula troca de tenant pelo usuário no meio do voo assíncrono!
        activeTenant = 'tenant-B';
        activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-B' };
        return { success: true, remoteId: change.entityId };
      };

      const result = await syncEngine.processQueue();
      // O processQueue deve ter abortado sem marcar como sincronizado sob o novo tenant
      expect(result.success).toBe(0);

      // O item permanece seguro para recuperação posterior no tenant original
      const db = await getDB();
      const rawItem = await db.get('syncQueue', itemA.id);
      expect(rawItem.tenantId).toBe('tenant-A');
      expect(rawItem.status).toBe('PENDING'); // Não foi corrompido nem atribuído a Tenant B
    });
  });

  // =========================================================================
  // 4. MANIFESTOS E CACHE LEGADOS DE IMAGENS
  // =========================================================================
  describe('4. Manifestos e Cache Legados de Imagens', () => {
    let imageCache;

    beforeEach(() => {
      imageCache = new LocalImageCache();
    });

    it('Manifesto e imagem legada sem tenant permanecem protegidos e não vazam para tenants ativos', async () => {
      const db = await getDB();

      // Insere binário legado sem tenant em productImages
      const mockBlob = new Blob(['legacy-image-content-bytes'], { type: 'image/webp' });
      await db.add('productImages', {
        id: 'photo-legacy-1',
        photoId: 'photo-legacy-1',
        productId: 'prod-legacy-1',
        blob: mockBlob,
        thumbnailBlob: mockBlob,
        version: 1,
        hash: 'hash-legacy-1',
        sizeBytes: mockBlob.size
      });

      // Insere manifesto legado sem tenant
      await db.add('imageManifest', {
        id: 'photo-legacy-1',
        photoId: 'photo-legacy-1',
        productId: 'prod-legacy-1',
        version: 1,
        hash: 'hash-legacy-1'
      });

      // Tenant A tenta consultar o cache
      activeTenant = 'tenant-A';
      const imgA = await imageCache.get('photo-legacy-1');
      expect(imgA).toBeNull();

      const metaA = await imageCache.getMetadata('photo-legacy-1');
      expect(metaA).toBeNull();

      const manifestA = await imageManifestRepository.findByPhotoId('photo-legacy-1');
      expect(manifestA).toBeNull();

      // Tenant B tenta consultar o cache
      activeTenant = 'tenant-B';
      const imgB = await imageCache.get('photo-legacy-1');
      expect(imgB).toBeNull();

      // Limpeza de cache do Tenant B NÃO remove imagens legadas sem tenant
      await imageCache.clear({ tenantId: 'tenant-B', hard: true });

      // O binário físico continua intacto e preservado no IndexedDB
      const rawImg = await db.get('productImages', 'photo-legacy-1');
      expect(rawImg).toBeDefined();
      expect(rawImg.photoId).toBe('photo-legacy-1');

      // Evicção sob Tenant B não remove a imagem legada
      const eviction = await imageCache.getEvictionCandidates({ tenantId: 'tenant-B' });
      expect(eviction.length).toBe(0);
    });

    it('Imagem do Tenant A é categoricamente bloqueada quando solicitada por Tenant B', async () => {
      const mockBlob = new Blob(['content-tenant-a'], { type: 'image/webp' });
      await imageCache.put({
        photoId: 'photo-matriz-1',
        productId: 'prod-matriz-1',
        tenantId: 'tenant-matriz',
        blob: mockBlob
      });

      // Tenant Matriz lê com sucesso
      activeTenant = 'tenant-matriz';
      const getMatriz = await imageCache.get('photo-matriz-1');
      expect(getMatriz).toBeDefined();
      expect(getMatriz.photoId).toBe('photo-matriz-1');

      // Tenant Filial tenta ler e é bloqueado
      activeTenant = 'tenant-filial';
      const getFilial = await imageCache.get('photo-matriz-1');
      expect(getFilial).toBeNull();

      const hasFilial = await imageCache.has('photo-matriz-1');
      expect(hasFilial).toBe(false);
    });
  });
});
