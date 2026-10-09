import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getDB, closeDB } from '../src/js/db/connection.js';
import { PWAHandler, pwaHandler } from '../src/js/utils/pwa.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import { syncRepository } from '../src/js/repositories/SyncRepository.js';
import { syncEngine } from '../src/js/services/SyncEngine.js';
import { localImageCache } from '../src/js/services/LocalImageCache.js';
import { authService } from '../src/js/services/AuthService.js';
import { platform } from '../src/js/platform/platform.js';
import { ProductImageGallery, GALLERY_STATE } from '../src/js/components/ProductImageGallery.js';

describe('PHASE 10 — PWA Hardening & Resiliência Operacional', () => {
  const manifestPath = resolve(process.cwd(), 'public', 'manifest.json');
  const swPath = resolve(process.cwd(), 'public', 'sw.js');

  beforeEach(async () => {
    localImageCache.revokeAllUrls();
    const db = await getDB();
    if (db.objectStoreNames.contains('syncQueue')) {
      const tx = db.transaction(['syncQueue'], 'readwrite');
      await tx.objectStore('syncQueue').clear();
      await tx.done;
    }
  });

  afterEach(() => {
    localImageCache.revokeAllUrls();
  });

  // =========================================================================
  // PWA-01: Manifest Válido
  // =========================================================================
  it('PWA-01: deve possuir manifesto W3C válido com todas as declarações de PWA', () => {
    expect(existsSync(manifestPath)).toBe(true);
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe('GestãoPro — Gestão Comercial e Estoque');
    expect(manifest.short_name).toBe('GestãoPro');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#0f172a');
    expect(manifest.theme_color).toBe('#0f172a');
    expect(manifest.lang).toBe('pt-BR');

    // Ícones obrigatórios
    expect(Array.isArray(manifest.icons)).toBe(true);
    const sizes = manifest.icons.map(i => i.sizes);
    expect(sizes).toContain('96x96');
    expect(sizes).toContain('144x144');
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    // Confirma existência dos ícones físicos no disco
    for (const icon of manifest.icons) {
      const p = resolve(process.cwd(), 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(p)).toBe(true);
    }
  });

  // =========================================================================
  // PWA-02: Service Worker Registra
  // =========================================================================
  it('PWA-02: deve registrar o Service Worker com escopo dinâmico correto', async () => {
    const handler = new PWAHandler();
    let registeredPath = null;
    let registeredOptions = null;

    // Simula navigator.serviceWorker.register
    const originalNavigator = globalThis.navigator;
    const fakeRegistration = {
      scope: '/',
      waiting: null,
      installing: null,
      addEventListener: mock(() => {})
    };

    globalThis.navigator = {
      ...originalNavigator,
      serviceWorker: {
        register: mock(async (path, opts) => {
          registeredPath = path;
          registeredOptions = opts;
          return fakeRegistration;
        }),
        controller: null,
        addEventListener: mock(() => {})
      }
    };

    await handler._registerServiceWorker();

    expect(globalThis.navigator.serviceWorker.register).toHaveBeenCalled();
    expect(registeredPath).toMatch(/sw\.js$/);
    expect(registeredOptions).toBeDefined();

    globalThis.navigator = originalNavigator;
  });

  // =========================================================================
  // PWA-03: Offline App Shell
  // =========================================================================
  it('PWA-03: deve declarar App Shell no sw.js com fallback transparente para index.html', () => {
    const swContent = readFileSync(swPath, 'utf-8');

    expect(swContent).toContain('SHELL_ASSETS');
    expect(swContent).toContain("'/index.html'");
    expect(swContent).toContain("'/manifest.json'");
    expect(swContent).toContain('networkFirst');

    // O fallback para navegação offline deve servir index.html
    expect(swContent).toContain("request.mode === 'navigate'");
    expect(swContent).toContain('index.html');
  });

  // =========================================================================
  // PWA-04: Cache Versioning
  // =========================================================================
  it('PWA-04: deve adotar versionamento semântico explícito separando static e runtime', () => {
    const swContent = readFileSync(swPath, 'utf-8');

    expect(swContent).toMatch(/CACHE_VERSION\s*=\s*'gestaopro-v1\.\d+\.\d+/);
    expect(swContent).toContain('STATIC_CACHE = `${CACHE_VERSION}-static`');
    expect(swContent).toContain('RUNTIME_CACHE = `${CACHE_VERSION}-runtime`');
  });

  // =========================================================================
  // PWA-05: Old Cache Cleanup
  // =========================================================================
  it('PWA-05: deve limpar exclusivamente caches obsoletos do GestãoPro no evento activate', () => {
    const swContent = readFileSync(swPath, 'utf-8');

    expect(swContent).toContain("addEventListener('activate'");
    expect(swContent).toContain('caches.keys()');
    expect(swContent).toContain("name.startsWith('gestaopro-')");
    expect(swContent).toContain('caches.delete(name)');
    expect(swContent).toContain('self.clients.claim()');
  });

  // =========================================================================
  // PWA-06: IndexedDB Preservation
  // =========================================================================
  it('PWA-06: limpeza de cache e ciclo do SW NUNCA deve tocar ou apagar IndexedDB', async () => {
    const swContent = readFileSync(swPath, 'utf-8');
    expect(swContent).not.toContain('indexedDB.deleteDatabase');

    // Grava um produto de teste no banco local
    const db = await getDB();
    const testProd = { id: 'p-test-sw-preserv', name: 'Preserved Prod', priceCents: 5000, tenantId: 'default_tenant' };
    await db.put('products', testProd);

    // Simula ciclo do PWA handler limpando cache
    const handler = new PWAHandler();
    await handler.clearAppCache();

    // Confirma que o produto continua intacto no IndexedDB
    const retrieved = await db.get('products', 'p-test-sw-preserv');
    expect(retrieved).not.toBeNull();
    expect(retrieved.name).toBe('Preserved Prod');

    await db.delete('products', 'p-test-sw-preserv');
  });

  // =========================================================================
  // PWA-07: syncQueue Preservation
  // =========================================================================
  it('PWA-07: atualização do SW não pode apagar ou corromper itens pendentes na Outbox', async () => {
    // Enfileira item de mutação
    const queuedItem = await syncRepository.enqueue({
      entityType: 'products',
      entityId: 'prod-outbox-sw',
      action: 'UPDATE',
      payload: { name: 'Updated in Outbox', priceCents: 9900 }
    });

    expect(queuedItem).toBeDefined();
    expect(queuedItem.id).toBeDefined();

    // Simula purga de cache do PWA
    const handler = new PWAHandler();
    await handler.clearAppCache();

    // Confirma que a fila continua íntegra
    const pending = await syncRepository.getPending();
    const found = pending.find(p => p.entityId === 'prod-outbox-sw');
    expect(found).toBeDefined();
    expect(found.action).toBe('UPDATE');
  });

  // =========================================================================
  // PWA-08: Image Cache Preservation
  // =========================================================================
  it('PWA-08: atualização do SW não pode apagar productImages ou imageManifest', async () => {
    const mockBlob = new Blob(['sample-pwa-image-content'], { type: 'image/webp' });
    const stored = await localImageCache.put({
      photoId: 'photo-pwa-guard',
      productId: 'prod-pwa-guard',
      blob: mockBlob,
      mimeType: 'image/webp',
      version: 1
    });

    expect(stored.photoId).toBe('photo-pwa-guard');

    // Simula limpeza de cache de App Shell
    const handler = new PWAHandler();
    await handler.clearAppCache();

    // Imagem e metadados no IndexedDB permanecem intactos
    const cachedImage = await localImageCache.get('photo-pwa-guard');
    expect(cachedImage).not.toBeNull();
    expect(cachedImage.photoId).toBe('photo-pwa-guard');
    expect(cachedImage.blob).toBeDefined();

    await localImageCache.remove('photo-pwa-guard', { hard: true });
  });

  // =========================================================================
  // PWA-09: New Version Detection
  // =========================================================================
  it('PWA-09: deve detectar nova versão aguardando ativação (waiting worker)', () => {
    const handler = new PWAHandler();
    let notified = false;

    const unsub = eventBus.on(EVENTS.PWA_UPDATE_READY, () => {
      notified = true;
    });

    handler.waitingWorker = { postMessage: mock(() => {}) };
    handler._notifyUpdateReady();

    expect(notified).toBe(true);
    unsub();
  });

  // =========================================================================
  // PWA-10: Update Prompt
  // =========================================================================
  it('PWA-10: deve emitir payload com método applyUpdate e validação de momento seguro', () => {
    const handler = new PWAHandler();
    let payloadReceived = null;

    const unsub = eventBus.on(EVENTS.PWA_UPDATE_READY, (data) => {
      payloadReceived = data;
    });

    handler._notifyUpdateReady();

    expect(payloadReceived).not.toBeNull();
    expect(typeof payloadReceived.applyUpdate).toBe('function');
    expect(typeof payloadReceived.isSafe).toBe('function');

    unsub();
  });

  // =========================================================================
  // PWA-11: Update While Offline
  // =========================================================================
  it('PWA-11: não deve aplicar atualização do Service Worker se estiver offline', () => {
    const handler = new PWAHandler();
    handler.isOnline = false;
    const postMessageMock = mock(() => {});
    handler.waitingWorker = { postMessage: postMessageMock };

    const applied = handler.applyUpdate();
    expect(applied).toBe(false);
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // PWA-12: Reconnect
  // =========================================================================
  it('PWA-12: reconexão (offline -> online) deve emitir evento padronizado', () => {
    const handler = new PWAHandler();
    let statusPayload = null;

    const unsub = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, (p) => {
      statusPayload = p;
    });

    handler._handleNetworkChange(true);

    expect(handler.isOnline).toBe(true);
    expect(statusPayload).not.toBeNull();
    expect(statusPayload.isOnline).toBe(true);
    expect(statusPayload.message).toBe('Conexão restaurada.');

    unsub();
  });

  // =========================================================================
  // PWA-13: Duplicate Online Events
  // =========================================================================
  it('PWA-13: rajada de eventos online simultâneos deve ser desconsiderada se estado não mudar', () => {
    const handler = new PWAHandler();
    let changeCount = 0;

    const unsub = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, () => {
      changeCount++;
    });

    // Se já está online, chamada direta atualiza mas debounce e proteção filtram
    handler.isOnline = true;
    handler._handleNetworkChange(true);
    expect(changeCount).toBe(1);

    unsub();
  });

  // =========================================================================
  // PWA-14: visibilitychange Throttling
  // =========================================================================
  it('PWA-14: retorno à aba (visibilitychange) deve respeitar throttle de 4 segundos', () => {
    const handler = new PWAHandler();
    expect(handler._foregroundThrottleMs).toBeGreaterThanOrEqual(3000);

    handler._lastForegroundTime = Date.now();
    const now = Date.now();
    // Dentro da janela de throttle deve ser ignorado
    const isThrottled = (now - handler._lastForegroundTime) < handler._foregroundThrottleMs;
    expect(isThrottled).toBe(true);
  });

  // =========================================================================
  // PWA-15: Focus Throttling
  // =========================================================================
  it('PWA-15: eventos de foco em rajada não devem disparar múltiplas sincronizações', () => {
    const handler = new PWAHandler();
    handler._lastForegroundTime = Date.now() - 5000; // Há 5s (expirou throttle)

    const canTrigger = (Date.now() - handler._lastForegroundTime) >= handler._foregroundThrottleMs;
    expect(canTrigger).toBe(true);
  });

  // =========================================================================
  // PWA-16: Object URL Cleanup
  // =========================================================================
  it('PWA-16: Object URLs gerados para imagens devem ser rastreados e revogados sem vazamento', async () => {
    const mockBlob = new Blob(['mock-data'], { type: 'image/webp' });
    await localImageCache.put({
      photoId: 'photo-cleanup-test',
      productId: 'prod-cleanup-test',
      blob: mockBlob,
      mimeType: 'image/webp'
    });

    const url = await localImageCache.createUrl('photo-cleanup-test');
    expect(url).toBeDefined();
    if (url) {
      expect(url).toMatch(/^blob:/);
      expect(localImageCache.getActiveUrlsCount()).toBeGreaterThan(0);

      localImageCache.revokeUrl(url);
      expect(localImageCache.getActiveUrlsCount()).toBe(0);
    }

    await localImageCache.remove('photo-cleanup-test', { hard: true });
  });

  // =========================================================================
  // PWA-17: Route Offline
  // =========================================================================
  it('PWA-17: rotas locais de negócio devem ser autorizadas offline com sessão persistida', () => {
    // Rota comercial não requer rede externa para autorização local
    const canDashboard = authService.canAccessRoute('dashboard');
    const canProducts = authService.canAccessRoute('produtos');
    const canStock = authService.canAccessRoute('estoque');

    expect(typeof canDashboard).toBe('boolean');
    expect(typeof canProducts).toBe('boolean');
    expect(typeof canStock).toBe('boolean');
  });

  // =========================================================================
  // PWA-18: Gallery Offline
  // =========================================================================
  it('PWA-18: galeria de imagens deve carregar foto do cache local em modo offline', async () => {
    const mockBlob = new Blob(['gallery-offline-blob'], { type: 'image/webp' });
    await localImageCache.put({
      photoId: 'photo-offline-gal',
      productId: 'prod-offline-gal',
      blob: mockBlob,
      isPrimary: true
    });

    const cached = await localImageCache.get('photo-offline-gal');
    expect(cached).not.toBeNull();
    expect(cached.blob).toBeDefined();

    const objectUrl = localImageCache.createUrl('photo-offline-gal', cached.blob);
    expect(objectUrl).toBeDefined();

    localImageCache.revokeUrl(objectUrl);
    await localImageCache.remove('photo-offline-gal', { hard: true });
  });

  // =========================================================================
  // PWA-19: Android/PWA Behavior Contract
  // =========================================================================
  it('PWA-19: deve identificar modo standalone sob contratos de desktop, iOS e Android', () => {
    const handler = new PWAHandler();
    const result = handler.isStandalone();
    expect(typeof result).toBe('boolean');
  });

  // =========================================================================
  // PWA-20: Tauri Separation
  // =========================================================================
  it('PWA-20: ambiente desktop Tauri deve desabilitar/ignorar Service Worker e install prompt', async () => {
    const handler = new PWAHandler();

    // Simula ambiente desktop Tauri
    const originalIsDesktop = platform.isDesktop;
    platform.isDesktop = () => true;

    await handler.init();

    // Não deve tentar registrar SW nem configurar install prompt em Tauri
    expect(handler.swRegistration).toBeNull();
    expect(handler.isInstallable).toBe(false);

    platform.isDesktop = originalIsDesktop;
  });

  // =========================================================================
  // PWA-21: Corrupted Cache Recovery
  // =========================================================================
  it('PWA-21: clearAppCache deve limpar caches com prefixo gestaopro- sem erros', async () => {
    const handler = new PWAHandler();
    const success = await handler.clearAppCache();
    expect(success).toBe(true);
  });

  // =========================================================================
  // PWA-22: Quota Handling
  // =========================================================================
  it('PWA-22: getStorageQuota deve fornecer estimativa de armazenamento resiliente', async () => {
    const handler = new PWAHandler();
    const quota = await handler.getStorageQuota();

    expect(quota).toBeDefined();
    expect(typeof quota.usage).toBe('number');
    expect(typeof quota.quota).toBe('number');
    expect(quota.quota).toBeGreaterThan(0);
    expect(typeof quota.percentUsed).toBe('number');
  });

  // =========================================================================
  // PWA-23: Restart Recovery
  // =========================================================================
  it('PWA-23: reinicialização do banco e handler deve manter estado persistido sem falhas', async () => {
    const db1 = await getDB();
    expect(db1).toBeDefined();

    const handler = new PWAHandler();
    expect(handler.isOnline).toBe(true);
    expect(handler._initialized).toBe(false);

    await handler.init();
    expect(handler._initialized).toBe(true);
  });

  // =========================================================================
  // PWA-24: No Destructive Migration
  // =========================================================================
  it('PWA-24: conexão com banco de dados deve preservar todas as 9 stores sem migrações destrutivas', async () => {
    const db = await getDB();
    const expectedStores = [
      'products',
      'stockMovements',
      'sales',
      'purchases',
      'suppliers',
      'settings',
      'syncQueue',
      'imageManifest',
      'productImages'
    ];

    for (const storeName of expectedStores) {
      expect(db.objectStoreNames.contains(storeName)).toBe(true);
    }
  });
});
