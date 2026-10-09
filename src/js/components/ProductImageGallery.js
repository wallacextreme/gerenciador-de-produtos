import { localImageCache } from '../services/LocalImageCache.js';
import { imageManifestRepository } from '../repositories/ImageManifestRepository.js';
import { productImageRepository } from '../repositories/ProductImageRepository.js';
import { imageSyncService } from '../services/ImageSyncService.js';
import { eventBus, EVENTS } from '../eventBus.js';

/**
 * Estados Visuais Formais da Galeria de Fotos (PHASE 08).
 */
export const GALLERY_STATE = Object.freeze({
  NO_IMAGE: 'NO_IMAGE',             // Nenhuma foto cadastrada para o produto
  LOADING: 'LOADING',               // Fotos cadastradas, aguardando download sob demanda (P1)
  PARTIAL: 'PARTIAL',               // Pelo menos 1 foto disponível, demais em sincronização
  READY: 'READY',                   // Todas as fotos disponíveis localmente (online)
  OFFLINE_READY: 'OFFLINE_READY',   // Fotos disponíveis no cache local (offline)
  OFFLINE_MISSING: 'OFFLINE_MISSING',// Fotos existem remotamente mas não estão no cache (offline)
  ERROR: 'ERROR'                    // Falha no download ou integridade da foto
});

/**
 * Componente Profissional de Galeria de Fotos do Produto (PHASE 08).
 *
 * Responsável por:
 * - Exibição instantânea da foto principal (`isPrimary = true`) disponível no cache local;
 * - Resolução de thumbnails locais e exibição de imagem em alta resolução;
 * - Transição fluida entre estados (NO_IMAGE, LOADING, PARTIAL, READY, OFFLINE_READY, OFFLINE_MISSING, ERROR);
 * - Navegação de carrossel (Anterior, Próxima, Miniaturas, Teclado);
 * - Modo de visualização ampliada (Lightbox) com atalho ESC, controle de zoom e navegação;
 * - Atualização reativa em tempo real ao capturar `IMAGE_DOWNLOADED` sem recarregar a tela;
 * - Suporte a fotos de produtos antigos (legado) e fotos do manifesto;
 * - Rastreamento e revogação estrita de Object URLs sem vazamentos de memória (Zero Memory Leaks);
 * - Acessibilidade completa (`aria-label`, foco de teclado, descrições `alt`).
 */
export class ProductImageGallery {
  /**
   * @param {HTMLElement} container Elemento container DOM onde a galeria será renderizada
   * @param {string} productId ID do produto
   * @param {Object} [options={}]
   * @param {string} [options.tenantId='default_tenant']
   * @param {string} [options.productName='Produto']
   * @param {ImageSyncService} [options.imageSyncService]
   * @param {LocalImageCache} [options.localImageCache]
   * @param {ImageManifestRepository} [options.manifestRepository]
   * @param {ProductImageRepository} [options.productImageRepository]
   * @param {EventBus} [options.eventBus]
   * @param {boolean} [options.isOnline]
   */
  constructor(container, productId, options = {}) {
    this.container = container;
    this.productId = String(productId || '');
    this.tenantId = String(options.tenantId || 'default_tenant');
    this.productName = String(options.productName || 'Produto');

    // Serviços injetáveis com defaults
    this.syncService = options.imageSyncService || imageSyncService;
    this.cache = options.localImageCache || localImageCache;
    this.manifestRepo = options.manifestRepository || imageManifestRepository;
    this.productImageRepo = options.productImageRepository || productImageRepository;
    this.bus = options.eventBus || eventBus;

    // Estado da galeria
    this.state = GALLERY_STATE.LOADING;
    this.photos = []; // Lista de fotos normalizadas
    this.selectedIndex = 0;
    this.isLightboxOpen = false;
    this.isZoomed = false;
    this.errorMessage = null;

    // Conectividade
    this.isOnline = typeof options.isOnline === 'boolean'
      ? options.isOnline
      : (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true);

    // Gestão de Object URLs ativas
    this._activeUrls = new Set();

    // Listeners do ciclo de vida para cleanup
    this._cleanupFns = [];
  }

