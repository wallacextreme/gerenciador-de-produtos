import { AnalyticsService, PERIOD_TYPES, VELOCITY_CLASSIFICATION } from '../services/AnalyticsService.js';
import { MoneyService } from '../domain/MoneyService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class DashboardPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.periodType = PERIOD_TYPES.LAST_30_DAYS;
    this.customStartDate = null;
    this.customEndDate = null;
    this.activeTab = 'overview'; // 'overview' | 'abc' | 'velocity' | 'suppliers' | 'categories'
    this.analytics = null;
    this.isLoading = true;
    this.cleanupListeners = [];
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6 pb-12 max-w-7xl mx-auto">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-black text-slate-900 tracking-tight">Painel de Controle & Análises</h2>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">Visão executiva em tempo real: Faturamento, CMV, Lucro, Giro, Curva ABC e Fornecedores</p>
          </div>

          <!-- Quick Navigation Actions -->
          <div class="flex items-center gap-2">
            <a href="#/vendas" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
              Nova Venda (PDV)
            </a>
            <a href="#/compras" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              Nova Compra
            </a>
          </div>
        </div>

        <!-- Period Selector Filter Bar -->
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div class="flex flex-wrap items-center gap-1.5" id="period-buttons-container">
            <button data-period="${PERIOD_TYPES.TODAY}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50">Hoje</button>
            <button data-period="${PERIOD_TYPES.LAST_7_DAYS}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50">7 dias</button>
            <button data-period="${PERIOD_TYPES.LAST_30_DAYS}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition bg-blue-600 text-white border border-blue-600">30 dias</button>
            <button data-period="${PERIOD_TYPES.LAST_90_DAYS}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50">90 dias</button>
            <button data-period="${PERIOD_TYPES.LAST_12_MONTHS}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50">12 meses</button>
            <button data-period="${PERIOD_TYPES.CUSTOM}" class="period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50">Personalizado</button>
          </div>

          <!-- Custom Date Range Form (collapsible) -->
          <div id="custom-date-container" class="hidden flex items-center gap-2">
            <input type="date" id="custom-start-date" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <span class="text-xs text-slate-400 font-medium">até</span>
            <input type="date" id="custom-end-date" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <button id="btn-apply-custom-date" class="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-slate-800 transition">Filtrar</button>
          </div>

          <div class="text-xs font-semibold text-slate-500 flex items-center gap-2 ml-auto">
            <span id="period-label-display" class="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md">Últimos 30 dias</span>
            <button id="btn-refresh-dashboard" title="Atualizar dados" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
          </div>
        </div>

        <!-- Dashboard Content Body -->
        <div id="dashboard-content">
          ${this._renderLoadingSkeleton()}
        </div>
      </div>
    `;

    this._bindPeriodEvents();
    this._bindRealtimeEvents();
    await this.loadData();
  }

  async loadData() {
    this.isLoading = true;
    try {
      this.analytics = await AnalyticsService.getDashboardAnalytics({
        periodType: this.periodType,
        customStartDate: this.customStartDate,
        customEndDate: this.customEndDate
      });

      this._renderDashboardBody();
    } catch (err) {
      console.error('[Dashboard] Erro ao carregar análises:', err);
      const container = this.rootElement.querySelector('#dashboard-content');
      if (container) {
        container.innerHTML = `
          <div class="bg-rose-50 border border-rose-200 text-rose-800 p-6 rounded-2xl text-center">
            <h3 class="text-base font-bold mb-1">Erro ao processar análises do Dashboard</h3>
            <p class="text-xs text-rose-600">${err.message}</p>
            <button id="btn-retry" class="mt-4 px-4 py-2 bg-rose-700 text-white text-xs font-bold rounded-lg hover:bg-rose-800 transition">Tentar Novamente</button>
          </div>
        `;
        const retryBtn = container.querySelector('#btn-retry');
        if (retryBtn) retryBtn.addEventListener('click', () => this.loadData());
      }
    } finally {
      this.isLoading = false;
    }
  }

  _renderDashboardBody() {
    const container = this.rootElement.querySelector('#dashboard-content');
    if (!container || !this.analytics) return;

    const { financial, stockValuation, period } = this.analytics;

    // Atualizar label de período
    const labelEl = this.rootElement.querySelector('#period-label-display');
    if (labelEl) labelEl.textContent = period.label;

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 6 Main KPI Cards Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          
          <!-- Card 1: Faturamento -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Faturamento</span>
              <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
            </div>
            <div class="text-xl font-black text-slate-900 tracking-tight">
              ${MoneyService.format(financial.revenueCents)}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>${financial.totalSalesCount} vendas</span>
              <span class="font-semibold text-slate-700">Méd: ${MoneyService.format(financial.averageTicketCents)}</span>
            </div>
          </div>

          <!-- Card 2: Lucro Bruto -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lucro Bruto</span>
              <div class="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
              </div>
            </div>
            <div class="text-xl font-black ${financial.grossProfitCents >= 0 ? 'text-blue-700' : 'text-rose-600'} tracking-tight">
              ${MoneyService.format(financial.grossProfitCents)}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
              <span class="text-slate-500">Margem:</span>
              <span class="font-bold ${financial.grossMarginPercent >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
                ${financial.grossMarginPercent !== null ? `${financial.grossMarginPercent}%` : 'N/A'}
              </span>
            </div>
          </div>

          <!-- Card 3: CMV (Custo das Mercadorias Vendidas) -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">CMV (Custo)</span>
              <div class="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>
              </div>
            </div>
            <div class="text-xl font-black text-slate-900 tracking-tight">
              ${MoneyService.format(financial.cogsCents)}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>${financial.totalUnitsSold} un vendidas</span>
              <span class="font-semibold text-slate-700">${financial.markupPercent !== null ? `Mk: ${financial.markupPercent}%` : 'Mk: N/A'}</span>
            </div>
          </div>

          <!-- Card 4: Valor do Estoque a Custo -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Estoque (Custo)</span>
              <div class="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
            </div>
            <div class="text-xl font-black text-slate-900 tracking-tight">
              ${MoneyService.format(stockValuation.stockCostValueCents)}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>${stockValuation.totalStockUnits} itens</span>
              <span class="text-emerald-600 font-semibold">Venda: ${MoneyService.format(stockValuation.stockSaleValueCents)}</span>
            </div>
          </div>

          <!-- Card 5: Compras Realizadas -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Compras</span>
              <div class="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
            </div>
            <div class="text-xl font-black text-slate-900 tracking-tight">
              ${MoneyService.format(financial.totalPurchasesSpentCents)}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>${financial.totalPurchasesCount} ordens</span>
              <span class="font-semibold text-slate-700">${financial.totalUnitsPurchased} un rec.</span>
            </div>
          </div>

          <!-- Card 6: Giro de Estoque -->
          <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between hover:border-slate-300 transition">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Giro de Estoque</span>
              <div class="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </div>
            </div>
            <div class="text-xl font-black text-slate-900 tracking-tight">
              ${stockValuation.turnoverRatio !== null ? `${stockValuation.turnoverRatio}x` : '<span class="text-xs font-normal text-slate-400 italic">Dados insuficientes</span>'}
            </div>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Ciclo estimado:</span>
              <span class="font-semibold text-slate-700">${stockValuation.turnoverDays ? `~${stockValuation.turnoverDays} dias` : '—'}</span>
            </div>
          </div>

        </div>

        <!-- Analytical Navigation Tabs -->
        <div class="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
          <div class="flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2 mb-4" id="dashboard-tabs-container">
            <button data-tab="overview" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'overview' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Visão Geral & Gráficos
            </button>
            <button data-tab="abc" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'abc' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Curva ABC de Produtos
            </button>
            <button data-tab="velocity" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'velocity' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Velocidade & Produtos Parados
            </button>
            <button data-tab="suppliers" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'suppliers' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Análise de Fornecedores
            </button>
            <button data-tab="categories" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'categories' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Desempenho por Categoria
            </button>
          </div>

          <!-- Active Tab Content -->
          <div id="tab-content-area" class="p-2">
            ${this._renderActiveTabContent()}
          </div>
        </div>
      </div>
    `;

    this._bindTabEvents();
  }

  _renderActiveTabContent() {
    switch (this.activeTab) {
      case 'abc':
        return this._renderABCTab();
      case 'velocity':
        return this._renderVelocityTab();
      case 'suppliers':
        return this._renderSuppliersTab();
      case 'categories':
        return this._renderCategoriesTab();
      case 'overview':
      default:
        return this._renderOverviewTab();
    }
  }

  /**
   * TAB 1: Visão Geral & Gráficos
   */
  _renderOverviewTab() {
    const { timelineSeries, productPerformance, categoryAnalysis, financial } = this.analytics;

    return `
      <div class="space-y-6">
        <!-- Charts Grid (Timeline & Category Donut) -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Timeline Area Chart (Col span 2) -->
          <div class="lg:col-span-2 bg-slate-50/70 p-5 rounded-2xl border border-slate-200">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="text-sm font-bold text-slate-900">Evolução de Faturamento x Lucro</h3>
                <p class="text-[11px] text-slate-500">Comportamento diário das vendas e compras no período</p>
              </div>
              <div class="flex items-center gap-3 text-[10px] font-bold">
                <span class="flex items-center gap-1 text-emerald-700">
                  <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Faturamento
                </span>
                <span class="flex items-center gap-1 text-blue-700">
                  <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Lucro Bruto
                </span>
                <span class="flex items-center gap-1 text-purple-700">
                  <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Compras
                </span>
              </div>
            </div>

            <!-- SVG Timeline Chart -->
            <div class="w-full h-64">
              ${this._renderTimelineSVG(timelineSeries)}
            </div>
          </div>

          <!-- Category Share Donut / Bar List (Col span 1) -->
          <div class="bg-slate-50/70 p-5 rounded-2xl border border-slate-200 flex flex-col justify-between">
            <div class="mb-3">
              <h3 class="text-sm font-bold text-slate-900">Participação por Categoria</h3>
              <p class="text-[11px] text-slate-500">Concentração de receita por linha</p>
            </div>

            <!-- SVG Donut Chart -->
            <div class="my-auto py-2">
              ${this._renderCategoryDonutSVG(categoryAnalysis.categories)}
            </div>
          </div>
        </div>

        <!-- Secondary Overview Grid: Top Sellers & Critical Stock Alerts -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          <!-- Top 5 Products -->
          <div class="bg-white p-5 rounded-2xl border border-slate-200">
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                Top Produtos Mais Vendidos
              </h3>
              <button data-switch-tab="velocity" class="text-xs text-blue-600 hover:text-blue-700 font-semibold">Ver Todos</button>
            </div>

            ${productPerformance.topSellers.length > 0 ? `
              <div class="space-y-3">
                ${productPerformance.topSellers.slice(0, 5).map((p, idx) => `
                  <div class="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 transition">
                    <div class="flex items-center gap-3">
                      <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs">
                        ${idx + 1}
                      </span>
                      <div>
                        <a href="#/produtos/detalhes/${p.id}" class="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-1">${this._esc(p.name)}</a>
                        <span class="text-[10px] text-slate-400">${p.productCode || 'Sem SKU'} · ${p.unitsSold} un vendidas</span>
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="text-xs font-black text-slate-900">${MoneyService.format(p.revenueCents)}</div>
                      <div class="text-[10px] text-emerald-600 font-bold">Lucro: ${MoneyService.format(p.profitCents)}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="py-8 text-center text-slate-400 text-xs">
                Nenhuma venda registrada no período selecionado.
              </div>
            `}
          </div>

          <!-- Idle Products Warning & Capital at Risk -->
          <div class="bg-white p-5 rounded-2xl border border-slate-200">
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
              <h3 class="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                Capital Imobilizado (Produtos Parados)
              </h3>
              <span class="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                ${MoneyService.format(productPerformance.totalIdleCapitalCents)}
              </span>
            </div>

            ${productPerformance.idleProducts.length > 0 ? `
              <div class="space-y-3">
                ${productPerformance.idleProducts.slice(0, 5).map(p => `
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/40 border border-amber-100 hover:bg-amber-50 transition">
                    <div>
                      <a href="#/produtos/detalhes/${p.id}" class="text-xs font-bold text-slate-900 hover:text-blue-600 line-clamp-1">${this._esc(p.name)}</a>
                      <span class="text-[10px] text-slate-500">${p.stockQuantity} un em estoque · Custo unit.: ${MoneyService.format(p.purchasePriceCents)}</span>
                    </div>
                    <div class="text-right">
                      <div class="text-xs font-black text-slate-800">${MoneyService.format(p.idleCapitalCents)}</div>
                      <span class="text-[9px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold uppercase">0 vendas no período</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="py-8 text-center text-slate-400 text-xs">
                Excelente! Nenhum produto com estoque parado sem vendas no período.
              </div>
            `}
          </div>

        </div>
      </div>
    `;
  }

  /**
   * TAB 2: Curva ABC de Produtos
   */
  _renderABCTab() {
    const { productABC } = this.analytics;
    const { summary, classA, classB, classC, items } = productABC;

    return `
      <div class="space-y-6">
        <!-- Pareto Overview Explanation & Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          <div class="bg-emerald-50/80 p-4 rounded-2xl border border-emerald-200">
            <div class="flex items-center justify-between mb-2">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-700 text-white uppercase tracking-wider">Classe A (Top 80%)</span>
              <span class="text-xs font-bold text-emerald-800">${summary.countA} produtos</span>
            </div>
            <div class="text-xl font-black text-emerald-900">${MoneyService.format(summary.revenueA)}</div>
            <p class="text-[11px] text-emerald-700 mt-1">${summary.percentA}% do faturamento total do período</p>
          </div>

          <div class="bg-blue-50/80 p-4 rounded-2xl border border-blue-200">
            <div class="flex items-center justify-between mb-2">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-700 text-white uppercase tracking-wider">Classe B (Próx. 15%)</span>
              <span class="text-xs font-bold text-blue-800">${summary.countB} produtos</span>
            </div>
            <div class="text-xl font-black text-blue-900">${MoneyService.format(summary.revenueB)}</div>
            <p class="text-[11px] text-blue-700 mt-1">${summary.percentB}% do faturamento total do período</p>
          </div>

          <div class="bg-amber-50/80 p-4 rounded-2xl border border-amber-200">
            <div class="flex items-center justify-between mb-2">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-700 text-white uppercase tracking-wider">Classe C (Últimos 5%)</span>
              <span class="text-xs font-bold text-amber-800">${summary.countC} produtos</span>
            </div>
            <div class="text-xl font-black text-amber-900">${MoneyService.format(summary.revenueC)}</div>
            <p class="text-[11px] text-amber-700 mt-1">${summary.percentC}% do faturamento total do período</p>
          </div>

        </div>

        <!-- Pareto ABC Table -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div class="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Classificação de Pareto (Curva ABC de Faturamento)</h3>
              <p class="text-[11px] text-slate-500">Produtos ordenados pelo impacto na receita bruta do período</p>
            </div>
            <span class="text-xs font-semibold text-slate-600">${items.length} produtos classificados</span>
          </div>

          ${items.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-100/75 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th class="py-3 px-4">Classe</th>
                    <th class="py-3 px-4">Produto</th>
                    <th class="py-3 px-4">Categoria</th>
                    <th class="py-3 px-4 text-right">Faturamento</th>
                    <th class="py-3 px-4 text-right">% Participação</th>
                    <th class="py-3 px-4 text-right">% Acumulado</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${items.map(item => `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="py-3 px-4">
                        <span class="px-2 py-0.5 rounded text-[10px] font-black ${
                          item.classification === 'A' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                          item.classification === 'B' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                          'bg-amber-100 text-amber-800 border border-amber-200'
                        }">
                          CLASSE ${item.classification}
                        </span>
                      </td>
                      <td class="py-3 px-4 font-bold text-slate-900">
                        <a href="#/produtos/detalhes/${item.id}" class="hover:text-blue-600">${this._esc(item.name)}</a>
                        <span class="block text-[10px] text-slate-400 font-normal">${item.productCode || 'Sem SKU'}</span>
                      </td>
                      <td class="py-3 px-4 text-slate-600">${this._esc(item.category) || '—'}</td>
                      <td class="py-3 px-4 text-right font-black text-slate-900">${MoneyService.format(item.revenueCents)}</td>
                      <td class="py-3 px-4 text-right font-bold text-slate-700">${item.sharePercent}%</td>
                      <td class="py-3 px-4 text-right font-bold text-slate-500">${item.accumulatedPercent}%</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="py-12 text-center text-slate-400 text-xs">
              Nenhuma venda registrada no período para cálculo da Curva ABC.
            </div>
          `}
        </div>
      </div>
    `;
  }

  /**
   * TAB 3: Velocidade & Produtos Parados
   */
  _renderVelocityTab() {
    const { productPerformance } = this.analytics;
    const { allProductsPerformance, idleProducts, totalIdleCapitalCents } = productPerformance;

    return `
      <div class="space-y-6">
        
        <!-- Idle Products Alert -->
        <div class="bg-amber-50 border border-amber-200 p-5 rounded-2xl">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-amber-900 flex items-center gap-2">
                <svg class="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                Relatório de Produtos sem Giro (Parados no Período)
              </h3>
              <p class="text-xs text-amber-700 mt-0.5">Itens com saldo físico em estoque mas com 0 vendas no período selecionado</p>
            </div>
            <div class="text-right">
              <span class="text-xs text-amber-800 font-medium">Total de Capital Imobilizado:</span>
              <div class="text-lg font-black text-amber-950">${MoneyService.format(totalIdleCapitalCents)}</div>
            </div>
          </div>
        </div>

        <!-- Full Velocity & Run Rate Table -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div class="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Velocidade de Vendas (Run Rate Diário) & Cobertura</h3>
            <span class="text-xs text-slate-500 font-semibold">${allProductsPerformance.length} produtos monitorados</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-100/75 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th class="py-3 px-4">Produto</th>
                  <th class="py-3 px-4 text-center">Status Giro</th>
                  <th class="py-3 px-4 text-right">Estoque Atual</th>
                  <th class="py-3 px-4 text-right">Vendidos (Período)</th>
                  <th class="py-3 px-4 text-right">Velocidade (un/dia)</th>
                  <th class="py-3 px-4 text-right">Cobertura Estimada</th>
                  <th class="py-3 px-4 text-right">Margem</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${allProductsPerformance.map(p => `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4">
                      <a href="#/produtos/detalhes/${p.id}" class="font-bold text-slate-900 hover:text-blue-600">${this._esc(p.name)}</a>
                      <span class="block text-[10px] text-slate-400">${p.category} · ${p.productCode || 'Sem SKU'}</span>
                    </td>
                    <td class="py-3 px-4 text-center">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                        p.velocity === VELOCITY_CLASSIFICATION.RAPIDA ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                        p.velocity === VELOCITY_CLASSIFICATION.NORMAL ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                        p.velocity === VELOCITY_CLASSIFICATION.LENTA ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                        'bg-rose-100 text-rose-800 border border-rose-200'
                      }">
                        ${p.velocity}
                      </span>
                    </td>
                    <td class="py-3 px-4 text-right font-black text-slate-800">${p.stockQuantity} un</td>
                    <td class="py-3 px-4 text-right font-black text-slate-900">${p.unitsSold} un</td>
                    <td class="py-3 px-4 text-right font-bold text-slate-700">${p.dailySalesRate} un/dia</td>
                    <td class="py-3 px-4 text-right font-bold text-slate-600">
                      ${p.coverageDays !== null ? (p.coverageDays === 0 ? '<span class="text-rose-600">Esgotado</span>' : `~${p.coverageDays} dias`) : '—'}
                    </td>
                    <td class="py-3 px-4 text-right font-bold ${p.marginPercent !== null ? (p.marginPercent >= 0 ? 'text-emerald-700' : 'text-rose-600') : 'text-slate-400'}">
                      ${p.marginPercent !== null ? `${p.marginPercent}%` : '—'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * TAB 4: Análise de Fornecedores & Compras
   */
  _renderSuppliersTab() {
    const { supplierAnalysis } = this.analytics;
    const { supplierABC } = supplierAnalysis;
    const { items, summary } = supplierABC;

    return `
      <div class="space-y-6">
        <!-- Summary Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-purple-50 p-4 rounded-2xl border border-purple-200">
            <span class="text-[10px] font-bold text-purple-700 uppercase tracking-wider block mb-1">Total Investido em Compras</span>
            <div class="text-xl font-black text-purple-950">${MoneyService.format(summary.totalSpentCents)}</div>
            <p class="text-[11px] text-purple-700 mt-1">Compras reais confirmadas no período</p>
          </div>

          <div class="bg-blue-50 p-4 rounded-2xl border border-blue-200">
            <span class="text-[10px] font-bold text-blue-700 uppercase tracking-wider block mb-1">Fornecedores Classe A (Top 80%)</span>
            <div class="text-xl font-black text-blue-950">${summary.countA} parceiros</div>
            <p class="text-[11px] text-blue-700 mt-1">Representam 80% do volume financeiro</p>
          </div>

          <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <span class="text-[10px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Fornecedores Ativos</span>
            <div class="text-xl font-black text-slate-900">${items.length} fornecedores</div>
            <p class="text-[11px] text-slate-500 mt-1">Com ordens de compra no período</p>
          </div>
        </div>

        <!-- Supplier Table -->
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div class="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Ranking de Fornecedores por Volume de Compras</h3>
            <a href="#/fornecedores" class="text-xs text-blue-600 hover:text-blue-700 font-semibold">Gerenciar Fornecedores</a>
          </div>

          ${items.length > 0 ? `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-100/75 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th class="py-3 px-4">Classe</th>
                    <th class="py-3 px-4">Fornecedor</th>
                    <th class="py-3 px-4 text-center">Ordens de Compra</th>
                    <th class="py-3 px-4 text-right">Itens Adquiridos</th>
                    <th class="py-3 px-4 text-right">Total Investido</th>
                    <th class="py-3 px-4 text-right">% do Volume</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  ${items.map(s => `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="py-3 px-4">
                        <span class="px-2 py-0.5 rounded text-[10px] font-black ${
                          s.classification === 'A' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                          s.classification === 'B' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                          'bg-slate-100 text-slate-800 border border-slate-200'
                        }">
                          CLASSE ${s.classification}
                        </span>
                      </td>
                      <td class="py-3 px-4 font-bold text-slate-900">${this._esc(s.supplierName)}</td>
                      <td class="py-3 px-4 text-center font-bold text-slate-700">${s.ordersCount}</td>
                      <td class="py-3 px-4 text-right font-bold text-slate-700">${s.unitsPurchased} un</td>
                      <td class="py-3 px-4 text-right font-black text-slate-900">${MoneyService.format(s.totalSpentCents)}</td>
                      <td class="py-3 px-4 text-right font-bold text-purple-700">${s.sharePercent}%</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="py-12 text-center text-slate-400 text-xs">
              Nenhuma ordem de compra registrada com fornecedores no período selecionado.
            </div>
          `}
        </div>
      </div>
    `;
  }

  /**
   * TAB 5: Desempenho por Categoria
   */
  _renderCategoriesTab() {
    const { categoryAnalysis } = this.analytics;
    const { categories } = categoryAnalysis;

    return `
      <div class="space-y-6">
        <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <div class="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider">Desempenho Financeiro e Estoque por Categoria</h3>
            <span class="text-xs text-slate-500 font-semibold">${categories.length} categorias cadastradas</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-100/75 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th class="py-3 px-4">Categoria</th>
                  <th class="py-3 px-4 text-center">Qtd. Produtos</th>
                  <th class="py-3 px-4 text-right">Estoque Físico</th>
                  <th class="py-3 px-4 text-right">Unidades Vendidas</th>
                  <th class="py-3 px-4 text-right">Faturamento</th>
                  <th class="py-3 px-4 text-right">CMV</th>
                  <th class="py-3 px-4 text-right">Lucro Bruto</th>
                  <th class="py-3 px-4 text-right">Margem</th>
                  <th class="py-3 px-4 text-right">% Share</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${categories.map(c => `
                  <tr class="hover:bg-slate-50 transition">
                    <td class="py-3 px-4 font-bold text-slate-900">${this._esc(c.categoryName)}</td>
                    <td class="py-3 px-4 text-center text-slate-600 font-medium">${c.productsCount}</td>
                    <td class="py-3 px-4 text-right font-bold text-slate-800">${c.currentStockUnits} un</td>
                    <td class="py-3 px-4 text-right font-bold text-slate-800">${c.unitsSold} un</td>
                    <td class="py-3 px-4 text-right font-black text-slate-900">${MoneyService.format(c.revenueCents)}</td>
                    <td class="py-3 px-4 text-right text-slate-600">${MoneyService.format(c.cogsCents)}</td>
                    <td class="py-3 px-4 text-right font-bold ${c.profitCents >= 0 ? 'text-blue-700' : 'text-rose-600'}">
                      ${MoneyService.format(c.profitCents)}
                    </td>
                    <td class="py-3 px-4 text-right font-bold ${c.marginPercent !== null ? (c.marginPercent >= 0 ? 'text-emerald-700' : 'text-rose-600') : 'text-slate-400'}">
                      ${c.marginPercent !== null ? `${c.marginPercent}%` : '—'}
                    </td>
                    <td class="py-3 px-4 text-right font-black text-slate-700">${c.sharePercent}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza gráfico SVG nativo responsivo de evolução temporal (Faturamento x Lucro x Compras).
   */
  _renderTimelineSVG(series) {
    if (!series || series.length === 0) {
      return `<div class="h-full flex items-center justify-center text-xs text-slate-400">Sem dados temporais no período</div>`;
    }

    const width = 600;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxVal = Math.max(
      ...series.map(s => Math.max(s.revenueCents, s.cogsCents, s.profitCents, s.purchasesCents)),
      1000 // mínimo para evitar escala zero
    );

    const stepX = series.length > 1 ? chartW / (series.length - 1) : chartW / 2;

    // Gerar pontos das linhas
    const revPoints = series.map((s, idx) => {
      const x = padding.left + (series.length > 1 ? idx * stepX : chartW / 2);
      const y = padding.top + chartH - ((s.revenueCents / maxVal) * chartH);
      return `${x},${y}`;
    }).join(' ');

    const profitPoints = series.map((s, idx) => {
      const x = padding.left + (series.length > 1 ? idx * stepX : chartW / 2);
      const profitRatio = Math.max(0, s.profitCents) / maxVal;
      const y = padding.top + chartH - (profitRatio * chartH);
      return `${x},${y}`;
    }).join(' ');

    const purchasesPoints = series.map((s, idx) => {
      const x = padding.left + (series.length > 1 ? idx * stepX : chartW / 2);
      const y = padding.top + chartH - ((s.purchasesCents / maxVal) * chartH);
      return `${x},${y}`;
    }).join(' ');

    // Área sob a curva de faturamento
    const firstX = padding.left;
    const lastX = padding.left + (series.length > 1 ? (series.length - 1) * stepX : chartW / 2);
    const bottomY = padding.top + chartH;
    const revAreaPoints = `${firstX},${bottomY} ${revPoints} ${lastX},${bottomY}`;

    // Amostragem de labels do eixo X (máximo 6 labels para não poluir)
    const labelStep = Math.max(1, Math.floor(series.length / 6));

    return `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-full overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        <!-- Grid Lines Horizontais -->
        <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="#e2e8f0" stroke-dasharray="3 3"/>
        <line x1="${padding.left}" y1="${padding.top + chartH / 2}" x2="${width - padding.right}" y2="${padding.top + chartH / 2}" stroke="#e2e8f0" stroke-dasharray="3 3"/>
        <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${width - padding.right}" y2="${padding.top + chartH}" stroke="#cbd5e1"/>

        <!-- Y Axis Labels -->
        <text x="${padding.left - 6}" y="${padding.top + 4}" text-anchor="end" font-size="9" fill="#94a3b8" font-weight="600">${MoneyService.format(maxVal)}</text>
        <text x="${padding.left - 6}" y="${padding.top + chartH / 2 + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-weight="600">${MoneyService.format(maxVal / 2)}</text>
        <text x="${padding.left - 6}" y="${padding.top + chartH + 3}" text-anchor="end" font-size="9" fill="#94a3b8" font-weight="600">R$ 0</text>

        <!-- Área de Faturamento -->
        <polygon points="${revAreaPoints}" fill="url(#revGrad)"/>

        <!-- Linha de Compras (Roxa) -->
        <polyline points="${purchasesPoints}" fill="none" stroke="#a855f7" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>

        <!-- Linha de Lucro (Azul) -->
        <polyline points="${profitPoints}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>

        <!-- Linha de Faturamento (Verde) -->
        <polyline points="${revPoints}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>

        <!-- X Axis Labels -->
        ${series.map((s, idx) => {
          if (idx % labelStep !== 0 && idx !== series.length - 1) return '';
          const x = padding.left + (series.length > 1 ? idx * stepX : chartW / 2);
          return `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#64748b" font-weight="600">${s.label}</text>`;
        }).join('')}
      </svg>
    `;
  }

  /**
   * Renderiza gráfico Donut SVG de distribuição por categoria.
   */
  _renderCategoryDonutSVG(categories) {
    if (!categories || categories.length === 0) {
      return `<div class="text-center text-slate-400 text-xs py-6">Nenhuma categoria registrada</div>`;
    }

    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b'];

    return `
      <div class="space-y-3">
        ${categories.slice(0, 5).map((cat, idx) => {
          const color = colors[idx % colors.length];
          return `
            <div class="space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-slate-800 flex items-center gap-1.5">
                  <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${color}"></span>
                  ${this._esc(cat.categoryName)}
                </span>
                <span class="font-black text-slate-900">${cat.sharePercent}% (${MoneyService.format(cat.revenueCents)})</span>
              </div>
              <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full rounded-full transition-all duration-500" style="width: ${Math.max(2, cat.sharePercent)}%; background-color: ${color};"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderLoadingSkeleton() {
    return `
      <div class="space-y-6 animate-pulse">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          ${Array(6).fill(0).map(() => `
            <div class="bg-white p-4 rounded-2xl border border-slate-200 h-28 flex flex-col justify-between">
              <div class="h-3 w-16 bg-slate-200 rounded"></div>
              <div class="h-6 w-24 bg-slate-200 rounded"></div>
              <div class="h-3 w-20 bg-slate-100 rounded"></div>
            </div>
          `).join('')}
        </div>
        <div class="bg-white p-6 rounded-2xl border border-slate-200 h-80"></div>
      </div>
    `;
  }

  _bindPeriodEvents() {
    const container = this.rootElement.querySelector('#period-buttons-container');
    const customContainer = this.rootElement.querySelector('#custom-date-container');
    const startDateInput = this.rootElement.querySelector('#custom-start-date');
    const endDateInput = this.rootElement.querySelector('#custom-end-date');
    const applyCustomBtn = this.rootElement.querySelector('#btn-apply-custom-date');
    const refreshBtn = this.rootElement.querySelector('#btn-refresh-dashboard');

    if (container) {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-btn');
        if (!btn) return;

        const period = btn.dataset.period;
        this.periodType = period;

        // Atualizar classes dos botões
        container.querySelectorAll('.period-btn').forEach(b => {
          b.className = 'period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition border border-slate-200 text-slate-600 hover:bg-slate-50';
        });
        btn.className = 'period-btn px-3 py-1.5 rounded-lg text-xs font-bold transition bg-blue-600 text-white border border-blue-600 shadow-xs';

        if (period === PERIOD_TYPES.CUSTOM) {
          if (customContainer) customContainer.classList.remove('hidden');
        } else {
          if (customContainer) customContainer.classList.add('hidden');
          this.loadData();
        }
      });
    }

    if (applyCustomBtn && startDateInput && endDateInput) {
      applyCustomBtn.addEventListener('click', () => {
        this.customStartDate = startDateInput.value || null;
        this.customEndDate = endDateInput.value || null;
        this.loadData();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadData());
    }
  }

  _bindTabEvents() {
    const tabsContainer = this.rootElement.querySelector('#dashboard-tabs-container');
    if (tabsContainer) {
      tabsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;

        const tab = btn.dataset.tab;
        this.activeTab = tab;

        tabsContainer.querySelectorAll('.tab-btn').forEach(b => {
          b.className = 'tab-btn px-4 py-2 rounded-xl text-xs font-bold transition text-slate-600 hover:bg-slate-100';
        });
        btn.className = 'tab-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-slate-900 text-white shadow-xs';

        const area = this.rootElement.querySelector('#tab-content-area');
        if (area) area.innerHTML = this._renderActiveTabContent();
      });
    }

    // Switch tab buttons from inside overview
    this.rootElement.querySelectorAll('[data-switch-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.dataset.switchTab;
        const tabBtn = this.rootElement.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
        if (tabBtn) tabBtn.click();
      });
    });
  }

  _bindRealtimeEvents() {
    const refresh = () => {
      // Atualizar automaticamente se o usuário estiver visualizando o dashboard
      if (document.body.contains(this.rootElement)) {
        this.loadData();
      }
    };

    const unsubSale = eventBus.on(EVENTS.SALE_CREATED, refresh);
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, refresh);
    const unsubProduct = eventBus.on(EVENTS.PRODUCT_UPDATED, refresh);
    const unsubPurchase = eventBus.on('PURCHASE_CREATED', refresh);
    const unsubPurchaseCancel = eventBus.on('PURCHASE_CANCELLED', refresh);

    this.cleanupListeners.push(unsubSale, unsubStock, unsubProduct, unsubPurchase, unsubPurchaseCancel);
  }

  destroy() {
    this.cleanupListeners.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.cleanupListeners = [];
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
