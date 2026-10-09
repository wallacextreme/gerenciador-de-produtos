import { imageManifestRepository } from '../repositories/ImageManifestRepository.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';

/**
 * Constantes formais de classificação da reconciliação de manifesto (PHASE 05).
 */
export const MANIFEST_STATUS = Object.freeze({
  NEW: 'NEW',
  CHANGED: 'CHANGED',
  UNCHANGED: 'UNCHANGED',
  DELETED: 'DELETED',
  LOCAL_ONLY: 'LOCAL_ONLY',
  CONFLICT: 'CONFLICT'
});

/**
 * Normaliza e valida um registro de metadados do manifesto de imagem.
 * Garante contrato unificado entre ImageService, StorageProvider, RTDB e IndexedDB.
 * @param {Object} raw 
 * @returns {Object}
 */
export function normalizeImageMetadata(raw = {}) {
  const photoId = String(raw.photoId || raw.id || crypto.randomUUID());
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0
    ? raw.version
    : 1;

  let updatedAt = Date.now();
  if (typeof raw.updatedAt === 'number') {
    updatedAt = raw.updatedAt;
  } else if (raw.updatedAt) {
    const parsed = new Date(raw.updatedAt).getTime();
    if (!isNaN(parsed)) updatedAt = parsed;
  }

  let deletedAt = null;
  if (typeof raw.deletedAt === 'number') {
    deletedAt = raw.deletedAt;
  } else if (raw.deletedAt) {
    const parsed = new Date(raw.deletedAt).getTime();
    if (!isNaN(parsed)) deletedAt = parsed;
  }

  return {
    photoId,
    id: photoId, // Garantir id idêntico para idb key e regra RTDB .validate
    productId: String(raw.productId || ''),
    tenantId: String(raw.tenantId || 'default_tenant'),
    label: raw.label ? String(raw.label) : 'Foto do Produto',
    isPrimary: !!raw.isPrimary,
    url: raw.url ? String(raw.url) : '',
    thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl) : (raw.url ? String(raw.url) : ''),
    version,
    hash: raw.hash ? String(raw.hash) : '',
    sizeBytes: typeof raw.sizeBytes === 'number' ? Math.max(0, raw.sizeBytes) : 0,
    mimeType: raw.mimeType ? String(raw.mimeType) : 'image/webp',
    width: typeof raw.width === 'number' ? Math.max(0, raw.width) : 0,
    height: typeof raw.height === 'number' ? Math.max(0, raw.height) : 0,
    updatedAt,
    deletedAt
  };
}

/**
 * Calcula o Checksum SHA-256 determinístico sobre um Blob ou Buffer de imagem.
 * @param {Blob|ArrayBuffer|Uint8Array|string} source 
 * @returns {Promise<string>}
 */
export async function computeImageHash(source) {
  if (!source) return '';
  let arrayBuffer;

  if (source instanceof ArrayBuffer) {
    arrayBuffer = source;
  } else if (ArrayBuffer.isView(source)) {
    arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  } else if (typeof source.arrayBuffer === 'function') {
    arrayBuffer = await source.arrayBuffer();
  } else if (typeof source === 'string') {
    const encoder = new TextEncoder();
    arrayBuffer = encoder.encode(source).buffer;
  } else {
    return '';
  }

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback rápido caso crypto.subtle não esteja disponível
  let h = 0;
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < view.length; i++) {
    h = ((h << 5) - h) + view[i];
    h |= 0;
  }
  return 'fb-' + Math.abs(h).toString(16);
}

/**
 * Serviço de Manifesto e Reconciliação Incremental de Imagens (PHASE 05).
 * Responsável por:
 * 1. Comparar manifesto remoto com manifesto local com complexidade O(N);
 * 2. Classificar cada ativo em: NEW, CHANGED, UNCHANGED, DELETED, LOCAL_ONLY ou CONFLICT;
 * 3. Calcular deltas de sincronização sem tráfego redundante;
 * 4. Garantir isolamento multi-tenant absoluto;
 * 5. Não baixar nem remover Blobs nesta fase (apenas inteligência de decisão).
 */
