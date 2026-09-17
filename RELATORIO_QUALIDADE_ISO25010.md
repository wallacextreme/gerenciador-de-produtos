# Relatório de Qualidade de Software — ISO/IEC 25010:2023 — GestãoPro

Data da avaliação: **17/09/2026**  
Versão do sistema avaliada: **1.13.0** (Comprovada em `package.json`, `Cargo.toml`, `tauri.conf.json` e binários compilados)  
Norma de Referência: **ISO/IEC 25010:2023** (*Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Product quality model*)  
Delimitação Normativa: O modelo de **Qualidade em Uso** (*Quality-in-Use Model*) é regido pela norma autônoma **ISO/IEC 25019:2023** e encontra-se formalmente delimitado fora do escopo desta auditoria técnica de repositório.

---

## 1. Objetivo e Metodologia

### 1.1. Finalidade
Este documento apresenta a auditoria técnica de qualidade do software **GestãoPro**, conduzida a partir da inspeção minuciosa e orientada a evidências dos artefatos contidos no repositório do projeto. O propósito é aferir a aderência arquitetural, funcional e operacional da aplicação em face das 9 características de qualidade de produto estipuladas pela revisão vigente **ISO/IEC 25010:2023**.

### 1.2. Metodologia de Avaliação
A avaliação empregou métodos combinados de auditoria técnica:
1. **Inspeção Estática de Código e Configuração (E1)**: Análise direta do código-fonte em JavaScript (ES Modules), Rust (backend Tauri v2), CSS (Tailwind v4), HTML, manifestos de configuração e especificações de esquemas de banco de dados.
2. **Execução de Testes Automatizados (E2)**: Execução real da suíte de testes unitários, de integração e de domínio do projeto utilizando o runner nativo do Bun (`bun test`), com registro auditável de tempos de execução, sucessos e falhas.
3. **Verificação de Build e Empacotamento (E3)**: Execução de compilação de produção (`bun run build`) e inspeção de artefatos de release gerados fisicamente no repositório (`.exe` e `.msi` gerados via NSIS e WiX Toolset).
4. **Análise Histórica e Documental (E4)**: Inspeção da árvore do Git, commits, `task.md` e histórico de evolução funcional em `docs/CHANGELOG.md`.

### 1.3. Sistema de Níveis de Evidência
Para assegurar a rastreabilidade e evitar inferências infundadas, cada constatação deste relatório é associada a um nível de evidência formal:
- **E1 — Evidência Estática**: Comprovada diretamente por código-fonte, configuração ou estrutura do repositório.
- **E2 — Evidência Executada**: Comprovada por execução real de testes e comandos automatizados em tempo de auditoria.
- **E3 — Evidência de Build/Empacotamento**: Comprovada por geração real do bundle e presença de binários executáveis.
- **E4 — Evidência Histórica/Documental**: Comprovada por histórico Git, registros de mudanças e documentação técnica.
- **NE — Não Evidenciado**: Não foram identificadas evidências suficientes nos arquivos do repositório.

### 1.4. Critérios de Classificação de Status
- 🟢 **Demonstrado no repositório**: Evidência clara, rastreável e consistente com o requisito.
- 🟡 **Parcialmente demonstrado**: Mecanismo implementado ou testado, mas com lacunas técnicas, restrições pontuais ou cobertura incompleta.
- 🔴 **Não demonstrado**: Ausência de implementação ou falha impeditiva identificada.
- ⚪ **Não aplicável**: Característica cujo escopo não se aplica ao domínio operacional do produto, acompanhada de justificativa técnica formal.

---

## 2. Escopo e Delimitação Normativa

Esta avaliação incide estritamente sobre o **Product Quality Model (ISO/IEC 25010:2023)**, o qual avalia as propriedades intrínsecas do software quando entregue ou executado.

> [!NOTE]
> **Delimitação ISO/IEC 25010:2023 vs. ISO/IEC 25019:2023:**  
> A revisão das normas internacionais do comitê ISO/IEC JTC 1/SC 7 desmembrou a antiga norma de 2011 em modelos independentes:
> - **ISO/IEC 25010:2023**: Modelo de Qualidade de Produto de Software (*Product Quality Model* — 9 características técnicas avaliadas neste relatório).
> - **ISO/IEC 25019:2023**: Modelo de Qualidade em Uso (*Quality-in-Use Model* — eficácia, eficiência, satisfação, ausência de risco e cobertura de contexto percebidas pelo usuário final em ambiente real de produção).
> 
> A Qualidade em Uso depende de pesquisa com usuários reais, métricas de ergonomia no trabalho e estudos de campo após implantação contínua. Portanto, está expressamente fora do escopo deste relatório e é indicada como etapa futura de homologação.

---

## 3. Inventário de Evidências Auditadas

A tabela a seguir consolida as evidências técnicas centrais utilizadas para fundamentar o relatório:

