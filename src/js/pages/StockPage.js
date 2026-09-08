import { StockService, STOCK_STATUS } from '../services/StockService.js';
import { MOVEMENT_TYPES } from '../validators/StockValidator.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { MoneyService } from '../domain/MoneyService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class StockPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.products = [];
    this.allProductsList = []; // Para o select do modal
    this.metrics = {};
    this.categories = [];
    this.cleanupListeners = [];
    this.thumbnailUrls = new Map();
    this.searchDebounceTimer = null;
    this.activeFilter = 'ALL'; // ALL, LOW_STOCK, OUT_OF_STOCK, NORMAL, EXCESS_STOCK
    this.searchQuery = '';
    this.selectedCategory = '';
    
    // Modal states
    this.activeModal = null; // 'movement' | 'history' | 'adjust'
    this.modalProduct = null;
    this.historyData = [];
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Top Metrics Cards -->
        <div id="stock-metrics" class="grid grid-cols-2 lg:grid-cols-5 gap-4">
          ${this._renderSkeletonMetrics()}
        </div>

        <!-- Toolbar & Filter Bar -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <!-- Top Row: Search & Actions -->
          <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="flex-1 relative">
              <input type="text" id="stock-search-input" value="${this._esc(this.searchQuery)}"
                     placeholder="Buscar por produto, SKU, código interno ou código de barras..."
                     class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              <svg class="w-5 h-5 text-slate-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            
            <div class="flex items-center gap-2">
              <button id="btn-recalculate-stock" class="px-3.5 py-2.5 border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded-lg transition flex items-center gap-2" title="Verificar integridade do somatório de estoque">
                <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                <span class="hidden sm:inline">Auditar Saldo</span>
              </button>

              <button id="btn-open-movement-modal" class="bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-2 whitespace-nowrap">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                Nova Movimentação
              </button>
            </div>
          </div>

          <!-- Bottom Row: Filter Tabs and Category -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-sm">
            <!-- Filter Pills -->
            <div class="flex flex-wrap items-center gap-1.5" id="filter-pills">
              <button data-filter="ALL" class="filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.activeFilter === 'ALL' ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                Todos (<span id="count-all">0</span>)
              </button>
              <button data-filter="LOW_STOCK" class="filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.activeFilter === 'LOW_STOCK' ? 'bg-amber-500 text-white shadow-xs' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}">
                Estoque Baixo (<span id="count-low">0</span>)
              </button>
              <button data-filter="OUT_OF_STOCK" class="filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.activeFilter === 'OUT_OF_STOCK' ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}">
                Esgotados (<span id="count-out">0</span>)
              </button>
              <button data-filter="NORMAL" class="filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.activeFilter === 'NORMAL' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}">
                Normais (<span id="count-normal">0</span>)
              </button>
              <button data-filter="EXCESS_STOCK" class="filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition ${this.activeFilter === 'EXCESS_STOCK' ? 'bg-purple-600 text-white shadow-xs' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}">
                Excesso (<span id="count-excess">0</span>)
              </button>
            </div>

            <!-- Category Filter -->
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-xs text-slate-400 font-medium hidden sm:inline">Categoria:</span>
              <select id="filter-stock-category" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none focus:border-blue-600">
                <option value="">Todas as Categorias</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Products Stock Table / List -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col">
          <div class="overflow-x-auto flex-1">
            <table class="w-full text-left text-sm text-slate-600">
              <thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th scope="col" class="py-3.5 px-4">Produto</th>
                  <th scope="col" class="py-3.5 px-3">Valores (Custo / Venda)</th>
                  <th scope="col" class="py-3.5 px-3">Mín / Máx</th>
                  <th scope="col" class="py-3.5 px-4 text-center">Saldo Atual</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Nível de Estoque</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Ações de Movimentação</th>
                </tr>
              </thead>
              <tbody id="stock-table-body" class="divide-y divide-slate-100">
                <!-- Rows injected dynamically -->
                ${this._renderSkeletonRows()}
              </tbody>
            </table>
          </div>

          <!-- Empty State -->
          <div id="stock-empty-state" class="hidden flex-col items-center justify-center p-12 text-center">
            <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-1">Nenhum registro de estoque encontrado</h3>
            <p class="text-xs text-slate-500 max-w-sm">Nenhum produto corresponde aos filtros ou critérios de busca selecionados.</p>
          </div>
        </div>

        <!-- Container for Modals -->
        <div id="modal-container"></div>

      </div>
    `;

    this.bindEvents();
    await this.loadData();
    this.subscribeEvents();
  }

  async loadData() {
    try {
      this._revokeThumbnailUrls();

      // Buscar categorias para o filtro
      this.categories = await productRepository.getCategories();
      this._populateCategorySelect();

      // Buscar visão geral de estoque
      const filterParams = {
        search: this.searchQuery,
        category: this.selectedCategory,
        status: this.activeFilter === 'ALL' ? undefined : this.activeFilter
      };

      const result = await StockService.getStockOverview(filterParams);
      this.products = result.products;
      this.metrics = result.metrics;

      // Buscar todos os produtos ativos enriquecidos para o select do modal
      const allOverview = await StockService.getStockOverview({});
      this.allProductsList = allOverview.products;

      // Carregar thumbnails para os produtos visíveis
      await this._loadThumbnails();

      this.renderMetrics();
      this.renderTable();
    } catch (e) {
      console.error('Erro ao carregar dados de estoque:', e);
      const tbody = this.rootElement.querySelector('#stock-table-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500">Erro ao carregar estoque: ${e.message}</td></tr>`;
      }
    }
  }

  async _loadThumbnails() {
    for (const p of this.products) {
      if (!this.thumbnailUrls.has(p.id)) {
        try {
          const primaryImg = await productImageRepository.getPrimaryImage(p.id);
          if (primaryImg && (primaryImg.thumbnailBlob || primaryImg.blob)) {
            const url = URL.createObjectURL(primaryImg.thumbnailBlob || primaryImg.blob);
            this.thumbnailUrls.set(p.id, url);
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

  _populateCategorySelect() {
    const sel = this.rootElement.querySelector('#filter-stock-category');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas as Categorias</option>';
    this.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === this.selectedCategory) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  renderMetrics() {
    const m = this.metrics || {};
    const metricsEl = this.rootElement.querySelector('#stock-metrics');
    if (!metricsEl) return;

    metricsEl.innerHTML = `
      <!-- Total Units -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Total de Itens</span>
          <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-slate-800 mt-2">${m.totalUnits ?? 0} <span class="text-xs font-normal text-slate-400">unidades</span></p>
        <span class="text-[11px] text-slate-400">${m.totalProducts ?? 0} produtos cadastrados</span>
      </div>

      <!-- Total Cost Value -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Estoque a Custo</span>
          <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
        <p class="text-xl font-black text-indigo-700 mt-2">${MoneyService.format(m.totalCostCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Patrimônio imobilizado</span>
      </div>

      <!-- Total Sale Value -->
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Estoque a Venda</span>
          <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
          </div>
        </div>
        <p class="text-xl font-black text-emerald-700 mt-2">${MoneyService.format(m.totalSaleCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Potencial de faturamento</span>
      </div>

      <!-- Low Stock Alert Card -->
      <div class="bg-white p-4 rounded-xl border border-amber-200 shadow-xs bg-amber-50/20 cursor-pointer hover:border-amber-400 transition" id="card-filter-low">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-amber-800 uppercase">Estoque Baixo</span>
          <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-amber-700 mt-2">${m.lowStockCount ?? 0} <span class="text-xs font-medium text-amber-600">itens</span></p>
        <span class="text-[11px] text-amber-700 font-medium">Requer reposição</span>
      </div>

      <!-- Out of Stock Card -->
      <div class="bg-white p-4 rounded-xl border border-rose-200 shadow-xs bg-rose-50/20 cursor-pointer hover:border-rose-400 transition col-span-2 lg:col-span-1" id="card-filter-out">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-rose-800 uppercase">Esgotados</span>
          <div class="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-rose-700 mt-2">${m.outOfStockCount ?? 0} <span class="text-xs font-medium text-rose-600">itens</span></p>
        <span class="text-[11px] text-rose-700 font-medium">Sem estoque disponível</span>
      </div>
    `;

    // Atualizar contadores das pílulas
    const countAll = this.rootElement.querySelector('#count-all');
    const countLow = this.rootElement.querySelector('#count-low');
    const countOut = this.rootElement.querySelector('#count-out');
    const countNormal = this.rootElement.querySelector('#count-normal');
    const countExcess = this.rootElement.querySelector('#count-excess');

    if (countAll) countAll.textContent = m.totalProducts ?? 0;
    if (countLow) countLow.textContent = m.lowStockCount ?? 0;
    if (countOut) countOut.textContent = m.outOfStockCount ?? 0;
    if (countNormal) countNormal.textContent = m.normalStockCount ?? 0;
    if (countExcess) countExcess.textContent = m.excessStockCount ?? 0;
  }

  renderTable() {
    const tbody = this.rootElement.querySelector('#stock-table-body');
    const emptyEl = this.rootElement.querySelector('#stock-empty-state');
    if (!tbody || !emptyEl) return;

    if (this.products.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.classList.add('flex');
      return;
    }

    emptyEl.classList.add('hidden');
    emptyEl.classList.remove('flex');

    tbody.innerHTML = this.products.map(p => {
      const thumb = this.thumbnailUrls.get(p.id);
      const badge = this._renderStatusBadge(p.stockStatus);
      const capacity = this._renderCapacityBar(p);
      const costFormatted = MoneyService.format(p.purchasePriceCents);
      const saleFormatted = MoneyService.format(p.salePriceCents);

      return `
        <tr class="hover:bg-slate-50/80 transition-colors group">
          <!-- Produto -->
          <td class="py-3 px-4">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 bg-slate-100 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                ${thumb
                  ? `<img src="${thumb}" alt="${this._esc(p.name)}" class="w-full h-full object-cover">`
                  : `<svg class="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`}
              </div>
              <div class="min-w-0">
                <a href="#/produtos/detalhes/${p.id}" class="font-semibold text-slate-800 hover:text-blue-600 transition truncate block max-w-xs text-sm">
                  ${this._esc(p.name)}
                </a>
                <div class="flex items-center gap-2 text-xs text-slate-400">
                  <span class="font-mono">${this._esc(p.productCode) || 'Sem SKU'}</span>
                  ${p.category ? `<span>•</span> <span>${this._esc(p.category)}</span>` : ''}
                </div>
              </div>
            </div>
          </td>

          <!-- Valores -->
          <td class="py-3 px-3 whitespace-nowrap text-xs">
            <div class="text-slate-800 font-medium">Venda: <span class="font-bold text-slate-900">${saleFormatted}</span></div>
            <div class="text-slate-400">Custo: ${costFormatted}</div>
          </td>

          <!-- Mínimo / Máximo -->
          <td class="py-3 px-3 whitespace-nowrap text-xs">
            <div class="text-slate-600">Mín: <span class="font-semibold text-slate-700">${p.minimumStock || 0} un</span></div>
            <div class="text-slate-400">Máx: ${p.maximumStock ? p.maximumStock + ' un' : '∞'}</div>
          </td>

          <!-- Saldo Atual -->
          <td class="py-3 px-4 text-center whitespace-nowrap">
            <div class="inline-flex flex-col items-center">
              <span class="text-lg font-black ${p.stockQuantity <= 0 ? 'text-rose-600' : p.stockStatus === 'LOW_STOCK' ? 'text-amber-600' : 'text-slate-800'}">
                ${p.stockQuantity}
              </span>
              <span class="text-[10px] text-slate-400 font-medium">unidades</span>
            </div>
          </td>

          <!-- Nível de Estoque -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <div class="flex flex-col items-center gap-1.5">
              ${badge}
              ${capacity}
            </div>
          </td>

          <!-- Ações Rápidas -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1">
              <!-- Quick IN -->
              <button data-action="quick-in" data-product-id="${p.id}" class="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Entrada rápida">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </button>

              <!-- Quick OUT -->
              <button data-action="quick-out" data-product-id="${p.id}" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Saída rápida">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
              </button>

              <!-- Quick ADJUST -->
              <button data-action="quick-adjust" data-product-id="${p.id}" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="Balanço / Ajuste Físico">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>

              <!-- History -->
              <button data-action="history" data-product-id="${p.id}" class="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition" title="Histórico de movimentações">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  _renderStatusBadge(status) {
    switch (status) {
      case STOCK_STATUS.OUT_OF_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">Esgotado</span>`;
      case STOCK_STATUS.LOW_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">Estoque Baixo</span>`;
      case STOCK_STATUS.EXCESS_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800">Excesso</span>`;
      case STOCK_STATUS.NORMAL:
      default:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">Normal</span>`;
    }
  }

  _renderCapacityBar(p) {
    if (!p.maximumStock || p.maximumStock <= 0) {
      return '';
    }
    const percent = p.capacityPercent ?? 0;
    let colorClass = 'bg-emerald-500';
    if (p.stockStatus === 'OUT_OF_STOCK') colorClass = 'bg-rose-500';
    else if (p.stockStatus === 'LOW_STOCK') colorClass = 'bg-amber-500';
    else if (p.stockStatus === 'EXCESS_STOCK') colorClass = 'bg-purple-500';

    return `
      <div class="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div class="${colorClass} h-1.5 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
      </div>
    `;
  }

  bindEvents() {
    // 1. Debounced Search
    const searchInput = this.rootElement.querySelector('#stock-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.searchQuery = e.target.value;
          this.loadData();
        }, 300);
      });
    }

    // 2. Filter Pills
    const pillsContainer = this.rootElement.querySelector('#filter-pills');
    if (pillsContainer) {
      pillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-pill');
        if (!btn) return;
        const filter = btn.dataset.filter;
        this.activeFilter = filter;

        // Atualizar classes visuais dos botões
        pillsContainer.querySelectorAll('.filter-pill').forEach(b => {
          b.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-100 text-slate-600 hover:bg-slate-200';
        });

        if (filter === 'ALL') btn.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-blue-600 text-white shadow-xs';
        else if (filter === 'LOW_STOCK') btn.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-amber-500 text-white shadow-xs';
        else if (filter === 'OUT_OF_STOCK') btn.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-rose-600 text-white shadow-xs';
        else if (filter === 'NORMAL') btn.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-emerald-600 text-white shadow-xs';
        else if (filter === 'EXCESS_STOCK') btn.className = 'filter-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-purple-600 text-white shadow-xs';

        this.loadData();
      });
    }

    // 3. Category Filter
    const categorySelect = this.rootElement.querySelector('#filter-stock-category');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        this.selectedCategory = e.target.value;
        this.loadData();
      });
    }

    // 4. Click nos cards de métricas
    const cardLow = this.rootElement.querySelector('#card-filter-low');
    if (cardLow) {
      cardLow.addEventListener('click', () => {
        const btn = this.rootElement.querySelector('[data-filter="LOW_STOCK"]');
        if (btn) btn.click();
      });
    }

    const cardOut = this.rootElement.querySelector('#card-filter-out');
    if (cardOut) {
      cardOut.addEventListener('click', () => {
        const btn = this.rootElement.querySelector('[data-filter="OUT_OF_STOCK"]');
        if (btn) btn.click();
      });
    }

    // 5. Botão Nova Movimentação
    const btnNewMov = this.rootElement.querySelector('#btn-open-movement-modal');
    if (btnNewMov) {
      btnNewMov.addEventListener('click', () => this.openMovementModal());
    }

    // 6. Botão Auditoria de Saldo
    const btnRecalculate = this.rootElement.querySelector('#btn-recalculate-stock');
    if (btnRecalculate) {
      btnRecalculate.addEventListener('click', () => this.handleAuditStock());
    }

    // 7. Ações na tabela
    const tbody = this.rootElement.querySelector('#stock-table-body');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const productId = btn.dataset.productId;
        const product = this.products.find(p => p.id === productId);

        if (action === 'quick-in') {
          this.openMovementModal(product, 'IN');
        } else if (action === 'quick-out') {
          this.openMovementModal(product, 'OUT');
        } else if (action === 'quick-adjust') {
          this.openAdjustModal(product);
        } else if (action === 'history') {
          this.openHistoryModal(product);
        }
      });
    }
  }

  // ==========================================
  // MODAL DE MOVIMENTAÇÃO DE ESTOQUE
  // ==========================================

  openMovementModal(product = null, defaultType = 'IN') {
    this.modalProduct = product;
    const modalContainer = this.rootElement.querySelector('#modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <!-- Modal Header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 class="text-base font-bold text-slate-800">Registrar Movimentação de Estoque</h3>
              <p class="text-xs text-slate-500">Adicione entradas, saídas manuais ou devoluções</p>
            </div>
            <button id="modal-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Modal Body / Form -->
          <form id="movement-form" class="p-6 space-y-4">
            <!-- Seleção de Produto -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Produto <span class="text-red-500">*</span></label>
              <select id="mov-product-id" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600">
                <option value="">Selecione um produto...</option>
                ${this.allProductsList.map(p => `
                  <option value="${p.id}" ${product && product.id === p.id ? 'selected' : ''}>
                    ${this._esc(p.name)} (${p.productCode ? 'SKU: ' + p.productCode + ' - ' : ''}Saldo: ${p.stockQuantity || 0} un)
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Tipo de Movimentação -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Tipo de Operação <span class="text-red-500">*</span></label>
              <div class="grid grid-cols-3 gap-2">
                <label class="mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition ${defaultType === 'IN' ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">
                  <input type="radio" name="mov-type" value="IN" class="sr-only" ${defaultType === 'IN' ? 'checked' : ''}>
                  <svg class="w-5 h-5 text-emerald-600 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                  <span class="text-xs">Entrada (+)</span>
                </label>

                <label class="mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition ${defaultType === 'OUT' ? 'border-rose-600 bg-rose-50 text-rose-800 font-bold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">
                  <input type="radio" name="mov-type" value="OUT" class="sr-only" ${defaultType === 'OUT' ? 'checked' : ''}>
                  <svg class="w-5 h-5 text-rose-600 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
                  <span class="text-xs">Saída (-)</span>
                </label>

                <label class="mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition ${defaultType === 'RETURN' ? 'border-blue-600 bg-blue-50 text-blue-800 font-bold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">
                  <input type="radio" name="mov-type" value="RETURN" class="sr-only" ${defaultType === 'RETURN' ? 'checked' : ''}>
                  <svg class="w-5 h-5 text-blue-600 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
                  <span class="text-xs">Devolução (+)</span>
                </label>
              </div>
            </div>

            <!-- Quantidade e Custo -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Quantidade <span class="text-red-500">*</span></label>
                <input type="number" id="mov-quantity" min="1" step="1" value="1"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600">
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Custo Unitário (R$)</label>
                <input type="text" id="mov-unit-cost" value="${product ? MoneyService.format(product.purchasePriceCents) : 'R$ 0,00'}"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600">
              </div>
            </div>

            <!-- Motivo / Justificativa -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Motivo / Justificativa <span id="reason-req-star" class="text-red-500 ${defaultType === 'OUT' ? '' : 'hidden'}">*</span>
              </label>
              <select id="mov-reason-preset" class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:border-blue-600 mb-2">
                <option value="">Selecione ou digite abaixo...</option>
                <option value="Compra de mercadoria">Compra de mercadoria</option>
                <option value="Reposição de estoque">Reposição de estoque</option>
                <option value="Devolução de cliente">Devolução de cliente</option>
                <option value="Consumo interno">Consumo interno / Showroom</option>
                <option value="Avaria / Produto danificado">Avaria / Produto danificado</option>
                <option value="Venda balcão avulsa">Venda balcão avulsa</option>
                <option value="Perda / Extravio">Perda / Extravio</option>
              </select>
              <input type="text" id="mov-reason-custom" placeholder="Ou descreva o motivo detalhado..."
                     class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:border-blue-600">
            </div>

            <!-- Observações Livres -->
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Observações (Opcional)</label>
              <textarea id="mov-notes" rows="2" placeholder="Notas internas ou número de documento..."
                        class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-blue-600"></textarea>
            </div>

            <!-- Prévia de Impacto de Saldo -->
            <div id="stock-preview-box" class="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span class="text-slate-600 font-medium">Saldo Atual: <strong id="prev-stock-val">0</strong> un</span>
              <svg class="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              <span class="text-slate-800 font-bold">Novo Saldo: <strong id="next-stock-val" class="text-emerald-700 text-sm">0</strong> un</span>
            </div>

            <!-- Feedback de Erro -->
            <div id="modal-error-msg" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"></div>

            <!-- Footer / Botões -->
            <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" id="modal-cancel-btn" class="px-4 py-2 text-slate-600 text-xs font-semibold hover:bg-slate-100 rounded-lg transition">
                Cancelar
              </button>
              <button type="submit" id="btn-submit-movement" class="px-5 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                Confirmar Movimentação
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    this._bindMovementModalEvents(product);
  }

  _bindMovementModalEvents(initialProduct) {
    const container = this.rootElement.querySelector('#modal-container');
    const closeBtn = container.querySelector('#modal-close-btn');
    const cancelBtn = container.querySelector('#modal-cancel-btn');
    const form = container.querySelector('#movement-form');
    const productSelect = container.querySelector('#mov-product-id');
    const qtyInput = container.querySelector('#mov-quantity');
    const unitCostInput = container.querySelector('#mov-unit-cost');
    const typeRadios = container.querySelectorAll('input[name="mov-type"]');
    const typeLabels = container.querySelectorAll('.mov-type-label');
    const reasonPreset = container.querySelector('#mov-reason-preset');
    const reasonCustom = container.querySelector('#mov-reason-custom');
    const reasonStar = container.querySelector('#reason-req-star');
    const errorMsg = container.querySelector('#modal-error-msg');

    const closeModal = () => {
      container.innerHTML = '';
      this.modalProduct = null;
    };

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    // Tipo radio changes
    typeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        typeLabels.forEach(l => {
          l.className = 'mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition border-slate-200 text-slate-600 hover:bg-slate-50';
        });

        const selectedRadio = container.querySelector('input[name="mov-type"]:checked');
        const activeType = selectedRadio ? selectedRadio.value : 'IN';
        const parentLabel = selectedRadio?.closest('.mov-type-label');

        if (activeType === 'IN' && parentLabel) parentLabel.className = 'mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition border-emerald-600 bg-emerald-50 text-emerald-800 font-bold';
        else if (activeType === 'OUT' && parentLabel) parentLabel.className = 'mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition border-rose-600 bg-rose-50 text-rose-800 font-bold';
        else if (activeType === 'RETURN' && parentLabel) parentLabel.className = 'mov-type-label flex flex-col items-center justify-center p-2.5 rounded-lg border cursor-pointer transition border-blue-600 bg-blue-50 text-blue-800 font-bold';

        if (reasonStar) {
          if (activeType === 'OUT') reasonStar.classList.remove('hidden');
          else reasonStar.classList.add('hidden');
        }

        updatePreview();
      });
    });

    const updatePreview = () => {
      const pId = productSelect ? productSelect.value : (initialProduct ? initialProduct.id : '');
      const prod = this.allProductsList.find(p => p.id === pId) || (initialProduct && initialProduct.id === pId ? initialProduct : null);
      const currentStock = prod ? (prod.stockQuantity ?? 0) : 0;
      const qty = parseInt(qtyInput?.value || 0, 10) || 0;
      const selectedRadio = container.querySelector('input[name="mov-type"]:checked');
      const movType = selectedRadio ? selectedRadio.value : 'IN';

      let delta = movType === 'OUT' ? -qty : qty;
      let nextStock = currentStock + delta;

      const prevEl = container.querySelector('#prev-stock-val');
      const nextEl = container.querySelector('#next-stock-val');
      if (prevEl) prevEl.textContent = currentStock;
      if (nextEl) {
        nextEl.textContent = nextStock;
        if (nextStock < 0) {
          nextEl.className = 'text-rose-600 text-sm font-black';
        } else {
          nextEl.className = 'text-emerald-700 text-sm font-black';
        }
      }
    };

    typeLabels.forEach(label => {
      label.addEventListener('click', () => {
        const radio = label.querySelector('input[name="mov-type"]');
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // Preset reason selection
    reasonPreset?.addEventListener('change', (e) => {
      if (e.target.value) {
        reasonCustom.value = e.target.value;
      }
    });

    // Formatar campo de custo com MoneyService
    unitCostInput?.addEventListener('blur', (e) => {
      const cents = MoneyService.toCents(e.target.value);
      e.target.value = MoneyService.format(cents);
    });

    // Troca de produto no select
    productSelect?.addEventListener('change', () => {
      const pId = productSelect.value;
      const found = this.allProductsList.find(p => p.id === pId) || (initialProduct && initialProduct.id === pId ? initialProduct : null);
      if (found && unitCostInput) {
        unitCostInput.value = MoneyService.format(found.purchasePriceCents || 0);
      }
      updatePreview();
    });

    qtyInput?.addEventListener('input', updatePreview);
    
    updatePreview();

    // Submit
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const pId = productSelect ? productSelect.value : '';
      if (!pId) {
        errorMsg.textContent = 'Por favor, selecione um produto.';
        errorMsg.classList.remove('hidden');
        return;
      }

      const selectedRadio = container.querySelector('input[name="mov-type"]:checked');
      const type = selectedRadio ? selectedRadio.value : 'IN';
      const quantity = parseInt(qtyInput.value, 10);
      const unitCostCents = MoneyService.toCents(unitCostInput.value);
      const reason = (reasonCustom.value || reasonPreset.value || '').trim();
      const notes = (container.querySelector('#mov-notes')?.value || '').trim();

      if (isNaN(quantity) || quantity <= 0) {
        errorMsg.textContent = 'Informe uma quantidade válida maior que zero.';
        errorMsg.classList.remove('hidden');
        return;
      }

      if (type === 'OUT' && !reason) {
        errorMsg.textContent = 'Informe o motivo/justificativa para saída de estoque.';
        errorMsg.classList.remove('hidden');
        return;
      }

      const submitBtn = container.querySelector('#btn-submit-movement');
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
        Registrando...
      `;

      try {
        const res = await StockService.recordMovement({
          productId: pId,
          type,
          quantity,
          unitCostCents,
          reason,
          notes
        });

        closeModal();
        await this.loadData();
        this._showToast(`Movimentação confirmada com sucesso! Novo saldo: ${res.newStock} un.`);
      } catch (err) {
        errorMsg.textContent = err.message || 'Erro ao registrar movimentação.';
        errorMsg.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          Confirmar Movimentação
        `;
      }
    });
  }

  // ==========================================
  // MODAL DE AJUSTE / BALANÇO FÍSICO DIRETO
  // ==========================================

  openAdjustModal(product) {
    if (!product) return;
    const modalContainer = this.rootElement.querySelector('#modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 class="text-base font-bold text-slate-800">Ajuste de Balanço Físico</h3>
              <p class="text-xs text-slate-500">${this._esc(product.name)}</p>
            </div>
            <button id="adjust-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <form id="adjust-form" class="p-6 space-y-4">
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
              <span class="text-xs text-slate-500 font-medium">Saldo Registrado no Sistema:</span>
              <span class="text-base font-black text-slate-800">${product.stockQuantity || 0} un</span>
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Nova Quantidade Física Contada <span class="text-red-500">*</span>
              </label>
              <input type="number" id="adjust-target-qty" value="${product.stockQuantity || 0}" min="0" step="1"
                     class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-lg font-black focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Justificativa do Ajuste <span class="text-red-500">*</span>
              </label>
              <input type="text" id="adjust-reason" placeholder="Ex: Inventário mensal, acerto de contagem..." value="Inventário / Balanço Físico"
                     class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:border-indigo-600">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Observações (Opcional)</label>
              <textarea id="adjust-notes" rows="2" placeholder="Notas adicionais sobre a divergência..."
                        class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs focus:bg-white focus:outline-none focus:border-indigo-600"></textarea>
            </div>

            <div id="adjust-preview" class="text-xs text-slate-500 font-medium"></div>
            <div id="adjust-error-msg" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"></div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" id="adjust-cancel-btn" class="px-4 py-2 text-slate-600 text-xs font-semibold hover:bg-slate-100 rounded-lg transition">
                Cancelar
              </button>
              <button type="submit" id="btn-submit-adjust" class="px-5 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 active:scale-95 transition shadow-xs flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                Aplicar Balanço
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    const container = modalContainer;
    const closeBtn = container.querySelector('#adjust-close-btn');
    const cancelBtn = container.querySelector('#adjust-cancel-btn');
    const form = container.querySelector('#adjust-form');
    const targetInput = container.querySelector('#adjust-target-qty');
    const reasonInput = container.querySelector('#adjust-reason');
    const notesInput = container.querySelector('#adjust-notes');
    const previewEl = container.querySelector('#adjust-preview');
    const errorMsg = container.querySelector('#adjust-error-msg');

    const closeModal = () => { container.innerHTML = ''; };
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    const updateAdjustPreview = () => {
      const target = parseInt(targetInput.value, 10) || 0;
      const current = product.stockQuantity || 0;
      const delta = target - current;

      if (delta === 0) {
        previewEl.innerHTML = `<span class="text-slate-400">Nenhuma alteração de saldo necessária.</span>`;
      } else if (delta > 0) {
        previewEl.innerHTML = `<span class="text-emerald-700 font-semibold">Diferença: +${delta} unidades adicionadas ao estoque.</span>`;
      } else {
        previewEl.innerHTML = `<span class="text-rose-700 font-semibold">Diferença: ${delta} unidades reduzidas do estoque.</span>`;
      }
    };

    targetInput?.addEventListener('input', updateAdjustPreview);
    updateAdjustPreview();

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const targetQuantity = parseInt(targetInput.value, 10);
      const reason = reasonInput.value.trim();
      const notes = notesInput.value.trim();

      if (isNaN(targetQuantity)) {
        errorMsg.textContent = 'Informe uma quantidade válida.';
        errorMsg.classList.remove('hidden');
        return;
      }

      if (!reason) {
        errorMsg.textContent = 'Informe o motivo do balanço/ajuste.';
        errorMsg.classList.remove('hidden');
        return;
      }

      const btnSubmit = container.querySelector('#btn-submit-adjust');
      btnSubmit.disabled = true;

      try {
        const res = await StockService.adjustStock({
          productId: product.id,
          targetQuantity,
          reason,
          notes
        });

        closeModal();
        await this.loadData();
        this._showToast(`Balanço físico aplicado com sucesso! Novo saldo: ${res.newStock} un.`);
      } catch (err) {
        errorMsg.textContent = err.message || 'Erro ao ajustar estoque.';
        errorMsg.classList.remove('hidden');
        btnSubmit.disabled = false;
      }
    });
  }

  // ==========================================
  // MODAL DE HISTÓRICO DE MOVIMENTAÇÕES
  // ==========================================

  async openHistoryModal(product) {
    if (!product) return;
    const modalContainer = this.rootElement.querySelector('#modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all max-h-[90vh] flex flex-col">
          
          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 flex-shrink-0">
            <div>
              <h3 class="text-base font-bold text-slate-800">Histórico de Movimentações</h3>
              <p class="text-xs text-slate-500">${this._esc(product.name)} • Saldo Atual: <strong class="text-slate-800">${product.stockQuantity || 0} un</strong></p>
            </div>
            <button id="history-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="p-6 overflow-y-auto flex-1" id="history-content">
            <div class="flex items-center justify-center h-32 text-slate-400 text-xs">
              <svg class="animate-spin h-5 w-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
              Carregando histórico...
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0 text-xs text-slate-500">
            <span id="history-count">0 movimentações registradas</span>
            <button id="history-done-btn" class="px-4 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition">
              Fechar
            </button>
          </div>

        </div>
      </div>
    `;

    const closeBtn = modalContainer.querySelector('#history-close-btn');
    const doneBtn = modalContainer.querySelector('#history-done-btn');
    const closeModal = () => { modalContainer.innerHTML = ''; };
    closeBtn?.addEventListener('click', closeModal);
    doneBtn?.addEventListener('click', closeModal);

    // Carregar histórico
    try {
      const history = await StockService.getProductStockHistory(product.id);
      const contentEl = modalContainer.querySelector('#history-content');
      const countEl = modalContainer.querySelector('#history-count');

      if (countEl) countEl.textContent = `${history.length} movimentação(ões) registrada(s)`;

      if (history.length === 0) {
        contentEl.innerHTML = `
          <div class="text-center py-10 text-slate-400">
            <svg class="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p class="text-sm font-semibold text-slate-600">Nenhuma movimentação registrada</p>
            <p class="text-xs text-slate-400">Este produto ainda não recebeu entradas ou saídas de estoque.</p>
          </div>
        `;
        return;
      }

      contentEl.innerHTML = `
        <div class="divide-y divide-slate-100">
          ${history.map(mov => {
            const dateStr = new Date(mov.date || mov.createdAt).toLocaleString('pt-BR');
            const isPositive = ['IN', 'PURCHASE', 'RETURN'].includes(mov.type) || (mov.type === 'ADJUSTMENT' && (mov.delta > 0 || mov.quantity > 0));
            const typeBadge = this._renderMovementTypeBadge(mov.type);

            return `
              <div class="py-3 flex items-start justify-between gap-4">
                <div class="flex items-start gap-3">
                  <div class="mt-0.5">${typeBadge}</div>
                  <div>
                    <p class="text-sm font-bold text-slate-800">${this._esc(mov.reason) || 'Movimentação sem motivo especificado'}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${dateStr} ${mov.notes ? `• <span class="italic">${this._esc(mov.notes)}</span>` : ''}</p>
                  </div>
                </div>

                <div class="text-right whitespace-nowrap">
                  <span class="text-sm font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}">
                    ${isPositive ? '+' : '-'}${Math.abs(mov.delta !== undefined ? mov.delta : mov.quantity)} un
                  </span>
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    Saldo: <span class="font-bold text-slate-700">${mov.resultingStock ?? '-'} un</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (e) {
      console.error('Erro ao buscar histórico:', e);
      const contentEl = modalContainer.querySelector('#history-content');
      if (contentEl) {
        contentEl.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg text-xs">Erro ao carregar histórico: ${e.message}</div>`;
      }
    }
  }

  _renderMovementTypeBadge(type) {
    switch (type) {
      case 'IN':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Entrada</span>`;
      case 'OUT':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Saída</span>`;
      case 'ADJUSTMENT':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">Balanço</span>`;
      case 'RETURN':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Devolução</span>`;
      case 'SALE':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">Venda</span>`;
      case 'PURCHASE':
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800">Compra</span>`;
      default:
        return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${type}</span>`;
    }
  }

  // ==========================================
  // AUDITORIA E RECÁLCULO DE SALDO
  // ==========================================

  async handleAuditStock() {
    const btn = this.rootElement.querySelector('#btn-recalculate-stock');
    if (btn) btn.disabled = true;

    try {
      const res = await StockService.recalculateAllStock();
      if (res.syncedCount === 0) {
        alert('Auditoria concluída com sucesso! Todos os saldos estão 100% íntegros e sincronizados com a tabela de movimentações.');
      } else {
        alert(`Auditoria concluída: ${res.syncedCount} produto(s) tiveram seus saldos corrigidos e sincronizados com o histórico.`);
        await this.loadData();
      }
    } catch (e) {
      alert(`Erro ao auditar estoque: ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ==========================================
  // EVENT BUS E SINCRONIZAÇÃO MULTIABA
  // ==========================================

  subscribeEvents() {
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, () => {
      this.loadData();
    });
    const unsubProduct = eventBus.on(EVENTS.PRODUCT_UPDATED, () => {
      this.loadData();
    });

    this.cleanupListeners.push(unsubStock, unsubProduct);
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
        <td class="py-3 px-4 flex items-center gap-3">
          <div class="w-10 h-10 bg-slate-200 rounded-lg"></div>
          <div class="space-y-1.5"><div class="h-3.5 bg-slate-200 rounded w-36"></div><div class="h-2.5 bg-slate-100 rounded w-20"></div></div>
        </td>
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-24 mb-1"></div><div class="h-2 bg-slate-100 rounded w-16"></div></td>
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-20"></div></td>
        <td class="py-3 px-4 text-center"><div class="h-5 bg-slate-200 rounded w-12 mx-auto"></div></td>
        <td class="py-3 px-3 text-center"><div class="h-5 bg-slate-200 rounded w-16 mx-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-6 bg-slate-200 rounded w-24 ml-auto"></div></td>
      </tr>
    `).join('');
  }

  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }

  _showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl border text-sm font-semibold flex items-center gap-3 transform transition-all duration-300 translate-y-2 opacity-0 ${
      type === 'success' 
        ? 'bg-emerald-800 text-white border-emerald-700 shadow-emerald-950/20' 
        : 'bg-rose-800 text-white border-rose-700 shadow-rose-950/20'
    }`;
    
    toast.innerHTML = `
      <svg class="w-5 h-5 flex-shrink-0 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
      <span>${this._esc(message)}</span>
    `;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
      toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}
