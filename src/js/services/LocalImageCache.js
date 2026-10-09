import { getDB } from '../db/connection.js';
import { executeTransaction } from '../db/transactions.js';
import { computeImageHash, normalizeImageMetadata } from './ImageManifestService.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { imageManifestRepository } from '../repositories/ImageManifestRepository.js';

/**
 * Categorias de Retenção de Cache Local (PHASE 06).
 */
export const RETENTION_CATEGORY = Object.freeze({
  HOT: 'HOT',   // Acessada nos últimos 7 dias
  WARM: 'WARM', // Acessada entre 7 e 30 dias
  COLD: 'COLD'  // Não acessada há mais de 30 dias (candidata a evicção futura)
});

/**
 * GestãoPro — LocalImageCache (PHASE 06)
 *
 * Responsável pelo armazenamento persistente de imagens e thumbnails no cliente:
 * - Fonte Primária de Binários: IndexedDB (stores `productImages` e `imageManifest`);
 * - Zero Duplicação: Não duplica Blobs no Cache Storage da Service Worker;
 * - Validação de Integridade: Checksum SHA-256 verificado antes da gravação;
 * - Proteção contra Downgrade: Bloqueia substituição por versões antigas;
 * - Transacional e Atômico: Rollback automático em caso de falha de gravação;
 * - Gerenciamento de Object URLs: Rastreamento e revogação sem vazamentos de memória;
 * - Isolamento Multi-Tenant estrito: Tenant B não acessa fotos de Tenant A;
 * - Controle e Estimativa de Quota: Suporte a `navigator.storage.estimate()`.
 */
export class LocalImageCache {
  constructor() {
    // Rastreamento ativo de Object URLs para evitar vazamento de memória (Memory Leak Prevention)
    this._activeUrls = new Map(); // url -> { photoId, size, createdAt }

    // Throttle de atualização de lastAccessedAt para não sobrecarregar I/O do IndexedDB
    this._accessThrottle = new Map(); // photoId -> timestamp

    // Simulação opcional de cota para testes de ambiente controlado
    this._simulatedQuotaLimit = null;
  }

  /**
   * Define um limite artificial de cota para testes automatizados.
   * @param {number|null} bytes 
   */
  setSimulatedQuotaLimit(bytes) {
    this._simulatedQuotaLimit = typeof bytes === 'number' ? bytes : null;
  }

  /**
   * Armazena uma imagem e seu thumbnail de forma atômica no cache local.
   * Valida integridade criptográfica SHA-256 e previne downgrades de versão.
   *
   * @param {Object} params
   * @param {string} params.photoId
   * @param {string} params.productId
   * @param {string} [params.tenantId='default_tenant']
   * @param {Blob} params.blob Imagem completa otimizada (WebP)
   * @param {Blob} [params.thumbnailBlob] Thumbnail otimizado (320px)
   * @param {number} [params.version=1] Versão sequencial da imagem
   * @param {string} [params.hash] Checksum SHA-256 da imagem
   * @param {string} [params.expectedHash] Hash esperado para validação estrita
   * @param {number} [params.width] Largura da imagem em pixels
   * @param {number} [params.height] Altura da imagem em pixels
   * @param {string} [params.mimeType='image/webp']
   * @param {boolean} [params.isPrimary=false]
   * @param {string} [params.label='Foto do Produto']
   * @param {boolean} [params.overwrite=true]
   * @returns {Promise<Object>} Resumo do registro armazenado
   */
  async put(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('[LocalImageCache] Parâmetros inválidos para gravação.');
    }

    const photoId = String(params.photoId || params.id || '');
    const productId = String(params.productId || '');
    const tenantId = String(params.tenantId || 'default_tenant');

    if (!photoId) throw new Error('[LocalImageCache] photoId é obrigatório.');
    if (!productId) throw new Error('[LocalImageCache] productId é obrigatório.');
    if (!params.blob && !params.thumbnailBlob) {
      throw new Error('[LocalImageCache] Blob da imagem ou do thumbnail é obrigatório.');
    }

    const mainBlob = params.blob || params.thumbnailBlob;
    const thumbBlob = params.thumbnailBlob || params.blob;
    const version = typeof params.version === 'number' && params.version > 0 ? params.version : 1;

    // 1. Validação Criptográfica de Integridade (SHA-256)
    const computedHash = await computeImageHash(mainBlob);

