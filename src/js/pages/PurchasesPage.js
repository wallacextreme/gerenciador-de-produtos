import { PurchaseService } from '../services/PurchaseService.js';
import { SupplierService } from '../services/SupplierService.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { MoneyService } from '../domain/MoneyService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class PurchasesPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.purchases = [];
    this.allSuppliers = [];
    this.allProducts = [];
    this.metrics = {};
    this.cleanupListeners = [];
    this.thumbnailUrls = new Map();
    this.searchDebounceTimer = null;

    // Filtros
    this.searchQuery = '';
    this.selectedPeriod = 'ALL';
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Top Metrics Cards -->
        <div id="purchases-metrics" class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          ${this._renderSkeletonMetrics()}
        </div>

        <!-- Toolbar & Filter Bar -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          <!-- Top Row: Search & New Purchase Button -->
          <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="flex-1 relative">
              <input type="text" id="purchases-search-input" value="${this._esc(this.searchQuery)}"
                     placeholder="Buscar por fornecedor, produto, nota fiscal ou observações..."
                     class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              <svg class="w-5 h-5 text-slate-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            
            <button id="btn-open-purchase-modal" class="bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-2 whitespace-nowrap">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Nova Ordem de Compra
            </button>
          </div>

          <!-- Bottom Row: Period Filter -->
          <div class="flex items-center gap-1.5 pt-3 border-t border-slate-100 text-sm" id="purchases-period-pills">
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
        </div>

        <!-- Purchases Table -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col">
          <div class="overflow-x-auto flex-1">
            <table class="w-full text-left text-sm text-slate-600">
              <thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th scope="col" class="py-3.5 px-4">Data / Pedido</th>
                  <th scope="col" class="py-3.5 px-3">Fornecedor</th>
                  <th scope="col" class="py-3.5 px-3">Produto</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Qtd</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Custo Unitário</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Total da Compra</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Nota Fiscal</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody id="purchases-table-body" class="divide-y divide-slate-100">
                ${this._renderSkeletonRows()}
              </tbody>
            </table>
          </div>

          <!-- Empty State -->
          <div id="purchases-empty-state" class="hidden flex-col items-center justify-center p-12 text-center">
            <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-1">Nenhuma ordem de compra registrada</h3>
            <p class="text-xs text-slate-500 max-w-sm mb-4">Cadastre ordens de compra para abastecer automaticamente seu estoque e calibrar seus custos.</p>
            <button id="empty-state-new-purchase-btn" class="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition">
              Registrar Primeira Compra
            </button>
          </div>
        </div>

        <!-- Container for Modals -->
        <div id="purchases-modal-container"></div>
      </div>
    `;

    this.bindEvents();
    await this.loadData();
    this.subscribeEvents();
  }

  async loadData() {
    try {
      this._revokeThumbnailUrls();

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
        startDate: startDate || undefined
      };

      const overview = await PurchaseService.getPurchasesOverview(filters);
      this.purchases = overview.purchases;
      this.metrics = overview.metrics;

      // Buscar listas para o modal
      this.allSuppliers = await SupplierService.listSuppliers({ status: 'active' });
      this.allProducts = await productRepository.list({ status: 'active' });

      await this._loadThumbnails();

      this.renderMetrics();
      this.renderTable();
    } catch (e) {
      console.error('Erro ao carregar compras:', e);
      const tbody = this.rootElement.querySelector('#purchases-table-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500">Erro: ${e.message}</td></tr>`;
      }
    }
  }

  async _loadThumbnails() {
    for (const p of this.purchases) {
      if (!this.thumbnailUrls.has(p.productId)) {
        try {
          const primaryImg = await productImageRepository.getPrimaryImage(p.productId);
          if (primaryImg && (primaryImg.thumbnailBlob || primaryImg.blob)) {
            const url = URL.createObjectURL(primaryImg.thumbnailBlob || primaryImg.blob);
            this.thumbnailUrls.set(p.productId, url);
          }
        } catch {}
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
    const metricsEl = this.rootElement.querySelector('#purchases-metrics');
    if (!metricsEl) return;

    metricsEl.innerHTML = `
      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Total Investido</span>
          <div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-blue-700 mt-2">${MoneyService.format(m.totalSpentCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Total em compras ativas</span>
      </div>

      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Ordens de Compra</span>
          <div class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-indigo-700 mt-2">${m.totalPurchasesCount ?? 0} <span class="text-xs font-medium text-indigo-500">pedidos</span></p>
        <span class="text-[11px] text-slate-400">Pedidos finalizados</span>
      </div>

      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Itens Adquiridos</span>
          <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
          </div>
        </div>
        <p class="text-2xl font-black text-emerald-700 mt-2">${m.totalItemsPurchased ?? 0} <span class="text-xs font-medium text-emerald-600">un</span></p>
        <span class="text-[11px] text-slate-400">Entradas no estoque</span>
      </div>

      <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-500 uppercase">Média por Pedido</span>
          <div class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
        </div>
        <p class="text-xl font-black text-amber-700 mt-2">${MoneyService.format(m.averagePurchaseCents ?? 0)}</p>
        <span class="text-[11px] text-slate-400">Ticket médio de compra</span>
      </div>
    `;
  }

  renderTable() {
    const tbody = this.rootElement.querySelector('#purchases-table-body');
    const emptyEl = this.rootElement.querySelector('#purchases-empty-state');
    if (!tbody || !emptyEl) return;

    if (this.purchases.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.classList.add('flex');
      return;
    }

    emptyEl.classList.add('hidden');
    emptyEl.classList.remove('flex');

    tbody.innerHTML = this.purchases.map(p => {
      const thumb = this.thumbnailUrls.get(p.productId);
      const isCancelled = !!p.cancelledAt;
      const dateStr = new Date(p.date || p.createdAt).toLocaleString('pt-BR');
      const totalFormatted = MoneyService.format(p.totalCostCents);
      const unitCostFormatted = MoneyService.format(p.unitCostCents);

      return `
        <tr class="hover:bg-slate-50/80 transition-colors group ${isCancelled ? 'opacity-50 bg-slate-50' : ''}">
          <!-- Data / Pedido ID -->
          <td class="py-3 px-4 whitespace-nowrap">
            <div class="text-xs font-bold text-slate-800">${dateStr}</div>
            <div class="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span>#${p.id.slice(0, 8)}</span>
              ${isCancelled ? '<span class="px-1.5 py-0.2 bg-rose-100 text-rose-800 font-bold rounded">Estornada</span>' : ''}
            </div>
          </td>

          <!-- Fornecedor -->
          <td class="py-3 px-3">
            <div class="font-semibold text-slate-800 text-xs">${this._esc(p.supplierName)}</div>
          </td>

          <!-- Produto -->
          <td class="py-3 px-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 bg-slate-100 rounded-lg border border-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                ${thumb
                  ? `<img src="${thumb}" alt="${this._esc(p.productName)}" class="w-full h-full object-cover">`
                  : `<svg class="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`}
              </div>
              <div class="min-w-0">
                <a href="#/produtos/detalhes/${p.productId}" class="font-semibold text-slate-800 hover:text-blue-600 transition truncate block max-w-xs text-xs">
                  ${this._esc(p.productName)}
                </a>
                <span class="text-[10px] font-mono text-slate-400">${this._esc(p.productCode) || 'Sem SKU'}</span>
              </div>
            </div>
          </td>

          <!-- Quantidade -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <span class="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-800">
              +${p.quantity} un
            </span>
          </td>

          <!-- Custo Unitário -->
          <td class="py-3 px-4 text-right whitespace-nowrap text-xs font-medium text-slate-700">
            ${unitCostFormatted}
          </td>

          <!-- Total da Compra -->
          <td class="py-3 px-4 text-right whitespace-nowrap font-black text-slate-900 text-sm">
            ${totalFormatted}
          </td>

          <!-- NF / Comprovante -->
          <td class="py-3 px-3 text-center whitespace-nowrap font-mono text-xs text-slate-600">
            ${this._esc(p.invoiceNumber) || '<span class="text-slate-400 font-sans italic">-</span>'}
          </td>

          <!-- Ações -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1">
              <button data-action="view-receipt" data-id="${p.id}" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Ver Comprovante">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </button>

              ${!isCancelled ? `
                <button data-action="cancel-purchase" data-id="${p.id}" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Estornar Compra (Deduz Estoque)">
                  <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  bindEvents() {
    const searchInput = this.rootElement.querySelector('#purchases-search-input');
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchQuery = e.target.value;
        this.loadData();
      }, 300);
    });

    const periodContainer = this.rootElement.querySelector('#purchases-period-pills');
    periodContainer?.addEventListener('click', (e) => {
      const btn = e.target.closest('.period-pill');
      if (!btn) return;
      this.selectedPeriod = btn.dataset.period;

      periodContainer.querySelectorAll('.period-pill').forEach(b => {
        b.className = 'period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-100 text-slate-600 hover:bg-slate-200';
      });
      btn.className = 'period-pill px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-blue-600 text-white shadow-xs';

      this.loadData();
    });

    const btnNew = this.rootElement.querySelector('#btn-open-purchase-modal');
    btnNew?.addEventListener('click', () => this.openNewPurchaseModal());

    const btnEmpty = this.rootElement.querySelector('#empty-state-new-purchase-btn');
    btnEmpty?.addEventListener('click', () => this.openNewPurchaseModal());

    const tbody = this.rootElement.querySelector('#purchases-table-body');
    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const p = this.purchases.find(item => item.id === id);

      if (action === 'view-receipt' && p) {
        this.openReceiptModal(p);
      } else if (action === 'cancel-purchase' && p) {
        this.handleCancelPurchase(p);
      }
    });
  }

  // ==========================================
  // MODAL NOVA ORDEM DE COMPRA
  // ==========================================

  openNewPurchaseModal() {
    const modalContainer = this.rootElement.querySelector('#purchases-modal-container');
    if (!modalContainer) return;

    if (this.allSuppliers.length === 0) {
      alert('Nenhum fornecedor ativo cadastrado. Cadastre um fornecedor antes de registrar uma compra.');
      window.location.hash = '#/fornecedores';
      return;
    }

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <!-- Header -->
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-blue-50/50">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-800">Nova Ordem de Compra</h3>
                <p class="text-xs text-slate-500">Entrada automática no estoque e calibração de custo</p>
              </div>
            </div>
            <button id="purchase-modal-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body / Form -->
          <form id="new-purchase-form" class="p-6 space-y-4 text-xs">
            <!-- Seleção de Fornecedor -->
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Fornecedor <span class="text-red-500">*</span></label>
              <select id="purchase-supplier-id" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:border-blue-600">
                <option value="">Selecione o fornecedor...</option>
                ${this.allSuppliers.map(s => `
                  <option value="${s.id}">${this._esc(s.name)} ${s.document ? '(' + this._esc(s.document) + ')' : ''}</option>
                `).join('')}
              </select>
            </div>

            <!-- Seleção de Produto -->
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Produto <span class="text-red-500">*</span></label>
              <select id="purchase-product-id" required class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-800 text-sm focus:bg-white focus:outline-none focus:border-blue-600">
                <option value="">Selecione o produto a abastecer...</option>
                ${this.allProducts.map(p => `
                  <option value="${p.id}" data-cost="${p.purchasePriceCents || 0}" data-stock="${p.stockQuantity || 0}">
                    ${this._esc(p.name)} (${p.productCode ? 'SKU: ' + p.productCode + ' - ' : ''}Saldo: ${p.stockQuantity || 0} un - Custo Atual: ${MoneyService.format(p.purchasePriceCents)})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Quantidade e Custo Unitário -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Quantidade Comprada <span class="text-red-500">*</span></label>
                <input type="number" id="purchase-quantity" min="1" step="1" value="1" required
                       class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-base font-black focus:bg-white focus:outline-none focus:border-blue-600">
              </div>

              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Custo Unitário (R$)</label>
                <input type="text" id="purchase-unit-cost" value="R$ 0,00"
                       class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-base font-bold focus:bg-white focus:outline-none focus:border-blue-600">
              </div>
            </div>

            <!-- Nota Fiscal e Atualizar Custo do Catálogo -->
            <div class="grid grid-cols-2 gap-4 items-center">
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Número da NF (Opcional)</label>
                <input type="text" id="purchase-invoice" placeholder="Ex: NF-10492"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono">
              </div>

              <div class="pt-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" id="purchase-update-cost-flag" checked class="w-4 h-4 text-blue-600 rounded">
                  <span class="text-[11px] text-slate-700 font-semibold leading-tight">Atualizar preço de custo no catálogo</span>
                </label>
              </div>
            </div>

            <!-- Observações -->
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Observações da Compra (Opcional)</label>
              <input type="text" id="purchase-notes" placeholder="Condições de frete, lote, garantias..."
                     class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900">
            </div>

            <!-- Resumo Financeiro e de Estoque -->
            <div class="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200/80 space-y-2">
              <div class="flex justify-between items-center text-slate-700">
                <span class="font-medium">Total da Ordem de Compra:</span>
                <strong id="purchase-preview-total" class="text-base text-blue-900 font-black">R$ 0,00</strong>
              </div>
              <div class="flex justify-between items-center text-slate-600 pt-1 border-t border-blue-100">
                <span>Impacto no Estoque:</span>
                <span id="purchase-preview-stock" class="font-bold text-emerald-700">0 un → +0 un = 0 un</span>
              </div>
            </div>

            <div id="purchase-error-msg" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-red-700"></div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" id="purchase-modal-cancel-btn" class="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition">
                Cancelar
              </button>
              <button type="submit" id="btn-submit-purchase" class="px-5 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                Confirmar Entrada
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    this._bindNewPurchaseModalEvents();
  }

  _bindNewPurchaseModalEvents() {
    const container = this.rootElement.querySelector('#purchases-modal-container');
    const closeBtn = container.querySelector('#purchase-modal-close-btn');
    const cancelBtn = container.querySelector('#purchase-modal-cancel-btn');
    const form = container.querySelector('#new-purchase-form');
    const supSelect = container.querySelector('#purchase-supplier-id');
    const prodSelect = container.querySelector('#purchase-product-id');
    const qtyInput = container.querySelector('#purchase-quantity');
    const costInput = container.querySelector('#purchase-unit-cost');
    const invoiceInput = container.querySelector('#purchase-invoice');
    const updateCostCheckbox = container.querySelector('#purchase-update-cost-flag');
    const notesInput = container.querySelector('#purchase-notes');
    const errorMsg = container.querySelector('#purchase-error-msg');

    const closeModal = () => { container.innerHTML = ''; };
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    const updatePreview = () => {
      const selectedOpt = prodSelect.options[prodSelect.selectedIndex];
      if (!selectedOpt || !prodSelect.value) {
        container.querySelector('#purchase-preview-total').textContent = 'R$ 0,00';
        container.querySelector('#purchase-preview-stock').textContent = 'Selecione um produto';
        return;
      }

      const stock = parseInt(selectedOpt.dataset.stock, 10) || 0;
      const qty = parseInt(qtyInput.value, 10) || 0;
      const costCents = MoneyService.toCents(costInput.value);
      const totalCostCents = qty * costCents;
      const newStock = stock + qty;

      container.querySelector('#purchase-preview-total').textContent = MoneyService.format(totalCostCents);
      container.querySelector('#purchase-preview-stock').textContent = `${stock} un → +${qty} un = ${newStock} un`;
    };

    prodSelect?.addEventListener('change', () => {
      const selectedOpt = prodSelect.options[prodSelect.selectedIndex];
      if (selectedOpt && prodSelect.value) {
        const defaultCost = parseInt(selectedOpt.dataset.cost, 10) || 0;
        costInput.value = MoneyService.format(defaultCost);
      }
      updatePreview();
    });

    costInput?.addEventListener('blur', (e) => {
      const cents = MoneyService.toCents(e.target.value);
      e.target.value = MoneyService.format(cents);
      updatePreview();
    });

    qtyInput?.addEventListener('input', updatePreview);

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const supplierId = supSelect.value;
      const productId = prodSelect.value;
      const quantity = parseInt(qtyInput.value, 10);
      const unitCostCents = MoneyService.toCents(costInput.value);
      const invoiceNumber = invoiceInput.value.trim();
      const updateProductPurchasePrice = updateCostCheckbox.checked;
      const notes = notesInput.value.trim();

      const btnSubmit = container.querySelector('#btn-submit-purchase');
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Processando Entrada...';

      try {
        await PurchaseService.recordPurchase({
          supplierId,
          productId,
          quantity,
          unitCostCents,
          invoiceNumber,
          updateProductPurchasePrice,
          notes
        });

        closeModal();
        await this.loadData();
      } catch (err) {
        errorMsg.textContent = err.message || 'Erro ao registrar ordem de compra.';
        errorMsg.classList.remove('hidden');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Entrada';
      }
    });
  }

  // ==========================================
  // MODAL DE COMPROVANTE DE COMPRA
  // ==========================================

  openReceiptModal(purchase) {
    const modalContainer = this.rootElement.querySelector('#purchases-modal-container');
    if (!modalContainer) return;

    const dateStr = new Date(purchase.date || purchase.createdAt).toLocaleString('pt-BR');
    const totalFormatted = MoneyService.format(purchase.totalCostCents);
    const unitCostFormatted = MoneyService.format(purchase.unitCostCents);
    const isCancelled = !!purchase.cancelledAt;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 class="text-base font-bold text-slate-800">Ordem de Compra</h3>
              <p class="text-xs text-slate-500">ID: #${purchase.id.slice(0, 8)}</p>
            </div>
            <button id="p-receipt-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6 space-y-4 text-xs">
            ${isCancelled ? `
              <div class="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">
                <strong class="font-bold block">COMPRA ESTORNADA / CANCELADA</strong>
                <span>Motivo: ${this._esc(purchase.cancelReason) || 'Cancelamento solicitado'}</span>
              </div>
            ` : ''}

            <div class="border-b border-dashed border-slate-200 pb-3 space-y-1.5">
              <div class="flex justify-between">
                <span class="text-slate-500">Data e Hora:</span>
                <span class="font-semibold text-slate-800">${dateStr}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-500">Fornecedor:</span>
                <span class="font-semibold text-slate-800">${this._esc(purchase.supplierName)}</span>
              </div>
              ${purchase.invoiceNumber ? `
                <div class="flex justify-between">
                  <span class="text-slate-500">Nota Fiscal:</span>
                  <span class="font-mono font-bold text-slate-800">${this._esc(purchase.invoiceNumber)}</span>
                </div>
              ` : ''}
            </div>

            <div class="space-y-2 border-b border-dashed border-slate-200 pb-3">
              <div class="flex justify-between">
                <span class="text-slate-700 font-bold">${this._esc(purchase.productName)}</span>
                <span class="font-semibold text-slate-800">${purchase.quantity}x ${unitCostFormatted}</span>
              </div>
              <div class="flex justify-between text-slate-400 text-[11px]">
                <span>SKU: ${this._esc(purchase.productCode) || '-'}</span>
                <span>Entrada no Estoque: +${purchase.quantity} un</span>
              </div>
            </div>

            <div class="flex justify-between font-black text-slate-900 text-base">
              <span>TOTAL DA COMPRA:</span>
              <span class="text-blue-700">${totalFormatted}</span>
            </div>

            ${purchase.notes ? `
              <div class="p-2.5 bg-slate-50 rounded-lg text-slate-500 italic">
                Nota: ${this._esc(purchase.notes)}
              </div>
            ` : ''}
          </div>

          <div class="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
            <button id="btn-print-p-receipt" class="px-3.5 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition">
              <svg class="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
              Imprimir
            </button>
            <button id="p-receipt-done-btn" class="px-4 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-xs font-semibold transition">
              Fechar
            </button>
          </div>

        </div>
      </div>
    `;

    const closeModal = () => { modalContainer.innerHTML = ''; };
    modalContainer.querySelector('#p-receipt-close-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#p-receipt-done-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#btn-print-p-receipt')?.addEventListener('click', () => window.print());
  }

  // ==========================================
  // ESTORNO DE ORDEM DE COMPRA
  // ==========================================

  async handleCancelPurchase(purchase) {
    const reason = prompt(`Deseja realmente estornar a compra de "${purchase.productName}" (${purchase.quantity} un)?\n\nEssa ação DEDUZIRÁ ${purchase.quantity} unidades do seu estoque.\n\nInforme o motivo do cancelamento:`, 'Devolução de mercadoria ao fornecedor');
    if (reason === null) return;

    try {
      await PurchaseService.cancelPurchase(purchase.id, reason);
      alert('Compra estornada com sucesso! O estoque foi deduzido.');
      await this.loadData();
    } catch (e) {
      alert('Erro ao estornar compra: ' + e.message);
    }
  }

  subscribeEvents() {
    const unsubPurchase = eventBus.on('PURCHASE_CREATED', () => this.loadData());
    const unsubCancel = eventBus.on('PURCHASE_CANCELLED', () => this.loadData());
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, () => this.loadData());

    this.cleanupListeners.push(unsubPurchase, unsubCancel, unsubStock);
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
    return Array(4).fill(0).map(() => `
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
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-24"></div></td>
        <td class="py-3 px-3 flex items-center gap-2"><div class="w-8 h-8 bg-slate-200 rounded-lg"></div><div class="h-3 bg-slate-200 rounded w-24"></div></td>
        <td class="py-3 px-3 text-center"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
        <td class="py-3 px-4 text-right"><div class="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
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
