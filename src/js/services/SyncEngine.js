import { syncRepository } from '../repositories/SyncRepository.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { FirebaseProvider } from '../sync/FirebaseProvider.js';
import { MockCloudProvider } from '../sync/MockCloudProvider.js';

/**
 * GestãoPro — SyncEngine (FASE 13)
 * Motor central de sincronização em nuvem desacoplado e assíncrono.
 * Opera sob o padrão Outbox, garantindo integridade transacional e resiliência offline.
 */
export class SyncEngine {
  constructor(cloudProvider = null) {
    const isPublicDemo = typeof import.meta !== 'undefined' && 
                         import.meta.env && 
                         (import.meta.env.VITE_PUBLIC_DEMO === 'true' || import.meta.env.VITE_PUBLIC_DEMO === true);

    this.provider = cloudProvider || (isPublicDemo ? new MockCloudProvider({ name: 'Demonstração em Nuvem (Simulada)' }) : new FirebaseProvider());
    this.isSyncing = false;
    this.autoSync = true;
    this.lastSyncTimestamp = null;
    this.debounceTimer = null;
    this._initialized = false;
    this._cleanupFns = [];
  }

  /**
   * Inicializa o SyncEngine, carrega configurações e escuta eventos de mutação e rede.
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      // 1. Carrega configurações salvas de nuvem
      const savedConfig = await settingsRepository.get('firebaseConfig');
      if (savedConfig && this.provider instanceof FirebaseProvider) {
        this.provider.updateConfig(savedConfig);
      }

      const savedAutoSync = await settingsRepository.get('autoSyncEnabled');
      if (savedAutoSync !== null && savedAutoSync !== undefined) {
        this.autoSync = !!savedAutoSync;
      }

      const savedLastSync = await settingsRepository.get('lastSyncTimestamp');
      if (savedLastSync) {
        this.lastSyncTimestamp = savedLastSync;
      }
    } catch (err) {
      console.warn('[SyncEngine] Aviso ao carregar configurações de nuvem:', err);
    }

    // 2. Registra listeners de mutações do sistema
    this._setupMutationListeners();

    // 3. Registra listener de status de rede
    this._setupNetworkListener();

    // 4. Se estiver online e configurado, processa itens pendentes
    if (this.autoSync && this.provider.isConfigured() && typeof navigator !== 'undefined' && navigator.onLine) {
      this.triggerAutoSync();
    }
  }

  /**
   * Configura o provedor em nuvem ativo.
   * @param {CloudProvider} provider 
   */
  setProvider(provider) {
    if (provider) {
      this.provider = provider;
      this._emitStatus();
    }
  }

  /**
   * Atualiza a configuração de credenciais e persiste no IndexedDB.
   * @param {Object} config 
   */
  async updateCredentials(config) {
    if (this.provider instanceof FirebaseProvider) {
      this.provider.updateConfig(config);
    }
    await settingsRepository.set('firebaseConfig', config);
    this._emitStatus();
  }

  /**
   * Habilita ou desabilita o sincronismo automático.
   * @param {boolean} enabled 
   */
  async setAutoSync(enabled) {
    this.autoSync = !!enabled;
    await settingsRepository.set('autoSyncEnabled', this.autoSync);
    this._emitStatus();
  }

  /**
   * Registra listeners para eventos de mutação de entidades.
   */
  _setupMutationListeners() {
    // Produtos (Create/Update)
    const unsubProdUp = eventBus.on(EVENTS.PRODUCT_UPDATED, async (payload) => {
      if (payload && payload.id) {
        await this.enqueue('products', payload.id, 'UPDATE', payload);
      }
    });
    this._cleanupFns.push(unsubProdUp);

    // Produtos (Soft Delete)
    const unsubProdDel = eventBus.on(EVENTS.PRODUCT_DELETED, async (payload) => {
      if (payload && payload.id) {
        await this.enqueue('products', payload.id, 'DELETE', payload);
      }
    });
    this._cleanupFns.push(unsubProdDel);

    // Movimentações de Estoque
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, async (payload) => {
      if (payload && payload.id) {
        await this.enqueue('stockMovements', payload.id, 'CREATE', payload);
      }
    });
    this._cleanupFns.push(unsubStock);

    // Vendas
    const unsubSale = eventBus.on(EVENTS.SALE_CREATED, async (payload) => {
      if (payload && payload.id) {
        await this.enqueue('sales', payload.id, 'CREATE', payload);
      }
    });
    this._cleanupFns.push(unsubSale);

    // Compras
    const unsubPurchase = eventBus.on(EVENTS.PURCHASE_CREATED, async (payload) => {
      if (payload && payload.id) {
        await this.enqueue('purchases', payload.id, 'CREATE', payload);
      }
    });
    this._cleanupFns.push(unsubPurchase);

