# Changelog — GestãoPro

## [1.13.0-phase13] — 2026-08-20

### Adicionado — Módulo Firebase & Sincronização em Nuvem (FASE 13)

#### Camada de Provedores em Nuvem (`src/js/sync/`)
- `CloudProvider.js` — Interface abstrata desacoplada para contratos de comunicação remota (`pushChange`, `pullChanges`, `testConnection`).
- `FirebaseProvider.js` — Provedor de alta performance para Google Firebase Firestore REST API sem dependências pesadas externas, com serializador/deserializador tipado nativo.
- `MockCloudProvider.js` — Provedor em memória com suporte a injeção de latência e falhas de rede para testes automatizados.

#### Padrão Outbox & Fila de Sincronização
- `SyncRepository.js` (`src/js/repositories/SyncRepository.js`) — Gerenciador da store IndexedDB `syncQueue`:
  - Enfileiramento transacional com coalescência inteligente (UPDATE fundido em CREATE pendente; eliminação instantânea de DELETE sobre CREATE não sincronizado).
  - Ciclo de vida com status `PENDING`, `SYNCING`, `SYNCED` e `FAILED`.
  - Controle de retentativas (`retryFailed`) e limpeza de histórico (`clearCompleted`).

#### Motor de Sincronização (SyncEngine)
- `SyncEngine.js` (`src/js/services/SyncEngine.js`) — Orquestrador central assíncrono:
  - Processamento ordenado e idempotente da fila com debounce inteligente.
  - Escuta transparente do `EventBus` para capturar mutações (`PRODUCT_UPDATED`, `PRODUCT_DELETED`, `STOCK_CHANGED`, `SALE_CREATED`, `PURCHASE_CREATED`, `SETTINGS_CHANGED`).
  - Auto-sincronização reativa ao evento `NETWORK_STATUS_CHANGED` ao restabelecer conectividade.
  - Resolução determinística de conflitos via Last Write Wins (LWW) baseado em `updatedAt`.

#### Interface do Usuário (UI)
- **5ª Aba em Configurações (`#/configuracoes`)**: Painel de gerenciamento de nuvem e credenciais Firebase, teste de conectividade em tempo real, métricas da fila e tabela de inspeção dos itens Outbox.
- **Badge Dinâmico no Header**: Indicador sutil do estado de sincronização (`Nuvem Pronta`, `Sincronizando...`, `X na fila`, `Sincronizado`, `Falha de sync`).

#### Testes Automatizados
- 12 novos testes em `tests/sync_phase13.test.js` cobrindo o Outbox pattern, encoders tipados, resolução de conflitos e listeners de eventos.
- **Total do Sistema: 171 testes automatizados passando, 0 falhas.**

---

## [1.12.0-phase12] — 2026-08-20

### Adicionado — Módulo Desktop Tauri v2 & Camada Multi-Plataforma (FASE 12)

#### Camada de Abstração Multi-Plataforma
- `Platform` (`src/js/platform/platform.js`) — Facade centralizado para detecção de runtime e operações de sistema:
  - `isDesktop()`, `isPWA()`, `isWeb()`, `getPlatformInfo()`.
  - `webAdapter.js` — Implementação para navegadores modernos e modo PWA instalado.
  - `tauriAdapter.js` — Implementação para ambiente desktop nativo (Windows WebView2) com fallbacks seguros.
  - Desacoplamento estrito da UI: nenhuma página ou componente importa dependências do Tauri diretamente.

#### Backend Nativo Desktop (Tauri v2)
- Estrutura oficial `src-tauri/` configurada para compilação Windows:
  - `Cargo.toml` — Crate `gestaopro v1.12.0` com dependências mínimas (`tauri v2`, `serde`).
  - `tauri.conf.json` — Configuração de empacotamento (`com.gestaopro.app`), janela 1280x820 e bundles `all` (EXE + MSI + NSIS).
  - `capabilities/default.json` — Permissões granulares baseadas no princípio do menor privilégio (`core:default`).
  - `build.rs`, `lib.rs` e `main.rs` com flag para omitir janela de console no Windows em builds de release.
  - Ícones desktop nativos sincronizados em `src-tauri/icons/`.

