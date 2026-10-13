# ADR — Adoção do Supabase Storage como Provedor de Mídia Remota (PHASE 14.6)

**Status:** APROVADO PARA IMPLEMENTAÇÃO LOCAL E AUDITADO (CANONICAL CUTOVER E PRONTIDÃO VALIDADOS)  
**Data:** 10/10/2026  
**Contexto do Projeto:** GestãoPro (Gerenciador de Produtos)  
**Decisores:** Proprietário do Projeto, Equipe de Arquitetura  

---

## 1. Contexto e Problema

O GestãoPro é uma aplicação comercial *offline-first* desenvolvida em JavaScript Vanilla, com persistência local em IndexedDB, sincronização de dados transacionais via Firebase Realtime Database e autenticação via Firebase Authentication.

Na auditoria das fases 14.0.1 e 14.0.2, identificou-se que:
1. O Firebase Cloud Storage requer obrigatoriamente a associação de conta de faturamento (Plano Blaze) no Google Cloud desde 03/02/2026, mesmo que o consumo de homologação permaneça dentro da cota gratuita de 5 GB.
2. O proprietário do projeto determinou manter o custo em R$ 0,00 sem cadastrar cartão de crédito neste momento.
3. O conector `CloudinaryImageProvider` possui limitações graves no cliente (impossibilidade de exclusão não assinada, ausência de download de Blob e risco de abuso por *unsigned preset* público).
4. O **Supabase Storage** oferece um plano gratuito (*Free Tier*) perpétuo sem exigência de cartão de crédito:
   - 1 GB de armazenamento de arquivos;
   - 10 GB de transferência mensal (*bandwidth/egress*);
   - 50 MB de limite por arquivo;
   - Suporte nativo a Row Level Security (RLS) e buckets privados.

O desafio arquitetural é integrar o Supabase Storage mantendo o **Firebase Authentication** como provedor de identidade oficial, sem criar login duplo para os usuários e sem expor credenciais administrativas (`service_role`) no navegador.

---

## 2. Decisão Arquitetural

Adotar o **Supabase Storage** como provedor remoto alternativo de fotos de produtos através da criação do conector desacoplado [`SupabaseStorageProvider`](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/sync/SupabaseStorageProvider.js), preservando 100% da arquitetura existente:

1. **Identidade Preservada:** O Firebase Authentication continua sendo o único provedor de autenticação de usuários do GestãoPro.
2. **Third-Party Auth no Supabase:** As requisições ao Supabase Storage utilizam o `idToken` (JWT) emitido pelo Firebase Auth. O Supabase valida o token criptograficamente via chaves públicas do Google (JWKS).
3. **Bucket Estritamente Privado:** O bucket `product-images` opera em modo privado com Row Level Security (RLS) ativado na tabela `storage.objects`. Nenhuma foto é exposta via bucket público.
4. **Isolamento Multi-Tenant:** Objetos são organizados sob caminhos canônicos `tenants/{tenantId}/products/{productId}/{photoId}.{ext}`. RLS policies no PostgreSQL validam que `auth.jwt() ->> 'tenantId' = storage.foldername(name)[2]`.
5. **Arquitetura Offline-First Intacta:** O fluxo de cadastro local em IndexedDB (`LocalImageCache`), a fila de sincronização (`ImageSyncService`) e o manifesto de imagens (`ImageManifestService`) continuam operando de forma autônoma e resiliente à perda de conexão.
6. **Convivência de Múltiplos Provedores:** O sistema passa a suportar manifestos legados (Firebase Storage, Mock, etc.) e novos manifestos Supabase sem quebra de referências ou necessidade de migração forçada de fotos antigas.

---

## 3. Matriz de Responsabilidade dos Componentes

| Componente | Responsabilidade | Tecnologia / Armazenamento |
| :--- | :--- | :--- |
| **`AuthService` / `FirebaseAuthProvider`** | Login, sessão, renovação de token e emissão do JWT com custom claims. | Firebase Authentication SDK |
| **`SupabaseStorageProvider`** | Implementação do contrato `ImageStorageProvider`: upload, download autenticado, verificação e exclusão no bucket privado. | `@supabase/supabase-js` (via client scoped) |
| **`LocalImageCache`** | Fonte primária de verdade dos Blobs de imagem para visualização instantânea offline. | IndexedDB (`productImages` store) |
| **`ImageManifestRepository`** | Registro local de metadados das fotos (versão, hash SHA-256, tamanho, MIME, storageProvider). | IndexedDB (`imageManifest` store) |
| **`ImageManifestService`** | Reconciliação bidirecional do catálogo de imagens com o Realtime Database. | Firebase Realtime Database (`/tenants/{tenantId}/imageManifest`) |
| **`ImageSyncService`** | Orquestração da fila de downloads em segundo plano com priorização P1/P2/P3 e retry. | Fila em memória + eventos no `EventBus` |
| **`ProductImageGallery`** | Interface de usuário para exibição de carrossel, thumbnails e upload de novas fotos. | DOM Web Components / Vanilla JS |

---

## 4. Integração de Autenticação e Resolução da Claim `role`

### 4.1. Mecanismo de Autenticação de Terceiros
O Supabase JS Client é instanciado sem sessão própria de login (`auth.persistSession: false`), injetando dinamicamente o token do Firebase Auth:

```javascript
import { createClient } from '@supabase/supabase-js';

export function createSupabaseStorageClient(supabaseUrl, supabaseAnonKey, authService) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    accessToken: async () => {
      if (!authService || !authService.isAuthenticated()) return null;
      return await authService.getIdToken();
    }
  });
}
```

### 4.2. Contrato Canônico de Claims

O contrato formal de identidade e autorização adotado para harmonizar o Firebase Authentication com o Supabase Storage e o Realtime Database é estruturado da seguinte forma:

```json
{
  "role": "authenticated",
  "appRole": "admin",
  "tenantId": "tenant-staging"
}
```

> **Aviso de Segurança:** O exemplo acima é puramente estrutural e normativo para a modelagem técnica local; **não constitui autorização para criar ou modificar claims em usuários reais do Firebase nesta fase**.

#### 4.2.1. Semântica das Claims

1. **`role` (Papel Técnico de Infraestrutura):**
   - Representa o papel técnico exigido pelo Supabase/PostgreSQL (`auth.role() = 'authenticated'`).
   - Deve conter obrigatoriamente o valor `'authenticated'` nos tokens destinados à integração Supabase.
   - **Não representa, isoladamente, qualquer autorização administrativa ou comercial no GestãoPro.**
   - O valor `role: 'authenticated'` jamais confere privilégios de gravação ou administração por si só.

2. **`appRole` (Papel de Negócio do Domínio):**
   - Representa o papel comercial validado pelo GestãoPro (`AuthService`, RTDB, Firebase Storage legado e RLS do Supabase).
   - Assume estritamente os papéis definidos no domínio: `'admin'`, `'operator'` ou `'viewer'`.
   - Deve ser emitido exclusivamente por fonte administrativa confiável (Firebase Admin SDK).
   - Não pode ser definido, injetado ou adulterado pelo cliente, formulário ou SDK público.

3. **`tenantId` (Isolamento Multi-Tenant):**
   - Identifica o tenant autorizado para leitura e gravação.
   - Deve ser emitido exclusivamente por fonte administrativa confiável.
   - Corresponde estritamente ao segundo segmento do caminho de dados e imagens (`tenants/{tenantId}/...`).

#### 4.2.2. Cutover Canônico e Eliminação de Privilégio Residual (Fase 14.5)

Na **Fase 14.5**, o GestãoPro realizou o cutover operacional definitivo para o modelo canônico de claims, eliminando o privilégio residual e a ambiguidade identificada na Fase 14.4:

* **Eliminação Integral do Fallback Legado:** O RTDB (`database.rules.json`), o Firebase Storage (`storage.rules`) e o cliente (`FirebaseAuthProvider.js`) não aceitam mais `auth.token.role` para conceder permissões de escrita ou privilégios administrativos.
* **Autorização Estritamente Canônica:** Toda operação protegida por papel comercial exige exclusivamente claims explícitas e válidas em `appRole` (`'admin'`, `'operator'`, `'viewer'`).
* **Resolução Uniforme de Ausência ou Null:** A ausência de `appRole` e o valor explícito `appRole: null` são igualmente incapazes de conceder privilégios: ambos resultam em `viewer` no cliente e têm gravações protegidas negadas no RTDB, no Firebase Storage e no Supabase Storage.
* **Dependência de Migração:** Usuários legados sem claims canônicas ficam restritos a `viewer` (somente leitura) até que seu provisionamento administrativo seja realizado via Firebase Admin SDK.

#### 4.2.3. Matriz Unificada de Interpretação e Autorização Cross-Layer (Fase 14.5)