export class ImageManifestService {
  /**
   * Executa a reconciliação puramente em memória entre dois conjuntos de manifesto.
   * Não executa I/O nem downloads, garantindo determinismo total e alta performance.
   *
   * @param {Array|Object} remoteInput Manifesto remoto (lista ou dicionário)
   * @param {Array|Object} localInput Manifesto local (lista ou dicionário)
   * @param {Object} [options] { tenantId, productId }
   * @returns {{
   *   newPhotos: Array,
   *   changedPhotos: Array,
   *   unchangedPhotos: Array,
   *   deletedPhotos: Array,
   *   localOnlyPhotos: Array,
   *   conflicts: Array,
   *   summary: Object
   * }}
   */
  static reconcile(remoteInput = [], localInput = [], options = {}) {
    const { tenantId = null, productId = null } = options;

    const remoteMap = this._normalizeToMap(remoteInput, { tenantId, productId });
    const localMap = this._normalizeToMap(localInput, { tenantId, productId });

    const newPhotos = [];
    const changedPhotos = [];
    const unchangedPhotos = [];
    const deletedPhotos = [];
    const localOnlyPhotos = [];
    const conflicts = [];

    // Conjunto de todos os photoIds únicos relevantes
    const allPhotoIds = new Set([...remoteMap.keys(), ...localMap.keys()]);

    for (const photoId of allPhotoIds) {
      const remote = remoteMap.get(photoId) || null;
      const local = localMap.get(photoId) || null;

      // 1. Caso DELETED: O remoto declara explicitamente deletedAt
      if (remote && remote.deletedAt != null) {
        deletedPhotos.push({
          photoId,
          productId: remote.productId,
          tenantId: remote.tenantId,
          remote,
          local,
          status: MANIFEST_STATUS.DELETED,
          reason: 'Marcado como excluído no manifesto remoto'
        });
        continue;
      }

      // 2. Caso LOCAL_ONLY: Foto existe apenas no manifesto local
      if (!remote && local) {
        localOnlyPhotos.push({
          photoId,
          productId: local.productId,
          tenantId: local.tenantId,
          remote: null,
          local,
          status: MANIFEST_STATUS.LOCAL_ONLY,
          reason: 'Foto presente exclusivamente no manifesto local'
        });
        continue;
      }

      // 3. Caso NEW: Foto existe no remoto e não existe no manifesto local
      if (remote && !local) {
        newPhotos.push({
          photoId,
          productId: remote.productId,
          tenantId: remote.tenantId,
          remote,
          local: null,
          status: MANIFEST_STATUS.NEW,
          reason: 'Nova foto presente no manifesto remoto'
        });
        continue;
      }

      // 4. Ambos existem: Avaliar versões, hashes e integridade
      if (remote && local) {
        const remoteVersion = remote.version || 1;
        const localVersion = local.version || 1;
        const remoteHash = remote.hash || '';
        const localHash = local.hash || '';

        // 4A. Conflito: Mesma versão com hashes diferentes
        if (remoteVersion === localVersion && remoteHash && localHash && remoteHash !== localHash) {
          conflicts.push({
            photoId,
            productId: remote.productId,
            tenantId: remote.tenantId,
            remote,
            local,
            status: MANIFEST_STATUS.CONFLICT,
            reason: `Conflito de hash na mesma versão (${remoteVersion}): local [${localHash.slice(0, 8)}] vs remote [${remoteHash.slice(0, 8)}]`
          });
          continue;
        }

        // 4B. Conflito: Versão remota inferior à versão local com hashes diferentes
        if (remoteVersion < localVersion && remoteHash !== localHash) {
          conflicts.push({
            photoId,
            productId: remote.productId,
            tenantId: remote.tenantId,
            remote,
            local,
            status: MANIFEST_STATUS.CONFLICT,
            reason: `Versão remota (${remoteVersion}) inferior à versão local (${localVersion}) com divergência de conteúdo`
          });
          continue;
        }

        // 4C. UNCHANGED: Mesma versão e mesmo hash (ou mesma versão sem alteração)
        if (remoteVersion === localVersion && remoteHash === localHash) {
          unchangedPhotos.push({
            photoId,
            productId: remote.productId,
            tenantId: remote.tenantId,
            remote,
            local,
            status: MANIFEST_STATUS.UNCHANGED,
            reason: 'Versão e checksum SHA-256 idênticos'
          });
          continue;
        }

        // 4D. CHANGED: Versão remota estritamente superior
        if (remoteVersion > localVersion) {
          changedPhotos.push({
            photoId,
            productId: remote.productId,
            tenantId: remote.tenantId,
            remote,
            local,
            status: MANIFEST_STATUS.CHANGED,
            reason: `Versão remota atualizada (v${remoteVersion} > v${localVersion})`
          });
          continue;
        }

        // Fallback defensivo para qualquer outro estado não classificado
        unchangedPhotos.push({
          photoId,
          productId: remote.productId,
          tenantId: remote.tenantId,
          remote,
          local,
          status: MANIFEST_STATUS.UNCHANGED,
          reason: 'Sem divergências de versão detectadas'
        });
      }
    }

    return {
      newPhotos,
      changedPhotos,
      unchangedPhotos,
      deletedPhotos,
      localOnlyPhotos,
      conflicts,
      summary: {
        totalRemote: remoteMap.size,
        totalLocal: localMap.size,
        newCount: newPhotos.length,
        changedCount: changedPhotos.length,
        unchangedCount: unchangedPhotos.length,
        deletedCount: deletedPhotos.length,
        localOnlyCount: localOnlyPhotos.length,
        conflictCount: conflicts.length
      }
    };
  }

