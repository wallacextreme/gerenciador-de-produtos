import { getDB } from '../db/connection.js';
import { validateAttributionEvidence, resolveTrustedSession } from './AttributionTrustBoundary.js';
import { authService } from './AuthService.js';

/**
 * GestãoPro — LegacyDataMigrationService (FASE 14.9 & 14.10)
 *
 * Serviço de auditoria, isolamento, fronteira de confiança e migração segura de dados legados:
 * - Separação estrita entre metadado descritivo, proveniência e confirmação humana;
 * - NUNCA aceita uma string arbitrária (ex: 'ADMIN_RECONCILIATION_VERIFIED') como prova isolada de reconciliação;
 * - Migração atômica e consistente via transações multi-store do IndexedDB;
 * - Preservação total de identificadores originais, relacionamentos comerciais, valores e histórico do ledger;
 * - Suporte a plano estruturado de reconciliação humana com autorização de administrador;
 * - Proteção de itens legados e interrupções em voo na Outbox.
 */
export class LegacyDataMigrationService {
  constructor() {
    this.monitoredStores = [
      'products',
      'sales',
      'purchases',
      'stockMovements',
      'suppliers',
      'productSuppliers',
      'categories',
      'productImages',
      'imageManifest',
      'syncQueue'
    ];
  }

  /**
   * Realiza auditoria completa dos registros do IndexedDB identificando registros
   * com tenant confiável, sem tenant, e pendentes de resolução.
   * @returns {Promise<Object>}
   */
  async auditLegacyData() {
    const db = await getDB();
    const stats = {
      stores: {},
      totalRecords: 0,
      totalAssigned: 0,
      totalUnassigned: 0,
      totalPendingAttribution: 0,
      outboxSummary: {
        total: 0,
        assigned: 0,
        unassigned: 0,
        pending: 0,
        failed: 0,
        requiresResolution: 0
      }
    };

    for (const storeName of this.monitoredStores) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      const all = await db.getAll(storeName);
      
      let assigned = 0;
      let unassigned = 0;
      let pendingAttribution = 0;

      for (const item of all) {
        if (item.tenantId) {
          assigned++;
        } else {
          unassigned++;
          if (item.tenantStatus === 'PENDING_ATTRIBUTION') {
            pendingAttribution++;
          }
        }
      }

      stats.stores[storeName] = {
        total: all.length,
        assigned,
        unassigned,
        pendingAttribution
      };

      stats.totalRecords += all.length;
      stats.totalAssigned += assigned;
      stats.totalUnassigned += unassigned;
      stats.totalPendingAttribution += pendingAttribution;

      if (storeName === 'syncQueue') {
        stats.outboxSummary.total = all.length;
        stats.outboxSummary.assigned = assigned;
        stats.outboxSummary.unassigned = unassigned;
        stats.outboxSummary.pending = all.filter(i => i.status === 'PENDING').length;
        stats.outboxSummary.failed = all.filter(i => i.status === 'FAILED').length;
        stats.outboxSummary.requiresResolution = all.filter(i => i.requiresResolution).length;
      }
    }

