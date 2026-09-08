# Regras de Negócio — GestãoPro

## Regras Gerais

### RN-001 — Transações Estritas
Nenhuma operação de persistência deve ser aplicada parcialmente.  
Erros durante uma transação multi-store acionam rollback automático via IndexedDB.

### RN-002 — Soft Delete Obrigatório
Produtos e Fornecedores **nunca são removidos definitivamente** enquanto houver possibilidade de referência futura em vendas, compras ou movimentações de estoque.  
A exclusão define `deletedAt` com timestamp ISO e o registro permanece na store.

### RN-003 — Valores Monetários em Centavos
Todos os valores monetários são armazenados como **inteiros em centavos**.  
`float` nunca é fonte de verdade — apenas para exibição ou entrada do usuário via conversão explícita por `MoneyService`.

---

## Regras de Produto (FASE 3)

### RN-004 — Nome Obrigatório
O campo `name` é obrigatório e deve ter no mínimo 2 caracteres e no máximo 255 caracteres.

### RN-005 — Unicidade de Códigos
Os campos `productCode`, `internalCode` e `barcode`, quando preenchidos, devem ser únicos entre produtos ativos.  
Ao atualizar, a verificação exclui o próprio produto da checagem.

### RN-007 — Estoque Mínimo e Máximo
Quando `maximumStock > 0` e `minimumStock > 0`, o máximo deve ser maior ou igual ao mínimo.

---

## Regras de Movimentação e Gestão de Estoque (FASE 4)

### RE-001 — Fonte de Verdade de Estoque
Toda e qualquer alteração de saldo físico deve originar um registro na store `stockMovements`.  
O campo `Product.stockQuantity` atua como cache sincronizado atomicamente.

### RE-002 — Tipos de Movimentação Válidos
- `IN`: Entrada manual / reposição (soma ao saldo).
- `OUT`: Saída manual / perda / avaria / showroom (subtrai do saldo).
- `ADJUSTMENT`: Balanço físico / inventário periódico (ajuste relativo para coincidir com a contagem física).
- `RETURN`: Devolução de cliente ou fornecedor (soma ao saldo).
- `PURCHASE`: Entrada gerada por ordem de compra (soma ao saldo).
- `SALE`: Saída gerada por pedido de venda (subtrai do saldo).

### RE-003 — Quantidade Inteira Positiva
Toda movimentação manual de entrada ou saída deve informar quantidade inteira estritamente maior que zero (`quantity > 0`).

### RE-004 — Justificativa Obrigatória para Saídas e Ajustes
Toda operação do tipo `OUT` ou `ADJUSTMENT` exige preenchimento obrigatório de um motivo/justificativa para fins de auditoria interna.

### RE-005 — Bloqueio de Estoque Negativo
Por padrão (`allowNegativeStock = false`), o sistema rejeita qualquer movimentação de saída que resulte em saldo inferior a zero. Caso o parâmetro seja alterado nas configurações, o saldo negativo é aceito mantendo o registro transacional.

### RE-006 — Classificação de Status de Estoque
- **Esgotado (`OUT_OF_STOCK`)**: `stockQuantity <= 0`.
- **Estoque Baixo (`LOW_STOCK`)**: `stockQuantity > 0 && stockQuantity <= minimumStock` (quando `minimumStock > 0`).
- **Excesso (`EXCESS_STOCK`)**: `stockQuantity > maximumStock` (quando `maximumStock > 0`).
- **Normal (`NORMAL`)**: Dentro da faixa ideal de operação.

### RE-007 — Auditoria e Recalibração de Integridade
O sistema disponibiliza rotina de recalibração (`recalculateAllStock`) que soma o histórico imutável de `stockMovements` e atualiza eventuais divergências em `Product.stockQuantity`.

---

## Regras de Vendas e Registro Comercial (FASE 5)

### RV-001 — Atomicidade Multi-Store na Venda
Toda venda é registrada em transação atômica única (`sales`, `stockMovements`, `products`, `settings`):
1. Cria registro na store `sales`;
2. Cria movimento de saída na store `stockMovements` (`type: 'SALE'`, `referenceId: saleId`);
3. Deduz `Product.stockQuantity`;
4. Incrementa `Product.totalSold`.

### RV-002 — Snapshot Imutável de Custos e Lucro
Toda venda grava o custo unitário praticado no exato instante da transação (`unitCostCents`). Alterações futuras no `purchasePriceCents` do produto **não alteram** o custo histórico nem o lucro das vendas já efetuadas.

### RV-003 — Fórmulas de Fechamento de Venda
- `totalSaleCents = quantity * unitSalePriceCents`
- `totalCostCents = quantity * unitCostCents`
- `profitCents = totalSaleCents - totalCostCents`
- `marginPercent = (profitCents / totalSaleCents) * 100`

