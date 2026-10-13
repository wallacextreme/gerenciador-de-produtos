import { CloudProvider } from './CloudProvider.js';
import { arePayloadsEquivalent, computeCanonicalPayloadHash } from '../utils/operationIdentity.js';

/**
 * GestãoPro — Provedor em Nuvem Mock em Memória (FASE 13 & 14.12)
 * Utilizado para testes unitários automatizados, validação de integração e ambientes de desenvolvimento isolados.
 * Suporta o contrato atômico de criação e atualização condicional da Fase 14.12.
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

    const timestamp = new Date().toISOString();
    this.pushedChanges.push({ ...changeItem, pushedTimestamp: timestamp });

    const { entityType, entityId, action, payload } = changeItem;
    if (!this.remoteStore.has(entityType)) {
      this.remoteStore.set(entityType, new Map());
    }
    const store = this.remoteStore.get(entityType);
    const existing = store.get(entityId);

    if (action === 'DELETE') {
      if (existing) {
        if (existing.deletedAt) {
          return {
            success: true,
            alreadyApplied: true,
            remoteId: entityId,
            remoteVersion: existing._remoteSyncedAt || timestamp
          };
        }
        existing.deletedAt = timestamp;
        existing._remoteSyncedAt = timestamp;
        existing.version = (existing.version || 1) + 1;
        store.set(entityId, existing);
      } else {
        store.delete(entityId);
      }
    } else if (action === 'CREATE') {
      if (existing) {
        if (arePayloadsEquivalent(entityType, payload, existing)) {
          return {
            success: true,
            alreadyApplied: true,
            remoteId: entityId,
            remoteVersion: existing._remoteSyncedAt || timestamp
          };
        } else {
          const err = new Error(`Conflito de integridade: registro remoto "${entityId}" já existe no destino com dados divergentes.`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'payload_divergence_conflict';
          err.remoteRecord = existing;
          throw err;
        }
      }

      store.set(entityId, {
        ...payload,
        id: entityId,
        version: payload?.version !== undefined ? payload.version : 1,
        _remoteSyncedAt: timestamp
      });
    } else if (action === 'UPDATE') {
      if (!existing) {
        const err = new Error(`Registro "${entityId}" não encontrado no servidor para atualização.`);
        err.code = 'not_found';
        err.errorCategory = 'permanent';
        throw err;
      }

      if (arePayloadsEquivalent(entityType, payload, existing)) {
        return {
          success: true,
          alreadyApplied: true,
          remoteId: entityId,
          remoteVersion: existing._remoteSyncedAt || timestamp
        };
      }

      const expectedBase = payload?.baseVersion ?? payload?.expectedBaseVersion;
      if (expectedBase !== undefined && expectedBase !== null) {
        const currentVer = existing.version || 1;
        if (currentVer !== expectedBase) {
          const err = new Error(`Conflito de concorrência: registro "${entityId}" foi alterado concorrentemente (versão remota v${currentVer} difere da versão esperada).`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'version_conflict';
          err.remoteRecord = existing;
          throw err;
        }
      }

      if (payload?.basePayloadHash) {
        const currentHash = computeCanonicalPayloadHash(entityType, existing);
        if (currentHash !== payload.basePayloadHash) {
          const err = new Error(`Conflito de concorrência: registro "${entityId}" sofreu mutação concorrente por outro dispositivo.`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'payload_divergence_conflict';
          err.remoteRecord = existing;
          throw err;
        }
      }

      const nextVersion = (existing.version || 1) + 1;
      store.set(entityId, {
        ...existing,
        ...payload,
        id: entityId,
        version: nextVersion,
        _remoteSyncedAt: timestamp
      });
    } else {
      store.set(entityId, {
        ...payload,
        id: entityId,
        _remoteSyncedAt: timestamp
      });
    }

    return {
      success: true,
      remoteId: entityId,
      remoteVersion: timestamp
    };
  }

  async get(entityType, id) {
    if (!this.remoteStore.has(entityType)) return null;
    const store = this.remoteStore.get(entityType);
    return store.get(id) || null;
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
