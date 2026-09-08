import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'bun:test';
import { SaleService } from '../src/js/services/SaleService.js';
import { StockService, STOCK_STATUS } from '../src/js/services/StockService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { SaleValidator, PAYMENT_METHODS } from '../src/js/validators/SaleValidator.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('SaleValidator (Phase 5)', () => {
  it('deve validar venda com dados corretos', () => {
    const res = SaleValidator.validate({
      productId: 'prod-uuid-1',
      quantity: 3,
      unitSalePriceCents: 15000,
      unitCostCents: 9000,
      paymentMethod: PAYMENT_METHODS.PIX
    });
    expect(res.isValid).toBeTrue();
    expect(res.errors.length).toBe(0);
  });

  it('deve falhar se produto não for informado', () => {
    const res = SaleValidator.validate({
      quantity: 1
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Produto'))).toBeTrue();
  });

  it('deve falhar para quantidade zero, negativa ou não inteira', () => {
    const resZero = SaleValidator.validate({
      productId: 'p-1',
      quantity: 0
    });
    expect(resZero.isValid).toBeFalse();

    const resNeg = SaleValidator.validate({
      productId: 'p-1',
      quantity: -2
    });
    expect(resNeg.isValid).toBeFalse();

    const resFloat = SaleValidator.validate({
      productId: 'p-1',
      quantity: 1.5
    });
    expect(resFloat.isValid).toBeFalse();
  });

  it('deve falhar para método de pagamento desconhecido', () => {
    const res = SaleValidator.validate({
      productId: 'p-1',
      quantity: 1,
      paymentMethod: 'BITCOIN_INVALID'
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Forma de pagamento'))).toBeTrue();
  });
});

describe('SaleService & Operações Transacionais (Phase 5)', () => {
  it('deve registrar venda com atomicidade multi-store (sales + stockMovements + products)', async () => {
    const productId = await ProductService.createProduct({
      name: 'Headphone Bluetooth Bass',
      productCode: 'HP-BT-90',
      purchasePriceCents: 6000, // Custo R$ 60,00
      salePriceCents: 12000     // Venda R$ 120,00
    });

    // Abastecer estoque com 10 unidades
    await StockService.recordMovement({
      productId,
      type: 'IN',
      quantity: 10
    });

    // Realizar venda de 3 unidades
    const saleResult = await SaleService.recordSale({
      productId,
      quantity: 3,
      customerName: 'Maria Silva',
      paymentMethod: PAYMENT_METHODS.PIX,
      notes: 'Desconto de inauguração'
    });

    expect(saleResult.saleId).toBeDefined();
    expect(saleResult.totalSaleCents).toBe(36000); // 3 * 12000 = R$ 360,00
    expect(saleResult.profitCents).toBe(18000);    // (12000 - 6000) * 3 = R$ 180,00
    expect(saleResult.previousStock).toBe(10);
    expect(saleResult.newStock).toBe(7);

    // 1. Verificar store sales
    const savedSale = await saleRepository.findById(saleResult.saleId);
    expect(savedSale).not.toBeNull();
    expect(savedSale.productName).toBe('Headphone Bluetooth Bass');
    expect(savedSale.quantity).toBe(3);
    expect(savedSale.customerName).toBe('Maria Silva');
    expect(savedSale.paymentMethod).toBe('PIX');

    // 2. Verificar store stockMovements
    const movements = await stockMovementRepository.findByProductId(productId);
    const saleMovement = movements.find(m => m.type === 'SALE');
    expect(saleMovement).toBeDefined();
    expect(saleMovement.quantity).toBe(3);
    expect(saleMovement.delta).toBe(-3);
    expect(saleMovement.referenceId).toBe(saleResult.saleId);
    expect(saleMovement.resultingStock).toBe(7);

    // 3. Verificar store products (cache de estoque e totalSold)
    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(7);
    expect(product.totalSold).toBe(3);
  });

  it('deve preservar o custo histórico imutável (unitCostCents) mesmo se o preço de compra do produto mudar depois', async () => {
    const productId = await ProductService.createProduct({
      name: 'Smartwatch Sport Fit',
      purchasePriceCents: 10000, // R$ 100,00
      salePriceCents: 20000      // R$ 200,00
    });

    await StockService.recordMovement({ productId, type: 'IN', quantity: 5 });

    // Venda 1: Custo no momento da venda é R$ 100,00
    const sale1 = await SaleService.recordSale({
      productId,
      quantity: 1
    });
    expect(sale1.unitCostCents).toBe(10000);
    expect(sale1.profitCents).toBe(10000);

    // Posteriormente, o fornecedor aumenta o preço de compra do produto para R$ 150,00
    await ProductService.updateProduct(productId, {
      name: 'Smartwatch Sport Fit',
      purchasePriceCents: 15000, // Custo atualizado para R$ 150,00
      salePriceCents: 22000      // Novo preço de venda R$ 220,00
    });

    // Verificar se a venda anterior permaneceu com custo original de R$ 100,00
    const oldSale = await saleRepository.findById(sale1.saleId);
    expect(oldSale.unitCostCents).toBe(10000);
    expect(oldSale.profitCents).toBe(10000);

    // Venda 2: Custo no novo momento da venda é R$ 150,00
    const sale2 = await SaleService.recordSale({
      productId,
      quantity: 1
    });
    expect(sale2.unitCostCents).toBe(15000);
    expect(sale2.profitCents).toBe(7000); // 22000 - 15000 = R$ 70,00
  });

  it('deve bloquear venda se o estoque for insuficiente quando allowNegativeStock for false', async () => {
    await settingsRepository.set('allowNegativeStock', false);

    const productId = await ProductService.createProduct({
      name: 'Console Portátil Mini',
      purchasePriceCents: 25000,
      salePriceCents: 45000
    });

    // Estoque inicial = 2
    await StockService.recordMovement({ productId, type: 'IN', quantity: 2 });

    // Tentar vender 5 unidades
    let threwError = false;
    try {
      await SaleService.recordSale({
        productId,
        quantity: 5
      });
    } catch (e) {
      threwError = true;
      expect(e.message.toLowerCase()).toContain('estoque insuficiente');
    }

    expect(threwError).toBeTrue();

    // Confirmar que nenhuma venda foi persistida e o estoque permaneceu intacto
    const sales = await saleRepository.findByProductId(productId);
    expect(sales.length).toBe(0);

    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(2);
    expect(product.totalSold).toBeFalsy();
  });

  it('deve permitir estorno/cancelamento de venda com reposição automática de estoque', async () => {
    const productId = await ProductService.createProduct({
      name: 'Caixa de Som Portátil',
      purchasePriceCents: 4000,
      salePriceCents: 8000
    });

    await StockService.recordMovement({ productId, type: 'IN', quantity: 10 });

    const sale = await SaleService.recordSale({
      productId,
      quantity: 4,
      customerName: 'Carlos Teste'
    });

    // Saldo após venda = 6, totalSold = 4
    let pAfterSale = await productRepository.findById(productId);
    expect(pAfterSale.stockQuantity).toBe(6);
    expect(pAfterSale.totalSold).toBe(4);

    // Cancelar a venda
    const cancelRes = await SaleService.cancelSale(sale.saleId, 'Cliente desistiu da compra');
    expect(cancelRes.restoredQuantity).toBe(4);
    expect(cancelRes.newStock).toBe(10);

    // Verificar venda marcada como cancelada
    const cancelledSale = await saleRepository.findById(sale.saleId);
    expect(cancelledSale.cancelledAt).not.toBeNull();
    expect(cancelledSale.cancelReason).toContain('desistiu');

    // Verificar reposição no estoque via movimento RETURN
    const movements = await stockMovementRepository.findByProductId(productId);
    const returnMov = movements.find(m => m.type === 'RETURN' && m.referenceId === sale.saleId);
    expect(returnMov).toBeDefined();
    expect(returnMov.quantity).toBe(4);

    // Verificar produto restaurado
    const pAfterCancel = await productRepository.findById(productId);
    expect(pAfterCancel.stockQuantity).toBe(10);
    expect(pAfterCancel.totalSold).toBe(0);
  });

  it('deve consolidar métricas de vendas e ranking de mais vendidos no getSalesOverview', async () => {
    const p1 = await ProductService.createProduct({ name: 'Mouse Sem Fio Top', purchasePriceCents: 3000, salePriceCents: 6000 });
    const p2 = await ProductService.createProduct({ name: 'Teclado Gamer Pro', purchasePriceCents: 10000, salePriceCents: 20000 });

    await StockService.recordMovement({ productId: p1, type: 'IN', quantity: 50 });
    await StockService.recordMovement({ productId: p2, type: 'IN', quantity: 50 });

    await SaleService.recordSale({ productId: p1, quantity: 10 }); // 10 * 6000 = 60000
    await SaleService.recordSale({ productId: p2, quantity: 2 });  // 2 * 20000 = 40000

    const overview = await SaleService.getSalesOverview({});
    expect(overview.metrics.totalSalesCount).toBeGreaterThanOrEqual(2);
    expect(overview.metrics.totalUnitsSold).toBeGreaterThanOrEqual(12);
    expect(overview.metrics.totalRevenueCents).toBeGreaterThanOrEqual(100000);
    expect(overview.metrics.totalProfitCents).toBeGreaterThanOrEqual(50000);

    // Top selling products deve ter p1 em primeiro (10 unidades) e p2 em segundo (2 unidades)
    expect(overview.topSellingProducts.length).toBeGreaterThanOrEqual(2);
    const topItem = overview.topSellingProducts.find(item => item.productId === p1);
    expect(topItem.unitsSold).toBe(10);
  });

  it('deve emitir eventos de SALE_CREATED no EventBus', async () => {
    let capturedSale = null;
    const unsub = eventBus.on(EVENTS.SALE_CREATED, (data) => {
      capturedSale = data;
    });

    const pId = await ProductService.createProduct({ name: 'Produto Evento Venda', salePriceCents: 5000, purchasePriceCents: 2000 });
    await StockService.recordMovement({ productId: pId, type: 'IN', quantity: 10 });

    await SaleService.recordSale({
      productId: pId,
      quantity: 2
    });

    expect(capturedSale).not.toBeNull();
    expect(capturedSale.productId).toBe(pId);
    expect(capturedSale.quantity).toBe(2);

    unsub();
  });
});
