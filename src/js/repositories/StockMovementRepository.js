import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class StockMovementRepository extends BaseRepository {
  constructor() {
    super('stockMovements');
  }

  /**
   * Busca movimentações de um produto com ordenação cronológica decrescente.
   * @param {string} productId 
   * @param {Object} options { limit, offset, sortOrder }
   */
  async findByProductId(productId, options = {}) {
    const db = await getDB();
    const movements = await db.getAllFromIndex(this.storeName, 'productId', productId);
    
    const sortOrder = options.sortOrder || 'desc';
    movements.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt).getTime();
      const dateB = new Date(b.date || b.createdAt).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    if (options.limit && typeof options.limit === 'number') {
      const offset = options.offset || 0;
      return movements.slice(offset, offset + options.limit);
    }

    return movements;
  }

  /**
   * Lista movimentações com filtros avançados.
   * @param {Object} filters { productId, type, startDate, endDate, limit }
   */
  async listMovements(filters = {}) {
    let movements = [];
    if (filters.productId) {
      movements = await this.findByProductId(filters.productId, { sortOrder: 'desc' });
    } else {
      movements = await this.findAll();
      movements.sort((a, b) => {
        const dateA = new Date(a.date || a.createdAt).getTime();
        const dateB = new Date(b.date || b.createdAt).getTime();
        return dateB - dateA;
      });
    }

    // Filtro por tipo
    if (filters.type) {
      movements = movements.filter(m => m.type === filters.type);
    }

    // Filtro por data inicial
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime();
      movements = movements.filter(m => new Date(m.date || m.createdAt).getTime() >= start);
    }

    // Filtro por data final
    if (filters.endDate) {
      const end = new Date(filters.endDate).getTime();
      movements = movements.filter(m => new Date(m.date || m.createdAt).getTime() <= end);
    }

    if (filters.limit && typeof filters.limit === 'number') {
      movements = movements.slice(0, filters.limit);
    }

    return movements;
  }

  /**
   * Calcula o estoque lógico através do somatório de todas as movimentações.
   * IN, PURCHASE, RETURN somam.
   * OUT, SALE diminuem.
   * ADJUSTMENT soma o delta (positivo ou negativo).
   * @param {string} productId 
   * @param {IDBObjectStore} [transactionStore] Store aberta em transação ativa (opcional)
   */
  async sumByProduct(productId, transactionStore = null) {
    let movements = [];
    if (transactionStore) {
      const index = transactionStore.index('productId');
      movements = await index.getAll(productId);
    } else {
      const db = await getDB();
      movements = await db.getAllFromIndex(this.storeName, 'productId', productId);
    }

    let total = 0;
    for (const mov of movements) {
      if (['IN', 'PURCHASE', 'RETURN'].includes(mov.type)) {
        total += mov.quantity;
      } else if (['OUT', 'SALE'].includes(mov.type)) {
        total -= mov.quantity;
      } else if (mov.type === 'ADJUSTMENT') {
        // Delta do ajuste (pode ser positivo ou negativo)
        total += mov.quantity;
      }
    }
    return total;
  }
}

export const stockMovementRepository = new StockMovementRepository();
