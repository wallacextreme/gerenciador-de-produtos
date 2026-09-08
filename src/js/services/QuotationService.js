import { productSupplierRepository } from '../repositories/ProductSupplierRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { QuotationValidator } from '../validators/QuotationValidator.js';
import { eventBus } from '../eventBus.js';

const MAX_ACTIVE_SUPPLIERS_PER_PRODUCT = 3;

/**
 * Serviço de Cotações de Fornecedores por Produto.
 * Gerencia o ciclo de vida de cotações: criação, atualização (com preservação de histórico),
 * fornecedor preferido, comparação de preços e integração com compras.
 */
export class QuotationService {

  // ─────────────────────────────────────────────
  // CRIAÇÃO
  // ─────────────────────────────────────────────

  /**
   * Adiciona uma nova cotação para um produto.
   * Regras:
   *   - Máximo de 3 fornecedores/cotações ATIVAS por produto (RQ-001)
   *   - O mesmo fornecedor não pode ter duas cotações ativas para o mesmo produto (RQ-002)
   *   - Histórico nunca é destruído
   * @param {Object} data
   * @returns {Promise<Object>} Cotação criada
   */
  static async addQuotation(data) {
    QuotationValidator.assertValid(data);

    // Verificar existência do produto
    const product = await productRepository.findById(data.productId);
    if (!product || product.deletedAt) {
      throw new Error('Produto não encontrado ou inativo.');
    }

    // Verificar existência do fornecedor
    const supplier = await supplierRepository.findById(data.supplierId);
    if (!supplier || supplier.deletedAt) {
      throw new Error('Fornecedor não encontrado ou inativo.');
    }

    // RQ-001 — Máximo de 3 fornecedores distintos ativos por produto
    const activeSupplierCount = await productSupplierRepository.countActiveSuppliersByProductId(data.productId);
    const existingActive = await productSupplierRepository.findAllActiveByProductAndSupplier(data.productId, data.supplierId);

    if (existingActive.length === 0 && activeSupplierCount >= MAX_ACTIVE_SUPPLIERS_PER_PRODUCT) {
      throw new Error(
        `Produto já possui ${MAX_ACTIVE_SUPPLIERS_PER_PRODUCT} fornecedores com cotações ativas. ` +
        `Desative uma cotação existente antes de adicionar um novo fornecedor.`
      );
    }

    // RQ-002 — Unicidade: mesmo fornecedor só pode ter 1 cotação ativa por produto
    if (existingActive.length > 0) {
      throw new Error(
        `Fornecedor "${supplier.name}" já possui uma cotação ativa para este produto. ` +
        `Para atualizar o preço, use "Atualizar Cotação".`
      );
    }

    const quotationId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const record = {
      id: quotationId,
      productId: product.id,
      productName: product.name,
      productCode: product.productCode || '',
      supplierId: supplier.id,
      supplierName: supplier.name,
      unitCostCents: data.unitCostCents,
      minimumOrderQty: data.minimumOrderQty != null ? Number(data.minimumOrderQty) : null,
      leadTimeDays: data.leadTimeDays != null ? Number(data.leadTimeDays) : null,
      paymentTerms: data.paymentTerms ? data.paymentTerms.trim() : '',
      quoteDate: data.quoteDate || nowIso,
      validUntil: data.validUntil || null,
      isPreferred: data.isPreferred === true,
      isActive: true,
      notes: data.notes ? data.notes.trim() : '',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await productSupplierRepository.create(record);

    eventBus.emit('QUOTATION_CREATED', { id: quotationId, productId: product.id, supplierId: supplier.id });

    return record;
  }

  // ─────────────────────────────────────────────
  // ATUALIZAÇÃO (Preserva Histórico)
  // ─────────────────────────────────────────────

  /**
   * Atualiza uma cotação existente:
   *   - Desativa a cotação anterior (histórico preservado)
   *   - Cria uma nova entrada com os dados atualizados
   *   - Transfere o flag isPreferred para a nova cotação se estava marcado
   * @param {string} oldId ID da cotação a ser superada
   * @param {Object} data Novos dados da cotação
   * @returns {Promise<Object>} Nova cotação criada
   */
  static async updateQuotation(oldId, data) {
    const old = await productSupplierRepository.findById(oldId);
    if (!old) throw new Error('Cotação não encontrada.');

    // Validar novos dados (reutilizando produto e fornecedor do registro anterior)
    const mergedData = {
      productId: data.productId || old.productId,
      supplierId: data.supplierId || old.supplierId,
      unitCostCents: data.unitCostCents !== undefined ? data.unitCostCents : old.unitCostCents,
      minimumOrderQty: data.minimumOrderQty !== undefined ? data.minimumOrderQty : old.minimumOrderQty,
      leadTimeDays: data.leadTimeDays !== undefined ? data.leadTimeDays : old.leadTimeDays,
      paymentTerms: data.paymentTerms !== undefined ? data.paymentTerms : old.paymentTerms,
      quoteDate: data.quoteDate || new Date().toISOString(),
      validUntil: data.validUntil !== undefined ? data.validUntil : old.validUntil,
      notes: data.notes !== undefined ? data.notes : old.notes
    };

    QuotationValidator.assertValid(mergedData);

    // Desativar a cotação anterior (histórico preservado, não deletado)
    await productSupplierRepository.deactivate(oldId);

    const newId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const newRecord = {
      id: newId,
      productId: old.productId,
      productName: old.productName,
      productCode: old.productCode || '',
      supplierId: old.supplierId,
      supplierName: old.supplierName,
      unitCostCents: mergedData.unitCostCents,
      minimumOrderQty: mergedData.minimumOrderQty != null ? Number(mergedData.minimumOrderQty) : null,
      leadTimeDays: mergedData.leadTimeDays != null ? Number(mergedData.leadTimeDays) : null,
      paymentTerms: mergedData.paymentTerms ? String(mergedData.paymentTerms).trim() : '',
      quoteDate: mergedData.quoteDate,
      validUntil: mergedData.validUntil || null,
      isPreferred: old.isPreferred === true, // Transfere preferência se estava marcada
      isActive: true,
      notes: mergedData.notes ? String(mergedData.notes).trim() : '',
      previousQuotationId: oldId, // Rastreabilidade ao histórico
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await productSupplierRepository.create(newRecord);

    eventBus.emit('QUOTATION_UPDATED', {
      id: newId,
      previousId: oldId,
      productId: old.productId,
      supplierId: old.supplierId
    });

    return newRecord;
  }

  // ─────────────────────────────────────────────
  // DESATIVAÇÃO
  // ─────────────────────────────────────────────

  /**
   * Desativa uma cotação (isActive: false). Histórico preservado.
   * @param {string} id
   * @returns {Promise<Object>}
   */
  static async deactivateQuotation(id) {
    const result = await productSupplierRepository.deactivate(id);
    eventBus.emit('QUOTATION_DELETED', { id, productId: result.productId, supplierId: result.supplierId });
    return result;
  }

  // ─────────────────────────────────────────────
  // FORNECEDOR PREFERIDO
  // ─────────────────────────────────────────────

  /**
   * Define um fornecedor como preferido para um produto.
   * Desmarca todos os outros fornecedores como não-preferidos (RQ-004).
   * A preferência é INDEPENDENTE do menor preço.
   * @param {string} productId
   * @param {string} quotationId ID da cotação a ser marcada como preferida
   * @returns {Promise<void>}
   */
  static async setPreferredSupplier(productId, quotationId) {
    const allForProduct = await productSupplierRepository.findByProductId(productId);

    for (const q of allForProduct) {
      const shouldBePreferred = q.id === quotationId;
      if (q.isPreferred !== shouldBePreferred) {
        q.isPreferred = shouldBePreferred;
        q.updatedAt = new Date().toISOString();
        await productSupplierRepository.update(q);
      }
    }

    eventBus.emit('PREFERRED_SUPPLIER_CHANGED', { productId, quotationId });
  }

  // ─────────────────────────────────────────────
  // CONSULTAS
  // ─────────────────────────────────────────────

  /**
   * Retorna as cotações ATIVAS de um produto com flags calculados:
   *   - isCheapest: true para a cotação com menor unitCostCents entre as ativas
   *   - isExpiredNow: sempre false (ativas não vencidas, por definição)
   * @param {string} productId
   * @returns {Promise<Object[]>}
   */
  static async getQuotationsForProduct(productId) {
    const active = await productSupplierRepository.findActiveByProductId(productId);

    if (active.length === 0) return [];

    const minPrice = Math.min(...active.map(q => q.unitCostCents));

    return active.map(q => ({
      ...q,
      isCheapest: q.unitCostCents === minPrice,
      isExpiredNow: false // Ativas por definição já foram filtradas como não vencidas
    }));
  }

  /**
   * Retorna o histórico COMPLETO de cotações de um produto
   * (ativas + inativas + vencidas), com flags calculados.
   * @param {string} productId
   * @returns {Promise<Object[]>}
   */
  static async getQuotationHistory(productId) {
    return await productSupplierRepository.findHistoryByProductId(productId);
  }

  /**
   * Retorna todas as cotações de um fornecedor específico.
   * @param {string} supplierId
   * @returns {Promise<Object[]>}
   */
  static async getSupplierQuotations(supplierId) {
    const all = await productSupplierRepository.findBySupplierId(supplierId);
    const now = new Date();
    return all.map(q => ({
      ...q,
      isExpiredNow: QuotationValidator.isExpired(q, now)
    }));
  }

  /**
   * Prepara os dados de uma cotação para pré-preencher o modal de Nova Compra.
   * Retorna os campos necessários para o PurchasesPage.
   * @param {string} quotationId
   * @returns {Promise<Object|null>}
   */
  static async prepareForPurchase(quotationId) {
    const quotation = await productSupplierRepository.findById(quotationId);
    if (!quotation) return null;

    return {
      quotationId: quotation.id,
      productId: quotation.productId,
      productName: quotation.productName,
      supplierId: quotation.supplierId,
      supplierName: quotation.supplierName,
      unitCostCents: quotation.unitCostCents,
      minimumOrderQty: quotation.minimumOrderQty,
      leadTimeDays: quotation.leadTimeDays,
      paymentTerms: quotation.paymentTerms,
      notes: quotation.notes
    };
  }

  /**
   * Retorna as cotações ativas de um produto para exibir no modal de compra.
   * Inclui flags isCheapest e isPreferred para destaque na UI.
   * @param {string} productId
   * @returns {Promise<Object[]>}
   */
  static async getQuotationsForPurchaseModal(productId) {
    return await this.getQuotationsForProduct(productId);
  }
}