  /**
   * Inicializa a galeria, carrega as fotos e registra ouvintes de eventos.
   * @returns {Promise<void>}
   */
  async init() {
    this._bindGlobalEvents();
    await this.loadPhotos();
  }

  /**
   * Carrega metadados e Blobs das fotos do produto, ordenando a primária primeiro.
   * @returns {Promise<void>}
   */
  async loadPhotos() {
    try {
      this._revokeCreatedUrls();

      // 1. Obter metadados do manifesto local
      let manifestPhotos = [];
      if (this.manifestRepo && typeof this.manifestRepo.findByProductId === 'function') {
        manifestPhotos = await this.manifestRepo.findByProductId(this.productId);
        manifestPhotos = manifestPhotos.filter(p => !p.deletedAt);
      }

      // 2. Obter fotos legadas do ProductImageRepository
      let legacyPhotos = [];
      if (this.productImageRepo && typeof this.productImageRepo.findByProductId === 'function') {
        legacyPhotos = await this.productImageRepo.findByProductId(this.productId);
        legacyPhotos = legacyPhotos.filter(p => !p.deletedAt);
      }

      // 3. Mesclar fotos do manifesto com legado
      const photoMap = new Map();

      // Primeiro insere legados
      for (const leg of legacyPhotos) {
        const id = leg.photoId || leg.id;
        photoMap.set(id, {
          photoId: id,
          id,
          productId: this.productId,
          tenantId: leg.tenantId || this.tenantId,
          isPrimary: !!leg.isPrimary,
          label: leg.label || 'Foto do Produto',
          version: leg.version || 1,
          hash: leg.hash || null,
          blob: leg.blob || null,
          thumbnailBlob: leg.thumbnailBlob || null,
          isCached: !!(leg.blob || leg.thumbnailBlob)
        });
      }

      // Depois mescla fotos do manifesto (fonte prioritária de versão e status remoto)
      for (const man of manifestPhotos) {
        const id = man.photoId || man.id;
        const existing = photoMap.get(id);

        photoMap.set(id, {
          photoId: id,
          id,
          productId: this.productId,
          tenantId: man.tenantId || this.tenantId,
          isPrimary: !!man.isPrimary,
          label: man.label || (existing ? existing.label : 'Foto do Produto'),
          version: man.version || 1,
          hash: man.hash || (existing ? existing.hash : null),
          blob: existing ? existing.blob : null,
          thumbnailBlob: existing ? existing.thumbnailBlob : null,
          isCached: existing ? existing.isCached : false
        });
      }

      const rawList = Array.from(photoMap.values());

      // 4. Se não há fotos cadastradas
      if (rawList.length === 0) {
        this.photos = [];
        this.state = GALLERY_STATE.NO_IMAGE;
        this.render();
        return;
      }

      // 5. Verificar disponibilidade no cache para cada foto
      const processedPhotos = [];
      let cachedCount = 0;

      for (const item of rawList) {
        let isCached = item.isCached;
        let url = null;
        let thumbUrl = null;

        // Se já temos o Blob na memória
        if (item.blob || item.thumbnailBlob) {
          isCached = true;
          const displayBlob = item.blob || item.thumbnailBlob;
          url = this._createObjectUrl(displayBlob);
          thumbUrl = item.thumbnailBlob ? this._createObjectUrl(item.thumbnailBlob) : url;
        } else if (this.cache) {
          // Consultar LocalImageCache
          const hasCache = await this.cache.has(this.tenantId, item.photoId, item.version);
          if (hasCache) {
            isCached = true;
            url = await this._createCacheUrl(item.photoId, 'full');
            thumbUrl = await this._createCacheUrl(item.photoId, 'thumbnail') || url;
          }
        }

        if (isCached && url) {
          cachedCount++;
        }

        processedPhotos.push({
          ...item,
          isCached,
          url,
          thumbnailUrl: thumbUrl || url,
          isLoading: !isCached && this.isOnline,
          isMissingOffline: !isCached && !this.isOnline
        });
      }

      // 6. Ordenação estável: isPrimary primeiro, depois label/photoId
      this.photos = this._sortPhotos(processedPhotos);

      // Preservar ou ajustar selectedIndex
      if (this.selectedIndex >= this.photos.length) {
        this.selectedIndex = 0;
      }

      // 7. Determinar estado global da galeria
      this.state = this._calculateState(cachedCount, this.photos.length);

      // 8. Renderizar
      this.render();

      // 9. Se houver fotos pendentes e estiver online, garante download P1 via ImageSyncService
      if (cachedCount < this.photos.length && this.isOnline && this.syncService) {
        this.syncService.ensureProductImages(this.productId, { tenantId: this.tenantId }).catch(() => {});
      }
    } catch (err) {
      console.error('[ProductImageGallery] Erro ao carregar fotos:', err);
      this.state = GALLERY_STATE.ERROR;
      this.errorMessage = err.message || 'Falha ao carregar galeria';
      this.render();
    }
  }

