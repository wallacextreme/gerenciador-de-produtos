import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'bun:test';
import { ProductService } from '../src/js/services/ProductService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { productImageRepository } from '../src/js/repositories/ProductImageRepository.js';
import { ProductValidator } from '../src/js/validators/ProductValidator.js';
import { MarginService } from '../src/js/domain/MarginService.js';
import { MoneyService } from '../src/js/domain/MoneyService.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('ProductValidator', () => {
  it('deve validar com sucesso produto válido', () => {
    const res = ProductValidator.validate({
      name: 'Mouse Gamer RGB',
      purchasePriceCents: 5000,
      salePriceCents: 12000,
      minimumStock: 5,
      maximumStock: 20
    });
    expect(res.isValid).toBeTrue();
    expect(Object.keys(res.errors).length).toBe(0);
  });

  it('deve falhar se nome for vazio ou curto', () => {
    const res1 = ProductValidator.validate({ name: '' });
    expect(res1.isValid).toBeFalse();
    expect(res1.errors.name).toBeDefined();

    const res2 = ProductValidator.validate({ name: 'A' });
    expect(res2.isValid).toBeFalse();
    expect(res2.errors.name).toBeDefined();
  });

  it('deve falhar se valores em centavos forem negativos ou não inteiros', () => {
    const res = ProductValidator.validate({
      name: 'Teste Valor',
      purchasePriceCents: -100,
      salePriceCents: 15.5
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.purchasePriceCents).toBeDefined();
    expect(res.errors.salePriceCents).toBeDefined();
  });

  it('deve falhar se estoque máximo for menor que estoque mínimo', () => {
    const res = ProductValidator.validate({
      name: 'Teste Estoque',
      minimumStock: 10,
      maximumStock: 5
    });
    expect(res.isValid).toBeFalse();
    expect(res.errors.maximumStock).toBeDefined();
  });
});

