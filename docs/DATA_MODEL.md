# Modelo de Dados — GestãoPro

## Regras Universais

| Regra | Descrição |
|-------|-----------|
| **IDs** | `crypto.randomUUID()` — string UUID v4 |
| **Valores Monetários** | Inteiros em centavos (`cents`). Nunca float como fonte de verdade. |
| **Datas** | ISO 8601 UTC string (`new Date().toISOString()`) |
| **Soft Delete** | `deletedAt: string|null` — nunca delete permanente de entidade com histórico |

---

## Entidade: `Product`

Store IndexedDB: `products`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `name` | string | Nome do produto (obrigatório, mín. 2 chars) |
| `productCode` | string | Código SKU (único quando preenchido) |
| `internalCode` | string | Código interno da loja (único quando preenchido) |
| `barcode` | string | Código de barras EAN/GTIN (único quando preenchido) |
| `description` | string | Descrição longa do produto |
| `category` | string | Categoria principal (texto livre) |
| `subcategory` | string | Subcategoria |
| `brand` | string | Marca / Fabricante |
| `purchasePriceCents` | integer | Preço de compra / custo de referência em centavos |
| `salePriceCents` | integer | Preço de venda em centavos |
| `minimumStock` | integer | Quantidade mínima para alerta |
| `maximumStock` | integer | Quantidade máxima para controle |
| `stockQuantity` | integer | Quantidade atual (cache atômico de leitura) |
| `totalSold` | integer | Total acumulado de unidades vendidas |
| `notes` | string | Observações internas da loja |
| `isActive` | boolean | Produto ativo (true) ou inativo (false) |
| `deletedAt` | string|null | ISO string de exclusão (soft delete) |
| `createdAt` | string | ISO string de criação |
| `updatedAt` | string | ISO string da última atualização |

---

## Entidade: `Supplier` (FASE 6)

Store IndexedDB: `suppliers`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `name` | string | Razão Social / Nome Fantasia |
| `document` | string | CNPJ ou CPF formatado |
| `email` | string | Email comercial |
| `phone` | string | Telefone / WhatsApp |
| `contactPerson` | string | Nome do representante / vendedor |
| `address` | string | Endereço comercial completo |
| `notes` | string | Observações internas |
| `isActive` | boolean | Fornecedor ativo (true) ou inativo (false) |
| `deletedAt` | string|null | Soft delete |
| `createdAt` | string | ISO string de criação |
| `updatedAt` | string | ISO string da última atualização |

---

## Entidade: `Purchase` (FASE 6)

Store IndexedDB: `purchases`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `supplierId` | string (UUID) | Referência ao fornecedor |
| `supplierName` | string | Snapshot do nome do fornecedor |
| `productId` | string (UUID) | Referência ao produto |
| `productName` | string | Snapshot do nome do produto |
| `productCode` | string | SKU do produto |
| `quantity` | integer | Quantidade adquirida |
| `unitCostCents` | integer | Custo unitário de compra em centavos |
| `totalCostCents` | integer | Custo total da ordem (`quantity * unitCostCents`) |
| `invoiceNumber` | string | Número da Nota Fiscal / Comprovante |
| `paymentMethod` | string | Forma de pagamento utilizada |
| `notes` | string | Observações da compra |
| `stockMovementId` | string (UUID) | Referência ao movimento de entrada |
| `cancelledAt` | string|null | ISO string de cancelamento |
| `cancelReason` | string|null | Motivo do estorno |
| `date` | string | Data da compra |
| `createdAt` | string | ISO string de criação |
| `updatedAt` | string | ISO string da última atualização |

---

## Entidade: `StockMovement` (FASE 4)

Store IndexedDB: `stockMovements`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `productId` | string (UUID) | Referência ao produto |
| `type` | string | `IN`, `OUT`, `ADJUSTMENT`, `RETURN`, `PURCHASE`, `SALE` |
| `quantity` | integer | Quantidade movimentada (absoluta) |
| `delta` | integer | Variação com sinal (+ / -) |
| `unitCostCents` | integer | Custo unitário registrado na movimentação |
| `reason` | string | Justificativa / Motivo da movimentação |
| `notes` | string | Observações adicionais |
| `referenceId` | string | ID da Venda, Compra ou Ajuste relacionado |
| `referenceType` | string | Tipo da referência (`SALE`, `SALE_CANCEL`, `PURCHASE`, `PURCHASE_CANCEL`) |
| `previousStock` | integer | Saldo antes do movimento |
| `resultingStock` | integer | Saldo após o movimento |
| `date` | string | ISO string da data do movimento |
| `createdAt` | string | ISO string de auditoria |

---

## Entidade: `Sale` (FASE 5)

Store IndexedDB: `sales`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `productId` | string (UUID) | Referência ao produto |
| `productName` | string | Snapshot do nome do produto |
| `quantity` | integer | Quantidade vendida |
| `unitSalePriceCents` | integer | Preço unitário praticado na venda |
| `unitCostCents` | integer | **Snapshot imutável** do custo unitário |
| `totalSaleCents` | integer | Faturamento total |
| `totalCostCents` | integer | Custo total da mercadoria vendida |
| `profitCents` | integer | Lucro bruto |
| `marginPercent` | number | Margem percentual |
| `paymentMethod` | string | `DINHEIRO`, `PIX`, `CARTAO_CREDITO`, `CARTAO_DEBITO`, etc. |
| `cancelledAt` | string|null | ISO string de cancelamento |
| `createdAt` | string | ISO string de criação |

---

## Entidade: `ProductSupplier` (FASE 7 — Cotações)

Store IndexedDB: `productSuppliers`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável |
| `productId` | string (UUID) | Referência ao produto |
| `supplierId` | string (UUID) | Referência ao fornecedor |
| `unitCostCents` | integer | Preço de custo cotado em centavos |
| `minimumOrderQty` | integer | Quantidade mínima para pedido |
| `leadTimeDays` | integer | Prazo de entrega em dias corridos |
| `paymentTerms` | string | Condições comerciais (ex: "30/60 dias", "À vista") |
| `quoteDate` | string | Data da cotação (ISO string) |
| `validUntil` | string\|null | Data de validade da cotação (ISO string) |
| `isPreferred` | boolean | Indica se é o fornecedor de preferência operacional |
| `notes` | string | Observações específicas da cotação |
| `isActive` | boolean | Cotação ativa (máximo 3 ativas por produto) |
| `createdAt` | string | ISO string de criação |
| `updatedAt` | string | ISO string da última atualização |

---

## Entidade: `SyncQueueItem` (FASE 13 — Fila Outbox)

Store IndexedDB: `syncQueue`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string (UUID) | Chave primária imutável da mutação |
| `entityType` | string | Nome da store/coleção (ex: `products`, `sales`, `stockMovements`) |
| `entityId` | string | ID do registro afetado |
| `action` | string | Tipo da mutação (`CREATE`, `UPDATE`, `DELETE`) |
| `payload` | object | Snapshot dos dados serializados da entidade |
| `status` | string | Estado do ciclo de vida: `PENDING`, `SYNCING`, `SYNCED`, `FAILED` |
| `attempts` | integer | Contador de tentativas de sincronização |
| `lastAttemptAt` | string\|null | Timestamp ISO da última tentativa |
| `lastError` | string\|null | Mensagem de erro em caso de falha |
| `syncedAt` | string\|null | Timestamp ISO de confirmação remota |
| `remoteVersion` | string\|null | Versão ou timestamp gerado pelo servidor em nuvem |
| `createdAt` | string | ISO string de registro na fila |
| `updatedAt` | string | ISO string da última alteração de estado |

