# THREAT MODEL — GESTÃOPRO (PHASE 11)

**Sistema:** GestãoPro (Gerenciador de Produtos & PDV Offline-First)  
**Versão:** 1.13.0  
**Data:** Outubro de 2026  
**Status de Segurança:** HARDENED  

---

## 1. Visão Geral da Arquitetura de Segurança

O **GestãoPro** opera com uma arquitetura **Local-First / Offline-First**:
- **IndexedDB local** opera como a fonte primária de verdade operacional no cliente.
- O **SyncEngine** e o **ImageSyncService** gerenciam a sincronização bidirecional assíncrona com os serviços em nuvem: **Firebase Authentication**, **Firebase Realtime Database (RTDB)** e **Cloud Storage for Firebase**.
- A fronteira de autorização e segurança reside exclusivamente no **servidor em nuvem (Security Rules)** e na **validação de integridade do cliente (Defesa em Profundidade)**.

---

## 2. Perfis de Ameaça e Atores Maliciosos (Threat Actors)

### 2.1. Atacante Externo (Unauthenticated)
- **Perfil:** Atacante na internet sem credenciais de acesso ou cadastro ativo.
- **Objetivos:**
  - Enumerar endpoints, tentar ler dados de produtos, clientes, estoque ou vendas.
  - Injetar dados maliciosos no banco de dados ou no storage de imagens.
  - Acessar arquivos privados ou credenciais administrativas expostas.
- **Defesas Aplicadas:**
  - Regras do Realtime Database exigem `auth != null` em todas as rotas de dados (`/tenants/...` e `/users/...`).
  - Storage Rules exigem `request.auth != null` para qualquer operação de leitura, upload ou exclusão.
  - Zero segredos administrativos (Service Accounts, private keys) expostos no bundle estático ou no repositório.
  - Proteção contra Open Redirect e esquemas maliciosos (`javascript:`, `data:`) em adapters de plataforma.

