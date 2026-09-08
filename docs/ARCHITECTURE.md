# Arquitetura do Sistema — GestãoPro

## Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| UI | Vanilla JavaScript (ES Modules), HTML5 Semântico |
| Estilos | Tailwind CSS v4 via `@tailwindcss/vite` |
| Bundler | Vite v8 |
| Runtime / Testes | Bun v1.3+ |
| Persistência | IndexedDB via `idb` v8 |
| Sync Inter-Aba | BroadcastChannel API |
| IDs | `crypto.randomUUID()` |

---

## Camadas da Arquitetura

```
┌────────────────────────────────────────────────────────────────────────┐
│  UI Layer — Páginas e Componentes (Vanilla JS, HTML Templates)         │
│  DashboardPage (FASE 8) │ SettingsPage (FASE 9) │ ReportsPage (FASE 10) │
│  ProductFormPage │ ProductDetailPage │ StockPage │ SalesPage │           │
│  PurchasesPage │ SuppliersPage │ QuotationsPage (FASE 7)               │
└────────────────────────────────────────────────────────────────────────┘
          │ invoca Application Services
┌────────────────────────────────────────────────────────────────────────┐
│  Application Services — Orquestra Domínio + Repositórios               │
│  ReportService (FASE 10) │ BackupService (FASE 9) │ AnalyticsService   │
│  ProductService │ StockService │ SaleService │ PurchaseService         │
│  SupplierService │ QuotationService (FASE 7) │ ImageService            │
└────────────────────────────────────────────────────────────────────────┘
          │ usa Domain Services e chama Repositories
┌────────────────────────────────────────────────────────────────────────┐
│  Domain Layer — Lógica Pura de Negócio e Validações                    │
│  MoneyService │ MarginService │ ProductValidator │ StockValidator      │
│  SaleValidator │ PurchaseValidator │ SupplierValidator                 │
│  QuotationValidator (FASE 7)                                           │
└────────────────────────────────────────────────────────────────────────┘
          │ opera sobre
┌────────────────────────────────────────────────────────────────────────┐
│  Repository Layer — Abstração CRUD sobre IndexedDB                     │
│  ProductRepository │ ProductImageRepository │ StockMovementRepository  │
│  SaleRepository │ PurchaseRepository │ SupplierRepository              │
│  ProductSupplierRepository (FASE 7) │ SettingsRepository               │
└────────────────────────────────────────────────────────────────────────┘
          │ usa
┌────────────────────────────────────────────────────────────────────────┐
│  Persistence Layer — Conexão, Schema e Transações                      │
│  connection.js (getDB)  │  migrations.js  │  transactions.js           │
└────────────────────────────────────────────────────────────────────────┘
          │ comunica via
┌────────────────────────────────────────────────────────────────────────┐
│  Event Layer — Sincronização Intra e Inter-Aba                         │
│  eventBus.js (EventTarget + BroadcastChannel)                          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Roteamento

Hash-based routing via `Router`:

| Hash | Página | Status |
|------|--------|--------|
| `#/dashboard` | Painel de Controle e Análises | Ativo (FASE 8) |
| `#/produtos` | Catálogo de Produtos | Ativo (Fase 3) |
| `#/produtos/novo` | Formulário de Criação | Ativo (Fase 3) |
| `#/produtos/editar/:id` | Formulário de Edição | Ativo (Fase 3) |
| `#/produtos/detalhes/:id` | Tela de Detalhes do Produto | Ativo (Fase 3/4/5/6/7) |
| `#/estoque` | Gerenciamento de Estoque | Ativo (FASE 4) |
| `#/vendas` | Frente de Caixa e Vendas (PDV) | Ativo (FASE 5) |
| `#/compras` | Ordens de Compra e Entrada de Estoque | Ativo (FASE 6) |
| `#/fornecedores` | Gestão de Fornecedores | Ativo (FASE 6) |
| `#/cotacoes` | Cotações de Fornecedores por Produto | Ativo (FASE 7) |
| `#/configuracoes` | Configurações, Backup e Restauração | Ativo (FASE 9) |
| `#/relatorios` | Central de Relatórios & Impressão | Ativo (FASE 10) |

---

## Estrutura de Diretórios

