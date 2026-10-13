import { computeImageHash } from './ImageManifestService.js';
import { localImageCache } from './LocalImageCache.js';
import { imageManifestRepository } from '../repositories/ImageManifestRepository.js';
import { imageManifestService } from './ImageManifestService.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { eventBus, EVENTS } from '../eventBus.js';

/**
 * Níveis formais de prioridade da fila de sincronização de imagens (PHASE 07).
 */
export const SYNC_PRIORITY = Object.freeze({
  P1: 100, // Produto atual em visualização ativa (máxima prioridade)
  P2: 50,  // Categoria atual exibida na tela
  P3: 10   // Restante do catálogo (sincronização gradual em background)
});

/**
 * Estados do ciclo de vida de um item na fila de download.
 */
export const QUEUE_STATE = Object.freeze({
  QUEUED: 'QUEUED',
  DOWNLOADING: 'DOWNLOADING',
  VALIDATING: 'VALIDATING',
  SAVING: 'SAVING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED'
});

/**
 * Políticas de rede para controle de tráfego de dados e Wi-Fi.
 */
export const NETWORK_POLICY = Object.freeze({
  AUTO_WIFI: 'AUTO_WIFI',         // Wi-Fi: P1, P2, P3. Dados móveis: P1 apenas.
  ON_DEMAND_ONLY: 'ON_DEMAND_ONLY', // Apenas P1 (sob demanda explícita).
  AUTO_ALWAYS: 'AUTO_ALWAYS',     // P1, P2, P3 em qualquer rede conectada.
  DISABLED: 'DISABLED'            // Downloads suspensos.
});

/**
 * Eventos dedicados do barramento para o ImageSyncService.
 */
export const IMAGE_SYNC_EVENTS = Object.freeze({
  IMAGE_SYNC_STARTED: 'IMAGE_SYNC_STARTED',
  IMAGE_SYNC_PROGRESS: 'IMAGE_SYNC_PROGRESS',
  IMAGE_DOWNLOADED: 'IMAGE_DOWNLOADED',
  IMAGE_SYNC_PAUSED: 'IMAGE_SYNC_PAUSED',
  IMAGE_SYNC_RESUMED: 'IMAGE_SYNC_RESUMED',
  IMAGE_SYNC_COMPLETED: 'IMAGE_SYNC_COMPLETED',
  IMAGE_SYNC_ERROR: 'IMAGE_SYNC_ERROR'
});

/**
 * GestãoPro — ImageSyncService (PHASE 07)
 *
 * Responsável por:
 * - Orquestração da fila de downloads sob demanda e catálogo;
 * - Priorização inteligente de 3 níveis (P1: Produto atual, P2: Categoria, P3: Catálogo);
 * - Priorização de fotos principais (`isPrimary = true`) dentro de P1;
 * - Concorrência controlada (padrão: 2 downloads simultâneos);
 * - Deduplicação rigorosa e promoção dinâmica de prioridade (P3 -> P1);
 * - Validação de integridade SHA-256 e proteção contra versões desatualizadas;
 * - Pausa e retomada automática com base em conectividade (offline / online);
 * - Políticas de rede (Wi-Fi vs Dados Móveis vs SaveData);
 * - Proteção de cota de armazenamento e integração com evicção;
 * - Prevenção absoluta de loops de sincronização com o banco de dados.
 */
