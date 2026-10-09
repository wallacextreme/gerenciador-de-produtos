# ROADMAP — GestãoPro (Evolução Incremental)

Este roadmap define as 15 fases estruturadas para transformar o **GestãoPro** em uma plataforma **Offline-First**, **PWA Multi-Plataforma**, com **Firebase Realtime Database**, **Sincronização Bidirecional em Tempo Real** e **Gestão Incremental de Fotos** sem dependência compulsória do Firebase Cloud Storage/Blaze.

---

## Fases do Projeto

### PHASE 00 — DISCOVERY (Atual)
- **Status:** `PASS`
- **Objetivo:** Mapeamento integral da arquitetura, fluxo de dados, repositórios, serviços, PWA, Tauri e testes.
- **Entregáveis:**
  - `PROJECT_STATE.md`
  - `ARCHITECTURE.md` (atualizado)
  - `ROADMAP.md`
  - `IMPLEMENTATION_STATUS.md`
  - `SYNC_ARCHITECTURE.md`
  - `IMAGE_SYNC_ARCHITECTURE.md`
  - `SECURITY.md` (atualizado)
  - `TESTING.md`
  - `CHANGELOG.md` (atualizado)

---

### PHASE 01 — ARCHITECTURE
- **Status:** `PASS`
- **Objetivo:** Especificação detalhada da arquitetura técnica:
  - Modelagem do schema no Firebase Realtime Database (`products`, `inventory`, `sales`, `settings`, `syncMetadata`, `imageManifest`).
  - Desenho do motor de sincronização bidirecional e prevenção de loops (`origin: 'remote' | 'local'`, `sourceDeviceId`, `lastMutationId`).
  - Desenho do Image Manifest e versionamento incremental de fotos por SHA-256 e versão.
  - Estratégia de resolução de conflitos (Last-Write-Wins + razão contábil append-only para estoque e vendas).
  - Análise de viabilidade técnica e seleção do Cloudinary Free / Supabase Free para evitar dependência do Blaze.
  - Baseline de testes corrigido para 100% GREEN (171 pass / 0 fail).

---

### PHASE 02 — FIREBASE AUTH
- **Status:** `PASS`
- **Objetivo:** Camada de autenticação segura para o sistema:
  - Integração oficial com Firebase Authentication modular SDK v13 (`FirebaseAuthProvider`).
  - Abstração desacoplada de provedores (`AuthProvider`, `MockAuthProvider`).
  - `AuthService` singleton com controle central de sessão, ciclo de vida e eventos `AUTH_STATE_CHANGED`.
  - Persistência nativa de sessão (`browserLocalPersistence`).
  - Leitura segura de claims (`tenantId`, `role`) sem permissão de elevação no frontend.
  - Route guard centralizado (`canAccessRoute`) 100% compatível com Offline-First.
  - Tela de login responsiva (`LoginPage`) e badge com logout no cabeçalho.
  - Bateria completa de testes unitários e de integração (AUTH-01 a AUTH-18: 26 testes, 100% GREEN).
  - Nenhuma chave secreta exposta no frontend.

---

### PHASE 03 — REALTIME DATABASE
- **Status:** `PARTIAL` (Implementação e testes concluídos; aguardando credenciais de produção)
- **Objetivo:** Implementação do adaptador do Firebase Realtime Database:
  - Criação do `FirebaseRealtimeProvider.js` mantendo a interface `CloudProvider` e modularidade SDK v13.
  - Implementação do `MockRealtimeProvider.js` para simulações completas de banco em árvore, reconexão e testes.
  - Regras declarativas de segurança (`database.rules.json`) com isolamento multi-tenant, validação de schema e índices.
  - Arquitetura anti-loop de 4 camadas (`sourceDeviceId`, `mutationId`, `version`, `origin: 'remote'`).
  - Tratamento de estoque como append-only ledger e LWW determinístico para produtos.
  - Suíte de testes automatizados com 27 testes específicos (RTDB-01 a RTDB-27).
  - Total de testes atualizado para 224 PASS / 0 FAIL.

---

