import { ImageStorageProvider } from './ImageStorageProvider.js';

/**
 * GestãoPro — Provedor Alternativo Cloudinary (PHASE 04)
 * Permite upload direto unsigned via HTTPS REST para o Cloudinary Free Tier.
 * 
 * AVISOS DE SEGURANÇA E LIMITAÇÕES:
 * 1. O upload unsigned utiliza um `upload_preset` público. Restrições estritas de tamanho e formato
 *    devem ser configuradas no painel da Cloudinary.
 * 2. A Cloudinary NÃO permite exclusão de ativos (delete) através de chamadas unsigned do cliente.
 *    Para exclusão física real, seria necessário um backend autenticado com `api_secret`.
 */
export class CloudinaryImageProvider extends ImageStorageProvider {
  constructor(config = null) {
    super();
    this.config = config || null;
    this.maxSizeBytes = 10 * 1024 * 1024; // 10MB
  }

  getProviderName() {
    return 'Cloudinary Image Storage';
  }

  isConfigured() {
    return !!(this.config && this.config.cloudName && this.config.uploadPreset);
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
      return `hash_${Date.now()}`;
    }
  }

  async upload(blob, metadata = {}) {
    if (!this.isConfigured()) throw new Error('Cloudinary não configurado com cloudName e uploadPreset.');
    if (!blob) throw new Error('Blob de imagem é obrigatório.');

    const sizeBytes = blob.size !== undefined ? blob.size : (blob.length || 0);
    if (sizeBytes > this.maxSizeBytes) {
      throw new Error(`Arquivo excede o limite máximo permitido de ${Math.round(this.maxSizeBytes / (1024 * 1024))}MB.`);
    }

    const tenantId = metadata.tenantId || 'tenant_default';
    const productId = metadata.productId || 'prod_unknown';
    const photoId = metadata.photoId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `photo_${Date.now()}`);
    const version = metadata.version || 1;
    const hash = metadata.hash || (await this._calculateHash(blob));
    const folder = `gestaopro/${tenantId}/${productId}`;
    const publicId = `${folder}/${photoId}`;

    const formData = new FormData();
    formData.append('file', blob);
    formData.append('upload_preset', this.config.uploadPreset);
    formData.append('folder', folder);
    formData.append('public_id', photoId);

    try {
      const response = await fetch(`https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const uploadedAt = new Date().toISOString();

      return {
        photoId,
        url: data.secure_url,
        remotePath: publicId,
        version,
        hash,
        sizeBytes: data.bytes || sizeBytes,
        mimeType: data.format ? `image/${data.format}` : 'image/webp',
        uploadedAt
      };
    } catch (err) {
      throw new Error(`Falha no upload para o Cloudinary: ${err.message}`);
    }
  }

  async replace(photoId, blob, metadata = {}) {
    const nextVersion = (metadata.version || 1) + 1;
    return this.upload(blob, {
      ...metadata,
      photoId,
      version: nextVersion
    });
  }

  async delete(photoId, remotePath = '') {
    // Cloudinary não permite unsigned deletion no cliente sem expor api_secret.
    console.warn('[CloudinaryImageProvider] Exclusão física remota no Cloudinary requer backend autenticado ou assinatura da API.');
    return false;
  }

  getUrl(photoId, remotePath = '') {
    if (!this.isConfigured()) return null;
    return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/${remotePath}`;
  }

  async getMetadata(photoId, remotePath = '') {
    return null;
  }

  async exists(photoId, remotePath = '') {
    return false;
  }
}