#### Build & Integração
- Scripts adicionados ao `package.json`: `tauri`, `tauri:dev`, `tauri:build`.
- `vite.config.js` atualizado com porta estrita 3000, `clearScreen: false` e prefixos de ambiente `TAURI_`.
- `SettingsPage.js` — Card de status atualizado para identificar o runtime ativo (`Desktop (Windows Tauri)` vs `PWA` vs `Web`).
- `docs/IMAGE_STORAGE.md` — Estudo de dimensionamento e viabilidade do armazenamento de imagens com IndexedDB e filesystem.

#### Testes Automatizados
- 10 novos testes em `tests/platform_phase12.test.js` cobrindo adapters, detecção de runtime, integridade da configuração Tauri e scripts de build.
- **Total do Sistema: 159 testes automatizados, 0 falhas.**

---

## [1.11.0-phase11] — 2026-08-20

### Adicionado — Módulo de PWA & Resiliência Offline (FASE 11)

#### PWA & Ciclo de Vida do Service Worker
- `PWAHandler.js` (`src/js/utils/pwa.js`) — Módulo para gerenciar o ecossistema PWA no navegador:
  - Registro controlado do Service Worker com monitoramento de updates (`updatefound`, `installed`, `waiting`).
  - Disparo de evento `pwa:update-ready` e aplicação suave de nova versão via `SKIP_WAITING` sem quebra de estado.
  - Captura do evento `beforeinstallprompt` para instalação 1-clique e tratamento do evento `appinstalled`.
  - Detecção segura de modo de execução standalone (`isStandalone`).
  - Monitoramento de eventos de rede (`online`/`offline`) com disparo de `NETWORK_STATUS_CHANGED` no `EventBus`.

#### Service Worker & Estratégias de Cache
- `sw.js` (`public/sw.js`) — Service Worker `v1.11.0` especializado para SPA Vite:
  - **Network First** para navegação HTML (`/`, `/index.html`) com fallback instantâneo para o cache em modo offline.
  - **Cache First** para assets compilados pelo Vite (`/assets/*`) com hash imutável.
  - **Cache First com Revalidação** para ícones de alta resolução e manifesto W3C.
  - **Stale While Revalidate** para demais recursos estáticos.
  - Limpeza segura de versões de cache obsoletas (`activate`) preservando integralmente o IndexedDB local.

#### UI & Experiência de Uso Offline
- **Indicador de Conectividade em Tempo Real**: Badge dinâmico no Header com estados `Online` (verde) e `Offline` (âmbar animado).
- **Notificação Não-Intrusiva de Rede**: Toast discreto ao transicionar para offline (*"Você está offline. Os dados locais continuam disponíveis."*) e ao retornar (*"Conexão restaurada."*).
- **Botão de Instalação no Sidebar**: Ação destacada "Instalar Aplicativo" quando o navegador suportar instalação PWA.
- **Painel de Status nas Configurações (`#/configuracoes`)**: Card informativo na aba de preferências exibindo Modo de Execução (App Instalado vs Navegador Web), Persistência IndexedDB e Conectividade.

#### Testes Automatizados
- 15 novos testes em `tests/pwa_phase11.test.js` cobrindo validação W3C do manifest, existência física de ícones, ciclo de vida do Service Worker, estratégias de rede, transições online/offline e prompt de instalação.
- **Total do Sistema: 149 testes automatizados, 0 falhas.**

---

## [1.10.0-phase10] — 2026-08-19

### Adicionado — Módulo de Relatórios e Impressão (FASE 10)