  /**
   * Converte entradas brutas em um Map indexado por photoId, aplicando filtros e desduplicação.
   * @private
   */
  static _normalizeToMap(input, filters = {}) {
    const map = new Map();
    if (!input) return map;

    let items = [];
    if (Array.isArray(input)) {
      items = input;
    } else if (input instanceof Map) {
      items = Array.from(input.values());
    } else if (typeof input === 'object') {
      items = Object.values(input);
    }

    for (const raw of items) {
      if (!raw) continue;
      const entry = normalizeImageMetadata(raw);

      // Filtro rigoroso de tenantId (se especificado)
      if (filters.tenantId && entry.tenantId !== filters.tenantId) {
        continue;
      }

      // Filtro de productId (se especificado)
      if (filters.productId && entry.productId !== filters.productId) {
        continue;
      }

      // Desduplicação idempotente: preserva a versão mais alta ou o registro mais recente
      const existing = map.get(entry.photoId);
      if (!existing || entry.version > existing.version || entry.updatedAt > existing.updatedAt) {
        map.set(entry.photoId, entry);
      }
    }

    return map;
  }

  /**
   * Orquestra a reconciliação completa para um tenant específico consultando
   * o provedor do Realtime Database e o repositório local do IndexedDB.
   * @param {Object} realtimeProvider Instância de CloudProvider / RealtimeProvider
   * @param {string} tenantId 
   * @param {Object} [options]
   * @returns {Promise<Object>} Resultado da reconciliação
   */
  static async reconcileForTenant(realtimeProvider, tenantId, options = {}) {
    if (!tenantId) throw new Error('[ImageManifestService] tenantId é obrigatório para reconciliação.');
    if (!realtimeProvider) throw new Error('[ImageManifestService] Provedor de Realtime Database é obrigatório.');

    // 1. Carregar manifesto local do IndexedDB
    const localManifest = await imageManifestRepository.findByTenantId(tenantId);

    // 2. Carregar manifesto remoto via RTDB Provider
    const remoteManifest = await this.pullRemoteManifest(realtimeProvider, tenantId, options);

    // 3. Executar reconciliação pura
    return this.reconcile(remoteManifest, localManifest, { tenantId, ...options });
  }

  /**
   * Consulta o manifesto remoto do tenant no Firebase Realtime Database.
   * @param {Object} realtimeProvider 
   * @param {string} tenantId 
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  static async pullRemoteManifest(realtimeProvider, tenantId, options = {}) {
    if (!realtimeProvider || !tenantId) return [];

    const rawList = await realtimeProvider.list('imageManifest', {
      tenantId,
      ...options
    });

    if (!Array.isArray(rawList)) return [];
    return rawList.map(item => normalizeImageMetadata(item));
  }

  /**
   * Publica ou atualiza uma entrada de metadados no manifesto remoto no RTDB.
   * @param {Object} realtimeProvider 
   * @param {Object} metadata 
   * @returns {Promise<Object>}
   */
  static async publishRemoteEntry(realtimeProvider, metadata) {
    if (!realtimeProvider) throw new Error('[ImageManifestService] Provedor remoto não fornecido.');
    const entry = normalizeImageMetadata(metadata);
    await realtimeProvider.upsert('imageManifest', entry.photoId, entry, {
      tenantId: entry.tenantId
    });
    return entry;
  }

  /**
   * Filtra deltas de manifesto a partir de um timestamp de corte.
   * @param {Array<Object>} manifestList 
   * @param {number} sinceTimestamp 
   * @returns {Array<Object>}
   */
  static calculateDelta(manifestList = [], sinceTimestamp = 0) {
    if (!Array.isArray(manifestList)) return [];
    if (!sinceTimestamp || sinceTimestamp <= 0) return [...manifestList];

    return manifestList.filter(item => {
      const updated = typeof item.updatedAt === 'number' ? item.updatedAt : new Date(item.updatedAt).getTime();
      const deleted = item.deletedAt ? (typeof item.deletedAt === 'number' ? item.deletedAt : new Date(item.deletedAt).getTime()) : 0;
      return updated > sinceTimestamp || deleted > sinceTimestamp;
    });
  }

  /**
   * Obtém o timestamp do último sync de manifesto do tenant no IndexedDB.
   * @param {string} tenantId 
   * @returns {Promise<number>}
   */
  static async getLastSyncAt(tenantId) {
    if (!tenantId) return 0;
    const val = await settingsRepository.getSetting(`manifest_sync_${tenantId}`, 0);
    return typeof val === 'number' ? val : 0;
  }

  /**
   * Atualiza o timestamp do último sync de manifesto do tenant no IndexedDB.
   * @param {string} tenantId 
   * @param {number} timestamp 
   * @returns {Promise<number>}
   */
  static async setLastSyncAt(tenantId, timestamp = Date.now()) {
    if (!tenantId) return 0;
    await settingsRepository.setSetting(`manifest_sync_${tenantId}`, timestamp);
    return timestamp;
  }
}

export const imageManifestService = new ImageManifestService();
