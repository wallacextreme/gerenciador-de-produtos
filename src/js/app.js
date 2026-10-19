import { Router } from './router.js';
import { pwaHandler } from './utils/pwa.js';
import { platform } from './platform/index.js';
import { syncEngine } from './services/SyncEngine.js';
import { authService } from './services/AuthService.js';
import { eventBus, EVENTS } from './eventBus.js';

export class App {
  constructor() {
    this.rootElement = null;
    this.router = new Router();
    this.networkBadgeEl = null;
    this.syncBadgeEl = null;
    this.authBadgeEl = null;
    this.installBtnEl = null;
    this.cleanupFns = [];
  }

  mount(element) {
    if (!element) throw new Error('Mount element not found.');
    this.rootElement = element;
    
    this.renderLayout();
    this.router.init(this.rootElement.querySelector('#main-content'));
    this.bindEvents();
  }

  renderLayout() {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const session = authService.getCurrentSession();

    this.rootElement.innerHTML = `
      <!-- Mobile Drawer Backdrop -->
      <div id="mobile-sidebar-backdrop" class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 hidden md:hidden transition-opacity"></div>

      <!-- Sidebar -->
      <aside id="app-sidebar" class="fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white flex flex-col flex-shrink-0 transform -translate-x-full md:relative md:translate-x-0 transition-transform duration-200 ease-in-out">
        <!-- Logo / Brand -->
        <div class="px-5 py-5 border-b border-slate-700/50 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-xs">
              <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
            </div>
            <div class="min-w-0">
              <h1 class="text-base font-extrabold text-white tracking-tight leading-none">GestãoPro</h1>
              <p class="text-[10px] text-slate-400 font-medium mt-0.5 truncate">Catálogo, Estoque, Vendas & Compras</p>
            </div>
          </div>
          <button id="btn-close-mobile-menu" type="button" class="md:hidden p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition" aria-label="Fechar Menu">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 mb-3 mt-1">Menu Principal</p>

          <a href="#/dashboard" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
            </svg>
            Dashboard
          </a>

          <a href="#/produtos" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
            </svg>
            Catálogo de Produtos
          </a>

          <a href="#/estoque" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
            <span>Estoque</span>
          </a>

          <a href="#/vendas" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-emerald-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
            </svg>
            <span>Vendas (PDV)</span>
          </a>

          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pt-3 mb-2">Suprimentos</p>

          <a href="#/compras" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
            <span>Ordens de Compra</span>
          </a>

          <a href="#/compras/importar-nfe" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-amber-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            <span>Importar NFe (XML)</span>
          </a>

          <a href="#/fornecedores" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-indigo-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
            <span>Fornecedores</span>
          </a>

          <a href="#/cotacoes" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-emerald-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
            </svg>
            <span>Cotações</span>
          </a>

          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 pt-3 mb-2">Sistema</p>

          <a href="#/relatorios" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-indigo-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span>Relatórios</span>
          </a>

          <a href="#/configuracoes" class="nav-link flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all text-slate-300 hover:bg-slate-800 hover:text-white text-sm font-medium group">
            <svg class="w-4.5 h-4.5 text-slate-400 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span>Configurações</span>
          </a>
        </nav>

        <!-- PWA Install Button (if eligible and not already standalone) -->
        <div id="sidebar-install-container" class="px-4 py-2 hidden">
          <button id="btn-sidebar-install" class="w-full flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all transform active:scale-95">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            <span>Instalar Aplicativo</span>
          </button>
        </div>

        <!-- Footer -->
        <div class="p-4 border-t border-slate-700/50">
          <div class="text-[10px] text-slate-500 text-center">
            <p class="font-semibold text-slate-400">GestãoPro v1.13.0</p>
            <p class="text-[9px] text-slate-500 mt-0.5">Firebase & Cloud Sync</p>
          </div>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="flex-1 flex flex-col bg-slate-50 overflow-hidden min-w-0">
        <!-- Top Header Bar -->
        <header class="bg-white border-b border-slate-200 h-14 flex items-center px-3 sm:px-6 flex-shrink-0 gap-2 sm:gap-4">
          <button id="btn-mobile-menu" type="button" class="md:hidden p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition flex-shrink-0" aria-label="Abrir Menu">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <h2 class="text-sm font-bold text-slate-800 truncate" id="page-title">Painel de Controle</h2>
          <div class="flex-1"></div>
          
          <div class="flex items-center gap-2 sm:gap-3 text-xs font-medium flex-shrink-0">
            <!-- Dynamic Cloud Sync Badge -->
            <div id="header-sync-badge" class="hidden sm:block">
              <span class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                Nuvem Pronta
              </span>
            </div>

            <!-- Dynamic Network Status Badge -->
            <div id="header-network-badge">
              ${this._renderNetworkBadge(isOnline)}
            </div>

            <!-- IndexedDB Status -->
            <span class="hidden lg:flex items-center gap-1.5 text-slate-500">
              <span class="w-2 h-2 rounded-full bg-blue-500"></span>
              IndexedDB Local
            </span>

            <!-- Auth Session Status Badge & Actions -->
            <div id="header-auth-badge">
              ${this._renderAuthBadge(session)}
            </div>
          </div>
        </header>

        <!-- Migration Notice Banner (when requiresMigration === true) -->
        <div id="migration-banner-container">
          ${this._renderMigrationBanner(session)}
        </div>

        <!-- Scrollable Content Region -->
        <div id="main-content" class="flex-1 overflow-auto p-3 sm:p-6">
          <!-- Router injects views here -->
        </div>
      </main>
    `;
  }

