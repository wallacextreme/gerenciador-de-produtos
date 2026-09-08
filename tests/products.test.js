import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'bun:test';
import { ProductService } from '../src/js/services/ProductService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { getDB } from '../src/js/db/connection.js';

describe('ProductService', () => {
  it('deve criar um produto com nome válido', async () => {
    const id = await ProductService.createProduct({
      name: 'Produto Service Test',
      purchasePriceCents: 5000,
      salePriceCents: 10000
    });

    expect(id).toBeDefined();
    const product = await productRepository.findById(id);
    expect(product.name).toBe('Produto Service Test');
    expect(product.stockQuantity).toBe(0);
    expect(product.isActive).toBeTrue();
    expect(product.createdAt).toBeDefined();
  });

  it('deve bloquear criação sem nome', async () => {
    let threw = false;
    try {
      await ProductService.createProduct({ name: '' });
    } catch (e) {
      threw = true;
      expect(e.message).toContain('obrigatório');
    }
    expect(threw).toBeTrue();
  });

  it('deve bloquear código de produto duplicado', async () => {
    await ProductService.createProduct({
      name: 'Dup Test A',
      productCode: 'DUP-001'
    });

    let threw = false;
    try {
      await ProductService.createProduct({
        name: 'Dup Test B',
        productCode: 'DUP-001'
      });
    } catch (e) {
      threw = true;
      expect(e.message).toContain('já cadastrado');
    }
    expect(threw).toBeTrue();
  });

  it('deve fazer soft delete e remover da listagem', async () => {
    const id = await ProductService.createProduct({
      name: 'Soft Delete Test'
    });

    await ProductService.deleteProduct(id);

    const product = await productRepository.findById(id);
    expect(product.deletedAt).toBeDefined();

    const list = await productRepository.list();
    const found = list.find(p => p.id === id);
    expect(found).toBeUndefined();
  });

  it('deve atualizar produto existente', async () => {
    const id = await ProductService.createProduct({
      name: 'Update Test',
      purchasePriceCents: 1000
    });

    await ProductService.updateProduct(id, {
      name: 'Update Test Modified',
      purchasePriceCents: 2000,
      salePriceCents: 4000
    });

    const product = await productRepository.findById(id);
    expect(product.name).toBe('Update Test Modified');
    expect(product.purchasePriceCents).toBe(2000);
  });

  it('deve buscar produto com imagens', async () => {
    const id = await ProductService.createProduct({
      name: 'WithImages Test'
    });

    const result = await ProductService.getProductWithImages(id);
    expect(result).not.toBeNull();
    expect(result.product.name).toBe('WithImages Test');
    expect(result.images).toBeDefined();
    expect(result.images.length).toBe(0);
  });
});
