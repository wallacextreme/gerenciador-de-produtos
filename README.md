# Gerenciador de Produtos — Catálogo & Gestão Comercial (Desktop & PWA)

[![Tauri](https://img.shields.io/badge/Tauri-2.11-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Vite](https://img.shields.io/badge/Vite-8.2-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![IndexedDB](https://img.shields.io/badge/IndexedDB-idb_8.0-F16529?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/pt-BR/docs/Web/API/IndexedDB_API)
[![Bun](https://img.shields.io/badge/Runtime-Bun_1.3-FBF0DF?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![Status](https://img.shields.io/badge/Status-Advanced_Project-blue?style=flat-square)](#)

Aplicação de **Gestão Comercial e Catálogo de Produtos** projetada sob o paradigma **Offline-First**, executando como aplicação desktop nativa via **Tauri 2** ou como **Progressive Web App (PWA)** no navegador, com persistência local em **IndexedDB**, barramento de eventos e abstração de provedores de sincronização.

---

## 🎯 Objetivo

Oferecer controle prático de catálogo de produtos, estoque, vendas e fornecedores com funcionamento garantido sem conexão à internet, demonstrando a aplicação do padrão Repository, serviços de domínio desacoplados e adaptadores de plataforma para desktop e web.

---

## ✨ Módulos do Sistema

### 📦 Produtos & Catálogo
- Cadastro de itens com código de barras, SKU, categoria, preço de custo, preço de venda e cálculo automático de margem/markup.
- Armazenamento de imagens de produtos via `ProductImageRepository`.
- Associação de fornecedores por produto com histórico de cotações.

### 📊 Estoque & Movimentações
- Registro de entradas, saídas e ajustes de saldo (`StockMovementRepository`).
- Verificação de estoque mínimo com alertas visuais.

### 💰 Vendas & Cálculos de Domínio
- Lançamento de pedidos de venda com subtotais e cálculo de lucro.
- Regras de domínio isoladas para cálculos financeiros (`MoneyService`) e análise de lucratividade (`MarginService`).

### 🛒 Compras & Cotações
- Registro de compras e comparativo de preços entre fornecedores (`QuotationService`).

### 📈 Relatórios & Inteligência
- Dashboards com métricas de faturamento, giro de itens e histórico de operações (`AnalyticsService` e `ReportService`).

### 🔄 Arquitetura Offline-First & Provedores
- **Armazenamento Primário**: IndexedDB local no cliente utilizando a biblioteca `idb 8.0` com controle de esquemas versionados (`migrations.js`) e transações seguras (`transactions.js`).
- **Abstração Cloud Provider**:
  - `FirebaseProvider`: Adaptador que consome a REST API do Google Firestore diretamente, sem SDKs pesados.
  - `MockCloudProvider`: Provedor em memória utilizado para testes automatizados unitários e de integração.
- **Backup & Restauração**: Rotinas de exportação e importação de snapshots do banco (`BackupService`).

---

## 🏗️ Arquitetura em Camadas

```text
┌─────────────────────────────────────────────────────────────┐
│                 Interface do Usuário (UI)                   │
│   (DashboardPage, ProductsPage, SalesPage, StockPage, etc.) │
│                   Router + EventBus                         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Serviços & Regras de Domínio                │
│    (ProductService, SaleService, StockService, BackupService)│
│               Domain: MoneyService, MarginService           │
│                    Validators Layer                         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Camada de Repositórios                      │
│ (ProductRepository, SaleRepository, StockMovementRepository)│
│                   BaseRepository Pattern                    │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│     IndexedDB Local (idb)   │ │   SyncEngine (Offline-First)│
│  - Migrations de Esquema    │ │   - FirebaseProvider (REST) │
│  - Transações Atômicas      │ │   - MockCloudProvider (Mem) │
└─────────────────────────────┘ └─────────────────────────────┘
```

### Adaptadores de Plataforma (Ports & Adapters)
- `tauriAdapter.js`: Comunicação com sistema de arquivos e recursos nativos no Desktop.
- `webAdapter.js`: Fallbacks utilizando Web Storage e APIs de navegador no modo PWA.

---

## 🧪 Testes Automatizados

O projeto inclui **14 arquivos de testes automatizados** executados via **Bun**:

- `tests/domain.test.js`: Cálculos de centavos, margens, markup e validações monetárias.
- `tests/db.test.js`: Operações de banco IndexedDB com `fake-indexeddb`.
- `tests/products.test.js` & `tests/products_phase3.test.js`: Ciclo de vida e validações de produtos.
- `tests/stock_phase4.test.js`: Movimentações e integridade de saldo de estoque.
- `tests/sales_phase5.test.js`: Processamento de pedidos de venda.
- `tests/purchases_suppliers_phase6.test.js`: Associação e regras de fornecedores.
- `tests/quotations_phase7.test.js`: Cotações comparativas.
- `tests/analytics_phase8.test.js`: Métricas agregadas e relatórios.
- `tests/backup_settings_phase9.test.js`: Snapshots e configurações.
- `tests/reports_phase10.test.js`: Geração de relatórios operacionais.
- `tests/pwa_phase11.test.js`: Ciclo de vida e service worker.
- `tests/platform_phase12.test.js`: Validação dos adaptadores Tauri vs Web.
- `tests/sync_phase13.test.js`: Motor de sincronização com provedores Mock e Firebase.

---

## 🚀 Como Executar

### Pré-requisitos
- **Bun** instalado (ou Node.js 18+)
- Para modo Desktop: Ferramentas de desenvolvimento do **Rust** e build tools do Windows.

### 1. Instalar dependências
```bash
bun install
```

### 2. Modo Web / PWA (Desenvolvimento)
```bash
bun run dev
```
Inicia o servidor Vite em `http://localhost:5173`.

### 3. Modo Desktop (Tauri)
```bash
bun run tauri dev
```

### 4. Executar Testes Automatizados
```bash
bun test
```
*Executa a suíte de testes de domínio, banco, repositórios e serviços com o runner nativo do Bun.*

---

## 📌 Status

- **Maturidade**: Projeto Avançado / Portfólio de Engenharia de Software.
- **Competências em evidência**: Arquitetura Offline-First, IndexedDB com idb, padrão Repository, isolamento de regras de domínio, testes automatizados e integração híbrida Desktop/Web com Tauri 2 e Tailwind CSS 4.

---

## 👨‍💻 Autor

Desenvolvido por **[Wallace Soares](https://github.com/wallacextreme)**.