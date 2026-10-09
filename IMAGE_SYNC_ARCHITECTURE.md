# Arquitetura de Sincronização e Armazenamento de Imagens — GestãoPro (PHASE 04)

Este documento estabelece a análise comparativa formal, modelagem de custos, matriz de decisão e especificação técnica do ecossistema de armazenamento de imagens do **GestãoPro**.

---

## 1. Auditoria e Correção da Modelagem de Custos e Limites

### 1.1 Cloudinary (Free Tier Oficial)
A documentação atual da Cloudinary adota um modelo baseado em **25 Créditos Mensais Compartilhados**. Os créditos não são separados:
- **1 Crédito** = **1 GB de Armazenamento Gerenciado (Storage)**; OU
- **1 Crédito** = **1 GB de Tráfego de Imagem na CDN (Bandwidth/Egress)**; OU
- **1 Crédito** = **1.000 Transformações de Imagem na Nuvem**.
- **Regra Crítica de Concorrência**: O armazenamento e a largura de banda consomem a mesma cota. Se o catálogo consumir 15 GB de storage (15 créditos), restam apenas 10 créditos para download/mês (10 GB) para todos os dispositivos combinados.
- **Excesso de Cota**: Interrompe o serviço ou exige upgrade para o plano Plus (**$89/mês**).

### 1.2 Supabase Storage (Free Tier Oficial)
A documentação atual do Supabase Storage no plano gratuito oferece:
- **1 GB de Armazenamento Total (Storage)**;
- **5 GB de Egress em Cache (Cached Egress)** + **5 GB de Egress sem Cache (Uncached Egress)** = **10 GB de Bandwidth Mensal**;
- **Limite por Arquivo**: 50 MB;
- **Excesso de Cota**: Não permite expansão proporcional no plano Free; exige upgrade para o plano Pro (**$25/mês fixo**).

### 1.3 Firebase Cloud Storage (Política do Plano Blaze)
- **Obrigatoriedade do Plano Blaze**: Desde 3 de fevereiro de 2026, a política oficial do Firebase exige o plano Blaze (Pay-as-you-go com cartão cadastrado no Google Cloud) para utilizar o Cloud Storage for Firebase. O serviço não está funcionalmente disponível no plano gratuito Spark.
- **Franquia Gratuita Inclusa no Blaze**:
  - Mesmo sob o plano Blaze, o Firebase mantém uma faixa mensal sem custo de **5 GB de Armazenamento** e **1 GB/dia de Download (~30 GB/mês)**;
  - Franquia diária de operações: 20.000 uploads/dia e 50.000 downloads/dia gratuitos.
- **Excedentes Além da Franquia**:
  - Cobrados de forma estritamente proporcional e sob demanda: **$0.026 por GB/mês de storage** (~R$ 0,15 por GB adicional) e **$0.12 por GB de download excedente**.

---

## 2. Cenários Reais de Dimensionamento

Premissas de simulação: fotos otimizadas localmente em WebP pelo `ImageService` (~220 KB por foto), 3 fotos por produto.

| Métrica / Volume | 1.000 Produtos (3.000 fotos) | 5.000 Produtos (15.000 fotos) | 10.000 Produtos (30.000 fotos) |
| :--- | :--- | :--- | :--- |
| **Volume de Armazenamento (Storage)** | **~644 MB (0,63 GB)** | **~3,15 GB** | **~6,29 GB** |
| **Cenário A: Visualiza 20% do catálogo** | 129 MB | 644 MB | 1,29 GB |
| **Cenário B: Visualiza 50% do catálogo** | 322 MB | 1,61 GB | 3,22 GB |
| **Cenário C: Sincroniza 100% (Offline)** | 644 MB / dispositivo | 3,15 GB / dispositivo | 6,29 GB / dispositivo |

### Análise de Viabilidade por Provedor nos Cenários:

1. **Cloudinary**:
   - *1.000 Produtos*: Viável. Consome ~1 crédito de storage e sobram 24 créditos de bandwidth (~37 downloads integrais/mês).
   - *5.000 Produtos*: Crítico. Consome ~3,2 créditos de storage. Com 5 dispositivos sincronizando o catálogo (15,75 GB), consome ~19 créditos no mês.
   - *10.000 Produtos*: **Inviável no Free Tier**. 6,3 créditos de storage deixam apenas 18,7 créditos de tráfego. Apenas 3 sincronizações completas estouram a cota, forçando upgrade de $89/mês.

2. **Supabase**:
   - *1.000 Produtos*: Viável (0,63 GB cabe no 1 GB de storage gratuito).
   - *5.000 Produtos e 10.000 Produtos*: **Bloqueado no Free Tier**. O catálogo (3,15 GB e 6,29 GB) excede o limite rígido de 1 GB de storage, exigindo plano Pro de $25/mês.