| ID | Evidência Identificada | Tipo | Arquivo / Origem no Repositório |
| :--- | :--- | :---: | :--- |
| **EV-001** | Manifesto do projeto com dependências (`vite 8.2`, `idb 8.0`, `tailwindcss 4.3`) | E1 | [`package.json`](package.json) |
| **EV-002** | Configuração do runtime nativo Tauri v2, identificador `com.gestaopro.app`, janelas e ausência de CSP (`security.csp: null`) | E1 | [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) |
| **EV-003** | Configuração do crate Rust `gestaopro v1.13.0` | E1 | [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) |
| **EV-004** | Permissões granulares de IPC do Tauri com menor privilégio (`core:default`) | E1 | [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json) |
| **EV-005** | Service Worker PWA com estratégias de cache (Network-First para navegação e Cache-First para assets com hash) | E1 | [`public/sw.js`](public/sw.js) |
| **EV-006** | W3C Web App Manifest com modo `standalone`, categorias e atalhos | E1 | [`public/manifest.json`](public/manifest.json) |
| **EV-007** | Definição de esquema versionado do IndexedDB com 10 object stores e índices | E1 | [`src/js/db/migrations.js`](src/js/db/migrations.js) |
| **EV-008** | Gerenciador de transações atômicas multi-store com abort/rollback automático | E1 | [`src/js/db/transactions.js`](src/js/db/transactions.js) |
| **EV-009** | Regras de domínio e validações estritas de centavos, margens, markup e produtos | E1 | [`src/js/domain/MoneyService.js`](src/js/domain/MoneyService.js), [`src/js/domain/MarginService.js`](src/js/domain/MarginService.js), [`src/js/validators/`](src/js/validators/) |
| **EV-010** | Camada de abstração de plataforma (Ports & Adapters) Desktop vs Web | E1 | [`src/js/platform/platform.js`](src/js/platform/platform.js), [`webAdapter.js`](src/js/platform/webAdapter.js), [`tauriAdapter.js`](src/js/platform/tauriAdapter.js) |
| **EV-011** | Motor de Sincronização Outbox e Provedores desacoplados (Firebase REST API e Mock) | E1 | [`src/js/services/SyncEngine.js`](src/js/services/SyncEngine.js), [`src/js/sync/`](src/js/sync/) |
| **EV-012** | Rotinas de Backup em JSON com cálculo de hash SHA-256 (Web Crypto) e restauração transacional | E1 | [`src/js/services/BackupService.js`](src/js/services/BackupService.js) |
| **EV-013** | Execução real de testes automatizados via `bun test` em 17/09/2026: 171 testes, 168 aprovados, 3 falhas | E2 | [`tests/`](tests/) |
| **EV-014** | Execução real do build de produção via `bun run build`: 29 assets gerados em 1.52s sem erros | E3 | Diretório `dist/` |
| **EV-015** | Presença física de instaladores Windows compilados (`.exe` de 2.32 MB e `.msi` de 3.32 MB) em `src-tauri/target/release/bundle/` (sem validação dinâmica de instalação) | E3 | [`src-tauri/target/release/bundle/nsis/`](src-tauri/target/release/bundle/nsis/), [`bundle/msi/`](src-tauri/target/release/bundle/msi/) |
| **EV-016** | Histórico cronológico de desenvolvimento modular em 13 fases | E4 | [`docs/CHANGELOG.md`](docs/CHANGELOG.md), [`task.md`](task.md) |
| **EV-017** | Ausência de automação de integração contínua (CI/CD) no repositório | NE | Diretório `.github/` inexistente no projeto |
| **EV-018** | Ausência de ferramenta de linter estático formal configurada | NE | Sem ESLint, Biome ou Prettier em `package.json` |

---

## 4. Resumo Executivo (Scorecard ISO/IEC 25010:2023)

A tabela abaixo resume a situação de cada uma das 9 características de qualidade definidas na edição 2023 da norma:

| # | Característica de Qualidade (ISO/IEC 25010:2023) | Status da Avaliação | Nível de Evidência | Resumo Técnico da Situação |
| :-: | :--- | :---: | :---: | :--- |
| **1** | **Adequação Funcional** (*Functional Suitability*) | 🟢 Demonstrado no repositório | E1 + E2 | Módulos ERP completos (produtos, estoque, PDV, compras, cotações, relatórios e DRE) com cobertura de testes em regras de domínio. |
| **2** | **Eficiência de Desempenho** (*Performance Efficiency*) | 🟡 Parcialmente demonstrado | E1 + E3 | Arquitetura local rápida (IndexedDB + Vite + lazy loading), mas ausência de testes formais de estresse com alto volume de registros. |
| **3** | **Compatibilidade** (*Compatibility*) | 🟢 Demonstrado no repositório | E1 + E3 | Operação comprovada no Desktop Windows (Tauri/WebView2) e Web/PWA, com exportação de dados interoperável em CSV e JSON. |
| **4** | **Capacidade de Interação** (*Interaction Capability*) | 🟢 Demonstrado no repositório | E1 | Interface Tailwind CSS consistente, proteção contra erros em transações, badges de status de conectividade/sync e clareza visual. |
| **5** | **Confiabilidade** (*Reliability*) | 🟢 Demonstrado no repositório | E1 + E2 | Arquitetura Offline-First orientada à persistência local, transações atômicas com rollback em caso de falha, auditoria de estoque e backup com hash SHA-256. |
| **6** | **Segurança** (*Security*) | 🟡 Parcialmente demonstrado | E1 | Ausência de segredos expostos no código e permissões Tauri mínimas; todavia, `security.csp` está desabilitado (`null`) no `tauri.conf.json`. |
| **7** | **Manutenibilidade** (*Maintainability*) | 🟡 Parcialmente demonstrado | E1 + E2 | Excelente modularidade em camadas e repositórios; contudo, ausência de linter formal e 3 falhas de teste decorrentes de versão fixa. |
| **8** | **Flexibilidade** (*Flexibility*) | 🟢 Demonstrado no repositório | E1 + E3 | Facilidade comprovada de instalação via instaladores nativos (.exe/.msi) e PWA standalone; arquitetura Ports & Adapters desacoplada. |
| **9** | **Segurança Operacional** (*Safety*) | ⚪ Não aplicável | E1 | Aplicação de gestão mercantil e administrativa para comércio varejista; ausência de interfaces de controle com risco a vidas ou meio ambiente. |

