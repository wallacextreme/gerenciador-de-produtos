import { ImageStorageProvider } from './ImageStorageProvider.js';
import { authService } from '../services/AuthService.js';
import { initializeApp, getApps } from 'firebase/app';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getMetadata,
  connectStorageEmulator
} from 'firebase/storage';
import { validateFirebaseConfig } from '../utils/firebaseConfigValidator.js';

/**
 * GestãoPro — Provedor Oficial Firebase Cloud Storage (PHASE 04 & PHASE 09)
 * Solução mais segura e resiliente:
 * - Autenticação 100% nativa via Firebase Authentication
 * - Regras de segurança granulares por tenant: /tenants/{tenantId}/products/{productId}/{photoId}
 * - Permissão nativa de exclusão e substituição segura sem expor segredos no frontend
 * - Suporte nativo ao Firebase Storage Emulator para testes locais sem custo
 */
export class FirebaseStorageProvider extends ImageStorageProvider {
  constructor(config = null, authServiceInstance = null) {
    super();
    this.config = config || null;
    this.authService = authServiceInstance || authService;
    this.app = null;
    this.storage = null;
    this._initialized = false;
    this.maxSizeBytes = 10 * 1024 * 1024; // 10MB
  }

  getProviderName() {
    return 'Firebase Cloud Storage';
  }

  isConfigured() {
    return !!(this.config && (this.config.storageBucket || (this.config.apiKey && this.config.projectId)));
  }

  getTenantId() {
    const authTenant = this.authService ? this.authService.getTenantId() : null;
    return authTenant || (this.config && this.config.tenantId) || 'tenant_matriz_01';
  }

  async initialize(config = null) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (!this.isConfigured() || (this._initialized && this.storage)) {
      return;
    }

    validateFirebaseConfig(this.config);

    try {
      const apps = getApps();
      const appName = 'gestaopro-storage';
      const existing = apps.find(a => a.name === appName || a.name === '[DEFAULT]');

      this.app = existing || initializeApp(this.config, apps.length === 0 ? undefined : appName);
      
      const bucketUrl = this.config.storageBucket ? `gs://${this.config.storageBucket.replace(/^gs:\/\//, '')}` : undefined;
      this.storage = getStorage(this.app, bucketUrl);

      // Conexão com Emulator se informado
      if (this.config && (this.config.storageEmulatorHost || this.config.emulatorHost)) {
        const emuHost = this.config.storageEmulatorHost || this.config.emulatorHost;
        const [host, port] = emuHost.split(':');
        connectStorageEmulator(this.storage, host, parseInt(port || '9199', 10));
      }

      this._initialized = true;
    } catch (err) {
      console.error('[FirebaseStorageProvider] Falha ao inicializar Firebase Storage:', err);
      throw new Error(`Falha ao conectar com Firebase Storage: ${err.message}`);
    }
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

  _sanitizePathSegment(segment, paramName = 'segment') {
    if (typeof segment !== 'string' || !segment.trim()) {
      throw new Error(`Identificador inválido para ${paramName}.`);
    }
    const clean = segment.trim();
    if (clean.includes('/') || clean.includes('\\') || clean.includes('..') || clean.includes('\0') || clean.includes(':')) {
      throw new Error(`Tentativa de path traversal detectada no parâmetro ${paramName}: "${segment}".`);
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(clean)) {
      throw new Error(`Caracteres inválidos no parâmetro ${paramName}: "${segment}".`);
    }
    return clean;
  }

  _validateRemotePathForTenant(remotePath, expectedTenantId) {
    if (!remotePath || typeof remotePath !== 'string') return;
    if (remotePath.includes('..') || remotePath.includes('\\') || remotePath.includes('\0')) {
      throw new Error(`Path traversal detectado no caminho remoto: "${remotePath}".`);
    }
    const expectedPrefix = `tenants/${expectedTenantId}/`;
    if (!remotePath.startsWith(expectedPrefix)) {
      throw new Error(`Acesso cross-tenant negado: caminho remoto "${remotePath}" não pertence ao tenant "${expectedTenantId}".`);
    }
  }

