# Plano de Testes — GestãoPro

## Níveis de Teste

### 1. Testes Automatizados (Bun Test)

Executar com: `bun test`

#### Infraestrutura / Banco de Dados (`tests/db.test.js`)
| Cenário | Status |
|---------|--------|
| Inicializar banco e aplicar schema (migrations v1) | ✅ PASS |
| CRUD básico no ProductRepository | ✅ PASS |
| Transação multi-store com sucesso (atomicidade) | ✅ PASS |
| Rollback em falha de transação multi-store | ✅ PASS |

#### Domain Services (`tests/domain.test.js`)
| Cenário | Status |
|---------|--------|
| MoneyService: conversões, centavos e formatação | ✅ PASS (11 testes) |
| MarginService: lucro, margem, markup e cálculos reversos | ✅ PASS (8 testes) |

#### FASE 3 - Módulo de Produtos (`tests/products.test.js` & `tests/products_phase3.test.js`)
| Cenário | Status |
|---------|--------|
| ProductValidator: validações de campos, limites e códigos | ✅ PASS (4 testes) |
| ProductService: CRUD, imagens, soft delete e eventos | ✅ PASS (18 testes) |

#### FASE 4 - Módulo de Estoque (`tests/stock_phase4.test.js`)
| Cenário | Status |
|---------|--------|
| StockValidator: validações de entradas, saídas e justificativas | ✅ PASS (5 testes) |
| StockService: atomicidade, bloqueio negativo, balanço e auditoria | ✅ PASS (8 testes) |

#### FASE 5 - Módulo de Vendas (`tests/sales_phase5.test.js`)
| Cenário | Status |
|---------|--------|
| SaleValidator: validações de dados de venda e pagamentos | ✅ PASS (4 testes) |
| SaleService: transações multi-store, snapshot imutável, estorno | ✅ PASS (6 testes) |

#### FASE 6 - Módulo de Fornecedores e Compras (`tests/purchases_suppliers_phase6.test.js`)
| Cenário | Status |
|---------|--------|
| SupplierValidator: validações de nome, documento (CNPJ/CPF) e contato | ✅ PASS (4 testes) |
| SupplierService: CRUD completo e unicidade de documento | ✅ PASS (2 testes) |
| PurchaseValidator: validações de produto, fornecedor e quantidade | ✅ PASS (2 testes) |
| PurchaseService: ordem de compra com entrada atômica no estoque | ✅ PASS |
| PurchaseService: atualização do preço de compra de referência | ✅ PASS |
| PurchaseService: estorno/cancelamento de compra e dedução no estoque | ✅ PASS |
| PurchaseService: bloqueio de estorno com estoque insuficiente | ✅ PASS |
| PurchaseService: consolidação de métricas em `getPurchasesOverview` | ✅ PASS |

#### FASE 7 - Módulo de Cotações por Produto (`tests/quotations_phase7.test.js`)
| Cenário | Status |
|---------|--------|
| QuotationValidator: validações de produto, fornecedor, custo, prazo e datas | ✅ PASS (9 testes) |
| QuotationService: criação e bloqueio de 4º fornecedor ativo (máximo 3) | ✅ PASS (2 testes) |
| QuotationService: bloqueio de duplicidade de fornecedor no mesmo produto | ✅ PASS (1 teste) |
| QuotationService: cálculo automático do menor preço (`isCheapest`) | ✅ PASS (1 teste) |
| QuotationService: definição e independência do fornecedor preferido (`isPreferred`) | ✅ PASS (2 testes) |
| QuotationService: versionamento histórico e desativação de cotações | ✅ PASS (2 testes) |
| QuotationService: tratamento e descarte de cotações vencidas | ✅ PASS (1 teste) |
| QuotationService: liberação de slot após desativação de cotação | ✅ PASS (1 teste) |
| QuotationService: pré-preenchimento e conversão em compra (`prepareForPurchase`) | ✅ PASS (1 teste) |
| QuotationService: múltiplos produtos e histórico por fornecedor | ✅ PASS (2 testes) |

