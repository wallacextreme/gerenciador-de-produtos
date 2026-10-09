import { CloudProvider } from './CloudProvider.js';
import { authService } from '../services/AuthService.js';
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  update,
  remove,
  get,
  onValue,
  off,
  serverTimestamp,
  goOnline,
  goOffline,
  connectDatabaseEmulator
} from 'firebase/database';
import { validateFirebaseConfig } from '../utils/firebaseConfigValidator.js';

/**
 * GestãoPro — Provedor Oficial do Firebase Realtime Database (PHASE 03)
 * Opera como Remote Synchronization Layer desacoplado sobre o Firebase Modular SDK v13.
 * Mantém isolamento Multi-Tenant (/tenants/{tenantId}/...), streaming bidirecional e Anti-Loop.
 */
export class FirebaseRealtimeProvider extends CloudProvider {
  constructor(config = null, authServiceInstance = null) {
    super();
    this.config = config || null;
    this.authService = authServiceInstance || authService;
    this.app = null;
    this.db = null;
    this.deviceId = null;
    this._connected = false;
    this._initialized = false;
    this._subscriptions = new Map(); // path -> Map(userCb -> fbUnsub)
    this._connectionListeners = new Set();
    this._processedMutations = new Set();
    this._unsubConnected = null;

    this._initDeviceId();
  }

  _initDeviceId() {
    if (typeof localStorage !== 'undefined') {
      try {
        let devId = localStorage.getItem('gestaopro_device_id');
        if (!devId) {
          devId = typeof crypto !== 'undefined' && crypto.randomUUID
            ? `dev_${crypto.randomUUID()}`
            : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          localStorage.setItem('gestaopro_device_id', devId);
        }
        this.deviceId = devId;
      } catch (_) {
        this.deviceId = `dev_temp_${Date.now()}`;
      }
    } else {
      this.deviceId = `dev_node_${Date.now()}`;
    }
  }

  getProviderName() {
    return 'Firebase Realtime Database';
  }

  isConfigured() {
    return !!(this.config && (this.config.databaseURL || (this.config.apiKey && this.config.projectId)));
  }

  getTenantId() {
    const authTenant = this.authService ? this.authService.getTenantId() : null;
    return authTenant || (this.config && this.config.tenantId) || 'tenant_matriz_01';
  }

  getDeviceId() {
    return this.deviceId;
  }

  setDeviceId(id) {
    this.deviceId = id;
  }

  isConnected() {
    return this._connected;
  }

  async initialize(config = null) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (!this.isConfigured() || (this._initialized && this.db)) {
      return;
    }

    validateFirebaseConfig(this.config);