3. **Firebase Storage (Blaze)**:
   - *1.000 Produtos*: Custo $0,00 (100% coberto pela cota gratuita de 5 GB).
   - *5.000 Produtos*: Custo $0,00 de storage (coberto pelos 5 GB gratuitos). Tráfego diário inicial de 1 GB gratuito. Custo estimado residual inferior a $0.50/mês.
   - *10.000 Produtos*: 6,29 GB - 5,00 GB = 1,29 GB excedentes @ $0.026/GB = **~$0.034/mês (menos de R$ 0,20 centavos por mês)**.

---

## 3. Matriz de Decisão Arquitetural

| Critério Técnico | Cloudinary | Supabase Storage | Firebase Cloud Storage |
| :--- | :--- | :--- | :--- |
| **Free Storage** | 25 créditos pool (~15-20 GB se pouco tráfego) | 1 GB estrito | 5 GB gratuitos (Requer plano Blaze desde 03/02/2026) |
| **Free Bandwidth** | Compartilhado nos 25 créditos | 10 GB (5 GB cached + 5 GB uncached) | 1 GB/dia (~30 GB/mês) |
| **Transformações na Nuvem** | SIM (1 crédito = 1.000 transf.) | LIMITADO (apenas redimensionamento básico) | NÃO nativo (gerado localmente no app) |
| **CDN Global Integrada** | SIM (Fastly / Akamai) | SIM (Cloudflare) | SIM (Google Cloud CDN) |
| **Direct Upload pelo Cliente** | SIM (Unsigned via Preset) | SIM (via anon key) | SIM (nativo via SDK) |
| **Signed Upload Seguro** | DEPENDE (exige backend próprio) | SIM (via Signed URLs geradas por backend) | SIM (nativo via SDK com Firebase Auth) |
| **Segurança / Zero Segredos** | LIMITADO (preset público pode sofrer spam) | LIMITADO (anon key pública sem auth nativo) | **SIM (100% nativo, sem expor chaves)** |
| **Integração Firebase Auth** | **NÃO** (desconhece tokens do Firebase) | **NÃO** (RLS requer Supabase Auth ou backend) | **SIM (100% integrado por Security Rules)** |
| **Exclusão de Ativos no Cliente**| **NÃO** (unsigned delete proibido; exige secret) | DEPENDE (requer permissão pública ou auth) | **SIM (`deleteObject` validado por rules)** |
| **Substituição Controlada** | LIMITADO (risco de sobrescrita abusiva) | SIM (upsert suportado) | **SIM (atomicamente por regras)** |
| **Versionamento e Checksum** | SIM (versão gerada pela CDN) | DEPENDE (gerido pelo cliente) | **SIM (customMetadata com version e hash)** |
| **URLs Públicas / CDN** | SIM | SIM | SIM (`getDownloadURL`) |
| **URLs Privadas com Token** | LIMITADO | SIM | SIM (Download token revogável) |
| **Compatibilidade Offline** | N/A (upload falha offline) | N/A (upload falha offline) | SIM (SDK gerencia retry nativo) |
| **Compatibilidade PWA/Tauri** | SIM (CORS aberto) | SIM (CORS configurável) | SIM (CORS nativo no Google Cloud) |
| **Complexidade de Código** | Baixa para upload; Alta para delete seguro | Média (gestão de dois ecossistemas) | **Baixa (mesmo SDK já instalado)** |
| **Dependência Externa Extra** | SIM (conta Cloudinary separada) | SIM (conta Supabase separada) | **NÃO (mesmo console e projeto Firebase)** |
| **Custo de Crescimento** | Alto ($89/mês após 25 créditos) | Médio ($25/mês após 1 GB) | **Mínimo ($0.026/GB excedente)** |

---

## 4. Decisão Arquitetural Justificada

Aplicando o critério fundamental do projeto:
> **SEGURANÇA > CONFIABILIDADE > MANUTENÇÃO > CUSTO**

### 4.1 Provedor Primário Recomendado: `FirebaseStorageProvider` (Firebase Cloud Storage)
- **POR QUE**: É a **única solução** que integra nativamente com a autenticação existente (`Firebase Auth`), garantindo autorização real sem segredos expostos no navegador.
- **SEGURANÇA**: Suporta regras declarativas (`storage.rules`) que garantem que usuários do `tenantA` não acessem nem alterem imagens do `tenantB`.
- **EXCLUSÃO E SUBSTITUIÇÃO**: Permite que o operador autenticado exclua ou substitua fotos de produtos diretamente pelo cliente com autorização formal do servidor, sem exigir um backend intermediário ou vazar chaves mestras.
- **CUSTO**: O custo no plano Blaze para catálogos comerciais típicos (5.000 a 10.000 produtos) varia entre **R$ 0,00 e R$ 0,50 por mês**, sendo drasticamente mais barato do que as taxas de upgrade do Cloudinary ($89/mês) ou Supabase ($25/mês).
- **MANUTENÇÃO**: Não introduz provedores externos fragmentados nem duplica contas de nuvem.

