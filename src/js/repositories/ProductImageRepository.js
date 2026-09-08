import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class ProductImageRepository extends BaseRepository {
  constructor() {
    super('productImages');
  }

  async findByProductId(productId) {
    const db = await getDB();
    const images = await db.getAllFromIndex(this.storeName, 'productId', productId);
    return images.filter(img => !img.deletedAt);
  }

  async getPrimaryImage(productId) {
    const images = await this.findByProductId(productId);
    // Retorna a primária, ou a primeira se não houver primária definida
    if (images.length === 0) return null;
    const primary = images.find(img => img.isPrimary);
    return primary || images[0];
  }

  async setPrimary(productId, imageId) {
    const images = await this.findByProductId(productId);
    for (const img of images) {
      if (img.id === imageId && !img.isPrimary) {
        img.isPrimary = true;
        await this.update(img);
      } else if (img.id !== imageId && img.isPrimary) {
        img.isPrimary = false;
        await this.update(img);
      }
    }
  }
}

export const productImageRepository = new ProductImageRepository();
