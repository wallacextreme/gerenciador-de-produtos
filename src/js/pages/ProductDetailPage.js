import { ProductService } from '../services/ProductService.js';
import { StockService, STOCK_STATUS } from '../services/StockService.js';
import { SaleService } from '../services/SaleService.js';
import { PurchaseService } from '../services/PurchaseService.js';
import { QuotationService } from '../services/QuotationService.js';
import { MoneyService } from '../domain/MoneyService.js';
import { MarginService } from '../domain/MarginService.js';
import { renderMovementTypeBadge } from '../utils/translations.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class ProductDetailPage {
  constructor(rootElement, productId) {
    this.rootElement = rootElement;
    this.productId = productId;
    this.product = null;
    this.images = [];
    this.selectedImageIndex = 0;
    this.imageUrls = [];
    this.recentMovements = [];
    this.recentSales = [];
    this.recentPurchases = [];
    this.activeQuotations = [];
    this.cleanupListeners = [];
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="max-w-5xl mx-auto p-6">
        <div class="flex items-center justify-center h-64">
          <div class="flex items-center gap-3 text-slate-500 font-medium">
            <svg class="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            Carregando detalhes do produto...
          </div>
        </div>
      </div>
    `;

    await this.loadData();
    this.bindEvents();
  }

  async loadData() {
    try {
      this._revokeImageUrls();
      const data = await ProductService.getProductWithImages(this.productId);

      if (!data || !data.product) {
        this.rootElement.innerHTML = `
          <div class="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-center mt-12">
            <div class="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <h2 class="text-xl font-bold text-slate-800 mb-2">Produto Não Encontrado</h2>
            <p class="text-slate-500 mb-6">O produto solicitado pode ter sido excluído ou não existe na base de dados.</p>
            <a href="#/produtos" class="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition">
              Voltar para Produtos
            </a>
          </div>
        `;
        return;
      }

      this.product = data.product;
      this.images = data.images || [];

      // Carregar movimentações recentes
      this.recentMovements = await StockService.getProductStockHistory(this.productId, { limit: 5 });

      // Carregar vendas recentes deste produto
      this.recentSales = await SaleService.getSalesByProduct(this.productId);

      // Carregar compras recentes deste produto
      this.recentPurchases = await PurchaseService.getPurchasesByProduct(this.productId);

      // Carregar cotações ativas deste produto (FASE 7)
      this.activeQuotations = await QuotationService.getQuotationsForProduct(this.productId);

      // Criar Object URLs para as imagens em alta resolução
      this.imageUrls = this.images.map(img => ({
        id: img.id,
        isPrimary: img.isPrimary,
        url: URL.createObjectURL(img.blob || img.thumbnailBlob)
      }));

      // Achar o index da primária
      const primaryIdx = this.imageUrls.findIndex(img => img.isPrimary);
      this.selectedImageIndex = primaryIdx !== -1 ? primaryIdx : 0;

      this.renderContent();
    } catch (e) {
      console.error('Erro ao carregar detalhes do produto:', e);
      this.rootElement.innerHTML = `<div class="p-6 text-red-600 bg-red-50 rounded-lg">Erro ao carregar detalhes: ${e.message}</div>`;
    }
  }

  renderContent() {
    const p = this.product;
    const purchaseFormatted = MoneyService.format(p.purchasePriceCents);
    const saleFormatted = MoneyService.format(p.salePriceCents);
    const profitCents = MarginService.calculateProfit(p.salePriceCents, p.purchasePriceCents);
    const profitFormatted = MoneyService.format(profitCents);
    const margin = MarginService.calculateMargin(p.salePriceCents, p.purchasePriceCents);
    const markup = MarginService.calculateMarkup(p.salePriceCents, p.purchasePriceCents);

    const stock = p.stockQuantity || 0;
    const minStock = p.minimumStock || 0;
    const maxStock = p.maximumStock || 0;
    const totalSold = p.totalSold || 0;
    const stockStatus = StockService.computeStockStatus(stock, minStock, maxStock);
    const stockBadge = this._renderStockBadge(stockStatus);

    // Calcular receita acumulada de vendas deste produto
    const totalRevenueCents = this.recentSales.filter(s => !s.cancelledAt).reduce((acc, s) => acc + (s.totalSaleCents || 0), 0);

    // Calcular total adquirido em compras
    const activePurchases = this.recentPurchases.filter(item => !item.cancelledAt);
    const totalPurchasedUnits = activePurchases.reduce((acc, item) => acc + (item.quantity || 0), 0);
    const totalSpentPurchasesCents = activePurchases.reduce((acc, item) => acc + (item.totalCostCents || 0), 0);

    const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : '-';
    const updatedDate = p.updatedAt ? new Date(p.updatedAt).toLocaleString('pt-BR') : '-';

    const selectedImgUrl = this.imageUrls[this.selectedImageIndex]?.url;

    this.rootElement.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6">
        <!-- Top Navigation & Actions Bar -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div class="flex items-center gap-3">
            <a href="#/produtos" class="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition" title="Voltar para listagem">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
            </a>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-bold text-slate-900">${this._esc(p.name)}</h1>
                ${p.isActive !== false 
                  ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Ativo</span>'
                  : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">Inativo</span>'}
                ${stockBadge}
              </div>
              <p class="text-xs text-slate-400">ID: ${p.id}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <a href="#/compras" class="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-semibold rounded-lg transition border border-blue-200/60">
              <svg class="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
              Comprar
            </a>
            <a href="#/vendas" class="inline-flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-lg transition border border-emerald-200/60">
              <svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
              Vender
            </a>
            <a href="#/produtos/editar/${p.id}" class="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-700 transition shadow-xs">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Editar
            </a>
            <button id="btn-delete-detail" class="inline-flex items-center gap-2 px-3 py-2 border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 transition">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              Excluir
            </button>
          </div>
        </div>

        <!-- Main Grid Layout -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Left Column: Image Gallery (5 cols) -->
          <div class="lg:col-span-5 space-y-4">
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <!-- Main Large Image -->
              <div class="relative w-full aspect-square bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-100 group">
                ${selectedImgUrl 
                  ? `<img id="main-preview-img" src="${selectedImgUrl}" alt="${this._esc(p.name)}" class="w-full h-full object-contain p-2 transition-transform duration-300">`
                  : `<div class="text-center text-slate-400">
                      <svg class="w-16 h-16 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                      <span class="text-sm font-medium">Sem imagem cadastrada</span>
                    </div>`}
              </div>

              <!-- Thumbnails Selector -->
              ${this.imageUrls.length > 1 ? `
                <div class="flex gap-2 mt-3 overflow-x-auto pb-1" id="thumb-strip">
                  ${this.imageUrls.map((img, idx) => `
                    <button data-index="${idx}" class="thumb-btn flex-shrink-0 w-16 h-16 rounded-lg border-2 overflow-hidden transition ${idx === this.selectedImageIndex ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-400'}">
                      <img src="${img.url}" class="w-full h-full object-cover" alt="Thumbnail ${idx + 1}">
                    </button>
                  `).join('')}
                </div>
              ` : ''}
            </div>

            <!-- Commercial Summary Cards (Vendas & Compras) -->
            <div class="grid grid-cols-2 gap-3">
              <!-- Vendas Card -->
              <div class="bg-gradient-to-br from-white to-emerald-50/40 p-4 rounded-xl border border-emerald-200/60 shadow-xs space-y-2">
                <span class="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Vendas</span>
                <div>
                  <span class="text-xs text-slate-500 block">Total Vendido</span>
                  <span class="text-base font-black text-slate-800 block">${totalSold} un</span>
                </div>
                <div class="pt-1 border-t border-emerald-100">
                  <span class="text-[11px] text-slate-500 block">Receita Total</span>
                  <span class="text-sm font-bold text-emerald-700 block">${MoneyService.format(totalRevenueCents)}</span>
                </div>
              </div>

              <!-- Compras Card (FASE 6) -->
              <div class="bg-gradient-to-br from-white to-blue-50/40 p-4 rounded-xl border border-blue-200/60 shadow-xs space-y-2">
                <span class="text-[10px] font-bold text-blue-800 uppercase tracking-wider block">Compras</span>
                <div>
                  <span class="text-xs text-slate-500 block">Total Adquirido</span>
                  <span class="text-base font-black text-slate-800 block">${totalPurchasedUnits} un</span>
                </div>
                <div class="pt-1 border-t border-blue-100">
                  <span class="text-[11px] text-slate-500 block">Total Investido</span>
                  <span class="text-sm font-bold text-blue-700 block">${MoneyService.format(totalSpentPurchasesCents)}</span>
                </div>
              </div>
            </div>

            <!-- Identifiers Card -->
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
              <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Códigos de Identificação</h3>
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span class="text-xs text-slate-500 block">Código (SKU)</span>
                  <span class="font-semibold text-slate-800">${this._esc(p.productCode) || '<span class="text-slate-400 font-normal">Não informado</span>'}</span>
                </div>
                <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span class="text-xs text-slate-500 block">Código Interno</span>
                  <span class="font-semibold text-slate-800">${this._esc(p.internalCode) || '<span class="text-slate-400 font-normal">Não informado</span>'}</span>
                </div>
                <div class="col-span-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span class="text-xs text-slate-500 block">Código de Barras (EAN)</span>
                  <span class="font-mono font-semibold text-slate-800 tracking-wider">${this._esc(p.barcode) || '<span class="text-slate-400 font-normal">Não informado</span>'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Financials & Specifications (7 cols) -->
          <div class="lg:col-span-7 space-y-6">
            
            <!-- Financial Highlights Card -->
            <div class="bg-gradient-to-br from-white to-slate-50 p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <div class="flex items-center justify-between border-b border-slate-200/60 pb-3">
                <h3 class="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <svg class="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  Visão Financeira
                </h3>
                <span class="text-xs text-slate-400 font-medium">Fórmula padrão</span>
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div class="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs">
                  <span class="text-xs text-slate-500 uppercase font-semibold">Preço de Compra</span>
                  <p class="text-lg font-bold text-slate-800 mt-1">${purchaseFormatted}</p>
                </div>
                <div class="bg-white p-3.5 rounded-xl border border-blue-200/80 shadow-xs bg-blue-50/20">
                  <span class="text-xs text-blue-600 uppercase font-semibold">Preço de Venda</span>
                  <p class="text-xl font-black text-blue-700 mt-1">${saleFormatted}</p>
                </div>
                <div class="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs">
                  <span class="text-xs text-slate-500 uppercase font-semibold">Margem de Lucro</span>
                  <p class="text-lg font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'} mt-1">${margin ? margin.toFixed(2) + '%' : '0,00%'}</p>
                </div>
                <div class="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-xs">
                  <span class="text-xs text-slate-500 uppercase font-semibold">Markup</span>
                  <p class="text-lg font-bold text-slate-800 mt-1">${markup ? markup.toFixed(2) + '%' : '0,00%'}</p>
                </div>
              </div>

              <div class="p-3 bg-emerald-50/80 border border-emerald-100 rounded-lg flex items-center justify-between">
                <span class="text-sm font-medium text-emerald-900">Lucro Bruto Previsto por Unidade:</span>
                <span class="text-lg font-extrabold ${profitCents >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${profitFormatted}</span>
              </div>
            </div>

            <!-- Classification & Stock Parameters -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Classification -->
              <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
                <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Classificação</h3>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Categoria</span>
                    <span class="font-semibold text-slate-800">${this._esc(p.category) || '<span class="text-slate-400 font-normal">Geral</span>'}</span>
                  </div>
                  <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Subcategoria</span>
                    <span class="font-semibold text-slate-800">${this._esc(p.subcategory) || '<span class="text-slate-400 font-normal">-</span>'}</span>
                  </div>
                  <div class="flex justify-between py-1">
                    <span class="text-slate-500">Marca</span>
                    <span class="font-semibold text-slate-800">${this._esc(p.brand) || '<span class="text-slate-400 font-normal">-</span>'}</span>
                  </div>
                </div>
              </div>

              <!-- Stock Limits & Status -->
              <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Situação do Estoque</h3>
                  ${stockBadge}
                </div>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Saldo Atual</span>
                    <span class="text-base font-black ${stock <= 0 ? 'text-rose-600' : stockStatus === 'LOW_STOCK' ? 'text-amber-600' : 'text-slate-800'}">
                      ${stock} un
                    </span>
                  </div>
                  <div class="flex justify-between py-1 border-b border-slate-100">
                    <span class="text-slate-500">Estoque Mínimo</span>
                    <span class="font-semibold text-slate-800">${minStock} un</span>
                  </div>
                  <div class="flex justify-between py-1">
                    <span class="text-slate-500">Estoque Máximo</span>
                    <span class="font-semibold text-slate-800">${maxStock ? maxStock + ' un' : 'Ilimitado'}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Recent Movements -->
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
              <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Últimas Movimentações de Estoque</h3>
                <a href="#/estoque" class="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                  Ver no Estoque
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </a>
              </div>

              ${this.recentMovements.length > 0 ? `
                <div class="divide-y divide-slate-100 text-xs">
                  ${this.recentMovements.map(mov => {
                    const isPositive = ['IN', 'PURCHASE', 'RETURN'].includes(mov.type) || (mov.type === 'ADJUSTMENT' && (mov.delta > 0 || mov.quantity > 0));
                    const dStr = new Date(mov.date || mov.createdAt).toLocaleDateString('pt-BR');
                    return `
                      <div class="py-2 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          ${renderMovementTypeBadge(mov.type)}
                          <span class="text-slate-700 font-medium">${this._esc(mov.reason) || 'Movimentação'}</span>
                          <span class="text-slate-400">(${dStr})</span>
                        </div>
                        <span class="font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}">
                          ${isPositive ? '+' : '-'}${Math.abs(mov.delta !== undefined ? mov.delta : mov.quantity)} un
                        </span>
                      </div>
                    `;
                  }).join('')}
                </div>
              ` : `
                <p class="text-xs text-slate-400 py-2">Nenhuma movimentação registrada para este produto.</p>
              `}
            </div>

            <!-- Quotations Panel (FASE 7) -->
            ${this._renderQuotationsPanel()}

            <!-- Description & Notes -->
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <div>
                <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Descrição do Produto</h3>
                <p class="text-sm text-slate-700 whitespace-pre-line leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                  ${this._esc(p.description) || '<span class="text-slate-400 italic">Nenhuma descrição informada.</span>'}
                </p>
              </div>

              ${p.notes ? `
                <div>
                  <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Observações Internas</h3>
                  <p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed bg-amber-50/50 p-3 rounded-lg border border-amber-100/60">
                    ${this._esc(p.notes)}
                  </p>
                </div>
              ` : ''}

              <!-- Audit Timestamps -->
              <div class="pt-3 border-t border-slate-100 flex flex-wrap justify-between text-[11px] text-slate-400">
                <span>Criado em: ${createdDate}</span>
                <span>Última atualização: ${updatedDate}</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    this._bindDetailInteractions();
  }

  _renderStockBadge(status) {
    switch (status) {
      case STOCK_STATUS.OUT_OF_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">Esgotado</span>`;
      case STOCK_STATUS.LOW_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">Estoque Baixo</span>`;
      case STOCK_STATUS.EXCESS_STOCK:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800">Excesso</span>`;
      case STOCK_STATUS.NORMAL:
      default:
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">Estoque Normal</span>`;
    }
  }

  /**
   * Renderiza o painel de cotações ativas do produto (FASE 7).
   */
  _renderQuotationsPanel() {
    const quotations = this.activeQuotations || [];

    const rows = quotations.map(q => {
      const badges = [];
      if (q.isCheapest) badges.push(`<span class="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">⭐ MELHOR</span>`);
      if (q.isPreferred) badges.push(`<span class="px-1 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">★ PREF.</span>`);

      return `
        <div class="py-2 flex items-center justify-between border-b border-slate-100 last:border-0">
          <div class="flex flex-col gap-0.5">
            <span class="text-xs font-semibold text-slate-800">${this._esc(q.supplierName)}</span>
            <div class="flex items-center gap-1">
              ${badges.join('')}
              ${q.leadTimeDays != null ? `<span class="text-[10px] text-slate-400">${q.leadTimeDays}d</span>` : ''}
              ${q.paymentTerms ? `<span class="text-[10px] text-slate-400">· ${this._esc(q.paymentTerms)}</span>` : ''}
            </div>
          </div>
          <span class="text-sm font-black ${q.isCheapest ? 'text-emerald-700' : 'text-slate-800'}">${MoneyService.format(q.unitCostCents)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            Fornecedores Cotados
          </h3>
          <a href="#/cotacoes" class="text-xs text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
            Gerenciar
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </a>
        </div>
        ${quotations.length > 0 ? `
          <div class="space-y-0">
            ${rows}
          </div>
          <p class="text-[10px] text-slate-400">${quotations.length}/3 fornecedor${quotations.length > 1 ? 'es' : ''} ativo${quotations.length > 1 ? 's' : ''}</p>
        ` : `
          <div class="text-center py-3">
            <p class="text-xs text-slate-400">Nenhuma cotação ativa. <a href="#/cotacoes" class="text-blue-600 hover:underline font-medium">Adicionar cotação</a></p>
          </div>
        `}
      </div>
    `;
  }

  _bindDetailInteractions() {
    const thumbBtns = this.rootElement.querySelectorAll('.thumb-btn');
    thumbBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.selectedImageIndex = idx;
        const mainImg = this.rootElement.querySelector('#main-preview-img');
        if (mainImg && this.imageUrls[idx]) {
          mainImg.src = this.imageUrls[idx].url;
        }
        thumbBtns.forEach((b, i) => {
          if (i === idx) {
            b.classList.add('border-blue-600', 'ring-2', 'ring-blue-100');
            b.classList.remove('border-slate-200');
          } else {
            b.classList.remove('border-blue-600', 'ring-2', 'ring-blue-100');
            b.classList.add('border-slate-200');
          }
        });
      });
    });

    const delBtn = this.rootElement.querySelector('#btn-delete-detail');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (confirm(`Deseja realmente excluir o produto "${this.product.name}"?`)) {
          try {
            await ProductService.deleteProduct(this.productId);
            window.location.hash = '#/produtos';
          } catch (e) {
            alert('Erro ao excluir produto: ' + e.message);
          }
        }
      });
    }
  }

  bindEvents() {
    const unsubUpdate = eventBus.on(EVENTS.PRODUCT_UPDATED, (data) => {
      if (data && data.id === this.productId) {
        this.loadData();
      }
    });

    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, (data) => {
      if (data && data.productId === this.productId) {
        this.loadData();
      }
    });

    const unsubSale = eventBus.on(EVENTS.SALE_CREATED, (data) => {
      if (data && data.productId === this.productId) {
        this.loadData();
      }
    });

    const unsubPurchase = eventBus.on('PURCHASE_CREATED', (data) => {
      if (data && data.productId === this.productId) {
        this.loadData();
      }
    });

    const unsubDelete = eventBus.on(EVENTS.PRODUCT_DELETED, (data) => {
      if (data && data.id === this.productId) {
        window.location.hash = '#/produtos';
      }
    });

    this.cleanupListeners.push(unsubUpdate, unsubStock, unsubSale, unsubPurchase, unsubDelete);
  }

  _revokeImageUrls() {
    this.imageUrls.forEach(img => {
      if (img.url) URL.revokeObjectURL(img.url);
    });
    this.imageUrls = [];
  }

  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }

  destroy() {
    this._revokeImageUrls();
    this.cleanupListeners.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.cleanupListeners = [];
    this.rootElement.innerHTML = '';
  }
}
