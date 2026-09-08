import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { stockMovementRepository } from '../repositories/StockMovementRepository.js';
import { executeTransaction } from '../db/transactions.js';
import { PurchaseValidator } from '../validators/PurchaseValidator.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class PurchaseService {
  /**
   * Registra uma nova ordem de compra com entrada atômica no estoque.
   * Cria o registro em purchases, cria o movimento PURCHASE em stockMovements,
   * atualiza o saldo de Product.stockQuantity e opcionalmente atualiza o purchasePriceCents do catálogo.
   * @param {Object} purchaseData 
   * @returns {Promise<Object>} Dados da compra registrada
   */
  static async recordPurchase(purchaseData) {
    PurchaseValidator.assertValid(purchaseData);

    const purchaseId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    let result = null;

    await executeTransaction(['purchases', 'stockMovements', 'products', 'suppliers'], 'readwrite', async (stores) => {
      // 1. Buscar produto
      const product = await stores.products.get(purchaseData.productId);
      if (!product || product.deletedAt) {
        throw new Error('Produto não encontrado ou inativo.');
      }

      // 2. Buscar fornecedor
      const supplier = await stores.suppliers.get(purchaseData.supplierId);
      if (!supplier || supplier.deletedAt) {
        throw new Error('Fornecedor não encontrado ou inativo.');
      }

      const quantity = purchaseData.quantity;
      const unitCostCents = purchaseData.unitCostCents !== undefined && purchaseData.unitCostCents !== null
        ? purchaseData.unitCostCents
        : (product.purchasePriceCents || 0);

      const totalCostCents = quantity * unitCostCents;
      const previousStock = product.stockQuantity || 0;
      const newStock = previousStock + quantity;
      const purchaseDate = purchaseData.date || new Date().toISOString();
      const nowIso = new Date().toISOString();

      // 3. Criar registro em purchases
      const purchaseRecord = {
        id: purchaseId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        productId: product.id,
        productName: product.name,
        productCode: product.productCode || '',
        quantity,
        unitCostCents,
        totalCostCents,
        invoiceNumber: purchaseData.invoiceNumber ? purchaseData.invoiceNumber.trim() : '',
        paymentMethod: purchaseData.paymentMethod || 'OUTRO',
        notes: purchaseData.notes ? purchaseData.notes.trim() : '',
        stockMovementId: movementId,
        cancelledAt: null,
        cancelReason: null,
        date: purchaseDate,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      await stores.purchases.add(purchaseRecord);

      // 4. Criar movimento de entrada de compra no estoque
      const movementRecord = {
        id: movementId,
        productId: product.id,
        type: 'PURCHASE',
        quantity,
        delta: quantity,
        unitCostCents,
        reason: `Compra #${purchaseId.slice(0, 8)} - Fornecedor: ${supplier.name}${purchaseData.invoiceNumber ? ' - NF: ' + purchaseData.invoiceNumber.trim() : ''}`,
        notes: purchaseData.notes ? purchaseData.notes.trim() : '',
        referenceId: purchaseId,
        referenceType: 'PURCHASE',
        previousStock,
        resultingStock: newStock,
        date: purchaseDate,
        createdAt: nowIso
      };

      await stores.stockMovements.add(movementRecord);

      // 5. Atualizar Produto (saldo de estoque e opcionalmente preço de compra de referência)
      product.stockQuantity = newStock;
      if (purchaseData.updateProductPurchasePrice === true) {
        product.purchasePriceCents = unitCostCents;
      }
      product.updatedAt = nowIso;
      await stores.products.put(product);

      result = {
        purchaseId,
        productId: product.id,
        productName: product.name,
        supplierId: supplier.id,
        supplierName: supplier.name,
        quantity,
        unitCostCents,
        totalCostCents,
        previousStock,
        newStock
      };
    });

    eventBus.emit('PURCHASE_CREATED', result);
    eventBus.emit(EVENTS.STOCK_CHANGED, {
      productId: result.productId,
      newStock: result.newStock,
      delta: result.quantity,
      type: 'PURCHASE'
    });
    eventBus.emit(EVENTS.PRODUCT_UPDATED, {
      id: result.productId,
      action: 'purchase'
    });

    return result;
  }

  /**
   * Cancela/Estorna uma ordem de compra de forma transacional.
   * Deduz os itens do estoque e valida se saldo não fica negativo.
   * @param {string} purchaseId 
   * @param {string} reason 
   */
  static async cancelPurchase(purchaseId, reason = '') {
    let result = null;

    await executeTransaction(['purchases', 'stockMovements', 'products', 'settings'], 'readwrite', async (stores) => {
      const purchase = await stores.purchases.get(purchaseId);
      if (!purchase) throw new Error('Ordem de compra não encontrada.');
      if (purchase.cancelledAt) throw new Error('Esta compra já foi cancelada anteriormente.');

      const product = await stores.products.get(purchase.productId);
      if (!product) throw new Error('Produto vinculado à compra não encontrado.');

      const settingRecord = await stores.settings.get('allowNegativeStock');
      const allowNegativeStock = settingRecord ? !!settingRecord.value : false;

      const previousStock = product.stockQuantity || 0;
      const newStock = previousStock - purchase.quantity;

      if (!allowNegativeStock && newStock < 0) {
        throw new Error(
          `Não é possível estornar a compra. O estoque atual (${previousStock}) ficaria negativo (${newStock}).`
        );
      }

      const returnMovementId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // 1. Atualizar compra
      purchase.cancelledAt = nowIso;
      purchase.cancelReason = reason ? reason.trim() : 'Estorno / Cancelamento de compra';
      purchase.updatedAt = nowIso;
      await stores.purchases.put(purchase);

      // 2. Criar movimento de saída por estorno no estoque
      const returnMovement = {
        id: returnMovementId,
        productId: product.id,
        type: 'OUT',
        quantity: purchase.quantity,
        delta: -purchase.quantity,
        unitCostCents: purchase.unitCostCents,
        reason: `Estorno da Compra #${purchaseId.slice(0, 8)}${reason ? ' - Motivo: ' + reason.trim() : ''}`,
        notes: `Estorno referenciando compra ${purchaseId}`,
        referenceId: purchaseId,
        referenceType: 'PURCHASE_CANCEL',
        previousStock,
        resultingStock: newStock,
        date: nowIso,
        createdAt: nowIso
      };

      await stores.stockMovements.add(returnMovement);

      // 3. Atualizar produto
      product.stockQuantity = newStock;
      product.updatedAt = nowIso;
      await stores.products.put(product);

      result = {
        purchaseId,
        productId: product.id,
        deductedQuantity: purchase.quantity,
        newStock
      };
    });

    eventBus.emit('PURCHASE_CANCELLED', result);
    eventBus.emit(EVENTS.STOCK_CHANGED, {
      productId: result.productId,
      newStock: result.newStock,
      delta: -result.deductedQuantity,
      type: 'OUT'
    });
    eventBus.emit(EVENTS.PRODUCT_UPDATED, {
      id: result.productId,
      action: 'purchase_cancel'
    });

    return result;
  }

  /**
   * Consolidação geral de compras e estatísticas financeiras.
   * @param {Object} filters 
   */
  static async getPurchasesOverview(filters = {}) {
    const allPurchases = await purchaseRepository.list(filters);
    const activePurchases = allPurchases.filter(p => !p.cancelledAt);

    let totalSpentCents = 0;
    let totalItemsPurchased = 0;

    for (const p of activePurchases) {
      totalSpentCents += p.totalCostCents || 0;
      totalItemsPurchased += p.quantity || 0;
    }

    const totalPurchasesCount = activePurchases.length;
    const averagePurchaseCents = totalPurchasesCount > 0 ? Math.round(totalSpentCents / totalPurchasesCount) : 0;

    return {
      purchases: allPurchases,
      metrics: {
        totalPurchasesCount,
        totalItemsPurchased,
        totalSpentCents,
        averagePurchaseCents,
        cancelledPurchasesCount: allPurchases.length - activePurchases.length
      }
    };
  }

  /**
   * Obtém compras de um produto específico.
   * @param {string} productId 
   */
  static async getPurchasesByProduct(productId) {
    return await purchaseRepository.findByProductId(productId);
  }

  /**
   * Obtém compras de um fornecedor específico.
   * @param {string} supplierId 
   */
  static async getPurchasesBySupplier(supplierId) {
    return await purchaseRepository.findBySupplierId(supplierId);
  }
}
