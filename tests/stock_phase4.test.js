import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'bun:test';
import { StockService, STOCK_STATUS } from '../src/js/services/StockService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { StockValidator, MOVEMENT_TYPES } from '../src/js/validators/StockValidator.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('StockValidator (Phase 4)', () => {
  it('deve validar movimentação de entrada válida', () => {
    const res = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.IN,
      quantity: 10,
      unitCostCents: 5000
    });
    expect(res.isValid).toBeTrue();
    expect(res.errors.length).toBe(0);
  });

  it('deve falhar se produto não for informado', () => {
    const res = StockValidator.validate({
      type: MOVEMENT_TYPES.IN,
      quantity: 5
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Produto'))).toBeTrue();
  });

  it('deve falhar para tipo de movimentação inválido', () => {
    const res = StockValidator.validate({
      productId: 'prod-123',
      type: 'INVALID_TYPE',
      quantity: 5
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Tipo'))).toBeTrue();
  });

  it('deve falhar se quantidade for zero, negativa ou não inteira para entradas/saídas', () => {
    const resZero = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.IN,
      quantity: 0
    });
    expect(resZero.isValid).toBeFalse();

    const resNeg = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.OUT,
      quantity: -5,
      reason: 'Avaria'
    });
    expect(resNeg.isValid).toBeFalse();

    const resFloat = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.IN,
      quantity: 2.5
    });
    expect(resFloat.isValid).toBeFalse();
  });

  it('deve exigir motivo/justificativa para saídas manuais e ajustes', () => {
    const resOutNoReason = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.OUT,
      quantity: 2
    });
    expect(resOutNoReason.isValid).toBeFalse();
    expect(resOutNoReason.errors.some(e => e.includes('Motivo'))).toBeTrue();

    const resOutWithReason = StockValidator.validate({
      productId: 'prod-123',
      type: MOVEMENT_TYPES.OUT,
      quantity: 2,
      reason: 'Produto com avaria na embalagem'
    });
    expect(resOutWithReason.isValid).toBeTrue();
  });
});

