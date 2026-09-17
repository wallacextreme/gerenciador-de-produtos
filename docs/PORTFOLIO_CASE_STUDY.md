# GestãoPro — Case de Engenharia de Software

Documento de Engenharia de Software e Estudo de Caso Arquitetural para Avaliação Técnica, Portfólio e Recrutadores.

---

## 1. Problema de Negócio e Contexto Operacional

Comércios de varejo e centros automotivos enfrentam problemas recorrentes ao adotar ERPs baseados exclusivamente em nuvem tradicional (SaaS cliente-servidor síncrono):

1. **Vulnerabilidade à Instabilidade de Conexão**: Uma oscilação de link de internet interrompe imediatamente o fechamento de vendas no PDV, consultas de saldo em estoque e faturamento, paralisando a operação física do estabelecimento.
2. **Latência Elevada em Operações Críticas**: Requisições síncronas para servidores remotos degradam a velocidade do caixa no atendimento ao cliente.
3. **Complexidade e Custo de Infraestrutura**: Soluções tradicionais exigem servidores dedicados de banco de dados locais ou infraestrutura em nuvem de alta disponibilidade, com custos de licenciamento inacessíveis a pequenos e médios lojistas.
4. **Acoplamento de Plataforma**: Dificuldade em manter uma mesma base de código executável como aplicativo desktop corporativo (Windows) e como Web/PWA multiplataforma.

---

## 2. A Solução: GestãoPro

O **GestãoPro** foi concebido e implementado como uma aplicação **Offline-First**, estruturada em camadas bem delimitadas, com persistência transacional local e capacidade de execução híbrida:

- **100% Operacional Sem Conexão**: Todas as leituras, gravações, emissão de vendas, movimentações de estoque e consultas de relatórios ocorrem no banco de dados local do cliente.
- **Distribuição Dupla (Desktop Nativo e PWA)**: Utiliza a mesma base de código frontend para empacotar um binário Windows leve de baixo consumo de RAM via **Tauri v2 (Rust)** e uma aplicação web instalável via **Progressive Web App (PWA)**.
- **Sincronização Desacoplada e Assíncrona**: Motor de sincronização com padrão *Outbox*, capaz de enfileirar mutações offline e sincronizar com nuvem de forma transparente quando houver conectividade.

---

## 3. Arquitetura Geral do Sistema

O sistema adota o padrão **Clean Architecture / Ports & Adapters (Hexagonal)** com separação estrita de responsabilidades:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                                 USUÁRIO                                 │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    ┌─────────────────────────┐             ┌─────────────────────────┐
    │     Navegador / PWA     │             │  Desktop Windows Nativo │
    │  (Service Worker + SW)  │             │   (Tauri v2 IPC / Rust) │
    └────────────┬────────────┘             └────────────┬────────────┘
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CAMADA DE APRESENTAÇÃO (UI / UX)                     │
│  - Router SPA Hash (navegação rápida sem recarregamento)                │
│  - EventBus Desacoplado (pub/sub de eventos do sistema)                 │
│  - Design System Modular com Tailwind CSS v4                            │
│  - Páginas: Dashboard, Produtos, Estoque, Vendas PDV, Compras, etc.    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      CAMADA DE SERVIÇOS & DOMÍNIO                       │
│  - Regras de Negócio: ProductService, StockService, SaleService         │
│  - Cálculos Financeiros em Centavos Inteiros: MoneyService              │
│  - Algoritmos de Margem e Markup: MarginService                         │
│  - Validadores Puros de Dados: ProductValidator, SaleValidator, etc.    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          CAMADA DE REPOSITÓRIOS                         │
│  - BaseRepository Pattern com operações CRUD assíncronas                │
│  - Repositórios especializados: Product, StockMovement, Sale, Supplier  │
│  - Consultas indexadas com múltiplos filtros em memória e cursor        │
└──────────────────┬──────────────────────────────────┬───────────────────┘
                   ▼                                  ▼
