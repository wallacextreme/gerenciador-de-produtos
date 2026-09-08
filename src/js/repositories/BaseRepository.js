import { getDB } from '../db/connection.js';

/**
 * Repositório Base contendo operações CRUD padronizadas.
 * Esconde completamente a implementação do idb/IndexedDB.
 */
export class BaseRepository {
  constructor(storeName) {
    this.storeName = storeName;
  }

  async getStore(mode = 'readonly') {
    const db = await getDB();
    const tx = db.transaction(this.storeName, mode);
    return { store: tx.objectStore(this.storeName), tx };
  }

  async create(data) {
    if (!data.id) throw new Error('[Repository] Criação falhou: ID é obrigatório.');
    
    data.createdAt = data.createdAt || new Date().toISOString();
    data.updatedAt = data.updatedAt || new Date().toISOString();
    
    const db = await getDB();
    await db.add(this.storeName, data);
    return data;
  }

  async update(data) {
    if (!data.id) throw new Error('[Repository] Atualização falhou: ID é obrigatório.');
    
    data.updatedAt = new Date().toISOString();
    
    const db = await getDB();
    await db.put(this.storeName, data);
    return data;
  }

  async findById(id) {
    const db = await getDB();
    return await db.get(this.storeName, id);
  }

  async findAll() {
    const db = await getDB();
    return await db.getAll(this.storeName);
  }

  async softDelete(id) {
    const record = await this.findById(id);
    if (record) {
      record.deletedAt = new Date().toISOString();
      await this.update(record);
      return true;
    }
    return false;
  }

  async hardDelete(id) {
    const db = await getDB();
    await db.delete(this.storeName, id);
    return true;
  }
}
