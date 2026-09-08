import { eventBus, EVENTS } from '../eventBus.js';

/**
 * GestãoPro — PWA Handler (FASE 11)
 * Gerencia o ciclo de vida do Service Worker, instalação PWA (beforeinstallprompt),
 * detecção de conectividade (online/offline) e feedback não-intrusivo de atualizações.
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
  }

  /**
   * Inicializa o gerenciador PWA, registra Service Worker e escuta eventos de rede e instalação.
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    this._setupNetworkListeners();
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
      // Registra o Service Worker na raiz
      this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
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
              console.log('[PWA] Conteúdo em cache para uso offline.');
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
      applyUpdate: () => this.applyUpdate()
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pwa:update-ready', { detail: payload }));
    }

    if (eventBus && EVENTS.PWA_UPDATE_READY) {
      eventBus.emit(EVENTS.PWA_UPDATE_READY, payload);
    }
  }

  /**
   * Aplica a atualização do Service Worker (envia SKIP_WAITING).
   */
  applyUpdate() {
    if (this.waitingWorker) {
      this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } else if (this.swRegistration && this.swRegistration.waiting) {
      this.swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  /**
   * Configura listeners de conectividade da rede.
   */
  _setupNetworkListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isOnline = true;
      this._handleNetworkChange(true);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this._handleNetworkChange(false);
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
}

// Singleton para a aplicação
export const pwaHandler = new PWAHandler();