#### FASE 8 - Módulo de Dashboard e Análises (`tests/analytics_phase8.test.js`)
| Cenário | Status |
|---------|--------|
| AnalyticsService: Faturamento, CMV, Lucro Bruto, Margem e Markup a partir de vendas reais | ✅ PASS (1 teste) |
| AnalyticsService: Tratamento seguro de faturamento zero e divisão por zero | ✅ PASS (1 teste) |
| AnalyticsService: Suporte a operações com lucro negativo (prejuízo) | ✅ PASS (1 teste) |
| AnalyticsService: Valorização do estoque (custo e venda) e Giro de Estoque (Turnover) | ✅ PASS (2 testes) |
| AnalyticsService: Curva ABC de Produtos por Pareto (80/15/5) e caso sem vendas | ✅ PASS (2 testes) |
| AnalyticsService: Velocidade de Venda (Run Rate), cobertura e identificação de Produtos Parados | ✅ PASS (1 teste) |
| AnalyticsService: Análise de Fornecedores por compras reais e Curva ABC | ✅ PASS (1 teste) |
| AnalyticsService: Desempenho e agrupamento por Categoria com margem e share % | ✅ PASS (1 teste) |
| AnalyticsService: Filtros de período temporal (Hoje, 7d, 30d, 90d, 12m, Custom) | ✅ PASS (1 teste) |
| AnalyticsService: Geração de série temporal diária para gráficos SVG | ✅ PASS (1 teste) |
| AnalyticsService: Integração com IndexedDB real em `getDashboardAnalytics` | ✅ PASS (1 teste) |

#### FASE 9 - Módulo de Backup, Restauração e Configurações (`tests/backup_settings_phase9.test.js`)
| Cenário | Status |
|---------|--------|
| BackupService: Exportação completa de todas as 10 stores e serialização de Blobs | ✅ PASS (1 teste) |
| BackupService: Validação de backup íntegro e metadados | ✅ PASS (1 teste) |
| BackupService: Rejeição de formato de backup incompatível | ✅ PASS (1 teste) |
| BackupService: Rejeição de arquivo corrompido com checksum SHA-256 divergente | ✅ PASS (1 teste) |
| BackupService: Rejeição de backup com schemaVersion superior/incompatível | ✅ PASS (1 teste) |
| BackupService: Restauração completa de entidades e conversão Base64 -> Blob | ✅ PASS (1 teste) |
| BackupService: Recálculo e consistência de saldos de estoque e total vendido | ✅ PASS (1 teste) |
| BackupService: Limpeza de dados de teste mantendo o catálogo e zerando estoque | ✅ PASS (1 teste) |
| BackupService: Factory Reset restaurando configurações de fábrica | ✅ PASS (1 teste) |
| SettingsRepository: Persistência de dados cadastrais da empresa e opções operacionais | ✅ PASS (1 teste) |

#### FASE 10 - Módulo de Relatórios e Impressão (`tests/reports_phase10.test.js`)
| Cenário | Status |
|---------|--------|
| ReportService: Relatório de Vendas (Comercial / PDV) com receita, CMV, lucro e margem | ✅ PASS (1 teste) |
| ReportService: Relatório de Compras e Fornecedores com total gasto e ordens ativas | ✅ PASS (1 teste) |
| ReportService: Relatório de Posição de Estoque & Inventário com valorização custo/venda | ✅ PASS (1 teste) |
| ReportService: DRE Gerencial formal com Receita, CMV e Resultado Bruto | ✅ PASS (1 teste) |
| ReportService: Curva ABC de Produtos (Pareto A, B, C por faturamento) | ✅ PASS (1 teste) |
| ReportService: Curva ABC de Fornecedores por volume de compras | ✅ PASS (1 teste) |
| ReportService: Kardex / Auditoria cronológica de movimentações de estoque | ✅ PASS (1 teste) |
| ReportService: Exportação CSV com delimitador `;`, UTF-8 BOM e escape | ✅ PASS (1 teste) |
| ReportService: Template HTML formal de impressão A4 com dados da empresa | ✅ PASS (1 teste) |

#### FASE 11 - PWA & Resiliência Offline (`tests/pwa_phase11.test.js`)
| Cenário | Status |
|---------|--------|
| Manifest W3C: estrutura do arquivo `manifest.json` com standalone, scope e tema | ✅ PASS (1 teste) |
| Manifest W3C: existência física e validação de ícones (96, 144, 192, 512, apple-touch) | ✅ PASS (1 teste) |
| Manifest W3C: atalhos rápidos de navegação (Dashboard, PDV, Estoque) | ✅ PASS (1 teste) |
| Service Worker: versionamento explícito (`gestaopro-v1.11.0`) e pré-cache do App Shell | ✅ PASS (1 teste) |
| Service Worker: eventos de ciclo de vida (install, activate, fetch, message) | ✅ PASS (1 teste) |
| Service Worker: limpeza segura de versões anteriores de cache sem tocar no IndexedDB | ✅ PASS (1 teste) |
| Service Worker: estratégias de rede (Network First HTML, Cache First Assets Vite) | ✅ PASS (1 teste) |
| PWAHandler: inicialização padrão e monitoramento de rede | ✅ PASS (1 teste) |
| PWAHandler: transição para modo offline com mensagem e evento padronizado | ✅ PASS (1 teste) |
| PWAHandler: transição de reconexão online com evento padronizado | ✅ PASS (1 teste) |
| PWAHandler: notificação e aplicação de atualização de Service Worker (`SKIP_WAITING`) | ✅ PASS (2 testes) |
| PWAHandler: prompt de instalação customizado (`beforeinstallprompt`) e modo standalone | ✅ PASS (3 testes) |

