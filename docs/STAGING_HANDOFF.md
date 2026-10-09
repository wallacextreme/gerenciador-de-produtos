# Manual de Homologação Externa — Staging Real (Firebase Cloud)

**Documento:** `docs/STAGING_HANDOFF.md`  
**Versão Alvo:** `v1.13.0-rc.1` (Release Candidate)  
**Objetivo:** Guia passo a passo seguro para provisionar o ambiente de staging na nuvem do Google Firebase e executar a homologação real (PHASE 13) sem riscos para os dados de produção.

> ⚠️ **ATENÇÃO DE SEGURANÇA:**  
> Este documento NUNCA deve conter senhas reais, tokens de autenticação ou chaves privadas de Service Account. Todas as credenciais de exemplo aqui apresentadas são estritamente sintéticas e ilustrativas.

---

## 1. Projeto Firebase Esperado

- **Nome do Projeto no Console:** `Gerenciador Produtos Staging`
- **Project ID Canônico:** `gerenciador-produtos-staging`
- **Configuração no Repositório:** Definido em [.firebaserc](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/.firebaserc)
- **Plano de Cobrança (Billing):**
  - **Spark (Gratuito):** Suporta Firebase Auth e Realtime Database (1 GB armazenado, 10 GB/mês de download).
  - **Blaze (Pay-as-you-go):** Obrigatório se utilizar o Firebase Cloud Storage para upload de imagens de produtos. Se o cliente não desejar ativar o plano Blaze, utilize o provedor gratuito alternativo `CloudinaryImageProvider`.

---

## 2. Configuração Necessária no Cliente Web

Copie as credenciais públicas do aplicativo web geradas no console para um arquivo `.env.staging` (baseado em [.env.staging.example](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/.env.staging.example)):

```bash
# Identificação do Projeto de Staging
VITE_FIREBASE_PROJECT_ID=gerenciador-produtos-staging
VITE_FIREBASE_API_KEY=AIzaSy...[CHAVE_PUBLICA_DO_CLIENTE]
VITE_FIREBASE_AUTH_DOMAIN=gerenciador-produtos-staging.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://gerenciador-produtos-staging-default-rtdb.firebaseio.com
VITE_FIREBASE_STORAGE_BUCKET=gerenciador-produtos-staging.firebasestorage.app
VITE_FIREBASE_APP_ID=1:...:web:...

# Modo de Operação
VITE_PUBLIC_DEMO=false
```

O [firebaseConfigValidator.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/utils/firebaseConfigValidator.js) bloqueará automaticamente a inicialização caso qualquer valor aponte acidentalmente para projetos de produção ou se houver incompatibilidade de domínios (Configuration Drift).

---

## 3. Regras de Segurança a Publicar

### A. Realtime Database
Publique o arquivo de regras auditado [database.rules.json](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/database.rules.json):
```bash
firebase deploy --only database --project gerenciador-produtos-staging
```
*Garante:* Segregação multi-tenant por ID Token (`auth.token.tenantId === $tenantId`), proibição de cascata de escrita na raiz, controle de perfil (`role === 'admin'` para compras/fornecedores/configurações) e validação de schema.

### B. Cloud Storage
Publique o arquivo de regras auditado [storage.rules](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/storage.rules):
```bash
firebase deploy --only storage --project gerenciador-produtos-staging
```
*Garante:* Restrição estrita de arquivos a formatos raster Web seguros (`image/(jpeg|png|webp)`), bloqueio de uploads acima de 10 MB e isolamento por tenant no caminho `/tenants/{tenantId}/...`.

---

## 4. Configuração do Firebase Authentication

1. Acesse o **Firebase Console** > **Authentication** > **Sign-in method**.
2. Habilite o provedor nativo: **E-mail/senha**.
3. Desabilite a opção "Criação de contas por usuários finais" (ou mantenha restrita) caso queira controle estrito corporativo.

---

## 5. Configuração do Cloud Storage

1. Acesse o **Firebase Console** > **Storage** > **Get Started**.
2. Selecione a região padrão recomendada (ex: `southamerica-east1` ou `us-central1`).
3. Confirme que o bucket foi criado com o nome correspondente (ex: `gerenciador-produtos-staging.firebasestorage.app`).

---

## 6. Usuários e Tenants de Teste Sintéticos