---

## 5. Avaliação Técnica Detalhada das 9 Características

---

### 5.1. Adequação Funcional (*Functional Suitability*)

#### Definição
Grau em que o conjunto de funções do software atende às necessidades declaradas e implícitas quando utilizado sob condições especificadas.

#### Subcaracterísticas Avaliadas
- **Completude Funcional**: Grau em que o conjunto de funcionalidades cobre todas as tarefas e objetivos especificados para a gestão comercial.
- **Correção Funcional**: Grau em que o software fornece resultados corretos com o nível de precisão necessário (destaque para operações financeiras em centavos).
- **Pertinência Funcional**: Grau em que as funções facilitam a realização de tarefas operacionais específicas do comércio.

#### Evidências Identificadas no Repositório
- `src/js/domain/MoneyService.js`: Gestão monetária estrita em centavos inteiros (`toCents`, `fromCents`, `toFloat`), prevenindo anomalias de arredondamento inerentes a números de ponto flutuante em JavaScript (`EV-009`).
- `src/js/domain/MarginService.js`: Fórmulas comerciais rigorosas para Margem sobre a Venda, Markup sobre o Custo, Lucro Bruto e cálculo reverso bidirecional (`EV-009`).
- `src/js/validators/`: 6 validadores de domínio especializados (`ProductValidator.js`, `StockValidator.js`, `SaleValidator.js`, `SupplierValidator.js`, `PurchaseValidator.js`, `QuotationValidator.js`).
- `src/js/services/`: 9 serviços de caso de uso cobrindo todo o ciclo operacional mercantil (catálogo, estoque, vendas, compras, fornecedores, cotações, analytics, relatórios e backup).

#### Validações Executadas
- **Execução Real (`bun test`)**: 14 arquivos de testes executados em 17/09/2026 (`EV-013`).
- Testes específicos de domínio aprovados:
  - `tests/domain.test.js`: 100% de aprovação em conversões de centavos e cálculos de margem/markup.
  - `tests/products.test.js` & `tests/products_phase3.test.js`: 100% de aprovação em criação, unicidade de SKU e validações.
  - `tests/stock_phase4.test.js`: 100% de aprovação em movimentações de entrada, saída, ajustes e auditoria.
  - `tests/sales_phase5.test.js`: 100% de aprovação em vendas no PDV, preservação de custo histórico e travas de estoque.
  - `tests/purchases_suppliers_phase6.test.js`: 100% de aprovação em ordens de compras, validações de CPF/CNPJ e estornos.
  - `tests/quotations_phase7.test.js`: 100% de aprovação no limite de 3 fornecedores cotados e seleção automática de menor preço.
  - `tests/analytics_phase8.test.js`: 100% de aprovação nos cálculos de Curva ABC, CMV, Giro e velocidade.
  - `tests/reports_phase10.test.js`: 100% de aprovação na geração dos 7 relatórios gerenciais e exportação CSV.

#### Resultado e Nível de Evidência
🟢 **Demonstrado no repositório** — Nível **E1 + E2**.

#### Lacunas Identificadas
- Inexistência de testes automatizados de ponta a ponta (E2E) simulando a interface do usuário com ferramentas como Playwright ou Cypress. As validações executadas operam sobre a camada de serviços e repositórios em memória via `fake-indexeddb`.

#### Recomendações
1. *(Média Prioridade)* Implementar ao menos uma suíte básica de testes E2E executada sobre o navegador headless para certificar o fluxo visual completo de venda e cadastro.

---

### 5.2. Eficiência de Desempenho (*Performance Efficiency*)

#### Definição
Desempenho relativo à quantidade de recursos utilizados sob condições declaradas (tempo de resposta, taxa de transferência e uso de memória/processamento).

#### Subcaracterísticas Avaliadas
- **Comportamento Temporal**: Tempos de resposta, tempos de processamento e taxas de transferência ao executar funções.
- **Utilização de Recursos**: Quantidade e tipos de recursos utilizados durante a execução.
- **Capacidade**: Limites máximos de dados e transações suportados sem degradação.

#### Evidências Identificadas no Repositório
- `src/js/router.js`: Uso de importação dinâmica (*dynamic imports* / lazy loading) para carregar páginas sob demanda (`await import('./pages/ProductsPage.js')`), reduzindo o tempo de carga inicial (*Initial Load Time*) (`EV-010`).
- `src/js/services/ImageService.js`: Redimensionamento automático no cliente via Canvas API e compressão para formato WebP com qualidade ajustável, limitando o consumo de armazenamento no IndexedDB (`EV-009`).
- `src/js/db/migrations.js`: Criação de múltiplos índices secundários no IndexedDB (`productCode`, `internalCode`, `barcode`, `name`, `categoryId`, `brand`, `type`, `date`) para permitir buscas e ordenações sem varredura linear (*table scan*) completa da base (`EV-007`).
- `public/sw.js`: Estratégia de cache `Cache First` para os recursos estáticos gerados com hash imutável na pasta `/assets/` do Vite (`EV-005`).

#### Validações Executadas
- **Build de Produção (`bun run build`)**: Concluído em **1.52 segundos** (`EV-014`). O bundle principal compilado pelo Vite totalizou apenas 50.8 kB de JavaScript (13.6 kB gzip) e 59.8 kB de CSS (10.5 kB gzip), demonstrando alta compactação de código e ausência de frameworks pesados no pacote inicial.
- **Tempo de Execução dos Testes (`bun test`)**: 171 testes unitários e de integração foram concluídos em **923 milissegundos**, evidenciando tempo de resposta na escala de sub-milissegundos para operações lógicas locais (`EV-013`).