export class ImageSyncService {
  constructor(options = {}) {
    this.storageProvider = options.storageProvider || null;
    this._providers = new Map();
    if (options.providers && typeof options.providers === 'object') {
      for (const [pName, pInst] of Object.entries(options.providers)) {
        this._providers.set(pName.toLowerCase(), pInst);
      }
    }
    if (this.storageProvider) {
      this.setStorageProvider(this.storageProvider);
    }
    this.imageCache = options.imageCache || localImageCache;
    this.manifestService = options.manifestService || imageManifestService;
    this.manifestRepository = options.manifestRepository || imageManifestRepository;
    this.settingsRepo = options.settingsRepo || settingsRepository;
    this.eventBus = options.eventBus || eventBus;

    // Fila estruturada: Map<string, Object> (chave: `${tenantId}:${photoId}`)
    this._queue = new Map();

    // Controle de concorrência e tarefas ativas
    this.concurrency = typeof options.concurrency === 'number' ? options.concurrency : 2;
    this.maxAttempts = typeof options.maxAttempts === 'number' ? options.maxAttempts : 3;
    this._activeDownloads = new Map(); // key -> { item, abortController, promise }
    this._isProcessing = false;

    // Conectividade e estado da fila
    this.isOnline = typeof options.isOnline === 'boolean'
      ? options.isOnline
      : (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true);
    this.isPaused = false;

    // Políticas de rede e cotas
    this.networkPolicy = options.networkPolicy || NETWORK_POLICY.AUTO_WIFI;
    this.quotaThreshold = typeof options.quotaThreshold === 'number' ? options.quotaThreshold : 0.85; // 85% de disco

    // Métricas e telemetria
    this._completedCount = 0;
    this._failedCount = 0;
    this._currentPhotoId = null;
    this._currentPriority = null;

    // Overrides para simulação em testes
    this._networkTypeOverride = null;
    this._saveDataOverride = null;

    // Listeners do ciclo de vida para cleanup
    this._boundListeners = [];
    this._initLifecycleListeners();
  }

  /**
   * Configura o provedor de armazenamento remoto de fotos.
   * @param {ImageStorageProvider} provider 
   * @param {string} [name]
   */
  setStorageProvider(provider, name = null) {
    this.storageProvider = provider;
    if (!this._providers) this._providers = new Map();
    this._providers.set('default', provider);
    if (name) {
      this._providers.set(String(name).toLowerCase(), provider);
    } else if (provider && typeof provider.getProviderName === 'function') {
      const pName = provider.getProviderName().toLowerCase();
      if (pName.includes('supabase')) this._providers.set('supabase', provider);
      if (pName.includes('firebase')) this._providers.set('firebase', provider);
      if (pName.includes('cloudinary')) this._providers.set('cloudinary', provider);
      if (pName.includes('mock')) this._providers.set('mock', provider);
    }
  }

  /**
   * Registra um provedor adicional pelo identificador.
   * @param {string} name
   * @param {ImageStorageProvider} provider
   */
  registerProvider(name, provider) {
    if (!this._providers) this._providers = new Map();
    if (name && provider) {
      this._providers.set(String(name).toLowerCase(), provider);
    }
  }

  /**
   * Resolve o provedor de storage adequado para o item com base no manifesto ou padrão.
   * @private
   * @param {Object} item
   * @returns {ImageStorageProvider|null}
   */
  _resolveProvider(item) {
    if (item && item.storageProvider && this._providers) {
      const key = String(item.storageProvider).toLowerCase();
      if (this._providers.has(key)) {
        return this._providers.get(key);
      }
    }
    return this.storageProvider;
  }

  /**
   * Ajusta o limite de downloads simultâneos.
   * @param {number} n 
   */
  setConcurrency(n) {
    if (typeof n === 'number' && n > 0) {
      this.concurrency = Math.floor(n);
    }
  }

  /**
   * Ajusta a política de rede para downloads automáticos.
   * @param {string} policy 
   */
  setNetworkPolicy(policy) {
    if (Object.values(NETWORK_POLICY).includes(policy)) {
      this.networkPolicy = policy;
    }
  }

  /**
   * Ajusta o limiar de uso de cota de armazenamento antes de pausar P3.
   * @param {number} threshold Valor entre 0.1 e 0.99
   */
  setQuotaThreshold(threshold) {
    if (typeof threshold === 'number' && threshold > 0 && threshold < 1) {
      this.quotaThreshold = threshold;
    }
  }

  /**
   * Força o estado de conectividade (útil para testes unitários ou desacoplamento).
   * @param {boolean} online 
   */
  setOnline(online) {
    const prev = this.isOnline;
    this.isOnline = !!online;

    if (prev && !this.isOnline) {
      this._handleOffline();
    } else if (!prev && this.isOnline) {
      this._handleOnline();
    }
  }

  /**
   * Override do tipo de conexão para testes (ex: 'wifi', 'cellular').
   * @param {string|null} type 
   */
  setNetworkTypeOverride(type) {
    this._networkTypeOverride = type;
  }

  /**
   * Override do modo de economia de dados para testes.
   * @param {boolean|null} val 
   */
  setSaveDataOverride(val) {
    this._saveDataOverride = val;
  }

