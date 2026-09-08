import { ReportService, REPORT_TYPES } from '../services/ReportService.js';
import { PERIOD_TYPES } from '../services/AnalyticsService.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';

export class ReportsPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.currentReportType = REPORT_TYPES.SALES;
    this.periodType = PERIOD_TYPES.LAST_30_DAYS;
    this.customStartDate = null;
    this.customEndDate = null;
    this.selectedCategory = '';
    this.selectedStatus = '';
    this.selectedPaymentMethod = '';
    this.includeCancelled = false;

    this.companyProfile = null;
    this.currentReportData = null;
    this.categories = [];
    this.suppliers = [];
    this.isLoading = false;
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6 pb-12">
        <!-- Header & Action Buttons -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-black text-slate-900 tracking-tight">Central de Relatórios & Impressão</h2>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">Emissão de relatórios gerenciais, demonstrativos DRE, balanço físico, exportação CSV e impressão A4</p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button id="btn-export-csv" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              Exportar CSV (.csv)
            </button>
            <button id="btn-print-report" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition shadow-xs flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              Imprimir / PDF
            </button>
          </div>
        </div>

        <!-- Filter & Selection Bar -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <!-- Report Type Pills -->
          <div class="flex flex-wrap items-center gap-1 border-b border-slate-100 pb-3" id="report-type-selector">
            <button data-type="${REPORT_TYPES.SALES}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.SALES ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Vendas (PDV)
            </button>
            <button data-type="${REPORT_TYPES.PURCHASES}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.PURCHASES ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Compras & Fornecedores
            </button>
            <button data-type="${REPORT_TYPES.STOCK_INVENTORY}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.STOCK_INVENTORY ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Estoque & Inventário Físico
            </button>
            <button data-type="${REPORT_TYPES.DRE}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.DRE ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              DRE Gerencial
            </button>
            <button data-type="${REPORT_TYPES.ABC_PRODUCTS}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.ABC_PRODUCTS ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Curva ABC (Produtos)
            </button>
            <button data-type="${REPORT_TYPES.ABC_SUPPLIERS}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.ABC_SUPPLIERS ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Curva ABC (Fornecedores)
            </button>
            <button data-type="${REPORT_TYPES.STOCK_MOVEMENTS}" class="report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition ${this.currentReportType === REPORT_TYPES.STOCK_MOVEMENTS ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Movimentações (Kardex)
            </button>
          </div>

          <!-- Filters Row -->
          <div class="flex flex-wrap items-center gap-3 text-xs" id="filters-container">
            <!-- Dynamic contextual filters will be injected here -->
          </div>
        </div>

        <!-- Report Content & Table Area -->
        <div id="report-view-container" class="space-y-4">
          <!-- Dynamic summary cards and table -->
        </div>
      </div>
    `;

    await this.loadInitialMetadata();
    await this.loadAndRenderReport();
    this._bindEvents();
  }

  async loadInitialMetadata() {
    this.companyProfile = await settingsRepository.get('companyProfile');
    const prods = await productRepository.list({});
    const cats = new Set(prods.map(p => p.category).filter(Boolean));
    this.categories = Array.from(cats);
    this.suppliers = await supplierRepository.list({});
  }

  async loadAndRenderReport() {
    this.isLoading = true;
    const viewContainer = this.rootElement.querySelector('#report-view-container');
    if (viewContainer) {
      viewContainer.innerHTML = `
        <div class="bg-white p-12 rounded-2xl border border-slate-200 text-center flex flex-col items-center justify-center space-y-3">
          <svg class="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
          <span class="text-xs font-bold text-slate-500">Consolidando e processando dados do relatório...</span>
        </div>
      `;
    }

    this._renderFiltersRow();

    const filters = {
      periodType: this.periodType,
      customStartDate: this.customStartDate,
      customEndDate: this.customEndDate,
      category: this.selectedCategory || undefined,
      status: this.selectedStatus || undefined,
      paymentMethod: this.selectedPaymentMethod || undefined,
      includeCancelled: this.includeCancelled
    };

    try {
      let data = null;
      switch (this.currentReportType) {
        case REPORT_TYPES.PURCHASES:
          data = await ReportService.generatePurchasesReport(filters);
          break;
        case REPORT_TYPES.STOCK_INVENTORY:
          data = await ReportService.generateStockInventoryReport(filters);
          break;
        case REPORT_TYPES.DRE:
          data = await ReportService.generateDREReport(filters);
          break;
        case REPORT_TYPES.ABC_PRODUCTS:
          data = await ReportService.generateABCReport('products', filters);
          break;
        case REPORT_TYPES.ABC_SUPPLIERS:
          data = await ReportService.generateABCReport('suppliers', filters);
          break;
        case REPORT_TYPES.STOCK_MOVEMENTS:
          data = await ReportService.generateStockMovementsReport(filters);
          break;
        case REPORT_TYPES.SALES:
        default:
          data = await ReportService.generateSalesReport(filters);
          break;
      }

      this.currentReportData = data;
      this._renderReportContent(data);
    } catch (err) {
      console.error('[ReportsPage] Erro ao gerar relatório:', err);
      if (viewContainer) {
        viewContainer.innerHTML = `
          <div class="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-2xl text-xs">
            <h4 class="font-bold mb-1">Falha na geração do relatório</h4>
            <p>${err.message}</p>
          </div>
        `;
      }
    } finally {
      this.isLoading = false;
    }
  }

  _renderFiltersRow() {
    const container = this.rootElement.querySelector('#filters-container');
    if (!container) return;

    const isStockReport = this.currentReportType === REPORT_TYPES.STOCK_INVENTORY;

    container.innerHTML = `
      ${!isStockReport ? `
        <!-- Period Selector -->
        <div class="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
          <span class="text-[11px] font-bold text-slate-500 uppercase px-2">Período:</span>
          <select id="select-period" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="${PERIOD_TYPES.TODAY}" ${this.periodType === PERIOD_TYPES.TODAY ? 'selected' : ''}>Hoje</option>
            <option value="${PERIOD_TYPES.LAST_7_DAYS}" ${this.periodType === PERIOD_TYPES.LAST_7_DAYS ? 'selected' : ''}>Últimos 7 dias</option>
            <option value="${PERIOD_TYPES.LAST_30_DAYS}" ${this.periodType === PERIOD_TYPES.LAST_30_DAYS ? 'selected' : ''}>Últimos 30 dias</option>
            <option value="${PERIOD_TYPES.LAST_90_DAYS}" ${this.periodType === PERIOD_TYPES.LAST_90_DAYS ? 'selected' : ''}>Últimos 90 dias</option>
            <option value="${PERIOD_TYPES.LAST_12_MONTHS}" ${this.periodType === PERIOD_TYPES.LAST_12_MONTHS ? 'selected' : ''}>Últimos 12 meses</option>
            <option value="${PERIOD_TYPES.CUSTOM}" ${this.periodType === PERIOD_TYPES.CUSTOM ? 'selected' : ''}>Personalizado</option>
          </select>
        </div>
      ` : ''}

      ${this.periodType === PERIOD_TYPES.CUSTOM && !isStockReport ? `
        <div class="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-200">
          <input type="date" id="custom-start-date" value="${this.customStartDate || ''}" class="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-700" />
          <span class="text-slate-400 text-xs">até</span>
          <input type="date" id="custom-end-date" value="${this.customEndDate || ''}" class="bg-white border border-slate-300 rounded px-2 py-0.5 text-xs text-slate-700" />
          <button id="btn-apply-custom-date" class="bg-slate-900 text-white font-bold px-2 py-1 rounded text-[11px] hover:bg-slate-800">Filtrar</button>
        </div>
      ` : ''}

      ${isStockReport ? `
        <!-- Category Filter -->
        <div class="flex items-center gap-1.5">
          <label class="text-[11px] font-bold text-slate-500 uppercase">Categoria:</label>
          <select id="select-category" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">Todas</option>
            ${this.categories.map(c => `<option value="${c}" ${this.selectedCategory === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${this.currentReportType === REPORT_TYPES.SALES ? `
        <!-- Payment Method Filter -->
        <div class="flex items-center gap-1.5">
          <label class="text-[11px] font-bold text-slate-500 uppercase">Pagamento:</label>
          <select id="select-payment-method" class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">Todos</option>
            <option value="DINHEIRO" ${this.selectedPaymentMethod === 'DINHEIRO' ? 'selected' : ''}>Dinheiro</option>
            <option value="PIX" ${this.selectedPaymentMethod === 'PIX' ? 'selected' : ''}>PIX</option>
            <option value="CARTAO_DEBITO" ${this.selectedPaymentMethod === 'CARTAO_DEBITO' ? 'selected' : ''}>Débito</option>
            <option value="CARTAO_CREDITO" ${this.selectedPaymentMethod === 'CARTAO_CREDITO' ? 'selected' : ''}>Crédito</option>
          </select>
        </div>
      ` : ''}
    `;

    this._bindFilterChangeEvents();
  }

  _renderReportContent(report) {
    const container = this.rootElement.querySelector('#report-view-container');
    if (!container) return;

    const summary = report.summary || {};
    const columns = report.columns || [];
    const rows = report.rows || [];

    let summaryCardsHTML = '';

    if (this.currentReportType === REPORT_TYPES.SALES) {
      summaryCardsHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Faturamento Real</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalRevenueFormatted}</span>
            <span class="text-[10px] text-emerald-600 font-bold mt-0.5 block">${summary.totalSalesCount} vendas concluídas</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">CMV (Custo)</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalCogsFormatted}</span>
            <span class="text-[10px] text-slate-400 font-medium mt-0.5 block">Custo mercadorias</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lucro Bruto</span>
            <span class="text-xl font-black text-emerald-600 mt-1 block">${summary.totalProfitFormatted}</span>
            <span class="text-[10px] text-emerald-700 font-bold mt-0.5 block">Margem: ${summary.averageMarginPercent}</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ticket Médio</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.averageTicketFormatted}</span>
            <span class="text-[10px] text-slate-400 font-medium mt-0.5 block">${summary.totalUnitsSold} un. vendidas</span>
          </div>
        </div>
      `;
    } else if (this.currentReportType === REPORT_TYPES.PURCHASES) {
      summaryCardsHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Comprado</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalSpentFormatted}</span>
            <span class="text-[10px] text-blue-600 font-bold mt-0.5 block">${summary.totalPurchasesCount} ordens concluídas</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Itens Recebidos</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalUnitsPurchased}</span>
            <span class="text-[10px] text-slate-400 font-medium mt-0.5 block">Unidades físicas</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Média por Ordem</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.averagePurchaseFormatted}</span>
          </div>
        </div>
      `;
    } else if (this.currentReportType === REPORT_TYPES.STOCK_INVENTORY) {
      summaryCardsHTML = `
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estoque a Custo</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalStockCostFormatted}</span>
            <span class="text-[10px] text-slate-400 font-medium mt-0.5 block">${summary.totalStockUnits} itens no balanço</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Estoque a Venda</span>
            <span class="text-xl font-black text-slate-900 mt-1 block">${summary.totalStockSaleFormatted}</span>
            <span class="text-[10px] text-slate-400 font-medium mt-0.5 block">Potencial bruto</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lucro Projetado</span>
            <span class="text-xl font-black text-emerald-600 mt-1 block">${summary.totalPotentialProfitFormatted}</span>
          </div>
          <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Alertas de Reposição</span>
            <span class="text-xl font-black text-rose-600 mt-1 block">${summary.outOfStockCount + summary.lowStockCount}</span>
            <span class="text-[10px] text-rose-700 font-medium mt-0.5 block">${summary.outOfStockCount} zerados · ${summary.lowStockCount} baixos</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      ${summaryCardsHTML}

      <!-- Table Card -->
      <div class="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider">${report.title}</h3>
            ${report.period ? `<span class="text-[11px] text-slate-500 font-medium">(${report.period.label})</span>` : ''}
          </div>
          <span class="text-[11px] text-slate-400 font-semibold">${rows.length} registros encontrados</span>
        </div>

        <div class="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
              <tr>
                ${columns.map(c => `<th class="py-3 px-4">${c.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium text-slate-700">
              ${rows.length === 0 ? `
                <tr>
                  <td colspan="${columns.length}" class="py-8 text-center text-slate-400 text-xs">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              ` : rows.map(row => `
                <tr class="hover:bg-slate-50/80 transition ${row.isCancelled ? 'opacity-50 line-through' : ''}">
                  ${columns.map(col => {
                    const val = row[col.key];
                    return `<td class="py-3 px-4 whitespace-nowrap">${val !== undefined && val !== null ? val : '—'}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Type Selector
    const typeContainer = this.rootElement.querySelector('#report-type-selector');
    if (typeContainer) {
      typeContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.report-type-btn');
        if (!btn) return;

        this.currentReportType = btn.dataset.type;

        typeContainer.querySelectorAll('.report-type-btn').forEach(b => {
          b.className = 'report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 hover:bg-slate-100';
        });
        btn.className = 'report-type-btn px-3 py-1.5 rounded-lg text-xs font-bold transition bg-slate-900 text-white shadow-xs';

        this.loadAndRenderReport();
      });
    }

    // Print Button
    const printBtn = this.rootElement.querySelector('#btn-print-report');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        if (!this.currentReportData) return;
        ReportService.printReport(this.currentReportData, this.companyProfile);
      });
    }

    // Export CSV Button
    const csvBtn = this.rootElement.querySelector('#btn-export-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', async () => {
        if (!this.currentReportData) return;
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        
        const typeNames = {
          sales: 'vendas_pdv',
          purchases: 'compras_fornecedores',
          stock_inventory: 'estoque_inventario',
          dre: 'demonstrativo_dre',
          abc_products: 'curva_abc_produtos',
          abc_suppliers: 'curva_abc_fornecedores',
          stock_movements: 'kardex_movimentacoes'
        };
        const reportSlug = typeNames[this.currentReportType] || this.currentReportType;
        const fileName = `gestaopro_relatorio_${reportSlug}_${dateStr}.csv`;
        
        await ReportService.downloadCSV(this.currentReportData.columns, this.currentReportData.rows, fileName);
      });
    }
  }

  _bindFilterChangeEvents() {
    const periodSelect = this.rootElement.querySelector('#select-period');
    if (periodSelect) {
      periodSelect.addEventListener('change', (e) => {
        this.periodType = e.target.value;
        this.loadAndRenderReport();
      });
    }

    const catSelect = this.rootElement.querySelector('#select-category');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        this.selectedCategory = e.target.value;
        this.loadAndRenderReport();
      });
    }

    const paySelect = this.rootElement.querySelector('#select-payment-method');
    if (paySelect) {
      paySelect.addEventListener('change', (e) => {
        this.selectedPaymentMethod = e.target.value;
        this.loadAndRenderReport();
      });
    }

    const customDateBtn = this.rootElement.querySelector('#btn-apply-custom-date');
    if (customDateBtn) {
      customDateBtn.addEventListener('click', () => {
        const start = this.rootElement.querySelector('#custom-start-date').value;
        const end = this.rootElement.querySelector('#custom-end-date').value;
        if (start && end) {
          this.customStartDate = start;
          this.customEndDate = end;
          this.loadAndRenderReport();
        }
      });
    }
  }
}