| Formato do Token | `role` | `appRole` | Papel no Cliente (`resolveBusinessRole`) | Acesso RTDB (Gravação) | Acesso Firebase Storage | Acesso Supabase Storage (RLS) | Comprovação por Testes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Legado sem appRole (Admin)** | `'admin'` | *(ausente)* | `'viewer'` (fail-closed) | **NEGADO** (requer appRole) | **NEGADO** (requer appRole) | **NEGADO** (requer role canônico e appRole) | Teste 14.2.6 (RTDB), D.11 (Storage), Claims C.1 & C.15 |
| **Legado sem appRole (Operator)** | `'operator'` | *(ausente)* | `'viewer'` (fail-closed) | **NEGADO** (requer appRole) | **NEGADO** (requer appRole) | **NEGADO** (requer role canônico e appRole) | Teste 14.2.6 (RTDB), D.11 (Storage), Claims C.2 |
| **Legado sem appRole (Viewer)** | `'viewer'` | *(ausente)* | `'viewer'` | Somente Leitura | Somente Leitura | **NEGADO** (requer role canônico) | Teste 14.3.3 (RTDB), D.5 (Storage), Claims C.3 |
| **Legado com undefined (JS)** | `'admin'` | `undefined` | `'viewer'` (fail-closed) | **NEGADO** (requer appRole) | **NEGADO** (requer appRole) | **NEGADO** | Claims C.15 |
| **Canônico Admin** | `'authenticated'` | `'admin'` | `'admin'` | Permitido (CRUD pleno) | Permitido (Upload / Delete) | Permitido (Upload / Delete) | Teste 14.2.1 (RTDB), D.10 & D.11b (Storage), Supabase RLS |
| **Canônico Operator** | `'authenticated'` | `'operator'` | `'operator'` | Permitido (Vendas/Produtos) | Permitido (Upload / Delete) | Permitido (Upload / Delete) | Teste 14.2.2 (RTDB), D.7 (Storage), Supabase RLS |
| **Canônico Viewer** | `'authenticated'` | `'viewer'` | `'viewer'` | Somente Leitura | Somente Leitura | Somente Leitura (Select) | Teste 14.2.3 (RTDB), D.8 (Storage), Supabase RLS |
| **Canônico sem appRole** | `'authenticated'` | *(ausente)* | `'viewer'` (fail-closed) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | Teste 14.2.4 (RTDB), D.9 (Storage), Supabase RLS |
| **Chave appRole com null** | `'admin'` | `null` | `'viewer'` (fail-closed) | **NEGADO** (Gap eliminado na 14.5) | **NEGADO** (CEL: fail-closed) | **NEGADO** (SQL: appRole IS NULL) | Teste 14.4.1 (RTDB), D.14 (Storage), Claims C.14 |
| **Chave appRole vazia ("")** | `'admin'` | `""` | `'viewer'` (fail-closed) | **NEGADO** (RTDB: "" != admin/op) | **NEGADO** (CEL: "" != admin) | **NEGADO** (SQL: "" NOT IN roles) | Teste 14.4.2 (RTDB), D.15 (Storage), Claims C.12 |
| **Tipo Incorreto (número/array)** | `'admin'` | `123` / `[]` | `'viewer'` (fail-closed) | **NEGADO** (RTDB: tipo incorreto) | **NEGADO** (CEL: tipo incorreto) | **NEGADO** (SQL: tipo incompatível) | Claims C.12, Supabase RLS estático |
| **Papel Desconhecido** | `'authenticated'` | `'superadmin'` | `'viewer'` (fail-closed) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | Teste 14.2.5 (RTDB), D.12 (Storage), Claims C.12 |
| **Conflito Inválido** | `'admin'` | `'superadmin'` | `'viewer'` (fail-closed) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | **NEGADO** (Sem gravação) | Teste 14.3.1 (RTDB), D.12 (Storage), Claims C.12 |
| **Conflito Restritivo** | `'admin'` | `'viewer'` | `'viewer'` (fail-closed) | **NEGADO** (gravação admin) | **NEGADO** (gravação admin) | **NEGADO** (gravação admin) | Teste 14.2.7 (RTDB), D.13 (Storage), Claims C.10 |
| **Tenant Ausente** | *(qualquer)* | *(qualquer)* | `tenantId: null` | **NEGADO** | **NEGADO** | **NEGADO** | Teste 14.3.4 (RTDB), D.16 (Storage), Supabase RLS |
| **Cross-Tenant** | `'authenticated'` | `'admin'` | Tenant isolado | **NEGADO** (outro tenant) | **NEGADO** (outro tenant) | **NEGADO** (outro tenant) | Teste 14.2.8 (RTDB), D.4 (Storage), Supabase RLS |

#### 4.2.4. Resolução da Limitação de Null no Realtime Database
Na Fase 14.4, verificou-se que a linguagem de regras do RTDB avaliava `auth.token.appRole == null` como verdadeiro tanto para chave ausente quanto para chave com valor `null`.  
Na Fase 14.5, em vez de tentar contornar essa limitação intrínseca de linguagem com comparações frágeis, o sistema **eliminou completamente o fallback** `auth.token.appRole == null && auth.token.role == 'admin'`.  
As regras do RTDB agora exigem expressamente `auth.token.appRole === 'admin' || auth.token.appRole === 'operator'`. Como `null` e `undefined` são ambos diferentes de `'admin'` e `'operator'`, a condição falha de forma fechada em ambos os casos, garantindo paridade total entre cliente, RTDB, Firebase Storage e Supabase Storage.

### 4.3. Implementação da Resolução no `FirebaseAuthProvider`

No conector [`FirebaseAuthProvider.js`](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/auth/FirebaseAuthProvider.js), a função `resolveBusinessRole(claims)` implementa rigorosamente o modelo canônico estrito:

```javascript
export const VALID_BUSINESS_ROLES = Object.freeze(['admin', 'operator', 'viewer']);

export function resolveBusinessRole(claims = {}) {
  if (!claims || typeof claims !== 'object') {
    return 'viewer';
  }

  // 1. O papel comercial depende exclusivamente de appRole canônico explícito e válido
  if (typeof claims.appRole === 'string' && VALID_BUSINESS_ROLES.includes(claims.appRole)) {
    return claims.appRole;
  }

  // 2. Qualquer outro caso (appRole ausente, nulo, vazio, tipo incorreto, desconhecido,
  // ou presença de role: 'admin' / role: 'operator' / role: 'authenticated' sem appRole canônico):
  // FAIL-CLOSED estrito para o menor privilégio comercial ('viewer').
  return 'viewer';
}
```

### 4.4. Gate de Segurança: `BLOCKED_ON_TRUSTED_CLAIM_PROVISIONING`
O frontend **jamais** pode forjar ou injetar custom claims em seu próprio token. A emissão de claims seguras deve ser realizada por ambiente administrativo confiável via Firebase Admin SDK.  
Enquanto o provisionamento de claims no Firebase Auth não for executado pelo proprietário, a homologação remota no Supabase Cloud permanece classificada como `BLOCKED_ON_TRUSTED_CLAIM_PROVISIONING`.

---

## 5. Modelagem de Storage e Políticas RLS (PostgreSQL)