  /**
   * Ordena as fotos para garantir que a foto principal (`isPrimary = true`) seja a primeira.
   * @private
   */
  _sortPhotos(list) {
    return [...list].sort((a, b) => {
      // 1. Primária primeiro
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      // 2. Ordem alfabética de label
      const labelA = a.label || '';
      const labelB = b.label || '';
      if (labelA !== labelB) return labelA.localeCompare(labelB);
      // 3. Fallback determinístico por photoId
      return String(a.photoId).localeCompare(String(b.photoId));
    });
  }

  /**
   * Calcula o estado geral da galeria com base na quantidade de fotos e conectividade.
   * @private
   */
  _calculateState(cachedCount, totalCount) {
    if (totalCount === 0) return GALLERY_STATE.NO_IMAGE;

    if (cachedCount === totalCount) {
      return this.isOnline ? GALLERY_STATE.READY : GALLERY_STATE.OFFLINE_READY;
    }

    if (cachedCount > 0) {
      return GALLERY_STATE.PARTIAL;
    }

    // Nenhuma foto pronta no cache
    if (!this.isOnline) {
      return GALLERY_STATE.OFFLINE_MISSING;
    }

    return GALLERY_STATE.LOADING;
  }

  /**
   * Atualização reativa sob demanda ao capturar `IMAGE_DOWNLOADED` sem recarregar a tela.
   * @param {Object} data 
   */
  async handleImageDownloaded(data) {
    if (!data || data.productId !== this.productId) return;

    const photoId = data.photoId;
    const existingPhoto = this.photos.find(p => p.photoId === photoId);

    // Se a foto já está na lista ou se é uma nova foto
    if (existingPhoto) {
      const url = await this._createCacheUrl(photoId, 'full');
      const thumbUrl = await this._createCacheUrl(photoId, 'thumbnail') || url;

      if (url) {
        existingPhoto.isCached = true;
        existingPhoto.isLoading = false;
        existingPhoto.isMissingOffline = false;
        existingPhoto.url = url;
        existingPhoto.thumbnailUrl = thumbUrl;
        if (data.version) existingPhoto.version = data.version;
      }
    } else {
      // Foto nova que acabou de chegar
      await this.loadPhotos();
      return;
    }

    // Recalcula contagem e estado
    const cachedCount = this.photos.filter(p => p.isCached && p.url).length;
    this.state = this._calculateState(cachedCount, this.photos.length);

    // Re-renderiza sem recarregar a página
    this.render();

    // Se o Lightbox estiver aberto, atualiza a imagem em foco
    if (this.isLightboxOpen) {
      this._updateLightboxContent();
    }
  }