#### Resultado e Nível de Evidência
🟡 **Parcialmente demonstrado** — Nível **E1 + E3**.

#### Lacunas Identificadas
- Não existem testes formais de carga ou estresse no repositório avaliando o comportamento temporal do IndexedDB com bases de dados volumosas (ex.: 50.000 produtos ou 200.000 vendas).
- Não foi implementada virtualização de listas longas (*virtual scrolling*) no catálogo ou nas tabelas; o carregamento baseia-se em listagem direta dos registros com paginação/limite manual.

#### Recomendações
1. *(Média Prioridade)* Implementar teste de benchmark automatizado inserindo 10.000 itens sintéticos para mensurar o tempo de renderização do grid de produtos e o impacto no consumo de memória.
2. *(Baixa Prioridade)* Adicionar virtualização de DOM nas tabelas de histórico e no grid de catálogo caso a base do cliente ultrapasse 3.000 itens ativos.

---

### 5.3. Compatibilidade (*Compatibility*)

#### Definição
Grau em que um produto ou sistema pode trocar informações com outros produtos ou sistemas e executar suas funções requeridas enquanto compartilha o mesmo ambiente comum de hardware ou software.

#### Subcaracterísticas Avaliadas
- **Coexistência**: Capacidade de executar suas funções eficientemente em um ambiente compartilhado com outros softwares sem impacto adverso.
- **Interoperabilidade**: Grau em que o sistema pode trocar dados com outros sistemas externos.

#### Evidências Identificadas no Repositório
- `src/js/platform/`: Camada estruturada no padrão *Ports & Adapters* (`Platform`, `WebAdapter`, `TauriAdapter`), garantindo que o núcleo da aplicação isole recursos específicos do navegador daqueles do ambiente nativo do sistema operacional Windows (`EV-010`).
- `src/js/services/ReportService.js`: Interoperabilidade de dados mercantil com exportação em formato padrão CSV com delimitador de ponto e vírgula (`;`), suporte explícito a cabeçalho UTF-8 BOM e codificação alternativa Windows-1252 (ANSI) para compatibilidade nativa de caracteres acentuados no Microsoft Excel do Windows (`EV-009`).
- `src/js/services/BackupService.js`: Exportação do estado do sistema em formato neutro JSON canônico com hash SHA-256 (`EV-012`).
- `src/js/sync/FirebaseProvider.js`: Interoperabilidade em nuvem via HTTP REST API padrão com codificação/decodificação bidirecional dos tipos de documentos do Google Firestore (`EV-011`).

#### Validações Executadas
- **Validação de Empacotamento Desktop (`EV-015`)**: Presença física de binários compilados de distribuição em instalador executável (NSIS `.exe` de 2.32 MB) e corporativo (WiX `.msi` de 3.32 MB) no diretório `src-tauri/target/release/bundle/`. Registra-se tecnicamente que a auditoria confirmou a existência física e integridade dos artefatos gerados pelo build, sem contudo ter realizado execução dinâmica de instalação/desinstalação ponta a ponta em máquina limpa.
- **Validação PWA**: Manifesto W3C (`manifest.json`) validado em teste automatizado `tests/pwa_phase11.test.js` quanto à estrutura de ícones (96, 144, 192, 512 px) e declarações W3C.

#### Resultado e Nível de Evidência
🟢 **Demonstrado no repositório** — Nível **E1 + E3**.

#### Lacunas Identificadas
- A compatibilidade desktop identificada restringe-se estritamente ao ecossistema Windows x64 (arquivos NSIS e WiX gerados). Não existem configurações de build ou artefatos para Linux (.deb/.AppImage) ou macOS (.dmg), embora o Tauri possua suporte nativo potencial.

#### Recomendações
1. *(Baixa Prioridade)* Documentar formalmente os requisitos mínimos do Windows (Windows 10 64-bit + WebView2 Runtime) no material de suporte ao cliente.

---

### 5.4. Capacidade de Interação (*Interaction Capability*)

> [!NOTE]
> Esta característica substituiu formalmente o termo "Usabilidade" (*Usability*) na revisão ISO/IEC 25010:2023, expandindo o foco para a capacidade do sistema em permitir trocas eficazes de informação entre o usuário e a interface.

#### Definição
Grau em que o produto pode ser interagido por usuários especificados para trocar informações através de sua interface com vistas a completar tarefas pretendidas.

#### Subcaracterísticas Avaliadas
- **Reconhecimento de Adequação**: Clareza da finalidade do software e de suas telas logo no primeiro contato.
- **Capacidade de Aprendizagem**: Facilidade com que o operador compreende o fluxo de trabalho.
- **Operabilidade**: Facilidade de controle, preenchimento e navegação nos módulos.
- **Proteção contra Erros do Usuário**: Mecanismos que impedem ou alertam sobre entradas incorretas e estados inválidos.
- **Autodescritividade**: Labels, instruções de campos monetários, indicações de obrigatoriedade e mensagens informativas.
- **Inclusividade & Acessibilidade**: Estrutura semântica e legibilidade da interface.

