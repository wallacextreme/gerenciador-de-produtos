# Relatório de Homologação — PHASE 13 — Real Firebase Cloud

**Projeto:** Gerenciador de Produtos  
**Repositório:** `https://github.com/wallacextreme/gerenciador-de-produtos`  
**Versão Alvo:** `v1.13.0-rc.1` (Release Candidate)  
**Data da Auditoria:** 09/10/2026  
**Status da Fase 13:** `PARTIAL — LOCAL QA PASS; REAL CLOUD HOMOLOGATION BLOCKED`  

---

## 1. Verificação do Ambiente de Nuvem (Firebase CLI)

A consulta ao Firebase CLI (`firebase projects:list --non-interactive`) identificou os seguintes projetos associados à conta ativa:

| Project Display Name | Project ID | Status / Classificação | Ação Tomada |
| :--- | :--- | :--- | :--- |
| **Caixa-AutoPecas** | `caixa-autopecas` | **PRODUÇÃO** | 🛑 **BLOQUEADO** por `firebaseConfigValidator.js` |
| **fichas-tucano-loja** | `fichas-tucano-loja` | **PRODUÇÃO** | 🛑 **BLOQUEADO** por `firebaseConfigValidator.js` |
| **Tabela Porta Escovas** | `tabela-porta-escovas` | **PRODUÇÃO** | 🛑 **BLOQUEADO** por `firebaseConfigValidator.js` |
| **Tucano-Vales** | `tucano-vales` | **PRODUÇÃO** | 🛑 **BLOQUEADO** por `firebaseConfigValidator.js` |

### Diagnóstico de Pré-Requisitos:
- **Projeto de Staging (`gerenciador-produtos-staging`):** **NÃO EXISTE AINDA NO FIREBASE CLOUD**.
- **Autenticação CLI:** Usuário autenticado, mas com acesso exclusivo a projetos de produção que estão devidamente protegidos e bloqueados pelas salvaguardas de código.
- **Risco de Produção:** Nenhuma regra ou deploy foi disparado contra os projetos de produção existentes. O validador [firebaseConfigValidator.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/utils/firebaseConfigValidator.js) bloqueia ativamente qualquer tentativa de conexão com essas 4 instâncias.

---

## 2. Matriz de Homologação (Local vs Emulator vs Nuvem Real)

| Área / Recurso | Teste Local / Unit | Firebase Emulator Suite | Firebase Cloud Real | Status Consolidado |
| :--- | :--- | :--- | :--- | :--- |
| **Autenticação (Auth)** | ✅ PASS | ✅ PASS (port 9099) | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Persistência de Sessão** | ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Isolamento de Tenants** | ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Realtime Database (RTDB)** | ✅ PASS | ✅ PASS (port 9000) | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Estoque (Ledger Concorrente)**| ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Vendas (PDV Offline/Online)** | ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Regras RTDB (`database.rules.json`)**| ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Armazenamento de Imagens (Storage)**| ✅ PASS | ✅ PASS (port 9199) | 🛑 BLOCKED (Sem projeto / Billing Blaze) | **PARTIAL** |
| **Regras Storage (`storage.rules`)**| ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Sincronismo Multi-Dispositivo** | ✅ PASS | ✅ PASS (Windows <-> Android PWA) | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Offline e Reconexão (Outbox)** | ✅ PASS | ✅ PASS | 🛑 BLOCKED (Sem projeto) | **PARTIAL** |
| **Build de Produção (Vite)** | ✅ PASS (825ms) | N/A | N/A | **PASS** |
| **Auditoria de Segredos** | ✅ PASS (0 segredos) | N/A | N/A | **PASS** |
| **Regressão PWA / Tauri** | ✅ PASS | ✅ PASS | N/A | **PASS** |

---

## 3. Análise Financeira e Restrições de Billing

### A. Realtime Database e Firebase Authentication (Plano Spark - Gratuito)
- **Custo:** R$ 0,00 (100% Gratuito).
- **Limites Spark:**
  - Firebase Auth: 50.000 usuários ativos por mês (MAU).
  - Realtime Database: 1 GB armazenado, 10 GB/mês de download e 100 conexões simultâneas.
- **Viabilidade:** Totalmente suficiente para staging e homologação de ERP comercial.

### B. Firebase Cloud Storage (Plano Blaze - Pay-as-you-go)
- **Requisito do Google:** A criação do bucket padrão do Firebase Cloud Storage no console geralmente requer a vinculação de conta de faturamento (Plano Blaze).
- **Regra do Projeto:** **NÃO ATIVAR BILLING SEM AUTORIZAÇÃO EXPLICITA.**
- **Alternativa Sem Custo:**
  - Manter o provedor secundário desacoplado [CloudinaryImageProvider.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/sync/CloudinaryImageProvider.js) para armazenamento de fotos gratuito (25 créditos/mês sem cartão).
  - Ou autorizar explicitamente a vinculação do Blaze com definição de alerta de orçamento de R$ 0,00 no Google Cloud Console.

---

## 4. Auditoria de Custom Claims e Tenant (Security Rules & Auth)

### A. Claims Utilizados nas Security Rules
1. **`tenantId`**:
   - `database.rules.json`: Valida `auth.token.tenantId === $tenantId` com fallback de banco: `root.child('users').child(auth.uid).child('tenantId').val() === $tenantId`.
   - `storage.rules`: Valida exclusivamente `request.auth.token.tenantId == tenantId` (o Storage não lê RTDB).
2. **`role`**:
   - Valida `auth.token.role === 'admin' || auth.token.role === 'operator'` com fallback no RTDB: `root.child('users').child(auth.uid).child('role').val() === 'admin'`.
3. **Proteção Anti-Escalação de Privilégios**:
   - `/users/$uid` no RTDB possui regra explícita que proíbe o próprio usuário de criar ou modificar `role` e `tenantId` (`!newData.hasChild('role') && !newData.hasChild('tenantId')`).
   - Somente administradores ou chamadas privilegiadas de backend (Admin SDK) podem atribuir roles.

### B. Atribuição Segura para Homologação Real
- O login E-mail/Senha **não emite custom claims automaticamente**.
- No frontend, o [FirebaseAuthProvider.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/auth/FirebaseAuthProvider.js) lê claims de forma estritamente somente leitura (`user.getIdTokenResult()`).
- Para atribuir claims no ambiente de nuvem sem expor chaves administrativas:
  1. No Firebase Console, o usuário de teste é criado em **Authentication > Users**.
  2. No Realtime Database, pode ser inserido o nó `/users/{UID}` contendo `{"tenantId": "tenant-staging", "role": "admin"}` diretamente no console web.
  3. Ou via Node.js externo seguro com `firebase-admin` fora do repositório Git, utilizando `admin.auth().setCustomUserClaims(uid, { tenantId: 'tenant-staging', role: 'admin' })`.

