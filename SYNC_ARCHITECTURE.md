# Arquitetura de Sincronização em Nuvem — GestãoPro (PHASE 01)

Este documento define formalmente a arquitetura de sincronização remota do **GestãoPro**, estabelecendo a modelagem do **Firebase Realtime Database**, o contrato do **FirebaseRealtimeProvider**, a segregação **Multi-tenant**, o protocolo de **Sincronização Bidirecional**, a estratégia **Anti-Loop** e a resolução de conflitos.

---

## 1. Princípio Fundamental: Local-First Irrestrito

Todas as operações de negócio (criar produto, registrar venda, movimentar estoque) são executadas localmente no **IndexedDB** (`gestaopro_db`) via `idb` v8:
- **Latência Zero**: UI atualiza em 0ms.
- **Funcionamento Offline Pleno**: Nenhuma chamada ao Firebase bloqueia a experiência do usuário.
- **Transações Atômicas**: Multi-store com rollback automático (`src/js/db/transactions.js`).
- **Padrão Outbox**: Mutações locais são gravadas na store `syncQueue` e despachadas assincronamente pelo `SyncEngine`.

---

## 2. Contrato Atual vs Futuro do Cloud Provider

### 2.1 Interface Atual (`CloudProvider.js`)
```typescript
interface CloudProvider {
  getProviderName(): string;
  isConfigured(): boolean;
  updateConfig(config: Record<string, any>): void;
  getConfig(): Record<string, any>;
  testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }>;
  pushChange(changeItem: SyncQueueItem): Promise<{ success: boolean; remoteId: string; remoteVersion?: string; error?: string }>;
  pullChanges(entityType: string, sinceTimestamp?: string | null): Promise<{ items: any[]; latestTimestamp: string }>;
}
```

### 2.2 Hierarquia de Provedores
```
                      ┌────────────────────────┐
                      │     CloudProvider      │
                      │  (Interface Abstrata)  │
                      └───────────┬────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
│ FirebaseProvider │   │  MockCloudProvider   │   │   FirebaseRealtimeProvider   │
│ (Firestore REST) │   │ (Emulador em Memória)│   │  (Realtime Database v10/v11) │
│ [Legado FASE 13] │   │ [Suíte de Testes]    │   │ [Alvo FASES 02 a 09]         │
└──────────────────┘   └──────────────────────┘   └──────────────────────────────┘
```

### 2.3 Implementação do `FirebaseRealtimeProvider` (Concluída na Phase 03)
O novo conector implementa estritamente os métodos de `CloudProvider`, garantindo que:
- `ProductService`, `StockService`, `SaleService`, `PurchaseService` e `SyncRepository` **NÃO sofram nenhuma alteração de código**.
- O `SyncEngine.js` continue utilizando `pushChange` e `pullChanges` normalmente.
- Adiciona métodos de tempo real para streaming bidirecional:
  - `subscribe(entityType: string, onUpdate: (data: any) => void): () => void` (retorna função de cancelamento/unsubscribe com Anti-Loop integrado).
  - `unsubscribe(entityType: string, callback: Function): void`.
  - `unsubscribeAll(): void` (encerra WebSockets/SSE na desmontagem).
  - `onConnectionChange(callback: Function): () => void` (monitoramento de `/.info/connected`).

---

## 3. Modelagem do Firebase Realtime Database (Schema JSON)

Os dados no Realtime Database são particionados por tenant/empresa (`/tenants/{tenantId}`), garantindo isolamento estrito entre contas.

