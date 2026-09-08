import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class SaleRepository extends BaseRepository {
  constructor() {
    super('sales');
  }

  /**
   * Busca vendas de um produto com ordenação temporal decrescente.
   * @param {string} productId 
   * @param {Object} options { limit, offset, sortOrder }
   */
  async findByProductId(productId, options = {}) {
    const db = await getDB();
    const sales = await db.getAllFromIndex(this.storeName, 'productId', productId);
    
    const sortOrder = options.sortOrder || 'desc';
    sales.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt).getTime();
      const dateB = new Date(b.date || b.createdAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    if (options.limit && typeof options.limit === 'number') {
      const offset = options.offset || 0;
      return sales.slice(offset, offset + options.limit);
    }

    return sales;
  }

  /**
   * Lista vendas com filtros avançados.
   * @param {Object} filters { productId, search, paymentMethod, startDate, endDate, includeCancelled, limit }
   */
  async list(filters = {}) {
    let sales = [];
    if (filters.productId) {
      sales = await this.findByProductId(filters.productId, { sortOrder: 'desc' });
    } else {
      sales = await this.findAll();
      sales.sort((a, b) => {
        const dateA = new Date(a.date || a.createdAt).getTime();
        const dateB = new Date(b.date || b.createdAt).getTime();
        return dateB - dateA;
      });
    }

    // Excluir soft deleted (se houver)
    sales = sales.filter(s => !s.deletedAt);

    // Filtrar canceladas por padrão a menos que solicitado
    if (filters.includeCancelled === false) {
      sales = sales.filter(s => !s.cancelledAt);
    } else if (filters.onlyCancelled === true) {
      sales = sales.filter(s => !!s.cancelledAt);
    }

    // Filtro por método de pagamento
    if (filters.paymentMethod) {
      sales = sales.filter(s => s.paymentMethod === filters.paymentMethod);
    }

    // Filtro por data inicial
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime();
      sales = sales.filter(s => new Date(s.date || s.createdAt).getTime() >= start);
    }

    // Filtro por data final
    if (filters.endDate) {
      const end = new Date(filters.endDate).getTime();
      sales = sales.filter(s => new Date(s.date || s.createdAt).getTime() <= end);
    }

    // Filtro por busca textual (cliente, notas, etc.)
    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      sales = sales.filter(s => 
        (s.customerName && s.customerName.toLowerCase().includes(q)) ||
        (s.notes && s.notes.toLowerCase().includes(q)) ||
        (s.productName && s.productName.toLowerCase().includes(q))
      );
    }

    if (filters.limit && typeof filters.limit === 'number') {
      sales = sales.slice(0, filters.limit);
    }

    return sales;
  }
}

export const saleRepository = new SaleRepository();