### RV-004 — Bloqueio de Venda Sem Estoque
Quando `allowNegativeStock = false`, o sistema aborta a transação e impede a venda se a quantidade solicitada for superior ao estoque atual disponível.

### RV-005 — Estorno e Cancelamento de Venda
Ao cancelar uma venda (`cancelSale`), a venda é marcada com `cancelledAt`, o estoque é reposto via `StockMovement` do tipo `RETURN` (`referenceType: 'SALE_CANCEL'`) e o acumulador `Product.totalSold` é ajustado de forma atômica.

---

## Regras de Fornecedores e Compras (FASE 6)

### RC-001 — Unicidade de Documento de Fornecedor
O campo `document` (CNPJ/CPF), quando preenchido, deve ser único entre fornecedores ativos.

### RC-002 — Entrada Automática de Mercadorias
Toda ordem de compra registrada na store `purchases` gera imediatamente e atomicamente uma movimentação `StockMovement` com `type: 'PURCHASE'` (`delta: +quantity`), aumentando o saldo em `Product.stockQuantity`.

### RC-003 — Calibração do Preço de Custo de Referência
Opcionalmente, a ordem de compra permite atualizar o campo `Product.purchasePriceCents` com o novo custo praticado pelo fornecedor na transação.

### RC-004 — Estorno Seguro de Ordem de Compra
O cancelamento de uma ordem de compra gera movimentação `OUT` (`referenceType: 'PURCHASE_CANCEL'`) e deduz os itens do estoque. Se `allowNegativeStock = false` e os itens já tiverem sido vendidos/consumidos, o estorno é bloqueado.

---

## Regras de Cotações de Fornecedores (FASE 7)

### RQ-001 — Limite de Fornecedores por Produto
Cada produto pode ter no **máximo 3 cotações ativas** (`isActive = true`) simultaneamente. A tentativa de registrar uma 4ª cotação ativa é bloqueada até que uma existente seja desativada ou removida.

### RQ-002 — Cotação Única por Fornecedor
Não é permitido ter duas cotações ativas do mesmo fornecedor para o mesmo produto. Atualizações criam uma nova cotação e desativam a anterior no histórico.

### RQ-003 — Destaque Automático de Menor Preço (`isCheapest`)
O sistema identifica automaticamente a cotação ativa com o menor `unitCostCents` para cada produto. Havendo empate, a cotação mais recente recebe o destaque.

### RQ-004 — Fornecedor Preferido (`isPreferred`) Independente
O usuário pode marcar um fornecedor como preferido por critérios operacionais (qualidade, prazo, confiabilidade). O status `isPreferred` é independente de ser o mais barato (`isCheapest`). Apenas 1 fornecedor ativo por produto pode ser preferido.

### RQ-005 — Validade e Expiração de Cotações
Cotações com data de validade (`validUntil`) no passado são marcadas como expiradas e não são computadas entre as ativas nem no cálculo de menor preço.

### RQ-006 — Conversão Rápida para Ordem de Compra
A partir de uma cotação ativa, o usuário pode acionar a criação direta de uma ordem de compra (`prepareForPurchase`), preenchendo automaticamente fornecedor, produto e custo unitário cotado.

---

## Regras de Analytics e Dashboard (FASE 8)

### RA-001 — Dados 100% Reais e Sem Mocks
Todos os indicadores analíticos são derivados estritamente das entidades persistidas (`sales`, `purchases`, `stockMovements`, `products`, `suppliers`). Não há números fictícios nem dados simulados.

### RA-002 — Faturamento e Lucro Histórico Baseado em Vendas Reais
- **Faturamento**: $\sum \text{Sale.totalSaleCents}$ das vendas ativas (`cancelledAt === null`) dentro do período selecionado.
- **Lucro Bruto**: $\sum \text{Sale.profitCents}$ das vendas ativas dentro do período.
- Preserva o snapshot imutável (`Sale.unitCostCents` e `Sale.profitCents`) gravado no instante de cada venda, sem recalcular retrospectivamente com custos atuais do catálogo.

### RA-003 — Custo das Mercadorias Vendidas (CMV)
- $\text{CMV} = \sum (\text{Sale.quantity} \times \text{Sale.unitCostCents})$ das vendas ativas do período.
- **Margem Bruta Geral**: $(\text{Lucro Bruto} / \text{Faturamento}) \times 100$. Quando Faturamento = 0, exibe `N/A` ou `Dados insuficientes` evitando divisão por zero.
- **Markup Geral**: $(\text{Lucro Bruto} / \text{CMV}) \times 100$. Quando CMV = 0, exibe `N/A`.

