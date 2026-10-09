import { AuthProvider } from './AuthProvider.js';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  connectAuthEmulator
} from 'firebase/auth';
import { validateFirebaseConfig } from '../utils/firebaseConfigValidator.js';

/**
 * GestãoPro — Provedor Oficial de Autenticação Firebase Auth (PHASE 02 & PHASE 09)
 * Utiliza o Firebase Modular SDK com persistência local nativa (browserLocalPersistence)
 * e suporte nativo ao Firebase Emulator Suite para homologação e staging.
 */
export class FirebaseAuthProvider extends AuthProvider {
  constructor(config = null) {
    super();
    this.config = config || null;
    this.app = null;
    this.auth = null;
    this.currentUser = null;
    this.currentSession = null;
    this._listeners = new Set();
    this._unsubscribeFbAuth = null;
    this._initialized = false;
  }

  getProviderName() {
    return 'Firebase Authentication';
  }

  isConfigured() {
    return !!(this.config && this.config.apiKey && this.config.projectId);
  }

  /**
   * Inicializa o Firebase App e Firebase Auth com persistência local.
   * @param {Object} [config]
   */
  async initialize(config = null) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (!this.isConfigured()) {
      return;
    }

    // Validação de segurança: Bloqueia conexão com projetos de produção na Phase 09
    validateFirebaseConfig(this.config);

    if (this._initialized && this.auth) {
      return;
    }

