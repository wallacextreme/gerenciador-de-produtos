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
| `#/login` | Autenticação por E-mail e Senha | Ativo (PHASE 02) |
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
| `#/nfe-import` | Importação e Mapeamento de NF-e XML | Ativo (FASE 11) |

---

## Estrutura de Diretórios

```
src/
├── css/
│   └── styles.css            # Tailwind v4 + estilos customizados
└── js/
    ├── app.js                # Shell principal com layout, status bar e badge de auth
    ├── main.js               # Bootstrap: DB + AuthService + App
    ├── router.js             # Hash router com Route Guard centralizado
    ├── eventBus.js           # EventTarget + BroadcastChannel
    ├── auth/                 # Camada de Autenticação Desacoplada (PHASE 02)
    │   ├── AuthProvider.js         # Contrato abstrato de autenticação
    │   ├── FirebaseAuthProvider.js # Implementação oficial Firebase Auth v13 modular
    │   ├── MockAuthProvider.js     # Provedor em memória para testes offline determinísticos
    │   └── index.js                # Facade de exportação
    ├── components/           # Componentes Visuais Reutilizáveis (PHASE 08)
    │   ├── ProductImageGallery.js  # Galeria profissional de fotos, carrossel e lightbox
    │   └── index.js                # Facade de exportação
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
    │   ├── ImageManifestRepository.js    # Repositório local de metadados do manifesto de imagens (PHASE 05)
    │   ├── StockMovementRepository.js
    │   ├── SaleRepository.js
    │   ├── PurchaseRepository.js         # Repositório de compras (Fase 6)
    │   ├── SupplierRepository.js         # Repositório de fornecedores (Fase 6)
    │   ├── ProductSupplierRepository.js  # Repositório de cotações (Fase 7)
    │   └── SettingsRepository.js
    ├── services/
    │   ├── ReportService.js        # Geração de relatórios, CSV UTF-8 BOM e impressão A4 (FASE 10)
    │   ├── BackupService.js        # Backup, restauração com SHA-256 e rollback (FASE 9)
    │   ├── AnalyticsService.js     # Consolidação de KPIs, Curva ABC, CMV e Giro (FASE 8)
    │   ├── ProductService.js       # Casos de uso do módulo de Produtos
    │   ├── StockService.js         # Orquestração transacional de estoque (Fase 4)
    │   ├── SaleService.js          # Orquestração de vendas e faturamento (Fase 5)
    │   ├── PurchaseService.js      # Orquestração de compras e abastecimento (Fase 6)
    │   ├── SupplierService.js      # Gestão de fornecedores (Fase 6)
    │   ├── QuotationService.js     # Gestão e comparação de cotações (Fase 7)
    │   ├── ImageService.js         # Processamento de imagens
    │   ├── ImageManifestService.js # Reconciliação incremental de fotos e delta sync (PHASE 05)
    │   ├── LocalImageCache.js      # Cache offline de imagens, validação SHA-256 e quotas (PHASE 06)
    │   └── ImageSyncService.js     # Fila com prioridades P1/P2/P3, download, retry e offline-first (PHASE 07)
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
    ├── sync/                 # Camada de provedores em nuvem e storage (FASE 13 / PHASE 03 / PHASE 04)
    │   ├── index.js          # Reexportações
    │   ├── CloudProvider.js  # Contrato abstrato de comunicação de dados em nuvem
    │   ├── FirebaseRealtimeProvider.js # Provedor oficial Firebase Realtime Database modular (PHASE 03)
    │   ├── MockRealtimeProvider.js     # Provedor em memória com streaming e multi-tenant (PHASE 03)
    │   ├── FirebaseProvider.js # Integração Firestore REST API (legado preservado)
    │   ├── MockCloudProvider.js # Provedor em memória para testes e isolamento
    │   ├── ImageStorageProvider.js     # Contrato abstrato de armazenamento de imagens (PHASE 04)
    │   ├── MockImageStorageProvider.js # Provedor em memória para imagens com SHA-256 e cotas (PHASE 04)
    │   ├── FirebaseStorageProvider.js  # Provedor oficial Firebase Storage modular SDK v13 (PHASE 04)
    │   └── CloudinaryImageProvider.js  # Provedor REST via unsigned upload preset (PHASE 04)
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

## Arquitetura de Sincronização em Nuvem (FASE 13 — Legado Firestore)

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

---

## Arquitetura Alvo: Firebase Realtime Database & Sincronização de Imagens (Nova Fase Master)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CAMADA DE INTERFACE (UI)                                         │
│   - Catálogo de Produtos │ Galeria Multi-Fotos │ PDV │ Estoque │ Compras │ Cotações │ Relatórios       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      ▲                             ▲
                    Leitura / Escrita │                             │ Eventos Reativos
                                      ▼                             ▼
┌────────────────────────────────────────────────────────┬───────────────────────────────────────────────┐
│              PERSISTÊNCIA LOCAL (IndexedDB)            │         BARRAMENTO DE EVENTOS (EventBus)      │
│   - products, stockMovements, sales, purchases...      │   - BroadcastChannel (Multi-aba/janela)       │
│   - productImages (Blobs locais para uso offline)      │   - Isolamento de Origem: { origin }          │
│   - syncQueue (Fila Outbox transacional)               │     'local' -> Enfileira no Outbox            │
│   - imageManifest (Cache de metadados de fotos)        │     'remote' -> Atualiza UI sem re-enfileirar │
└────────────────────────────────────────────────────────┴───────────────────────────────────────────────┘
                                      │
                                      ▼ (Mutações Locais)
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    MOTOR DE SINCRONIZAÇÃO (SyncEngine)                                 │
│   - Processamento sequencial da fila Outbox (Debounce)                                                │
│   - Detecção de conflitos via Last-Write-Wins (LWW) + Versão Incremental                              │
│   - Auto-sync reativo a reconexões de rede (`online` / `NETWORK_STATUS_CHANGED`)                      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
┌────────────────────────────────────────┐   ┌───────────────────────────────────────────────────────────┐
│      FIREBASE REALTIME DATABASE        │   │          STORAGE & DISTRIBUIÇÃO DE IMAGENS                │
│  - Provedor: FirebaseRealtimeProvider  │   │  - Provedor Pluggable (Sem obrigatoriedade de Blaze)      │
│  - /products                           │   │  - Cloudinary / Supabase Storage / Firebase Storage       │
│  - /inventory                          │   │  - Upload apenas de metadados no Realtime Database        │
│  - /sales                              │   │  - Download sob demanda + background com prioridades      │
│  - /settings                           │   │  - Cache local resiliente em Blobs no IndexedDB           │
│  - /imageManifest                      │   │  - Detecção inteligente de conexões Wi-Fi vs Dados Móveis │
│  - Sincronização Bidirecional (Listeners)│                                                             │
└────────────────────────────────────────┘   └───────────────────────────────────────────────────────────┘
```