Execute o script de provisionamento administrativo localmente com credenciais temporárias do Google Cloud SDK:

```bash
# Execução via Node/Bun com chave administrativa transitória fora do repositório
node scripts/provision-staging.js
```

### Usuários Criados no Staging:
| E-mail | Perfil (`role`) | Tenant ID (`tenantId`) | Escopo de Permissões |
| :--- | :--- | :--- | :--- |
| `admin@staging.gestaopro.internal` | `admin` | `tenant-staging` | Acesso total a produtos, estoque, vendas, compras, fornecedores e configurações. |
| `operador@staging.gestaopro.internal` | `operator` | `tenant-staging` | Acesso operacional (cadastro de produtos, registro de vendas e movimentações de estoque). Bloqueado para alterar configurações. |
| `auditor@staging.gestaopro.internal` | `viewer` | `tenant-staging` | Apenas leitura de relatórios e catálogo. |

---

## 7. Sequência de Testes de Homologação em Nuvem Real

Execute a seguinte bateria de validação operacional:

1. **Validação de Conexão Inicial:**
   - Inicie o sistema conectado ao staging e faça login como `admin@staging.gestaopro.internal`.
   - Verifique se o badge no cabeçalho exibe o e-mail autenticado e status "Nuvem Conectada".
2. **Isolamento Multi-Tenant:**
   - Tente consultar dados com um usuário com claim de outro tenant; a operação deve ser rejeitada com erro 403 / Permissão Negada.
3. **Sincronismo Bidirecional Real:**
   - Abra a aplicação em duas janelas (Janela A e Janela B).
   - Cadastre um produto na Janela A.
   - Verifique se o produto aparece automaticamente na Janela B em menos de 2 segundos.
4. **Concorrência de Estoque (Ledger Append-Only):**
   - Na Janela A, dê entrada de +5 unidades.
   - Na Janela B, dê saída de -2 unidades.
   - Ambas as movimentações devem constar no histórico e o saldo final consolidado deve ser 3.
5. **Transação de Venda Offline:**
   - Desconecte o cabo de rede ou ative o modo offline no DevTools.
   - Registre uma venda no PDV.
   - Verifique que o estoque local foi debitado imediatamente e a venda foi enfileirada no Outbox (`syncQueue`).
   - Reconecte a rede e observe a sincronização automática sem duplicação de saldo.
6. **Upload e Cache de Fotos:**
   - Faça upload de uma foto WebP no produto recém-criado.
   - Verifique o arquivo salvo no bucket do Storage e o hash gravado no manifesto do RTDB.
   - Na Janela B, acesse o produto e confirme que a imagem foi baixada e renderizada na galeria.
   - Coloque a Janela B offline e recarregue a página: a foto deve continuar visível (cache local IndexedDB).

---

## 8. Critérios de Aprovação para Entrada em Produção

- [ ] Todos os 6 passos da sequência de testes executados com 100% de sucesso.
- [ ] Zero erros `403 Permission Denied` ou falhas de autorização para operações legítimas de `admin` e `operator`.
- [ ] Zero vazamentos de dados ou fotos entre tenants distintos.
- [ ] Zero duplicação de movimentações contábeis ou de estoque no RTDB.
- [ ] Zero quebras de renderização offline de fotos e produtos.
- [ ] Latência média de sincronização em nuvem real inferior a 1500ms.

---

## 9. Plano de Rollback

Caso seja identificada anomalia grave durante os testes em nuvem real:

1. **Desativação Imediata da Nuvem:**
   - Na página de **Configurações** (`#/configuracoes`), aba **Sincronização**, desmarque a opção "Sincronização Automática" e limpe as credenciais.
   - O aplicativo retornará instantaneamente à operação 100% Local-First / Offline-First sobre o IndexedDB local.
2. **Purga dos Dados de Teste no Staging:**
   - Acesse o Realtime Database no Firebase Console e remova o nó `/tenants/tenant-staging`.
   - Acesse o Cloud Storage e remova a pasta `/tenants/tenant-staging`.
3. **Restauração de Dados Locais:**
   - Utilize a funcionalidade de restauração de backup ([BackupService.js](file:///c:/Users/Usu/Documents/Gerenciador%20De%20Produtos/src/js/services/BackupService.js)) a partir de um arquivo `.json` gerado previamente.