  _renderMigrationBanner(session) {
    if (session && session.authenticated && session.requiresMigration) {
      return `
        <div id="migration-notice-bar" class="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-4" role="alert">
          <div class="flex items-center gap-2.5">
            <svg class="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <span><strong>Aviso de Permissões:</strong> Sua conta está autenticada, mas aguarda regularização administrativa de claims (papel comercial). Operações protegidas de gravação permanecerão restritas até que o administrador conclua o provisionamento.</span>
          </div>
        </div>
      `;
    }
    return '';
  }

  _renderAuthBadge(session) {
    if (session && session.authenticated) {
      const email = session.email || 'Usuário';
      let roleLabel = 'Visualizador';
      if (session.role === 'admin') {
        roleLabel = 'Admin';
      } else if (session.role === 'operator') {
        roleLabel = 'Operador';
      }

      const migrationWarningBadge = session.requiresMigration
        ? `<span class="text-[9px] bg-amber-100 text-amber-800 border border-amber-200 px-1 py-0.2 rounded font-bold uppercase" title="Esta conta necessita de regularização administrativa de permissões.">Aguardando Regularização</span>`
        : '';

      return `
        <div class="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div class="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2 py-1 rounded-lg text-xs font-medium">
            <span class="w-2 h-2 rounded-full ${session.requiresMigration ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
            <span class="truncate max-w-[120px]" title="${email}">${email}</span>
            <span class="text-[9px] bg-slate-200 text-slate-600 px-1 py-0.2 rounded font-bold uppercase">${roleLabel}</span>
            ${migrationWarningBadge}
          </div>
          <button id="btn-header-logout" class="p-1 text-slate-400 hover:text-rose-600 transition-colors" title="Encerrar Sessão">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
            </svg>
          </button>
        </div>
      `;
    }

    return `
      <div class="pl-2 border-l border-slate-200">
        <a href="#/login" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold transition">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
          </svg>
          <span>Entrar</span>
        </a>
      </div>
    `;
  }

  _renderNetworkBadge(isOnline) {
    if (isOnline) {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          Online
        </span>
      `;
    } else {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold animate-pulse">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
          Offline
        </span>
      `;
    }
  }

