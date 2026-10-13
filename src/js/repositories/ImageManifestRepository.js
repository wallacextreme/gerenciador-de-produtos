import { BaseRepository, getCurrentTenant } from './BaseRepository.js';
import { getDB } from '../db/connection.js';
import { executeTransaction } from '../db/transactions.js';

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
    const targetTenant = data.tenantId || getCurrentTenant();
    const targetProductId = data.productId;

    return await executeTransaction([this.storeName], 'readwrite', async (stores) => {
      const store = stores[this.storeName];
      const raw = await store.get(photoId);
      if (raw) {
        if (raw.tenantId && targetTenant && raw.tenantId !== targetTenant) {
          throw new Error(`[ImageManifestRepository] Violação de isolamento multi-tenant: photoId "${photoId}" pertence ao tenant "${raw.tenantId}".`);
        }
        if (raw.productId && targetProductId && raw.productId !== targetProductId) {
          throw new Error(`[ImageManifestRepository] Conflito de integridade: photoId "${photoId}" já está associado ao produto "${raw.productId}".`);
        }
      }
      const entry = {
        ...data,
        photoId,
        id: photoId,
        tenantId: targetTenant || data.tenantId,
        version: typeof data.version === 'number' ? data.version : 1,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || Date.now()
      };
      await store.add(entry);
      return entry;
    });
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
    const targetTenant = data.tenantId || getCurrentTenant();
    const targetProductId = data.productId;

    return await executeTransaction([this.storeName], 'readwrite', async (stores) => {
      const store = stores[this.storeName];
      const raw = await store.get(photoId);
      if (!raw) {
        throw new Error(`[ImageManifestRepository] Registro "${photoId}" não encontrado para atualização.`);
      }
      if (raw.tenantId && targetTenant && raw.tenantId !== targetTenant) {
        throw new Error(`[ImageManifestRepository] Violação de isolamento multi-tenant: photoId "${photoId}" pertence ao tenant "${raw.tenantId}".`);
      }
      if (raw.productId && targetProductId && raw.productId !== targetProductId) {
        throw new Error(`[ImageManifestRepository] Conflito de integridade: photoId "${photoId}" já está associado ao produto "${raw.productId}".`);
      }
      const entry = {
        ...raw,
        ...data,
        photoId,
        id: photoId,
        tenantId: raw.tenantId || targetTenant,
        updatedAt: data.updatedAt || Date.now()
      };
      await store.put(entry);
      return entry;
    });
  }

  /**
   * Insere ou atualiza de forma idempotente com isolamento multi-tenant estrito.
   * Impede sobrescrita silenciosa de dados de outro tenant ou produto.
   * @param {Object} data 
   * @returns {Promise<Object>}
   */
  async upsert(data) {
    const photoId = data.photoId || data.id;
    if (!photoId) {
      throw new Error('[ImageManifestRepository] photoId é obrigatório para upsert.');
    }
    const targetTenant = data.tenantId || getCurrentTenant();
    const targetProductId = data.productId;

    return await executeTransaction([this.storeName], 'readwrite', async (stores) => {
      const store = stores[this.storeName];
      const raw = await store.get(photoId);

      if (raw) {
        // Validação estrita de isolamento multi-tenant
        if (raw.tenantId && targetTenant && raw.tenantId !== targetTenant) {
          throw new Error(`[ImageManifestRepository] Violação de isolamento multi-tenant: photoId "${photoId}" pertence ao tenant "${raw.tenantId}".`);
        }
        // Validação estrita de integridade de produto
        if (raw.productId && targetProductId && raw.productId !== targetProductId) {
          throw new Error(`[ImageManifestRepository] Conflito de integridade: photoId "${photoId}" já está associado ao produto "${raw.productId}".`);
        }
        const updatedEntry = {
          ...raw,
          ...data,
          photoId,
          id: photoId,
          tenantId: raw.tenantId || targetTenant,
          productId: raw.productId || targetProductId,
          version: typeof data.version === 'number' ? data.version : (raw.version || 1) + 1,
          createdAt: raw.createdAt || data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || Date.now()
        };
        await store.put(updatedEntry);
        return updatedEntry;
      }

      const newEntry = {
        ...data,
        photoId,
        id: photoId,
        tenantId: targetTenant || data.tenantId,
        version: typeof data.version === 'number' ? data.version : 1,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || Date.now()
      };
      await store.put(newEntry);
      return newEntry;
    });
  }

  /**
   * Localiza entrada pelo photoId estável.
   * @param {string} photoId 
   * @returns {Promise<Object|null>}
   */
  async findByPhotoId(photoId, options = {}) {
    if (!photoId) return null;
    const db = await getDB();
    const result = await db.get(this.storeName, photoId);
    if (!result) return null;
    const curTenant = options?.tenantId || getCurrentTenant();
    if (curTenant && result.tenantId !== curTenant) {
      return null;
    }
    return result;
  }

  /**
   * Alias de compatibilidade com BaseRepository.findById
   */
  async findById(id) {
    return this.findByPhotoId(id);
  }

  /**
   * Retorna todas as fotos registradas de um produto específico no escopo do tenant.
   * @param {string} productId 
   * @param {Object} [options] { tenantId }
   * @returns {Promise<Array>}
   */
  async findByProductId(productId, options = {}) {
    if (!productId) return [];
    const db = await getDB();
    const photos = await db.getAllFromIndex(this.storeName, 'productId', productId);
    const curTenant = options?.tenantId || getCurrentTenant();
    if (curTenant) {
      return photos.filter(p => p.tenantId === curTenant);
    }
    return photos;
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
   * Aplica validações estritas de isolamento multi-tenant e integridade por produto.
   * @param {Array<Object>} entries 
   * @returns {Promise<Array>}
   */
  async saveAll(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    return await executeTransaction([this.storeName], 'readwrite', async (stores) => {
      const store = stores[this.storeName];
      const results = [];
      const curTenant = getCurrentTenant();

      for (const data of entries) {
        const photoId = data.photoId || data.id;
        if (!photoId) continue;
        const targetTenant = data.tenantId || curTenant;
        const targetProductId = data.productId;

        const raw = await store.get(photoId);
        if (raw) {
          if (raw.tenantId && targetTenant && raw.tenantId !== targetTenant) {
            throw new Error(`[ImageManifestRepository] Violação de isolamento multi-tenant: photoId "${photoId}" pertence ao tenant "${raw.tenantId}".`);
          }
          if (raw.productId && targetProductId && raw.productId !== targetProductId) {
            throw new Error(`[ImageManifestRepository] Conflito de integridade: photoId "${photoId}" já está associado ao produto "${raw.productId}".`);
          }
        }

        const entry = {
          ...(raw || {}),
          ...data,
          photoId,
          id: photoId,
          tenantId: (raw && raw.tenantId) || targetTenant,
          productId: (raw && raw.productId) || targetProductId,
          updatedAt: data.updatedAt || Date.now()
        };
        await store.put(entry);
        results.push(entry);
      }
      return results;
    });
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