#### Serviço de Relatórios
- `ReportService.js` — Central de geração de 6 tipos de relatórios gerenciais a partir dos dados reais:
  - **Relatório de Vendas (Comercial / PDV)**: Faturamento, CMV, Lucro Bruto, Margem, Ticket Médio, filtros por período e método de pagamento.
  - **Relatório de Compras & Fornecedores**: Ordens de compra, total investido, itens recebidos, filtros por fornecedor.
  - **Relatório de Estoque & Inventário Físico (Balanço)**: Saldo, valorização a custo e preço de venda, lucro potencial, alertas de reposição.
  - **DRE Gerencial (Demonstrativo de Resultado)**: Estrutura formal com Receita Bruta, (-) CMV, (=) Lucro Bruto, Margem (%) e Markup (%).
  - **Curva ABC de Produtos** (por Faturamento Real) e **Curva ABC de Fornecedores** (por Volume de Compras).
  - **Movimentações de Estoque (Auditoria / Kardex)**: Histórico cronológico de entradas, saídas, ajustes e devoluções.
- **Exportação CSV com UTF-8 BOM** (`\uFEFF`): delimitador `;`, escape seguro de aspas e download com nome descritivo.
- **Impressão Direta & PDF (`@media print`)**: Template HTML A4 com cabeçalho corporativo integrado (dados da empresa da FASE 9), rodapé com data/hora e tabela profissional.

#### Páginas e UI
- **`ReportsPage` (`#/relatorios`)** (NOVA) — Central de Relatórios interativa com:
  - Seletor de 7 tipos de relatório por pills.
  - Filtros contextuais dinâmicos (período, categoria, método de pagamento).
  - Cards de KPI totalizadores por tipo de relatório.
  - Tabela de pré-visualização com scroll, striped rows e indicação de registros cancelados.
  - Botões de exportação CSV e Impressão/PDF.

#### Testes Automatizados
- 9 novos testes em `tests/reports_phase10.test.js` cobrindo todos os 6 tipos de relatórios, geração CSV com BOM e template de impressão.
- **Total do Sistema: 134 testes automatizados, 0 falhas.**

---

## [1.9.0-phase9] — 2026-08-19

### Adicionado — Módulo de Backup, Restauração e Configurações (FASE 9)

#### Serviços de Backup e Segurança
- `BackupService.js` — exportação e restauração transacional completa cobrindo todas as 10 stores do IndexedDB:
  - Envelope padronizado `gestaopro_backup` (versão 1.0) com metadados de contagem e datação ISO.
  - Conversão assíncrona de fotos e thumbnails `Blob` para Data URLs Base64 na exportação, e reconstrução fidedigna em `Blob` na importação.
  - Cálculo e validação de **Checksum Criptográfico SHA-256** determinístico (Web Crypto API) para detecção de corrupção e integridade de arquivo.
  - **Snapshot de Segurança Pré-Restauração** capturado em memória antes de qualquer modificação, com **Rollback Atômico** automático em caso de exceções.
  - **Recalibração Pós-Restauração**: recálculo determinístico de `Product.stockQuantity` (a partir de `stockMovements`) e `Product.totalSold` (a partir de `sales`).
  - **Limpeza de Dados Comerciais de Teste**: remove vendas, compras e movimentações zerando os saldos físicos e preservando produtos, fotos, fornecedores e configurações.
  - **Reset de Fábrica**: redefinição completa para o estado inicial com dupla confirmação (`CONFIRMAR`).

#### Páginas e UI
- **`SettingsPage` (`#/configuracoes`)** (NOVA) — Painel executivo de configurações dividido em 4 abas:
  - *Dados da Empresa*: Nome Fantasia, Razão Social, CNPJ/CPF, Telefone, Email e Endereço.
  - *Preferências Operacionais*: Permissão de Estoque Negativo (`allowNegativeStock`) e alertas de estoque baixo.
  - *Backup & Restauração*: Download de backup `.json` com barra de progresso, e upload com modal de inspeção de metadados e validação prévia de checksum.
  - *Manutenção & Limpeza*: Botões de limpeza de dados transacionais e reset de fábrica.

