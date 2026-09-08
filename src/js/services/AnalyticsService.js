import { saleRepository } from '../repositories/SaleRepository.js';
import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { StockService, STOCK_STATUS } from './StockService.js';
import { MarginService } from '../domain/MarginService.js';

export const PERIOD_TYPES = {
  TODAY: 'today',
  LAST_7_DAYS: '7d',
  LAST_30_DAYS: '30d',
  LAST_90_DAYS: '90d',
  LAST_12_MONTHS: '12m',
  CUSTOM: 'custom'
};

export const VELOCITY_CLASSIFICATION = {
  RAPIDA: 'RAPIDA',
  NORMAL: 'NORMAL',
  LENTA: 'LENTA',
  PARADA: 'PARADA',
  INSUFICIENTE: 'INSUFICIENTE'
};

export class AnalyticsService {
  /**
   * Converte um tipo de período em datas ISO de início e fim com base no fuso horário local.
   * @param {string} periodType 
   * @param {string} [customStartDate] 'YYYY-MM-DD'
   * @param {string} [customEndDate] 'YYYY-MM-DD'
   * @returns {{ startDate: string, endDate: string, periodDays: number, label: string }}
   */
  static getPeriodDateRange(periodType = PERIOD_TYPES.LAST_30_DAYS, customStartDate = null, customEndDate = null) {
    const now = new Date();
    
    // Início de hoje no fuso local
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    // Fim de hoje no fuso local
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let startDate = new Date(startOfToday);
    let endDate = new Date(endOfToday);
    let label = 'Últimos 30 dias';

    switch (periodType) {
      case PERIOD_TYPES.TODAY:
        startDate = new Date(startOfToday);
        label = 'Hoje';
        break;

      case PERIOD_TYPES.LAST_7_DAYS:
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - 6); // 7 dias incluindo hoje
        label = 'Últimos 7 dias';
        break;

      case PERIOD_TYPES.LAST_30_DAYS:
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - 29); // 30 dias incluindo hoje
        label = 'Últimos 30 dias';
        break;

