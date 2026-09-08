/**
 * EventBus isolado para comunicação inter-abas e desacoplamento de UI/Services.
 * Utiliza o BroadcastChannel como driver primário para comunicação multi-janela.
 */

class EventBus {
  constructor() {
    this.channelName = 'gestaopro_events';
    this.channel = null;
    this.listeners = new Map();

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event) => {
        this._dispatchLocal(event.data.type, event.data.payload);
      };
    } else {
      console.warn('[EventBus] BroadcastChannel não suportado. Fallback para EventTarget (apenas aba atual).');
    }
  }

  /**
   * Dispara um evento localmente e para outras abas.
   * @param {string} type Tipo de evento (ex: 'PRODUCT_UPDATED')
   * @param {any} payload Dados do evento
   */
  emit(type, payload = null) {
    // 1. Notifica a aba atual
    this._dispatchLocal(type, payload);
    
    // 2. Notifica outras abas (se suportado)
    if (this.channel) {
      try {
        this.channel.postMessage({ type, payload });
      } catch (e) {
        // Ignora erros de DataCloneError caso o payload contenha referências locais não-serializáveis (ex: funções)
      }
    }
  }

  /**
   * Registra um listener para um tipo de evento específico.
   * @param {string} type Tipo do evento
   * @param {Function} callback Função a ser executada
   * @returns {Function} Função para remover o listener
   */
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(callback);

    // Retorna a função de unsubscribe
    return () => {
      this.listeners.get(type).delete(callback);
    };
  }

  _dispatchLocal(type, payload) {
    if (this.listeners.has(type)) {
      for (const callback of this.listeners.get(type)) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[EventBus] Erro no listener do evento ${type}:`, error);
        }
      }
    }
  }
}

// Exporta um singleton
export const eventBus = new EventBus();

// Eventos Padronizados do Sistema
export const EVENTS = {
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  STOCK_CHANGED: 'STOCK_CHANGED',
  SALE_CREATED: 'SALE_CREATED',
  PURCHASE_CREATED: 'PURCHASE_CREATED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  NETWORK_STATUS_CHANGED: 'NETWORK_STATUS_CHANGED',
  PWA_UPDATE_READY: 'PWA_UPDATE_READY',
  PWA_INSTALLABLE: 'PWA_INSTALLABLE',
  PWA_INSTALLED: 'PWA_INSTALLED',
  SYNC_STATUS_CHANGED: 'SYNC_STATUS_CHANGED',
  SYNC_QUEUE_UPDATED: 'SYNC_QUEUE_UPDATED'
};