  _renderSyncBadge(stats) {
    if (!stats) return '';
    if (stats.isSyncing) {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-blue-500 animate-spin"></span>
          Sincronizando...
        </span>
      `;
    }
    if (stats.failed > 0) {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-semibold" title="${stats.failed} falha(s) na sincronização">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>
          ${stats.failed} falha(s) sync
        </span>
      `;
    }
    if (stats.pending > 0) {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
          ${stats.pending} na fila
        </span>
      `;
    }
    if (stats.isConfigured) {
      return `
        <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          Sincronizado
        </span>
      `;
    }
    return `
      <span class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-medium">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
        Nuvem Pronta
      </span>
    `;
  }

  bindEvents() {
    this.networkBadgeEl = this.rootElement.querySelector('#header-network-badge');
    this.syncBadgeEl = this.rootElement.querySelector('#header-sync-badge');
    this.authBadgeEl = this.rootElement.querySelector('#header-auth-badge');
    const installContainer = this.rootElement.querySelector('#sidebar-install-container');
    const btnInstall = this.rootElement.querySelector('#btn-sidebar-install');
    const sidebar = this.rootElement.querySelector('#app-sidebar');
    const backdrop = this.rootElement.querySelector('#mobile-sidebar-backdrop');
    const btnMobileMenu = this.rootElement.querySelector('#btn-mobile-menu');
    const btnCloseMobileMenu = this.rootElement.querySelector('#btn-close-mobile-menu');

    // 0. Controle do Menu Drawer Mobile
    const openMobileMenu = () => {
      if (sidebar) sidebar.classList.remove('-translate-x-full');
      if (backdrop) backdrop.classList.remove('hidden');
    };
    const closeMobileMenu = () => {
      if (sidebar) sidebar.classList.add('-translate-x-full');
      if (backdrop) backdrop.classList.add('hidden');
    };

    if (btnMobileMenu) btnMobileMenu.addEventListener('click', openMobileMenu);
    if (btnCloseMobileMenu) btnCloseMobileMenu.addEventListener('click', closeMobileMenu);
    if (backdrop) backdrop.addEventListener('click', closeMobileMenu);
    if (sidebar) {
      sidebar.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', closeMobileMenu);
      });
    }

    // 1. Atualização do Badge de Rede
    const updateNetworkUI = (isOnline) => {
      if (this.networkBadgeEl) {
        this.networkBadgeEl.innerHTML = this._renderNetworkBadge(isOnline);
      }
    };

    const unsubNetwork = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, (payload) => {
      updateNetworkUI(payload.isOnline);
    });
    this.cleanupFns.push(unsubNetwork);

    const onOnline = () => updateNetworkUI(true);
    const onOffline = () => updateNetworkUI(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.cleanupFns.push(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });

    // 2. Atualização do Badge de Sincronização em Nuvem
    const updateSyncUI = (stats) => {
      if (this.syncBadgeEl) {
        this.syncBadgeEl.innerHTML = this._renderSyncBadge(stats);
      }
    };

    const unsubSync = eventBus.on(EVENTS.SYNC_STATUS_CHANGED, (stats) => {
      updateSyncUI(stats);
    });
    this.cleanupFns.push(unsubSync);

    // Carrega status inicial do SyncEngine
    syncEngine.getStats().then(stats => updateSyncUI(stats)).catch(() => {});

    // 3. Atualização do Badge de Sessão / Auth State e Banner de Migração
    const updateAuthUI = (session) => {
      if (this.authBadgeEl) {
        this.authBadgeEl.innerHTML = this._renderAuthBadge(session);
        this._bindLogoutButton();
      }
      const migrationContainer = this.rootElement.querySelector('#migration-banner-container');
      if (migrationContainer) {
        migrationContainer.innerHTML = this._renderMigrationBanner(session);
      }
    };

    const unsubAuth = eventBus.on(EVENTS.AUTH_STATE_CHANGED, (payload) => {
      const session = payload && payload.session !== undefined ? payload.session : payload;
      updateAuthUI(session);
    });
    this.cleanupFns.push(unsubAuth);
    this._bindLogoutButton();

    // 4. Botão de Instalação no Sidebar (quando suportado)
    const showInstallPrompt = () => {
      if (installContainer && !platform.isDesktop() && !pwaHandler.isStandalone()) {
        installContainer.classList.remove('hidden');
      }
    };

    const hideInstallPrompt = () => {
      if (installContainer) {
        installContainer.classList.add('hidden');
      }
    };

    if (pwaHandler.isInstallable && !platform.isDesktop() && !pwaHandler.isStandalone()) {
      showInstallPrompt();
    }

    const unsubInstallable = eventBus.on(EVENTS.PWA_INSTALLABLE, () => {
      showInstallPrompt();
    });
    this.cleanupFns.push(unsubInstallable);

    const unsubInstalled = eventBus.on(EVENTS.PWA_INSTALLED, () => {
      hideInstallPrompt();
    });
    this.cleanupFns.push(unsubInstalled);

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        const result = await pwaHandler.promptInstall();
        if (result && result.outcome === 'accepted') {
          hideInstallPrompt();
        }
      });
    }

    // 5. Banner de Atualização PWA (quando disponível)
    const unsubUpdateReady = eventBus.on(EVENTS.PWA_UPDATE_READY, (detail) => {
      const banner = document.getElementById('update-banner');
      const btn = document.getElementById('btn-apply-update');
      const btnDismiss = document.getElementById('btn-dismiss-update');
      if (banner) {
        banner.classList.add('show');
        if (btn && detail && detail.applyUpdate) {
          btn.onclick = () => {
            detail.applyUpdate(true);
            banner.classList.remove('show');
          };
        }
        if (btnDismiss) {
          btnDismiss.onclick = () => banner.classList.remove('show');
        }
      }
    });
    this.cleanupFns.push(unsubUpdateReady);
  }

  _bindLogoutButton() {
    const btnLogout = this.rootElement?.querySelector('#btn-header-logout');
    if (btnLogout) {
      btnLogout.onclick = async () => {
        try {
          await authService.signOut();
          window.location.hash = '#/login';
        } catch (err) {
          console.error('Falha ao deslogar:', err);
        }
      };
    }
  }

  destroy() {
    this.cleanupFns.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    this.cleanupFns = [];
    if (this.router && typeof this.router.destroy === 'function') {
      this.router.destroy();
    }
  }
}