### 4.2 Provedor Alternativo Suportado: `CloudinaryImageProvider`
- Implementado como conector opcional para desenvolvedores ou empresas que desejam operar em modo demonstrativo sem vincular cartão no Google Cloud.
- Opera com upload unsigned via `upload_preset`. A exclusão física remota no modo unsigned é bloqueada no cliente com aviso explícito no console para evitar exposição de chaves privadas.

### 4.3 Provedor de Testes e Simulação: `MockImageStorageProvider`
- Emulador em memória determinístico, operando sem dependência de rede, com cálculo de SHA-256 e suporte integral aos testes automatizados (IMG-01 a IMG-20).

---

## 5. Contrato do Storage Provider (`src/js/sync/ImageStorageProvider.js`)

```typescript
export class ImageStorageProvider {
  getProviderName(): string;
  isConfigured(): boolean;
  async upload(blob: Blob, metadata: ImageMetadata): Promise<ImageUploadResult>;
  async replace(photoId: string, blob: Blob, metadata: ImageMetadata): Promise<ImageUploadResult>;
  async delete(photoId: string, remotePath?: string): Promise<boolean>;
  getUrl(photoId: string, remotePath?: string): string;
  async getMetadata(photoId: string, remotePath?: string): Promise<Object | null>;
  async exists(photoId: string, remotePath?: string): Promise<boolean>;
}
```

---

## 6. Regras Oficiais de Segurança do Firebase Storage (`storage.rules`)

```text
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /tenants/{tenantId}/products/{productId}/{photoId} {
      allow read: if request.auth != null && (
        request.auth.token.tenantId == tenantId ||
        request.auth.token.role == 'admin'
      );

      // Phase 11 Hardening: Estritamente raster formats para neutralizar SVG Stored XSS
      allow write: if request.auth != null &&
        request.auth.token.tenantId == tenantId &&
        (request.auth.token.role == 'admin' || request.auth.token.role == 'operator') &&
        request.resource.size < 10 * 1024 * 1024 &&
        request.resource.contentType.matches('image/(jpeg|png|webp)');

      allow delete: if request.auth != null &&
        request.auth.token.tenantId == tenantId &&
        (request.auth.token.role == 'admin' || request.auth.token.role == 'operator');
    }
  }
}
```

---

## 7. Estrutura do Manifesto de Imagens (PHASE 05)

### 7.1 Store Local no IndexedDB (`imageManifest`)
- Criada via **Migration 3** (`gestaopro_db` v3);
- Chave Primária: `{ keyPath: 'photoId' }`;
- Índices Estruturados:
  - `id` (alias para compatibilidade de regras e repositório);
  - `productId` (busca agrupada de todas as fotos de um produto);
  - `tenantId` (segregação estrita por tenant);
  - `updatedAt` (ordenação cronológica e delta sync);
  - `tenant_product` (`['tenantId', 'productId']` - índice composto).

### 7.2 Estrutura Remota no Firebase Realtime Database
- Localização: `/tenants/{tenantId}/imageManifest/{photoId}`
- Regra de validação no `database.rules.json`: `.validate: "newData.hasChildren(['id', 'productId', 'url', 'version'])"`
- Índices remotos declarados: `.indexOn: ["productId", "version", "updatedAt"]`
- **Zero Blobs no RTDB**: O banco armazena exclusivamente metadados textuais e numéricos de referência.

### 7.3 Contrato Canônico de Metadados
```json
{
  "photoId": "photo-uuid-123",
  "id": "photo-uuid-123",
  "productId": "prod-uuid-456",
  "tenantId": "tenant_matriz",
  "label": "Foto Principal",
  "isPrimary": true,
  "url": "https://firebasestorage.googleapis.com/.../photo-uuid-123.webp",
  "thumbnailUrl": "https://firebasestorage.googleapis.com/.../photo-uuid-123.webp",
  "version": 2,
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 184320,
  "mimeType": "image/webp",
  "width": 1920,
  "height": 1080,
  "updatedAt": 1728399600000,
  "deletedAt": null
}
```

---

## 8. Motor de Reconciliação Incremental (`ImageManifestService`)

