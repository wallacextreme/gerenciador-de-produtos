import { productRepository } from '../repositories/ProductRepository.js';
import { stockMovementRepository } from '../repositories/StockMovementRepository.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { executeTransaction } from '../db/transactions.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { StockValidator, MOVEMENT_TYPES } from '../validators/StockValidator.js';

export const STOCK_STATUS = {
  NORMAL: 'NORMAL',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  EXCESS_STOCK: 'EXCESS_STOCK'
};

export class StockService {
  /**
   * Registra uma movimentação de estoque de forma transacional e atômica.
   * Atualiza a store `stockMovements` e o cache `stockQuantity` do produto.
   * @param {Object} movementData
   * @returns {Promise<Object>} Resultado com ID do movimento e novos saldos
   */
  static async recordMovement(movementData) {
    // 1. Validação de Domínio
    StockValidator.assertValid(movementData);

    const product = await productRepository.findById(movementData.productId);
    if (!product || product.deletedAt) {
      throw new Error('Produto não encontrado ou inativo.');
    }

    const movementId = crypto.randomUUID();
    const quantity = movementData.quantity;
    const type = movementData.type;

    let delta = 0;
    if (['IN', 'PURCHASE', 'RETURN'].includes(type)) {
      delta = quantity;
    } else if (['OUT', 'SALE'].includes(type)) {
      delta = -quantity;
    } else if (type === 'ADJUSTMENT') {
      delta = quantity; // Em ajuste, quantity é o delta (positivo ou negativo)
    }

    let previousStock = 0;
    let newStock = 0;

    await executeTransaction(['stockMovements', 'products', 'settings'], 'readwrite', async (stores) => {
      // Obter configuração de estoque negativo
      const settingRecord = await stores.settings.get('allowNegativeStock');
      const allowNegativeStock = settingRecord ? !!settingRecord.value : false;

      // Buscar produto atualizado na transação
      const currentProduct = await stores.products.get(movementData.productId);
      if (!currentProduct || currentProduct.deletedAt) {
        throw new Error('Produto não encontrado durante a transação.');
      }

      previousStock = currentProduct.stockQuantity || 0;
      newStock = previousStock + delta;

      // Validar regra de estoque negativo
      if (!allowNegativeStock && newStock < 0) {
        throw new Error(
          `Estoque insuficiente para o produto "${currentProduct.name}". Saldo atual: ${previousStock}, Saída: ${Math.abs(delta)}, Saldo ficaria: ${newStock}.`
        );
      }

      const movementRecord = {
        id: movementId,
        productId: movementData.productId,
        type,
        quantity: type === 'ADJUSTMENT' ? Math.abs(quantity) : quantity,
        delta,
        unitCostCents: movementData.unitCostCents !== undefined && movementData.unitCostCents !== null
          ? movementData.unitCostCents
          : (currentProduct.purchasePriceCents || 0),
        reason: movementData.reason ? movementData.reason.trim() : '',
        notes: movementData.notes ? movementData.notes.trim() : '',
        referenceId: movementData.referenceId || '',
        referenceType: movementData.referenceType || '',
        previousStock,
        resultingStock: newStock,
        date: movementData.date || new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // 1. Gravar movimentação
      await stores.stockMovements.add(movementRecord);

      // 2. Atualizar cache do produto
      currentProduct.stockQuantity = newStock;
      currentProduct.updatedAt = new Date().toISOString();
      await stores.products.put(currentProduct);
    });

    // Disparar eventos
    eventBus.emit(EVENTS.STOCK_CHANGED, {
      productId: movementData.productId,
      movementId,
      type,
      delta,
      previousStock,
      newStock
    });

    eventBus.emit(EVENTS.PRODUCT_UPDATED, {
      id: movementData.productId,
      action: 'stock_change'
    });

    return {
      movementId,
      productId: movementData.productId,
      previousStock,
      newStock,
      delta
    };
  }

  /**
   * Realiza um balanço/ajuste físico direto para uma quantidade alvo.
   * @param {Object} param0 
   */
  static async adjustStock({ productId, targetQuantity, reason, notes, date }) {
    if (typeof targetQuantity !== 'number' || !Number.isInteger(targetQuantity)) {
      throw new Error('A quantidade alvo de ajuste deve ser um número inteiro.');
    }

    const product = await productRepository.findById(productId);
    if (!product || product.deletedAt) {
      throw new Error('Produto não encontrado.');
    }

    const currentStock = product.stockQuantity || 0;
    const delta = targetQuantity - currentStock;

    if (delta === 0) {
      return {
        movementId: null,
        productId,
        previousStock: currentStock,
        newStock: currentStock,
        delta: 0,
        message: 'Estoque já se encontra na quantidade especificada.'
      };
    }

    return await this.recordMovement({
      productId,
      type: MOVEMENT_TYPES.ADJUSTMENT,
      quantity: delta,
      reason: reason || 'Ajuste de inventário / Balanço físico',
      notes: notes || '',
      date
    });
  }

  /**
   * Obtém histórico detalhado de movimentações de um produto.
   * @param {string} productId 
   * @param {Object} filters 
   */
  static async getProductStockHistory(productId, filters = {}) {
    return await stockMovementRepository.findByProductId(productId, filters);
  }

  /**
   * Determina o status de estoque de um produto.
   * @param {number} currentStock 
   * @param {number} minimumStock 
   * @param {number} maximumStock 
   */
  static computeStockStatus(currentStock, minimumStock = 0, maximumStock = 0) {
    if (currentStock <= 0) {
      return STOCK_STATUS.OUT_OF_STOCK;
    }
    if (minimumStock > 0 && currentStock <= minimumStock) {
      return STOCK_STATUS.LOW_STOCK;
    }
    if (maximumStock > 0 && currentStock > maximumStock) {
      return STOCK_STATUS.EXCESS_STOCK;
    }
    return STOCK_STATUS.NORMAL;
  }

  /**
   * Obtém visão geral consolidada de estoque com métricas e filtros.
   * @param {Object} filters { search, status, category, brand }
   */
  static async getStockOverview(filters = {}) {
    const allProducts = await productRepository.list({});
    
    let totalUnits = 0;
    let totalCostCents = 0;
    let totalSaleCents = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let normalStockCount = 0;
    let excessStockCount = 0;

    const enrichedProducts = allProducts.map(p => {
      const stock = p.stockQuantity ?? 0;
      const min = p.minimumStock ?? 0;
      const max = p.maximumStock ?? 0;
      const purchasePrice = p.purchasePriceCents ?? 0;
      const salePrice = p.salePriceCents ?? 0;
      
      const status = this.computeStockStatus(stock, min, max);

      if (stock > 0) {
        totalUnits += stock;
        totalCostCents += stock * purchasePrice;
        totalSaleCents += stock * salePrice;
      }

      if (status === STOCK_STATUS.OUT_OF_STOCK) outOfStockCount++;
      else if (status === STOCK_STATUS.LOW_STOCK) lowStockCount++;
      else if (status === STOCK_STATUS.EXCESS_STOCK) excessStockCount++;
      else normalStockCount++;

      let capacityPercent = null;
      if (max > 0) {
        capacityPercent = Math.min(100, Math.max(0, Math.round((stock / max) * 100)));
      }

      return {
        ...p,
        stockQuantity: stock,
        stockStatus: status,
        totalCostCents: stock > 0 ? stock * purchasePrice : 0,
        totalSaleCents: stock > 0 ? stock * salePrice : 0,
        capacityPercent
      };
    });

    // Aplicação dos filtros
    let filtered = enrichedProducts;

    if (filters.status) {
      filtered = filtered.filter(p => p.stockStatus === filters.status);
    }

    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      filtered = filtered.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.productCode && p.productCode.toLowerCase().includes(q)) ||
        (p.internalCode && p.internalCode.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q))
      );
    }

    if (filters.category) {
      filtered = filtered.filter(p => p.category === filters.category);
    }

    if (filters.brand) {
      filtered = filtered.filter(p => p.brand === filters.brand);
    }

    return {
      products: filtered,
      metrics: {
        totalProducts: allProducts.length,
        totalUnits,
        totalCostCents,
        totalSaleCents,
        lowStockCount,
        outOfStockCount,
        normalStockCount,
        excessStockCount
      }
    };
  }

  /**
   * Auditoria de integridade: recalcula o stockQuantity de todos os produtos
   * a partir do somatório de stockMovements e sincroniza.
   */
  static async recalculateAllStock() {
    const products = await productRepository.findAll();
    const adjustments = [];

    await executeTransaction(['stockMovements', 'products'], 'readwrite', async (stores) => {
      for (const p of products) {
        if (p.deletedAt) continue;

        const movements = await stores.stockMovements.index('productId').getAll(p.id);
        let realStock = 0;

        for (const mov of movements) {
          if (['IN', 'PURCHASE', 'RETURN'].includes(mov.type)) {
            realStock += mov.quantity;
          } else if (['OUT', 'SALE'].includes(mov.type)) {
            realStock -= mov.quantity;
          } else if (mov.type === 'ADJUSTMENT') {
            realStock += mov.delta !== undefined ? mov.delta : mov.quantity;
          }
        }

        if (p.stockQuantity !== realStock) {
          adjustments.push({
            productId: p.id,
            productName: p.name,
            oldStock: p.stockQuantity || 0,
            realStock
          });
          p.stockQuantity = realStock;
          p.updatedAt = new Date().toISOString();
          await stores.products.put(p);
        }
      }
    });

    if (adjustments.length > 0) {
      eventBus.emit(EVENTS.STOCK_CHANGED, { audit: true, adjustmentsCount: adjustments.length });
    }

    return {
      syncedCount: adjustments.length,
      adjustments
    };
  }
}