### 5.1. Caminhos Canônicos
Estrutura determinística e sanitizada:
```text
tenants/{tenantId}/products/{productId}/{photoId}.webp
```
Prevenção contra path traversal: caracteres especiais (`..`, `\`, `/`, `:` e nulos) são terminantemente rejeitados antes do despacho.

### 5.2. Políticas Row Level Security (`storage.objects`)

1. **SELECT (Download de Imagens):**
   Permitido a qualquer membro autenticado (`role = 'authenticated'`) cujo `auth.jwt() ->> 'tenantId'` coincida com a pasta do tenant no caminho do objeto.
2. **INSERT (Upload de Novas Imagens):**
   Permitido a usuários com `appRole IN ('admin', 'operator')` do mesmo tenant, para imagens raster (JPEG, PNG, WebP) com tamanho inferior a 10MB.
3. **UPDATE (Substituição de Imagens):**
   Permitido a usuários com `appRole IN ('admin', 'operator')` do mesmo tenant.
4. **DELETE (Exclusão Física de Imagens):**
   Permitido a administradores e operadores do mesmo tenant.

---

## 6. Consequências da Decisão

### Positivas:
- **Custo Zero:** Homologação e operação sem necessidade de cartão de crédito no plano Spark do Firebase e Free Tier do Supabase.
- **Segurança Real:** Uploads e downloads protegidos por RLS contra vazamento cross-tenant, superando a vulnerabilidade dos presets não assinados da Cloudinary.
- **Exclusão Física Total:** Ao contrário da Cloudinary, o Supabase permite que o operador autenticado exclua a foto do bucket sem vazar segredos administrativos.
- **Resiliência:** Preserva 100% o funcionamento offline-first e a sincronização assíncrona.

### Riscos e Mitigações:
- **Limite de 1 GB do Free Tier:** Para catálogos grandes, 1 GB comporta aproximadamente 4.500 fotos em WebP (~220 KB cada). Um alerta de cota foi modelado para evitar estouro da capacidade.
- **Pausa por Inatividade:** Projetos gratuitos do Supabase podem ser pausados após 7 dias sem tráfego de banco. Como o Storage utiliza APIs HTTP ativas durante a operação, o tráfego regular previne a pausa.

---

## 7. Fase 14.7 — Offline-First Authorization, Outbox Safety & Local Tenant Isolation

### 7.1. Camadas de Autorização e Defesa em Profundidade
A autorização no GestãoPro opera em três camadas distintas, garantindo segurança mesmo quando o cliente está totalmente desconectado:

1. **Camada de Serviço Local (`authGuard.js` & Services):**
   - Antes de persistir qualquer mutação no IndexedDB local (`ProductService`, `StockService`, `SaleService`, `PurchaseService`, `SupplierService`, `SettingsRepository`), a função `assertPermission(action, entity)` é executada.
   - Aplica a matriz canônica:
     - `admin`: CRUD pleno em catálogo, estoque, vendas, compras, fornecedores e configurações.
     - `operator`: Catálogo, estoque e vendas. Bloqueio estrito de compras, fornecedores e configurações.
     - `viewer`: Bloqueio estrito de qualquer mutação de escrita.
     - `requiresMigration: true` / non-canonical: Tratado estritamente como `viewer`. Mutação rejeitada.
   - **Prevenção de Bypass:** Chamadas diretas à API de serviços (contornando botões desabilitados na UI) continuam sendo interceptadas e rejeitadas.

2. **Camada da Fila de Sincronização (`SyncEngine` & `SyncRepository` - Outbox):**
   - Ao enfileirar: Valida autorização da ação e associa explicitamente o `tenantId` da sessão ativa ao item da fila.
   - Pré-Despacho Remoto (`processQueue`):
     - **Isolamento de Tenant:** Se o `item.tenantId` for divergente do tenant da sessão ativa, a operação é ignorada e nunca despachada sob credenciais cruzadas.
     - **Mudança de Papel na Sessão:** Se a sessão ativa sofreu downgrade (ex: tornou-se `viewer` ou aguarda migração), a operação é marcada como `FAILED` com `permanentFailure: true`. O item **não é descartado silenciosamente** e **não entra em loop infinito de retentativa**. Fica preservado na fila para posterior recuperação via `retryFailed()` após regularização da conta.
     - **Classificação de Falhas de Nuvem:** Distingue falhas temporárias de rede (mantém status `PENDING` para retentativa) de falhas permanentes de autorização/segurança 403 (encerra retentativas imediatas sem perda de dados).

3. **Camada Remota (RTDB Security Rules & Supabase Storage RLS):**
   - Barreira final no backend contra adulterações diretas de payload ou bypass de cliente.

### 7.2. Isolamento Multi-Tenant Local no Dispositivo
- **IndexedDB (`BaseRepository`):**
  - Mutações locais gravam automaticamente o `tenantId` da sessão ativa.
  - Consultas (`findAll`, `findById`, `findByProductCode`, etc.) filtram determinísticamente por `tenantId`.
  - Tentativa de acesso, edição ou deleção direta de registros pertencentes a outro tenant resulta em `null` ou erro de acesso negado.
  - A troca de sessão de Tenant A para Tenant B no mesmo navegador não expõe dados de Tenant A. Ao restaurar a sessão de Tenant A, seus dados e fila permanecem íntegros sem perda de informações.
- **Cache Local de Imagens e Manifestos (`LocalImageCache` & `ImageManifestRepository`):**
  - O binário e os metadados mantêm o escopo do tenant em `productImages` e `imageManifest`.
  - Métodos `get()`, `getMetadata()`, `findByPhotoId()`, `has()` e `createUrl()` validam o tenant ativo, impedindo que Tenant B acesse imagens armazenadas por Tenant A através de IDs manipulados.

### 7.3. Escopo de Validação e Homologação
- **Cenários Comprovados por Testes Locais:**
  - Suíte `tests/offline_authorization_phase14.test.js`: 14 testes cobrindo autorização offline em todos os papéis (`admin`, `operator`, `viewer`, `requiresMigration`), Outbox safety, transições de papel, troca de tenant, classificação de erro e isolamento local.
  - Regressão total: 704 testes aprovados sem falhas (`bun test`), emulador RTDB (129 testes aprovados) e emulador Storage (21 testes aprovados).
- **Dependência Remota Não Testada:**
  - O isolamento real de instâncias e políticas RLS no Supabase Cloud depende de provisionamento futuro no ambiente de nuvem da Supabase e da migração de claims reais pelo Firebase Admin SDK. Todas as verificações nesta fase foram executadas localmente com emuladores, mocks estritos e especificações formais.

---

## 8. Fase 14.8 — Compatibilidade de Dados Legados, Atribuição Segura de Tenant e Recuperação da Outbox

### 8.1. Matriz de Compatibilidade dos Registros Legados (IndexedDB v1, v2 e v3)
A introdução do isolamento estrito por `tenantId` nas Fases 14.6 e 14.7 exigiu auditoria e blindagem conservadora para garantir que dados históricos anteriores não se tornem invisíveis nem sejam atribuídos erroneamente à primeira empresa/usuário que fizer login após a atualização:

1. **Registro Legado com Tenant Confiável:**
   - Registros com `tenantId` legítimo são isolados e acessíveis exclusivamente pelo tenant detentor.
2. **Registro Legado sem Tenant (Não Atribuído):**
   - **Regra Conservadora Inegociável:** A aplicação NUNCA atribui automaticamente o `tenantId` da sessão ativa a registros sem essa informação.
   - **Preservação e Isolamento:** Permanece intacto no IndexedDB com status `PENDING_ATTRIBUTION`.
   - **Barreira de Leitura e Escrita:** Ocultado de consultas normais (`findAll`, `findById`, lookups por código) de qualquer tenant ativo; tentativas de mutação ou exclusão por sessões normais são bloqueadas com erro de acesso negado.
   - **Acesso Administrativo Seguro:** Acessível exclusivamente por métodos de auditoria (`findUnassignedLegacy()` e `LegacyDataMigrationService`).
3. **Item da Outbox Legado sem Tenant:**
   - Bloqueado categoricamente de despacho remoto para o Realtime Database e Supabase Storage.
   - Marcado como `FAILED` permanente com `requiresResolution: true` (`unassigned_legacy`) para evitar loops infinitos ou publicação indevida sob o tenant incorreto.
4. **Manifestos e Binários de Imagens Legados:**
   - Fotos e manifestos sem tenant são mantidos no IndexedDB (`productImages` e `imageManifest`) com integridade binária SHA-256 preservada.
   - Bloqueados de acesso por tenants normais e protegidos contra evicção ou limpeza acidental (`LocalImageCache.clear`, `getEvictionCandidates`).

### 8.2. Política Segura de Recuperação da Outbox (`retryFailed()`)
O método `retryFailed()` foi reformulado para eliminar qualquer reativação indiscriminada de falhas:
- **Elegíveis para Reativação:** Falhas transitórias de rede/timeout e falhas de autorização temporária cujo tenant seja idêntico à sessão ativa e cuja ação tenha sido regularizada para o papel atual (`admin` ou `operator`).
- **Bloqueados de Reativação Automática:** Falhas permanentes de integridade/schema (400 Bad Request, payload malformado), itens legados sem tenant e itens de outros tenants.
- **Proteção Contra Mudança de Tenant em Voo (*In-Flight*):** O loop assíncrono de despacho em `SyncEngine.processQueue()` verifica dinamicamente a sessão antes de cada envio e após o retorno do provedor; se o usuário trocar de conta/tenant durante operações assíncronas, o processamento é abortado imediatamente sem corromper a fila nem confirmar sincronizações no tenant novo.

---

## 9. Fase 14.9 — Fronteira de Confiança na Atribuição de Tenant e Recuperação Segura com Consistência Transacional

### 9.1. Separação Estrita de Conceitos na Atribuição de Tenant
A Fase 14.9 estabeleceu uma barreira formal de confiança (`AttributionTrustBoundary.js`), eliminando a confusão entre metadados descritivos e evidências legítimas de autorização:
1. **Metadado Descritivo vs. Evidência Concreta:**
   - Uma string informativa (ex.: `'ADMIN_RECONCILIATION_VERIFIED'` ou `'MANUAL_RESOLUTION'`) é mero metadado descritivo. Chamadas a `assignLegacyTenant()` ou `migrateUnequivocalRecords()` fornecendo strings isoladas são **sumariamente rejeitadas**.
2. **Evidências Válidas de Proveniência:**
   - **`RELATIONAL_PROVENANCE`**: Relação comprovada com entidade pai cujo tenant já está estabelecido (ex.: manifestos/fotos apontando para produto atribuído, vendas/compras/movimentos apontando para produto atribuído).
   - **`IMAGE_MANIFEST_PROVENANCE`**: Todos os manifestos de fotos de um produto apontam para exatamente um único tenant comprovado.
   - **`HISTORICAL_METADATA`**: Metadado histórico contido no próprio registro comprovando a titularidade.
3. **Confirmação Humana Estruturada de Reconciliação Administrativa (`HUMAN_RECONCILIATION`):**
   - Requer plano formal com `confirmedByHuman === true`, `confirmedByUserId` (UID do operador autenticado), justificativa de negócio fundamentada e sessão ativa com papel `admin`. Sessões `viewer` ou não autenticadas são bloqueadas.
4. **Contrato Único em Toda a Aplicação:**
   - O método `BaseRepository.assignLegacyTenant()` e o serviço `LegacyDataMigrationService` aplicam exatamente a mesma validação centralizada. Nenhuma API permite contornar a fronteira de confiança.

### 9.2. Transações Atômicas Multi-Store e Consistência Relacional
- **Atomicidade no IndexedDB:** Migrações relacionais e reconciliações humanas são executadas sob transações multi-store (`db.transaction(['products', 'imageManifest', 'productImages', 'stockMovements', 'sales', 'purchases'], 'readwrite')`). Se qualquer registro ou dependência falhar na validação, a transação inteira é abortada sem escritas parciais.
- **Preservação de Dados de Negócio:** Identificadores originais (`id`), datas (`createdAt`), valores financeiros (`totalCents`) e quantidades de estoque são 100% preservados. O ledger append-only não sofre inserções compensatórias artificiais.

### 9.3. Resiliência da Outbox e Operações com Resultado Remoto Desconhecido
- **Rastreamento de ACK Remoto:** Se o backend aceitou a mutação, mas a sessão foi trocada antes da marcação local, a operação retém `remoteAckReceived: true`. No próximo ciclo de sincronização do tenant original, a operação é finalizada como `SYNCED` localmente **sem re-despacho duplicado na nuvem**.
- **Resultado Remoto Desconhecido (`remoteOutcomeUnknown`):** Operações cujo envio sofreu desconexão de rede mid-flight sem confirmação do backend são marcadas como resultado remoto desconhecido. Operações de movimentação de estoque no ledger são impedidas de retry automático cego (`UNKNOWN_REMOTE_OUTCOME_REQUIRES_RECONCILIATION`), prevenindo violação da imutabilidade do RTDB e duplicação de saldo de estoque.

---

## 10. Fase 14.10 — Autoridade de Reconciliação, Idempotência na Janela de Falha e Integridade Transacional

### 10.1. Autenticação Efetiva vs. Metadados de Auditoria e Limitações Locais
1. **Diferenciação Estrita de Autoridade:**
   - **Autenticação e Autorização Efetivas:** Derivam exclusivamente da fonte de verdade centralizada da aplicação (`AuthService`), validando sessão ativa, identidade autenticada via token criptográfico, alegação canônica de papel comercial (`appRole: 'admin'`), ausência de pendência de migração (`requiresMigration === false`) e correspondência exata do `tenantId`.
   - **Metadados de Auditoria:** Campos como `confirmedByHuman: true`, `confirmedByUserId`, strings descritivas e justificativas são **evidências de proveniência e registros de auditoria**, não substituindo nem conferindo prova de autorização por si sós.
2. **Limitação Arquitetural Expressa da Reconciliação Puramente Local:**
   - O ambiente de execução client-side em JavaScript não constitui fronteira de segurança contra um operador ou atacante com capacidade de inspecionar ou manipular o DevTools, a memória do processo ou o perfil do navegador.
   - Validações locais oferecem salvaguardas contra erros de operação e inconsistências de interface, mas **nenhuma validação puramente local substitui a autorização e a imposição de regras de segurança executadas no backend remoto**.

### 10.2. Escopo Transacional Unificado e Comportamento pós-Rollback
1. **Stores Abrangidas por cada Transação Multi-Store:**
   - **Migração Inequívoca:** Transação única abrangendo `products`, `imageManifest`, `productImages`, `stockMovements`, `sales`, `purchases`, `suppliers` e `productSuppliers`.
   - **Reconciliação Humana Supervisionada:** Transação única abrangendo todos os registros alvos, registros em cascata e a fila de sincronização `syncQueue`.
2. **Consistência Atômica e Comportamento pós-Rollback:**
   - Todas as operações de leitura e escrita utilizam o mesmo contexto transacional. Nenhuma conexão independente é aberta no curso da transação.
   - Em caso de falha ou erro de validação em qualquer store intermediária, `tx.abort()` garante que zero registros parciais sejam persistidos no IndexedDB (`migratedCount = 0`).
   - Após rollback e reabertura do banco, todos os registros originais permanecem intactos em seu estado inicial (`PENDING_ATTRIBUTION` ou sem tenant), garantindo integridade referencial total e permitindo reexecução limpa e idempotente.

### 10.3. Idempotência por Tipo de Operação Comercial
1. **Entidades Chave-Idempotentes (`products`, `sales`, `purchases`):**
   - O backend utiliza caminhos determinísticos baseados no ID da entidade (ex.: `/tenants/{tenantId}/products/{id}`). Mutações repetidas realizam escrita idempotente no mesmo nó sem gerar entidades duplicadas.
2. **Ledger Append-Only (`stockMovements`):**
   - Regras remotas no RTDB impõem estritamente `!data.exists() && newData.exists()`.
   - Uma repetição cega com a mesma chave é rejeitada pelo backend com `permission_denied`. Uma repetição com nova chave gerada duplicaria o movimento físico no estoque.
   - **Bloqueio Conservador:** Operações no ledger com resultado remoto desconhecido (`remoteOutcomeUnknown: true`) têm qualquer retry automático terminantemente bloqueado, exigindo conferência física de estoque e reconciliação administrativa explícita.

### 10.4. ACK Persistido vs. Resultado Remoto Desconhecido (Janela de Falha)
1. **ACK Durável Persistido:**
   - O ACK remoto (`remoteAckReceived: true`) é gravado duravelmente no IndexedDB antes de finalizar a operação local como `SYNCED`.
   - Sobrevive a reinicializações, interrupções ou trocas de sessão, permitindo finalização local segura sem retransmissão de rede.
2. **Resultado Remoto Desconhecido (`inFlight: true` no crash):**
   - Mutações despachadas cujo cliente falhe ou perca a conexão antes de receber a resposta do backend são marcadas como `remoteOutcomeUnknown: true` e `requiresResolution: true` durante o ciclo de inicialização (`recoverInterruptedInFlight()`).
   - Bloqueadas contra retransmissão cega. Reconciliação humana reativa apenas operações retidas por `unassigned_legacy` cujo resultado remoto seja comprovadamente conhecido.

---

## 11. Fase 14.11 — Contrato de Identidade de Operação, Política de Retries e Reconciliação Remota de Resultados

### 11.1. Matriz de Idempotência e Reconciliação por Tipo de Operação

| Operação | ID Persistente Antes do Envio | Pode Repetir Automaticamente? | Condição para Reconhecer o Remoto | Condição de Bloqueio |
| :--- | :--- | :--- | :--- | :--- |
| **Produto (`products`)** | Sim (`productId = crypto.randomUUID()` em `ProductService`, persistido em `products` e `syncQueue.entityId`). | Sim, se a checagem remota comprovar ausência ou equivalência. | Registro remoto existente com o mesmo ID e payload de negócio equivalente (`arePayloadsEquivalent`). | Conflito por divergência de payload (`payload_divergence_conflict`) ou permissão negada. |
| **Venda (`sales`)** | Sim (`saleId = crypto.randomUUID()` em `SaleService`, gravado em `sales` e `syncQueue.entityId`). | Sim, se comprovada ausência ou equivalência sem efeito pendente incerto. | Registro remoto existente com o mesmo `saleId` e dados comerciais equivalentes (itens, valores, data). | Conflito por divergência de payload ou efeito dependente de estoque em estado incerto. |
| **Compra (`purchases`)** | Sim (`purchaseId = crypto.randomUUID()` em `PurchaseService`, gravado em `purchases` e `syncQueue.entityId`). | Sim, se comprovada ausência ou equivalência sem efeito pendente incerto. | Registro remoto existente com o mesmo `purchaseId` e dados de compra equivalentes (fornecedor, valores, data). | Conflito por divergência de payload ou efeito dependente de estoque em estado incerto. |
| **Movimento de Estoque (`stockMovements` / `inventory`)** | **Obrigatório e Estável** (`movementId = crypto.randomUUID()`, gravado em `stockMovements` e `syncQueue.entityId`). Reutilizado estritamente em retries. | **NÃO repetir cegamente.** Permitido apenas se o remoto for consultado e comprovadamente ausente. | Registro remoto existente em `/inventory/{movementId}` com payload equivalente. Finaliza como `SYNCED` sem segundo despacho. | Resultado remoto desconhecido (`remoteOutcomeUnknown`), servidor inacessível, permissão negada ou payload divergente. |
| **Operação Composta (Venda/Compra + Estoque)** | IDs estáveis separados para cada efeito (`saleId` / `purchaseId` e `movementId` correlato via `referenceId`). | **Somente se cada efeito for comprovadamente recuperável de forma independente.** | Todos os efeitos relevantes confirmados e reconciliados. | Estado parcial ou desconhecido em qualquer dos efeitos dependentes. |

### 11.2. Taxonomia de Identificadores e Estados de Confirmação
1. **ID da Entidade (`entityId`):** Chave primária estável e imutável do registro no banco local IndexedDB (`products.id`, `sales.id`, `purchases.id`, `stockMovements.id`). Determina a chave do nó no Realtime Database.
2. **ID da Operação Lógica:** Identidade conceitual da ação de negócio. Para mutações unitárias coincide com o `entityId`; para transações compostas agrupa a operação principal e seus efeitos dependentes.
3. **ID do Item da Outbox (`item.id`):** UUID gerado pelo `syncRepository.enqueue()` para representar o item de trabalho na fila. É transmitido como `lastMutationId` para o mecanismo de Anti-Loop.
4. **ID de cada Efeito Dependente:** O identificador exclusivo e estável de cada sub-efeito gerado (ex.: `movementId` gerado em `SaleService` com `referenceId: saleId`).
5. **ACK Recebido (`res.success: true`):** Confirmação volátil retornada pela rede durante a execução assíncrona.
6. **ACK Persistido (`item.remoteAckReceived: true`):** Gravação durável no IndexedDB confirmando que o ACK remoto foi armazenado localmente antes da transição para `SYNCED`.
7. **Resultado Remoto Desconhecido (`item.remoteOutcomeUnknown: true`):** Estado atribuído quando uma operação estava em trânsito de rede (`inFlight: true`) e o cliente sofreu falha ou reinicialização antes de persistir o resultado.

### 11.3. Restrições Estritas de `options.force` e Procedimento Manual
- `options.force: true` **não atua como bypass genérico**:
  - Requer sessão autenticada com papel `admin`.
  - Rejeita qualquer tentativa de forçar retry de conflito de payload (`payload_divergence_conflict`) sem uma estratégia explícita (`resolutionAction`).
  - Proíbe sobrescrita remota (`OVERWRITE_REMOTE`) sobre o ledger append-only `/inventory`.
  - Preserva integralmente o `entityId` e o `payload` originais (terminantemente proibido recriar UUID de negócio para contornar rejeições de backend).
- O sistema implementa inspeção estruturada (`inspectOutboxItem`) e reconciliação controlada (`reconcileOutboxItem`) com trilha de auditoria completa (`reconciledByAdminUid`, `reconciliationDecision`, `reconciledAt`).

---

## 12. Fase 14.12 — Atomic RTDB Writes, Conditional Updates & Payload Integrity

### 12.1. Semântica Real das Operações de Criação e Atualização
1. **Criação Atômica (`CREATE`):**
   - **Registro remoto ausente:** Criado atomicamente no servidor via `runTransaction`.
   - **Registro remoto existente e equivalente:** Reconhecido como já aplicado (`alreadyApplied: true`), sem gerar mutação duplicada nem novo efeito colateral.
   - **Registro remoto existente e divergente:** Rejeitado com conflito explícito (`payload_divergence_conflict`). A escrita é abortada no servidor sem sobrescrita silenciosa.
   - **Registro remoto inacessível:** O estado permanece desconhecido (`UNKNOWN_RESULT`). A falta de acesso não é interpretada como ausência.

2. **Atualização Condicional com Concorrência Otimista (`UPDATE`):**
   - Utiliza controle de versão otimista (`baseVersion` e `version` monotônico).
   - O cliente fornece `baseVersion` (ou `expectedBaseVersion`) correspondente ao estado local em que baseou a edição.
   - No servidor RTDB via `runTransaction`: a mutação só é aplicada se `remoteRecord.version === expectedBaseVersion` (ou para registros legados sem versão, inicializado a partir de v1).
   - Se o registro remoto tiver sido alterado concorrentemente por outro cliente (`remoteRecord.version !== expectedBaseVersion`), a transação aborta com `VERSION_CONFLICT` e o item é bloqueado na Outbox (`requiresResolution: true`).
   - Se os payloads forem equivalentes, retorna `alreadyApplied: true` sem nova gravação redundante.

3. **Exclusão Idempotente (`DELETE`):**
   - Executa soft-delete (`deletedAt: timestamp`). Se o registro remoto já estiver com `deletedAt` preenchido, aborta a transação e retorna `alreadyApplied: true`.

### 12.2. Quando a Escrita é Atômica
- **Eliminação da Janela de Corrida Leitura-depois-Escrita:**
  - Na Fase 14.11, a checagem remota prévia (`get()`) ocorria antes do despacho `set()`, existindo uma janela de concorrência onde um cliente concorrente podia gravar entre o `get` e o `set`.
  - Na Fase 14.12, a decisão é tomada **dentro da função de transação do servidor** via `runTransaction(targetRef, transactionUpdate, { applyLocally: false })`. A validação (ausência, equivalência, versão base) e a gravação ocorrem de forma atômica no servidor RTDB via Compare-And-Swap (CAS).
- **Permissões de Leitura e Escrita para Transações RTDB:**
  - No Firebase Realtime Database, `runTransaction` exige **ambas** as regras `.read` e `.write` no nó afetado.
  - As regras em `database.rules.json` concedem `.read` e `.write` para membros autenticados com `appRole: 'admin'` ou `'operator'` em `products`, `sales` e `inventory`, e para `admin` em `purchases` e `settings`. Nenhuma ampliação indevida de permissões foi necessária.

### 12.3. Regras de Segurança do RTDB como Fronteira de Integridade
O arquivo `database.rules.json` foi endurecido com garantias estruturais adicionais avaliadas no servidor:
- **`products/$productId`:**
  - Validação de correspondência de ID: `newData.child('id').val() === $productId`.
  - Imutabilidade do ID: `!data.exists() || !data.hasChild('id') || data.child('id').val() === newData.child('id').val()`.
  - Monotonicidade de versão (anti-downgrade): `!newData.hasChild('version') || (newData.child('version').isNumber() && (!data.exists() || !data.hasChild('version') || newData.child('version').val() >= data.child('version').val()))`.
- **`sales/$saleId`:**
  - Correspondência de ID: `newData.child('id').val() === $saleId`.
  - Imutabilidade de ID e de `productId`: não permite mutação de produto em venda existente.
- **`purchases/$purchaseId`:**
  - Correspondência de ID e imutabilidade de `id`.
- **`inventory/$movementId`:**
  - Regra append-only estrita preservada: `!data.exists() && newData.exists()`. Atualizações e deleções são terminantemente rejeitadas.

### 12.4. Integridade do Payload e Hash SHA-256 Canônico
- **Evolução Criptográfica:** Substituição do hash de 64 bits por SHA-256 canônico determinístico em puro JavaScript (FIPS 180-4, sem dependências externas e 100% offline).
- **Formato:** `can_sha256_${64_hex_chars}`.
- **Envelope de Normalização:** Inclui metadados de entidade (`_entityType`, `_tenantId`), chaves ordenadas lexicalmente e normalização profunda recursiva de objetos, arrays, números e booleanos.
- **Campos Voláteis Ignorados:** `updatedAt`, `createdAt`, `_serverTimestamp`, `sourceDeviceId`, `lastMutationId`, `deletedAt`, `origin`.
- **Campos de Concorrência Preservados:** `baseVersion` é tratado como campo não-volátil relevante para integridade de conflito.
- **Limites do Hash:** O hash atesta unicamente a integridade e equivalência do conteúdo de negócio; **não constitui prova de autorização, assinatura de não-repúdio nem prova criptográfica de origem**.
- **Retrocompatibilidade:** Identificação automática de hashes legados de 64 bits (`isLegacyPayloadHash`) e verificação retroativa em `verifyPayloadIntegrity`.

### 12.5. Movimentos de Estoque e Operações Compostas
- Cada efeito dependente de estoque gerado por Venda (`SaleService`) ou Compra (`PurchaseService`) é instanciado com ID lógico estável e persistido no IndexedDB antes de qualquer sincronização.
- O ledger append-only `/inventory` jamais é sobrescrito em retries. Se o registro remoto já existir e for equivalente, a operação é finalizada como `SYNCED` sem envio redundante.
- Falhas de transporte com resultado remoto incerto mantêm o item bloqueado com `remoteOutcomeUnknown: true` e `requiresResolution: true`.

### 12.6. Resultados dos Testes Concorrentes no RTDB Emulator
A suíte executável `tests/rules_emulator_phase13.test.js` carrega o arquivo real `database.rules.json` no Realtime Database Emulator (porta 9000) e valida com dois clientes autenticados:
- Dois clientes criando o mesmo ID com dados divergentes (exatamente 1 comita, segundo aborta sem sobrescrever).
- Duas criações com o mesmo ID e conteúdo equivalente (segundo reconhece `alreadyApplied: true`).
- Atualizações concorrentes baseadas na mesma versão base (primeiro avança para v2, segundo aborta com conflito de versão).
- Atualização tardia (stale update) rejeitada sem tocar no banco.
- Cliente lê v1 e tenta sobrescrever após mutação concorrente para v2 (rejeitado atomicamente).
- Tentativa de transação por tenant incompatível (negada com `PERMISSION_DENIED`).
- Rejeição de mutações em `inventory` existente, retrocesso de versão de produto e adulteração de `id`.
- Total no emulador RTDB: **146 testes aprovados, 0 falhas**.

### 12.7. Garantias Não Comprovadas Sem Integração Remota Real
- **Concorrência sob Latência WAN Heterogênea:** Os testes concorrentes executam localmente contra o RTDB Emulator em localhost (~1-5ms de latência). O comportamento de retry do cliente Firebase sob alta latência WAN intercontinental (50-200ms) com clock drift requer homologação em ambiente de staging na nuvem (Fase 15).
- **Quotas de Transação da Nuvem:** O limite de concorrência simultânea em um único nó RTDB na nuvem não é exercitado no emulador.

---

## 13. Fase 14.13 — Server-Side Version Enforcement, Direct-Write Resistance & Legacy Mutation Safety

### 13.1. Diagnóstico das Regras Anteriores e Vulnerabilidade de Monotonicidade
Na Fase 14.12, as regras em `database.rules.json` aplicavam uma validação de versão monotônica básica para produtos:
`newData.child('version').val() >= data.child('version').val()`.
Essa condição isolada apresentava fragilidades quando submetida a escritas diretas de clientes via SDK (`set()`, `update()`), contornando o `FirebaseRealtimeProvider`:
1. **Mutação com Mesma Versão:** Permitiria alterar campos comerciais de um produto reenviando a mesma versão (`v === v`), contornando a detecção de concorrência.
2. **Saltos Arbitrários de Versão:** Permitiria enviar diretamente `v = 100` a partir de `v = 1`, quebrando o histórico contínuo de versões.
3. **Ausência de Exigência de Versão-Base no Servidor:** O cliente não era obrigado pelo servidor a comprovar que baseou sua alteração na versão remota atual (`baseVersion === currentVersion`).
4. **Risco em Deleção Física de Produtos e Transações:** Operadores podiam potencialmente chamar `remove()` em produtos ou vendas se a regra `.write` não barrasse `newData.exists()`.
5. **Entidades Financeiras:** Vendas e compras não possuíam regras no servidor impedindo a alteração arbitrária de valores, quantidades e produtos de transações já efetuadas.

### 13.2. Contrato Canônico de Criação e Atualização por Entidade

| Entidade | Criação (`!data.exists()`) | Atualização (`data.exists()`) | Exclusão Física (`!newData.exists()`) | Campos Imutáveis | Requisitos de Versionamento no Servidor |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`products`** | Registro ausente; `id === $productId`; `tenantId` correspondente; versão inicial (`version >= 1`). | Requer `baseVersion === currentVersion`; `newVersion === currentVersion + 1`; `id` imutável. | Proibida para `operator` (`newData.exists()`). Admin pode exclusão física ou lógica (`deletedAt`). | `id` | CAS Estrito no Servidor: `baseVersion === data.child('version').val()` e `version === data.child('version').val() + 1`. |
| **`sales`** | Registro ausente; `id === $saleId`; `tenantId` correspondente. | Proibida mutação de campos comerciais. Permitido apenas cancelamento (`cancelledAt`, `cancelReason`, etc.). | Terminantemente Proibida (`newData.exists()`). | `quantity`, `totalSaleCents`, `unitSalePriceCents`, `unitCostCents`, `productId`, `date` | Imutabilidade financeira de campos de negócio. |
| **`purchases`** | Registro ausente; `id === $purchaseId`; `tenantId` correspondente. | Proibida mutação de campos comerciais. Permitido apenas cancelamento (`cancelledAt`, `cancelReason`, etc.). | Terminantemente Proibida (`newData.exists()`). | `totalAmountCents`, `productId`, `quantity`, `supplierId`, `date` | Imutabilidade financeira de campos de negócio. |
| **`inventory`** | Append-only estrito: `!data.exists() && newData.exists()`. | Terminantemente Proibida (`PERMISSION_DENIED`). | Terminantemente Proibida (`PERMISSION_DENIED`). | Todos os campos do ledger. | Ledger imutável. Sem updates ou deletes. |

### 13.3. Estabelecimento e Preservação de `baseVersion`
1. **Captura na Edição:** A versão-base (`baseVersion`) é capturada diretamente do registro em memória que o usuário editou no cliente (`ProductService`).
2. **Preservação na Outbox:** O item enfileirado na Outbox retém `item.baseVersion` e o payload contém explicitamente `baseVersion`.
3. **Preservação no Provedor e no Nó Remoto:** O `FirebaseRealtimeProvider` e o `MockRealtimeProvider` preservam `baseVersion` no payload mesclado enviado ao servidor RTDB, persistindo-o no documento remoto.
4. **Imposição no Backend:** A regra `.validate` do RTDB exige `newData.hasChild('baseVersion') && newData.child('baseVersion').val() === data.child('version').val()`, tornando impossível qualquer tentativa de update concorrente baseado em estado obsoleto.

### 13.4. Tratamento Seguro de Registros Legados
- Para nós legados existentes no RTDB que não possuem a propriedade `version` (`!data.hasChild('version')`):
  - A regra permite a transição inicial para versionamento canônico exigindo `newData.child('version').isNumber() && newData.child('version').val() >= 1`.
  - Imediatamente após essa primeira escrita versionada, qualquer atualização subsequente cai sob o contrato estrito de CAS (`baseVersion === currentVersion` e `version === currentVersion + 1`).
  - Atualizações de produtos versionados que omitirem `baseVersion` são sumariamente rejeitadas pelo backend com `PERMISSION_DENIED`.

### 13.5. Comprovação de Resistência a Escritas Diretas (Bypass do Provedor)
A suíte `tests/rules_emulator_phase13.test.js` foi expandida com 18 cenários exaustivos (Fase 14.13), executando chamadas diretas com SDK do Firebase (`set()`, `update()`, `remove()`):
1. **Criação v1 Válida:** Aceita com sucesso.
2. **Tentativa de Re-criação com Payload Divergente:** Bloqueada pelo servidor.
3. **Tentativa de Modificar Conteúdo Mantendo a Mesma Versão:** Bloqueada pelo servidor.
4. **Tentativa de Salto de Versão (v1 para v3):** Bloqueada pelo servidor.
5. **Atualização com Incremento Estrito (+1) e `baseVersion` Correto:** Aceita com sucesso.
6. **Atualização com `baseVersion` Obsoleto:** Bloqueada pelo servidor; o registro remoto permanece intacto no estado v2.
7. **Atualização com `baseVersion` Arbitrariamente Superior:** Bloqueada pelo servidor.
8. **Atualização com ID Adulterado no Payload:** Bloqueada pelo servidor.
9. **Atualização Cross-Tenant:** Bloqueada pelo servidor com `PERMISSION_DENIED`.
10. **Tentativa de Retroceder Versão (v2 para v1):** Bloqueada pelo servidor.
11. **Tentativa de Sobrescrita ou Deleção no Ledger de Estoque (`/inventory`):** Bloqueada com `PERMISSION_DENIED`; ledger preservado intacto.
12. **Tentativa de Alterar Campos Comerciais em Vendas/Compras:** Bloqueada pelo servidor; cancelamento com metadados auditáveis permitido.
13. **Tentativa de Deleção Física em Vendas/Compras:** Bloqueada pelo servidor (`PERMISSION_DENIED`).
14. **Tentativa de Update Legado sem `baseVersion`:** Bloqueada pelo servidor.
15. **Tentativa de Escrita em Caminho Ancestral para Bypass:** Bloqueada pelo servidor.
16. **Tentativa de Deleção Física de Produto por Operador:** Bloqueada pelo servidor (`PERMISSION_DENIED`).
17. **Soft-delete Lógico Canônico por Operador:** Aceito com sucesso (`deletedAt` preenchido).
18. **Corrida Concorrente Direta entre Clientes Autorizados:** O primeiro cliente avança para v2; o segundo cliente (enviando a mesma `baseVersion: 1`) é rejeitado pelo servidor com erro de permissão/validação.

### 13.6. Garantias Não Comprovadas e Limitações Residuais
- **Validação de Tipos Complexos no RTDB:** O motor de regras do Realtime Database avalia expressões booleanas em nós atômicos. Ele não executa deep-equality em objetos JSON aninhados arbitrários; a garantia de equivalência de negócio fina continua sendo exercida cooperativamente pelo hash SHA-256 canônico (`operationIdentity.js`) e pela função transacional `runTransaction`.
- **Dependência de Claims Canônicas:** A segurança do backend pressupõe a emissão confiável de `appRole` e `tenantId` pelo Firebase Admin SDK.
- **Homologação em Nuvem:** Todos os testes de escrita direta foram validados no Firebase RTDB Emulator local. A validação sob serviços remotos gerenciados pelo Google Cloud faz parte da Fase 15 de staging.

---

## 14. Fase 14.14 — End-to-End Version Contract, Legacy Bootstrap & BaseVersion Integrity

### 14.1. Auditoria e Contexto Real das Expressões em `database.rules.json`
Foi esclarecida e corrigida a discrepância documental referente ao contexto de avaliação das regras no Realtime Database:
- **Caminho de Avaliação:** A regra `.validate` está posicionada exatamente em `/tenants/$tenantId/products/$productId`.
- **Semântica de Contexto:** 
  - `newData` representa o objeto completo do produto sendo gravado.
  - `data` representa o snapshot pré-existente do produto naquele caminho.
  - O acesso às propriedades ocorre diretamente via `newData.child('version')` e `newData.child('baseVersion')`.
  - O uso de `parent()` apontaria para o nó da coleção `/products`, e não para o produto; portanto, as regras no arquivo real utilizam corretamente acessos diretos aos filhos de `$productId`.

### 14.2. Contrato Canônico de Versionamento e Tipagem Inteira
O contrato estabelece regras rígidas para criação e progressão:
1. **Criação de Produto:**
   - Exige registro prévio inexistente (`!data.exists()`).
   - Se o nó contiver `version`, este deve ser estritamente inteiro (`val() % 1 === 0`), inicializado em `1` (`val() === 1`), e `baseVersion` deve ser omitido ou `0`.
   - Valores negativos, decimais fracionários (ex.: `1.5`), strings ou saltos iniciais (ex.: criar diretamente com `version: 2`) são sumariamente rejeitados pelo servidor.
2. **Atualização Normal de Produto Versionado:**
   - Exige que o registro já exista com versão (`data.exists() && data.hasChild('version')`).
   - `version` e `baseVersion` devem ser números inteiros (`% 1 === 0`).
   - `baseVersion` deve ser estritamente igual à versão atual no banco (`newData.child('baseVersion').val() === data.child('version').val()`).
   - `version` deve avançar exatamente 1 unidade (`newData.child('version').val() === data.child('version').val() + 1`).
   - Sequências contínuas `v1 -> v2 -> v3 -> v4` funcionam monotonicamente. Saltos arbitrários, retrocessos ou atualizações com `baseVersion` obsoleto/ausente são rejeitados pelo servidor mantendo o snapshot original intacto.

### 14.3. Bootstrap Seguro de Registros Legados sem Versão
Para nós remotos que não contêm o campo `version` (`!data.hasChild('version')`):
- O backend rejeita saltos arbitrários para versões elevadas (ex.: `version: 10`), recusa `baseVersion` arbitrário e recusa atualizações que omitam `baseVersion`.
- Permite apenas a transição controlada:
  - Inicialização canônica via transação: `baseVersion: 1, version: 2` (promovendo o registro ao regime versionado formal).
  - Ou definição inicial: `version: 1, (!baseVersion || baseVersion === 0)`.
- Disputas concorrentes entre clientes partindo do mesmo registro legado sem versão resultam em exatamente 1 vencedor; a transação do perdedor detecta a atualização remota e aborta de forma segura sem corromper dados comerciais.

### 14.4. Ciclo de Vida e Papel de `baseVersion`
- **Classificação:** `baseVersion` é metadado do mecanismo de concorrência e sincronização otimista (CAS), e não dado comercial do domínio.
- **Normalização e Idempotência:**
  - Persistido no documento remoto para suportar a validação das regras do servidor.
  - Excluído das comparações de equivalência comercial canônica (`operationIdentity.js`), impedindo que a presença do metadado crie falsos conflitos ou modifique indevidamente hashes de operação da Outbox.
  - Paridade total comprovada entre `FirebaseRealtimeProvider` e `MockRealtimeProvider`.

### 14.5. Limitações de Garantia e Estado de Migração
- A validação de regras do RTDB protege os nós folha e o esquema imediato no emulador local.
- Registros legados ambíguos permanecem protegidos contra mutações normais cegas até que sejam regularizados mediante bootstrap determinístico ou migração autorizada.

---

## 15. Fase 14.15 — Fechamento das Brechas de Versionamento, CAS e Proteção contra Escritas Diretas

### 15.1. Fechamento Definitivo da Brecha de Omissão de `version`
Na Fase 14.14, a regra em `/tenants/$tenantId/products/$productId` continha a cláusula condicional `(!newData.hasChild('version') || ...)`. Essa modelagem abria uma brecha onde clientes podiam criar produtos sem `version` ou remover campos de versionamento via `update({ version: null })`, contornando completamente o controle de concorrência.
Na **Fase 14.15**, essa brecha foi categoricamente fechada:
- A regra `.validate` agora exige obrigatoriamente: `newData.hasChildren(['id', 'name', 'salePriceCents', 'version'])`.
- O campo `version` é **estritamente inegociável** em qualquer operação de escrita.
- Tentativas de criação sem `version`, escrita com `version: null`, escrita de objeto completo omitindo `version` ou atualizações parciais via `update({ version: null })` são imediatamente rejeitadas pelo servidor RTDB.

### 15.2. Contrato Estrito de Criação e Atualização por Versão
1. **Criação de Produto Novo (`!data.exists()`):**
   - Exige `version` presente, numérico e inteiro (`newData.child('version').val() % 1 === 0`).
   - Exige estritamente `version === 1`.
   - `baseVersion` deve ser ausente ou número inteiro igual a `0`.
   - Rejeição absoluta de valores nulos, negativos, decimais fracionários, textuais ou saltos iniciais (`version >= 2`).
   - Identidade imutável coerente: `newData.child('id').val() === $productId` e `newData.child('tenantId').val() === $tenantId`.
2. **Atualização de Produto Versionado (`data.exists()`):**
   - Exige que o registro existente possua `version` (`data.hasChild('version')`).
   - Exige `version` e `baseVersion` presentes, numéricos e inteiros (`% 1 === 0`).
   - Exige `baseVersion === data.child('version').val()` (CAS rigoroso contra versão no servidor).
   - Exige `version === data.child('version').val() + 1` (incremento estrito de exatamente 1 unidade).
   - Rejeição absoluta de remoção de `baseVersion` (`update({ baseVersion: null })`), remoção simultânea de ambos os campos, reutilização da mesma versão com dados divergentes, saltos e retrocessos.
   - Identidade e `tenantId` permanecem imutáveis.

### 15.3. Política Segura para Registros Legados sem `version`
- **Bloqueio de Mutações por Clientes Comuns:** Clientes operacionais ou de aplicativo comum não possuem rota de escape para alterar registros legados não-versionados (`!data.hasChild('version')`).
- **Nenhum Bootstrap Genérico não Autorizado:** Tentativas de clientes comuns realizarem bootstrap em registros legados sem versão são rejeitadas pelo `.validate` do servidor, impedindo que campos comerciais sejam adulterados sob pretexto de migração.
- **Preservação e Legibilidade:** Registros legados existentes permanecem 100% íntegros e legíveis por usuários autorizados do respectivo tenant.
- **Migração Administrativa Futura (Fase 15):** A regularização e inclusão do atributo `version` em registros legados reais fica formalmente delegada ao procedimento supervisionado via Firebase Admin SDK com credenciais de serviço na Fase 15.

### 15.4. Exclusão Física, Exclusão Lógica e Barreiras em Nível `.write`
- As regras de validação `.validate` do RTDB não executam quando o nó resultante é `null` (exclusão física via `remove()` ou `set(null)`).
- A proteção contra exclusões indevidas é garantida em nível de regra `.write`:
  - Em `/tenants/$tenantId/products/$productId`: Operadores (`operator`) estão proibidos de exclusão física (`newData.exists() || auth.token.appRole === 'admin'`). Apenas administradores podem executar `remove()`. Operadores executam exclusão lógica (soft-delete) via CAS (`deletedAt`).
  - Em `/tenants/$tenantId/sales/$saleId` e `/tenants/$tenantId/purchases/$purchaseId`: Exclusão física é **proibida para todos os papéis**, inclusive `admin` (`newData.exists()`). Todos os campos comerciais e financeiros fundamentais são estritamente imutáveis.
  - Em `/tenants/$tenantId/inventory/$movementId`: Coleção append-only de ledger estrita. Proibida qualquer atualização parcial, alteração de delta/tipo ou exclusão (`!data.exists() && newData.exists()`).

### 15.5. Validação no Cliente vs. Imposição no Servidor
- A validação realizada nos serviços do cliente (`ProductService`, `SyncEngine`, `operationIdentity.js`) atua como primeira barreira de experiência do usuário e consistência do Outbox.
- A autoridade final e indefrágil é exercida pelo servidor do Realtime Database através das regras de segurança compiladas no motor do Firebase.

### 15.6. Ambiente Local e Isolamento de Serviços Reais
- Todos os testes de segurança, validação de concorrência e integridade foram executados exclusivamente contra o Firebase Realtime Database Emulator e Firebase Storage Emulator locais (`demo-gerenciador-produtos-staging`).
- Nenhum serviço em nuvem de produção (Firebase Cloud, Supabase Cloud, Google Cloud) foi acessado, consultado ou modificado.
- Nenhuma credencial ou arquivo `.env.*` foi inspecionado ou alterado.

---

## 16. Fase 14.21 — Auditoria de Identidade Canônica, ACKs Atrasados, Isolamento do Outbox e Limitações de Atomicidade

### 16.1. Convenção Canônica Estrita de Custom Claims
- **Nomes Canônicos:** `tenantId` e `appRole` são as únicas claims aceitas para autorização empresarial e isolamento multitenant no GestãoPro.
- **Eliminação de Fallback Residual:** O `authGuard.js` e as regras de segurança recusam qualquer concessão de privilégios de mutação via `role` legado ou `tenant_id` legado. Tokens com apenas `role` são rebaixados de forma fechada (*fail-closed*) para `viewer`, impedindo qualquer escrita.
- **Isolamento de Tenant Obrigatório:** Nenhuma mutação é autorizada se `session.tenantId` for nulo, indefinido ou divergente do recurso acessado.

### 16.2. Tratamento Seguro de ACKs Atrasados e Recuperação de Leases
- **Segurança de ACKs Suplantados:** Quando uma tentativa anterior (`attemptId`) recebe uma confirmação remota após o término de sua concessão (`claimTimeoutMs`) ou após outra instância ter assumido o despacho:
  - O ACK atrasado é persistido de forma isolada em `item.staleAttemptAcks` e marca `item.remoteAckReceived = true` para que a evidência de entrega remota não seja descartada.
  - O ACK atrasado **NUNCA** reverte o status da operação de `FAILED` para `SYNCED`, nem remove a flag `requiresResolution: true` definida por uma reconciliação posterior da tentativa titular.
- **Atomicidade Transacional:** Transições de estado do Outbox (`markSynced`, `markFailed`, `recordRemoteAck`) são executadas em transações atômicas no IndexedDB (`executeTransaction(['syncQueue'], 'readwrite')`), rejeitando confirmações de instâncias suplantadas.

### 16.3. Distinção entre Ausência Remota e Falha de Transporte/Autorização
- **Ausência Remota Confirmada (`NOT_FOUND`):** Apenas leitura autorizada bem-sucedida que retorna explicitamente `null` indica a ausência do nó remoto.
- **Falhas de Leitura (`INACCESSIBLE`):** Exceções de transporte, timeouts, desconexões e `PERMISSION_DENIED` jamais são convertidas silenciosamente em registro ausente. São classificadas como `INACCESSIBLE` e mantêm o item pendente para nova tentativa sem alterar o estado do registro ou assumir idempotência.

### 16.4. Matriz de Recuperação e Reconciliação por Entidade e Ação
1. **CREATE:**
   - Se ausente no servidor: Elegível para nova tentativa automática mantendo a mesma identidade canônica (`operationId`, `hash`).
   - Se equivalente no servidor: Reconciliação imediata como `SYNCED` sem mutação duplicada.
   - Se divergente no servidor: Bloqueio imediato (`FAILED`, `requiresResolution: true`, `RECORD_DIVERGENT`) para evitar colisão de ID.
2. **UPDATE de Produto Versionado:**
   - Se ausente no servidor: Bloqueio estrito com `UPDATE_ON_ABSENT_RECORD` (`requiresResolution: true`). Jamais é convertido silenciosamente em `CREATE`.
   - Se existente no servidor: Validação estrita de CAS (`baseVersion` e `version`). Se equivalente, `SYNCED`; se divergente ou com salto/regressão de versão, bloqueio para intervenção humana.
3. **DELETE:**
   - Se ausente no servidor: Conclusão idempotente (`SYNCED`, `ALREADY_DELETED`), desde que comprovada a correspondência de `tenantId` e identidade.
4. **Ledger Append-Only (Movimentações de Estoque, Vendas, Compras):**
   - Se resultado remoto for desconhecido: Bloqueio com `requiresResolution: true` e preservação integral dos dados locais. Proibida retentativa cega que possa duplicar débitos/créditos ou lançamentos fiscais.

### 16.5. Limitações de Atomicidade entre Stores e Armazenamento em Nuvem
- **IndexedDB (`imageManifest` vs `productImages`):** O IndexedDB não suporta transações de duas fases nativas (*2PC*) distribuídas entre o armazenamento local e as chamadas REST em nuvem. No ambiente local, operações que exigem gravação de metadados e blobs binários utilizam transações estritas no nível do respectivo repositório (`executeTransaction`).
- **Resolução de Desalinhamento (Storage vs RTDB):** Se o upload do binário for concluído no bucket (`product-images`) mas a sincronização do manifesto no banco falhar, o sistema marca a operação com `remoteOutcomeUnknown: true` ou `requiresResolution: true`. A reconciliação verifica a existência do hash SHA-256 e tamanho do blob remoto antes de decidir a retentativa ou descarte, prevenindo arquivos órfãos sem referências canônicas.

---

## 18. Fase 14.23 — Consistência Final da Recuperação do Ledger, Semântica de Claims e Prontidão para Staging

### 18.1. Resolução Definitiva da Divergência de Recuperação (Máquina de Estados Única)
A auditoria da Fase 14.22 identificou uma divergência documental e funcional entre seções que tratavam resultados remotos desconhecidos no ledger append-only (`/inventory`):
- **Divergência Resolvida:** Uma leitura remota inacessível (timeout de rede, desconexão transitória) **NÃO é ausência de registro** e **NÃO autoriza novo envio da escrita comercial**. Contudo, também não deve travar imediatamente o sistema em bloqueio permanente (`FAILED` com `requiresResolution: true`) sem antes esgotar as tentativas de consulta com backoff.
- **Máquina de Estados Unificada:**
  1. **Envio Comprovadamente Não Iniciado (`dispatchStarted === false` sem histórico):** O item é revertido para `status: 'PENDING'` e liberado diretamente para despacho limpo, sem necessidade de consulta remota.
  2. **Tentativa de Leitura Remota (Reconciliação):**
     - **Inacessível / Timeout Transitório (`INACCESSIBLE`):** O item permanece em `status: 'PENDING'`, com `remoteOutcomeUnknown: true`, `requiresResolution: false`, e agenda a próxima tentativa de leitura em `nextReconcileAt` com backoff exponencial (1s, 2s, 4s, 8s, 16s...). **A escrita comercial original NUNCA é reenviada enquanto o resultado remoto for desconhecido.** Ao atingir o teto de 5 tentativas de leitura sem sucesso, a operação é escalada para `status: 'FAILED'`, `requiresResolution: true`, `permanentFailure: true` e `errorCategory: 'unknown_remote_outcome'` para auditoria humana supervisionada.
     - **Erro de Autorização (`PERMISSION_DENIED`):** Falha de segurança estrita. Bloqueia imediatamente como `status: 'FAILED'`, `requiresResolution: true`, `errorCategory: 'security'`.
     - **Ausência Comprovada (`RECORD_ABSENT` / `null`):** Para `CREATE` (inclusive no ledger append-only), a ausência autoriza a transição para novo despacho comercial. Para `UPDATE`, ausência remota bloqueia como `UPDATE_ON_ABSENT_RECORD` (`requiresResolution: true`), jamais convertendo em criação. Para `DELETE`, ausência conclui como `ALREADY_DELETED` (`SYNCED`).
     - **Registro Remoto Equivalente (`RECORD_EQUIVALENT`):** A mutação já foi aceita pelo backend. Finaliza imediatamente como `status: 'SYNCED'` sem nova escrita, eliminando qualquer risco de duplicação física ou fiscal de estoque.
     - **Registro Remoto Divergente (`RECORD_DIVERGENT` / `VERSION_CONFLICT`):** Bloqueio estrito como `status: 'FAILED'`, `requiresResolution: true`. Dados locais e remotos são integralmente preservados.
  3. **Escrita Comercial com Falha e Leitura Indisponível:** Se a tentativa de gravação falhar com erro de transporte e a leitura subsequente estiver inacessível, o item é retido em `status: 'PENDING'`, com `remoteOutcomeUnknown: true` e `requiresResolution: false`, forçando o ciclo subsequente a executar reconciliação prévia por leitura antes de qualquer reenvio.

### 18.2. Semântica Rigorosa dos Marcadores de Recuperação do Outbox
| Campo | Significado Semântico | Rotina(s) que Altera(m) | Escopo | Persistência | Sobrevive a Crash? | Invariante Protegida | Requisito para Transição Final `SYNCED` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `remoteAckReceived` | Evidência durável de que **algum** despacho recebeu ACK remoto bem-sucedido na nuvem. | `recordRemoteAck` | Por operação | IndexedDB | Sim | Impede descartar confirmações válidas em nuvem recebidas por tentativas suplantadas. | Exige validação de equivalência se recebido por tentativa suplantada; não transiciona se `requiresResolution: true`. |
| `staleAttemptAcks` | Histórico isolado de respostas recebidas por tentativas cujo lease expirou ou foi suplantado. | `recordRemoteAck`, `markSynced` | Por tentativa | IndexedDB (array) | Sim | Impede que respostas tardias de instâncias antigas sobrescrevam o estado da instância titular ou retirem bloqueios de resolução. | Não autoriza `SYNCED` por si só; serve como evidência para reconciliação pré-despacho. |
| `remoteOutcomeUnknown` | Indica que o resultado da escrita no backend remoto é desconhecido e exige reconciliação por leitura prévia. | `SyncEngine`, `markFailed`, `recordReconcileDeferred` | Por operação | IndexedDB | Sim | **Impede retransmissão cega da escrita**, especialmente no ledger append-only. | Deve ser comprovado como `false` via leitura autorizada equivalente ou ausente. |
| `dispatchStarted` | Evidência atômica de que o payload da tentativa atual começou a ser transmitido à rede. | `claimForDispatch`, `recordDispatchStarted` | Por tentativa | IndexedDB | Sim | Distingue crash antes do envio (libera retry limpo) de crash durante/após envio (exige reconciliação). | Inicia em `false`, vira `true` logo antes de `pushChange`. Preservado via `preserveDispatchStarted: true`. |
| `claimAttemptId` | UUID único da concessão/tentativa de despacho vigente. | `claimForDispatch`, `releaseDispatchClaim`, `markSynced`, `markFailed` | Por tentativa | IndexedDB | Sim | Garante propriedade exclusiva e detecta confirmações ou falhas atrasadas de instâncias suplantadas. | Deve bater exatamente com o `attemptId` ativo para alterar status do registro. |
| `claimExpiresAt` | Timestamp ISO da expiração do lease exclusivo de despacho (padrão 30s). | `claimForDispatch`, `releaseDispatchClaim`, `markSynced` | Por tentativa | IndexedDB | Sim | Permite que uma nova instância recupere itens presos de abas que travaram sem deadlocks. | Leases ativos de outras instâncias são respeitados por `recoverInterruptedInFlight`. |
| `requiresResolution` | Trava de integridade comercial que exige auditoria ou resolução administrativa manual. | `markFailed`, `reconcileOutboxItem` | Por operação | IndexedDB | Sim | Impede que mutações conflitantes, divergentes ou inseguras sejam despachadas à revelia. | Deve ser explicitamente resolvido via `reconcileOutboxItem` com decisão administrativa. |
| `status` | Estado central do ciclo de vida da Outbox (`'PENDING'`, `'SYNCING'`, `'SYNCED'`, `'FAILED'`). | `SyncRepository` (`claimForDispatch`, `markSynced`, `markFailed`, `recordReconcileDeferred`) | Por operação | IndexedDB | Sim | Máquina de estados central do motor de sincronização. | Apenas itens em `SYNCING` com `attemptId` válido ou via reconciliação comprovada transicionam para `SYNCED`. |

### 18.3. Harmonização Canônica de Custom Claims entre Firebase e Supabase
- **`tenantId`:** Identificador canônico do tenant/empresa da sessão ativa. Obrigatório em todas as operações de banco de dados, storage e regras de segurança.
- **`appRole`:** Papel comercial legítimo da aplicação (`'admin'`, `'operator'`, `'viewer'`). Define todas as permissões de negócio e de gravação.
- **`role: 'authenticated'`:** Claim técnica do JWT exigida pelo Supabase Storage / PostgreSQL para identificar que o token possui autenticação válida. **NÃO concede qualquer papel empresarial nem autorização de escrita comercial por si só.**
- **Regras RLS de Supabase Storage:** Validam cumulativamente:
  1. `auth.jwt() ->> 'role' = 'authenticated'` (autenticação técnica presente);
  2. `auth.jwt() ->> 'tenantId' = split_part(name, '/', 2)` (isolamento multitenant estrito);
  3. `(auth.jwt() ->> 'appRole') IN ('admin', 'operator')` para uploads, mutações e deleções.
- **Ausência de Fallbacks:** Não existe conversão automática de `role` para `appRole` nem de `tenant_id` para `tenantId`. Contas sem claims canônicas completas são rebaixadas de forma fechada (*fail-closed*) para `viewer` com `requiresMigration: true`.







