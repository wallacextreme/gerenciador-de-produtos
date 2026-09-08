import { SaleService } from '../services/SaleService.js';
import { PAYMENT_METHODS } from '../validators/SaleValidator.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { MoneyService } from '../domain/MoneyService.js';
import { MarginService } from '../domain/MarginService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class SalesPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.sales = [];
    this.allProducts = [];
    this.metrics = {};
    this.topSellers = [];
    this.cleanupListeners = [];
    this.thumbnailUrls = new Map();
    this.searchDebounceTimer = null;
    
    // Filtros
    this.searchQuery = '';
    this.selectedPeriod = 'ALL'; // ALL, TODAY, WEEK, MONTH
    this.selectedPaymentMethod = '';
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Top Metrics Cards -->
        <div id="sales-metrics" class="grid grid-cols-2 lg:grid-cols-5 gap-4">
          ${this._renderSkeletonMetrics()}
        </div>

        <!-- Toolbar & Filter Bar -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <!-- Top Row: Search & New Sale Button -->
          <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="flex-1 relative">
              <input type="text" id="sales-search-input" value="${this._esc(this.searchQuery)}"
                     placeholder="Buscar por produto, cliente, observações ou ID da venda..."
                     class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              <svg class="w-5 h-5 text-slate-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            
            <button id="btn-open-sale-modal" class="bg-emerald-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-2 whitespace-nowrap">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Nova Venda (PDV)
            </button>
          </div>

          <!-- Bottom Row: Period Filter & Payment Filter -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-sm">
            <div class="flex flex-wrap items-center gap-1.5" id="sales-period-pills">
              <button data-period="ALL" class="period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.selectedPeriod === 'ALL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Todas
              </button>
              <button data-period="TODAY" class="period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.selectedPeriod === 'TODAY' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Hoje
              </button>
              <button data-period="WEEK" class="period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.selectedPeriod === 'WEEK' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Últimos 7 dias
              </button>
              <button data-period="MONTH" class="period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.selectedPeriod === 'MONTH' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Este Mês
              </button>
            </div>

            <!-- Payment Method Filter -->
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-xs text-slate-400 font-medium hidden sm:inline">Pagamento:</span>
              <select id="filter-payment-method" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none focus:border-blue-600">
                <option value="">Todas as Formas</option>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                <option value="CARTAO_DEBITO">Cartão de Débito</option>
                <option value="BOLETO">Boleto</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Sales Table / List -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col">
          <div class="overflow-x-auto flex-1">
            <table class="w-full text-left text-sm text-slate-600">
              <thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th scope="col" class="py-3.5 px-4">Data / Venda</th>
                  <th scope="col" class="py-3.5 px-3">Produto</th>
                  <th scope="col" class="py-3.5 px-3">Cliente</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Qtd</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Total da Venda</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Lucro Bruto</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Pagamento</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody id="sales-table-body" class="divide-y divide-slate-100">
                ${this._renderSkeletonRows()}
              </tbody>
            </table>
          </div>

          <!-- Empty State -->
          <div id="sales-empty-state" class="hidden flex-col items-center justify-center p-12 text-center">
            <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-1">Nenhuma venda registrada</h3>
            <p class="text-xs text-slate-500 max-w-sm mb-4">Nenhuma venda corresponde aos filtros selecionados ou nenhuma transação foi realizada ainda.</p>
            <button id="empty-state-new-sale-btn" class="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition">
              Registrar Primeira Venda
            </button>
          </div>
        </div>

        <!-- Container for Modals -->
        <div id="sales-modal-container"></div>

      </div>
    `;

    this.bindEvents();
    await this.loadData();
    this.subscribeEvents();
  }

  async loadData() {
    try {
      this._revokeThumbnailUrls();

      // Determinar filtro de datas com base no período selecionado
      let startDate = null;
      const now = new Date();
      if (this.selectedPeriod === 'TODAY') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        startDate = start.toISOString();
      } else if (this.selectedPeriod === 'WEEK') {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = start.toISOString();
      } else if (this.selectedPeriod === 'MONTH') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        startDate = start.toISOString();
      }

      const filters = {
        search: this.searchQuery,
        paymentMethod: this.selectedPaymentMethod || undefined,
        startDate: startDate || undefined
      };

      const overview = await SaleService.getSalesOverview(filters);
      this.sales = overview.sales;
      this.metrics = overview.metrics;
      this.topSellers = overview.topSellingProducts;

      // Buscar produtos ativos para o select de venda
      this.allProducts = await productRepository.list({ status: 'active' });

      // Carregar thumbnails
      await this._loadThumbnails();

      this.renderMetrics();
      this.renderTable();
    } catch (e) {
      console.error('Erro ao carregar dados de vendas:', e);
      const tbody = this.rootElement.querySelector('#sales-table-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500">Erro ao carregar vendas: ${e.message}</td></tr>`;
      }
    }
  }

  async _loadThumbnails() {
    for (const s of this.sales) {
      if (!this.thumbnailUrls.has(s.productId)) {
        try {
          const primaryImg = await productImageRepository.getPrimaryImage(s.productId);
          if (primaryImg && (primaryImg.thumbnailBlob || primaryImg.blob)) {
            const url = URL.createObjectURL(primaryImg.thumbnailBlob || primaryImg.blob);
            this.thumbnailUrls.set(s.productId, url);
          }
        } catch {
          // Fallback silencioso
        }
      }
    }
  }

  _revokeThumbnailUrls() {
    for (const url of this.thumbnailUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.thumbnailUrls.clear();
  }

  renderMetrics() {
    const m = this.metrics || {};
    const metricsEl = this.rootElement.querySelector('#sales-metrics');
    if (!metricsEl) return;

    metricsEl.innerHTML = `
      <!-- Total Revenue -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Faturamento Total</span>
          <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-emerald-700 mt-2">${MoneyService.format(m.totalRevenueCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Total bruto vendido</span>
      </div>

      <!-- Total Profit -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Lucro Bruto Total</span>
          <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-blue-700 mt-2">${MoneyService.format(m.totalProfitCents ?? 0)}</p>
        <span class="text-[11px] font-semibold ${m.averageMarginPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
          Margem Média: ${m.averageMarginPercent ? m.averageMarginPercent.toFixed(2) + '%' : '0,00%'}
        </span>
      </div>

      <!-- Total Cost -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Custo dos Produtos</span>
          <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          </div>
        </div>
        <p class="text-xl font-black text-indigo-700 mt-2">${MoneyService.format(m.totalCostCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Custo histórico das vendas</span>
      </div>

      <!-- Average Ticket -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Ticket Médio</span>
          <div class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
        </div>
        <p class="text-xl font-black text-amber-700 mt-2">${MoneyService.format(m.averageTicketCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Média por transação</span>
      </div>

      <!-- Volume of Sales -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs col-span-2 lg:col-span-1">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Vendas Realizadas</span>
          <div class="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-purple-700 mt-2">${m.totalSalesCount ?? 0} <span class="text-xs font-medium text-purple-600">vendas</span></p>
        <span class="text-[11px] text-slate-400">${m.totalUnitsSold ?? 0} unidades vendidas</span>
      </div>
    `;
  }

  renderTable() {
    const tbody = this.rootElement.querySelector('#sales-table-body');
    const emptyEl = this.rootElement.querySelector('#sales-empty-state');
    if (!tbody || !emptyEl) return;

    if (this.sales.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.classList.add('flex');
      return;
    }

    emptyEl.classList.add('hidden');
    emptyEl.classList.remove('flex');

    tbody.innerHTML = this.sales.map(s => {
      const thumb = this.thumbnailUrls.get(s.productId);
      const isCancelled = !!s.cancelledAt;
      const dateStr = new Date(s.date || s.createdAt).toLocaleString('pt-BR');
      const totalFormatted = MoneyService.format(s.totalSaleCents);
      const profitFormatted = MoneyService.format(s.profitCents);
      const unitPriceFormatted = MoneyService.format(s.unitSalePriceCents);
      const paymentBadge = this._renderPaymentBadge(s.paymentMethod);

      return `
        <tr class="hover:bg-slate-50/80 transition-colors group ${isCancelled ? 'opacity-50 bg-slate-50' : ''}">
          <!-- Data / Venda ID -->
          <td class="py-3 px-4 whitespace-nowrap">
            <div class="text-xs font-bold text-slate-800">${dateStr}</div>
            <div class="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span>#${s.id.slice(0, 8)}</span>
              ${isCancelled ? '<span class="px-1.5 py-0.2 bg-rose-100 text-rose-800 font-bold rounded">Cancelada</span>' : ''}
            </div>
          </td>

          <!-- Produto -->
          <td class="py-3 px-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 bg-slate-100 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                ${thumb
                  ? `<img src="${thumb}" alt="${this._esc(s.productName)}" class="w-full h-full object-cover">`
                  : `<svg class="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`}
              </div>
              <div class="min-w-0">
                <a href="#/produtos/detalhes/${s.productId}" class="font-semibold text-slate-800 hover:text-blue-600 transition truncate block max-w-xs text-xs">
                  ${this._esc(s.productName)}
                </a>
                <span class="text-[10px] font-mono text-slate-400">${this._esc(s.productCode) || 'Sem SKU'}</span>
              </div>
            </div>
          </td>

          <!-- Cliente -->
          <td class="py-3 px-3 whitespace-nowrap text-xs">
            <span class="font-medium text-slate-700">${this._esc(s.customerName) || '<span class="text-slate-400 italic">Consumidor</span>'}</span>
          </td>

          <!-- Quantidade -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <span class="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-800">
              ${s.quantity} un
            </span>
          </td>

          <!-- Total da Venda -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="font-black text-slate-900 text-sm">${totalFormatted}</div>
            <div class="text-[10px] text-slate-400 font-medium">Un: ${unitPriceFormatted}</div>
          </td>

          <!-- Lucro Bruto -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="font-bold text-xs ${s.profitCents >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
              ${profitFormatted}
            </div>
            <div class="text-[10px] font-semibold text-slate-400">
              Margem: ${s.marginPercent ? s.marginPercent.toFixed(1) + '%' : '0%'}
            </div>
          </td>

          <!-- Forma de Pagamento -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            ${paymentBadge}
          </td>

          <!-- Ações -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1">
              <button data-action="view-receipt" data-sale-id="${s.id}" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Ver Recibo / Comprovante">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </button>

              ${!isCancelled ? `
                <button data-action="cancel-sale" data-sale-id="${s.id}" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Estornar / Cancelar Venda">
                  <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  _renderPaymentBadge(method) {
    switch (method) {
      case 'PIX':
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">PIX</span>`;
      case 'CARTAO_CREDITO':
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">Crédito</span>`;
      case 'CARTAO_DEBITO':
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 text-cyan-800">Débito</span>`;
      case 'BOLETO':
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Boleto</span>`;
      case 'DINHEIRO':
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Dinheiro</span>`;
      default:
        return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${method || 'Outro'}</span>`;
    }
  }

  bindEvents() {
    // 1. Search Debounce
    const searchInput = this.rootElement.querySelector('#sales-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.searchQuery = e.target.value;
          this.loadData();
        }, 300);
      });
    }

    // 2. Period Pills
    const periodContainer = this.rootElement.querySelector('#sales-period-pills');
    if (periodContainer) {
      periodContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.period-pill');
        if (!btn) return;
        this.selectedPeriod = btn.dataset.period;

        periodContainer.querySelectorAll('.period-pill').forEach(b => {
          b.className = 'period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-100 text-slate-600 hover:bg-slate-200';
        });
        btn.className = 'period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-blue-600 text-white shadow-xs';

        this.loadData();
      });
    }

    // 3. Payment Method Filter
    const paymentSelect = this.rootElement.querySelector('#filter-payment-method');
    if (paymentSelect) {
      paymentSelect.addEventListener('change', (e) => {
        this.selectedPaymentMethod = e.target.value;
        this.loadData();
      });
    }

    // 4. Botão Nova Venda
    const btnNewSale = this.rootElement.querySelector('#btn-open-sale-modal');
    btnNewSale?.addEventListener('click', () => this.openNewSaleModal());

    const btnEmptySale = this.rootElement.querySelector('#empty-state-new-sale-btn');
    btnEmptySale?.addEventListener('click', () => this.openNewSaleModal());

    // 5. Table actions
    const tbody = this.rootElement.querySelector('#sales-table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const saleId = btn.dataset.saleId;
        const sale = this.sales.find(s => s.id === saleId);

        if (action === 'view-receipt' && sale) {
          this.openReceiptModal(sale);
        } else if (action === 'cancel-sale' && sale) {
          this.handleCancelSale(sale);
        }
      });
    }
  }

  // ==========================================
  // MODAL DE REGISTRO DE VENDA (PDV)
  // ==========================================

  openNewSaleModal() {
    const modalContainer = this.rootElement.querySelector('#sales-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-50/50">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 bg-emerald-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 shadow-xs">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-800">Registrar Venda (PDV)</h3>
                <p class="text-xs text-slate-500">Baixa automática de estoque e cálculo de margem</p>
              </div>
            </div>
            <button id="sale-modal-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body / Form -->
          <form id="new-sale-form" class="p-6 space-y-4">
            <!-- Seleção de Produto -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Produto <span class="text-red-500">*</span></label>
              <select id="sale-product-id" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600">
                <option value="">Selecione o produto...</option>
                ${this.allProducts.map(p => `
                  <option value="${p.id}" data-price="${p.salePriceCents || 0}" data-cost="${p.purchasePriceCents || 0}" data-stock="${p.stockQuantity || 0}">
                    ${this._esc(p.name)} (${p.productCode ? 'SKU: ' + p.productCode + ' - ' : ''}Estoque: ${p.stockQuantity || 0} un - Venda: ${MoneyService.format(p.salePriceCents)})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Quantidade e Preço Unitário -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Quantidade <span class="text-red-500">*</span></label>
                <input type="number" id="sale-quantity" min="1" step="1" value="1"
                       class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-base font-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600">
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Preço Unitário (R$)</label>
                <input type="text" id="sale-unit-price" value="R$ 0,00"
                       class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-base font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600">
              </div>
            </div>

            <!-- Forma de Pagamento e Cliente -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Pagamento <span class="text-red-500">*</span></label>
                <select id="sale-payment-method" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:border-emerald-600">
                  <option value="DINHEIRO">Dinheiro</option>
                  <option value="PIX" selected>PIX</option>
                  <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                  <option value="CARTAO_DEBITO">Cartão de Débito</option>
                  <option value="BOLETO">Boleto</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Cliente (Opcional)</label>
                <input type="text" id="sale-customer-name" placeholder="Nome do comprador..."
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:border-emerald-600">
              </div>
            </div>

            <!-- Observações -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Observações da Venda (Opcional)</label>
              <input type="text" id="sale-notes" placeholder="Descontos, garantias ou número de pedido..."
                     class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-emerald-600">
            </div>

            <!-- Resumo Financeiro da Transação -->
            <div class="p-4 bg-gradient-to-br from-emerald-50 to-slate-50 rounded-xl border border-emerald-200/80 space-y-2 text-xs">
              <div class="flex justify-between items-center text-slate-600">
                <span>Subtotal da Venda:</span>
                <strong id="sale-preview-total" class="text-base text-slate-900 font-black">R$ 0,00</strong>
              </div>
              <div class="flex justify-between items-center text-slate-500 pt-1 border-t border-emerald-100">
                <span>Lucro Bruto Previsto:</span>
                <span id="sale-preview-profit" class="font-bold text-emerald-700">R$ 0,00 (0%)</span>
              </div>
              <div class="flex justify-between items-center text-slate-500">
                <span>Impacto no Estoque:</span>
                <span id="sale-preview-stock" class="font-semibold text-slate-700">0 un → 0 un</span>
              </div>
            </div>

            <!-- Feedback de Erro -->
            <div id="sale-error-msg" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"></div>

            <!-- Footer / Botões -->
            <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" id="sale-modal-cancel-btn" class="px-4 py-2 text-slate-600 text-xs font-semibold hover:bg-slate-100 rounded-lg transition">
                Cancelar
              </button>
              <button type="submit" id="btn-submit-sale" class="px-5 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                Finalizar Venda
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    this._bindNewSaleModalEvents();
  }

  _bindNewSaleModalEvents() {
    const container = this.rootElement.querySelector('#sales-modal-container');
    const closeBtn = container.querySelector('#sale-modal-close-btn');
    const cancelBtn = container.querySelector('#sale-modal-cancel-btn');
    const form = container.querySelector('#new-sale-form');
    const productSelect = container.querySelector('#sale-product-id');
    const qtyInput = container.querySelector('#sale-quantity');
    const unitPriceInput = container.querySelector('#sale-unit-price');
    const customerInput = container.querySelector('#sale-customer-name');
    const paymentSelect = container.querySelector('#sale-payment-method');
    const notesInput = container.querySelector('#sale-notes');
    const errorMsg = container.querySelector('#sale-error-msg');

    const closeModal = () => { container.innerHTML = ''; };
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    const updatePreview = () => {
      const selectedOpt = productSelect.options[productSelect.selectedIndex];
      if (!selectedOpt || !productSelect.value) {
        container.querySelector('#sale-preview-total').textContent = 'R$ 0,00';
        container.querySelector('#sale-preview-profit').textContent = 'R$ 0,00 (0%)';
        container.querySelector('#sale-preview-stock').textContent = 'Selecione um produto';
        return;
      }

      const costCents = parseInt(selectedOpt.dataset.cost, 10) || 0;
      const stock = parseInt(selectedOpt.dataset.stock, 10) || 0;
      const qty = parseInt(qtyInput.value, 10) || 0;
      const unitPriceCents = MoneyService.toCents(unitPriceInput.value);

      const totalSaleCents = qty * unitPriceCents;
      const totalCostCents = qty * costCents;
      const profitCents = totalSaleCents - totalCostCents;
      const margin = MarginService.calculateMargin(totalSaleCents, totalCostCents);
      const remainingStock = stock - qty;

      container.querySelector('#sale-preview-total').textContent = MoneyService.format(totalSaleCents);
      container.querySelector('#sale-preview-profit').textContent = `${MoneyService.format(profitCents)} (${margin ? margin.toFixed(1) + '%' : '0%'})`;
      
      const stockPreviewEl = container.querySelector('#sale-preview-stock');
      if (remainingStock < 0) {
        stockPreviewEl.innerHTML = `<span class="text-rose-600 font-bold">${stock} un → ${remainingStock} un (Estoque Insuficiente!)</span>`;
      } else {
        stockPreviewEl.innerHTML = `<span class="text-slate-700">${stock} un → <strong class="text-emerald-700">${remainingStock} un</strong></span>`;
      }
    };

    // Preencher preço ao selecionar produto
    productSelect?.addEventListener('change', () => {
      const selectedOpt = productSelect.options[productSelect.selectedIndex];
      if (selectedOpt && productSelect.value) {
        const defaultPrice = parseInt(selectedOpt.dataset.price, 10) || 0;
        unitPriceInput.value = MoneyService.format(defaultPrice);
      }
      updatePreview();
    });

    unitPriceInput?.addEventListener('blur', (e) => {
      const cents = MoneyService.toCents(e.target.value);
      e.target.value = MoneyService.format(cents);
      updatePreview();
    });

    qtyInput?.addEventListener('input', updatePreview);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const productId = productSelect.value;
      if (!productId) {
        errorMsg.textContent = 'Por favor, selecione um produto para a venda.';
        errorMsg.classList.remove('hidden');
        return;
      }

      const quantity = parseInt(qtyInput.value, 10);
      const unitSalePriceCents = MoneyService.toCents(unitPriceInput.value);
      const customerName = customerInput.value.trim();
      const paymentMethod = paymentSelect.value;
      const notes = notesInput.value.trim();

      const btnSubmit = container.querySelector('#btn-submit-sale');
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<svg class="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Concluindo Venda...`;

      try {
        await SaleService.recordSale({
          productId,
          quantity,
          unitSalePriceCents,
          customerName,
          paymentMethod,
          notes
        });

        closeModal();
        await this.loadData();
      } catch (err) {
        errorMsg.textContent = err.message || 'Erro ao registrar venda.';
        errorMsg.classList.remove('hidden');
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Finalizar Venda`;
      }
    });
  }

  // ==========================================
  // MODAL DE COMPROVANTE / RECIBO
  // ==========================================

  openReceiptModal(sale) {
    const modalContainer = this.rootElement.querySelector('#sales-modal-container');
    if (!modalContainer) return;

    const dateStr = new Date(sale.date || sale.createdAt).toLocaleString('pt-BR');
    const totalFormatted = MoneyService.format(sale.totalSaleCents);
    const unitPriceFormatted = MoneyService.format(sale.unitSalePriceCents);
    const unitCostFormatted = MoneyService.format(sale.unitCostCents);
    const profitFormatted = MoneyService.format(sale.profitCents);
    const isCancelled = !!sale.cancelledAt;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 class="text-base font-bold text-slate-800">Comprovante de Venda</h3>
              <p class="text-xs text-slate-500">ID: #${sale.id.slice(0, 8)}</p>
            </div>
            <button id="receipt-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6 space-y-4 text-xs">
            ${isCancelled ? `
              <div class="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">
                <strong class="font-bold block">VENDA CANCELADA / ESTORNADA</strong>
                <span>Motivo: ${this._esc(sale.cancelReason) || 'Cancelamento solicitado'}</span>
              </div>
            ` : ''}

            <div class="border-b border-dashed border-slate-200 pb-3 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-slate-500">Data e Hora:</span>
                <span class="font-semibold text-slate-800">${dateStr}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Cliente:</span>
                <span class="font-semibold text-slate-800">${this._esc(sale.customerName) || 'Consumidor Final'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Forma de Pagamento:</span>
                <span class="font-semibold text-slate-800">${sale.paymentMethod || 'Dinheiro'}</span>
              </div>
            </div>

            <div class="space-y-2 border-b border-dashed border-slate-200 pb-3">
              <div class="flex justify-between">
                <span class="text-slate-700 font-bold">${this._esc(sale.productName)}</span>
                <span class="font-semibold text-slate-800">${sale.quantity}x ${unitPriceFormatted}</span>
              </div>
              <div class="flex justify-between text-slate-400 text-[11px]">
                <span>SKU: ${this._esc(sale.productCode) || '-'}</span>
                <span>Custo Snapshot: ${unitCostFormatted}</span>
              </div>
            </div>

            <div class="space-y-1.5 text-sm">
              <div class="flex justify-between font-black text-slate-900 text-base">
                <span>TOTAL:</span>
                <span class="text-emerald-700">${totalFormatted}</span>
              </div>
              <div class="flex justify-between text-xs text-slate-500">
                <span>Lucro Bruto:</span>
                <span class="font-bold text-slate-700">${profitFormatted} (${sale.marginPercent ? sale.marginPercent.toFixed(1) + '%' : '0%'})</span>
              </div>
            </div>

            ${sale.notes ? `
              <div class="p-2.5 bg-slate-50 rounded-lg text-slate-500 italic">
                Nota: ${this._esc(sale.notes)}
              </div>
            ` : ''}
          </div>

          <div class="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
            <button id="btn-print-receipt" class="px-3.5 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition">
              <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              Imprimir
            </button>
            <button id="receipt-done-btn" class="px-4 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-xs font-semibold transition">
              Fechar
            </button>
          </div>

        </div>
      </div>
    `;

    const closeModal = () => { modalContainer.innerHTML = ''; };
    modalContainer.querySelector('#receipt-close-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#receipt-done-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#btn-print-receipt')?.addEventListener('click', () => window.print());
  }

  // ==========================================
  // CANCELAMENTO / ESTORNO DE VENDA
  // ==========================================

  async handleCancelSale(sale) {
    const reason = prompt(`Deseja realmente estornar a venda do produto "${sale.productName}" (${sale.quantity} unidades)?\n\nInforme o motivo do cancelamento:`, 'Cliente solicitou cancelamento');
    if (reason === null) return;

    try {
      await SaleService.cancelSale(sale.id, reason);
      alert('Venda cancelada com sucesso! O estoque das mercadorias foi reposto automaticamente.');
      await this.loadData();
    } catch (e) {
      alert('Erro ao cancelar venda: ' + e.message);
    }
  }

  // ==========================================
  // MULTIABA & CLEANUP
  // ==========================================

  subscribeEvents() {
    const unsubSale = eventBus.on(EVENTS.SALE_CREATED, () => this.loadData());
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, () => this.loadData());
    const unsubProduct = eventBus.on(EVENTS.PRODUCT_UPDATED, () => this.loadData());

    this.cleanupListeners.push(unsubSale, unsubStock, unsubProduct);
  }

  destroy() {
    this._revokeThumbnailUrls();
    clearTimeout(this.searchDebounceTimer);
    this.cleanupListeners.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.cleanupListeners = [];
  }

  _renderSkeletonMetrics() {
    return Array(5).fill(0).map(() => `
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs animate-pulse">
        <div class="h-3 bg-slate-200 rounded w-20 mb-3"></div>
        <div class="h-6 bg-slate-200 rounded w-28 mb-2"></div>
        <div class="h-2.5 bg-slate-100 rounded w-16"></div>
      </div>
    `).join('');
  }

  _renderSkeletonRows() {
    return Array(5).fill(0).map(() => `
      <tr class="animate-pulse">
        <td class="py-3 px-4"><div class="h-3.5 bg-slate-200 rounded w-28 mb-1"></div><div class="h-2.5 bg-slate-100 rounded w-16"></div></td>
        <td class="py-3 px-3 flex items-center gap-2"><div class="w-8 h-8 bg-slate-200 rounded-lg"></div><div class="h-3 bg-slate-200 rounded w-24"></div></td>
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-20"></div></td>
        <td class="py-3 px-3 text-center"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-4 bg-slate-200 rounded w-14 ml-auto"></div></td>
        <td class="py-3 px-3 text-center"><div class="h-4 bg-slate-200 rounded w-12 mx-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-5 bg-slate-200 rounded w-16 ml-auto"></div></td>
      </tr>
    `).join('');
  }

  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }
}