describe('ProductService & ProductRepository (Phase 3 Full)', () => {
  it('deve cadastrar produto completo com classificação e estoque', async () => {
    const id = await ProductService.createProduct({
      name: 'Monitor UltraWide 29',
      productCode: 'MON-29-LG',
      internalCode: 'INT-9988',
      barcode: '789123456001',
      category: 'Monitores',
      subcategory: 'UltraWide',
      brand: 'LG',
      description: 'Monitor IPS 75Hz com HDR10',
      notes: 'Fornecedor TechDist',
      purchasePriceCents: 90000,
      salePriceCents: 140000,
      minimumStock: 2,
      maximumStock: 15,
      isActive: true
    });

    const p = await productRepository.findById(id);
    expect(p).not.toBeNull();
    expect(p.name).toBe('Monitor UltraWide 29');
    expect(p.category).toBe('Monitores');
    expect(p.brand).toBe('LG');
    expect(p.purchasePriceCents).toBe(90000);
    expect(p.salePriceCents).toBe(140000);
    expect(p.minimumStock).toBe(2);
    expect(p.maximumStock).toBe(15);
  });

  it('deve impedir código interno e código de barras duplicados', async () => {
    await ProductService.createProduct({
      name: 'Produto Base Códigos',
      internalCode: 'INT-UNIQUE-1',
      barcode: 'EAN-UNIQUE-1'
    });

    // Código interno duplicado
    let threwInternal = false;
    try {
      await ProductService.createProduct({
        name: 'Produto Dup Internal',
        internalCode: 'INT-UNIQUE-1'
      });
    } catch (e) {
      threwInternal = true;
      expect(e.message.toLowerCase()).toContain('código interno');
    }
    expect(threwInternal).toBeTrue();

    // Código de barras duplicado
    let threwBarcode = false;
    try {
      await ProductService.createProduct({
        name: 'Produto Dup Barcode',
        barcode: 'EAN-UNIQUE-1'
      });
    } catch (e) {
      threwBarcode = true;
      expect(e.message.toLowerCase()).toContain('código de barras');
    }
    expect(threwBarcode).toBeTrue();
  });

  it('deve persistir produto com múltiplas imagens e definir primeira como primária', async () => {
    const fakeBlob1 = new Blob(['img1-data'], { type: 'image/webp' });
    const fakeThumb1 = new Blob(['thumb1-data'], { type: 'image/webp' });
    const fakeBlob2 = new Blob(['img2-data'], { type: 'image/webp' });
    const fakeThumb2 = new Blob(['thumb2-data'], { type: 'image/webp' });

    const id = await ProductService.createProduct({
      name: 'Produto Com Fotos',
      purchasePriceCents: 1000,
      salePriceCents: 2000
    }, [
      { blob: fakeBlob1, thumbnailBlob: fakeThumb1, width: 800, height: 600, mimeType: 'image/webp', sizeBytes: 100 },
      { blob: fakeBlob2, thumbnailBlob: fakeThumb2, width: 800, height: 600, mimeType: 'image/webp', sizeBytes: 100 }
    ]);

    const data = await ProductService.getProductWithImages(id);
    expect(data.images.length).toBe(2);
    const primaryImg = data.images.find(img => img.isPrimary);
    expect(primaryImg).toBeDefined();
    expect(primaryImg.isPrimary).toBeTrue();

    // Verificar getPrimaryImage no repositório
    const primary = await productImageRepository.getPrimaryImage(id);
    expect(primary).not.toBeNull();
    expect(primary.id).toBe(primaryImg.id);

    // Identificar a secundária
    const secondaryImg = data.images.find(img => !img.isPrimary);
    expect(secondaryImg).toBeDefined();

    // Alterar imagem primária
    await productImageRepository.setPrimary(id, secondaryImg.id);
    const updatedPrimary = await productImageRepository.getPrimaryImage(id);
    expect(updatedPrimary.id).toBe(secondaryImg.id);
  });

  it('deve atualizar produto adicionando novas imagens e removendo imagens antigas', async () => {
    const fakeBlob1 = new Blob(['img1'], { type: 'image/webp' });
    const fakeThumb1 = new Blob(['th1'], { type: 'image/webp' });

    const id = await ProductService.createProduct({
      name: 'Produto Multi Img Test'
    }, [
      { blob: fakeBlob1, thumbnailBlob: fakeThumb1, width: 400, height: 400, mimeType: 'image/webp', sizeBytes: 50 }
    ]);

    const before = await ProductService.getProductWithImages(id);
    const oldImgId = before.images[0].id;

    const fakeBlob2 = new Blob(['img2'], { type: 'image/webp' });
    const fakeThumb2 = new Blob(['th2'], { type: 'image/webp' });

    await ProductService.updateProduct(id, {
      name: 'Produto Multi Img Atualizado'
    }, [
      { blob: fakeBlob2, thumbnailBlob: fakeThumb2, width: 400, height: 400, mimeType: 'image/webp', sizeBytes: 60 }
    ], [oldImgId]);

    const after = await ProductService.getProductWithImages(id);
    expect(after.product.name).toBe('Produto Multi Img Atualizado');
    expect(after.images.length).toBe(1);
    expect(after.images[0].id).not.toBe(oldImgId);
  });

  it('deve filtrar produtos por categoria, marca, status e faixa de preço', async () => {
    await ProductService.createProduct({
      name: 'Headset Pro Gamer',
      category: 'Áudio',
      brand: 'HyperX',
      salePriceCents: 50000,
      isActive: true
    });

    await ProductService.createProduct({
      name: 'Caixa de Som Bluetooth',
      category: 'Áudio',
      brand: 'JBL',
      salePriceCents: 30000,
      isActive: false
    });

    await ProductService.createProduct({
      name: 'Cadeira Ergonômica',
      category: 'Móveis',
      brand: 'DT3',
      salePriceCents: 120000,
      isActive: true
    });

    // 1. Filtro por Categoria 'Áudio' (apenas ativos)
    const audioActive = await productRepository.list({ category: 'Áudio', status: 'active' });
    expect(audioActive.length).toBe(1);
    expect(audioActive[0].name).toBe('Headset Pro Gamer');

    // 2. Filtro por Categoria 'Áudio' (todos)
    const audioAll = await productRepository.list({ category: 'Áudio', status: 'all' });
    expect(audioAll.length).toBe(2);

    // 3. Filtro por Marca 'JBL' (inativos)
    const jbl = await productRepository.list({ brand: 'JBL', status: 'inactive' });
    expect(jbl.length).toBe(1);
    expect(jbl[0].name).toBe('Caixa de Som Bluetooth');

    // 4. Filtro por faixa de preço
    const priceFilter = await productRepository.list({ minPriceCents: 40000, maxPriceCents: 60000, status: 'all' });
    expect(priceFilter.length).toBe(1);
    expect(priceFilter[0].name).toBe('Headset Pro Gamer');

    // 5. Categorias e Marcas únicas
    const categories = await productRepository.getCategories();
    expect(categories).toContain('Áudio');
    expect(categories).toContain('Móveis');

    const brands = await productRepository.getBrands();
    expect(brands).toContain('HyperX');
    expect(brands).toContain('JBL');
    expect(brands).toContain('DT3');
  });

  it('deve emitir eventos de EventBus nas ações de create, update e delete', async () => {
    let capturedEvent = null;
    const unsub = eventBus.on(EVENTS.PRODUCT_UPDATED, (data) => {
      capturedEvent = data;
    });

    const id = await ProductService.createProduct({ name: 'Produto Evento Test' });
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.id).toBe(id);
    expect(capturedEvent.action).toBe('create');

    capturedEvent = null;
    await ProductService.updateProduct(id, { name: 'Produto Evento Renomeado' });
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.id).toBe(id);
    expect(capturedEvent.action).toBe('update');

    let deleteEvent = null;
    const unsubDel = eventBus.on(EVENTS.PRODUCT_DELETED, (data) => {
      deleteEvent = data;
    });

    await ProductService.deleteProduct(id);
    expect(deleteEvent).not.toBeNull();
    expect(deleteEvent.id).toBe(id);

    unsub();
    unsubDel();
  });
});
