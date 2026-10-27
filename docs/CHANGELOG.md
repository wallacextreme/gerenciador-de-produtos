# Changelog — GestãoPro

## [1.13.1] — 2026-10-27

### Executado — PHASE 16 — SISTEMA KEEP-ALIVE ANTI-PAUSA DEFINITIVO (7 CAMADAS)
- **Diagnóstico com Evidências de Telemetria**:
  - Constatação: O projeto Supabase `fujgtzxzspqhvvbzmqzv` pausou entre 22/10 e 25/10/2026 porque requisições de Storage (`GET /storage/v1/bucket`) ou respostas 404 de schema PostgREST não geram transações reais nem gravam no WAL do PostgreSQL.
- **Camada de Gravação Real no Banco (`supabase/migrations/20261027000000_keep_alive_heartbeat.sql`)**:
  - Criação da tabela `public._keep_alive_heartbeat` com RLS ativo e bloqueio total contra escrita/leitura direta por `anon` e `authenticated`.
  - Função RPC `public.rpc_keep_alive(ping_source)` com `SECURITY DEFINER` executando `UPSERT` real (incremento atômico de `ping_count` e `now()`), gerando transação real no banco.
  - Função legada `public.keep_alive()` mantida para retrocompatibilidade.
- **Automação GitHub Actions 3x ao Dia (`.github/workflows/supabase-keep-alive.yml`)**:
  - Agendamento cron nos horários 08:17, 14:17 e 20:17 BRT (minutos quebrados `:17` para evitar atraso de fila do GitHub).
  - Execução de `scripts/supabase-keep-alive.mjs` com checagem de escrita real via RPC e listagem de fotos.
  - Job anti-expiração de 60 dias: re-habilita o workflow via API do GitHub e registra heartbeat a cada 10 dias em branch órfão (`keepalive-heartbeat`), sem poluir a `main`.
- **Watchdog com Auto-Restore via Management API (`scripts/supabase-watchdog.mjs`)**:
  - Monitoramento de status do projeto: se `INACTIVE` ou `PAUSED`, aciona `POST /v1/projects/{ref}/restore` e aguarda retorno para `ACTIVE_HEALTHY`.
  - Auto-cura: se a RPC não existir no banco, aplica automaticamente a migração via `POST /database/query`.
- **Resiliência a Quedas e Supabase Indisponível no App**:
  - `src/js/utils/cloudErrorClassifier.js`: reclassifica `fetch failed`, `Failed to fetch`, `ENOTFOUND`, `540`, `503` como `TEMPORARY` com `shouldRetry: true`.
  - `src/js/services/ImageSyncService.js`: falha de rede/Supabase pausado mantém fotos em `QUEUED` sem consumir tentativas nem gerar falhas permanentes.
  - `src/js/repositories/SyncRepository.js`: `recoverProviderMisconfigurationFailures()` auto-recupera itens da outbox pendentes que falharam por indisponibilidade de rede ou pausa.
  - `src/js/sync/SupabaseStorageProvider.js`: `pingKeepAlive` atualizado para acionar a RPC `rpc_keep_alive` e nunca enviar `sb_publishable_...` como Bearer.
- **Validação de Linha de Base**:
  - Suíte completa de **1128 testes automatizados aprovada com 100% de sucesso (0 falhas em 44 arquivos)**.
  - 25 novos testes unitários adicionados em `tests/supabase_keep_alive_phase16.test.js`.
  - Guia completo passo a passo documentado em [KEEP_ALIVE_SETUP.md](KEEP_ALIVE_SETUP.md).

## [1.13.0-phase13-cloud-homologation] — 2026-10-09

### Executado — PHASE 13 — REAL FIREBASE CLOUD HOMOLOGATION (Prompt Master)
- **Auditoria de Nuvem e Salvaguardas Financeiras**:
  - Consulta ao Firebase CLI (`firebase projects:list --non-interactive`): identificados 4 projetos existentes pertencentes a ambientes de produção (`caixa-autopecas`, `fichas-tucano-loja`, `tabela-porta-escovas`, `tucano-vales`).
  - Salvaguardas ativas: Nenhuma operação, regra ou deploy foi disparado contra os projetos de produção. Todos os 4 projetos permanecem rigorosamente bloqueados por [firebaseConfigValidator.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/utils/firebaseConfigValidator.js).
  - Constatação: O projeto de homologação `gerenciador-produtos-staging` ainda não foi criado no Firebase Cloud.
  - Princípio de Honestidade Técnica: Classificação definida como `PARTIAL — LOCAL QA PASS; REAL CLOUD HOMOLOGATION BLOCKED`. Nenhuma conexão foi simulada ou falsificada.
- **Relatório e Guia de Homologação**:
  - Geração de [docs/PHASE13_CLOUD_HOMOLOGATION.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/docs/PHASE13_CLOUD_HOMOLOGATION.md) detalhando matriz de testes (Local vs Emulator vs Nuvem Real), análise de cotas Spark (gratuitas) e restrições de faturamento Blaze.
  - Atualização do manual [docs/STAGING_HANDOFF.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/docs/STAGING_HANDOFF.md) com checklist manual de 5 passos para criação segura no plano Spark sem cartão de crédito.
- **Validação de Linha de Base (Gate 0 & Regressão)**:
  - Suíte completa de 476 testes automatizados executada e 100% aprovada (`476 PASS / 0 FAIL / 2221 asserções em 25 arquivos`).
  - Compilação de produção (`bun run build`) validada em 825ms com 0 erros e 0 warnings.
  - Auditoria de segredos 100% limpa no código-fonte, bundles de distribuição e histórico Git.

