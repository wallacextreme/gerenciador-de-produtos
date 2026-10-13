import { CloudProvider } from './CloudProvider.js';
import { arePayloadsEquivalent, computeCanonicalPayloadHash } from '../utils/operationIdentity.js';

/**
 * GestãoPro — Provedor Mock do Firebase Realtime Database em Memória (PHASE 03)
 * Simula com precisão o comportamento do Firebase Realtime Database:
 * - Árvore multi-tenant (/tenants/{tenantId}/...)
 * - Listeners de tempo real (onValue, child listeners)
 * - Anti-loop (sourceDeviceId, mutationId, version)
 * - Simulação de concorrência, perda de conexão (.info/connected) e regras de permissão
 */
export class MockRealtimeProvider extends CloudProvider {
  constructor(options = {}) {
    super();
    this.name = options.name || 'MockRealtimeProvider';
    this.configured = options.configured !== undefined ? options.configured : true;
    this.tenantId = options.tenantId || 'tenant_matriz_01';
    this.deviceId = options.deviceId || 'device_mock_01';
    this.connected = options.connected !== undefined ? options.connected : true;

    // Simulação de banco em árvore: tenantId -> entityType -> Map(id -> doc)
    this.database = new Map();
    this.pushedChanges = [];
    this.processedMutations = new Set();

    // Listeners registrados: path -> Set(callback)
    this.listeners = new Map();
    this.connectionListeners = new Set();

    // Simulações de falha
    this.shouldFail = false;
    this.failureMessage = 'Falha simulada do Realtime Database';
    this.failureCode = 'UNKNOWN_ERROR';
    this.latencyMs = options.latencyMs || 5;

    // Inicializa store do tenant padrão
    this._ensureTenantStore(this.tenantId);
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

  getTenantId() {
    return this.tenantId;
  }

  setTenantId(tenantId) {
    this.tenantId = tenantId;
    this._ensureTenantStore(tenantId);
  }

  getDeviceId() {
    return this.deviceId;
  }

  setDeviceId(deviceId) {
    this.deviceId = deviceId;
  }

  isConnected() {
    return this.connected;
  }

  setConnected(val) {
    this.connected = !!val;
    for (const cb of this.connectionListeners) {
      try { cb(this.connected); } catch (_) {}
    }
  }

  onConnectionChange(callback) {
    if (typeof callback !== 'function') throw new Error('Callback deve ser uma função.');
    this.connectionListeners.add(callback);
    try { callback(this.connected); } catch (_) {}
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  setShouldFail(val, msg = 'Falha simulada do Realtime Database', code = 'UNKNOWN_ERROR') {
    this.shouldFail = !!val;
    this.failureMessage = msg;
    this.failureCode = code;
  }

  _ensureTenantStore(tenantId) {
    if (!this.database.has(tenantId)) {
      this.database.set(tenantId, new Map());
    }
  }

  _getStore(entityType, tenantId = this.tenantId) {
    this._ensureTenantStore(tenantId);
    const tenantData = this.database.get(tenantId);
    if (!tenantData.has(entityType)) {
      tenantData.set(entityType, new Map());
    }
    return tenantData.get(entityType);
  }

  async testConnection() {
    if (!this.configured) {
      return { success: false, message: 'Provedor não configurado com credenciais válidas.' };
    }
    if (!this.connected) {
      return { success: false, message: 'Sem conexão com o Realtime Database.' };
    }
    if (this.shouldFail) {
      return { success: false, message: this.failureMessage };
    }
    return { success: true, message: 'Conexão Realtime Database ativa.', latencyMs: this.latencyMs };
  }

  /**
   * Envia alteração local da Outbox para o RTDB.
   * Adiciona metadados de sync (sourceDeviceId, lastMutationId, timestamps).
   */
  async pushChange(changeItem) {
    if (!this.configured) throw new Error('Provedor não configurado.');
    if (!this.connected) throw new Error('Sem conexão com o Realtime Database.');
    if (this.shouldFail) {
      const err = new Error(this.failureMessage);
      err.code = this.failureCode;
      throw err;
    }

    const { entityType, entityId, action, payload } = changeItem;
    const store = this._getStore(entityType);
    const mutationId = changeItem.id || `mut_${Date.now()}`;
    const timestamp = new Date().toISOString();

    this.processedMutations.add(mutationId);
    this.pushedChanges.push({ ...changeItem, pushedTimestamp: timestamp });

    if (action === 'DELETE') {
      const existing = store.get(entityId);
      if (existing) {
        if (existing.deletedAt) {
          return {
            success: true,
            alreadyApplied: true,
            remoteId: entityId,
            remoteVersion: existing.updatedAt || timestamp
          };
        }
        const currentVer = existing.version || 1;
        existing.deletedAt = timestamp;
        existing.updatedAt = timestamp;
        existing.lastMutationId = mutationId;
        existing.sourceDeviceId = this.deviceId;
        existing.baseVersion = currentVer;
        existing.version = currentVer + 1;
        store.set(entityId, existing);
        this._notifyListeners(entityType, { type: 'deleted', doc: existing, entityId });
      }
    } else if (action === 'CREATE') {
      const existing = store.get(entityId);
      if (existing) {
        if (arePayloadsEquivalent(entityType, { ...payload, id: entityId }, existing)) {
          return {
            success: true,
            alreadyApplied: true,
            remoteId: entityId,
            remoteVersion: existing.updatedAt || timestamp
          };
        } else {
          const err = new Error(`Conflito de integridade: registro remoto "${entityId}" já existe no destino com dados divergentes.`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'payload_divergence_conflict';
          err.remoteRecord = existing;
          throw err;
        }
      }

      const cleanCreatePayload = { ...payload };
      delete cleanCreatePayload.baseVersion;
      delete cleanCreatePayload.expectedBaseVersion;
      delete cleanCreatePayload.basePayloadHash;

      const newDoc = {
        ...cleanCreatePayload,
        id: entityId,
        version: entityType === 'products' ? 1 : (cleanCreatePayload.version !== undefined ? cleanCreatePayload.version : 1),
        sourceDeviceId: this.deviceId,
        lastMutationId: mutationId,
        updatedAt: payload.updatedAt || timestamp,
        _serverTimestamp: Date.now()
      };
      store.set(entityId, newDoc);
      this._notifyListeners(entityType, { type: 'updated', doc: newDoc, entityId });
    } else if (action === 'UPDATE') {
      const existing = store.get(entityId);
      const expectedBase = payload?.baseVersion ?? payload?.expectedBaseVersion;

      if (!existing) {
        if (expectedBase !== undefined && expectedBase !== null) {
          const err = new Error(`Conflito de concorrência: registro "${entityId}" esperado na versão v${expectedBase} não existe no servidor.`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'not_found';
          throw err;
        }

        // Compatibilidade legada / upsert: quando não há baseVersion esperada, insere com versão inicial
        const newDoc = {
          ...payload,
          id: entityId,
          version: payload.version !== undefined ? payload.version : 1,
          sourceDeviceId: this.deviceId,
          lastMutationId: mutationId,
          updatedAt: payload.updatedAt || timestamp,
          _serverTimestamp: Date.now()
        };
        delete newDoc.baseVersion;
        delete newDoc.expectedBaseVersion;
        delete newDoc.basePayloadHash;
        store.set(entityId, newDoc);
        this._notifyListeners(entityType, { type: 'updated', doc: newDoc, entityId });
        return {
          success: true,
          remoteId: entityId,
          remoteVersion: newDoc.version
        };
      }

      if (arePayloadsEquivalent(entityType, { ...payload, id: entityId }, existing)) {
        return {
          success: true,
          alreadyApplied: true,
          remoteId: entityId,
          remoteVersion: existing.updatedAt || timestamp
        };
      }

      if (existing.version === undefined) {
        const err = new Error(`Registro legado não versionado "${entityId}" é protegido contra mutações diretas.`);
        err.code = 'concurrency_conflict';
        err.errorCategory = 'unversioned_legacy_conflict';
        err.remoteRecord = existing;
        throw err;
      }

      if (expectedBase !== undefined && expectedBase !== null) {
        const currentVer = existing.version || 1;
        if (currentVer !== expectedBase) {
          const err = new Error(`Conflito de concorrência: registro "${entityId}" foi alterado concorrentemente (versão remota v${currentVer} difere da versão esperada).`);
          err.code = 'concurrency_conflict';
          err.errorCategory = 'version_conflict';
          err.remoteRecord = existing;
          throw err;
        }
      } else if (existing.version !== undefined && (payload?.version !== undefined || payload?.baseVersion !== undefined)) {
        const err = new Error(`Conflito de integridade: atualização do registro versionado "${entityId}" requer baseVersion.`);
        err.code = 'concurrency_conflict';
        err.errorCategory = 'missing_base_version';
        err.remoteRecord = existing;
        throw err;
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

      const currentVer = existing.version || 1;
      const nextVersion = currentVer + 1;
      const updatedDoc = {
        ...existing,
        ...payload,
        id: entityId,
        baseVersion: currentVer,
        version: nextVersion,
        sourceDeviceId: this.deviceId,
        lastMutationId: mutationId,
        updatedAt: payload.updatedAt || timestamp,
        _serverTimestamp: Date.now()
      };
      delete updatedDoc.expectedBaseVersion;
      delete updatedDoc.basePayloadHash;
      store.set(entityId, updatedDoc);
      this._notifyListeners(entityType, { type: 'updated', doc: updatedDoc, entityId });
    }

    return {
      success: true,
      remoteId: entityId,
      remoteVersion: timestamp
    };
  }

  async pullChanges(entityType, sinceTimestamp = null) {
    if (!this.configured) throw new Error('Provedor não configurado.');
    if (!this.connected) throw new Error('Sem conexão com o Realtime Database.');
    if (this.shouldFail) throw new Error(this.failureMessage);

    const store = this._getStore(entityType);
    let items = Array.from(store.values());

    if (sinceTimestamp) {
      const sinceTime = new Date(sinceTimestamp).getTime();
      items = items.filter(doc => new Date(doc.updatedAt || doc.createdAt || 0).getTime() > sinceTime);
    }

    return {
      items,
      latestTimestamp: new Date().toISOString()
    };
  }

  // Operações CRUD Diretas
  async get(entityType, id) {
    const store = this._getStore(entityType);
    return store.get(id) || null;
  }

  async list(entityType, options = {}) {
    const store = this._getStore(entityType);
    let list = Array.from(store.values());

    if (options.filter && typeof options.filter === 'function') {
      list = list.filter(options.filter);
    }
    if (options.orderBy) {
      list.sort((a, b) => (a[options.orderBy] > b[options.orderBy] ? 1 : -1));
    }
    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return list;
  }

  /**
   * Consulta um registro na store em memória pelo entityType e entityId.
   * @param {string} entityType
   * @param {string} entityId
   * @returns {Promise<Object|null>}
   */
  async get(entityType, entityId) {
    const store = this._getStore(entityType);
    return store.get(entityId) || null;
  }

  async create(entityType, id, data) {
    return this.pushChange({
      entityType,
      entityId: id,
      action: 'CREATE',
      payload: data
    });
  }

  async update(entityType, id, data) {
    return this.pushChange({
      entityType,
      entityId: id,
      action: 'UPDATE',
      payload: data
    });
  }

  async upsert(entityType, id, data) {
    return this.pushChange({
      entityType,
      entityId: id,
      action: 'UPDATE',
      payload: data
    });
  }

  async remove(entityType, id) {
    return this.pushChange({
      entityType,
      entityId: id,
      action: 'DELETE',
      payload: { id }
    });
  }

  /**
   * Registra listener com suporte a Anti-Loop e Tagging origin: 'remote'.
   */
  subscribe(entityType, callback) {
    if (typeof callback !== 'function') throw new Error('Callback deve ser uma função.');

    if (!this.listeners.has(entityType)) {
      this.listeners.set(entityType, new Set());
    }
    this.listeners.get(entityType).add(callback);

    // Notificação inicial com estado corrente
    const store = this._getStore(entityType);
    const initialItems = Array.from(store.values());
    if (initialItems.length > 0) {
      try {
        callback({
          entityType,
          items: initialItems.map(item => ({ ...item, origin: 'remote' })),
          isInitial: true
        });
      } catch (err) {
        console.error('[MockRealtimeProvider] Erro no listener inicial:', err);
      }
    }

    return () => {
      this.unsubscribe(entityType, callback);
    };
  }

  unsubscribe(entityType, callback) {
    if (this.listeners.has(entityType)) {
      this.listeners.get(entityType).delete(callback);
    }
  }

  unsubscribeAll() {
    this.listeners.clear();
  }

  _notifyListeners(entityType, event) {
    const callbacks = this.listeners.get(entityType);
    if (!callbacks || callbacks.size === 0) return;

    const payload = {
      ...event,
      entityType,
      origin: 'remote'
    };

    for (const cb of callbacks) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[MockRealtimeProvider] Erro ao notificar listener:', e);
      }
    }
  }

  /**
   * Simula um evento disparado por outro dispositivo (Dispositivo B).
   * Permite testar recepção remota, reconciliação, descarte de eco e ausência de loops.
   */
  simulateRemoteChange({ entityType, entityId, action = 'UPDATE', payload, sourceDeviceId = 'device_remote_other', version = 2, mutationId = null }) {
    const store = this._getStore(entityType);
    const finalMutationId = mutationId || `mut_rem_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const remoteDoc = {
      ...(store.get(entityId) || {}),
      ...payload,
      id: entityId,
      version,
      sourceDeviceId,
      lastMutationId: finalMutationId,
      updatedAt: payload?.updatedAt || timestamp,
      _serverTimestamp: Date.now()
    };

    if (action === 'DELETE') {
      remoteDoc.deletedAt = timestamp;
    }

    store.set(entityId, remoteDoc);

    // Dispara listeners registrados
    this._notifyListeners(entityType, {
      type: action === 'DELETE' ? 'deleted' : 'updated',
      doc: remoteDoc,
      entityId,
      sourceDeviceId,
      mutationId: finalMutationId,
      version
    });

    return remoteDoc;
  }

  clear() {
    this.database.clear();
    this.pushedChanges = [];
    this.processedMutations.clear();
    this.listeners.clear();
    this.connectionListeners.clear();
    this.shouldFail = false;
    this.connected = true;
    this._ensureTenantStore(this.tenantId);
  }
}