### RA-004 — Valorização do Estoque e Giro
- **Valor do Estoque (Custo)**: $\sum (\text{Product.stockQuantity} \times \text{Product.purchasePriceCents})$ (custo de referência atual).
- **Valor do Estoque (Venda)**: $\sum (\text{Product.stockQuantity} \times \text{Product.salePriceCents})$ (potencial de faturamento).
- **Giro de Estoque (Turnover)**: $\text{CMV do Período} / \text{Valor do Estoque a Custo}$. Mede quantas vezes o estoque foi renovado no período. Quando não há vendas ou estoque = 0, exibe `Dados insuficientes`.

### RA-005 — Curva ABC de Produtos (Pareto 80/15/5)
- Produtos ordenados por faturamento decrescente no período.
- **Classe A**: Até 80% do faturamento acumulado.
- **Classe B**: > 80% até 95% do faturamento acumulado.
- **Classe C**: > 95% do faturamento acumulado.
- Produtos com 0 vendas no período **nunca** são classificados em Classe A ou B.

### RA-006 — Curva ABC e Análise de Fornecedores
- Ordena fornecedores pelo volume financeiro real de ordens de compras (`Purchase.totalCostCents`) no período.
- Cotações (Fase 7) são diferenciadas de compras reais efetivamente concluídas (Fase 6/8).

### RA-007 — Velocidade de Venda e Produtos Parados
- **Velocidade Diária (Run Rate)**: $\text{Unidades Vendidas no Período} / \text{Dias do Período}$.
  - Rápida ($\ge 1.0$ un/dia), Normal ($\ge 0.2$ un/dia), Lenta ($< 0.2$ un/dia), Parada ($0$ vendas).
- **Cobertura Estimada**: $\text{Estoque Físico Atual} / \text{Velocidade Diária}$ (em dias).
- **Produtos Parados**: Produtos com saldo físico $> 0$ em estoque mas $0$ vendas no período. O capital imobilizado é calculado como $\text{Estoque} \times \text{Custo de Referência}$.

### RA-008 — Filtros de Período e Fuso Horário
- Períodos padronizados: `Hoje`, `7 dias`, `30 dias`, `90 dias`, `12 meses` e `Personalizado`.
- Consultas utilizam timestamp ISO UTC garantindo que os limites locais de início (00:00:00) e fim de dia (23:59:59.999) não percam registros.

---

## Regras de Backup, Restauração e Configurações (FASE 9)

### RB-001 — Envelope Completo e Checksum SHA-256
- O backup exporta todas as 10 stores ativas do banco no envelope padrão `gestaopro_backup` (versão 1.0).
- Contém `checksum` SHA-256 calculado sobre a serialização canônica determinística do payload `data`.
- O checksum atua como mecanismo de verificação de integridade e detecção de corrupção ou alteração acidental de arquivo (não substituindo criptografia com chave de segurança).

### RB-002 — Serialização e Reconstrução de Blobs de Imagens
- Fotos em alta resolução e thumbnails (`productImages`) são convertidos assincronamente para Data URLs Base64 na exportação, liberando ponteiros de memória.
- Na restauração, as strings Base64 são reconstruídas para instâncias nativas de `Blob` com os respectivos MIME types (`image/webp`, `image/jpeg`).

### RB-003 — Snapshot de Segurança Pré-Restauração e Rollback Atômico
- Antes de aplicar qualquer alteração ou limpeza no banco, o sistema captura automaticamente um snapshot de segurança do estado atual em memória.
- Em caso de qualquer falha ou inconsistência durante a gravação das stores, o rollback restaura o estado anterior preservando os dados intactos.

### RB-004 — Recalibração de Caches e Consistência Pós-Restauração
- Após a importação, o sistema não confia cegamente em valores cacheados. Executa o recálculo dos saldos físicos de estoque (`Product.stockQuantity`) a partir do histórico de `stockMovements` e de unidades vendidas (`Product.totalSold`) a partir de `sales` ativas.

### RB-005 — Limpeza Controlada de Dados de Teste
- Permite apagar registros comerciais (`sales`, `purchases`, `stockMovements`) mantendo o catálogo de produtos, fotos, fornecedores e configurações.
- Recalibra os saldos em estoque de todos os produtos para zero de forma consistente.

### RB-006 — Reset de Fábrica com Dupla Confirmação
- Apaga integralmente todas as stores e redefine as configurações para os valores de fábrica (`allowNegativeStock = false`).
- Exige digitação obrigatória da palavra `CONFIRMAR` no modal para evitar disparos acidentais.

---

## Regras Financeiras (FASE 3)



### RF-001 — Fórmula de Lucro
```
Lucro = Preço de Venda - Preço de Compra
```
Pode ser negativo (prejuízo).

### RF-002 — Fórmula de Margem
```
Margem (%) = (Lucro / Preço de Venda) × 100
```

### RF-003 — Fórmula de Markup
```
Markup (%) = (Lucro / Preço de Compra) × 100
```