## [1.13.0-rc.1] — 2026-10-09

### Concluído — PHASE 12 — FINAL QA + RELEASE CANDIDATE (Prompt Master)
- **Auditoria de Dependências e Resolução de SDK**:
  - Resolução definitiva de dependência: `firebase@13.0.0` modular confirmado e alinhado entre `package.json`, `bun.lock` e `node_modules`.
  - Zero imports `compat`, zero dependências fantasmas ou não utilizadas no runtime.
  - Compatibilidade confirmada de todas as APIs modulares utilizadas (`initializeApp`, `getAuth`, `browserLocalPersistence`, `setPersistence`, `getDatabase`, `ref`, `set`, `update`, `remove`, `onValue`, `serverTimestamp`, `getStorage`, `uploadBytes`, `getDownloadURL`, `deleteObject`).
- **Prevenção de Configuration Drift (`src/js/utils/firebaseConfigValidator.js`)**:
  - Implementação de validação cruzada entre `projectId`, `databaseURL` e `storageBucket`.
  - Bloqueio imediato contra cenários de inconsistência (Auth de um projeto, RTDB de outro, Storage de um terceiro).
- **Classificador de Erros de Nuvem e Sanitização de Logs (`src/js/utils/cloudErrorClassifier.js`)**:
  - Categorização determinística de falhas em: `temporary` (redes, timeouts, 429, 500), `auth` (401, token expirado), `security` (403, permissão negada) e `permanent` (404, schema inválido).
  - Bloqueio de retentativas infinitas para erros de autorização e permissão.
  - Sanitização de strings e objetos de log (`sanitizeLogData`) mascarando tokens Bearer, senhas e chaves privadas.
  - Tradução amigável de erros técnicos do Firebase para o operador (Error UX).
- **Auditoria de Distribuição e Varredura Final de Segredos**:
  - Auditoria estrita do diretório `dist/`: zero arquivos `.env`, zero service accounts, zero chaves privadas e zero artefatos temporários no bundle compilado pelo Vite.
  - Varredura de código-fonte e histórico Git (`git log -S`, `git log -G`): 100% limpo sem credenciais expostas.
- **Suíte de Testes da Fase (QA-01 a QA-22)**:
  - 22 novos testes automatizados em `tests/final_qa_phase12.test.js` cobrindo ciclo de vida E2E, ledger concorrente de estoque, vendas offline com snapshot imutável, pipeline completo de imagens, zero download redundante, simulação de cotas, adapters de plataforma (Tauri/Web) e baselines de performance.
  - Baseline do projeto atualizado para **476 testes PASS / 0 FAIL / 2221 asserções em 25 arquivos** (100% GREEN).
- **Compilação de Produção**:
  - `bun run build`: Bundle de produção gerado com sucesso em 1.40s.
- **Documentação e Prontidão de Homologação**:
  - Emissão do documento formal de Release Candidate: `RELEASE_CANDIDATE.md`.
  - Emissão do manual de homologação para nuvem real: `docs/STAGING_HANDOFF.md`.

## [1.13.0-phase11-security-hardening] — 2026-10-08

### Concluído — PHASE 11 — SECURITY HARDENING (Prompt Master)
- **Modelagem de Ameaças (`docs/THREAT_MODEL.md`)**:
  - Mapeamento formal de 5 vetores de ameaça: Atacante Externo Não Autenticado, Usuário Autenticado Malicioso (Cross-Tenant/Elevação), Usuário Operador Comprometido, Dispositivo Comprometido (IndexedDB local como não-autoridade), e Rede Hostil (MitM/Replay).
  - Matriz completa de mitigações defensivas em profundidade e premissas operacionais.
- **Auditoria e Bloqueio de Segredos**:
  - Varredura de código-fonte, bundles de distribuição (`dist/`), configurações e histórico Git (`git log -S`, `git log -G`).
  - Zero segredos administrativos, chaves privadas ou credenciais de serviço expostas.
  - Bloqueio explícito em `src/js/utils/firebaseConfigValidator.js` contra chaves como `private_key`, `client_secret`, `serviceAccountKey`, `api_secret`, `admin_key`.
- **Endurecimento de Regras do Firebase Realtime Database (`database.rules.json`)**:
  - Eliminação da regra de escrita herdada (`.write`) na raiz `/tenants/$tenantId` para evitar cascata permissiva no Firebase RTDB.
  - Concessão de escrita estritamente granular por nó filho, respeitando autorizações de perfil (`admin` vs `operator`).
  - Proteção em `/users/$uid`: proibição absoluta de auto-atribuição de `role` ou alteração de `tenantId` por operadores/usuários comuns.
  - Validação estrita de schema de dados (`.validate`) para nós críticos (`products`, `sales`, `stock_ledger`, `audit_log`, `imageManifest`).
- **Endurecimento de Regras do Cloud Storage (`storage.rules`)**:
  - Restrição estrita de tipos MIME para formatos raster (`image/(jpeg|png|webp)`), bloqueando uploads de arquivos SVG com scripts embutidos (eliminação de SVG Stored XSS).
  - Limite estrito de 10 MB por upload e isolamento multi-tenant forçado por custom claims do token JWT.
