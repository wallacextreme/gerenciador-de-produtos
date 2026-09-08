import { productRepository } from '../repositories/ProductRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { executeTransaction } from '../db/transactions.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { ProductValidator } from '../validators/ProductValidator.js';

export class ProductService {
  /**
   * Cria um produto com validações de domínio e opcionalmente associa imagens já processadas.
   * @param {Object} productData 
   * @param {Array} imagesData 
   * @returns {Promise<string>} ID do produto criado
   */
  static async createProduct(productData, imagesData = []) {
    // 1. Validação de Domínio
    ProductValidator.assertValid(productData);

    // 2. Checagem de duplicações de códigos únicos
    if (productData.productCode && productData.productCode.trim()) {
      const exists = await productRepository.findByProductCode(productData.productCode.trim());
      if (exists && !exists.deletedAt) throw new Error('Código do produto já cadastrado.');
    }

    if (productData.internalCode && productData.internalCode.trim()) {
      const exists = await productRepository.findByInternalCode(productData.internalCode.trim());
      if (exists && !exists.deletedAt) throw new Error('Código interno já cadastrado.');
    }

    if (productData.barcode && productData.barcode.trim()) {
      const exists = await productRepository.findByBarcode(productData.barcode.trim());
      if (exists && !exists.deletedAt) throw new Error('Código de barras já cadastrado.');
    }

    const productId = crypto.randomUUID();
    const newProduct = {
      name: productData.name.trim(),
      productCode: productData.productCode ? productData.productCode.trim() : '',
      internalCode: productData.internalCode ? productData.internalCode.trim() : '',
      barcode: productData.barcode ? productData.barcode.trim() : '',
      description: productData.description ? productData.description.trim() : '',
      category: productData.category ? productData.category.trim() : '',
      categoryId: productData.categoryId || '',
      subcategory: productData.subcategory ? productData.subcategory.trim() : '',
      subcategoryId: productData.subcategoryId || '',
      brand: productData.brand ? productData.brand.trim() : '',
      purchasePriceCents: productData.purchasePriceCents ?? 0,
      salePriceCents: productData.salePriceCents ?? 0,
      minimumStock: productData.minimumStock ?? 0,
      maximumStock: productData.maximumStock ?? 0,
      notes: productData.notes ? productData.notes.trim() : '',
      stockQuantity: 0, // Campo de exibição na Fase 3
      isActive: productData.isActive !== false,
      id: productId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Imagens recebem ID do produto e UUID próprio
    const newImages = imagesData.map((img, index) => ({
      id: crypto.randomUUID(),
      productId,
      blob: img.blob,
      thumbnailBlob: img.thumbnailBlob,
      width: img.width,
      height: img.height,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes,
      isPrimary: index === 0, // A primeira imagem enviada torna-se primária
      createdAt: new Date().toISOString()
    }));

    // Transação Atômica
    await executeTransaction(['products', 'productImages'], 'readwrite', async (stores) => {
      await stores.products.add(newProduct);
      for (const img of newImages) {
        await stores.productImages.add(img);
      }
    });

    // Dispara Evento via EventBus / BroadcastChannel
    eventBus.emit(EVENTS.PRODUCT_UPDATED, { id: productId, action: 'create' });
    return productId;
  }

  /**
   * Atualiza um produto existente, adiciona novas imagens e remove as excluídas.
   */
  static async updateProduct(id, productData, newImagesData = [], imagesToDeleteIds = []) {
    ProductValidator.assertValid(productData);

    const existingProduct = await productRepository.findById(id);
    if (!existingProduct || existingProduct.deletedAt) {
      throw new Error('Produto não encontrado.');
    }

    // Checagem de duplicações de códigos ignorando o próprio ID
    if (productData.productCode && productData.productCode.trim() !== existingProduct.productCode) {
      const exists = await productRepository.findByProductCode(productData.productCode.trim());
      if (exists && exists.id !== id && !exists.deletedAt) {
        throw new Error(`O código de produto "${productData.productCode}" já está em uso.`);
      }
    }

    if (productData.internalCode && productData.internalCode.trim() !== existingProduct.internalCode) {
      const exists = await productRepository.findByInternalCode(productData.internalCode.trim());
      if (exists && exists.id !== id && !exists.deletedAt) {
        throw new Error(`O código interno "${productData.internalCode}" já está em uso.`);
      }
    }

    if (productData.barcode && productData.barcode.trim() !== existingProduct.barcode) {
      const exists = await productRepository.findByBarcode(productData.barcode.trim());
      if (exists && exists.id !== id && !exists.deletedAt) {
        throw new Error(`O código de barras "${productData.barcode}" já está em uso.`);
      }
    }

    const updatedProduct = {
      ...existingProduct,
      name: productData.name.trim(),
      productCode: productData.productCode ? productData.productCode.trim() : '',
      internalCode: productData.internalCode ? productData.internalCode.trim() : '',
      barcode: productData.barcode ? productData.barcode.trim() : '',
      description: productData.description !== undefined ? productData.description.trim() : existingProduct.description,
      category: productData.category !== undefined ? productData.category.trim() : existingProduct.category,
      categoryId: productData.categoryId !== undefined ? productData.categoryId : existingProduct.categoryId,
      subcategory: productData.subcategory !== undefined ? productData.subcategory.trim() : existingProduct.subcategory,
      subcategoryId: productData.subcategoryId !== undefined ? productData.subcategoryId : existingProduct.subcategoryId,
      brand: productData.brand !== undefined ? productData.brand.trim() : existingProduct.brand,
      purchasePriceCents: productData.purchasePriceCents !== undefined ? productData.purchasePriceCents : existingProduct.purchasePriceCents,
      salePriceCents: productData.salePriceCents !== undefined ? productData.salePriceCents : existingProduct.salePriceCents,
      minimumStock: productData.minimumStock !== undefined ? productData.minimumStock : existingProduct.minimumStock,
      maximumStock: productData.maximumStock !== undefined ? productData.maximumStock : existingProduct.maximumStock,
      notes: productData.notes !== undefined ? productData.notes.trim() : existingProduct.notes,
      isActive: productData.isActive !== undefined ? productData.isActive : existingProduct.isActive,
      id, // Imutabilidade do ID
      updatedAt: new Date().toISOString()
    };

    const currentImages = await productImageRepository.findByProductId(id);
    const remainingImages = currentImages.filter(img => !imagesToDeleteIds.includes(img.id));
    const hasRemainingPrimary = remainingImages.some(img => img.isPrimary);

    const newImages = newImagesData.map((img, index) => ({
      id: crypto.randomUUID(),
      productId: id,
      blob: img.blob,
      thumbnailBlob: img.thumbnailBlob,
      width: img.width,
      height: img.height,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes,
      isPrimary: !hasRemainingPrimary && index === 0, // Se não houver primária restante, a primeira nova vira primária
      createdAt: new Date().toISOString()
    }));

    await executeTransaction(['products', 'productImages'], 'readwrite', async (stores) => {
      await stores.products.put(updatedProduct);

      // Deletar imagens marcadas
      for (const imgId of imagesToDeleteIds) {
        await stores.productImages.delete(imgId);
      }

      // Adicionar novas imagens
      for (const img of newImages) {
        await stores.productImages.add(img);
      }

      // Se todas as imagens anteriores foram deletadas e novas foram adicionadas, ou se nenhuma ficou primária
      if (!hasRemainingPrimary && remainingImages.length > 0 && newImages.length === 0) {
        // Tornar a primeira remanescente como primária
        remainingImages[0].isPrimary = true;
        await stores.productImages.put(remainingImages[0]);
      }
    });

    eventBus.emit(EVENTS.PRODUCT_UPDATED, { id, action: 'update' });
    return id;
  }

  /**
   * Realiza Soft Delete no produto.
   */
  static async deleteProduct(id) {
    const success = await productRepository.softDelete(id);
    if (success) {
      eventBus.emit(EVENTS.PRODUCT_DELETED, { id });
    }
    return success;
  }

  /**
   * Obtém produto e suas imagens associadas.
   */
  static async getProductWithImages(id) {
    const product = await productRepository.findById(id);
    if (!product || product.deletedAt) return null;

    const images = await productImageRepository.findByProductId(id);
    return { product, images };
  }
}