    if (params.expectedHash && params.expectedHash !== computedHash) {
      throw new Error(`[LocalImageCache] Falha de integridade: hash da imagem (${computedHash}) diverge do hash esperado (${params.expectedHash}).`);
    }

    if (params.hash && params.hash !== computedHash) {
      throw new Error(`[LocalImageCache] Falha de integridade: checksum calculado (${computedHash}) diverge do hash fornecido (${params.hash}).`);
    }

    // 2. Verificação de versão atual em cache (Proteção contra Downgrade)
    const existing = await this.get(photoId, { tenantId, touch: false });
    if (existing) {
      if (version < existing.version) {
        throw new Error(`[LocalImageCache] Downgrade bloqueado: versão informada (v${version}) é inferior à versão atual em cache (v${existing.version}).`);
      }

      // Se for rigorosamente a mesma versão e mesmo hash, é um put duplicado idempotente
      if (version === existing.version && computedHash === existing.hash) {
        this.touch(photoId);
        return {
          photoId,
          productId,
          tenantId,
          version: existing.version,
          hash: existing.hash,
          sizeBytes: existing.sizeBytes,
          isDuplicate: true,
          cachedAt: existing.cachedAt || Date.now()
        };
      }
    }

    // 3. Verificação de Cota de Disco
    const requiredBytes = (mainBlob.size || 0) + (thumbBlob.size || 0);
    await this._assertQuotaAvailable(requiredBytes);

    const now = Date.now();
    const sizeBytes = mainBlob.size || 0;
    const width = typeof params.width === 'number' ? params.width : 0;
    const height = typeof params.height === 'number' ? params.height : 0;
    const mimeType = params.mimeType || mainBlob.type || 'image/webp';
    const isPrimary = !!params.isPrimary;
    const label = params.label ? String(params.label) : 'Foto do Produto';

    // 4. Gravação Atômica nas stores `productImages` e `imageManifest`
    const productImgRecord = {
      id: photoId,
      photoId,
      productId,
      tenantId,
      blob: mainBlob,
      thumbnailBlob: thumbBlob,
      width,
      height,
      mimeType,
      sizeBytes,
      isPrimary,
      label,
      version,
      hash: computedHash,
      cachedAt: now,
      lastAccessedAt: now,
      deletedAt: null,
      createdAt: existing?.createdAt || new Date(now).toISOString()
    };

    const manifestRecord = normalizeImageMetadata({
      photoId,
      id: photoId,
      productId,
      tenantId,
      url: params.url || existing?.url || '',
      thumbnailUrl: params.thumbnailUrl || existing?.thumbnailUrl || '',
      version,
      hash: computedHash,
      width,
      height,
      sizeBytes,
      mimeType,
      isPrimary,
      label,
      updatedAt: now,
      deletedAt: null
    });

    await executeTransaction(['productImages', 'imageManifest'], 'readwrite', async (stores) => {
      await stores.productImages.put(productImgRecord);
      await stores.imageManifest.put(manifestRecord);
    });

