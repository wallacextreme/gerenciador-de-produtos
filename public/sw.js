/**
 * GestãoPro — Service Worker (FASE 11 - PWA & Resiliência Offline)
 * 
 * Princípios de Design:
 *   - App Shell & Assets Estáticos → Gerenciados pelo Service Worker.
 *   - Dados de Negócio (Produtos, Estoque, Vendas, etc.) → Gerenciados exclusivamente pelo IndexedDB.
 *   - O Service Worker NUNCA apaga ou interfere no IndexedDB.
 */

const CACHE_VERSION = 'gestaopro-v1.13.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Escopo e base path dinâmicos do Service Worker (compatível com GitHub Pages e raiz)
const scopeUrl = self.registration ? new URL(self.registration.scope) : new URL(self.location.origin);
const basePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;

// Recursos críticos do shell da aplicação para cache imediato na instalação
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
// 1. INSTALL — Pré-cache do shell estático
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker:', CACHE_VERSION);

  const scopePath = self.registration ? new URL(self.registration.scope).pathname.replace(/\/$/, '') : '';
  const assetsToCache = scopePath 
    ? SHELL_ASSETS.map(asset => asset === '/' ? (scopePath + '/') : (scopePath + asset))
    : SHELL_ASSETS;

  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pré-cacheando shell da aplicação...');
      return cache.addAll(assetsToCache).catch((err) => {
        console.warn('[SW] Aviso no pré-cache de assets:', err);
      });
    })
  );
});

// ============================================================
// 2. ACTIVATE — Limpeza segura de caches obsoletos
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando Service Worker:', CACHE_VERSION);

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
      // Assume o controle dos clientes abertos
      return self.clients.claim();
    })
  );
});

// ============================================================
// 3. FETCH — Intercepção de requisições
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições que não sejam HTTP(S) GET
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // 1. Navegação HTML (SPA / Hash Routes) → Network First com fallback transparente para o cache
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html' || (basePath && (url.pathname === basePath || url.pathname === `${basePath}index.html`))) {
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

  // 4. Demais recursos estáticos (CSS, fontes, imagens gerais) → Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ============================================================
// 4. MENSAGENS — Comunicação com a aplicação
// ============================================================
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Comando SKIP_WAITING recebido — ativando imediatamente.');
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

// ============================================================
// ESTRATÉGIAS DE CACHE
// ============================================================

/**
 * Network First: busca na rede; se falhar (offline), busca no cache.
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

    // Se estiver navegando e não encontrar a rota exata, serve o index.html em cache
    if (request.mode === 'navigate') {
      const fallbackIndex = await cache.match(`${basePath}index.html`) || await cache.match(basePath);
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
    console.warn('[SW] Cache First — recurso indisponível offline:', request.url);
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