#### Evidências Identificadas no Repositório
- `src/js/app.js`: Cabeçalho superior dinâmico com sinalizadores visuais permanentes de conectividade de rede (`Online` em verde e `Offline` pulsante em âmbar) e de sincronização em nuvem (`Nuvem Pronta`, `Sincronizando...`, `X na fila`, `Sincronizado` e `Falha sync`), eliminando qualquer ambiguidade sobre o estado dos dados do usuário (`EV-010`).
- **Proteção contra Erros do Usuário**:
  - `SaleService.js:41-45`: Bloqueio transacional automático ao tentar faturar itens sem saldo suficiente quando a opção de estoque negativo está desabilitada (`EV-008`).
  - `QuotationService.js:35-45`: Bloqueio contra inclusão de mais de 3 fornecedores cotados simultaneamente e proteção contra fornecedores duplicados no mesmo produto (`EV-009`).
  - `BackupService.js:280-320`: Validação estrita do arquivo de backup antes de restaurar, com exibição de tela de resumo dos registros e exigência de confirmação explícita do operador (`EV-012`).
  - `StockService.js:30-40`: Exigência mandatória de justificativa textual para saídas manuais e avarias (`EV-009`).
- **Autodescritividade**: Conversão automática de centavos para Real com símbolo R$, recálculo em tempo real de margem/markup no formulário de produtos e modais de recibo limpos com suporte a impressão física.

#### Validações Executadas
- Testes automatizados de validação de erro (`tests/sales_phase5.test.js`, `tests/stock_phase4.test.js`, `tests/purchases_suppliers_phase6.test.js`) demonstram que entradas inválidas disparam exceções estruturadas com mensagens descritivas amigáveis (`EV-013`).

#### Resultado e Nível de Evidência
🟢 **Demonstrado no repositório** — Nível **E1**.

#### Lacunas Identificadas
- Ausência de atalhos globais de teclado mapeados no código (ex.: teclas de função `F1` a `F12` para frente de caixa ágil).
- Não foi evidenciada auditoria de acessibilidade WCAG 2.1 formal (contraste de cores, conformidade com leitores de tela NVDA/JAWS e atributos ARIA completos em todos os modais dinâmicos).

#### Recomendações
1. *(Alta Prioridade)* Implementar mapeamento de teclas de atalho no PDV (ex.: tecla `F2` para abrir modal de nova venda e `F10` para finalizar com dinheiro/PIX).
2. *(Média Prioridade)* Conduzir auditoria de acessibilidade com ferramenta automatizada (axe-core / Lighthouse Accessibility) para aprimorar atributos ARIA nos modais customizados.

---

### 5.5. Confiabilidade (*Reliability*)

#### Definição
Grau em que um sistema executa funções especificadas sob condições especificadas durante um período determinado de tempo.

#### Subcaracterísticas Avaliadas
- **Ausência de Falhas**: Baixa frequência de falhas operacionais em rotinas de cálculo e persistência.
- **Disponibilidade**: Prontidão operacional garantida pela arquitetura Offline-First.
- **Tolerância a Falhas**: Capacidade de manter a estabilidade operacional mesmo diante de interrupções de conexão ou de rede.
- **Capacidade de Recuperação**: Mecanismos de auditoria, restauração de snapshots e reversão transacional (*rollback*).

#### Evidências Identificadas no Repositório
- `src/js/db/transactions.js`: Mecanismo centralizado `executeTransaction` que engloba operações multi-store no IndexedDB e implementa aborto automático (`tx.abort()`) com reversão transacional (*rollback*) em caso de falha no meio do processo (`EV-008`).
- `src/js/services/StockService.js`: Método `recalculateAllStock()` implementado para auditar a base de movimentações físicas históricas e sanar eventuais descompassos de saldo acumulados (`EV-009`).
- `src/js/services/BackupService.js`: Validação de integridade do payload de backup com cálculo canônico de hash SHA-256 e reversão automática se o arquivo estiver adulterado (`EV-012`).
- `src/js/services/SyncEngine.js`: Padrão Outbox com persistência da fila em disco (`syncQueue`), reprocessamento sequencial e tratamento com retentativas e resolução determinística de conflitos via Last Write Wins (LWW) (`EV-011`).

#### Validações Executadas
- Testes transacionais executados com sucesso em `tests/db.test.js`, `tests/stock_phase4.test.js` e `tests/sales_phase5.test.js` comprovando que erros forçados abortam a transação sem corromper as tabelas envolvidas (`EV-013`).

#### Resultado e Nível de Evidência
🟢 **Demonstrado no repositório** — Nível **E1 + E2**.

#### Lacunas Identificadas
- A proteção contra corrupção do banco IndexedDB depende inteiramente da robustez da implementação do storage engine do navegador (Chromium/WebView2) no disco local. Não há espelhamento físico em arquivo secundário além das rotinas de backup acionadas pelo usuário.

#### Recomendações
1. *(Média Prioridade)* Adicionar lembrete automático periódico na interface sugerindo ao operador a geração do arquivo de backup caso tenham transcorrido mais de 7 dias desde a última exportação.

---

### 5.6. Segurança (*Security*)

#### Definição
Grau em que um produto protege informações e dados de modo que pessoas ou sistemas tenham o grau de acesso aos dados adequado às suas autorizações, resistindo a ameaças e ataques.

#### Subcaracterísticas Avaliadas
- **Confidencialidade**: Proteção contra acesso e visualização não autorizada de dados mercantis.
- **Integridade**: Proteção contra modificação maliciosa ou corrupção de informações.
- **Não Repúdio & Responsabilização**: Rastreabilidade das ações registradas no histórico.
- **Autenticidade**: Validação de procedência de dados.
- **Resistência a Ataques**: Mecanismos de blindagem de IPC e contenção de injeção de scripts.

