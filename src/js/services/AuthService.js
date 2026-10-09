import { FirebaseAuthProvider } from '../auth/FirebaseAuthProvider.js';
import { MockAuthProvider } from '../auth/MockAuthProvider.js';
import { settingsRepository } from '../repositories/SettingsRepository.js';
import { eventBus, EVENTS } from '../eventBus.js';

export const AUTH_STATES = {
  LOADING: 'LOADING',
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ERROR: 'ERROR'
};

/**
 * GestãoPro — AuthService (PHASE 02)
 * Serviço central desacoplado de gerenciamento de autenticação, sessão e proteção de rotas.
 */
export class AuthService {
  constructor(provider = null) {
    const isPublicDemo = typeof import.meta !== 'undefined' &&
                         import.meta.env &&
                         (import.meta.env.VITE_PUBLIC_DEMO === 'true' || import.meta.env.VITE_PUBLIC_DEMO === true);

    this.provider = provider || (isPublicDemo ? new MockAuthProvider({ name: 'Demonstração Auth (Simulada)' }) : new FirebaseAuthProvider());
    this.state = AUTH_STATES.LOADING;
    this.currentSession = null;
    this._initialized = false;
    this._unsubscribeProvider = null;
    this._listeners = new Set();
  }

  /**
   * Inicializa o AuthService, carrega configurações de credenciais e inicia o listener de sessão.
   */
  async init() {
    if (this._initialized) return;
    this._initialized = true;

    try {
      // 1. Carregar configurações salvas do Firebase ou fallback de variáveis de ambiente
      let savedConfig = await settingsRepository.get('firebaseConfig');
      if ((!savedConfig || !savedConfig.apiKey) && typeof import.meta !== 'undefined' && import.meta.env) {
        const env = import.meta.env;
        if (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID) {
          savedConfig = {
            apiKey: env.VITE_FIREBASE_API_KEY,
            authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: env.VITE_FIREBASE_APP_ID,
            databaseURL: env.VITE_FIREBASE_DATABASE_URL,
            emulatorHost: env.VITE_FIREBASE_EMULATOR_HOST,
            authEmulatorHost: env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
            storageEmulatorHost: env.VITE_FIREBASE_STORAGE_EMULATOR_HOST
          };
        }
      }

      if (savedConfig && this.provider instanceof FirebaseAuthProvider) {
        await this.provider.initialize(savedConfig);
      } else if (this.provider instanceof MockAuthProvider) {
        await this.provider.initialize();
      }

      // 2. Registrar listener no provider ativo
      this._setupProviderListener();
    } catch (err) {
      console.warn('[AuthService] Aviso ao inicializar provedor de autenticação:', err.message);
      this.state = AUTH_STATES.UNAUTHENTICATED;
      this._emitStateChanged();
    }
  }

  _setupProviderListener() {
    if (this._unsubscribeProvider) {
      this._unsubscribeProvider();
    }

    this._unsubscribeProvider = this.provider.onAuthStateChanged((session) => {
      this.currentSession = session;
      if (session && session.authenticated) {
        this.state = AUTH_STATES.AUTHENTICATED;
      } else {
        this.state = AUTH_STATES.UNAUTHENTICATED;
      }
      this._emitStateChanged();
    });
  }

  _emitStateChanged() {
    const payload = {
      state: this.state,
      session: this.currentSession,
      isAuthenticated: this.isAuthenticated()
    };

    // 1. Notifica listeners diretos do serviço
    for (const cb of this._listeners) {
      try {
        cb(payload);
      } catch (e) {
        console.error('[AuthService] Erro no listener direto:', e);
      }
    }

    // 2. Dispara no EventBus do sistema
    if (eventBus && EVENTS.AUTH_STATE_CHANGED) {
      eventBus.emit(EVENTS.AUTH_STATE_CHANGED, payload);
    }
  }

  /**
   * Define o provedor de autenticação ativo (útil para testes ou transição de mock).
   * @param {AuthProvider} provider 
   */
  setProvider(provider) {
    if (!provider) return;
    if (this._unsubscribeProvider) {
      this._unsubscribeProvider();
      this._unsubscribeProvider = null;
    }
    this.provider = provider;
    this._setupProviderListener();
    this.currentSession = this.provider.getCurrentSession();
    this.state = this.currentSession?.authenticated ? AUTH_STATES.AUTHENTICATED : AUTH_STATES.UNAUTHENTICATED;
    this._emitStateChanged();
  }

