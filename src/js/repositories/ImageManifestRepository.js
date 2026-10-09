import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

/**
 * Repositório Local para a store `imageManifest` no IndexedDB (PHASE 05).
 * Armazena metadados estruturados de imagens conhecidas localmente,
 * permitindo reconciliação incremental, rastreamento de versões,
 * detecção de deltas e isolamento multi-tenant.
 */
export class ImageManifestRepository extends BaseRepository {
  constructor() {
    super('imageManifest');
  }

  /**
   * Cria uma nova entrada no manifesto local.
   * Garante coerência entre `photoId` e `id` (chave primária da store).
   * @param {Object} data 
   * @returns {Promise<Object>}
   */
  async create(data) {
    if (!data.photoId && !data.id) {
      throw new Error('[ImageManifestRepository] photoId é obrigatório para criação.');
    }
    const photoId = data.photoId || data.id;
    const entry = {
      ...data,
      photoId,
      id: photoId,
      version: typeof data.version === 'number' ? data.version : 1,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || Date.now()
    };
    const db = await getDB();
    await db.add(this.storeName, entry);
    return entry;
  }

  /**
   * Atualiza uma entrada existente no manifesto local.
   * @param {Object} data 
   * @returns {Promise<Object>}
   */
  async update(data) {
    const photoId = data.photoId || data.id;
    if (!photoId) {
      throw new Error('[ImageManifestRepository] photoId é obrigatório para atualização.');
    }
    const entry = {
      ...data,
      photoId,
      id: photoId,
      updatedAt: data.updatedAt || Date.now()
    };
    const db = await getDB();
    await db.put(this.storeName, entry);
    return entry;
  }

  /**
   * Insere ou atualiza de forma idempotente.
   * @param {Object} data 
   * @returns {Promise<Object>}
   */
  async upsert(data) {
    const photoId = data.photoId || data.id;
    if (!photoId) {
      throw new Error('[ImageManifestRepository] photoId é obrigatório para upsert.');
    }
    const existing = await this.findByPhotoId(photoId);
    if (existing) {
      return this.update({ ...existing, ...data, photoId, id: photoId });
    } else {
      return this.create(data);
    }
  }

  /**
   * Localiza entrada pelo photoId estável.
   * @param {string} photoId 
   * @returns {Promise<Object|null>}
   */
  async findByPhotoId(photoId) {
    if (!photoId) return null;
    const db = await getDB();
    const result = await db.get(this.storeName, photoId);
    return result || null;
  }

  /**
   * Alias de compatibilidade com BaseRepository.findById
   */
  async findById(id) {
    return this.findByPhotoId(id);
  }

  /**
   * Retorna todas as fotos registradas de um produto específico.
   * @param {string} productId 
   * @returns {Promise<Array>}
   */
  async findByProductId(productId) {
    if (!productId) return [];
    const db = await getDB();
    return db.getAllFromIndex(this.storeName, 'productId', productId);
  }

  /**
   * Retorna todas as fotos pertencentes a um tenant específico.
   * @param {string} tenantId 
   * @returns {Promise<Array>}
   */
  async findByTenantId(tenantId) {
    if (!tenantId) return [];
    const db = await getDB();
    return db.getAllFromIndex(this.storeName, 'tenantId', tenantId);
  }

  /**
   * Retorna deltas para um tenant a partir de um timestamp de corte.
   * @param {string} tenantId 
   * @param {number} sinceTimestamp 
   * @returns {Promise<Array>}
   */
  async findDelta(tenantId, sinceTimestamp = 0) {
    const all = await this.findByTenantId(tenantId);
    if (!sinceTimestamp || sinceTimestamp <= 0) return all;
    return all.filter(item => {
      const updated = typeof item.updatedAt === 'number' ? item.updatedAt : new Date(item.updatedAt).getTime();
      return updated > sinceTimestamp;
    });
  }

  /**
   * Salva múltiplas entradas em lote dentro de uma única transação atômica.
   * @param {Array<Object>} entries 
   * @returns {Promise<Array>}
   */
  async saveAll(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const db = await getDB();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    const results = [];

    for (const data of entries) {
      const photoId = data.photoId || data.id;
      if (!photoId) continue;
      const entry = {
        ...data,
        photoId,
        id: photoId,
        updatedAt: data.updatedAt || Date.now()
      };
      await store.put(entry);
      results.push(entry);
    }

    await tx.done;
    return results;
  }

  /**
   * Remove fisicamente uma entrada do manifesto local.
   * @param {string} photoId 
   * @returns {Promise<boolean>}
   */
  async deleteByPhotoId(photoId) {
    if (!photoId) return false;
    const db = await getDB();
    await db.delete(this.storeName, photoId);
    return true;
  }

  /**
   * Marca exclusão lógica (soft delete) no manifesto local.
   * @param {string} photoId 
   * @returns {Promise<Object|null>}
   */
  async markDeleted(photoId) {
    const existing = await this.findByPhotoId(photoId);
    if (!existing) return null;
    existing.deletedAt = Date.now();
    existing.updatedAt = Date.now();
    return this.update(existing);
  }
}

export const imageManifestRepository = new ImageManifestRepository();