    // Configurações
    const unsubSettings = eventBus.on(EVENTS.SETTINGS_CHANGED, async (payload) => {
      if (payload && payload.key && payload.key !== 'firebaseConfig') {
        await this.enqueue('settings', payload.key, 'UPDATE', payload);
      }
    });
    this._cleanupFns.push(unsubSettings);
  }

  /**
   * Escuta transições de estado de rede para sincronizar automaticamente ao reconectar.
   */
  _setupNetworkListener() {
    const unsubNet = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, (payload) => {
      if (payload && payload.isOnline && this.autoSync) {
        this.triggerAutoSync();
      }
    });
    this._cleanupFns.push(unsubNet);
  }

  /**
   * Enfileira uma mutação na fila de saída (Outbox).
   * @param {string} entityType 
   * @param {string} entityId 
   * @param {'CREATE'|'UPDATE'|'DELETE'} action 
   * @param {Object} payload 
   */
  async enqueue(entityType, entityId, action, payload) {
    const item = await syncRepository.enqueue({ entityType, entityId, action, payload });
    
    eventBus.emit(EVENTS.SYNC_QUEUE_UPDATED, { item });
    this._emitStatus();

    if (this.autoSync && this.provider.isConfigured()) {
      this.triggerAutoSync();
    }
    return item;
  }

  /**
   * Aciona a sincronização com debounce para agrupar múltiplas mutações em rajada.
   * @param {number} [delayMs=1200] 
   */
  triggerAutoSync(delayMs = 1200) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.processQueue().catch((err) => {
        console.warn('[SyncEngine] Erro durante auto-sync:', err.message);
      });
    }, delayMs);
  }

  /**
   * Processa todos os itens pendentes da fila de sincronização de forma ordenada.
   * @returns {Promise<{ processed: number, success: number, failed: number }>}
   */
  async processQueue() {
    if (this.isSyncing) {
      return { processed: 0, success: 0, failed: 0, isBusy: true };
    }

    if (!this.provider || !this.provider.isConfigured()) {
      return { processed: 0, success: 0, failed: 0, notConfigured: true };
    }

    this.isSyncing = true;
    this._emitStatus();

    let successCount = 0;
    let failedCount = 0;

    try {
      const pendingItems = await syncRepository.getPending();

      for (const item of pendingItems) {
        try {
          const res = await this.provider.pushChange(item);
          if (res && res.success) {
            await syncRepository.markSynced(item.id, res);
            successCount++;
          } else {
            await syncRepository.markFailed(item.id, res.error || 'Erro desconhecido');
            failedCount++;
          }
        } catch (err) {
          await syncRepository.markFailed(item.id, err.message);
          failedCount++;
        }
      }

      this.lastSyncTimestamp = new Date().toISOString();
      await settingsRepository.set('lastSyncTimestamp', this.lastSyncTimestamp);

    } finally {
      this.isSyncing = false;
      this._emitStatus();
    }

    return {
      processed: successCount + failedCount,
      success: successCount,
      failed: failedCount
    };
  }

  /**
   * Resolução determinística de conflitos entre versão local e remota.
   * Estratégia: Last Write Wins (LWW) baseada no timestamp `updatedAt`.
   * @param {Object} localDoc 
   * @param {Object} remoteDoc 
   * @param {'LAST_WRITE_WINS'} [strategy='LAST_WRITE_WINS']
   * @returns {Object} Documento vencedor
   */
  resolveConflict(localDoc, remoteDoc, strategy = 'LAST_WRITE_WINS') {
    if (!localDoc) return remoteDoc;
    if (!remoteDoc) return localDoc;

    if (strategy === 'LAST_WRITE_WINS') {
      const localTime = new Date(localDoc.updatedAt || localDoc.createdAt || 0).getTime();
      const remoteTime = new Date(remoteDoc.updatedAt || remoteDoc.createdAt || 0).getTime();

      if (remoteTime > localTime) {
        return { ...remoteDoc, _conflictResolved: 'remote_won' };
      }
      return { ...localDoc, _conflictResolved: 'local_won' };
    }

    return localDoc;
  }

  /**
   * Retorna estatísticas completas de sincronização.
   */
  async getStats() {
    const queueStats = await syncRepository.getStats();
    return {
      ...queueStats,
      isSyncing: this.isSyncing,
      isConfigured: this.provider ? this.provider.isConfigured() : false,
      providerName: this.provider ? this.provider.getProviderName() : 'Nenhum',
      autoSync: this.autoSync,
      lastSyncTimestamp: this.lastSyncTimestamp
    };
  }

  async _emitStatus() {
    const stats = await this.getStats();
    eventBus.emit(EVENTS.SYNC_STATUS_CHANGED, stats);
  }

  destroy() {
    this._cleanupFns.forEach(fn => fn && fn());
    this._cleanupFns = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this._initialized = false;
  }
}

export const syncEngine = new SyncEngine();
