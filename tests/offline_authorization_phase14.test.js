import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { getDB } from '../src/js/db/connection.js';
import { authService, AUTH_STATES } from '../src/js/services/AuthService.js';
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
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { LocalImageCache } from '../src/js/services/LocalImageCache.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { setTenantResolver, getCurrentTenant } from '../src/js/repositories/BaseRepository.js';
import { checkPermission, assertPermission } from '../src/js/utils/authGuard.js';

describe('FASE 14.7 — Offline-First Authorization, Outbox Safety & Local Tenant Isolation Suite', () => {
  let mockProvider;
  let customAuth;
  let syncEngine;
  let imageCache;

  // Helper para simular provedor de autenticação com sessão controlada
  function createControllableAuthProvider(initialSession = null) {
    let session = initialSession;
    const listeners = new Set();
    return {
      isConfigured: () => true,
      getCurrentSession: () => session,
      setSession: (newSession) => {
        session = newSession;
        listeners.forEach(cb => {
          try { cb(session); } catch (_) {}
        });
      },
      onAuthStateChanged: (cb) => {
        listeners.add(cb);
        if (session) cb(session);
        return () => listeners.delete(cb);
      },
      getIdToken: async () => session ? `mock-token-${session.role}` : null
    };
  }

  beforeEach(async () => {
    const db = await getDB();
    await db.clear('products');
    await db.clear('stockMovements');
    await db.clear('sales');
    await db.clear('purchases');
    await db.clear('suppliers');
    await db.clear('syncQueue');
    await db.clear('imageManifest');
    await db.clear('productImages');

    mockProvider = createControllableAuthProvider(null);
    authService.setProvider(mockProvider);

    const mockCloud = new MockRealtimeProvider({
      tenantId: 'tenant-matriz',
      deviceId: 'device-test-1'
    });
    syncEngine = new SyncEngine(mockCloud, authService);
    await syncEngine.init();
    imageCache = new LocalImageCache();
  });

  afterEach(() => {
    if (syncEngine) syncEngine.destroy();
    authService.destroy();
  });

  // =========================================================================
  // 1. AUTORIZAÇÃO OFFLINE NA CAMADA DE SERVIÇOS
  // =========================================================================
  describe('1. Autorização Offline nos Serviços de Negócio', () => {
    it('Sessão Canônica Admin: Permite criação e mutação em todos os módulos', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'admin-01',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-matriz'
      });

      // 1. Catálogo
      const prodId = await ProductService.createProduct({
        name: 'Produto Admin',
        salePriceCents: 15000,
        currentStock: 10
      });
      expect(prodId).toBeDefined();

      // 2. Movimento de estoque
      const mov = await StockService.recordMovement({
        productId: prodId,
        quantity: 5,
        type: 'IN',
        reason: 'Entrada Inicial'
      });
      expect(mov).toBeDefined();

      // 3. Venda
      const sale = await SaleService.recordSale({
        productId: prodId,
        quantity: 2,
        unitSalePriceCents: 15000,
        paymentMethod: 'DINHEIRO'
      });
      expect(sale).toBeDefined();

      // 4. Fornecedor (exclusivo admin)
      const supId = await SupplierService.createSupplier({
        name: 'Fornecedor Confiança',
        document: '12345678000199'
      });
      expect(supId).toBeDefined();

      // 5. Compra (exclusivo admin)
      const purchase = await PurchaseService.recordPurchase({
        productId: prodId,
        supplierId: supId,
        quantity: 10,
        unitCostCents: 8000
      });
      expect(purchase).toBeDefined();
    });

    it('Sessão Canônica Operator: Permite catálogo, estoque e vendas; bloqueia compras e fornecedores', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'operator-01',
        role: 'operator',
        appRole: 'operator',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-matriz'
      });

      // Operações permitidas
      const prodId = await ProductService.createProduct({
        name: 'Produto Operador',
        salePriceCents: 5000
      });
      expect(prodId).toBeDefined();

      const mov = await StockService.recordMovement({
        productId: prodId,
        quantity: 2,
        type: 'IN'
      });
      expect(mov).toBeDefined();

      const sale = await SaleService.recordSale({
        productId: prodId,
        quantity: 1,
        unitSalePriceCents: 5000,
        paymentMethod: 'PIX'
      });
      expect(sale).toBeDefined();

      // Operações administrativas exclusivas de admin -> DEVEM SER BLOQUEADAS
      await expect(SupplierService.createSupplier({
        name: 'Fornecedor Bloqueado'
      })).rejects.toThrow(/não autorizada/i);

      await expect(PurchaseService.recordPurchase({
        productId: prodId,
        supplierId: 'sup-1',
        quantity: 5,
        unitCostCents: 2000
      })).rejects.toThrow(/não autorizada/i);
    });

    it('Sessão Canônica Viewer: Bloqueia terminantemente qualquer operação de escrita', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'viewer-01',
        role: 'viewer',
        appRole: 'viewer',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-matriz'
      });

      // Criação de produto bloqueada
      await expect(ProductService.createProduct({
        name: 'Produto Viewer',
        salePriceCents: 1000
      })).rejects.toThrow(/não autorizada/i);

      // Movimentação de estoque bloqueada
      await expect(StockService.recordMovement({
        productId: 'prod-x',
        quantity: 1,
        type: 'IN'
      })).rejects.toThrow(/não autorizada/i);

      // Venda bloqueada
      await expect(SaleService.recordSale({
        productId: 'prod-x',
        quantity: 1,
        unitSalePriceCents: 1000,
        paymentMethod: 'DINHEIRO'
      })).rejects.toThrow(/não autorizada/i);

      // Compra bloqueada
      await expect(PurchaseService.recordPurchase({
        productId: 'prod-x',
        supplierId: 'sup-x',
        quantity: 1,
        unitCostCents: 500
      })).rejects.toThrow(/não autorizada/i);

      // Fornecedor bloqueado
      await expect(SupplierService.createSupplier({
        name: 'Fornecedor Viewer'
      })).rejects.toThrow(/não autorizada/i);
    });

    it('Sessão com requiresMigration: true: Bloqueia mutações mesmo se alegar ser admin legado', async () => {
      // Usuário antigo com claims legadas (sem appRole canônico)
      mockProvider.setSession({
        authenticated: true,
        uid: 'legacy-admin',
        role: 'viewer', // resolvido para viewer por segurança
        appRole: 'viewer',
        canonicalClaims: false,
        requiresMigration: true,
        tenantId: 'tenant-matriz'
      });

      await expect(ProductService.createProduct({
        name: 'Tentativa de Escrita Sem Claims Canônicas',
        salePriceCents: 10000
      })).rejects.toThrow(/regularização administrativa de claims/i);

      await expect(StockService.recordMovement({
        productId: 'prod-1',
        quantity: 10,
        type: 'IN'
      })).rejects.toThrow(/regularização administrativa de claims/i);
    });

    it('Chamada direta a repositórios e serviços sem passar pela UI é estritamente validada', async () => {
      // Validação centralizada direta através de assertPermission
      const viewerSession = {
        authenticated: true,
        role: 'viewer',
        appRole: 'viewer',
        canonicalClaims: true,
        requiresMigration: false
      };

      expect(() => {
        assertPermission('create', 'products', { session: viewerSession });
      }).toThrow(/não autorizada.*viewer/i);

      expect(() => {
        assertPermission('create', 'purchases', {
          session: { authenticated: true, role: 'operator', appRole: 'operator', canonicalClaims: true }
        });
      }).toThrow(/não autorizada.*exclusiva para.*admin/i);
    });
  });

  // =========================================================================
  // 2. SEGURANÇA DA OUTBOX E CICLO DE RETENTATIVAS
  // =========================================================================
  describe('2. Segurança da Outbox, Mudança de Sessão e Retentativas', () => {
    it('Operação autorizada offline é enfileirada no Outbox com tenantId correto', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'admin-01',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      const prodId = await ProductService.createProduct({
        name: 'Produto na Fila',
        salePriceCents: 2990
      });

      await new Promise(r => setTimeout(r, 20));

      const pending = await syncRepository.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].entityType).toBe('products');
      expect(pending[0].entityId).toBe(prodId);
      expect(pending[0].tenantId).toBe('tenant-alpha');
      expect(pending[0].status).toBe('PENDING');
    });

    it('Tentativa de enfileirar mutação não autorizada no Outbox é rejeitada', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'viewer-01',
        role: 'viewer',
        appRole: 'viewer',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      // Tentativa direta no syncEngine.enqueue
      await expect(syncEngine.enqueue('products', 'prod-malicious', 'CREATE', {
        name: 'Injeção Ilegítima'
      })).rejects.toThrow(/não autorizada/i);

      const pending = await syncRepository.getPending();
      expect(pending.length).toBe(0);
    });

    it('Operação pendente seguida de rebaixamento de papel para viewer não é reenviada indefinidamente nem apagada', async () => {
      // 1. Admin enfileira produto legitimamente
      mockProvider.setSession({
        authenticated: true,
        uid: 'admin-01',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      const item = await syncEngine.enqueue('products', 'prod-pending-1', 'CREATE', {
        name: 'Produto Pendente',
        salePriceCents: 1000
      });

      // 2. Papel da sessão muda para viewer (ou token expirado / rebaixado)
      mockProvider.setSession({
        authenticated: true,
        uid: 'viewer-01',
        role: 'viewer',
        appRole: 'viewer',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      // 3. SyncEngine tenta processar
      const res = await syncEngine.processQueue();
      expect(res.failed).toBe(1);
      expect(res.success).toBe(0);

      // Item não foi apagado silenciosamente! Permanece registrado com status FAILED (permanente)
      const record = await syncRepository.findById(item.id);
      expect(record).not.toBeNull();
      expect(record.status).toBe('FAILED');
      expect(record.permanentFailure).toBe(true);
      expect(record.lastError).toContain('não autorizada');

      // Tentativa subsequente de sync: como não está PENDING, NÃO fica em loop infinito!
      const res2 = await syncEngine.processQueue();
      expect(res2.processed).toBe(0);
    });

    it('Operação pendente seguida de mudança de tenant não vaza para a sessão do outro tenant', async () => {
      // 1. Tenant Alpha enfileira operação
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-alpha',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      await syncEngine.enqueue('products', 'prod-alpha-1', 'CREATE', {
        name: 'Item Alpha',
        tenantId: 'tenant-alpha'
      });

      // 2. Nova sessão inicia sob Tenant Beta
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-beta',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-beta'
      });

      // Fila do Tenant Beta não deve ver os itens pendentes do Tenant Alpha
      const pendingBeta = await syncRepository.getPending();
      expect(pendingBeta.length).toBe(0);

      // Processar a fila do Tenant Beta não despacha nem afeta itens do Tenant Alpha
      const resBeta = await syncEngine.processQueue();
      expect(resBeta.processed).toBe(0);

      // Item do Tenant Alpha continua intacto
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-alpha',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });
      const pendingAlpha = await syncRepository.getPending();
      expect(pendingAlpha.length).toBe(1);
      expect(pendingAlpha[0].entityId).toBe('prod-alpha-1');
    });

    it('Falha temporária de rede preserva status PENDING para retentativa; erro de segurança encerra retentativa', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'admin-01',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-alpha'
      });

      const item = await syncEngine.enqueue('products', 'prod-retry-test', 'CREATE', {
        name: 'Item Rede',
        salePriceCents: 500
      });

      // Simula erro temporário de rede
      await syncRepository.markFailed(item.id, 'Sem conexão com o Realtime Database.', 5, false);
      let afterNetErr = await syncRepository.findById(item.id);
      expect(afterNetErr.status).toBe('PENDING'); // Mantém PENDING para retentativa
      expect(afterNetErr.attempts).toBe(1);

      // Simula erro permanente de permissão / segurança
      await syncRepository.markFailed(item.id, '403 Forbidden: Permission Denied', 5, true);
      let afterSecErr = await syncRepository.findById(item.id);
      expect(afterSecErr.status).toBe('FAILED');
      expect(afterSecErr.permanentFailure).toBe(true);

      // Recuperação controlada após regularização via retryFailed()
      await syncRepository.retryFailed();
      let afterRecovery = await syncRepository.findById(item.id);
      expect(afterRecovery.status).toBe('PENDING');
      expect(afterRecovery.attempts).toBe(0);
      expect(afterRecovery.permanentFailure).toBe(false);
    });
  });

  // =========================================================================
  // 3. ISOLAMENTO MULTI-TENANT NO ARMAZENAMENTO LOCAL
  // =========================================================================
  describe('3. Isolamento Multi-Tenant Local (IndexedDB, Caches e Manifestos)', () => {
    it('Registros criados no Tenant A não são visíveis nem editáveis no Tenant B', async () => {
      // 1. Tenant A cria catálogo e estoque
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-a',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-loja-a'
      });

      const prodA = await ProductService.createProduct({
        name: 'Smartwatch Loja A',
        salePriceCents: 39900
      });
      await StockService.recordMovement({
        productId: prodA,
        quantity: 20,
        type: 'IN'
      });

      // Confirma que Tenant A visualiza seus registros
      const prodsA = await productRepository.findAll();
      expect(prodsA.length).toBe(1);
      expect(prodsA[0].id).toBe(prodA);

      // 2. Sessão encerra e inicia Sessão do Tenant B no mesmo navegador
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-b',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-loja-b'
      });

      // Tenant B consulta produtos: NÃO deve ver registros de Tenant A
      const prodsB = await productRepository.findAll();
      expect(prodsB.length).toBe(0);

      // Tenant B tenta consultar direto pelo ID do Produto de A: deve retornar null
      const directSearch = await productRepository.findById(prodA);
      expect(directSearch).toBeNull();

      // Tenant B tenta movimentar estoque do Produto de A: falha
      await expect(StockService.recordMovement({
        productId: prodA,
        quantity: 5,
        type: 'OUT'
      })).rejects.toThrow();

      // Tenant B cria seu próprio produto
      const prodB = await ProductService.createProduct({
        name: 'Fone Bluetooth Loja B',
        salePriceCents: 12900
      });
      const prodsBAfter = await productRepository.findAll();
      expect(prodsBAfter.length).toBe(1);
      expect(prodsBAfter[0].id).toBe(prodB);

      // 3. Restaura sessão do Tenant A: produtos e estoque de A continuam preservados!
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-a',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-loja-a'
      });

      const restoredA = await productRepository.findAll();
      expect(restoredA.length).toBe(1);
      expect(restoredA[0].id).toBe(prodA);
      expect(restoredA[0].name).toBe('Smartwatch Loja A');
    });

    it('Cache de Imagens e Manifestos respeitam estritamente o isolamento de tenant', async () => {
      // 1. Tenant A salva imagem no cache
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-a',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-empresa-1'
      });

      const mockBlob = new Blob(['fake-image-bytes-tenant-1'], { type: 'image/webp' });
      await imageCache.put({
        photoId: 'photo-tenant-1',
        productId: 'prod-1',
        blob: mockBlob,
        version: 1
      });

      // Tenant A consegue recuperar do cache
      const cachedA = await imageCache.get('photo-tenant-1');
      expect(cachedA).not.toBeNull();
      expect(cachedA.photoId).toBe('photo-tenant-1');

      // Tenant A consulta manifesto
      const manifestA = await imageManifestRepository.findByPhotoId('photo-tenant-1');
      expect(manifestA).not.toBeNull();

      // 2. Sessão muda para Tenant B
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-b',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-empresa-2'
      });

      // Tenant B tenta obter foto de Tenant A usando o photoId manipulado: DEVE RETORNAR NULL
      const leakedImg = await imageCache.get('photo-tenant-1');
      expect(leakedImg).toBeNull();

      const leakedMeta = await imageCache.getMetadata('photo-tenant-1');
      expect(leakedMeta).toBeNull();

      const leakedManifest = await imageManifestRepository.findByPhotoId('photo-tenant-1');
      expect(leakedManifest).toBeNull();

      // 3. Restaura Tenant A
      mockProvider.setSession({
        authenticated: true,
        uid: 'user-a',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-empresa-1'
      });

      const recoveredImg = await imageCache.get('photo-tenant-1');
      expect(recoveredImg).not.toBeNull();
      expect(recoveredImg.photoId).toBe('photo-tenant-1');
    });

    it('Inicialização sem sessão autenticada não recebe privilégios nem expõe dados', async () => {
      mockProvider.setSession(null);

      // Sem sessão, operações de escrita são categoricamente bloqueadas
      await expect(ProductService.createProduct({
        name: 'Tentativa Anônima',
        salePriceCents: 5000
      })).rejects.toThrow(/não autenticado/i);

      await expect(StockService.recordMovement({
        productId: 'prod-anon',
        quantity: 1,
        type: 'IN'
      })).rejects.toThrow(/não autenticado/i);
    });
  });

  // =========================================================================
  // 4. REGRESSÃO E INTEGRIDADE DO LEDGER
  // =========================================================================
  describe('4. Regressão e Integridade do Append-Only Ledger', () => {
    it('Múltiplos movimentos de estoque preservam integridade e idempotência do ledger', async () => {
      mockProvider.setSession({
        authenticated: true,
        uid: 'admin-01',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false,
        tenantId: 'tenant-matriz'
      });

      const prodId = await ProductService.createProduct({
        name: 'Ledger Audit Product',
        salePriceCents: 1000
      });

      // Sequência de 3 movimentações
      await StockService.recordMovement({ productId: prodId, quantity: 15, type: 'IN', reason: 'Carga 1' });
      await StockService.recordMovement({ productId: prodId, quantity: 5, type: 'OUT', reason: 'Venda 1' });
      await StockService.recordMovement({ productId: prodId, quantity: 2, type: 'OUT', reason: 'Venda 2' });

      const movements = await stockMovementRepository.findByProductId(prodId, { sortOrder: 'asc' });
      expect(movements.length).toBe(3);

      // Ledger calcula saldo acumulado: 15 - 5 - 2 = 8
      const calculatedBalance = movements.reduce((acc, m) => {
        return m.type === 'IN' ? acc + m.quantity : acc - m.quantity;
      }, 0);
      expect(calculatedBalance).toBe(8);

      // Validação de que nenhum movimento anterior foi modificado (imutabilidade do ledger)
      expect(movements[0].quantity).toBe(15);
      expect(movements[1].quantity).toBe(5);
      expect(movements[2].quantity).toBe(2);
    });
  });
});