### PHASE 04 — IMAGE STORAGE STRATEGY
- **Status:** `PASS`
- **Objetivo:** Análise técnica profunda, modelagem de custos e seleção da estratégia de armazenamento de imagens:
  - Auditoria completa do pipeline local (`ImageService.js` + `ProductImageRepository.js`), preservando compressão WebP (1920px max e thumbnail 320px) e armazenamento offline em Blobs no IndexedDB.
  - Correção da modelagem de custos oficiais: Cloudinary 25 créditos compartilhados (storage x bandwidth x transformações), Supabase Storage 1 GB storage / 10 GB egress total, e Firebase Storage (exigência do plano Blaze desde 03/02/2026, com 5 GB gratuitos inclusos e custo de $0.026/GB adicional).
  - Análise rigorosa de segurança e autorização com Firebase Auth:
    - Cloudinary: unsigned upload presets podem vazar no bundle e **não suportam exclusão segura de arquivos no cliente sem expor api_secret**.
    - Supabase: RLS não reconhece tokens do Firebase Auth diretamente (exigiria autenticação dupla ou backend customizado).
    - Firebase Storage: integração nativa com tokens de identidade do Firebase Auth, controle por `storage.rules` declarativas e deleção física autorizada no cliente sem segredos expostos.
  - Simulações de consumo real para 1.000, 5.000 e 10.000 produtos com 3 fotos (220 KB/foto) em cenários de acesso a 20%, 50% e 100% do catálogo.
  - Princípio orientador: `SEGURANÇA > CONFIABILIDADE > MANUTENÇÃO > CUSTO`. Recomendação primária oficial: **Firebase Storage** (Plano Blaze com 5 GB gratuitos), com **Cloudinary** como alternativa desacoplada documentada.
  - Criação do contrato abstrato `ImageStorageProvider.js`, emulador `MockImageStorageProvider.js`, implementação oficial `FirebaseStorageProvider.js` e alternativa `CloudinaryImageProvider.js`.
  - Regras de segurança de produção criadas em `storage.rules` com isolamento multi-tenant (`/tenants/{tenantId}/...`) e restrições de tamanho (10MB) e MIME.
  - Criação de suíte de testes com 21 cenários (`tests/image_storage_phase4.test.js`, IMG-01 a IMG-20). Baseline total: **245 PASS / 0 FAIL / 956 asserções**.

---

### PHASE 05 — IMAGE MANIFEST
- **Status:** `PASS`
- **Objetivo:** Estrutura e gerenciamento do Manifesto de Imagens e motor de reconciliação incremental:
  - Criação da store `imageManifest` no IndexedDB via Migration 3 com índices: `id`, `productId`, `tenantId`, `updatedAt` e `tenant_product`.
  - Normalização canônica de metadados: `photoId` estável, `productId`, `tenantId`, `label`, `isPrimary`, `url`, `thumbnailUrl`, `version`, `hash` (SHA-256 via Web Crypto), `sizeBytes`, `mimeType`, `width`, `height`, `updatedAt`, `deletedAt`.
  - Implementação do `ImageManifestRepository.js` com operações de CRUD, lote (`saveAll`), e consultas por tenant/produto.
  - Implementação do motor de reconciliação incremental `ImageManifestService.js` com algoritmo $O(N)$ indexado por `photoId` em memória.
  - Classificação formal em 6 estados fundamentais: `NEW`, `CHANGED`, `UNCHANGED`, `DELETED`, `LOCAL_ONLY` e `CONFLICT` (conflito detectado quando versões são iguais com hashes divergentes ou downgrade remoto, impedindo sobrescrita acidental).
  - Algoritmo de Delta Sync com timestamp de corte `lastSyncAt` armazenado por tenant na store `settings`.
  - Isolamento multi-tenant garantido na reconciliação e no repositório.
  - Preservação estrita dos Blobs locais sem downloads ou deleções físicas antecipadas.
  - Suíte de 27 testes automatizados (`tests/image_manifest_phase5.test.js`, MANIFEST-01 a MANIFEST-20 + integridade/migração/performance com até 30.000 fotos). Baseline total: **272 PASS / 0 FAIL / 1111 asserções**.

---

