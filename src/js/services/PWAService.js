/**
 * PWAService — Gerenciamento do ciclo de vida PWA (FASE 11)
 * Responsabilidades:
 *   - Registro e atualização do Service Worker
 *   - Interceptação do evento de instalação (beforeinstallprompt)
 *   - Detecção de nova versão disponível com notificação ao usuário
 *   - Persistência de storage IndexedDB (navigator.storage.persist)
 */

export class PWAService {
  static _installPrompt = null;
  static _swRegistration = null;
  static _updateReadyCallback = null;

  /**
   * Inicializa o PWA: registra o SW, configura listeners e solicita storage persistente.
   * @param {Function} [onUpdateReady] Callback chamado quando uma nova versão do SW estiver disponível.
   */
  static async init(onUpdateReady = null) {
    this._updateReadyCallback = onUpdateReady;

    // 1. Registrar Service Worker
    if ('serviceWorker' in navigator) {
      await this._registerServiceWorker();
    }

    // 2. Capturar evento de instalação nativa do browser
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this._installPrompt = event;
      console.log('[PWA] Evento beforeinstallprompt capturado — app instalável.');

      // Emitir evento customizado para a UI mostrar botão de instalação
      window.dispatchEvent(new CustomEvent('pwa:installable'));
    });

    // 3. Detectar quando app foi instalado com sucesso
    window.addEventListener('appinstalled', () => {
      this._installPrompt = null;
      console.log('[PWA] App instalado com sucesso!');
      window.dispatchEvent(new CustomEvent('pwa:installed'));
    });

    // 4. Solicitar persistência de storage IndexedDB
    await this._requestPersistentStorage();
  }

  /**
   * Registra o Service Worker e configura handlers de atualização.
   */
  static async _registerServiceWorker() {
    try {
      const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
      const swPath = `${base.endsWith('/') ? base : base + '/'}sw.js`;
      const registration = await navigator.serviceWorker.register(swPath, {
        scope: base
      });

      this._swRegistration = registration;
      console.log('[PWA] Service Worker registrado com escopo:', registration.scope);

      // Verificar se há uma atualização pendente ao registrar
      if (registration.waiting) {
        this._notifyUpdateReady(registration);
      }

      // Ouvir por novas atualizações durante a sessão
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Nova versão instalada e pronta — notificar o usuário
            console.log('[PWA] Nova versão disponível!');
            this._notifyUpdateReady(registration);
          }
        });
      });

      // Listener para recarga quando o novo SW assumir o controle
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Novo Service Worker assumiu o controle. Recarregando...');
        window.location.reload();
      });

    } catch (error) {
      console.error('[PWA] Falha ao registrar Service Worker:', error);
    }
  }

  /**
   * Notifica a aplicação que uma atualização está disponível.
   * @param {ServiceWorkerRegistration} registration
   */
  static _notifyUpdateReady(registration) {
    if (this._updateReadyCallback) {
      this._updateReadyCallback(() => this.applyUpdate(registration));
    }

    // Emitir evento global para componentes de UI escutarem
    window.dispatchEvent(new CustomEvent('pwa:update-ready', {
      detail: { applyUpdate: () => this.applyUpdate(registration) }
    }));
  }

  /**
   * Aplica a atualização disponível enviando SKIP_WAITING ao SW aguardando.
   * @param {ServiceWorkerRegistration} registration
   */
  static applyUpdate(registration = null) {
    const reg = registration || this._swRegistration;
    if (reg && reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  /**
   * Exibe o prompt nativo de instalação do browser.
   * @returns {Promise<boolean>} true se o usuário aceitou instalar.
   */
  static async promptInstall() {
    if (!this._installPrompt) {
      console.warn('[PWA] Nenhum prompt de instalação disponível. App já instalado ou browser não suporta.');
      return false;
    }

    this._installPrompt.prompt();
    const { outcome } = await this._installPrompt.userChoice;

    console.log('[PWA] Resposta do usuário ao prompt de instalação:', outcome);
    this._installPrompt = null;

    return outcome === 'accepted';
  }

  /**
   * Retorna se o app está instalado (rodando em modo standalone/fullscreen).
   * @returns {boolean}
   */
  static isInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true
    );
  }

  /**
   * Retorna se o browser suporta a instalação e o app ainda não está instalado.
   * @returns {boolean}
   */
  static canInstall() {
    return !!this._installPrompt && !this.isInstalled();
  }

  /**
   * Verifica manualmente se há uma atualização de SW disponível.
   */
  static async checkForUpdate() {
    if (this._swRegistration) {
      await this._swRegistration.update();
    }
  }

  /**
   * Solicita ao browser que mantenha o storage IndexedDB persistente (não limpe por pressão de disco).
   */
  static async _requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        console.log('[PWA] Storage persistente:', granted ? 'concedido ✓' : 'negado (modo best-effort)');
      } else {
        console.log('[PWA] Storage persistente já ativo ✓');
      }
    }
  }

  /**
   * Retorna o status de conectividade atual.
   * @returns {{ online: boolean, connectionType: string|null }}
   */
  static getNetworkStatus() {
    const online = navigator.onLine;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      online,
      connectionType: connection ? connection.effectiveType : null,
      isSlowConnection: connection ? ['slow-2g', '2g'].includes(connection.effectiveType) : false
    };
  }
}
