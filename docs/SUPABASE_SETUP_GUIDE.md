# Guia Oficial de Configuração Manual do Supabase Storage — GestãoPro (PHASE 14.6)

**Projeto:** Gerenciador de Produtos (GestãoPro)  
**Objetivo:** Instruções passo a passo para o proprietário provisionar e configurar manualmente o projeto Supabase no plano gratuito (*Free Tier*), integrando-o com o Firebase Authentication e as políticas de segurança multitenant.

---

## 1. Limites do Plano Gratuito (Supabase Free Tier)

| Recurso | Cota Oficial (Free Tier) | Comportamento no GestãoPro |
| :--- | :--- | :--- |
| **Armazenamento de Arquivos (Storage)** | **1 GB total** | Comporta ~4.500 fotos em WebP otimizadas (~220 KB cada). Ao atingir 1 GB, novos uploads falharão com erro descritivo de cota; o app continuará funcionando offline no IndexedDB. |
| **Transferência Mensal (Egress)** | **10 GB/mês** (5 GB cached + 5 GB uncached) | Graças ao `LocalImageCache`, cada foto é baixada apenas uma vez por dispositivo, economizando banda. 10 GB comportam ~45.000 visualizações de fotos novas por mês. |
| **Tamanho Máximo por Arquivo** | **50 MB** | O GestãoPro impõe limite ainda mais rígido de **10 MB** no cliente e no bucket. |
| **Pausa por Inatividade** | **7 dias sem tráfego de banco** | Projetos gratuitos são pausados pela Supabase se ficarem sem tráfego. Como o Storage utiliza APIs HTTP regulares durante a operação diária do GestãoPro, o uso comercial ativo mantém o projeto acordado. |
| **Custo Financeiro** | **R$ 0,00 perpétuo** | Sem necessidade de cadastrar cartão de crédito. |

---

## 2. Passo 1 — Criar o Projeto no Supabase Dashboard