#### FASE 12 - Tauri Desktop, Adapters & Multi-Plataforma (`tests/platform_phase12.test.js`)
| Cenário | Status |
|---------|--------|
| WebAdapter: detecção de ambiente web, tipo 'web' e resolução de Blob | ✅ PASS (1 teste) |
| TauriAdapter: detecção de ambiente Tauri, fallbacks e resolução de Blob | ✅ PASS (1 teste) |
| Platform Facade: detecção consistente e metadados de execução (`isDesktop`, `isPWA`, `isWeb`) | ✅ PASS (1 teste) |
| Tauri v2: validação da estrutura `tauri.conf.json` (identificador, versão, frontendDist, bundle) | ✅ PASS (1 teste) |
| Tauri v2: validação do manifesto `Cargo.toml` com crate gestaopro | ✅ PASS (1 teste) |
| Tauri v2: validação de capabilities com princípio do menor privilégio (`core:default`) | ✅ PASS (1 teste) |
| Tauri v2: existência de arquivos Rust nativos (`build.rs`, `main.rs`, `lib.rs`) | ✅ PASS (1 teste) |
| Tauri v2: integridade de ícones desktop em `src-tauri/icons/` | ✅ PASS (1 teste) |
| Scripts do Projeto: scripts `tauri`, `tauri:dev` e `tauri:build` no `package.json` | ✅ PASS (1 teste) |
#### FASE 13 - Firebase & Sync Engine (`tests/sync_phase13.test.js`)
| Cenário | Status |
|---------|--------|
| CloudProvider: interface base abstrata com lançamento de erro | ✅ PASS (1 teste) |
| MockCloudProvider: simulação completa de push, pull e falha de rede | ✅ PASS (1 teste) |
| FirebaseProvider: conversão bidirecional de tipos do Firestore REST API | ✅ PASS (1 teste) |
| SyncRepository: enfileiramento padrão com status PENDING e attempts 0 | ✅ PASS (1 teste) |
| SyncRepository: coalescência de UPDATE sobre CREATE não sincronizado | ✅ PASS (1 teste) |
| SyncRepository: eliminação de DELETE sobre CREATE não sincronizado | ✅ PASS (1 teste) |
| SyncRepository: confirmação de sincronismo e limpeza de concluídos | ✅ PASS (1 teste) |
| SyncRepository: transição para FAILED após maxAttempts e reprocessamento | ✅ PASS (1 teste) |
| SyncRepository: consolidação de métricas e estatísticas | ✅ PASS (1 teste) |
| SyncEngine: processamento da fila com MockCloudProvider | ✅ PASS (1 teste) |
| SyncEngine: escuta reativa de eventos de mutação do EventBus | ✅ PASS (1 teste) |
| SyncEngine: resolução determinística de conflitos Last Write Wins (LWW) | ✅ PASS (1 teste) |

**Total Atual: 171 testes automatizados, 0 falhas.**

---

### 2. Testes Manuais no Navegador & Desktop

Executar em http://localhost:3000/ e via `cargo tauri dev`

#### TC-DSK-001 — Execução Desktop e Multiplataforma (FASE 12)
- [ ] Executar `cargo tauri dev` e verificar a abertura da janela nativa desktop (1280x820 centralizada).
- [ ] Verificar a renderização do título da janela: "GestãoPro — Gestão Comercial e Estoque".
- [ ] Acessar `#/configuracoes` e confirmar que o card de status identifica "Desktop (Windows Tauri)" e "IndexedDB Persistente".
- [ ] Cadastrar um novo produto com imagem no modo Desktop e verificar a persistência.
- [ ] Realizar uma venda no PDV e conferir o estorno e movimentação de estoque.
- [ ] Executar a aplicação paralelamente no navegador web (`http://localhost:3000`) e confirmar que o modo web permanece 100% funcional.
- [ ] Executar `cargo tauri build` e verificar a geração do binário release e instaladores.