#### Testes Automatizados
- 10 novos testes automatizados em `tests/backup_settings_phase9.test.js` cobrindo exportação, reconstrução de Blobs, validação SHA-256, rejeição de arquivos corrompidos, restauração, rollback, limpeza de dados e persistência de configurações.
- **Total do Sistema: 125 testes automatizados, 0 falhas.**

---

## [1.8.0-phase8] — 2026-08-19

### Adicionado — Módulo de Dashboard e Análises (FASE 8)

#### Domínio e Serviços Analíticos
- `AnalyticsService.js` — camada analítica de agregação em passagem única $O(N)$ baseada exclusivamente em dados reais das stores:
  - Faturamento real a partir de `Sale.totalSaleCents` com respeito estrito aos filtros de período.
  - Snapshot imutável de custos e lucro histórico (`Sale.profitCents` e `Sale.unitCostCents`).
  - **CMV (Custo das Mercadorias Vendidas)**: soma dos custos unitários históricos imutáveis das vendas reais.
  - **Lucro Bruto**, **Margem Bruta Geral** e **Markup Geral** com tratamento seguro para faturamento zero e lucro negativo.
  - **Valorização do Estoque**: Valor a Custo (custo de referência atual) vs Valor a Preço de Venda (potencial de faturamento).
  - **Giro de Estoque (Turnover)**: taxa de giro e ciclo médio estimado em dias.
  - **Curva ABC de Produtos**: classificação por Princípio de Pareto (A: até 80%, B: 80%-95%, C: >95%) baseada no faturamento real no período.
  - **Curva ABC de Fornecedores**: classificação baseada no volume financeiro de compras reais efetivamente concluídas.
  - **Velocidade de Vendas (Run Rate)**: média diária de unidades vendidas por dia, cobertura estimada de estoque em dias e identificação de Produtos Parados (capital imobilizado).
  - **Desempenho por Categoria**: faturamento, CMV, margem, unidades vendidas e estoque físico por linha.
  - **Séries Temporais**: geração contínua de pontos diários para plotagem de gráficos com datas no fuso horário local.

#### Páginas e UI
- **`DashboardPage` (`#/dashboard`)** (NOVA) — Painel executivo profissional:
  - Pílulas de filtro rápido de período (`Hoje`, `7 dias`, `30 dias`, `90 dias`, `12 meses`, `Personalizado` com inputs `date`).
  - 6 Cards principais de KPIs (Faturamento, Lucro Bruto com margem %, CMV com markup %, Valor do Estoque a Custo com potencial a venda, Compras Realizadas, Giro de Estoque).
  - 5 Abas analíticas interativas (Visão Geral & Gráficos, Curva ABC de Produtos, Velocidade & Produtos Parados, Análise de Fornecedores, Desempenho por Categoria).
  - Gráficos SVG nativos responsivos: Evolução Temporal com gradiente suave (Faturamento x Lucro x Compras) e barras/donuts de categoria.
  - Reatividade em tempo real escutando eventos do `EventBus` (`SALE_CREATED`, `PURCHASE_CREATED`, `STOCK_CHANGED`, `PRODUCT_UPDATED`).

#### Testes Automatizados
- 13 novos testes automatizados em `tests/analytics_phase8.test.js` cobrindo todas as fórmulas, limites da Curva ABC, CMV, velocidade de vendas, filtros temporais e integração com IndexedDB.
- **Total do Sistema: 115 testes automatizados, 0 falhas.**

---

## [1.7.0-phase7] — 2026-08-19

### Adicionado — Módulo de Cotações de Fornecedores por Produto (FASE 7)

#### Domínio e Validações
- `QuotationValidator.js` — validações de cotação: produto e fornecedor obrigatórios, `unitCostCents` não-negativo (aceita zero para orçamentos em aberto), `minimumOrderQty` e `leadTimeDays` não-negativos, e validação temporal (`validUntil >= quoteDate`, detecção de cotações vencidas).

