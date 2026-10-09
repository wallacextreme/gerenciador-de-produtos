import { ImageStorageProvider } from './ImageStorageProvider.js';

/**
 * GestãoPro — Provedor Mock de Armazenamento de Imagens em Memória (PHASE 04)
 * Utilizado para testes unitários, testes de integração sem rede e ambientes de desenvolvimento isolados.
 */
export class MockImageStorageProvider extends ImageStorageProvider {
  constructor(options = {}) {
    super();
    this.name = options.name || 'MockImageStorageProvider';
    this.configured = options.configured !== undefined ? options.configured : true;
    this.tenantId = options.tenantId || 'tenant_loja_01';
    this.maxSizeBytes = options.maxSizeBytes || 10 * 1024 * 1024; // 10MB
    this.maxTotalStorageBytes = options.maxTotalStorageBytes || 100 * 1024 * 1024; // 100MB
    this.allowedMimeTypes = options.allowedMimeTypes || ['image/webp', 'image/jpeg', 'image/png', 'image/gif'];

    this.storage = new Map(); // photoId -> record
    this.uploadHistory = [];
    this.shouldFail = false;
    this.failureMessage = 'Falha simulada de armazenamento de imagens';
    this.failureCode = 'STORAGE_ERROR';
    this.timeoutMs = options.timeoutMs || 0;
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

  setShouldFail(val, msg = 'Falha simulada de armazenamento de imagens', code = 'STORAGE_ERROR') {
    this.shouldFail = !!val;
    this.failureMessage = msg;
    this.failureCode = code;
  }

  async _calculateHash(blob) {
    try {
      let arrayBuffer;
      if (blob instanceof ArrayBuffer) {
        arrayBuffer = blob;
      } else if (typeof blob.arrayBuffer === 'function') {
        arrayBuffer = await blob.arrayBuffer();
      } else {
        arrayBuffer = new Uint8Array(blob).buffer;
      }
      const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer);
      return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (_) {
      return `mock_hash_${Date.now()}`;
    }
  }

  _getTotalStoredBytes() {
    let total = 0;
    for (const item of this.storage.values()) {
      total += item.sizeBytes || 0;
    }
    return total;
  }

  async upload(blob, metadata = {}) {
    if (!this.configured) throw new Error('Provedor de imagem não configurado.');
    if (this.shouldFail) {
      const err = new Error(this.failureMessage);
      err.code = this.failureCode;
      throw err;
    }

    if (!blob) throw new Error('Blob de imagem é obrigatório.');

    // 1. Validação de tamanho
    const sizeBytes = blob.size !== undefined ? blob.size : (blob.length || 0);
    if (sizeBytes > this.maxSizeBytes) {
      throw new Error(`Arquivo excede o limite máximo permitido de ${Math.round(this.maxSizeBytes / (1024 * 1024))}MB.`);
    }

    // 2. Validação de cota total
    if (this._getTotalStoredBytes() + sizeBytes > this.maxTotalStorageBytes) {
      const err = new Error('Cota de armazenamento excedida.');
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }

    // 3. Validação de MIME Type
    const mimeType = blob.type || metadata.mimeType || 'image/webp';
    if (!this.allowedMimeTypes.includes(mimeType) && !mimeType.startsWith('image/')) {
      throw new Error(`Tipo de arquivo não permitido: ${mimeType}. Permitidos: imagens.`);
    }

    const photoId = metadata.photoId || `photo_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    const productId = metadata.productId || 'prod_unknown';
    const tenantId = metadata.tenantId || this.tenantId;
    const version = metadata.version || 1;
    const hash = metadata.hash || (await this._calculateHash(blob));
    const remotePath = `tenants/${tenantId}/products/${productId}/${photoId}.webp`;
    const url = `https://mock-storage.gestaopro.local/${remotePath}`;
    const uploadedAt = new Date().toISOString();

    const record = {
      photoId,
      productId,
      tenantId,
      label: metadata.label || 'Foto do Produto',
      isPrimary: metadata.isPrimary || false,
      url,
      thumbnailUrl: url,
      remotePath,
      version,
      hash,
      sizeBytes,
      mimeType,
      blob,
      uploadedAt,
      deletedAt: null
    };

    this.storage.set(photoId, record);
    this.uploadHistory.push({ photoId, action: 'UPLOAD', timestamp: uploadedAt });

    return {
      photoId,
      url,
      remotePath,
      version,
      hash,
      sizeBytes,
      mimeType,
      uploadedAt
    };
  }

  async replace(photoId, blob, metadata = {}) {
    const existing = this.storage.get(photoId);
    if (!existing) {
      throw new Error(`Foto ${photoId} não encontrada para substituição.`);
    }

    const nextVersion = (existing.version || 1) + 1;
    return this.upload(blob, {
      ...metadata,
      photoId,
      productId: existing.productId,
      tenantId: existing.tenantId,
      version: nextVersion
    });
  }

  async delete(photoId, remotePath = '') {
    if (!this.configured) throw new Error('Provedor de imagem não configurado.');
    if (this.shouldFail) throw new Error(this.failureMessage);

    const existing = this.storage.get(photoId);
    if (!existing) {
      return false;
    }

    this.storage.delete(photoId);
    this.uploadHistory.push({ photoId, action: 'DELETE', timestamp: new Date().toISOString() });
    return true;
  }

  async download(photoId, remotePath = '') {
    if (!this.configured) throw new Error('Provedor de imagem não configurado.');
    if (this.shouldFail) {
      const err = new Error(this.failureMessage);
      err.code = this.failureCode;
      throw err;
    }

    const item = this.storage.get(photoId);
    if (!item) {
      const err = new Error(`Foto ${photoId} não encontrada no storage mock.`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (item.blob) return item.blob;
    return new Blob(['mock_image_bytes'], { type: item.mimeType || 'image/webp' });
  }

  getUrl(photoId, remotePath = '') {
    const item = this.storage.get(photoId);
    if (item) return item.url;
    if (remotePath) return `https://mock-storage.gestaopro.local/${remotePath}`;
    return null;
  }

  async getMetadata(photoId, remotePath = '') {
    const item = this.storage.get(photoId);
    return item ? { ...item } : null;
  }

  async exists(photoId, remotePath = '') {
    return this.storage.has(photoId);
  }

  clear() {
    this.storage.clear();
    this.uploadHistory = [];
    this.shouldFail = false;
  }
}
