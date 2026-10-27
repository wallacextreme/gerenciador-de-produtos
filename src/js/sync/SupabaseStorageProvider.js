import { ImageStorageProvider } from './ImageStorageProvider.js';
import { authService } from '../services/AuthService.js';
import { createClient } from '@supabase/supabase-js';

/**
 * GestãoPro — SupabaseStorageProvider (PHASE 14.1)
 *
 * Provedor de armazenamento de fotos no Supabase Storage:
 * 1. Autenticação delegada via Firebase Authentication (Third-Party Auth / JWKS).
 * 2. Bucket estritamente PRIVADO (`product-images`), protegido por Row Level Security (RLS).
 * 3. Isolamento multi-tenant garantido no cliente e validado por RLS no servidor:
 *    `tenants/{tenantId}/products/{productId}/{photoId}.webp`
 * 4. Suporte completo ao contrato ImageStorageProvider: upload, replace, download, delete, getUrl, getMetadata, exists.
 * 5. Tratamento de erros limpo e idempotente, compatível com Outbox e LocalImageCache.
 */
export class SupabaseStorageProvider extends ImageStorageProvider {
  /**
   * @param {Object} [config] Configuração do Supabase (supabaseUrl, supabaseKey / anonKey, bucketName)
   * @param {Object} [authServiceInstance] Instância do serviço de autenticação
   * @param {Object} [supabaseClient] Cliente pré-inicializado (útil para injeção em testes)
   */
  constructor(config = null, authServiceInstance = null, supabaseClient = null) {
    super();
    this.config = config || null;
    this.authService = authServiceInstance || authService;
    this.client = supabaseClient || null;
    this.bucketName = (config && config.bucketName) ? config.bucketName : 'product-images';
    this.maxSizeBytes = (config && typeof config.maxSizeBytes === 'number') ? config.maxSizeBytes : 10 * 1024 * 1024; // 10MB
    this._initialized = !!supabaseClient;
  }

  getProviderName() {
    return 'Supabase Storage';
  }

  _resolveEnvConfig() {
    if (!this.config || (!this.config.supabaseUrl && !this.config.url)) {
      const metaEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : null;
      const procEnv = (typeof process !== 'undefined' && process.env) ? process.env : null;

      const url = (metaEnv && (metaEnv.VITE_SUPABASE_URL || metaEnv.SUPABASE_URL)) ||
                  (procEnv && (procEnv.VITE_SUPABASE_URL || procEnv.SUPABASE_URL));

      const key = (metaEnv && (metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY || metaEnv.VITE_SUPABASE_ANON_KEY || metaEnv.VITE_SUPABASE_KEY || metaEnv.SUPABASE_ANON_KEY)) ||
                  (procEnv && (procEnv.VITE_SUPABASE_PUBLISHABLE_KEY || procEnv.VITE_SUPABASE_ANON_KEY || procEnv.VITE_SUPABASE_KEY || procEnv.SUPABASE_ANON_KEY));

      const bucket = (metaEnv && (metaEnv.VITE_SUPABASE_STORAGE_BUCKET || metaEnv.SUPABASE_STORAGE_BUCKET)) ||
                     (procEnv && (procEnv.VITE_SUPABASE_STORAGE_BUCKET || procEnv.SUPABASE_STORAGE_BUCKET)) ||
                     'product-images';

      if (url || key) {
        this.config = {
          ...this.config,
          supabaseUrl: url,
          supabaseKey: key,
          bucketName: bucket
        };
        if (bucket) this.bucketName = bucket;
      }
    }
  }

