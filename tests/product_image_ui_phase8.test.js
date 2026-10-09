import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ProductImageGallery, GALLERY_STATE } from '../src/js/components/ProductImageGallery.js';
import { EventBus, EVENTS } from '../src/js/eventBus.js';

// Setup de Mock DOM minimalista e robusto para testes unitários em Bun
class MockDOMElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this._innerHTML = '';
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.className = '';
    this.parentNode = null;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    this._parseBasicHTML(html);
  }

  _parseBasicHTML(html) {
    this.children = [];
    const stack = [this];
    const tagRegex = /<(\/)?([a-z0-9]+)([^>]*)>/gi;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      const isClosing = !!match[1];
      const tagName = match[2].toLowerCase();
      const attrsStr = match[3] || '';
      const isSelfClosing = attrsStr.trim().endsWith('/') || ['img', 'input', 'br', 'hr', 'circle', 'path'].includes(tagName);

      if (isClosing) {
        if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName) {
          stack.pop();
        }
      } else {
        const currentParent = stack[stack.length - 1];
        const el = new MockDOMElement(tagName);
        el.parentNode = currentParent;

        // Extrai atributos: key="val" ou key='val'
        const attrRegex = /([a-z0-9_-]+)(?:=["']([^"']*)["'])?/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          const attrName = attrMatch[1].toLowerCase();
          if (attrName === '/' || !attrName) continue;
          const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : '';
          el.setAttribute(attrName, attrVal);
          if (attrName.startsWith('data-')) {
            const key = attrName.slice(5);
            el.dataset[key] = attrVal;
          }
        }

        currentParent.children.push(el);

        if (!isSelfClosing) {
          stack.push(el);
        }
      }
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = val;
    if (name === 'class') this.className = val;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(fn);
  }

  removeEventListener(event, fn) {
    if (!this.listeners.has(event)) return;
    const arr = this.listeners.get(event).filter(cb => cb !== fn);
    this.listeners.set(event, arr);
  }

  dispatchEvent(evt) {
    const type = typeof evt === 'string' ? evt : evt.type;
    const fns = this.listeners.get(type) || [];
    for (const fn of fns) {
      fn(typeof evt === 'string' ? { type: evt, target: this, stopPropagation: () => {} } : evt);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
  }

  querySelector(selector) {
    if (!selector) return null;
    const sel = selector.trim();

    // Por id (#foo)
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this._findRecursive(el => el.id === id);
    }

    // Por classe (.foo)
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this._findRecursive(el => el.className && el.className.split(/\s+/).includes(cls));
    }

    // Por tag
    return this._findRecursive(el => el.tagName.toLowerCase() === sel.toLowerCase());
  }

  querySelectorAll(selector) {
    const results = [];
    if (!selector) return results;
    const sel = selector.trim();

    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      this._findAllRecursive(el => el.className && el.className.split(/\s+/).includes(cls), results);
    } else if (sel.startsWith('#')) {
      const id = sel.slice(1);
      this._findAllRecursive(el => el.id === id, results);
    } else {
      this._findAllRecursive(el => el.tagName.toLowerCase() === sel.toLowerCase(), results);
    }
    return results;
  }

  _findRecursive(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._findRecursive(predicate);
      if (found) return found;
    }
    return null;
  }

  _findAllRecursive(predicate, out) {
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      child._findAllRecursive(predicate, out);
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
}

