import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class PurchaseRepository extends BaseRepository {
  constructor() {
    super('purchases');
  }

  /**
   * Busca compras de um produto com ordenação temporal decrescente.
   * @param {string} productId 
   * @param {Object} options 
   */
  async findByProductId(productId, options = {}) {
    const db = await getDB();
    const purchases = await db.getAllFromIndex(this.storeName, 'productId', productId);
    
    const sortOrder = options.sortOrder || 'desc';
    purchases.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt).getTime();
      const dateB = new Date(b.date || b.createdAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    if (options.limit && typeof options.limit === 'number') {
      const offset = options.offset || 0;
      return purchases.slice(offset, offset + options.limit);
    }

    return purchases;
  }

  /**
   * Busca compras de um fornecedor específico.
   * @param {string} supplierId 
   * @param {Object} options 
   */
  async findBySupplierId(supplierId, options = {}) {
    const db = await getDB();
    const purchases = await db.getAllFromIndex(this.storeName, 'supplierId', supplierId);

    const sortOrder = options.sortOrder || 'desc';
    purchases.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt).getTime();
      const dateB = new Date(b.date || b.createdAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    if (options.limit && typeof options.limit === 'number') {
      const offset = options.offset || 0;
      return purchases.slice(offset, offset + options.limit);
    }

    return purchases;
  }

  /**
   * Lista compras com filtros avançados.
   * @param {Object} filters { productId, supplierId, search, startDate, endDate, includeCancelled, limit }
   */
  async list(filters = {}) {
    let purchases = [];
    if (filters.productId) {
      purchases = await this.findByProductId(filters.productId, { sortOrder: 'desc' });
    } else if (filters.supplierId) {
      purchases = await this.findBySupplierId(filters.supplierId, { sortOrder: 'desc' });
    } else {
      purchases = await this.findAll();
      purchases.sort((a, b) => {
        const dateA = new Date(a.date || a.createdAt).getTime();
        const dateB = new Date(b.date || b.createdAt).getTime();
        return dateB - dateA;
      });
    }

    // Excluir soft deleted (se houver)
    purchases = purchases.filter(p => !p.deletedAt);

    // Filtrar canceladas por padrão a menos que solicitado
    if (filters.includeCancelled === false) {
      purchases = purchases.filter(p => !p.cancelledAt);
    } else if (filters.onlyCancelled === true) {
      purchases = purchases.filter(p => !!p.cancelledAt);
    }

    // Filtro por data inicial
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime();
      purchases = purchases.filter(p => new Date(p.date || p.createdAt).getTime() >= start);
    }

    // Filtro por data final
    if (filters.endDate) {
      const end = new Date(filters.endDate).getTime();
      purchases = purchases.filter(p => new Date(p.date || p.createdAt).getTime() <= end);
    }

    // Filtro por busca textual (fornecedor, produto, nota fiscal, notas)
    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      purchases = purchases.filter(p => 
        (p.supplierName && p.supplierName.toLowerCase().includes(q)) ||
        (p.productName && p.productName.toLowerCase().includes(q)) ||
        (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q))
      );
    }

    if (filters.limit && typeof filters.limit === 'number') {
      purchases = purchases.slice(0, filters.limit);
    }

    return purchases;
  }
}

export const purchaseRepository = new PurchaseRepository();
