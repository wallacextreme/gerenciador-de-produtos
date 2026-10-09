import { AuthProvider } from './AuthProvider.js';

/**
 * GestãoPro — Provedor de Autenticação Mock em Memória (PHASE 02)
 * Utilizado para testes unitários, testes de integração sem rede e ambientes de desenvolvimento isolados.
 */
export class MockAuthProvider extends AuthProvider {
  constructor(options = {}) {
    super();
    this.name = options.name || 'MockAuthProvider';
    this.configured = options.configured !== undefined ? options.configured : true;
    this.shouldFail = false;
    this.failureMessage = 'Falha simulada de autenticação';
    this.failureCode = 'auth/invalid-credential';
    this.isOffline = false;

    // Catálogo de usuários pré-cadastrados para teste
    this.registeredUsers = new Map();
    this.currentUser = null;
    this.currentSession = null;
    this._listeners = new Set();

    // Registra usuário padrão de testes
    this.addUser({
      uid: 'user_admin_001',
      email: 'admin@gestaopro.com',
      password: 'password123',
      displayName: 'Administrador Matriz',
      tenantId: 'tenant_loja_01',
      role: 'admin'
    });

    this.addUser({
      uid: 'user_operator_002',
      email: 'caixa1@gestaopro.com',
      password: 'password123',
      displayName: 'Operador Caixa 1',
      tenantId: 'tenant_loja_01',
      role: 'operator'
    });
  }

  getProviderName() {
    return this.name;
  }

  isConfigured() {
    return this.configured;
  }

  setConfigured(val) {
    this.configured = !!val;
  }

  setShouldFail(val, msg = 'Falha simulada de autenticação', code = 'auth/invalid-credential') {
    this.shouldFail = !!val;
    this.failureMessage = msg;
    this.failureCode = code;
  }

  setOffline(val) {
    this.isOffline = !!val;
  }

  addUser({ uid, email, password, displayName, tenantId, role = 'operator', customClaims = {} }) {
    this.registeredUsers.set(email.toLowerCase().trim(), {
      uid: uid || `mock_uid_${crypto.randomUUID().slice(0, 8)}`,
      email: email.toLowerCase().trim(),
      password,
      displayName: displayName || email.split('@')[0],
      tenantId: tenantId || null,
      role,
      claims: {
        tenantId: tenantId || null,
        role,
        ...customClaims
      }
    });
  }

  async initialize(config = {}) {
    // Inicialização síncrona/instantânea em memória
    return Promise.resolve();
  }

  async signIn(email, password) {
    if (!this.configured) {
      throw new Error('Serviço de autenticação não configurado com credenciais válidas.');
    }

    if (this.isOffline) {
      throw new Error('Sem conexão com a internet para autenticar. Verifique sua rede e tente novamente.');
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (!email || !password) {
      throw new Error('Informe o e-mail e a senha de acesso.');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userRecord = this.registeredUsers.get(normalizedEmail);

    if (!userRecord || userRecord.password !== password) {
      throw new Error('E-mail ou senha incorretos. Verifique suas credenciais.');
    }

    this.currentUser = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      getIdToken: async () => `mock_jwt_token_${userRecord.uid}`,
      getIdTokenResult: async () => ({ claims: { ...userRecord.claims } })
    };

    this.currentSession = {
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      tenantId: userRecord.tenantId,
      role: userRecord.role,
      claims: { ...userRecord.claims },
      authenticated: true,
      lastLoginAt: new Date().toISOString()
    };

    this._notifyListeners();
    return this.currentSession;
  }

  async signOut() {
    this.currentUser = null;
    this.currentSession = null;
    this._notifyListeners();
  }

  getCurrentUser() {
    return this.currentUser;
  }

  getCurrentSession() {
    return this.currentSession;
  }

  onAuthStateChanged(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback deve ser uma função.');
    }

    this._listeners.add(callback);

    // Emite o estado atual imediatamente
    try {
      callback(this.currentSession);
    } catch (e) {
      console.error('[MockAuthProvider] Erro na notificação inicial:', e);
    }

    return () => {
      this._listeners.delete(callback);
    };
  }

  async refreshToken() {
    if (!this.currentUser) return null;
    return `mock_jwt_token_refreshed_${this.currentUser.uid}`;
  }

  async getIdToken(forceRefresh = false) {
    if (!this.currentUser) return null;
    return `mock_jwt_token_${this.currentUser.uid}`;
  }

  async getClaims(forceRefresh = false) {
    if (!this.currentSession) return {};
    return { ...this.currentSession.claims };
  }

  isAuthenticated() {
    return !!this.currentSession && this.currentSession.authenticated;
  }

  /**
   * Simula o encerramento da sessão acionado por outra aba do navegador.
   */
  simulateMultiTabSignOut() {
    this.currentUser = null;
    this.currentSession = null;
    this._notifyListeners();
  }

  _notifyListeners() {
    for (const callback of this._listeners) {
      try {
        callback(this.currentSession);
      } catch (e) {
        console.error('[MockAuthProvider] Erro no listener:', e);
      }
    }
  }

  clear() {
    this.currentUser = null;
    this.currentSession = null;
    this._listeners.clear();
    this.shouldFail = false;
    this.isOffline = false;
  }
}