describe('PHASE 08 — PRODUCT IMAGE UI / GALLERY', () => {
  let originalDocument;
  let originalWindow;
  let originalURL;
  let testContainer;
  let customBus;
  let revokedUrls;
  let reloadMock;

  beforeEach(() => {
    revokedUrls = [];
    reloadMock = mock(() => {});
    customBus = new EventBus();

    // Mock global Document & Window
    originalDocument = globalThis.document;
    originalWindow = globalThis.window;
    originalURL = globalThis.URL;

    testContainer = new MockDOMElement('div');
    testContainer.id = 'product-gallery-container';

    const mockBody = new MockDOMElement('body');

    globalThis.document = {
      body: mockBody,
      createElement: (tag) => new MockDOMElement(tag),
      getElementById: (id) => mockBody.querySelector(`#${id}`)
    };

    const windowListeners = new Map();
    globalThis.window = {
      addEventListener: (evt, fn) => {
        if (!windowListeners.has(evt)) windowListeners.set(evt, []);
        windowListeners.get(evt).push(fn);
      },
      removeEventListener: (evt, fn) => {
        if (!windowListeners.has(evt)) return;
        windowListeners.set(evt, windowListeners.get(evt).filter(cb => cb !== fn));
      },
      dispatchEvent: (evt) => {
        const type = typeof evt === 'string' ? evt : evt.type;
        const fns = windowListeners.get(type) || [];
        fns.forEach(fn => fn(evt));
      },
      location: {
        reload: reloadMock,
        hash: '#/produtos'
      }
    };

    globalThis.URL = {
      createObjectURL: (blob) => `blob:http://localhost/${crypto.randomUUID()}`,
      revokeObjectURL: (url) => {
        revokedUrls.push(url);
      }
    };
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.URL = originalURL;
  });

  // Helper para criar mocks de repositórios
  function createMockRepos({ manifestPhotos = [], legacyPhotos = [], cacheMap = new Map() } = {}) {
    const manifestRepo = {
      findByProductId: mock(async (pId) => [...manifestPhotos])
    };

    const productImageRepo = {
      findByProductId: mock(async (pId) => [...legacyPhotos])
    };

    const localImageCache = {
      has: mock(async (tenantId, photoId, version) => {
        return cacheMap.has(photoId);
      }),
      createUrl: mock(async (photoId, options = {}) => {
        if (cacheMap.has(photoId)) {
          return `blob:http://localhost/cached_${photoId}_${options.size || 'full'}`;
        }
        return null;
      }),
      revokeUrl: mock((url) => {
        revokedUrls.push(url);
      })
    };

    const imageSyncService = {
      ensureProductImages: mock(async (pId, opts) => ({ queued: 1, existingCount: 0 }))
    };

    return { manifestRepo, productImageRepo, localImageCache, imageSyncService };
  }

  // =========================================================================
  // UI-01 — Produto sem foto
  // =========================================================================
  it('UI-01: deve renderizar estado NO_IMAGE quando o produto não tem fotos', async () => {
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [],
      legacyPhotos: []
    });

    const gallery = new ProductImageGallery(testContainer, 'prod_empty', {
      productName: 'Teclado Gamer',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.NO_IMAGE);
    expect(gallery.photos.length).toBe(0);
    expect(testContainer.innerHTML).toContain('Nenhuma foto cadastrada');
    expect(testContainer.querySelector('#thumb-strip')).toBeNull();
    expect(testContainer.querySelector('.btn-prev-photo')).toBeNull();
  });

  // =========================================================================
  // UI-02 — Uma foto
  // =========================================================================
  it('UI-02: deve exibir foto única sem controles desnecessários de navegação ou miniaturas', async () => {
    const cacheMap = new Map([['photo_single', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'photo_single', productId: 'p1', isPrimary: true, label: 'Foto Única', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      productName: 'Monitor 4K',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(gallery.photos.length).toBe(1);
    expect(testContainer.innerHTML).toContain('main-preview-img');
    expect(testContainer.querySelector('.btn-prev-photo')).toBeNull();
    expect(testContainer.querySelector('.btn-next-photo')).toBeNull();
    expect(testContainer.querySelector('#thumb-strip')).toBeNull();
  });

  // =========================================================================
  // UI-03 — Múltiplas fotos
  // =========================================================================
  it('UI-03: deve renderizar carrossel completo, setas e faixa de miniaturas para múltiplas fotos', async () => {
    const cacheMap = new Map([['ph1', true], ['ph2', true], ['ph3', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph1', productId: 'p1', isPrimary: true, label: 'Frente', version: 1 },
        { photoId: 'ph2', productId: 'p1', isPrimary: false, label: 'Lado', version: 1 },
        { photoId: 'ph3', productId: 'p1', isPrimary: false, label: 'Traseira', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      productName: 'Cadeira Gamer',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.photos.length).toBe(3);
    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(testContainer.innerHTML).toContain('gallery-counter');
    expect(testContainer.innerHTML).toContain('1 de 3');
    expect(testContainer.querySelector('#thumb-strip')).not.toBeNull();
    expect(testContainer.querySelector('.btn-prev-photo')).not.toBeNull();
    expect(testContainer.querySelector('.btn-next-photo')).not.toBeNull();

    const thumbs = testContainer.querySelectorAll('.thumb-btn');
    expect(thumbs.length).toBe(3);
  });

  // =========================================================================
  // UI-04 — Foto principal (isPrimary)
  // =========================================================================
  it('UI-04: deve ordenar foto com isPrimary=true para o primeiro índice mesmo se cadastrada fora de ordem', async () => {
    const cacheMap = new Map([['ph_sec', true], ['ph_prim', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_sec', productId: 'p1', isPrimary: false, label: 'Secundária', version: 1 },
        { photoId: 'ph_prim', productId: 'p1', isPrimary: true, label: 'Primária', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      productName: 'Mouse Gamer',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.photos[0].photoId).toBe('ph_prim');
    expect(gallery.photos[0].isPrimary).toBeTrue();
    expect(gallery.selectedIndex).toBe(0);
  });

  // =========================================================================
  // UI-05 — Thumbnail selection
  // =========================================================================
  it('UI-05: clicar em uma miniatura deve alterar selectedIndex e atualizar a imagem em foco', async () => {
    const cacheMap = new Map([['p_a', true], ['p_b', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'p_a', productId: 'p1', isPrimary: true, label: 'A', version: 1 },
        { photoId: 'p_b', productId: 'p1', isPrimary: false, label: 'B', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.selectedIndex).toBe(0);

    // Clica no thumbnail do índice 1
    const thumbs = testContainer.querySelectorAll('.thumb-btn');
    thumbs[1].click();

    expect(gallery.selectedIndex).toBe(1);
    expect(testContainer.innerHTML).toContain('cached_p_b');
  });

  // =========================================================================
  // UI-06 — Next (Avançar)
  // =========================================================================
  it('UI-06: chamar next() deve avançar para a próxima imagem em loop circular', async () => {
    const cacheMap = new Map([['f1', true], ['f2', true], ['f3', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'f1', productId: 'p1', isPrimary: true, label: 'F1', version: 1 },
        { photoId: 'f2', productId: 'p1', isPrimary: false, label: 'F2', version: 1 },
        { photoId: 'f3', productId: 'p1', isPrimary: false, label: 'F3', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.selectedIndex).toBe(0);

    gallery.next();
    expect(gallery.selectedIndex).toBe(1);

    gallery.next();
    expect(gallery.selectedIndex).toBe(2);

    gallery.next();
    expect(gallery.selectedIndex).toBe(0); // Circular
  });

  // =========================================================================
  // UI-07 — Previous (Retroceder)
  // =========================================================================
  it('UI-07: chamar previous() deve retroceder para a imagem anterior em loop circular', async () => {
    const cacheMap = new Map([['f1', true], ['f2', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'f1', productId: 'p1', isPrimary: true, label: 'F1', version: 1 },
        { photoId: 'f2', productId: 'p1', isPrimary: false, label: 'F2', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.selectedIndex).toBe(0);

    gallery.previous();
    expect(gallery.selectedIndex).toBe(1); // Circular backwards

    gallery.previous();
    expect(gallery.selectedIndex).toBe(0);
  });

  // =========================================================================
  // UI-08 — Open Lightbox
  // =========================================================================
  it('UI-08: clicar na imagem ou chamar openLightbox() deve abrir visualização ampliada', async () => {
    const cacheMap = new Map([['ph_main', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_main', productId: 'p1', isPrimary: true, label: 'Principal', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      productName: 'Headset Pro',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.isLightboxOpen).toBeFalse();

    gallery.openLightbox();
    expect(gallery.isLightboxOpen).toBeTrue();

    const lb = document.getElementById('gallery-lightbox');
    expect(lb).not.toBeNull();
    expect(lb.innerHTML).toContain('lightbox-img');
    expect(lb.getAttribute('role')).toBe('dialog');
  });

  // =========================================================================
  // UI-09 — Close Lightbox
  // =========================================================================
  it('UI-09: chamar closeLightbox() deve remover o modal da tela e redefinir estado', async () => {
    const cacheMap = new Map([['ph_main', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_main', productId: 'p1', isPrimary: true, label: 'Principal', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    gallery.openLightbox();
    expect(gallery.isLightboxOpen).toBeTrue();

    gallery.closeLightbox();
    expect(gallery.isLightboxOpen).toBeFalse();
    expect(document.getElementById('gallery-lightbox')).toBeNull();
  });

  // =========================================================================
  // UI-10 — Offline Ready
  // =========================================================================
  it('UI-10: deve exibir badge "Disponível offline" quando fotos estão locais e dispositivo está offline', async () => {
    const cacheMap = new Map([['ph_off', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_off', productId: 'p1', isPrimary: true, label: 'Off', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      isOnline: false, // Dispositivo offline
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.OFFLINE_READY);
    expect(testContainer.innerHTML).toContain('Disponível offline');
    expect(testContainer.innerHTML).toContain('main-preview-img');
  });

  // =========================================================================
  // UI-11 — Offline Missing
  // =========================================================================
  it('UI-11: deve exibir mensagem elegante de "Foto indisponível offline" se offline e sem cache local', async () => {
    const cacheMap = new Map(); // Vazio
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_not_cached', productId: 'p1', isPrimary: true, label: 'Remoto', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      isOnline: false, // Offline
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.OFFLINE_MISSING);
    expect(testContainer.innerHTML).toContain('Foto indisponível offline');
    expect(testContainer.innerHTML).not.toContain('main-preview-img');
  });

  // =========================================================================
  // UI-12 — Loading
  // =========================================================================
  it('UI-12: deve apresentar skeleton/spinner com "Carregando foto..." quando foto remota ainda não baixou', async () => {
    const cacheMap = new Map(); // Não em cache
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_remote', productId: 'p1', isPrimary: true, label: 'Remoto', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      isOnline: true,
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.LOADING);
    expect(testContainer.innerHTML).toContain('Sincronizando imagem...');
    expect(imageSyncService.ensureProductImages).toHaveBeenCalledWith('p1', { tenantId: 'default_tenant' });
  });

  // =========================================================================
  // UI-13 — Error
  // =========================================================================
  it('UI-13: estado de erro deve exibir "Imagem indisponível" com opção discreta de tentar novamente', async () => {
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: []
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    gallery.state = GALLERY_STATE.ERROR;
    gallery.errorMessage = 'INTEGRITY_ERROR';
    gallery.render();

    expect(testContainer.innerHTML).toContain('Imagem indisponível');
    expect(testContainer.innerHTML).toContain('INTEGRITY_ERROR');
    expect(testContainer.querySelector('.btn-retry-sync')).not.toBeNull();
  });

  // =========================================================================
  // UI-14 — Retry
  // =========================================================================
  it('UI-14: clicar em "Tentar novamente" aciona ensureProductImages no ImageSyncService', async () => {
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: []
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    gallery.state = GALLERY_STATE.ERROR;
    gallery.render();

    const btnRetry = testContainer.querySelector('.btn-retry-sync');
    btnRetry.click();

    expect(gallery.state).toBe(GALLERY_STATE.LOADING);
    expect(imageSyncService.ensureProductImages).toHaveBeenCalled();
  });

  // =========================================================================
  // UI-15 — IMAGE_DOWNLOADED atualiza UI sem reload
  // =========================================================================
  it('UI-15: evento IMAGE_DOWNLOADED deve atualizar a imagem reativamente sem recarregar a tela', async () => {
    const cacheMap = new Map(); // Inicialmente vazio
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_async', productId: 'p_reactive', isPrimary: true, label: 'Async', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p_reactive', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.state).toBe(GALLERY_STATE.LOADING);

    // Agora o motor conclui o download e adiciona ao cache
    cacheMap.set('ph_async', true);

    // Emite evento no EventBus
    customBus.emit(EVENTS.IMAGE_DOWNLOADED, {
      photoId: 'ph_async',
      productId: 'p_reactive',
      version: 1
    });

    // Permite flush assíncrono
    await new Promise(r => setTimeout(r, 10));

    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(gallery.photos[0].isCached).toBeTrue();
    expect(testContainer.innerHTML).toContain('main-preview-img');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // UI-16 — Foto v1 -> v2
  // =========================================================================
  it('UI-16: foto v1 local substituída por v2 atualiza a URL sem quebrar a galeria', async () => {
    const cacheMap = new Map([['ph_versioned', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_versioned', productId: 'p1', isPrimary: true, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.photos[0].version).toBe(1);

    // Recebe evento de v2
    customBus.emit(EVENTS.IMAGE_DOWNLOADED, {
      photoId: 'ph_versioned',
      productId: 'p1',
      version: 2
    });

    await new Promise(r => setTimeout(r, 10));

    expect(gallery.photos[0].version).toBe(2);
    expect(gallery.photos[0].isCached).toBeTrue();
  });

  // =========================================================================
  // UI-17 — Não recarrega página
  // =========================================================================
  it('UI-17: deve garantir que manipulações e eventos de galeria não acionam window.location.reload()', async () => {
    const cacheMap = new Map([['p1', true], ['p2', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'p1', productId: 'p1', isPrimary: true, version: 1 },
        { photoId: 'p2', productId: 'p1', isPrimary: false, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    gallery.next();
    gallery.previous();
    gallery.selectImage(1);
    gallery.openLightbox();
    gallery.toggleZoom();
    gallery.closeLightbox();

    expect(reloadMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // UI-18 — Object URL cleanup
  // =========================================================================
  it('UI-18: destroy() deve revogar todas as Object URLs criadas sem vazamento de memória', async () => {
    const cacheMap = new Map([['ph_leak_test', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_leak_test', productId: 'p1', isPrimary: true, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.getStatus().activeUrlsCount).toBeGreaterThan(0);

    gallery.destroy();

    expect(revokedUrls.length).toBeGreaterThan(0);
    expect(testContainer.innerHTML).toBe('');
  });

  // =========================================================================
  // UI-19 — Produto antigo sem fotos (Legado)
  // =========================================================================
  it('UI-19: produto legado sem manifesto deve abrir sem erros no estado NO_IMAGE', async () => {
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [],
      legacyPhotos: []
    });

    const gallery = new ProductImageGallery(testContainer, 'prod_legacy_1990', {
      productName: 'Parafuso Aço Inox',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.NO_IMAGE);
    expect(testContainer.innerHTML).toContain('Nenhuma foto cadastrada');
  });

  // =========================================================================
  // UI-20 — Acessibilidade básica
  // =========================================================================
  it('UI-20: botões devem possuir aria-label explicativo e imagens devem ter atributo alt descritivo', async () => {
    const cacheMap = new Map([['p_acc1', true], ['p_acc2', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'p_acc1', productId: 'p1', isPrimary: true, label: 'Foto A', version: 1 },
        { photoId: 'p_acc2', productId: 'p1', isPrimary: false, label: 'Foto B', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      productName: 'Teclado Mecânico RGB',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    const mainImg = testContainer.querySelector('#main-preview-img');
    expect(mainImg.getAttribute('alt')).toContain('Teclado Mecânico RGB');

    const btnPrev = testContainer.querySelector('.btn-prev-photo');
    expect(btnPrev.getAttribute('aria-label')).toBe('Foto anterior');

    const btnNext = testContainer.querySelector('.btn-next-photo');
    expect(btnNext.getAttribute('aria-label')).toBe('Próxima foto');

    const thumbs = testContainer.querySelectorAll('.thumb-btn');
    expect(thumbs[0].getAttribute('aria-label')).toBe('Ver foto 1 de 2');
    expect(thumbs[1].getAttribute('aria-label')).toBe('Ver foto 2 de 2');
  });

  // =========================================================================
  // Cenários Extras da Especificação da Fase 08
  // =========================================================================
  it('Zoom Toggle: alternar zoom no Lightbox deve atualizar scale e cursor', async () => {
    const cacheMap = new Map([['ph_zoom', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_zoom', productId: 'p1', isPrimary: true, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    gallery.openLightbox();

    expect(gallery.isZoomed).toBeFalse();
    gallery.toggleZoom();
    expect(gallery.isZoomed).toBeTrue();

    const lbImg = document.getElementById('gallery-lightbox').querySelector('#lightbox-img');
    expect(lbImg.className).toContain('scale-150');
    expect(lbImg.className).toContain('cursor-zoom-out');

    gallery.toggleZoom();
    expect(gallery.isZoomed).toBeFalse();
    expect(lbImg.className).toContain('cursor-zoom-in');
  });

  it('Teclado: pressionar tecla Escape deve fechar o Lightbox', async () => {
    const cacheMap = new Map([['ph_esc', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_esc', productId: 'p1', isPrimary: true, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    gallery.openLightbox();
    expect(gallery.isLightboxOpen).toBeTrue();

    // Simula tecla ESC
    globalThis.window.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: () => {}
    });

    expect(gallery.isLightboxOpen).toBeFalse();
    expect(document.getElementById('gallery-lightbox')).toBeNull();
  });

  it('Transição Parcial: 2 fotos onde apenas 1 está em cache exibe PARTIAL e badge de sincronização', async () => {
    const cacheMap = new Map([['ph_ready', true]]); // ph_loading não está no cache
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_ready', productId: 'p1', isPrimary: true, version: 1 },
        { photoId: 'ph_loading', productId: 'p1', isPrimary: false, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p1', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.PARTIAL);
    expect(testContainer.innerHTML).toContain('Sincronizando fotos...');
    expect(testContainer.innerHTML).toContain('main-preview-img');
  });

  it('Suporte Transparente a Imagens Legadas em productImages (sem manifesto)', async () => {
    const mockBlob = new Blob(['legacy-image-content'], { type: 'image/webp' });
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [],
      legacyPhotos: [
        { id: 'leg_01', productId: 'p_leg', isPrimary: true, blob: mockBlob, label: 'Legado 1' }
      ]
    });

    const gallery = new ProductImageGallery(testContainer, 'p_leg', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(gallery.photos.length).toBe(1);
    expect(gallery.photos[0].isCached).toBeTrue();
    expect(testContainer.innerHTML).toContain('main-preview-img');
  });

  // =========================================================================
  // Cenário 35 — Fluxo Manual Principal da Especificação
  // =========================================================================
  it('Cenário 35: produto possui 3 fotos -> principal aparece -> galeria navega -> lightbox abre/fecha -> fica offline e fotos permanecem', async () => {
    const cacheMap = new Map([['f_prim', true], ['f_sec1', true], ['f_sec2', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'f_prim', productId: 'p35', isPrimary: true, label: 'Principal', version: 1 },
        { photoId: 'f_sec1', productId: 'p35', isPrimary: false, label: 'Ângulo 1', version: 1 },
        { photoId: 'f_sec2', productId: 'p35', isPrimary: false, label: 'Ângulo 2', version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p35', {
      productName: 'Notebook Gamer',
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus,
      isOnline: true
    });

    // 1. Abre produto
    await gallery.init();
    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(gallery.photos[0].photoId).toBe('f_prim');

    // 2. Navega pelas fotos
    gallery.next();
    expect(gallery.selectedIndex).toBe(1);
    gallery.next();
    expect(gallery.selectedIndex).toBe(2);

    // 3. Abre Lightbox
    gallery.openLightbox();
    expect(gallery.isLightboxOpen).toBeTrue();

    // 4. Fecha Lightbox
    gallery.closeLightbox();
    expect(gallery.isLightboxOpen).toBeFalse();

    // 5. Simula queda de rede (Internet OFF)
    gallery.setOnline(false);
    expect(gallery.state).toBe(GALLERY_STATE.OFFLINE_READY);

    // 6. Fotos continuam todas visíveis no cache
    expect(gallery.photos.length).toBe(3);
    expect(gallery.photos.every(p => p.isCached)).toBeTrue();
    expect(testContainer.innerHTML).toContain('Disponível offline');
    expect(testContainer.innerHTML).toContain('main-preview-img');
  });

  // =========================================================================
  // Cenário 36 — Teste de Foto Nova Adicionada
  // =========================================================================
  it('Cenário 36: adição remota de quarta foto atualiza galeria sem recarregar a tela', async () => {
    const cacheMap = new Map([['f1', true], ['f2', true], ['f3', true], ['f4', true]]);
    const currentManifest = [
      { photoId: 'f1', productId: 'p36', isPrimary: true, version: 1 },
      { photoId: 'f2', productId: 'p36', isPrimary: false, version: 1 },
      { photoId: 'f3', productId: 'p36', isPrimary: false, version: 1 }
    ];

    const manifestRepo = {
      findByProductId: mock(async () => [...currentManifest])
    };
    const { productImageRepo, localImageCache, imageSyncService } = createMockRepos({ cacheMap });

    const gallery = new ProductImageGallery(testContainer, 'p36', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.photos.length).toBe(3);

    // Remoto cadastra 4ª foto e sincroniza
    currentManifest.push({ photoId: 'f4', productId: 'p36', isPrimary: false, version: 1 });

    customBus.emit(EVENTS.IMAGE_DOWNLOADED, {
      photoId: 'f4',
      productId: 'p36',
      version: 1
    });

    await new Promise(r => setTimeout(r, 15));

    expect(gallery.photos.length).toBe(4);
    expect(gallery.photos.find(p => p.photoId === 'f4')).toBeDefined();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Cenário 37 — Teste de Foto Alterada (v1 -> v2)
  // =========================================================================
  it('Cenário 37: substituição de foto v1 por v2 preserva exibição da versão anterior até chegada de v2', async () => {
    const cacheMap = new Map([['ph_main', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'ph_main', productId: 'p37', isPrimary: true, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p37', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    expect(gallery.photos[0].version).toBe(1);
    expect(testContainer.innerHTML).toContain('cached_ph_main');

    // Chega evento de nova versão v2
    customBus.emit(EVENTS.IMAGE_DOWNLOADED, {
      photoId: 'ph_main',
      productId: 'p37',
      version: 2
    });

    await new Promise(r => setTimeout(r, 10));

    expect(gallery.photos[0].version).toBe(2);
    expect(gallery.state).toBe(GALLERY_STATE.READY);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Cenário 38 — Teste de Exclusão Lógica
  // =========================================================================
  it('Cenário 38: foto marcada com deletedAt no manifesto é desconsiderada na galeria', async () => {
    const cacheMap = new Map([['f_alive', true], ['f_deleted', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'f_alive', productId: 'p38', isPrimary: true, version: 1, deletedAt: null },
        { photoId: 'f_deleted', productId: 'p38', isPrimary: false, version: 1, deletedAt: Date.now() }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p38', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();

    expect(gallery.photos.length).toBe(1);
    expect(gallery.photos[0].photoId).toBe('f_alive');
    expect(gallery.photos.some(p => p.photoId === 'f_deleted')).toBeFalse();
  });

  // =========================================================================
  // Navegação por Teclado no Lightbox (Setas Esquerda e Direita)
  // =========================================================================
  it('Navegação por Teclado: ArrowRight e ArrowLeft no Lightbox devem alternar fotos', async () => {
    const cacheMap = new Map([['f1', true], ['f2', true]]);
    const { manifestRepo, productImageRepo, localImageCache, imageSyncService } = createMockRepos({
      manifestPhotos: [
        { photoId: 'f1', productId: 'p_keys', isPrimary: true, version: 1 },
        { photoId: 'f2', productId: 'p_keys', isPrimary: false, version: 1 }
      ],
      cacheMap
    });

    const gallery = new ProductImageGallery(testContainer, 'p_keys', {
      manifestRepository: manifestRepo,
      productImageRepository: productImageRepo,
      localImageCache,
      imageSyncService,
      eventBus: customBus
    });

    await gallery.init();
    gallery.openLightbox();
    expect(gallery.selectedIndex).toBe(0);

    // Simula tecla ArrowRight
    globalThis.window.dispatchEvent({
      type: 'keydown',
      key: 'ArrowRight',
      preventDefault: () => {}
    });
    expect(gallery.selectedIndex).toBe(1);

    // Simula tecla ArrowLeft
    globalThis.window.dispatchEvent({
      type: 'keydown',
      key: 'ArrowLeft',
      preventDefault: () => {}
    });
    expect(gallery.selectedIndex).toBe(0);
  });
});