### 2.2. Usuário Autenticado Malicioso (Cross-Tenant & Cross-Resource Attacker)
- **Perfil:** Usuário registrado legitimamente em um tenant específico (ex: `tenantA`), que tenta atacar o sistema para obter vantagens indevidas.
- **Vectores de Ataque:**
  - **Cross-Tenant Access:** Tenta ler ou alterar dados de `tenantB` (`/tenants/tenantB/...`).
  - **Manipulação de Parâmetros/URLs:** Forjar `tenantId`, `productId` ou `photoId` usando path traversal (`../`, `..\`, null bytes) para invadir caminhos remotos de outros tenants no Storage ou RTDB.
  - **Upload Abuse:** Fazer upload de arquivos maliciosos (scripts SVG XSS, arquivos gigantes > 10MB, arquivos binários executáveis).
  - **Auto-Elevação de Privilégio:** Tentar escrever `{ "role": "admin" }` no nó `/users/$uid` ou forjar custom claims.
- **Defesas Aplicadas:**
  - **Isolamento de Tenant RTDB:** Regras validam `(auth.token.tenantId === $tenantId || root.child('users').child(auth.uid).child('tenantId').val() === $tenantId)` nó por nó.
  - **Remoção de Cascata Pai:** A remoção do `.write` na raiz `$tenantId` impede que operadores ou usuários de um tenant contornem regras restritivas em nós filhos (`settings`, `purchases`, `suppliers`).
  - **Isolamento de Tenant Storage:** `storage.rules` exige `request.auth.token.tenantId == tenantId`. Caminhos contendo tentativas de traversal são invalidados no cliente via `_sanitizePathSegment` e rejeitados no Storage pelo Firebase.
  - **MIME & Tamanho Estritos:** Bloqueio de SVG e arquivos não-raster (`image/(jpeg|png|webp)` apenas) e limite de 10MB.
  - **Proteção do Perfil de Usuário:** Regras em `/users/$uid` proíbem que usuários alterem seus próprios campos `role` ou `tenantId`.

### 2.3. Usuário Operador Comprometido (Privilege Escalation)
- **Perfil:** Usuário com papel de `operator` que tenta realizar ações privativas de `admin`.
- **Objetivos:**
  - Alterar configurações da empresa (`/settings`).
  - Criar/alterar registros de fornecedores (`/suppliers`, `/productSuppliers`).
  - Criar/alterar registros de compras e despesas (`/purchases`).
  - Promover seu próprio papel para `admin`.
- **Defesas Aplicadas:**
  - RBAC estrito em nós críticos (`settings`, `purchases`, `suppliers`) exigindo explicitamente `auth.token.role === 'admin'`.
  - Custom claims geradas em ambiente seguro são imutáveis pelo cliente.

### 2.4. Dispositivo Comprometido (Compromised Local Device)
- **Premissa Fundamental:** **O IndexedDB local NUNCA é autoridade de segurança.**
- **Cenário:** O usuário possui acesso total às ferramentas de desenvolvedor (F12 DevTools), armazenamento local (`localStorage`, `IndexedDB`, `Cache Storage`), e pode editar registros locais arbitrariamente.
- **Defesas Aplicadas:**
  - Nenhuma senha, token administrativo, chave privada ou credencial secreta é armazenada em `IndexedDB` ou `localStorage`.
  - Mutações geradas localmente sofrem validação rigorosa no servidor (RTDB Security Rules `.validate`) antes de serem aceitas na nuvem.
  - Dados corruptos no cliente não conseguem comprometer a integridade do banco remoto nem de outros tenants.

### 2.5. Rede Hostil (Man-in-the-Middle & Replay Attacks)
- **Cenário:** Conexões de rede públicas, proxy reverso inseguro, repetição deliberada de requisições.
- **Defesas Aplicadas:**
  - HTTPS obrigatório para todas as comunicações em nuvem.
  - **Idempotência de Mutações:** Operações na fila Outbox (`SyncRepository`) e estoque possuem identificadores únicos determinísticos (`mutationId` / `saleId` / `movementId`), impedindo contabilidade duplicada em replay.
  - Resolução de conflitos determinística baseada em LWW (Last-Write-Wins) com timestamps sincronizados.

---

## 3. Matriz de Superfície de Ataque e Mitigações

| Vetor de Ataque | Severidade Bruta | Componente Afetado | Mitigação Implementada | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Escalação de privilégio via RTDB write cascade** | CRITICAL | `database.rules.json` | Removida regra `.write` na raiz do tenant; escrita granular nó a nó com verificação de role. | **MITIGADO** |
| **Adulteração de role/tenantId em `/users/$uid`** | CRITICAL | `database.rules.json` | Regra restringe escrita de `role` e `tenantId` estritamente a administradores. | **MITIGADO** |
| **XSS armazenado via impressão de relatórios** | HIGH | `ReportService.js` | Adicionada sanitização universal `_escapeHTML()` em todos os campos cadastrais e linhas da tabela. | **MITIGADO** |
| **SVG Stored XSS via Storage** | HIGH | `storage.rules`, `FirebaseStorageProvider.js` | Restrição estrita de MIME type para `image/(jpeg\|png\|webp)`. Rejeição de SVG. | **MITIGADO** |
| **Path Traversal em upload/delete de fotos** | MEDIUM | `FirebaseStorageProvider.js` | Sanitização `_sanitizePathSegment` contra `../`, `..\`, `:`, null bytes em `tenantId`, `productId`, `photoId`. | **MITIGADO** |
| **Open Redirect / Protocol Hijacking** | MEDIUM | `webAdapter.js`, `tauriAdapter.js` | Validação de protocolo estrita (`http:`, `https:`) em `openExternal()`. Rejeição de `javascript:`. | **MITIGADO** |
| **Injeção de Esquema em URLs de Imagens** | MEDIUM | `ProductImageGallery.js` | Validação `_sanitizeImageUrl()` exigindo `blob:`, `http:` ou `https:`, com escape de atributos HTML. | **MITIGADO** |
| **Envenenamento de Mensagens BroadcastChannel** | LOW | `eventBus.js` | Guard de validação defensiva verificando tipo, tamanho e integridade do payload antes do dispatch. | **MITIGADO** |
| **Conexão acidental com Firebase de Produção** | HIGH | `firebaseConfigValidator.js` | Bloqueio automático de projetos de produção em estágios de staging/desenvolvimento. | **MITIGADO** |

---

## 4. Suposições e Limitações (Assumptions & Limitations)

1. **Custom Claims:** Assume-se que em produção as custom claims (`tenantId`, `role`) são geradas por Cloud Functions ou backend privilegiado via Firebase Admin SDK, pois o frontend não possui e não deve possuir capacidade de emitir claims.
2. **Ambiente HTTP de Produção:** Headers de segurança (CSP, HSTS, X-Content-Type-Options) devem ser servidos pelo provedor de hospedagem (Firebase Hosting / Vercel / Nginx). A configuração local fornece a política recomendada.
3. **Ambiente Real de Staging (PHASE 09):** O isolamento de regras e segurança do Storage/RTDB está 100% coberto em testes e regras declarativas, aguardando ativação final de projeto na nuvem para teste live.