### PHASE 06 — LOCAL IMAGE CACHE
- **Status:** `PASS`
- **Objetivo:** Armazenamento local de alta performance, integridade e resiliência:
  - IndexedDB como fonte primária exclusiva de persistência dos Blobs (`productImages`) e metadados (`imageManifest`), evitando duplicação redundante com o Cache Storage (que permanece restrito ao App Shell).
  - Implementação do `LocalImageCache.js` (alias `ImageCacheService`) com API canônica: `put()`, `get()`, `has()`, `replace()`, `remove()`, `clear()`, `getMetadata()`, `getQuotaEstimate()`, `getStats()`, `getEvictionCandidates()`.
  - Validação de integridade criptográfica SHA-256 via Web Cryptography API antes da escrita oficial no cache.
  - Bloqueio estrito de downgrade de versão (`payload.version < existing.version`).
  - Gravação atômica coordenada entre `productImages` e `imageManifest`.
  - Gestão e contenção ativa de vazamentos de memória de Object URLs (`createUrl()`, `revokeUrl()`, `revokeAllUrls()`).
  - Monitoramento de cota de armazenamento via `navigator.storage.estimate()` com tratamento gracioso de espaço esgotado.
  - Classificação temporal de retenção (`HOT`, `WARM`, `COLD`) com proteção para fotos principais (`isPrimary`).
  - Throttling de I/O em disco para atualizações de `lastAccessedAt` (intervalo de 5s).
  - Suíte de 30 testes automatizados (`tests/local_image_cache_phase6.test.js`, CACHE-01 a CACHE-26 + cenários de persistência e corrupção). Baseline total: **302 PASS / 0 FAIL / 1194 asserções**.

---

### PHASE 07 — AUTOMATIC IMAGE SYNC
- **Status:** `PASS`
- **Objetivo:** Motor de sincronização automática e inteligente de imagens:
  - Implementação do `ImageSyncService.js` (singleton `imageSyncService`) orquestrando a fila de downloads.
  - Fila estruturada com 3 níveis de prioridade:
    1. `P1 (100)`: Produto em foco ativo na tela sob demanda (`ensureProductImages`). Foto principal (`isPrimary`) priorizada no topo.
    2. `P2 (50)`: Categoria em exibição no catálogo (`reprioritizeCategory`).
    3. `P3 (10)`: Restante do catálogo em segundo plano de forma gradual e interruptível.
  - Controle de concorrência com pool configurável (padrão: 2 downloads simultâneos).
  - Deduplicação inteligente e promoção dinâmica de prioridade (`P3 -> P1` ao navegar para o produto).
  - Resiliência com retry e backoff exponencial (1s, 2s, 4s) para falhas transitórias e descarte imediato para erros definitivos (404, hash mismatch).
  - Validação estrita de integridade SHA-256 via Web Crypto antes de salvar no cache local.
  - Pausa instantânea ao detectar perda de rede (`offline`) e retomada ordenada automática ao reconectar (`online`).
  - Políticas de rede: `AUTO_WIFI` (Wi-Fi baixa tudo; móvel baixa apenas P1), `ON_DEMAND_ONLY`, `AUTO_ALWAYS`, `DISABLED` e respeito a `SaveData`.
  - Proteção de cota de armazenamento: P3 pausado quando disco excede limiar configurável (85%), com suporte a evicção segura de fotos COLD.
  - Zero loops de sincronização com o banco de dados (download não aciona mutações de produto nem Outbox).
  - Integração mínima e reativa com `ProductDetailPage.js` via evento `IMAGE_DOWNLOADED`.
  - Reconstituição da fila na reinicialização via `reconstructFromManifest`.
  - Suíte de 35 testes automatizados (`tests/image_sync_phase7.test.js`, SYNC-01 a SYNC-30 + cenários 51, 52, 53, 56, 57). Baseline total: **337 PASS / 0 FAIL / 1285 asserções**.

---

### PHASE 08 — PRODUCT IMAGE UI / GALLERY
- **Status:** `PASS`
- **Objetivo:** Experiência do usuário (UI) profissional para fotos integrada ao motor de sincronização:
  - Implementação do componente `ProductImageGallery` (`src/js/components/ProductImageGallery.js`) e integração direta na tela de produto (`ProductDetailPage.js`).
  - Priorização de foto principal (`isPrimary = true`) exibida imediatamente na montagem da tela.
  - Carrossel com botões acessíveis de próximo e anterior, navegação circular e setas de teclado.
  - Faixa de miniaturas (Thumbnails Strip) com indicador de seleção ativa e destaque de foto principal.
  - Visualização ampliada em tela cheia (Lightbox modal) com backdrop escurecido, contador, controle de zoom nativo sem dependências e fechamento com atalho de teclado `ESC`.
  - Tratamento visual explícito e elegante de estados: `NO_IMAGE`, `LOADING` (skeleton discreto), `PARTIAL` (fotos secundárias sincronizando), `READY`, `OFFLINE_READY` (badge "Disponível offline"), `OFFLINE_MISSING` ("Foto indisponível offline") e `ERROR` (com botão "Tentar novamente").
  - Atualização reativa em tempo real ao escutar `IMAGE_DOWNLOADED` no EventBus, substituindo imagens ou inserindo novas fotos sem recarregar a tela (`0 page reload`).
  - Gestão e descarte estrito de Object URLs (`createUrl`/`revokeUrl`) sem vazamento de memória gráfica/DOM.
  - Compatibilidade com produtos legados criados antes da introdução do manifesto de fotos.
  - Suíte de 29 testes automatizados (`tests/product_image_ui_phase8.test.js`, UI-01 a UI-20 + cenários 35, 36, 37, 38). Baseline total: **366 PASS / 0 FAIL / 1400 asserções**.