  /**
   * Alterna a conectividade da galeria.
   * @param {boolean} online 
   */
  setOnline(online) {
    this.isOnline = !!online;
    const cachedCount = this.photos.filter(p => p.isCached && p.url).length;
    this.state = this._calculateState(cachedCount, this.photos.length);
    this.render();
  }

  /**
   * Avança para a próxima foto da galeria.
   */
  next() {
    if (this.photos.length <= 1) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.photos.length;
    this.isZoomed = false;
    this.render();
    if (this.isLightboxOpen) this._updateLightboxContent();
  }

  /**
   * Retrocede para a foto anterior da galeria.
   */
  previous() {
    if (this.photos.length <= 1) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.photos.length) % this.photos.length;
    this.isZoomed = false;
    this.render();
    if (this.isLightboxOpen) this._updateLightboxContent();
  }

  /**
   * Seleciona diretamente uma foto pelo índice.
   * @param {number} index 
   */
  selectImage(index) {
    if (index >= 0 && index < this.photos.length) {
      this.selectedIndex = index;
      this.isZoomed = false;
      this.render();
      if (this.isLightboxOpen) this._updateLightboxContent();
    }
  }

  /**
   * Abre o modo Lightbox (visualização ampliada em tela cheia).
   */
  openLightbox() {
    const current = this.photos[this.selectedIndex];
    if (!current || !current.url) return; // Não abre se não houver foto carregada
    this.isLightboxOpen = true;
    this.isZoomed = false;
    this._renderLightbox();
  }

  /**
   * Fecha o modo Lightbox.
   */
  closeLightbox() {
    this.isLightboxOpen = false;
    this.isZoomed = false;
    const lb = this._getLightboxElement();
    if (lb && lb.parentNode) {
      lb.parentNode.removeChild(lb);
    }
  }

  /**
   * Alterna o estado de ampliação (Zoom) dentro do Lightbox.
   */
  toggleZoom() {
    this.isZoomed = !this.isZoomed;
    this._updateLightboxContent();
  }

  /**
   * Aciona nova tentativa de sincronização com o ImageSyncService.
   */
  async retrySync() {
    this.state = GALLERY_STATE.LOADING;
    this.errorMessage = null;
    this.render();

    if (this.syncService) {
      try {
        await this.syncService.ensureProductImages(this.productId, { tenantId: this.tenantId });
      } catch (err) {
        this.state = GALLERY_STATE.ERROR;
        this.errorMessage = err.message || 'Erro ao sincronizar';
        this.render();
      }
    }
  }

  /**
   * Renderiza a galeria principal no container DOM.
   */
  render() {
    if (!this.container) return;
    this.container.innerHTML = this.getHTML();
    this._bindDOMInteractions();
  }

  /**
   * Gera o HTML estruturado da galeria respeitando acessibilidade e design responsivo.
   * @returns {string}
   */
  getHTML() {
    const total = this.photos.length;
    const current = this.photos[this.selectedIndex] || null;
    const isSingle = total <= 1;

    // Badges de conectividade e status
    let statusBadgeHTML = '';
    if (this.state === GALLERY_STATE.OFFLINE_READY) {
      statusBadgeHTML = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60" title="Imagens salvas localmente">
          <svg class="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          Disponível offline
        </span>
      `;
    } else if (this.state === GALLERY_STATE.PARTIAL) {
      statusBadgeHTML = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60" title="Sincronizando fotos secundárias">
          <svg class="animate-spin w-3 h-3 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
          Sincronizando fotos...
        </span>
      `;
    } else if (this.state === GALLERY_STATE.LOADING) {
      statusBadgeHTML = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
          <svg class="animate-spin w-3 h-3 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
          Carregando foto...
        </span>
      `;
    }

    // Contador de fotos
    const counterBadgeHTML = total > 1
      ? `<span class="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full" id="gallery-counter">${this.selectedIndex + 1} de ${total}</span>`
      : '';

    // Conteúdo central do viewport
    let mainContentHTML = '';

    if (this.state === GALLERY_STATE.NO_IMAGE) {
      mainContentHTML = `
        <div class="text-center p-8 text-slate-400 select-none">
          <svg class="w-16 h-16 mx-auto mb-2 opacity-40 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <span class="text-sm font-semibold text-slate-500 block">Nenhuma foto cadastrada</span>
          <span class="text-xs text-slate-400 mt-0.5 block">Adicione fotos editando o produto</span>
        </div>
      `;
    } else if (this.state === GALLERY_STATE.OFFLINE_MISSING && (!current || !current.url)) {
      mainContentHTML = `
        <div class="text-center p-6 text-amber-800 bg-amber-50/60 rounded-xl border border-amber-200/60 max-w-sm mx-auto">
          <svg class="w-12 h-12 mx-auto mb-2 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6" />
          </svg>
          <span class="text-sm font-bold block mb-1">Foto indisponível offline</span>
          <p class="text-xs text-amber-700">Esta imagem não foi baixada previamente. Conecte-se à internet para sincronizá-la.</p>
        </div>
      `;
    } else if (this.state === GALLERY_STATE.ERROR && (!current || !current.url)) {
      mainContentHTML = `
        <div class="text-center p-6 text-rose-800 bg-rose-50/60 rounded-xl border border-rose-200/60 max-w-sm mx-auto space-y-3">
          <svg class="w-12 h-12 mx-auto text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div>
            <span class="text-sm font-bold block">Imagem indisponível</span>
            <p class="text-xs text-rose-600 mt-0.5">${this._esc(this.errorMessage || 'Falha ao obter imagem.')}</p>
          </div>
          <button type="button" class="btn-retry-sync inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-lg shadow-2xs transition" aria-label="Tentar novamente o download">
            <svg class="w-3.5 h-3.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Tentar novamente
          </button>
        </div>
      `;
    } else if (!current || !current.url) {
      // Estado de Carregamento / Skeleton
      mainContentHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-slate-500 animate-pulse space-y-3 select-none">
          <div class="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center">
            <svg class="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          </div>
          <span class="text-sm font-semibold text-slate-600">Sincronizando imagem...</span>
          <span class="text-xs text-slate-400">Baixando arquivo em alta resolução</span>
        </div>
      `;
    } else {
      // Imagem presente e disponível
      const altText = `${this._esc(this.productName)} — Foto ${this.selectedIndex + 1}`;
      const safeMainUrl = this._sanitizeImageUrl(current.url);
      mainContentHTML = `
        <img id="main-preview-img" src="${safeMainUrl}" alt="${altText}" class="w-full h-full object-contain p-2 cursor-zoom-in transition-transform duration-200 group-hover:scale-[1.01]" tabindex="0" role="button" aria-label="Ampliar foto em tela cheia">

        ${!isSingle ? `
          <!-- Setas de Navegação Sobrepostas -->
          <button type="button" class="btn-prev-photo absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white text-slate-700 shadow-md flex items-center justify-center transition opacity-80 sm:opacity-0 group-hover:opacity-100 hover:scale-105 focus:opacity-100" aria-label="Foto anterior">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button type="button" class="btn-next-photo absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/95 hover:bg-white text-slate-700 shadow-md flex items-center justify-center transition opacity-80 sm:opacity-0 group-hover:opacity-100 hover:scale-105 focus:opacity-100" aria-label="Próxima foto">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
          </button>
        ` : ''}

        <!-- Botão de Ampliação / Lightbox Hint -->
        <button type="button" class="btn-open-lightbox absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-slate-900/75 hover:bg-slate-900 text-white text-[11px] font-medium backdrop-blur-xs flex items-center gap-1.5 transition opacity-90 group-hover:opacity-100 shadow-xs" aria-label="Abrir galeria ampliada">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
          <span>Ampliar</span>
        </button>
      `;
    }

    // Miniaturas (Thumbnails Strip)
    let thumbnailsHTML = '';
    if (total > 1) {
      thumbnailsHTML = `
        <div class="flex gap-2 mt-3 overflow-x-auto pb-1 pt-1" id="thumb-strip" role="tablist" aria-label="Miniaturas de fotos do produto">
          ${this.photos.map((item, idx) => {
            const isSelected = idx === this.selectedIndex;
            const thumbSrc = this._sanitizeImageUrl(item.thumbnailUrl || item.url);
            return `
              <button type="button" data-index="${idx}" role="tab" aria-selected="${isSelected}" aria-label="Ver foto ${idx + 1} de ${total}" class="thumb-btn flex-shrink-0 w-16 h-16 rounded-lg border-2 overflow-hidden transition relative ${isSelected ? 'border-blue-600 ring-2 ring-blue-100 shadow-2xs' : 'border-slate-200 hover:border-slate-400 opacity-75 hover:opacity-100'}">
                ${thumbSrc 
                  ? `<img src="${thumbSrc}" class="w-full h-full object-cover" alt="Miniatura ${idx + 1}">`
                  : `<div class="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <svg class="animate-spin w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                    </div>`}
                ${item.isPrimary ? '<span class="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-blue-600 ring-1 ring-white" title="Foto principal"></span>' : ''}
              </button>
            `;
          }).join('')}
        </div>
      `;
    }

    return `
      <div class="product-image-gallery bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3" role="region" aria-label="Galeria de fotos do produto">
        <!-- Top Status Bar -->
        <div class="flex items-center justify-between text-xs min-h-[22px]">
          <div>${statusBadgeHTML}</div>
          <div>${counterBadgeHTML}</div>
        </div>

        <!-- Main Large Viewport -->
        <div class="relative w-full aspect-square bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center border border-slate-200/70 group">
          ${mainContentHTML}
        </div>

        <!-- Thumbnails Strip -->
        ${thumbnailsHTML}
      </div>
    `;
  }

  /**
   * Associa eventos do DOM interno da galeria.
   * @private
   */
  _bindDOMInteractions() {
    if (!this.container) return;

    // Clique na imagem principal para abrir lightbox
    const mainImg = this.container.querySelector('#main-preview-img');
    if (mainImg) {
      mainImg.addEventListener('click', () => this.openLightbox());
      mainImg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openLightbox();
        }
      });
    }

    // Botão explícito de abrir lightbox
    const btnLightbox = this.container.querySelector('.btn-open-lightbox');
    if (btnLightbox) {
      btnLightbox.addEventListener('click', () => this.openLightbox());
    }

    // Seta anterior
    const btnPrev = this.container.querySelector('.btn-prev-photo');
    if (btnPrev) {
      btnPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        this.previous();
      });
    }

    // Seta próxima
    const btnNext = this.container.querySelector('.btn-next-photo');
    if (btnNext) {
      btnNext.addEventListener('click', (e) => {
        e.stopPropagation();
        this.next();
      });
    }

    // Botão de retry
    const btnRetry = this.container.querySelector('.btn-retry-sync');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => this.retrySync());
    }

    // Botões de miniatura
    const thumbBtns = this.container.querySelectorAll('.thumb-btn');
    thumbBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (!isNaN(idx)) {
          this.selectImage(idx);
        }
      });
    });
  }

  /**
   * Renderiza o modal de visualização ampliada (Lightbox).
   * @private
   */
  _renderLightbox() {
    const existing = this._getLightboxElement();
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const current = this.photos[this.selectedIndex];
    if (!current || !current.url) return;

    const total = this.photos.length;
    const isSingle = total <= 1;

    const modal = document.createElement('div');
    modal.id = 'gallery-lightbox';
    modal.className = 'fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 select-none animate-fadeIn';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `Visualização ampliada de ${this._esc(this.productName)}`);

    modal.innerHTML = `
      <!-- Top Action Bar -->
      <div class="flex items-center justify-between text-white/90 z-10 max-w-6xl mx-auto w-full">
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold tracking-wide">${this._esc(this.productName)}</span>
          ${total > 1 ? `<span class="text-xs bg-white/10 px-2 py-0.5 rounded-full text-slate-300" id="lightbox-counter">${this.selectedIndex + 1} de ${total}</span>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-lightbox-zoom px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition" aria-label="Alternar zoom">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
            <span class="zoom-label">${this.isZoomed ? 'Reduzir' : 'Ampliar'}</span>
          </button>
          <button type="button" class="btn-lightbox-close p-1.5 rounded-lg bg-white/10 hover:bg-rose-600/80 text-white text-xs font-semibold transition" aria-label="Fechar galeria">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- Center Viewport with Zoom -->
      <div class="flex-1 flex items-center justify-center p-2 relative overflow-auto" id="lightbox-viewport">
        <img id="lightbox-img" src="${this._sanitizeImageUrl(current.url)}" alt="${this._esc(this.productName)}" class="max-w-[92vw] max-h-[80vh] object-contain transition-all duration-300 ${this.isZoomed ? 'scale-150 sm:scale-200 cursor-zoom-out' : 'cursor-zoom-in'}">

        ${!isSingle ? `
          <button type="button" class="btn-lightbox-prev absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition" aria-label="Foto anterior">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button type="button" class="btn-lightbox-next absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition" aria-label="Próxima foto">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
          </button>
        ` : ''}
      </div>

      <!-- Bottom Hint Bar -->
      <div class="text-center text-xs text-slate-400 py-1 z-10">
        Pressione <kbd class="px-1.5 py-0.5 bg-white/10 rounded text-slate-300 font-mono">ESC</kbd> para fechar ou clique na imagem para alternar zoom.
      </div>
    `;

    document.body.appendChild(modal);

    // Bindings do Lightbox
    const btnClose = modal.querySelector('.btn-lightbox-close');
    if (btnClose) btnClose.addEventListener('click', () => this.closeLightbox());

    const btnZoom = modal.querySelector('.btn-lightbox-zoom');
    if (btnZoom) btnZoom.addEventListener('click', () => this.toggleZoom());

    const lbImg = modal.querySelector('#lightbox-img');
    if (lbImg) lbImg.addEventListener('click', () => this.toggleZoom());

    const btnPrev = modal.querySelector('.btn-lightbox-prev');
    if (btnPrev) btnPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      this.previous();
    });

    const btnNext = modal.querySelector('.btn-lightbox-next');
    if (btnNext) btnNext.addEventListener('click', (e) => {
      e.stopPropagation();
      this.next();
    });

    // Fechar ao clicar no backdrop escuro fora da imagem
    const viewport = modal.querySelector('#lightbox-viewport');
    if (viewport) {
      viewport.addEventListener('click', (e) => {
        if (e.target === viewport) {
          this.closeLightbox();
        }
      });
    }
  }

  /**
   * Atualiza o conteúdo visual do Lightbox sem recriar o modal.
   * @private
   */
  _updateLightboxContent() {
    const modal = this._getLightboxElement();
    if (!modal) return;

    const current = this.photos[this.selectedIndex];
    if (!current) return;

    const lbImg = modal.querySelector('#lightbox-img');
    if (lbImg && current.url) {
      lbImg.src = this._sanitizeImageUrl(current.url);
      if (this.isZoomed) {
        lbImg.className = 'max-w-[92vw] max-h-[80vh] object-contain transition-all duration-300 scale-150 sm:scale-200 cursor-zoom-out';
      } else {
        lbImg.className = 'max-w-[92vw] max-h-[80vh] object-contain transition-all duration-300 cursor-zoom-in';
      }
    }

    const counter = modal.querySelector('#lightbox-counter');
    if (counter) {
      counter.textContent = `${this.selectedIndex + 1} de ${this.photos.length}`;
    }

    const zoomLabel = modal.querySelector('.zoom-label');
    if (zoomLabel) {
      zoomLabel.textContent = this.isZoomed ? 'Reduzir' : 'Ampliar';
    }
  }

  /**
   * Obtém o elemento modal do Lightbox no DOM.
   * @private
   */
  _getLightboxElement() {
    if (typeof document !== 'undefined') {
      return document.getElementById('gallery-lightbox');
    }
    return null;
  }

  /**
   * Registra eventos globais do ciclo de vida da galeria.
   * @private
   */
  _bindGlobalEvents() {
    // 1. Escutar IMAGE_DOWNLOADED no EventBus
    if (this.bus && typeof this.bus.on === 'function') {
      const unsub = this.bus.on(EVENTS.IMAGE_DOWNLOADED, (data) => {
        this.handleImageDownloaded(data);
      });
      if (typeof unsub === 'function') {
        this._cleanupFns.push(unsub);
      }
    }

    // 2. Teclado (ESC para fechar lightbox, Setas para navegação)
    if (typeof window !== 'undefined') {
      const keyHandler = (e) => {
        if (this.isLightboxOpen) {
          if (e.key === 'Escape') {
            e.preventDefault();
            this.closeLightbox();
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            this.next();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this.previous();
          }
        }
      };

      window.addEventListener('keydown', keyHandler);
      this._cleanupFns.push(() => window.removeEventListener('keydown', keyHandler));

      // 3. Conectividade da janela
      const onlineHandler = () => this.setOnline(true);
      const offlineHandler = () => this.setOnline(false);

      window.addEventListener('online', onlineHandler);
      window.addEventListener('offline', offlineHandler);
      this._cleanupFns.push(
        () => window.removeEventListener('online', onlineHandler),
        () => window.removeEventListener('offline', offlineHandler)
      );
    }
  }

  /**
   * Cria uma Object URL para exibição gerenciada.
   * @private
   */
  _createObjectUrl(blob) {
    if (!blob) return null;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      this._activeUrls.add(url);
      return url;
    }
    return null;
  }

  /**
   * Cria uma Object URL a partir do LocalImageCache.
   * @private
   */
  async _createCacheUrl(photoId, size = 'full') {
    if (!this.cache || typeof this.cache.createUrl !== 'function') return null;
    try {
      const url = await this.cache.createUrl(photoId, { tenantId: this.tenantId, size });
      if (url) {
        this._activeUrls.add(url);
      }
      return url;
    } catch (_) {
      return null;
    }
  }

  /**
   * Revoga todas as Object URLs criadas por esta instância.
   * @private
   */
  _revokeCreatedUrls() {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this._activeUrls) {
        URL.revokeObjectURL(url);
      }
    }
    this._activeUrls.clear();
  }

  /**
   * Sanitiza strings para HTML seguro.
   * @private
   */
  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Valida e sanitiza URLs de imagens para evitar injeção de esquemas maliciosos (javascript:, data:).
   * @private
   */
  _sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('blob:') || trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return this._esc(trimmed);
    }
    return '';
  }

  /**
   * Retorna snapshot do estado atual da galeria para testes e diagnósticos.
   * @returns {Object}
   */
  getStatus() {
    return {
      productId: this.productId,
      state: this.state,
      totalPhotos: this.photos.length,
      selectedIndex: this.selectedIndex,
      isLightboxOpen: this.isLightboxOpen,
      isZoomed: this.isZoomed,
      isOnline: this.isOnline,
      activeUrlsCount: this._activeUrls.size
    };
  }

  /**
   * Destrói a galeria, revoga URLs e remove ouvintes de eventos (Cleanup).
   */
  destroy() {
    this.closeLightbox();
    this._revokeCreatedUrls();

    this._cleanupFns.forEach(fn => {
      try { if (typeof fn === 'function') fn(); } catch (_) {}
    });
    this._cleanupFns = [];

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