#### Evidências Identificadas no Repositório
- **Ausência de Segredos Hardcoded**: Análise estática no repositório confirmou que não existem chaves privadas de API ou credenciais de produção do Firebase fixas no código-fonte. O arquivo `SettingsPage.js` apenas disponibiliza campos vazios com placeholders informativos para que o usuário informe suas próprias chaves (`EV-009`).
- `src-tauri/capabilities/default.json`: Configuração de permissões do Tauri v2 baseada estritamente no princípio do menor privilégio (`core:default`), sem concessão indiscriminada de comandos nativos do sistema operacional (`EV-004`).
- `src/js/services/BackupService.js`: Proteção contra manipulação de backups através de checksum digital SHA-256 via Web Crypto API nativa (`EV-012`).
- **Validação de Entradas**: Todos os dados recebidos na UI passam por validadores tipados antes de atingir os repositórios (`ProductValidator`, `SaleValidator`, etc.) mitigando injeção de tipos incoerentes (`EV-009`).

#### Validações Executadas
- Inspeção estática de dependências e configuração Tauri (`EV-002`, `EV-004`).

#### Resultado e Nível de Evidência
🟡 **Parcialmente demonstrado** — Nível **E1**.

#### Lacunas Identificadas
- **CSP Desabilitado no Tauri (`EV-002`)**: No arquivo `src-tauri/tauri.conf.json` (linhas 25-27), a política de segurança de conteúdo está explicitamente definida como nula:
  ```json
  "security": {
    "csp": null
  }
  ```
  Isso desabilita a Content Security Policy na janela do Windows Desktop, permitindo em tese a execução de scripts e conexões a origens não restritas caso ocorra uma injeção de conteúdo externo.
- **Armazenamento em Repouso Descriptografado**: Os dados gravados no IndexedDB local residem em texto plano (JSON desprotegido no perfil do usuário do Windows), dependendo unicamente do controle de acesso do sistema operacional (permissões da pasta do usuário no NTFS). Não há camada de criptografia local em repouso (ex.: AES-GCM com chave derivada de senha mestra).
- **Ausência de Controle de Acesso por Usuário (RBAC)**: O sistema não implementa tela de login, senhas ou papéis de operadores (ex.: Caixa vs. Gerente), permitindo acesso irrestrito a todas as configurações a qualquer pessoa com acesso à máquina.

#### Recomendações
1. *(Alta Prioridade)* Configurar uma Content Security Policy estrita em `tauri.conf.json`, permitindo apenas scripts da própria origem (`'self'`) e conexões estritas ao Firestore (`https://firestore.googleapis.com`).
2. *(Média Prioridade)* Avaliar a introdução de controle básico de operador de caixa com senha de acesso e perfil restrito (bloqueando acesso à exclusão de base ou cancelamento de vendas sem autorização).

---

### 5.7. Manutenibilidade (*Maintainability*)

#### Definição
Grau de eficácia e eficiência com que o software pode ser modificado pelos desenvolvedores pretendidos para aprimorá-lo, corrigi-lo ou adaptá-lo a mudanças no ambiente ou nos requisitos.

#### Subcaracterísticas Avaliadas
- **Modularidade**: Grau em que o sistema é composto por componentes discretos com baixo acoplamento.
- **Reusabilidade**: Facilidade com que ativos do software podem ser utilizados em mais de um módulo.
- **Capacidade de Análise**: Facilidade de diagnóstico de deficiências ou causas de falhas.
- **Capacidade de Modificação**: Facilidade de alteração do software sem introduzir defeitos colaterais.
- **Testabilidade**: Facilidade com que os critérios de teste podem ser estabelecidos e testes executados.

#### Evidências Identificadas no Repositório
- **Arquitetura em Camadas Estruturada**: Segregação estrita de responsabilidades no código frontend (`src/js/`):
  - Camada de Domínio (`domain/`): Funções puras e sem dependências externas;
  - Camada de Validações (`validators/`): Regras de formato e limites de negócio isoladas;
  - Camada de Repositórios (`repositories/`): Padrão `BaseRepository` com abstração completa do IndexedDB;
  - Camada de Casos de Uso (`services/`): Orquestração de processos e transações;
  - Camada de Apresentação (`pages/`): Componentes visuais desacoplados de bibliotecas nativas;
  - Camada de Adaptação (`platform/` e `sync/`): Conectores externos substituíveis.
- **Barramento de Eventos Desacoplado (`eventBus.js`)**: Comunicação entre módulos via publicação/assinatura (`PRODUCT_UPDATED`, `STOCK_CHANGED`, `SALE_CREATED`, `NETWORK_STATUS_CHANGED`), evitando dependências circulares entre páginas e serviços.
- **Suíte Extensa de Testes**: 14 suítes de teste cobrindo todas as 13 fases do roadmap (`EV-013`).

#### Validações Executadas
- **Execução Real (`bun test`)**: 171 testes executados em 923ms (`EV-013`).
- **Análise das 3 Falhas de Teste Observadas**:
  Na suíte `tests/platform_phase12.test.js`, foram registradas 3 falhas de asserção:
  ```text
  (fail) ... deve possuir tauri.conf.json válido com identificador, versão e caminhos de build corretos
  (fail) ... deve possuir Cargo.toml com crate gestaopro e tauri v2
  (fail) ... package.json deve conter scripts tauri, tauri:dev e tauri:build na versão 1.12.0
  ```
  *Causa Técnica Identificada*: Os testes da Fase 12 continham asserções fixas na versão literal `"1.12.0"`. Quando a Fase 13 elevou o projeto para a versão `"1.13.0"` no `package.json`, `Cargo.toml` e `tauri.conf.json`, as asserções fixas de teste não foram atualizadas para a nova versão. Esse achado comprova a necessidade de aperfeiçoar os testes para ler dinamicamente o versionamento do pacote.

