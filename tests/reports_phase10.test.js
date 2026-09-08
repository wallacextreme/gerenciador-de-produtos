import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'bun:test';
import { ReportService, REPORT_TYPES } from '../src/js/services/ReportService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { PERIOD_TYPES } from '../src/js/services/AnalyticsService.js';

describe('ReportService — Relatórios e Impressão (Phase 10)', () => {

  describe('Relatório de Vendas (Comercial / PDV)', () => {
    test('deve consolidar vendas do período com receita, CMV, lucro e margem', async () => {
      const prodId = crypto.randomUUID();
      await productRepository.create({
        id: prodId,
        name: 'Teclado Mecânico RGB',
        productCode: 'TEC-01',
        purchasePriceCents: 10000,
        salePriceCents: 20000,
        stockQuantity: 15
      });

      // 1 Venda ativa de 2 unidades
      await saleRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        productName: 'Teclado Mecânico RGB',
        productCode: 'TEC-01',
        quantity: 2,
        unitSalePriceCents: 20000,
        totalSaleCents: 40000,
        unitCostCents: 10000,
        totalCostCents: 20000,
        profitCents: 20000,
        paymentMethod: 'PIX',
        customerName: 'João da Silva',
        cancelledAt: null,
        date: new Date().toISOString()
      });

      // 1 Venda cancelada
      await saleRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        productName: 'Teclado Mecânico RGB',
        quantity: 1,
        unitSalePriceCents: 20000,
        totalSaleCents: 20000,
        unitCostCents: 10000,
        totalCostCents: 10000,
        profitCents: 10000,
        cancelledAt: new Date().toISOString(),
        date: new Date().toISOString()
      });

      const report = await ReportService.generateSalesReport({ periodType: PERIOD_TYPES.LAST_30_DAYS, includeCancelled: true });

      expect(report.title).toBe('Relatório de Vendas (Comercial / PDV)');
      expect(report.summary.totalSalesCount).toBe(1);
      expect(report.summary.cancelledCount).toBe(1);
      expect(report.summary.totalUnitsSold).toBe(2);
      expect(report.summary.totalRevenueCents).toBe(40000);
      expect(report.summary.totalCogsCents).toBe(20000);
      expect(report.summary.totalProfitCents).toBe(20000);
      expect(report.summary.averageMarginPercent).toBe('50%');
      expect(report.rows.length).toBe(2);
    });
  });

  describe('Relatório de Compras e Fornecedores', () => {
    test('deve consolidar ordens de compra ativas e calcular total gasto', async () => {
      const suppId = crypto.randomUUID();
      await supplierRepository.create({
        id: suppId,
        name: 'Distribuidora Tech Brasil'
      });

      await purchaseRepository.create({
        id: crypto.randomUUID(),
        supplierId: suppId,
        supplierName: 'Distribuidora Tech Brasil',
        productName: 'Mouse Gamer',
        quantity: 10,
        unitCostCents: 5000,
        totalCostCents: 50000,
        invoiceNumber: 'NF-1234',
        cancelledAt: null,
        date: new Date().toISOString()
      });

      const report = await ReportService.generatePurchasesReport({ periodType: PERIOD_TYPES.LAST_30_DAYS });

      expect(report.title).toBe('Relatório de Ordens de Compra e Fornecedores');
      expect(report.summary.totalPurchasesCount).toBeGreaterThanOrEqual(1);
      expect(report.summary.totalUnitsPurchased).toBeGreaterThanOrEqual(10);
      expect(report.summary.totalSpentCents).toBeGreaterThanOrEqual(50000);
      expect(report.rows.length).toBeGreaterThanOrEqual(1);
      expect(report.rows[0].invoiceNumber).toBe('NF-1234');
    });
  });

  describe('Relatório de Posição de Estoque & Inventário (Balanço Físico)', () => {
    test('deve calcular valorização do estoque a custo e a preço de venda', async () => {
      const prodId = crypto.randomUUID();
      await productRepository.create({
        id: prodId,
        name: 'Headset 7.1 Pro',
        productCode: 'HS-71',
        category: 'Áudio',
        purchasePriceCents: 8000,  // R$ 80,00
        salePriceCents: 15000,    // R$ 150,00
        stockQuantity: 10,
        minimumStock: 2,
        maximumStock: 20
      });

      const report = await ReportService.generateStockInventoryReport({ category: 'Áudio' });

      expect(report.title).toBe('Relatório de Posição de Estoque & Inventário Físico');
      const item = report.rows.find(r => r.id === prodId);
      expect(item).toBeDefined();
      expect(item.stockQuantity).toBe(10);
      expect(item.totalCostCents).toBe(80000);   // 10 * 8000 = R$ 800,00
      expect(item.totalSaleCents).toBe(150000);  // 10 * 15000 = R$ 1.500,00
      expect(item.potentialProfitCents).toBe(70000); // 150000 - 80000 = R$ 700,00
    });
  });

  describe('Demonstrativo de Resultado Gerencial (DRE)', () => {
    test('deve estruturar DRE com Receita Bruta, CMV e Resultado Bruto', async () => {
      const report = await ReportService.generateDREReport({ periodType: PERIOD_TYPES.LAST_30_DAYS });

      expect(report.title).toBe('Demonstrativo de Resultado do Exercício (DRE Gerencial)');
      expect(report.rows.length).toBe(5);
      expect(report.rows[0].description).toContain('RECEITA BRUTA');
      expect(report.rows[2].description).toContain('CUSTO DAS MERCADORIAS VENDIDAS');
      expect(report.rows[3].description).toContain('RESULTADO BRUTO');
    });
  });

  describe('Relatório de Curva ABC', () => {
    test('deve gerar Curva ABC de produtos classificados em Pareto A, B e C', async () => {
      const report = await ReportService.generateABCReport('products', { periodType: PERIOD_TYPES.LAST_30_DAYS });

      expect(report.title).toBe('Relatório de Curva ABC de Produtos (Faturamento Real)');
      expect(report.summary.countA).toBeDefined();
      expect(report.columns.length).toBe(7);
    });

    test('deve gerar Curva ABC de fornecedores por volume de compras', async () => {
      const report = await ReportService.generateABCReport('suppliers', { periodType: PERIOD_TYPES.LAST_30_DAYS });

      expect(report.title).toBe('Relatório de Curva ABC de Fornecedores (Volume Comprado)');
      expect(report.columns.find(c => c.key === 'name').label).toBe('Fornecedor');
    });
  });

  describe('Relatório de Movimentações (Kardex)', () => {
    test('deve consolidar histórico cronológico de movimentações', async () => {
      const prodId = crypto.randomUUID();
      await productRepository.create({ id: prodId, name: 'Produto Kardex', productCode: 'KDX-01' });

      await stockMovementRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        type: 'IN',
        quantity: 25,
        delta: 25,
        unitCostCents: 4000,
        reason: 'Entrada Inicial de Teste',
        date: new Date().toISOString()
      });

      const report = await ReportService.generateStockMovementsReport({ productId: prodId });

      expect(report.title).toBe('Relatório de Movimentações de Estoque (Auditoria / Kardex)');
      expect(report.rows.length).toBeGreaterThanOrEqual(1);
      const mov = report.rows.find(r => r.productCode === 'KDX-01');
      expect(mov).toBeDefined();
      expect(mov.deltaFormatted).toBe('+25');
    });
  });

  describe('Exportação CSV com Delimitador ";" e UTF-8 BOM', () => {
    test('deve gerar string CSV formatada com cabeçalho, BOM e escape seguro', () => {
      const columns = [
        { key: 'name', label: 'Nome do Produto' },
        { key: 'category', label: 'Categoria' },
        { key: 'price', label: 'Preço' }
      ];

      const rows = [
        { name: 'Cabo HDMI; Ultra', category: 'Cabos & Conectores', price: 'R$ 49,90' },
        { name: 'Mouse "Gamer" Pro', category: 'Periféricos', price: 'R$ 120,00' }
      ];

      const csv = ReportService.generateCSVString(columns, rows);

      // 1. Deve iniciar com o caractere BOM UTF-8 (\uFEFF)
      expect(csv.startsWith('\uFEFF')).toBe(true);

      // 2. Cabeçalho com delimitador ';'
      expect(csv).toContain('Nome do Produto;Categoria;Preço');

      // 3. Escape de campos com ponto e vírgula ou aspas
      expect(csv).toContain('"Cabo HDMI; Ultra";Cabos & Conectores;R$ 49,90');
      expect(csv).toContain('"Mouse ""Gamer"" Pro";Periféricos;R$ 120,00');
    });
  });

  describe('Documento Formal de Impressão HTML (@media print)', () => {
    test('deve gerar template HTML incluindo dados cadastrais da empresa no cabeçalho', () => {
      const companyProfile = {
        tradeName: 'MegaTech Eletrônicos',
        cnpj: '12.345.678/0001-90',
        phone: '(11) 98765-4321',
        email: 'contato@megatech.com'
      };

      const reportData = {
        title: 'Relatório Teste Impressão',
        period: { label: 'Últimos 30 dias' },
        columns: [{ key: 'name', label: 'Item' }],
        rows: [{ name: 'Teste' }]
      };

      const html = ReportService.generatePrintableHTML(reportData, companyProfile);

      expect(html).toContain('MegaTech Eletrônicos');
      expect(html).toContain('12.345.678/0001-90');
      expect(html).toContain('(11) 98765-4321');
      expect(html).toContain('Relatório Teste Impressão');
      expect(html).toContain('@page { size: A4 portrait;');
    });
  });
});
