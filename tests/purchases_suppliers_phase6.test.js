import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'bun:test';
import { SupplierService } from '../src/js/services/SupplierService.js';
import { PurchaseService } from '../src/js/services/PurchaseService.js';
import { ProductService } from '../src/js/services/ProductService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { SupplierValidator } from '../src/js/validators/SupplierValidator.js';
import { PurchaseValidator } from '../src/js/validators/PurchaseValidator.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('SupplierValidator (Phase 6)', () => {
  it('deve validar fornecedor com dados corretos', () => {
    const res = SupplierValidator.validate({
      name: 'Distribuidora Tech Brasil Ltda',
      document: '12.345.678/0001-90',
      email: 'contato@techbrasil.com.br',
      phone: '(11) 98765-4321'
    });
    expect(res.isValid).toBeTrue();
    expect(res.errors.length).toBe(0);
  });

  it('deve falhar se nome do fornecedor for vazio ou curto', () => {
    const resEmpty = SupplierValidator.validate({ name: '' });
    expect(resEmpty.isValid).toBeFalse();

    const resShort = SupplierValidator.validate({ name: 'A' });
    expect(resShort.isValid).toBeFalse();
  });

  it('deve falhar se email for inválido', () => {
    const res = SupplierValidator.validate({
      name: 'Fornecedor Teste',
      email: 'email_invalido_sem_arroba'
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Email'))).toBeTrue();
  });

  it('deve falhar se documento for inválido em tamanho de dígitos', () => {
    const res = SupplierValidator.validate({
      name: 'Fornecedor Teste',
      document: '12345'
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.some(e => e.includes('Documento'))).toBeTrue();
  });
});

describe('SupplierService CRUD & Regras (Phase 6)', () => {
  it('deve cadastrar, atualizar, listar e fazer soft delete de fornecedor', async () => {
    const supplierId = await SupplierService.createSupplier({
      name: 'Alpha Informática e Peças',
      document: '11.222.333/0001-44',
      email: 'vendas@alphainfo.com',
      phone: '(11) 3333-4444',
      contactPerson: 'Roberto Alves'
    });

    expect(supplierId).toBeDefined();

    // Buscar fornecedor
    const sup = await supplierRepository.findById(supplierId);
    expect(sup.name).toBe('Alpha Informática e Peças');
    expect(sup.contactPerson).toBe('Roberto Alves');

    // Atualizar
    await SupplierService.updateSupplier(supplierId, {
      name: 'Alpha Informática & Componentes',
      contactPerson: 'Roberto Carlos'
    });

    const updated = await supplierRepository.findById(supplierId);
    expect(updated.name).toBe('Alpha Informática & Componentes');
    expect(updated.contactPerson).toBe('Roberto Carlos');

    // Listar
    const list = await SupplierService.listSuppliers({ search: 'Alpha' });
    expect(list.length).toBeGreaterThanOrEqual(1);

    // Soft delete
    await SupplierService.deleteSupplier(supplierId);
    const deleted = await supplierRepository.findById(supplierId);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('deve bloquear duplicidade de documento (CNPJ/CPF) entre fornecedores ativos', async () => {
    await SupplierService.createSupplier({
      name: 'Fornecedor Uno',
      document: '99.888.777/0001-66'
    });

    let threw = false;
    try {
      await SupplierService.createSupplier({
        name: 'Fornecedor Duplo',
        document: '99.888.777/0001-66'
      });
    } catch (e) {
      threw = true;
      expect(e.message.toLowerCase()).toContain('já existe um fornecedor');
    }

    expect(threw).toBeTrue();
  });
});

describe('PurchaseValidator (Phase 6)', () => {
  it('deve validar compra com dados consistentes', () => {
    const res = PurchaseValidator.validate({
      productId: 'prod-uuid-1',
      supplierId: 'supp-uuid-1',
      quantity: 50,
      unitCostCents: 4500
    });
    expect(res.isValid).toBeTrue();
  });

  it('deve falhar para falta de produto, fornecedor ou quantidade <= 0', () => {
    const resNoProd = PurchaseValidator.validate({ supplierId: 's-1', quantity: 10 });
    expect(resNoProd.isValid).toBeFalse();

    const resNoSup = PurchaseValidator.validate({ productId: 'p-1', quantity: 10 });
    expect(resNoSup.isValid).toBeFalse();

    const resZeroQty = PurchaseValidator.validate({ productId: 'p-1', supplierId: 's-1', quantity: 0 });
    expect(resZeroQty.isValid).toBeFalse();
  });
});

describe('PurchaseService & Operações Transacionais (Phase 6)', () => {
  it('deve registrar ordem de compra com entrada atômica no estoque e opcionalmente atualizar preço de compra', async () => {
    const supplierId = await SupplierService.createSupplier({
      name: 'Mega Suprimentos Brasil',
      document: '44.555.666/0001-88'
    });

    const productId = await ProductService.createProduct({
      name: 'SSD NVMe 1TB HighSpeed',
      purchasePriceCents: 20000, // R$ 200,00
      salePriceCents: 35000
    });

    // Saldo inicial do produto = 0
    let pInitial = await productRepository.findById(productId);
    expect(pInitial.stockQuantity || 0).toBe(0);

    // Registrar compra de 20 unidades a R$ 180,00 cada (atualizando preço de compra do catálogo)
    const purchaseResult = await PurchaseService.recordPurchase({
      supplierId,
      productId,
      quantity: 20,
      unitCostCents: 18000,
      invoiceNumber: 'NF-99881',
      updateProductPurchasePrice: true,
      notes: 'Lote promocional de fábrica'
    });

    expect(purchaseResult.purchaseId).toBeDefined();
    expect(purchaseResult.totalCostCents).toBe(360000); // 20 * 18000 = R$ 3.600,00
    expect(purchaseResult.previousStock).toBe(0);
    expect(purchaseResult.newStock).toBe(20);

    // 1. Verificar store purchases
    const savedPurchase = await purchaseRepository.findById(purchaseResult.purchaseId);
    expect(savedPurchase).not.toBeNull();
    expect(savedPurchase.supplierName).toBe('Mega Suprimentos Brasil');
    expect(savedPurchase.invoiceNumber).toBe('NF-99881');
    expect(savedPurchase.quantity).toBe(20);

    // 2. Verificar store stockMovements (tipo PURCHASE com delta positivo)
    const movements = await stockMovementRepository.findByProductId(productId);
    const purchaseMov = movements.find(m => m.type === 'PURCHASE');
    expect(purchaseMov).toBeDefined();
    expect(purchaseMov.quantity).toBe(20);
    expect(purchaseMov.delta).toBe(20);
    expect(purchaseMov.referenceId).toBe(purchaseResult.purchaseId);
    expect(purchaseMov.resultingStock).toBe(20);

    // 3. Verificar store products (saldo incrementado e preço de compra atualizado para R$ 180,00)
    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(20);
    expect(product.purchasePriceCents).toBe(18000);
  });

  it('deve estornar/cancelar ordem de compra deduzindo os itens do estoque', async () => {
    const supplierId = await SupplierService.createSupplier({ name: 'Fornecedor Reposição' });
    const productId = await ProductService.createProduct({ name: 'Monitor Gamer 27 165Hz', purchasePriceCents: 80000, salePriceCents: 130000 });

    // Comprar 15 unidades
    const purchase = await PurchaseService.recordPurchase({
      supplierId,
      productId,
      quantity: 15,
      unitCostCents: 80000
    });

    let pAfterPurchase = await productRepository.findById(productId);
    expect(pAfterPurchase.stockQuantity).toBe(15);

    // Cancelar/estornar a compra
    const cancelRes = await PurchaseService.cancelPurchase(purchase.purchaseId, 'Devolução por avaria no frete');
    expect(cancelRes.deductedQuantity).toBe(15);
    expect(cancelRes.newStock).toBe(0);

    // Verificar compra marcada como cancelada
    const cancelledPurchase = await purchaseRepository.findById(purchase.purchaseId);
    expect(cancelledPurchase.cancelledAt).not.toBeNull();
    expect(cancelledPurchase.cancelReason).toContain('avaria no frete');

    // Verificar estoque deduzido e movimento OUT gerado
    const movements = await stockMovementRepository.findByProductId(productId);
    const cancelMov = movements.find(m => m.type === 'OUT' && m.referenceId === purchase.purchaseId);
    expect(cancelMov).toBeDefined();
    expect(cancelMov.delta).toBe(-15);

    const pAfterCancel = await productRepository.findById(productId);
    expect(pAfterCancel.stockQuantity).toBe(0);
  });

  it('deve bloquear cancelamento de compra se os produtos já tiverem sido consumidos/vendidos quando allowNegativeStock for false', async () => {
    await settingsRepository.set('allowNegativeStock', false);

    const supplierId = await SupplierService.createSupplier({ name: 'Fornecedor Exclusivo' });
    const productId = await ProductService.createProduct({ name: 'Placa de Vídeo RTX 4070', purchasePriceCents: 300000 });

    // Compra 10 unidades
    const purchase = await PurchaseService.recordPurchase({
      supplierId,
      productId,
      quantity: 10
    });

    // Simula que 8 unidades foram vendidas / saíram, restando apenas 2 em estoque
    await stockMovementRepository.create({
      id: crypto.randomUUID(),
      productId,
      type: 'OUT',
      quantity: 8,
      delta: -8,
      reason: 'Venda de produtos',
      resultingStock: 2,
      createdAt: new Date().toISOString()
    });
    const prod = await productRepository.findById(productId);
    prod.stockQuantity = 2;
    await productRepository.update(prod);

    // Tentar cancelar a compra inteira de 10 unidades quando só restam 2
    let threw = false;
    try {
      await PurchaseService.cancelPurchase(purchase.purchaseId, 'Tentativa de estorno inválida');
    } catch (e) {
      threw = true;
      expect(e.message.toLowerCase()).toContain('ficaria negativo');
    }

    expect(threw).toBeTrue();

    // Confirmar que o saldo continuou 2
    const prodAfter = await productRepository.findById(productId);
    expect(prodAfter.stockQuantity).toBe(2);
  });

  it('deve consolidar visão geral de compras em getPurchasesOverview', async () => {
    const sup = await SupplierService.createSupplier({ name: 'Fornecedor de Áudio' });
    const p1 = await ProductService.createProduct({ name: 'Microfone Condensador Studio' });
    const p2 = await ProductService.createProduct({ name: 'Interface de Áudio USB' });

    await PurchaseService.recordPurchase({ supplierId: sup, productId: p1, quantity: 5, unitCostCents: 20000 }); // R$ 1.000,00
    await PurchaseService.recordPurchase({ supplierId: sup, productId: p2, quantity: 2, unitCostCents: 40000 }); // R$ 800,00

    const overview = await PurchaseService.getPurchasesOverview();
    expect(overview.metrics.totalPurchasesCount).toBeGreaterThanOrEqual(2);
    expect(overview.metrics.totalItemsPurchased).toBeGreaterThanOrEqual(7);
    expect(overview.metrics.totalSpentCents).toBeGreaterThanOrEqual(180000);
  });
});