┌─────────────────────────────────────┐  ┌────────────────────────────────┐
│       PERSISTÊNCIA LOCAL            │  │     SINCRONIZAÇÃO EM NUVEM     │
│  - IndexedDB nativo com `idb 8.0`   │  │  - SyncEngine (Outbox Queue)   │
│  - Migrations versionadas           │  │  - Last-Write-Wins (LWW)       │
│  - Transações Atômicas Multi-Store  │  │  - MockCloudProvider (In-Mem)  │
│  - Backup JSON com Hash SHA-256     │  │  - FirebaseProvider (REST)     │
└─────────────────────────────────────┘  └────────────────────────────────┘
```

---

## 4. Principais Desafios de Engenharia & Decisões Arquiteturais

### 4.1 Precisão Monetária sem Ponto Flutuante
- **Desafio**: Erros de arredondamento inerentes à representação IEEE 754 de números decimais em JavaScript (ex: `0.1 + 0.2 === 0.30000000000000004`).
- **Decisão**: Toda a manipulação de valores financeiros no banco e nas regras de negócio armazena estritamente **centavos inteiros** (`salePriceCents: 15990` para R$ 159,90).
- **Implementação**: O módulo centralizador `MoneyService` provê operações seguras de soma, subtração, multiplicação e divisão com arredondamento comercial (*half-up*). A formatação monetária (BRL) ocorre exclusivamente na camada de apresentação (`translations.js`).

### 4.2 Integridade e Auditoria de Estoque
- **Desafio**: Descompasso entre saldo de produto e histórico de movimentações (vendas, devoluções, compras e perdas).
- **Decisão**: O saldo do produto é recalculado a partir das movimentações reais ou atualizado sob transação atômica multi-store com verificação de estoque mínimo e bloqueio de estoque negativo configurável.
- **Implementação**: Ferramenta de auditoria de saldo integrada, permitindo ao operador recalibrar o catálogo caso ocorra qualquer inconsistência.

### 4.3 Transações Atômicas no Navegador
- **Desafio**: O IndexedDB nativo do navegador aborta transações se micro-tarefas assíncronas não mantiverem o ciclo de vida da transação ativo.
- **Decisão**: Criação de um utilitário de transações seguras (`executeTransaction`), coordenando operações de leitura e escrita com tratamento automático de erros e rollback transacional.

---

## 5. Offline-First & Resiliência PWA

1. **Service Worker Estruturado**:
   - `public/sw.js` gerencia o cache do shell da aplicação via estratégias diferenciadas:
     - **HTML / Rotas**: *Network-First* com fallback imediato para o `index.html` em cache.
     - **Assets com Hash Imutável** (`/assets/*`): *Cache-First* garantindo carregamento instantâneo.
     - **Manifest e Ícones**: *Cache-First* com revalidação.
   - O Service Worker **não interfere** no armazenamento de dados de negócio, delegando toda a persistência ao IndexedDB.
2. **Armazenamento Persistente**:
   - Rotina em `src/js/utils/storage.js` solicita explicitamente ao navegador a flag `navigator.storage.persist()`, mitigando o risco de expurgo de dados locais em situações de pouca memória no dispositivo cliente.

---

## 6. Persistência Local & Rotinas de Backup com Hash SHA-256

- **Esquema de Dados Versionado**: Implementado em `src/js/db/migrations.js` com 10 object stores especializadas:
  - `products`, `productImages`, `suppliers`, `productSuppliers`, `sales`, `purchases`, `stockMovements`, `categories`, `settings` e `syncQueue`.
- **Rotina de Backup Criptograficamente Auditável**:
  - `BackupService` gera arquivos `.json` contendo o snapshot estruturado do banco.
  - O arquivo inclui um checksum **SHA-256** calculado via **Web Crypto API** (`crypto.subtle.digest`).
  - Na restauração, o arquivo é validado em quatro fases: checagem de metadados, integridade do checksum SHA-256, captura de snapshot de segurança temporário e inserção atômica com possibilidade de rollback em caso de falha.

---

## 7. Motor de Sincronização Desacoplado (Outbox Pattern)

- **Desacoplamento de Provedor**: A classe abstrata `CloudProvider` define a interface para qualquer nuvem externa (`pushChange`, `pullChanges`, `testConnection`).
- **Resolução de Conflitos**: Estratégia determinística *Last-Write-Wins (LWW)* baseada em carimbos de data/hora ISO 8601 (`updatedAt`).
- **Provedores Disponíveis**:
  - `MockCloudProvider`: Provedor simulado em memória utilizado em testes automatizados e no modo de demonstração pública, sem chamadas de rede.
  - `FirebaseProvider`: Integração direta com Firestore via endpoints REST HTTPS, eliminando a dependência do SDK pesado do Firebase no bundle frontend.

---

## 8. Aplicação Desktop Nativa: Tauri v2 + Rust

- **Segurança por Menor Privilégio**: As capacidades do Tauri são configuradas em `src-tauri/capabilities/default.json` concedendo apenas o conjunto mínimo `core:default`. A configuração de CSP é restrita para prevenir injeções externas.
- **Eficiência de Recursos**: Enquanto aplicações empacotadas com Electron consomem facilmente centenas de megabytes de RAM e geram executáveis de mais de 100 MB, o GestãoPro compilado com Tauri resulta em:
  - Instalador Windows NSIS (`.exe`): **2.32 MB**
  - Pacote Corporativo Windows Installer (`.msi`): **3.32 MB**
  - Executável estático compilado (`gestaopro.exe`): **9.04 MB**

---

## 9. Estratégia de Testes Automatizados

A estabilidade do sistema é comprovada por uma suíte de testes automatizados com execução no runner nativo do **Bun**:

| Arquivo de Teste | Camada Validada | Aspectos Chave Inspecionados |
| :--- | :--- | :--- |
| `tests/domain.test.js` | Domínio / Finanças | Centavos inteiros, arredondamento comercial, markup e margem líquida |
| `tests/db.test.js` | Persistência | Inicialização do esquema IndexedDB, migrações e índices de busca |
| `tests/products.test.js` | Catálogo | Criação, validações estritas de campos obrigatórios e soft delete |
| `tests/products_phase3.test.js` | Catálogo Avançado | Filtros compostos, unicidade de SKU/código de barras e atualização de fotos |
| `tests/stock_phase4.test.js` | Estoque | Entradas, saídas, recálculo histórico de saldo e alertas de estoque mínimo |
| `tests/sales_phase5.test.js` | Vendas / PDV | Validação de itens, métodos de pagamento (PIX, cartões, dinheiro) e conciliação |
| `tests/purchases_suppliers_phase6.test.js` | Suprimentos | Ordens de compra, validação de CNPJ/CPF de fornecedores e cotações |
| `tests/quotations_phase7.test.js` | Cotações | Matriz comparativa de melhores preços e prazos entre múltiplos fornecedores |
| `tests/analytics_phase8.test.js` | Relatórios | Agregações de faturamento, cálculo de ticket médio e produtos de maior giro |
| `tests/backup_settings_phase9.test.js` | Integridade | Exportação de JSON, hash SHA-256 e restauração transacional com rollback |
| `tests/reports_phase10.test.js` | Auditoria | Filtros temporais e exportação de dados para relatórios operacionais |
| `tests/pwa_phase11.test.js` | PWA | Ciclo de vida do Service Worker, eventos de rede e prontidão de atualização |
| `tests/platform_phase12.test.js` | Plataforma | Contratos dos adaptadores Tauri (desktop) vs Web (PWA) |
| `tests/sync_phase13.test.js` | Sincronização | Outbox queue, MockCloudProvider, resiliência a falhas de rede e push/pull |

**Resultado Real da Execução**: 171 testes executados em menos de 1 segundo (923 ms) em ambiente auditado.

---

## 10. Alinhamento com Normas Internacionais de Qualidade

1. **ISO/IEC 25010:2023 (Product Quality Model)**:
   - Avaliação técnica documental estruturada nas 9 características: Adequação Funcional, Eficiência de Desempenho, Compatibilidade, Capacidade de Interação, Confiabilidade, Segurança, Manutenibilidade, Flexibilidade e Segurança Operacional (*Safety*).
   - Registrado formalmente em `RELATORIO_QUALIDADE_ISO25010.md` como análise de aderência e gap analysis (sem caráter de certificação).
2. **ISO 9001:2026 (Quality Management Systems)**:
   - Documentação de processos alinhada à nova edição da norma publicada em 16/09/2026.
   - Estrutura completa de Procedimentos Operacionais Padrão (POP 01 a POP 05), matriz de riscos e oportunidades, e política da qualidade documentados em `SISTEMA_GESTAO_QUALIDADE_ISO9001.md`.

---

## 11. Governança de Segurança e Sanitização de Demonstração

- **Zero Exposição de Dados Reais**: Todo o ambiente público e os artefatos de demonstração operam sob o dataset sintético de autopeças gerado em `src/js/demo/demoSeed.js`.
- **Isolamento de Segredos**: Ausência total de credenciais de produção, chaves secretas ou tokens administrativos no repositório.
- **Canal Responsável de Segurança**: Diretrizes de reporte via GitHub Security Advisories documentadas em `SECURITY.md`.