  /**
   * Realiza login por email e senha.
   * @param {string} email 
   * @param {string} password 
   * @returns {Promise<Object>}
   */
  async signIn(email, password) {
    try {
      this.state = AUTH_STATES.LOADING;
      const session = await this.provider.signIn(email, password);
      if (this.currentSession !== session) {
        this.currentSession = session;
        this.state = AUTH_STATES.AUTHENTICATED;
        this._emitStateChanged();
      }
      return session;
    } catch (error) {
      this.state = AUTH_STATES.UNAUTHENTICATED;
      this._emitStateChanged();
      throw error;
    }
  }

  /**
   * Encerra a sessão ativa do usuário.
   */
  async signOut() {
    try {
      await this.provider.signOut();
      if (this.currentSession !== null) {
        this.currentSession = null;
        this.state = AUTH_STATES.UNAUTHENTICATED;
        this._emitStateChanged();
      }
    } catch (error) {
      console.error('[AuthService] Falha ao efetuar logout:', error);
      throw error;
    }
  }

  async logout() {
    return this.signOut();
  }

  /**
   * Retorna o usuário bruto ativo.
   */
  getCurrentUser() {
    return this.provider ? this.provider.getCurrentUser() : null;
  }

  getUser() {
    return this.getCurrentUser();
  }

  /**
   * Retorna os dados estruturados da sessão ativa.
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Registra listener para alterações de estado de autenticação.
   * @param {Function} callback 
   * @returns {Function} Unsubscribe
   */
  onAuthStateChanged(callback) {
    if (typeof callback !== 'function') throw new Error('Callback deve ser uma função.');
    this._listeners.add(callback);

    // Emite o estado atual imediatamente
    try {
      callback({
        state: this.state,
        session: this.currentSession,
        isAuthenticated: this.isAuthenticated()
      });
    } catch (e) {}

    return () => {
      this._listeners.delete(callback);
    };
  }

  async refreshToken() {
    return this.provider ? this.provider.refreshToken() : null;
  }

  async getIdToken(forceRefresh = false) {
    return this.provider ? this.provider.getIdToken(forceRefresh) : null;
  }

  async getClaims(forceRefresh = false) {
    return this.provider ? this.provider.getClaims(forceRefresh) : {};
  }

  isAuthenticated() {
    return !!(this.currentSession && this.currentSession.authenticated);
  }

  getTenantId() {
    return this.currentSession?.tenantId || null;
  }

  getRole() {
    return this.currentSession?.role || 'operator';
  }

  isAdmin() {
    return this.getRole() === 'admin';
  }

  isConfigured() {
    return this.provider ? this.provider.isConfigured() : false;
  }

  getAuthState() {
    return this.state;
  }

  /**
   * Route Guard: Determina se uma rota pode ser acessada.
   * Se o provedor não estiver configurado (modo local/demo aberto), o acesso é livre.
   * Se configurado e não autenticado, apenas rotas públicas (como 'login') são permitidas.
   * OFFLINE-FIRST: Se o usuário já está autenticado (sessão persistida localmente), o acesso é 100% liberado offline.
   * @param {string} route 
   * @returns {boolean}
   */
  canAccessRoute(route) {
    if (route === 'login') return true;

    // Se o serviço de autenticação não está configurado com Firebase real, opera em modo aberto/local
    if (!this.isConfigured() && !(this.provider instanceof MockAuthProvider && this.provider.isConfigured())) {
      return true;
    }

    // Se estiver autenticado (mesmo se estiver offline), o acesso a páginas locais é livre
    return this.isAuthenticated();
  }

  destroy() {
    if (this._unsubscribeProvider) {
      this._unsubscribeProvider();
      this._unsubscribeProvider = null;
    }
    this._listeners.clear();
    this.currentSession = null;
    this.state = AUTH_STATES.UNAUTHENTICATED;
    this._initialized = false;
  }
}

export const authService = new AuthService();
