import { SupplierService } from '../services/SupplierService.js';
import { MoneyService } from '../domain/MoneyService.js';
import { eventBus } from '../eventBus.js';

export class SuppliersPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.suppliers = [];
    this.cleanupListeners = [];
    this.searchQuery = '';
    this.selectedStatus = 'all'; // all, active, inactive
    this.searchDebounceTimer = null;
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Header & Action Bar -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div>
            <h2 class="text-lg font-black text-slate-900 tracking-tight">Gestão de Fornecedores</h2>
            <p class="text-xs text-slate-500">Parceiros comerciais, dados de contato e histórico de aquisições</p>
          </div>
          <button id="btn-open-supplier-modal" class="bg-indigo-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg hover:bg-indigo-700 active:scale-95 transition shadow-xs flex items-center justify-center gap-2 whitespace-nowrap">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Novo Fornecedor
          </button>
        </div>

        <!-- Filter & Search Toolbar -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div class="flex-1 relative">
            <input type="text" id="supplier-search-input" value="${this._esc(this.searchQuery)}"
                   placeholder="Buscar por nome, CNPJ/CPF, email ou pessoa de contato..."
                   class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition">
            <svg class="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400 font-medium">Status:</span>
            <select id="filter-supplier-status" class="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 text-xs font-medium focus:bg-white focus:outline-none">
              <option value="all" ${this.selectedStatus === 'all' ? 'selected' : ''}>Todos</option>
              <option value="active" ${this.selectedStatus === 'active' ? 'selected' : ''}>Ativos</option>
              <option value="inactive" ${this.selectedStatus === 'inactive' ? 'selected' : ''}>Inativos</option>
            </select>
          </div>
        </div>

        <!-- Suppliers Table -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col">
          <div class="overflow-x-auto flex-1">
            <table class="w-full text-left text-sm text-slate-600">
              <thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th scope="col" class="py-3 px-4">Fornecedor / Razão Social</th>
                  <th scope="col" class="py-3 px-3">Documento (CNPJ/CPF)</th>
                  <th scope="col" class="py-3 px-3">Contatos</th>
                  <th scope="col" class="py-3 px-3 text-center">Pedidos</th>
                  <th scope="col" class="py-3 px-4 text-right">Total Comprado</th>
                  <th scope="col" class="py-3 px-3 text-center">Status</th>
                  <th scope="col" class="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody id="suppliers-table-body" class="divide-y divide-slate-100">
                ${this._renderSkeletonRows()}
              </tbody>
            </table>
          </div>

          <!-- Empty State -->
          <div id="suppliers-empty-state" class="hidden flex-col items-center justify-center p-12 text-center">
            <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
              <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 class="text-base font-bold text-slate-800 mb-1">Nenhum fornecedor cadastrado</h3>
            <p class="text-xs text-slate-500 max-w-sm mb-4">Cadastre seus fornecedores para registrar ordens de compra e controlar custos de estoque.</p>
            <button id="empty-state-new-sup-btn" class="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition">
              Cadastrar Primeiro Fornecedor
            </button>
          </div>
        </div>

        <!-- Modal Container -->
        <div id="suppliers-modal-container"></div>
      </div>
    `;

    this.bindEvents();
    await this.loadData();
    this.subscribeEvents();
  }

  async loadData() {
    try {
      this.suppliers = await SupplierService.listSuppliers({
        search: this.searchQuery,
        status: this.selectedStatus
      });

      this.renderTable();
    } catch (e) {
      console.error('Erro ao carregar fornecedores:', e);
      const tbody = this.rootElement.querySelector('#suppliers-table-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500">Erro: ${e.message}</td></tr>`;
      }
    }
  }

  renderTable() {
    const tbody = this.rootElement.querySelector('#suppliers-table-body');
    const emptyEl = this.rootElement.querySelector('#suppliers-empty-state');
    if (!tbody || !emptyEl) return;

    if (this.suppliers.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
      emptyEl.classList.add('flex');
      return;
    }

    emptyEl.classList.add('hidden');
    emptyEl.classList.remove('flex');

    tbody.innerHTML = this.suppliers.map(sup => {
      const isActive = sup.isActive !== false;
      const spentFormatted = MoneyService.format(sup.totalSpentCents || 0);

      return `
        <tr class="hover:bg-slate-50/80 transition-colors group">
          <!-- Nome -->
          <td class="py-3 px-4">
            <div class="font-bold text-slate-800 text-xs">${this._esc(sup.name)}</div>
            ${sup.contactPerson ? `<div class="text-[11px] text-slate-400">Contato: ${this._esc(sup.contactPerson)}</div>` : ''}
          </td>

          <!-- Documento -->
          <td class="py-3 px-3 whitespace-nowrap text-xs font-mono text-slate-600">
            ${this._esc(sup.document) || '<span class="text-slate-400 font-sans italic">Não informado</span>'}
          </td>

          <!-- Contatos -->
          <td class="py-3 px-3 text-xs">
            ${sup.email ? `<div class="text-slate-700 font-medium truncate max-w-xs">${this._esc(sup.email)}</div>` : ''}
            ${sup.phone ? `<div class="text-slate-400 text-[11px]">${this._esc(sup.phone)}</div>` : ''}
            ${!sup.email && !sup.phone ? '<span class="text-slate-400 italic">Sem contatos</span>' : ''}
          </td>

          <!-- Pedidos -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <span class="inline-flex items-center justify-center font-bold px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-800">
              ${sup.orderCount || 0}
            </span>
          </td>

          <!-- Total Comprado -->
          <td class="py-3 px-4 text-right whitespace-nowrap font-black text-slate-900 text-xs">
            ${spentFormatted}
          </td>

          <!-- Status -->
          <td class="py-3 px-3 text-center whitespace-nowrap">
            ${isActive 
              ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Ativo</span>' 
              : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Inativo</span>'}
          </td>

          <!-- Ações -->
          <td class="py-3 px-4 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1">
              <button data-action="history" data-id="${sup.id}" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="Ver Histórico de Compras">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
              </button>
              <button data-action="edit" data-id="${sup.id}" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Editar Fornecedor">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button data-action="delete" data-id="${sup.id}" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Excluir Fornecedor">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  bindEvents() {
    // Search input
    const searchInput = this.rootElement.querySelector('#supplier-search-input');
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchQuery = e.target.value;
        this.loadData();
      }, 300);
    });

    // Status filter
    const statusSelect = this.rootElement.querySelector('#filter-supplier-status');
    statusSelect?.addEventListener('change', (e) => {
      this.selectedStatus = e.target.value;
      this.loadData();
    });

    // New Supplier buttons
    const btnNew = this.rootElement.querySelector('#btn-open-supplier-modal');
    btnNew?.addEventListener('click', () => this.openSupplierModal());

    const btnEmptyNew = this.rootElement.querySelector('#empty-state-new-sup-btn');
    btnEmptyNew?.addEventListener('click', () => this.openSupplierModal());

    // Table Actions
    const tbody = this.rootElement.querySelector('#suppliers-table-body');
    tbody?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const sup = this.suppliers.find(s => s.id === id);

      if (action === 'edit' && sup) {
        this.openSupplierModal(sup);
      } else if (action === 'history' && sup) {
        this.openHistoryModal(id);
      } else if (action === 'delete' && sup) {
        this.handleDeleteSupplier(sup);
      }
    });
  }

  // ==========================================
  // MODAL CADASTRO / EDIÇÃO DE FORNECEDOR
  // ==========================================

  openSupplierModal(supplier = null) {
    const modalContainer = this.rootElement.querySelector('#suppliers-modal-container');
    if (!modalContainer) return;

    const isEdit = !!supplier;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 bg-indigo-600 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-800">${isEdit ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
                <p class="text-xs text-slate-500">Dados cadastrais do parceiro comercial</p>
              </div>
            </div>
            <button id="supplier-modal-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <form id="supplier-form" class="p-6 space-y-4 text-xs">
            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Razão Social / Nome Fantasia <span class="text-red-500">*</span></label>
              <input type="text" id="sup-name" required value="${this._esc(supplier?.name || '')}" placeholder="Ex: Distribuidora Central Ltda"
                     class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600">
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">CNPJ / CPF</label>
                <input type="text" id="sup-doc" value="${this._esc(supplier?.document || '')}" placeholder="00.000.000/0001-00"
                       class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600 font-mono">
              </div>
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Pessoa de Contato</label>
                <input type="text" id="sup-contact" value="${this._esc(supplier?.contactPerson || '')}" placeholder="Ex: Vendedor Carlos"
                       class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email</label>
                <input type="email" id="sup-email" value="${this._esc(supplier?.email || '')}" placeholder="contato@fornecedor.com"
                       class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600">
              </div>
              <div>
                <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Telefone / WhatsApp</label>
                <input type="text" id="sup-phone" value="${this._esc(supplier?.phone || '')}" placeholder="(11) 99999-9999"
                       class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600">
              </div>
            </div>

            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Endereço / Cidade</label>
              <input type="text" id="sup-address" value="${this._esc(supplier?.address || '')}" placeholder="Rua, número, bairro e cidade..."
                     class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600">
            </div>

            <div>
              <label class="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">Observações Internas</label>
              <textarea id="sup-notes" rows="2" placeholder="Prazos de entrega, condições de pagamento padrão..."
                        class="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-600">${this._esc(supplier?.notes || '')}</textarea>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <input type="checkbox" id="sup-active" ${supplier?.isActive !== false ? 'checked' : ''} class="w-4 h-4 text-indigo-600 rounded">
              <label for="sup-active" class="text-xs text-slate-700 font-semibold cursor-pointer">Fornecedor Ativo</label>
            </div>

            <div id="sup-error-msg" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"></div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button type="button" id="supplier-modal-cancel-btn" class="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition">
                Cancelar
              </button>
              <button type="submit" class="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 active:scale-95 transition shadow-xs">
                ${isEdit ? 'Salvar Alterações' : 'Cadastrar Fornecedor'}
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    const closeModal = () => { modalContainer.innerHTML = ''; };
    modalContainer.querySelector('#supplier-modal-close-btn')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#supplier-modal-cancel-btn')?.addEventListener('click', closeModal);

    const form = modalContainer.querySelector('#supplier-form');
    const errorMsg = modalContainer.querySelector('#sup-error-msg');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorMsg.classList.add('hidden');

      const data = {
        name: modalContainer.querySelector('#sup-name').value.trim(),
        document: modalContainer.querySelector('#sup-doc').value.trim(),
        contactPerson: modalContainer.querySelector('#sup-contact').value.trim(),
        email: modalContainer.querySelector('#sup-email').value.trim(),
        phone: modalContainer.querySelector('#sup-phone').value.trim(),
        address: modalContainer.querySelector('#sup-address').value.trim(),
        notes: modalContainer.querySelector('#sup-notes').value.trim(),
        isActive: modalContainer.querySelector('#sup-active').checked
      };

      try {
        if (isEdit) {
          await SupplierService.updateSupplier(supplier.id, data);
        } else {
          await SupplierService.createSupplier(data);
        }
        closeModal();
        await this.loadData();
      } catch (err) {
        errorMsg.textContent = err.message || 'Erro ao salvar fornecedor.';
        errorMsg.classList.remove('hidden');
      }
    });
  }

  // ==========================================
  // MODAL HISTÓRICO DE COMPRAS DO FORNECEDOR
  // ==========================================

  async openHistoryModal(supplierId) {
    const modalContainer = this.rootElement.querySelector('#suppliers-modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
          <div class="p-8 text-center text-slate-500">Carregando histórico do fornecedor...</div>
        </div>
      </div>
    `;

    try {
      const data = await SupplierService.getSupplierWithPurchases(supplierId);
      if (!data) return;

      const sup = data.supplier;
      const purchases = data.purchases;
      const stats = data.stats;

      modalContainer.innerHTML = `
        <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden transform transition-all">
            
            <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 class="text-base font-bold text-slate-800">${this._esc(sup.name)}</h3>
                <p class="text-xs text-slate-500 font-mono">${this._esc(sup.document) || 'Sem documento'}</p>
              </div>
              <button id="history-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>

            <!-- Stats Bar -->
            <div class="grid grid-cols-3 gap-3 p-4 bg-indigo-50/50 border-b border-indigo-100 text-xs">
              <div class="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                <span class="text-slate-400 block text-[10px] uppercase font-bold">Total de Pedidos</span>
                <span class="text-base font-black text-slate-800">${stats.totalOrders}</span>
              </div>
              <div class="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                <span class="text-slate-400 block text-[10px] uppercase font-bold">Itens Adquiridos</span>
                <span class="text-base font-black text-slate-800">${stats.totalItemsPurchased} un</span>
              </div>
              <div class="bg-white p-3 rounded-lg border border-indigo-100 text-center">
                <span class="text-slate-400 block text-[10px] uppercase font-bold">Total Investido</span>
                <span class="text-base font-black text-indigo-700">${MoneyService.format(stats.totalSpentCents)}</span>
              </div>
            </div>

            <!-- History List -->
            <div class="p-6 max-h-96 overflow-y-auto divide-y divide-slate-100 text-xs">
              ${purchases.length > 0 ? purchases.map(p => {
                const dateStr = new Date(p.date || p.createdAt).toLocaleString('pt-BR');
                const isCancelled = !!p.cancelledAt;
                return `
                  <div class="py-3 flex items-center justify-between ${isCancelled ? 'opacity-50' : ''}">
                    <div>
                      <div class="font-bold text-slate-800">${this._esc(p.productName)}</div>
                      <div class="text-[11px] text-slate-400 font-mono">Data: ${dateStr} ${p.invoiceNumber ? ' | NF: ' + this._esc(p.invoiceNumber) : ''}</div>
                      ${isCancelled ? '<span class="text-[10px] text-rose-600 font-bold">Estornada / Cancelada</span>' : ''}
                    </div>
                    <div class="text-right">
                      <div class="font-black text-slate-900">${MoneyService.format(p.totalCostCents)}</div>
                      <div class="text-[11px] text-slate-500 font-medium">${p.quantity} un x ${MoneyService.format(p.unitCostCents)}</div>
                    </div>
                  </div>
                `;
              }).join('') : `
                <div class="p-8 text-center text-slate-400">Nenhuma compra registrada para este fornecedor.</div>
              `}
            </div>

            <div class="px-6 py-3 bg-slate-50 border-t border-slate-100 text-right">
              <button id="history-done-btn" class="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition">
                Fechar
              </button>
            </div>

          </div>
        </div>
      `;

      const closeModal = () => { modalContainer.innerHTML = ''; };
      modalContainer.querySelector('#history-close-btn')?.addEventListener('click', closeModal);
      modalContainer.querySelector('#history-done-btn')?.addEventListener('click', closeModal);
    } catch (e) {
      modalContainer.innerHTML = `<div class="fixed inset-0 z-50 flex items-center justify-center p-4"><div class="bg-white p-6 rounded-xl text-red-500">Erro: ${e.message}</div></div>`;
    }
  }

  async handleDeleteSupplier(sup) {
    if (confirm(`Deseja realmente excluir o fornecedor "${sup.name}"?`)) {
      try {
        await SupplierService.deleteSupplier(sup.id);
        await this.loadData();
      } catch (e) {
        alert('Erro ao excluir fornecedor: ' + e.message);
      }
    }
  }

  subscribeEvents() {
    const unsubCreate = eventBus.on('SUPPLIER_CREATED', () => this.loadData());
    const unsubUpdate = eventBus.on('SUPPLIER_UPDATED', () => this.loadData());
    const unsubDelete = eventBus.on('SUPPLIER_DELETED', () => this.loadData());
    const unsubPurchase = eventBus.on('PURCHASE_CREATED', () => this.loadData());

    this.cleanupListeners.push(unsubCreate, unsubUpdate, unsubDelete, unsubPurchase);
  }

  destroy() {
    clearTimeout(this.searchDebounceTimer);
    this.cleanupListeners.forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    this.cleanupListeners = [];
  }

  _renderSkeletonRows() {
    return Array(4).fill(0).map(() => `
      <tr class="animate-pulse">
        <td class="py-3 px-4"><div class="h-3 bg-slate-200 rounded w-28 mb-1"></div><div class="h-2 bg-slate-100 rounded w-16"></div></td>
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-24"></div></td>
        <td class="py-3 px-3"><div class="h-3 bg-slate-200 rounded w-20"></div></td>
        <td class="py-3 px-3 text-center"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
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
