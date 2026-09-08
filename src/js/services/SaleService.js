import { productRepository } from '../repositories/ProductRepository.js';
import { saleRepository } from '../repositories/SaleRepository.js';
import { stockMovementRepository } from '../repositories/StockMovementRepository.js';
import { executeTransaction } from '../db/transactions.js';
import { MarginService } from '../domain/MarginService.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { SaleValidator, PAYMENT_METHODS } from '../validators/SaleValidator.js';

export class SaleService {
  /**
   * Registra uma venda comercial de forma transacional e atômica.
   * Cria o registro da venda, deduz o estoque via StockMovement,
   * atualiza o saldo e o acumulador de totalSold no Produto,
   * e fixa imutavelmente o custo e o lucro no momento da venda.
   * @param {Object} saleData
   * @returns {Promise<Object>} Dados da venda criada
   */
  static async recordSale(saleData) {
    // 1. Validação de Domínio
    SaleValidator.assertValid(saleData);

    const saleId = crypto.randomUUID();
    const movementId = crypto.randomUUID();
    let result = null;

    await executeTransaction(['sales', 'stockMovements', 'products', 'settings'], 'readwrite', async (stores) => {
      // 1. Buscar produto na transação
      const product = await stores.products.get(saleData.productId);
      if (!product || product.deletedAt) {
        throw new Error('Produto não encontrado ou inativo.');
      }

      // 2. Verificar permissão de estoque negativo
      const settingRecord = await stores.settings.get('allowNegativeStock');
      const allowNegativeStock = settingRecord ? !!settingRecord.value : false;

      const previousStock = product.stockQuantity || 0;
      const quantity = saleData.quantity;
      const newStock = previousStock - quantity;

      if (!allowNegativeStock && newStock < 0) {
        throw new Error(
          `Estoque insuficiente para o produto "${product.name}". Saldo disponível: ${previousStock}, Quantidade da venda: ${quantity}.`
        );
      }

      // 3. Determinar preços e snapshot imutável de custo e lucro
      const unitSalePriceCents = saleData.unitSalePriceCents !== undefined && saleData.unitSalePriceCents !== null
        ? saleData.unitSalePriceCents
        : (product.salePriceCents || 0);

      const unitCostCents = saleData.unitCostCents !== undefined && saleData.unitCostCents !== null
        ? saleData.unitCostCents
        : (product.purchasePriceCents || 0);

      const totalSaleCents = quantity * unitSalePriceCents;
      const totalCostCents = quantity * unitCostCents;
      const profitCents = totalSaleCents - totalCostCents;
      const marginPercent = MarginService.calculateMargin(totalSaleCents, totalCostCents);
      const markupPercent = MarginService.calculateMarkup(totalSaleCents, totalCostCents);
      const saleDate = saleData.date || new Date().toISOString();

      // 4. Criar registro da Venda
      const saleRecord = {
        id: saleId,
        productId: product.id,
        productName: product.name,
        productCode: product.productCode || '',
        quantity,
        unitSalePriceCents,
        unitCostCents, // Snapshot imutável no momento da venda
        totalSaleCents,
        totalCostCents,
        profitCents,
        marginPercent,
        markupPercent,
        customerName: saleData.customerName ? saleData.customerName.trim() : '',
        paymentMethod: saleData.paymentMethod || PAYMENT_METHODS.DINHEIRO,
        notes: saleData.notes ? saleData.notes.trim() : '',
        stockMovementId: movementId,
        cancelledAt: null,
        cancelReason: null,
        date: saleDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await stores.sales.add(saleRecord);

      // 5. Criar registro de Movimentação de Estoque vinculada
      const movementRecord = {
        id: movementId,
        productId: product.id,
        type: 'SALE',
        quantity,
        delta: -quantity,
        unitCostCents,
        reason: `Venda #${saleId.slice(0, 8)}${saleData.customerName ? ' - Cliente: ' + saleData.customerName.trim() : ''}`,
        notes: saleData.notes ? saleData.notes.trim() : '',
        referenceId: saleId,
        referenceType: 'SALE',
        previousStock: previousStock,
        resultingStock: newStock,
        date: saleDate,
        createdAt: new Date().toISOString()
      };

      await stores.stockMovements.add(movementRecord);

      // 6. Atualizar Produto (saldo e acumulador de vendas)
      product.stockQuantity = newStock;
      product.totalSold = (product.totalSold || 0) + quantity;
      product.updatedAt = new Date().toISOString();
      await stores.products.put(product);

      result = {
        saleId,
        productId: product.id,
        productName: product.name,
        quantity,
        unitSalePriceCents,
        unitCostCents,
        totalSaleCents,
        profitCents,
        marginPercent,
        previousStock,
        newStock
      };
    });

    // 7. Notificar listeners via EventBus (BroadcastChannel)
    eventBus.emit(EVENTS.SALE_CREATED, result);
    eventBus.emit(EVENTS.STOCK_CHANGED, {
      productId: result.productId,
      newStock: result.newStock,
      delta: -result.quantity,
      type: 'SALE'
    });
    eventBus.emit(EVENTS.PRODUCT_UPDATED, {
      id: result.productId,
      action: 'sale'
    });

    return result;
  }

  /**
   * Realiza o estorno/cancelamento de uma venda de forma transacional.
   * Marca a venda como cancelada, cria movimento RETURN de reposição e atualiza o produto.
   * @param {string} saleId 
   * @param {string} reason 
   */
  static async cancelSale(saleId, reason = '') {
    let result = null;

    await executeTransaction(['sales', 'stockMovements', 'products'], 'readwrite', async (stores) => {
      const sale = await stores.sales.get(saleId);
      if (!sale) throw new Error('Venda não encontrada.');
      if (sale.cancelledAt) throw new Error('Esta venda já foi cancelada anteriormente.');

      const product = await stores.products.get(sale.productId);
      if (!product) throw new Error('Produto vinculado à venda não encontrado.');

      const currentStock = product.stockQuantity || 0;
      const newStock = currentStock + sale.quantity;
      const returnMovementId = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      // 1. Atualizar registro da venda
      sale.cancelledAt = nowIso;
      sale.cancelReason = reason ? reason.trim() : 'Cancelamento / Estorno de venda';
      sale.updatedAt = nowIso;
      await stores.sales.put(sale);

      // 2. Criar movimento de devolução / estorno no estoque
      const returnMovement = {
        id: returnMovementId,
        productId: product.id,
        type: 'RETURN',
        quantity: sale.quantity,
        delta: sale.quantity,
        unitCostCents: sale.unitCostCents,
        reason: `Estorno da Venda #${saleId.slice(0, 8)}${reason ? ' - Motivo: ' + reason.trim() : ''}`,
        notes: `Estorno referenciando venda ${saleId}`,
        referenceId: saleId,
        referenceType: 'SALE_CANCEL',
        previousStock: currentStock,
        resultingStock: newStock,
        date: nowIso,
        createdAt: nowIso
      };

      await stores.stockMovements.add(returnMovement);

      // 3. Atualizar Produto (restaura saldo e deduz do acumulador totalSold)
      product.stockQuantity = newStock;
      product.totalSold = Math.max(0, (product.totalSold || 0) - sale.quantity);
      product.updatedAt = nowIso;
      await stores.products.put(product);

      result = {
        saleId,
        productId: product.id,
        restoredQuantity: sale.quantity,
        newStock
      };
    });

    eventBus.emit(EVENTS.STOCK_CHANGED, {
      productId: result.productId,
      newStock: result.newStock,
      delta: result.restoredQuantity,
      type: 'RETURN'
    });
    eventBus.emit(EVENTS.PRODUCT_UPDATED, {
      id: result.productId,
      action: 'sale_cancel'
    });

    return result;
  }

  /**
   * Retorna consolidação de vendas com métricas financeiras e ranking de produtos.
   * @param {Object} filters 
   */
  static async getSalesOverview(filters = {}) {
    const allSales = await saleRepository.list(filters);
    const activeSales = allSales.filter(s => !s.cancelledAt);

    let totalRevenueCents = 0;
    let totalCostCents = 0;
    let totalProfitCents = 0;
    let totalUnitsSold = 0;

    const productRankingMap = new Map();

    for (const sale of activeSales) {
      totalRevenueCents += sale.totalSaleCents || 0;
      totalCostCents += sale.totalCostCents || 0;
      totalProfitCents += sale.profitCents || 0;
      totalUnitsSold += sale.quantity || 0;

      // Ranking por produto
      if (!productRankingMap.has(sale.productId)) {
        productRankingMap.set(sale.productId, {
          productId: sale.productId,
          productName: sale.productName || 'Produto',
          productCode: sale.productCode || '',
          unitsSold: 0,
          revenueCents: 0,
          profitCents: 0,
          salesCount: 0
        });
      }

      const item = productRankingMap.get(sale.productId);
      item.unitsSold += sale.quantity;
      item.revenueCents += sale.totalSaleCents;
      item.profitCents += sale.profitCents;
      item.salesCount += 1;
    }

    const totalSalesCount = activeSales.length;
    const averageTicketCents = totalSalesCount > 0 ? Math.round(totalRevenueCents / totalSalesCount) : 0;
    const averageMarginPercent = MarginService.calculateMargin(totalRevenueCents, totalCostCents);

    const topSellingProducts = Array.from(productRankingMap.values())
      .sort((a, b) => b.unitsSold - a.unitsSold);

    return {
      sales: allSales,
      metrics: {
        totalSalesCount,
        totalUnitsSold,
        totalRevenueCents,
        totalCostCents,
        totalProfitCents,
        averageTicketCents,
        averageMarginPercent,
        cancelledSalesCount: allSales.length - activeSales.length
      },
      topSellingProducts
    };
  }

  /**
   * Obtém histórico de vendas de um produto específico.
   * @param {string} productId 
   */
  static async getSalesByProduct(productId) {
    return await saleRepository.findByProductId(productId);
  }
}
