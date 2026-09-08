import { CloudProvider } from './CloudProvider.js';

/**
 * GestãoPro — Provedor em Nuvem Mock em Memória (FASE 13)
 * Utilizado para testes unitários automatizados, validação de integração e ambientes de desenvolvimento isolados.
 */
export class MockCloudProvider extends CloudProvider {
  constructor(options = {}) {
    super();
    this.name = options.name || 'MockCloudProvider';
    this.configured = options.configured !== undefined ? options.configured : true;
    this.remoteStore = new Map(); // entityType -> Map(id -> doc)
    this.pushedChanges = [];
    this.shouldFail = false;
    this.failureMessage = 'Falha simulada de comunicação em nuvem';
  }

  getProviderName() {
    return this.name;
  }

  isConfigured() {
    return this.configured;
  }

  setConfigured(val) {
    this.configured = !!val;
  }

  setShouldFail(val, msg = 'Falha simulada de comunicação em nuvem') {
    this.shouldFail = !!val;
    this.failureMessage = msg;
  }

  async testConnection() {
    if (!this.configured) {
      return { success: false, message: 'Provedor não configurado com credenciais válidas.' };
    }
    if (this.shouldFail) {
      return { success: false, message: this.failureMessage };
    }
    return { success: true, message: 'Conexão mock estabelecida com sucesso.', latencyMs: 15 };
  }

  async pushChange(changeItem) {
    if (!this.configured) {
      throw new Error('Provedor não configurado.');
    }
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    this.pushedChanges.push({ ...changeItem, pushedTimestamp: new Date().toISOString() });

    const { entityType, entityId, action, payload } = changeItem;
    if (!this.remoteStore.has(entityType)) {
      this.remoteStore.set(entityType, new Map());
    }
    const store = this.remoteStore.get(entityType);

    if (action === 'DELETE') {
      store.delete(entityId);
    } else {
      store.set(entityId, {
        ...payload,
        id: entityId,
        _remoteSyncedAt: new Date().toISOString()
      });
    }

    return {
      success: true,
      remoteId: entityId,
      remoteVersion: new Date().toISOString()
    };
  }

  async pullChanges(entityType, sinceTimestamp = null) {
    if (!this.configured) {
      throw new Error('Provedor não configurado.');
    }
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const store = this.remoteStore.get(entityType) || new Map();
    let items = Array.from(store.values());

    if (sinceTimestamp) {
      const sinceDate = new Date(sinceTimestamp);
      items = items.filter(doc => new Date(doc.updatedAt || doc.createdAt || 0) > sinceDate);
    }

    return {
      items,
      latestTimestamp: new Date().toISOString()
    };
  }

  getRemoteData(entityType) {
    const store = this.remoteStore.get(entityType);
    return store ? Array.from(store.values()) : [];
  }

  clear() {
    this.remoteStore.clear();
    this.pushedChanges = [];
  }
}
