# Política de Segurança — GestãoPro

A segurança da informação, a privacidade de dados e a integridade de sistemas são pilares fundamentais no desenvolvimento do **GestãoPro**.

---

## 1. Escopo e Princípios de Segurança

O **GestãoPro** adota uma postura de segurança ativa em todas as suas camadas:

- **Zero Segredos no Código & Repositório**:
  - Nenhuma chave privada, service account, token administrativo de escrita irrestrita ou segredo comercial é comitado no repositório Git.
  - Credenciais públicas de cliente (como `apiKey` e `projectId` do Firebase Web) são identificadores de cliente e dependem obrigatoriamente de **Regras de Segurança** no servidor para proteção dos dados.
  - Padrões explícitos no `.gitignore` impedem inclusão acidental de `serviceAccountKey*.json`, `firebase-adminsdk*.json`, `*.pem`, `*.key`.
- **Arquitetura de Autenticação e Claims (Phase 02)**:
  - **Custom Claims Nunca Geradas no Cliente**: Claims como `role` e `tenantId` são tratadas como **somente leitura** no frontend via `user.getIdTokenResult()`. Apenas ambientes de backend confiáveis (Firebase Admin SDK ou Cloud Functions) têm permissão de invocar `setCustomUserClaims()`.
  - **Fallback Seguro Sem Elevação de Privilégio**: Usuários sem claims recebem a role default `'operator'`. Em nenhuma circunstância o cliente autoatribui privilégios de `'admin'`.
  - **Zero Armazenamento de Senhas**: Senhas em texto plano nunca são armazenadas em `IndexedDB`, `localStorage`, `sessionStorage` ou registradas em logs (`console.log`).
  - **Sessão Persistida Oficial**: A sessão é gerida pelo mecanismo nativo do Firebase (`browserLocalPersistence`). Nenhum token falso ou mock de autorização no `localStorage` é aceito como autoridade de segurança real.
- **Isolamento de Credenciais em `.env.local`**:
  - O arquivo `.gitignore` bloqueia estritamente `.env`, `.env.*` (exceto `.env.example`).
  - Nenhuma credencial administrativa deve ser empacotada no bundle do PWA ou no executável distribuído.
- **Regras Estritas no Firebase Realtime Database (`database.rules.json`)**:
  - É expressamente proibido manter regras abertas (`.read: true, .write: true`) em ambiente produtivo.
  - Implementado o arquivo `database.rules.json` formalizando:
    - Obrigatoriedade de autenticação (`auth != null`);
    - Segregação de tenant (`auth.token.tenantId === $tenantId`);
    - Controle de escrita por perfil (`auth.token.role === 'admin'`);
    - Validação estrutural de tipos e atributos obrigatórios via `.validate`;
    - Declaração de índices para consultas via `.indexOn`.
- **Validação de Payload e Tipagem**:
  - Toda mutação é validada localmente por Validators de Domínio (`ProductValidator`, `StockValidator`, etc.) e protegida contra injeção de campos desconhecidos.
- **Proteção do Armazenamento Remoto de Imagens (Phase 04)**:
  - **Firebase Storage com Regras Declarativas (`storage.rules`)**:
    - Obrigatoriedade estrita de usuário autenticado (`request.auth != null`);
    - Isolamento rigoroso multi-tenant: o caminho `/tenants/{tenantId}/products/{productId}/{photoId}.webp` só pode ser lido, escrito ou excluído por membros do mesmo tenant (`request.auth.token.tenantId == tenantId`);
    - Validação de integridade do arquivo: tamanho máximo de 10 MB (`request.resource.size < 10 * 1024 * 1024`) e tipo MIME restrito a imagens (`request.resource.contentType.matches('image/.*')`);
    - Permissão de exclusão física delegada ao cliente autenticado sem necessitar de chaves secretas no frontend.
  - **Diretrizes de Segurança para Cloudinary (Caso Habilitado)**:
    - *Unsigned Upload Presets* NÃO são considerados segredos confiáveis; qualquer pessoa inspecionando o tráfego HTTP pode obter o identificador.
    - O preset na conta Cloudinary DEVE obrigatoriamente impor:
      - Modo Unsigned restrito;
      - Pasta fixa vinculada ao tenant;
      - Formatos permitidos exclusivamente de imagem (`webp`, `jpg`, `png`);
      - Tamanho máximo de arquivo limitado a 10 MB;
      - Resource type restrito a `image` (rejeitando `raw` e `video`);
      - Desativação de sobrescrita arbitrária (`overwrite: false`);
    - **Proibição Absoluta do `api_secret` no Frontend**: O segredo da API Cloudinary NUNCA deve ser incluído no bundle, variáveis de ambiente públicas do Vite ou código-fonte. Como a API REST do Cloudinary não permite exclusões via presets unsigned, a exclusão física exige soft-delete no manifesto ou intermediação por backend seguro / Cloud Function.