  _buildRemotePath(tenantId, productId, photoId) {
    const cleanTenant = this._sanitizePathSegment(tenantId, 'tenantId');
    const cleanProduct = this._sanitizePathSegment(productId, 'productId');
    const cleanPhoto = this._sanitizePathSegment(photoId.replace(/\.webp$/i, ''), 'photoId');
    return `tenants/${cleanTenant}/products/${cleanProduct}/${cleanPhoto}.webp`;
  }

  async upload(blob, metadata = {}) {
    if (!this.isConfigured()) throw new Error('Firebase Storage não configurado.');
    if (!this.storage) await this.initialize();

    if (!blob) throw new Error('Blob de imagem é obrigatório.');

    const sizeBytes = blob.size !== undefined ? blob.size : (blob.length || 0);
    if (sizeBytes > this.maxSizeBytes) {
      throw new Error(`Arquivo excede o limite máximo permitido de ${Math.round(this.maxSizeBytes / (1024 * 1024))}MB.`);
    }

    const mimeType = blob.type || metadata.mimeType || 'image/webp';
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(mimeType)) {
      throw new Error(`Tipo de arquivo não permitido: ${mimeType}. Permitidos: image/jpeg, image/png, image/webp.`);
    }

    const tenantId = metadata.tenantId || this.getTenantId();
    const productId = metadata.productId || 'prod_unknown';
    const photoId = metadata.photoId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `photo_${Date.now()}`);
    const version = metadata.version || 1;
    const hash = metadata.hash || (await this._calculateHash(blob));
    const remotePath = this._buildRemotePath(tenantId, productId, photoId);

    const storageRef = ref(this.storage, remotePath);
    const customMetadata = {
      photoId,
      productId,
      tenantId,
      version: String(version),
      hash,
      label: metadata.label || 'Foto do Produto'
    };

    try {
      await uploadBytes(storageRef, blob, {
        contentType: mimeType,
        customMetadata
      });

      const url = await getDownloadURL(storageRef);
      const uploadedAt = new Date().toISOString();

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
    } catch (err) {
      throw new Error(`Falha no upload para o Firebase Storage: ${err.message}`);
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
    if (!this.storage) await this.initialize();
    const tenantId = this.getTenantId();
    if (!remotePath) {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    } else {
      this._validateRemotePathForTenant(remotePath, tenantId);
    }

    try {
      const storageRef = ref(this.storage, remotePath);
      await deleteObject(storageRef);
      return true;
    } catch (err) {
      if (err.code === 'storage/object-not-found') {
        return false;
      }
      throw new Error(`Falha ao excluir foto do Firebase Storage: ${err.message}`);
    }
  }

  async download(photoId, remotePath = '') {
    if (!this.storage) await this.initialize();
    const tenantId = this.getTenantId();
    if (!remotePath) {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    } else {
      this._validateRemotePathForTenant(remotePath, tenantId);
    }
    try {
      const storageRef = ref(this.storage, remotePath);
      const url = await getDownloadURL(storageRef);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar foto.`);
      return await res.blob();
    } catch (err) {
      if (err.code === 'storage/object-not-found') {
        const notFoundErr = new Error(`Foto ${photoId} não encontrada no Firebase Storage.`);
        notFoundErr.code = 'NOT_FOUND';
        throw notFoundErr;
      }
      throw err;
    }
  }

  async getUrl(photoId, remotePath = '') {
    if (!this.storage) await this.initialize();
    const tenantId = this.getTenantId();
    if (remotePath) {
      this._validateRemotePathForTenant(remotePath, tenantId);
    } else {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    }
    try {
      const storageRef = ref(this.storage, remotePath);
      return await getDownloadURL(storageRef);
    } catch (_) {
      return null;
    }
  }

  async getMetadata(photoId, remotePath = '') {
    if (!this.storage) await this.initialize();
    const tenantId = this.getTenantId();
    if (remotePath) {
      this._validateRemotePathForTenant(remotePath, tenantId);
    } else {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    }
    try {
      const storageRef = ref(this.storage, remotePath);
      const meta = await getMetadata(storageRef);
      return {
        photoId,
        sizeBytes: meta.size,
        mimeType: meta.contentType,
        updatedAt: meta.updated,
        customMetadata: meta.customMetadata
      };
    } catch (_) {
      return null;
    }
  }

  async exists(photoId, remotePath = '') {
    const meta = await this.getMetadata(photoId, remotePath);
    return !!meta;
  }
}