  /**
   * Verifica se o dispositivo está conectado em rede móvel ou com restrições.
   * @returns {boolean}
   */
  isMobileConnection() {
    if (this._networkTypeOverride !== null) {
      return this._networkTypeOverride === 'cellular' || this._networkTypeOverride === 'mobile';
    }

    if (typeof navigator !== 'undefined' && navigator.connection) {
      const type = navigator.connection.type;
      const effectiveType = navigator.connection.effectiveType;
      if (type === 'cellular') return true;
      if (type === 'wifi' || type === 'ethernet') return false;
      // Heurística de tipo efetivo se type for desconhecido
      if (effectiveType === '2g' || effectiveType === '3g') return true;
    }
    return false;
  }

  /**
   * Verifica se o modo SaveData (economia de dados) do usuário está ativo.
   * @returns {boolean}
   */
  isSaveDataEnabled() {
    if (this._saveDataOverride !== null) {
      return !!this._saveDataOverride;
    }
    if (typeof navigator !== 'undefined' && navigator.connection) {
      return !!navigator.connection.saveData;
    }
    return false;
  }

  /**
   * Determina se itens com determinada prioridade podem ser processados sob a política atual.
   * @param {number} priority 
   * @returns {boolean}
   */
  canProcessPriority(priority) {
    if (this.networkPolicy === NETWORK_POLICY.DISABLED) {
      return false;
    }

    // P1 (Produto atual em foco) SEMPRE é permitido quando há conectividade
    if (priority >= SYNC_PRIORITY.P1) {
      return true;
    }

    // Se o usuário solicitou economia de dados, P2 e P3 ficam restritos
    if (this.isSaveDataEnabled()) {
      return false;
    }

    // Política explícita sob demanda: apenas P1
    if (this.networkPolicy === NETWORK_POLICY.ON_DEMAND_ONLY) {
      return false;
    }

    // Política irrestrita: aceita P1, P2 e P3
    if (this.networkPolicy === NETWORK_POLICY.AUTO_ALWAYS) {
      return true;
    }

    // Política AUTO_WIFI (padrão): P2 e P3 só executam em Wi-Fi/Ethernet
    if (this.networkPolicy === NETWORK_POLICY.AUTO_WIFI) {
      if (this.isMobileConnection()) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Enfileira uma foto para download e processamento.
   * Implementa deduplicação automática e promoção de prioridade.
   *
   * @param {Object} itemParams
   * @param {string} itemParams.photoId
   * @param {string} itemParams.productId
   * @param {string} [itemParams.tenantId='default_tenant']
   * @param {number} [itemParams.priority=SYNC_PRIORITY.P3]
   * @param {boolean} [itemParams.isPrimary=false]
   * @param {number} [itemParams.expectedVersion=1]
   * @param {string} [itemParams.expectedHash]
   * @param {string} [itemParams.url]
   * @param {string} [itemParams.thumbnailUrl]
   * @param {string} [itemParams.remotePath]
   * @param {string} [itemParams.reason='catalog_sync']
   * @returns {Object} O item enfileirado ou atualizado
   */
  enqueue(itemParams) {
    if (!itemParams || !itemParams.photoId || !itemParams.productId) {
      throw new Error('[ImageSyncService] photoId e productId são obrigatórios para enfileirar.');
    }

    const tenantId = String(itemParams.tenantId || 'default_tenant');
    const photoId = String(itemParams.photoId);
    const key = `${tenantId}:${photoId}`;
    const priority = typeof itemParams.priority === 'number' ? itemParams.priority : SYNC_PRIORITY.P3;
    const isPrimary = !!itemParams.isPrimary;
    const expectedVersion = Number(itemParams.expectedVersion || 1);
    const expectedHash = itemParams.expectedHash ? String(itemParams.expectedHash) : null;

    // 1. Verificar se o item já está na fila
    if (this._queue.has(key)) {
      const existing = this._queue.get(key);

      // Promoção de prioridade: P3 -> P1 ou P2 -> P1
      if (priority > existing.priority) {
        existing.priority = priority;
        existing.reason = itemParams.reason || existing.reason;
      }

      // Promoção de foto principal
      if (isPrimary && !existing.isPrimary) {
        existing.isPrimary = true;
      }

      // Atualização de versão esperada superior
      if (expectedVersion > existing.expectedVersion) {
        existing.expectedVersion = expectedVersion;
        existing.expectedHash = expectedHash || existing.expectedHash;
        existing.attempts = 0; // Reseta tentativas para nova versão
        if (existing.state === QUEUE_STATE.FAILED || existing.state === QUEUE_STATE.COMPLETED) {
          existing.state = QUEUE_STATE.QUEUED;
        }
      }

      // Se estava em erro ou pausado, e uma nova solicitação com prioridade superior chegou
      if ((existing.state === QUEUE_STATE.FAILED || existing.state === QUEUE_STATE.PAUSED) && priority >= SYNC_PRIORITY.P1) {
        existing.state = QUEUE_STATE.QUEUED;
        existing.attempts = 0;
        existing.retryAfter = null;
      }

      this.processQueue();
      return existing;
    }

    // 2. Novo item na fila
    const newItem = {
      id: key,
      photoId,
      productId: String(itemParams.productId),
      tenantId,
      priority,
      isPrimary,
      requestedAt: Date.now(),
      reason: itemParams.reason || 'catalog_sync',
      expectedVersion,
      expectedHash,
      url: itemParams.url || null,
      thumbnailUrl: itemParams.thumbnailUrl || null,
      remotePath: itemParams.remotePath || null,
      storageProvider: itemParams.storageProvider || null,
      state: QUEUE_STATE.QUEUED,
      attempts: 0,
      lastError: null,
      retryAfter: null
    };

    this._queue.set(key, newItem);
    this.processQueue();
    return newItem;
  }

  /**
   * Enfileira múltiplos itens em lote com disparo único de processamento.
   * @param {Array<Object>} items 
   * @returns {number} Quantidade de novos itens adicionados
   */
  enqueueMany(items = []) {
    if (!Array.isArray(items) || items.length === 0) return 0;
    let added = 0;
    for (const item of items) {
      if (item && item.photoId && item.productId) {
        this.enqueue(item);
        added++;
      }
    }
    this.processQueue();
    return added;
  }

  /**
   * Promove dinamicamente todas as fotos de um produto para uma nova prioridade (ex: P1).
   * @param {string} productId 
   * @param {number} [newPriority=SYNC_PRIORITY.P1]
   */
  reprioritize(productId, newPriority = SYNC_PRIORITY.P1) {
    if (!productId) return;
    let modified = false;

    for (const item of this._queue.values()) {
      if (item.productId === productId && item.state !== QUEUE_STATE.COMPLETED) {
        if (newPriority > item.priority) {
          item.priority = newPriority;
          modified = true;
        }
      }
    }

    if (modified) {
      this.processQueue();
    }
  }

  /**
   * Promove dinamicamente as fotos de produtos pertencentes a uma categoria (P2).
   * @param {string} categoryId 
   * @param {Array<string>} productIds 
   * @param {number} [newPriority=SYNC_PRIORITY.P2]
   */
  reprioritizeCategory(categoryId, productIds = [], newPriority = SYNC_PRIORITY.P2) {
    if (!Array.isArray(productIds) || productIds.length === 0) return;
    const set = new Set(productIds);
    let modified = false;

    for (const item of this._queue.values()) {
      if (set.has(item.productId) && item.state !== QUEUE_STATE.COMPLETED) {
        if (newPriority > item.priority) {
          item.priority = newPriority;
          item.reason = `category_${categoryId}`;
          modified = true;
        }
      }
    }

    if (modified) {
      this.processQueue();
    }
  }

  /**
   * Garante a disponibilidade local de todas as fotos necessárias de um produto (Sob Demanda — P1).
   * Consulta o manifesto local/remoto, adiciona fotos faltantes ou desatualizadas com P1
   * e prioriza a foto principal (`isPrimary = true`).
   *
   * @param {string} productId 
   * @param {Object} [options={}]
   * @param {string} [options.tenantId='default_tenant']
   * @param {Array<Object>} [options.remoteManifest] Metadados fornecidos externamente
   * @returns {Promise<{ queued: number, existingCount: number }>}
   */
  async ensureProductImages(productId, options = {}) {
    if (!productId) throw new Error('[ImageSyncService] productId obrigatório para ensureProductImages.');
    const tenantId = String(options.tenantId || 'default_tenant');

    // 1. Obter metadados das fotos deste produto no manifesto local
    let photos = await this.manifestRepository.findByProductId(productId);

    // Se fornecido um manifesto remoto explícito, mescla ou utiliza as fotos fornecidas
    if (Array.isArray(options.remoteManifest) && options.remoteManifest.length > 0) {
      const remotePhotos = options.remoteManifest.filter(p => p.productId === productId);
      if (remotePhotos.length > 0) {
        photos = remotePhotos;
      }
    }

    if (!photos || photos.length === 0) {
      return { queued: 0, existingCount: 0 };
    }

    let queuedCount = 0;
    let existingCount = 0;

    for (const photo of photos) {
      // Ignora fotos marcadas com exclusão lógica
      if (photo.deletedAt) continue;

      const hasValidCache = await this.imageCache.has(tenantId, photo.photoId, photo.version);
      if (hasValidCache) {
        existingCount++;
        continue;
      }

      // Enfileira com prioridade máxima P1
      this.enqueue({
        photoId: photo.photoId,
        productId: photo.productId,
        tenantId,
        priority: SYNC_PRIORITY.P1,
        isPrimary: !!photo.isPrimary,
        expectedVersion: photo.version,
        expectedHash: photo.hash,
        url: photo.url,
        thumbnailUrl: photo.thumbnailUrl,
        remotePath: photo.remotePath,
        storageProvider: photo.storageProvider,
        reason: 'on_demand_product'
      });
      queuedCount++;
    }

    return { queued: queuedCount, existingCount };
  }

  /**
   * Pausa a execução de novos downloads na fila.
   */
  pause() {
    this.isPaused = true;
    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_PAUSED, { reason: 'manual_pause' });
  }

  /**
   * Retoma o processamento da fila.
   */
  resume() {
    this.isPaused = false;
    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_RESUMED, { reason: 'manual_resume' });
    this.processQueue();
  }

