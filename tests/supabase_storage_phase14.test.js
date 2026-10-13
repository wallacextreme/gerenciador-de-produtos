import { describe, it, expect, beforeEach } from 'bun:test';
import { SupabaseStorageProvider } from '../src/js/sync/SupabaseStorageProvider.js';
import { ImageStorageProvider } from '../src/js/sync/ImageStorageProvider.js';
import { MockImageStorageProvider } from '../src/js/sync/MockImageStorageProvider.js';
import { ImageSyncService, SYNC_PRIORITY, QUEUE_STATE } from '../src/js/services/ImageSyncService.js';
import { normalizeImageMetadata, computeImageHash } from '../src/js/services/ImageManifestService.js';

// Helper de criação de Blob
function createTestBlob(content = 'fake_webp_image_content', mimeType = 'image/webp') {
  return new Blob([content], { type: mimeType });
}

/**
 * Cria um Mock funcional do cliente Supabase Storage em memória,
 * simulando exatamente o comportamento da API `@supabase/supabase-js`.
 */
function createMockSupabaseClient(options = {}) {
  const objects = new Map(); // path -> { data: Blob, contentType: string, metadata: Object, updated_at: string }
  let tokenResolver = options.accessToken || (async () => {
    if (options.authService && typeof options.authService.getIdToken === 'function') {
      return await options.authService.getIdToken();
    }
    return 'fake-jwt-token';
  });

  return {
    _objects: objects,
    _setTokenResolver: (fn) => { tokenResolver = fn; },
    storage: {
      from: (bucketName) => ({
        upload: async (path, blob, uploadOpts = {}) => {
          const token = await tokenResolver();
          if (!token) {
            return { data: null, error: { message: 'JWT ausente ou sessão não autenticada', statusCode: 401 } };
          }
          if (options.simulateNetworkError) {
            return { data: null, error: { message: 'Failed to fetch (Network Error)', statusCode: 0 } };
          }
          if (uploadOpts.upsert === false && objects.has(path)) {
            return { data: null, error: { message: 'Object already exists', statusCode: 409 } };
          }

          objects.set(path, {
            data: blob,
            contentType: uploadOpts.contentType || blob.type || 'image/webp',
            metadata: uploadOpts.metadata || {},
            updated_at: new Date().toISOString()
          });

          return { data: { path, id: path, fullPath: `${bucketName}/${path}` }, error: null };
        },

        download: async (path) => {
          const token = await tokenResolver();
          if (!token) {
            return { data: null, error: { message: 'JWT ausente ou sessão não autenticada', statusCode: 401 } };
          }
          if (options.simulateNetworkError) {
            return { data: null, error: { message: 'Failed to fetch (Network Error)', statusCode: 0 } };
          }
          if (!objects.has(path)) {
            return { data: null, error: { message: 'The resource was not found', statusCode: 404 } };
          }

          const obj = objects.get(path);
          return { data: obj.data, error: null };
        },

        remove: async (paths = []) => {
          const token = await tokenResolver();
          if (!token) {
            return { data: null, error: { message: 'JWT ausente ou sessão não autenticada', statusCode: 401 } };
          }
          const removed = [];
          for (const p of paths) {
            if (objects.has(p)) {
              objects.delete(p);
              removed.push({ name: p });
            }
          }
          return { data: removed, error: null };
        },

        createSignedUrl: async (path, expiresIn = 3600) => {
          const token = await tokenResolver();
          if (!token) {
            return { data: null, error: { message: 'JWT ausente', statusCode: 401 } };
          }
          if (!objects.has(path)) {
            return { data: null, error: { message: 'Object not found', statusCode: 404 } };
          }
          return {
            data: {
              signedUrl: `https://fake-supabase.co/storage/v1/object/sign/product-images/${path}?token=mock-signed-token-${Date.now()}`
            },
            error: null
          };
        },

        list: async (folder = '', listOpts = {}) => {
          const token = await tokenResolver();
          if (!token) {
            return { data: null, error: { message: 'JWT ausente', statusCode: 401 } };
          }
          const results = [];
          for (const [k, v] of objects.entries()) {
            if (k.startsWith(folder)) {
              const fileName = k.replace(`${folder}/`, '');
              if (!listOpts.search || fileName.includes(listOpts.search)) {
                results.push({
                  name: fileName,
                  size: v.data.size,
                  updated_at: v.updated_at,
                  metadata: {
                    mimetype: v.contentType,
                    size: v.data.size,
                    ...v.metadata
                  }
                });
              }
            }
          }
          return { data: results, error: null };
        }
      })
    }
  };
}

