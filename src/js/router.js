export class Router {
  constructor() {
    this.routes = {};
    this.rootElement = null;
    this.currentCleanup = null;
    this.currentPage = null;
    
    // Listen for hash changes
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  init(element) {
    this.rootElement = element;
    
    // Define base routes
    this.addRoute('dashboard', () => this.renderDashboard());
    this.addRoute('produtos', () => this.renderProducts());
    this.addRoute('produtos/novo', () => this.renderProductForm());
    this.addRoute('produtos/editar', (id) => this.renderProductForm(id));
    this.addRoute('produtos/detalhes', (id) => this.renderProductDetail(id));
    this.addRoute('estoque', () => this.renderStock());
    this.addRoute('vendas', () => this.renderSales());
    this.addRoute('compras', () => this.renderPurchases());
    this.addRoute('fornecedores', () => this.renderSuppliers());
    this.addRoute('cotacoes', () => this.renderQuotations());
    this.addRoute('configuracoes', () => this.renderSettings());
    this.addRoute('relatorios', () => this.renderReports());

    // Handle initial route
    if (!window.location.hash) {
      window.location.hash = '#/dashboard';
    } else {
      this.handleRoute();
    }
  }

  addRoute(path, handler) {
    this.routes[path] = handler;
  }

  handleRoute() {
    if (this.currentCleanup) {
      this.currentCleanup();
      this.currentCleanup = null;
    }
    
    const hash = window.location.hash.slice(2) || 'dashboard';
    const parts = hash.split('/');
    const routeBase = parts[0]; 
    const routeAction = parts[1];
    const routeId = parts[2];

    this.updatePageTitle(routeBase, routeAction);
    this.updateNavHighlight(routeBase);

    let fullRoute = routeBase;
    let param = null;

    if (routeAction === 'editar' && routeId) {
      fullRoute = `${routeBase}/editar`;
      param = routeId;
    } else if (routeAction === 'detalhes' && routeId) {
      fullRoute = `${routeBase}/detalhes`;
      param = routeId;
    } else if (routeAction === 'novo') {
      fullRoute = `${routeBase}/novo`;
    }

    const handler = this.routes[fullRoute] || this.routes[routeBase];

    if (handler) {
      handler(param);
    } else {
      this.renderNotFound();
    }
  }

  async renderProducts() {
    this.rootElement.innerHTML = '';
    const { ProductsPage } = await import('./pages/ProductsPage.js');
    this.currentPage = new ProductsPage(this.rootElement);
    this.currentPage.render();
    
    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderProductForm(id = null) {
    this.rootElement.innerHTML = '';
    const { ProductFormPage } = await import('./pages/ProductFormPage.js');
    this.currentPage = new ProductFormPage(this.rootElement, id);
    this.currentPage.render();
    
    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderProductDetail(id) {
    this.rootElement.innerHTML = '';
    const { ProductDetailPage } = await import('./pages/ProductDetailPage.js');
    this.currentPage = new ProductDetailPage(this.rootElement, id);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderStock() {
    this.rootElement.innerHTML = '';
    const { StockPage } = await import('./pages/StockPage.js');
    this.currentPage = new StockPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderSales() {
    this.rootElement.innerHTML = '';
    const { SalesPage } = await import('./pages/SalesPage.js');
    this.currentPage = new SalesPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderPurchases() {
    this.rootElement.innerHTML = '';
    const { PurchasesPage } = await import('./pages/PurchasesPage.js');
    this.currentPage = new PurchasesPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderSuppliers() {
    this.rootElement.innerHTML = '';
    const { SuppliersPage } = await import('./pages/SuppliersPage.js');
    this.currentPage = new SuppliersPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderQuotations() {
    this.rootElement.innerHTML = '';
    const { QuotationsPage } = await import('./pages/QuotationsPage.js');
    this.currentPage = new QuotationsPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderSettings() {
    this.rootElement.innerHTML = '';
    const { SettingsPage } = await import('./pages/SettingsPage.js');
    this.currentPage = new SettingsPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  async renderReports() {
    this.rootElement.innerHTML = '';
    const { ReportsPage } = await import('./pages/ReportsPage.js');
    this.currentPage = new ReportsPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  updatePageTitle(route, action) {
    const titleEl = document.getElementById('page-title');
    if (titleEl) {
      if (route === 'produtos') {
        if (action === 'novo') titleEl.textContent = 'Novo Produto';
        else if (action === 'editar') titleEl.textContent = 'Editar Produto';
        else if (action === 'detalhes') titleEl.textContent = 'Detalhes do Produto';
        else titleEl.textContent = 'Catálogo de Produtos';
      } else if (route === 'dashboard') {
        titleEl.textContent = 'Painel de Controle e Análises';
      } else if (route === 'estoque') {
        titleEl.textContent = 'Gerenciamento de Estoque';
      } else if (route === 'vendas') {
        titleEl.textContent = 'Frente de Caixa e Vendas (PDV)';
      } else if (route === 'compras') {
        titleEl.textContent = 'Ordens de Compra e Entrada de Estoque';
      } else if (route === 'fornecedores') {
        titleEl.textContent = 'Cadastro de Fornecedores';
      } else if (route === 'cotacoes') {
        titleEl.textContent = 'Cotações de Fornecedores';
      } else if (route === 'configuracoes') {
        titleEl.textContent = 'Configurações e Backup';
      } else if (route === 'relatorios') {
        titleEl.textContent = 'Central de Relatórios & Impressão';
      } else {
        titleEl.textContent = route.charAt(0).toUpperCase() + route.slice(1);
      }
    }
  }

  updateNavHighlight(currentBase) {
    const navLinks = document.querySelectorAll('aside nav a');
    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.startsWith(`#/${currentBase}`)) {
        link.classList.add('bg-slate-700', 'text-white', 'font-semibold');
        link.classList.remove('text-slate-300');
      } else {
        link.classList.remove('bg-slate-700', 'font-semibold');
        link.classList.add('text-slate-300');
      }
    });
  }

  async renderDashboard() {
    this.rootElement.innerHTML = '';
    const { DashboardPage } = await import('./pages/DashboardPage.js');
    this.currentPage = new DashboardPage(this.rootElement);
    this.currentPage.render();

    this.currentCleanup = () => {
      if (this.currentPage && this.currentPage.destroy) {
        this.currentPage.destroy();
      }
    };
  }

  renderNotFound() {
    this.rootElement.innerHTML = `
      <div class="text-center text-slate-500 mt-16 max-w-md mx-auto p-6 bg-white rounded-xl border border-slate-200">
        <h3 class="text-3xl font-black text-slate-800 mb-2">404</h3>
        <p class="text-slate-600 mb-6">Página não encontrada.</p>
        <a href="#/dashboard" class="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition">
          Voltar ao Dashboard
        </a>
      </div>
    `;
  }
}
