import { executeTransaction } from '../db/transactions.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { deParaRepository } from '../repositories/DeParaRepository.js';
import { nfeImportRepository } from '../repositories/NFeImportRepository.js';
import { assertPermission } from '../utils/authGuard.js';
import { getCurrentTenant } from '../repositories/BaseRepository.js';
import { authService } from './AuthService.js';

export class NFeTransactionService {
  /**
   * Processa a entrada definitiva da NFe no estoque.
   * Valida se está 'PRONTA', executa transaction para salvar compras, movimentos de estoque e atualizar produtos.
   * Marca a NFe na staging como 'PROCESSADA'.
   * @param {string} idStaging 
   */
  static async processFinalEntry(idStaging) {
    assertPermission('create', 'purchases');
    const record = await nfeImportRepository.findById(idStaging);
    if (!record) throw new Error('NFe não encontrada na Staging Area.');
    
    if (record.status !== 'PRONTA') {
      throw new Error(`A NFe não está PRONTA para processamento. Status atual: ${record.status}`);
    }

    const nfe = record.dadosNormalizados;
    const itemsProcessed = [];
    const productIdToStockDelta = new Map(); // Para disparar eventos depois
    const resolvedTenant = record.tenantId || getCurrentTenant() || authService.getTenantId() || null;

    await executeTransaction(['purchases', 'stockMovements', 'products', 'nfe_imports', 'de_para_produtos'], 'readwrite', async (stores) => {
      const nowIso = new Date().toISOString();

      // 1. Validar Fornecedor
      const supplierId = nfe.emitente.fornecedorId;
      if (!supplierId) {
        throw new Error('Fornecedor não está vinculado (fornecedorId ausente). É obrigatório ter o fornecedor cadastrado.');
      }
      const supplierName = nfe.emitente.razaoSocial || nfe.emitente.nomeFantasia;

      // 2. Iterar itens e registrar Purchases + StockMovements
      for (const item of nfe.itens) {
        if (item.statusDePara !== 'VINCULADO' || !item.idProdutoInterno) {
          throw new Error(`Item ${item.codigoFornecedor} - ${item.descricao} não possui vínculo De-Para finalizado.`);
        }

        const product = await stores.products.get(item.idProdutoInterno);
        if (!product || product.deletedAt) {
          throw new Error(`Produto interno vinculado (ID: ${item.idProdutoInterno}) não encontrado ou inativo.`);
        }

        const itemTenant = product.tenantId || resolvedTenant;
        const quantityXML = item.quantidade;
        const fator = item.fatorConversao || 1;
        const quantidadeConvertida = quantityXML * fator;
        
        // Em um ERP real o unitCostCents deve ser o valor total do item / quantidade convertida
        // Para manter o valor exato no total, convertemos valorTotal para centavos.
        const totalCostCents = Math.round((item.valorTotal || 0) * 100);
        const unitCostCents = quantidadeConvertida > 0 ? Math.round(totalCostCents / quantidadeConvertida) : 0;

        const previousStock = product.stockQuantity || 0;
        const newStock = previousStock + quantidadeConvertida;
        
        const purchaseId = crypto.randomUUID();
        const movementId = crypto.randomUUID();

        // Salvar Purchase (cada item como uma linha de compra para adequar à arquitetura existente)
        const purchaseRecord = {
          id: purchaseId,
          ...(itemTenant ? { tenantId: itemTenant } : {}),
          supplierId: supplierId,
          supplierName: supplierName,
          productId: product.id,
          productName: product.name,
          productCode: product.productCode || '',
          quantity: quantidadeConvertida,
          unitCostCents: unitCostCents,
          totalCostCents: totalCostCents,
          invoiceNumber: nfe.cabecalho.numero,
          invoiceKey: nfe.cabecalho.chaveAcesso, // NOVO CAMPO: Para evitar duplicação em compras independentes da staging
          paymentMethod: 'NFE_IMPORT',
          notes: `Importado via NFe ${nfe.cabecalho.numero} - Série ${nfe.cabecalho.serie}`,
          stockMovementId: movementId,
          cancelledAt: null,
          cancelReason: null,
          date: nfe.cabecalho.dataEmissao || nowIso,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        await stores.purchases.add(purchaseRecord);

        // Salvar StockMovement
        const movementRecord = {
          id: movementId,
          ...(itemTenant ? { tenantId: itemTenant } : {}),
          productId: product.id,
          type: 'PURCHASE',
          quantity: quantidadeConvertida,
          delta: quantidadeConvertida,
          unitCostCents: unitCostCents,
          reason: `Entrada via XML NFe #${nfe.cabecalho.numero}`,
          notes: `Chave: ${nfe.cabecalho.chaveAcesso}`,
          referenceId: purchaseId,
          referenceType: 'PURCHASE',
          previousStock: previousStock,
          resultingStock: newStock,
          date: nfe.cabecalho.dataEmissao || nowIso,
          createdAt: nowIso
        };
        await stores.stockMovements.add(movementRecord);

        // Atualizar Produto
        product.stockQuantity = newStock;
        // Atualizamos o preço de custo opcionalmente? No fluxo manual há checkbox, aqui vamos padronizar
        // como opcionalmente atualizado pelo usuário na tela de De-Para (no momento, simplificamos e atualizamos se for maior que 0)
        if (unitCostCents > 0) {
          product.purchasePriceCents = unitCostCents;
        }
        product.updatedAt = nowIso;
        await stores.products.put(product);

        // Rastreamento para eventos
        itemsProcessed.push({ productId: product.id, delta: quantidadeConvertida, newStock });
        
        const existingDelta = productIdToStockDelta.get(product.id) || { delta: 0, newStock: 0 };
        productIdToStockDelta.set(product.id, {
          delta: existingDelta.delta + quantidadeConvertida,
          newStock: newStock
        });
      }

      // 3. Atualizar status na Staging Area
      record.status = 'PROCESSADA';
      record.updatedAt = nowIso;
      await stores.nfe_imports.put(record);
    });

    // 4. Emitir eventos FORA da transação, se houver sucesso
    eventBus.emit('PURCHASE_CREATED', { source: 'nfe_import', count: itemsProcessed.length });
    
    for (const [productId, info] of productIdToStockDelta.entries()) {
      eventBus.emit(EVENTS.STOCK_CHANGED, {
        productId,
        newStock: info.newStock,
        delta: info.delta,
        type: 'PURCHASE'
      });
      eventBus.emit(EVENTS.PRODUCT_UPDATED, {
        id: productId,
        action: 'purchase_nfe'
      });
    }

    return record;
  }
}
