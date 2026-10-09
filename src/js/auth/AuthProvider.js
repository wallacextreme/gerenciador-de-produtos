/**
 * GestãoPro — Contrato Abstrato de Autenticação (PHASE 02)
 * Define a interface padrão para provedores de autenticação (Firebase Auth, Mock, Custom).
 */
export class AuthProvider {
  /**
   * Nome identificador do provedor.
   * @returns {string}
   */
  getProviderName() {
    return 'BaseAuthProvider';
  }

  /**
   * Retorna se o provedor está configurado com credenciais válidas.
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * Inicializa o provedor de autenticação com a configuração fornecida.
   * @param {Object} [config]
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    throw new Error('initialize() deve ser implementado pela subclasse.');
  }

  /**
   * Realiza login através de email e senha.
   * @param {string} email 
   * @param {string} password 
   * @returns {Promise<Object>} Dados da sessão autenticada
   */
  async signIn(email, password) {
    throw new Error('signIn() deve ser implementado pela subclasse.');
  }

  /**
   * Encerra a sessão ativa do usuário.
   * @returns {Promise<void>}
   */
  async signOut() {
    throw new Error('signOut() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna o usuário bruto atualmente autenticado ou null.
   * @returns {Object|null}
   */
  getCurrentUser() {
    return null;
  }

  /**
   * Retorna a representação estruturada da sessão atual.
   * @returns {Object|null}
   */
  getCurrentSession() {
    return null;
  }

  /**
   * Registra um listener para mudanças de estado de autenticação.
   * @param {Function} callback (session: Object|null) => void
   * @returns {Function} Função para cancelar o listener (unsubscribe)
   */
  onAuthStateChanged(callback) {
    throw new Error('onAuthStateChanged() deve ser implementado pela subclasse.');
  }

  /**
   * Força a atualização do token de autenticação.
   * @returns {Promise<string|null>}
   */
  async refreshToken() {
    throw new Error('refreshToken() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna o ID Token JWT do usuário.
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<string|null>}
   */
  async getIdToken(forceRefresh = false) {
    throw new Error('getIdToken() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna as claims customizadas presentes no ID Token (somente leitura).
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<Object>}
   */
  async getClaims(forceRefresh = false) {
    throw new Error('getClaims() deve ser implementado pela subclasse.');
  }

  /**
   * Retorna se há um usuário com sessão válida ativa.
   * @returns {boolean}
   */
  isAuthenticated() {
    return false;
  }
}