    try {
      // 1. Inicializar ou reutilizar Firebase App
      const apps = getApps();
      const appName = 'gestaopro-auth';
      const existing = apps.find(a => a.name === appName || a.name === '[DEFAULT]');
      
      this.app = existing || initializeApp(this.config, apps.length === 0 ? undefined : appName);
      this.auth = getAuth(this.app);

      // 2. Conexão com Auth Emulator caso configurado
      if (this.config && (this.config.authEmulatorHost || this.config.emulatorHost)) {
        const emuHost = this.config.authEmulatorHost || this.config.emulatorHost;
        const [host, port] = emuHost.split(':');
        const emuUrl = `http://${host}:${port || '9099'}`;
        connectAuthEmulator(this.auth, emuUrl, { disableWarnings: true });
      }

      // 3. Configurar persistência local explícita no navegador
      if (typeof window !== 'undefined' && browserLocalPersistence) {
        try {
          await setPersistence(this.auth, browserLocalPersistence);
        } catch (persErr) {
          console.warn('[FirebaseAuthProvider] Aviso ao definir persistência local:', persErr.message);
        }
      }

      // 4. Registrar listener nativo de estado de autenticação
      this._setupNativeListener();
      this._initialized = true;
    } catch (err) {
      console.error('[FirebaseAuthProvider] Falha ao inicializar Firebase Auth:', err);
      throw new Error(`Falha ao inicializar autenticação: ${err.message}`);
    }
  }

  _setupNativeListener() {
    if (!this.auth) return;
    if (this._unsubscribeFbAuth) {
      this._unsubscribeFbAuth();
    }

    this._unsubscribeFbAuth = fbOnAuthStateChanged(this.auth, async (user) => {
      this.currentUser = user;
      if (user) {
        this.currentSession = await this._buildSessionModel(user);
      } else {
        this.currentSession = null;
      }
      this._notifyListeners();
    }, (error) => {
      console.error('[FirebaseAuthProvider] Erro no listener nativo de auth:', error);
    });
  }

  _notifyListeners() {
    for (const callback of this._listeners) {
      try {
        callback(this.currentSession);
      } catch (e) {
        console.error('[FirebaseAuthProvider] Erro no listener registrado:', e);
      }
    }
  }

  /**
   * Constrói o SessionModel seguro a partir do usuário do Firebase.
   * Lê custom claims do token (somente leitura no cliente).
   * @param {Object} user 
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<Object>}
   */
  async _buildSessionModel(user, forceRefresh = false) {
    if (!user) return null;

    let claims = {};
    try {
      if (typeof user.getIdTokenResult === 'function') {
        const tokenResult = await user.getIdTokenResult(forceRefresh);
        claims = tokenResult.claims || {};
      }
    } catch (err) {
      console.warn('[FirebaseAuthProvider] Não foi possível obter claims do token:', err.message);
    }

    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Operador',
      tenantId: claims.tenantId || null,
      role: claims.role || 'operator', // fallback seguro padrão
      claims: { ...claims },
      authenticated: true,
      lastLoginAt: user.metadata?.lastSignInTime || new Date().toISOString()
    };
  }

  /**
   * Realiza login por email e senha tratando os códigos de erro oficiais.
   * @param {string} email 
   * @param {string} password 
   * @returns {Promise<Object>}
   */
  async signIn(email, password) {
    if (!this.isConfigured() || !this.auth) {
      throw new Error('Serviço de autenticação não configurado com credenciais válidas.');
    }

    if (!email || !password) {
      throw new Error('Informe o e-mail e a senha de acesso.');
    }

    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email.trim(), password);
      this.currentUser = userCredential.user;
      this.currentSession = await this._buildSessionModel(userCredential.user, true);
      this._notifyListeners();
      return this.currentSession;
    } catch (error) {
      throw new Error(this._mapAuthError(error));
    }
  }

  /**
   * Encerra a sessão ativa no Firebase.
   */
  async signOut() {
    if (!this.auth) {
      this.currentUser = null;
      this.currentSession = null;
      this._notifyListeners();
      return;
    }

    try {
      await fbSignOut(this.auth);
      this.currentUser = null;
      this.currentSession = null;
      this._notifyListeners();
    } catch (error) {
      console.error('[FirebaseAuthProvider] Erro ao deslogar:', error);
      throw new Error(`Erro ao encerrar sessão: ${error.message}`);
    }
  }

  getCurrentUser() {
    return this.currentUser || (this.auth ? this.auth.currentUser : null);
  }

  getCurrentSession() {
    return this.currentSession;
  }

  onAuthStateChanged(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback deve ser uma função.');
    }

    this._listeners.add(callback);

    // Notifica imediatamente com o estado atual caso já resolvido
    if (this._initialized) {
      try {
        callback(this.currentSession);
      } catch (err) {
        console.error('[FirebaseAuthProvider] Erro na notificação inicial:', err);
      }
    }

    return () => {
      this._listeners.delete(callback);
    };
  }

  async refreshToken() {
    const user = this.getCurrentUser();
    if (!user) return null;
    return user.getIdToken(true);
  }

  async getIdToken(forceRefresh = false) {
    const user = this.getCurrentUser();
    if (!user) return null;
    return user.getIdToken(forceRefresh);
  }

  async getClaims(forceRefresh = false) {
    const user = this.getCurrentUser();
    if (!user) return {};
    if (typeof user.getIdTokenResult === 'function') {
      const res = await user.getIdTokenResult(forceRefresh);
      return res.claims || {};
    }
    return {};
  }

  isAuthenticated() {
    return !!(this.currentUser || (this.auth && this.auth.currentUser));
  }

  /**
   * Traduz códigos técnicos de erro do Firebase Auth para mensagens claras e amigáveis em português.
   * @param {Object} error 
   * @returns {string}
   */
  _mapAuthError(error) {
    const code = error?.code || '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'E-mail ou senha incorretos. Verifique suas credenciais.';
      case 'auth/invalid-email':
        return 'O formato do e-mail informado é inválido.';
      case 'auth/user-disabled':
        return 'Esta conta de usuário foi desativada pelo administrador.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas sem sucesso. Por segurança, tente novamente em alguns instantes.';
      case 'auth/network-request-failed':
        return 'Sem conexão com a internet para autenticar. Verifique sua rede e tente novamente.';
      default:
        return error.message ? `Erro de autenticação: ${error.message}` : 'Não foi possível concluir o login.';
    }
  }

  destroy() {
    if (this._unsubscribeFbAuth) {
      this._unsubscribeFbAuth();
      this._unsubscribeFbAuth = null;
    }
    this._listeners.clear();
    this.currentUser = null;
    this.currentSession = null;
    this._initialized = false;
  }
}
