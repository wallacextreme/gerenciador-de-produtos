import { eventBus, EVENTS } from '../eventBus.js';
import { platform } from '../platform/platform.js';

/**
 * GestãoPro — PWA Handler (PHASE 10 - PWA Hardening)
 * 
 * Gerencia com segurança operacional:
 *   - Ciclo de vida do Service Worker (registro, ativação e detecção de versões)
 *   - Atualizações seguras (safe update flow, preservação de formulários ativos)
 *   - Instalação PWA (beforeinstallprompt, modo standalone)
 *   - Deduplicação de eventos de conectividade (debounce em flutuações de rede)
 *   - Throttling de eventos de primeiro plano (visibilitychange e foco)
 *   - Separação estrita de plataformas (Tauri vs PWA Web)
 *   - Recuperação de cache corrompido e consulta de cota
 */
export class PWAHandler {
  constructor() {
    this.deferredPrompt = null;
    this.swRegistration = null;
    this.waitingWorker = null;
    this.isOnline = (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean')
      ? navigator.onLine
      : true;
    this.isInstallable = false;
    this._initialized = false;
    this._onlineDebounceTimer = null;
    this._lastForegroundTime = 0;
    this._foregroundThrottleMs = 4000;
  }

  /**
   * Inicializa o gerenciador PWA.
   * Em ambiente Desktop (Tauri), o ciclo de Service Worker é ignorado para preservar o runtime nativo.
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    // Separação Tauri: não registra SW nem intercepta prompts de instalação em Tauri Desktop
    if (typeof platform !== 'undefined' && platform.isDesktop()) {
      return;
    }

    this._setupNetworkListeners();
    this._setupForegroundListeners();
    this._setupInstallPromptListeners();

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      await this._registerServiceWorker();
    }
  }

  /**
   * Registra o Service Worker e monitora ciclo de vida de atualizações.
   */
  async _registerServiceWorker() {
    try {
      // Registra o Service Worker respeitando a base da aplicação (suporte a GitHub Pages)
      const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
      const swPath = `${base.endsWith('/') ? base : base + '/'}sw.js`;
      this.swRegistration = await navigator.serviceWorker.register(swPath, {
        scope: base
      });

      // Se já houver um worker em espera (waiting), notifica prontidão de update
      if (this.swRegistration.waiting) {
        this.waitingWorker = this.swRegistration.waiting;
        this._notifyUpdateReady();
      }

      // Escuta novos service workers instalando
      this.swRegistration.addEventListener('updatefound', () => {
        const installingWorker = this.swRegistration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // Nova versão encontrada e instalada
              this.waitingWorker = installingWorker;
              this._notifyUpdateReady();
            } else {
              // Primeira instalação — conteúdo em cache para uso offline
              console.log('[PWA] Conteúdo do App Shell em cache para uso offline.');
            }
          }
        });
      });

      // Recarrega automaticamente a página quando o novo controller assumir o controle (após applyUpdate)
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

    } catch (error) {
      // Em ambientes de teste ou sem suporte a SW HTTPS/localhost, loga aviso não fatal
      console.warn('[PWA] Não foi possível registrar o Service Worker:', error.message);
    }
  }

  /**
   * Notifica a aplicação de que uma nova versão está pronta para ser ativada.
   */
  _notifyUpdateReady() {
    const payload = {
      applyUpdate: (force = false) => this.applyUpdate(force),
      isSafe: () => this.isSafeToUpdate()
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pwa:update-ready', { detail: payload }));
    }

    if (eventBus && EVENTS.PWA_UPDATE_READY) {
      eventBus.emit(EVENTS.PWA_UPDATE_READY, payload);
    }
  }

  /**
   * Avalia se a aplicação está em um momento seguro para recarregar/atualizar.
   * Não interrompe digitação em formulários, modais abertos, rotas de edição/cadastro,
   * ou estado offline.
   * @returns {boolean}
   */
  isSafeToUpdate() {
    if (typeof document === 'undefined') return true;

    // 1. Atualizações não devem ser aplicadas offline
    if (!this.isOnline) return false;

    // 2. Não atualizar se usuário estiver interagindo com campos de entrada
    if (document.activeElement) {
      const tag = document.activeElement.tagName ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        return false;
      }
    }

    // 3. Não atualizar se houver modal de formulário ou diálogo aberto
    const hasOpenModal = !!document.querySelector('.modal:not(.hidden), [role="dialog"]:not(.hidden)');
    if (hasOpenModal) return false;

    // 4. Não atualizar se o usuário estiver em rotas de cadastro ou edição de entidades
    if (typeof window !== 'undefined' && window.location && window.location.hash) {
      const hash = window.location.hash;
      if (hash.includes('/novo') || hash.includes('/editar')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Aplica a atualização do Service Worker (envia SKIP_WAITING).
   * @param {boolean} [force=false] Se true, ignora restrições de segurança de momento.
   * @returns {boolean} Se o comando foi disparado com sucesso.
   */
  applyUpdate(force = false) {
    if (!this.isOnline) {
      console.warn('[PWA] Não é possível aplicar atualização enquanto offline.');
      return false;
    }

    if (!force && !this.isSafeToUpdate()) {
      console.warn('[PWA] Atualização postergada para momento seguro (usuário em operação crítica).');
      return false;
    }

    const targetWorker = this.waitingWorker || (this.swRegistration && this.swRegistration.waiting);
    if (targetWorker) {
      targetWorker.postMessage({ type: 'SKIP_WAITING' });
      return true;
    }
    return false;
  }

  /**
   * Configura listeners de conectividade da rede com debounce e deduplicação.
   */
  _setupNetworkListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      if (this._onlineDebounceTimer) {
        clearTimeout(this._onlineDebounceTimer);
      }
      this._onlineDebounceTimer = setTimeout(() => {
        if (!this.isOnline) {
          this.isOnline = true;
          this._handleNetworkChange(true);
        }
      }, 250);
    });

    window.addEventListener('offline', () => {
      if (this._onlineDebounceTimer) {
        clearTimeout(this._onlineDebounceTimer);
      }
      if (this.isOnline) {
        this.isOnline = false;
        this._handleNetworkChange(false);
      }
    });
  }

  /**
   * Configura throttle para eventos de foreground (retorno à aba / foco) para evitar rajadas.
   */
  _setupForegroundListeners() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleForeground = () => {
      const now = Date.now();
      if (now - this._lastForegroundTime < this._foregroundThrottleMs) {
        return; // Throttled
      }
      this._lastForegroundTime = now;

      if (document.visibilityState === 'visible' && this.isOnline) {
        window.dispatchEvent(new CustomEvent('pwa:foreground'));
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleForeground();
      }
    });

    window.addEventListener('focus', () => {
      handleForeground();
    });
  }

  /**
   * Trata a transição de estado da rede com feedback não-intrusivo.
   */
  _handleNetworkChange(isOnline) {
    this.isOnline = isOnline;

    const payload = {
      isOnline,
      message: isOnline
        ? 'Conexão restaurada.'
        : 'Você está offline. Os dados locais continuam disponíveis.'
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pwa:network-changed', { detail: payload }));
      this._renderNetworkToast(payload);
    }

    if (eventBus && EVENTS.NETWORK_STATUS_CHANGED) {
      eventBus.emit(EVENTS.NETWORK_STATUS_CHANGED, payload);
    }
  }

  /**
   * Renderiza toast/banner sutil na interface para mudança de conectividade.
   */
  _renderNetworkToast({ isOnline, message }) {
    if (typeof document === 'undefined') return;

    let toast = document.getElementById('pwa-network-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pwa-network-toast';
      toast.className = 'fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold transition-all transform duration-300 pointer-events-auto';
      document.body.appendChild(toast);
    }

    if (isOnline) {
      toast.className = 'fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold bg-emerald-900/95 text-emerald-100 border-emerald-700/60 transition-all transform duration-300 opacity-100 translate-y-0';
      toast.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
        <span>${message}</span>
      `;
      setTimeout(() => {
        if (toast && toast.parentElement) {
          toast.classList.add('opacity-0', 'translate-y-2');
          setTimeout(() => toast.remove(), 300);
        }
      }, 3500);
    } else {
      toast.className = 'fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold bg-slate-900/95 text-slate-100 border-amber-500/60 transition-all transform duration-300 opacity-100 translate-y-0';
      toast.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
        <span>${message}</span>
        <button id="pwa-toast-dismiss" class="ml-2 text-slate-400 hover:text-white transition">✕</button>
      `;
      const btnDismiss = toast.querySelector('#pwa-toast-dismiss');
      if (btnDismiss) {
        btnDismiss.addEventListener('click', () => toast.remove(), { once: true });
      }
    }
  }

  /**
   * Configura listeners para captura do prompt de instalação do PWA.
   */
  _setupInstallPromptListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (e) => {
      // Impede o mini-infobar padrão do navegador
      e.preventDefault();
      this.deferredPrompt = e;
      this.isInstallable = true;

      const payload = {
        promptInstall: () => this.promptInstall()
      };

      window.dispatchEvent(new CustomEvent('pwa:installable', { detail: payload }));
      if (eventBus && EVENTS.PWA_INSTALLABLE) {
        eventBus.emit(EVENTS.PWA_INSTALLABLE, payload);
      }
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.isInstallable = false;

      window.dispatchEvent(new CustomEvent('pwa:installed'));
      if (eventBus && EVENTS.PWA_INSTALLED) {
        eventBus.emit(EVENTS.PWA_INSTALLED);
      }
      console.log('[PWA] GestãoPro instalado com sucesso como aplicativo standalone.');
    });
  }

  /**
   * Aciona o diálogo de instalação nativo do navegador.
   * @returns {Promise<{ outcome: 'accepted' | 'dismissed' } | null>}
   */
  async promptInstall() {
    if (!this.deferredPrompt) {
      console.warn('[PWA] Prompt de instalação não disponível no momento.');
      return null;
    }

    try {
      this.deferredPrompt.prompt();
      const choiceResult = await this.deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] Usuário aceitou a instalação do aplicativo.');
      } else {
        console.log('[PWA] Usuário recusou a instalação do aplicativo.');
      }
      this.deferredPrompt = null;
      this.isInstallable = false;
      return choiceResult;
    } catch (err) {
      console.error('[PWA] Erro ao invocar prompt de instalação:', err);
      return null;
    }
  }

  /**
   * Verifica se a aplicação está rodando em modo standalone (PWA instalado).
   */
  isStandalone() {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  /**
   * Obtém a versão do Service Worker ativo via postMessage.
   */
  async getActiveSWVersion() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.controller) {
      return null;
    }

    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        resolve(event.data?.version || null);
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_VERSION' },
        [messageChannel.port2]
      );

      setTimeout(() => resolve(null), 1000);
    });
  }

  /**
   * Purga caches do App Shell para recuperação de cache corrompido.
   * NUNCA toca no IndexedDB.
   * @returns {Promise<boolean>}
   */
  async clearAppCache() {
    if (typeof caches !== 'undefined') {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key.startsWith('gestaopro-')).map((key) => caches.delete(key))
        );
      } catch (err) {
        console.warn('[PWA] Erro ao limpar caches via CacheStorage:', err);
      }
    }

    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
      try {
        const channel = new MessageChannel();
        const promise = new Promise((resolve) => {
          channel.port1.onmessage = (event) => resolve(event.data?.success || false);
          setTimeout(() => resolve(true), 1500);
        });
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_APP_CACHE' }, [channel.port2]);
        await promise;
      } catch (_) {}
    }
    return true;
  }

  /**
   * Obtém estimativa de cota de armazenamento via Storage API.
   * Isola a cota do navegador sem misturar com banco de imagens.
   */
  async getStorageQuota() {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        return {
          usage: est.usage || 0,
          quota: est.quota || (1024 * 1024 * 1024),
          percentUsed: est.quota ? Number(((est.usage / est.quota) * 100).toFixed(2)) : 0
        };
      } catch (_) {}
    }
    return { usage: 0, quota: 1024 * 1024 * 1024, percentUsed: 0 };
  }
}

// Singleton para a aplicação
export const pwaHandler = new PWAHandler();