### 3.1 Árvore Estruturada
```json
{
  "tenants": {
    "tenant_empresa_001": {
      "metadata": {
        "companyName": "Loja Matriz Centro",
        "cnpj": "12345678000190",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "plan": "standard"
      },
      "products": {
        "p_uuid_001": {
          "id": "p_uuid_001",
          "name": "Teclado Mecânico RGB Pro",
          "productCode": "TEC-001",
          "internalCode": "INT-10",
          "barcode": "7891234567890",
          "description": "Switches azuis, padrão ABNT2",
          "category": "Periféricos",
          "brand": "ProTech",
          "purchasePriceCents": 12000,
          "salePriceCents": 24900,
          "minimumStock": 5,
          "maximumStock": 50,
          "stockQuantity": 18,
          "totalSold": 42,
          "isActive": true,
          "version": 4,
          "updatedAt": "2026-10-08T14:30:00.000Z",
          "updatedBy": "usr_auth_uuid_99",
          "lastMutationId": "mut_uuid_777",
          "deletedAt": null
        }
      },
      "inventory": {
        "mov_uuid_001": {
          "id": "mov_uuid_001",
          "productId": "p_uuid_001",
          "type": "IN",
          "quantity": 10,
          "delta": 10,
          "unitCostCents": 12000,
          "reason": "Entrada por Ordem de Compra #102",
          "referenceId": "pur_uuid_102",
          "referenceType": "PURCHASE",
          "previousStock": 8,
          "resultingStock": 18,
          "date": "2026-10-08T14:00:00.000Z",
          "createdAt": "2026-10-08T14:00:00.000Z",
          "createdBy": "usr_auth_uuid_99"
        }
      },
      "sales": {
        "sale_uuid_001": {
          "id": "sale_uuid_001",
          "productId": "p_uuid_001",
          "productName": "Teclado Mecânico RGB Pro",
          "quantity": 2,
          "unitSalePriceCents": 24900,
          "unitCostCents": 12000,
          "totalSaleCents": 49800,
          "totalCostCents": 24000,
          "profitCents": 25800,
          "marginPercent": 51.8,
          "paymentMethod": "PIX",
          "cancelledAt": null,
          "date": "2026-10-08T14:15:00.000Z",
          "createdAt": "2026-10-08T14:15:00.000Z",
          "createdBy": "usr_auth_uuid_99"
        }
      },
      "purchases": {
        "pur_uuid_102": {
          "id": "pur_uuid_102",
          "supplierId": "sup_uuid_01",
          "supplierName": "Distribuidora Tech Ltda",
          "productId": "p_uuid_001",
          "productName": "Teclado Mecânico RGB Pro",
          "productCode": "TEC-001",
          "quantity": 10,
          "unitCostCents": 12000,
          "totalCostCents": 120000,
          "invoiceNumber": "NF-99881",
          "paymentMethod": "BOLETO",
          "stockMovementId": "mov_uuid_001",
          "cancelledAt": null,
          "date": "2026-10-08T13:50:00.000Z",
          "createdAt": "2026-10-08T13:50:00.000Z"
        }
      },
      "suppliers": {
        "sup_uuid_01": {
          "id": "sup_uuid_01",
          "name": "Distribuidora Tech Ltda",
          "document": "12.345.678/0001-90",
          "email": "contato@distribuidoratech.com.br",
          "phone": "(11) 98765-4321",
          "isActive": true,
          "updatedAt": "2026-09-10T10:00:00.000Z",
          "deletedAt": null
        }
      },
      "productSuppliers": {
        "ps_uuid_01": {
          "id": "ps_uuid_01",
          "productId": "p_uuid_001",
          "supplierId": "sup_uuid_01",
          "unitCostCents": 11500,
          "leadTimeDays": 3,
          "isPreferred": true,
          "isActive": true,
          "updatedAt": "2026-09-10T10:00:00.000Z"
        }
      },
      "settings": {
        "allowNegativeStock": { "value": false, "updatedAt": "2026-08-01T00:00:00.000Z" },
        "autoSyncEnabled": { "value": true, "updatedAt": "2026-10-08T10:00:00.000Z" },
        "imageSyncPolicy": { "value": "WIFI_ONLY", "updatedAt": "2026-10-08T10:00:00.000Z" }
      },
      "imageManifest": {
        "img_uuid_001": {
          "id": "img_uuid_001",
          "productId": "p_uuid_001",
          "label": "Foto Principal",
          "isPrimary": true,
          "url": "https://storage.provider.com/tenants/t001/products/p001/main.webp",
          "thumbnailUrl": "https://storage.provider.com/tenants/t001/products/p001/thumb.webp",
          "version": 1,
          "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "sizeBytes": 194500,
          "mimeType": "image/webp",
          "width": 1920,
          "height": 1080,
          "updatedAt": "2026-10-08T14:00:00.000Z",
          "deletedAt": null
        }
      },
      "syncMetadata": {
        "lastCatalogUpdate": "2026-10-08T14:30:00.000Z",
        "lastManifestUpdate": "2026-10-08T14:00:00.000Z",
        "activeDevices": {
          "device_windows_pc01": { "lastSeen": "2026-10-08T14:35:10.000Z", "appVersion": "1.13.0", "platform": "desktop" },
          "device_android_tab01": { "lastSeen": "2026-10-08T14:35:12.000Z", "appVersion": "1.13.0", "platform": "pwa" }
        }
      }
    }
  }
}
```

---

## 4. Modelagem Multiusuário e Permissões (RBAC)

### 4.1 Estrutura de Identidade
- Todo usuário autenticado no Firebase Auth possui um token JWT com Custom Claims:
  ```json
  {
    "tenantId": "tenant_empresa_001",
    "role": "admin" | "operator",
    "displayName": "Operador Caixa 1"
  }
  ```
- **Fallback de Registro Inicial**: Mapeamento do usuário na coleção raiz `/users/{uid}` para associar o usuário ao respectivo `tenantId` e `role`.

