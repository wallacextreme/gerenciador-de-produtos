import { productRepository } from '../repositories/ProductRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { MoneyService } from '../domain/MoneyService.js';
import { MarginService } from '../domain/MarginService.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { ProductService } from '../services/ProductService.js';

export class ProductsPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.products = [];
    this.cleanupListeners = [];
    this.thumbnailUrls = [];
    this.searchDebounceTimer = null;
    this.filters = {
      query: '',
      category: '',
      brand: '',
      status: 'active'
    };
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Header & Filters Toolbar -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col gap-4">
          
          <!-- Top Row: Search & New Product Button -->
          <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div class="flex-1 relative">
              <input type="text" id="search-input" value="${this._esc(this.filters.query)}"
                     placeholder="Buscar por nome, SKU, código interno, barras ou marca..."
                     class="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              <svg class="w-5 h-5 text-slate-400 absolute left-3 top-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            
            <a href="#/produtos/novo" class="bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-2 whitespace-nowrap">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Novo Produto
            </a>
          </div>

          <!-- Bottom Row: Multi-Filter Selects -->
          <div class="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-sm">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-slate-500 uppercase">Filtros:</span>
            </div>

            <!-- Categoria Filter -->
            <select id="filter-category" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none focus:border-blue-600">
              <option value="">Todas as Categorias</option>
            </select>

            <!-- Marca Filter -->
            <select id="filter-brand" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none focus:border-blue-600">
              <option value="">Todas as Marcas</option>
            </select>

            <!-- Status Filter -->
            <select id="filter-status" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none focus:border-blue-600">
              <option value="active" selected>Apenas Ativos</option>
              <option value="inactive">Apenas Inativos</option>
              <option value="all">Todos os Produtos</option>
            </select>

            <span id="product-count" class="ml-auto text-xs text-slate-400 font-medium">Carregando...</span>
          </div>

        </div>

        <!-- Products Grid Area -->
        <div class="flex-1 overflow-auto">
          <div id="products-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <!-- Loading Skeleton Cards -->
            ${this._renderSkeletonCards()}
          </div>

          <!-- Empty State -->
          <div id="empty-state" class="hidden flex-col items-center justify-center p-12 text-center bg-white rounded-2xl border border-slate-200 my-4 shadow-xs">
            <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-1">Nenhum produto encontrado</h3>
            <p class="text-xs text-slate-500 max-w-sm mb-5">Não encontramos produtos correspondentes aos filtros aplicados ou sua base ainda está vazia.</p>
            <a href="#/produtos/novo" class="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition shadow-xs">
              Cadastrar Produto
            </a>
          </div>
        </div>

      </div>
    `;

    this.bindEvents();
    await this.loadFilterOptions();
    await this.loadData();
  }

  async loadFilterOptions() {
    try {
      const categories = await productRepository.getCategories();
      const catSelect = document.getElementById('filter-category');
      if (catSelect) {
        catSelect.innerHTML = '<option value="">Todas as Categorias</option>' +
          categories.map(c => `<option value="${this._esc(c)}">${this._esc(c)}</option>`).join('');
      }

      const brands = await productRepository.getBrands();
      const brandSelect = document.getElementById('filter-brand');
      if (brandSelect) {
        brandSelect.innerHTML = '<option value="">Todas as Marcas</option>' +
          brands.map(b => `<option value="${this._esc(b)}">${this._esc(b)}</option>`).join('');
      }
    } catch (e) {
      console.warn('Erro ao carregar opções de filtro:', e);
    }
  }

  bindEvents() {
    // Multiaba Sync via EventBus
    const unsubUpdate = eventBus.on(EVENTS.PRODUCT_UPDATED, async () => {
      await this.loadFilterOptions();
      await this.loadData();
    });
    const unsubDelete = eventBus.on(EVENTS.PRODUCT_DELETED, async () => {
      await this.loadFilterOptions();
      await this.loadData();
    });
    this.cleanupListeners.push(unsubUpdate, unsubDelete);

    // Search Input com Debounce de 300ms
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.filters.query = e.target.value;
          this.loadData();
        }, 300);
      });
    }

    // Filtros de seleção
    const catSelect = document.getElementById('filter-category');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        this.filters.category = e.target.value;
        this.loadData();
      });
    }

    const brandSelect = document.getElementById('filter-brand');
    if (brandSelect) {
      brandSelect.addEventListener('change', (e) => {
        this.filters.brand = e.target.value;
        this.loadData();
      });
    }

    const statusSelect = document.getElementById('filter-status');
    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        this.filters.status = e.target.value;
        this.loadData();
      });
    }
  }

  async loadData() {
    try {
      this._revokeThumbnails();
      this.products = await productRepository.list(this.filters);
      
      const countEl = document.getElementById('product-count');
      if (countEl) {
        countEl.textContent = `${this.products.length} ${this.products.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
      }

      this.renderGrid();
    } catch (e) {
      console.error('Erro ao carregar lista de produtos:', e);
      const grid = document.getElementById('products-grid');
      if (grid) {
        grid.innerHTML = `
          <div class="col-span-full bg-red-50 text-red-600 p-4 rounded-xl text-center text-sm">
            Erro ao carregar catálogo: ${e.message}
          </div>
        `;
      }
    }
  }

  renderGrid() {
    const grid = document.getElementById('products-grid');
    const empty = document.getElementById('empty-state');
    if (!grid || !empty) return;

    if (this.products.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      empty.classList.add('flex');
      return;
    }

    empty.classList.add('hidden');
    empty.classList.remove('flex');
    grid.innerHTML = '';

    const frag = document.createDocumentFragment();

    for (const p of this.products) {
      const card = this._createCard(p);
      frag.appendChild(card);
    }

    grid.appendChild(frag);
  }

  _createCard(p) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl border border-slate-200 shadow-xs hover:shadow-md hover:border-blue-200 transition-all duration-200 group overflow-hidden flex flex-col cursor-pointer';

    // Imagem do Card
    const imgContainer = document.createElement('div');
    imgContainer.className = 'h-44 bg-slate-100 relative overflow-hidden flex items-center justify-center';
    imgContainer.innerHTML = `
      <div class="absolute inset-0 flex items-center justify-center text-slate-300">
        <svg class="w-10 h-10 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
      </div>
    `;

    // Status Badge no Card
    if (p.isActive === false) {
      const inactiveBadge = document.createElement('span');
      inactiveBadge.className = 'absolute top-2 left-2 bg-slate-800/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-xs z-10';
      inactiveBadge.textContent = 'Inativo';
      imgContainer.appendChild(inactiveBadge);
    }

    const priceFormatted = MoneyService.format(p.salePriceCents);
    const margin = MarginService.calculateMargin(p.salePriceCents, p.purchasePriceCents);
    const markup = MarginService.calculateMarkup(p.salePriceCents, p.purchasePriceCents);

    // Corpo de Informações
    const infoDiv = document.createElement('div');
    infoDiv.className = 'p-4 flex-1 flex flex-col justify-between space-y-3';

    // Título e Tags
    const headerDiv = document.createElement('div');
    headerDiv.className = 'space-y-1.5';

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'flex flex-wrap items-center gap-1.5';

    if (p.productCode) {
      const codeSpan = document.createElement('span');
      codeSpan.className = 'text-[11px] bg-slate-100 text-slate-600 font-mono px-2 py-0.5 rounded font-medium';
      codeSpan.textContent = p.productCode;
      tagsDiv.appendChild(codeSpan);
    }

    if (p.category) {
      const catSpan = document.createElement('span');
      catSpan.className = 'text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium';
      catSpan.textContent = p.category;
      tagsDiv.appendChild(catSpan);
    }

    const nameEl = document.createElement('h3');
    nameEl.className = 'font-bold text-slate-800 text-sm leading-snug line-clamp-2 group-hover:text-blue-600 transition';
    nameEl.textContent = p.name;
    nameEl.title = p.name;

    headerDiv.appendChild(tagsDiv);
    headerDiv.appendChild(nameEl);
    infoDiv.appendChild(headerDiv);

    // Valores e Margens
    const statsDiv = document.createElement('div');
    statsDiv.className = 'pt-3 border-t border-slate-100 flex items-end justify-between';
    statsDiv.innerHTML = `
      <div>
        <span class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Preço de Venda</span>
        <span class="text-base font-extrabold text-blue-700">${this._esc(priceFormatted)}</span>
      </div>
      <div class="text-right">
        <span class="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Margem</span>
        <span class="text-xs font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
          ${margin ? margin.toFixed(1) + '%' : '0%'}
        </span>
      </div>
    `;
    infoDiv.appendChild(statsDiv);

    // Botões de Ação
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2';

    const detailBtn = document.createElement('a');
    detailBtn.href = `#/produtos/detalhes/${p.id}`;
    detailBtn.className = 'text-xs font-semibold text-slate-600 hover:text-blue-600 py-1 transition flex items-center gap-1';
    detailBtn.innerHTML = `<span>Detalhes</span> <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'flex items-center gap-1.5';

    const editBtn = document.createElement('a');
    editBtn.href = `#/produtos/editar/${p.id}`;
    editBtn.className = 'p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-md transition';
    editBtn.title = 'Editar produto';
    editBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition';
    deleteBtn.title = 'Excluir produto (Soft Delete)';
    deleteBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
    
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Deseja realmente excluir o produto "${p.name}"?`)) {
        try {
          await ProductService.deleteProduct(p.id);
        } catch (err) {
          alert('Erro ao excluir: ' + err.message);
        }
      }
    });

    buttonGroup.appendChild(editBtn);
    buttonGroup.appendChild(deleteBtn);

    actionsDiv.appendChild(detailBtn);
    actionsDiv.appendChild(buttonGroup);

    card.appendChild(imgContainer);
    card.appendChild(infoDiv);
    card.appendChild(actionsDiv);

    // Ao clicar em qualquer parte do card que não seja link/botão, navega para detalhes
    card.addEventListener('click', (e) => {
      if (!e.target.closest('a') && !e.target.closest('button')) {
        window.location.hash = `#/produtos/detalhes/${p.id}`;
      }
    });

    // Lazy load apenas do ThumbnailBlob (otimização de memória e desempenho)
    this._loadThumbnail(p.id, imgContainer);

    return card;
  }

  async _loadThumbnail(productId, container) {
    try {
      const primaryImg = await productImageRepository.getPrimaryImage(productId);
      if (primaryImg && (primaryImg.thumbnailBlob || primaryImg.blob)) {
        const url = URL.createObjectURL(primaryImg.thumbnailBlob || primaryImg.blob);
        this.thumbnailUrls.push(url);

        const img = document.createElement('img');
        img.src = url;
        img.className = 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105';
        img.alt = 'Thumbnail';
        container.innerHTML = '';
        container.appendChild(img);
      } else {
        container.innerHTML = `
          <div class="flex flex-col items-center justify-center text-slate-300">
            <svg class="w-12 h-12 mb-1 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span class="text-[11px] font-medium text-slate-400">Sem foto</span>
          </div>
        `;
      }
    } catch (e) {
      console.warn('Falha ao carregar miniatura:', e);
    }
  }

  _renderSkeletonCards() {
    return Array.from({ length: 8 }).map(() => `
      <div class="bg-white rounded-xl border border-slate-200 overflow-hidden animate-pulse flex flex-col h-72">
        <div class="h-40 bg-slate-200"></div>
        <div class="p-4 flex-1 space-y-3">
          <div class="h-4 bg-slate-200 rounded w-3/4"></div>
          <div class="h-3 bg-slate-200 rounded w-1/2"></div>
          <div class="pt-4 border-t border-slate-100 flex justify-between">
            <div class="h-5 bg-slate-200 rounded w-1/3"></div>
            <div class="h-5 bg-slate-200 rounded w-1/4"></div>
          </div>
        </div>
      </div>
    `).join('');
  }

  _revokeThumbnails() {
    this.thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    this.thumbnailUrls = [];
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy() {
    this._revokeThumbnails();
    clearTimeout(this.searchDebounceTimer);
    this.cleanupListeners.forEach(unsub => unsub());
    this.cleanupListeners = [];
    this.rootElement.innerHTML = '';
  }
}