    return {
      photoId,
      productId,
      tenantId,
      version,
      hash: computedHash,
      sizeBytes,
      width,
      height,
      mimeType,
      isPrimary,
      label,
      cachedAt: now,
      lastAccessedAt: now
    };
  }

  /**
   * Recupera um registro de imagem em cache pelo photoId.
   * Aplica isolamento multi-tenant e atualiza lastAccessedAt sob throttle.
   *
   * @param {string} photoId
   * @param {Object} [options]
   * @param {string} [options.tenantId]
   * @param {boolean} [options.touch=true]
   * @param {'full'|'thumbnail'} [options.size='full']
   * @returns {Promise<Object|null>}
   */
  async get(arg1, arg2 = {}) {
    let photoId = arg1;
    let options = arg2;

    if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      const tenantId = arg1;
      photoId = arg2;
      options = (arguments[2] && typeof arguments[2] === 'object') ? { ...arguments[2], tenantId } : { tenantId };
    }

    if (!photoId) return null;
    const { tenantId = null, touch = true, size = 'full' } = options || {};

    const db = await getDB();
    const record = await db.get('productImages', photoId);
    if (!record || record.deletedAt) return null;

    // Isolamento multi-tenant estrito
    if (tenantId && record.tenantId && record.tenantId !== tenantId) {
      return null;
    }

    // Atualização de lastAccessedAt com throttle de 5 segundos
    if (touch) {
      this.touch(photoId);
    }

    // Seleção de Blob apropriado
    const displayBlob = (size === 'thumbnail' && record.thumbnailBlob)
      ? record.thumbnailBlob
      : (record.blob || record.thumbnailBlob);

    return {
      ...record,
      displayBlob
    };
  }

  /**
   * Verifica se uma imagem existe no cache com versão válida.
   * Suporta has(photoId, { tenantId, minVersion }) e has(tenantId, photoId, minVersion).
   * @param {string} arg1
   * @param {Object|string} [arg2]
   * @returns {Promise<boolean>}
   */
  async has(arg1, arg2 = {}) {
    let photoId = arg1;
    let options = arg2;

    if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      const tenantId = arg1;
      photoId = arg2;
      options = { tenantId, minVersion: arguments[2] };
    }

    if (!photoId) return false;
    const { tenantId = null, minVersion = null } = options || {};

    const record = await this.get(photoId, { tenantId, touch: false });
    if (!record) return false;

    if (minVersion !== null && typeof minVersion === 'number') {
      return (record.version || 1) >= minVersion;
    }

    return true;
  }

  /**
   * Substitui uma imagem existente por uma versão atualizada.
   * @param {string} photoId
   * @param {Object} newParams
   * @returns {Promise<Object>}
   */
  async replace(photoId, newParams) {
    if (!photoId) throw new Error('[LocalImageCache] photoId é obrigatório para replace.');
    return this.put({ ...newParams, photoId });
  }

  /**
   * Remove uma imagem do cache local.
   * Suporta remove(photoId, options) e remove(tenantId, photoId, options).
   * @param {string} arg1
   * @param {Object|string} [arg2]
   * @returns {Promise<boolean>}
   */
  async remove(arg1, arg2 = {}) {
    let photoId = arg1;
    let options = arg2;

    if (typeof arg1 === 'string' && typeof arg2 === 'string') {
      const tenantId = arg1;
      photoId = arg2;
      options = (arguments[2] && typeof arguments[2] === 'object') ? { ...arguments[2], tenantId } : { tenantId };
    }

    if (!photoId) return false;
    const { tenantId = null, hard = false } = options || {};

    const existing = await this.get(photoId, { tenantId, touch: false });
    if (!existing) return false;

    // Revoga qualquer Object URL ativo desta foto
    this.revokeUrlForPhoto(photoId);

    if (hard) {
      await executeTransaction(['productImages', 'imageManifest'], 'readwrite', async (stores) => {
        await stores.productImages.delete(photoId);
        await stores.imageManifest.delete(photoId);
      });
    } else {
      const now = Date.now();
      await executeTransaction(['productImages', 'imageManifest'], 'readwrite', async (stores) => {
        existing.deletedAt = now;
        await stores.productImages.put(existing);

        const manifest = await stores.imageManifest.get(photoId);
        if (manifest) {
          manifest.deletedAt = now;
          await stores.imageManifest.put(manifest);
        }
      });
    }

    return true;
  }

  /**
   * Limpa o cache de imagens para um tenant ou globalmente.
   * @param {Object} [options]
   * @param {string} [options.tenantId]
   * @param {boolean} [options.hard=false]
   * @returns {Promise<number>} Quantidade de itens limpos
   */
  async clear(options = {}) {
    const { tenantId = null, hard = false } = options;
    const db = await getDB();
    const all = await db.getAll('productImages');
    let count = 0;

    this.revokeAllUrls();

    for (const item of all) {
      if (tenantId && item.tenantId && item.tenantId !== tenantId) {
        continue;
      }
      await this.remove(item.photoId || item.id, { tenantId, hard });
      count++;
    }

    return count;
  }

  /**
   * Retorna metadados da imagem sem carregar Blobs binários pesados na memória.
   * @param {string} photoId
   * @param {Object} [options]
   * @returns {Promise<Object|null>}
   */
  async getMetadata(photoId, options = {}) {
    if (!photoId) return null;
    const { tenantId = null } = options;

    // Consulta primeiro o manifesto local (mais leve, sem Blobs)
    const manifest = await imageManifestRepository.findByPhotoId(photoId);
    if (!manifest || manifest.deletedAt) return null;

    if (tenantId && manifest.tenantId && manifest.tenantId !== tenantId) {
      return null;
    }

    return {
      photoId: manifest.photoId,
      productId: manifest.productId,
      tenantId: manifest.tenantId,
      version: manifest.version,
      hash: manifest.hash,
      sizeBytes: manifest.sizeBytes,
      mimeType: manifest.mimeType,
      width: manifest.width,
      height: manifest.height,
      isPrimary: manifest.isPrimary,
      label: manifest.label,
      updatedAt: manifest.updatedAt
    };
  }

  /**
   * Cria e rastreia uma URL de objeto (blob:...) gerenciada para exibição em componentes UI.
   * Evita vazamentos de memória registrando cada URL no mapa interno.
   *
   * @param {string} photoId
   * @param {Object} [options] { size: 'full'|'thumbnail', tenantId }
   * @returns {Promise<string|null>}
   */
  async createUrl(photoId, options = {}) {
    const record = await this.get(photoId, options);
    if (!record || !record.displayBlob) return null;

    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return null;
    }

    const url = URL.createObjectURL(record.displayBlob);
    this._activeUrls.set(url, {
      photoId,
      size: options.size || 'full',
      createdAt: Date.now()
    });

    return url;
  }

  /**
   * Revoga uma Object URL específica e libera a memória associada.
   * @param {string} url
   */
  revokeUrl(url) {
    if (!url || typeof url !== 'string') return;
    if (this._activeUrls.has(url)) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
      this._activeUrls.delete(url);
    }
  }

  /**
   * Revoga todas as URLs associadas a um photoId específico.
   * @param {string} photoId
   */
  revokeUrlForPhoto(photoId) {
    for (const [url, info] of this._activeUrls.entries()) {
      if (info.photoId === photoId) {
        this.revokeUrl(url);
      }
    }
  }

  /**
   * Revoga todas as Object URLs gerenciadas ativas no ciclo de vida.
   */
  revokeAllUrls() {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this._activeUrls.keys()) {
        URL.revokeObjectURL(url);
      }
    }
    this._activeUrls.clear();
  }

  /**
   * Retorna a quantidade de Object URLs ativas no momento.
   * @returns {number}
   */
  getActiveUrlsCount() {
    return this._activeUrls.size;
  }

  /**
   * Atualiza o timestamp lastAccessedAt sob controle de throttle (máx. 1 escrita a cada 5s).
   * @param {string} photoId
   */
  touch(photoId) {
    if (!photoId) return;
    const now = Date.now();
    const last = this._accessThrottle.get(photoId) || 0;

    // Se acessado a menos de 5 segundos, ignora para poupar transações
    if (now - last < 5000) return;

    this._accessThrottle.set(photoId, now);

    // Atualização assíncrona não-bloqueante
    (async () => {
      try {
        const db = await getDB();
        const record = await db.get('productImages', photoId);
        if (record && !record.deletedAt) {
          record.lastAccessedAt = now;
          await db.put('productImages', record);
        }
      } catch (err) {
        // Silencioso em caso de concorrência momentânea
      }
    })();
  }

  /**
   * Retorna a categoria de retenção do ativo (HOT, WARM ou COLD).
   * @param {Object} record
   * @param {number} [now=Date.now()]
   * @returns {string}
   */
  static getRetentionCategory(record, now = Date.now()) {
    if (!record) return RETENTION_CATEGORY.COLD;
    const lastAccess = record.lastAccessedAt || record.cachedAt || record.updatedAt || 0;
    const ageMs = now - lastAccess;

    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    if (ageMs <= SEVEN_DAYS) return RETENTION_CATEGORY.HOT;
    if (ageMs <= THIRTY_DAYS) return RETENTION_CATEGORY.WARM;
    return RETENTION_CATEGORY.COLD;
  }

  /**
   * Identifica candidatos à remoção (evicção) futura ordenados do mais antigo ao mais recente.
   * NUNCA remove automaticamente fotos protegidas (isPrimary ou HOT).
   *
   * @param {Object} [options]
   * @param {string} [options.tenantId]
   * @param {number} [options.limit=50]
   * @returns {Promise<Array<Object>>}
   */
  async getEvictionCandidates(options = {}) {
    const { tenantId = null, limit = 50 } = options;
    const db = await getDB();
    const all = await db.getAll('productImages');
    const now = Date.now();

    const candidates = [];
    for (const item of all) {
      if (item.deletedAt) continue;
      if (tenantId && item.tenantId && item.tenantId !== tenantId) continue;

      const category = LocalImageCache.getRetentionCategory(item, now);

      // Não seleciona itens HOT nem fotos primárias protegidas
      if (category === RETENTION_CATEGORY.HOT || item.isPrimary) {
        continue;
      }

      candidates.push({
        photoId: item.photoId || item.id,
        productId: item.productId,
        tenantId: item.tenantId,
        sizeBytes: item.sizeBytes || 0,
        lastAccessedAt: item.lastAccessedAt || item.cachedAt || 0,
        category,
        isPrimary: !!item.isPrimary
      });
    }

    // Ordena do mais antigo acessado para o mais recente
    candidates.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    return candidates.slice(0, limit);
  }

  /**
   * Consolida métricas e estatísticas de uso do cache local sob demanda.
   * @param {Object} [options]
   * @param {string} [options.tenantId]
   * @returns {Promise<Object>}
   */
  async getStats(options = {}) {
    const { tenantId = null } = options;
    const db = await getDB();
    const all = await db.getAll('productImages');
    const now = Date.now();

    let photosCount = 0;
    let totalBytes = 0;
    let thumbBytes = 0;
    let fullBytes = 0;
    let oldestCachedAt = null;
    let newestCachedAt = null;
    let latestAccessedAt = null;
    let hotCount = 0;
    let warmCount = 0;
    let coldCount = 0;

    for (const item of all) {
      if (item.deletedAt) continue;
      if (tenantId && item.tenantId && item.tenantId !== tenantId) continue;

      photosCount++;
      const fBytes = item.blob ? item.blob.size : (item.sizeBytes || 0);
      const tBytes = item.thumbnailBlob ? item.thumbnailBlob.size : 0;

      fullBytes += fBytes;
      thumbBytes += tBytes;
      totalBytes += (fBytes + tBytes);

      const cached = item.cachedAt || now;
      if (oldestCachedAt === null || cached < oldestCachedAt) oldestCachedAt = cached;
      if (newestCachedAt === null || cached > newestCachedAt) newestCachedAt = cached;

      const accessed = item.lastAccessedAt || cached;
      if (latestAccessedAt === null || accessed > latestAccessedAt) latestAccessedAt = accessed;

      const cat = LocalImageCache.getRetentionCategory(item, now);
      if (cat === RETENTION_CATEGORY.HOT) hotCount++;
      else if (cat === RETENTION_CATEGORY.WARM) warmCount++;
      else coldCount++;
    }

    return {
      photosCount,
      totalBytes,
      thumbBytes,
      fullBytes,
      oldestCachedAt: oldestCachedAt || now,
      newestCachedAt: newestCachedAt || now,
      latestAccessedAt: latestAccessedAt || now,
      hotCount,
      warmCount,
      coldCount
    };
  }

  /**
   * Retorna a estimativa de cota de armazenamento via Storage API com fallback resiliente.
   * @returns {Promise<{ usage: number, quota: number, percentUsed: number, available: number, isFallback: boolean }>}
   */
  static async getQuotaEstimate() {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage || 0;
        const quota = est.quota || (1024 * 1024 * 1024);
        const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
        return {
          usage,
          quota,
          percentUsed: Number(percentUsed.toFixed(2)),
          available: Math.max(0, quota - usage),
          isFallback: false
        };
      } catch (err) {
        // Fallback gracioso
      }
    }

    // Fallback padrão para ambientes sem suporte (ex: Node/Bun em testes, WebView2 restrito)
    return {
      usage: 0,
      quota: 1024 * 1024 * 1024, // 1 GB padrão
      percentUsed: 0,
      available: 1024 * 1024 * 1024,
      isFallback: true
    };
  }

  /**
   * Avalia e valida se há espaço de armazenamento suficiente antes de salvar.
   * @private
   */
  async _assertQuotaAvailable(requiredBytes) {
    if (this._simulatedQuotaLimit !== null) {
      const stats = await this.getStats();
      if ((stats.totalBytes + requiredBytes) > this._simulatedQuotaLimit) {
        throw new Error(`[LocalImageCache] Cota de armazenamento insuficiente (limite simulado de ${this._simulatedQuotaLimit} bytes atingido).`);
      }
      return;
    }

    const quota = await LocalImageCache.getQuotaEstimate();
    if (!quota.isFallback && quota.available < requiredBytes) {
      throw new Error(`[LocalImageCache] Armazenamento do dispositivo insuficiente para salvar imagem (${requiredBytes} bytes necessários, ${quota.available} disponíveis).`);
    }
  }
}

// Singleton exportado
export const localImageCache = new LocalImageCache();

// Alias alternativo conforme convenção
export { LocalImageCache as ImageCacheService };
