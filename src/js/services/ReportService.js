import { saleRepository } from '../repositories/SaleRepository.js';
import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { stockMovementRepository } from '../repositories/StockMovementRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { StockService, STOCK_STATUS } from './StockService.js';
import { AnalyticsService, PERIOD_TYPES } from './AnalyticsService.js';
import { MoneyService } from '../domain/MoneyService.js';
import { MarginService } from '../domain/MarginService.js';

export const REPORT_TYPES = {
  SALES: 'sales',
  PURCHASES: 'purchases',
  STOCK_INVENTORY: 'stock_inventory',
  DRE: 'dre',
  ABC_PRODUCTS: 'abc_products',
  ABC_SUPPLIERS: 'abc_suppliers',
  STOCK_MOVEMENTS: 'stock_movements'
};

export class ReportService {
  /**
   * Converte uma matriz de colunas e linhas em arquivo CSV formatado com delimitador ';' e BOM UTF-8.
   * @param {Array<{ key: string, label: string }>} columns 
   * @param {Array<Object>} rows 
   * @param {string} [fileName] 
   * @returns {string} String CSV gerada
   */
  static generateCSVString(columns, rows) {
    const headerRow = columns.map(c => this._escapeCSVField(c.label)).join(';');
    const bodyRows = rows.map(row => {
      return columns.map(col => {
        const val = row[col.key];
        return this._escapeCSVField(val !== undefined && val !== null ? String(val) : '');
      }).join(';');
    });

    return '\uFEFF' + [headerRow, ...bodyRows].join('\r\n');
  }