1. Acesse o painel da Supabase: [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Faça login e clique em **"New Project"**.
3. Preencha os dados:
   - **Name:** `gestaopro-staging-storage` (ou nome de sua preferência)
   - **Database Password:** Gere uma senha forte e guarde-a com segurança no seu gerenciador de senhas (nunca no código).
   - **Region:** Selecione `South America (São Paulo) - sa-east-1` para menor latência com o Brasil.
   - **Pricing Plan:** **Free ($0/month)**.
4. Clique em **"Create new project"** e aguarde o provisionamento (cerca de 2 minutos).

---

## 3. Passo 2 — Obter as Credenciais Públicas (API Keys)

1. No menu lateral do projeto, clique na engrenagem **Project Settings** (ou **Connect**).
2. Vá em **API**.
3. Copie com atenção:
   - **Project URL:** Exemplo: `https://abcdefghijklmnopqrst.supabase.co`
   - **Project API Keys > anon (public):** Exemplo: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
4. 🛑 **REGRA DE SEGURANÇA CRÍTICA:**
   - **NUNCA** copie ou utilize a chave `service_role` (secret).
   - Apenas a chave `anon` pública é permitida no frontend.

---

## 4. Passo 3 — Configurar Firebase Auth como Provedor de Terceiros (Third-Party Auth)

Para que o Supabase valide os tokens JWT emitidos pelo Firebase Authentication:

1. No menu lateral, acesse **Authentication > Providers** (ou **Third-Party Auth**).
2. Procure pela opção de **Custom JWT Providers / External Auth / Firebase Auth**.
3. Configure o emissor (*Issuer*) e JWKS:
   - **Issuer URL:** `https://securetoken.google.com/gerenciador-produtos-staging`
   - **JWKS URI:** `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
4. Isso permite que qualquer token assinado pela infraestrutura do Firebase seja verificado de forma matemática pelo Supabase sem compartilhar segredos.

---

## 5. Passo 4 — Criar o Bucket Privado e Aplicar as Políticas RLS

1. No menu lateral, clique em **SQL Editor**.
2. Clique em **"New query"**.
3. Abra e copie integralmente o conteúdo do arquivo local:
   [`supabase/migrations/20261010000000_create_product_images_storage.sql`](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/supabase/migrations/20261010000000_create_product_images_storage.sql)
4. Cole no editor SQL do Supabase e clique em **"Run"** (Ctrl+Enter).
5. O script irá:
   - Criar o bucket privado `product-images` (com `public = false`, limite de 10MB e formatos JPEG/PNG/WebP);
   - Ativar Row Level Security (RLS) em `storage.objects`;
   - Criar as 4 políticas de segurança: `SELECT`, `INSERT`, `UPDATE` e `DELETE`, isolando o acesso estritamente pelo `tenantId` do token.
6. Verificação: Vá em **Storage > Buckets** e confirme que `product-images` aparece com uma etiqueta **"Private"**.

---

## 6. Passo 5 — Provisionamento Seguro de Custom Claims no Firebase Auth

O Supabase exige que o JWT contenha `role: 'authenticated'`. Para que o GestãoPro continue aplicando controle de acesso comercial, separamos o papel de negócio em `appRole`:

### Estrutura Obrigatória das Claims:
```json
{
  "tenantId": "tenant-staging",
  "role": "authenticated",
  "appRole": "admin"
}
```

### Como Atribuir (Via Script Seguro com Firebase Admin SDK):
Em seu ambiente de terminal com a Service Account do Firebase configurada temporariamente fora do repositório:
```javascript
const admin = require('firebase-admin');
// Inicializa com sua credencial administrativa local fora do Git
admin.auth().setCustomUserClaims(userUid, {
  tenantId: 'tenant-staging',
  role: 'authenticated',
  appRole: 'admin'
});
```
*Atenção:* O frontend não pode emitir ou alterar claims. Essa operação deve ser executada apenas via backend ou CLI administrativa.  
*Plano de Transição:* Consulte o plano detalhado de migração segura em [`docs/SUPABASE_CLAIMS_MIGRATION_PLAN.md`](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/docs/SUPABASE_CLAIMS_MIGRATION_PLAN.md).  
*Status da Fase 14.6:* **Nenhuma claim real foi alterada no Firebase Cloud neste momento.** A auditoria global comprovou a coerência canônica da aplicação, e o procedimento administrativo de migração com Firebase Admin SDK permanece como pré-requisito obrigatório antes da publicação de qualquer regra na nuvem.

---

## 7. Passo 6 — Configurar o Arquivo Local `.env.local`

Para testar no seu ambiente de desenvolvimento sem commitar no Git:

1. Crie ou edite o arquivo local `.env.local` (já protegido no `.gitignore`):
```ini
# Ativar Supabase como Provedor de Armazenamento de Fotos
VITE_IMAGE_STORAGE_PROVIDER=supabase
VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_STORAGE_BUCKET=product-images
```

---

## 8. Procedimento de Teste e Validação

1. Inicie a aplicação localmente: `bun run dev`.
2. Faça login com a conta de homologação (`admin@staging.local`).
3. Cadastre um novo produto e adicione uma foto WebP.
4. Verifique no Supabase Dashboard em **Storage > product-images**:
   - A imagem deve aparecer em `tenants/tenant-staging/products/{productId}/{photoId}.webp`.
5. Abra o GestãoPro em uma janela anônima com outro usuário do mesmo tenant: a foto deve carregar normalmente.
6. Tente acessar com um usuário de outro tenant: o acesso deve ser bloqueado com erro 403 / `permission_denied` pelo RLS.

---

## 9. Observações sobre Autorização Offline e Isolamento Local (Fase 14.7)

* **Operação Totalmente Offline:**
  - Quando desconectado da internet, o GestãoPro aplica a mesma matriz de autorização localmente nos serviços de negócio (`ProductService`, `StockService`, `SaleService`, `PurchaseService`, `SupplierService`).
  - Usuários com papel `viewer` ou com sessão necessitando migração (`requiresMigration: true`) não conseguem criar novos produtos, vendas, compras ou movimentações locais no IndexedDB.
* **Fila Outbox e Mudança de Tenant:**
  - Mutações pendentes geradas offline são etiquetadas com o `tenantId` da sessão ativa.
  - Ao alternar entre contas de diferentes tenants na mesma máquina, o motor de sincronização impede terminantemente o envio de dados do Tenant A sob a sessão do Tenant B.
  - Se a sessão for rebaixada para `viewer`, a operação pendente é mantida com status `FAILED` (permanente), evitando repetições infinitas ou exclusão silenciosa de dados.
* **Delimitação:**
  - Os testes de isolamento e RLS executados até a Fase 14.7 são baseados em emuladores locais e suítes automatizadas de teste. A comprovação de instâncias reais na nuvem Supabase depende do provisionamento remoto futuro.

---

## 10. Administração de Dados Legados e Recuperação Controlada da Outbox (Fase 14.8)

* **Auditoria de Dados Legados sem Tenant:**
  - Registros gerados em versões anteriores do banco (IndexedDB v1/v2/v3) que não possuem `tenantId` permanecem salvaguardados localmente no IndexedDB, mas isolados da sessão ativa de qualquer tenant para impedir vazamento de dados confidenciais.
  - Para verificar a quantidade e os tipos de registros legados pendentes na máquina local, utilize o serviço:
    ```javascript
    import { legacyDataMigrationService } from './js/services/LegacyDataMigrationService.js';
    const auditReport = await legacyDataMigrationService.auditLegacyData();
    console.log(auditReport);
    ```
* **Atribuição Automática por Proveniência Relacional Inequívoca:**
  - Registros com relacionamento relacional comprovado (ex.: fotos e movimentações vinculadas a produtos já atribuídos, ou produtos com fotos em `imageManifest` exclusivas de um único tenant) são migrados de forma segura e idempotente:
    ```javascript
    const result = await legacyDataMigrationService.migrateUnequivocalRecords();
    ```
  - Registros ambíguos permanecem marcados com `tenantStatus: 'PENDING_ATTRIBUTION'` e isolados no banco local.
* **Recuperação de Operações da Outbox (`retryFailed`):**
  - Operações falhas na fila de sincronização (`syncQueue`) decorrentes de perda transitória de rede ou indisponibilidade temporária de serviço podem ser reprocessadas:
    ```javascript
    import { syncRepository } from './js/repositories/SyncRepository.js';
    const retriedCount = await syncRepository.retryFailed({ eligibleOnly: true });
    ```
  - Operações com erro permanente (rejeição de autorização, ausência de tenant ou dados inválidos) exigem intervenção de um administrador e **não** são reativadas automaticamente, prevenindo loops de retry ou envio acidental de registros corrompidos.

---

## 11. Fronteira de Confiança de Tenant e Reconciliação Humana Estruturada (Fase 14.9)

* **Fronteira de Confiança (`AttributionTrustBoundary.js`):**
  - Passar strings arbitrárias como `{ source: 'ADMIN_RECONCILIATION_VERIFIED' }` é sumariamente rejeitado. Strings descritivas não constituem prova de autorização.
  - O método `migrateUnequivocalRecords()` migra exclusivamente dados com proveniência relacional inequívoca.
* **Plano de Reconciliação Humana para Registros Ambíguos:**
  - Para atribuir registros que não possuem proveniência relacional comprovada, um administrador autenticado deve submeter um plano formal de reconciliação:
    ```javascript
    import { legacyDataMigrationService } from './js/services/LegacyDataMigrationService.js';
    import { authService } from './js/services/AuthService.js';

    const session = authService.getCurrentSession(); // Requer papel 'admin'
    const plan = {
      targetTenantId: 'tenant-empresa-a',
      confirmedByHuman: true,
      confirmedByUserId: session.uid,
      reason: 'Reconciliação validada após inventário físico e auditoria de notas fiscais',
      records: [
        { storeName: 'products', id: 'prod-legado-1' },
        { storeName: 'products', id: 'prod-legado-2' }
      ]
    };

    const result = await legacyDataMigrationService.executeHumanReconciliationPlan(plan, session);
    console.log(result); // { reconciledCount, cascadedCount, totalAffected, details }
    ```
  - A operação executa atomicamente em uma transação multi-store no IndexedDB e propaga a atribuição para dependências em cascata (`productImages`, `imageManifest`, `stockMovements`, `sales`, `purchases`).
* **Proteção contra Duplicação no Ledger e Resultado Remoto Desconhecido:**
  - Se uma operação da Outbox foi aceita remotamente antes de uma troca de sessão, a fila retém `remoteAckReceived: true` e a finaliza como `SYNCED` no retorno do usuário sem reenviar na nuvem.
  - Movimentações de estoque com resultado remoto desconhecido (`remoteOutcomeUnknown`) têm retentativa automática bloqueada para proteger o saldo de estoque contra duplicação acidental.

---

### FASE 14.10: Diretrizes de Reconciliação, Transações e Recuperação de Falhas

* **Quem pode executar reconciliação:**
  - Exclusivamente administradores com token canônico ativo (`appRole: 'admin'`) autenticados via `AuthService`.
  - Tentativas com sessão não autenticada, operadores comuns (`operator`), visualizadores (`viewer`) ou sessões com `requiresMigration: true` são bloqueadas de forma fechada (*fail-closed*).
* **Transações no IndexedDB:**
  - As operações de migração e reconciliação cobrem a lista canônica de stores: `products`, `imageManifest`, `productImages`, `stockMovements`, `sales`, `purchases`, `suppliers`, `productSuppliers` e `syncQueue`.
  - Em caso de qualquer falha no curso do processo, a transação aborta integralmente sem deixar registros parciais inconsistentes.
* **Idempotência e Recuperação na Inicialização:**
  - Operações de catálogo e cadastros utilizam escrita chave-idempotente no caminho determinístico `/tenants/{tenantId}/{collection}/{id}`.
  - Movimentações de estoque no nó `/tenants/{tenantId}/inventory/{id}` são imutáveis e append-only; em caso de falha de conexão sem confirmação (resultado remoto desconhecido), a operação é bloqueada de retentativa cega para evitar divergência física no estoque.

---

### FASE 14.11: Procedimento Operacional de Auditoria e Reconciliação Manual da Outbox

Quando uma operação for retida na Outbox com `requiresResolution: true` (por resultado remoto desconhecido ou conflito de payload divergente), utilize o procedimento operacional abaixo:

1. **Inspeção Estruturada da Operação:**
   ```javascript
   import { syncEngine } from './js/services/SyncEngine.js';
   import { authService } from './js/services/AuthService.js';

   // Requer sessão ativa com papel 'admin' ou 'operator'
   const inspection = await syncEngine.inspectOutboxItem('item-outbox-uuid');
   console.log(inspection);
   /*
   {
     id: 'item-outbox-uuid',
     entityType: 'products',
     entityId: 'prod-123',
     status: 'FAILED',
     errorCategory: 'payload_divergence_conflict',
     canonicalPayloadHash: 'can_8a1f...',
     localPayload: { ... },
     remoteRecord: { ... },
     comparisonOutcome: 'RECORD_DIVERGENT',
     divergentFields: [ { field: 'salePriceCents', localValue: 2500, remoteValue: 3000 } ]
   }
   */
   ```

2. **Execução de Decisão de Reconciliação (Apenas Admin):**
   ```javascript
   // Opção A: Aceitar versão remota autoritativa (finaliza local como SYNCED)
   await syncEngine.reconcileOutboxItem('item-outbox-uuid', 'ACCEPT_REMOTE', {
     reason: 'Confirmado com o setor de compras que o preço remoto R$ 30,00 é o correto'
   });

   // Opção B: Descartar mutação local inválida
   await syncEngine.reconcileOutboxItem('item-outbox-uuid', 'DISCARD_LOCAL', {
     reason: 'Operação descartada devido a erro de digitação do operador'
   });

   // Opção C: Liberar novo envio após confirmar ausência de duplicação
   await syncEngine.reconcileOutboxItem('item-outbox-uuid', 'RETRY_CONFIRMED', {
     reason: 'Verificado via console que o registro não foi persistido no banco remoto'
   });
   ```

3. **Invariantes e Regras de Segurança:**
   - O ledger de estoque (`stockMovements`/`inventory`) é estritamente append-only. O comando `OVERWRITE_REMOTE` é bloqueado e rejeitado pelo motor para evitar corrupção do histórico contábil.
   - Qualquer intervenção via `options.force: true` exige autenticação de `admin` e jamais gera um novo identificador lógico de negócio para burlar restrições do servidor.

---

### FASE 14.13: Diretrizes Operacionais de Controle de Versão e Invariantes no Servidor

* **Regras de Atualização de Produtos no Servidor:**
  - O Realtime Database valida que qualquer atualização de produto versionado forneça obrigatoriamente `baseVersion` igual à versão existente no banco e `version` estritamente igual a `versão_atual + 1`.
  - Tentativas de salvar alterações concorrentes baseadas em versão desatualizada (stale update) ou pular versões são sumariamente rejeitadas com erro de validação/permissão.
* **Política de Exclusão Física vs. Lógica:**
  - Usuários com papel `operator` são bloqueados pelo servidor RTDB de executar exclusão física (`remove()`). Exclusões devem ser realizadas via soft-delete preenchendo o campo `deletedAt`.
  - Exclusão física é permitida unicamente para `admin`.
* **Imutabilidade de Registros Comerciais e Ledger de Estoque:**
  - Vendas (`sales`) e compras (`purchases`) não podem ser fisicamente excluídas por nenhum papel. Seus dados financeiros e quantidades são imutáveis; cancelamentos devem preencher `cancelledAt` e `cancelReason`.
  - Movimentações de estoque (`inventory`) são append-only e não admitem atualização ou exclusão sob nenhuma circunstância.

---

### FASE 14.14: Diretrizes Operacionais de Versionamento Fim-a-Fim e Bootstrap Legado

* **Contrato Rígido de Criação e Atualização de Produtos:**
  - **Criação:** Produtos novos versionados exigem `version: 1` e `baseVersion` ausente ou igual a `0`. Tentativa de criar produto com `version: 2`, valores decimais ou negativos é recusada pelo servidor.
  - **Atualização:** Produtos versionados exigem número inteiro estrito (`% 1 === 0`), `baseVersion === versão_atual` e `version === versão_atual + 1`. A progressão `v1 -> v2 -> v3 -> v4` é monotonicamente comprovada.
* **Bootstrap Controlado de Registros Legados sem Versão:**
  - Nós legados no Realtime Database sem a propriedade `version` não podem receber saltos arbitrários nem updates sem `baseVersion`.
  - O bootstrap canônico ocorre via transação com `baseVersion: 1, version: 2` ou `version: 1`. Disputas concorrentes garantem que apenas 1 cliente vence, preservando a integridade dos dados sem sobrescrita destrutiva.
* **Preservação de `baseVersion` e Paridade entre Provedores:**
  - `baseVersion` é mantido no documento remoto para suportar a regra `.validate`, porém é tratado como metadado de sincronização, sem poluir o cálculo do hash canônico SHA-256 (`operationIdentity.js`).
  - O `MockRealtimeProvider` e o `FirebaseRealtimeProvider` compartilham paridade de detecção de conflitos de concorrência e idempotência em retentativas.

---

### FASE 14.15: Diretrizes Operacionais de Fechamento de Brechas de Versionamento e Proteção contra Escritas Diretas

* **Fechamento de Brechas de Versionamento:**
  - O campo `version` é obrigatório em todas as escritas no caminho `/tenants/{tenantId}/products/{productId}`.
  - Tentativas de criação sem `version` ou mutações que omitam/anulem `version` (`update({ version: null })`) são rejeitadas de imediato com erro de permissão/validação no servidor RTDB.
* **Contrato Rígido de Criação e Atualização:**
  - **Criação:** Exige obrigatoriamente `version === 1` e `baseVersion === 0` (ou ausente). Versões decimais, negativas, nulas ou saltos (`>= 2`) são rejeitados.
  - **Atualização:** Exige obrigatoriamente `baseVersion === versão_atual` e `version === versão_atual + 1`. Anulação de `baseVersion` (`update({ baseVersion: null })`), saltos e retrocessos são bloqueados.
* **Política Segura de Registros Legados sem Versão:**
  - Clientes comuns do aplicativo não podem realizar mutações comerciais ou bootstraps genéricos em registros remotos que não possuam o campo `version`.
  - Registros legados permanecem legíveis e preservados para os usuários do tenant.
  - A migração oficial para atribuição do atributo `version` a registros legados reais fica reservada para o script administrativo supervisionado da Fase 15 via Firebase Admin SDK.
* **Salvaguardas de Exclusão Física no Servidor (`.write`):**
  - Operadores (`operator`) não têm permissão para deletar produtos fisicamente (`remove()` ou `set(null)`). Devem utilizar exclusão lógica preenchendo `deletedAt`. Apenas `admin` pode executar exclusão física.
  - Vendas (`sales`) e compras (`purchases`) possuem proibição total de exclusão física para todos os papéis (`newData.exists()`). Dados de valor, quantidade, data e fornecedor são imutáveis.
  - Movimentações de estoque (`inventory`) são append-only no servidor; mutações parciais ou remoções são permanentemente rejeitadas.
* **Ambiente Estritamente Local:**
  - Toda a auditoria e suíte de testes operam exclusivamente contra os emuladores locais do Firebase. Nenhuma base remota ou projeto de produção foi acessado ou modificado.

---

### FASE 14.21: Diretrizes Operacionais de Identidade Canônica, ACKs Atrasados e Isolamento do Outbox

* **Convenção Canônica Estrita de Claims (`tenantId` e `appRole`):**
  - O GestãoPro opera sob o contrato canônico `tenantId` (string não-vazia identificando o tenant) e `appRole` (`'admin'`, `'operator'`, `'viewer'`).
  - Qualquer claim legada (`role` ou `tenant_id`) sem as propriedades canônicas correspondentes é tratada de forma estrita em modo *fail-closed*, rebaixando o acesso do cliente para `viewer` e bloqueando escritas no RTDB e Storage.
* **Segurança de ACKs Atrasados de Tentativas Anteriores:**
  - Respostas tardias de despachos cuja concessão (`leaseExpiresAt`) expirou são registradas como evidência em `staleAttemptAcks` com `remoteAckReceived = true`.
  - Um ACK tardio jamais altera o status de uma operação que foi marcada como `FAILED` ou `requiresResolution: true` pela tentativa titular atual.
* **Isolamento Multitenant no Outbox Local (`SyncRepository`):**
  - Métodos do repositório operam sob o contexto da sessão ativa (`getCurrentTenant()`).
  - Atualizações técnicas de recuperação utilizam validação rigorosa de imutabilidade: `tenantId`, `operationId`, `entityType` e `entityId` não podem ser modificados.
  - Modificação de payloads comerciais de outro tenant é estritamente proibida no cliente.
* **Matriz de Reconciliação por Ação:**
  - Falhas de leitura (`PERMISSION_DENIED`, timeouts) são classificadas como `INACCESSIBLE` e retidas para nova tentativa, sem serem confundidas com registro ausente (`NOT_FOUND`).
  - `CREATE` ausente é retentado; se equivalente, reconciliado como `SYNCED`; se divergente, bloqueado.
  - `UPDATE` versionado cujo nó remoto não existe é bloqueado (`UPDATE_ON_ABSENT_RECORD`, `requiresResolution: true`), sem converter para `CREATE`.
  - Operações em coleções append-only cujo resultado remoto for desconhecido são bloqueadas para intervenção humana a fim de evitar duplicações no ledger.

---

### FASE 14.22: Diretrizes Operacionais de Fechamento de Invariantes antes de Staging

* **Contrato Canônico Uniforme de Claims:**
  - `tenantId`: identificador do tenant da empresa.
  - `appRole`: papel comercial válido (`admin`, `operator`, `viewer`).
  - `role: 'authenticated'`: reservado exclusivamente como papel técnico de infraestrutura JWT para o Supabase Storage.
  - Claims legadas (`role: 'admin'`, `tenant_id`) não concedem equivalência ou permissão de escrita. Contas sem claims canônicas completas são rebaixadas para `viewer` com `requiresMigration: true`.
* **Semântica de ACKs Tardios e Outbox:**
  - Um ACK de tentativa cujo lease expirou é registrado como evidência em `staleAttemptAcks` com `remoteAckReceived: true`, mas **não transiciona o item para `SYNCED`** nem remove flags de erro (`requiresResolution: true`).
  - Se a operação foi marcada como `FAILED` por divergência de payload ou conflito CAS, ela permanece estritamente bloqueada até resolução humana.
* **Política de Ledger Append-Only (`/inventory`):**
  - Operações com `dispatchStarted: true` ou `remoteOutcomeUnknown: true` nunca sofrem repetição automática sem reconciliação prévia.
  - Timeouts e erros de permissão (`PERMISSION_DENIED`) durante a leitura remota não provam ausência: o item é mantido bloqueado para prevenir lançamentos fiscais/físicos duplicados.
  - O despacho só é liberado se a leitura autorizada comprovar ausência (`RECORD_ABSENT`).
* **Imutabilidade e Isolamento do `SyncRepository`:**
  - `tenantId`, `operationId`, `entityType`, `entityId` e `canonicalPayloadHash` são imutáveis.
  - Operações técnicas de recuperação não expõem ou alteram payloads de outro tenant sob nova sessão.
* **Fronteira com Staging e Produção:**
  - Nenhum provisionamento, deploy ou migração em nuvem real foi executado nesta fase.

---

### FASE 14.23: Consistência Final da Recuperação do Ledger, Semântica de Claims e Prontidão para Staging

* **Máquina de Estados Única e Determinística para Resultados Remotos Desconhecidos:**
  - Leitura remota inacessível por falha transitória (`INACCESSIBLE`) **não é ausência** e **nunca reenvia a escrita comercial às cegas**.
  - O item permanece em `status: 'PENDING'`, com `remoteOutcomeUnknown: true`, `requiresResolution: false`, retentando a consulta com backoff exponencial via `nextReconcileAt`.
  - Ao esgotar 5 tentativas de consulta sem resposta, o item é escalado para `status: 'FAILED'`, `requiresResolution: true` e `permanentFailure: true`.
  - Leitura negada por permissão (`PERMISSION_DENIED`) é tratada como erro de segurança e bloqueia imediatamente com `requiresResolution: true`.
  - Ausência autorizada (`RECORD_ABSENT`) autoriza novo envio para `CREATE`; para `UPDATE`, bloqueia como `UPDATE_ON_ABSENT_RECORD`.
  - Registro equivalente (`RECORD_EQUIVALENT`) conclui como `SYNCED` sem nova escrita no backend.
  - Registro divergente (`RECORD_DIVERGENT`) bloqueia para resolução sem sobrescrever o servidor.
* **Harmonização de Custom Claims:**
  - `tenantId`: tenant da aplicação empresarial.
  - `appRole`: papel empresarial (`admin`, `operator`, `viewer`).
  - `role: 'authenticated'`: claim técnica exigida pelo Supabase / PostgreSQL. Não concede papel empresarial nem permissões de escrita comercial.
  - Proibido qualquer fallback automático entre claims técnicas/legadas e claims empresariais.