describe('StockService & Movimentações (Phase 4)', () => {
  it('deve registrar entrada de estoque (IN) e atualizar saldo e produto de forma atômica', async () => {
    const productId = await ProductService.createProduct({
      name: 'Teclado Mecânico RGB',
      purchasePriceCents: 15000,
      salePriceCents: 25000,
      minimumStock: 5,
      maximumStock: 50
    });

    const result = await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.IN,
      quantity: 20,
      reason: 'Entrada inicial de lote',
      unitCostCents: 15000
    });

    expect(result.previousStock).toBe(0);
    expect(result.newStock).toBe(20);
    expect(result.delta).toBe(20);

    // Conferir no ProductRepository
    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(20);

    // Conferir na tabela de movimentações
    const movements = await stockMovementRepository.findByProductId(productId);
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe('IN');
    expect(movements[0].quantity).toBe(20);
    expect(movements[0].resultingStock).toBe(20);
  });

  it('deve registrar saída de estoque (OUT) reduzindo saldo', async () => {
    const productId = await ProductService.createProduct({
      name: 'Mousepad Extra Grande',
      purchasePriceCents: 3000,
      salePriceCents: 6000
    });

    // Entrada de 30
    await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.IN,
      quantity: 30
    });

    // Saída de 12
    const outResult = await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.OUT,
      quantity: 12,
      reason: 'Consumo interno para showroom'
    });

    expect(outResult.previousStock).toBe(30);
    expect(outResult.newStock).toBe(18);
    expect(outResult.delta).toBe(-12);

    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(18);
  });

  it('deve bloquear saída se deixar estoque negativo quando allowNegativeStock for false', async () => {
    await settingsRepository.set('allowNegativeStock', false);

    const productId = await ProductService.createProduct({
      name: 'Cabo HDMI 2.1 Ultra',
      purchasePriceCents: 2000,
      salePriceCents: 4500
    });

    // Entrada de 5
    await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.IN,
      quantity: 5
    });

    // Tentar sair 8 (saldo atual é 5)
    let threwError = false;
    try {
      await StockService.recordMovement({
        productId,
        type: MOVEMENT_TYPES.OUT,
        quantity: 8,
        reason: 'Venda avulsa'
      });
    } catch (e) {
      threwError = true;
      expect(e.message.toLowerCase()).toContain('estoque insuficiente');
    }

    expect(threwError).toBeTrue();

    // Saldo do produto deve permanecer inalterado (5)
    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(5);

    // Histórico deve conter apenas a entrada
    const movements = await stockMovementRepository.findByProductId(productId);
    expect(movements.length).toBe(1);
  });

  it('deve permitir estoque negativo se allowNegativeStock for true', async () => {
    await settingsRepository.set('allowNegativeStock', true);

    const productId = await ProductService.createProduct({
      name: 'Adaptador USB-C Hub',
      purchasePriceCents: 4000,
      salePriceCents: 8000
    });

    // Saída de 3 sem entrada prévia
    const outResult = await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.OUT,
      quantity: 3,
      reason: 'Venda antecipada com entrega futura'
    });

    expect(outResult.newStock).toBe(-3);

    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(-3);

    // Restaurar configuração
    await settingsRepository.set('allowNegativeStock', false);
  });

  it('deve realizar ajuste físico direto com adjustStock', async () => {
    const productId = await ProductService.createProduct({
      name: 'Pendrive 64GB',
      purchasePriceCents: 1500,
      salePriceCents: 3500
    });

    // Entrada de 10
    await StockService.recordMovement({
      productId,
      type: MOVEMENT_TYPES.IN,
      quantity: 10
    });

    // Balanço físico: foram contados 14 itens (delta +4)
    const adjResult = await StockService.adjustStock({
      productId,
      targetQuantity: 14,
      reason: 'Inventário mensal'
    });

    expect(adjResult.previousStock).toBe(10);
    expect(adjResult.newStock).toBe(14);
    expect(adjResult.delta).toBe(4);

    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(14);
  });

  it('deve calcular status de estoque e visão geral com métricas financeiras', async () => {
    // 1. Produto normal
    const p1 = await ProductService.createProduct({
      name: 'Headphone Normal',
      purchasePriceCents: 10000,
      salePriceCents: 20000,
      minimumStock: 5,
      maximumStock: 30
    });
    await StockService.recordMovement({ productId: p1, type: MOVEMENT_TYPES.IN, quantity: 15 });

    // 2. Produto com estoque baixo
    const p2 = await ProductService.createProduct({
      name: 'Microfone Baixo',
      purchasePriceCents: 5000,
      salePriceCents: 10000,
      minimumStock: 10,
      maximumStock: 50
    });
    await StockService.recordMovement({ productId: p2, type: MOVEMENT_TYPES.IN, quantity: 4 });

    // 3. Produto esgotado (zerado)
    const p3 = await ProductService.createProduct({
      name: 'Webcam Zerada',
      purchasePriceCents: 8000,
      salePriceCents: 16000,
      minimumStock: 2,
      maximumStock: 20
    });

    const overview = await StockService.getStockOverview({});
    expect(overview.metrics.totalUnits).toBeGreaterThanOrEqual(19);
    expect(overview.metrics.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(overview.metrics.outOfStockCount).toBeGreaterThanOrEqual(1);

    // Filtrar por status LOW_STOCK
    const lowStockOverview = await StockService.getStockOverview({ status: STOCK_STATUS.LOW_STOCK });
    expect(lowStockOverview.products.some(p => p.id === p2)).toBeTrue();
    expect(lowStockOverview.products.some(p => p.id === p1)).toBeFalse();
  });

  it('deve realizar auditoria e recálculo total de estoque via recalculateAllStock', async () => {
    const pId = await ProductService.createProduct({
      name: 'Auditoria Test Item',
      purchasePriceCents: 1000,
      salePriceCents: 2000
    });

    // Criar movimentações
    await StockService.recordMovement({ productId: pId, type: MOVEMENT_TYPES.IN, quantity: 50 });
    await StockService.recordMovement({ productId: pId, type: MOVEMENT_TYPES.OUT, quantity: 15, reason: 'Saída' });
    // Saldo real = 35

    // Simular inconsistência no cache do produto diretamente
    const pObj = await productRepository.findById(pId);
    pObj.stockQuantity = 999;
    await productRepository.update(pObj);

    // Executar auditoria
    const audit = await StockService.recalculateAllStock();
    expect(audit.syncedCount).toBeGreaterThanOrEqual(1);

    const fixed = await productRepository.findById(pId);
    expect(fixed.stockQuantity).toBe(35);
  });

  it('deve emitir evento STOCK_CHANGED no EventBus', async () => {
    let capturedStockEvent = null;
    const unsub = eventBus.on(EVENTS.STOCK_CHANGED, (data) => {
      capturedStockEvent = data;
    });

    const pId = await ProductService.createProduct({
      name: 'Produto Evento Estoque'
    });

    await StockService.recordMovement({
      productId: pId,
      type: MOVEMENT_TYPES.IN,
      quantity: 25
    });

    expect(capturedStockEvent).not.toBeNull();
    expect(capturedStockEvent.productId).toBe(pId);
    expect(capturedStockEvent.newStock).toBe(25);

    unsub();
  });
});