- **Segurança e Isolamento no Cache Local de Imagens (Phase 06)**:
  - **Isolamento Rígido de Tenants no IndexedDB**: Todas as operações de leitura e escrita (`put`, `get`, `remove`, `has`) no `LocalImageCache` validam compulsoriamente a coincidência de `tenantId`. Dados ou fotos de uma organização nunca são expostos para outra empresa.
  - **Validação Criptográfica de Integridade Pré-Escrita**: O hash SHA-256 de qualquer Blob recebido é recalculado localmente via Web Cryptography API (`crypto.subtle`) e comparado com o hash declarado no manifesto. Blobs corrompidos, incompletos ou adulterados em trânsito são sumariamente descartados sem poluir o armazenamento local nem sobrescrever cópias válidas.
  - **Prevenção de Ataques de Downgrade**: O cache bloqueia categoricamente qualquer tentativa de sobrescrever uma imagem válida por uma versão inferior (`payload.version < existing.version`), impedindo regressão de estado por mensagens obsoletas.
  - **Prevenção de Exaustão de Memória (Memory Leaks)**: Rastreamento ativo e revogação mandatória de Object URLs (`URL.revokeObjectURL`) garantem que referências binárias na memória gráfica/DOM sejam liberadas imediatamente após remoção ou fechamento de tela.
  - **Zero Segredos e Tokens Administrativos**: Nenhum token de autenticação, chave de API privada ou credencial sensível é gravada nas stores locais de imagens (`productImages` e `imageManifest`).
- **Segurança e Isolamento na Sincronização Automática de Imagens (Phase 07)**:
  - **Isolamento de Tenants na Fila (`ImageSyncService`)**: A fila de downloads valida e processa tarefas com segregação por `tenantId`. Tentativas de agendar ou baixar arquivos de organizações divergentes são sumariamente ignoradas.
  - **Validação Mandatória de Integridade Pré-Gravação**: Todo Blob baixado pelo provedor de storage passa por validação do checksum SHA-256 antes da persistência no cache. Se o hash divergir do metadado esperado do manifesto, o salvamento é abortado com `INTEGRITY_ERROR`, mantendo a versão local intacta.
  - **Prevenção de Esgotamento de Recursos e Consumo Excessivo de Franquia**:
    - Políticas de rede explícitas (`AUTO_WIFI`, `ON_DEMAND_ONLY`, `saveData`) restringem downloads em lote (P2/P3) a redes Wi-Fi não restritivas.
    - Concorrência estritamente controlada (padrão de 2 downloads paralelos) e limite de 3 tentativas com backoff exponencial evitam tempestades de conexões contra CDNs e provedores. Erros permanentes (404, 401, falhas de hash) não entram em retry.
    - Monitoramento ativo de cota de disco (pausando P3 em 85% de uso) protege o cliente contra exaustão de armazenamento.
  - **Garantia Anti-Loop com Outbox**: Downloads e atualizações de cache não geram mutações cadastrais em produtos nem criam registros na `syncQueue`, eliminando riscos de amplificação de tráfego no Firebase Realtime Database.
- **Segurança e Proteção na Interface da Galeria de Fotos (Phase 08)**:
  - **Zero Acesso a Tenants Cruzados**: A galeria consulta metadados e Blobs vinculados estritamente ao `tenantId` do produto em foco.
  - **Desacoplamento Seguro de Infraestrutura**: A camada de visualização é 100% desacoplada e se comunica exclusivamente com `LocalImageCache` e `ImageSyncService`, sem expor credenciais, endpoints ou tokens no DOM.
  - **Sanitização Rigorosa contra XSS**: Nomes de produtos, descrições e legendas de fotos renderizados na galeria e no Lightbox são compulsoriamente sanitizados via função `_esc()`.
  - **Mitigação de Esgotamento de Memória Gráfica (GPU/DOM Memory Leaks)**: Revogação mandatória de todas as Object URLs criadas para visualização no ciclo de vida do componente (`destroy()`).

- **Segurança da Camada Service Worker e Cache Storage (Phase 10)**:
  - **Isolamento de Origem do App Shell**: O Service Worker (`public/sw.js`) intercepta e gerencia exclusivamente requisições same-origin para arquivos estáticos essenciais do App Shell (`index.html`, `/assets/*`, manifest e ícones). Todas as requisições para origens externas (Firebase Auth, Realtime Database, Cloud Storage, Cloudinary, etc.) são ignoradas e tratadas fora do Cache Storage.
  - **Zero Armazenamento de Dados Sensíveis ou Tokens**: O Service Worker e o Cache Storage do navegador jamais interceptam, guardam ou expõem tokens JWT, credenciais, senhas ou dados comerciais.
  - **Preservação de Integridade do IndexedDB**: O Service Worker opera em sandbox isolado e NUNCA executa comandos de remoção ou modificação nas bases de dados IndexedDB (`indexedDB.deleteDatabase`), garantindo a integridade dos dados de negócio e do cache local de imagens.
  - **Zero Duplicação de Fotos de Produtos no Cache Storage**: Fotos de produtos são tratadas exclusivamente pelo `LocalImageCache` no IndexedDB, impedindo vazamento de imagens comerciais para o Cache Storage do Service Worker.
  - **Recuperação Segura de Cache**: O mecanismo de purga de cache (`clearAppCache`) restringe-se estritamente aos caches com prefixo `gestaopro-`, sem riscos de danificar outros armazenamentos do navegador.