  /**
   * Loop principal de despacho da fila de downloads.
   * Respeita a concorrência configurada, prioridades P1 > P2 > P3 e cotas de armazenamento.
   */
  async processQueue() {
    if (this._isProcessing) return;
    if (this.isPaused || !this.isOnline) return;

    this._isProcessing = true;

    try {
      while (!this.isPaused && this.isOnline && this._activeDownloads.size < this.concurrency) {
        const nextItem = await this._selectNextItem();
        if (!nextItem) {
          // Nenhum item elegível no momento
          break;
        }

        // Inicia download assíncrono gerenciado pelo worker pool
        this._dispatchItem(nextItem);
      }

      // Se não há downloads ativos e todos os itens foram processados, notifica conclusão
      if (this._activeDownloads.size === 0 && this._getQueuedCount() === 0 && this._queue.size > 0) {
        const allCompletedOrFailed = Array.from(this._queue.values()).every(
          it => it.state === QUEUE_STATE.COMPLETED || it.state === QUEUE_STATE.FAILED
        );
        if (allCompletedOrFailed) {
          this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_COMPLETED, {
            completed: this._completedCount,
            failed: this._failedCount,
            total: this._queue.size
          });
        }
      }
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Seleciona o próximo item mais prioritário e elegível para execução.
   * Regras de Ordenação:
   * 1. `priority` DESC (P1=100 > P2=50 > P3=10);
   * 2. `isPrimary` DESC (fotos principais primeiro dentro da mesma prioridade);
   * 3. `requestedAt` ASC (FIFO para desempate).
   *
   * @private
   * @returns {Promise<Object|null>}
   */
  async _selectNextItem() {
    const now = Date.now();
    const candidates = [];

    for (const item of this._queue.values()) {
      if (item.state !== QUEUE_STATE.QUEUED) continue;
      if (item.retryAfter && now < item.retryAfter) continue;

      // Validação de política de rede para este nível de prioridade
      if (!this.canProcessPriority(item.priority)) {
        continue;
      }

      candidates.push(item);
    }

    if (candidates.length === 0) return null;

    // Ordenação estrita por prioridade, foto principal e timestamp de solicitação
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.isPrimary !== a.isPrimary) return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      return a.requestedAt - b.requestedAt;
    });

    const candidate = candidates[0];

    // Proteção de Cota de Armazenamento para itens P3 (Catálogo geral em background)
    if (candidate.priority <= SYNC_PRIORITY.P3) {
      const quotaSafe = await this._checkQuotaForP3(candidate);
      if (!quotaSafe) {
        // P3 bloqueado por falta de espaço; retorna nulo para não descarregar P3 sem espaço
        return null;
      }
    }

    return candidate;
  }

  /**
   * Valida cota de disco antes de iniciar um item P3.
   * Se a cota estiver sob pressão (> threshold), tenta evicção de fotos COLD seguras.
   * Se mesmo assim não houver espaço seguro, bloqueia P3 para preservar o disco para vendas e estoque.
   *
   * @private
   * @param {Object} item 
   * @returns {Promise<boolean>}
   */
  async _checkQuotaForP3(item) {
    try {
      const estimate = await this.imageCache.getQuotaEstimate();
      if (!estimate || !estimate.supported) return true;

      if (estimate.percentUsed > this.quotaThreshold) {
        // Tenta liberar candidatos a descarte (COLD)
        const candidates = await this.imageCache.getEvictionCandidates(item.tenantId, { limit: 5 });
        if (candidates && candidates.length > 0) {
          for (const cand of candidates) {
            // NUNCA descarta fotos principais ou o próprio produto atual
            if (cand.isPrimary || cand.productId === item.productId) continue;
            await this.imageCache.remove(item.tenantId, cand.photoId, { purge: true });
          }
          // Reavalia cota após evicção
          const recheck = await this.imageCache.getQuotaEstimate();
          return recheck.percentUsed <= this.quotaThreshold;
        }
        return false;
      }
      return true;
    } catch (_) {
      return true;
    }
  }

  /**
   * Despacha o download de um item no pool de concorrência.
   * @private
   * @param {Object} item 
   */
  _dispatchItem(item) {
    item.state = QUEUE_STATE.DOWNLOADING;
    this._currentPhotoId = item.photoId;
    this._currentPriority = item.priority >= SYNC_PRIORITY.P1 ? 'P1' : (item.priority >= SYNC_PRIORITY.P2 ? 'P2' : 'P3');

    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_STARTED, {
      photoId: item.photoId,
      productId: item.productId,
      priority: item.priority
    });

    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const taskPromise = this._executeDownload(item, abortController)
      .catch((err) => {
        this._handleDownloadError(item, err);
      })
      .finally(() => {
        this._activeDownloads.delete(item.id);
        this.processQueue();
      });

    this._activeDownloads.set(item.id, { item, abortController, promise: taskPromise });
  }

  /**
   * Executa a cadeia completa: Download do Blob -> Validação SHA-256 -> Gravação no LocalImageCache.
   * @private
   * @param {Object} item 
   * @param {AbortController|null} abortController 
   */
  async _executeDownload(item, abortController) {
    const provider = this._resolveProvider(item);
    if (!provider) {
      throw new Error('[ImageSyncService] Provedor de armazenamento (storageProvider) não configurado.');
    }

    // 1. Download do Blob através do ImageStorageProvider
    let blob = null;
    const targetRef = item.remotePath || item.url;
    if (typeof provider.download === 'function') {
      blob = await provider.download(item.photoId, targetRef);
    } else {
      // Fallback via getUrl() + fetch
      const url = await provider.getUrl(item.photoId, targetRef);
      if (!url) throw new Error(`URL remota da foto ${item.photoId} indisponível.`);
      const response = await fetch(url, { signal: abortController ? abortController.signal : undefined });
      if (!response.ok) throw new Error(`HTTP ${response.status} ao obter foto.`);
      blob = await response.blob();
    }

    if (!blob) {
      throw new Error(`Blob vazio retornado para foto ${item.photoId}.`);
    }

    // 2. Validação Criptográfica de Integridade (SHA-256)
    item.state = QUEUE_STATE.VALIDATING;
    const computedHash = await computeImageHash(blob);

    if (item.expectedHash && computedHash !== item.expectedHash) {
      const integrityError = new Error(`INTEGRITY_ERROR: Hash recebido (${computedHash.slice(0, 8)}) diverge do manifesto (${item.expectedHash.slice(0, 8)})`);
      integrityError.code = 'INTEGRITY_ERROR';
      throw integrityError;
    }

    // 3. Gravação Atômica no LocalImageCache
    item.state = QUEUE_STATE.SAVING;
    await this.imageCache.put({
      photoId: item.photoId,
      productId: item.productId,
      tenantId: item.tenantId,
      blob,
      version: item.expectedVersion,
      hash: computedHash,
      isPrimary: item.isPrimary,
      label: item.reason === 'on_demand_product' ? 'Foto Principal' : 'Foto do Produto'
    });

    // 4. Conclusão com Sucesso
    item.state = QUEUE_STATE.COMPLETED;
    item.lastError = null;
    this._completedCount++;

    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_DOWNLOADED, {
      photoId: item.photoId,
      productId: item.productId,
      tenantId: item.tenantId,
      version: item.expectedVersion,
      isPrimary: item.isPrimary
    });

    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_PROGRESS, {
      photoId: item.photoId,
      productId: item.productId,
      state: QUEUE_STATE.COMPLETED,
      completed: this._completedCount,
      failed: this._failedCount,
      total: this._queue.size
    });
  }

  /**
   * Trata falhas de download classificando em erros permanentes vs temporários (com backoff exponencial).
   * @private
   * @param {Object} item 
   * @param {Error} err 
   */
  _handleDownloadError(item, err) {
    const isOffline = !this.isOnline || (err && (err.name === 'AbortError' || err.message?.includes('network')));

    // Se a falha ocorreu por perda de conexão no meio da requisição: não pune com tentativa definitiva
    if (isOffline) {
      item.state = QUEUE_STATE.QUEUED;
      item.lastError = 'Conexão interrompida (offline)';
      this.pause();
      return;
    }

    const isPermanent = this._isPermanentError(err);

    if (isPermanent) {
      item.state = QUEUE_STATE.FAILED;
      item.lastError = err.message;
      this._failedCount++;
      this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_ERROR, {
        photoId: item.photoId,
        productId: item.productId,
        error: err.message,
        code: err.code || 'PERMANENT_ERROR'
      });
      return;
    }

    // Erro temporário: aplica backoff exponencial (1s, 2s, 4s)
    item.attempts++;
    if (item.attempts >= this.maxAttempts) {
      item.state = QUEUE_STATE.FAILED;
      item.lastError = `Tentativas esgotadas (${this.maxAttempts}): ${err.message}`;
      this._failedCount++;
      this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_ERROR, {
        photoId: item.photoId,
        productId: item.productId,
        error: err.message,
        code: 'MAX_ATTEMPTS_EXCEEDED'
      });
    } else {
      const backoffMs = Math.pow(2, item.attempts - 1) * 1000;
      item.state = QUEUE_STATE.QUEUED;
      item.retryAfter = Date.now() + backoffMs;
      item.lastError = `Tentativa ${item.attempts} falhou: ${err.message}. Retentando em ${backoffMs / 1000}s.`;
    }
  }

  /**
   * Identifica se um erro é definitivo e não deve sofrer retentativas.
   * @private
   * @param {Error} err 
   * @returns {boolean}
   */
  _isPermanentError(err) {
    if (!err) return false;
    const msg = String(err.message || '').toLowerCase();
    const code = String(err.code || '');

    if (code === 'INTEGRITY_ERROR' || msg.includes('integrity_error') || msg.includes('hash recebido')) return true;
    if (code === 'NOT_FOUND' || msg.includes('404') || msg.includes('não encontrada')) return true;
    if (msg.includes('tipo de arquivo não permitido') || msg.includes('downgrade rejected')) return true;
    if (msg.includes('permission_denied') || msg.includes('permissão negada')) return true;

    return false;
  }

  /**
   * Manipulador para quando a conectividade é perdida.
   * @private
   */
  _handleOffline() {
    this.isPaused = true;
    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_PAUSED, { reason: 'network_offline' });

    // Aborta com segurança downloads em andamento e reseta estado para QUEUED
    for (const [key, active] of this._activeDownloads.entries()) {
      if (active.abortController) {
        try { active.abortController.abort(); } catch (_) {}
      }
      if (active.item && active.item.state === QUEUE_STATE.DOWNLOADING) {
        active.item.state = QUEUE_STATE.QUEUED;
      }
    }
    this._activeDownloads.clear();
  }

  /**
   * Manipulador para quando a conectividade retorna.
   * @private
   */
  _handleOnline() {
    this.isPaused = false;
    this.eventBus.emit(IMAGE_SYNC_EVENTS.IMAGE_SYNC_RESUMED, { reason: 'network_online' });
    this.processQueue();
  }

  /**
   * Registra ouvintes nativos para eventos de ciclo de vida (online, offline, foreground).
   * @private
   */
  _initLifecycleListeners() {
    if (typeof window !== 'undefined') {
      const onlineHandler = () => this.setOnline(true);
      const offlineHandler = () => this.setOnline(false);

      window.addEventListener('online', onlineHandler);
      window.addEventListener('offline', offlineHandler);
      this._boundListeners.push(
        () => window.removeEventListener('online', onlineHandler),
        () => window.removeEventListener('offline', offlineHandler)
      );

      // Sincronização ao retornar para primeiro plano (Foreground Sync)
      if (typeof document !== 'undefined') {
        const visibilityHandler = () => {
          if (document.visibilityState === 'visible' && this.isOnline) {
            this.processQueue();
          }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        this._boundListeners.push(() => document.removeEventListener('visibilitychange', visibilityHandler));
      }
    }
  }

  /**
   * Quantidade de itens aguardando na fila.
   * @private
   * @returns {number}
   */
  _getQueuedCount() {
    let count = 0;
    for (const item of this._queue.values()) {
      if (item.state === QUEUE_STATE.QUEUED) count++;
    }
    return count;
  }

  /**
   * Retorna snapshot completo do status operacional da sincronização de imagens.
   * @returns {Object}
   */
  getSyncStatus() {
    return {
      running: this._isProcessing || this._activeDownloads.size > 0,
      online: this.isOnline,
      paused: this.isPaused,
      queued: this._getQueuedCount(),
      active: this._activeDownloads.size,
      completed: this._completedCount,
      failed: this._failedCount,
      currentPhotoId: this._currentPhotoId,
      currentPriority: this._currentPriority,
      networkPolicy: this.networkPolicy,
      concurrency: this.concurrency
    };
  }

  /**
   * Retorna os itens ativos e pendentes da fila (sem carregar Blobs na memória).
   * @returns {Array<Object>}
   */
  getQueue() {
    return Array.from(this._queue.values()).map(it => ({ ...it }));
  }

  /**
   * Limpa itens concluídos, cancelados ou com erro da fila em memória.
   * Não afeta o LocalImageCache.
   */
  clearCompleted() {
    for (const [key, item] of this._queue.entries()) {
      if (item.state === QUEUE_STATE.COMPLETED || item.state === QUEUE_STATE.CANCELLED) {
        this._queue.delete(key);
      }
    }
  }

  /**
   * Limpa completamente a fila em memória (útil para testes unitários).
   */
  clearQueue() {
    for (const active of this._activeDownloads.values()) {
      if (active.abortController) {
        try { active.abortController.abort(); } catch (_) {}
      }
    }
    this._activeDownloads.clear();
    this._queue.clear();
    this._completedCount = 0;
    this._failedCount = 0;
    this._currentPhotoId = null;
    this._currentPriority = null;
  }

  /**
   * Reconstitui a fila de download a partir do manifesto local e do cache físico.
   * Utilizado na reinicialização da aplicação ou ao carregar novo tenant.
   *
   * @param {string} tenantId 
   * @returns {Promise<number>} Quantidade de itens reintegrados à fila
   */
  async reconstructFromManifest(tenantId = 'default_tenant') {
    const manifestItems = await this.manifestRepository.findByTenantId(tenantId);
    if (!manifestItems || manifestItems.length === 0) return 0;

    let enqueued = 0;
    for (const item of manifestItems) {
      if (item.deletedAt) continue;

      const cached = await this.imageCache.has(tenantId, item.photoId, item.version);
      if (!cached) {
        this.enqueue({
          photoId: item.photoId,
          productId: item.productId,
          tenantId,
          priority: SYNC_PRIORITY.P3,
          isPrimary: !!item.isPrimary,
          expectedVersion: item.version,
          expectedHash: item.hash,
          url: item.url,
          thumbnailUrl: item.thumbnailUrl,
          reason: 'restart_recovery'
        });
        enqueued++;
      }
    }

    return enqueued;
  }

  /**
   * Desativa listeners globais, cancela downloads em voo e libera recursos.
   */
  destroy() {
    this.pause();
    this._boundListeners.forEach(fn => {
      try { fn(); } catch (_) {}
    });
    this._boundListeners = [];
    this.clearQueue();
  }
}

// Exporta singleton de aplicação
export const imageSyncService = new ImageSyncService();
