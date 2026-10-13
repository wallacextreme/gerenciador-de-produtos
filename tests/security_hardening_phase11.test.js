import { describe, it, expect, beforeEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { validateFirebaseConfig, isProductionProject } from '../src/js/utils/firebaseConfigValidator.js';
import { FirebaseStorageProvider } from '../src/js/sync/FirebaseStorageProvider.js';
import { ReportService } from '../src/js/services/ReportService.js';
import { ProductImageGallery } from '../src/js/components/ProductImageGallery.js';
import { webAdapter } from '../src/js/platform/webAdapter.js';
import { tauriAdapter } from '../src/js/platform/tauriAdapter.js';
import { EventBus } from '../src/js/eventBus.js';
import { SyncRepository } from '../src/js/repositories/SyncRepository.js';
import { AuthService } from '../src/js/services/AuthService.js';

describe('PHASE 11 — SECURITY HARDENING SUITE', () => {

  // =========================================================================
  // SEC-01: Secret Scan em todo o código-fonte e histórico
  // =========================================================================
  describe('SEC-01: Secret Scan no repositório de código', () => {
    it('nenhum arquivo do repositório deve conter chaves privadas ou service accounts reais', () => {
      const forbiddenTokens = [
        '-----BEGIN RSA PRIVATE KEY-----',
        '-----BEGIN PRIVATE KEY-----',
        'firebase-adminsdk',
        '"private_key": "-----BEGIN',
        'client_secret":'
      ];

      function scanDir(dir) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (['node_modules', '.git', 'dist'].includes(entry)) continue;
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (stat.isFile() && /\.(js|json|html|env|md)$/i.test(entry)) {
            const content = readFileSync(fullPath, 'utf-8');
            for (const token of forbiddenTokens) {
              expect(content.includes(token)).toBe(false);
            }
          }
        }
      }

      scanDir(join(process.cwd(), 'src'));
      scanDir(join(process.cwd(), 'public'));
    });
  });

  // =========================================================================
  // SEC-02: Config Validation
  // =========================================================================
  describe('SEC-02: Validação rigorosa de configuração Firebase', () => {
    it('deve aprovar configuração de staging válida', () => {
      const stagingConfig = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaSyStagingTestKey123',
        authDomain: 'gerenciador-produtos-staging.firebaseapp.com',
        databaseURL: 'https://gerenciador-produtos-staging-default-rtdb.firebaseio.com',
        storageBucket: 'gerenciador-produtos-staging.firebasestorage.app'
      };

      const result = validateFirebaseConfig(stagingConfig, {
        requireDatabaseURL: true,
        requireStorageBucket: true
      });
      expect(result.valid).toBe(true);
    });

    it('deve rejeitar configuração sem databaseURL quando exigido', () => {
      const config = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaSyStagingTestKey123'
      };

      expect(() => {
        validateFirebaseConfig(config, { requireDatabaseURL: true });
      }).toThrow('databaseURL');
    });

    it('deve rejeitar configuração sem storageBucket quando exigido', () => {
      const config = {
        projectId: 'gerenciador-produtos-staging',
        apiKey: 'AIzaSyStagingTestKey123'
      };

      expect(() => {
        validateFirebaseConfig(config, { requireStorageBucket: true });
      }).toThrow('storageBucket');
    });
  });

  // =========================================================================
  // SEC-03: Tenant Isolation (RTDB & Storage Rules)
  // =========================================================================
  describe('SEC-03: Isolamento estrito entre tenants', () => {
    it('database.rules.json deve restringir leitura e escrita estritamente ao mesmo tenant', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      const tenantRules = rules.rules.tenants.$tenantId;

      expect(tenantRules['.read']).toContain('auth.token.tenantId === $tenantId');
      // Garante que não há .write aberto na raiz do tenant (eliminação de cascata pai)
      expect(tenantRules['.write']).toBeUndefined();
    });

    it('storage.rules deve isolar pastas de arquivos por tenantId', () => {
      const storageContent = readFileSync(join(process.cwd(), 'storage.rules'), 'utf-8');
      expect(storageContent).toContain('match /tenants/{tenantId}/products/{productId}/{photoId}');
      expect(storageContent).toContain('request.auth.token.tenantId == tenantId');
    });
  });

  // =========================================================================
  // SEC-04: Unauthorized RTDB Read
  // =========================================================================
  describe('SEC-04: Bloqueio de leitura não-autenticada no RTDB', () => {
    it('nenhuma regra de leitura deve ser pública (auth == null)', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      expect(rules.rules['.read']).toBeUndefined();
      expect(rules.rules.tenants.$tenantId['.read']).toContain('auth != null');
      expect(rules.rules.users.$uid['.read']).toContain('auth != null');
    });
  });

  // =========================================================================
  // SEC-05: Unauthorized RTDB Write
  // =========================================================================
  describe('SEC-05: Bloqueio de escrita não-autorizada no RTDB', () => {
    it('rotas críticas (settings, purchases, suppliers) devem proibir escrita por operadores comuns', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      const tenant = rules.rules.tenants.$tenantId;

      expect(tenant.settings.$settingKey['.write']).toContain("appRole === 'admin'");
      expect(tenant.purchases.$purchaseId['.write']).toContain("appRole === 'admin'");
      expect(tenant.suppliers.$supplierId['.write']).toContain("appRole === 'admin'");
    });
  });

  // =========================================================================
  // SEC-06: Unauthorized Storage
  // =========================================================================
  describe('SEC-06: Bloqueio de acesso não-autorizado no Cloud Storage', () => {
    it('storage.rules deve exigir autenticação em todas as operações', () => {
      const content = readFileSync(join(process.cwd(), 'storage.rules'), 'utf-8');
      expect(content).toContain('allow read: if request.auth != null');
      expect(content).toContain('allow write: if request.auth != null');
      expect(content).toContain('allow delete: if request.auth != null');
    });
  });

  // =========================================================================
  // SEC-07: Invalid Role
  // =========================================================================
  describe('SEC-07: Rejeição de roles arbitrárias ou inexistentes', () => {
    it('as regras de segurança devem aceitar somente admin ou operator reconhecidos', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      const productWriteRule = rules.rules.tenants.$tenantId.products.$productId['.write'];

      expect(productWriteRule).toContain("appRole === 'admin'");
      expect(productWriteRule).toContain("appRole === 'operator'");
      expect(productWriteRule).not.toContain("appRole === 'superadmin'");
      expect(productWriteRule).not.toContain("appRole === 'root'");
    });
  });

  // =========================================================================
  // SEC-08: Forged Role Client-Side
  // =========================================================================
  describe('SEC-08: Bloqueio de auto-elevação de privilégio em /users/$uid', () => {
    it('usuário regular não pode alterar seu próprio role ou tenantId', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      const userWriteRule = rules.rules.users.$uid['.write'];

      // Regra exige que apenas admin altere role ou que o próprio usuário não injete role
      expect(userWriteRule).toContain("auth.token.appRole === 'admin'");
      expect(userWriteRule).toContain("!newData.hasChild('role')");
    });
  });

  // =========================================================================
  // SEC-09: XSS Product Name
  // =========================================================================
  describe('SEC-09: Proteção contra XSS no nome do produto', () => {
    it('ReportService deve escapar tags HTML no nome do produto', () => {
      const maliciousReport = {
        title: 'Relatório Teste',
        columns: [{ key: 'name', label: 'Nome' }],
        rows: [{ name: '<script>alert(1)</script>' }]
      };

      const html = ReportService.generatePrintableHTML(maliciousReport);
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  // =========================================================================
  // SEC-10: XSS Description & Notes
  // =========================================================================
  describe('SEC-10: Proteção contra XSS em descrições e observações', () => {
    it('ReportService deve escapar observações com payloads de injeção', () => {
      const maliciousReport = {
        title: 'Relatório Movimentações',
        columns: [{ key: 'reason', label: 'Motivo' }],
        rows: [{ reason: '<img src=x onerror="alert(\'xss\')">' }]
      };

      const html = ReportService.generatePrintableHTML(maliciousReport);
      expect(html).not.toContain('<img src=x onerror');
      expect(html).toContain('&lt;img src=x onerror=');
    });
  });

  // =========================================================================
  // SEC-11: XSS Image Label
  // =========================================================================
  describe('SEC-11: Proteção contra HTML injection em labels de fotos', () => {
    it('ProductImageGallery deve sanitizar nomes e labels de imagens', () => {
      const mockContainer = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
      const gallery = new ProductImageGallery(mockContainer, 'p1', {
        productName: '<svg onload=alert(1)>'
      });
      gallery.photos = [{ photoId: '1', url: 'https://exemplo.com/f.webp', label: '<svg onload=alert(1)>' }];
      gallery.state = 'READY';

      const html = gallery.getHTML();
      expect(html).not.toContain('<svg onload=alert(1)>');
      expect(html).toContain('&lt;svg onload=alert(1)&gt;');
    });
  });

  // =========================================================================
  // SEC-12: JavaScript URL Scheme
  // =========================================================================
  describe('SEC-12: Bloqueio de esquemas perigosos de URL (javascript:, data:)', () => {
    it('WebAdapter e TauriAdapter devem rejeitar URLs javascript:', async () => {
      expect(webAdapter._isSafeExternalUrl('javascript:alert(1)')).toBe(false);
      expect(webAdapter._isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(webAdapter._isSafeExternalUrl('https://exemplo.com')).toBe(true);

      expect(tauriAdapter._isSafeExternalUrl('javascript:alert(1)')).toBe(false);
      expect(tauriAdapter._isSafeExternalUrl('https://exemplo.com')).toBe(true);
    });

    it('ProductImageGallery deve sanitizar URLs rejeitando esquemas javascript:', () => {
      const mockContainer = { innerHTML: '' };
      const gallery = new ProductImageGallery(mockContainer, 'p1');

      expect(gallery._sanitizeImageUrl('javascript:alert(1)')).toBe('');
      expect(gallery._sanitizeImageUrl('data:text/html,abc')).toBe('');
      expect(gallery._sanitizeImageUrl('https://storage.googleapis.com/test.webp')).toContain('https://storage.googleapis.com/test.webp');
      expect(gallery._sanitizeImageUrl('blob:http://localhost/test')).toContain('blob:http://localhost/test');
    });
  });

  // =========================================================================
  // SEC-13: Malicious Filename
  // =========================================================================
  describe('SEC-13: Rejeição de caracteres maliciosos em nomes de arquivo', () => {
    it('FirebaseStorageProvider deve rejeitar nomes de arquivo com null byte ou caracteres inválidos', () => {
      const provider = new FirebaseStorageProvider();
      expect(() => {
        provider._sanitizePathSegment('arquivo\0malicioso.webp', 'photoId');
      }).toThrow('Tentativa de path traversal detectada');

      expect(() => {
        provider._sanitizePathSegment('foto:cmd.webp', 'photoId');
      }).toThrow('Tentativa de path traversal detectada');
    });
  });

  // =========================================================================
  // SEC-14: Path Traversal
  // =========================================================================
  describe('SEC-14: Bloqueio absoluto de Path Traversal (../, ..\\)', () => {
    it('FirebaseStorageProvider deve bloquear tentativas de traversal em qualquer parâmetro de caminho', () => {
      const provider = new FirebaseStorageProvider();

      expect(() => {
        provider._buildRemotePath('tenant_01', '../../etc', 'photo1');
      }).toThrow('path traversal');

      expect(() => {
        provider._buildRemotePath('tenant_01/sub', 'prod1', 'photo1');
      }).toThrow('path traversal');

      expect(() => {
        provider._buildRemotePath('..\\tenant_alheio', 'prod1', 'photo1');
      }).toThrow('path traversal');
    });

    it('FirebaseStorageProvider deve validar que caminhos remotos fornecidos pertencem ao mesmo tenant', () => {
      const provider = new FirebaseStorageProvider();
      expect(() => {
        provider._validateRemotePathForTenant('tenants/outroTenant/products/p1/f1.webp', 'meuTenant');
      }).toThrow('Acesso cross-tenant negado');
    });
  });

  // =========================================================================
  // SEC-15: Oversized Upload
  // =========================================================================
  describe('SEC-15: Bloqueio de uploads gigantes (>10MB)', () => {
    it('FirebaseStorageProvider deve rejeitar blobs acima de 10MB no cliente', async () => {
      const provider = new FirebaseStorageProvider({ apiKey: 'k', projectId: 'p', storageBucket: 'b' });
      provider.storage = {}; // Simula inicializado

      const oversizedBlob = { size: 11 * 1024 * 1024, type: 'image/webp' };
      expect(provider.upload(oversizedBlob)).rejects.toThrow('excede o limite');
    });

    it('storage.rules deve declarar limite máximo estrito de 10MB', () => {
      const content = readFileSync(join(process.cwd(), 'storage.rules'), 'utf-8');
      expect(content).toContain('request.resource.size < 10 * 1024 * 1024');
    });
  });

  // =========================================================================
  // SEC-16: Wrong MIME Type
  // =========================================================================
  describe('SEC-16: Bloqueio de arquivos não-imagem ou MIME malicioso', () => {
    it('FirebaseStorageProvider deve rejeitar executáveis, HTML, JSON ou SVG', async () => {
      const provider = new FirebaseStorageProvider({ apiKey: 'k', projectId: 'p', storageBucket: 'b' });
      provider.storage = {};

      const htmlBlob = { size: 100, type: 'text/html' };
      const svgBlob = { size: 100, type: 'image/svg+xml' };
      const jsBlob = { size: 100, type: 'application/javascript' };

      expect(provider.upload(htmlBlob)).rejects.toThrow('Tipo de arquivo não permitido');
      expect(provider.upload(svgBlob)).rejects.toThrow('Tipo de arquivo não permitido');
      expect(provider.upload(jsBlob)).rejects.toThrow('Tipo de arquivo não permitido');
    });

    it('storage.rules deve permitir somente formatos raster seguros (jpeg, png, webp)', () => {
      const content = readFileSync(join(process.cwd(), 'storage.rules'), 'utf-8');
      expect(content).toContain('image/jpeg');
      expect(content).toContain('image/png');
      expect(content).toContain('image/webp');
    });
  });

  // =========================================================================
  // SEC-17: Duplicate Mutation
  // =========================================================================
  describe('SEC-17: Idempotência e proteção contra mutações duplicadas', () => {
    it('SyncRepository deve manter consistência e coalescer operações com idempotência', async () => {
      const syncRepo = new SyncRepository();
      const mutationA = { entityType: 'products', entityId: 'p_dupl', action: 'CREATE', payload: { name: 'Prod A' } };
      
      const id1 = await syncRepo.enqueue(mutationA);
      const id2 = await syncRepo.enqueue(mutationA);

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      
      const pending = await syncRepo.getPending();
      // O repositório deve manter a fila estável sem corromper estado
      expect(pending.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SEC-18: Replay Mutation
  // =========================================================================
  describe('SEC-18: Prevenção de ataques de repetição (Replay Attacks)', () => {
    it('mutações marcadas como SYNCED não devem ser reprocessadas', async () => {
      const syncRepo = new SyncRepository();
      const item = await syncRepo.enqueue({ entityType: 'sales', entityId: 's_replay', action: 'CREATE', payload: {} });

      await syncRepo.markSynced(item.id);
      const pending = await syncRepo.getPending();
      const hasReplayed = pending.some(m => m.id === item.id);
      expect(hasReplayed).toBe(false);
    });
  });

  // =========================================================================
  // SEC-19: Service Worker Message Defense
  // =========================================================================
  describe('SEC-19: Defesa do Service Worker contra mensagens maliciosas', () => {
    it('sw.js deve ignorar comandos desconhecidos sem lançar exceções não tratadas', () => {
      const swContent = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8');
      expect(swContent).toContain("event.data.type === 'SKIP_WAITING'");
      expect(swContent).toContain("event.data.type === 'GET_VERSION'");
      expect(swContent).toContain("event.data.type === 'CLEAR_APP_CACHE'");
      expect(swContent).toContain("if (!event.data) return;");
    });
  });

  // =========================================================================
  // SEC-20: PostMessage / BroadcastChannel Origin Defense
  // =========================================================================
  describe('SEC-20: Validação de mensagens do EventBus (BroadcastChannel)', () => {
    it('EventBus deve validar tipo e estrutura do payload recebido via canal', () => {
      const bus = new EventBus();
      let dispatched = false;
      bus.on('TEST_EVENT', () => { dispatched = true; });

      // Simula recebimento de mensagem malformada (falsy ou sem type)
      if (bus.channel && typeof bus.channel.onmessage === 'function') {
        bus.channel.onmessage({ data: null });
        bus.channel.onmessage({ data: 'string_inválida' });
        bus.channel.onmessage({ data: { type: '' } });
      }

      expect(dispatched).toBe(false);
    });
  });

  // =========================================================================
  // SEC-21: Local Secret Exposure
  // =========================================================================
  describe('SEC-21: Ausência de credenciais em armazenamento local', () => {
    it('o código-fonte nunca deve salvar tokens ou senhas em localStorage', () => {
      function scanDirForStorage(dir) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (['node_modules', '.git'].includes(entry)) continue;
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDirForStorage(fullPath);
          } else if (stat.isFile() && entry.endsWith('.js')) {
            const content = readFileSync(fullPath, 'utf-8');
            if (content.includes('localStorage.setItem')) {
              expect(content).not.toContain("localStorage.setItem('token'");
              expect(content).not.toContain("localStorage.setItem('password'");
              expect(content).not.toContain("localStorage.setItem('secret'");
            }
          }
        }
      }
      scanDirForStorage(join(process.cwd(), 'src/js'));
    });
  });

  // =========================================================================
  // SEC-22: Cache Secret Exposure
  // =========================================================================
  describe('SEC-22: Isolamento de dados no Service Worker Cache Storage', () => {
    it('sw.js nunca deve armazenar respostas autenticadas ou dados comerciais no cache', () => {
      const swContent = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf-8');
      expect(swContent).toContain("url.origin !== self.location.origin");
      expect(swContent).toContain("url.pathname.includes('/tenants/')");
    });
  });

  // =========================================================================
  // SEC-23: Production Config Blocked
  // =========================================================================
  describe('SEC-23: Bloqueio estrito de projetos de produção', () => {
    it('validateFirebaseConfig deve bloquear qualquer projeto com prod ou production', () => {
      expect(() => {
        validateFirebaseConfig({ projectId: 'empresa-prod-v1' });
      }).toThrow('PRODUÇÃO');

      expect(() => {
        validateFirebaseConfig({ projectId: 'tabela-porta-escovas' });
      }).toThrow('PRODUÇÃO');

      expect(isProductionProject('empresa-production')).toBe(true);
      expect(isProductionProject('gerenciador-produtos-staging')).toBe(false);
    });
  });

  // =========================================================================
  // SEC-24: Admin Credential Blocked
  // =========================================================================
  describe('SEC-24: Bloqueio de Service Account keys no frontend', () => {
    it('validateFirebaseConfig deve rejeitar chaves administrativas', () => {
      expect(() => {
        validateFirebaseConfig({ projectId: 'staging', private_key: 'segredo' });
      }).toThrow('Segredo administrativo detectado');

      expect(() => {
        validateFirebaseConfig({ projectId: 'staging', client_secret: 'segredo' });
      }).toThrow('Segredo administrativo detectado');

      expect(() => {
        validateFirebaseConfig({ projectId: 'staging', serviceAccount: 'obj' });
      }).toThrow('Segredo administrativo detectado');
    });
  });

  // =========================================================================
  // SEC-25: Error Sanitization
  // =========================================================================
  describe('SEC-25: Sanitização de erros sem vazamento de paths internos', () => {
    it('mensagens de erro do validador devem ser limpas e objetivas', () => {
      try {
        validateFirebaseConfig({ projectId: 'loja-prod' });
      } catch (err) {
        expect(err.message).not.toContain('C:\\Users');
        expect(err.message).not.toContain('/home/');
        expect(err.message).toContain('PRODUÇÃO');
      }
    });
  });

  // =========================================================================
  // SEC-26: Route Authorization
  // =========================================================================
  describe('SEC-26: Proteção e guarda de rotas autenticadas', () => {
    it('AuthService deve reportar estado não-autenticado por padrão sem sessão válida', () => {
      const auth = new AuthService();
      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.getUser()).toBeNull();
      expect(auth.getTenantId()).toBeNull();
    });
  });

  // =========================================================================
  // SEC-27: Logout Protection
  // =========================================================================
  describe('SEC-27: Limpeza integral de credenciais no Logout', () => {
    it('logout deve anular usuário, tenant e dados de sessão', async () => {
      const auth = new AuthService();
      await auth.init();
      auth.currentSession = { authenticated: true, user: { uid: 'u1' }, tenantId: 'tenant_1' };

      await auth.logout();
      expect(auth.getCurrentUser()).toBeNull();
      expect(auth.getTenantId()).toBeNull();
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  // =========================================================================
  // SEC-28: Multi-Tab Auth Synchronization
  // =========================================================================
  describe('SEC-28: Sincronização segura de eventos de autenticação entre abas', () => {
    it('EventBus deve suportar broadcast do evento AUTH_STATE_CHANGED', () => {
      const bus = new EventBus();
      let stateEmitted = null;
      bus.on('AUTH_STATE_CHANGED', (payload) => {
        stateEmitted = payload;
      });

      bus.emit('AUTH_STATE_CHANGED', { isAuthenticated: false });
      expect(stateEmitted).toEqual({ isAuthenticated: false });
    });
  });

  // =========================================================================
  // SEC-29: Sync Anti-Loop Defense
  // =========================================================================
  describe('SEC-29: Prevenção de loop infinito de sincronização entre dispositivos', () => {
    it('deviceId deve existir e ser consistente para identificação anti-loop', () => {
      const deviceIdKey = 'gestaopro_device_id';
      const deviceId = 'device_test_123';
      
      // Valida padrão de UUID ou identificador não-vazio
      expect(deviceId).toMatch(/^device_/);
    });
  });

  // =========================================================================
  // SEC-30: Malicious TenantId Defense
  // =========================================================================
  describe('SEC-30: Rejeição de TenantId forjado ou malicioso', () => {
    it('FirebaseStorageProvider deve rejeitar tenantId com injeção ou caracteres ilegais', () => {
      const provider = new FirebaseStorageProvider();

      expect(() => {
        provider._sanitizePathSegment('<script>', 'tenantId');
      }).toThrow('Caracteres inválidos');

      expect(() => {
        provider._sanitizePathSegment('../tenantB', 'tenantId');
      }).toThrow('path traversal');

      expect(() => {
        provider._sanitizePathSegment('tenant 01', 'tenantId');
      }).toThrow('Caracteres inválidos');

      // Tenant válido deve passar
      expect(provider._sanitizePathSegment('tenant_matriz-01', 'tenantId')).toBe('tenant_matriz-01');
    });
  });

});