### 4.2 Matriz de Controle de Acesso
| Recurso | Administrador (`admin`) | Operador (`operator`) | Anônimo |
| :--- | :--- | :--- | :--- |
| **Produtos** | Leitura, Criação, Edição, Desativação | Leitura, Consulta | Negado |
| **Estoque** | Leitura, Ajuste Físico, Auditoria | Leitura, Movimentação de Venda | Negado |
| **Vendas** | Leitura, Registro, Cancelamento/Estorno | Leitura, Registro | Negado |
| **Compras/Fornecedores**| Leitura, Cadastro, Edição | Consulta apenas | Negado |
| **Configurações/Backup**| Leitura, Alteração de Parâmetros | Somente leitura de opções visuais | Negado |
| **Fotos/Manifest** | Upload, Substituição, Exclusão | Leitura e Download | Negado |

---

## 5. Security Rules Declarativas (`database.rules.json`)

```json
{
  "rules": {
    "tenants": {
      "$tenantId": {
        ".read": "auth != null && (auth.token.tenantId === $tenantId || root.child('users').child(auth.uid).child('tenantId').val() === $tenantId)",
        ".write": "auth != null && (auth.token.tenantId === $tenantId || root.child('users').child(auth.uid).child('tenantId').val() === $tenantId)",

        "products": {
          ".indexOn": ["productCode", "barcode", "updatedAt", "category"],
          "$productId": {
            ".validate": "newData.hasChildren(['id', 'name', 'salePriceCents', 'updatedAt']) && newData.child('salePriceCents').isNumber()"
          }
        },

        "inventory": {
          ".indexOn": ["productId", "type", "date"],
          "$movementId": {
            ".validate": "newData.hasChildren(['id', 'productId', 'quantity', 'delta', 'type'])"
          }
        },

        "sales": {
          ".indexOn": ["productId", "date", "createdAt"],
          "$saleId": {
            ".validate": "newData.hasChildren(['id', 'productId', 'quantity', 'totalSaleCents'])"
          }
        },

        "imageManifest": {
          ".indexOn": ["productId", "version", "updatedAt"],
          "$photoId": {
            ".validate": "newData.hasChildren(['id', 'productId', 'url', 'version', 'hash', 'sizeBytes'])"
          }
        },

        "syncMetadata": {
          ".write": "auth != null"
        }
      }
    },

    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && (auth.uid === $uid || auth.token.role === 'admin')"
      }
    }
  }
}
```

---

## 6. Sincronização Bidirecional e Prevenção Matemática de Loop

### 6.1 A Anatomia do Problema do Loop
```
Dispositivo A (Local) ──(Push)──► Firebase RTDB
                                       │
                                   (onUpdate)
                                       ▼
                              Dispositivo A (Recebe próprio evento)
                                       │
                                (Salva IndexedDB)
                                       │
                                 (Gera EventBus)
                                       │
                              (SyncEngine enfileira de novo)
                                       │
                                       ▼
                              Dispositivo A (Reenvia ao Firebase: LOOP INFINITO!)
```

### 6.2 Solução Arquitetural de 4 Camadas Anti-Loop
1. **Identificador Único de Dispositivo (`sourceDeviceId`)**:
   - Todo cliente gera na primeira inicialização um UUID v4 persistido em `settings` (`sourceDeviceId`).
   - Toda alteração enviada ao Realtime Database inclui os metadados:
     `{ lastMutationId: 'uuid', sourceDeviceId: 'meu_device_id', version: N }`.
2. **Descarte Imediato no Listener**:
   - Ao receber um evento do Realtime Database via WebSocket/SSE:
     ```javascript
     if (remoteDoc.sourceDeviceId === this.currentDeviceId) {
       // O evento é eco da minha própria alteração já gravada localmente!
       // DESCARTA imediatamente. Não aciona IndexedDB nem EventBus.
       return;
     }
     ```
3. **Tagging de Contexto de Origem (`origin`)**:
   - Mutações geradas pelo usuário na UI: `{ origin: 'local' }`.
   - Mutações legítimas de outro dispositivo recebidas e aplicadas localmente: `{ origin: 'remote' }`.
   - O `SyncEngine` escuta e enfileira exclusivamente eventos onde `origin === 'local'`.
4. **Guarda de Idempotência e Versão**:
   - O documento só é aplicado no IndexedDB local se `remoteDoc.version > localDoc.version`.
   - Isso elimina reprocessamentos cíclicos mesmo em caso de falha de rede temporária.

---

## 7. Estratégia de Resolução de Conflitos

