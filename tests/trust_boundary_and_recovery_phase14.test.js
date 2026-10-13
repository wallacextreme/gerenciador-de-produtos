import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { getDB, closeDB } from '../src/js/db/connection.js';
import { legacyDataMigrationService } from '../src/js/services/LegacyDataMigrationService.js';
import { validateAttributionEvidence, resolveTrustedSession } from '../src/js/services/AttributionTrustBoundary.js';
import { BaseRepository, setTenantResolver, getCurrentTenant } from '../src/js/repositories/BaseRepository.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { syncEngine } from '../src/js/services/SyncEngine.js';
import { authService } from '../src/js/services/AuthService.js';
import { LocalImageCache } from '../src/js/services/LocalImageCache.js';
import { SaleService } from '../src/js/services/SaleService.js';
import { PurchaseService } from '../src/js/services/PurchaseService.js';
import { StockService } from '../src/js/services/StockService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import {
  arePayloadsEquivalent,
  computeCanonicalPayloadHash,
  REMOTE_RECONCILIATION_OUTCOME,
  classifyRemoteOutcome,
  isLegacyPayloadHash,
  verifyPayloadIntegrity,
  computeLegacy64BitHash,
  sha256
} from '../src/js/utils/operationIdentity.js';

describe('FASE 14.9 — Legacy Tenant Attribution Trust Boundary & Transaction-Safe Recovery', () => {
  let activeTenant = null;
  let activeSession = null;
  let originalProvider = null;
  let originalAuthService = null;

  const mockAuthService = {
    getTenantId: () => activeTenant,
    getCurrentSession: () => activeSession,
    isConfigured: () => true
  };

  beforeEach(async () => {
    originalProvider = syncEngine.provider;
    originalAuthService = syncEngine.authService;
    await closeDB();
    if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const d of dbs) {
        if (d.name) indexedDB.deleteDatabase(d.name);
      }
    }
    activeTenant = null;
    activeSession = null;
    setTenantResolver(() => activeTenant);
  });

  afterEach(async () => {
    syncEngine.provider = originalProvider;
    syncEngine.authService = originalAuthService;
    await closeDB();
    setTenantResolver(() => authService.getTenantId());
  });

  // =========================================================================
  // 1. PROVENIÊNCIA E FRONTEIRA DE CONFIANÇA (TRUST BOUNDARY)
  // =========================================================================
  describe('1. Proveniência e Fronteira de Confiança (Trust Boundary)', () => {
    it('assignLegacyTenant() rejeita chamada direta com string arbitrária sem evidência estruturada', async () => {
      const db = await getDB();
      await db.add('products', {
        id: 'prod-legacy-1',
        name: 'Produto Legado 1',
        salePriceCents: 1500
      });

      // Tentativa de passar string como "prova"
      await expect(
        productRepository.assignLegacyTenant('prod-legacy-1', 'tenant-alfa', 'ADMIN_RECONCILIATION_VERIFIED')
      ).rejects.toThrow(/strings arbitrárias de origem/);

      // O produto permanece sem tenantId
      const check = await db.get('products', 'prod-legacy-1');
      expect(check.tenantId).toBeUndefined();
    });

    it('assignLegacyTenant() rejeita tentativa de reconciliação humana quando operador não for admin', async () => {
      const db = await getDB();
      await db.add('products', {
        id: 'prod-legacy-2',
        name: 'Produto Legado 2',
        salePriceCents: 2000
      });

      const viewerSession = {
        authenticated: true,
        role: 'viewer',
        appRole: 'viewer',
        tenantId: 'tenant-alfa',
        uid: 'user-viewer-1'
      };

      const humanEvidence = {
        type: 'HUMAN_RECONCILIATION',
        confirmedByHuman: true,
        confirmedByUserId: 'user-viewer-1',
        reason: 'Reconciliação manual por visualizador',
        session: viewerSession
      };

      await expect(
        productRepository.assignLegacyTenant('prod-legacy-2', 'tenant-alfa', humanEvidence, { session: viewerSession })
      ).rejects.toThrow(/Permissão negada: reconciliação humana exige papel "admin"/);

      // Registro permanece intocado
      const check = await db.get('products', 'prod-legacy-2');
      expect(check.tenantId).toBeUndefined();
    });

    it('assignLegacyTenant() aceita reconciliação humana válida por admin e grava trilha de auditoria completa', async () => {
      const db = await getDB();
      await db.add('products', {
        id: 'prod-legacy-3',
        name: 'Produto Legado 3',
        salePriceCents: 3500
      });

      const adminSession = {
        authenticated: true,
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-alfa',
        uid: 'admin-uid-1'
      };

      const validEvidence = {
        type: 'HUMAN_RECONCILIATION',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-uid-1',
        reason: 'Reconciliação confirmada com base em nota fiscal física NF-1234',
        session: adminSession
      };

      const updated = await productRepository.assignLegacyTenant('prod-legacy-3', 'tenant-alfa', validEvidence, { session: adminSession });
      expect(updated.tenantId).toBe('tenant-alfa');
      expect(updated.tenantStatus).toBe('RESOLVED');
      expect(updated.tenantAttributionSource).toBe('EXPLICIT_HUMAN_ADMIN_RECONCILIATION');
      expect(updated.tenantAttributionProof.type).toBe('HUMAN_RECONCILIATION');
      expect(updated.tenantAttributionProof.confirmedByUserId).toBe('admin-uid-1');
      expect(updated.tenantAttributionProof.reason).toBe('Reconciliação confirmada com base em nota fiscal física NF-1234');
      expect(updated.tenantAttributionProof.adminRole).toBe('admin');

      // Verificação direta no banco
      const inDB = await db.get('products', 'prod-legacy-3');
      expect(inDB.tenantId).toBe('tenant-alfa');
      expect(inDB.tenantStatus).toBe('RESOLVED');
    });

    it('assignLegacyTenant() rejeita atribuição quando registro já pertence a outro tenant (conflito preservado)', async () => {
      const db = await getDB();
      await db.add('products', {
        id: 'prod-conflict',
        name: 'Produto Conflitante',
        tenantId: 'tenant-origem-a'
      });

      const adminSession = {
        authenticated: true,
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-destino-b',
        uid: 'admin-uid-b'
      };

      const evidence = {
        type: 'HUMAN_RECONCILIATION',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-uid-b',
        reason: 'Tentativa de apropriação indevida',
        session: adminSession
      };

      await expect(
        productRepository.assignLegacyTenant('prod-conflict', 'tenant-destino-b', evidence, { session: adminSession })
      ).rejects.toThrow(/Conflito irrecuperável: registro já pertence ao tenant "tenant-origem-a"/);

      // O produto permanece rigorosamente no tenant original A
      const inDB = await db.get('products', 'prod-conflict');
      expect(inDB.tenantId).toBe('tenant-origem-a');
    });

    it('migrateUnequivocalRecords() ignora string arbitrária source: "ADMIN_RECONCILIATION_VERIFIED" sem atribuir registros órfãos', async () => {
      const db = await getDB();
      await db.add('products', {
        id: 'prod-orphan',
        name: 'Produto Órfão sem Manifesto',
        salePriceCents: 5000
      });

      // Passa options com source arbitrária
      const result = await legacyDataMigrationService.migrateUnequivocalRecords({
        source: 'ADMIN_RECONCILIATION_VERIFIED'
      });

      // O produto órfão NÃO foi atribuído
      expect(result.migratedCount).toBe(0);
      const orphan = await db.get('products', 'prod-orphan');
      expect(orphan.tenantId).toBeUndefined();
    });

    it('migrateUnequivocalRecords() é estritamente idempotente em execuções repetidas', async () => {
      const db = await getDB();
      await db.add('products', { id: 'prod-p1', name: 'Produto P1' });
      await db.add('imageManifest', { photoId: 'photo-1', productId: 'prod-p1', tenantId: 'tenant-matriz' });

      const firstRun = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(firstRun.migratedCount).toBe(1);

      const secondRun = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(secondRun.migratedCount).toBe(0);

      const thirdRun = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(thirdRun.migratedCount).toBe(0);

      // Quantidade total de registros inalterada
      const allProds = await db.getAll('products');
      expect(allProds.length).toBe(1);
      expect(allProds[0].tenantId).toBe('tenant-matriz');
    });
  });

  // =========================================================================
  // 2. CONSISTÊNCIA TRANSACIONAL E RECONCILIAÇÃO HUMANA
  // =========================================================================
  describe('2. Consistência Transacional e Recuperação de Registros Ambíguos', () => {
    it('getReconciliationReport() classifica corretamente registros elegíveis por proveniência vs pendentes de revisão humana', async () => {
      const db = await getDB();
      // Produto com tenant
      await db.add('products', { id: 'prod-known', name: 'Produto Conhecido', tenantId: 'tenant-empresa-x' });
      // Movimento de estoque referenciando o produto conhecido (elegível por proveniência relacional)
      await db.add('stockMovements', { id: 'mov-eligible', productId: 'prod-known', quantity: 10, type: 'IN' });
      // Venda sem produto conhecido (requer revisão humana)
      await db.add('sales', { id: 'sale-orphan', productId: 'unknown-prod-id', totalCents: 5000 });

      const report = await legacyDataMigrationService.getReconciliationReport();
      expect(report.summary.unassignedTotal).toBe(2);
      expect(report.summary.provenanceEligibleTotal).toBe(1);
      expect(report.summary.requiresHumanReviewTotal).toBe(1);

      expect(report.actionableProvenanceRecords[0].id).toBe('mov-eligible');
      expect(report.actionableProvenanceRecords[0].eligibleTenant).toBe('tenant-empresa-x');

      expect(report.pendingHumanReviewRecords[0].id).toBe('sale-orphan');
    });

    it('executeHumanReconciliationPlan() aplica plano atômico de admin com propagação relacional em cascata', async () => {
      const db = await getDB();
      // Registros legados
      await db.add('products', { id: 'prod-plan-1', name: 'Produto Plano 1', salePriceCents: 8000 });
      await db.add('stockMovements', { id: 'mov-plan-1', productId: 'prod-plan-1', quantity: 20, type: 'IN' });
      await db.add('sales', { id: 'sale-plan-1', productId: 'prod-plan-1', totalCents: 8000 });
      const mockBlob = new Blob(['bytes'], { type: 'image/webp' });
      await db.add('productImages', { id: 'img-plan-1', productId: 'prod-plan-1', blob: mockBlob, hash: 'h1' });

      const adminSession = {
        authenticated: true,
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-empresa-x',
        uid: 'admin-gestor-1'
      };

      const plan = {
        targetTenantId: 'tenant-empresa-x',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-gestor-1',
        reason: 'Reconciliação administrativa autorizada após inventário físico anual',
        records: [
          { storeName: 'products', id: 'prod-plan-1' }
        ]
      };

      const planResult = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession);
      expect(planResult.reconciledCount).toBe(1); // 1 produto reconciliado diretamente
      expect(planResult.cascadedCount).toBe(3); // 3 dependências propagadas em cascata (movimento, venda, foto)
      expect(planResult.totalAffected).toBe(4);

      // Verificação de preservação de integridade comercial
      const p = await db.get('products', 'prod-plan-1');
      expect(p.tenantId).toBe('tenant-empresa-x');
      expect(p.tenantStatus).toBe('RESOLVED');
      expect(p.salePriceCents).toBe(8000); // Valor preservado

      const mov = await db.get('stockMovements', 'mov-plan-1');
      expect(mov.tenantId).toBe('tenant-empresa-x');
      expect(mov.quantity).toBe(20); // Quantidade do ledger preservada

      const s = await db.get('sales', 'sale-plan-1');
      expect(s.tenantId).toBe('tenant-empresa-x');
      expect(s.totalCents).toBe(8000); // Total financeiro preservado

      const img = await db.get('productImages', 'img-plan-1');
      expect(img.tenantId).toBe('tenant-empresa-x');
      expect(img.hash).toBe('h1'); // Hash de integridade preservado
    });

    it('executeHumanReconciliationPlan() falha de forma atômica se um item for inválido ou pertencer a outro tenant', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-valid', name: 'Válido' });
      await db.add('products', { id: 'p-conflict', name: 'Conflito', tenantId: 'tenant-outro' });

      const adminSession = {
        authenticated: true,
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-alfa',
        uid: 'admin-1'
      };

      const invalidPlan = {
        targetTenantId: 'tenant-alfa',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-1',
        reason: 'Plano com conflito',
        records: [
          { storeName: 'products', id: 'p-valid' },
          { storeName: 'products', id: 'p-conflict' }
        ]
      };

      await expect(
        legacyDataMigrationService.executeHumanReconciliationPlan(invalidPlan, adminSession)
      ).rejects.toThrow(/Conflito irrecuperável/);

      // O produto p-valid NÃO foi modificado (atomicidade prévia)
      const p = await db.get('products', 'p-valid');
      expect(p.tenantId).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. OUTBOX: IDEMPOTÊNCIA, RECUPERAÇÃO DE INTERRUPÇÃO E RESULTADO REMOTO
  // =========================================================================
  describe('3. Outbox: Idempotência, Recuperação de Interrupção e Resultado Remoto Desconhecido', () => {
    it('SyncEngine: finaliza como SYNCED operação com remoteAckReceived = true sem re-despacho duplicado', async () => {
      const db = await getDB();
      activeTenant = 'tenant-A';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-A' };

      // Insere item com remoteAckReceived = true (ACK já recebido no ciclo anterior antes de interrupção)
      await db.add('syncQueue', {
        id: 'outbox-acked-item',
        entityType: 'products',
        entityId: 'prod-acked-1',
        action: 'CREATE',
        tenantId: 'tenant-A',
        status: 'PENDING',
        remoteAckReceived: true,
        remoteVersion: '2026-10-10T12:00:00Z',
        createdAt: '2026-10-10T11:00:00Z'
      });

      let pushCount = 0;
      const customMockProvider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-A',
        getProviderName: () => 'MockCloudProvider',
        pushChange: async () => {
          pushCount++;
          return { success: true };
        }
      };

      syncEngine.provider = customMockProvider;
      syncEngine.authService = mockAuthService;

      const result = await syncEngine.processQueue();
      expect(result.success).toBe(1);
      // PUSHCHANGE NÃO DEVE TER SIDO CHAMADO! Foi recuperado localmente pelo ACK prévio!
      expect(pushCount).toBe(0);

      const inDB = await db.get('syncQueue', 'outbox-acked-item');
      expect(inDB.status).toBe('SYNCED');
      expect(inDB.remoteVersion).toBe('2026-10-10T12:00:00Z');
    });

    it('retryFailed(): bloqueia retry cego automático de movimento de estoque com remoteOutcomeUnknown', async () => {
      const db = await getDB();
      activeTenant = 'tenant-A';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-A' };

      // Movimento de estoque no ledger cuja resposta da nuvem foi perdida mid-flight
      await db.add('syncQueue', {
        id: 'outbox-mov-unknown',
        entityType: 'stockMovements',
        entityId: 'mov-unknown-1',
        action: 'CREATE',
        tenantId: 'tenant-A',
        status: 'FAILED',
        permanentFailure: true,
        remoteOutcomeUnknown: true,
        attempts: 1,
        lastError: 'Timeout de conexão: status de confirmação na nuvem desconhecido',
        createdAt: '2026-10-10T11:00:00Z'
      });

      // Tentativa de retry normal sem flag force
      const retryResult = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(retryResult.retriedCount).toBe(0);
      expect(retryResult.skippedCount).toBe(1);
      expect(retryResult.skippedItems[0].reason).toBe('UNKNOWN_REMOTE_OUTCOME_REQUIRES_RECONCILIATION');

      // O item continua FAILED
      const item = await db.get('syncQueue', 'outbox-mov-unknown');
      expect(item.status).toBe('FAILED');
    });

    it('retryFailed(): com options.force permite reativação controlada após confirmação humana', async () => {
      const db = await getDB();
      activeTenant = 'tenant-A';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-A' };

      await db.add('syncQueue', {
        id: 'outbox-mov-force',
        entityType: 'stockMovements',
        entityId: 'mov-force-1',
        action: 'CREATE',
        tenantId: 'tenant-A',
        status: 'FAILED',
        permanentFailure: true,
        remoteOutcomeUnknown: true,
        attempts: 1,
        lastError: 'Conexão interrompida',
        createdAt: '2026-10-10T11:00:00Z'
      });

      // Admin inspecionou e autorizou com force: true
      const retryResult = await syncRepository.retryFailed({ authService: mockAuthService, force: true });
      expect(retryResult.retriedCount).toBe(1);

      const item = await db.get('syncQueue', 'outbox-mov-force');
      expect(item.status).toBe('PENDING');
      expect(item.remoteOutcomeUnknown).toBe(false);
      expect(item.attempts).toBe(0);
    });
  });

  // =========================================================================
  // 4. IMAGENS, MANIFESTOS E INTEGRIDADE DE BINÁRIOS
  // =========================================================================
  describe('4. Imagens, Manifestos e Integridade de Binários', () => {
    it('LocalImageCache não expõe imagem legada sem tenant para tenant ativo e não deleta no clear', async () => {
      const db = await getDB();
      const mockBlob = new Blob(['imagem-legada-conteudo'], { type: 'image/webp' });
      await db.add('productImages', {
        id: 'img-legacy-keep',
        photoId: 'img-legacy-keep',
        productId: 'prod-legacy-keep',
        blob: mockBlob,
        thumbnailBlob: mockBlob,
        hash: 'hash-keep-1',
        version: 1
      });

      const imageCache = new LocalImageCache();

      // Tenant A ativo tenta consultar imagem legada sem tenant
      activeTenant = 'tenant-A';
      const cached = await imageCache.get('img-legacy-keep');
      expect(cached).toBeNull(); // Não vaza!

      // Tenant A executa clear() do cache
      await imageCache.clear();

      // A imagem legada no IndexedDB NÃO FOI APAGADA
      const rawInDB = await db.get('productImages', 'img-legacy-keep');
      expect(rawInDB).not.toBeNull();
      expect(rawInDB.hash).toBe('hash-keep-1');
      expect(rawInDB.blob.size).toBe(mockBlob.size);
    });

    it('Migração de imagens não duplica manifestos nem altera hashes', async () => {
      const db = await getDB();
      const mockBlob = new Blob(['foto-original'], { type: 'image/webp' });
      await db.add('products', { id: 'prod-img-safe', name: 'Produto Seguro', tenantId: 'tenant-safe' });
      await db.add('productImages', {
        id: 'photo-safe-1',
        photoId: 'photo-safe-1',
        productId: 'prod-img-safe',
        blob: mockBlob,
        thumbnailBlob: mockBlob,
        hash: 'sha256-original-hash',
        version: 1
      });

      const result = await legacyDataMigrationService.migrateUnequivocalRecords();
      expect(result.migratedCount).toBe(1);

      const img = await db.get('productImages', 'photo-safe-1');
      expect(img.tenantId).toBe('tenant-safe');
      expect(img.hash).toBe('sha256-original-hash'); // Hash preservado
      expect(img.blob.size).toBe(mockBlob.size); // Binário preservado

      const allImages = await db.getAll('productImages');
      expect(allImages.length).toBe(1); // Nenhuma duplicação
    });
  });

  // =========================================================================
  // 5. FASE 14.10 — AUTORIDADE DE RECONCILIAÇÃO HUMANA (CASOS NEGATIVOS & TRUSTED SESSION)
  // =========================================================================
  describe('5. FASE 14.10 — Autoridade Estrita de Reconciliação Humana (Casos Negativos & Trusted Session)', () => {
    it('resolveTrustedSession() rejeita chamada sem sessão autenticada', () => {
      expect(() => resolveTrustedSession(null, null)).toThrow(/nenhuma sessão autenticada ativa/);
      expect(() => resolveTrustedSession({ authenticated: false }, null)).toThrow(/nenhuma sessão autenticada ativa/);
    });

    it('resolveTrustedSession() rejeita objeto forjado que divirja da autoridade ativa', () => {
      activeSession = {
        authenticated: true,
        uid: 'real-admin',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-real'
      };

      // Tentativa de passar objeto forjado com outro UID
      const forgedSession = {
        authenticated: true,
        uid: 'impostor-uid',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-real'
      };

      expect(() => resolveTrustedSession(forgedSession, mockAuthService)).toThrow(
        /diverge da identidade autenticada corrente/
      );
    });

    it('executeHumanReconciliationPlan() rejeita sessão com requiresMigration: true', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-mig-req', name: 'Prod Pendente Migracao' });

      const pendingMigSession = {
        authenticated: true,
        uid: 'user-legacy-admin',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-alfa',
        requiresMigration: true
      };

      const plan = {
        targetTenantId: 'tenant-alfa',
        confirmedByHuman: true,
        confirmedByUserId: 'user-legacy-admin',
        reason: 'Tentativa de reconciliação antes de migrar claims',
        records: [{ storeName: 'products', id: 'p-mig-req' }]
      };

      await expect(
        legacyDataMigrationService.executeHumanReconciliationPlan(plan, pendingMigSession, { authService: null })
      ).rejects.toThrow(/migração de claims pendente/);

      const p = await db.get('products', 'p-mig-req');
      expect(p.tenantId).toBeUndefined();
    });

    it('executeHumanReconciliationPlan() rejeita operador com papel operator ou viewer', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-role-check', name: 'Prod Role Check' });

      const opSession = {
        authenticated: true,
        uid: 'op-1',
        role: 'operator',
        appRole: 'operator',
        tenantId: 'tenant-alfa'
      };

      const plan = {
        targetTenantId: 'tenant-alfa',
        confirmedByHuman: true,
        confirmedByUserId: 'op-1',
        reason: 'Tentativa de operador reconciliar',
        records: [{ storeName: 'products', id: 'p-role-check' }]
      };

      await expect(
        legacyDataMigrationService.executeHumanReconciliationPlan(plan, opSession, { authService: null })
      ).rejects.toThrow(/reconciliação humana exige papel "admin"/);
    });

    it('executeHumanReconciliationPlan() rejeita tenant divergente entre sessão e plano', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-mismatch', name: 'Prod Tenant Mismatch' });

      const adminSession = {
        authenticated: true,
        uid: 'admin-1',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-alfa'
      };

      const plan = {
        targetTenantId: 'tenant-beta', // Diverge de tenant-alfa
        confirmedByHuman: true,
        confirmedByUserId: 'admin-1',
        reason: 'Tentativa de atribuir a outro tenant',
        records: [{ storeName: 'products', id: 'p-mismatch' }]
      };

      await expect(
        legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null })
      ).rejects.toThrow(/Conflito de tenant da sessão/);
    });

    it('executeHumanReconciliationPlan() deduplica IDs repetidos no plano sem reprocessamento redundante', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-dup', name: 'Prod Duplicado no Plano' });

      const adminSession = {
        authenticated: true,
        uid: 'admin-dedup',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-dedup'
      };

      const plan = {
        targetTenantId: 'tenant-dedup',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-dedup',
        reason: 'Reconciliação com IDs duplicados no array',
        records: [
          { storeName: 'products', id: 'p-dup' },
          { storeName: 'products', id: 'p-dup' } // duplicata intencional
        ]
      };

      const result = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null });
      expect(result.reconciledCount).toBe(1); // Processou apenas uma vez!

      const p = await db.get('products', 'p-dup');
      expect(p.tenantId).toBe('tenant-dedup');
      expect(p.tenantStatus).toBe('RESOLVED');
    });
  });

  // =========================================================================
  // 6. FASE 14.10 — CONSISTÊNCIA TRANSACIONAL MULTI-STORE E ROLLBACK REAL
  // =========================================================================
  describe('6. FASE 14.10 — Consistência Transacional Multi-Store e Rollback Real', () => {
    it('Transação multi-store propaga com sucesso para produtos, cotações (productSuppliers) e dependências', async () => {
      const db = await getDB();
      await db.add('products', { id: 'prod-main', name: 'Produto Principal', salePriceCents: 5000 });
      await db.add('productSuppliers', { id: 'ps-quote-1', productId: 'prod-main', supplierId: 'sup-1', unitCostCents: 3000 });
      await db.add('stockMovements', { id: 'sm-mov-1', productId: 'prod-main', quantity: 5, type: 'IN' });

      const adminSession = {
        authenticated: true,
        uid: 'admin-tx',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-tx'
      };

      const plan = {
        targetTenantId: 'tenant-tx',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-tx',
        reason: 'Reconciliação abrangendo cotações e movimentos',
        records: [{ storeName: 'products', id: 'prod-main' }]
      };

      const res = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null });
      expect(res.reconciledCount).toBe(1);
      expect(res.cascadedCount).toBe(2); // ps-quote-1 e sm-mov-1

      const p = await db.get('products', 'prod-main');
      expect(p.tenantId).toBe('tenant-tx');

      const quote = await db.get('productSuppliers', 'ps-quote-1');
      expect(quote.tenantId).toBe('tenant-tx');
      expect(quote.unitCostCents).toBe(3000); // Preservado

      const sm = await db.get('stockMovements', 'sm-mov-1');
      expect(sm.tenantId).toBe('tenant-tx');
      expect(sm.quantity).toBe(5); // Preservado
    });

    it('Reexecução do plano de reconciliação humana após interrupção conclui de forma limpa e idempotente', async () => {
      const db = await getDB();
      await db.add('products', { id: 'prod-retry', name: 'Produto Reexecução' });

      const adminSession = {
        authenticated: true,
        uid: 'admin-clean',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-clean'
      };

      const plan = {
        targetTenantId: 'tenant-clean',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-clean',
        reason: 'Primeira execução válida',
        records: [{ storeName: 'products', id: 'prod-retry' }]
      };

      const run1 = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null });
      expect(run1.reconciledCount).toBe(1);

      // Reexecução do mesmo plano para o mesmo tenant é idempotente e permitida
      const run2 = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null });
      expect(run2.reconciledCount).toBe(1);

      const p = await db.get('products', 'prod-retry');
      expect(p.tenantId).toBe('tenant-clean');
      expect(p.tenantStatus).toBe('RESOLVED');
    });

    it('migrateUnequivocalRecords() faz rollback atômico se uma store intermediária falhar (zero registros parciais)', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-abort-test', name: 'Produto Abort' });
      await db.add('imageManifest', { photoId: 'ph-abort-1', productId: 'p-abort-test', tenantId: 'tenant-abort' });
      await db.add('stockMovements', { id: 'sm-abort-1', productId: 'p-abort-test', quantity: 10, type: 'IN' });

      // Simula uma falha no meio da transação multi-store interceptando put da store dependente
      const originalTx = db.transaction.bind(db);
      db.transaction = function(storeNames, mode) {
        const tx = originalTx(storeNames, mode);
        if (tx && tx.done && typeof tx.done.catch === 'function') {
          tx.done.catch(() => {});
        }
        const originalObjectStore = tx.objectStore.bind(tx);
        tx.objectStore = function(name) {
          const store = originalObjectStore(name);
          if (name === 'stockMovements') {
            const originalPut = store.put.bind(store);
            store.put = async function(...args) {
              throw new Error('Falha simulada de I/O em stockMovements');
            };
          }
          return store;
        };
        return tx;
      };

      let migrationFailed = false;
      try {
        await legacyDataMigrationService.migrateUnequivocalRecords();
      } catch (err) {
        migrationFailed = true;
        expect(err.message).toContain('Falha simulada de I/O em stockMovements');
      } finally {
        db.transaction = originalTx;
      }
      expect(migrationFailed).toBe(true);

      // Verifica no IndexedDB que o produto NÃO foi atribuído (rollback completo da transação unificada)!
      const p = await db.get('products', 'p-abort-test');
      expect(p.tenantId).toBeUndefined();

      const sm = await db.get('stockMovements', 'sm-abort-1');
      expect(sm.tenantId).toBeUndefined();

      // Aguarda ciclo de microtasks do fake-indexeddb liquidar transação abortada
      await new Promise(r => setTimeout(r, 25));
    });
  });

  // =========================================================================
  // 7. FASE 14.10 — CRASH-WINDOW RECOVERY, IDEMPOTÊNCIA E RECONCILIAÇÃO OUTBOX
  // =========================================================================
  describe('7. FASE 14.10 — Crash-Window Recovery, Idempotência Remota e Outbox', () => {
    it('recoverInterruptedInFlight(): finaliza como SYNCED se remoteAckReceived for true', async () => {
      const db = await getDB();
      await db.add('syncQueue', {
        id: 'outbox-crashed-acked',
        entityType: 'products',
        entityId: 'p-crash-ack',
        action: 'CREATE',
        tenantId: 'tenant-crash',
        status: 'PENDING',
        inFlight: true,
        remoteAckReceived: true,
        remoteVersion: 'rev-duravel-1'
      });

      const recovery = await syncEngine.recoverInterruptedInFlight();
      expect(recovery.recovered).toBe(1);

      const inDB = await db.get('syncQueue', 'outbox-crashed-acked');
      expect(inDB.status).toBe('SYNCED');
      expect(inDB.inFlight).toBe(false);
      expect(inDB.remoteVersion).toBe('rev-duravel-1');
    });

    it('recoverInterruptedInFlight(): bloqueia retry de movimentação de estoque com resultado remoto desconhecido', async () => {
      const db = await getDB();
      await db.add('syncQueue', {
        id: 'outbox-crashed-mov',
        entityType: 'stockMovements',
        entityId: 'mov-crash-unknown',
        action: 'CREATE',
        tenantId: 'tenant-crash',
        status: 'PENDING',
        inFlight: true,
        remoteAckReceived: false
      });

      const recovery = await syncEngine.recoverInterruptedInFlight();
      // FASE 14.23: não reenvia e não bloqueia definitivamente; aguarda reconciliação por leitura
      expect(recovery.blocked).toBe(0);
      expect(recovery.awaitingReconciliation).toBe(1);

      const inDB = await db.get('syncQueue', 'outbox-crashed-mov');
      expect(inDB.status).toBe('PENDING');
      expect(inDB.remoteOutcomeUnknown).toBe(true);
      expect(inDB.requiresResolution).toBe(false);
      expect(inDB.errorCategory).toBe('unknown_remote_outcome');
      expect(inDB.inFlight).toBe(false);
    });

    it('recoverInterruptedInFlight(): permite repetição de produto chave-idempotente após interrupção', async () => {
      const db = await getDB();
      await db.add('syncQueue', {
        id: 'outbox-crashed-prod',
        entityType: 'products',
        entityId: 'prod-idempotent-crash',
        action: 'CREATE',
        tenantId: 'tenant-crash',
        status: 'PENDING',
        inFlight: true,
        remoteAckReceived: false
      });

      const recovery = await syncEngine.recoverInterruptedInFlight();
      expect(recovery.recovered).toBe(1);

      const inDB = await db.get('syncQueue', 'outbox-crashed-prod');
      expect(inDB.status).toBe('PENDING'); // Devolvido com segurança para PENDING
      expect(inDB.inFlight).toBe(false);
      expect(inDB.remoteOutcomeUnknown).toBe(true);
    });

    it('Reconciliação humana reativa Outbox se causa foi unassigned_legacy, mas mantém bloqueio se resultado remoto foi desconhecido', async () => {
      const db = await getDB();
      await db.add('products', { id: 'p-outbox-rec', name: 'Prod Outbox Rec' });

      // Item 1: Falhou puramente por unassigned_legacy (deve ser reativado para PENDING)
      await db.add('syncQueue', {
        id: 'sq-item-legacy',
        entityType: 'products',
        entityId: 'p-outbox-rec',
        action: 'CREATE',
        status: 'FAILED',
        permanentFailure: true,
        requiresResolution: true,
        errorCategory: 'unassigned_legacy',
        lastError: 'Sem tenant'
      });

      // Item 2: Falhou por unknown_remote_outcome (NÃO deve ser reativado automaticamente)
      await db.add('syncQueue', {
        id: 'sq-item-unknown',
        entityType: 'products',
        entityId: 'p-outbox-rec',
        action: 'UPDATE',
        status: 'FAILED',
        permanentFailure: true,
        requiresResolution: true,
        errorCategory: 'unknown_remote_outcome',
        remoteOutcomeUnknown: true,
        lastError: 'Resultado remoto desconhecido'
      });

      const adminSession = {
        authenticated: true,
        uid: 'admin-outbox',
        role: 'admin',
        appRole: 'admin',
        tenantId: 'tenant-rec'
      };

      const plan = {
        targetTenantId: 'tenant-rec',
        confirmedByHuman: true,
        confirmedByUserId: 'admin-outbox',
        reason: 'Reconciliação e liberação de outbox',
        records: [{ storeName: 'products', id: 'p-outbox-rec' }]
      };

      const result = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, adminSession, { authService: null });
      expect(result.outboxReconciledCount).toBe(1); // Somente o item 1 foi liberado!

      const item1 = await db.get('syncQueue', 'sq-item-legacy');
      expect(item1.status).toBe('PENDING');
      expect(item1.tenantId).toBe('tenant-rec');
      expect(item1.requiresResolution).toBe(false);
      expect(item1.reconciledByPlanId).toBeDefined();

      const item2 = await db.get('syncQueue', 'sq-item-unknown');
      expect(item2.status).toBe('FAILED');
      expect(item2.requiresResolution).toBe(true); // Continua bloqueado!
    });

    it('Troca de tenant antes do despacho não vaza itens de Tenant A para Tenant B', async () => {
      const db = await getDB();
      activeTenant = 'tenant-B';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-B' };

      // Item pertencente a Tenant A
      await db.add('syncQueue', {
        id: 'outbox-tenant-a',
        entityType: 'products',
        entityId: 'prod-a-1',
        action: 'CREATE',
        tenantId: 'tenant-A',
        status: 'PENDING',
        createdAt: '2026-10-10T10:00:00Z'
      });

      let pushCount = 0;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-B',
        getProviderName: () => 'Mock',
        pushChange: async () => {
          pushCount++;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      // Nenhum item processado pois não há itens para Tenant B
      expect(pushCount).toBe(0);
      expect(res.processed).toBe(0);

      // O item do Tenant A permanece PENDING e intocado
      const itemA = await db.get('syncQueue', 'outbox-tenant-a');
      expect(itemA.status).toBe('PENDING');
      expect(itemA.tenantId).toBe('tenant-A');
    });
  });

  // =========================================================================
  // 8. FASE 14.11 — OPERATION IDENTITY, RETRY CONTRACT & REMOTE OUTCOME RECONCILIATION
  // =========================================================================
  describe('8. FASE 14.11 — Operation Identity, Retry Contract & Remote Outcome Reconciliation', () => {
    it('Duas tentativas da mesma operação de produto preservam estritamente o entityId e o payload', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const prodId = 'prod-identity-stable-1';
      const item = await syncRepository.enqueue({
        entityType: 'products',
        entityId: prodId,
        action: 'CREATE',
        payload: { id: prodId, name: 'Mouse Sem Fio', salePriceCents: 8900 },
        tenantId: 'tenant-test'
      });

      expect(item.entityId).toBe(prodId);
      expect(item.canonicalPayloadHash).toBeDefined();

      // Falha transitória
      await syncRepository.markFailed(item.id, 'Falha de rede temporária', 1, true, { errorCategory: 'temporary' });
      const failedItem = await db.get('syncQueue', item.id);
      expect(failedItem.status).toBe('FAILED');

      // Retry
      const retryRes = await syncRepository.retryFailed({ authService: mockAuthService });
      expect(retryRes.retriedCount).toBe(1);

      const retriedItem = await db.get('syncQueue', item.id);
      expect(retriedItem.status).toBe('PENDING');
      expect(retriedItem.entityId).toBe(prodId);
      expect(retriedItem.payload.id).toBe(prodId);
      expect(retriedItem.id).toBe(item.id); // Mesmo Outbox ID
    });

    it('Tentativa repetida não sobrescreve silenciosamente conteúdo remoto divergente (detecta conflito)', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const prodId = 'prod-divergent-conflict-1';
      const localPayload = { id: prodId, name: 'Teclado Mecânico ABNT', salePriceCents: 25000 };
      const remoteRecord = { id: prodId, name: 'Teclado Mecânico RGB Diferente', salePriceCents: 32000, updatedAt: '2026-10-10T12:00:00Z' };

      await db.add('syncQueue', {
        id: 'outbox-divergent-prod',
        entityType: 'products',
        entityId: prodId,
        action: 'UPDATE',
        payload: localPayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T10:00:00Z'
      });

      let pushCalled = false;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async (entityType, id) => {
          if (id === prodId) return remoteRecord;
          return null;
        },
        pushChange: async () => {
          pushCalled = true;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      // pushChange NÃO deve ter sido chamado para evitar sobrescrita cega!
      expect(pushCalled).toBe(false);
      expect(res.failed).toBe(1);

      const check = await db.get('syncQueue', 'outbox-divergent-prod');
      expect(check.status).toBe('FAILED');
      expect(check.requiresResolution).toBe(true);
      expect(check.errorCategory).toBe('payload_divergence_conflict');
      expect(check.permanentFailure).toBe(true);
    });

    it('Venda aceita remotamente não é criada novamente com outro ID na recuperação', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const saleId = 'sale-idemp-1';
      const salePayload = {
        id: saleId,
        productId: 'prod-1',
        quantity: 2,
        unitSalePriceCents: 5000,
        totalSaleCents: 10000,
        date: '2026-10-10T14:00:00Z'
      };

      await db.add('syncQueue', {
        id: 'outbox-sale-idemp',
        entityType: 'sales',
        entityId: saleId,
        action: 'CREATE',
        payload: salePayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        inFlightInterrupted: true,
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T14:00:00Z'
      });

      let pushCount = 0;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async (entityType, id) => {
          if (id === saleId) {
            // Remoto já tem o registro equivalente da tentativa anterior
            return { ...salePayload, _serverTimestamp: 123456789, sourceDeviceId: 'dev_original' };
          }
          return null;
        },
        pushChange: async () => {
          pushCount++;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(pushCount).toBe(0); // Nenhum novo despacho!
      expect(res.success).toBe(1);

      const saleItem = await db.get('syncQueue', 'outbox-sale-idemp');
      expect(saleItem.status).toBe('SYNCED');
      expect(saleItem.remoteAckReceived).toBe(true);
      expect(saleItem.remoteOutcomeUnknown).toBe(false);
      expect(saleItem.entityId).toBe(saleId); // ID preservado
    });

    it('Compra aceita remotamente não duplica efeitos associados (estoque)', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const purchaseId = 'pur-idemp-1';
      const movementId = 'sm-dep-pur-1';

      const purPayload = { id: purchaseId, productId: 'prod-1', supplierId: 'sup-1', quantity: 5, unitCostCents: 1000, totalCostCents: 5000 };
      const movPayload = { id: movementId, productId: 'prod-1', quantity: 5, delta: 5, type: 'PURCHASE', referenceId: purchaseId, referenceType: 'PURCHASE' };

      await db.add('syncQueue', {
        id: 'outbox-pur-main',
        entityType: 'purchases',
        entityId: purchaseId,
        action: 'CREATE',
        payload: purPayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T15:00:00Z'
      });

      await db.add('syncQueue', {
        id: 'outbox-mov-dep',
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: movPayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T15:00:01Z'
      });

      let pushCount = 0;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async (entityType, id) => {
          if (id === purchaseId) return { ...purPayload, _serverTimestamp: 1 };
          if (id === movementId) return { ...movPayload, _serverTimestamp: 2 };
          return null;
        },
        pushChange: async () => {
          pushCount++;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(pushCount).toBe(0); // Zero chamadas de push duplicadas
      expect(res.success).toBe(2);

      const checkPur = await db.get('syncQueue', 'outbox-pur-main');
      const checkMov = await db.get('syncQueue', 'outbox-mov-dep');
      expect(checkPur.status).toBe('SYNCED');
      expect(checkMov.status).toBe('SYNCED');
      expect(checkPur.entityId).toBe(purchaseId);
      expect(checkMov.entityId).toBe(movementId);
    });

    it('Movimento de estoque reutiliza o ID lógico original entre tentativas (sem novo UUID)', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const movementId = 'mov-fixed-uuid-1';
      const item = await syncRepository.enqueue({
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { id: movementId, productId: 'prod-1', quantity: 3, delta: 3, type: 'IN' },
        tenantId: 'tenant-test'
      });

      expect(item.entityId).toBe(movementId);

      // Simula 3 tentativas com falha e retry
      for (let attempt = 1; attempt <= 3; attempt++) {
        await syncRepository.markFailed(item.id, `Erro tentativa ${attempt}`, 10, false);
        const cur = await db.get('syncQueue', item.id);
        expect(cur.entityId).toBe(movementId);
        expect(cur.payload.id).toBe(movementId);

        await syncRepository.retryFailed({ authService: mockAuthService });
        const retried = await db.get('syncQueue', item.id);
        expect(retried.entityId).toBe(movementId);
        expect(retried.payload.id).toBe(movementId);
      }
    });

    it('Movimento de estoque existente com payload equivalente é reconhecido como SYNCED', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const movementId = 'sm-equiv-check';
      const movPayload = { id: movementId, productId: 'prod-eq', quantity: 7, delta: 7, type: 'IN', unitCostCents: 150 };

      await db.add('syncQueue', {
        id: 'outbox-sm-eq',
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: movPayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T16:00:00Z'
      });

      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async (entityType, id) => {
          if (id === movementId) {
            return { ...movPayload, sourceDeviceId: 'other_dev', _serverTimestamp: 999 };
          }
          return null;
        },
        pushChange: async () => {
          throw new Error('Não deveria executar pushChange quando equivalente');
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(res.success).toBe(1);

      const check = await db.get('syncQueue', 'outbox-sm-eq');
      expect(check.status).toBe('SYNCED');
      expect(check.remoteAckReceived).toBe(true);
    });

    it('Movimento de estoque existente com payload divergente gera conflito e bloqueia', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const movementId = 'sm-div-check';
      const localPayload = { id: movementId, productId: 'prod-div', quantity: 10, delta: 10, type: 'IN' };
      const remoteRecord = { id: movementId, productId: 'prod-div', quantity: 50, delta: 50, type: 'IN' }; // Divergente!

      await db.add('syncQueue', {
        id: 'outbox-sm-div',
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: localPayload,
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T16:30:00Z'
      });

      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async (entityType, id) => {
          if (id === movementId) return remoteRecord;
          return null;
        },
        pushChange: async () => {
          throw new Error('Sobrescrita indevida!');
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(res.failed).toBe(1);

      const check = await db.get('syncQueue', 'outbox-sm-div');
      expect(check.status).toBe('FAILED');
      expect(check.requiresResolution).toBe(true);
      expect(check.errorCategory).toBe('payload_divergence_conflict');
    });

    it('Resposta de permissão negada não é interpretada como sucesso e bloqueia', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const prodId = 'prod-perm-denied';
      await db.add('syncQueue', {
        id: 'outbox-perm-denied',
        entityType: 'products',
        entityId: prodId,
        action: 'CREATE',
        payload: { id: prodId, name: 'Produto Bloqueado' },
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T17:00:00Z'
      });

      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async () => {
          const err = new Error('PERMISSION_DENIED: Client lacks read permission.');
          err.code = 'PERMISSION_DENIED';
          throw err;
        },
        pushChange: async () => {
          throw new Error('Não deveria executar pushChange');
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(res.failed).toBe(1);

      const check = await db.get('syncQueue', 'outbox-perm-denied');
      expect(check.status).toBe('FAILED');
      expect(check.errorCategory).toBe('security');
      expect(check.requiresResolution).toBe(true);
    });

    it('Servidor remoto inacessível deixa ledger append-only bloqueado para retry cego', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const movementId = 'sm-offline-block';
      await db.add('syncQueue', {
        id: 'outbox-sm-offline',
        entityType: 'stockMovements',
        entityId: movementId,
        action: 'CREATE',
        payload: { id: movementId, productId: 'p1', quantity: 1, delta: 1, type: 'IN' },
        tenantId: 'tenant-test',
        status: 'PENDING',
        remoteOutcomeUnknown: true,
        createdAt: '2026-10-10T17:30:00Z'
      });

      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        getProviderName: () => 'Mock',
        get: async () => {
          throw new Error('Network timeout (offline)');
        },
        pushChange: async () => {
          throw new Error('Não deve tentar push cego no ledger se remoto estiver inacessível');
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      // FASE 14.23: falha de leitura = reconciliação adiada (backoff), nunca ausência, nunca push cego
      expect(res.failed).toBe(0);
      expect(res.reconcileDeferred).toBe(1);

      const check = await db.get('syncQueue', 'outbox-sm-offline');
      expect(check.status).toBe('PENDING');
      expect(check.requiresResolution).toBe(false);
      expect(check.remoteOutcomeUnknown).toBe(true);
      expect(check.errorCategory).toBe('unknown_remote_outcome');
      expect(check.reconcileAttempts).toBe(1);
      expect(check.nextReconcileAt).toBeTruthy();
    });

    it('ACK persistido permite finalização local sem nova chamada remota', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      await db.add('syncQueue', {
        id: 'outbox-ack-persisted',
        entityType: 'products',
        entityId: 'p-ack-1',
        action: 'CREATE',
        payload: { id: 'p-ack-1', name: 'Ack Prod' },
        tenantId: 'tenant-test',
        status: 'SYNCING',
        inFlight: true,
        remoteAckReceived: true,
        remoteVersion: '2026-10-10T18:00:00Z',
        createdAt: '2026-10-10T18:00:00Z'
      });

      let callCount = 0;
      syncEngine.provider = {
        isConfigured: () => true,
        pushChange: async () => {
          callCount++;
          return { success: true };
        }
      };

      const res = await syncEngine.recoverInterruptedInFlight();
      expect(res.recovered).toBe(1);
      expect(callCount).toBe(0); // Zero chamadas remotas

      const check = await db.get('syncQueue', 'outbox-ack-persisted');
      expect(check.status).toBe('SYNCED');
      expect(check.inFlight).toBe(false);
      expect(check.remoteAckReceived).toBe(true);
    });

    it('Operação SYNCED não é enviada novamente após reinicialização', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      await db.add('syncQueue', {
        id: 'outbox-already-synced',
        entityType: 'products',
        entityId: 'p-synced-1',
        action: 'CREATE',
        payload: { id: 'p-synced-1', name: 'Synced Prod' },
        tenantId: 'tenant-test',
        status: 'SYNCED',
        syncedAt: '2026-10-10T19:00:00Z',
        remoteAckReceived: true,
        createdAt: '2026-10-10T19:00:00Z'
      });

      let pushCount = 0;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        pushChange: async () => {
          pushCount++;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const res = await syncEngine.processQueue();
      expect(pushCount).toBe(0);
      expect(res.processed).toBe(0);

      const check = await db.get('syncQueue', 'outbox-already-synced');
      expect(check.status).toBe('SYNCED');
    });

    it('options.force não contorna verificações de integridade (rejeita não-admin e divergência sem estratégia)', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';

      await db.add('syncQueue', {
        id: 'outbox-conflict-force',
        entityType: 'products',
        entityId: 'p-force-div',
        action: 'UPDATE',
        payload: { id: 'p-force-div', name: 'Local A' },
        tenantId: 'tenant-test',
        status: 'FAILED',
        permanentFailure: true,
        errorCategory: 'payload_divergence_conflict',
        requiresResolution: true,
        createdAt: '2026-10-10T19:30:00Z'
      });

      // 1. Não-admin tenta usar force: true
      const operatorService = {
        getTenantId: () => 'tenant-test',
        getCurrentSession: () => ({ authenticated: true, role: 'operator', appRole: 'operator', tenantId: 'tenant-test' }),
        isConfigured: () => true
      };

      const resOp = await syncRepository.retryFailed({ authService: operatorService, force: true });
      expect(resOp.retriedCount).toBe(0);
      expect(resOp.skippedItems[0].reason).toBe('FORCE_RETRY_REQUIRES_ADMIN_ROLE');

      // 2. Admin tenta force: true sem resolutionAction explícita
      const adminService = {
        getTenantId: () => 'tenant-test',
        getCurrentSession: () => ({ authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' }),
        isConfigured: () => true
      };

      const resAdminNoAction = await syncRepository.retryFailed({ authService: adminService, force: true });
      expect(resAdminNoAction.retriedCount).toBe(0);
      expect(resAdminNoAction.skippedItems[0].reason).toBe('PAYLOAD_DIVERGENCE_REQUIRES_EXPLICIT_RESOLUTION');

      // 3. Admin com resolutionAction autorizada consegue liberar preservando entityId
      const resAdminWithAction = await syncRepository.retryFailed({
        authService: adminService,
        force: true,
        resolutionAction: 'OVERWRITE_REMOTE'
      });
      expect(resAdminWithAction.retriedCount).toBe(1);

      const check = await db.get('syncQueue', 'outbox-conflict-force');
      expect(check.status).toBe('PENDING');
      expect(check.entityId).toBe('p-force-div'); // ID estritamente preservado!
    });

    it('Procedimento de inspeção e reconciliação manual (inspectOutboxItem & reconcileOutboxItem)', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      const adminSession = { authenticated: true, uid: 'admin-master', role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };
      activeSession = adminSession;

      const prodId = 'prod-manual-rec';
      await db.add('syncQueue', {
        id: 'outbox-manual-item',
        entityType: 'products',
        entityId: prodId,
        action: 'UPDATE',
        payload: { id: prodId, name: 'Produto Local', salePriceCents: 1000 },
        tenantId: 'tenant-test',
        status: 'FAILED',
        permanentFailure: true,
        requiresResolution: true,
        errorCategory: 'payload_divergence_conflict',
        createdAt: '2026-10-10T20:00:00Z'
      });

      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        get: async (entityType, id) => {
          if (id === prodId) return { id: prodId, name: 'Produto Remoto Oficial', salePriceCents: 1500 };
          return null;
        }
      };
      syncEngine.authService = mockAuthService;

      // 1. Inspeção estruturada
      const inspection = await syncEngine.inspectOutboxItem('outbox-manual-item', { authService: mockAuthService });
      expect(inspection.entityId).toBe(prodId);
      expect(inspection.comparisonOutcome).toBe('RECORD_DIVERGENT');
      expect(inspection.isEquivalent).toBe(false);
      expect(inspection.divergentFields.length).toBeGreaterThan(0);

      // 2. Não-admin não pode reconciliar
      const viewerSession = { authenticated: true, uid: 'viewer-1', role: 'viewer', appRole: 'viewer', tenantId: 'tenant-test' };
      await expect(
        syncEngine.reconcileOutboxItem('outbox-manual-item', 'ACCEPT_REMOTE', { session: viewerSession, authService: mockAuthService })
      ).rejects.toThrow(/papel "admin"/);

      // 3. Não pode executar OVERWRITE_REMOTE em ledger de estoque
      await db.add('syncQueue', {
        id: 'outbox-ledger-rec',
        entityType: 'stockMovements',
        entityId: 'sm-ledger-test',
        action: 'CREATE',
        payload: { id: 'sm-ledger-test', productId: 'p1' },
        tenantId: 'tenant-test',
        status: 'FAILED',
        createdAt: '2026-10-10T20:05:00Z'
      });

      await expect(
        syncEngine.reconcileOutboxItem('outbox-ledger-rec', 'OVERWRITE_REMOTE', { session: adminSession, authService: mockAuthService })
      ).rejects.toThrow(/ledger de estoque é append-only/);

      // 4. Admin executa ACCEPT_REMOTE com auditoria durável
      const recRes = await syncEngine.reconcileOutboxItem('outbox-manual-item', 'ACCEPT_REMOTE', {
        session: adminSession,
        authService: mockAuthService,
        reason: 'Versão remota confirmada com a matriz fiscal'
      });
      expect(recRes.success).toBe(true);

      const reconciledItem = await db.get('syncQueue', 'outbox-manual-item');
      expect(reconciledItem.status).toBe('SYNCED');
      expect(reconciledItem.remoteAckReceived).toBe(true);
      expect(reconciledItem.reconciledByAdminUid).toBe('admin-master');
      expect(reconciledItem.reconciliationDecision).toBe('ACCEPT_REMOTE');
      expect(reconciledItem.reconciliationReason).toBe('Versão remota confirmada com a matriz fiscal');
    });

    it('Operações compostas (Venda e Compra) geram efeitos de estoque com identificadores estáveis separados e vinculados na Outbox', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      await db.add('products', {
        id: 'prod-compound-1',
        name: 'Produto Composto',
        salePriceCents: 5000,
        purchasePriceCents: 3000,
        stockQuantity: 20,
        tenantId: 'tenant-test'
      });

      // Configura os listeners no syncEngine
      await syncEngine.init();

      // Executa venda
      const saleResult = await SaleService.recordSale({
        productId: 'prod-compound-1',
        quantity: 3,
        tenantId: 'tenant-test'
      });

      // Aguarda listeners assíncronos do eventBus
      await new Promise(r => setTimeout(r, 30));

      const allQueue = await syncRepository.findAll();
      const saleItem = allQueue.find(i => i.entityType === 'sales' && i.entityId === saleResult.saleId);
      const movItem = allQueue.find(i => (i.entityType === 'stockMovements' || i.entityType === 'inventory') && i.payload.referenceId === saleResult.saleId);

      expect(saleItem).toBeDefined();
      expect(movItem).toBeDefined();
      expect(saleItem.entityId).toBe(saleResult.saleId);
      expect(saleItem.id).not.toBe(movItem.id); // Outbox IDs distintos
      expect(movItem.payload.referenceType).toBe('SALE');
      expect(movItem.payload.referenceId).toBe(saleResult.saleId);
    });
  });

  // =========================================================================
  // 9. FASE 14.12 — ATOMIC RTDB WRITES, CONCURRENCY WINDOWS & OUTBOX RECOVERY
  // =========================================================================
  describe('9. FASE 14.12 — Atomic RTDB Writes, Concurrency Windows & Outbox Recovery Contract', () => {
    it('Canonical SHA-256 payload hash: gera prefixo can_sha256_, 64 caracteres hexadecimais e ignora campos voláteis', () => {
      const payload1 = {
        id: 'p-sha-1',
        name: 'Item Teste',
        salePriceCents: 1500,
        updatedAt: '2026-10-11T12:00:00Z',
        _serverTimestamp: 123456789,
        sourceDeviceId: 'dev-1',
        lastMutationId: 'mut-1'
      };

      const payload2 = {
        name: 'Item Teste',
        id: 'p-sha-1',
        salePriceCents: 1500,
        updatedAt: '2026-10-11T15:30:00Z', // Timestamp diferente (volátil)
        _serverTimestamp: 987654321,         // Timestamp diferente (volátil)
        sourceDeviceId: 'dev-2',            // Device diferente (volátil)
        lastMutationId: 'mut-2'             // MutationId diferente (volátil)
      };

      const hash1 = computeCanonicalPayloadHash('products', payload1);
      const hash2 = computeCanonicalPayloadHash('products', payload2);

      expect(hash1.startsWith('can_sha256_')).toBe(true);
      expect(hash1.length).toBe(11 + 64); // "can_sha256_" (11) + 64 hex chars
      expect(hash1).toBe(hash2); // Determinístico e imune a campos voláteis

      // Divergência de negócio altera o hash
      const payloadDivergent = { ...payload1, salePriceCents: 2000 };
      const hashDivergent = computeCanonicalPayloadHash('products', payloadDivergent);
      expect(hashDivergent).not.toBe(hash1);
    });

    it('Retrocompatibilidade: identifica hash legado de 64 bits e verifica integridade', () => {
      const legacyCalculated = computeLegacy64BitHash('legacy-test-string');
      expect(isLegacyPayloadHash(legacyCalculated)).toBe(true);
      expect(isLegacyPayloadHash('can_sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false);

      const payload = { id: 'p-leg-1', name: 'Legacy Prod', salePriceCents: 500 };
      const shaHash = computeCanonicalPayloadHash('products', payload);
      expect(verifyPayloadIntegrity('products', payload, shaHash).valid).toBe(true);
      expect(verifyPayloadIntegrity('products', { ...payload, salePriceCents: 999 }, shaHash).valid).toBe(false);
    });

    it('Conflito de concorrência detectado pelo provedor bloqueia item na Outbox com requiresResolution: true', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const outboxItem = {
        id: 'outbox-conflict-test',
        entityType: 'products',
        entityId: 'p-conflict-1',
        action: 'UPDATE',
        payload: {
          id: 'p-conflict-1',
          name: 'Nome Atualizado',
          salePriceCents: 3500,
          baseVersion: 1,
          version: 2
        },
        tenantId: 'tenant-test',
        status: 'PENDING',
        inFlight: false,
        createdAt: new Date().toISOString()
      };
      await db.add('syncQueue', outboxItem);

      // Simula provedor rejeitando com erro de concorrência
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        get: async () => ({ id: 'p-conflict-1', version: 3 }), // Remoto já avançou para v3
        pushChange: async () => {
          const err = new Error('Conflito de concorrência: versão remota difere da base esperada.');
          err.code = 'concurrency_conflict';
          err.errorCategory = 'version_conflict';
          throw err;
        }
      };
      syncEngine.authService = mockAuthService;

      const result = await syncEngine.processQueue();
      expect(result.failed).toBe(1);

      const check = await db.get('syncQueue', 'outbox-conflict-test');
      expect(check.status).toBe('FAILED');
      expect(check.requiresResolution).toBe(true);
      expect(check.errorCategory).toBe('version_conflict');

      // Tentativa subsequente de sync não envia itens bloqueados
      let callCount = 0;
      syncEngine.provider.pushChange = async () => { callCount++; return { success: true }; };
      await syncEngine.processQueue();
      expect(callCount).toBe(0); // Bloqueado contra retry cego
    });

    it('Retry de operação com ACK remoto perdido: reconciliação detecta equivalente e transiciona para SYNCED', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const outboxItem = {
        id: 'outbox-lost-ack',
        entityType: 'products',
        entityId: 'p-lost-ack-1',
        action: 'CREATE',
        payload: {
          id: 'p-lost-ack-1',
          name: 'Produto Perdido ACK',
          salePriceCents: 4500
        },
        tenantId: 'tenant-test',
        status: 'PENDING',
        inFlight: false,
        remoteOutcomeUnknown: true, // Indica que houve tentativa anterior com resultado desconhecido
        createdAt: new Date().toISOString()
      };
      await db.add('syncQueue', outboxItem);

      let pushChangeCalled = false;
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        // Provedor remoto já tem o registro equivalente
        get: async () => ({
          id: 'p-lost-ack-1',
          name: 'Produto Perdido ACK',
          salePriceCents: 4500,
          version: 1
        }),
        pushChange: async () => {
          pushChangeCalled = true;
          return { success: true };
        }
      };
      syncEngine.authService = mockAuthService;

      const result = await syncEngine.processQueue();
      expect(result.success).toBe(1);
      expect(pushChangeCalled).toBe(false); // Não realizou nova escrita remota (reconciliado via equivalência)

      const check = await db.get('syncQueue', 'outbox-lost-ack');
      expect(check.status).toBe('SYNCED');
      expect(check.remoteAckReceived).toBe(true);
    });

    it('Resultado remoto inacessível (falha de transporte na verificação prévia) mantém bloqueio e recusa retry cego', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      const outboxItem = {
        id: 'outbox-unreachable',
        entityType: 'stockMovements',
        entityId: 'mov-unreachable-1',
        action: 'CREATE',
        payload: {
          id: 'mov-unreachable-1',
          productId: 'prod-1',
          delta: 5,
          quantity: 5,
          type: 'IN'
        },
        tenantId: 'tenant-test',
        status: 'SYNCING',
        inFlight: true,
        createdAt: new Date().toISOString()
      };
      await db.add('syncQueue', outboxItem);

      // Provedor com transporte inacessível
      syncEngine.provider = {
        isConfigured: () => true,
        getTenantId: () => 'tenant-test',
        get: async () => {
          const err = new Error('Network timeout: remote host unreachable.');
          err.code = 'network_error';
          throw err;
        },
        pushChange: async () => {
          throw new Error('Should not be called');
        }
      };
      syncEngine.authService = mockAuthService;

      const rec = await syncEngine.recoverInterruptedInFlight();
      // FASE 14.23: recuperação NÃO bloqueia nem reenvia; devolve a PENDING + remoteOutcomeUnknown para reconciliar por leitura
      expect(rec.blocked).toBe(0);
      expect(rec.awaitingReconciliation).toBe(1);

      const check = await db.get('syncQueue', 'outbox-unreachable');
      expect(check.status).toBe('PENDING');
      expect(check.requiresResolution).toBe(false);
      expect(check.remoteOutcomeUnknown).toBe(true);
      expect(check.errorCategory).toBe('unknown_remote_outcome');

      // Leitura inacessível posterior: adiada com backoff, SEM push cego (pushChange lança se chamado)
      const res = await syncEngine.processQueue();
      expect(res.reconcileDeferred).toBe(1);
      const after = await db.get('syncQueue', 'outbox-unreachable');
      expect(after.status).toBe('PENDING');
      expect(after.requiresResolution).toBe(false);
      expect(after.remoteOutcomeUnknown).toBe(true);
      expect(after.nextReconcileAt).toBeTruthy();
    });

    it('ProductService.updateProduct emite baseVersion e version monotônico', async () => {
      const db = await getDB();
      activeTenant = 'tenant-test';
      activeSession = { authenticated: true, role: 'admin', appRole: 'admin', tenantId: 'tenant-test' };

      // Cria produto inicial
      const productId = await ProductService.createProduct({
        name: 'Produto Base Version',
        salePriceCents: 1000,
        tenantId: 'tenant-test'
      });
      const created = await productRepository.findById(productId);
      expect(created.version).toBe(1);

      // Atualiza produto
      await ProductService.updateProduct(productId, {
        name: 'Produto Base Version',
        salePriceCents: 1500
      });
      const updated = await productRepository.findById(productId);
      expect(updated.baseVersion).toBe(1);
      expect(updated.version).toBe(2);

      // Segunda atualização
      await ProductService.updateProduct(productId, {
        name: 'Produto Base Version',
        salePriceCents: 2000
      });
      const updated2 = await productRepository.findById(productId);
      expect(updated2.baseVersion).toBe(2);
      expect(updated2.version).toBe(3);
    });
  });
});