### 8.1 Algoritmo $O(N)$
A comparação ocorre em memória, normalizando as entradas remotas e locais em `Map` indexados por `photoId`:
1. Filtra registros por `tenantId` para garantir isolamento multi-tenant absoluto;
2. Desduplica entradas de forma idempotente mantendo a versão superior;
3. Itera linearmente sobre a união de identificadores únicos.

### 8.2 Matriz de Classificação de Estados
| Estado | Condição Remota | Condição Local | Ação Decisória |
| :--- | :--- | :--- | :--- |
| **NEW** | Existe (`deletedAt == null`) | Não existe | Agendar para download futuro |
| **CHANGED** | `remote.version > local.version` | Existe | Versão mais recente na nuvem; agendar atualização |
| **UNCHANGED** | `remote.version == local.version` | `remote.hash == local.hash` | Foto idêntica; nenhum download necessário |
| **DELETED** | `remote.deletedAt != null` | Existe localmente | Marcar exclusão lógica (preservar Blob até limpeza) |
| **LOCAL_ONLY** | Não existe no remoto | Existe localmente | Foto pendente de upload ou criada offline |
| **CONFLICT** | `remote.version == local.version` OU `remote.version < local.version` | `remote.hash != local.hash` | Conflito de divergência; não sobrescrever |

### 8.3 Sincronização Delta com `lastSyncAt`
- O cliente grava `manifest_sync_${tenantId}` na store `settings`.
- Consultas delta filtram apenas registros onde `updatedAt > lastSyncAt` ou `deletedAt > lastSyncAt`, eliminando o tráfego repetido de catálogos volumosos.

---

## 9. Arquitetura de Cache Local de Imagens (`LocalImageCache` — PHASE 06)

### 9.1 Decisão Crítica: IndexedDB Blob vs Cache Storage Response

Para evitar desperdício e duplicação desnecessária de armazenamento em disco no dispositivo do usuário, foi realizada a análise comparativa entre as duas opções:

| Critério Técnico | IndexedDB (`productImages` + `imageManifest`) | Cache Storage (`caches.open()`) | Decisão do Projeto |
| :--- | :--- | :--- | :--- |
| **Tipo de Dado** | Blobs binários e objetos estruturados nativos | `Response` HTTP vinculada a `Request` | **IndexedDB** |
| **Indexação & Busca** | Índices nativos por `tenantId`, `productId`, `photoId` | Chave única por URL (sem índices secundários) | **IndexedDB** |
| **Atomicidade** | Transações ACID coordenadas multi-store | Gravação isolada por requisição (sem rollback) | **IndexedDB** |
| **Isolamento de Tenants** | Filtro estrito via chave composta e índice `tenantId` | URLs públicas acessíveis sem particionamento interno | **IndexedDB** |
| **Compatibilidade Tauri** | Nativo no WebView2 com persistência contínua | Variável entre implementações de WebView em desktop | **IndexedDB** |
| **PWA & Offline** | 100% suportado em todos os navegadores modernos | Excelente para assets estáticos do App Shell | **Híbrido Complementar** |
| **Risco de Duplicação** | Zero se mantido como repositório único | Alto se o mesmo Blob for duplicado no cache HTTP | **Sem Duplicação** |

#### Definição Formal da Fonte da Verdade:
- **IndexedDB**: **Fonte Primária Exclusiva de Persistência** para Blobs de fotos (`productImages`) e metadados (`imageManifest`).
- **Cache Storage**: **Restrito ao App Shell Estático** (`index.html`, bundles JS/CSS do Vite, fontes e ícones). **Nenhuma foto de produto é duplicada no Cache Storage**.

---

### 9.2 O Serviço `LocalImageCache` (Alias `ImageCacheService`)

Localizado em `src/js/services/LocalImageCache.js`, o serviço desacopla o armazenamento local da lógica remota e de reconciliação:

```
┌─────────────────────────────────────────────────────────┐
│               ImageService (Compressão)                 │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│           ImageManifestService (Reconciliação)          │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│          LocalImageCache (Armazenamento Local)          │
│   put() │ get() │ has() │ replace() │ remove() │ stats  │
└─────────────────────────────────────────────────────────┘
           │                                │
           ▼                                ▼
┌───────────────────────┐        ┌────────────────────────┐
│ IDB: `productImages`  │        │  IDB: `imageManifest`  │
│ (Blobs full + thumb)  │        │ (Metadados e versão)   │
└───────────────────────┘        └────────────────────────┘
```

#### Princípios de Separação de Responsabilidades:
O `LocalImageCache` **NÃO**:
- comunica-se diretamente com o Firebase ou CDNs;
- executa chamadas de autenticação;
- resolve conflitos remotos;
- executa uploads ou modifica o Realtime Database;
- orquestra filas de download P1/P2/P3 (responsabilidade reservada para a Phase 07).