---

## 11. Validação em Ambiente Real / Staging e Emuladores (PHASE 09)

O sistema foi submetido à homologação integrada no **Firebase Emulator Suite** com simulação de múltiplos nós concorrentes (Windows Desktop e Android PWA) conectados ao tenant de homologação `tenant-staging`.

### REAL ENVIRONMENT VALIDATION
```text
Project:                 gerenciador-produtos-staging (definido em .firebaserc)
Environment:             Firebase Local Emulator Suite (Automated Validation) + Cloud Staging (Provisioned)
Date:                    08/10/2026
Auth:                    PASS (Emulator Suite + Session + Custom Claims tenant-staging)
RTDB:                    PASS (Schema validation, rules, multi-tenant isolation, append-only ledger)
Storage:                 PASS (WebP rules, mime check, 10MB limit, tenant isolation)
Rules:                   PASS (database.rules.json + storage.rules validadas sem falhas)
Multi-Device:            PASS (Device A Windows Desktop <-> Device B Android PWA sincronizados)
Offline:                 PASS (Outbox offline -> online + LocalImageCache offline display + App Shell cache)
Images:                  PASS (Upload, download, SHA-256 integrity, zero redundant downloads)
PWA Hardening:           PASS (SW lifecycle, safe activation, reconnect debounce, foreground throttle)
Result:                  PASS no Emulator Suite / PARTIAL para Cloud Real (requer criação manual no Firebase Console)
```

---

## 12. PWA Hardening, App Shell e Estratégia de Cache (PHASE 10)