      case PERIOD_TYPES.LAST_90_DAYS:
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - 89); // 90 dias incluindo hoje
        label = 'Últimos 90 dias';
        break;

      case PERIOD_TYPES.LAST_12_MONTHS:
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - 364); // 12 meses (~365 dias)
        label = 'Últimos 12 meses';
        break;

      case PERIOD_TYPES.CUSTOM:
        if (customStartDate) {
          const [y, m, d] = customStartDate.split('-').map(Number);
          startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
        } else {
          startDate = new Date(startOfToday);
          startDate.setDate(startDate.getDate() - 29);
        }

        if (customEndDate) {
          const [y, m, d] = customEndDate.split('-').map(Number);
          endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
        } else {
          endDate = new Date(endOfToday);
        }
        
        label = `Personalizado (${startDate.toLocaleDateString('pt-BR')} a ${endDate.toLocaleDateString('pt-BR')})`;
        break;

      default:
        startDate = new Date(startOfToday);
        startDate.setDate(startDate.getDate() - 29);
        label = 'Últimos 30 dias';
        break;
    }

    // Calcular diferença de dias (mínimo 1 dia para evitar divisão por zero)
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const periodDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateObj: startDate,
      endDateObj: endDate,
      periodDays,
      label
    };
  }

  /**
   * Consolida todas as análises de negócio a partir dos registros reais do sistema.
   * @param {Object} options { periodType, customStartDate, customEndDate }
   */
  static async getDashboardAnalytics(options = {}) {
    const period = this.getPeriodDateRange(
      options.periodType || PERIOD_TYPES.LAST_30_DAYS,
      options.customStartDate,
      options.customEndDate
    );

    // 1. Carregamento em paralelo via repositórios indexados
    const [sales, purchases, products, suppliers] = await Promise.all([
      saleRepository.list({
        startDate: period.startDate,
        endDate: period.endDate,
        includeCancelled: false
      }),
      purchaseRepository.list({
        startDate: period.startDate,
        endDate: period.endDate,
        includeCancelled: false
      }),
      productRepository.list({}),
      supplierRepository.list({})
    ]);

    // Filtrar apenas produtos e fornecedores não excluídos (soft delete check)
    const activeProducts = products.filter(p => !p.deletedAt && p.isActive !== false);
    const activeSuppliers = suppliers.filter(s => !s.deletedAt);

    // 2. Cálculos Financeiros (Faturamento, CMV, Lucro Bruto, Margem, Compras)
    const financial = this.calculateFinancialMetrics(sales, purchases);

    // 3. Valorização e Status do Estoque
    const stockValuation = this.calculateStockValuation(activeProducts, financial.cogsCents);

    // 4. Desempenho e Velocidade de Produtos (Top, Bottom, Parados, Run Rate)
    const productPerformance = this.calculateProductPerformance(sales, activeProducts, period.periodDays);

    // 5. Curva ABC de Produtos (Pareto 80/15/5 baseado em faturamento real)
    const productABC = this.calculateProductABC(sales, activeProducts);

    // 6. Análise e Curva ABC de Fornecedores (compras reais realizadas)
    const supplierAnalysis = this.calculateSupplierAnalysis(purchases, activeSuppliers);

    // 7. Análise por Categoria
    const categoryAnalysis = this.calculateCategoryAnalysis(sales, activeProducts);

    // 8. Série Temporal para Gráficos
    const timelineSeries = this.generateTimelineSeries(sales, purchases, period.startDateObj, period.endDateObj, period.periodDays);

    return {
      period,
      financial,
      stockValuation,
      productPerformance,
      productABC,
      supplierAnalysis,
      categoryAnalysis,
      timelineSeries,
      hasData: sales.length > 0 || purchases.length > 0 || activeProducts.length > 0
    };
  }

  /**
   * Calcula as métricas financeiras essenciais no período.
   * CMV = soma dos custos unitários históricos imutáveis das vendas (unitCostCents * quantity).
   * Faturamento = soma de totalSaleCents das vendas ativas.
   * Lucro Bruto = Faturamento - CMV.
   */
  static calculateFinancialMetrics(sales, purchases) {
    let revenueCents = 0;
    let cogsCents = 0; // Custo das Mercadorias Vendidas (CMV)
    let totalUnitsSold = 0;
    let grossProfitCents = 0;

    for (const sale of sales) {
      const saleRev = sale.totalSaleCents || 0;
      // Usar totalCostCents gravado na venda ou fallback para unitCostCents * quantity
      const saleCost = sale.totalCostCents !== undefined && sale.totalCostCents !== null
        ? sale.totalCostCents
        : (sale.unitCostCents || 0) * (sale.quantity || 0);

      const saleProfit = sale.profitCents !== undefined && sale.profitCents !== null
        ? sale.profitCents
        : (saleRev - saleCost);

      revenueCents += saleRev;
      cogsCents += saleCost;
      grossProfitCents += saleProfit;
      totalUnitsSold += (sale.quantity || 0);
    }

    const totalSalesCount = sales.length;
    const averageTicketCents = totalSalesCount > 0 ? Math.round(revenueCents / totalSalesCount) : 0;

    // Tratamento de faturamento zero para evitar divisão por zero
    let grossMarginPercent = null;
    let markupPercent = null;

    if (revenueCents > 0) {
      grossMarginPercent = Number(((grossProfitCents / revenueCents) * 100).toFixed(2));
    }

    if (cogsCents > 0) {
      markupPercent = Number(((grossProfitCents / cogsCents) * 100).toFixed(2));
    }

    // Consolidação de compras no período
    let totalPurchasesSpentCents = 0;
    let totalUnitsPurchased = 0;

    for (const purchase of purchases) {
      totalPurchasesSpentCents += (purchase.totalCostCents || 0);
      totalUnitsPurchased += (purchase.quantity || 0);
    }

    const totalPurchasesCount = purchases.length;
    const averagePurchaseTicketCents = totalPurchasesCount > 0 ? Math.round(totalPurchasesSpentCents / totalPurchasesCount) : 0;

    return {
      revenueCents,
      cogsCents,
      grossProfitCents,
      grossMarginPercent,
      markupPercent,
      totalSalesCount,
      totalUnitsSold,
      averageTicketCents,
      totalPurchasesCount,
      totalPurchasesSpentCents,
      totalUnitsPurchased,
      averagePurchaseTicketCents
    };
  }

  /**
   * Calcula o valor do estoque físico atual e giro de estoque.
   * Valor do estoque a custo = soma(Product.stockQuantity * Product.purchasePriceCents).
   * Valor do estoque a venda = soma(Product.stockQuantity * Product.salePriceCents).
   * Giro de Estoque = CMV / Valor do Estoque a Custo.
   */
  static calculateStockValuation(products, cogsCents = 0) {
    let totalStockUnits = 0;
    let stockCostValueCents = 0;
    let stockSaleValueCents = 0;
    let outOfStockCount = 0;
    let lowStockCount = 0;
    let normalStockCount = 0;
    let excessStockCount = 0;

    for (const p of products) {
      const stock = p.stockQuantity ?? 0;
      const min = p.minimumStock ?? 0;
      const max = p.maximumStock ?? 0;
      const purchasePrice = p.purchasePriceCents ?? 0;
      const salePrice = p.salePriceCents ?? 0;

      if (stock > 0) {
        totalStockUnits += stock;
        stockCostValueCents += stock * purchasePrice;
        stockSaleValueCents += stock * salePrice;
      }

      const status = StockService.computeStockStatus(stock, min, max);
      if (status === STOCK_STATUS.OUT_OF_STOCK) outOfStockCount++;
      else if (status === STOCK_STATUS.LOW_STOCK) lowStockCount++;
      else if (status === STOCK_STATUS.EXCESS_STOCK) excessStockCount++;
      else normalStockCount++;
    }

    const potentialProfitCents = stockSaleValueCents - stockCostValueCents;

    // Giro de Estoque: CMV do período dividido pelo valor do estoque atual a custo
    let turnoverRatio = null;
    let turnoverDays = null;
    if (stockCostValueCents > 0 && cogsCents > 0) {
      turnoverRatio = Number((cogsCents / stockCostValueCents).toFixed(2));
      if (turnoverRatio > 0) {
        turnoverDays = Math.round(365 / turnoverRatio);
      }
    }

    return {
      totalProductsCount: products.length,
      totalStockUnits,
      stockCostValueCents,
      stockSaleValueCents,
      potentialProfitCents,
      turnoverRatio,
      turnoverDays,
      statusCounts: {
        outOfStock: outOfStockCount,
        lowStock: lowStockCount,
        normalStock: normalStockCount,
        excessStock: excessStockCount
      }
    };
  }

  /**
   * Calcula métricas de desempenho de produtos:
   * Top Sellers, Bottom Sellers, Produtos Parados e Velocidade de Venda (Run Rate diário).
   */
  static calculateProductPerformance(sales, products, periodDays = 30) {
    const productSalesMap = new Map();

    // 1. Mapear vendas por produto
    for (const sale of sales) {
      if (!productSalesMap.has(sale.productId)) {
        productSalesMap.set(sale.productId, {
          productId: sale.productId,
          productName: sale.productName || 'Produto',
          productCode: sale.productCode || '',
          unitsSold: 0,
          revenueCents: 0,
          costCents: 0,
          profitCents: 0,
          salesCount: 0
        });
      }

      const item = productSalesMap.get(sale.productId);
      item.unitsSold += (sale.quantity || 0);
      item.revenueCents += (sale.totalSaleCents || 0);
      item.costCents += (sale.totalCostCents || (sale.unitCostCents || 0) * (sale.quantity || 0));
      item.profitCents += (sale.profitCents || 0);
      item.salesCount += 1;
    }

    // 2. Mapear todos os produtos do catálogo com cálculos de velocidade
    const allEnrichedProducts = products.map(p => {
      const saleInfo = productSalesMap.get(p.id) || {
        productId: p.id,
        productName: p.name,
        productCode: p.productCode || '',
        unitsSold: 0,
        revenueCents: 0,
        costCents: 0,
        profitCents: 0,
        salesCount: 0
      };

      const stock = p.stockQuantity ?? 0;
      const unitsSold = saleInfo.unitsSold;
      const dailySalesRate = periodDays > 0 ? Number((unitsSold / periodDays).toFixed(2)) : 0;

      // Cobertura de estoque em dias: estoqueAtual / velocidadeDiaria
      let coverageDays = null;
      if (dailySalesRate > 0 && stock > 0) {
        coverageDays = Math.round(stock / dailySalesRate);
      } else if (stock === 0) {
        coverageDays = 0;
      }

      // Classificação de Velocidade
      let velocity = VELOCITY_CLASSIFICATION.PARADA;
      if (unitsSold > 0) {
        if (dailySalesRate >= 1.0) {
          velocity = VELOCITY_CLASSIFICATION.RAPIDA;
        } else if (dailySalesRate >= 0.2) {
          velocity = VELOCITY_CLASSIFICATION.NORMAL;
        } else {
          velocity = VELOCITY_CLASSIFICATION.LENTA;
        }
      }

      const marginPercent = saleInfo.revenueCents > 0
        ? Number(((saleInfo.profitCents / saleInfo.revenueCents) * 100).toFixed(2))
        : null;

      return {
        id: p.id,
        name: p.name,
        productCode: p.productCode || '',
        category: p.category || 'Sem Categoria',
        brand: p.brand || '',
        stockQuantity: stock,
        purchasePriceCents: p.purchasePriceCents || 0,
        salePriceCents: p.salePriceCents || 0,
        unitsSold,
        revenueCents: saleInfo.revenueCents,
        profitCents: saleInfo.profitCents,
        salesCount: saleInfo.salesCount,
        dailySalesRate,
        coverageDays,
        velocity,
        marginPercent,
        hasSales: unitsSold > 0
      };
    });

    // Top Sellers (ordenados por faturamento decrescente)
    const topSellers = allEnrichedProducts
      .filter(p => p.unitsSold > 0)
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 10);

    // Bottom Sellers (produtos com vendas, mas menor quantidade vendida)
    const bottomSellers = allEnrichedProducts
      .filter(p => p.unitsSold > 0)
      .sort((a, b) => a.unitsSold - b.unitsSold)
      .slice(0, 5);

    // Produtos Parados (em estoque > 0, mas sem nenhuma venda no período)
    const idleProducts = allEnrichedProducts
      .filter(p => p.stockQuantity > 0 && p.unitsSold === 0)
      .map(p => ({
        ...p,
        idleCapitalCents: p.stockQuantity * p.purchasePriceCents
      }))
      .sort((a, b) => b.idleCapitalCents - a.idleCapitalCents);

    const totalIdleCapitalCents = idleProducts.reduce((sum, p) => sum + p.idleCapitalCents, 0);

    return {
      allProductsPerformance: allEnrichedProducts,
      topSellers,
      bottomSellers,
      idleProducts: idleProducts.slice(0, 10),
      idleProductsCount: idleProducts.length,
      totalIdleCapitalCents
    };
  }

  /**
   * Calcula a Curva ABC de Produtos (Princípio de Pareto) com base no faturamento real no período.
   * Regra Matemática:
   * Classe A: até ~80% do faturamento acumulado.
   * Classe B: > 80% até ~95% do faturamento acumulado.
   * Classe C: > 95% até 100% do faturamento acumulado.
   * Produtos sem vendas NÃO são classificados em A ou B.
   */
  static calculateProductABC(sales, products) {
    // 1. Somar faturamento por produto
    const productRevMap = new Map();
    let totalRevenueCents = 0;

    for (const sale of sales) {
      const rev = sale.totalSaleCents || 0;
      totalRevenueCents += rev;
      productRevMap.set(sale.productId, (productRevMap.get(sale.productId) || 0) + rev);
    }

    if (totalRevenueCents === 0 || productRevMap.size === 0) {
      return {
        classA: [],
        classB: [],
        classC: [],
        summary: {
          countA: 0,
          countB: 0,
          countC: 0,
          revenueA: 0,
          revenueB: 0,
          revenueC: 0,
          totalRevenueCents: 0
        },
        items: []
      };
    }

    // 2. Criar lista de produtos vendidos e ordenar por faturamento decrescente
    const productObjMap = new Map(products.map(p => [p.id, p]));
    const soldProducts = [];

    for (const [productId, revCents] of productRevMap.entries()) {
      const prod = productObjMap.get(productId);
      soldProducts.push({
        id: productId,
        name: prod ? prod.name : 'Produto Desconhecido',
        productCode: prod ? prod.productCode : '',
        category: prod ? prod.category : '',
        revenueCents: revCents,
        sharePercent: Number(((revCents / totalRevenueCents) * 100).toFixed(2))
      });
    }

    soldProducts.sort((a, b) => b.revenueCents - a.revenueCents);

    // 3. Classificar A, B, C com base no percentual acumulado
    let accumulatedCents = 0;
    const classA = [];
    const classB = [];
    const classC = [];
    const items = [];

    for (const item of soldProducts) {
      accumulatedCents += item.revenueCents;
      const accumulatedPercent = Number(((accumulatedCents / totalRevenueCents) * 100).toFixed(2));

      let classification = 'C';
      if (accumulatedPercent <= 80.0 || classA.length === 0) {
        classification = 'A';
        classA.push({ ...item, accumulatedPercent, classification });
      } else if (accumulatedPercent <= 95.0) {
        classification = 'B';
        classB.push({ ...item, accumulatedPercent, classification });
      } else {
        classification = 'C';
        classC.push({ ...item, accumulatedPercent, classification });
      }

      items.push({ ...item, accumulatedPercent, classification });
    }

    const revenueA = classA.reduce((sum, i) => sum + i.revenueCents, 0);
    const revenueB = classB.reduce((sum, i) => sum + i.revenueCents, 0);
    const revenueC = classC.reduce((sum, i) => sum + i.revenueCents, 0);

    return {
      classA,
      classB,
      classC,
      summary: {
        countA: classA.length,
        countB: classB.length,
        countC: classC.length,
        percentA: Number(((revenueA / totalRevenueCents) * 100).toFixed(1)),
        percentB: Number(((revenueB / totalRevenueCents) * 100).toFixed(1)),
        percentC: Number(((revenueC / totalRevenueCents) * 100).toFixed(1)),
        revenueA,
        revenueB,
        revenueC,
        totalRevenueCents
      },
      items
    };
  }

  /**
   * Analisa as compras reais realizadas com fornecedores e calcula a Curva ABC de Fornecedores.
   */
  static calculateSupplierAnalysis(purchases, suppliers) {
    const supplierPurchasesMap = new Map();
    let totalPurchasesSpentCents = 0;

    for (const p of purchases) {
      const sId = p.supplierId || 'desconhecido';
      const cost = p.totalCostCents || 0;
      totalPurchasesSpentCents += cost;

      if (!supplierPurchasesMap.has(sId)) {
        supplierPurchasesMap.set(sId, {
          supplierId: sId,
          supplierName: p.supplierName || 'Fornecedor',
          totalSpentCents: 0,
          ordersCount: 0,
          unitsPurchased: 0
        });
      }

      const item = supplierPurchasesMap.get(sId);
      item.totalSpentCents += cost;
      item.ordersCount += 1;
      item.unitsPurchased += (p.quantity || 0);
    }

    if (totalPurchasesSpentCents === 0 || supplierPurchasesMap.size === 0) {
      return {
        topSuppliers: [],
        supplierABC: {
          classA: [],
          classB: [],
          classC: [],
          items: [],
          summary: { countA: 0, countB: 0, countC: 0, totalSpentCents: 0 }
        }
      };
    }

    const supplierList = Array.from(supplierPurchasesMap.values())
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents);

    // Calcular Curva ABC de Fornecedores
    let accumulatedCents = 0;
    const classA = [];
    const classB = [];
    const classC = [];
    const enrichedList = [];

    for (const item of supplierList) {
      accumulatedCents += item.totalSpentCents;
      const sharePercent = Number(((item.totalSpentCents / totalPurchasesSpentCents) * 100).toFixed(2));
      const accumulatedPercent = Number(((accumulatedCents / totalPurchasesSpentCents) * 100).toFixed(2));
      const prevAccumulated = accumulatedPercent - sharePercent;

      let classification = 'C';
      if (accumulatedPercent <= 80.0 || classA.length === 0) {
        classification = 'A';
        classA.push({ ...item, sharePercent, accumulatedPercent, classification });
      } else if (accumulatedPercent <= 95.0) {
        classification = 'B';
        classB.push({ ...item, sharePercent, accumulatedPercent, classification });
      } else {
        classC.push({ ...item, sharePercent, accumulatedPercent, classification });
      }

      enrichedList.push({ ...item, sharePercent, accumulatedPercent, classification });
    }

    return {
      topSuppliers: enrichedList.slice(0, 5),
      supplierABC: {
        classA,
        classB,
        classC,
        items: enrichedList,
        summary: {
          countA: classA.length,
          countB: classB.length,
          countC: classC.length,
          totalSpentCents: totalPurchasesSpentCents
        }
      }
    };
  }

  /**
   * Consolida métricas de vendas e estoque agrupadas por categoria.
   */
  static calculateCategoryAnalysis(sales, products) {
    const categoryMap = new Map();
    let totalRevenueCents = 0;

    // 1. Mapear produtos por categoria
    for (const prod of products) {
      const cat = (prod.category && prod.category.trim()) ? prod.category.trim() : 'Geral';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, {
          categoryName: cat,
          revenueCents: 0,
          cogsCents: 0,
          profitCents: 0,
          unitsSold: 0,
          salesCount: 0,
          productsCount: 0,
          currentStockUnits: 0,
          stockCostCents: 0
        });
      }

      const item = categoryMap.get(cat);
      item.productsCount += 1;
      const stock = prod.stockQuantity || 0;
      if (stock > 0) {
        item.currentStockUnits += stock;
        item.stockCostCents += stock * (prod.purchasePriceCents || 0);
      }
    }

    // Criar mapa de lookup produto -> categoria
    const prodCatMap = new Map(products.map(p => [p.id, (p.category && p.category.trim()) ? p.category.trim() : 'Geral']));

    // 2. Mapear vendas por categoria
    for (const sale of sales) {
      const cat = prodCatMap.get(sale.productId) || 'Geral';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, {
          categoryName: cat,
          revenueCents: 0,
          cogsCents: 0,
          profitCents: 0,
          unitsSold: 0,
          salesCount: 0,
          productsCount: 0,
          currentStockUnits: 0,
          stockCostCents: 0
        });
      }

      const item = categoryMap.get(cat);
      const rev = sale.totalSaleCents || 0;
      const cost = sale.totalCostCents || (sale.unitCostCents || 0) * (sale.quantity || 0);
      const profit = sale.profitCents || (rev - cost);

      item.revenueCents += rev;
      item.cogsCents += cost;
      item.profitCents += profit;
      item.unitsSold += (sale.quantity || 0);
      item.salesCount += 1;
      totalRevenueCents += rev;
    }

    const categories = Array.from(categoryMap.values()).map(cat => {
      const marginPercent = cat.revenueCents > 0
        ? Number(((cat.profitCents / cat.revenueCents) * 100).toFixed(2))
        : null;

      const sharePercent = totalRevenueCents > 0
        ? Number(((cat.revenueCents / totalRevenueCents) * 100).toFixed(2))
        : 0;

      return {
        ...cat,
        marginPercent,
        sharePercent
      };
    }).sort((a, b) => b.revenueCents - a.revenueCents);

    return {
      categories,
      totalCategoriesCount: categories.length,
      totalRevenueCents
    };
  }

  /**
   * Gera uma série temporal cronológica diária para renderização de gráficos de evolução.
   */
  static generateTimelineSeries(sales, purchases, startDateObj, endDateObj, periodDays = 30) {
    const pointsMap = new Map();

    // Inicializar todos os dias do período no mapa para que dias sem movimentação apareçam como zero
    const cur = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), startDateObj.getDate());
    const end = new Date(endDateObj.getFullYear(), endDateObj.getMonth(), endDateObj.getDate());

    while (cur <= end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${d}`;
      const label = `${d}/${m}`;

      pointsMap.set(key, {
        key,
        label,
        dateObj: new Date(cur),
        revenueCents: 0,
        cogsCents: 0,
        profitCents: 0,
        purchasesCents: 0,
        salesCount: 0
      });

      cur.setDate(cur.getDate() + 1);
    }

    // Preencher dados reais das vendas
    for (const sale of sales) {
      const dateStr = (sale.date || sale.createdAt || '').slice(0, 10);
      if (pointsMap.has(dateStr)) {
        const point = pointsMap.get(dateStr);
        const rev = sale.totalSaleCents || 0;
        const cost = sale.totalCostCents || (sale.unitCostCents || 0) * (sale.quantity || 0);
        const profit = sale.profitCents || (rev - cost);

        point.revenueCents += rev;
        point.cogsCents += cost;
        point.profitCents += profit;
        point.salesCount += 1;
      }
    }

    // Preencher dados reais das compras
    for (const purchase of purchases) {
      const dateStr = (purchase.date || purchase.createdAt || '').slice(0, 10);
      if (pointsMap.has(dateStr)) {
        const point = pointsMap.get(dateStr);
        point.purchasesCents += (purchase.totalCostCents || 0);
      }
    }

    return Array.from(pointsMap.values());
  }
}
