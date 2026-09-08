import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'bun:test';
import { QuotationValidator } from '../src/js/validators/QuotationValidator.js';
import { QuotationService } from '../src/js/services/QuotationService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';

// ─────────────────────────────────────────────
// Helpers de dados de teste
// ─────────────────────────────────────────────
async function makeProduct(overrides = {}) {
  const id = crypto.randomUUID();
  const product = {
    id,
    name: overrides.name || ('Produto Fase7 ' + id.slice(0, 6)),
    productCode: overrides.productCode || '',
    purchasePriceCents: overrides.purchasePriceCents || 5000,
    salePriceCents: overrides.salePriceCents || 9000,
    stockQuantity: overrides.stockQuantity ?? 10,
    totalSold: 0,
    isActive: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await productRepository.create(product);
  return product;
}

async function makeSupplier(overrides = {}) {
  const id = crypto.randomUUID();
  const supplier = {
    id,
    name: overrides.name || ('Fornecedor Fase7 ' + id.slice(0, 6)),
    document: overrides.document || '',
    email: '',
    phone: '',
    isActive: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await supplierRepository.create(supplier);
  return supplier;
}

// ─────────────────────────────────────────────
// QuotationValidator
// ─────────────────────────────────────────────
describe('QuotationValidator (Phase 7)', () => {
  test('deve validar cotação com dados corretos', () => {
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      supplierId: crypto.randomUUID(),
      unitCostCents: 7500,
      minimumOrderQty: 10,
      leadTimeDays: 5,
      paymentTerms: '30/60 dias',
      quoteDate: new Date().toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    });
    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('deve falhar se productId não for informado', () => {
    const result = QuotationValidator.validate({
      supplierId: crypto.randomUUID(),
      unitCostCents: 5000
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Produto'))).toBe(true);
  });

  test('deve falhar se supplierId não for informado', () => {
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      unitCostCents: 5000
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Fornecedor'))).toBe(true);
  });

  test('deve falhar se unitCostCents for negativo', () => {
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      supplierId: crypto.randomUUID(),
      unitCostCents: -100
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('centavos'))).toBe(true);
  });

  test('deve aceitar unitCostCents igual a zero (orçamento aberto)', () => {
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      supplierId: crypto.randomUUID(),
      unitCostCents: 0
    });
    expect(result.isValid).toBe(true);
  });

  test('deve falhar se leadTimeDays for negativo', () => {
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      supplierId: crypto.randomUUID(),
      unitCostCents: 5000,
      leadTimeDays: -1
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Prazo'))).toBe(true);
  });

  test('deve falhar se validUntil for anterior à quoteDate', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const result = QuotationValidator.validate({
      productId: crypto.randomUUID(),
      supplierId: crypto.randomUUID(),
      unitCostCents: 5000,
      quoteDate: today.toISOString(),
      validUntil: yesterday.toISOString()
    });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('validade'))).toBe(true);
  });

  test('deve detectar cotação vencida via isExpired()', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    expect(QuotationValidator.isExpired({ validUntil: pastDate })).toBe(true);
  });

  test('deve retornar false para cotação sem validUntil', () => {
    expect(QuotationValidator.isExpired({ validUntil: null })).toBe(false);
  });
});

