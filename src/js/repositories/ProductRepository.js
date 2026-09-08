import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class ProductRepository extends BaseRepository {
  constructor() {
    super('products');
  }

  async findByProductCode(code) {
    if (!code) return null;
    const db = await getDB();
    return await db.getFromIndex(this.storeName, 'productCode', code);
  }

  async findByInternalCode(code) {
    if (!code) return null;
    const db = await getDB();
    return await db.getFromIndex(this.storeName, 'internalCode', code);
  }

  async findByBarcode(barcode) {
    if (!barcode) return null;
    const db = await getDB();
    return await db.getFromIndex(this.storeName, 'barcode', barcode);
  }

  /**
   * Lista produtos com suporte a busca textual e múltiplos filtros.
   * Filtra sempre produtos soft-deleted (deletedAt).
   * @param {Object} options
   * @param {string} [options.query]
   * @param {string} [options.category]
   * @param {string} [options.brand]
   * @param {boolean|string} [options.status] 'all', 'active', 'inactive'
   * @param {number} [options.minPriceCents]
   * @param {number} [options.maxPriceCents]
   * @param {number} [options.minMargin]
   * @returns {Promise<Array>}
   */
  async list(options = {}) {
    const all = await this.findAll();
    const {
      query = '',
      category = '',
      brand = '',
      status = 'active',
      minPriceCents,
      maxPriceCents
    } = options;

    const q = query.trim().toLowerCase();

    return all.filter(p => {
      // 1. Ignorar soft deleted
      if (p.deletedAt) return false;

      // 2. Filtro de Status
      if (status === 'active' && p.isActive === false) return false;
      if (status === 'inactive' && p.isActive !== false) return false;

      // 3. Filtro textual (nome, sku, codigo interno, barras, marca, categoria)
      if (q) {
        const matchesName = p.name && p.name.toLowerCase().includes(q);
        const matchesCode = p.productCode && p.productCode.toLowerCase().includes(q);
        const matchesInternal = p.internalCode && p.internalCode.toLowerCase().includes(q);
        const matchesBarcode = p.barcode && p.barcode.toLowerCase().includes(q);
        const matchesBrand = p.brand && p.brand.toLowerCase().includes(q);
        const matchesCategory = p.category && p.category.toLowerCase().includes(q);

        if (!matchesName && !matchesCode && !matchesInternal && !matchesBarcode && !matchesBrand && !matchesCategory) {
          return false;
        }
      }

      // 4. Filtro por Categoria
      if (category && p.category !== category && p.categoryId !== category) {
        return false;
      }

      // 5. Filtro por Marca
      if (brand && p.brand !== brand) {
        return false;
      }

      // 6. Filtro por Faixa de Preço
      if (minPriceCents !== undefined && minPriceCents !== null && minPriceCents > 0) {
        if ((p.salePriceCents || 0) < minPriceCents) return false;
      }
      if (maxPriceCents !== undefined && maxPriceCents !== null && maxPriceCents > 0) {
        if ((p.salePriceCents || 0) > maxPriceCents) return false;
      }

      return true;
    });
  }

  /**
   * Retorna lista única de categorias existentes.
   */
  async getCategories() {
    const products = await this.list({ status: 'all' });
    const set = new Set();
    products.forEach(p => {
      if (p.category && p.category.trim()) set.add(p.category.trim());
    });
    return Array.from(set).sort();
  }

  /**
   * Retorna lista única de marcas existentes.
   */
  async getBrands() {
    const products = await this.list({ status: 'all' });
    const set = new Set();
    products.forEach(p => {
      if (p.brand && p.brand.trim()) set.add(p.brand.trim());
    });
    return Array.from(set).sort();
  }
}

export const productRepository = new ProductRepository();