#### Resultado e Nível de Evidência
🟡 **Parcialmente demonstrado** — Nível **E1 + E2**.

#### Lacunas Identificadas
- Inexistência de ferramenta de análise estática / linter (ESLint ou Biome) configurada no pipeline ou no `package.json` (`EV-018`).
- Inexistência de suíte de testes de regressão de versão automatizada nos testes da Fase 12.

#### Recomendações
1. *(Alta Prioridade)* Ajustar as asserções de versão em `tests/platform_phase12.test.js` para lerem a versão vigente do `package.json` de forma dinâmica ou parametrizada.
2. *(Média Prioridade)* Configurar script de linter (`npm run lint` / `bun run lint`) com Biome ou ESLint para garantir padronização formal de código em todo o repositório.

---

### 5.8. Flexibilidade (*Flexibility*)

> [!NOTE]
> Esta característica substituiu a antiga "Portabilidade" (*Portability*) na revisão ISO/IEC 25010:2023, englobando a capacidade de instalação, substituição, adaptabilidade e escalabilidade do software.

#### Definição
Grau em que um produto pode ser adaptado para ambientes de hardware, software ou outros ambientes operacionais ou de uso diferentes ou em evolução.

#### Subcaracterísticas Avaliadas
- **Adaptabilidade**: Capacidade de operar em múltiplos ambientes de execução (Desktop Windows, PWA Standalone e Web).
- **Capacidade de Instalação**: Facilidade com que o produto pode ser instalado e desinstalado em ambientes-alvo.
- **Capacidade de Substituição**: Facilidade de substituição de componentes ou provedores externos.
- **Escalabilidade**: Capacidade do sistema em acomodar o crescimento das cargas de trabalho.

#### Evidências Identificadas no Repositório
- `src/js/platform/platform.js`: Mecanismo automático de detecção de runtime (`isDesktop()`, `isPWA()`, `isWeb()`) com chaveamento transparente dos adaptadores de imagem e armazenamento (`EV-010`).
- `src/js/sync/CloudProvider.js`: Interface abstrata que permite trocar o provedor de sincronização (atualmente implementado com `FirebaseProvider` e `MockCloudProvider`) sem alterar uma única linha da camada de UI ou de repositórios (`EV-011`).
- **Instalação Híbrida**: Suporte comprovado a instalação nativa do Windows (.exe via NSIS e .msi corporativo via WiX) e instalação leve como aplicativo web progressivo direto do navegador (`EV-006`, `EV-015`).

#### Validações Executadas
- Testes automatizados de plataforma em `tests/platform_phase12.test.js` e `tests/sync_phase13.test.js` validando a interface abstrata de provedores e adaptadores (`EV-013`).
- Confirmação física da existência dos pacotes gerados no repositório (`EV-015`).

#### Resultado e Nível de Evidência
🟢 **Demonstrado no repositório** — Nível **E1 + E3**.

#### Lacunas Identificadas
- A adaptação de banco de dados é fortemente atrelada à API IndexedDB do navegador. Caso a organização decida migrar para um banco de dados relacional baseado em arquivos (ex.: SQLite embutido nativo via plugin Tauri), os repositórios precisarão de uma nova camada de adaptação SQL.

#### Recomendações
1. *(Baixa Prioridade)* Manter a abstração da interface `BaseRepository` para possibilitar eventual suporte futuro ao plugin `tauri-plugin-sql` com SQLite em caso de operação exclusivamente desktop corporativa.

---

### 5.9. Segurança Operacional (*Safety*)

> [!IMPORTANT]
> **Distinção Fundamental (ISO/IEC 25010:2023):**  
> A característica **Safety (Segurança Operacional)** é nova na revisão de 2023 e refere-se estritamente à capacidade do software de **evitar estados que causem dano físico, perigo à vida humana, à saúde das pessoas, ao meio ambiente ou à propriedade física**.  
> **Não deve ser confundida com Security (Segurança da Informação)**, que trata de acesso indevido, vazamento de dados e ataques cibernéticos (avaliada no item 5.6).

#### Definição
Grau em que um produto ou sistema, sob condições especificadas, evita estados nos quais vidas humanas, saúde, propriedade ou o meio ambiente sejam colocados em perigo.

#### Subcaracterísticas Normativas da ISO/IEC 25010:2023
- **Restrição Operacional** (*Operational constraint*): Restrições para mitigar perigos físicos.
- **Identificação de Risco** (*Risk identification*): Mecanismos para prever condições perigosas.
- **Comportamento à Prova de Falhas** (*Fail safe*): Transição para estado seguro em falhas críticas.
- **Aviso de Perigo** (*Hazard warning*): Emissão de alertas de risco ambiental ou físico.
- **Integração Segura** (*Safe integration*): Integração sem comprometer a segurança operacional de outros sistemas.

#### Análise do Domínio da Aplicação
O software GestãoPro é um sistema de gestão comercial e controle de estoque de bens de consumo, varejo e serviços administrativos.
- A aplicação **não opera atuadores físicos, maquinários industriais, dispositivos médicos, robótica ou sistemas de suporte à vida**.
- O sistema **não controla substâncias inflamáveis, perigosas, tóxicas ou variáveis de impacto ecológico direto**.
- Riscos de prejuízo financeiro decorrentes de falhas de estoque ou erros de precificação são analisados normativamente sob as características de **Adequação Funcional**, **Confiabilidade** e **Segurança da Informação**, e não sob o conceito de perigo físico da característica Safety.

#### Resultado e Nível de Evidência
⚪ **Não aplicável** — Nível **E1**.

