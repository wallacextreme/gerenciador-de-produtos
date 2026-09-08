import { QuotationService } from '../services/QuotationService.js';
import { ProductService } from '../services/ProductService.js';
import { SupplierService } from '../services/SupplierService.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { MoneyService } from '../domain/MoneyService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class QuotationsPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.products = [];
    this.suppliers = [];
    this.selectedProductId = null;
    this.quotations = [];
    this.history = [];
    this.showHistory = false;
    this.cleanupListeners = [];
    this.modalData = null;
    this.editingQuotationId = null;
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div>
            <h2 class="text-lg font-black text-slate-900 tracking-tight">Cotações de Fornecedores</h2>
            <p class="text-xs text-slate-500">Compare preços, prazos e condições por produto — até 3 fornecedores ativos por produto</p>
          </div>
          <div>
          </div>
        </div>

        <!-- Product Selector -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <label class="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Selecionar Produto</label>
          <div class="flex flex-col sm:flex-row gap-3">
            <select id="product-selector" class="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Selecione um produto para ver as cotações —</option>
            </select>
            <button id="btn-toggle-history" class="px-4 py-2 text-xs font-semibold border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition whitespace-nowrap hidden">
              Histórico Completo
            </button>
            <button id="btn-new-quotation" class="bg-blue-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg hover:bg-blue-700 transition shadow-xs flex items-center gap-2 whitespace-nowrap hidden">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Nova Cotação
            </button>
          </div>
        </div>

        <!-- Quotation Content -->
        <div id="quotation-content">
          <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-12 text-center">
            <svg class="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
            <p class="text-sm text-slate-400 font-medium">Selecione um produto acima para visualizar e gerenciar suas cotações.</p>
          </div>
        </div>
      </div>

      <!-- Quotation Modal -->
      <div id="quotation-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
          <div class="p-6 border-b border-slate-100">
            <div class="flex items-center justify-between">
              <h3 class="text-base font-bold text-slate-900" id="modal-title">Nova Cotação</h3>
              <button id="btn-close-modal" class="text-slate-400 hover:text-slate-600 transition">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <form id="quotation-form" class="p-6 space-y-4">
            <!-- Fornecedor -->
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Fornecedor <span class="text-red-500">*</span></label>
              <select id="modal-supplier" class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Selecione o fornecedor...</option>
              </select>
            </div>

            <!-- Preço unitário -->
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Preço Unitário (R$) <span class="text-red-500">*</span></label>
              <input id="modal-price" type="text" placeholder="0,00" inputmode="decimal"
                class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <p class="text-[10px] text-slate-400 mt-0.5">Valor em Reais (será convertido para centavos)</p>
            </div>

            <!-- Linha: Qtd Mínima + Prazo -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Qtd. Mínima</label>
                <input id="modal-min-qty" type="number" min="1" step="1" placeholder="ex: 10"
                  class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Prazo de Entrega (dias)</label>
                <input id="modal-lead-time" type="number" min="0" step="1" placeholder="ex: 7"
                  class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
            </div>

            <!-- Condições de pagamento -->
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Condições de Pagamento</label>
              <input id="modal-payment-terms" type="text" placeholder="ex: 30/60 dias, À vista..."
                class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>

            <!-- Linha: Data cotação + Validade -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Data da Cotação</label>
                <input id="modal-quote-date" type="date"
                  class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-600 mb-1">Validade</label>
                <input id="modal-valid-until" type="date"
                  class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
            </div>

            <!-- Notas -->
            <div>
              <label class="block text-xs font-semibold text-slate-600 mb-1">Observações</label>
              <textarea id="modal-notes" rows="2" placeholder="Informações adicionais sobre esta cotação..."
                class="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
            </div>

            <div id="modal-error" class="hidden text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"></div>

            <div class="flex gap-3 pt-2">
              <button type="button" id="btn-cancel-modal" class="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
                Cancelar
              </button>
              <button type="submit" id="btn-submit-modal" class="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
                Salvar Cotação
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    await this._loadDropdowns();
    this._bindPageEvents();
    this._subscribeToEvents();
  }

  async _loadDropdowns() {
    // Produtos
    try {
      this.products = await productRepository.list({ status: 'active' });
    } catch (err) {
      console.error('[QuotationsPage] Erro ao listar produtos:', err);
      this.products = [];
    }

    const selector = this.rootElement.querySelector('#product-selector');
    if (selector) {
      selector.innerHTML = '<option value="">— Selecione um produto para ver as cotações —</option>';
      this.products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name}${p.productCode ? ' [' + p.productCode + ']' : ''}`;
        selector.appendChild(opt);
      });
      if (this.selectedProductId) selector.value = this.selectedProductId;
    }

    // Fornecedores
    try {
      this.suppliers = await SupplierService.listSuppliers({ status: 'active' });
    } catch (err) {
      console.error('[QuotationsPage] Erro ao listar fornecedores:', err);
      this.suppliers = [];
    }
  }

  _bindPageEvents() {
    const selector = this.rootElement.querySelector('#product-selector');
    if (selector) {
      selector.addEventListener('change', async (e) => {
        this.selectedProductId = e.target.value || null;
        this.showHistory = false;
        await this._loadQuotations();
      });
    }

    const btnNew = this.rootElement.querySelector('#btn-new-quotation');
    if (btnNew) {
      btnNew.addEventListener('click', () => this._openModal(null));
    }

    const btnHistory = this.rootElement.querySelector('#btn-toggle-history');
    if (btnHistory) {
      btnHistory.addEventListener('click', async () => {
        this.showHistory = !this.showHistory;
        btnHistory.textContent = this.showHistory ? 'Apenas Ativas' : 'Histórico Completo';
        await this._loadQuotations();
      });
    }

    const btnClose = this.rootElement.querySelector('#btn-close-modal');
    const btnCancel = this.rootElement.querySelector('#btn-cancel-modal');
    if (btnClose) btnClose.addEventListener('click', () => this._closeModal());
    if (btnCancel) btnCancel.addEventListener('click', () => this._closeModal());

    const form = this.rootElement.querySelector('#quotation-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this._submitModal();
      });
    }

    const modal = this.rootElement.querySelector('#quotation-modal');
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) this._closeModal(); });
    }
  }

  async _loadQuotations() {
    if (!this.selectedProductId) {
      this._renderNoProduct();
      return;
    }

    const btnNew = this.rootElement.querySelector('#btn-new-quotation');
    const btnHistory = this.rootElement.querySelector('#btn-toggle-history');
    if (btnNew) btnNew.classList.remove('hidden');
    if (btnHistory) btnHistory.classList.remove('hidden');

    try {
      if (this.showHistory) {
        this.history = await QuotationService.getQuotationHistory(this.selectedProductId);
        this._renderHistory();
      } else {
        this.quotations = await QuotationService.getQuotationsForProduct(this.selectedProductId);
        this._renderQuotations();
      }
    } catch (e) {
      this._renderError(e.message);
    }
  }

  _renderNoProduct() {
    const content = this.rootElement.querySelector('#quotation-content');
    if (!content) return;
    const btnNew = this.rootElement.querySelector('#btn-new-quotation');
    const btnHistory = this.rootElement.querySelector('#btn-toggle-history');
    if (btnNew) btnNew.classList.add('hidden');
    if (btnHistory) btnHistory.classList.add('hidden');
    content.innerHTML = `
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-12 text-center">
        <svg class="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p class="text-sm text-slate-400 font-medium">Selecione um produto acima para visualizar e gerenciar suas cotações.</p>
      </div>
    `;
  }

  _renderQuotations() {
    const content = this.rootElement.querySelector('#quotation-content');
    if (!content) return;

    const count = this.quotations.length;
    const canAdd = count < 3;

    const cardsCss = 'grid grid-cols-1 md:grid-cols-3 gap-4';

    if (count === 0) {
      content.innerHTML = `
        <div class="bg-white rounded-xl border border-dashed border-blue-300 shadow-xs p-10 text-center">
          <svg class="w-10 h-10 mx-auto mb-3 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="text-sm text-slate-500 font-medium mb-1">Nenhuma cotação ativa para este produto.</p>
          <p class="text-xs text-slate-400">Adicione até 3 fornecedores e compare os melhores preços.</p>
        </div>
      `;
      return;
    }

    const cards = this.quotations.map(q => this._buildQuotationCard(q)).join('');

    content.innerHTML = `
      <!-- Legenda de slots -->
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-slate-500 font-medium">${count}/3 fornecedores ativos</span>
        <div class="flex items-center gap-3 text-[11px]">
          <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span> Melhor Preço</span>
          <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-amber-500"></span> Preferido</span>
          <span class="flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full bg-rose-400"></span> Vencida</span>
        </div>
      </div>

      <!-- Cards de cotação -->
      <div class="${cardsCss}">
        ${cards}
        ${canAdd ? `
          <div class="border-2 border-dashed border-blue-200 rounded-xl flex flex-col items-center justify-center p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition group" id="card-add-slot">
            <svg class="w-8 h-8 text-blue-300 group-hover:text-blue-500 mb-2 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/></svg>
            <span class="text-xs text-blue-500 font-semibold">Adicionar Fornecedor</span>
            <span class="text-[10px] text-blue-400">(${3 - count} slot${3 - count > 1 ? 's' : ''} disponível)</span>
          </div>
        ` : ''}
      </div>
    `;

    // Bind card buttons
    this.quotations.forEach(q => {
      const btnPreferred = content.querySelector(`#btn-preferred-${q.id}`);
      const btnEdit = content.querySelector(`#btn-edit-${q.id}`);
      const btnDeactivate = content.querySelector(`#btn-deactivate-${q.id}`);

      if (btnPreferred) {
        btnPreferred.addEventListener('click', async () => {
          await QuotationService.setPreferredSupplier(this.selectedProductId, q.id);
          await this._loadQuotations();
        });
      }
      if (btnEdit) {
        btnEdit.addEventListener('click', () => this._openModal(q));
      }
      if (btnDeactivate) {
        btnDeactivate.addEventListener('click', async () => {
          if (confirm(`Desativar cotação do fornecedor "${q.supplierName}"?\n\nEla será preservada no histórico.`)) {
            await QuotationService.deactivateQuotation(q.id);
            await this._loadQuotations();
          }
        });
      }
    });

    const addSlot = content.querySelector('#card-add-slot');
    if (addSlot) {
      addSlot.addEventListener('click', () => this._openModal(null));
    }
  }

  _buildQuotationCard(q) {
    const priceFormatted = MoneyService.format(q.unitCostCents);
    const isExpired = q.isExpiredNow || false;

    const badges = [];
    if (q.isCheapest && !isExpired) badges.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">⭐ MELHOR PREÇO</span>`);
    if (q.isPreferred) badges.push(`<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">★ PREFERIDO</span>`);
    if (isExpired) badges.push(`<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">⚠ VENCIDA</span>`);

    const borderColor = q.isCheapest && !isExpired
      ? 'border-emerald-300'
      : q.isPreferred
        ? 'border-amber-300'
        : isExpired
          ? 'border-rose-200'
          : 'border-slate-200';

    const quoteDateStr = q.quoteDate ? new Date(q.quoteDate).toLocaleDateString('pt-BR') : '-';
    const validUntilStr = q.validUntil ? new Date(q.validUntil).toLocaleDateString('pt-BR') : 'Sem validade';

    return `
      <div class="bg-white rounded-xl border-2 ${borderColor} shadow-xs p-5 flex flex-col gap-3 relative">
        <!-- Badges -->
        ${badges.length > 0 ? `<div class="flex flex-wrap gap-1">${badges.join('')}</div>` : ''}

        <!-- Fornecedor -->
        <div>
          <span class="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Fornecedor</span>
          <span class="text-sm font-bold text-slate-900 block leading-snug">${this._esc(q.supplierName)}</span>
        </div>

        <!-- Preço -->
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-100">
          <span class="text-[10px] text-slate-500 uppercase font-semibold block">Preço Unitário</span>
          <span class="text-xl font-black ${q.isCheapest && !isExpired ? 'text-emerald-700' : 'text-slate-800'} block">${priceFormatted}</span>
        </div>

        <!-- Detalhes -->
        <div class="space-y-1.5 text-xs text-slate-600">
          <div class="flex justify-between">
            <span class="text-slate-400">Qtd. Mínima</span>
            <span class="font-semibold">${q.minimumOrderQty ? q.minimumOrderQty + ' un' : '-'}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Prazo de Entrega</span>
            <span class="font-semibold">${q.leadTimeDays != null ? q.leadTimeDays + ' dias' : '-'}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Condição</span>
            <span class="font-semibold truncate max-w-[110px] text-right">${this._esc(q.paymentTerms) || '-'}</span>
          </div>
          <div class="flex justify-between border-t border-slate-100 pt-1.5">
            <span class="text-slate-400">Cotação em</span>
            <span class="font-semibold">${quoteDateStr}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Válida até</span>
            <span class="font-semibold ${isExpired ? 'text-rose-600' : ''}">${validUntilStr}</span>
          </div>
        </div>

        <!-- Ações -->
        <div class="border-t border-slate-100 pt-3 flex flex-col gap-2">
          ${!q.isPreferred ? `
            <button id="btn-preferred-${q.id}" class="w-full text-xs font-semibold py-1.5 px-3 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition">
              ★ Definir como Preferido
            </button>
          ` : ''}
          <div class="flex gap-2">
            <button id="btn-edit-${q.id}" class="flex-1 text-xs font-medium py-1.5 px-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
              Atualizar
            </button>
            <button id="btn-deactivate-${q.id}" class="flex-1 text-xs font-medium py-1.5 px-3 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition">
              Desativar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderHistory() {
    const content = this.rootElement.querySelector('#quotation-content');
    if (!content) return;

    if (this.history.length === 0) {
      content.innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs p-10 text-center">
          <p class="text-sm text-slate-400">Nenhum histórico de cotações para este produto.</p>
        </div>
      `;
      return;
    }

    const rows = this.history.map(q => {
      const isActive = q.isActive !== false;
      const isExpired = q.isExpiredNow;
      const statusBadge = isExpired
        ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">VENCIDA</span>`
        : isActive
          ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">ATIVA</span>`
          : `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">INATIVA</span>`;
      const preferredBadge = q.isPreferred ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">PREF.</span>` : '';
      const qDate = q.quoteDate ? new Date(q.quoteDate).toLocaleDateString('pt-BR') : '-';
      const validDate = q.validUntil ? new Date(q.validUntil).toLocaleDateString('pt-BR') : '-';

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/50 text-xs ${!isActive ? 'opacity-60' : ''}">
          <td class="py-2.5 px-3 font-semibold text-slate-800">${this._esc(q.supplierName)}</td>
          <td class="py-2.5 px-3 font-bold text-slate-900">${MoneyService.format(q.unitCostCents)}</td>
          <td class="py-2.5 px-3 text-slate-600">${q.leadTimeDays != null ? q.leadTimeDays + ' dias' : '-'}</td>
          <td class="py-2.5 px-3 text-slate-600">${this._esc(q.paymentTerms) || '-'}</td>
          <td class="py-2.5 px-3 text-slate-600">${qDate}</td>
          <td class="py-2.5 px-3 text-slate-600">${validDate}</td>
          <td class="py-2.5 px-3">
            <div class="flex flex-wrap gap-1">${statusBadge}${preferredBadge}</div>
          </td>
        </tr>
      `;
    }).join('');

    content.innerHTML = `
      <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 class="text-sm font-bold text-slate-700">Histórico Completo de Cotações</h3>
          <span class="text-xs text-slate-400">${this.history.length} registro(s)</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                <th class="py-2.5 px-3 text-left">Fornecedor</th>
                <th class="py-2.5 px-3 text-left">Preço Unit.</th>
                <th class="py-2.5 px-3 text-left">Prazo</th>
                <th class="py-2.5 px-3 text-left">Condição</th>
                <th class="py-2.5 px-3 text-left">Data</th>
                <th class="py-2.5 px-3 text-left">Válida Até</th>
                <th class="py-2.5 px-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderError(msg) {
    const content = this.rootElement.querySelector('#quotation-content');
    if (content) {
      content.innerHTML = `<div class="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-200">${this._esc(msg)}</div>`;
    }
  }

  _openModal(quotation = null) {
    this.editingQuotationId = quotation ? quotation.id : null;
    this.modalData = quotation;

    const modal = this.rootElement.querySelector('#quotation-modal');
    const title = this.rootElement.querySelector('#modal-title');
    const supplierSelect = this.rootElement.querySelector('#modal-supplier');

    if (!modal) return;

    // Populate supplier dropdown
    if (supplierSelect) {
      supplierSelect.innerHTML = '<option value="">Selecione o fornecedor...</option>';
      this.suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        supplierSelect.appendChild(opt);
      });
    }

    if (quotation) {
      title.textContent = 'Atualizar Cotação';
      if (supplierSelect) supplierSelect.value = quotation.supplierId;
      supplierSelect.disabled = true; // Ao atualizar, fornecedor é fixo
      this._setModalField('#modal-price', MoneyService.toCurrencyString ? MoneyService.toCurrencyString(quotation.unitCostCents) : (quotation.unitCostCents / 100).toFixed(2).replace('.', ','));
      this._setModalField('#modal-min-qty', quotation.minimumOrderQty || '');
      this._setModalField('#modal-lead-time', quotation.leadTimeDays != null ? quotation.leadTimeDays : '');
      this._setModalField('#modal-payment-terms', quotation.paymentTerms || '');
      this._setModalField('#modal-quote-date', quotation.quoteDate ? quotation.quoteDate.slice(0, 10) : '');
      this._setModalField('#modal-valid-until', quotation.validUntil ? quotation.validUntil.slice(0, 10) : '');
      this._setModalField('#modal-notes', quotation.notes || '');
    } else {
      title.textContent = 'Nova Cotação';
      if (supplierSelect) supplierSelect.disabled = false;
      this._clearModalFields();
      // Data de hoje como padrão
      const today = new Date().toISOString().slice(0, 10);
      this._setModalField('#modal-quote-date', today);
    }

    const errorEl = this.rootElement.querySelector('#modal-error');
    if (errorEl) errorEl.classList.add('hidden');

    modal.classList.remove('hidden');
    setTimeout(() => supplierSelect && !quotation && supplierSelect.focus(), 100);
  }

  _closeModal() {
    const modal = this.rootElement.querySelector('#quotation-modal');
    if (modal) modal.classList.add('hidden');
    this.editingQuotationId = null;
    this.modalData = null;
    const supplierSelect = this.rootElement.querySelector('#modal-supplier');
    if (supplierSelect) supplierSelect.disabled = false;
  }

  async _submitModal() {
    const btn = this.rootElement.querySelector('#btn-submit-modal');
    const errorEl = this.rootElement.querySelector('#modal-error');

    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    if (errorEl) errorEl.classList.add('hidden');

    try {
      const supplierId = this.rootElement.querySelector('#modal-supplier')?.value;
      const priceRaw = (this.rootElement.querySelector('#modal-price')?.value || '').replace(',', '.').replace(/[^\d.]/g, '');
      const unitCostCents = Math.round(parseFloat(priceRaw || '0') * 100);
      const minQtyRaw = this.rootElement.querySelector('#modal-min-qty')?.value;
      const leadTimeRaw = this.rootElement.querySelector('#modal-lead-time')?.value;
      const paymentTerms = this.rootElement.querySelector('#modal-payment-terms')?.value?.trim();
      const quoteDateRaw = this.rootElement.querySelector('#modal-quote-date')?.value;
      const validUntilRaw = this.rootElement.querySelector('#modal-valid-until')?.value;
      const notes = this.rootElement.querySelector('#modal-notes')?.value?.trim();

      const data = {
        productId: this.selectedProductId,
        supplierId,
        unitCostCents,
        minimumOrderQty: minQtyRaw ? parseInt(minQtyRaw) : null,
        leadTimeDays: leadTimeRaw !== '' && leadTimeRaw != null ? parseInt(leadTimeRaw) : null,
        paymentTerms: paymentTerms || '',
        quoteDate: quoteDateRaw ? new Date(quoteDateRaw).toISOString() : new Date().toISOString(),
        validUntil: validUntilRaw ? new Date(validUntilRaw).toISOString() : null,
        notes: notes || ''
      };

      if (this.editingQuotationId) {
        await QuotationService.updateQuotation(this.editingQuotationId, data);
      } else {
        await QuotationService.addQuotation(data);
      }

      this._closeModal();
      await this._loadQuotations();
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = e.message;
        errorEl.classList.remove('hidden');
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar Cotação'; }
    }
  }

  _setModalField(selector, value) {
    const el = this.rootElement.querySelector(selector);
    if (el) el.value = value;
  }

  _clearModalFields() {
    ['#modal-price', '#modal-min-qty', '#modal-lead-time', '#modal-payment-terms',
     '#modal-quote-date', '#modal-valid-until', '#modal-notes'].forEach(sel => {
      this._setModalField(sel, '');
    });
  }

  _subscribeToEvents() {
    const onQuotation = () => {
      if (this.selectedProductId) this._loadQuotations();
    };
    const onProductOrSupplierChanged = () => {
      this._loadDropdowns();
    };
    const unsub1 = eventBus.on('QUOTATION_CREATED', onQuotation);
    const unsub2 = eventBus.on('QUOTATION_UPDATED', onQuotation);
    const unsub3 = eventBus.on('QUOTATION_DELETED', onQuotation);
    const unsub4 = eventBus.on('PREFERRED_SUPPLIER_CHANGED', onQuotation);
    const unsub5 = eventBus.on(EVENTS.PRODUCT_CREATED, onProductOrSupplierChanged);
    const unsub6 = eventBus.on(EVENTS.PRODUCT_UPDATED, onProductOrSupplierChanged);
    const unsub7 = eventBus.on(EVENTS.PRODUCT_DELETED, onProductOrSupplierChanged);
    const unsub8 = eventBus.on('SUPPLIER_CREATED', onProductOrSupplierChanged);
    const unsub9 = eventBus.on('SUPPLIER_UPDATED', onProductOrSupplierChanged);
    const unsub10 = eventBus.on('SUPPLIER_DELETED', onProductOrSupplierChanged);
    this.cleanupListeners.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub7, unsub8, unsub9, unsub10);
  }

  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }

  destroy() {
    this.cleanupListeners.forEach(fn => typeof fn === 'function' && fn());
    this.cleanupListeners = [];
    this.rootElement.innerHTML = '';
  }
}
