import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDB, closeDB } from '../src/js/db/connection.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { executeTransaction } from '../src/js/db/transactions.js';

describe('IndexedDB Persistence Layer', () => {
  beforeEach(async () => {
    // IndexedDB state is preserved between tests in memory, so we could clear it,
    // but idb handles open DB well. We will use unique IDs to avoid conflicts.
  });

  afterEach(async () => {
    // Fechar conexão se precisar limpar o estado
  });

  it('deve inicializar o banco e aplicar schema (migrations)', async () => {
    const db = await getDB();
    expect(db.name).toBe('gestaopro_db');
    expect(db.version).toBe(1);
    expect(db.objectStoreNames.contains('products')).toBeTrue();
    expect(db.objectStoreNames.contains('stockMovements')).toBeTrue();
    expect(db.objectStoreNames.contains('sales')).toBeTrue();
  });

  it('deve realizar CRUD básico no ProductRepository', async () => {
    const productId = crypto.randomUUID();
    
    // Create
    const newProduct = await productRepository.create({
      id: productId,
      name: 'Produto Teste',
      productCode: 'PROD-001',
      stockQuantity: 10
    });
    expect(newProduct.createdAt).toBeDefined();

    // Read
    const fetched = await productRepository.findById(productId);
    expect(fetched.name).toBe('Produto Teste');
    
    fetched.name = 'Produto Editado';
    await new Promise(r => setTimeout(r, 2));
    await productRepository.update(fetched);
    const updated = await productRepository.findById(productId);
    expect(updated.name).toBe('Produto Editado');
    expect(updated.updatedAt).toBeDefined();
    
    // Soft Delete
    await productRepository.softDelete(productId);
    const deleted = await productRepository.findById(productId);
    expect(deleted.deletedAt).toBeDefined();
    
    const list = await productRepository.list();
    const foundInList = list.find(p => p.id === productId);
    expect(foundInList).toBeUndefined(); // Não deve aparecer na listagem
  });

  it('deve garantir atomicidade através de executeTransaction (Sucesso)', async () => {
    const productId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const movementId = crypto.randomUUID();

    // Cria o produto fora da transação de venda
    await productRepository.create({
      id: productId,
      name: 'Transação Sucesso',
      stockQuantity: 10
    });

    await executeTransaction(['sales', 'stockMovements', 'products'], 'readwrite', async (stores) => {
      // 1. Inserir venda
      await stores.sales.add({
        id: saleId,
        productId,
        quantity: 2,
        totalCents: 2000
      });

      // 2. Inserir movimentação
      await stores.stockMovements.add({
        id: movementId,
        productId,
        type: 'SALE',
        quantity: 2,
        date: new Date().toISOString()
      });

      // 3. Atualizar produto (cache)
      const product = await stores.products.get(productId);
      product.stockQuantity -= 2;
      await stores.products.put(product);
    });

    // Validar fora da transação
    const db = await getDB();
    const savedSale = await db.get('sales', saleId);
    expect(savedSale).toBeDefined();

    const savedProduct = await productRepository.findById(productId);
    expect(savedProduct.stockQuantity).toBe(8);
  });

  it('deve fazer ROLLBACK se ocorrer erro na transação (Falha)', async () => {
    const productId = crypto.randomUUID();
    const saleId = crypto.randomUUID();

    await productRepository.create({
      id: productId,
      name: 'Transação Erro',
      stockQuantity: 10
    });

    let transactionFailed = false;

    try {
      await executeTransaction(['sales', 'stockMovements', 'products'], 'readwrite', async (stores) => {
        // 1. Inserir venda validamente
        await stores.sales.add({
          id: saleId,
          productId,
          quantity: 5,
          totalCents: 5000
        });

        // 2. Forçar um erro de regra de negócio
        throw new Error('Estoque negativo não permitido!');
        
        // As próximas etapas nem executam
      });
    } catch (error) {
      transactionFailed = true;
    }

    expect(transactionFailed).toBeTrue();

    // A venda NÃO DEVE estar no banco, o rollback cancelou a inclusão!
    const db = await getDB();
    const failedSale = await db.get('sales', saleId);
    expect(failedSale).toBeUndefined();

    // Produto deve estar intacto
    const product = await productRepository.findById(productId);
    expect(product.stockQuantity).toBe(10);
  });
});