#### TC-PWA-001 — PWA, Instalação e Funcionamento Offline (FASE 11)
- [ ] Acessar a aplicação online e verificar o badge verde "Online" no topo do Header.
- [ ] Verificar se o botão "Instalar Aplicativo" é exibido na Sidebar quando o navegador suportar `beforeinstallprompt`.
- [ ] Clicar em "Instalar Aplicativo" e concluir a instalação standalone.
- [ ] Desligar a conexão de internet (ou simular Offline no DevTools Network).
- [ ] Verificar a alteração imediata do badge para "Offline" e a exibição do toast não-intrusivo ("Você está offline. Os dados locais continuam disponíveis.").
- [ ] Recarregar a página completamente offline (F5) e confirmar que a aplicação abre com o App Shell em cache.
- [ ] Navegar entre Produtos, Estoque, Vendas, Compras, Dashboard e Relatórios offline.
- [ ] Criar um novo produto e realizar uma venda no PDV offline, confirmando que o IndexedDB persiste todos os dados normalmente.
- [ ] Restaurar a conexão de internet e verificar o feedback ("Conexão restaurada.") com o retorno do badge "Online" sem perda de dados locais.

Executar em http://localhost:3000/

#### TC-001 — Configurações e Backup (FASE 9)
- [ ] Acessar `#/configuracoes` e preencher os dados cadastrais da empresa (Nome Fantasia, CNPJ, Telefone, Endereço).
- [ ] Salvar e recarregar a página para confirmar a persistência dos dados.
- [ ] Alterar a opção "Permitir estoque negativo" e salvar.
- [ ] Clicar em "Baixar Arquivo de Backup" e verificar o download do `.json`.
- [ ] Testar restauração selecionando o arquivo `.json` baixado, inspecionar metadados e confirmar restauração.
- [ ] Testar botão de "Limpar Apenas Vendas e Movimentações" confirmando que o catálogo permanece intacto.
- [ ] Testar modal de "Reset de Fábrica" com digitação da palavra `CONFIRMAR`.


#### TC-001 — Dashboard e Indicadores Gerais (FASE 8)
- [ ] Acessar `#/dashboard` e verificar os 6 cards de KPIs (Faturamento, Lucro Bruto, CMV, Estoque, Compras, Giro).
- [ ] Alternar filtros de período (`Hoje`, `7 dias`, `30 dias`, `90 dias`, `12 meses`, `Personalizado`).
- [ ] Verificar atualização dos valores monetários formatados em BRL e gráficos SVG.
- [ ] Acessar a aba "Curva ABC de Produtos" e conferir a distribuição das Classes A, B e C.
- [ ] Acessar a aba "Velocidade & Produtos Parados" e checar o capital imobilizado.
- [ ] Acessar a aba "Análise de Fornecedores" e "Desempenho por Categoria".
- [ ] Registrar uma nova venda no PDV e retornar ao Dashboard verificando a atualização reativa em tempo real.


#### TC-001 — Cadastro de Fornecedor
- [ ] Acessar `#/fornecedores` e clicar em "+ Novo Fornecedor".
- [ ] Preencher Razão Social, CNPJ, Email, Telefone e Pessoa de Contato.
- [ ] Confirmar cadastro e verificar aparição na tabela de fornecedores.
- [ ] Clicar no botão de edição e alterar a pessoa de contato.

#### TC-002 — Ordem de Compra e Entrada de Estoque
- [ ] Acessar `#/compras` e clicar em "+ Nova Ordem de Compra".
- [ ] Selecionar o fornecedor cadastrado e o produto a abastecer.
- [ ] Informar quantidade 20, custo unitário R$ 150,00 e número da Nota Fiscal.
- [ ] Marcar "Atualizar preço de custo no catálogo" e confirmar a compra.
- [ ] Verificar emissão do comprovante de compra.
- [ ] Acessar `#/estoque` e confirmar que o saldo do produto aumentou em 20 unidades.
- [ ] Acessar `#/fornecedores` e abrir o histórico de compras do fornecedor.

#### TC-003 — Cotações de Fornecedores por Produto (FASE 7)
- [ ] Acessar `#/cotacoes` e selecionar um produto no dropdown.
- [ ] Cadastrar até 3 cotações de fornecedores distintos com prazos e preços variados.
- [ ] Verificar destaque automático em verde no fornecedor com menor preço (`MELHOR PREÇO`).
- [ ] Definir um fornecedor como "Preferido" e verificar badge dourada independente.
- [ ] Tentar cadastrar um 4º fornecedor e verificar bloqueio visual e validação de limite.
- [ ] Clicar em "Comprar" a partir de uma cotação e verificar redirecionamento para `#/compras` com dados preenchidos.
- [ ] Acessar `#/produtos/detalhes/:id` do produto e verificar painel com as cotações ativas.

#### TC-004 — Estorno de Compra
- [ ] Na tela `#/compras`, clicar em estornar a compra realizada.
- [ ] Informar justificativa e confirmar.
- [ ] Verificar que o estoque foi deduzido em `#/estoque`.

