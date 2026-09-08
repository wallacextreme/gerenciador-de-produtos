import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'bun:test';
import { AnalyticsService, PERIOD_TYPES, VELOCITY_CLASSIFICATION } from '../src/js/services/AnalyticsService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';

// Helpers para setup de dados
async function createTestProduct(overrides = {}) {
  const id = crypto.randomUUID();
  const product = {
    id,
    name: overrides.name || `Produto Teste ${id.slice(0, 6)}`,
    productCode: overrides.productCode || `SKU-${id.slice(0, 4)}`,
    category: overrides.category || 'Eletrônicos',
    purchasePriceCents: overrides.purchasePriceCents ?? 5000, // R$ 50,00
    salePriceCents: overrides.salePriceCents ?? 10000, // R$ 100,00
    minimumStock: overrides.minimumStock ?? 5,
    maximumStock: overrides.maximumStock ?? 50,
    stockQuantity: overrides.stockQuantity ?? 20,
    totalSold: overrides.totalSold ?? 0,
    isActive: true,
    deletedAt: null,
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await productRepository.create(product);
  return product;
}

async function createTestSupplier(overrides = {}) {
  const id = crypto.randomUUID();
  const supplier = {
    id,
    name: overrides.name || `Fornecedor Teste ${id.slice(0, 6)}`,
    document: overrides.document || '12345678000199',
    isActive: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await supplierRepository.create(supplier);
  return supplier;
}

async function createTestSale(overrides = {}) {
  const id = crypto.randomUUID();
  const quantity = overrides.quantity ?? 2;
  const unitSalePriceCents = overrides.unitSalePriceCents ?? 10000;
  const unitCostCents = overrides.unitCostCents ?? 5000;
  const totalSaleCents = quantity * unitSalePriceCents;
  const totalCostCents = quantity * unitCostCents;
  const profitCents = totalSaleCents - totalCostCents;

  const sale = {
    id,
    productId: overrides.productId,
    productName: overrides.productName || 'Produto',
    productCode: overrides.productCode || '',
    quantity,
    unitSalePriceCents,
    unitCostCents,
    totalSaleCents,
    totalCostCents,
    profitCents,
    marginPercent: ((profitCents / totalSaleCents) * 100),
    markupPercent: ((profitCents / totalCostCents) * 100),
    paymentMethod: overrides.paymentMethod || 'PIX',
    cancelledAt: overrides.cancelledAt || null,
    date: overrides.date || new Date().toISOString(),
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saleRepository.create(sale);
  return sale;
}

async function createTestPurchase(overrides = {}) {
  const id = crypto.randomUUID();
  const quantity = overrides.quantity ?? 10;
  const unitCostCents = overrides.unitCostCents ?? 4500;
  const totalCostCents = quantity * unitCostCents;

  const purchase = {
    id,
    supplierId: overrides.supplierId,
    supplierName: overrides.supplierName || 'Fornecedor',
    productId: overrides.productId,
    productName: overrides.productName || 'Produto',
    quantity,
    unitCostCents,
    totalCostCents,
    cancelledAt: overrides.cancelledAt || null,
    date: overrides.date || new Date().toISOString(),
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await purchaseRepository.create(purchase);
  return purchase;
}

describe('AnalyticsService — Camada Analítica e Dashboard (Phase 8)', () => {

  describe('Cálculos Financeiros, CMV e Margem', () => {
    test('deve calcular corretamente Faturamento, CMV, Lucro Bruto e Margem Geral a partir de dados reais', () => {
      const sales = [
        {
          quantity: 2,
          unitCostCents: 5000,
          totalSaleCents: 20000, // R$ 200,00
          totalCostCents: 10000, // R$ 100,00 (CMV)
          profitCents: 10000     // R$ 100,00
        },
        {
          quantity: 1,
          unitCostCents: 8000,
          totalSaleCents: 12000, // R$ 120,00
          totalCostCents: 8000,  // R$ 80,00 (CMV)
          profitCents: 4000      // R$ 40,00
        }
      ];

      const purchases = [
        { quantity: 10, totalCostCents: 50000 } // R$ 500,00
      ];

      const result = AnalyticsService.calculateFinancialMetrics(sales, purchases);

      expect(result.revenueCents).toBe(32000); // R$ 320,00
      expect(result.cogsCents).toBe(18000);    // R$ 180,00 (CMV)
      expect(result.grossProfitCents).toBe(14000); // R$ 140,00
      expect(result.totalUnitsSold).toBe(3);
      expect(result.totalSalesCount).toBe(2);
      expect(result.averageTicketCents).toBe(16000); // 32000 / 2
      // Margem = (14000 / 32000) * 100 = 43.75%
      expect(result.grossMarginPercent).toBe(43.75);
      // Markup = (14000 / 18000) * 100 = 77.78%
      expect(result.markupPercent).toBe(77.78);
      // Compras
      expect(result.totalPurchasesCount).toBe(1);
      expect(result.totalPurchasesSpentCents).toBe(50000);
      expect(result.totalUnitsPurchased).toBe(10);
    });

    test('deve tratar com segurança o cenário de faturamento zero sem erro de divisão por zero', () => {
      const result = AnalyticsService.calculateFinancialMetrics([], []);

      expect(result.revenueCents).toBe(0);
      expect(result.cogsCents).toBe(0);
      expect(result.grossProfitCents).toBe(0);
      expect(result.grossMarginPercent).toBeNull();
      expect(result.markupPercent).toBeNull();
      expect(result.averageTicketCents).toBe(0);
      expect(result.totalSalesCount).toBe(0);
    });

    test('deve suportar operações com lucro negativo (prejuízo) sem corromper métricas', () => {
      const sales = [
        {
          quantity: 1,
          unitCostCents: 10000, // Custo R$ 100
          totalSaleCents: 8000,  // Vendido por R$ 80 (Prejuízo R$ 20)
          totalCostCents: 10000,
          profitCents: -2000
        }
      ];

      const result = AnalyticsService.calculateFinancialMetrics(sales, []);

      expect(result.revenueCents).toBe(8000);
      expect(result.cogsCents).toBe(10000);
      expect(result.grossProfitCents).toBe(-2000);
      expect(result.grossMarginPercent).toBe(-25); // (-2000 / 8000) * 100 = -25%
      expect(result.markupPercent).toBe(-20);      // (-2000 / 10000) * 100 = -20%
    });
  });

  describe('Valorização e Giro de Estoque', () => {
    test('deve calcular valor do estoque pelo custo de referência e pelo preço de venda', () => {
      const products = [
        { stockQuantity: 10, purchasePriceCents: 2000, salePriceCents: 4000, minimumStock: 5, maximumStock: 20 },
        { stockQuantity: 5, purchasePriceCents: 10000, salePriceCents: 15000, minimumStock: 2, maximumStock: 10 },
        { stockQuantity: 0, purchasePriceCents: 5000, salePriceCents: 8000, minimumStock: 1, maximumStock: 5 }
      ];

      const cogsCents = 35000; // CMV no período
      const result = AnalyticsService.calculateStockValuation(products, cogsCents);

      expect(result.totalStockUnits).toBe(15);
      // Custo: (10 * 2000) + (5 * 10000) = 20000 + 50000 = 70000 (R$ 700,00)
      expect(result.stockCostValueCents).toBe(70000);
      // Venda: (10 * 4000) + (5 * 15000) = 40000 + 75000 = 115000 (R$ 1.150,00)
      expect(result.stockSaleValueCents).toBe(115000);
      expect(result.potentialProfitCents).toBe(45000);
      // Giro: 35000 / 70000 = 0.50
      expect(result.turnoverRatio).toBe(0.5);
      expect(result.statusCounts.outOfStock).toBe(1);
      expect(result.statusCounts.normalStock).toBe(2);
    });

    test('deve retornar turnoverRatio nulo quando não houver custo de estoque ou vendas', () => {
      const result = AnalyticsService.calculateStockValuation([], 0);
      expect(result.stockCostValueCents).toBe(0);
      expect(result.turnoverRatio).toBeNull();
      expect(result.turnoverDays).toBeNull();
    });
  });

  describe('Curva ABC de Produtos (Princípio de Pareto)', () => {
    test('deve classificar corretamente produtos em Classes A, B e C conforme limites de faturamento acumulado', () => {
      const products = [
        { id: 'p1', name: 'Smartphone Pro' },
        { id: 'p2', name: 'Smartwatch X' },
        { id: 'p3', name: 'Fone Bluetooth' },
        { id: 'p4', name: 'Cabo USB-C' },
        { id: 'p5', name: 'Película de Vidro' }
      ];

      // Faturamento total: R$ 100.000 (10.000.000 centavos)
      // p1: R$ 75.000 (75% -> acumula 75%) -> Classe A (<= 80%)
      // p2: R$ 15.000 (15% -> acumula 90%) -> Classe B (<= 95%)
      // p3: R$ 4.000  (4%  -> acumula 94%) -> Classe B (<= 95%)
      // p4: R$ 4.000  (4%  -> acumula 98%) -> Classe C (> 95%)
      // p5: R$ 2.000  (2%  -> acumula 100%) -> Classe C (> 95%)
      const sales = [
        { productId: 'p1', totalSaleCents: 7500000 },
        { productId: 'p2', totalSaleCents: 1500000 },
        { productId: 'p3', totalSaleCents: 400000 },
        { productId: 'p4', totalSaleCents: 400000 },
        { productId: 'p5', totalSaleCents: 200000 }
      ];

      const abc = AnalyticsService.calculateProductABC(sales, products);

      expect(abc.summary.totalRevenueCents).toBe(10000000);
      expect(abc.classA.length).toBe(1);
      expect(abc.classA[0].id).toBe('p1');
      expect(abc.classA[0].classification).toBe('A');

      expect(abc.classB.length).toBe(2);
      expect(abc.classB[0].id).toBe('p2');
      expect(abc.classB[1].id).toBe('p3');

      expect(abc.classC.length).toBe(2);
      expect(abc.classC[0].id).toBe('p4');
      expect(abc.classC[1].id).toBe('p5');
    });

    test('deve retornar listas vazias de ABC quando não houver vendas', () => {
      const abc = AnalyticsService.calculateProductABC([], [{ id: 'p1', name: 'P1' }]);
      expect(abc.classA.length).toBe(0);
      expect(abc.classB.length).toBe(0);
      expect(abc.classC.length).toBe(0);
      expect(abc.summary.totalRevenueCents).toBe(0);
    });
  });

  describe('Velocidade de Venda e Produtos Parados', () => {
    test('deve calcular velocidade diária (run rate) e identificar produtos parados sem giro', () => {
      const products = [
        { id: 'p1', name: 'Produto Rápido', stockQuantity: 30, purchasePriceCents: 2000 },
        { id: 'p2', name: 'Produto Normal', stockQuantity: 10, purchasePriceCents: 3000 },
        { id: 'p3', name: 'Produto Parado', stockQuantity: 50, purchasePriceCents: 5000 } // R$ 2.500 parado
      ];

      // Período de 30 dias
      // p1: 60 un vendidas (2.0 un/dia -> RÁPIDA, cobertura = 30 / 2 = 15 dias)
      // p2: 9 un vendidas (0.30 un/dia -> NORMAL, cobertura = 10 / 0.3 = 33 dias)
      // p3: 0 un vendidas -> PARADA
      const sales = [
        { productId: 'p1', quantity: 60, totalSaleCents: 300000, totalCostCents: 120000, profitCents: 180000 },
        { productId: 'p2', quantity: 9, totalSaleCents: 45000, totalCostCents: 27000, profitCents: 18000 }
      ];

      const perf = AnalyticsService.calculateProductPerformance(sales, products, 30);

      expect(perf.topSellers.length).toBe(2);
      expect(perf.topSellers[0].id).toBe('p1');
      expect(perf.topSellers[0].dailySalesRate).toBe(2.0);
      expect(perf.topSellers[0].velocity).toBe(VELOCITY_CLASSIFICATION.RAPIDA);
      expect(perf.topSellers[0].coverageDays).toBe(15);

      expect(perf.topSellers[1].id).toBe('p2');
      expect(perf.topSellers[1].velocity).toBe(VELOCITY_CLASSIFICATION.NORMAL);

      // Produto Parado
      expect(perf.idleProductsCount).toBe(1);
      expect(perf.idleProducts[0].id).toBe('p3');
      expect(perf.idleProducts[0].idleCapitalCents).toBe(250000); // 50 * 5000 = R$ 2.500,00
      expect(perf.totalIdleCapitalCents).toBe(250000);
    });
  });

  describe('Análise por Fornecedor e Curva ABC de Compras', () => {
    test('deve ranquear fornecedores por volume de compras reais e classificar ABC', () => {
      const suppliers = [
        { id: 's1', name: 'Distribuidora Alpha' },
        { id: 's2', name: 'Importadora Beta' },
        { id: 's3', name: 'Fornecedor Gamma' }
      ];

      const purchases = [
        { supplierId: 's1', supplierName: 'Distribuidora Alpha', quantity: 50, totalCostCents: 800000 }, // R$ 8.000 (80%)
        { supplierId: 's2', supplierName: 'Importadora Beta', quantity: 10, totalCostCents: 150000 },     // R$ 1.500 (15%)
        { supplierId: 's3', supplierName: 'Fornecedor Gamma', quantity: 5, totalCostCents: 50000 }        // R$ 500 (5%)
      ];

      const analysis = AnalyticsService.calculateSupplierAnalysis(purchases, suppliers);

      expect(analysis.topSuppliers.length).toBe(3);
      expect(analysis.topSuppliers[0].supplierId).toBe('s1');
      expect(analysis.topSuppliers[0].totalSpentCents).toBe(800000);
      expect(analysis.supplierABC.classA[0].supplierId).toBe('s1');
      expect(analysis.supplierABC.classB[0].supplierId).toBe('s2');
      expect(analysis.supplierABC.classC[0].supplierId).toBe('s3');
    });
  });

  describe('Análise por Categoria', () => {
    test('deve agrupar faturamento, margem e estoque por categoria', () => {
      const products = [
        { id: 'p1', category: 'Informática', stockQuantity: 5, purchasePriceCents: 1000 },
        { id: 'p2', category: 'Informática', stockQuantity: 10, purchasePriceCents: 2000 },
        { id: 'p3', category: 'Acessórios', stockQuantity: 20, purchasePriceCents: 500 }
      ];

      const sales = [
        { productId: 'p1', quantity: 2, totalSaleCents: 4000, totalCostCents: 2000, profitCents: 2000 },
        { productId: 'p3', quantity: 5, totalSaleCents: 5000, totalCostCents: 2500, profitCents: 2500 }
      ];

      const catAnalysis = AnalyticsService.calculateCategoryAnalysis(sales, products);

      expect(catAnalysis.totalCategoriesCount).toBe(2);
      expect(catAnalysis.totalRevenueCents).toBe(9000);

      const infoCat = catAnalysis.categories.find(c => c.categoryName === 'Informática');
      expect(infoCat.productsCount).toBe(2);
      expect(infoCat.currentStockUnits).toBe(15);
      expect(infoCat.revenueCents).toBe(4000);
      expect(infoCat.marginPercent).toBe(50);
    });
  });

  describe('Filtros de Período e Séries Temporais', () => {
    test('deve gerar intervalos de data consistentes para Hoje, 7d, 30d, 90d e 12m', () => {
      const pToday = AnalyticsService.getPeriodDateRange(PERIOD_TYPES.TODAY);
      expect(pToday.periodDays).toBe(1);

      const p7 = AnalyticsService.getPeriodDateRange(PERIOD_TYPES.LAST_7_DAYS);
      expect(p7.periodDays).toBe(7);

      const p30 = AnalyticsService.getPeriodDateRange(PERIOD_TYPES.LAST_30_DAYS);
      expect(p30.periodDays).toBe(30);

      const p90 = AnalyticsService.getPeriodDateRange(PERIOD_TYPES.LAST_90_DAYS);
      expect(p90.periodDays).toBe(90);

      const pCustom = AnalyticsService.getPeriodDateRange(PERIOD_TYPES.CUSTOM, '2026-08-01', '2026-08-15');
      expect(pCustom.periodDays).toBe(15);
    });

    test('deve gerar série temporal com todos os dias preenchidos mesmo sem vendas', () => {
      const start = new Date(2026, 7, 1); // 01/08/2026
      const end = new Date(2026, 7, 5);   // 05/08/2026
      
      const sales = [
        { date: '2026-08-02T14:30:00.000Z', totalSaleCents: 15000, totalCostCents: 8000, profitCents: 7000 }
      ];
      const purchases = [
        { date: '2026-08-04T10:00:00.000Z', totalCostCents: 50000 }
      ];

      const series = AnalyticsService.generateTimelineSeries(sales, purchases, start, end, 5);

      expect(series.length).toBe(5);
      expect(series[0].revenueCents).toBe(0); // dia 01
      expect(series[1].revenueCents).toBe(15000); // dia 02
      expect(series[3].purchasesCents).toBe(50000); // dia 04
    });
  });

  describe('Integração com IndexedDB e getDashboardAnalytics', () => {
    test('deve orquestrar e retornar payload completo a partir do banco de dados real', async () => {
      const prod = await createTestProduct({
        name: 'Teclado Mecânico RGB',
        purchasePriceCents: 15000, // R$ 150
        salePriceCents: 30000,     // R$ 300
        stockQuantity: 15
      });

      const supp = await createTestSupplier({ name: 'Tech Distribuidora' });

      await createTestSale({
        productId: prod.id,
        productName: prod.name,
        quantity: 3,
        unitSalePriceCents: 30000,
        unitCostCents: 15000
      });

      await createTestPurchase({
        supplierId: supp.id,
        supplierName: supp.name,
        productId: prod.id,
        quantity: 10,
        unitCostCents: 14000
      });

      const data = await AnalyticsService.getDashboardAnalytics({
        periodType: PERIOD_TYPES.LAST_30_DAYS
      });

      expect(data.hasData).toBe(true);
      expect(data.financial.revenueCents).toBe(90000); // 3 * 30000
      expect(data.financial.cogsCents).toBe(45000);    // 3 * 15000
      expect(data.financial.grossProfitCents).toBe(45000);
      expect(data.financial.grossMarginPercent).toBe(50);
      expect(data.stockValuation.totalStockUnits).toBeGreaterThanOrEqual(15);
      expect(data.productABC.classA.length).toBeGreaterThanOrEqual(1);
      expect(data.supplierAnalysis.topSuppliers.length).toBeGreaterThanOrEqual(1);
    });
  });
});