---

### 9.3 Integridade Criptográfica (SHA-256) e Bloqueio de Downgrade

1. **Validação Criptográfica SHA-256**:
   - Antes de efetivar qualquer gravação no cache, o hash SHA-256 do Blob é calculado via `crypto.subtle.digest('SHA-256', buffer)`.
   - Se o hash fornecido no manifesto não coincidir com o hash real do Blob, a operação é rejeitada com erro formal de integridade (`Hash validation failed: blob hash ... !== metadata hash ...`).
   - A cópia local pré-existente permanece intacta e não é corrompida.
2. **Bloqueio Rígido de Downgrade**:
   - Se o cache já possui a versão $V$ da foto e uma operação tenta gravar uma versão menor ($V_{nova} < V$), a gravação é bloqueada com erro (`Downgrade rejected: incoming version ... < existing version ...`).
   - O cache mantém a versão mais recente e protege contra retransmissões obsoletas.

---

### 9.4 Gravação Atômica Coordenada

A gravação ocorre de forma atômica e coordenada sobre as stores `productImages` e `imageManifest`:
1. Validação prévia de integridade, versão e cota de disco;
2. Preparação do registro binário com campos canônicos (`id`, `photoId`, `productId`, `tenantId`, `blob`, `thumbnailBlob`, `version`, `hash`, `mimeType`, `sizeBytes`, `cachedAt`, `lastAccessedAt`);
3. Gravação simultânea na transação do IndexedDB;
4. Em caso de falha em qualquer etapa, a gravação é abortada, garantindo que o sistema nunca fique em estado inconsistente (metadados atualizados sem Blob correspondente ou vice-versa).

---

### 9.5 Ciclo de Vida e Contenção de Vazamento de Object URLs

A renderização de imagens a partir de Blobs locais no navegador utiliza `URL.createObjectURL(blob)`. Para evitar consumo descontrolado de memória RAM:
- O `LocalImageCache` rastreia todos os Object URLs gerados em um `Map` interno com carimbo de criação e referência;
- Métodos explícitos de revogação: `createUrl(blob, refId)`, `revokeUrl(url)` e `revokeAllUrls()`;
- Sempre que uma imagem é removida (`remove()`) ou o cache é limpo (`clear()`), todos os Object URLs associados são imediatamente revogados via `URL.revokeObjectURL(url)`.

---

### 9.6 Monitoramento de Cota de Armazenamento e Tolerância a Disco Cheio

1. **Estimativa de Cota (`getQuotaEstimate()`)**:
   - Consulta `navigator.storage.estimate()` retornando `{ usage, quota, percentUsed, available, supported }`;
   - Se a API não estiver disponível (ex: ambientes de teste ou webviews restritas), adota fallback determinístico com cota padrão de 500 MB sem quebrar a execução.
2. **Persistência de Armazenamento (`navigator.storage.persist()`)**:
   - Avaliada e encapsulada em `src/js/utils/storage.js` para solicitar proteção contra descarte pelo navegador em condições de pressão de disco.
3. **Tratamento Gracioso de Espaço Esgotado**:
   - Se uma gravação falhar por estouro de cota (ex: `QuotaExceededError`), o erro é capturado e sinalizado sem interromper os fluxos comerciais do aplicativo (cadastro de produtos, registro de vendas e movimentações de estoque continuam operando normalmente sem foto).

---

### 9.7 Modelo Conceitual de Retenção e Políticas de Descarte (Eviction)

O cache classifica temporalmente as imagens para futura orquestração de limpeza:
- **`HOT`**: Acessada nos últimos 7 dias (`< 7 dias`);
- **`WARM`**: Acessada entre 7 e 30 dias (`7 a 30 dias`);
- **`COLD`**: Não acessada há mais de 30 dias (`> 30 dias`).

#### Regras de Proteção de Descarte:
Nunca são consideradas para descarte:
- Fotos principais do produto (`isPrimary === true`);
- Fotos em estado `HOT`;
- Fotos vinculadas a operações de sincronização em andamento.

O método `getEvictionCandidates(tenantId, { limit, maxBytes })` retorna candidatos prioritários ordenados por `lastAccessedAt` ascendente (LRU).

---

### 9.8 Throttling de I/O em `lastAccessedAt`

A leitura de fotos para renderização na interface (`get()`) atualiza o metadado `lastAccessedAt`. Para evitar saturação de I/O e escritas excessivas no IndexedDB a cada redesenho de componente:
- É aplicado um throttling em memória com intervalo mínimo de **5 segundos por foto**;
- Requisições consecutivas retornam o Blob instantaneamente sem disparar escrita repetida no disco.