| Tipo de Dado | Estratégia Adotada | Justificativa Técnica |
| :--- | :--- | :--- |
| **Produtos** | **Last Write Wins (LWW)** baseado em `updatedAt` com incremento de `version`. | Edições cadastrais (nome, preço de venda, descrição) convergem determinísticamente para a alteração mais recente. |
| **Estoque** | **Razão Contábil Append-Only** (`stockMovements`). | Dois dispositivos nunca "editam" o saldo de estoque ao mesmo tempo. Cada dispositivo registra sua movimentação (ex: -1 venda, +5 compra). O saldo final do produto é a soma algébrica dos movimentos validados, garantindo reconciliação sem perda de dados. |
| **Vendas** | **Imutabilidade / Append-Only**. | Uma venda efetuada em um dispositivo nunca é alterada por outro. Cancelamentos são novos eventos de estorno vinculados ao ID original. |
| **Manifest de Imagens**| **Maior Versão (`version`)**. | Atualização de foto sobrepõe versões antigas; exclusão propaga via `deletedAt`. |

---

## 8. Sincronização Automática de Imagens (Phase 07) e Prevenção de Loops com Outbox

Na Phase 07, o `ImageSyncService` orquestra o download inteligente de fotos baseado nos metadados obtidos via `ImageManifestService`.

### 8.1 Separação Rígida entre Dados e Binários
```
                     ┌──────────────────────────────┐
                     │ Firebase Realtime Database   │
                     │ (imageManifest: metadados)   │
                     └──────────────┬───────────────┘
                                    │
                         ImageManifestService
                                    │
                                    ▼
┌──────────────────┐        ImageSyncService        ┌─────────────────────────┐
│ SyncEngine       │   (Fila P1 / P2 / P3 c/ Retry) │ ImageStorageProvider    │
│ (Outbox / Dados) │                │               │ (Download de Blobs)     │
└────────┬─────────┘                │               └────────────┬────────────┘
         │                          │                            │
   NÃO PARTICIPA                    ▼                            ▼
   DO FLUXO DE              LocalImageCache ◄──────── SHA-256 Validation
   IMAGENS!                 (IndexedDB v3: Blobs)
```

### 8.2 Garantias Anti-Loop no Fluxo de Imagens
1. **Nenhuma Mutação de Produto Gerada no Download**:
   - Quando uma imagem é baixada do provedor de storage e salva no `LocalImageCache`, o serviço **NÃO** invoca `ProductService.updateProduct` nem atualiza `updatedAt`/`version` do produto.
   - O vínculo `product.image` ou galeria de imagens aponta para IDs/URLs estáveis gerenciadas pelo manifesto.
2. **Isolamento do Outbox (`syncQueue`)**:
   - O `LocalImageCache` e o `imageManifestRepository` operam stores independentes no IndexedDB.
   - O `SyncEngine` escuta apenas stores de entidades de negócio (`products`, `sales`, `stockMovements`, etc.).
   - Downloads locais não geram itens na store `syncQueue`, eliminando qualquer possibilidade de loop infinito entre dispositivo e RTDB.

---

## 9. Validação em Ambiente Real / Staging e Emuladores (PHASE 09)

### 9.1 Configuração Declarativa de Emuladores
- `firebase.json` define os emuladores locais oficiais:
  - Auth Emulator na porta 9099;
  - Realtime Database Emulator na porta 9000;
  - Storage Emulator na porta 9199;
  - Emulator UI na porta 4000.
- `.firebaserc` associa o alias padrão a `gerenciador-produtos-staging`.
- `firebaseConfigValidator.js` bloqueia terminantemente tentativas de conexão com projetos de produção conhecidos (`caixa-autopecas`, etc.).

### 9.2 REAL ENVIRONMENT VALIDATION
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

## 10. Segurança e Endurecimento de Regras (PHASE 11)

### 10.1 Eliminação de Cascata de Escrita Pai no RTDB
- **Princípio:** No Firebase Realtime Database, a declaração de `.write: true` em um nó ancestral propaga autorização irrestrita a todos os descendentes, ignorando regras mais estritas em nós filhos.
- **Correção:** A regra `.write` na raiz `$tenantId` foi completamente removida. Todas as coleções do tenant (`products`, `inventory`, `sales`, `purchases`, `suppliers`, `settings`, `imageManifest`, `syncMetadata`) agora definem individualmente suas condições de autorização.
- **RBAC Estrito:** Operações em `settings`, `purchases` e `suppliers` exigem estritamente `auth.token.role === 'admin'`.

### 10.2 Proteção Contra Auto-Elevação de Privilégio (`/users/$uid`)
- A regra de escrita em `/users/$uid` bloqueia qualquer tentativa de um usuário regular alterar seu próprio `role` ou `tenantId`. Apenas administradores ou Cloud Functions podem atribuir roles.

### 10.3 Idempotência e Defesa Contra Replay Attacks
- O `SyncRepository` e as transações de estoque operam com identificadores únicos determinísticos (`mutationId`, `movementId`), garantindo que reenvios ou repetições de mensagens de rede não gerem lançamentos financeiros ou alterações duplicadas de saldo (SEC-17, SEC-18).