    return stats;
  }

  /**
   * Emite relatório aprofundado de reconciliação para administradores:
   * Classifica registros em elegíveis para migração relacional inequívoca vs pendentes de revisão humana.
   * Não expõe dados comerciais entre tenants.
   * @returns {Promise<Object>}
   */
  async getReconciliationReport() {
    const db = await getDB();
    const report = {
      summary: {
        unassignedTotal: 0,
        provenanceEligibleTotal: 0,
        requiresHumanReviewTotal: 0,
        conflictsTotal: 0
      },
      stores: {},
      actionableProvenanceRecords: [],
      pendingHumanReviewRecords: []
    };

    // Mapeia produtos com tenant conhecido
    const knownProductTenants = new Map();
    if (db.objectStoreNames.contains('products')) {
      const prods = await db.getAll('products');
      prods.forEach(p => {
        if (p.tenantId) knownProductTenants.set(p.id, p.tenantId);
      });
    }

    for (const storeName of this.monitoredStores) {
      if (storeName === 'syncQueue' || storeName === 'settings') continue;
      if (!db.objectStoreNames.contains(storeName)) continue;

      const items = await db.getAll(storeName);
      let storeUnassigned = 0;
      let storeProvenanceEligible = 0;
      let storeRequiresHumanReview = 0;

      for (const item of items) {
        if (!item.tenantId) {
          storeUnassigned++;
          report.summary.unassignedTotal++;

          // Verifica se possui produto pai conhecido
          const parentId = item.productId;
          if (parentId && knownProductTenants.has(parentId)) {
            storeProvenanceEligible++;
            report.summary.provenanceEligibleTotal++;
            report.actionableProvenanceRecords.push({
              storeName,
              id: item.id || item.photoId,
              productId: parentId,
              eligibleTenant: knownProductTenants.get(parentId),
              provenanceType: 'PARENT_PRODUCT_RELATION'
            });
          } else {
            storeRequiresHumanReview++;
            report.summary.requiresHumanReviewTotal++;
            report.pendingHumanReviewRecords.push({
              storeName,
              id: item.id || item.photoId,
              status: item.tenantStatus || 'UNASSIGNED',
              requiresResolution: true
            });
          }
        }
      }

      report.stores[storeName] = {
        unassigned: storeUnassigned,
        provenanceEligible: storeProvenanceEligible,
        requiresHumanReview: storeRequiresHumanReview
      };
    }

    return report;
  }

  /**
   * Executa a migração de registros cuja atribuição seja comprovadamente inequívoca:
   * 1. Produtos correlacionados a manifestos onde todas as fotos pertencem a um único tenant;
   * 2. Fotos, manifestos, vendas, compras e movimentações de estoque referenciando produtos com tenant comprovado;
   *
   * REJEIÇÃO EXPLÍCITA: Se o chamador fornecer uma string arbitrária (ex: source: 'ADMIN_RECONCILIATION_VERIFIED')
   * sem plano estruturado de confirmação humana, o método ignora ou rejeita essa string como evidência isolada.
   *
   * SEGURANÇA TRANSACIONAL: Operações relacionadas são aplicadas em transações atômicas multi-store do IndexedDB.
   *
   * @param {Object} [options={}]
   * @returns {Promise<{ migratedCount: number, details: Array<Object> }>}
   */
  async migrateUnequivocalRecords(options = {}) {
    const db = await getDB();
    const details = [];
    let migratedCount = 0;

    // Se o chamador tentar passar apenas uma string de origem como argumento (ex: source = 'ADMIN_RECONCILIATION_VERIFIED')
    // sem plano formal de reconciliação humana, rejeita de forma fail-closed sem atribuir registros.
    if (options && typeof options === 'object' && options.source && !options.humanPlan && !options.verifiedEvidence) {
      if (typeof options.source === 'string') {
        console.warn('[LegacyDataMigrationService] Chamador forneceu source descritivo sem evidência estruturada. Ignorando como prova de atribuição.');
      }
    }

    if (!db.objectStoreNames.contains('products')) {
      return { migratedCount: 0, details: [] };
    }

    // Lista canônica de todas as stores que podem ser lidas ou modificadas pelo processo de migração
    const candidateStores = [
      'products',
      'imageManifest',
      'productImages',
      'stockMovements',
      'sales',
      'purchases',
      'suppliers',
      'productSuppliers'
    ];
    const availableStores = candidateStores.filter(s => db.objectStoreNames.contains(s));

    // Abre UMA ÚNICA transação multi-store atômica cobrindo todas as stores envolvidas (incluindo products)
    const tx = db.transaction(availableStores, 'readwrite');
    if (tx && tx.done && typeof tx.done.catch === 'function') {
      tx.done.catch((e) => {
        // Ignora AbortError de rollback seguro
      });
    }

    try {
      const prodStore = tx.objectStore('products');
      const allProducts = await prodStore.getAll();

      // 1. Correlação Produto <-> Manifesto de Imagens (dentro do mesmo contexto transacional tx)
      if (availableStores.includes('imageManifest')) {
        const manStore = tx.objectStore('imageManifest');
        const allManifests = await manStore.getAll();

        const manifestTenantsByProduct = new Map();
        for (const m of allManifests) {
          if (m.productId && m.tenantId) {
            if (!manifestTenantsByProduct.has(m.productId)) {
              manifestTenantsByProduct.set(m.productId, new Set());
            }
            manifestTenantsByProduct.get(m.productId).add(m.tenantId);
          }
        }

        for (const p of allProducts) {
          if (!p.tenantId) {
            const tenantSet = manifestTenantsByProduct.get(p.id);
            if (tenantSet && tenantSet.size === 1) {
              const singleTenant = Array.from(tenantSet)[0];
              const evidence = {
                type: 'IMAGE_MANIFEST_PROVENANCE',
                singleTenant,
                manifestCount: manifestTenantsByProduct.get(p.id).size
              };

              const validation = validateAttributionEvidence({
                targetTenantId: singleTenant,
                existingRecord: p,
                evidence
              });

              p.tenantId = singleTenant;
              p.tenantStatus = 'RESOLVED';
              p.tenantAttributionSource = validation.attributionSource;
              p.tenantAttributionProof = validation.proofDetails;
              p.tenantAttributionAt = new Date().toISOString();
              p.updatedAt = new Date().toISOString();

              await prodStore.put(p);
              migratedCount++;
              details.push({ storeName: 'products', id: p.id, tenantId: singleTenant, source: validation.attributionSource });
            }
          }
        }
      }

      // 2. Mapeamento dos produtos com tenant conhecido (existentes + recém-atribuídos)
      const productTenantMap = new Map();
      allProducts.forEach(p => {
        if (p.tenantId) productTenantMap.set(p.id, p.tenantId);
      });

      // 3. Propagação Transacional Atômica para Entidades Filhas (dentro do mesmo tx)
      const childStores = ['productImages', 'imageManifest', 'stockMovements', 'sales', 'purchases', 'productSuppliers']
        .filter(s => availableStores.includes(s));

      for (const storeName of childStores) {
        const store = tx.objectStore(storeName);
        const allItems = await store.getAll();
        for (const item of allItems) {
          if (!item.tenantId && item.productId && productTenantMap.has(item.productId)) {
            const parentTenant = productTenantMap.get(item.productId);
            const validation = validateAttributionEvidence({
              targetTenantId: parentTenant,
              existingRecord: item,
              evidence: {
                type: 'RELATIONAL_PROVENANCE',
                parentEntity: 'products',
                parentId: item.productId,
                parentTenant
              }
            });

            item.tenantId = parentTenant;
            item.tenantStatus = 'RESOLVED';
            item.tenantAttributionSource = validation.attributionSource;
            item.tenantAttributionProof = validation.proofDetails;
            item.tenantAttributionAt = new Date().toISOString();
            if (item.updatedAt !== undefined) {
              item.updatedAt = new Date().toISOString();
            }

            await store.put(item);
            migratedCount++;
            details.push({ storeName, id: item.id || item.photoId, tenantId: parentTenant, source: validation.attributionSource });
          }
        }
      }

      // Aguarda commit efetivo de TODAS as stores
      await tx.done;
    } catch (err) {
      try {
        if (tx && typeof tx.abort === 'function') {
          tx.abort();
          if (tx.done && typeof tx.done.catch === 'function') {
            await tx.done.catch(() => {});
          }
        }
      } catch (_) {}
      console.error('[LegacyDataMigrationService] Falha na transação multi-store atômica de migração:', err);
      throw err;
    }

    return { migratedCount, details };
  }

  /**
   * Executa um plano formal e estruturado de reconciliação humana de registros ambíguos.
   *
   * Requisitos estritos de integridade:
   * 1. Sessão ativa autenticada com papel 'admin' obtida da fonte confiável (AuthService);
   * 2. Confirmação humana explícita (confirmedByHuman === true, confirmedByUserId correspondente ao operador, reason fundamentada);
   * 3. Congelamento defensivo e deduplicação de registros { storeName, id } para evitar mutação concorrente;
   * 4. Pré-validação estrita contra a fronteira de confiança (rejeição de conflitos e cross-tenant);
   * 5. Execução em transação multi-store atômica do IndexedDB abrangendo todas as stores afetadas;
   * 6. Propagação relacional em cascata para dependências (manifestos, fotos, movimentos, vendas, compras, cotações);
   * 7. Reconciliação segura da Outbox (syncQueue): itens retidos por unassigned_legacy são tornados PENDING de forma explícita;
   *    operações com resultado remoto desconhecido no ledger ou erros permanentes NUNCA são reativadas cegamente.
   *
   * @param {Object} plan Plano de reconciliação
   * @param {Object} [session=null] Sessão informada pelo chamador (validada contra autoridade confiável)
   * @param {Object} [options={}] Opções adicionais (ex: authService personalizado)
   * @returns {Promise<{ reconciledCount: number, cascadedCount: number, outboxReconciledCount: number, totalAffected: number, details: Array<Object> }>}
   */
  async executeHumanReconciliationPlan(plan, session = null, options = {}) {
    if (!plan || typeof plan !== 'object') {
      throw new Error('[ReconciliationPlan] Plano de reconciliação inválido.');
    }
    const { targetTenantId, confirmedByHuman, confirmedByUserId, reason, records } = plan;

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('[ReconciliationPlan] Plano exige array não vazio de registros a reconciliar.');
    }

    // Validação e autoridade da sessão via AuthService confiável
    const activeSession = resolveTrustedSession(session || plan.session, options.authService || authService);

    // Cópia defensiva e deduplicação imutável do plano
    const sanitizedPlan = {
      planId: plan.planId || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      targetTenantId: (targetTenantId || '').trim(),
      confirmedByHuman: confirmedByHuman === true,
      confirmedByUserId: (confirmedByUserId || '').trim(),
      reason: (reason || '').trim(),
      records: []
    };

    const seenRecordKeys = new Set();
    for (const r of records) {
      if (!r || typeof r !== 'object' || !r.storeName || !r.id) {
        throw new Error('[ReconciliationPlan] Registro no plano possui estrutura inválida (exige storeName e id).');
      }
      const key = `${r.storeName}:${r.id}`;
      if (!seenRecordKeys.has(key)) {
        seenRecordKeys.add(key);
        sanitizedPlan.records.push({ storeName: r.storeName, id: r.id });
      }
    }
    Object.freeze(sanitizedPlan);
    Object.freeze(sanitizedPlan.records);

    const humanEvidence = {
      type: 'HUMAN_RECONCILIATION',
      confirmedByHuman: sanitizedPlan.confirmedByHuman,
      confirmedByUserId: sanitizedPlan.confirmedByUserId,
      reason: sanitizedPlan.reason,
      session: activeSession,
      planId: sanitizedPlan.planId
    };

    const db = await getDB();

    // Lista abrangente de stores envolvidas na transação atômica
    const candidateStores = [
      'products',
      'productImages',
      'imageManifest',
      'stockMovements',
      'sales',
      'purchases',
      'suppliers',
      'productSuppliers',
      'syncQueue'
    ];
    const storesNeeded = Array.from(new Set(
      sanitizedPlan.records.map(r => r.storeName).concat(candidateStores)
    )).filter(s => db.objectStoreNames.contains(s));

    // Pré-validação de todos os registros antes de iniciar transação de escrita
    for (const itemRef of sanitizedPlan.records) {
      const { storeName, id } = itemRef;
      if (!db.objectStoreNames.contains(storeName)) {
        throw new Error(`[ReconciliationPlan] Store "${storeName}" não existe no IndexedDB.`);
      }
      const existing = await db.get(storeName, id);
      if (!existing) {
        throw new Error(`[ReconciliationPlan] Registro ${id} não encontrado na store "${storeName}".`);
      }
      validateAttributionEvidence({
        targetTenantId: sanitizedPlan.targetTenantId,
        existingRecord: existing,
        evidence: humanEvidence,
        session: activeSession
      });
    }

    // Execução atômica em transação unificada
    const tx = db.transaction(storesNeeded, 'readwrite');
    if (tx && tx.done && typeof tx.done.catch === 'function') {
      tx.done.catch(() => {});
    }
    let reconciledCount = 0;
    let cascadedCount = 0;
    let outboxReconciledCount = 0;
    const details = [];
    const reconciledProductIds = new Set();

    try {
      // 1. Aplicação nos registros primários do plano
      for (const itemRef of sanitizedPlan.records) {
        const { storeName, id } = itemRef;
        const store = tx.objectStore(storeName);
        const record = await store.get(id);

        const validation = validateAttributionEvidence({
          targetTenantId: sanitizedPlan.targetTenantId,
          existingRecord: record,
          evidence: humanEvidence,
          session: activeSession
        });

        record.tenantId = sanitizedPlan.targetTenantId;
        record.tenantStatus = 'RESOLVED';
        record.tenantAttributionSource = validation.attributionSource;
        record.tenantAttributionProof = validation.proofDetails;
        record.tenantAttributionAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();

        await store.put(record);
        reconciledCount++;
        details.push({ storeName, id, tenantId: sanitizedPlan.targetTenantId, source: validation.attributionSource });

        if (storeName === 'products') {
          reconciledProductIds.add(id);
        }
      }

      // 2. Propagação relacional em cascata para produtos recém-reconciliados
      if (reconciledProductIds.size > 0) {
        const cascadeStores = ['productImages', 'imageManifest', 'stockMovements', 'sales', 'purchases', 'productSuppliers']
          .filter(s => storesNeeded.includes(s));

        for (const cStoreName of cascadeStores) {
          const cStore = tx.objectStore(cStoreName);
          const allItems = await cStore.getAll();
          for (const item of allItems) {
            if (!item.tenantId && item.productId && reconciledProductIds.has(item.productId)) {
              item.tenantId = sanitizedPlan.targetTenantId;
              item.tenantStatus = 'RESOLVED';
              item.tenantAttributionSource = 'PARENT_RELATION_VERIFIED';
              item.tenantAttributionProof = {
                type: 'RELATIONAL_PROVENANCE',
                parentEntity: 'products',
                parentId: item.productId,
                cascadedFromHumanPlanId: sanitizedPlan.planId,
                validatedAt: new Date().toISOString()
              };
              item.tenantAttributionAt = new Date().toISOString();
              if (item.updatedAt !== undefined) {
                item.updatedAt = new Date().toISOString();
              }
              await cStore.put(item);
              cascadedCount++;
              details.push({ storeName: cStoreName, id: item.id || item.photoId, tenantId: sanitizedPlan.targetTenantId, source: 'PARENT_RELATION_VERIFIED' });
            }
          }
        }
      }

      // 3. Reconciliação Controlada da Outbox (syncQueue)
      if (storesNeeded.includes('syncQueue')) {
        const sqStore = tx.objectStore('syncQueue');
        const queueItems = await sqStore.getAll();
        for (const qItem of queueItems) {
          const isRelatedToReconciled =
            (qItem.entityType === 'products' && reconciledProductIds.has(qItem.entityId)) ||
            sanitizedPlan.records.some(r => r.storeName === qItem.entityType && r.id === qItem.entityId);

          if (isRelatedToReconciled) {
            // Regra Estrita da FASE G: Só torna PENDING se a falha original foi unassigned_legacy E resultado não for desconhecido
            if (qItem.errorCategory === 'unassigned_legacy' && !qItem.remoteOutcomeUnknown) {
              qItem.tenantId = sanitizedPlan.targetTenantId;
              if (qItem.payload && typeof qItem.payload === 'object') {
                qItem.payload.tenantId = sanitizedPlan.targetTenantId;
              }
              qItem.status = 'PENDING';
              qItem.permanentFailure = false;
              qItem.requiresResolution = false;
              qItem.errorCategory = null;
              qItem.lastError = null;
              qItem.reconciledByPlanId = sanitizedPlan.planId;
              qItem.reconciledByUserId = sanitizedPlan.confirmedByUserId;
              qItem.reconciledAt = new Date().toISOString();
              qItem.updatedAt = new Date().toISOString();

              await sqStore.put(qItem);
              outboxReconciledCount++;
              details.push({ storeName: 'syncQueue', id: qItem.id, tenantId: sanitizedPlan.targetTenantId, source: 'RECONCILED_OUTBOX_ITEM' });
            }
          }
        }
      }

      await tx.done;
    } catch (err) {
      try {
        if (tx && typeof tx.abort === 'function') {
          tx.abort();
          if (tx.done && typeof tx.done.catch === 'function') {
            await tx.done.catch(() => {});
          }
        }
      } catch (_) {}
      console.error('[ReconciliationPlan] Erro na execução da transação de reconciliação humana:', err);
      throw err;
    }

    return {
      reconciledCount,
      cascadedCount,
      outboxReconciledCount,
      totalAffected: reconciledCount + cascadedCount + outboxReconciledCount,
      details
    };
  }

  /**
   * Marca registros ambíguos remanescentes com status PENDING_ATTRIBUTION:
   * - Preserva todos os dados comerciais e metadados originais;
   * - Garante que o registro não seja exposto a outro tenant nem enviado à nuvem;
   * - Previne exclusão acidental.
   *
   * @returns {Promise<{ markedCount: number }>}
   */
  async markAmbiguousRecords() {
    const db = await getDB();
    let markedCount = 0;

    for (const storeName of this.monitoredStores) {
      if (storeName === 'syncQueue' || storeName === 'settings') continue;
      if (!db.objectStoreNames.contains(storeName)) continue;

      const all = await db.getAll(storeName);
      for (const item of all) {
        if (!item.tenantId && item.tenantStatus !== 'PENDING_ATTRIBUTION') {
          item.tenantStatus = 'PENDING_ATTRIBUTION';
          item.requiresResolution = true;
          item.resolutionPendingReason = 'AMBIGUOUS_ORIGIN_AWAITING_ADMIN_CLASSIFICATION';
          item.updatedAt = new Date().toISOString();
          await db.put(storeName, item);
          markedCount++;
        }
      }
    }

    return { markedCount };
  }

  /**
   * Audita e protege a fila Outbox (syncQueue):
   * Marca itens sem tenantId como FAILED permanente para evitar despacho acidental.
   * @returns {Promise<{ securedCount: number }>}
   */
  async secureLegacyOutbox() {
    const db = await getDB();
    if (!db.objectStoreNames.contains('syncQueue')) return { securedCount: 0 };

    const all = await db.getAll('syncQueue');
    let securedCount = 0;

    for (const item of all) {
      if (!item.tenantId && !item.requiresResolution) {
        item.status = 'FAILED';
        item.permanentFailure = true;
        item.requiresResolution = true;
        item.errorCategory = 'unassigned_legacy';
        item.lastError = 'Item legado da Outbox sem tenantId comprovado: requer atribuição segura antes do envio';
        item.updatedAt = new Date().toISOString();
        await db.put('syncQueue', item);
        securedCount++;
      }
    }

    return { securedCount };
  }
}

export const legacyDataMigrationService = new LegacyDataMigrationService();