---

## 10. Sincronização Automática e Orquestração de Downloads (`ImageSyncService` — PHASE 07)

### 10.1 Arquitetura do Serviço e Fluxo Decisório

O `ImageSyncService` atua como a camada orquestradora entre a reconciliação de metadados (`ImageManifestService`), a camada de transporte remoto (`ImageStorageProvider`) e o cache físico local (`LocalImageCache`):

```
┌────────────────────────────────────────────────────────┐
│            Firebase Realtime Database (RTDB)           │
│        /tenants/{tenantId}/imageManifest/{photoId}     │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            ImageManifestService (Reconciliação)        │
│          O QUE PRECISA SER ATUALIZADO? (NEW, CHANGED)  │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             ImageSyncService (Orquestrador)            │
│         QUANDO? QUAL? EM QUE ORDEM? (P1, P2, P3)       │
└────────────────────────────────────────────────────────┘
         │                                       │
         ▼                                       ▼
┌─────────────────────────┐             ┌─────────────────────────┐
│  ImageStorageProvider   │             │     LocalImageCache     │
│   (COMO É OBTIDO?)      │             │  (COMO É ARMAZENADO?)   │
│   download(photoId)     │ ──SHA-256─► │    put({ blob, hash })  │
└─────────────────────────┘             └─────────────────────────┘
                                                     │
                                                     ▼
                                        ┌─────────────────────────┐
                                        │   ProductDetailPage     │
                                        │   (Renderização Offline)│
                                        └─────────────────────────┘
```

---

### 10.2 Fila Estruturada com 3 Níveis de Prioridade

Cada item da fila possui a estrutura canônica:
```javascript
{
  id: `${tenantId}:${photoId}`,
  photoId,
  productId,
  tenantId,
  priority,       // P1=100, P2=50, P3=10
  isPrimary,      // true para foto principal
  requestedAt,
  reason,         // 'on_demand_product' | 'category' | 'catalog_sync'
  expectedVersion,
  expectedHash,
  state,          // QUEUED, DOWNLOADING, VALIDATING, SAVING, COMPLETED, FAILED, PAUSED
  attempts,
  lastError,
  retryAfter
}
```

#### Níveis de Prioridade:
1. **P1 (Prioridade 100 — Produto Atual em Foco)**:
   - Acionado sob demanda via `ensureProductImages(productId)` quando o usuário acessa a tela de detalhes ou formulário;
   - **Regra de Foto Principal**: Dentro de P1, itens com `isPrimary = true` são despachados primeiro para garantir visualização imediata da imagem de capa;
   - P1 nunca é adiado por economia de dados ou limites preventivos de cota.
2. **P2 (Prioridade 50 — Categoria em Exibição)**:
   - Acionado via `reprioritizeCategory(categoryId, productIds)` ao listar produtos de uma categoria;
   - Executa após P1 e antes de P3.
3. **P3 (Prioridade 10 — Restante do Catálogo em Background)**:
   - Download gradual de todas as fotos faltantes no catálogo;
   - Totalmente interruptível; obedece regras de Wi-Fi e cota de armazenamento.

---

### 10.3 Concorrência, Deduplicação e Promoção Dinâmica

1. **Pool de Concorrência Controlado**:
   - Limitado a **2 downloads simultâneos** por padrão (`concurrency = 2`), prevenindo congestionamento de rede e saturação de threads.
2. **Deduplicação Rigorosa**:
   - Chave composta única `${tenantId}:${photoId}`; requisições redundantes são mescladas (merge) em vez de duplicadas.
3. **Promoção Dinâmica de Prioridade**:
   - Se uma foto está na fila como P3 (catálogo) e o usuário abre o produto proprietário, ela é automaticamente promovida de `P3 -> P1` via `reprioritize()`, saltando para o topo da fila sem recriar o item.

---

### 10.4 Pipeline de Execução e Validação Criptográfica

Para cada item despachado:
1. `QUEUED` ➔ `DOWNLOADING`: Blob binário é requisitado via `storageProvider.download(photoId)`;
2. `VALIDATING`: Checksum SHA-256 do Blob é calculado via Web Cryptography API (`crypto.subtle`);
   - Se `computedHash !== expectedHash`, a operação é marcada como `FAILED` com `INTEGRITY_ERROR` e o arquivo não é salvo;
3. `SAVING`: Gravado atomicamente no `LocalImageCache`;
4. `COMPLETED`: Emissão de `IMAGE_DOWNLOADED` no `eventBus` notificando a UI.

---

### 10.5 Resiliência e Classificação de Erros