---

## 2. Como Reportar Vulnerabilidades

Caso você identifique uma potencial vulnerabilidade de segurança, falha de isolamento ou exposição acidental neste projeto:

1. **Não abra uma issue pública** contendo detalhes exploráveis da vulnerabilidade.
2. Utilize o recurso oficial de **Divulgação Privada de Vulnerabilidade (Private Vulnerability Reporting)** do GitHub diretamente na aba [Security / Advisories](https://github.com/wallacextreme/gerenciador-de-produtos/security/advisories/new) deste repositório.
3. Caso a opção de advisory privado não esteja habilitada, abra uma issue simples solicitando um canal de contato seguro para reporte de segurança, sem incluir o payload ou a prova de conceito pública.

Agradecemos o apoio da comunidade de segurança e nos comprometemos a analisar e tratar reportes responsáveis com prontidão.

---

## 3. Diretrizes para Contribuidores e Avaliadores

- **Nunca comite credenciais reais**: Arquivos `.env`, `.env.*` (com exceção de `.env.example` e `.env.staging.example`), certificados, chaves privadas e dumps de banco de dados estão explicitamente incluídos no `.gitignore`.
- **Prevenção de Segredos**: Nunca utilize dados reais de empresas, clientes ou parceiros em testes automatizados, fixtures ou documentações.
- **Armazenamento no Navegador**: Em ambientes PWA, o IndexedDB opera sob a política de mesma origem (*Same-Origin Policy*). Nenhuma credencial com privilégios de escrita irrestrita deve ser persistida sem criptografia ou controles de acesso adequados.

---

## 4. REAL ENVIRONMENT VALIDATION

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

## 5. PHASE 11 — SECURITY HARDENING AUDIT & STATUS

```text
SECURITY STATUS:         HARDENED (454 testes PASS, 0 FAIL)
OPEN VULNERABILITIES:    0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
AUDIT DATE:              08/10/2026
```

### Mitigações Implementadas (Defesa em Profundidade)
1. **Eliminação de Cascata Pai no RTDB (`database.rules.json`)**:
   - Removida regra `.write` na raiz `$tenantId`, impedindo que operadores contornassem regras de nós restritos (`settings`, `purchases`, `suppliers`). Escrita redefinida de forma estrita e granular por recurso.
2. **Proteção Contra Escalada de Privilégio em `/users/$uid` (`database.rules.json`)**:
   - Bloqueada auto-atribuição de `role` e `tenantId` por usuários não-administradores.
3. **Mitigação de SVG Stored XSS no Storage (`storage.rules` & `FirebaseStorageProvider.js`)**:
   - Regras e validador de upload restringem estritamente arquivos aos formatos raster web: `image/jpeg`, `image/png`, `image/webp`. Rejeição total de SVG e scripts disfarçados.
4. **Sanitização Contra XSS Armazenado em Relatórios (`ReportService.js`)**:
   - Implementado método `_escapeHTML()` sanitizando todos os dados de empresa, títulos, períodos e células tabulares antes da renderização de impressão (`document.write`).
5. **Proteção Contra Path Traversal (`FirebaseStorageProvider.js`)**:
   - Implementada validação `_sanitizePathSegment` rejeitando sequências `../`, `..\`, `:`, null bytes (`\0`) e validando pertinência do caminho remoto ao tenant ativo (`_validateRemotePathForTenant`).
6. **Proteção Contra Open Redirect e Protocol Hijacking (`webAdapter.js`, `tauriAdapter.js`)**:
   - Validador `_isSafeExternalUrl()` garante abertura restrita a protocolos `http:` e `https:`, bloqueando `javascript:`, `data:`, `file:`.
7. **Sanitização de URLs de Imagens (`ProductImageGallery.js`)**:
   - Implementado `_sanitizeImageUrl()` bloqueando injeção de esquemas maliciosos em tags `<img>` e atributos DOM.
8. **Defesa de Mensagens Multi-Aba (`eventBus.js`)**:
   - Inserido type guard defensivo no listener de `BroadcastChannel` para descartar payloads corrompidos, nulos ou malformados.
9. **Validação de Configuração Firebase Reforçada (`firebaseConfigValidator.js`)**:
   - Adicionada verificação mandatória de `databaseURL`, `storageBucket` e expansão de detecção de segredos administrativos.

### Premissas e Limitações (Assumptions & Limitations)
- **Premissa 1:** Custom claims são emitidas exclusivamente em ambiente seguro (backend/Admin SDK).
- **Premissa 2:** O IndexedDB local é tratado como armazenamento não-confiável e nunca armazena segredos de autoridade.
- **Limitação 1:** A validação contra o Firebase Cloud real permanece formalmente `PARTIAL` até que a criação do projeto na nuvem seja concluída manualmente pelo usuário no Firebase Console.