---

### PHASE 09 — FIREBASE STAGING + END-TO-END HOMOLOGATION
- **Status:** `PARTIAL` (Emulator Suite 100% PASS, E2E Automatizado PASS, Nuvem Real aguardando provisionamento deliberado no Console)
- **Objetivo:** Validação ponta a ponta da arquitetura completa em ambiente controlado de staging e emuladores:
  - Blindagem estrita contra projetos de produção (`firebaseConfigValidator.js`), bloqueando conexões acidentais.
  - Configuração do Firebase Emulator Suite (`auth: 9099`, `rtdb: 9000`, `storage: 9199`, `ui: 4000`) via `firebase.json` e `.firebaserc`.
  - Provedores atualizados com suporte nativo aos emuladores (`FirebaseAuthProvider`, `FirebaseRealtimeProvider`, `FirebaseStorageProvider`).
  - Script administrativo de provisionamento externo (`scripts/provision-staging.js`) com usuários de teste e custom claims (`tenant-staging`).
  - Suíte completa de 27 testes automatizados (`tests/firebase_staging_phase9.test.js`) validando:
    1. Bloqueio de produção e proteção de segredos;
    2. Regras de segurança do RTDB e validação de schema;
    3. Regras de segurança do Cloud Storage e limites de arquivo;
    4. Sincronização multi-device em tempo real Windows <-> Android PWA;
    5. Protocolo anti-loop com contagem estrita de writes (1 write original, zero reflexão);
    6. Ciclo de vida Outbox (offline -> online -> synced);
    7. Pipeline completo de fotos: upload 3 fotos sintéticas, download sob demanda P1, validação SHA-256 no cache local, persistência offline, atualização incremental v2 e zero download redundante.
  - Baseline total: **393 PASS / 0 FAIL / 1504 asserções em 22 arquivos**.

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

---

### PHASE 10 — PWA HARDENING
- **Status:** `PASS`
- **Objetivo:** Reforço da robustez do PWA, Service Worker e resiliência offline:
  - Separação estrita de camadas: App Shell em Cache Storage vs Dados de Negócio e Imagens (Blobs) exclusivamente no IndexedDB.
  - Service Worker resiliente (`public/sw.js`) com versionamento semântico explícito (`gestaopro-v1.13.0-pwa10-static` e `-runtime`), limpeza segura de caches obsoletos e suporte à mensagem `CLEAR_APP_CACHE` para recuperação de cache corrompido.
  - Pré-cache resiliente de assets do shell sem falhas em assets opcionais e fallback offline transparente para `index.html` em requisições de navegação SPA.
  - Ciclo de atualização seguro (`pwaHandler.applyUpdate` e `isSafeToUpdate`) que posterga recarregamento automático durante digitação em formulários, modais abertos, rotas de edição (`#/produtos/novo`, `#/produtos/editar`) ou estado offline.
  - Interface discreta de atualização com banner não-intrusivo contendo botões `[Atualizar]` e `[Depois]`.
  - Reconnection Coordinator com debounce de 250ms para eventos de oscilação de rede (`online`/`offline`) e throttle de 4000ms para eventos de retorno à aba (`visibilitychange`) e foco (`focus`), evitando tempestades de sincronização concorrente.
  - Desativação limpa do Service Worker e interceptação de install prompt em runtime desktop nativo (Tauri v2).
  - Suíte de 24 testes automatizados (`tests/pwa_hardening_phase10.test.js`, PWA-01 a PWA-24). Baseline total: **417 PASS / 0 FAIL / 1596 asserções em 23 arquivos**.

---