- **Erros Temporários** (timeouts, falhas de conexão, HTTP 429/5xx):
  - Aplicam **backoff exponencial**: 1s (tentativa 1), 2s (tentativa 2), 4s (tentativa 3);
  - Limite máximo de 3 tentativas antes de marcar como `FAILED`.
- **Erros Permanentes** (HTTP 404, hash mismatch, permissão negada, tipo MIME inválido):
  - Falham imediatamente sem consumir ciclos de retentativa.

---

### 10.6 Conectividade e Políticas de Rede

- **Transição Offline / Online**:
  - `offline`: Fila é pausada instantaneamente (`IMAGE_SYNC_PAUSED`), downloads em andamento são abortados e retornam ao estado `QUEUED` sem penalidade;
  - `online`: Fila é retomada automaticamente (`IMAGE_SYNC_RESUMED`), processando na ordem P1 ➔ P2 ➔ P3.
- **Políticas de Tráfego**:
  - `AUTO_WIFI` (padrão): P1, P2 e P3 liberados em Wi-Fi/Ethernet. Em dados móveis (cellular), apenas P1 é permitido;
  - `ON_DEMAND_ONLY`: Apenas P1 permitido;
  - `AUTO_ALWAYS`: P1, P2 e P3 em qualquer rede;
  - `DISABLED`: Todos os downloads suspensos;
  - **SaveData**: Respeita `navigator.connection.saveData`, restringindo downloads a P1 sob demanda.

---

### 10.7 Proteção de Cota e Prevenção de Loops

- **Proteção de Disco para P3**:
  - Antes de iniciar downloads P3, consulta `localImageCache.getQuotaEstimate()`;
  - Se `percentUsed > 0.85` (85%), downloads P3 são suspensos para preservar disco para operações comerciais (vendas e estoque);
  - Avalia candidatos a evicção segura (`COLD`), protegendo fotos principais e fotos `HOT`.
- **Prevenção Absoluta de Loops de Sincronização (Anti-Loop)**:
  - O download e cache de fotos não emitem eventos de mutação de negócio (`PRODUCT_UPDATED`);
  - Zero inserções no Outbox (`SyncQueue`), eliminando retransmissões infinitas para o Realtime Database.

---

## 11. Interface de Fotos e Galeria Integrada (PHASE 08)

Na Phase 08, a experiência visual de fotos foi conectada diretamente ao ecossistema de sincronização através do componente `ProductImageGallery` (`src/js/components/ProductImageGallery.js`), montado na tela de detalhes do produto (`ProductDetailPage.js`).

### 11.1 Máquina de Estados Visuais da Galeria
```
                     ┌───────────────────┐
                     │     loadPhotos    │
                     └─────────┬─────────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
         [Sem fotos]     [Em download]   [Fotos locais]
               │               │               │
               ▼               ▼               ▼
           NO_IMAGE         LOADING          ONLINE?
                               │            ┌───┴───┐
                               │           SIM     NÃO
                               │            │       │
                               ▼            ▼       ▼
                            PARTIAL       READY  OFFLINE_READY
                          (1+ prontas,
                          outras baixando)
```

| Estado | Descrição Visual | Comportamento do Usuário |
| :--- | :--- | :--- |
| **`NO_IMAGE`** | Ícone discreto e mensagem "Nenhuma foto cadastrada". | Não exibe setas nem faixa de miniaturas. |
| **`LOADING`** | Skeleton animado e indicador com spinner "Sincronizando imagem...". | Aciona download sob demanda P1 em background. |
| **`PARTIAL`** | Foto disponível exibida + badge "Sincronizando fotos...". | Usuário já interage com a foto pronta enquanto outras chegam. |
| **`READY`** | Todas as fotos prontas e disponíveis (online). | Navegação completa por carrossel e miniaturas. |
| **`OFFLINE_READY`**| Fotos carregadas do cache local + badge sutil "Disponível offline". | Experiência de uso idêntica à online, com zero tráfego de rede. |
| **`OFFLINE_MISSING`**| Mensagem explicativa "Foto indisponível offline". | Informa que a foto não foi pré-sincronizada sem travar a interface. |
| **`ERROR`** | Ícone de aviso, "Imagem indisponível" e botão "Tentar novamente". | Aciona `ensureProductImages` para retentativa controlada. |