    try {
      const apps = getApps();
      const appName = 'gestaopro-rtdb';
      const existing = apps.find(a => a.name === appName || a.name === '[DEFAULT]');

      this.app = existing || initializeApp(this.config, apps.length === 0 ? undefined : appName);
      
      const dbUrl = this.config.databaseURL || undefined;
      this.db = getDatabase(this.app, dbUrl);

      // Conexão com Emulator Suite quando configurado
      if (this.config.emulatorHost) {
        const [host, port] = this.config.emulatorHost.split(':');
        connectDatabaseEmulator(this.db, host, parseInt(port || '9000', 10));
      }

      // Monitoramento da conexão real do Realtime Database (/.info/connected)
      const connectedRef = ref(this.db, '.info/connected');
      this._unsubConnected = onValue(connectedRef, (snap) => {
        this._connected = snap.val() === true;
        for (const cb of this._connectionListeners) {
          try { cb(this._connected); } catch (_) {}
        }
      });

      this._initialized = true;
    } catch (err) {
      console.error('[FirebaseRealtimeProvider] Falha ao inicializar RTDB:', err);
      throw new Error(`Falha ao conectar com Realtime Database: ${err.message}`);
    }
  }

  async testConnection() {
    if (!this.isConfigured()) {
      return { success: false, message: 'Provedor não configurado com credenciais válidas do Firebase.' };
    }

    if (!this.db) {
      try {
        await this.initialize();
      } catch (err) {
        return { success: false, message: err.message };
      }
    }

    const start = Date.now();
    try {
      const tenantId = this.getTenantId();
      const testRef = ref(this.db, `tenants/${tenantId}/syncMetadata/lastTest`);
      await set(testRef, { timestamp: Date.now(), deviceId: this.deviceId });
      const latencyMs = Date.now() - start;
      return { success: true, message: 'Conexão ativa com o Firebase Realtime Database.', latencyMs };
    } catch (err) {
      return { success: false, message: `Falha na verificação remota: ${err.message}` };
    }
  }

  /**
   * Envia uma alteração da fila Outbox (SyncQueue) para o Realtime Database.
   * Aplica metadados de sync: version, sourceDeviceId, lastMutationId, timestamps.
   */
  async pushChange(changeItem) {
    if (!this.isConfigured() || !this.db) {
      await this.initialize();
      if (!this.db) throw new Error('Realtime Database não inicializado.');
    }

    const tenantId = this.getTenantId();
    const { entityType, entityId, action, payload } = changeItem;
    const path = `tenants/${tenantId}/${entityType}/${entityId}`;
    const targetRef = ref(this.db, path);
    const mutationId = changeItem.id || `mut_${Date.now()}`;
    const timestamp = new Date().toISOString();

    // Rastreia a mutação local para prevenção de loop no retorno do listener
    this._processedMutations.add(mutationId);

    try {
      if (action === 'DELETE') {
        // Soft delete no nó do RTDB com marcação explícita
        await update(targetRef, {
          deletedAt: timestamp,
          updatedAt: timestamp,
          lastMutationId: mutationId,
          sourceDeviceId: this.deviceId
        });
      } else {
        const docData = {
          ...payload,
          id: entityId,
          sourceDeviceId: this.deviceId,
          lastMutationId: mutationId,
          updatedAt: payload?.updatedAt || timestamp,
          version: payload?.version !== undefined ? payload.version : 1,
          _serverTimestamp: serverTimestamp()
        };

        await set(targetRef, docData);
      }

      return {
        success: true,
        remoteId: entityId,
        remoteVersion: timestamp
      };
    } catch (err) {
      throw new Error(`Falha na sincronização remota: ${err.message}`);
    }
  }

  async pullChanges(entityType, sinceTimestamp = null) {
    if (!this.isConfigured() || !this.db) {
      await this.initialize();
      if (!this.db) throw new Error('Realtime Database não inicializado.');
    }

    const tenantId = this.getTenantId();
    const collRef = ref(this.db, `tenants/${tenantId}/${entityType}`);
    const snapshot = await get(collRef);

    if (!snapshot.exists()) {
      return { items: [], latestTimestamp: new Date().toISOString() };
    }

    const val = snapshot.val() || {};
    let items = Object.values(val);

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
    if (!this.db) await this.initialize();
    const tenantId = this.getTenantId();
    const itemRef = ref(this.db, `tenants/${tenantId}/${entityType}/${id}`);
    const snap = await get(itemRef);
    return snap.exists() ? snap.val() : null;
  }

  async list(entityType, options = {}) {
    const res = await this.pullChanges(entityType);
    let items = res.items;

    if (options.filter && typeof options.filter === 'function') {
      items = items.filter(options.filter);
    }
    if (options.orderBy) {
      items.sort((a, b) => (a[options.orderBy] > b[options.orderBy] ? 1 : -1));
    }
    if (options.limit) {
      items = items.slice(0, options.limit);
    }
    return items;
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
   * Registra listener com filtragem matemática de Anti-Loop:
   * 1. Descarte imediato de eco local (sourceDeviceId === this.deviceId).
   * 2. Descarte de mutações já processadas localmente (lastMutationId).
   * 3. Tagging estrito de origem remota ({ origin: 'remote' }) para proteção do Outbox.
   */
  subscribe(entityType, callback) {
    if (typeof callback !== 'function') throw new Error('Callback deve ser uma função.');

    const tenantId = this.getTenantId();
    const targetPath = `tenants/${tenantId}/${entityType}`;

    if (!this._subscriptions.has(targetPath)) {
      this._subscriptions.set(targetPath, new Map());
    }
    const pathSubs = this._subscriptions.get(targetPath);

    if (this.db) {
      const targetRef = ref(this.db, targetPath);
      const fbUnsub = onValue(targetRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const val = snapshot.val() || {};
        const items = Object.values(val);

        // Filtra itens com protocolo Anti-Loop
        const remoteItems = [];
        for (const item of items) {
          // Camada 1: Descarte de eco gerado por este próprio dispositivo
          if (item.sourceDeviceId === this.deviceId) {
            continue;
          }

          // Camada 2: Descarte de mutação já processada
          if (item.lastMutationId && this._processedMutations.has(item.lastMutationId)) {
            continue;
          }

          // Camada 3: Tagging seguro como 'remote'
          remoteItems.push({
            ...item,
            origin: 'remote',
            _origin: 'remote'
          });
        }

        if (remoteItems.length > 0) {
          try {
            callback({
              entityType,
              items: remoteItems,
              origin: 'remote'
            });
          } catch (cbErr) {
            console.error('[FirebaseRealtimeProvider] Erro ao invocar callback de subscription:', cbErr);
          }
        }
      });

      pathSubs.set(callback, fbUnsub);
    } else {
      // Mock / fallback sem DB instanciado
      pathSubs.set(callback, () => {});
    }

    return () => {
      this.unsubscribe(entityType, callback);
    };
  }

  unsubscribe(entityType, callback) {
    const tenantId = this.getTenantId();
    const targetPath = `tenants/${tenantId}/${entityType}`;
    const pathSubs = this._subscriptions.get(targetPath);
    if (pathSubs && pathSubs.has(callback)) {
      const fbUnsub = pathSubs.get(callback);
      if (typeof fbUnsub === 'function') {
        fbUnsub();
      }
      pathSubs.delete(callback);
    }
  }

  unsubscribeAll() {
    for (const [path, map] of this._subscriptions.entries()) {
      for (const [cb, unsub] of map.entries()) {
        if (typeof unsub === 'function') unsub();
      }
      map.clear();
    }
    this._subscriptions.clear();
  }

  onConnectionChange(callback) {
    if (typeof callback !== 'function') throw new Error('Callback deve ser uma função.');
    this._connectionListeners.add(callback);
    try { callback(this._connected); } catch (_) {}
    return () => {
      this._connectionListeners.delete(callback);
    };
  }

  goOnline() {
    if (this.db) goOnline(this.db);
    this._connected = true;
  }

  goOffline() {
    if (this.db) goOffline(this.db);
    this._connected = false;
  }

  destroy() {
    this.unsubscribeAll();
    if (this._unsubConnected && typeof this._unsubConnected === 'function') {
      this._unsubConnected();
      this._unsubConnected = null;
    }
    this._connectionListeners.clear();
    this._processedMutations.clear();
    this._initialized = false;
    this.db = null;
    this.app = null;
  }
}