```
src/
├── css/
│   └── styles.css            # Tailwind v4 + estilos customizados
└── js/
    ├── app.js                # Shell principal com layout e sidebar
    ├── main.js               # Bootstrap: DB + App
    ├── router.js             # Hash router
    ├── eventBus.js           # EventTarget + BroadcastChannel
    ├── db/
    │   ├── connection.js     # getDB() singleton
    │   ├── migrations.js     # Versionamento do schema
    │   └── transactions.js   # executeTransaction() atômica
    ├── domain/
    │   ├── MoneyService.js   # Centavos, formatação, float
    │   └── MarginService.js  # Margem, Markup, Lucro, cálculo reverso
    ├── validators/
    │   ├── ProductValidator.js   # Validação de entidade Produto
    │   ├── StockValidator.js     # Validação de movimentações de estoque (Fase 4)
    │   ├── SaleValidator.js      # Validação de vendas comerciais (Fase 5)
    │   ├── SupplierValidator.js  # Validação de fornecedores (Fase 6)
    │   ├── PurchaseValidator.js  # Validação de ordens de compra (Fase 6)
    │   └── QuotationValidator.js # Validação de cotações por produto (Fase 7)
    ├── repositories/
    │   ├── BaseRepository.js
    │   ├── ProductRepository.js
    │   ├── ProductImageRepository.js
    │   ├── StockMovementRepository.js
    │   ├── SaleRepository.js
    │   ├── PurchaseRepository.js         # Repositório de compras (Fase 6)
    │   ├── SupplierRepository.js         # Repositório de fornecedores (Fase 6)
    │   ├── ProductSupplierRepository.js  # Repositório de cotações (Fase 7)
    │   └── SettingsRepository.js
    ├── services/
    │   ├── ReportService.js    # Geração de relatórios, CSV UTF-8 BOM e impressão A4 (FASE 10)
    │   ├── BackupService.js    # Backup, restauração com SHA-256 e rollback (FASE 9)
    │   ├── AnalyticsService.js # Consolidação de KPIs, Curva ABC, CMV e Giro (FASE 8)
    │   ├── ProductService.js   # Casos de uso do módulo de Produtos
    │   ├── StockService.js     # Orquestração transacional de estoque (Fase 4)
    │   ├── SaleService.js      # Orquestração de vendas e faturamento (Fase 5)
    │   ├── PurchaseService.js  # Orquestração de compras e abastecimento (Fase 6)
    │   ├── SupplierService.js  # Gestão de fornecedores (Fase 6)
    │   ├── QuotationService.js # Gestão e comparação de cotações (Fase 7)
    │   └── ImageService.js     # Processamento de imagens
    ├── pages/
    │   ├── DashboardPage.js      # Painel Executivo com KPIs e Gráficos SVG (FASE 8)
    │   ├── SettingsPage.js       # Configurações, Backup e Restauração (FASE 9)
    │   ├── ReportsPage.js        # Central de Relatórios, CSV e Impressão A4 (FASE 10)
    │   ├── ProductsPage.js       # Lista + Filtros + Busca
    │   ├── ProductFormPage.js    # Formulário Criar/Editar
    │   ├── ProductDetailPage.js  # Tela Detalhada + Estoque + Vendas + Compras + Cotações
    │   ├── StockPage.js          # Módulo de Gestão de Estoque (Fase 4)
    │   ├── SalesPage.js          # Módulo de Vendas e PDV (Fase 5)
    │   ├── PurchasesPage.js      # Módulo de Ordens de Compra (Fase 6)
    │   ├── SuppliersPage.js      # Módulo de Fornecedores (Fase 6)
    │   └── QuotationsPage.js     # Módulo de Cotações por Produto (Fase 7)
    ├── platform/             # Camada de abstração multiplataforma (FASE 12)
    │   ├── index.js          # Ponto de entrada e reexportações
    │   ├── platform.js       # Facade singleton com detecção de runtime
    │   ├── webAdapter.js     # Implementação Web / PWA
    │   └── tauriAdapter.js   # Implementação Desktop nativa (Windows Tauri)
    ├── sync/                 # Camada de provedores em nuvem (FASE 13)
    │   ├── index.js          # Reexportações
    │   ├── CloudProvider.js  # Contrato abstrato de comunicação em nuvem
    │   ├── FirebaseProvider.js # Integração Firestore REST API
    │   └── MockCloudProvider.js # Provedor em memória para testes e isolamento
    └── utils/
        ├── storage.js        # navigator.storage.persist()
        └── pwa.js            # PWAHandler (Service Worker, beforeinstallprompt, online/offline) (FASE 11)

src-tauri/                    # Backend nativo Desktop (FASE 12)
├── Cargo.toml                # Manifesto Rust do Tauri v2
├── build.rs                  # Build script do Tauri
├── tauri.conf.json           # Configuração de janelas, bundles e empacotamento
├── capabilities/
│   └── default.json          # Permissões com princípio do menor privilégio
├── icons/                    # Ícones desktop nativos
└── src/
    ├── lib.rs                # Biblioteca Rust Tauri v2
    └── main.rs               # Entrypoint Windows desktop

public/
├── manifest.json             # W3C Web App Manifest (standalone, theme, shortcuts, icons)
├── sw.js                     # Service Worker (Network First HTML, Cache First Assets, Offline Shell)
└── icons/                    # Ícones de alta resolução (96, 144, 192, 512, apple-touch)
```

---

## Arquitetura de Sincronização em Nuvem (FASE 13)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Mutações de Negócio (EventBus: PRODUCT_UPDATED, SALE_CREATED, etc.)   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SyncRepository (Store IndexedDB: `syncQueue` — Outbox Pattern)        │
│  - Gravação transacional instantânea com latência zero                 │
│  - Coalescência de mutações pendentes (UPDATE sobre CREATE)            │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SyncEngine (`src/js/services/SyncEngine.js`)                          │
│  - Orquestrador sequencial e idempotente com debounce                  │
│  - Reativo ao `NETWORK_STATUS_CHANGED` (auto-sync ao reconectar)       │
│  - Resolução de Conflitos: Last Write Wins (LWW) via `updatedAt`       │
└────────────────────────────────────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
┌────────────────────────┐   ┌───────────────────────────────────────────┐
│ FirebaseProvider       │   │ MockCloudProvider                         │
│ - Firestore REST API   │   │ - Emulação em memória para testes         │
│ - Transformador Tipado │   │ - Injeção de latência e falhas de rede    │
└────────────────────────┘   └───────────────────────────────────────────┘
```
