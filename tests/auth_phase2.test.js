import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { AuthService, AUTH_STATES } from '../src/js/services/AuthService.js';
import { AuthProvider } from '../src/js/auth/AuthProvider.js';
import { MockAuthProvider } from '../src/js/auth/MockAuthProvider.js';
import { FirebaseAuthProvider } from '../src/js/auth/FirebaseAuthProvider.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import { getDB } from '../src/js/db/connection.js';
import { ProductRepository } from '../src/js/repositories/ProductRepository.js';

describe('Firebase Auth — Autenticação e Gestão de Sessão (FASE 02)', () => {
  let mockProvider;
  let authService;
  let productRepo;

  beforeEach(async () => {
    // Limpa banco local para isolamento
    const db = await getDB();
    await db.clear('products');

    mockProvider = new MockAuthProvider({ name: 'TestMockAuthProvider', configured: true });
    authService = new AuthService(mockProvider);
    await authService.init();

    productRepo = new ProductRepository();
  });

  afterEach(() => {
    if (authService) {
      authService.destroy();
    }
    if (mockProvider) {
      mockProvider.clear();
    }
  });

  describe('AUTH-01: Inicialização do Serviço', () => {
    it('deve inicializar o AuthService com o provedor fornecido em estado correto', async () => {
      expect(authService).toBeDefined();
      expect(authService.isConfigured()).toBe(true);
      expect(authService.getAuthState()).toBe(AUTH_STATES.UNAUTHENTICATED);
      expect(authService.getCurrentSession()).toBeNull();
    });

    it('AuthProvider base deve garantir contrato e lançar exceções em métodos abstratos', async () => {
      const base = new AuthProvider();
      expect(base.getProviderName()).toBe('BaseAuthProvider');
      expect(base.isConfigured()).toBe(false);
      expect(base.getCurrentUser()).toBeNull();
      expect(base.getCurrentSession()).toBeNull();
      expect(base.isAuthenticated()).toBe(false);

      expect(base.initialize()).rejects.toThrow('deve ser implementado');
      expect(base.signIn('a@b.com', '123')).rejects.toThrow('deve ser implementado');
      expect(base.signOut()).rejects.toThrow('deve ser implementado');
      expect(() => base.onAuthStateChanged(() => {})).toThrow('deve ser implementado');
      expect(base.refreshToken()).rejects.toThrow('deve ser implementado');
      expect(base.getIdToken()).rejects.toThrow('deve ser implementado');
      expect(base.getClaims()).rejects.toThrow('deve ser implementado');
    });
  });

  describe('AUTH-02: Usuário Inicialmente Desconectado', () => {
    it('deve indicar que não há usuário autenticado antes do login', () => {
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getCurrentUser()).toBeNull();
      expect(authService.getCurrentSession()).toBeNull();
      expect(authService.getTenantId()).toBeNull();
      expect(authService.isAdmin()).toBe(false);
      expect(authService.getRole()).toBe('operator');
    });
  });

  describe('AUTH-03: Login Válido', () => {
    it('deve autenticar usuário válido com email e senha e criar sessão estruturada', async () => {
      const session = await authService.signIn('admin@gestaopro.com', 'password123');

      expect(session).toBeDefined();
      expect(session.authenticated).toBe(true);
      expect(session.uid).toBe('user_admin_001');
      expect(session.email).toBe('admin@gestaopro.com');
      expect(session.displayName).toBe('Administrador Matriz');
      expect(session.tenantId).toBe('tenant_loja_01');
      expect(session.role).toBe('admin');

      // Verifica estado do AuthService
      expect(authService.isAuthenticated()).toBe(true);
      expect(authService.getAuthState()).toBe(AUTH_STATES.AUTHENTICATED);
      expect(authService.isAdmin()).toBe(true);
      expect(authService.getTenantId()).toBe('tenant_loja_01');

      // Verifica que a senha NÃO foi gravada na sessão
      expect(session.password).toBeUndefined();
    });
  });

  describe('AUTH-04: Credenciais Inválidas', () => {
    it('deve falhar para senha incorreta com mensagem amigável sem expor dados técnicos', async () => {
      expect(authService.signIn('admin@gestaopro.com', 'senha_errada')).rejects.toThrow(
        'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getAuthState()).toBe(AUTH_STATES.UNAUTHENTICATED);
    });

    it('deve falhar para usuário inexistente', async () => {
      expect(authService.signIn('naoexiste@gestaopro.com', '123456')).rejects.toThrow(
        'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
    });

    it('deve validar obrigatoriedade de email e senha', async () => {
      expect(authService.signIn('', '')).rejects.toThrow('Informe o e-mail e a senha de acesso.');
      expect(authService.signIn('admin@gestaopro.com', '')).rejects.toThrow('Informe o e-mail e a senha de acesso.');
    });
  });

  describe('AUTH-05: Logout', () => {
    it('deve encerrar sessão, atualizar estado e limpar usuário ativo', async () => {
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.isAuthenticated()).toBe(true);

      await authService.signOut();

      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getCurrentSession()).toBeNull();
      expect(authService.getCurrentUser()).toBeNull();
      expect(authService.getAuthState()).toBe(AUTH_STATES.UNAUTHENTICATED);
    });
  });

  describe('AUTH-06: Persistência de Sessão', () => {
    it('deve preservar sessão persistida no provedor entre requisições sem exigir novo login', async () => {
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.isAuthenticated()).toBe(true);

      // Simula reabertura de serviço com o mesmo provedor persistido
      const serviceRestored = new AuthService(mockProvider);
      await serviceRestored.init();

      expect(serviceRestored.isAuthenticated()).toBe(true);
      expect(serviceRestored.getCurrentSession()?.email).toBe('admin@gestaopro.com');
      expect(serviceRestored.getRole()).toBe('admin');

      serviceRestored.destroy();
    });
  });

  describe('AUTH-07: Mudança de Auth State (EventBus e Listeners)', () => {
    it('deve emitir notificações no EventBus e listeners diretos ao alterar estado', async () => {
      const capturedBusEvents = [];
      const capturedDirectEvents = [];

      const unsubBus = eventBus.on(EVENTS.AUTH_STATE_CHANGED, (payload) => {
        capturedBusEvents.push(payload);
      });

      const unsubDirect = authService.onAuthStateChanged((payload) => {
        capturedDirectEvents.push(payload);
      });

      // Login
      await authService.signIn('admin@gestaopro.com', 'password123');

      // Logout
      await authService.signOut();

      unsubBus();
      unsubDirect();

      // Verifica disparos
      expect(capturedBusEvents.length).toBeGreaterThanOrEqual(2);
      expect(capturedDirectEvents.length).toBeGreaterThanOrEqual(2);

      const loginEvent = capturedDirectEvents.find(e => e.isAuthenticated === true);
      expect(loginEvent).toBeDefined();
      expect(loginEvent.session.email).toBe('admin@gestaopro.com');

      const logoutEvent = capturedDirectEvents[capturedDirectEvents.length - 1];
      expect(logoutEvent.isAuthenticated).toBe(false);
      expect(logoutEvent.session).toBeNull();
    });
  });

  describe('AUTH-08: Listener Duplicado', () => {
    it('não deve duplicar execuções de um mesmo callback registrado via Set', async () => {
      let callCount = 0;
      const callback = () => {
        callCount++;
      };

      // Registra a mesma função duas vezes
      authService.onAuthStateChanged(callback);
      authService.onAuthStateChanged(callback);

      const countAfterRegister = callCount;

      await authService.signIn('admin@gestaopro.com', 'password123');

      // O callback deve ser invocado apenas uma vez no signIn (e não duas vezes)
      expect(callCount - countAfterRegister).toBe(1);
    });
  });

  describe('AUTH-09: Cleanup de Listeners', () => {
    it('função de unsubscribe deve cancelar recebimento de notificações futuras', async () => {
      let listenerCalls = 0;
      const unsub = authService.onAuthStateChanged(() => {
        listenerCalls++;
      });

      const initialCalls = listenerCalls;

      // Desinscreve
      unsub();

      // Dispara ações após cancelamento
      await authService.signIn('admin@gestaopro.com', 'password123');
      await authService.signOut();

      expect(listenerCalls).toBe(initialCalls);
    });
  });

  describe('AUTH-10: Tratamento de Erro de Rede (Offline Login)', () => {
    it('deve emitir mensagem clara e amigável ao tentar login remoto sem rede', async () => {
      mockProvider.setOffline(true);

      expect(authService.signIn('admin@gestaopro.com', 'password123')).rejects.toThrow(
        'Sem conexão com a internet para autenticar. Verifique sua rede e tente novamente.'
      );
    });

    it('FirebaseAuthProvider deve mapear auth/network-request-failed corretamente', () => {
      const fbProvider = new FirebaseAuthProvider();
      const mapped = fbProvider._mapAuthError({ code: 'auth/network-request-failed' });
      expect(mapped).toBe('Sem conexão com a internet para autenticar. Verifique sua rede e tente novamente.');
    });
  });

  describe('AUTH-11: Obtenção de ID Token (getIdToken)', () => {
    it('deve retornar token JWT seguro para usuário autenticado e null quando deslogado', async () => {
      expect(await authService.getIdToken()).toBeNull();

      await authService.signIn('admin@gestaopro.com', 'password123');
      const token = await authService.getIdToken();

      expect(token).toBeDefined();
      expect(token).toContain('mock_jwt_token_user_admin_001');

      await authService.signOut();
      expect(await authService.getIdToken()).toBeNull();
    });
  });

  describe('AUTH-12: Leitura de Custom Claims do Token', () => {
    it('deve extrair tenantId e role a partir das claims do ID Token', async () => {
      await authService.signIn('admin@gestaopro.com', 'password123');

      const claims = await authService.getClaims();
      expect(claims).toBeDefined();
      expect(claims.tenantId).toBe('tenant_loja_01');
      expect(claims.role).toBe('admin');
      expect(authService.getTenantId()).toBe('tenant_loja_01');
      expect(authService.getRole()).toBe('admin');
      expect(authService.isAdmin()).toBe(true);
    });
  });

  describe('AUTH-13: Ausência de Custom Claims (Fallback Seguro)', () => {
    it('deve atribuir role "operator" e tenantId nulo por padrão sem elevar privilégios', async () => {
      // Cadastra usuário sem custom claims
      mockProvider.addUser({
        uid: 'user_noclaims_999',
        email: 'simples@gestaopro.com',
        password: 'password123',
        displayName: 'Operador Padrão',
        tenantId: null,
        role: 'operator',
        customClaims: {}
      });

      await authService.signIn('simples@gestaopro.com', 'password123');

      expect(authService.isAuthenticated()).toBe(true);
      expect(authService.getTenantId()).toBeNull();
      expect(authService.getRole()).toBe('operator');
      expect(authService.isAdmin()).toBe(false);
    });
  });

  describe('AUTH-14: Logout em Múltiplas Abas', () => {
    it('deve detectar encerramento de sessão acionado por outra aba e invalidar estado', async () => {
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.isAuthenticated()).toBe(true);

      // Simula logout disparado na Aba B
      mockProvider.simulateMultiTabSignOut();

      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.getCurrentSession()).toBeNull();
      expect(authService.getAuthState()).toBe(AUTH_STATES.UNAUTHENTICATED);
    });
  });

  describe('AUTH-15: Comportamento Offline de Usuário Autenticado', () => {
    it('não deve bloquear acesso local a rotas quando a conexão cai para usuário já autenticado', async () => {
      // 1. Usuário faz login online
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.isAuthenticated()).toBe(true);

      // 2. Conexão com a internet cai
      mockProvider.setOffline(true);

      // 3. Router guard continua autorizando acesso total aos dados locais
      expect(authService.canAccessRoute('dashboard')).toBe(true);
      expect(authService.canAccessRoute('produtos')).toBe(true);
      expect(authService.canAccessRoute('estoque')).toBe(true);
      expect(authService.canAccessRoute('vendas')).toBe(true);
    });
  });

  describe('AUTH-16: Comportamento Offline de Usuário Não Autenticado', () => {
    it('deve bloquear páginas protegidas para usuário não autenticado mesmo offline', async () => {
      mockProvider.setOffline(true);

      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.canAccessRoute('dashboard')).toBe(false);
      expect(authService.canAccessRoute('produtos')).toBe(false);
      expect(authService.canAccessRoute('vendas')).toBe(false);

      // Rota de login permanece sempre acessível
      expect(authService.canAccessRoute('login')).toBe(true);

      // Tentativa de login remoto offline é rejeitada
      expect(authService.signIn('admin@gestaopro.com', 'password123')).rejects.toThrow(
        'Sem conexão com a internet para autenticar.'
      );
    });
  });

  describe('AUTH-17: Route Guard Centralizado', () => {
    it('deve permitir acesso irrestrito à rota de login em qualquer estado', () => {
      expect(authService.canAccessRoute('login')).toBe(true);
    });

    it('deve restringir rotas do sistema para usuários não autenticados', () => {
      expect(authService.isAuthenticated()).toBe(false);
      expect(authService.canAccessRoute('dashboard')).toBe(false);
      expect(authService.canAccessRoute('produtos')).toBe(false);
      expect(authService.canAccessRoute('configuracoes')).toBe(false);
    });

    it('deve liberar todas as rotas após login bem-sucedido', async () => {
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.canAccessRoute('dashboard')).toBe(true);
      expect(authService.canAccessRoute('produtos')).toBe(true);
      expect(authService.canAccessRoute('relatorios')).toBe(true);
      expect(authService.canAccessRoute('vendas')).toBe(true);
    });
  });

  describe('AUTH-18: Preservação de Dados Comerciais Locais após Logout', () => {
    it('logout NÃO deve apagar indevidamente os produtos ou dados comerciais do IndexedDB', async () => {
      // 1. Cadastra produto no IndexedDB local
      const novoProduto = {
        id: 'prod-test-auth-18',
        name: 'Notebook Dell Latitude 5420',
        internalCode: 'NOTE-DELL-5420',
        category: 'Informática',
        salePriceCents: 450000,
        costPriceCents: 320000,
        stockQuantity: 15
      };

      const produtoSalvo = await productRepo.create(novoProduto);
      expect(produtoSalvo.id).toBeDefined();

      // 2. Autentica
      await authService.signIn('admin@gestaopro.com', 'password123');
      expect(authService.isAuthenticated()).toBe(true);

      // 3. Efetua logout
      await authService.signOut();
      expect(authService.isAuthenticated()).toBe(false);

      // 4. Verifica que o dado comercial continua intacto no IndexedDB local
      const produtoRecuperado = await productRepo.findById(produtoSalvo.id);
      expect(produtoRecuperado).toBeDefined();
      expect(produtoRecuperado.name).toBe('Notebook Dell Latitude 5420');
      expect(produtoRecuperado.stockQuantity).toBe(15);
      expect(produtoRecuperado.salePriceCents).toBe(450000);

      const todosProdutos = await productRepo.findAll();
      expect(todosProdutos.length).toBe(1);
    });
  });

  describe('Mapeamento de Erros e Segurança do FirebaseAuthProvider', () => {
    it('deve mapear códigos do Firebase Auth para mensagens amigáveis em português', () => {
      const fbProvider = new FirebaseAuthProvider();

      expect(fbProvider._mapAuthError({ code: 'auth/invalid-credential' })).toBe(
        'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
      expect(fbProvider._mapAuthError({ code: 'auth/wrong-password' })).toBe(
        'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
      expect(fbProvider._mapAuthError({ code: 'auth/user-not-found' })).toBe(
        'E-mail ou senha incorretos. Verifique suas credenciais.'
      );
      expect(fbProvider._mapAuthError({ code: 'auth/invalid-email' })).toBe(
        'O formato do e-mail informado é inválido.'
      );
      expect(fbProvider._mapAuthError({ code: 'auth/user-disabled' })).toBe(
        'Esta conta de usuário foi desativada pelo administrador.'
      );
      expect(fbProvider._mapAuthError({ code: 'auth/too-many-requests' })).toBe(
        'Muitas tentativas sem sucesso. Por segurança, tente novamente em alguns instantes.'
      );
    });

    it('FirebaseAuthProvider._buildSessionModel deve ler claims com segurança sem expor senha', async () => {
      const fbProvider = new FirebaseAuthProvider();
      const mockUser = {
        uid: 'fb_uid_123',
        email: 'gerente@loja.com',
        displayName: 'Gerente da Loja',
        metadata: { lastSignInTime: '2026-10-08T12:00:00Z' },
        getIdTokenResult: async () => ({
          claims: {
            tenantId: 'tenant_filial_2',
            role: 'authenticated',
            appRole: 'admin'
          }
        })
      };

      const session = await fbProvider._buildSessionModel(mockUser);
      expect(session).toBeDefined();
      expect(session.uid).toBe('fb_uid_123');
      expect(session.email).toBe('gerente@loja.com');
      expect(session.tenantId).toBe('tenant_filial_2');
      expect(session.role).toBe('admin');
      expect(session.authenticated).toBe(true);
      expect(session.password).toBeUndefined();
    });
  });
});
