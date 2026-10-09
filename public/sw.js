/**
 * GestãoPro — Service Worker (PHASE 10 - PWA Hardening)
 * 
 * Princípios Arquiteturais:
 *   - APP SHELL & ASSETS ESTÁTICOS: Gerenciados pelo Service Worker via Cache Storage.
 *   - DADOS DE NEGÓCIO (Produtos, Vendas, Estoque, Outbox): Gerenciados exclusivamente pelo IndexedDB.
 *   - IMAGENS DE PRODUTOS: Gerenciadas exclusivamente pelo LocalImageCache (IndexedDB Blobs).
 *   - O Service Worker NUNCA apaga bancos ou stores do IndexedDB.
 *   - O Service Worker NUNCA armazena dados sensíveis ou intercepta APIs em nuvem.
 */

const CACHE_VERSION = 'gestaopro-v1.13.0-pwa10';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Escopo e base path dinâmicos do Service Worker (compatível com GitHub Pages e raiz)
const scopeUrl = self.registration ? new URL(self.registration.scope) : new URL(self.location.origin);
const basePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;

// Recursos essenciais do shell da aplicação para pré-cache na instalação
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-96.png',
  '/icons/icon-144.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// ============================================================
// 1. INSTALL — Pré-cache do shell estático resiliente
// ============================================================
self.addEventListener('install', (event) => {
  const scopePath = self.registration ? new URL(self.registration.scope).pathname.replace(/\/$/, '') : '';
  const assetsToCache = scopePath 
    ? SHELL_ASSETS.map(asset => asset === '/' ? (scopePath + '/') : (scopePath + asset))
    : SHELL_ASSETS;

  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // Pré-cache individual resiliente: falha em um asset opcional não bloqueia a instalação do shell
      await Promise.allSettled(
        assetsToCache.map(asset =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Aviso no pré-cache de asset:', asset, err?.message);
          })
        )
      );
    })
  );
});

// ============================================================
// 2. ACTIVATE — Limpeza segura de versões anteriores de cache
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('gestaopro-') && name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Removendo cache obsoleto de versão anterior:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Assume o controle dos clientes abertos imediatamente
      return self.clients.claim();
    })
  );
});

// ============================================================
// 3. FETCH — Intercepção e separação rigorosa de camadas
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições que não sejam HTTP(S) GET
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ISOLAMENTO DE CAMADAS:
  // Ignora requisições a serviços externos (Firebase Auth, Realtime Database, Firestore REST, Cloudinary, etc.)
  // O Service Worker lida EXCLUSIVAMENTE com o App Shell local no mesmo origin.
  if (url.origin !== self.location.origin) {
    return;
  }

  // ISOLAMENTO DE IMAGENS DE PRODUTO:
  // Imagens de produtos pertencem exclusivamente ao LocalImageCache (IndexedDB Blobs).
  // O Service Worker NUNCA armazena fotos de produtos no Cache Storage.
  if (url.pathname.includes('/tenants/') || url.pathname.includes('/products/images/')) {
    return;
  }

  // 1. Navegação HTML (SPA / Hash Routes) → Network First com fallback transparente para index.html
  if (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    (basePath && (url.pathname === basePath || url.pathname === `${basePath}index.html`))
  ) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // 2. Assets compilados pelo Vite (/assets/* com hash imutável) → Cache First
  if (url.pathname.startsWith('/assets/') || url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // 3. Ícones e Manifest → Cache First (com revalidação)
  if (url.pathname.includes('/icons/') || url.pathname.endsWith('/manifest.json')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 4. Demais recursos estáticos locais (CSS, fontes locais, JS) → Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ============================================================
// 4. MENSAGENS — Comunicação com a aplicação
// ============================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  // Comando para ativar novo worker imediatamente
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Consulta de versão ativa do Service Worker
  if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }

  // Recuperação de Cache Corrompido: purga caches do GestãoPro sob demanda
  if (event.data.type === 'CLEAR_APP_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => {
        return Promise.all(
          names.filter((n) => n.startsWith('gestaopro-')).map((n) => caches.delete(n))
        );
      }).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true, cleared: true });
        }
      })
    );
  }

  // Ping de diagnóstico
  if (event.data.type === 'PING' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'PONG', version: CACHE_VERSION });
  }
});

// ============================================================
// ESTRATÉGIAS DE CACHE
// ============================================================

/**
 * Network First: busca na rede; se falhar (offline), busca no cache.
 * Garante que navegações SPA caiam no index.html mesmo quando offline.
 */
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    // Se estiver navegando e a rota exata não estiver no cache, serve o index.html
    if (request.mode === 'navigate') {
      const fallbackIndex = 
        await cache.match(`${basePath}index.html`) || 
        await cache.match('/index.html') || 
        await cache.match(basePath) || 
        await cache.match('/');
      if (fallbackIndex) return fallbackIndex;
    }

    return new Response('Offline — recurso não disponível no cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/**
 * Cache First: serve do cache se existir; senão, busca na rede e armazena.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return new Response('Offline — recurso não disponível no cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/**
 * Stale While Revalidate: serve do cache imediatamente e atualiza em segundo plano.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((response) => {
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch || new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