#### Justificativa Técnica Formal
Conforme estabelecido pelas diretrizes de escopo da ISO/IEC 25010:2023, a característica *Safety* é classificada como **Não Aplicável**, pois não foram identificadas, no escopo funcional analisado, condições relevantes que caracterizem um problema de Safety (ausência de controle de atuadores físicos, maquinários industriais, substâncias perigosas ou sistemas de suporte à vida). Eventuais riscos mercantis, discrepâncias de estoque ou perdas financeiras são tratados normativamente sob as características de **Adequação Funcional**, **Confiabilidade** e **Segurança da Informação**.

---

## 6. Plano de Ação Priorizado de Melhoria da Qualidade

A tabela a seguir consolida as recomendações técnicas derivadas da auditoria estática e executada, ordenadas por prioridade técnica e esforço estimado:

| ID | Ação Recomendada | Característica ISO 25010 | Prioridade | Esforço Estimado | Benefício Técnico Esperado |
| :-: | :--- | :---: | :---: | :---: | :--- |
| **REC-01** | Habilitar e configurar Content Security Policy (CSP) restritiva no `tauri.conf.json` (`security.csp`) | Segurança | **Alta** | Baixo | Elimina brecha de injeção de scripts não autorizados na janela nativa do Windows. |
| **REC-02** | Parametrizar testes de plataforma em `tests/platform_phase12.test.js` para ler a versão dinamicamente do `package.json` | Manutenibilidade | **Alta** | Baixo | Elimina as 3 falhas de teste na suíte de build e viabiliza testes 100% aprovados em futuras versões. |
| **REC-03** | Adicionar atalhos de teclado operacionais no PDV (`F2`, `F10`) para agilizar atendimento de caixa | Capacidade de Interação | **Alta** | Médio | Aumenta significativamente a produtividade e velocidade operacional de faturamento. |
| **REC-04** | Integrar ferramenta de linter estático e formatação de código (ESLint ou Biome) no `package.json` | Manutenibilidade | **Média** | Baixo | Padroniza convenções de código e previne erros comuns de sintaxe antes do commit. |
| **REC-05** | Implementar suíte básica de testes E2E automatizados com Playwright para o fluxo crítico de venda | Adequação Funcional | **Média** | Médio | Valida visualmente os fluxos completos de interface do usuário de ponta a ponta. |
| **REC-06** | Adicionar lembrete automático de backup na interface após 7 dias de atividade sem exportação | Confiabilidade | **Média** | Baixo | Mitiga risco de perda substancial de dados no ambiente do cliente. |
| **REC-07** | Desenvolver teste de estresse de banco local com 10.000 itens para aferir desempenho com grandes volumes | Eficiência de Desempenho | **Média** | Médio | Identifica antecipadamente eventuais gargalos de paginação ou busca na base. |
| **REC-08** | Implementar controle básico de acesso por operador com senha e restrição de configurações | Segurança | **Média** | Médio | Protege cadastros e configurações críticas contra manipulação por funcionários não autorizados. |
| **REC-09** | Conduzir auditoria de acessibilidade automatizada (axe-core) e refinar atributos ARIA nos modais | Capacidade de Interação | **Média** | Médio | Melhora conformidade inclusiva para operadores com deficiência visual ou motora. |
| **REC-10** | Estudar abstração futura para plugin SQLite no Tauri mantendo fallback em IndexedDB no PWA | Flexibilidade | **Baixa** | Alto | Oferece persistência em arquivo de banco único para instalações desktop corporativas. |

---

## 7. Limitações desta Avaliação

Esta auditoria técnica baseou-se estritamente na inspeção do código-fonte, configurações, histórico Git e execução dos comandos locais do repositório. Por conseguinte, este relatório **não cobre**:
1. **Testes de Penetração Dinâmicos (Pentest)**: Não foram realizados testes de invasão ativa, análise dinâmica de vulnerabilidades de rede ou testes de engenharia reversa sobre os binários compilados.
2. **Testes de Carga e Concorrência Real**: As medições refletem a execução em máquina de desenvolvimento local com runner Bun; não foram simulados ambientes com concorrência massiva de operações no disco.
3. **Pesquisa Ergonômica com Usuários Reais**: Aspectos subjetivos de satisfação, esforço cognitivo e ergonomia operacional dependem de avaliação em campo com operadores humanos (escopo da norma ISO/IEC 25019:2023).
4. **Métricas de Telemetria em Produção**: Por ser uma aplicação estritamente Offline-First sem envio compulsório de telemetria externa, não há dados estatísticos de taxa de crash (*crash rate*) ou comportamento em máquinas legadas de clientes.

---

## 8. Aviso Normativo e Limite de Certificação

> [!IMPORTANT]
> **Aviso de Natureza Técnica e Isenção de Certificação Comercial:**  
> A norma **ISO/IEC 25010:2023** é um modelo de referência conceitual e técnico de qualidade de produto de software (*Product Quality Model*). Ela fornece a taxonomia, o vocabulário padronizado e a lista estruturada de características e subcaracterísticas para guiar a engenharia, os testes e a documentação do software.  
> 
> **A emissão deste relatório técnico NÃO constitui, por si só, uma "certificação formal de produto ISO/IEC 25010".** Certificações comerciais de conformidade técnica exigem a contratação formal de laboratórios de ensaio acreditados e órgãos certificadores independentes (como ABNT, DNV, SGS, TÜV), operando sob protocolos formais de auditoria externa e emissão de laudo acreditado. Este documento representa uma autoavaliação técnica de engenharia, rigorosamente fundamentada em evidências auditáveis do repositório.