### 11.2 Características Arquiteturais de UX
1. **Foto Principal Imediata**: Fotos com `isPrimary: true` são indexadas na posição 0, garantindo primeira imagem útil instantânea ao abrir o produto.
2. **Atualização Reativa Sem Recarregar a Tela (Zero Page Reload)**: A galeria assina o evento `IMAGE_DOWNLOADED` no `eventBus`. Ao receber a foto recém-baixada, substitui o skeleton ou atualiza a versão v1 para v2 no DOM sem acionar `window.location.reload()` nem recriar a página.
3. **Lightbox Fullscreen com Zoom Nativo**: Modal de alta resolução com backdrop escurecido (`bg-slate-950/95`), controle de zoom por clique (`scale-150`), navegação por setas e fechamento com atalho `ESC`.
4. **Contenção Estrita de Object URLs**: Todas as URLs de objetos criadas pelo componente são registradas e revogadas compulsoriamente via `URL.revokeObjectURL()` no método `destroy()`, eliminando vazamentos de memória na alternância de abas ou navegação entre produtos.

---

## 12. Homologação End-to-End em Staging e Validação do Ciclo de Fotos (Phase 09)

Na Phase 09, o fluxo completo de imagens foi homologado ponta a ponta simulando dois dispositivos distintos (Device A Windows Desktop e Device B Android PWA) conectados ao mesmo tenant de staging (`tenant-staging`):

1. **Upload em Staging (Device A)**:
   - Device A cria produto e envia 3 fotos WebP (`foto_1`, `foto_2`, `foto_3`) ao provedor de armazenamento;
   - As fotos recebem hashes SHA-256 e são registradas no manifesto remoto com versão 1.
2. **Download Sob Demanda (Device B)**:
   - Device B abre a tela de detalhes do produto, acionando `ensureProductImages(productId)`;
   - As 3 imagens são baixadas na fila prioritária P1 com concorrência controlada;
   - Validação criptográfica de integridade: `hash local === hash remoto` confirmado para cada imagem antes de persistir no `LocalImageCache`.
3. **Persistência Offline Total**:
   - Device B entra em modo offline;
   - A tela de detalhes do produto continua renderizando todas as fotos com fidelidade visual a partir dos Blobs salvos no IndexedDB (`productImages`), sem gerar erros de rede ou dependência de conectividade.
4. **Atualização Incremental e Deduplicação Extrema**:
   - Device A insere Foto 4 e altera a Foto 1 (gerando versão 2 e novo hash SHA-256), mantendo Foto 2 intacta;
   - Device B reconecta e sincroniza: Foto 4 e Foto 1 (v2) são baixadas; Foto 2 tem **zero download redundante**;
   - Foto 3 é excluída no Device A com registro de `deletedAt` no manifesto, mantendo integridade histórica.

### 12.1 REAL ENVIRONMENT VALIDATION
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

## 13. Endurecimento de Segurança do Storage (Phase 11 — Security Hardening)

Na Phase 11, a camada de armazenamento e exibição de imagens passou por auditoria defensiva em profundidade:

### 13.1 Neutralização de SVG Stored XSS
- **Regras Cloud Storage**: Substituição da permissão genérica `image/.*` por `image/(jpeg|png|webp)` em `storage.rules`. O formato `image/svg+xml` foi sumariamente bloqueado, impedindo injeção de scripts XML embutidos (`<script>`, tags `<animate>` maliciosas).
- **Validação no Cliente**: `FirebaseStorageProvider._validateFile` e `_validateRemotePathForTenant` rejeitam uploads e downloads fora do catálogo raster permitido.

### 13.2 Proteção Contra Path Traversal e Injeção de Diretórios
- Implementação de `_sanitizePathSegment(segment)` em `FirebaseStorageProvider.js`.
- Rejeição imediata de segmentos contendo:
  - Travessia de diretório (`../`, `..\`);
  - Separadores de caminho (`/`, `\`);
  - Null bytes (`\0`);
  - Metacaracteres reservados (`:`, `?`, `#`).
- Caminhos remotos são estritamente forçados no padrão seguro:
  `tenants/${tenantId}/products/${productId}/${photoId}`
  com validação de correspondência exata do `tenantId` da sessão ativa.

### 13.3 Sanitização de Esquemas de URL e Atributos DOM
- `ProductImageGallery.js` implementa `_sanitizeImageUrl(url)`:
  - URLs com esquemas maliciosos (`javascript:`, `data:`, `vbscript:`) são bloqueadas antes de serem atribuídas a elementos `<img>`, `src` ou `href`.
  - Apenas esquemas seguros (`http:`, `https:`, `blob:`) são aceitos.
- Labels e metadados de fotos (`photo.label`) são escapados antes de renderização e inseridos em atributos de acessibilidade (`aria-label`, `title`) sem interpretação HTML (`SEC-11`).
- `webAdapter.js` e `tauriAdapter.js` contam com `_isSafeExternalUrl()` bloqueando abertura de URLs perigosas via `openExternal`.