#### Repositórios e Serviços
- `ProductSupplierRepository.js` — CRUD na store `productSuppliers`, índices por produto, fornecedor e data de cotação.
- `QuotationService.js` — orquestração de cotações por produto:
  - Limite estrito de até 3 fornecedores cotados ativos (`isActive = true`) por produto.
  - Bloqueio de duplicidade de cotação ativa para o mesmo fornecedor no mesmo produto.
  - Identificação e marcação automática da cotação com menor preço (`isCheapest`).
  - Gestão de Fornecedor Preferido (`isPreferred`) independente de preço (critério operacional).
  - Versionamento de histórico com desativação e preservação de cotações anteriores.
  - `prepareForPurchase()` — preparação de dados com vínculo de fornecedor e custo unitário para disparo de Ordens de Compra.
  - Histórico consolidado por produto e por fornecedor.

#### Páginas e UI
- **`QuotationsPage` (`#/cotacoes`)** (NOVA) — tela interativa de cotações:
  - Seletor rápido de produtos com dropdown inteligente.
  - Grid de comparação de até 3 cards de fornecedores ativos lado a lado com destaques visuais (Menor Preço, Fornecedor Preferido, Prazo de Entrega, Condições de Pagamento, Pedido Mínimo).
  - Botão de ação rápida "Comprar" disparando diretamente o fluxo de Ordem de Compra.
  - Modal de Cadastro e Edição de Cotação com validações e recálculo em tempo real.
  - Painel colapsável de Histórico Completo de cotações anteriores do produto.
- **`ProductDetailPage`** — painel integrado "Fornecedores Cotados (FASE 7)" com badges de melhor preço e preferido, e link direto para gerenciamento.
- **`app.js` & `router.js`** — navegação integrada para `#/cotacoes` com badge `FASE 7`.

#### Testes Automatizados
- 22 novos testes em `tests/quotations_phase7.test.js` cobrindo todas as regras de negócio e validações de cotações.
- **Total do Sistema: 102 testes automatizados, 0 falhas.**

---

## [1.6.0-phase6] — 2026-08-19

### Adicionado — Módulo de Fornecedores, Compras e Entrada de Estoque (FASE 6)

#### Domínio e Validações
- `SupplierValidator.js` — validação de domínio para fornecedores: Razão Social/Nome Fantasia obrigatório (2 a 255 caracteres), validação de formato de email e validação de quantidade de dígitos para CPF (11 dígitos) e CNPJ (14 dígitos).
- `PurchaseValidator.js` — validação de domínio para ordens de compra: produto obrigatório, fornecedor obrigatório, quantidade inteira estritamente positiva (`quantity > 0`), custos unitários em centavos não-negativos.

#### Serviços e Lógica Transacional
- `SupplierService.js` — CRUD completo de fornecedores com verificação de unicidade de documento (CNPJ/CPF), soft delete e consolidação de histórico/total investido por fornecedor.
- `PurchaseService.js` — orquestração de ordens de compra com atomicidade multi-store estrita (`executeTransaction(['purchases', 'stockMovements', 'products', 'suppliers'])`):
  - Gravação de ordem de compra com vinculação de fornecedor e produto.
  - Abastecimento automático de estoque gerando movimentação `StockMovement` do tipo `PURCHASE` (`delta: +quantity`, `referenceId: purchaseId`, `unitCostCents`).
  - Atualização síncrona do saldo `Product.stockQuantity`.
  - Opção de atualizar automaticamente o preço de compra de referência do catálogo (`Product.purchasePriceCents`).
  - `cancelPurchase()` — cancelamento/estorno transacional de ordens de compra com geração de movimento `OUT`, validação de estoque negativo (quando `allowNegativeStock = false`) e dedução síncrona de saldo.
  - `getPurchasesOverview()` — consolidação de KPIs de compras (Total Investido, Total de Pedidos, Total de Itens Adquiridos, Ticket Médio).
  - `getPurchasesByProduct()` e `getPurchasesBySupplier()` — consultas detalhadas por entidade.

