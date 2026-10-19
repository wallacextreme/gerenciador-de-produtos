import { syncRepository } from '../repositories/SyncRepository.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { eventBus, EVENTS } from '../eventBus.js';
import { FirebaseRealtimeProvider } from '../sync/FirebaseRealtimeProvider.js';
import { MockCloudProvider } from '../sync/MockCloudProvider.js';
import { authService } from './AuthService.js';
import { checkPermission, assertPermission } from '../utils/authGuard.js';
import { classifyCloudError } from '../utils/cloudErrorClassifier.js';
import {
  arePayloadsEquivalent,
  classifyRemoteOutcome,
  REMOTE_RECONCILIATION_OUTCOME
} from '../utils/operationIdentity.js';

/**
 * GestãoPro — SyncEngine (FASE 13 & 14.7)
 * Motor central de sincronização em nuvem desacoplado e assíncrono.
 * Opera sob o padrão Outbox, garantindo integridade transacional, isolamento multi-tenant
 * e resiliência offline com proteção de autorização e retentativas seguras.
 */
export class SyncEngine {
  constructor(cloudProvider = null, authServiceInstance = null) {
    const isPublicDemo = typeof import.meta !== 'undefined' && 
                         import.meta.env && 
                         (import.meta.env.VITE_PUBLIC_DEMO === 'true' || import.meta.env.VITE_PUBLIC_DEMO === true);

    this.authService = authServiceInstance || authService;
    this.provider = cloudProvider || (isPublicDemo ? new MockCloudProvider({ name: 'Demonstração em Nuvem (Simulada)' }) : new FirebaseRealtimeProvider(null, this.authService));
    this.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'engine_' + Math.random().toString(36).substring(2, 9);
    this.isSyncing = false;
    this.autoSync = true;
    this.lastSyncTimestamp = null;
    this.debounceTimer = null;
    this._initialized = false;
    this._destroyed = false;
    this._cleanupFns = [];
    /** Relógio injetável (ms) usado pelo backoff de reconciliação; substituível em testes. */
    this._now = () => Date.now();
    SyncEngine._activeInstances.add(this);
  }

  static _activeInstances = new Set();

  static destroyAll() {
    for (const inst of Array.from(SyncEngine._activeInstances)) {
      try {
        inst.destroy();
      } catch (_) {}
    }
    SyncEngine._activeInstances.clear();
  }

  /**
   * Inicializa o SyncEngine, carrega configurações e escuta eventos de mutação e rede.
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;
    this._destroyed = false;
    SyncEngine._activeInstances.add(this);

    try {
      // 1. Carrega configurações salvas de nuvem ou fallback de ambiente
      let savedConfig = await settingsRepository.get('firebaseConfig');
      if ((!savedConfig || !savedConfig.apiKey) && !(this.provider && this.provider._initialized) && typeof import.meta !== 'undefined' && import.meta.env) {
        const env = import.meta.env;
        if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) {
          savedConfig = {
            apiKey: env.VITE_FIREBASE_API_KEY,
            authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: env.VITE_FIREBASE_APP_ID,
            databaseURL: env.VITE_FIREBASE_DATABASE_URL,
            emulatorHost: env.VITE_FIREBASE_EMULATOR_HOST,
            authEmulatorHost: env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
            storageEmulatorHost: env.VITE_FIREBASE_STORAGE_EMULATOR_HOST
          };
        }
      }

      if (savedConfig) {
        if (typeof this.provider?.updateConfig === 'function') {
          this.provider.updateConfig(savedConfig);
        } else if (this.provider && !this.provider._initialized && typeof this.provider.initialize === 'function') {
          await this.provider.initialize(savedConfig);
        }
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

    // 3.5. Recuperação de interrupções em voo de sessões anteriores (crash-window recovery)
    try {
      await this.recoverInterruptedInFlight();
    } catch (e) {
      console.warn('[SyncEngine] Aviso ao recuperar itens in-flight:', e);
    }

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
    if (typeof this.provider?.updateConfig === 'function') {
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
   * Encerra o SyncEngine, desregistrando todos os listeners do EventBus e cancelando timers pendentes.
   */
  destroy() {
    this._destroyed = true;
    SyncEngine._activeInstances.delete(this);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (Array.isArray(this._cleanupFns)) {
      this._cleanupFns.forEach((fn) => {
        try {
          if (typeof fn === 'function') fn();
        } catch (_) {}
      });
      this._cleanupFns = [];
    }
    this._initialized = false;
  }

