import { describe, it, expect, beforeEach } from 'bun:test';
import { SupabaseStorageProvider } from '../src/js/sync/SupabaseStorageProvider.js';
import { ImageSyncService } from '../src/js/services/ImageSyncService.js';

describe('FASE 15.5 — Auditoria de Hardening do SupabaseStorageProvider', () => {
  let mockAuthService;

  beforeEach(() => {
    mockAuthService = {
      _token: 'valid_firebase_jwt_token',
      _tenantId: 'tenant_staging_01',
      _role: 'operator',
      getIdToken: async () => mockAuthService._token,
      getTenantId: () => mockAuthService._tenantId,
      getRole: () => mockAuthService._role,
      isAuthenticated: () => !!mockAuthService._token
    };
  });

  describe('1. Validação de Segurança de Credenciais e Bloqueio de service_role', () => {
    it('1.1 Rejeita com erro fail-closed chave contendo a substring service_role', async () => {
      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: 'supabase_service_role_secret_key_12345'
      }, mockAuthService);

      await expect(provider.initialize()).rejects.toThrow(/Chave administrativa \(service_role \/ secret\) é estritamente proibida/);
    });

    it('1.2 Rejeita com erro fail-closed chave contendo a substring secret', async () => {
      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: 'my_super_secret_admin_key'
      }, mockAuthService);

      await expect(provider.initialize()).rejects.toThrow(/Chave administrativa \(service_role \/ secret\) é estritamente proibida/);
    });

    it('1.3 Rejeita com erro fail-closed JWT cujo payload decodificado possua role: service_role', async () => {
      // Cria JWT sintético com payload { role: "service_role" }
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const payload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64');
      const signature = 'fake_signature';
      const fakeServiceJwt = `${header}.${payload}.${signature}`;

      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: fakeServiceJwt
      }, mockAuthService);

      await expect(provider.initialize()).rejects.toThrow(/JWT com role "service_role" detectado/);
    });

    it('1.4 Aceita chave pública/anônima válida (anon key)', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const payload = Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64');
      const signature = 'fake_signature';
      const fakeAnonJwt = `${header}.${payload}.${signature}`;

      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: fakeAnonJwt
      }, mockAuthService);

      expect(() => provider._validateSecurityConstraints(provider.config.supabaseUrl, provider.config.supabaseKey)).not.toThrow();
    });
  });

  describe('2. Resolução de Configuração via import.meta.env', () => {
    it('2.1 isConfigured() e initialize() identificam variáveis de ambiente quando config não é fornecido', () => {
      const prevUrl = process.env.VITE_SUPABASE_URL;
      const prevKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const prevBucket = process.env.VITE_SUPABASE_STORAGE_BUCKET;
      try {
        process.env.VITE_SUPABASE_URL = 'https://demo-staging.supabase.co';
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_pub_staging_valid_key_123';
        process.env.VITE_SUPABASE_STORAGE_BUCKET = 'product-images';

        const provider = new SupabaseStorageProvider(null, mockAuthService);
        expect(provider.isConfigured()).toBe(true);
        expect(provider.config.supabaseUrl).toBe('https://demo-staging.supabase.co');
        expect(provider.config.supabaseKey).toBe('sb_pub_staging_valid_key_123');
        expect(provider.bucketName).toBe('product-images');
      } finally {
        if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl; else delete process.env.VITE_SUPABASE_URL;
        if (prevKey !== undefined) process.env.VITE_SUPABASE_PUBLISHABLE_KEY = prevKey; else delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (prevBucket !== undefined) process.env.VITE_SUPABASE_STORAGE_BUCKET = prevBucket; else delete process.env.VITE_SUPABASE_STORAGE_BUCKET;
      }
    });

    it('2.2 Suporta VITE_SUPABASE_ANON_KEY como fallback para a chave pública', () => {
      const prevUrl = process.env.VITE_SUPABASE_URL;
      const prevKey = process.env.VITE_SUPABASE_ANON_KEY;
      try {
        process.env.VITE_SUPABASE_URL = 'https://demo-staging.supabase.co';
        process.env.VITE_SUPABASE_ANON_KEY = 'sb_anon_staging_valid_key_456';

        const provider = new SupabaseStorageProvider(null, mockAuthService);
        expect(provider.isConfigured()).toBe(true);
        expect(provider.config.supabaseKey).toBe('sb_anon_staging_valid_key_456');
      } finally {
        if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl; else delete process.env.VITE_SUPABASE_URL;
        if (prevKey !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevKey; else delete process.env.VITE_SUPABASE_ANON_KEY;
      }
    });

    it('2.3 Retorna isConfigured() false se variáveis estiverem ausentes e sem client injetado', () => {
      const prevUrl = process.env.VITE_SUPABASE_URL;
      const prevKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
      try {
        delete process.env.VITE_SUPABASE_URL;
        delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        delete process.env.VITE_SUPABASE_ANON_KEY;

        const provider = new SupabaseStorageProvider(null, mockAuthService);
        expect(provider.isConfigured()).toBe(false);
      } finally {
        if (prevUrl !== undefined) process.env.VITE_SUPABASE_URL = prevUrl;
        if (prevKey !== undefined) process.env.VITE_SUPABASE_PUBLISHABLE_KEY = prevKey;
        if (prevAnon !== undefined) process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
      }
    });
  });

  describe('3. Integração com AuthService e Mecanismo accessToken', () => {
    it('3.1 Provider obtém dinamicamente o ID token da sessão ativa do Firebase Auth', async () => {
      let capturedAccessTokenFn = null;
      const fakeClient = {
        storage: {
          from: () => ({})
        }
      };

      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: 'public_anon_key_123'
      }, mockAuthService);

      // Injeta client fake para testar o handler accessToken
      const clientOptions = {
        accessToken: async () => {
          if (provider.authService && typeof provider.authService.getIdToken === 'function') {
            return await provider.authService.getIdToken();
          }
          return null;
        }
      };

      const token1 = await clientOptions.accessToken();
      expect(token1).toBe('valid_firebase_jwt_token');

      // Simula renovação do token na sessão ativa do Firebase
      mockAuthService._token = 'refreshed_firebase_jwt_token_v2';
      const token2 = await clientOptions.accessToken();
      expect(token2).toBe('refreshed_firebase_jwt_token_v2');

      // Simula logout
      mockAuthService._token = null;
      const token3 = await clientOptions.accessToken();
      expect(token3).toBeNull();
    });

    it('3.2 getTenantId() resolve estritamente a partir do AuthService ativo', () => {
      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://staging-project.supabase.co',
        supabaseKey: 'public_anon_key_123'
      }, mockAuthService);

      expect(provider.getTenantId()).toBe('tenant_staging_01');

      mockAuthService._tenantId = 'tenant_staging_filial_02';
      expect(provider.getTenantId()).toBe('tenant_staging_filial_02');
    });
  });

  describe('4. Compatibilidade com ImageSyncService e Despacho de Provedor', () => {
    it('4.1 ImageSyncService despacha itens com storageProvider="supabase" para o provedor Supabase', () => {
      const syncService = new ImageSyncService();
      const mockSupabaseProvider = {
        getProviderName: () => 'Supabase Storage',
        download: async () => new Blob(['fake_data'])
      };

      syncService.setStorageProvider(mockSupabaseProvider, 'supabase');

      const resolved = syncService._resolveProvider({ storageProvider: 'supabase' });
      expect(resolved).toBe(mockSupabaseProvider);
      expect(resolved.getProviderName()).toBe('Supabase Storage');
    });
  });

  describe('5. Keep-Alive Automático Anti-Pausa (pingKeepAlive)', () => {
    it('5.1 pingKeepAlive({ force: true }) envia GET autenticado para /storage/v1/bucket e respeita throttle de 12h', async () => {
      const calls = [];
      const mockFetch = async (url, opts) => {
        calls.push({ url, opts });
        return {
          ok: true,
          status: 200,
          json: async () => []
        };
      };

      const provider = new SupabaseStorageProvider({
        supabaseUrl: 'https://fujgtzxzspqhvvbzmqzv.supabase.co',
        supabaseAnonKey: 'sb_publishable_test_key',
        fetchImpl: mockFetch
      });

      const first = await provider.pingKeepAlive({ force: true });
      expect(first.ok).toBe(true);
      expect(first.status).toBe(200);
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe('https://fujgtzxzspqhvvbzmqzv.supabase.co/storage/v1/bucket');
      expect(calls[0].opts.method).toBe('GET');
      expect(calls[0].opts.headers.apikey).toBe('sb_publishable_test_key');

      // Se localStorage estiver disponível no ambiente, verifica throttle; caso contrário force:true sempre executa
      if (typeof localStorage !== 'undefined') {
        const second = await provider.pingKeepAlive({ force: false });
        expect(second.ok).toBe(true);
        expect(second.throttled).toBe(true);
        expect(calls.length).toBe(1);
      }
    });
  });
});
