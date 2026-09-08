import { ProductService } from '../services/ProductService.js';
import { MoneyService } from '../domain/MoneyService.js';
import { MarginService } from '../domain/MarginService.js';
import { ImageService } from '../services/ImageService.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';

export class ProductFormPage {
  constructor(rootElement, productId = null) {
    this.rootElement = rootElement;
    this.productId = productId;

    this.product = {
      name: '',
      productCode: '',
      internalCode: '',
      barcode: '',
      description: '',
      category: '',
      categoryId: '',
      subcategory: '',
      subcategoryId: '',
      brand: '',
      purchasePriceCents: 0,
      salePriceCents: 0,
      minimumStock: 0,
      maximumStock: 0,
      notes: '',
      isActive: true
    };

    this.newImages = []; // Array de { blob, thumbnailBlob, width, height, mimeType, sizeBytes, _previewUrl, _tempId, isPrimary }
    this.existingImages = []; // Array de records da store productImages com _viewUrl
    this.imagesToDelete = []; // Array de IDs
    this.isSaving = false;
    this.isRecalculating = false;
    this.objectUrlsToRevoke = [];
    this.pasteHandler = null;
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex items-center justify-center h-64">
        <p class="text-slate-500 font-medium animate-pulse">Carregando formulário...</p>
      </div>
    `;

    if (this.productId) {
      const data = await ProductService.getProductWithImages(this.productId);
      if (data && data.product) {
        this.product = { ...this.product, ...data.product };
        this.existingImages = data.images || [];
      } else {
        this.rootElement.innerHTML = `
          <div class="max-w-xl mx-auto bg-white p-6 rounded-xl border border-red-200 text-center">
            <h3 class="text-lg font-bold text-red-600 mb-2">Produto Não Encontrado</h3>
            <p class="text-slate-500 mb-4">O produto informado não existe ou foi removido.</p>
            <a href="#/produtos" class="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm">Voltar</a>
          </div>
        `;
        return;
      }
    }

    const title = this.productId ? 'Editar Produto' : 'Novo Produto';
    const purchaseFloat = this.product.purchasePriceCents ? MoneyService.toFloat(this.product.purchasePriceCents).toFixed(2) : '';
    const saleFloat = this.product.salePriceCents ? MoneyService.toFloat(this.product.salePriceCents).toFixed(2) : '';

    this.rootElement.innerHTML = `
      <div class="max-w-4xl mx-auto pb-12" id="form-container" tabindex="0">
        
        <!-- Header Actions -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sticky top-0 z-10 backdrop-blur-sm bg-white/95">
          <div>
            <h1 class="text-xl font-bold text-slate-900">${title}</h1>
            <p class="text-xs text-slate-500">Preencha os dados do produto e seus valores financeiros.</p>
          </div>
          <div class="flex items-center gap-3">
            <span id="save-status" class="text-sm font-medium transition-all opacity-0"></span>
            <a href="#/produtos" class="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition">
              Cancelar
            </a>
            <button id="btn-save" type="button" class="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:scale-95 transition shadow-xs flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              Salvar Produto
            </button>
          </div>
        </div>

        <form id="product-form" class="space-y-6" onsubmit="return false;">
          
          <!-- 1. IDENTIFICAÇÃO -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-blue-600"></span>
                Identificação do Produto
              </h2>
              <span class="text-xs text-slate-400 font-medium">* Campos obrigatórios</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="col-span-full">
                <label for="inp-name" class="block text-sm font-semibold text-slate-700 mb-1">
                  Nome do Produto <span class="text-rose-500">*</span>
                </label>
                <input type="text" id="inp-name" required value="${this._esc(this.product.name)}" placeholder="Ex: Teclado Mecânico RGB Wireless"
                       class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
                <p id="err-name" class="text-xs text-rose-500 mt-1 hidden"></p>
              </div>

              <div>
                <label for="inp-code" class="block text-sm font-medium text-slate-700 mb-1">Código do Produto (SKU)</label>
                <input type="text" id="inp-code" value="${this._esc(this.product.productCode)}" placeholder="Ex: TEC-MEC-01"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div>
                <label for="inp-internal-code" class="block text-sm font-medium text-slate-700 mb-1">Código Interno da Loja</label>
                <input type="text" id="inp-internal-code" value="${this._esc(this.product.internalCode)}" placeholder="Ex: 10045"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div class="col-span-full md:col-span-1">
                <label for="inp-barcode" class="block text-sm font-medium text-slate-700 mb-1">Código de Barras (EAN-13 / GTIN)</label>
                <input type="text" id="inp-barcode" value="${this._esc(this.product.barcode)}" placeholder="Ex: 7891234567890"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div class="flex items-center pt-6">
                <label class="relative flex items-center gap-3 cursor-pointer select-none">
                  <input type="checkbox" id="inp-active" ${this.product.isActive !== false ? 'checked' : ''} class="sr-only peer">
                  <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  <span class="text-sm font-semibold text-slate-700">Produto Ativo</span>
                </label>
              </div>
            </div>
          </div>

          <!-- 2. CLASSIFICAÇÃO -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="border-b border-slate-100 pb-3">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-600"></span>
                Classificação & Organização
              </h2>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label for="inp-category" class="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
                <input type="text" id="inp-category" value="${this._esc(this.product.category)}" placeholder="Ex: Periféricos"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div>
                <label for="inp-subcategory" class="block text-sm font-medium text-slate-700 mb-1">Subcategoria</label>
                <input type="text" id="inp-subcategory" value="${this._esc(this.product.subcategory)}" placeholder="Ex: Teclados"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div>
                <label for="inp-brand" class="block text-sm font-medium text-slate-700 mb-1">Marca / Fabricante</label>
                <input type="text" id="inp-brand" value="${this._esc(this.product.brand)}" placeholder="Ex: Logitech"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>
            </div>
          </div>

          <!-- 3. VALORES & PRECIFICAÇÃO -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="border-b border-slate-100 pb-3">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-600"></span>
                Precificação & Margens
              </h2>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200">
              
              <div>
                <label for="inp-purchase" class="block text-xs font-bold text-slate-600 uppercase mb-1">Preço de Compra</label>
                <div class="relative">
                  <span class="absolute left-3 top-2 text-slate-400 font-medium text-sm">R$</span>
                  <input type="number" step="0.01" min="0" id="inp-purchase" value="${purchaseFloat}" placeholder="0,00"
                         class="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
                </div>
              </div>

              <div>
                <label for="inp-margin" class="block text-xs font-bold text-slate-600 uppercase mb-1">Margem de Lucro</label>
                <div class="relative">
                  <input type="number" step="0.01" id="inp-margin" placeholder="0,00"
                         class="w-full pr-8 pl-3 py-2 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
                  <span class="absolute right-3 top-2 text-slate-400 font-medium text-sm">%</span>
                </div>
              </div>

              <div>
                <label for="inp-markup" class="block text-xs font-bold text-slate-600 uppercase mb-1">Markup</label>
                <div class="relative">
                  <input type="number" step="0.01" id="inp-markup" placeholder="0,00"
                         class="w-full pr-8 pl-3 py-2 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
                  <span class="absolute right-3 top-2 text-slate-400 font-medium text-sm">%</span>
                </div>
              </div>

              <div>
                <label for="inp-sale" class="block text-xs font-bold text-blue-700 uppercase mb-1">Preço de Venda</label>
                <div class="relative">
                  <span class="absolute left-3 top-2 text-blue-500 font-medium text-sm">R$</span>
                  <input type="number" step="0.01" min="0" id="inp-sale" value="${saleFloat}" placeholder="0,00"
                         class="w-full pl-9 pr-3 py-2 bg-white border border-blue-300 rounded-lg font-bold text-blue-700 text-right focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
                </div>
              </div>

              <div class="col-span-full pt-3 border-t border-slate-200/80 flex items-center justify-between">
                <span class="text-sm font-medium text-slate-600">Lucro Bruto Previsto:</span>
                <span id="lbl-profit" class="text-lg font-extrabold text-emerald-600">R$ 0,00</span>
              </div>
            </div>
          </div>

          <!-- 4. ESTOQUE -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="border-b border-slate-100 pb-3">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                Limites de Estoque
              </h2>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="inp-min-stock" class="block text-sm font-medium text-slate-700 mb-1">Estoque Mínimo (Alerta)</label>
                <input type="number" min="0" id="inp-min-stock" value="${this.product.minimumStock || 0}"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>

              <div>
                <label for="inp-max-stock" class="block text-sm font-medium text-slate-700 mb-1">Estoque Máximo</label>
                <input type="number" min="0" id="inp-max-stock" value="${this.product.maximumStock || 0}"
                       class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">
              </div>
            </div>
          </div>

          <!-- 5. OBSERVAÇÕES & DESCRIÇÃO -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="border-b border-slate-100 pb-3">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-slate-600"></span>
                Descrição & Detalhes
              </h2>
            </div>

            <div class="space-y-4">
              <div>
                <label for="inp-description" class="block text-sm font-medium text-slate-700 mb-1">Descrição do Produto</label>
                <textarea id="inp-description" rows="3" placeholder="Informações detalhadas sobre especificações, garantia, etc."
                          class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">${this._esc(this.product.description)}</textarea>
              </div>

              <div>
                <label for="inp-notes" class="block text-sm font-medium text-slate-700 mb-1">Observações Internas (Uso restrito da loja)</label>
                <textarea id="inp-notes" rows="2" placeholder="Notas sobre fornecedores, histórico, particularidades..."
                          class="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition">${this._esc(this.product.notes)}</textarea>
              </div>
            </div>
          </div>

          <!-- 6. IMAGENS & GALERIA -->
          <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div class="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 class="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-purple-600"></span>
                Galeria de Imagens
              </h2>
              <span class="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                💡 Dica: Cole imagens direto da área de transferência (CTRL+V)
              </span>
            </div>

            <!-- Upload Drop Zone -->
            <div id="drop-zone" class="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-slate-500 hover:bg-blue-50/50 hover:border-blue-400 hover:text-blue-600 transition cursor-pointer group">
              <div class="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-blue-100 group-hover:text-blue-600 flex items-center justify-center mb-3 transition">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              </div>
              <span class="font-semibold text-sm">Clique para selecionar ou arraste imagens até aqui</span>
              <span class="text-xs text-slate-400 mt-1">Formatos suportados: WebP, JPEG, PNG (Compactados automaticamente)</span>
              <input type="file" id="inp-file" accept="image/*" multiple class="hidden">
            </div>

            <!-- Gallery Grid -->
            <div id="gallery-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>
          </div>

        </form>
      </div>
    `;

    this.bindEvents();
    this.recalcFinancials();
    this.renderGallery();
  }

  bindEvents() {
    const inpPurchase = document.getElementById('inp-purchase');
    const inpSale = document.getElementById('inp-sale');
    const inpMargin = document.getElementById('inp-margin');
    const inpMarkup = document.getElementById('inp-markup');

    // Preço de Compra Alterado
    inpPurchase.addEventListener('input', () => {
      if (this.isRecalculating) return;
      this.isRecalculating = true;
      this.product.purchasePriceCents = MoneyService.toCents(inpPurchase.value);

      // Se houver margem digitada, recalcula preço de venda; senão recalcula margem baseada na venda
      const marginVal = parseFloat(inpMargin.value);
      if (!isNaN(marginVal) && marginVal > 0 && marginVal < 100) {
        const newSale = MarginService.calculateSaleFromMargin(this.product.purchasePriceCents, marginVal);
        this.product.salePriceCents = newSale;
        inpSale.value = MoneyService.toFloat(newSale).toFixed(2);
      } else {
        this.product.salePriceCents = MoneyService.toCents(inpSale.value);
      }

      this.recalcFinancials(true, false);
      this.isRecalculating = false;
    });

    // Preço de Venda Alterado
    inpSale.addEventListener('input', () => {
      if (this.isRecalculating) return;
      this.isRecalculating = true;
      this.product.salePriceCents = MoneyService.toCents(inpSale.value);
      this.product.purchasePriceCents = MoneyService.toCents(inpPurchase.value);
      this.recalcFinancials(false, false);
      this.isRecalculating = false;
    });

    // Margem Alterada
    inpMargin.addEventListener('input', () => {
      if (this.isRecalculating) return;
      this.isRecalculating = true;
      const margin = parseFloat(inpMargin.value);
      this.product.purchasePriceCents = MoneyService.toCents(inpPurchase.value);

      if (!isNaN(margin) && margin < 100) {
        try {
          const saleCents = MarginService.calculateSaleFromMargin(this.product.purchasePriceCents, margin);
          this.product.salePriceCents = saleCents;
          inpSale.value = MoneyService.toFloat(saleCents).toFixed(2);
          this.recalcFinancials(true, false);
        } catch (e) {
          // Ignore
        }
      }
      this.isRecalculating = false;
    });

    // Markup Alterado
    inpMarkup.addEventListener('input', () => {
      if (this.isRecalculating) return;
      this.isRecalculating = true;
      const markup = parseFloat(inpMarkup.value);
      this.product.purchasePriceCents = MoneyService.toCents(inpPurchase.value);

      if (!isNaN(markup)) {
        try {
          const saleCents = MarginService.calculateSaleFromMarkup(this.product.purchasePriceCents, markup);
          this.product.salePriceCents = saleCents;
          inpSale.value = MoneyService.toFloat(saleCents).toFixed(2);
          this.recalcFinancials(false, true);
        } catch (e) {
          // Ignore
        }
      }
      this.isRecalculating = false;
    });

    // Botão Salvar
    document.getElementById('btn-save').addEventListener('click', () => this.save());

    // Upload via Input e Drag & Drop
    const fileInput = document.getElementById('inp-file');
    const dropZone = document.getElementById('drop-zone');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-blue-50', 'border-blue-500');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-blue-50', 'border-blue-500');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-blue-50', 'border-blue-500');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleFiles(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.handleFiles(Array.from(e.target.files));
      }
    });

    // Suporte ao colar imagem com CTRL+V
    this.pasteHandler = (e) => {
      const files = ImageService.extractImagesFromClipboard(e);
      if (files && files.length > 0) {
        e.preventDefault();
        this.handleFiles(files);
      }
    };
    window.addEventListener('paste', this.pasteHandler);
  }

  recalcFinancials(skipMarginUpdate = false, skipMarkupUpdate = false) {
    const purchase = this.product.purchasePriceCents || 0;
    const sale = this.product.salePriceCents || 0;

    const profit = MarginService.calculateProfit(sale, purchase);
    const markup = MarginService.calculateMarkup(sale, purchase);
    const margin = MarginService.calculateMargin(sale, purchase);

    const profitEl = document.getElementById('lbl-profit');
    if (profitEl) {
      profitEl.textContent = MoneyService.format(profit);
      if (profit < 0) {
        profitEl.className = 'text-lg font-extrabold text-rose-600';
      } else {
        profitEl.className = 'text-lg font-extrabold text-emerald-600';
      }
    }

    if (!skipMarkupUpdate) {
      const markupInp = document.getElementById('inp-markup');
      if (markupInp) markupInp.value = markup ? markup.toFixed(2) : '';
    }

    if (!skipMarginUpdate) {
      const marginInp = document.getElementById('inp-margin');
      if (marginInp) marginInp.value = margin ? margin.toFixed(2) : '';
    }
  }

  async handleFiles(files) {
    const status = document.getElementById('save-status');
    if (status) {
      status.textContent = 'Processando imagens...';
      status.className = 'text-sm font-medium text-blue-600 transition-all opacity-100';
    }

    try {
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          const processed = await ImageService.processImage(file);
          const previewUrl = URL.createObjectURL(processed.thumbnailBlob);
          this.objectUrlsToRevoke.push(previewUrl);

          // Se não há imagens existentes e esta é a primeira nova, torna-se primária
          const hasAnyPrimary = this.existingImages.some(i => i.isPrimary) || this.newImages.some(i => i.isPrimary);

          this.newImages.push({
            ...processed,
            _previewUrl: previewUrl,
            _tempId: crypto.randomUUID(),
            isPrimary: !hasAnyPrimary
          });
        }
      }

      this.renderGallery();
      if (status) {
        status.textContent = 'Imagens adicionadas!';
        status.className = 'text-sm font-medium text-emerald-600 transition-all opacity-100';
        setTimeout(() => { status.className = 'text-sm font-medium transition-all opacity-0'; }, 2000);
      }
    } catch (e) {
      alert('Erro ao processar imagem: ' + e.message);
      if (status) status.className = 'text-sm font-medium transition-all opacity-0';
    }
  }

  renderGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Imagens existentes no banco
    this.existingImages.forEach(img => {
      if (!img._viewUrl) {
        img._viewUrl = URL.createObjectURL(img.thumbnailBlob || img.blob);
        this.objectUrlsToRevoke.push(img._viewUrl);
      }
      this._renderImageCard(grid, img._viewUrl, img.id, true, img.isPrimary);
    });

    // Novas imagens pendentes de salvamento
    this.newImages.forEach(img => {
      this._renderImageCard(grid, img._previewUrl, img._tempId, false, img.isPrimary);
    });
  }

  _renderImageCard(container, imgSrc, id, isExisting, isPrimary) {
    const el = document.createElement('div');
    el.className = 'relative rounded-xl border border-slate-200 overflow-hidden h-36 group bg-slate-100 shadow-xs flex items-center justify-center';

    const img = document.createElement('img');
    img.src = imgSrc;
    img.className = 'w-full h-full object-cover';
    img.alt = 'Foto do produto';
    el.appendChild(img);

    if (isPrimary) {
      const badge = document.createElement('span');
      badge.className = 'absolute top-2 left-2 bg-amber-400 text-amber-950 text-[11px] font-extrabold px-2 py-0.5 rounded-md shadow-xs flex items-center gap-1 z-10';
      badge.innerHTML = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg> Principal';
      el.appendChild(badge);
    }

    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-200';

    // Botão para tornar Principal
    if (!isPrimary) {
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'bg-amber-400 text-amber-950 p-2 rounded-full hover:bg-amber-500 active:scale-95 transition shadow-xs';
      starBtn.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>';
      starBtn.title = 'Definir como imagem principal';
      starBtn.addEventListener('click', async () => {
        if (isExisting && this.productId) {
          await productImageRepository.setPrimary(this.productId, id);
          const data = await ProductService.getProductWithImages(this.productId);
          if (data) {
            this.existingImages = data.images || [];
            this.renderGallery();
          }
        } else {
          // Atualiza nas listas em memória
          this.existingImages.forEach(i => { i.isPrimary = false; });
          this.newImages.forEach(i => { i.isPrimary = i._tempId === id; });
          this.renderGallery();
        }
      });
      overlay.appendChild(starBtn);
    }

    // Botão Excluir Imagem
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'bg-rose-600 text-white p-2 rounded-full hover:bg-rose-700 active:scale-95 transition shadow-xs';
    deleteBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
    deleteBtn.title = 'Remover imagem';
    deleteBtn.addEventListener('click', () => {
      if (isExisting) {
        this.imagesToDelete.push(id);
        this.existingImages = this.existingImages.filter(i => i.id !== id);
      } else {
        this.newImages = this.newImages.filter(i => i._tempId !== id);
      }
      this.renderGallery();
    });
    overlay.appendChild(deleteBtn);

    el.appendChild(overlay);
    container.appendChild(el);
  }

  async save() {
    if (this.isSaving) return;

    // Coleta dos campos
    this.product.name = document.getElementById('inp-name').value;
    this.product.productCode = document.getElementById('inp-code').value;
    this.product.internalCode = document.getElementById('inp-internal-code').value;
    this.product.barcode = document.getElementById('inp-barcode').value;
    this.product.category = document.getElementById('inp-category').value;
    this.product.subcategory = document.getElementById('inp-subcategory').value;
    this.product.brand = document.getElementById('inp-brand').value;
    this.product.description = document.getElementById('inp-description').value;
    this.product.notes = document.getElementById('inp-notes').value;
    this.product.minimumStock = parseInt(document.getElementById('inp-min-stock').value, 10) || 0;
    this.product.maximumStock = parseInt(document.getElementById('inp-max-stock').value, 10) || 0;
    this.product.isActive = document.getElementById('inp-active').checked;

    const inpPurchase = document.getElementById('inp-purchase');
    const inpSale = document.getElementById('inp-sale');
    if (inpPurchase) this.product.purchasePriceCents = MoneyService.toCents(inpPurchase.value);
    if (inpSale) this.product.salePriceCents = MoneyService.toCents(inpSale.value);

    const btn = document.getElementById('btn-save');
    const status = document.getElementById('save-status');

    try {
      this.isSaving = true;
      btn.disabled = true;
      btn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        Salvando...
      `;

      status.textContent = 'Salvando...';
      status.className = 'text-sm font-medium text-slate-500 transition-all opacity-100';

      const cleanNewImages = this.newImages.map(img => {
        const copy = { ...img };
        delete copy._previewUrl;
        delete copy._tempId;
        return copy;
      });

      let savedId;
      if (this.productId) {
        savedId = await ProductService.updateProduct(this.productId, this.product, cleanNewImages, this.imagesToDelete);
      } else {
        savedId = await ProductService.createProduct(this.product, cleanNewImages);
      }

      status.textContent = 'Salvo com sucesso!';
      status.className = 'text-sm font-medium text-emerald-600 transition-all opacity-100';

      setTimeout(() => {
        window.location.hash = `#/produtos/detalhes/${savedId}`;
      }, 600);

    } catch (e) {
      console.error(e);
      status.textContent = e.message || 'Erro ao salvar produto.';
      status.className = 'text-sm font-medium text-rose-600 transition-all opacity-100';
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Tentar Novamente
      `;
    } finally {
      this.isSaving = false;
    }
  }

  _esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  destroy() {
    if (this.pasteHandler) {
      window.removeEventListener('paste', this.pasteHandler);
      this.pasteHandler = null;
    }
    this.objectUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    this.objectUrlsToRevoke = [];
    this.rootElement.innerHTML = '';
  }
}
