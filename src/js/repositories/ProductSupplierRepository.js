import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';
import { QuotationValidator } from '../validators/QuotationValidator.js';

/**
 * Repositório para a store `productSuppliers`.
 * Cada registro é uma cotação (snapshot de preço e condições) de um fornecedor para um produto.
 */
export class ProductSupplierRepository extends BaseRepository {
  constructor() {
    super('productSuppliers');
  }

  /**
   * Retorna TODAS as cotações de um produto (ativas + inativas + vencidas),
   * ordenadas da mais recente para a mais antiga.
   * @param {string} productId
   * @returns {Promise<Object[]>}
   */
  async findByProductId(productId) {
    const db = await getDB();
    const all = await db.getAllFromIndex(this.storeName, 'productId', productId);
    all.sort((a, b) => new Date(b.quoteDate || b.createdAt) - new Date(a.quoteDate || a.createdAt));
    return all;
  }

  /**
   * Retorna apenas cotações ATIVAS e NÃO VENCIDAS de um produto,
   * ordenadas do menor para o maior preço.
   * @param {string} productId
   * @param {Date} [referenceDate]
   * @returns {Promise<Object[]>}
   */
  async findActiveByProductId(productId, referenceDate = new Date()) {
    const all = await this.findByProductId(productId);
    return all
      .filter(q => q.isActive !== false && !QuotationValidator.isExpired(q, referenceDate))
      .sort((a, b) => (a.unitCostCents || 0) - (b.unitCostCents || 0));
  }

  /**
   * Retorna o histórico COMPLETO de um produto: ativas, inativas e vencidas.
   * Inclui flag calculado `isExpired`.
   * @param {string} productId
   * @returns {Promise<Object[]>}
   */
  async findHistoryByProductId(productId) {
    const all = await this.findByProductId(productId);
    const now = new Date();
    return all.map(q => ({
      ...q,
      isExpiredNow: QuotationValidator.isExpired(q, now)
    }));
  }

  /**
   * Retorna a cotação ativa com o MENOR preço para um produto.
   * Cotações vencidas não são consideradas.
   * @param {string} productId
   * @returns {Promise<Object|null>}
   */
  async findBestPriceByProductId(productId) {
    const active = await this.findActiveByProductId(productId);
    if (active.length === 0) return null;
    return active[0]; // Já ordenado pelo menor preço
  }

  /**
   * Retorna a cotação ATIVA mais recente de um par produto+fornecedor específico.
   * @param {string} productId
   * @param {string} supplierId
   * @param {string} [excludeId] ID a excluir da busca
   * @returns {Promise<Object|null>}
   */
  async findActiveByProductAndSupplier(productId, supplierId, excludeId = null) {
    const all = await this.findByProductId(productId);
    const now = new Date();
    return all.find(q =>
      q.supplierId === supplierId &&
      q.isActive !== false &&
      !QuotationValidator.isExpired(q, now) &&
      q.id !== excludeId
    ) || null;
  }

  /**
   * Retorna todas as cotações ativas (independente de validade) de um par produto+fornecedor.
   * Utilizado para checar unicidade antes de criar nova cotação.
   * @param {string} productId
   * @param {string} supplierId
   * @param {string} [excludeId]
   * @returns {Promise<Object[]>}
   */
  async findAllActiveByProductAndSupplier(productId, supplierId, excludeId = null) {
    const all = await this.findByProductId(productId);
    return all.filter(q =>
      q.supplierId === supplierId &&
      q.isActive !== false &&
      q.id !== excludeId
    );
  }

  /**
   * Retorna todas as cotações de um fornecedor (histórico completo).
   * @param {string} supplierId
   * @returns {Promise<Object[]>}
   */
  async findBySupplierId(supplierId) {
    const db = await getDB();
    const all = await db.getAllFromIndex(this.storeName, 'supplierId', supplierId);
    all.sort((a, b) => new Date(b.quoteDate || b.createdAt) - new Date(a.quoteDate || a.createdAt));
    return all;
  }

  /**
   * Conta as cotações ativas (não vencidas) de um produto.
   * @param {string} productId
   * @returns {Promise<number>}
   */
  async countActiveByProductId(productId) {
    const active = await this.findActiveByProductId(productId);
    return active.length;
  }

  /**
   * Conta quantos fornecedores DISTINTOS têm cotação ativa para um produto.
   * @param {string} productId
   * @returns {Promise<number>}
   */
  async countActiveSuppliersByProductId(productId) {
    const active = await this.findActiveByProductId(productId);
    const uniqueSuppliers = new Set(active.map(q => q.supplierId));
    return uniqueSuppliers.size;
  }

  /**
   * Desativa (marca isActive: false) uma cotação pelo ID.
   * @param {string} id
   * @returns {Promise<Object>}
   */
  async deactivate(id) {
    const record = await this.findById(id);
    if (!record) throw new Error('Cotação não encontrada.');
    record.isActive = false;
    record.updatedAt = new Date().toISOString();
    await this.update(record);
    return record;
  }

  /**
   * Lista todas as cotações ativas de fornecedores distintos por produto.
   * Usada pela tela de cotações para listar produtos com cotações.
   * @returns {Promise<Object[]>}
   */
  async findAllActive() {
    const all = await this.findAll();
    const now = new Date();
    return all.filter(q => q.isActive !== false && !QuotationValidator.isExpired(q, now));
  }
}

export const productSupplierRepository = new ProductSupplierRepository();
