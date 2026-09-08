# Roadmap & Progresso do Sistema — GestãoPro

## Roadmap Oficial do Projeto

- [x] **FASE 1 & 2** — Fundação & Persistência
- [x] **FASE 3** — Módulo de Produtos & Catálogo
- [x] **FASE 4** — Módulo de Estoque & Movimentações
- [x] **FASE 5** — Módulo de Vendas (PDV) & Frente de Caixa
- [x] **FASE 6** — Módulo de Fornecedores, Compras & Abastecimento
- [x] **FASE 7** — Módulo de Cotações de Fornecedores por Produto
- [x] **FASE 8** — Dashboard e Análises
- [x] **FASE 9** — Backup, Restauração e Configurações
- [x] **FASE 10** — Relatórios e Impressão
- [x] **FASE 11** — PWA + Resiliência Offline
- [x] **FASE 12** — Tauri + EXE + MSI (Desktop Multi-Plataforma)
- [x] **FASE 13** — Firebase + Sincronização em Nuvem (Sync Engine & Outbox Pattern)

---

## FASE 13 — Firebase + Sincronização em Nuvem (Concluída)

- [x] `src/js/sync/` — Camada desacoplada de provedores em nuvem:
  - `CloudProvider.js` — Interface abstrata de sincronização (`pushChange`, `pullChanges`, `testConnection`).
  - `FirebaseProvider.js` — Provedor concreto Firestore REST API com transformador bidirecional de tipos de dados.
  - `MockCloudProvider.js` — Provedor em memória para testes e simulação com latência e injeção de falhas.
- [x] `src/js/repositories/SyncRepository.js` — Repositório da fila `syncQueue` (Padrão Outbox):
  - Enfileiramento de mutações locais com coalescência inteligente (UPDATE sobre CREATE e eliminação de DELETE sobre CREATE não sincronizado).
  - Controle de status (`PENDING`, `SYNCING`, `SYNCED`, `FAILED`), retentativas automáticas e limpeza de histórico (`clearCompleted`, `retryFailed`).
- [x] `src/js/services/SyncEngine.js` — Motor central de sincronização:
  - Orquestrador de fila com debounce, processamento sequencial e idempotente.
  - Escuta transparente do `EventBus` (`PRODUCT_UPDATED`, `PRODUCT_DELETED`, `STOCK_CHANGED`, `SALE_CREATED`, `PURCHASE_CREATED`, `SETTINGS_CHANGED`).
  - Reatividade a eventos de rede (`NETWORK_STATUS_CHANGED`) para auto-sync ao reconectar.
  - Resolução determinística de conflitos via Last Write Wins (LWW) baseado em `updatedAt`.
- [x] `src/js/pages/SettingsPage.js` — 5ª Aba: **Sincronização & Firebase**:
  - Painel de configuração de credenciais Firebase (API Key, Project ID, Auth Domain, App ID, Auto-Sync).
  - Teste de conexão em tempo real com medição de latência.
  - Cards de métricas da fila (Pendentes, Sincronizados, Falhas, Último Sync).
  - Tabela de inspeção dos itens recentes na fila Outbox.
- [x] `src/js/app.js` — Badge dinâmico de status de sincronização no Header (`Nuvem Pronta`, `Sincronizando...`, `X na fila`, `Sincronizado`, `Falha de sync`).
- [x] 12 novos testes automatizados em `tests/sync_phase13.test.js`.
- [x] `bun test` — **171 testes passando, 0 falhas** em 14 arquivos de teste.
- [x] `bun run build` — Build de produção limpo no Vite (sem erros).
- [x] Documentação sincronizada em `docs/` (`ARCHITECTURE.md`, `TEST_PLAN.md`, `CHANGELOG.md`, `DATA_MODEL.md`).