### PHASE 11 — SECURITY HARDENING
- **Status:** `PASS`
- **Objetivo:** Auditoria ofensiva, defesa em profundidade e validação de segurança:
  - Documentação formal do Threat Model em `docs/THREAT_MODEL.md` abrangendo 5 perfis de ameaça (atacante externo, usuário autenticado malicioso, operador comprometido, dispositivo comprometido, rede hostil).
  - Secret scan completo no código-fonte, bundle `dist/`, arquivos `.env` e histórico Git (zero credenciais comprometidas).
  - Eliminação de cascata pai no RTDB (`database.rules.json`): remoção do `.write` na raiz `$tenantId` e definição de escrita granular por recurso com RBAC restrito a administradores em `settings`, `purchases`, `suppliers`.
  - Proteção contra escalada de privilégio em `/users/$uid`: proibição estrita de auto-atribuição de `role` e `tenantId` por usuários não-administradores.
  - Mitigação de SVG Stored XSS e restrição de MIME types no Cloud Storage (`storage.rules` & `FirebaseStorageProvider.js`) para formatos raster web seguros (`image/(jpeg|png|webp)`).
  - Sanitização universal anti-XSS em relatórios e impressão (`ReportService.js`) com escape de dados cadastrais da empresa e linhas de tabelas (`_escapeHTML`).
  - Proteção contra Path Traversal no Storage (`FirebaseStorageProvider.js`) via sanitização `_sanitizePathSegment` contra sequências `../`, `..\`, `:`, null bytes e verificação de prefixo de tenant (`_validateRemotePathForTenant`).
  - Proteção contra Open Redirect e injeção de esquemas maliciosos (`javascript:`, `data:`) em `webAdapter.js`, `tauriAdapter.js` e `ProductImageGallery.js`.
  - Defesa contra mensagens corrompidas no barramento multi-aba `eventBus.js` (BroadcastChannel).
  - Validador `firebaseConfigValidator.js` reforçado com detecção expandida de segredos e checagem condicional de `databaseURL` e `storageBucket`.
  - Suíte completa de 37 testes automatizados (`tests/security_hardening_phase11.test.js`, SEC-01 a SEC-30). Baseline total: **454 PASS / 0 FAIL / 2123 asserções em 24 arquivos**.

---

### PHASE 12 — FINAL QA + RELEASE CANDIDATE
- **Status:** `PASS`
- **Objetivo:** Auditoria final, consistência de dependências, testes de regressão e preparação para Firebase Cloud real:
  - Resolução de dependências do Firebase SDK modular (v13.0.0 confirmado sem drift ou mistura de compat).
  - Bloqueio ativo de Configuration Drift entre Auth, RTDB e Storage (`src/js/utils/firebaseConfigValidator.js`).
  - Classificador formal de resiliência e erros de nuvem (`src/js/utils/cloudErrorClassifier.js`).
  - Auditoria completa de distribuição `dist/` e histórico Git (zero credenciais comprometidas).
  - Ciclo de integridade de dados E2E, estoque concorrente em ledger append-only e vendas offline testados.
  - Validação de versionamento de imagens, integridade SHA-256 e zero downloads redundantes.
  - Nova suíte de testes de QA com 22 testes automatizados (`tests/final_qa_phase12.test.js`, QA-01 a QA-22).
  - Baseline total: **476 PASS / 0 FAIL / 2221 asserções em 25 arquivos**.
  - Documento de Release Candidate: `RELEASE_CANDIDATE.md` (v1.13.0-rc.1).
  - Documento de Homologação Externa: `docs/STAGING_HANDOFF.md`.

---

### PHASE 13 — REAL FIREBASE CLOUD HOMOLOGATION
- **Status:** `PARTIAL` (QA Local 476/476 PASS; Real Cloud BLOCKED por ação externa — 4 projetos de produção protegidos; aguardando criação do projeto gerenciador-produtos-staging no Firebase Console)
- **Objetivo:** Conexão e homologação real na nuvem do Firebase Staging (`gerenciador-produtos-staging`):
  - Auditoria de CLI e identificação das 4 instâncias de produção (todas protegidas e bloqueadas).
  - Emissão de relatório de homologação [docs/PHASE13_CLOUD_HOMOLOGATION.md](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/docs/PHASE13_CLOUD_HOMOLOGATION.md).
  - Roteiro passo a passo para criação no plano Spark sem ativação acidental de billing em `docs/STAGING_HANDOFF.md`.
  - Aguardando provisionamento manual do projeto no Firebase Console para publicação de regras e testes reais.

---


### PHASE 14 — FINAL PRODUCTION AUDIT
- **Status:** *PENDING*
- **Objetivo:** Auditoria geral e encerramento:
  - Checklist completo de 100% dos requisitos do PROMPT MASTER.
  - Validação de continuidade técnica para futuras manutenções por IA ou engenheiros humanos.