describe('PHASE 14.1 — Supabase Storage Provider & Multi-Provider Image Sync Suite', () => {
  const TENANT_MATRIZ = 'tenant_matriz_sp';
  const TENANT_FILIAL = 'tenant_filial_rj';

  let mockClient;
  let mockAuthService;
  let provider;

  beforeEach(() => {
    mockAuthService = {
      _session: {
        authenticated: true,
        tenantId: TENANT_MATRIZ,
        role: 'admin',
        appRole: 'admin'
      },
      isAuthenticated: () => !!mockAuthService._session?.authenticated,
      getIdToken: async () => mockAuthService._session?.authenticated ? 'valid-jwt-token' : null,
      getTenantId: () => mockAuthService._session?.tenantId || null,
      getRole: () => mockAuthService._session?.role || 'operator',
      getClaims: async () => ({
        tenantId: mockAuthService._session?.tenantId,
        role: 'authenticated', // Claim técnica para o Supabase
        appRole: mockAuthService._session?.appRole || 'admin'
      })
    };

    mockClient = createMockSupabaseClient({ authService: mockAuthService });

    provider = new SupabaseStorageProvider(
      {
        supabaseUrl: 'https://xyzcompany.supabase.co',
        supabaseKey: 'anon-public-key-for-test',
        bucketName: 'product-images',
        tenantId: TENANT_MATRIZ
      },
      mockAuthService,
      mockClient
    );
  });

  describe('1. Inicialização e Conformidade com ImageStorageProvider', () => {
    it('deve herdar de ImageStorageProvider e reportar nome e configuração corretos', () => {
      expect(provider).toBeInstanceOf(ImageStorageProvider);
      expect(provider.getProviderName()).toBe('Supabase Storage');
      expect(provider.isConfigured()).toBe(true);
    });

    it('isConfigured deve retornar false se URL ou chave estiverem ausentes e sem client injetado', () => {
      const emptyProvider = new SupabaseStorageProvider({}, mockAuthService, null);
      expect(emptyProvider.isConfigured()).toBe(false);
    });

    it('deve resolver o tenantId ativo a partir do AuthService', () => {
      expect(provider.getTenantId()).toBe(TENANT_MATRIZ);
      mockAuthService._session.tenantId = 'tenant_custom_456';
      expect(provider.getTenantId()).toBe('tenant_custom_456');
    });
  });

  describe('2. Segurança, Isolamento Multi-Tenant e Sanitização de Caminhos', () => {
    it('deve gerar o caminho canônico correto tenants/{tenantId}/products/{productId}/{photoId}.webp', async () => {
      const blob = createTestBlob('foto_cafe_1');
      const res = await provider.upload(blob, {
        productId: 'prod_cafe_torrado',
        photoId: 'photo_001'
      });

      expect(res.remotePath).toBe(`tenants/${TENANT_MATRIZ}/products/prod_cafe_torrado/photo_001.webp`);
      expect(res.storageProvider).toBe('supabase');
      expect(res.version).toBe(1);
    });

    it('deve bloquear e rejeitar tentativas de path traversal em photoId, productId ou tenantId', async () => {
      const blob = createTestBlob('foto_traversal');

      // Tentativa de sair do diretório via ../
      expect(
        provider.upload(blob, { productId: '../hack_dir', photoId: 'photo_1' })
      ).rejects.toThrow('Tentativa de path traversal detectada');

      expect(
        provider.upload(blob, { productId: 'prod_1', photoId: '../../root_escape' })
      ).rejects.toThrow('Tentativa de path traversal detectada');

      expect(
        provider.upload(blob, { productId: 'prod_1', photoId: 'photo\0null_byte' })
      ).rejects.toThrow('Tentativa de path traversal detectada');
    });

    it('deve bloquear operações cross-tenant quando remotePath não pertence ao tenant autenticado', async () => {
      const foreignPath = `tenants/${TENANT_FILIAL}/products/prod_outro/foto.webp`;

      expect(
        provider.download('foto', foreignPath)
      ).rejects.toThrow('Acesso cross-tenant negado');

      expect(
        provider.delete('foto', foreignPath)
      ).rejects.toThrow('Acesso cross-tenant negado');

      expect(
        provider.getUrl('foto', foreignPath)
      ).rejects.toThrow('Acesso cross-tenant negado');
    });
  });

  describe('3. Validação de Arquivos e Restrições de Upload', () => {
    it('deve aceitar formatos de imagem raster permitidos (WebP, JPEG, PNG)', async () => {
      const webpBlob = createTestBlob('bytes_webp', 'image/webp');
      const jpegBlob = createTestBlob('bytes_jpeg', 'image/jpeg');
      const pngBlob = createTestBlob('bytes_png', 'image/png');

      const resWebp = await provider.upload(webpBlob, { productId: 'p1', photoId: 'ph_webp' });
      expect(resWebp.mimeType).toBe('image/webp');

      const resJpeg = await provider.upload(jpegBlob, { productId: 'p1', photoId: 'ph_jpeg' });
      expect(resJpeg.mimeType).toBe('image/jpeg');

      const resPng = await provider.upload(pngBlob, { productId: 'p1', photoId: 'ph_png' });
      expect(resPng.mimeType).toBe('image/png');
    });

    it('deve rejeitar categoricamente arquivos não permitidos (SVG, PDF, executáveis)', async () => {
      const svgBlob = createTestBlob('<svg>alert(1)</svg>', 'image/svg+xml');
      const pdfBlob = createTestBlob('%PDF-1.4 fake', 'application/pdf');

      expect(
        provider.upload(svgBlob, { productId: 'p1' })
      ).rejects.toThrow('Tipo de arquivo não permitido');

      expect(
        provider.upload(pdfBlob, { productId: 'p1' })
      ).rejects.toThrow('Tipo de arquivo não permitido');
    });

    it('deve rejeitar arquivos que excedam o tamanho máximo permitido (10MB)', async () => {
      const hugeBlob = {
        size: 11 * 1024 * 1024,
        type: 'image/webp'
      };

      expect(
        provider.upload(hugeBlob, { productId: 'p1' })
      ).rejects.toThrow('excede o limite máximo permitido de 10MB');
    });

    it('replace deve incrementar atomicamente a versão sequencial', async () => {
      const blobV1 = createTestBlob('foto_versao_1');
      const blobV2 = createTestBlob('foto_versao_2');

      const resV1 = await provider.upload(blobV1, { productId: 'p_ver', photoId: 'ph_ver' });
      expect(resV1.version).toBe(1);

      const resV2 = await provider.replace('ph_ver', blobV2, {
        productId: 'p_ver',
        version: resV1.version
      });
      expect(resV2.version).toBe(2);
      expect(resV2.photoId).toBe('ph_ver');
    });
  });

  describe('4. Download Privado, URLs Assinadas e Metadados', () => {
    it('download deve retornar o Blob correto armazenado no bucket privado', async () => {
      const originalBlob = createTestBlob('conteudo_exclusivo_do_produto');
      const uploadRes = await provider.upload(originalBlob, {
        productId: 'prod_privado',
        photoId: 'foto_privada'
      });

      const downloadedBlob = await provider.download('foto_privada', uploadRes.remotePath);
      expect(downloadedBlob).toBeDefined();
      expect(downloadedBlob.size).toBe(originalBlob.size);
    });

    it('download deve lançar erro com code NOT_FOUND se o arquivo não existir', async () => {
      const nonExistentPath = `tenants/${TENANT_MATRIZ}/products/prod_inexistente/foto_404.webp`;
      expect(
        provider.download('foto_404', nonExistentPath)
      ).rejects.toThrow('não encontrada no Supabase Storage');
    });

    it('getUrl deve gerar URL assinada com expiração para o bucket privado', async () => {
      const uploadRes = await provider.upload(createTestBlob('img_sign'), {
        productId: 'prod_sign',
        photoId: 'foto_sign'
      });

      const signedUrl = await provider.getUrl('foto_sign', uploadRes.remotePath, 1800);
      expect(signedUrl).toBeDefined();
      expect(typeof signedUrl).toBe('string');
      expect(signedUrl).toContain('mock-signed-token');
      expect(signedUrl).toContain(uploadRes.remotePath);
    });

    it('getMetadata e exists devem reportar metadados corretos', async () => {
      const uploadRes = await provider.upload(createTestBlob('img_meta'), {
        productId: 'prod_meta',
        photoId: 'foto_meta'
      });

      const exists = await provider.exists('foto_meta', uploadRes.remotePath);
      expect(exists).toBe(true);

      const meta = await provider.getMetadata('foto_meta', uploadRes.remotePath);
      expect(meta).toBeDefined();
      expect(meta.photoId).toBe('foto_meta');
      expect(meta.mimeType).toBe('image/webp');
    });

    it('delete deve remover com sucesso a foto no bucket remoto', async () => {
      const uploadRes = await provider.upload(createTestBlob('img_del'), {
        productId: 'prod_del',
        photoId: 'foto_del'
      });

      expect(await provider.exists('foto_del', uploadRes.remotePath)).toBe(true);
      const delSuccess = await provider.delete('foto_del', uploadRes.remotePath);
      expect(delSuccess).toBe(true);
      expect(await provider.exists('foto_del', uploadRes.remotePath)).toBe(false);
    });
  });

  describe('5. Autenticação, Tokens e Resolução de Papéis (appRole vs role)', () => {
    it('deve bloquear upload quando o usuário estiver deslogado (sem token)', async () => {
      mockAuthService._session = null;
      expect(
        provider.upload(createTestBlob('unauth'), { productId: 'p1' })
      ).rejects.toThrow('JWT ausente ou sessão não autenticada');
    });

    it('deve falhar de forma descritiva em caso de falha de rede', async () => {
      const netClient = createMockSupabaseClient({ simulateNetworkError: true });
      const netProvider = new SupabaseStorageProvider(
        { supabaseUrl: 'https://url', supabaseKey: 'key', tenantId: TENANT_MATRIZ },
        mockAuthService,
        netClient
      );

      expect(
        netProvider.upload(createTestBlob('offline'), { productId: 'p1' })
      ).rejects.toThrow('Network Error');
    });

    it('deve repassar erro descritivo em caso de violação de RLS (ex: token de viewer sem appRole de escrita)', async () => {
      const rlsClient = {
        storage: {
          from: () => ({
            upload: async () => ({
              data: null,
              error: {
                message: 'new row violates row-level security policy for table "objects"',
                statusCode: 403
              }
            })
          })
        }
      };

      const rlsProvider = new SupabaseStorageProvider(
        { supabaseUrl: 'https://url', supabaseKey: 'key', tenantId: TENANT_MATRIZ },
        mockAuthService,
        rlsClient
      );

      expect(
        rlsProvider.upload(createTestBlob('viewer_upload'), { productId: 'p1' })
      ).rejects.toThrow('row-level security policy');
    });
  });

  describe('6. Compatibilidade Multi-Provedor com ImageSyncService e Manifesto', () => {
    let syncService;
    let mockCache;
    let mockFirebaseStorage;

    beforeEach(() => {
      mockCache = {
        _cache: new Map(),
        has: async (tenantId, photoId, version) => mockCache._cache.has(`${tenantId}:${photoId}:v${version}`),
        get: async (tenantId, photoId) => mockCache._cache.get(`${tenantId}:${photoId}`) || null,
        put: async (item) => {
          mockCache._cache.set(`${item.tenantId}:${item.photoId}:v${item.version}`, item);
          mockCache._cache.set(`${item.tenantId}:${item.photoId}`, item);
        },
        remove: async (tenantId, photoId) => {
          mockCache._cache.delete(`${tenantId}:${photoId}`);
        },
        getQuotaEstimate: async () => ({ supported: true, percentUsed: 0.1, available: 1000000 })
      };

      mockFirebaseStorage = new MockImageStorageProvider({
        tenantId: TENANT_MATRIZ
      });

      syncService = new ImageSyncService({
        storageProvider: mockFirebaseStorage, // Padrão legado: Firebase
        imageCache: mockCache,
        isOnline: true
      });

      // Registra provedor alternativo Supabase no registry de multi-provedores
      syncService.registerProvider('supabase', provider);
      syncService.registerProvider('firebase', mockFirebaseStorage);
    });

    it('normalizeImageMetadata deve preservar storageProvider e remotePath sem quebrar fotos legadas', () => {
      // Foto legada sem storageProvider explícito
      const legacy = normalizeImageMetadata({
        photoId: 'photo_legacy_1',
        productId: 'prod_1',
        url: 'https://firebasestorage.googleapis.com/.../photo_legacy_1.webp'
      });
      expect(legacy.photoId).toBe('photo_legacy_1');
      expect(legacy.storageProvider).toBeUndefined();

      // Nova foto com Supabase Storage
      const supabasePhoto = normalizeImageMetadata({
        photoId: 'photo_supa_1',
        productId: 'prod_2',
        storageProvider: 'supabase',
        remotePath: 'tenants/t1/products/p2/photo_supa_1.webp',
        url: 'tenants/t1/products/p2/photo_supa_1.webp'
      });
      expect(supabasePhoto.storageProvider).toBe('supabase');
      expect(supabasePhoto.remotePath).toBe('tenants/t1/products/p2/photo_supa_1.webp');
    });

    it('ImageSyncService deve despachar download para o SupabaseStorageProvider quando foto declarar storageProvider="supabase"', async () => {
      // 1. Cadastra foto no Supabase Storage
      const blobSupa = createTestBlob('foto_sincronizada_pelo_supabase');
      const hashSupa = await computeImageHash(blobSupa);
      const uploadSupa = await provider.upload(blobSupa, {
        productId: 'prod_supa_sync',
        photoId: 'ph_supa_sync'
      });

      // 2. Enfileira no ImageSyncService declarando storageProvider = 'supabase'
      syncService.enqueue({
        photoId: 'ph_supa_sync',
        productId: 'prod_supa_sync',
        tenantId: TENANT_MATRIZ,
        expectedVersion: 1,
        expectedHash: hashSupa,
        remotePath: uploadResPath(uploadSupa.remotePath),
        storageProvider: 'supabase',
        priority: SYNC_PRIORITY.P1
      });

      function uploadResPath(p) { return p; }

      // 3. Aguarda o processamento assíncrono da fila
      await new Promise(r => setTimeout(r, 60));

      // 4. Valida se a imagem foi baixada do Supabase e persistida no LocalImageCache
      const cached = await mockCache.has(TENANT_MATRIZ, 'ph_supa_sync', 1);
      expect(cached).toBe(true);
    });

    it('ImageSyncService deve despachar fotos legadas sem storageProvider para o provedor default (Firebase)', async () => {
      // 1. Cadastra foto no Firebase Storage legado
      const blobFb = createTestBlob('foto_legada_firebase');
      const hashFb = await computeImageHash(blobFb);
      const uploadFb = await mockFirebaseStorage.upload(blobFb, {
        productId: 'prod_legado',
        photoId: 'ph_legado'
      });

      // 2. Enfileira sem storageProvider (legado)
      syncService.enqueue({
        photoId: 'ph_legado',
        productId: 'prod_legado',
        tenantId: TENANT_MATRIZ,
        expectedVersion: 1,
        expectedHash: hashFb,
        url: uploadFb.url,
        priority: SYNC_PRIORITY.P1
      });

      // 3. Aguarda o processamento
      await new Promise(r => setTimeout(r, 60));

      // 4. Valida se a imagem legada foi baixada com sucesso pelo FirebaseStorageProvider
      const cached = await mockCache.has(TENANT_MATRIZ, 'ph_legado', 1);
      expect(cached).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Verificação Estática de Especificação das Políticas RLS do Supabase Storage
  // ---------------------------------------------------------------------------
  describe('7. Verificação Estática e Especificação Formal das Políticas RLS do Supabase Storage', () => {
    // Modelagem pura dos predicados SQL definidos em 20261010000000_create_product_images_storage.sql
    function evaluateSelectPolicy({ bucket_id, name, jwt }) {
      if (bucket_id !== 'product-images') return false;
      if (!jwt || jwt.role !== 'authenticated') return false;
      if (!jwt.tenantId || typeof jwt.tenantId !== 'string') return false;

      const parts = name.split('/');
      // split_part 1 a 5 não-vazios, e 6 vazio (isto é, exatamente 5 segmentos)
      if (parts.length !== 5) return false;
      return parts[0] === 'tenants' &&
             parts[1] === jwt.tenantId &&
             parts[2] === 'products' &&
             parts[3].length > 0 &&
             parts[4].length > 0;
    }

    function evaluateWritePolicy({ bucket_id, name, jwt }) {
      if (!evaluateSelectPolicy({ bucket_id, name, jwt })) return false;
      return ['admin', 'operator'].includes(jwt.appRole);
    }

    const validPath = 'tenants/tenant_alpha/products/prod_100/photo_01.webp';

    it('Token canônico com appRole válido ("admin" ou "operator") autoriza leitura e escrita', () => {
      const adminJwt = { role: 'authenticated', appRole: 'admin', tenantId: 'tenant_alpha' };
      const opJwt = { role: 'authenticated', appRole: 'operator', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: adminJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: adminJwt })).toBe(true);

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: opJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: opJwt })).toBe(true);
    });

    it('Token canônico com appRole "viewer" autoriza leitura mas nega escrita (fail-closed)', () => {
      const viewerJwt = { role: 'authenticated', appRole: 'viewer', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: viewerJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: viewerJwt })).toBe(false);
    });

    it('Token canônico sem appRole autoriza leitura mas nega escrita', () => {
      const noAppRoleJwt = { role: 'authenticated', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: noAppRoleJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: noAppRoleJwt })).toBe(false);
    });

    it('Token canônico com appRole inválido ("superadmin") autoriza leitura mas nega escrita', () => {
      const badAppRoleJwt = { role: 'authenticated', appRole: 'superadmin', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: badAppRoleJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: badAppRoleJwt })).toBe(false);
    });

    it('Token canônico com appRole presente com valor null autoriza leitura mas nega escrita (fail-closed)', () => {
      const nullAppRoleJwt = { role: 'authenticated', appRole: null, tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: nullAppRoleJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: nullAppRoleJwt })).toBe(false);
    });

    it('Token canônico com appRole vazio ("") autoriza leitura mas nega escrita (fail-closed)', () => {
      const emptyAppRoleJwt = { role: 'authenticated', appRole: '', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: emptyAppRoleJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: emptyAppRoleJwt })).toBe(false);
    });

    it('Token canônico com appRole de tipo numérico incorreto (123) autoriza leitura mas nega escrita (fail-closed)', () => {
      const numberAppRoleJwt = { role: 'authenticated', appRole: 123, tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: numberAppRoleJwt })).toBe(true);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: numberAppRoleJwt })).toBe(false);
    });

    it('Token conflitante (role: "admin", appRole: "superadmin") tem leitura e escrita negadas por não ter role="authenticated"', () => {
      const conflictJwt = { role: 'admin', appRole: 'superadmin', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: conflictJwt })).toBe(false);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: conflictJwt })).toBe(false);
    });

    it('Token legado do Firebase (role: "admin", sem appRole) tem acesso ao Supabase negado até a migração de claims', () => {
      const legacyJwt = { role: 'admin', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: legacyJwt })).toBe(false);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: legacyJwt })).toBe(false);
    });

    it('Tentativa de acesso cross-tenant é categoricamente rejeitada em leitura e escrita', () => {
      const crossJwt = { role: 'authenticated', appRole: 'admin', tenantId: 'tenant_beta' };

      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: validPath, jwt: crossJwt })).toBe(false);
      expect(evaluateWritePolicy({ bucket_id: 'product-images', name: validPath, jwt: crossJwt })).toBe(false);
    });

    it('Caminho fora do contrato canônico (tentativa de escape ou número incorreto de segmentos) é negado', () => {
      const adminJwt = { role: 'authenticated', appRole: 'admin', tenantId: 'tenant_alpha' };

      // Escape com 6 segmentos
      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: 'tenants/tenant_alpha/products/p1/extra/photo.webp', jwt: adminJwt })).toBe(false);
      // Segmento vazio ou incompleto
      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: 'tenants/tenant_alpha/products//photo.webp', jwt: adminJwt })).toBe(false);
      // Fora de tenants/
      expect(evaluateSelectPolicy({ bucket_id: 'product-images', name: 'public/photo.webp', jwt: adminJwt })).toBe(false);
    });

    it('Tentativa de acesso a bucket diferente de "product-images" é categoricamente negada', () => {
      const adminJwt = { role: 'authenticated', appRole: 'admin', tenantId: 'tenant_alpha' };

      expect(evaluateSelectPolicy({ bucket_id: 'other-bucket', name: validPath, jwt: adminJwt })).toBe(false);
      expect(evaluateWritePolicy({ bucket_id: 'other-bucket', name: validPath, jwt: adminJwt })).toBe(false);
    });
  });
});