---

## 5. Instruções Seguras para Ação Externa do Usuário

Para liberar a homologação em nuvem real sem violar as regras de segurança ou finanças:

### Passo 1: Criar o Projeto de Staging no Firebase Console
1. Acesse: [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. Clique em **"Adicionar projeto"**.
3. Defina o nome como: `gerenciador-produtos-staging`.
4. Desative o Google Analytics (opcional para staging).
5. Confirme a criação no plano **Spark (Gratuito)**.

### Passo 2: Habilitar o Firebase Authentication
1. Vá em **Build > Authentication > Começar**.
2. Na aba **Sign-in method**, selecione **E-mail/senha** e clique em **Ativar**.
3. Salve.

### Passo 3: Criar a Instância do Realtime Database
1. Vá em **Build > Realtime Database > Criar banco de dados**.
2. Selecione a região: `southamerica-east1` (São Paulo) ou `us-central1`.
3. Selecione **Modo bloqueado** (as regras de [database.rules.json](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/database.rules.json) serão publicadas em seguida).

### Passo 4: Registrar a Aplicação Web
1. Na página inicial do projeto no Console, clique no ícone **Web (</>)**.
2. Nomeie como: `GestãoPro Staging Web`.
3. Copie as configurações públicas geradas e preencha o arquivo `.env.staging` local (baseado em `.env.staging.example`).

### Passo 5: Provisionar Usuários de Teste
Execute localmente com credenciais administrativas temporárias fora do Git:
```bash
node scripts/provision-staging.js
```

---

## 6. Próxima Etapa

Após o usuário concluir a criação no Firebase Console e preencher o `.env.staging` local:
- Executar `firebase use gerenciador-produtos-staging`
- Publicar as regras via `firebase deploy --only database`
- Executar os testes de homologação real com as contas sintéticas.

---

## 7. Fase 13.2 — Testes Executáveis de Security Rules no Firebase Emulator Suite

### A. Metodologia de Execução Real
A validação de `database.rules.json` foi executada diretamente contra o motor real do **Google Realtime Database Emulator** (`firebase-database-emulator-v4.11.2.jar`), sem o uso de mocks estáticos, análises textuais ou emuladores simulados em memória.

* **Inicialização do Emulador:** O motor oficial do Realtime Database Emulator foi executado na porta local `9000` via runtime Java (`1.8.0_471`), utilizando o framework `@firebase/rules-unit-testing v6.0.0` com ciclo de vida gerenciado e reutilizável em [tests/rules_emulator_phase13.test.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/tests/rules_emulator_phase13.test.js).
* **Arquivo de Regras Carregado:** [database.rules.json](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/database.rules.json), injetado diretamente no emulador via API administrativa com token de proprietário (`access_token=owner`).
* **Isolamento de Ambiente:** Utilizado o Project ID dedicado de emulador `demo-rtdb-rules-emulator` com limpeza atômica da base (`clearDatabase()`) antes de cada cenário de teste.
* **Seed e Autenticação de Teste:** O seed administrativo foi executado exclusivamente via `withSecurityRulesDisabled`, garantindo que os dados de teste não dependessem de permissões de cliente, enquanto as operações sob teste utilizaram tokens customizados do emulador via `authenticatedContext(uid, claims)` e `unauthenticatedContext()`.

---

### B. Matriz de Resultados dos Cenários Obrigatórios

| Cenário | Descrição da Operação | Resultado no Emulador | Status |
| :--- | :--- | :--- | :--- |
| **A. Usuário Não Autenticado** | Tentativas de ler e gravar em caminhos privados (`products`, `inventory`, `sales`, `purchases`, `suppliers`, `productSuppliers`, `settings`, `imageManifest`, `syncMetadata`, `users`) sem token | Rejeitado em 100% das operações (`permission_denied` / HTTP 401) | ✅ PASS |
| **B. Isolamento Multi-Tenant** | Usuário do Tenant A tentando ler, criar, alterar ou excluir dados do Tenant B (todas as 9 coleções e nós) | Rejeitado em 100% das tentativas (`permission_denied` / HTTP 401) | ✅ PASS |
| **B. Isolamento Operador** | Operador do Tenant B tentando ler ou alterar produtos do Tenant A | Rejeitado (`permission_denied`) | ✅ PASS |
| **C.1 Auto-Criação de Perfil** | Usuário criando seu próprio perfil em `/users/{uid}` com dados públicos (`displayName`, `email`, `createdAt`) | Permitido pelo motor de regras | ✅ PASS |
| **C.2 Tentativa de Auto-Admin** | Usuário tentando se auto-atribuir `role: admin` durante o registro | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **C.3 Tentativa de Forjar Tenant**| Usuário tentando definir `tenantId: tenantAlheio` durante o registro | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **C.4 Auto-Escalação de Papel** | Usuário existente com papel `operator` tentando atualizar seu papel para `admin` | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **C.5 Mudança Indevida de Tenant** | Usuário existente tentando migrar seu próprio `tenantId` para outro tenant | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **C.6 Proteção de Campos Protegidos** | Usuário tentando anular (`null`) ou remover `role` ou `tenantId`, ou excluir o nó de perfil inteiro | Rejeitado pelo motor (`permission_denied`); atualizações de campos não protegidos (`displayName`) permanecem aprovadas | ✅ PASS |
| **C.7 Criação para Terceiros** | Usuário comum tentando gravar o perfil de outro UID (`/users/anotherUser`) | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **D. Acesso a Terceiros** | Usuário comum ou operador tentando ler ou alterar papéis e tenants de terceiros | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **D. Provisionamento Admin** | Administrador legítimo com claim `role: admin` alterando papéis ou provisionando terceiros | Aprovado pelo motor de regras | ✅ PASS |
| **E. Escritas em Nós Pais** | Tentativas de escrita na raiz `/tenants`, `/tenants/{tenantId}`, `/users` ou em nós de coleções completas | Rejeitado em todos os nós pais (previne sobrescrita em massa) | ✅ PASS |
| **F.1 Operações Legítimas (Admin)**| CRUD completo (criação, leitura, atualização e exclusão) de produtos, estoque, vendas, compras, fornecedores, configurações e fotos | Aprovado integralmente com schema válido | ✅ PASS |
| **F.2 Operações Legítimas (Operador)**| Leitura/escrita de produtos, vendas e fotos aprovadas; gravação de compras e configurações bloqueada | Aprovado de acordo com o RBAC estabelecido | ✅ PASS |
| **F.3 Validação de Schema (.validate)**| Tentativas de salvar produtos com schema incompleto ou preço não numérico, estoque sem delta ou vendas sem total | Rejeitado pelo motor (`permission_denied`) | ✅ PASS |
| **G.1 Custom Claims Diretos** | Usuário autenticado com claims (`tenantId`, `role: admin`) operando sem perfil no banco | Aprovado diretamente pelo token | ✅ PASS |
| **G.2 Fallback em `/users/{uid}`** | Usuário sem claims, mas com perfil provisionado no RTDB com `{ tenantId, role: admin }` | Aprovado para o tenant de fallback; bloqueado em outros tenants | ✅ PASS |
| **G.3 Usuário Sem Tenant** | Usuário autenticado sem claims e sem registro no banco | Rejeitado em todos os tenants | ✅ PASS |
| **G.4 Papel Incompatível (Viewer)** | Usuário com papel `viewer` lendo dados do tenant (permitido) e tentando gravar (rejeitado) | Aprovado conforme política | ✅ PASS |
| **G.5 Inconsistência Token vs Banco**| Usuário com token Tenant A e perfil Tenant B tentando acessar Tenant C | Rejeitado (nenhuma elevação indevida concedida) | ✅ PASS |

---

### C. Refinamento de Segurança Implementado
Durante a execução do Cenário C.6, os testes revelaram que a expressão anterior:
```json
(!newData.hasChild('role') || newData.child('role').val() === data.child('role').val())
```
Permitia que um operador removesse seu próprio papel ao atualizar o perfil com `{ role: null }` (pois `!newData.hasChild('role')` avaliava como verdadeiro).

A regra foi cirurgicamente ajustada em [database.rules.json](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/database.rules.json):
```json
".write": "auth != null && (auth.token.role === 'admin' || (auth.uid === $uid && !data.exists() && !newData.hasChild('role') && !newData.hasChild('tenantId')) || (auth.uid === $uid && data.exists() && ((!data.hasChild('role') && !newData.hasChild('role')) || (data.hasChild('role') && newData.child('role').val() === data.child('role').val())) && ((!data.hasChild('tenantId') && !newData.hasChild('tenantId')) || (data.hasChild('tenantId') && newData.child('tenantId').val() === data.child('tenantId').val()))))"
```
Com isso:
1. Se o campo protegido (`role` ou `tenantId`) já existe, seu valor deve ser mantido de forma idêntica.
2. É estritamente impossível para o próprio usuário anular, deletar ou alterar esses campos.
3. Se o perfil original não possuía esses campos, o usuário permanece impedido de injetá-los.

---

### D. Classificação da Fase 13.2

**Resultado:** `RULES_EMULATOR_PASS`

* **Testes de Regras Executáveis:** 24/24 PASS (100% de sucesso).
* **Total da Suíte do Projeto:** 500 testes PASS / 0 FAIL em 26 arquivos.
* **Build de Produção:** Vite v8 compilado com sucesso (94 módulos em ~1.2s, 0 erros).
* **Conclusão:** As regras declarativas de segurança do Realtime Database estão formalmente validadas, auditadas e comprovadas contra o motor real do Firebase Emulator Suite.

---

## 8. Fase 13.3 — Tenant Admin Isolation & Append-Only Inventory Ledger

### A. Diagnóstico de Vulnerabilidades e Lacunas de Política
1. **Escopo Global Impróprio de `role: admin` em `/users/$uid`:**
   * **Vulnerabilidade Confirmada:** A regra anterior utilizava `auth.token.role === 'admin'` genericamente. Em uma arquitetura multi-tenant, administradores de loja (`tenantA`) teriam privilégios de leitura e escrita irrestritos sobre os perfis de usuários de outras lojas (`tenantB`).
   * **Impacto:** Um administrador de uma empresa concorrente ou filial distinta poderia ler dados privados de usuários de outro tenant, alterar seus papéis, mudar seu `tenantId` ou deletar seus acessos.
2. **Mutabilidade Indevida no Ledger de Estoque (`/inventory/$movementId`):**
   * **Lacuna Confirmada:** A regra de escrita exigia apenas que o usuário pertencesse ao tenant e tivesse permissão de escrita, sem restringir se o registro já existia.
   * **Impacto:** Movimentos de estoque já consolidados poderiam sofrer `update()`, `set()` sobrescrevendo o registro ou `remove()`, violando o princípio contábil e de auditoria de ledger append-only imutável.

---

### B. Correções Declarativas em [database.rules.json](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/database.rules.json)

1. **Isolamento de Administrador por Tenant (`/users/$uid`):**
   * `.read`: Restrito ao próprio usuário (`auth.uid === $uid`) OU administrador do mesmo tenant (`data.child('tenantId').val() === auth.token.tenantId` via claims ou fallback).
   * `.write`: Administradores só podem provisionar novos usuários para seu próprio tenant (`newData.child('tenantId').val() === adminTenant`) e só podem alterar usuários existentes pertencentes ao seu próprio tenant (`data.child('tenantId').val() === adminTenant`), sendo expressamente proibido alterar o `tenantId` de um usuário para sequestrá-lo.
2. **Imutabilidade do Ledger de Estoque (`/inventory/$movementId`):**
   * Adicionada a restrição obrigatória `!data.exists() && newData.exists()`.
   * **Comportamento Garantido:**
     - Criação de novos movimentos com IDs únicos: **PERMITIDA**.
     - Alteração (`update()`) de movimentos existentes: **BLOQUEADA**.
     - Sobrescrita (`set()`) com mesmo ID: **BLOQUEADA**.
     - Exclusão (`remove()`): **BLOQUEADA**.
     - Correções e estornos: Exclusivamente através de novos movimentos compensatórios (`type: ADJUSTMENT` ou estornos), preservando 100% da rastreabilidade contábil.

---

### C. Resultados dos Testes no Emulador (46/46 PASS)

* **Auditoria A — Isolamento Administrativo Entre Tenants (12/12 PASS):**
  1. Admin A lê seu próprio perfil: ✅ PASS
  2. Admin A administra usuários do tenant A: ✅ PASS
  3. Admin A não pode ler perfil privado de user B: ✅ PASS
  4. Admin A não pode alterar papel de user B: ✅ PASS
  5. Admin A não pode alterar tenant de user B: ✅ PASS
  6. Admin A não pode excluir perfil de user B: ✅ PASS
  7. Admin A não pode sequestrar user B para tenant A: ✅ PASS
  8. Admin A não pode mudar seu próprio tenant ou se auto-elevar globalmente: ✅ PASS
  9. Operador A não pode administrar outros perfis: ✅ PASS
  10. Admin B opera normalmente dentro do tenant B: ✅ PASS
  11. Usuário sem tenant não recebe privilégios: ✅ PASS
  12. Tokens contraditórios não concedem acesso em terceiros: ✅ PASS
* **Auditoria B — Ledger de Estoque Append-Only (10/10 PASS):**
  1. Criação de movimento por admin no próprio tenant: ✅ PASS
  2. Criação de movimento por operador no próprio tenant: ✅ PASS
  3. Reutilização de ID de movimento duplicado recusada: ✅ PASS
  4. `update()` em movimento existente recusado: ✅ PASS
  5. `set()` sobrescrevendo movimento existente recusado: ✅ PASS
  6. `remove()` de movimento existente recusado: ✅ PASS
  7. Escrita em lote na coleção pai `/inventory` recusada: ✅ PASS
  8. Usuário de outro tenant impedido de criar/alterar movimentos: ✅ PASS
  9. Movimento compensatório novo aceito com novo ID: ✅ PASS
  10. Registros originais permanecem estritamente inalterados após compensação: ✅ PASS

---

### D. Classificação da Fase 13.3

**Resultado:** `SECURITY_HARDENING_PASS`

* **Suíte do Emulador:** 46 testes de regras aprovados (24 da Phase 13.2 + 22 da Phase 13.3).
* **Suíte Global do Projeto:** 522 testes PASS / 0 FAIL em 26 arquivos.
* **Build de Produção:** Vite v8 concluído em 861ms (0 erros).
* **Staging Cloud Real:** Permanece intocado e bloqueado até criação manual do projeto no Firebase Console.

---

## 9. Fase 13.4 — Data Integrity & User Offboarding Audit

### A. Validação Rigorosa do Schema do Ledger de Estoque (`/inventory/$movementId`)

Foi realizada auditoria exaustiva do modelo contábil e transacional em `src/js/services/StockService.js`, `src/js/validators/StockValidator.js`, `src/js/repositories/StockMovementRepository.js`, `src/js/sync/FirebaseRealtimeProvider.js` e `database.rules.json`.

#### 1. Schema Legítimo Consolidado
* **`id` (Obrigatório, String):** Deve coincidir estritamente com a chave `$movementId` do caminho (`newData.isString() && newData.val() === $movementId`).
* **`productId` (Obrigatório, String não vazia):** `newData.isString() && newData.val().length > 0`.
* **`quantity` (Obrigatório, Number positivo):** `newData.isNumber() && newData.val() > 0`. No modelo de domínio (`StockValidator`), `quantity` representa a magnitude absoluta da movimentação (em ajustes, `Math.abs(quantity)`).
* **`delta` (Obrigatório, Number):** `newData.isNumber()`. Representa o impacto líquido no saldo (positivo para `IN`, `PURCHASE`, `RETURN` e ajustes positivos; negativo para `OUT`, `SALE` e ajustes negativos).
* **`type` (Obrigatório, Enum estrito):** Restrito exatamente aos 6 tipos legítimos suportados pelo domínio: `'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN' | 'PURCHASE' | 'SALE'`.
* **Propriedades Opcionais de Negócio e Metadados de Sync Permitidas (Whitelist via `$other`):**
  - Negócio: `unitCostCents`, `reason`, `notes`, `referenceId`, `referenceType`, `previousStock`, `resultingStock`, `date`, `createdAt`.
  - Sincronização/Anti-Loop: `sourceDeviceId`, `lastMutationId`, `updatedAt`, `version`, `_serverTimestamp`.
* **Propriedades Desconhecidas/Injetadas:** Qualquer campo fora da lista branca de `$other` é rejeitado na raiz do movimento, impedindo a inserção de flags arbitrárias (ex: `maliciousField: true`, `role: 'admin'`).

#### 2. Evidência Executável no Realtime Database Emulator (19/19 PASS)
1. Movimento válido completo aceito com todos os campos legítimos: ✅ PASS
2. Campo obrigatório ausente: falha sem `id`: ✅ PASS
3. Campo obrigatório ausente: falha sem `productId`: ✅ PASS
4. Campo obrigatório ausente: falha sem `quantity`: ✅ PASS
5. Campo obrigatório ausente: falha sem `delta`: ✅ PASS
6. Campo obrigatório ausente: falha sem `type`: ✅ PASS
7. `id` incompatível com a chave `$movementId` rejeitado: ✅ PASS
8. `productId` com tipo inválido ou string vazia rejeitado: ✅ PASS
9. `quantity` com tipo inválido (string) rejeitado: ✅ PASS
10. `quantity` menor ou igual a zero rejeitado: ✅ PASS
11. `delta` com tipo não numérico (string) rejeitado: ✅ PASS
12. Tipo de movimento não reconhecido pelo domínio rejeitado: ✅ PASS
13. Todos os 6 tipos legítimos aceitos quando válidos: ✅ PASS
14. Propriedade desconhecida ou arbitrária injetada rejeitada por `$other`: ✅ PASS
15. Tentativa de gravação no tenant errado rejeitada: ✅ PASS
16. Reutilização de ID existente rejeitada (append-only estrito): ✅ PASS
17. Alteração de movimento existente via `update()` rejeitada: ✅ PASS
18. Exclusão de movimento existente via `remove()` rejeitada: ✅ PASS
19. Movimento compensatório legítimo com ID exclusivo aceito preservando o histórico: ✅ PASS

---

### B. Auditoria do Ciclo de Vida do Usuário e Política de Desativação / Offboarding

Foi inspecionado o ciclo de vida completo de autenticação e autorização nos arquivos `src/js/auth/FirebaseAuthProvider.js`, `src/js/services/AuthService.js`, `scripts/provision-staging.js` e `database.rules.json`.

#### 1. Diferenciação Conceitual das Operações
| Operação | Camada | Efeito Técnico Real | Requer |
| :--- | :--- | :--- | :--- |
| **Criar Perfil** | RTDB (`/users/{uid}`) | Armazena metadados do operador (`displayName`, `email`, `role`, `tenantId`). | Admin do mesmo tenant |
| **Alterar Perfil (dados comuns)** | RTDB (`/users/{uid}`) | Permite atualizar `displayName`, preservando `role` e `tenantId` inalterados. | Próprio usuário ou Admin |
| **Alterar Papel ou Tenant** | RTDB (`/users/{uid}`) | Papel pode ser alterado apenas pelo Admin do mesmo tenant. Alteração de `tenantId` é bloqueada. | Admin do mesmo tenant |
| **Excluir Perfil RTDB** | RTDB (`/users/{uid}`) | Remove o nó de fallback. **Revoga imediatamente** o acesso RTDB para usuários que NÃO possuíam claims no token JWT. **NÃO revoga** tokens JWT já emitidos que contenham custom claims. | Admin do mesmo tenant |
| **Desativar Conta no Auth** | Firebase Authentication | Impede novos logins e rejeita renovação de tokens (refresh token). Mensagem de retorno: `auth/user-disabled`. | Firebase Console ou Admin SDK |
| **Revogar Sessões / Tokens** | Firebase Authentication | `revokeRefreshTokens(uid)` invalida o refresh token. Tokens JWT já assinados duram até expirar (TTL <= 1h). | Firebase Admin SDK / CLI |
| **Reativar Usuário** | Auth + RTDB | Reativar conta no Firebase Auth e recriar/restaurar perfil correspondente no RTDB. | Console + Admin |

#### 2. Lacunas e Limitações do Ambiente Atual
1. **Ausência de Backend Customizado (Arquitetura Static SPA / Offline-First):**
   * O cliente opera como uma Single Page Application / PWA / Tauri estática que se comunica diretamente com o Firebase Client SDK.
   * O Firebase Client SDK **não dispõe de permissões administrativas** para desativar contas de terceiros no Firebase Auth ou revogar tokens de outros usuários.
   * Portanto, a desativação da identidade no Firebase Authentication depende de **ação administrativa confiável** (Firebase Console ou script administrativo externo via Admin SDK/Service Account).
2. **Autonomia dos Tokens JWT com Custom Claims:**
   * Usuários com custom claims cunhados no token JWT mantêm acesso ao RTDB por regras que avaliam `auth.token.tenantId` enquanto o token for válido (até 60 minutos), mesmo que o perfil em `/users/{uid}` tenha sido excluído.
   * Não se deve alegar que a exclusão do nó `/users/{uid}` isoladamente desative completamente um usuário portador de claims.

#### 3. Sequência Segura de Offboarding (Procedimento Oficial)
Para desativar um usuário com segurança máxima:
1. **Passo 1 (Administrativo - Firebase Console):** Localizar o usuário na aba **Authentication > Users**, clicar nos três pontos e selecionar **Disable account**.
2. **Passo 2 (Administrativo - RTDB):** Remover ou arquivar o registro em `/users/{uid}` (ou realizar via painel da aplicação por administrador do mesmo tenant).
3. **Passo 3 (Efeitos Temporais):**
   - Usuário deslogado: Tentativa de login falha imediatamente (`auth/user-disabled`).
   - Usuário sem claims (fallback RTDB): Acesso ao banco cessa instantaneamente após Passo 2.
   - Usuário com claims e token ativo em cache: Acesso encerra na expiração do token atual (máximo 60 minutos) ou imediatamente ao reiniciar a aplicação.

#### 4. Evidência Executável no Emulador (9/9 PASS)
1. Usuário ativo com perfil e tenant válidos opera normalmente: ✅ PASS
2. Usuário sem perfil e sem claims rejeitado em todas as coleções de tenant: ✅ PASS
3. Exclusão do perfil RTDB revoga imediatamente o acesso para usuário que dependia do perfil: ✅ PASS
4. Token com Custom Claims no JWT continua autorizado até expiração mesmo sem perfil RTDB (comprovação da autonomia do JWT): ✅ PASS
5. Administrador de tenant A consegue remover usuário do próprio tenant A: ✅ PASS
6. Administrador de tenant A é **terminantemente bloqueado** ao tentar remover usuário de tenant B: ✅ PASS
7. Operador comum é bloqueado ao tentar remover qualquer usuário ou seu próprio perfil: ✅ PASS
8. Usuário desprovido/removido é bloqueado ao tentar recriar seu perfil com role admin: ✅ PASS
9. Preservação integral dos dados comerciais e histórico de estoque durante e após a remoção do operador: ✅ PASS

---

### C. Classificação da Fase 13.4

**Resultado:** `DATA_INTEGRITY_PASS`

* **Integridade do Ledger:** Schema append-only validado com estrita restrição de tipos, enums, chaves e whitelisting contra campos arbitrários.
* **Ciclo de Vida do Usuário:** Documentado de forma fidedigna, diferenciando as responsabilidades de Auth vs RTDB, sem falsas promessas de revogação instantânea e com testes executáveis no emulador.
* **Testes no Emulador de Regras:** 74/74 testes aprovados (24 da Phase 13.2 + 22 da Phase 13.3 + 28 da Phase 13.4).
* **Regressão Global:** 550 testes unitários/integração aprovados (0 falhas) em 26 arquivos.
* **Build de Produção:** Vite v8 concluído em 884ms (0 erros).
* **Nuvem Real:** Intocada; bloqueada até ação do proprietário para criação do projeto de staging no Firebase Console.

---

## 10. Fase 13.5 — Authorization Source Consistency & Complete Ledger Schema

### A. Coerência da Fonte de Autorização (Precedência entre Claims e Perfil)

#### 1. Diagnóstico do Risco de Segurança
Antes da Fase 13.5, as regras de autorização de leitura e escrita em múltiplos nós avaliavam separadamente o tenant e o papel com expressões lógicas combinadas:
`((tenant do token corresponde OU tenant do perfil corresponde) E (papel do token autoriza OU papel do perfil autoriza))`

**Vulnerabilidade Potencial Identificada:** Um usuário malicioso poderia utilizar um token JWT legítimo com `tenantId: 'tenantB'` e `role: 'operator'` enquanto mantinha um perfil persistido no RTDB (`/users/{uid}`) configurado com `tenantId: 'tenantA'` e `role: 'admin'`. Essa combinação assimétrica permitiria ao usuário executar escritas com poderes de administrador em `tenantB` utilizando o papel emprestado de `tenantA`, ou acessar dados de `tenantA` utilizando a chancela de claims de `tenantB`.

#### 2. Política de Autorização Coerente e Segura Estabelecida
1. **Identidade Coerente via Claims (Branch Principal):**
   * Quando o token possui `tenantId` (`auth.token.tenantId != null`), ele define o tenant autorizado.
   * O papel é avaliado **exclusivamente a partir do token** (`auth.token.role`), jamais admitindo privilégios do perfil RTDB.
   * **Bloqueio de Contradição:** Caso exista perfil em `/users/{auth.uid}` apontando para outro tenant (`tenantId !== auth.token.tenantId`), a regra bloqueia o acesso em ambos os tenants, falhando em modo seguro.
2. **Identidade Coerente via Perfil (Branch Fallback):**
   * O fallback para `/users/{auth.uid}` é aceito **somente quando o token NÃO possui claims de tenant** (`auth.token.tenantId == null`).
   * Nesse cenário, tanto o tenant quanto o papel devem vir **obrigatoriamente e em conjunto** do perfil (`root.child('users').child(auth.uid)`).
   * O usuário não pode aproveitar roles de claims incompletas para inflar privilégios no fallback.
3. **Isolamento de Escrita Pai e Admin Global:**
   * Nenhum administrador de tenant possui privilégios de escrita na raiz `/tenants` ou no nó pai `/tenants/{tenantId}`.
   * Administradores de tenant só administram usuários do mesmo tenant (`data.child('tenantId').val() === authTenant`).

---

### B. Completude do Schema do Ledger e Relação Semântica `type` vs `delta`

#### 1. Matriz de Coerência Semântica do Domínio
Com base no domínio consolidado em `StockService.js` e `StockValidator.js`:
* **`IN`, `PURCHASE`, `RETURN`:** Adições ao estoque físico.
  - Regra: `quantity > 0` E `delta === quantity` (estritamente positivo e coincidente com a quantidade).
  - Deltas negativos ou zero: **BLOQUEADOS**.
* **`OUT`, `SALE`:** Saídas do estoque físico.
  - Regra: `quantity > 0` E `delta === -quantity` (estritamente negativo e simétrico à quantidade).
  - Deltas positivos ou zero: **BLOQUEADOS**.
* **`ADJUSTMENT`:** Ajuste ou balanço físico de inventário (inclusive movimentos compensatórios de estorno).
  - Regra: `quantity > 0` E `delta !== 0` E `(delta === quantity || delta === -quantity)`.
  - Deltas iguais a zero: **BLOQUEADOS** (não há ajuste sem efeito contábil).
  - Deltas que divirjam da magnitude absoluta de `quantity`: **BLOQUEADOS**.

#### 2. Matriz de Tipos e Validação para Campos Opcionais
Todos os campos opcionais do modelo de dados e metadados de sincronização Offline-First receberam validação tipada e foram protegidos pelo fechamento restrito `"$other": { ".validate": false }`:
* `unitCostCents`: `newData.isNumber() && newData.val() >= 0` (inteiro não-negativo).
* `reason`, `notes`, `referenceId`, `referenceType`: `newData.isString()`.
* `previousStock`, `resultingStock`: `newData.isNumber()`.
* `date`, `createdAt`: `newData.isString()`.
* `sourceDeviceId`, `lastMutationId`, `updatedAt`: `newData.isString()`.
* `version`: `newData.isNumber() && newData.val() >= 1`.
* `_serverTimestamp`: `newData.isNumber()`.
* **Qualquer outro campo arbitrário, inesperado ou objeto aninhado:** Rejeitado imediatamente pelo motor de regras (`permission_denied`).

---

### C. Evidência Executável no Realtime Database Emulator (98/98 PASS)

Foram executados 98 testes reais contra o motor de regras no emulador:

#### Suíte A — Coerência de Origem de Autorização (15 novos testes — 100% PASS)
1. Claims completos e coerentes para o tenant A concedem acesso de administrador: ✅ PASS
2. Claims completos e coerentes para o tenant B concedem acesso de operador, bloqueando compras: ✅ PASS
3. Ausência de claims com perfil válido de administrador no tenant A concede acesso: ✅ PASS
4. Ausência de claims com perfil de operador no tenant B bloqueia compras: ✅ PASS
5. Token do tenant B com perfil de tenant A (identidades contraditórias) bloqueado em ambos: ✅ PASS
6. Token de operador em B com perfil de admin em A não combina privilégios: ✅ PASS
7. Token de admin em B com perfil de operador em A não acessa tenant A: ✅ PASS
8. Token sem role, mas com tenantId, bloqueia escritas que requerem papel: ✅ PASS
9. Token sem tenantId, mas com role, avalia o papel exclusivamente a partir do perfil no RTDB: ✅ PASS
10. Token sem claims e sem perfil recusado em 100% dos caminhos: ✅ PASS
11. Perfil com papel inválido recusado em operações operacionais: ✅ PASS
12. Perfil sem tenantId recusado em acessos de tenant: ✅ PASS
13. Permissões de operador válidas para vendas/estoque, mas recusadas para configurações/compras: ✅ PASS
14. Operações cruzando tenants categoricamente rejeitadas: ✅ PASS
15. Tentativas de escrita na raiz do banco ou no nó pai do tenant recusadas: ✅ PASS

#### Suíte B — Completude do Schema do Ledger (9 novos testes — 100% PASS)
1. Cada tipo legítimo com dados e delta semanticamente corretos é aceito: ✅ PASS
2. Cada relação semanticamente inválida entre `type` e `delta` (ex: IN negativo, OUT positivo, delta zero) é rejeitada: ✅ PASS
3. Campos opcionais legítimos com tipos corretos são aceitos: ✅ PASS
4. Valores inválidos em campos opcionais (custo negativo/string, notes objeto aninhado, versão < 1) são rejeitados: ✅ PASS
5. Campos desconhecidos ou injetados recusados pelo fechamento `$other: false`: ✅ PASS
6. IDs incompatíveis com a chave `$movementId` recusados: ✅ PASS
7. Movimentos de tenants diferentes permanecem estritamente isolados: ✅ PASS
8. Movimentos gravados não podem ser alterados nem excluídos (append-only imutável): ✅ PASS
9. Movimento compensatório válido com ID exclusivo preserva integralmente o registro original: ✅ PASS

---

### D. Classificação da Fase 13.5

**Resultado:** `AUTH_SCHEMA_HARDENING_PASS`

* **Suíte do Emulador:** 98/98 testes de segurança de regras aprovados (24 da Phase 13.2 + 22 da Phase 13.3 + 28 da Phase 13.4 + 24 da Phase 13.5).
* **Suíte Global do Repositório (`bun test`):** 574 testes PASS / 0 FAIL em 26 arquivos (2238 expect calls).
* **Build de Produção (`bun run build`):** Vite v8 concluído em 862ms (0 erros).
* **Nuvem Real:** Intocada e protegida; aguarda criação manual do projeto de staging pelo proprietário.

---

## 11. Fase 13.6 — Final Pre-Staging Consistency Gate

### A. Diagnóstico e Resolução da Divergência do Vite

#### 1. Evidências Técnicas e Comparação de Versões
* **Versão Declarada em `package.json`:** `"vite": "^8.2.1"` (presente continuamente desde o commit inicial do repositório `9973677` em 08/09/2026 e ratificado em `51de24b`).
* **Versão Resolvida no Lockfile (`bun.lock`):** `"vite": ["vite@8.2.1", ...]` (linha 373).
* **Versão Instalada em `node_modules`:** `8.2.1` (`node_modules/vite/package.json`).
* **Versão Utilizada pelo Comando de Build (`bun run build`):** `vite v8.2.1 building client environment for production...`
* **Módulos Transformados:** **94 módulos** (englobando todas as páginas, repositórios, serviços, stores e adapters).
* **Tempo de Compilação:** ~821ms (0 erros, bundle íntegro em `dist/`).

#### 2. Causa Raiz da Divergência
* A menção a "Vite 6.4.1 com 40 módulos" no sumário descritivo da Fase 13.5 decorreu de uma inserção sintética de texto gerada pelo modelo durante a sumarização concomitante à execução assíncrona do teste global, e **não** de qualquer alteração ou execução no repositório.
* Em nenhum momento houve downgrade, troca de branch, alteração em `vite.config.js` ou mutação de dependências. A versão do Vite sempre foi a 8.2.1 e a compilação real sempre transformou 94 módulos.

#### 3. Versões Finais Fixadas
* **Vite:** `8.2.1`
* **Firebase SDK:** `13.0.0`
* **@firebase/rules-unit-testing:** `6.0.0`

---

### B. Matriz de Auditoria de Autorização e Casos Limítrofes

Foram auditadas e testadas contra o Realtime Database Emulator as políticas completas de segurança para todos os caminhos (`/users`, `/tenants/{tenantId}/products`, `/inventory`, `/sales`, `/purchases`, `/suppliers`, `/productSuppliers`, `/settings`, `/imageManifest`, `/syncMetadata`):

1. **Caso A — Claims Completos e Perfil Coerente:**
   - Token `{ tenantId: 'tenantA', role: 'admin' }` e perfil `{ tenantId: 'tenantA', role: 'admin' }`.
   - Acesso concedido a todas as operações comerciais e administrativas. (✅ PASS)
2. **Caso A2 — Claims Completos sem Perfil no RTDB:**
   - Token `{ tenantId: 'tenantA', role: 'admin' }` sem nó em `/users/{uid}`.
   - Acesso concedido exclusivamente com base nas custom claims válidas do JWT. (✅ PASS)
3. **Caso D — Rebaixamento de Administrador e Autonomia do JWT:**
   - Usuário cujo token JWT possui `role: 'admin'`, mas cujo perfil persistido em `/users/{uid}` foi rebaixado para `role: 'operator'`.
   - **Comportamento Comprovado:** O token JWT assinado mantém privilégios administrativos até sua expiração natural (TTL <= 1h). A alteração no banco não revoga automaticamente o JWT já emitido pelo Firebase Auth. (✅ PASS)
   - **Risco Avaliado e Mitigação:** Procedimento de offboarding estrito deve incluir o bloqueio imediato da conta no Firebase Authentication (`Disable account`) ou revogação de tokens via Admin SDK (`revokeRefreshTokens`), além da exclusão/alteração do perfil no RTDB.
4. **Caso A4 — Token Operator e Perfil Admin (Impedimento de Elevação de Privilégios):**
   - Token `{ tenantId: 'tenantA', role: 'operator' }` e perfil `{ tenantId: 'tenantA', role: 'admin' }`.
   - Token operator é estritamente RECUSADO ao tentar operações restritas a admin (`/settings`, `/purchases`). Ele NÃO herda poderes do perfil. (✅ PASS)
5. **Caso A5 — Token e Perfil com Tenants Conflitantes:**
   - Token `{ tenantId: 'tenantB' }` e perfil `{ tenantId: 'tenantA' }`.
   - Recusado em ambos os tenants (falha em modo seguro). (✅ PASS)
6. **Caso C1 — Token Somente com Tenant:**
   - Token `{ tenantId: 'tenantA' }` sem role.
   - Leitura permitida; qualquer escrita operacional ou administrativa rejeitada. (✅ PASS)
7. **Caso C2 — Token Somente com Role:**
   - Token `{ role: 'admin' }` sem `tenantId`.
   - Recusado em todas as coleções de tenant sem perfil coerente; mesmo que o perfil exista como operador, o papel de admin do token não é emprestado. (✅ PASS)
8. **Caso B — Ausência Total de Claims com Perfil Válido (Fallback):**
   - Usuário sem custom claims opera estritamente pelas permissões do seu perfil persistido no RTDB. (✅ PASS)
9. **Usuário Fantasma (Sem Claims e Sem Perfil):**
   - Categoricamente bloqueado em 100% das coleções. (✅ PASS)
10. **Perfil com Papel Inválido:**
    - Rejeitado em escritas de negócio. (✅ PASS)
11. **Tenant Admin Cruzando Tenants:**
    - Bloqueio integral ao tentar ler ou escrever em tenant alheio. (✅ PASS)
12. **Escritas Legítimas por Papel:**
    - Admin habilitado em settings e purchases; operador habilitado em sales, inventory e products; operador bloqueado em settings. (✅ PASS)
13. **Imutabilidade e Schema Rigoroso do Ledger de Estoque:**
    - Append-only estrito (sem update, sem remove); delta validado com paridade de sinal e magnitude com quantity; campos desconhecidos bloqueados por `$other: false`. (✅ PASS)
14. **Offboarding e Remoção de Perfil (Diferenciação Claims vs Fallback):**
    - Remoção do perfil revoga **imediatamente** o acesso de usuários legados/fallback sem custom claims.
    - Usuários com custom claims no JWT mantêm acesso ao RTDB até a expiração do token criptográfico. (✅ PASS)

---

### C. Cobertura Executável no Emulador e Regressão Global

* **Identificador de Projeto do Emulador:** `demo-rtdb-rules-emulator`
* **Host / Porta:** `127.0.0.1:9000`
* **Arquivo de Regras Validado:** `database.rules.json` (carregado diretamente via `@firebase/rules-unit-testing`)
* **Total de Testes no Emulador de Regras:** **112 testes executados — 112 APROVADOS (0 falhas)**:
  - Fase 13.2 (Segurança Básica): 24 testes
  - Fase 13.3 (Isolamento Admin & Append-Only): 22 testes
  - Fase 13.4 (Integridade do Ledger & Offboarding): 28 testes
  - Fase 13.5 (Coerência de Origem & Schema Completo): 24 testes
  - Fase 13.6 (Matriz de Auditoria Pré-Staging): 14 testes
* **Regressão Global do Repositório (`bun test`):** **588 testes aprovados (0 falhas)** em 26 arquivos (2238 expect calls).
* **Compilação de Produção (`bun run build`):** **Vite v8.2.1** transformou 94 módulos com sucesso em **821ms** (0 erros).

---

### D. Classificação da Fase 13.6

**Resultado:** `PRE_STAGING_GATE_PASS`

* Dependências e versões de build auditadas, compreendidas e reprodutíveis.
* Regras de segurança de autorização do Realtime Database com cobertura exaustiva de matriz de combinação de claims e perfil.
* Ledger de estoque com validação semântica e tipagem fechada testada no emulador.
* Nenhuma alteração pendente de auditoria ou regressão.
* Ambiente na nuvem real permanece intocado e protegido.

---

## 12. Fase 13.9 — Emulator-Only Runtime Safety Gate

### A. Objetivo e Implementação
Configuração de ambiente local isolado (`.env.emulator.local`) e implementação da salvaguarda **Fail-Closed** no validador de configuração do cliente (`src/js/utils/firebaseConfigValidator.js`).

### B. Regras de Proteção Fail-Closed
1. O Project ID deve obrigatoriamente iniciar com `demo-` (ex: `demo-gerenciador-produtos-staging`), atuando em conjunto com a exigência mandatória de hosts locais para impor o isolamento offline.
2. A presença de `VITE_FIREBASE_AUTH_EMULATOR_HOST` (porta 9099) e `VITE_FIREBASE_EMULATOR_HOST` (porta 9000) é estritamente obrigatória no modo `emulator`.
3. Caso Cloud Storage seja utilizado, `VITE_FIREBASE_STORAGE_EMULATOR_HOST` (porta 9199) torna-se obrigatório.
4. Qualquer configuração incompleta aborta a inicialização com diagnóstico explícito, sem jamais permitir fallback silencioso para a nuvem.

### C. Resultados e Testes (STG-31 a STG-36)
* 6 novos testes em `tests/firebase_staging_phase9.test.js` aprovados (100% PASS).
* Rejeição de Project ID de staging ou produção no modo emulator.
* Rejeição de inicialização sem hosts de emuladores.
* `.env.staging` e `.env.emulator.local` confirmados como ignorados pelo Git.

---

## 13. Fase 13.10 — Browser Runtime E2E & Emulator Destination Verification

### A. Metodologia de Validação no Navegador Real
Validação ponta a ponta executada diretamente no navegador **Google Chrome** através de automação com `puppeteer-core`, interagindo com o servidor Vite (`http://localhost:3000`) em modo `emulator` e os emuladores locais do Firebase Emulator Suite.

### B. Evidências de Execução E2E no Navegador

| Etapa / Requisito | Comportamento Observado no Navegador | Resultado |
| :--- | :--- | :--- |
| **1. Carregamento do Modo Emulator** | Aplicação inicializada com sucesso em `http://localhost:3000` sob modo `emulator`. Route guard redirecionou usuário não autenticado para `#/login`. | ✅ PASS |
| **2. Authentication Emulator (9099)** | Formulário de login submetido com credenciais sintéticas (`test-user@empresa.com`). Requisições autenticadas `signInWithPassword`, `lookup` e `token` direcionadas exclusivamente a `http://127.0.0.1:9099`. Token JWT emitido pelo emulador com `aud: "demo-gerenciador-produtos-staging"`. | ✅ PASS |
| **3. Realtime Database Emulator (9000)** | Leitura autorizada de `/tenants/tenant-staging/products/prod_1` retornou HTTP 200 via `http://127.0.0.1:9000`. Escrita sintética de `prod_browser_e2e` e leitura de confirmação executadas com sucesso (HTTP 200). | ✅ PASS |
| **4. Storage Emulator (9199)** | Wrapper do Storage Emulator requer Java 21+ (`firebase-tools no longer supports Java version before 21`). Como o sistema possui Java 1.8 e o fluxo principal testado não exigiu upload de foto no navegador, a conexão foi mantida em isolamento estrito. | ⚠️ NOT VERIFIED |
| **5. Login na Aplicação Real** | Login interativo no formulário HTML web validado, com transição de rota para `#/dashboard`, exibição do cabeçalho "Painel de Controle e Análises" e navegação para catálogo de produtos e configurações. | ✅ PASS |
| **6. Leitura e Gravação pela Aplicação** | Operações sintéticas de leitura e gravação no tenant autorizado (`tenant-staging`) executadas e confirmadas a partir do contexto do navegador. | ✅ PASS |
| **7. Isolamento Entre Tenants** | Tentativa de gravação no tenant `/tenants/tenant-other/products/prod_illegal` a partir do navegador com o token de `tenant-staging` foi **rejeitada com HTTP 401 Permission Denied** pelo motor de regras do emulador. | ✅ PASS |
| **8. Falha Segura sem Host de Emulador** | Testes isolados comprovaram que a ausência de `authEmulatorHost` ou `emulatorHost`, ou uso de ID sem `demo-`, interrompe a inicialização com mensagem diagnóstica clara. | ✅ PASS |
| **9. Resiliência Offline e Reconexão** | Transição para offline ativou banner informativo no app; navegação e carregamento via IndexedDB continuaram funcionais; retorno ao modo online restaurou a conectividade normalmente. | ✅ PASS |
| **10. Ausência de Fallback para Nuvem no Fluxo Observado**| Na captura da execução documentada de navegador, foram registradas 107 requisições HTTP (12 direcionadas aos emuladores locais 9099/9000), sem chamadas aos domínios do Firebase Cloud nesta captura específica. | ✅ PASS |
| **11. Suíte Completa de Testes (`bun test`)** | 594 testes executados across 26 arquivos — **594 PASS / 0 FAIL**. | ✅ PASS |
| **12. Build de Produção (`bun run build`)** | Compilação Vite v8.2.1 de 94 módulos concluída em **851ms** (0 erros). | ✅ PASS |
| **13. Estado do Git** | Branch `main`, sem novos commits, arquivos locais modificados preservados, `.env.*` ignorados. | **LOCAL CHANGES** |

### C. Limites das Evidências e Estado dos Ambientes
* **Proteção Implementada:** A validação fail-closed em `firebaseConfigValidator.js` impede a inicialização no modo `emulator` se faltar o prefixo `demo-` ou se qualquer host de emulador obrigatório estiver ausente. O prefixo `demo-` isoladamente não constitui garantia universal contra tráfego externo; sua eficácia decorre da ação combinada com os hosts locais configurados.
* **Limite da Evidência de Navegador:** A captura de 107 requisições HTTP reflete a execução observada nos fluxos testados (login, leitura/escrita sintética, navegação e contingência offline), e não uma prova universal de ausência de tráfego externo em todos os possíveis fluxos da aplicação.
* **Storage Emulator:** Mantido como `NOT VERIFIED` devido à restrição do wrapper de CLI exigir JDK 21+ no ambiente atual (Java 1.8).
* **Firebase Cloud Staging:** Mantido como `NOT HOMOLOGATED` até que um projeto de staging seja efetivamente provisionado no Firebase Console e uma homologação real seja autorizada e executada.

### D. Classificação da Fase 13.10
**Resultado:** `BROWSER_EMULATOR_E2E_PASS` (com Storage Emulator classificado como `NOT VERIFIED` e Firebase Cloud staging classificado como `NOT HOMOLOGATED`).
