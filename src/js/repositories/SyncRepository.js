import { BaseRepository } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

/**
 * GestãoPro — Repositório da Fila de Sincronização (Outbox Pattern)
 * Persiste na store `syncQueue` todas as mutações locais para posterior sincronização assíncrona.
 */
export class SyncRepository extends BaseRepository {
  constructor() {
    super('syncQueue');
  }

  /**
   * Enfileira uma mutação para sincronização em nuvem com coalescência inteligente.
   * @param {Object} params { entityType, entityId, action, payload }
   * @returns {Promise<Object>} Item enfileirado
   */
  async enqueue({ entityType, entityId, action, payload }) {
    const all = await this.findAll();
    const now = new Date().toISOString();

    // Busca se já existe um item PENDENTE ou SYNCING para a mesma entidade
    const existingIndex = all.findIndex(
      item => item.entityType === entityType && item.entityId === entityId && item.status !== 'SYNCED'
    );

    if (existingIndex !== -1) {
      const existing = all[existingIndex];

      // Coalescência de Ações:
      if (existing.action === 'CREATE' && action === 'UPDATE') {
        // Se foi criado e agora editado antes do sync, mescla no CREATE original
        existing.payload = { ...existing.payload, ...payload };
        existing.updatedAt = now;
        await this.update(existing);
        return existing;
      }

      if (existing.action === 'CREATE' && action === 'DELETE') {
        // Se foi criado e deletado antes do sync, remove da fila (nunca existiu na nuvem!)
        await this.hardDelete(existing.id);
        return null;
      }

      // Atualiza com a nova ação e payload
      existing.action = action;
      existing.payload = payload;
      existing.status = 'PENDING';
      existing.updatedAt = now;
      await this.update(existing);
      return existing;
    }

    const newItem = {
      id: crypto.randomUUID(),
      entityType,
      entityId,
      action, // 'CREATE' | 'UPDATE' | 'DELETE'
      payload: payload || {},
      status: 'PENDING', // 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      syncedAt: null,
      createdAt: now,
      updatedAt: now
    };

    await this.create(newItem);
    return newItem;
  }

  /**
   * Retorna todas as mutações pendentes ordenadas cronologicamente.
   * @returns {Promise<Array<Object>>}
   */
  async getPending() {
    const all = await this.findAll();
    return all
      .filter(item => item.status === 'PENDING')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  /**
   * Retorna itens com falha definitiva de sincronização.
   * @returns {Promise<Array<Object>>}
   */
  async getFailed() {
    const all = await this.findAll();
    return all.filter(item => item.status === 'FAILED');
  }

  /**
   * Marca um item como sincronizado com sucesso.
   * @param {string} id 
   * @param {Object} [remoteMeta] 
   */
  async markSynced(id, remoteMeta = {}) {
    const item = await this.findById(id);
    if (!item) return;

    item.status = 'SYNCED';
    item.syncedAt = new Date().toISOString();
    item.remoteVersion = remoteMeta.remoteVersion || null;
    item.lastError = null;
    item.updatedAt = new Date().toISOString();
    await this.update(item);
  }

  /**
   * Registra uma falha de sincronização e incrementa contador de tentativas.
   * @param {string} id 
   * @param {string} errorMessage 
   * @param {number} [maxAttempts=5] 
   */
  async markFailed(id, errorMessage, maxAttempts = 5) {
    const item = await this.findById(id);
    if (!item) return;

    item.attempts = (item.attempts || 0) + 1;
    item.lastAttemptAt = new Date().toISOString();
    item.lastError = errorMessage;
    item.updatedAt = new Date().toISOString();

    if (item.attempts >= maxAttempts) {
      item.status = 'FAILED';
    } else {
      item.status = 'PENDING';
    }

    await this.update(item);
  }

  /**
   * Reseta todos os itens com falha para o estado pendente permitindo nova tentativa.
   */
  async retryFailed() {
    const failed = await this.getFailed();
    const now = new Date().toISOString();
    for (const item of failed) {
      item.status = 'PENDING';
      item.attempts = 0;
      item.lastError = null;
      item.updatedAt = now;
      await this.update(item);
    }
  }

  /**
   * Remove da fila todos os itens já sincronizados.
   */
  async clearCompleted() {
    const all = await this.findAll();
    const synced = all.filter(item => item.status === 'SYNCED');
    for (const item of synced) {
      await this.hardDelete(item.id);
    }
  }

  /**
   * Retorna estatísticas consolidadas da fila de sincronização.
   * @returns {Promise<{ total: number, pending: number, syncing: number, synced: number, failed: number }>}
   */
  async getStats() {
    const all = await this.findAll();
    return {
      total: all.length,
      pending: all.filter(i => i.status === 'PENDING').length,
      syncing: all.filter(i => i.status === 'SYNCING').length,
      synced: all.filter(i => i.status === 'SYNCED').length,
      failed: all.filter(i => i.status === 'FAILED').length
    };
  }
}

export const syncRepository = new SyncRepository();