  /**
   * Registra listeners para eventos de mutação de entidades.
   * Anti-Loop: Mutações com origin: 'remote' são ignoradas para não reentrar no Outbox.
   */
  _setupMutationListeners() {
    if (!Array.isArray(this._cleanupFns)) {
      this._cleanupFns = [];
    }
    const isRemote = (payload) => payload && (payload.origin === 'remote' || payload._origin === 'remote');

    // Produtos (Create/Update)
    const unsubProdUp = eventBus.on(EVENTS.PRODUCT_UPDATED, async (payload) => {
      if (this._destroyed) return;
      if (payload && payload.id && !isRemote(payload)) {
        if (payload.action === 'stock_change' || payload.action === 'sale' || payload.action === 'purchase') return;
        const action = payload.action === 'create' ? 'CREATE' : 'UPDATE';
        await this.enqueue('products', payload.id, action, payload);
      }
    });
    this._cleanupFns.push(unsubProdUp);

    // Produtos (Soft Delete)
    const unsubProdDel = eventBus.on(EVENTS.PRODUCT_DELETED, async (payload) => {
      if (this._destroyed) return;
      if (payload && payload.id && !isRemote(payload)) {
        await this.enqueue('products', payload.id, 'DELETE', payload);
      }
    });
    this._cleanupFns.push(unsubProdDel);

    // Fornecedores (Create)
    const unsubSupCr = eventBus.on('SUPPLIER_CREATED', async (payload) => {
      if (this._destroyed) return;
      if (payload && payload.id && !isRemote(payload)) {
        await this.enqueue('suppliers', payload.id, 'CREATE', payload);
      }
    });
    this._cleanupFns.push(unsubSupCr);

    // Fornecedores (Update)
    const unsubSupUp = eventBus.on('SUPPLIER_UPDATED', async (payload) => {
      if (this._destroyed) return;
      if (payload && payload.id && !isRemote(payload)) {
        await this.enqueue('suppliers', payload.id, 'UPDATE', payload);
      }
    });
    this._cleanupFns.push(unsubSupUp);

    // Movimentações de Estoque (Ledger /inventory)
    const unsubStock = eventBus.on(EVENTS.STOCK_CHANGED, async (payload) => {
      if (this._destroyed) return;
      const id = payload?.id || payload?.movementId;
      if (id && !isRemote(payload)) {
        const cleanPayload = {
          id,
          productId: payload.productId,
          quantity: payload.quantity !== undefined ? payload.quantity : (payload.delta !== undefined ? Math.abs(payload.delta) : 0),
          delta: payload.delta,
          type: payload.type,
          unitCostCents: payload.unitCostCents || 0,
          reason: payload.reason || '',
          notes: payload.notes || '',
          referenceId: payload.referenceId || '',
          referenceType: payload.referenceType || '',
          previousStock: payload.previousStock !== undefined ? payload.previousStock : 0,
          resultingStock: payload.resultingStock !== undefined ? payload.resultingStock : (payload.newStock !== undefined ? payload.newStock : 0),
          date: payload.date || new Date().toISOString(),
          createdAt: payload.createdAt || new Date().toISOString()
        };
        await this.enqueue('stockMovements', id, 'CREATE', cleanPayload);
      }
    });
    this._cleanupFns.push(unsubStock);

    // Vendas
    const unsubSale = eventBus.on(EVENTS.SALE_CREATED, async (payload) => {
      if (this._destroyed) return;
      const id = payload?.id || payload?.saleId;
      if (id && !isRemote(payload)) {
        await this.enqueue('sales', id, 'CREATE', { ...payload, id });
      }
    });
    this._cleanupFns.push(unsubSale);

    // Compras
    const unsubPurchase = eventBus.on(EVENTS.PURCHASE_CREATED, async (payload) => {
      if (this._destroyed) return;
      const id = payload?.id || payload?.purchaseId;
      if (id && !isRemote(payload)) {
        await this.enqueue('purchases', id, 'CREATE', { ...payload, id });
      }
    });
    this._cleanupFns.push(unsubPurchase);

    // Configurações
    const unsubSettings = eventBus.on(EVENTS.SETTINGS_CHANGED, async (payload) => {
      if (this._destroyed) return;
      if (payload && payload.key && payload.key !== 'firebaseConfig' && !isRemote(payload)) {
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
      if (this._destroyed) return;
      if (payload && payload.isOnline && this.autoSync) {
        this.triggerAutoSync();
      }
    });
    this._cleanupFns.push(unsubNet);
  }

  /**
   * Enfileira uma mutação na fila de saída (Outbox) com validação de autorização.
   * @param {string} entityType 
   * @param {string} entityId 
   * @param {'CREATE'|'UPDATE'|'DELETE'} action 
   * @param {Object} payload 
   */
  async enqueue(entityType, entityId, action, payload) {
    // Verificação de Autorização antes de persistir na Outbox
    assertPermission(action, entityType, { authInstance: this.authService });

    const tenantId = payload?.tenantId || (this.authService ? this.authService.getTenantId() : null);
    const item = await syncRepository.enqueue({ entityType, entityId, action, payload, tenantId });
    if (this._destroyed) return item;
    
    eventBus.emit(EVENTS.SYNC_QUEUE_UPDATED, { item });
    this._emitStatus();

    if (!this._destroyed && this.autoSync && this.provider.isConfigured()) {
      this.triggerAutoSync();
    }
    return item;
  }

  /**
   * Aciona a sincronização com debounce para agrupar múltiplas mutações em rajada.
   * @param {number} [delayMs=1200] 
   */
  triggerAutoSync(delayMs = 1200) {
    if (this._destroyed) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      if (this._destroyed) return;
      this.processQueue().catch((err) => {
        console.warn('[SyncEngine] Erro durante auto-sync:', err.message);
      });
    }, delayMs);
  }

  /**
   * Normaliza a versão do produto local no IndexedDB após sincronização com o backend.
   * Garante que criações consolidadas fiquem na versão 1 sem baseVersion obsoleto,
   * e que atualizações consolidadas tenham versão e baseVersion consistentes com o remoto,
   * prevenindo conflitos CAS (baseVersion mismatch) em edições locais posteriores.
   * Não altera a versão local se houver edição posterior pendente ou em voo no Outbox.
   * @param {Object} item
   */
  async _reconcileLocalProductVersion(item) {
    if (!item || item.entityType !== 'products' || !item.entityId) return;
    try {
      // 1. Verifica se existem mutações posteriores ainda pendentes ou em voo no Outbox para a mesma entidade no mesmo tenant
      const pendingMutations = await syncRepository.findAll(false);
      const hasSubsequentPending = pendingMutations.some(
        other => other &&
                 other.id !== item.id &&
                 other.entityType === 'products' &&
                 other.entityId === item.entityId &&
                 (!item.tenantId || !other.tenantId || other.tenantId === item.tenantId) &&
                 other.status !== 'SYNCED'
      );

      // Se houver edição posterior pendente ou em voo, não devemos regredir nem alterar a versão local
      if (hasSubsequentPending) {
        return;
      }

      const localProd = await productRepository.findById(item.entityId);
      if (localProd) {
        const targetVer = item.action === 'CREATE' ? 1 : (item.payload?.version || 1);

        const targetBase = item.action === 'CREATE' ? undefined : (item.payload?.baseVersion ?? (targetVer > 1 ? targetVer - 1 : undefined));

        let needsUpdate = false;
        if (localProd.version !== targetVer) {
          localProd.version = targetVer;
          needsUpdate = true;
        }

        if (item.action === 'CREATE') {
          if (localProd.baseVersion !== undefined) {
            delete localProd.baseVersion;
            needsUpdate = true;
          }
        } else if (item.action === 'UPDATE') {
          if (localProd.baseVersion !== targetBase) {
            if (targetBase === undefined) {
              delete localProd.baseVersion;
            } else {
              localProd.baseVersion = targetBase;
            }
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          await productRepository.update(localProd);
        }
      }
    } catch (_) {}
  }

  /**
   * Recupera itens com despacho interrompido (in-flight crash window):
   * - Respeita leases ativos pertencentes a instâncias vivas;
   * - Finaliza itens com ACK remoto durável já persistido sem re-despacho;
   * - Se o envio comprovadamente NÃO foi iniciado (dispatchStarted === false), reverte diretamente para PENDING com remoteOutcomeUnknown: false;
   * - Se o envio foi iniciado (dispatchStarted === true ou in-flight), marca remoteOutcomeUnknown: true;
   * - Para ledger append-only (stockMovements/inventory), devolve para PENDING com remoteOutcomeUnknown: true
   *   (requiresResolution: false). processQueue() reconcilia por LEITURA antes de qualquer escrita; o ledger
   *   nunca é reenviado às cegas e só é bloqueado (FAILED + requiresResolution) por divergência, permissão ou
   *   esgotamento das tentativas de leitura;
   * - Para entidades chave-idempotentes (produtos), devolve para PENDING para reconciliação pré-despacho em processQueue().
   *
   * @param {Object} [options={}]
   * @param {boolean} [options.force=false] Forçar recuperação ignorando lease ativo
   * @param {number|string} [options.now] Timestamp base para expiração de lease
   * @returns {Promise<{ recovered: number, blocked: number }>}
   */
  async recoverInterruptedInFlight(options = {}) {
    const all = await syncRepository.findAll(false);
    const interrupted = all.filter(item => item && (item.inFlight || item.status === 'SYNCING'));
    if (interrupted.length === 0) return { recovered: 0, blocked: 0, awaitingReconciliation: 0 };

    let recovered = 0;
    let blocked = 0;
    let awaitingReconciliation = 0;
    const nowTime = options.now ? new Date(options.now).getTime() : Date.now();

    for (const item of interrupted) {
      // 1. Instância antiga ainda ativa: respeita lease não expirado (a menos que options.force seja verdadeiro)
      if (!options.force && item.claimExpiresAt) {
        const expiresTime = new Date(item.claimExpiresAt).getTime();
        if (expiresTime > nowTime && item.claimedBy && item.claimedBy !== this.id) {
          // Lease ainda ativo de outra instância viva; não assume prematuramente
          continue;
        }
      }

      // 2. ACK remoto durável já persistido antes de interrupção (apenas se não estiver bloqueado por conflito/falha e não for exclusivamente de tentativa suplantada)
      const hasStaleAckOnly = Boolean(
        item.staleAttemptAcks &&
        item.staleAttemptAcks.length > 0 &&
        (!item.claimAttemptId || item.staleAttemptAcks.some(a => a.attemptId !== item.claimAttemptId))
      );

      if (item.remoteAckReceived && !item.requiresResolution && item.status !== 'FAILED' && !hasStaleAckOnly) {
        item.inFlight = false;
        await syncRepository.markSynced(item.id, {
          remoteVersion: item.remoteVersion,
          recoveredFromCrash: true
        });
        await this._reconcileLocalProductVersion(item);
        recovered++;
        continue;
      }

      // 3. Reserva criada, envio comprovadamente NÃO iniciado: dispatchStarted === false E nenhuma evidência
      // anterior de envio/ACK/resultado desconhecido. Libera para despacho sem exigir leitura remota.
      const hasPriorSendEvidence = Boolean(
        item.remoteOutcomeUnknown ||
        item.remoteAckReceived ||
        (Array.isArray(item.staleAttemptAcks) && item.staleAttemptAcks.length > 0)
      );
      if (item.dispatchStarted === false && !hasPriorSendEvidence) {
        item.inFlight = false;
        item.status = 'PENDING';
        item.claimedBy = null;
        item.claimAttemptId = null;
        item.claimExpiresAt = null;
        item.releasedBeforeDispatch = true;
        item.releasedBeforeDispatchAt = new Date().toISOString();
        await syncRepository.update(item, { isTechnicalUpdate: true });
        recovered++;
        continue;
      }

      // 4. Envio iniciado (ou indefinido em registro legado, ou evidência anterior): resultado remoto desconhecido.
      item.inFlight = false;
      item.remoteOutcomeUnknown = true;
      item.inFlightInterrupted = true;
      item.inFlightInterruptedAt = new Date().toISOString();
      item.claimedBy = null;
      item.claimAttemptId = null;
      item.claimExpiresAt = null;

      if (item.entityType === 'stockMovements' || item.entityType === 'inventory') {
        // FASE 14.23: o ledger NÃO é bloqueado definitivamente aqui, nem reenviado. Fica PENDING com
        // remoteOutcomeUnknown e será reconciliado (leitura autorizada) ANTES de qualquer escrita em processQueue().
        item.status = 'PENDING';
        item.requiresResolution = false;
        item.errorCategory = 'unknown_remote_outcome';
        item.lastError = 'Interrupção durante envio: resultado remoto desconhecido no ledger. Aguardando reconciliação antes de qualquer reenvio.';
        await syncRepository.update(item, { isTechnicalUpdate: true });
        awaitingReconciliation++;
      } else {
        item.status = 'PENDING';
        await syncRepository.update(item, { isTechnicalUpdate: true });
        recovered++;
      }
    }

    return { recovered, blocked, awaitingReconciliation };
  }

  /**
   * Processa todos os itens pendentes da fila de sincronização de forma ordenada.
   * Aplica isolamento de tenant, validação de permissões pré-despacho e classificação de falhas.
   * @returns {Promise<{ processed: number, success: number, failed: number }>}
   */
  async processQueue() {
    if (this.isSyncing) {
      return { processed: 0, success: 0, failed: 0, isBusy: true };
    }

    if (!this.provider || !this.provider.isConfigured()) {
      return { processed: 0, success: 0, failed: 0, notConfigured: true };
    }

    // Aguarda a restauração da sessão: com autenticação ativa e sessão ainda não restaurada
    // (ex.: inicialização lenta em 4G), NÃO processa nem marca itens como falha de segurança.
    const authGate = this.authService || authService;
    if (authGate && typeof authGate.isConfigured === 'function' && authGate.isConfigured()) {
      const gateSession = typeof authGate.getCurrentSession === 'function' ? authGate.getCurrentSession() : null;
      if (!gateSession || !gateSession.authenticated) {
        return { processed: 0, success: 0, failed: 0, awaitingAuth: true };
      }
    }

    this.isSyncing = true;
    this._emitStatus();

    let successCount = 0;
    let failedCount = 0;
    let deferredCount = 0;

    try {
      // 0. Recuperação de interrupções in-flight anteriores antes do loop
      await this.recoverInterruptedInFlight();

      const auth = this.authService || authService;
      const initialTenant = auth ? auth.getTenantId() : null;
      const pendingItems = await syncRepository.getPending();

      for (const item of pendingItems) {
        const liveTenant = auth ? auth.getTenantId() : null;
        const liveSession = auth ? auth.getCurrentSession() : null;

        // 1. Verificação dinâmica da sessão / tenant vivo antes de cada despacho:
        // Se a sessão ou o tenant mudou enquanto operações assíncronas estavam em andamento, aborta o loop imediatamente.
        if (liveTenant !== initialTenant) {
          console.warn('[SyncEngine] Troca de sessão/tenant detectada durante o processamento da fila. Interrompendo envio imediatamente.');
          break;
        }

        // 2. Isolamento Multi-Tenant estrito na Outbox:
        // Se a operação pertencer a outro tenant, JAMAIS processa ou altera sob a sessão atual.
        if (liveTenant && item.tenantId && item.tenantId !== liveTenant) {
          continue;
        }

        // 2.5. Serialização Causal e Ordem FIFO por Entidade:
        // Se houver predecessor un-synced ou operação da mesma entidade em voo, aguarda
        const hasPredecessor = await syncRepository.hasUnsyncedPredecessorOrInFlight(
          item.entityType,
          item.entityId,
          item.tenantId,
          item.id,
          item.createdAt
        );
        if (hasPredecessor) {
          // Mantém a ordem causal: operação posterior de uma entidade aguarda o término da predecessora
          // Outras entidades independentes na fila continuam sendo processadas!
          continue;
        }

        // 2.55. Backoff de reconciliação (FASE 14.23): uma leitura remota que falhou não é repetida antes de nextReconcileAt.
        if (item.nextReconcileAt && new Date(item.nextReconcileAt).getTime() > this._now()) {
          continue;
        }

        // Necessidade de reconciliar calculada ANTES da reserva (a evidência histórica vem do item persistido).
        const isLedgerItem = item.entityType === 'stockMovements' || item.entityType === 'inventory';
        const needsReconcile = Boolean(
          item.remoteOutcomeUnknown ||
          item.inFlightInterrupted ||
          (Array.isArray(item.staleAttemptAcks) && item.staleAttemptAcks.length > 0) ||
          (isLedgerItem && item.dispatchStarted)
        );

        // 2.6. Reserva Atômica Exclusiva com Lease de Despacho (claimForDispatch):
        // Garante que entre abas ou ciclos simultâneos, exatamente uma instância processe o item.
        // preserveDispatchStarted: a reserva não pode apagar a prova de que um envio anterior começou.
        const claimed = await syncRepository.claimForDispatch(item.id, this.id, { leaseDurationMs: 30000, preserveDispatchStarted: true });
        if (!claimed) {
          // Já reservado por outra aba/instância concorrente ou lease ativo vigente
          continue;
        }
        Object.assign(item, claimed);
        const currentAttemptId = claimed.claimAttemptId;

        // 3. Recuperação idempotente de item com ACK remoto já confirmado antes de interrupção de sessão:
        // Evita re-despacho duplicado na nuvem caso o backend já tenha aceito a mutação.
        const hasStaleAckOnly = Boolean(
          item.staleAttemptAcks &&
          item.staleAttemptAcks.length > 0 &&
          (!item.claimAttemptId || item.staleAttemptAcks.some(a => a.attemptId !== item.claimAttemptId))
        );

        if (item.remoteAckReceived && !item.requiresResolution && item.status !== 'FAILED' && !hasStaleAckOnly) {
          await syncRepository.markSynced(item.id, {
            remoteVersion: item.remoteVersion,
            recoveredFromInterruptedSession: true
          }, currentAttemptId);
          await this._reconcileLocalProductVersion(item);
          successCount++;
          continue;
        }

        // 4. Proteção contra registros legados da Outbox sem tenant:
        // Se a aplicação estiver em sessão com tenant ativo ou autenticação configurada,
        // JAMAIS despacha para a nuvem sob suposição ou sob o tenant do primeiro usuário a logar.
        const isAuthEnforced = auth ? (auth.isConfigured() || (liveSession !== null)) : false;
        if (liveTenant || isAuthEnforced) {
          if (!item.tenantId) {
            await syncRepository.markFailed(
              item.id,
              'Operação legada sem tenantId comprovado. Envio bloqueado para segurança multi-tenant.',
              5,
              true,
              { errorCategory: 'unassigned_legacy', requiresResolution: true }
            );
            failedCount++;
            continue;
          }
        }

        // 5. Verificação de autorização da sessão ativa antes do despacho remoto:
        // Bloqueia envio se a autenticação estiver ativa/configurada e a sessão tiver papel insuficiente.
        if (isAuthEnforced) {
          const permCheck = checkPermission(liveSession, item.action, item.entityType);
          if (!permCheck.authorized) {
            await syncRepository.markFailed(
              item.id,
              `Operação não autorizada para sessão atual (${liveSession?.role || 'anônimo'}): ${permCheck.reason}`,
              5,
              true, // permanente para o papel atual; preserva na fila sem loop infinito
              { errorCategory: 'security' }
            );
            failedCount++;
            continue;
          }
        }

        // 5.5. Reconciliação pré-despacho (FASE 14.23): LEITURA separada da ESCRITA.
        // Itens com histórico in-flight, resultado remoto desconhecido ou ACK de tentativa suplantada são reconciliados
        // antes de qualquer escrita. No ledger, `dispatchStarted` (preservado pela reserva) também exige reconciliação.
        if (needsReconcile) {
          if (this.provider && typeof this.provider.get === 'function') {
            try {
              const remoteRecord = await this.provider.get(item.entityType, item.entityId);
              const localWithTenant = item.payload?.tenantId ? item.payload : { ...item.payload, tenantId: item.tenantId };
              const comparison = classifyRemoteOutcome({
                entityType: item.entityType,
                entityId: item.entityId,
                action: item.action || 'CREATE',
                localPayload: localWithTenant,
                remoteRecord,
                expectedBaseVersion: item.payload?.baseVersion ?? item.payload?.expectedBaseVersion
              });

              if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT || comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED) {
                // Sucesso remoto anterior confirmado! Finaliza localmente sem re-despacho
                item.remoteAckReceived = true;
                item.remoteOutcomeUnknown = false;
                item.inFlightInterrupted = false;
                item.inFlight = false;
                await syncRepository.markSynced(item.id, {
                  remoteVersion: remoteRecord?.updatedAt || remoteRecord?._serverTimestamp || new Date().toISOString(),
                  reconciledRemotely: true
                });
                await this._reconcileLocalProductVersion(item);
                successCount++;
                continue;
              } else if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.UPDATE_ON_ABSENT_RECORD) {
                item.inFlight = false;
                await syncRepository.markFailed(
                  item.id,
                  `Tentativa de UPDATE sobre registro inexistente no servidor remoto: ${comparison.reason}`,
                  5,
                  true,
                  { errorCategory: 'missing_record', requiresResolution: true }
                );
                failedCount++;
                continue;
              } else if (item.action === 'UPDATE' && comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT) {
                const expVer = item.payload?.baseVersion ?? item.payload?.expectedBaseVersion;
                const isMultiTenantViolation = comparison.divergentFields && comparison.divergentFields.some(d => d.field === 'tenantId');
                if (!isMultiTenantViolation && expVer !== undefined && expVer !== null && remoteRecord?.version === expVer) {
                  // A tentativa anterior de UPDATE não chegou a ser aplicada remotamente:
                  // o servidor permanece na baseVersion esperada. Seguro prosseguir para o novo despacho!
                  item.remoteOutcomeUnknown = false;
                  item.inFlightInterrupted = false;
                  await syncRepository.update(item, { isTechnicalUpdate: true });
                } else {
                  // Conflito de concorrência ou violação de tenant
                  item.inFlight = false;
                  await syncRepository.markFailed(
                    item.id,
                    `Conflito detectado: ${comparison.reason}`,
                    5,
                    true,
                    { errorCategory: 'payload_divergence_conflict', requiresResolution: true }
                  );
                  failedCount++;
                  continue;
                }
              } else if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT || comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT) {
                // Conflito de payload ou versão: registro remoto divergente existente. Não sobrescrever!
                item.inFlight = false;
                const errCat = comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT ? 'version_conflict' : 'payload_divergence_conflict';
                await syncRepository.markFailed(
                  item.id,
                  `Conflito detectado: ${comparison.reason}`,
                  5,
                  true,
                  { errorCategory: errCat, requiresResolution: true }
                );
                failedCount++;
                continue;
              } else if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT) {
                // Ausência comprovada por leitura AUTORIZADA, para ação CREATE: seguro prosseguir para novo despacho.
                // (UPDATE/DELETE ausentes são tratados nos ramos anteriores e nunca viram criação.)
                item.remoteOutcomeUnknown = false;
                item.remoteAckReceived = false;
                item.dispatchStarted = false;
                item.inFlightInterrupted = false;
                item.reconcileAttempts = 0;
                item.nextReconcileAt = null;
                item.lastReconcileOutcome = 'RECORD_ABSENT';
                item.lastReconcileAt = new Date(this._now()).toISOString();
                await syncRepository.update(item, { isTechnicalUpdate: true });
              }
            } catch (queryErr) {
              const errInfo = classifyCloudError(queryErr);
              if (errInfo.category === 'security') {
                item.inFlight = false;
                await syncRepository.markFailed(
                  item.id,
                  `Leitura remota de reconciliação rejeitada por regras de permissão: ${queryErr.message}`,
                  5,
                  true,
                  { errorCategory: 'security', requiresResolution: true }
                );
                failedCount++;
                continue;
              }
              // Leitura inacessível NÃO é ausência. Adia a reconciliação com backoff
              // sem NUNCA reenviar a escrita enquanto o resultado remoto permanecer desconhecido.
              const d = await syncRepository.recordReconcileDeferred(item.id, currentAttemptId, {
                message: `Servidor remoto inacessível durante verificação de reconciliação: ${queryErr.message}`,
                now: this._now()
              });
              if (d.escalated) { failedCount++; } else { deferredCount++; }
              continue;
            }
          } else {
            // Sem capacidade de leitura remota o resultado anterior não pode ser provado: nunca despacha às cegas quando o desfecho for desconhecido.
            const d = await syncRepository.recordReconcileDeferred(item.id, currentAttemptId, {
              message: 'Provedor sem capacidade de leitura remota: resultado da operação não pode ser comprovado.',
              now: this._now()
            });
            if (d.escalated) { failedCount++; } else { deferredCount++; }
            continue;
          }
        }

        // 6. Janela de Envio: Registra duravelmente início do envio com a tentativa atual
        await syncRepository.recordDispatchStarted(item.id, currentAttemptId);

        try {
          const res = await this.provider.pushChange(item);

          // 7. Confirma se o tenant ainda é o mesmo antes de confirmar a sincronização na fila local
          const currentPostTenant = auth ? auth.getTenantId() : null;
          if (currentPostTenant !== item.tenantId) {
            console.warn('[SyncEngine] Tenant alterado após resposta do provedor. Isolando item sem marcação na sessão nova.');
            item.inFlight = false;
            item.status = 'PENDING';
            item.inFlightInterrupted = true;
            item.inFlightSwitchedTenant = currentPostTenant;
            item.inFlightInterruptedAt = new Date().toISOString();
            if (res && res.success) {
              item.remoteAckReceived = true;
              item.remoteVersion = res.remoteVersion || null;
            } else {
              item.remoteOutcomeUnknown = true;
            }
            await syncRepository.update(item, { isTechnicalUpdate: true });
            break;
          }

          // 7.1. Registro seguro do ACK com proteção contra ACK atrasado (superseded)
          const ackResult = await syncRepository.recordRemoteAck(item.id, currentAttemptId, res);

          if (ackResult.superseded) {
            console.warn('[SyncEngine] Despacho suplantado por nova instância recuperadora. ACK registrado duravelmente sem sobrescrever novo proprietário.');
            continue;
          }

          if (res && res.success) {
            await syncRepository.markSynced(item.id, res, currentAttemptId);
            await this._reconcileLocalProductVersion(item);
            successCount++;
          } else {
            item.inFlight = false;
            const errInfo = classifyCloudError(res?.error || 'Erro desconhecido');
            const isPermanent = !errInfo.shouldRetry;
            await syncRepository.markFailed(
              item.id,
              res?.error || 'Erro desconhecido',
              5,
              isPermanent,
              { errorCategory: errInfo.category },
              currentAttemptId
            );
            failedCount++;
          }
        } catch (err) {
          // Se a tentativa foi suplantada enquanto estava em voo, não altera estado nem marca FAILED
          const freshItem = await syncRepository.findById(item.id, { allowCrossTenant: true });
          if (freshItem && freshItem.claimAttemptId && freshItem.claimAttemptId !== currentAttemptId) {
            console.warn('[SyncEngine] Exceção durante envio, mas tentativa foi suplantada por nova instância recuperadora.');
            continue;
          }

          item.inFlight = false;
          item.remoteOutcomeUnknown = true;
          item.inFlightInterrupted = true;
          const errInfo = classifyCloudError(err);
          const isLedger = item.entityType === 'stockMovements' || item.entityType === 'inventory';

          let autoReconciled = false;
          let readbackDivergent = false;
          let readbackAbsent = false;
          // Se falhou no ledger append-only, verifica se o erro ocorreu porque o registro já havia sido gravado remotamente
          if (isLedger && this.provider && typeof this.provider.get === 'function') {
            try {
              const remoteRecord = await this.provider.get(item.entityType, item.entityId);
              if (!remoteRecord) {
                readbackAbsent = true;
              } else if (!arePayloadsEquivalent(item.entityType, item.payload, remoteRecord)) {
                readbackDivergent = true;
              }
              if (remoteRecord && arePayloadsEquivalent(item.entityType, item.payload, remoteRecord)) {
                item.remoteAckReceived = true;
                item.remoteOutcomeUnknown = false;
                item.inFlightInterrupted = false;
                await syncRepository.markSynced(item.id, {
                  remoteVersion: remoteRecord?.updatedAt || remoteRecord?._serverTimestamp || new Date().toISOString(),
                  reconciledAfterConflict: true
                });
                await this._reconcileLocalProductVersion(item);
                successCount++;
                autoReconciled = true;
              }
            } catch (_) {}
          }

          if (!autoReconciled) {
            const isConflict = err.code === 'concurrency_conflict' || err.errorCategory === 'payload_divergence_conflict' || err.errorCategory === 'version_conflict';
            if (isLedger && !isConflict && !readbackDivergent && errInfo.category !== 'security') {
              // FASE 14.23: resultado da escrita desconhecido no ledger. Não bloqueia definitivamente nem reenvia:
              // fica PENDING + remoteOutcomeUnknown; o próximo ciclo reconcilia ANTES de qualquer nova escrita.
              if (readbackAbsent) {
                await syncRepository.markFailed(
                  item.id,
                  err.message,
                  5,
                  false,
                  { errorCategory: 'unknown_remote_outcome', requiresResolution: false, remoteOutcomeUnknown: true },
                  currentAttemptId
                );
              } else {
                await syncRepository.recordReconcileDeferred(item.id, currentAttemptId, {
                  message: `Escrita no ledger com resultado desconhecido e leitura de verificação indisponível: ${err.message}`,
                  now: this._now()
                });
                deferredCount++;
              }
              failedCount++;
            } else {
              const isPermanent = !errInfo.shouldRetry || isLedger || isConflict;
              await syncRepository.markFailed(
                item.id,
                err.message,
                5,
                isPermanent,
                {
                  errorCategory: isConflict ? (err.errorCategory || 'payload_divergence_conflict') : (isLedger ? (readbackDivergent ? 'payload_divergence_conflict' : 'unknown_remote_outcome') : errInfo.category),
                  requiresResolution: isConflict || isLedger ? true : undefined
                },
                currentAttemptId
              );
              failedCount++;
            }
          }
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
      failed: failedCount,
      reconcileDeferred: deferredCount
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
   * Procedimento de Inspeção de Operações Bloqueadas (FASE 14.11 / Plano H):
   * Permite consultar o estado conhecido da operação, tenant original, payload local,
   * registro remoto existente e divergências detectadas sem expor dados de outro tenant.
   * @param {string} itemId
   * @param {Object} [options={}]
   * @returns {Promise<Object>} Diagnóstico estruturado da operação
   */
  async inspectOutboxItem(itemId, options = {}) {
    const auth = options.authService || this.authService || authService;
    const item = await syncRepository.findById(itemId);
    if (!item) {
      throw new Error(`Item da Outbox com ID "${itemId}" não encontrado.`);
    }

    const activeTenant = auth ? auth.getTenantId() : null;
    if (activeTenant && item.tenantId && item.tenantId !== activeTenant) {
      throw new Error(`Acesso negado: o item pertence ao tenant "${item.tenantId}", mas a sessão ativa é "${activeTenant}".`);
    }

    let remoteRecord = null;
    let readError = null;

    if (this.provider && typeof this.provider.get === 'function') {
      try {
        remoteRecord = await this.provider.get(item.entityType, item.entityId);
      } catch (err) {
        readError = err;
      }
    }

    const comparison = classifyRemoteOutcome({
      entityType: item.entityType,
      entityId: item.entityId,
      localPayload: item.payload,
      remoteRecord,
      readError
    });

    return {
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      tenantId: item.tenantId,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError,
      errorCategory: item.errorCategory,
      permanentFailure: item.permanentFailure,
      requiresResolution: item.requiresResolution,
      remoteOutcomeUnknown: item.remoteOutcomeUnknown,
      remoteAckReceived: item.remoteAckReceived,
      canonicalPayloadHash: item.canonicalPayloadHash,
      localPayload: item.payload,
      remoteRecord,
      comparisonOutcome: comparison.outcome,
      isEquivalent: comparison.isEquivalent,
      divergentFields: comparison.divergentFields,
      comparisonReason: comparison.reason
    };
  }

  /**
   * Procedimento de Reconciliação Manual Controlada (FASE 14.11 / Plano H):
   * Registra e executa uma decisão administrativa auditada sobre uma operação bloqueada:
   * - 'ACCEPT_REMOTE': Aceita versão remota autoritativa e finaliza localmente como SYNCED;
   * - 'OVERWRITE_REMOTE': Libera sobrescrita controlada (proibido para ledger append-only);
   * - 'DISCARD_LOCAL': Descarta mutação local inválida / abandonada;
   * - 'RETRY_CONFIRMED': Reativa para novo envio preservando estritamente entityId e payload.
   * @param {string} itemId
   * @param {'ACCEPT_REMOTE'|'OVERWRITE_REMOTE'|'DISCARD_LOCAL'|'RETRY_CONFIRMED'} decision
   * @param {Object} [options={}]
   * @returns {Promise<{ success: boolean, item: Object, decision: string }>}
   */
  async reconcileOutboxItem(itemId, decision, options = {}) {
    const auth = options.authService || this.authService || authService;
    const session = options.session || (auth ? auth.getCurrentSession() : null);

    if (!session || (session.role !== 'admin' && session.appRole !== 'admin')) {
      throw new Error('Permissão negada: reconciliação manual da Outbox exige papel "admin".');
    }

    const item = await syncRepository.findById(itemId);
    if (!item) {
      throw new Error(`Item da Outbox com ID "${itemId}" não encontrado.`);
    }

    const activeTenant = auth ? auth.getTenantId() : session.tenantId;
    if (activeTenant && item.tenantId && item.tenantId !== activeTenant) {
      throw new Error(`Violação de isolamento multi-tenant na reconciliação.`);
    }

    const now = new Date().toISOString();
    const reason = options.reason || 'Reconciliação administrativa manual';

    switch (decision) {
      case 'ACCEPT_REMOTE': {
        item.status = 'SYNCED';
        item.remoteAckReceived = true;
        item.remoteOutcomeUnknown = false;
        item.requiresResolution = false;
        item.permanentFailure = false;
        item.reconciledByAdminUid = session.uid;
        item.reconciliationDecision = 'ACCEPT_REMOTE';
        item.reconciliationReason = reason;
        item.reconciledAt = now;
        item.updatedAt = now;
        await syncRepository.update(item);
        return { success: true, item, decision: 'ACCEPT_REMOTE' };
      }

      case 'OVERWRITE_REMOTE': {
        if (item.entityType === 'stockMovements' || item.entityType === 'inventory') {
          throw new Error('Operação inválida: o ledger de estoque é append-only e imutável. Sobrescrita remota proibida.');
        }
        item.status = 'PENDING';
        item.attempts = 0;
        item.permanentFailure = false;
        item.requiresResolution = false;
        item.remoteOutcomeUnknown = false;
        item.reconciledByAdminUid = session.uid;
        item.reconciliationDecision = 'OVERWRITE_REMOTE';
        item.reconciliationReason = reason;
        item.reconciledAt = now;
        item.updatedAt = now;
        await syncRepository.update(item);
        return { success: true, item, decision: 'OVERWRITE_REMOTE' };
      }

      case 'DISCARD_LOCAL': {
        item.status = 'FAILED';
        item.permanentFailure = true;
        item.requiresResolution = false;
        item.discardedByAdmin = true;
        item.reconciledByAdminUid = session.uid;
        item.reconciliationDecision = 'DISCARD_LOCAL';
        item.reconciliationReason = reason;
        item.reconciledAt = now;
        item.updatedAt = now;
        await syncRepository.update(item);
        return { success: true, item, decision: 'DISCARD_LOCAL' };
      }

      case 'RETRY_CONFIRMED': {
        item.status = 'PENDING';
        item.attempts = 0;
        item.permanentFailure = false;
        item.requiresResolution = false;
        item.remoteOutcomeUnknown = false;
        item.reconciledByAdminUid = session.uid;
        item.reconciliationDecision = 'RETRY_CONFIRMED';
        item.reconciliationReason = reason;
        item.reconciledAt = now;
        item.updatedAt = now;
        await syncRepository.update(item);
        return { success: true, item, decision: 'RETRY_CONFIRMED' };
      }

      default:
        throw new Error(`Decisão de reconciliação inválida: "${decision}". Esperado: ACCEPT_REMOTE, OVERWRITE_REMOTE, DISCARD_LOCAL, RETRY_CONFIRMED.`);
    }
  }

  /**
   * Reconciliação automática de item com resultado remoto desconhecido via consulta direta ao provedor.
   * Diferencia:
   * - RECORD_EQUIVALENT: mutação já aplicada remotamente -> finaliza como SYNCED sem re-escrever;
   * - RECORD_ABSENT: mutação nunca gravada remotamente -> seguro transicionar para PENDING para despacho limpo;
   * - RECORD_DIVERGENT: payload divergente existente -> bloqueia com FAILED e requiresResolution: true.
   * @param {string} itemId
   * @returns {Promise<{ reconciled: boolean, outcome: string, item: Object }>}
   */
  async autoReconcileUnknownOutboxItem(itemId) {
    const item = await syncRepository.findById(itemId);
    if (!item) throw new Error(`Item ${itemId} não encontrado.`);
    if (!this.provider || typeof this.provider.get !== 'function') {
      return { reconciled: false, outcome: 'NO_PROVIDER_GET', item };
    }

    let remoteRecord = null;
    let readError = null;
    try {
      remoteRecord = await this.provider.get(item.entityType, item.entityId);
    } catch (err) {
      readError = err;
    }

    const comparison = classifyRemoteOutcome({
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action || 'CREATE',
      localPayload: item.payload?.tenantId ? item.payload : { ...item.payload, tenantId: item.tenantId },
      remoteRecord,
      readError,
      expectedBaseVersion: item.payload?.baseVersion ?? item.payload?.expectedBaseVersion
    });

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT) {
      item.status = 'SYNCED';
      item.remoteAckReceived = true;
      item.remoteOutcomeUnknown = false;
      item.inFlightInterrupted = false;
      item.inFlight = false;
      item.requiresResolution = false;
      item.permanentFailure = false;
      await syncRepository.update(item);
      await this._reconcileLocalProductVersion(item);
      return { reconciled: true, outcome: 'RECORD_EQUIVALENT', item };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED) {
      item.status = 'SYNCED';
      item.remoteAckReceived = true;
      item.remoteOutcomeUnknown = false;
      item.inFlightInterrupted = false;
      item.inFlight = false;
      item.requiresResolution = false;
      item.permanentFailure = false;
      item.syncedAt = new Date().toISOString();
      await syncRepository.update(item);
      return { reconciled: true, outcome: 'ALREADY_DELETED', item };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.UPDATE_ON_ABSENT_RECORD) {
      item.status = 'FAILED';
      item.requiresResolution = true;
      item.permanentFailure = true;
      item.errorCategory = 'missing_record';
      item.lastError = `Tentativa de UPDATE sobre registro inexistente no servidor remoto: ${comparison.reason}`;
      await syncRepository.update(item);
      return { reconciled: false, outcome: 'UPDATE_ON_ABSENT_RECORD', item };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT) {
      item.status = 'PENDING';
      item.remoteOutcomeUnknown = false;
      item.remoteAckReceived = false;
      item.dispatchStarted = false;
      item.inFlightInterrupted = false;
      item.inFlight = false;
      item.requiresResolution = false;
      item.permanentFailure = false;
      item.reconcileAttempts = 0;
      item.nextReconcileAt = null;
      item.lastReconcileOutcome = 'RECORD_ABSENT';
      item.lastReconcileAt = new Date(this._now()).toISOString();
      await syncRepository.update(item, { isTechnicalUpdate: true });
      return { reconciled: true, outcome: 'RECORD_ABSENT', item };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT || comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT) {
      item.status = 'FAILED';
      item.requiresResolution = true;
      item.permanentFailure = true;
      item.errorCategory = comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT ? 'version_conflict' : 'payload_divergence_conflict';
      item.lastError = `Conflito detectado na reconciliação: ${comparison.reason}`;
      await syncRepository.update(item);
      return { reconciled: false, outcome: comparison.outcome, item };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED) {
      item.status = 'FAILED';
      item.requiresResolution = true;
      item.permanentFailure = true;
      item.errorCategory = 'security';
      item.lastError = `Leitura remota de reconciliação rejeitada por permissão: ${readError?.message || comparison.reason}`;
      await syncRepository.update(item);
      return { reconciled: false, outcome: 'PERMISSION_DENIED', item, error: readError };
    }

    if (comparison.outcome === REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE) {
      // FASE 14.23: falha de LEITURA não é ausência e não autoriza reenvio da escrita.
      // O item permanece PENDING + remoteOutcomeUnknown com backoff de reconciliação;
      // após o limite de tentativas de leitura, é bloqueado para resolução.
      const deferred = await syncRepository.recordReconcileDeferred(item.id, null, {
        message: `Servidor remoto inacessível durante verificação: ${readError?.message || comparison.reason}`,
        now: this._now()
      });
      return { reconciled: false, outcome: 'INACCESSIBLE', item: deferred.item || item, error: readError, escalated: Boolean(deferred.escalated) };
    }

    return { reconciled: false, outcome: comparison.outcome, item };
  }

  /**
   * Reconcilia automaticamente todos os itens com resultado remoto desconhecido.
   * @returns {Promise<{ reconciledCount: number, blockedCount: number, absentCount: number }>}
   */
  async reconcileAllUnknownItems() {
    const all = await syncRepository.findAll(false);
    const unknownItems = all.filter(item => item.remoteOutcomeUnknown || item.inFlightInterrupted);
    let reconciledCount = 0;
    let blockedCount = 0;
    let absentCount = 0;

    for (const item of unknownItems) {
      const res = await this.autoReconcileUnknownOutboxItem(item.id);
      if (res.outcome === 'RECORD_EQUIVALENT') reconciledCount++;
      else if (res.outcome === 'RECORD_ABSENT') absentCount++;
      else if (res.outcome === 'RECORD_DIVERGENT') blockedCount++;
    }

    return { reconciledCount, blockedCount, absentCount };
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
      providerName: (this.provider && typeof this.provider.getProviderName === 'function') ? this.provider.getProviderName() : 'Nenhum',
      autoSync: this.autoSync,
      lastSyncTimestamp: this.lastSyncTimestamp
    };
  }

  async _emitStatus() {
    const stats = await this.getStats();
    eventBus.emit(EVENTS.SYNC_STATUS_CHANGED, stats);
  }
}

export const syncEngine = new SyncEngine();