  _validateSecurityConstraints(url, key) {
    if (key && typeof key === 'string') {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('service_role') || lowerKey.includes('secret')) {
        throw new Error('[SEGURANÇA FAIL-CLOSED] Chave administrativa (service_role / secret) é estritamente proibida no cliente frontend.');
      }
      if (key.includes('.')) {
        try {
          const parts = key.split('.');
          if (parts.length >= 2) {
            const payloadStr = typeof atob === 'function' ? atob(parts[1]) : Buffer.from(parts[1], 'base64').toString('utf8');
            const payload = JSON.parse(payloadStr);
            if (payload && payload.role === 'service_role') {
              throw new Error('[SEGURANÇA FAIL-CLOSED] JWT com role "service_role" detectado. Apenas a chave anônima/pública (anon / publishable) é permitida no frontend.');
            }
          }
        } catch (e) {
          if (e.message.includes('SEGURANÇA FAIL-CLOSED')) throw e;
        }
      }
    }
  }

  isConfigured() {
    if (this.client) return true;
    this._resolveEnvConfig();
    if (!this.config) return false;
    const url = this.config.supabaseUrl || this.config.url;
    const key = this.config.supabaseKey || this.config.publishableKey || this.config.anonKey || this.config.supabaseAnonKey || this.config.apiKey;
    return !!(url && key);
  }

  /**
   * Inicializa o cliente Supabase configurando o token dinâmico do Firebase Auth.
   * @param {Object} [config]
   */
  async initialize(config = null) {
    if (config) {
      this.config = { ...this.config, ...config };
      if (config.bucketName) this.bucketName = config.bucketName;
      if (config.maxSizeBytes) this.maxSizeBytes = config.maxSizeBytes;
    }

    if (this.client) {
      this._initialized = true;
      return;
    }

    if (!this.isConfigured()) {
      return;
    }

    const supabaseUrl = this.config.supabaseUrl || this.config.url;
    const supabaseKey = this.config.supabaseKey || this.config.publishableKey || this.config.anonKey || this.config.apiKey;

    this._validateSecurityConstraints(supabaseUrl, supabaseKey);

    try {
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        accessToken: async () => {
          if (this.authService && typeof this.authService.getIdToken === 'function') {
            return await this.authService.getIdToken();
          }
          return null;
        }
      });
      this._initialized = true;
    } catch (err) {
      if (err.message.includes('SEGURANÇA FAIL-CLOSED')) {
        throw err;
      }
      console.error('[SupabaseStorageProvider] Falha ao instanciar Supabase Client:', err);
      throw new Error(`Falha ao conectar com Supabase Storage: ${err.message}`);
    }
  }

  /**
   * Retorna o tenantId ativo a partir do AuthService ou configuração.
   * @returns {string}
   */
  getTenantId() {
    const authTenant = this.authService ? this.authService.getTenantId() : null;
    return authTenant || (this.config && this.config.tenantId) || 'tenant_matriz_01';
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

  /**
   * Envia uma foto para o bucket privado do Supabase.
   * @param {Blob|File} blob 
   * @param {Object} [metadata]
   * @returns {Promise<Object>}
   */
  async upload(blob, metadata = {}) {
    if (!this.isConfigured()) throw new Error('Supabase Storage não configurado com credenciais válidas.');
    if (!this.client) await this.initialize();

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

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .upload(remotePath, blob, {
          contentType: mimeType,
          upsert: true,
          metadata: {
            photoId,
            productId,
            tenantId,
            version: String(version),
            hash,
            label: metadata.label || 'Foto do Produto'
          }
        });

      if (error) {
        throw new Error(error.message || `Erro de storage status ${error.statusCode || 'desconhecido'}`);
      }

      const uploadedAt = new Date().toISOString();

      return {
        photoId,
        url: remotePath, // Caminho canônico persistido no manifesto
        remotePath,
        storageProvider: 'supabase',
        version,
        hash,
        sizeBytes,
        mimeType,
        uploadedAt
      };
    } catch (err) {
      throw new Error(`Falha no upload para o Supabase Storage: ${err.message}`);
    }
  }

  /**
   * Substitui uma foto existente, incrementando a versão sequencial.
   * @param {string} photoId 
   * @param {Blob|File} blob 
   * @param {Object} [metadata]
   * @returns {Promise<Object>}
   */
  async replace(photoId, blob, metadata = {}) {
    const nextVersion = (metadata.version || 1) + 1;
    return this.upload(blob, {
      ...metadata,
      photoId,
      version: nextVersion
    });
  }

  /**
   * Remove a imagem do bucket privado do Supabase.
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<boolean>}
   */
  async delete(photoId, remotePath = '') {
    if (!this.client) await this.initialize();
    const tenantId = this.getTenantId();

    if (!remotePath) {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    } else {
      this._validateRemotePathForTenant(remotePath, tenantId);
    }

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .remove([remotePath]);

      if (error) {
        throw new Error(error.message);
      }
      return true;
    } catch (err) {
      throw new Error(`Falha ao excluir foto do Supabase Storage: ${err.message}`);
    }
  }

  /**
   * Baixa o Blob da imagem a partir do bucket privado autenticado.
   * @param {string} photoId 
   * @param {string} [remotePath]
   * @returns {Promise<Blob>}
   */
  async download(photoId, remotePath = '') {
    if (!this.client) await this.initialize();
    const tenantId = this.getTenantId();

    if (!remotePath) {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    } else {
      this._validateRemotePathForTenant(remotePath, tenantId);
    }

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .download(remotePath);

      if (error) {
        if (error.statusCode === 404 || error.message?.toLowerCase().includes('not found')) {
          const notFoundErr = new Error(`Foto ${photoId} não encontrada no Supabase Storage.`);
          notFoundErr.code = 'NOT_FOUND';
          throw notFoundErr;
        }
        throw new Error(error.message);
      }

      if (!data) {
        const emptyErr = new Error(`Blob vazio retornado para foto ${photoId}.`);
        emptyErr.code = 'EMPTY_RESPONSE';
        throw emptyErr;
      }

      return data;
    } catch (err) {
      if (err.code === 'NOT_FOUND') throw err;
      throw new Error(`Falha ao baixar foto do Supabase Storage: ${err.message}`);
    }
  }

  /**
   * Gera URL assinada temporária para visualização de trânsito em bucket privado.
   * @param {string} photoId 
   * @param {string} [remotePath] 
   * @param {number} [expiresIn=3600] Tempo de vida da URL assinada em segundos
   * @returns {Promise<string|null>}
   */
  async getUrl(photoId, remotePath = '', expiresIn = 3600) {
    if (!this.client) await this.initialize();
    const tenantId = this.getTenantId();

    if (remotePath) {
      this._validateRemotePathForTenant(remotePath, tenantId);
    } else {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    }

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .createSignedUrl(remotePath, expiresIn);

      if (error || !data) return null;
      return data.signedUrl;
    } catch (_) {
      return null;
    }
  }

  /**
   * Retorna metadados do arquivo a partir de consulta direta no Supabase Storage.
   * @param {string} photoId 
   * @param {string} [remotePath] 
   * @returns {Promise<Object|null>}
   */
  async getMetadata(photoId, remotePath = '') {
    if (!this.client) await this.initialize();
    const tenantId = this.getTenantId();

    if (remotePath) {
      this._validateRemotePathForTenant(remotePath, tenantId);
    } else {
      remotePath = this._buildRemotePath(tenantId, photoId, photoId);
    }

    try {
      // Extrai diretório pai e nome do arquivo
      const parts = remotePath.split('/');
      const fileName = parts.pop();
      const folder = parts.join('/');

      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .list(folder, {
          search: fileName,
          limit: 1
        });

      if (error || !data || data.length === 0) return null;

      const item = data.find(f => f.name === fileName) || data[0];
      return {
        photoId,
        sizeBytes: item.metadata?.size || item.size || 0,
        mimeType: item.metadata?.mimetype || 'image/webp',
        updatedAt: item.updated_at || item.created_at || new Date().toISOString(),
        customMetadata: item.metadata || {}
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Verifica existência do arquivo no bucket remoto.
   * @param {string} photoId 
   * @param {string} [remotePath] 
   * @returns {Promise<boolean>}
   */
  async exists(photoId, remotePath = '') {
    const meta = await this.getMetadata(photoId, remotePath);
    return !!meta;
  }

  /**
   * Executa um heartbeat leve contra a API do Supabase Storage para evitar
   * pausa por inatividade (> 7 dias) no Free Tier.
   * Possui throttle padrão de 12 horas para não gerar tráfego redundante.
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] Ignora o throttle de 12h
   * @returns {Promise<{ ok: boolean, skipped?: boolean, status?: number }>}
   */
  async pingKeepAlive(options = {}) {
    const supabaseUrl = (this.config.supabaseUrl || this.config.url || '').replace(/\/$/, '');
    const supabaseKey = this.config.supabaseKey || this.config.publishableKey || this.config.anonKey || this.config.supabaseAnonKey || this.config.apiKey;
    if (!supabaseUrl || !supabaseKey) {
      return { ok: false, skipped: true };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, skipped: true };
    }

    const THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 horas
    const STORAGE_KEY = 'gestaopro_supabase_keepalive_ts';

    if (!options.force && typeof localStorage !== 'undefined') {
      try {
        const lastTs = Number(localStorage.getItem(STORAGE_KEY) || 0);
        if (lastTs > 0 && (Date.now() - lastTs) < THROTTLE_MS) {
          return { ok: true, skipped: true, throttled: true };
        }
      } catch (_) {}
    }

    try {
      const fetchFn = (this.config && typeof this.config.fetchImpl === 'function')
        ? this.config.fetchImpl
        : fetch;

      const isJwt = typeof supabaseKey === 'string' && supabaseKey.split('.').length === 3;
      const authHeader = isJwt ? { Authorization: `Bearer ${supabaseKey}` } : {};

      let res = null;

      // Se endpoint explícito foi requisitado (ex: testes legados), honra diretamente
      if (options.endpoint) {
        res = await fetchFn(`${supabaseUrl}${options.endpoint}`, {
          method: options.method || 'GET',
          headers: { apikey: supabaseKey, ...authHeader }
        });
      } else {
        // 1. Tenta RPC real rpc_keep_alive para gerar escrita/atividade no PostgreSQL
        try {
          res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/rpc_keep_alive`, {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              'Content-Type': 'application/json',
              ...authHeader
            },
            body: JSON.stringify({ ping_source: 'app' })
          });
        } catch (_) {
          res = null;
        }

        // 2. Se a RPC não respondeu OK (ex: 404/migração pendente), fallback para Storage
        if (!res || !res.ok) {
          res = await fetchFn(`${supabaseUrl}/storage/v1/bucket`, {
            method: 'GET',
            headers: { apikey: supabaseKey, ...authHeader }
          });
        }
      }

      if (res && res.ok && typeof localStorage !== 'undefined') {
        try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
      }
      return { ok: !!(res && res.ok), status: res?.status };
    } catch (_) {
      return { ok: false };
    }
  }
}