  /**
   * Converte uma string com acentos em português para um Blob binário Windows-1252 (ANSI / ISO-8859-1).
   * Essa é a codificação padrão nativa que o Microsoft Excel do Windows exige para abrir
   * arquivos .csv diretamente com todas as palavras acentuadas (Preço, Margem %, Descrição, etc.) 100% corretas.
   * @param {string} str
   * @returns {Blob}
   */
  static _createExcelCompatibleCSVBlob(str) {
    const len = str.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const code = str.charCodeAt(i);
      if (code <= 255) {
        bytes[i] = code;
      } else {
        switch (code) {
          case 8211: bytes[i] = 0x96; break; // –
          case 8212: bytes[i] = 0x97; break; // —
          case 8216: bytes[i] = 0x91; break; // ‘
          case 8217: bytes[i] = 0x92; break; // ’
          case 8220: bytes[i] = 0x93; break; // “
          case 8221: bytes[i] = 0x94; break; // ”
          case 8226: bytes[i] = 0x95; break; // •
          case 8364: bytes[i] = 0x80; break; // €
          default: bytes[i] = 63; break;     // ?
        }
      }
    }
    return new Blob([bytes], { type: 'text/csv;charset=windows-1252;' });
  }

  /**
   * Dispara o salvamento/download de um arquivo CSV no navegador com suporte à janela "Salvar Como..." do Windows.
   * @param {Array<{ key: string, label: string }>} columns 
   * @param {Array<Object>} rows 
   * @param {string} fileName 
   */
  static async downloadCSV(columns, rows, fileName = 'relatorio.csv') {
    const csvContent = this.generateCSVString(columns, rows);
    const finalFileName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
    const blob = this._createExcelCompatibleCSVBlob(csvContent);

    // 1. Tenta abrir a caixa nativa "Salvar Como..." do Windows (permite escolher a pasta e renomear o arquivo)
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: finalFileName,
          types: [{
            description: 'Planilha CSV (*.csv)',
            accept: { 'text/csv': ['.csv'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // Se o usuário clicou em Cancelar na janela do Windows, encerra normalmente
        if (err.name === 'AbortError') return;
        console.warn('[ReportService] showSaveFilePicker indisponível ou rejeitado, usando fallback:', err);
      }
    }

    // 2. Fallback universal garantindo o nome do arquivo via Data URL (evita UUID do Chrome)
    const reader = new FileReader();
    reader.onload = () => {
      const a = document.createElement('a');
      a.href = reader.result;
      a.download = finalFileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 1500);
    };
    reader.readAsDataURL(blob);
  }

  /**
   * Escapa campos com ponto-e-vírgula, quebras de linha ou aspas para o formato CSV padrão.
   */
  static _escapeCSVField(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * 1. Relatório de Vendas (Comercial / PDV)
   * @param {Object} filters { periodType, customStartDate, customEndDate, paymentMethod, productId, includeCancelled }
   */
  static async generateSalesReport(filters = {}) {
    const period = AnalyticsService.getPeriodDateRange(
      filters.periodType || PERIOD_TYPES.LAST_30_DAYS,
      filters.customStartDate,
      filters.customEndDate
    );

    const sales = await saleRepository.list({
      startDate: period.startDate,
      endDate: period.endDate,
      paymentMethod: filters.paymentMethod || undefined,
      productId: filters.productId || undefined,
      includeCancelled: filters.includeCancelled === true
    });

    let totalRevenueCents = 0;
    let totalCogsCents = 0;
    let totalProfitCents = 0;
    let totalUnitsSold = 0;
    let activeSalesCount = 0;

    const rows = sales.map(s => {
      const isCancelled = !!s.cancelledAt;
      const rev = s.totalSaleCents || 0;
      const cost = s.totalCostCents || ((s.unitCostCents || 0) * (s.quantity || 0));
      const profit = s.profitCents || (rev - cost);

      if (!isCancelled) {
        totalRevenueCents += rev;
        totalCogsCents += cost;
        totalProfitCents += profit;
        totalUnitsSold += (s.quantity || 0);
        activeSalesCount++;
      }

      const dateFormatted = s.date ? new Date(s.date).toLocaleString('pt-BR') : '—';
      const marginFormatted = rev > 0 ? `${((profit / rev) * 100).toFixed(1)}%` : 'N/A';

      return {
        id: s.id,
        dateFormatted,
        dateIso: s.date,
        productName: s.productName || 'Produto',
        productCode: s.productCode || '',
        quantity: s.quantity || 0,
        unitSalePriceFormatted: MoneyService.format(s.unitSalePriceCents || 0),
        unitSalePriceCents: s.unitSalePriceCents || 0,
        totalSaleFormatted: MoneyService.format(rev),
        totalSaleCents: rev,
        unitCostFormatted: MoneyService.format(s.unitCostCents || 0),
        totalCostFormatted: MoneyService.format(cost),
        totalCostCents: cost,
        profitFormatted: MoneyService.format(profit),
        profitCents: profit,
        marginFormatted,
        paymentMethod: s.paymentMethod || 'Dinheiro',
        customerName: s.customerName || 'Consumidor Final',
        status: isCancelled ? 'CANCELADA' : 'CONCLUÍDA',
        isCancelled
      };
    });

    const averageTicketCents = activeSalesCount > 0 ? Math.round(totalRevenueCents / activeSalesCount) : 0;
    const averageMarginPercent = totalRevenueCents > 0 ? Number(((totalProfitCents / totalRevenueCents) * 100).toFixed(2)) : 0;

    return {
      title: 'Relatório de Vendas (Comercial / PDV)',
      period,
      summary: {
        totalSalesCount: activeSalesCount,
        cancelledCount: sales.length - activeSalesCount,
        totalUnitsSold,
        totalRevenueCents,
        totalRevenueFormatted: MoneyService.format(totalRevenueCents),
        totalCogsCents,
        totalCogsFormatted: MoneyService.format(totalCogsCents),
        totalProfitCents,
        totalProfitFormatted: MoneyService.format(totalProfitCents),
        averageTicketFormatted: MoneyService.format(averageTicketCents),
        averageMarginPercent: `${averageMarginPercent}%`
      },
      columns: [
        { key: 'dateFormatted', label: 'Data/Hora' },
        { key: 'id', label: 'ID Venda' },
        { key: 'productName', label: 'Produto' },
        { key: 'quantity', label: 'Qtd' },
        { key: 'unitSalePriceFormatted', label: 'Preço Unit.' },
        { key: 'totalSaleFormatted', label: 'Total Venda' },
        { key: 'totalCostFormatted', label: 'CMV (Custo)' },
        { key: 'profitFormatted', label: 'Lucro' },
        { key: 'marginFormatted', label: 'Margem %' },
        { key: 'paymentMethod', label: 'Pagamento' },
        { key: 'customerName', label: 'Cliente' },
        { key: 'status', label: 'Status' }
      ],
      rows
    };
  }

  /**
   * 2. Relatório de Compras e Fornecedores
   * @param {Object} filters { periodType, customStartDate, customEndDate, supplierId, productId, includeCancelled }
   */
  static async generatePurchasesReport(filters = {}) {
    const period = AnalyticsService.getPeriodDateRange(
      filters.periodType || PERIOD_TYPES.LAST_30_DAYS,
      filters.customStartDate,
      filters.customEndDate
    );

    const purchases = await purchaseRepository.list({
      startDate: period.startDate,
      endDate: period.endDate,
      supplierId: filters.supplierId || undefined,
      productId: filters.productId || undefined,
      includeCancelled: filters.includeCancelled === true
    });

    let totalSpentCents = 0;
    let totalUnitsPurchased = 0;
    let activePurchasesCount = 0;

    const rows = purchases.map(p => {
      const isCancelled = !!p.cancelledAt;
      const total = p.totalCostCents || 0;

      if (!isCancelled) {
        totalSpentCents += total;
        totalUnitsPurchased += (p.quantity || 0);
        activePurchasesCount++;
      }

      const dateFormatted = p.date ? new Date(p.date).toLocaleString('pt-BR') : '—';

      return {
        id: p.id,
        dateFormatted,
        dateIso: p.date,
        supplierName: p.supplierName || 'Fornecedor',
        productName: p.productName || 'Produto',
        quantity: p.quantity || 0,
        unitCostFormatted: MoneyService.format(p.unitCostCents || 0),
        totalCostFormatted: MoneyService.format(total),
        totalCostCents: total,
        invoiceNumber: p.invoiceNumber || '—',
        status: isCancelled ? 'ESTORNADA' : 'CONFIRMADA',
        isCancelled
      };
    });

    const averagePurchaseTicketCents = activePurchasesCount > 0 ? Math.round(totalSpentCents / activePurchasesCount) : 0;

    return {
      title: 'Relatório de Ordens de Compra e Fornecedores',
      period,
      summary: {
        totalPurchasesCount: activePurchasesCount,
        cancelledCount: purchases.length - activePurchasesCount,
        totalUnitsPurchased,
        totalSpentCents,
        totalSpentFormatted: MoneyService.format(totalSpentCents),
        averagePurchaseFormatted: MoneyService.format(averagePurchaseTicketCents)
      },
      columns: [
        { key: 'dateFormatted', label: 'Data/Hora' },
        { key: 'id', label: 'Ordem #' },
        { key: 'supplierName', label: 'Fornecedor' },
        { key: 'productName', label: 'Produto' },
        { key: 'quantity', label: 'Qtd Recebida' },
        { key: 'unitCostFormatted', label: 'Custo Unit.' },
        { key: 'totalCostFormatted', label: 'Total Comprado' },
        { key: 'invoiceNumber', label: 'Nota Fiscal' },
        { key: 'status', label: 'Status' }
      ],
      rows
    };
  }

  /**
   * 3. Relatório de Posição de Estoque & Inventário (Balanço Físico)
   * @param {Object} filters { category, status, search }
   */
  static async generateStockInventoryReport(filters = {}) {
    const products = await productRepository.list({});
    const activeProducts = products.filter(p => !p.deletedAt);

    let totalStockUnits = 0;
    let totalStockCostCents = 0;
    let totalStockSaleCents = 0;
    let outOfStockCount = 0;
    let lowStockCount = 0;

    let rows = activeProducts.map(p => {
      const stock = p.stockQuantity ?? 0;
      const min = p.minimumStock ?? 0;
      const max = p.maximumStock ?? 0;
      const cost = p.purchasePriceCents ?? 0;
      const sale = p.salePriceCents ?? 0;
      const totalCost = stock > 0 ? stock * cost : 0;
      const totalSale = stock > 0 ? stock * sale : 0;
      const potentialProfit = totalSale - totalCost;

      const status = StockService.computeStockStatus(stock, min, max);
      const statusLabels = {
        NORMAL: 'Normal',
        LOW_STOCK: 'Estoque Baixo',
        OUT_OF_STOCK: 'Esgotado',
        EXCESS_STOCK: 'Excesso'
      };
      const statusTranslated = statusLabels[status] || status;

      if (stock > 0) {
        totalStockUnits += stock;
        totalStockCostCents += totalCost;
        totalStockSaleCents += totalSale;
      }

      if (status === STOCK_STATUS.OUT_OF_STOCK) outOfStockCount++;
      else if (status === STOCK_STATUS.LOW_STOCK) lowStockCount++;

      return {
        id: p.id,
        name: p.name,
        productCode: p.productCode || '—',
        internalCode: p.internalCode || '—',
        category: p.category || 'Geral',
        stockQuantity: stock,
        minimumStock: min,
        maximumStock: max || '—',
        status: statusTranslated,
        statusCode: status,
        unitCostFormatted: MoneyService.format(cost),
        totalCostFormatted: MoneyService.format(totalCost),
        totalCostCents: totalCost,
        unitSaleFormatted: MoneyService.format(sale),
        totalSaleFormatted: MoneyService.format(totalSale),
        totalSaleCents: totalSale,
        potentialProfitFormatted: MoneyService.format(potentialProfit),
        potentialProfitCents: potentialProfit
      };
    });

    // Aplicação dos filtros
    if (filters.status) {
      rows = rows.filter(r => r.statusCode === filters.status || r.status === filters.status);
    }
    if (filters.category) {
      rows = rows.filter(r => r.category === filters.category);
    }

    const totalPotentialProfitCents = totalStockSaleCents - totalStockCostCents;

    return {
      title: 'Relatório de Posição de Estoque & Inventário Físico',
      summary: {
        totalProductsCount: activeProducts.length,
        totalStockUnits,
        totalStockCostFormatted: MoneyService.format(totalStockCostCents),
        totalStockSaleFormatted: MoneyService.format(totalStockSaleCents),
        totalPotentialProfitFormatted: MoneyService.format(totalPotentialProfitCents),
        outOfStockCount,
        lowStockCount
      },
      columns: [
        { key: 'productCode', label: 'SKU' },
        { key: 'name', label: 'Produto' },
        { key: 'category', label: 'Categoria' },
        { key: 'stockQuantity', label: 'Saldo Físico' },
        { key: 'minimumStock', label: 'Est. Mín.' },
        { key: 'status', label: 'Status' },
        { key: 'unitCostFormatted', label: 'Custo Unit.' },
        { key: 'totalCostFormatted', label: 'Total a Custo' },
        { key: 'unitSaleFormatted', label: 'Preço Venda' },
        { key: 'totalSaleFormatted', label: 'Total a Venda' },
        { key: 'potentialProfitFormatted', label: 'Lucro Potencial' }
      ],
      rows
    };
  }

  /**
   * 4. Demonstrativo de Resultado do Exercício (DRE Gerencial)
   * @param {Object} filters { periodType, customStartDate, customEndDate }
   */
  static async generateDREReport(filters = {}) {
    const period = AnalyticsService.getPeriodDateRange(
      filters.periodType || PERIOD_TYPES.LAST_30_DAYS,
      filters.customStartDate,
      filters.customEndDate
    );

    const [sales, purchases] = await Promise.all([
      saleRepository.list({ startDate: period.startDate, endDate: period.endDate, includeCancelled: false }),
      purchaseRepository.list({ startDate: period.startDate, endDate: period.endDate, includeCancelled: false })
    ]);

    const financial = AnalyticsService.calculateFinancialMetrics(sales, purchases);

    const dreItems = [
      {
        code: '1',
        description: '(+) RECEITA BRUTA DE VENDAS',
        valueCents: financial.revenueCents,
        valueFormatted: MoneyService.format(financial.revenueCents),
        percent: '100.0%',
        type: 'HEADER'
      },
      {
        code: '1.1',
        description: 'Vendas Comerciais no Período',
        valueCents: financial.revenueCents,
        valueFormatted: MoneyService.format(financial.revenueCents),
        percent: '100.0%',
        type: 'DETAIL'
      },
      {
        code: '2',
        description: '(-) CUSTO DAS MERCADORIAS VENDIDAS (CMV)',
        valueCents: -financial.cogsCents,
        valueFormatted: `(${MoneyService.format(financial.cogsCents)})`,
        percent: financial.revenueCents > 0 ? `${((financial.cogsCents / financial.revenueCents) * 100).toFixed(1)}%` : '0%',
        type: 'DEDUCTION'
      },
      {
        code: '3',
        description: '(=) RESULTADO BRUTO (LUCRO BRUTO)',
        valueCents: financial.grossProfitCents,
        valueFormatted: MoneyService.format(financial.grossProfitCents),
        percent: financial.grossMarginPercent !== null ? `${financial.grossMarginPercent}%` : 'N/A',
        type: 'TOTAL'
      },
      {
        code: '4',
        description: 'OUTRAS OPERAÇÕES: Compras Realizadas com Fornecedores',
        valueCents: financial.totalPurchasesSpentCents,
        valueFormatted: MoneyService.format(financial.totalPurchasesSpentCents),
        percent: '—',
        type: 'INFO'
      }
    ];

    return {
      title: 'Demonstrativo de Resultado do Exercício (DRE Gerencial)',
      period,
      financial,
      summary: {
        revenueFormatted: MoneyService.format(financial.revenueCents),
        cogsFormatted: MoneyService.format(financial.cogsCents),
        grossProfitFormatted: MoneyService.format(financial.grossProfitCents),
        grossMarginPercent: financial.grossMarginPercent !== null ? `${financial.grossMarginPercent}%` : 'N/A',
        markupPercent: financial.markupPercent !== null ? `${financial.markupPercent}%` : 'N/A'
      },
      columns: [
        { key: 'code', label: 'Item' },
        { key: 'description', label: 'Descrição' },
        { key: 'valueFormatted', label: 'Valor (R$)' },
        { key: 'percent', label: '% da Receita' }
      ],
      rows: dreItems
    };
  }

  /**
   * 5. Relatório de Curva ABC (Produtos ou Fornecedores)
   */
  static async generateABCReport(type = 'products', filters = {}) {
    const period = AnalyticsService.getPeriodDateRange(
      filters.periodType || PERIOD_TYPES.LAST_30_DAYS,
      filters.customStartDate,
      filters.customEndDate
    );

    if (type === 'suppliers') {
      const [purchases, suppliers] = await Promise.all([
        purchaseRepository.list({ startDate: period.startDate, endDate: period.endDate, includeCancelled: false }),
        supplierRepository.list({})
      ]);

      const analysis = AnalyticsService.calculateSupplierAnalysis(purchases, suppliers);
      const rows = analysis.supplierABC.items.map(item => ({
        classification: `CLASSE ${item.classification}`,
        name: item.supplierName,
        ordersCount: item.ordersCount,
        units: item.unitsPurchased,
        totalSpentFormatted: MoneyService.format(item.totalSpentCents),
        sharePercent: `${item.sharePercent}%`,
        accumulatedPercent: `${item.accumulatedPercent}%`
      }));

      return {
        title: 'Relatório de Curva ABC de Fornecedores (Volume Comprado)',
        period,
        summary: {
          totalSpentFormatted: MoneyService.format(analysis.supplierABC.summary.totalSpentCents),
          countA: analysis.supplierABC.summary.countA,
          countB: analysis.supplierABC.summary.countB,
          countC: analysis.supplierABC.summary.countC
        },
        columns: [
          { key: 'classification', label: 'Classe' },
          { key: 'name', label: 'Fornecedor' },
          { key: 'ordersCount', label: 'Ordens' },
          { key: 'units', label: 'Itens' },
          { key: 'totalSpentFormatted', label: 'Total Comprado' },
          { key: 'sharePercent', label: '% Volume' },
          { key: 'accumulatedPercent', label: '% Acumulado' }
        ],
        rows
      };
    } else {
      const [sales, products] = await Promise.all([
        saleRepository.list({ startDate: period.startDate, endDate: period.endDate, includeCancelled: false }),
        productRepository.list({})
      ]);

      const abc = AnalyticsService.calculateProductABC(sales, products);
      const rows = abc.items.map(item => ({
        classification: `CLASSE ${item.classification}`,
        productCode: item.productCode || '—',
        name: item.name,
        category: item.category || 'Geral',
        revenueFormatted: MoneyService.format(item.revenueCents),
        sharePercent: `${item.sharePercent}%`,
        accumulatedPercent: `${item.accumulatedPercent}%`
      }));

      return {
        title: 'Relatório de Curva ABC de Produtos (Faturamento Real)',
        period,
        summary: {
          totalRevenueFormatted: MoneyService.format(abc.summary.totalRevenueCents),
          countA: abc.summary.countA,
          countB: abc.summary.countB,
          countC: abc.summary.countC
        },
        columns: [
          { key: 'classification', label: 'Classe' },
          { key: 'productCode', label: 'SKU' },
          { key: 'name', label: 'Produto' },
          { key: 'category', label: 'Categoria' },
          { key: 'revenueFormatted', label: 'Faturamento' },
          { key: 'sharePercent', label: '% Participação' },
          { key: 'accumulatedPercent', label: '% Acumulado' }
        ],
        rows
      };
    }
  }

  /**
   * 6. Relatório de Movimentações de Estoque (Kardex / Auditoria)
   */
  static async generateStockMovementsReport(filters = {}) {
    const period = AnalyticsService.getPeriodDateRange(
      filters.periodType || PERIOD_TYPES.LAST_30_DAYS,
      filters.customStartDate,
      filters.customEndDate
    );

    const movements = await stockMovementRepository.listMovements({
      startDate: period.startDate,
      endDate: period.endDate,
      type: filters.movementType || undefined,
      productId: filters.productId || undefined
    });

    const products = await productRepository.list({});
    const prodMap = new Map(products.map(p => [p.id, p]));

    const typeLabels = {
      IN: 'Entrada',
      OUT: 'Saída',
      PURCHASE: 'Compra',
      SALE: 'Venda',
      ADJUSTMENT: 'Ajuste / Balanço',
      RETURN: 'Devolução',
      LOSS: 'Perda / Avaria'
    };

    const rows = movements.map(m => {
      const prod = prodMap.get(m.productId);
      const dateFormatted = m.date ? new Date(m.date).toLocaleString('pt-BR') : '—';
      const deltaSign = (m.delta > 0) ? `+${m.delta}` : `${m.delta || m.quantity}`;
      const typeTranslated = typeLabels[m.type] || m.type;

      return {
        id: m.id,
        dateFormatted,
        productName: prod ? prod.name : 'Produto Desconhecido',
        productCode: prod ? prod.productCode : '—',
        type: typeTranslated,
        quantity: m.quantity,
        deltaFormatted: deltaSign,
        costFormatted: m.unitCostCents ? MoneyService.format(m.unitCostCents) : '—',
        reason: m.reason || 'Movimentação operacional'
      };
    });

    return {
      title: 'Relatório de Movimentações de Estoque (Auditoria / Kardex)',
      period,
      summary: {
        totalMovementsCount: movements.length
      },
      columns: [
        { key: 'dateFormatted', label: 'Data/Hora' },
        { key: 'type', label: 'Tipo' },
        { key: 'productCode', label: 'SKU' },
        { key: 'productName', label: 'Produto' },
        { key: 'deltaFormatted', label: 'Variação' },
        { key: 'costFormatted', label: 'Custo Unit.' },
        { key: 'reason', label: 'Motivo / Documento' }
      ],
      rows
    };
  }

  /**
   * Monta o documento formal HTML com cabeçalho da empresa para impressão (@media print / PDF).
   */
  static generatePrintableHTML(reportData, companyProfile = null) {
    const cp = companyProfile || {};
    const emittedAt = new Date().toLocaleString('pt-BR');

    const headerHTML = `
      <div class="print-header">
        <div class="company-info">
          <h2>${cp.tradeName || cp.corporateName || 'GestãoPro — Sistema Comercial'}</h2>
          ${cp.cnpj ? `<p><strong>CNPJ/CPF:</strong> ${cp.cnpj}</p>` : ''}
          ${cp.phone ? `<p><strong>Telefone:</strong> ${cp.phone}</p>` : ''}
          ${cp.email ? `<p><strong>Email:</strong> ${cp.email}</p>` : ''}
          ${cp.address ? `<p><strong>Endereço:</strong> ${cp.address}</p>` : ''}
        </div>
        <div class="report-meta">
          <h1>${reportData.title}</h1>
          ${reportData.period ? `<p><strong>Período:</strong> ${reportData.period.label}</p>` : ''}
          <p><strong>Emissão:</strong> ${emittedAt}</p>
        </div>
      </div>
    `;

    const tableHTML = `
      <table class="print-table">
        <thead>
          <tr>
            ${reportData.columns.map(c => `<th>${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${reportData.rows.map(row => `
            <tr>
              ${reportData.columns.map(col => `<td>${row[col.key] !== undefined && row[col.key] !== null ? row[col.key] : ''}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>${reportData.title} — GestãoPro</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; font-size: 11px; margin: 0; padding: 20px; }
          .print-header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
          .company-info h2 { margin: 0 0 4px 0; font-size: 16px; color: #0f172a; }
          .company-info p { margin: 2px 0; font-size: 10px; color: #475569; }
          .report-meta { text-align: right; }
          .report-meta h1 { margin: 0 0 4px 0; font-size: 14px; color: #1e40af; }
          .report-meta p { margin: 2px 0; font-size: 10px; color: #475569; }
          .print-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .print-table th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 6px 8px; border-bottom: 1px solid #cbd5e1; font-size: 10px; text-transform: uppercase; }
          .print-table td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; font-size: 10px; }
          .print-table tr:nth-child(even) { background-color: #f8fafc; }
          .footer { margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 8px; text-align: center; font-size: 9px; color: #94a3b8; }
        </style>
      </head>
      <body>
        ${headerHTML}
        ${tableHTML}
        <div class="footer">
          GestãoPro — Sistema de Gestão Comercial e Estoque Offline · Documento emitido em ${emittedAt}
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Executa a impressão direta do relatório abrindo a janela de impressão.
   */
  static printReport(reportData, companyProfile = null) {
    const html = this.generatePrintableHTML(reportData, companyProfile);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 350);
    }
  }
}