// ─────────────────────────────────────────────
// QuotationService
// ─────────────────────────────────────────────
describe('QuotationService — Cotações por Produto (Phase 7)', () => {
  test('deve criar uma cotação para um produto', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    const q = await QuotationService.addQuotation({
      productId: product.id,
      supplierId: supplier.id,
      unitCostCents: 8000,
      leadTimeDays: 7,
      paymentTerms: '30 dias',
      quoteDate: new Date().toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    });

    expect(q.id).toBeTruthy();
    expect(q.productId).toBe(product.id);
    expect(q.supplierId).toBe(supplier.id);
    expect(q.unitCostCents).toBe(8000);
    expect(q.isActive).toBe(true);
    expect(q.productName).toBe(product.name);
    expect(q.supplierName).toBe(supplier.name);
  });

  test('deve bloquear 4º fornecedor distinto para o mesmo produto', async () => {
    const product = await makeProduct();
    const s1 = await makeSupplier();
    const s2 = await makeSupplier();
    const s3 = await makeSupplier();
    const s4 = await makeSupplier();

    const base = { productId: product.id, unitCostCents: 5000 };
    await QuotationService.addQuotation({ ...base, supplierId: s1.id });
    await QuotationService.addQuotation({ ...base, supplierId: s2.id });
    await QuotationService.addQuotation({ ...base, supplierId: s3.id });

    let threw = false;
    try {
      await QuotationService.addQuotation({ ...base, supplierId: s4.id });
    } catch (e) {
      threw = true;
      expect(e.message).toMatch(/3 fornecedores/);
    }
    expect(threw).toBe(true);
  });

  test('deve bloquear cotação duplicada do mesmo fornecedor no mesmo produto', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    await QuotationService.addQuotation({ productId: product.id, supplierId: supplier.id, unitCostCents: 5000 });

    let threw = false;
    try {
      await QuotationService.addQuotation({ productId: product.id, supplierId: supplier.id, unitCostCents: 4500 });
    } catch (e) {
      threw = true;
      expect(e.message).toMatch(/já possui uma cotação ativa/);
    }
    expect(threw).toBe(true);
  });

  test('deve identificar automaticamente o menor preço (isCheapest)', async () => {
    const product = await makeProduct();
    const s1 = await makeSupplier();
    const s2 = await makeSupplier();
    const s3 = await makeSupplier();

    await QuotationService.addQuotation({ productId: product.id, supplierId: s1.id, unitCostCents: 9000 });
    await QuotationService.addQuotation({ productId: product.id, supplierId: s2.id, unitCostCents: 7500 });
    await QuotationService.addQuotation({ productId: product.id, supplierId: s3.id, unitCostCents: 8200 });

    const quotations = await QuotationService.getQuotationsForProduct(product.id);
    expect(quotations.length).toBe(3);

    const cheapest = quotations.find(q => q.isCheapest);
    expect(cheapest).toBeTruthy();
    expect(cheapest.supplierId).toBe(s2.id);
    expect(cheapest.unitCostCents).toBe(7500);
    expect(quotations.filter(q => !q.isCheapest).length).toBe(2);
  });

  test('deve definir fornecedor preferido sem alterar o isCheapest (independência RQ-007 x RQ-003)', async () => {
    const product = await makeProduct();
    const s1 = await makeSupplier();
    const s2 = await makeSupplier();

    const q1 = await QuotationService.addQuotation({ productId: product.id, supplierId: s1.id, unitCostCents: 9000 });
    await QuotationService.addQuotation({ productId: product.id, supplierId: s2.id, unitCostCents: 7000 });

    await QuotationService.setPreferredSupplier(product.id, q1.id);

    const quotations = await QuotationService.getQuotationsForProduct(product.id);
    const preferred = quotations.find(q => q.isPreferred);
    const cheapest = quotations.find(q => q.isCheapest);

    expect(preferred.supplierId).toBe(s1.id);
    expect(cheapest.supplierId).toBe(s2.id);
    expect(preferred.id).not.toBe(cheapest.id);
  });

  test('deve desmarcar preferência anterior ao definir novo preferido', async () => {
    const product = await makeProduct();
    const s1 = await makeSupplier();
    const s2 = await makeSupplier();

    const q1 = await QuotationService.addQuotation({ productId: product.id, supplierId: s1.id, unitCostCents: 9000, isPreferred: true });
    const q2 = await QuotationService.addQuotation({ productId: product.id, supplierId: s2.id, unitCostCents: 7000 });

    await QuotationService.setPreferredSupplier(product.id, q2.id);

    const quotations = await QuotationService.getQuotationsForProduct(product.id);
    const preferred = quotations.filter(q => q.isPreferred);
    expect(preferred.length).toBe(1);
    expect(preferred[0].id).toBe(q2.id);
  });

  test('deve atualizar cotação criando nova entrada e preservando histórico', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    const original = await QuotationService.addQuotation({
      productId: product.id,
      supplierId: supplier.id,
      unitCostCents: 8000,
      quoteDate: '2026-08-15T10:00:00.000Z'
    });

    const updated = await QuotationService.updateQuotation(original.id, {
      unitCostCents: 7600,
      quoteDate: '2026-08-18T10:00:00.000Z'
    });

    expect(updated.id).not.toBe(original.id);
    expect(updated.unitCostCents).toBe(7600);
    expect(updated.previousQuotationId).toBe(original.id);
    expect(updated.isActive).toBe(true);

    const history = await QuotationService.getQuotationHistory(product.id);
    const oldRecord = history.find(h => h.id === original.id);
    expect(oldRecord).toBeTruthy();
    expect(oldRecord.isActive).toBe(false);
    expect(oldRecord.unitCostCents).toBe(8000); // Histórico imutável
  });

  test('deve desativar cotação e preservá-la no histórico', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    const q = await QuotationService.addQuotation({ productId: product.id, supplierId: supplier.id, unitCostCents: 6000 });
    await QuotationService.deactivateQuotation(q.id);

    const active = await QuotationService.getQuotationsForProduct(product.id);
    expect(active.find(x => x.id === q.id)).toBeUndefined();

    const history = await QuotationService.getQuotationHistory(product.id);
    const deactivated = history.find(h => h.id === q.id);
    expect(deactivated).toBeTruthy();
    expect(deactivated.isActive).toBe(false);
  });

  test('deve identificar cotação vencida e não incluí-la nas ativas', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    const expired = await QuotationService.addQuotation({
      productId: product.id,
      supplierId: supplier.id,
      unitCostCents: 5000,
      quoteDate: new Date(Date.now() - 7 * 86400000).toISOString(),
      validUntil: new Date(Date.now() - 86400000).toISOString() // ontem
    });

    const active = await QuotationService.getQuotationsForProduct(product.id);
    expect(active.find(q => q.id === expired.id)).toBeUndefined();

    const history = await QuotationService.getQuotationHistory(product.id);
    const expiredInHistory = history.find(h => h.id === expired.id);
    expect(expiredInHistory).toBeTruthy();
    expect(expiredInHistory.isExpiredNow).toBe(true);
  });

  test('deve permitir adicionar novo fornecedor após desativar um dos 3 ativos', async () => {
    const product = await makeProduct();
    const s1 = await makeSupplier();
    const s2 = await makeSupplier();
    const s3 = await makeSupplier();
    const s4 = await makeSupplier();

    const q1 = await QuotationService.addQuotation({ productId: product.id, supplierId: s1.id, unitCostCents: 5000 });
    await QuotationService.addQuotation({ productId: product.id, supplierId: s2.id, unitCostCents: 5000 });
    await QuotationService.addQuotation({ productId: product.id, supplierId: s3.id, unitCostCents: 5000 });

    await QuotationService.deactivateQuotation(q1.id);

    const q4 = await QuotationService.addQuotation({ productId: product.id, supplierId: s4.id, unitCostCents: 4800 });
    expect(q4.id).toBeTruthy();
    expect(q4.isActive).toBe(true);
  });

  test('deve preparar dados para pré-preenchimento de compra (prepareForPurchase)', async () => {
    const product = await makeProduct();
    const supplier = await makeSupplier();

    const q = await QuotationService.addQuotation({
      productId: product.id,
      supplierId: supplier.id,
      unitCostCents: 7000,
      leadTimeDays: 3,
      paymentTerms: '30/60 dias'
    });

    const purchaseData = await QuotationService.prepareForPurchase(q.id);
    expect(purchaseData.quotationId).toBe(q.id);
    expect(purchaseData.productId).toBe(product.id);
    expect(purchaseData.supplierId).toBe(supplier.id);
    expect(purchaseData.unitCostCents).toBe(7000);
    expect(purchaseData.leadTimeDays).toBe(3);
    expect(purchaseData.paymentTerms).toBe('30/60 dias');
  });

  test('deve aceitar cotações do mesmo fornecedor para produtos DIFERENTES', async () => {
    const p1 = await makeProduct();
    const p2 = await makeProduct();
    const supplier = await makeSupplier();

    const q1 = await QuotationService.addQuotation({ productId: p1.id, supplierId: supplier.id, unitCostCents: 5000 });
    const q2 = await QuotationService.addQuotation({ productId: p2.id, supplierId: supplier.id, unitCostCents: 6000 });

    expect(q1.productId).not.toBe(q2.productId);
    expect(q1.id).toBeTruthy();
    expect(q2.id).toBeTruthy();
  });

  test('deve retornar histórico de fornecedor com cotações de múltiplos produtos', async () => {
    const p1 = await makeProduct();
    const p2 = await makeProduct();
    const supplier = await makeSupplier();

    await QuotationService.addQuotation({ productId: p1.id, supplierId: supplier.id, unitCostCents: 5000 });
    await QuotationService.addQuotation({ productId: p2.id, supplierId: supplier.id, unitCostCents: 8000 });

    const supplierQuotations = await QuotationService.getSupplierQuotations(supplier.id);
    expect(supplierQuotations.length).toBeGreaterThanOrEqual(2);

    const productIds = supplierQuotations.map(q => q.productId);
    expect(productIds).toContain(p1.id);
    expect(productIds).toContain(p2.id);
  });
});