### 12.1 Separação Rígida de Camadas

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE APP SHELL                             │
│  - Gerenciada por: Service Worker (`public/sw.js`)                     │
│  - Armazenamento: Cache Storage (`STATIC_CACHE`, `RUNTIME_CACHE`)       │
│  - Conteúdo: index.html, JS bundles (/assets/*), CSS, manifest, ícones │
│  - Escopo: Estritamente same-origin                                    │
└────────────────────────────────────────────────────────────────────────┘
                                   ≠
┌────────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE BUSINESS DATA                         │
│  - Gerenciada por: Repositórios e Serviços do App                      │
│  - Armazenamento: IndexedDB (`products`, `sales`, `stockMovements`)     │
│  - Fila Outbox: `syncQueue` (preservada através de updates do SW)      │
└────────────────────────────────────────────────────────────────────────┘
                                   ≠
┌────────────────────────────────────────────────────────────────────────┐
│                        CAMADA DE FOTOS DE PRODUTO                      │
│  - Gerenciada por: `LocalImageCache` e `ImageSyncService`              │
│  - Armazenamento: IndexedDB (`productImages` Blobs + `imageManifest`)   │
│  - ZERO duplicação no Cache Storage do Service Worker                  │
└────────────────────────────────────────────────────────────────────────┘
```

### 12.2 Ciclo de Atualização e Safe Activation (`isSafeToUpdate`)
O Service Worker não interrompe o operador no meio de tarefas críticas:
1. **Nova versão detectada**: O Service Worker é baixado e instalado em segundo plano (`installing` -> `installed` / `waiting`).
2. **Avaliação de Segurança**: `pwaHandler.isSafeToUpdate()` verifica se:
   - A aplicação está online (atualizações são bloqueadas quando offline);
   - O foco não está em campos de entrada (`input`, `textarea`, `select`);
   - Nenhum modal de formulário ou diálogo está aberto;
   - O usuário não está em rotas de cadastro ou edição (`#/produtos/novo`, `#/produtos/editar`).
3. **UX Não-Intrusiva**: A interface exibe banner com botões `[Atualizar]` e `[Depois]`. O recarregamento só é acionado quando seguro ou após confirmação explícita do usuário.

### 12.3 Reconnection Coordinator e Prevenção de Tempestades de Sync
1. **Debounce de Rede (250ms)**: Eventos `online` e `offline` são amortecidos para eliminar flutuações e rajadas transitórias de conexão.
2. **Foreground & Focus Throttle (4000ms)**: Transições de primeiro plano (`visibilitychange` quando `visible` e `focus`) possuem cooldown de 4 segundos, evitando que alternâncias de aba disparem múltiplas reconciliações redundantes.

### 12.4 Separação de Plataforma: Tauri Desktop vs Web PWA
Em execução nativa Desktop via Tauri v2 (`platform.isDesktop() === true`), o registro do Service Worker e a captura de `beforeinstallprompt` são ignorados, garantindo que o runtime WebView2 nativo opere sem interceptações desnecessárias de rede.

---

## 13. Arquitetura de Segurança e Defesa em Profundidade (PHASE 11)

### 13.1 Princípio de Não-Confiança no Cliente (Zero Client Trust)
O **IndexedDB local** opera como cache e fonte de verdade offline no dispositivo, mas **NUNCA como autoridade de segurança**. Toda e qualquer autorização definitiva de leitura e escrita é avaliada nas **Security Rules** do Firebase:
1. **Regras Granulares sem Cascata Pai no RTDB (`database.rules.json`)**:
   - A regra `.write` na raiz do tenant `$tenantId` foi removida.
   - Cada recurso filho (`products`, `inventory`, `sales`, `purchases`, `suppliers`, `settings`, `imageManifest`) possui sua própria verificação declarativa de tenant e role (`admin` vs `operator`).
   - Evita que operadores contornem regras restritivas por herança de permissão pai.
2. **Proteção Contra Escalada em `/users/$uid`**:
   - Impede que usuários não-administradores alterem seus próprios atributos `role` e `tenantId`.

### 13.2 Isolamento de Mídia e Prevenção de Injeção no Cloud Storage (`storage.rules`)
- **Restrição Estrita de Formatos**: Somente formatos raster web seguros são permitidos: `image/jpeg`, `image/png`, `image/webp`. O formato `image/svg+xml` é categoricamente proibido para anular riscos de Stored XSS via tags SVG.
- **Teto Físico de Arquivo**: Limite rígido de 10 MB (`request.resource.size < 10 * 1024 * 1024`).
- **Isolamento de Caminho por Tenant**: Leitura, escrita e exclusão só são permitidas quando `request.auth.token.tenantId == tenantId`.

### 13.3 Sanitização Multicamadas Anti-XSS e Anti-Traversal
1. **Relatórios e Impressão (`ReportService.js`)**: Método `_escapeHTML` escapa caracteres especiais (`&`, `<`, `>`, `"`, `'`) em todos os dados de empresa, metadados e células de tabela antes da escrita via `document.write`.
2. **Path Traversal Sanitizer (`FirebaseStorageProvider.js`)**: O método `_sanitizePathSegment` bloqueia sequências `../`, `..\`, `/`, `\`, `:` e null bytes (`\0`), e `_validateRemotePathForTenant` assegura fronteiras de diretório do tenant.
3. **Validação de Protocolo de URLs**:
   - `webAdapter.js` e `tauriAdapter.js` rejeitam protocolos perigosos (`javascript:`, `data:`, `file:`) em `openExternal`.
   - `ProductImageGallery.js` sanitiza e filtra URLs de exibição com `_sanitizeImageUrl`.
4. **Resiliência do Barramento de Eventos (`eventBus.js`)**: O listener do `BroadcastChannel` descarta mensagens nulas, não-objeto ou sem `type` válido, prevenindo envenenamento de estado inter-abas.

---

## Links e Documentação de Referência

- [PROJECT_STATE.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/PROJECT_STATE.md) — Estado geral e diagnóstico da fase atual.
- [ROADMAP.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/ROADMAP.md) — Planejamento das fases de evolução.
- [THREAT_MODEL.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/docs/THREAT_MODEL.md) — Modelo formal de ameaças e atores maliciosos.
- [SYNC_ARCHITECTURE.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/SYNC_ARCHITECTURE.md) — Desenho da sincronização de dados e Realtime Database.
- [IMAGE_SYNC_ARCHITECTURE.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/IMAGE_SYNC_ARCHITECTURE.md) — Estratégia de armazenamento e sync de fotos.
- [SECURITY.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/SECURITY.md) — Política e regras de segurança.
- [TESTING.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/TESTING.md) — Matriz de testes automatizados e 21 cenários de imagem.


