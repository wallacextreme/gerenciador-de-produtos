import { BackupService } from '../services/BackupService.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { saleRepository } from '../repositories/SaleRepository.js';
import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { pwaHandler } from '../utils/pwa.js';
import { platform } from '../platform/index.js';
import { syncEngine } from '../services/SyncEngine.js';
import { syncRepository } from '../repositories/SyncRepository.js';
import { FirebaseProvider } from '../sync/FirebaseProvider.js';
import { formatSyncEntity, formatSyncAction } from '../utils/translations.js';

export class SettingsPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.activeTab = 'company'; // 'company' | 'operation' | 'backup' | 'maintenance' | 'cloud'
    this.companyProfile = {
      tradeName: '',
      corporateName: '',
      cnpj: '',
      phone: '',
      email: '',
      address: ''
    };
    this.allowNegativeStock = false;
    this.lowStockThreshold = 5;
    this.firebaseConfig = {
      apiKey: '',
      projectId: '',
      authDomain: '',
      appId: ''
    };
    this.autoSyncEnabled = true;
    this.cloudStats = null;
    this.syncQueueItems = [];
    this.dbStats = {
      products: 0,
      productImages: 0,
      suppliers: 0,
      sales: 0,
      purchases: 0
    };
    this.cleanupListeners = [];
    this.pendingRestoreBackup = null;
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6 pb-12 max-w-5xl mx-auto">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-xl font-black text-slate-900 tracking-tight">Configurações & Backup</h2>
            </div>
            <p class="text-xs text-slate-500 mt-0.5">Gerenciamento de dados cadastrais, preferências operacionais, integridade SHA-256 e sincronização em nuvem</p>
          </div>
        </div>

        <!-- Settings Tabs -->
        <div class="bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
          <div class="flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2 mb-4" id="settings-tabs-container">
            <button data-tab="company" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'company' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Dados da Empresa
            </button>
            <button data-tab="operation" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'operation' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Preferências Operacionais
            </button>
            <button data-tab="backup" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'backup' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Backup & Restauração
            </button>
            <button data-tab="cloud" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'cloud' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              ☁️ Nuvem & Firebase
            </button>
            <button data-tab="maintenance" class="tab-btn px-4 py-2 rounded-xl text-xs font-bold transition ${this.activeTab === 'maintenance' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'}">
              Manutenção & Limpeza
            </button>
          </div>

          <!-- Active Tab Content Area -->
          <div id="tab-content-area" class="p-2">
            ${this._renderLoadingSkeleton()}
          </div>
        </div>
      </div>

      <!-- Modal de Inspeção e Restauração de Backup -->
      <div id="modal-restore" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200">
          <div class="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              </span>
              <div>
                <h3 class="text-sm font-bold text-slate-900">Restaurar Banco de Dados</h3>
                <p class="text-[11px] text-slate-500">Validação prévia de integridade e metadados</p>
              </div>
            </div>
            <button id="btn-close-restore-modal" class="text-slate-400 hover:text-slate-600 transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6 space-y-4" id="modal-restore-body">
            <!-- Dynamic Inspection Content -->
          </div>

          <div class="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2" id="modal-restore-actions">
            <button id="btn-cancel-restore" class="px-4 py-2 text-xs font-semibold border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition">Cancelar</button>
            <button id="btn-confirm-restore" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-xs flex items-center gap-2">
              Confirmar Restauração
            </button>
          </div>
        </div>
      </div>
    `;

    await this.loadData();
    this._bindTabEvents();
    this._bindModalEvents();
  }

  async loadData() {
    try {
      // 1. Carregar configurações
      const savedCompany = await settingsRepository.get('companyProfile');
      if (savedCompany) {
        this.companyProfile = { ...this.companyProfile, ...savedCompany };
      }

      const allowNeg = await settingsRepository.get('allowNegativeStock');
      this.allowNegativeStock = allowNeg !== null ? !!allowNeg : false;

      const threshold = await settingsRepository.get('lowStockThreshold');
      if (threshold != null) this.lowStockThreshold = threshold;

      // 2. Carregar estatísticas do banco
      const [prods, imgs, supps, sales, purchases] = await Promise.all([
        productRepository.findAll(),
        productImageRepository.findAll(),
        supplierRepository.findAll(),
        saleRepository.findAll(),
        purchaseRepository.findAll()
      ]);

      this.dbStats = {
        products: prods.filter(p => !p.deletedAt).length,
        productImages: imgs.filter(i => !i.deletedAt).length,
        suppliers: supps.filter(s => !s.deletedAt).length,
        sales: sales.filter(s => !s.cancelledAt).length,
        purchases: purchases.filter(p => !p.cancelledAt).length
      };

      // 3. Carregar configurações de nuvem e fila de sincronização
      const fbConfig = await settingsRepository.get('firebaseConfig');
      if (fbConfig) {
        this.firebaseConfig = { ...this.firebaseConfig, ...fbConfig };
      }
      const autoSync = await settingsRepository.get('autoSyncEnabled');
      this.autoSyncEnabled = autoSync !== null && autoSync !== undefined ? !!autoSync : true;

      this.cloudStats = await syncEngine.getStats();
      this.syncQueueItems = await syncRepository.findAll();

      this._renderActiveTab();
    } catch (err) {
      console.error('[SettingsPage] Erro ao carregar configurações:', err);
    }
  }

  _renderActiveTab() {
    const container = this.rootElement.querySelector('#tab-content-area');
    if (!container) return;

    switch (this.activeTab) {
      case 'operation':
        container.innerHTML = this._renderOperationTab();
        this._bindOperationEvents();
        break;
      case 'backup':
        container.innerHTML = this._renderBackupTab();
        this._bindBackupEvents();
        break;
      case 'cloud':
        container.innerHTML = this._renderCloudTab();
        this._bindCloudEvents();
        break;
      case 'maintenance':
        container.innerHTML = this._renderMaintenanceTab();
        this._bindMaintenanceEvents();
        break;
      case 'company':
      default:
        container.innerHTML = this._renderCompanyTab();
        this._bindCompanyEvents();
        break;
    }
  }

  /**
   * TAB 1: Dados da Empresa / Loja
   */
  _renderCompanyTab() {
    const cp = this.companyProfile;
    return `
      <form id="form-company-profile" class="space-y-6 max-w-2xl">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">Identificação do Estabelecimento</h3>
          <p class="text-xs text-slate-500">Estas informações são utilizadas nos cabeçalhos de comprovantes de venda e ordens de compra.</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Nome Fantasia / Nome da Loja</label>
            <input type="text" id="input-trade-name" value="${this._esc(cp.tradeName)}" placeholder="Ex: GestãoPro Eletrônicos" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Razão Social</label>
            <input type="text" id="input-corp-name" value="${this._esc(cp.corporateName)}" placeholder="Ex: GestãoPro Comércio LTDA" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">CNPJ ou CPF</label>
            <input type="text" id="input-cnpj" value="${this._esc(cp.cnpj)}" placeholder="00.000.000/0000-00" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Telefone / WhatsApp</label>
            <input type="text" id="input-phone" value="${this._esc(cp.phone)}" placeholder="(00) 00000-0000" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Email de Contato</label>
            <input type="email" id="input-email" value="${this._esc(cp.email)}" placeholder="contato@empresa.com" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div class="sm:col-span-2">
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Endereço Completo</label>
            <input type="text" id="input-address" value="${this._esc(cp.address)}" placeholder="Rua, Número, Bairro, Cidade - UF, CEP" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
          <div id="company-feedback" class="text-xs font-bold text-emerald-600 hidden">✓ Dados salvos com sucesso!</div>
          <button type="submit" class="ml-auto bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition shadow-xs">
            Salvar Dados da Empresa
          </button>
        </div>
      </form>
    `;
  }

  /**
   * TAB 2: Preferências Operacionais
   */
  _renderOperationTab() {
    return `
      <form id="form-operation-settings" class="space-y-6 max-w-2xl">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">Regras de Operação e Estoque</h3>
          <p class="text-xs text-slate-500">Parâmetros de validação transacional e limites de alerta</p>
        </div>

        <!-- Negative Stock Option -->
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" id="check-allow-negative" ${this.allowNegativeStock ? 'checked' : ''} class="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
            <div>
              <span class="text-xs font-bold text-slate-900 block">Permitir Vendas com Saldo de Estoque Negativo</span>
              <span class="text-[11px] text-slate-500 block leading-relaxed">
                Por padrão (desativado), o sistema bloqueia vendas ou saídas manuais que deixariam o saldo físico menor que zero. Ao ativar, saídas são registradas mesmo sem estoque suficiente.
              </span>
            </div>
          </label>
        </div>

        <!-- Currency and Threshold -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Moeda Principal</label>
            <input type="text" value="Real Brasileiro (BRL R$)" disabled class="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-100 text-slate-500 cursor-not-allowed font-medium" />
          </div>

          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Alerta Padrão de Estoque Baixo</label>
            <input type="number" id="input-low-stock-threshold" min="0" value="${this.lowStockThreshold}" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <span class="text-[10px] text-slate-400">Quantidade mínima sugerida para novos produtos</span>
          </div>
        </div>

        <!-- Multi-Platform & Offline Status Card -->
        <div class="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-2">
          <h4 class="text-xs font-bold text-blue-900 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-600"></span>
            Plataforma, Execução & Armazenamento Local
          </h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
            <div class="bg-white p-2.5 rounded-lg border border-blue-100">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase">Modo de Execução</span>
              <span class="font-bold text-slate-900">
                ${platform.isDesktop() ? '🖥️ Desktop (Windows Tauri)' : (platform.isPWA() ? '📱 App Instalado (PWA)' : '🌐 Navegador Web')}
              </span>
            </div>
            <div class="bg-white p-2.5 rounded-lg border border-blue-100">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase">Banco de Dados Local</span>
              <span class="font-bold text-emerald-700 flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                IndexedDB Persistente
              </span>
            </div>
            <div class="bg-white p-2.5 rounded-lg border border-blue-100">
              <span class="text-[10px] text-slate-500 font-semibold block uppercase">Conectividade</span>
              <span class="font-bold ${pwaHandler.isOnline ? 'text-emerald-700' : 'text-amber-700'}">
                ${pwaHandler.isOnline ? '🟢 Online' : '🟠 Offline (100% Funcional)'}
              </span>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
          <div id="operation-feedback" class="text-xs font-bold text-emerald-600 hidden">✓ Preferências salvas com sucesso!</div>
          <button type="submit" class="ml-auto bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition shadow-xs">
            Salvar Preferências
          </button>
        </div>
      </form>
    `;
  }

  /**
   * TAB 3: Backup & Restauração
   */
  _renderBackupTab() {
    return `
      <div class="space-y-6 max-w-3xl">
        <!-- Backup Overview Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-center">
          <div>
            <span class="text-lg font-black text-slate-900 block">${this.dbStats.products}</span>
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Produtos</span>
          </div>
          <div>
            <span class="text-lg font-black text-slate-900 block">${this.dbStats.productImages}</span>
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Fotos</span>
          </div>
          <div>
            <span class="text-lg font-black text-slate-900 block">${this.dbStats.suppliers}</span>
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Fornecedores</span>
          </div>
          <div>
            <span class="text-lg font-black text-slate-900 block">${this.dbStats.sales}</span>
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Vendas</span>
          </div>
          <div class="col-span-2 sm:col-span-1">
            <span class="text-lg font-black text-slate-900 block">${this.dbStats.purchases}</span>
            <span class="text-[10px] text-slate-500 font-semibold uppercase">Compras</span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          <!-- Export Section -->
          <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
            <div>
              <div class="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              </div>
              <h3 class="text-sm font-bold text-slate-900">Exportar Backup Completo</h3>
              <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                Gera um arquivo <code class="bg-slate-100 px-1 py-0.5 rounded text-[11px] font-bold">.json</code> contendo todo o catálogo, fotos em alta resolução, histórico financeiro, compras e configurações protegidas por <strong>checksum de integridade SHA-256</strong>.
              </p>
            </div>

            <div class="space-y-2">
              <div id="backup-progress-bar-container" class="hidden space-y-1">
                <div class="flex justify-between text-[10px] text-slate-500 font-bold">
                  <span id="backup-progress-label">Exportando...</span>
                  <span id="backup-progress-percent">0%</span>
                </div>
                <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div id="backup-progress-bar" class="h-full bg-blue-600 rounded-full transition-all duration-300" style="width: 0%"></div>
                </div>
              </div>

              <button id="btn-export-backup" class="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 rounded-lg transition shadow-xs flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                Baixar Arquivo de Backup
              </button>
            </div>
          </div>

          <!-- Restore Section -->
          <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
            <div>
              <div class="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              </div>
              <h3 class="text-sm font-bold text-slate-900">Restaurar Banco de Dados</h3>
              <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                Restaura um backup gerado pelo GestãoPro. Antes de qualquer alteração, o sistema cria um <strong>snapshot de segurança</strong> com rollback automático em caso de inconsistência.
              </p>
            </div>

            <div>
              <input type="file" id="input-restore-file" accept=".json" class="hidden" />
              <button id="btn-trigger-restore-file" class="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 rounded-lg transition shadow-xs flex items-center justify-center gap-2">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                Selecionar Arquivo .json para Restaurar
              </button>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  /**
   * TAB 4: Manutenção & Limpeza Segura
   */
  _renderMaintenanceTab() {
    return `
      <div class="space-y-6 max-w-2xl">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">Operações de Manutenção & Limpeza</h3>
          <p class="text-xs text-slate-500">Ferramentas controladas para limpar dados de teste ou redefinir o sistema.</p>
        </div>

        <!-- Clean Commercial Test Data -->
        <div class="bg-amber-50/60 p-5 rounded-2xl border border-amber-200 space-y-3">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            <h4 class="text-xs font-bold text-amber-900 uppercase tracking-wider">Limpar Dados Comerciais de Teste</h4>
          </div>
          <p class="text-xs text-amber-800 leading-relaxed">
            Remove com segurança todas as <strong>vendas, ordens de compra e movimentações de estoque</strong>, e recalibra automaticamente os saldos do catálogo para zero.
            <strong>Seus produtos, fotos, fornecedores e configurações permanecem intactos.</strong>
          </p>
          <button id="btn-clean-test-data" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-xs">
            Limpar Apenas Vendas e Movimentações
          </button>
        </div>

        <!-- Factory Reset -->
        <div class="bg-rose-50/60 p-5 rounded-2xl border border-rose-200 space-y-3">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <h4 class="text-xs font-bold text-rose-900 uppercase tracking-wider">Reset de Fábrica (Zerar Todo o Sistema)</h4>
          </div>
          <p class="text-xs text-rose-800 leading-relaxed">
            Esta operação apaga <strong>todos os produtos, fotos, fornecedores, cotações, vendas, compras e configurações</strong>, restaurando o banco para o estado original virgem.
          </p>
          <button id="btn-factory-reset" class="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-xs">
            Reset de Fábrica Completo
          </button>
        </div>
      </div>
    `;
  }

  _bindTabEvents() {
    const container = this.rootElement.querySelector('#settings-tabs-container');
    if (container) {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;

        const tab = btn.dataset.tab;
        this.activeTab = tab;

        container.querySelectorAll('.tab-btn').forEach(b => {
          b.className = 'tab-btn px-4 py-2 rounded-xl text-xs font-bold transition text-slate-600 hover:bg-slate-100';
        });
        btn.className = 'tab-btn px-4 py-2 rounded-xl text-xs font-bold transition bg-slate-900 text-white shadow-xs';

        this._renderActiveTab();
      });
    }
  }

  _bindCompanyEvents() {
    const form = this.rootElement.querySelector('#form-company-profile');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updatedProfile = {
        tradeName: this.rootElement.querySelector('#input-trade-name').value.trim(),
        corporateName: this.rootElement.querySelector('#input-corp-name').value.trim(),
        cnpj: this.rootElement.querySelector('#input-cnpj').value.trim(),
        phone: this.rootElement.querySelector('#input-phone').value.trim(),
        email: this.rootElement.querySelector('#input-email').value.trim(),
        address: this.rootElement.querySelector('#input-address').value.trim()
      };

      await settingsRepository.set('companyProfile', updatedProfile);
      this.companyProfile = updatedProfile;

      const feedback = this.rootElement.querySelector('#company-feedback');
      if (feedback) {
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 3000);
      }
    });
  }

  _bindOperationEvents() {
    const form = this.rootElement.querySelector('#form-operation-settings');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const allowNeg = this.rootElement.querySelector('#check-allow-negative').checked;
      const threshold = parseInt(this.rootElement.querySelector('#input-low-stock-threshold').value, 10) || 5;

      await settingsRepository.set('allowNegativeStock', allowNeg);
      await settingsRepository.set('lowStockThreshold', threshold);
      this.allowNegativeStock = allowNeg;
      this.lowStockThreshold = threshold;

      const feedback = this.rootElement.querySelector('#operation-feedback');
      if (feedback) {
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 3000);
      }
    });
  }

  _bindBackupEvents() {
    const exportBtn = this.rootElement.querySelector('#btn-export-backup');
    const triggerRestoreBtn = this.rootElement.querySelector('#btn-trigger-restore-file');
    const fileInput = this.rootElement.querySelector('#input-restore-file');

    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        const progressContainer = this.rootElement.querySelector('#backup-progress-bar-container');
        const progressBar = this.rootElement.querySelector('#backup-progress-bar');
        const progressLabel = this.rootElement.querySelector('#backup-progress-label');
        const progressPercent = this.rootElement.querySelector('#backup-progress-percent');

        if (progressContainer) progressContainer.classList.remove('hidden');

        try {
          const backup = await BackupService.createBackup((pct, msg) => {
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressPercent) progressPercent.textContent = `${pct}%`;
            if (progressLabel) progressLabel.textContent = msg;
          });

          BackupService.downloadBackupFile(backup.backupObject);
          setTimeout(() => {
            if (progressContainer) progressContainer.classList.add('hidden');
            exportBtn.disabled = false;
          }, 1500);
        } catch (err) {
          alert('Erro ao exportar backup: ' + err.message);
          exportBtn.disabled = false;
        }
      });
    }

    if (triggerRestoreBtn && fileInput) {
      triggerRestoreBtn.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const backupObject = JSON.parse(text);
          this.pendingRestoreBackup = backupObject;

          await this._openRestoreModal(backupObject);
        } catch (err) {
          alert('O arquivo selecionado não é um JSON de backup válido: ' + err.message);
        } finally {
          fileInput.value = '';
        }
      });
    }
  }

  _bindMaintenanceEvents() {
    const cleanTestBtn = this.rootElement.querySelector('#btn-clean-test-data');
    const factoryResetBtn = this.rootElement.querySelector('#btn-factory-reset');

    if (cleanTestBtn) {
      cleanTestBtn.addEventListener('click', async () => {
        const confirmed = confirm(
          'Deseja limpar todos os dados transacionais de teste?\n\n' +
          '• Vendas, compras e movimentações de estoque serão removidas.\n' +
          '• Produtos, fotos, fornecedores e configurações serão mantidos.\n' +
          '• O saldo em estoque de todos os produtos retornará para 0.'
        );

        if (confirmed) {
          try {
            await BackupService.cleanTransactionalData();
            alert('✓ Dados comerciais de teste limpos com sucesso!');
            await this.loadData();
          } catch (err) {
            alert('Erro ao limpar dados: ' + err.message);
          }
        }
      });
    }

    if (factoryResetBtn) {
      factoryResetBtn.addEventListener('click', async () => {
        const promptText = prompt(
          'ATENÇÃO: O Reset de Fábrica apagará DEFINITIVAMENTE todos os produtos, fotos, clientes, fornecedores, vendas e compras.\n\n' +
          'Para confirmar, digite exatamente "CONFIRMAR" abaixo:'
        );

        if (promptText === 'CONFIRMAR') {
          try {
            await BackupService.factoryReset();
            alert('✓ Reset de fábrica concluído. O sistema foi restaurado para o estado inicial.');
            await this.loadData();
          } catch (err) {
            alert('Erro ao executar reset: ' + err.message);
          }
        } else if (promptText !== null) {
          alert('Operação cancelada: confirmação não corresponde a "CONFIRMAR".');
        }
      });
    }
  }

  async _openRestoreModal(backupObject) {
    const modal = this.rootElement.querySelector('#modal-restore');
    const body = this.rootElement.querySelector('#modal-restore-body');
    if (!modal || !body) return;

    body.innerHTML = `
      <div class="flex items-center justify-center py-6 text-slate-500 text-xs font-semibold">
        <svg class="animate-spin h-5 w-5 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
        Validando integridade SHA-256 e compatibilidade do backup...
      </div>
    `;

    modal.classList.remove('hidden');

    const validation = await BackupService.validateBackup(backupObject);

    if (!validation.isValid) {
      body.innerHTML = `
        <div class="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-xl text-xs space-y-2">
          <div class="font-bold flex items-center gap-1.5 text-rose-900">
            <svg class="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Não é possível restaurar este arquivo
          </div>
          <p>${validation.error}</p>
        </div>
      `;
      const confirmBtn = this.rootElement.querySelector('#btn-confirm-restore');
      if (confirmBtn) confirmBtn.classList.add('hidden');
      return;
    }

    const counts = validation.metadata.counts || {};
    const exportedDate = backupObject.exportedAt ? new Date(backupObject.exportedAt).toLocaleString('pt-BR') : 'Data não informada';

    body.innerHTML = `
      <div class="space-y-4 text-xs">
        <div class="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-xl flex items-center gap-2 font-bold">
          <svg class="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          Arquivo íntegro e validado com sucesso (SHA-256 verificado)!
        </div>

        <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
          <div class="flex justify-between text-slate-500">
            <span>Data de Exportação:</span>
            <span class="font-bold text-slate-800">${exportedDate}</span>
          </div>
          <div class="flex justify-between text-slate-500">
            <span>Versão da Aplicação:</span>
            <span class="font-bold text-slate-800">${backupObject.appVersion || 'v1.0.0'}</span>
          </div>
        </div>

        <div>
          <span class="font-bold text-slate-700 block mb-2 uppercase text-[10px] tracking-wider">Entidades a Restaurar:</span>
          <div class="grid grid-cols-2 gap-2 text-[11px]">
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Produtos:</span>
              <span class="font-bold text-slate-800">${counts.products || 0}</span>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Fotos:</span>
              <span class="font-bold text-slate-800">${counts.productImages || 0}</span>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Fornecedores:</span>
              <span class="font-bold text-slate-800">${counts.suppliers || 0}</span>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Vendas:</span>
              <span class="font-bold text-slate-800">${counts.sales || 0}</span>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Compras:</span>
              <span class="font-bold text-slate-800">${counts.purchases || 0}</span>
            </div>
            <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
              <span class="text-slate-500">Movimentações:</span>
              <span class="font-bold text-slate-800">${counts.stockMovements || 0}</span>
            </div>
          </div>
        </div>

        <div class="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-800">
          <strong>Segurança Garantida:</strong> Um snapshot de segurança do estado atual do seu banco será criado antes da gravação. Se houver qualquer erro, as alterações serão revertidas automaticamente.
        </div>
      </div>
    `;

    const confirmBtn = this.rootElement.querySelector('#btn-confirm-restore');
    if (confirmBtn) confirmBtn.classList.remove('hidden');
  }

  /**
   * TAB 4: Sincronização em Nuvem & Firebase (FASE 13)
   */
  _renderCloudTab() {
    const fb = this.firebaseConfig || {};
    const stats = this.cloudStats || { pending: 0, synced: 0, failed: 0, isConfigured: false, lastSyncTimestamp: null };
    const queue = (this.syncQueueItems || []).slice(0, 10);
    const lastSyncFormatted = stats.lastSyncTimestamp ? new Date(stats.lastSyncTimestamp).toLocaleString('pt-BR') : 'Nunca sincronizado';

    return `
      <div class="space-y-6 max-w-3xl">
        <!-- Banner de Status & Arquitetura Offline-First -->
        <div class="bg-gradient-to-r from-blue-900 to-indigo-900 text-white p-5 rounded-2xl shadow-sm space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="p-2 bg-white/10 rounded-xl">
                <svg class="w-5 h-5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z"/>
                </svg>
              </span>
              <div>
                <h3 class="text-sm font-bold">Motor de Sincronização em Nuvem (Outbox Pattern)</h3>
                <p class="text-[11px] text-blue-200">Sua loja opera 100% offline no IndexedDB e sincroniza automaticamente com o Firebase Firestore.</p>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-semibold ${stats.isConfigured ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}">
              ${stats.isConfigured ? '● Nuvem Conectada' : '○ Aguardando Credenciais'}
            </span>
          </div>

          <!-- Métricas da Fila -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div class="bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
              <span class="text-[10px] text-blue-200 uppercase font-semibold block">Fila Pendente</span>
              <span class="text-lg font-black text-amber-300">${stats.pending}</span>
            </div>
            <div class="bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
              <span class="text-[10px] text-blue-200 uppercase font-semibold block">Sincronizados</span>
              <span class="text-lg font-black text-emerald-300">${stats.synced}</span>
            </div>
            <div class="bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
              <span class="text-[10px] text-blue-200 uppercase font-semibold block">Falhas / Erros</span>
              <span class="text-lg font-black ${stats.failed > 0 ? 'text-red-400' : 'text-slate-300'}">${stats.failed}</span>
            </div>
            <div class="bg-white/10 backdrop-blur-xs p-3 rounded-xl border border-white/10">
              <span class="text-[10px] text-blue-200 uppercase font-semibold block">Último Sync</span>
              <span class="text-[11px] font-bold text-white truncate block mt-1">${lastSyncFormatted}</span>
            </div>
          </div>
        </div>

        <!-- Ações Manuais da Fila -->
        <div class="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
          <button id="btn-sync-now" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Sincronizar Agora
          </button>
          
          ${stats.failed > 0 ? `
            <button id="btn-retry-failed" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Reprocessar Falhas (${stats.failed})
            </button>
          ` : ''}

          ${stats.synced > 0 ? `
            <button id="btn-clear-synced" class="border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold px-3 py-2 rounded-lg transition">
              Limpar Concluídos
            </button>
          ` : ''}

          <div id="sync-operation-feedback" class="text-xs font-bold text-emerald-600 ml-auto hidden"></div>
        </div>

        <!-- Formulário de Credenciais Firebase -->
        <form id="form-firebase-config" class="space-y-4 bg-white p-5 rounded-xl border border-slate-200">
          <div class="border-b border-slate-100 pb-2">
            <h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Credenciais do Projeto Firebase</h4>
            <p class="text-[11px] text-slate-500">Insira a API Key e o Project ID do seu Console Firebase para sincronização remota.</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Project ID *</label>
              <input type="text" id="input-fb-project-id" value="${this._esc(fb.projectId)}" placeholder="ex: gestaopro-prod-123" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Web API Key *</label>
              <input type="password" id="input-fb-api-key" value="${this._esc(fb.apiKey)}" placeholder="AIzaSy..." class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" required />
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Auth Domain (Opcional)</label>
              <input type="text" id="input-fb-auth-domain" value="${this._esc(fb.authDomain)}" placeholder="ex: gestaopro.firebaseapp.com" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">App ID (Opcional)</label>
              <input type="text" id="input-fb-app-id" value="${this._esc(fb.appId)}" placeholder="1:123456789:web:abcdef" class="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div class="flex items-center gap-2 pt-2">
            <input type="checkbox" id="input-auto-sync" ${this.autoSyncEnabled ? 'checked' : ''} class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
            <label for="input-auto-sync" class="text-xs font-semibold text-slate-700 cursor-pointer">
              Sincronização Automática em Segundo Plano (Debounce ao salvar dados e reconectar)
            </label>
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <button type="button" id="btn-test-cloud" class="border border-blue-600 text-blue-700 hover:bg-blue-50 text-xs font-bold px-4 py-2.5 rounded-lg transition flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              Testar Conexão
            </button>

            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition shadow-xs">
              Salvar Credenciais
            </button>
          </div>
        </form>

        <!-- Inspeção da Fila Outbox -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 class="text-xs font-bold text-slate-900 uppercase tracking-wider">Itens Recentes na Fila Outbox</h4>
            <span class="text-[11px] text-slate-500">${this.syncQueueItems.length} registros no total</span>
          </div>

          ${queue.length === 0 ? `
            <div class="py-6 text-center text-slate-400 text-xs font-medium">
              Nenhuma mutação pendente ou registrada na fila no momento.
            </div>
          ` : `
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs border-collapse">
                <thead>
                  <tr class="border-b border-slate-200 text-slate-500 text-[10px] uppercase font-bold bg-slate-50">
                    <th class="py-2 px-3">Entidade</th>
                    <th class="py-2 px-3">Ação</th>
                    <th class="py-2 px-3">Status</th>
                    <th class="py-2 px-3">Tentativas</th>
                    <th class="py-2 px-3">Data Registro</th>
                    <th class="py-2 px-3">Detalhes</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 text-slate-700 font-medium">
                  ${queue.map(item => {
                    let statusBadge = '';
                    if (item.status === 'SYNCED') {
                      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Sincronizado</span>';
                    } else if (item.status === 'FAILED') {
                      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Falha</span>';
                    } else {
                      statusBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Pendente</span>';
                    }

                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="py-2 px-3 font-bold text-slate-900">${this._esc(formatSyncEntity(item.entityType))}</td>
                        <td class="py-2 px-3 font-semibold text-slate-600">${this._esc(formatSyncAction(item.action))}</td>
                        <td class="py-2 px-3">${statusBadge}</td>
                        <td class="py-2 px-3 text-slate-500">${item.attempts || 0}</td>
                        <td class="py-2 px-3 text-slate-500">${new Date(item.createdAt).toLocaleTimeString('pt-BR')}</td>
                        <td class="py-2 px-3 text-slate-400 text-[11px] truncate max-w-[150px]" title="${this._esc(item.lastError || item.id)}">
                          ${this._esc(item.lastError ? '⚠️ ' + item.lastError : item.entityId)}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  _bindCloudEvents() {
    const form = this.rootElement.querySelector('#form-firebase-config');
    const btnTest = this.rootElement.querySelector('#btn-test-cloud');
    const btnSyncNow = this.rootElement.querySelector('#btn-sync-now');
    const btnRetry = this.rootElement.querySelector('#btn-retry-failed');
    const btnClear = this.rootElement.querySelector('#btn-clear-synced');
    const feedback = this.rootElement.querySelector('#sync-operation-feedback');

    const showFeedback = (msg, isError = false) => {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.className = `text-xs font-bold ml-auto ${isError ? 'text-red-600' : 'text-emerald-600'}`;
      feedback.classList.remove('hidden');
      setTimeout(() => feedback.classList.add('hidden'), 4000);
    };

    // Salvar Credenciais
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = this.rootElement.querySelector('#input-fb-api-key').value.trim();
        const projectId = this.rootElement.querySelector('#input-fb-project-id').value.trim();
        const authDomain = this.rootElement.querySelector('#input-fb-auth-domain').value.trim();
        const appId = this.rootElement.querySelector('#input-fb-app-id').value.trim();
        const autoSync = this.rootElement.querySelector('#input-auto-sync').checked;

        const newConfig = { apiKey, projectId, authDomain, appId };
        await syncEngine.updateCredentials(newConfig);
        await syncEngine.setAutoSync(autoSync);

        this.firebaseConfig = newConfig;
        this.autoSyncEnabled = autoSync;
        showFeedback('✓ Credenciais e preferências salvas com sucesso!');
        await this.loadData();
      });
    }

    // Testar Conexão
    if (btnTest) {
      btnTest.addEventListener('click', async () => {
        const apiKey = this.rootElement.querySelector('#input-fb-api-key').value.trim();
        const projectId = this.rootElement.querySelector('#input-fb-project-id').value.trim();
        
        if (!apiKey || !projectId) {
          alert('Preencha ao menos a API Key e o Project ID para testar a conexão.');
          return;
        }

        btnTest.disabled = true;
        btnTest.innerHTML = `<svg class="animate-spin h-4 w-4 mr-1 text-blue-700" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Testando...`;

        const tempProvider = new FirebaseProvider({ apiKey, projectId });
        const result = await tempProvider.testConnection();

        btnTest.disabled = false;
        btnTest.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Testar Conexão`;

        if (result.success) {
          alert(`✓ Sucesso! ${result.message} (Latência: ${result.latencyMs}ms)`);
        } else {
          alert(`Falha na conexão: ${result.message}`);
        }
      });
    }

    // Sincronizar Agora
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', async () => {
        btnSyncNow.disabled = true;
        btnSyncNow.innerHTML = `<svg class="animate-spin h-4 w-4 mr-1 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Sincronizando...`;

        try {
          const res = await syncEngine.processQueue();
          if (res.notConfigured) {
            alert('Configure a API Key e o Project ID do Firebase antes de sincronizar.');
          } else {
            showFeedback(`✓ Sincronização concluída: ${res.success} sucesso(s), ${res.failed} falha(s).`);
          }
          await this.loadData();
        } catch (err) {
          showFeedback('Erro: ' + err.message, true);
        } finally {
          btnSyncNow.disabled = false;
        }
      });
    }

    // Reprocessar Falhas
    if (btnRetry) {
      btnRetry.addEventListener('click', async () => {
        await syncRepository.retryFailed();
        showFeedback('Itens com falha resetados para reprocessamento.');
        await this.loadData();
      });
    }

    // Limpar Concluídos
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        await syncRepository.clearCompleted();
        showFeedback('Itens sincronizados removidos do histórico.');
        await this.loadData();
      });
    }
  }

  _bindModalEvents() {
    const modal = this.rootElement.querySelector('#modal-restore');
    const closeBtn = this.rootElement.querySelector('#btn-close-restore-modal');
    const cancelBtn = this.rootElement.querySelector('#btn-cancel-restore');
    const confirmBtn = this.rootElement.querySelector('#btn-confirm-restore');

    const closeModal = () => {
      if (modal) modal.classList.add('hidden');
      this.pendingRestoreBackup = null;
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (!this.pendingRestoreBackup) return;

        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<svg class="animate-spin h-4 w-4 text-white mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Restaurando...`;

        try {
          await BackupService.restoreBackup(this.pendingRestoreBackup);
          alert('✓ Banco de dados restaurado com sucesso!');
          closeModal();
          await this.loadData();
        } catch (err) {
          alert('Erro ao restaurar banco: ' + err.message);
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirmar Restauração';
        }
      });
    }
  }

  _renderLoadingSkeleton() {
    return `
      <div class="space-y-4 animate-pulse max-w-2xl">
        <div class="h-4 w-32 bg-slate-200 rounded"></div>
        <div class="h-10 bg-slate-100 rounded-lg"></div>
        <div class="h-10 bg-slate-100 rounded-lg"></div>
        <div class="h-10 bg-slate-100 rounded-lg"></div>
      </div>
    `;
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