#### Repositórios
- `SupplierRepository.js` — busca textual, filtros por status (ativo/inativo) e busca por CNPJ/CPF com exclusão de ID próprio.
- `PurchaseRepository.js` — ordenação temporal decrescente, busca textual (fornecedor, produto, nota fiscal), filtros por período, produto e fornecedor.

#### Páginas e UI
- **`SuppliersPage` (`#/fornecedores`)** (NOVA) — tela de gerenciamento de fornecedores com:
  - Tabela com dados cadastrais, CNPJ/CPF, contatos e total investido.
  - Modal de Cadastro e Edição com validações em tempo real.
  - Modal de Histórico de Compras com resumo financeiro e timeline de pedidos por fornecedor.
- **`PurchasesPage` (`#/compras`)** (NOVA) — tela de ordens de compra com:
  - Top Bar de KPIs: Total Investido em Compras, Ordens de Compra, Itens Adquiridos e Média por Pedido.
  - Filtros rápidos por período (Todas, Hoje, 7 dias, Este Mês) e busca textual por produto, fornecedor ou nota fiscal.
  - **Modal Nova Ordem de Compra**: seleção de fornecedor e produto com saldo atual, stepper de quantidade, custo unitário editável com conversão automática, checkbox de atualização de custo do catálogo, número de nota fiscal e resumo visual de impacto no estoque.
  - **Modal de Comprovante de Compra**: recibo detalhado com identificadores e botão de impressão (`window.print()`).
  - **Estorno de Compra**: cancelamento com dedução imediata de mercadorias no estoque.
- **`ProductDetailPage`** — atualizada com cards de desempenho de compras (unidades adquiridas e total investido) e escuta aos eventos de compra.
- **`app.js` & `router.js`** — itens **Ordens de Compra** (`#/compras`) e **Fornecedores** (`#/fornecedores`) integrados na barra lateral com badge `FASE 6`, rotas ativas e Dashboard ERP comercial completo.

#### Testes Automatizados
- 12 novos testes automatizados em `tests/purchases_suppliers_phase6.test.js` cobrindo:
  - SupplierValidator (4 testes)
  - SupplierService CRUD e unicidade de CNPJ/CPF (2 testes)
  - PurchaseValidator (2 testes)
  - PurchaseService: transação atômica multi-store com entrada no estoque e atualização de custo
  - PurchaseService: estorno/cancelamento de compra e dedução de estoque
  - PurchaseService: bloqueio de estorno que deixaria estoque negativo (`allowNegativeStock: false`)
  - PurchaseService: consolidação de métricas (`getPurchasesOverview`)
- **Total: 80 testes, 0 falhas** em 7 arquivos.

---

## [1.5.0-phase5] — 2026-08-19

### Adicionado — Módulo de Vendas e Registro Comercial (FASE 5)
- `SaleValidator.js`, `SaleService.js`, `SaleRepository.js`, `SalesPage.js`.
- Total: 68 testes automatizados.

---

## [1.4.0-phase4] — 2026-08-19

### Adicionado — Módulo de Movimentação e Gestão de Estoque (FASE 4)
- `StockValidator.js`, `StockService.js`, `StockMovementRepository.js`, `StockPage.js`.
- Total: 58 testes automatizados.

---

## [1.3.0-phase3] — 2026-08-18

### Adicionado — Módulo de Produtos (FASE 3)
- `ProductValidator.js`, `ProductService.js`, `ImageService.js`, `ProductsPage.js`, `ProductFormPage.js`, `ProductDetailPage.js`.
- Total: 45 testes automatizados.

---

## [1.1.0-phase2] — 2026-08-18

### Adicionado — Infraestrutura de Persistência
- IndexedDB via `idb`, migrations v1, transações atômicas com rollback, BaseRepository, EventBus.

---

## [1.0.0-phase1] — 2026-08-18

### Adicionado — Fundação do Sistema
- Bun + Vite + Tailwind CSS v4, roteamento hash e layout base.