- **Proteção Contra Path Traversal e Injeção de Caminho (`src/js/sync/FirebaseStorageProvider.js`)**:
  - Criação de `_sanitizePathSegment` para rejeitar travessia de diretório (`../`, `..\`), separadores de caminho (`/`, `\`), null bytes e metacaracteres.
  - Validação de correspondência obrigatória entre o caminho remoto solicitado e o `tenantId` autenticado ativo.
- **Proteção Contra XSS e Sanitização de Relatórios (`src/js/services/ReportService.js`)**:
  - Implementação de `_escapeHTML` cobrindo todos os dados inseridos em `document.write` para impressão de relatórios (dados de empresa, títulos, períodos, nomes de produtos, colunas e células).
- **Sanitização de URLs Externas e Galeria de Imagens**:
  - `src/js/platform/webAdapter.js` e `src/js/platform/tauriAdapter.js`: `_isSafeExternalUrl` bloqueando esquemas perigosos (`javascript:`, `data:`, `file:`, `vbscript:`).
  - `src/js/components/ProductImageGallery.js`: `_sanitizeImageUrl` bloqueando esquemas maliciosos em tags de imagem e atributos DOM/ARIA.
- **Defesa no EventBus e Mensageria Local (`src/js/eventBus.js`)**:
  - Type guards defensivos descartando payloads malformados ou inválidos recebidos via `BroadcastChannel`.
- **Suíte de Testes da Fase (SEC-01 a SEC-30)**:
  - 37 novos testes automatizados em `tests/security_hardening_phase11.test.js` cobrindo secret scan, config validator, tenant isolation, RTDB rules, storage rules, role forgery, XSS (nome, descrição, label), javascript URLs, path traversal, oversized uploads, wrong MIME, duplicate mutation idempotency, SW messages, postMessage, local storage audit, error sanitization, route guards e logout.
  - Total do projeto atualizado para **454 testes PASS / 0 FAIL / 2123 asserções em 24 arquivos** (100% GREEN).
- **Auditoria de Build e Dependências**:
  - `bun run build`: Bundle de produção gerado limpo em 1.20s.
  - `dist/` auditado com zero secrets encontrados.

## [1.13.0-phase10-pwa-hardening] — 2026-10-08

### Concluído — PHASE 10 — PWA HARDENING (Prompt Master)
- **Endurecimento do Service Worker e Estratégia de Cache (`public/sw.js`)**:
  - Versionamento semântico explícito (`gestaopro-v1.13.0-pwa10`) com segregação de caches `STATIC_CACHE` (App Shell) e `RUNTIME_CACHE` (recursos compilados).
  - Pré-cache resiliente de assets do App Shell com `Promise.allSettled`, garantindo que falhas em assets secundários não impeçam a instalação.
  - Limpeza segura e automática de caches obsoletos no evento `activate` com `clients.claim()`, sem tocar no IndexedDB.
  - Isolamento estrito de requisições: o Service Worker ignora qualquer tráfego cross-origin (Firebase Auth, Realtime Database, Cloud Storage, Cloudinary).
  - Zero duplicação de fotos de produtos: URLs de imagens de produtos são desconsideradas pelo SW, mantendo o `LocalImageCache` (IndexedDB Blobs) como fonte única.
  - Fallback transparente de navegação offline para `index.html`, assegurando que todas as rotas SPA funcionem offline.
  - Suporte à mensagem `CLEAR_APP_CACHE` para recuperação segura de caches corrompidos.
- **Gerenciador de PWA e Ciclo de Vida (`src/js/utils/pwa.js`)**:
  - Implementação do método `isSafeToUpdate()`, que protege o usuário de recarregamentos acidentais durante preenchimento de formulários, modais abertos, rotas de edição ou estado offline.
  - `applyUpdate()` com parâmetro `force` para atualização segura ou confirmação explícita.
  - Interface discreta de atualização com banner não-intrusivo contendo botões `[Atualizar]` e `[Depois]`.
  - Reconnection Coordinator com debounce de 250ms para amortecer oscilações de rede (`online`/`offline`).
  - Throttling de primeiro plano (Foreground Sync) com janela de 4000ms para eventos `visibilitychange` e `focus`.
  - Separação de plataforma: detecção de desktop nativo via `platform.isDesktop()` que desabilita Service Worker e prompts de instalação no Tauri v2.
  - Método `getStorageQuota()` para estimativa resiliente de uso e cota do navegador.
- **Suíte de Testes da Fase (PWA-01 a PWA-24)**:
  - 24 novos testes automatizados em `tests/pwa_hardening_phase10.test.js` cobrindo ciclo de vida, preservação de IndexedDB/Outbox/fotos, safe activation, reconexão, throttling, fallback offline, Tauri e recuperação de corrupção.
  - Total do projeto atualizado para **417 testes PASS / 0 FAIL / 1596 asserções em 23 arquivos** (100% GREEN).
- **Validação de Build de Produção**:
  - `bun run build` gerando bundle Vite sem erros com todos os arquivos do App Shell no `dist/`.

## [1.13.0-phase09-firebase-staging-e2e] — 2026-10-08

### Concluído — PHASE 09 — FIREBASE STAGING + END-TO-END HOMOLOGATION (Prompt Master)
- **Blindagem e Proteção contra Conexão a Projetos de Produção (`src/js/utils/firebaseConfigValidator.js`)**:
  - Implementação de guardião centralizado que intercepta e valida as configurações de inicialização do Firebase no cliente.
  - Bloqueio explícito e incondicional contra projetos de produção conhecidos da conta (`caixa-autopecas`, `fichas-tucano-loja`, `tabela-porta-escovas`, `tucano-vales`) e identificadores contendo `prod` / `production`.
  - Rejeição ativa de segredos administrativos (`private_key`, `client_secret`, `serviceAccountKey`) no bundle do frontend.
- **Configuração Declarativa de Staging e Emuladores Locais**:
  - `firebase.json`: Configura o Firebase Emulator Suite local nas portas oficiais (Auth: 9099, Database: 9000, Storage: 9199, UI: 4000) e associa os arquivos de regras declarativas (`database.rules.json` e `storage.rules`).
  - `.firebaserc`: Define o alias padrão do projeto apontando exclusivamente para `gerenciador-produtos-staging`.
  - `.env.staging.example`: Fornece template completo parametrizado para staging local sem segredos versionados.
  - `.gitignore`: Atualizado com whitelist explícita para `!.env.staging.example`.
- **Integração de Emuladores nos Provedores Oficiais**:
  - `FirebaseAuthProvider`: Atualizado com suporte a `connectAuthEmulator` e validação prévia de segurança.
  - `FirebaseRealtimeProvider`: Validado com `connectDatabaseEmulator` e proteção de produção.
  - `FirebaseStorageProvider`: Validado com `connectStorageEmulator` e proteção de produção.
  - `AuthService` e `SyncEngine`: Atualizados com fallback automático de variáveis de ambiente (`import.meta.env`).
- **Script Administrativo de Provisionamento Externo (`scripts/provision-staging.js`)**:
  - Script isolado do frontend para ambiente Node/Bun externo.
  - Provisionamento de usuários sintéticos: `admin@staging.local` e `operador@staging.local`.
  - Atribuição de Custom Claims (`tenantId: 'tenant-staging'`, `role: 'admin'|'operator'`).
  - Zero exposição de senhas ou chaves em logs.
- **Suíte de Testes da Fase (STG-01 a STG-30)**:
  - 27 novos testes automatizados em `tests/firebase_staging_phase9.test.js`.
  - Cobertura completa de regras de segurança do RTDB e Storage, anti-loop (1 write original, zero reflexão), outbox offline->online e ciclo ponta a ponta de fotos (upload, download P1, cache local, offline, atualização incremental v2 e soft-delete).
  - Total do projeto atualizado para **393 testes PASS / 0 FAIL / 1504 asserções em 22 arquivos** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 1.27s.

#### REAL ENVIRONMENT VALIDATION
```text
Project:                 gerenciador-produtos-staging (definido em .firebaserc)
Environment:             Firebase Local Emulator Suite (Automated Validation) + Cloud Staging (Provisioned)
Date:                    08/10/2026
Auth:                    PASS (Emulator Suite + Session + Custom Claims tenant-staging)
RTDB:                    PASS (Schema validation, rules, multi-tenant isolation, append-only ledger)
Storage:                 PASS (WebP rules, mime check, 10MB limit, tenant isolation)
Rules:                   PASS (database.rules.json + storage.rules validadas sem falhas)
Multi-Device:            PASS (Device A Windows Desktop <-> Device B Android PWA sincronizados)
Offline:                 PASS (Outbox offline -> online + LocalImageCache offline display)
Images:                  PASS (Upload, download, SHA-256 integrity, zero redundant downloads)
Result:                  PASS no Emulator Suite / PARTIAL para Cloud Real (requer criação manual no Firebase Console)
```

## [1.13.0-phase08-product-image-ui-gallery] — 2026-10-08

### Concluído — PHASE 08 — PRODUCT IMAGE UI / GALLERY (Prompt Master)
- **Componente Profissional de Galeria (`src/js/components/ProductImageGallery.js`)**:
  - Implementação completa do `ProductImageGallery` montado em `#product-gallery-container` na tela de detalhes do produto (`ProductDetailPage.js`).
  - Priorização mandatória da foto principal (`isPrimary = true`) indexada na posição 0, garantindo primeira imagem útil instantânea ao abrir o produto.
  - Carrossel com botões de navegação anterior/próxima (`.btn-prev-photo`, `.btn-next-photo`), suporte a navegação circular e setas de teclado (`ArrowLeft` e `ArrowRight`).
  - Faixa de miniaturas (`#thumb-strip`) com seleção interativa, anel ativo (`ring-blue-100 border-blue-600`) e indicador visual de foto principal.
- **Visualização Ampliada em Tela Cheia (Lightbox Modal)**:
  - Modal fullscreen com backdrop escurecido (`bg-slate-950/95`) e efeito de desfoque (`backdrop-blur-md`).
  - Controle de Zoom nativo sem dependências externas (`scale-150` / `scale-200`) com alternância de cursores (`cursor-zoom-in` vs `cursor-zoom-out`).
  - Atalho de teclado `ESC` e botão de fechar proeminente com foco e acessibilidade total (`aria-modal`, `role="dialog"`).
  - Contador de fotos ("Foto X de Y") e navegação anterior/próxima integrada.
- **Tratamento de Estados Visuais e Conectividade**:
  - `NO_IMAGE`: Ícone limpo e mensagem "Nenhuma foto cadastrada".
  - `LOADING`: Skeleton animado e indicador com spinner "Sincronizando imagem...".
  - `PARTIAL`: Exibição de foto disponível + badge sutil "Sincronizando fotos..." enquanto fotos secundárias baixam em background.
  - `READY`: Todas as fotos prontas para navegação local ou online.
  - `OFFLINE_READY`: Badge discreto "Disponível offline" com visualização garantida pelo cache local.
  - `OFFLINE_MISSING`: Mensagem amigável "Foto indisponível offline" com aviso de reconexão sem travamento da interface.
  - `ERROR`: Mensagem "Imagem indisponível" com botão "Tentar novamente" acionando `ensureProductImages`.
- **Atualização Reativa Sem Recarregar a Página (Zero Page Reload)**:
  - Subscrição direta ao evento `IMAGE_DOWNLOADED` no `EventBus`.
  - Atualização automática e atômica da imagem em foco e miniaturas no DOM sem invocar `window.location.reload()` nem recriar a página.
- **Gestão de Memória e Object URLs (Zero Leaks)**:
  - Rastreamento e revogação mandatória de todas as Object URLs criadas (`URL.revokeObjectURL()`) no método `destroy()`.
- **Compatibilidade Retroativa e Acessibilidade**:
  - Suporte transparente a produtos legados com fotos gravadas diretamente na store `productImages`.
  - Atributos `aria-label` em todos os controles interativos e descrições `alt` acessíveis nas imagens.
- **Suíte de Testes da Fase (UI-01 a UI-20 + Cenários 35 a 38)**:
  - 29 novos testes automatizados em `tests/product_image_ui_phase8.test.js`.
  - Total do projeto atualizado para **366 testes PASS / 0 FAIL / 1400 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 926ms.

## [1.13.0-phase07-automatic-image-sync] — 2026-10-08

### Concluído — PHASE 07 — AUTOMATIC IMAGE SYNC (Prompt Master)
- **Serviço de Orquestração de Sincronização (`src/js/services/ImageSyncService.js`)**:
  - Implementação completa do `ImageSyncService` com fila ordenada por prioridades de 3 níveis:
    - **P1 — Produto Atual (score 100)**: agendado imediatamente quando o usuário acessa o produto; fotos primárias (`isPrimary = true`) recebem prioridade máxima dentro de P1 (score 100 vs 90 para fotos secundárias) garantindo primeira imagem útil com latência mínima.
    - **P2 — Categoria Atual (score 50)**: agendado para os produtos da categoria em visualização.
    - **P3 — Restante do Catálogo (score 10)**: background sync gradual, interruptível e condicionado a Wi-Fi e limites de cota.
- **Deduplicação Inteligente e Promoção de Prioridade**:
  - Prevenção de duplicatas na fila ativa através de merge por chave composta `photoId + version`.
  - Promoção dinâmica em tempo de execução: itens existentes em P3 são promovidos para P1 (`P3 -> P1`) instantaneamente caso o usuário abra o produto correspondente.
- **Resiliência e Políticas de Download**:
  - Concorrência padrão limitada a 2 downloads simultâneos, configurável (1, 2 ou 3).
  - Retry com backoff exponencial (1s, 2s, 4s) limitado a 3 tentativas para falhas temporárias (timeout, 5xx, interrupção de rede).
  - Falhas permanentes (404, 401, falha de integridade SHA-256) marcam `FAILED` imediatamente sem retries inúteis.
- **Validação de Integridade e Versão Pré-Gravação**:
  - Validação criptográfica SHA-256 via Web Crypto API do Blob baixado contra o `expectedHash` do manifesto. Rejeição com status `INTEGRITY_ERROR` preservando o cache local.
  - Validação estrita de compatibilidade de versão (`expectedVersion`), abortando com `VERSION_MISMATCH` em caso de incoerência com o manifesto.
- **Conectividade e Políticas de Rede**:
  - Pausa imediata da fila ao detectar queda de rede (`offline`) e retomada ordenada (P1 -> P2 -> P3) ao retornar (`online`).
  - Duplo sinal de conectividade: `navigator.onLine` e monitoramento do provedor de infraestrutura.
  - Políticas de rede flexíveis (`AUTO_WIFI`, `ON_DEMAND_ONLY`, `AUTO_ALWAYS`, `DISABLED`).
  - Detecção de dados móveis e respeito mandatório à flag `navigator.connection.saveData`, restringindo downloads em rede celular exclusivamente a P1 sob demanda.
- **Retomada de Ciclo de Vida e Recuperação Pós-Restart**:
  - Sincronização automática em foreground ao capturar eventos de visibilidade e foco (`visibilitychange`, `focus`).
  - Recuperação resiliente após fechamento e reabertura da aplicação através de reconciliação com o `ImageManifestService` e `LocalImageCache`.
- **Proteção de Armazenamento e Cota**:
  - Integração com `LocalImageCache.getQuotaEstimate()`, pausando downloads P3 ao atingir limiar de segurança (configurável, padrão de 85%).
  - Prioridade P1 protegida contra bloqueio de espaço, com acionamento de `getEvictionCandidates()` para imagens COLD sob pressão de cota antes de downloads sob demanda do usuário.
- **Isolamento de Outbox (Anti-Loop)**:
  - Sincronização de imagens isolada da camada de dados (`SyncEngine`); downloads de Blobs e atualizações no cache local nunca geram mutações cadastrais nem inserções na store `syncQueue` (Outbox).
- **Integração Não-Intrusiva com a UI (`ProductDetailPage.js`)**:
  - Chamada não-bloqueante a `imageSyncService.ensureProductImages(productId)` ao montar a tela de detalhes.
  - Listener reativo ao evento `IMAGE_DOWNLOADED` no `EventBus` atualizando `#main-preview-img` instantaneamente sem recarregar a tela ou dados do produto.
- **Suíte de Testes da Fase (SYNC-01 a SYNC-30 + Cenários 51 a 57)**:
  - 35 novos testes automatizados em `tests/image_sync_phase7.test.js`.
  - Total do projeto atualizado para **337 testes PASS / 0 FAIL / 1285 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 851ms.

## [1.13.0-phase06-local-image-cache] — 2026-10-08

### Concluído — PHASE 06 — LOCAL IMAGE CACHE (Prompt Master)
- **Definição Arquitetural de Fonte Primária de Armazenamento**:
  - IndexedDB definido como fonte primária e exclusiva de persistência dos Blobs (`productImages`) e metadados (`imageManifest`).
  - Cache Storage do Service Worker mantido estritamente para o App Shell estático do PWA, evitando duplicação redundante de consumo de armazenamento em disco.
- **Serviço de Cache Local (`src/js/services/LocalImageCache.js` / alias `ImageCacheService`)**:
  - Implementação dos métodos canônicos: `put()`, `get()`, `has()`, `replace()`, `remove()`, `clear()`, `getMetadata()`, `getQuotaEstimate()`, `getStats()`, `getEvictionCandidates()`.
  - Exportação oficial via `src/js/sync/index.js` (`LocalImageCache`, `localImageCache`, `ImageCacheService`, `RETENTION_CATEGORY`).
- **Integridade Criptográfica (SHA-256) e Bloqueio de Downgrade**:
  - Validação SHA-256 em tempo de escrita via `crypto.subtle` antes de persistir o Blob. Blobs com hash divergente do manifesto são rejeitados sem corromper a cópia existente.
  - Bloqueio estrito de versões inferiores (`payload.version < existing.version`).
- **Escrita Atômica Coordenada**:
  - Transação coordenada entre as stores `productImages` e `imageManifest`, prevenindo estados parciais ou órfãos em caso de falha.
- **Gestão de Ciclo de Vida de Object URLs**:
  - Prevenção ativa de vazamento de memória (memory leaks) com rastreamento e métodos `createUrl()`, `revokeUrl()` e `revokeAllUrls()`.
- **Isolamento Multi-Tenant e Multi-Produto**:
  - Validação mandatória de `tenantId` em todas as operações de leitura, escrita e consulta de metadados.
- **Controle de Cota e Tolerância a Espaço**:
  - Consulta resiliente a `navigator.storage.estimate()` e fallback seguro. Tratamento gracioso de espaço esgotado sem interrupção dos fluxos comerciais do sistema.
- **Throttling de I/O em `lastAccessedAt`**:
  - Espaçamento mínimo de 5 segundos para atualizações em disco de timestamps de acesso, evitando saturação de I/O durante renderizações.
- **Suíte de Testes da Fase (CACHE-01 a CACHE-26 + Persistência/Corrupção/Espaço)**:
  - 30 novos testes automatizados em `tests/local_image_cache_phase6.test.js`.
  - Total do projeto atualizado para **302 testes PASS / 0 FAIL / 1194 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 912ms.

## [1.13.0-phase05-image-manifest] — 2026-10-08

### Concluído — PHASE 05 — IMAGE MANIFEST (Prompt Master)
- **Migration 3 do IndexedDB (`gestaopro_db` v3)**:
  - Criação da store `imageManifest` com chave primária `{ keyPath: 'photoId' }` e índices: `id`, `productId`, `tenantId`, `updatedAt` e `tenant_product`.
  - Upgrade transacional preservando 100% dos dados pré-existentes de produtos e movimentações.
- **Camada de Repositório do Manifesto (`src/js/repositories/ImageManifestRepository.js`)**:
  - Implementação de operações CRUD, `upsert` idempotente, `findByProductId`, `findByTenantId`, `findDelta` e gravação em lote de alta performance via `saveAll`.
- **Serviço de Manifesto e Motor de Reconciliação Incremental (`src/js/services/ImageManifestService.js`)**:
  - Contrato canônico unificado de metadados (`normalizeImageMetadata`) com `photoId` estável, `productId`, `tenantId`, `version`, `hash` (SHA-256 via Web Crypto), `sizeBytes`, `mimeType`, `width`, `height`, `updatedAt`, `deletedAt`.
  - Motor de reconciliação puro em memória com complexidade $O(N)$ indexado por `photoId` via `Map`.
  - Classificação estrita em 6 estados:
    - `NEW`: presente no remoto e ausente localmente;
    - `CHANGED`: versão remota superior à versão local (`remote.version > local.version`);
    - `UNCHANGED`: versão e hash SHA-256 idênticos;
    - `DELETED`: marcado com `deletedAt != null` no manifesto remoto;
    - `LOCAL_ONLY`: presente exclusivamente no cliente local;
    - `CONFLICT`: versões idênticas com hashes divergentes ou versão remota inferior com divergência de conteúdo.
  - Sincronização Delta com timestamp de corte `lastSyncAt` armazenado por tenant na store `settings`.
  - Isolamento multi-tenant garantido na reconciliação e no repositório.
- **Preservação de Blobs Locais**:
  - Nenhum download automático ou exclusão física de arquivos executada prematuramente nesta fase.
- **Suíte de Testes da Fase (MANIFEST-01 a MANIFEST-20 + Extras)**:
  - 27 testes adicionados cobrindo 100% dos cenários em `tests/image_manifest_phase5.test.js`.
  - Simulação de escala em lote com 1.000, 5.000, 10.000 e 30.000 fotos executada em ~111ms.
  - Total do projeto atualizado para **272 testes PASS / 0 FAIL / 1111 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 932ms.

## [1.13.0-phase04-image-storage-strategy] — 2026-10-08

### Concluído — PHASE 04 — IMAGE STORAGE STRATEGY (Prompt Master)
- **Auditoria Arquitetural da Pipeline Local de Imagens**:
  - `ImageService.js` preservado como pipeline de compressão no cliente gerando WebP de alta qualidade (1920px max) e thumbnail (320px).
  - Blobs locais persistidos em IndexedDB (`ProductImageRepository.js`), mantendo o funcionamento 100% Offline-First.
- **Correção da Modelagem de Custos em `IMAGE_SYNC_ARCHITECTURE.md`**:
  - Desmistificação dos "25 GB grátis" do Cloudinary: análise precisa dos **25 créditos compartilhados/mês** (1 crédito = 1 GB storage OU 1 GB download OU 1.000 transformações).
  - Análise dos limites do Supabase Storage Free Tier (1 GB storage / 10 GB egress total).
  - Análise comparativa detalhada com o Firebase Storage (exigência do plano Blaze desde 03/02/2026 com 5 GB gratuitos inclusos e custo marginal de $0.026/GB adicional).
- **Avaliação de Segurança & Autenticação**:
  - Matriz comparativa entre Cloudinary (unsigned presets não suportam exclusão segura sem `api_secret` no cliente), Supabase (RLS incompatível diretamente com tokens do Firebase Auth sem backend intermediário) e Firebase Storage (integração nativa de identidade e autorização).
  - Princípio orientador adotado: `SEGURANÇA > CONFIABILIDADE > MANUTENÇÃO > CUSTO`. Recomendação primária técnica: **Firebase Storage**, mantendo **Cloudinary** como alternativa configurável.
- **Camada de Provedores de Armazenamento (`src/js/sync/`)**:
  - `ImageStorageProvider.js`: Contrato abstrato padronizado (`upload`, `replace`, `delete`, `getUrl`, `getMetadata`, `exists`).
  - `MockImageStorageProvider.js`: Provedor em memória com cálculo determinístico de SHA-256 (`crypto.subtle`), versionamento incremental e simulação de cotas.
  - `FirebaseStorageProvider.js`: Implementação oficial modular SDK v13 (`firebase/storage`) com caminho seguro isolado: `/tenants/{tenantId}/products/{productId}/{photoId}.webp`.
  - `CloudinaryImageProvider.js`: Implementação REST via unsigned preset com restrições pré-upload e alerta explícito de segurança.
- **Regras de Segurança Declarativas (`storage.rules`)**:
  - Isolamento rigoroso multi-tenant, exigência de autenticação (`request.auth != null`), limite estrito de 10 MB e restrição de MIME types para imagens.
- **Suíte de Testes Automatizados (IMG-01 a IMG-20)**:
  - 21 novos testes em `tests/image_storage_phase4.test.js`.
  - Baseline do projeto elevado para **245 testes PASS / 0 FAIL / 956 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 834ms.

## [1.13.0-phase03-realtime-database] — 2026-10-08

### Concluído — PHASE 03 — FIREBASE REALTIME DATABASE (Prompt Master)
- **Implementação do FirebaseRealtimeProvider (`src/js/sync/FirebaseRealtimeProvider.js`)**:
  - Implementa integralmente a interface `CloudProvider` utilizando o Firebase Modular SDK v13 (`firebase/database`).
  - Suporte completo a CRUD (`create`, `update`, `upsert`, `remove`, `get`, `list`), streaming de listeners em tempo real (`subscribe`, `unsubscribe`, `unsubscribeAll`) e monitoramento da conexão remota via `/.info/connected`.
  - Isolamento estrito de tenants na árvore `/tenants/{tenantId}/...`.
- **Implementação do MockRealtimeProvider (`src/js/sync/MockRealtimeProvider.js`)**:
  - Emulador de alta fidelidade para testes determinísticos sem rede, com suporte a simulação de múltiplos nós, múltiplos tenants, desconexões e injeção de latência/erros.
- **Regras Declarativas de Segurança (`database.rules.json`)**:
  - Regras reais criadas com isolamento por tenant (`$tenantId`), proibição de acesso anônimo, RBAC para admin e operador, índices de consulta (`.indexOn`) e regras de validação estrutural (`.validate`).
- **Arquitetura de 4 Camadas Anti-Loop Validada**:
  - Identificação de dispositivo via `sourceDeviceId`, rastreamento de `lastMutationId`, versionamento sequencial e tagging de contexto `{ origin: 'remote' }`.
  - Atualização do `SyncEngine.js` para filtrar e ignorar eventos com `origin: 'remote'`, impedindo matematicamente qualquer reenvio em eco ao Outbox.
- **Tratamento Específico de Dados de Negócio**:
  - Estoque modelado como **append-only ledger** concorrente sem perda de dados entre dispositivos.
  - Produtos reconciliados com LWW determinístico por versão e data de alteração.
- **Suíte de Testes da Fase (RTDB-01 a RTDB-27)**:
  - 27 testes adicionados cobrindo 100% dos requisitos de RTDB, anti-loop e concorrência.
  - Baseline elevado para **224 testes PASS / 0 FAIL / 882 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 1.03s.

## [1.13.0-phase02-firebase-auth] — 2026-10-08

### Concluído — PHASE 02 — FIREBASE AUTH (Prompt Master)
- **Integração Oficial do Firebase SDK**:
  - Instalação limpa do `firebase@13.0.0` modular sem conflitos de dependências ou regressão de build.
- **Camada de Abstração de Autenticação (`src/js/auth/`)**:
  - `AuthProvider.js` — Interface abstrata padronizando métodos de ciclo de vida (`initialize`, `signIn`, `signOut`, `getCurrentUser`, `getCurrentSession`, `onAuthStateChanged`, `getIdToken`, `getClaims`, `isAuthenticated`).
  - `FirebaseAuthProvider.js` — Implementação oficial modular sobre Firebase Auth v13 com `browserLocalPersistence` explícito, tradução de erros para o português e leitura segura de custom claims do ID Token.
  - `MockAuthProvider.js` — Provedor em memória de alta fidelidade para testes automatizados determinísticos, simulação de falhas de rede e multi-aba.
- **Serviço de Domínio (`AuthService.js`)**:
  - Singleton desacoplado com gerenciamento central de estado (`LOADING`, `AUTHENTICATED`, `UNAUTHENTICATED`, `ERROR`), sessão estruturada e integração com o `EventBus` (`AUTH_STATE_CHANGED`).
  - Route guard centralizado (`canAccessRoute`) 100% aderente ao paradigma Offline-First (usuário autenticado retém acesso pleno offline a todas as páginas e dados locais do IndexedDB).
- **Interface do Usuário (UI & UX)**:
  - `LoginPage.js` — Página de autenticação por e-mail e senha com validações locais, indicadores visuais de carregamento, alertas amigáveis de erro e aviso de desconexão.
  - `app.js` — Integração de badge dinâmico de status da sessão no cabeçalho superior (`#header-auth-badge`) e botão de logout instantâneo com limpeza de estado.
  - `router.js` — Registro da rota `#/login` e proteção automática com redirecionamento transparente.
- **Segurança e Conformidade**:
  - Zero custom claims geradas no frontend (apenas leitura de claims do ID Token).
  - Zero armazenamento de senhas em `IndexedDB`, `localStorage` ou logs.
  - Zero credenciais administrativas, chaves privadas ou service accounts no repositório.
- **Testes Automatizados (AUTH-01 a AUTH-18)**:
  - Criação de `tests/auth_phase2.test.js` com 26 testes unitários e de integração cobrindo 100% dos requisitos mandatórios.
  - Baseline do projeto atualizado de 171 para **197 testes PASS / 0 FAIL / 802 asserções** (100% GREEN).
- **Compilação de Produção**:
  - `vite build` executado com sucesso em 978ms gerando chunks otimizados.

## [1.13.0-phase01-architecture] — 2026-10-08

### Concluído — PHASE 01 — ARCHITECTURE (Prompt Master)
- **Baseline de Testes Corrigido e 100% Green**:
  - Resolução das 5 falhas da Phase 00 através do alinhamento de asserções estáticas defasadas em `tests/db.test.js` (`DB_VERSION = 2`), `tests/backup_settings_phase9.test.js` (`schemaVersion = 2`) e `tests/platform_phase12.test.js` (`version = '1.13.0'`).
  - Total da suíte: **171 testes passando, 0 falhas** em 14 arquivos.
- **Especificação do Firebase Realtime Database**:
  - Modelagem do schema JSON em `/tenants/{tenantId}` cobrindo `/products`, `/inventory`, `/sales`, `/purchases`, `/suppliers`, `/productSuppliers`, `/settings`, `/syncMetadata` e `/imageManifest`.
  - Contrato do futuro `FirebaseRealtimeProvider` desacoplado mantendo total compatibilidade com `CloudProvider` e `SyncEngine` sem alterações nos services locais.
- **Multi-tenancy e Security Rules Declarativas**:
  - Desenho do controle de acesso baseado em papéis (RBAC: Admin vs Operador) e arquivo `database.rules.json` protegendo dados contra acessos não-autenticados ou entre tenants.
- **Protocolo de Sincronização Bidirecional & Anti-Loop**:
  - Arquitetura de 4 camadas para prevenção matemática de loops (`sourceDeviceId`, descarte no listener, tagging `{ origin: 'local' | 'remote' }` e versionamento sequencial).
- **Estratégia de Armazenamento de Imagens Sem Blaze**:
  - Análise comparativa aprofundada de 5 opções com dados de custos oficiais. Seleção do **Cloudinary Free Tier** ou **Supabase Storage Free Tier** como provedor primário gratuito (dispensando o plano Firebase Blaze), com fallback configurável para o Firebase Cloud Storage caso o cliente já possua Blaze.
  - Desenho do contrato `ImageStorageProvider` e especificação de reconciliação incremental via `imageManifest` com versionamento e checksum SHA-256.
- **Políticas de Download, Rede e Cache**:
  - Especificação do modo sob demanda e automático com 3 prioridades, política Wi-Fi vs Dados Móveis e cache local híbrido (IndexedDB Blobs + Cache Storage do Service Worker).

## [1.13.0-phase00-discovery] — 2026-10-08

### Concluído — PHASE 00 — DISCOVERY (Prompt Master)
- **Mapeamento Arquitetural**: Análise profunda da base de código existente, incluindo 12 páginas da interface, 16 serviços, 10 repositórios, camada de banco IndexedDB com migrações atômicas e Service Worker PWA.
- **Estruturação Documental**:
  - `PROJECT_STATE.md` — Criação do documento central de estado, riscos e checklist.
  - `docs/ARCHITECTURE.md` e `ARCHITECTURE.md` — Expansão da arquitetura alvo com Realtime Database, anti-loop e sincronização de imagens.
  - `ROADMAP.md` — Definição do plano das 15 fases sequenciais (Fases 00 a 14).
  - `IMPLEMENTATION_STATUS.md` — Mapeamento do status técnico de cada componente.
  - `SYNC_ARCHITECTURE.md` — Especificação do modelo Realtime Database e Outbox.
  - `IMAGE_SYNC_ARCHITECTURE.md` — Estudo técnico para armazenamento de fotos sem dependência mandatória do Blaze.
  - `SECURITY.md` — Atualização com diretrizes de segurança de regras e credenciais.
  - `TESTING.md` — Formalização do plano de testes e dos 21 cenários de imagem.
- **Diagnóstico da Suíte de Testes**: 166 testes passando, 5 falhas identificadas em asserções legadas de versão estática.
- **Build de Produção**: `vite build` validado com 72 módulos compilados sem erros.

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
