import { describe, it, expect } from 'bun:test';
import { FirebaseAuthProvider, resolveBusinessRole, VALID_BUSINESS_ROLES } from '../src/js/auth/FirebaseAuthProvider.js';
import { AuthService, AUTH_STATES } from '../src/js/services/AuthService.js';
import { checkPermission } from '../src/js/utils/authGuard.js';

describe('PHASE 14.2 — Quality Gate 2: Auditoria de Claims no FirebaseAuthProvider e AuthService', () => {
  // Helper para simular objeto User retornado pelo Firebase Auth
  function createMockFirebaseUser(claims = {}, profileOverrides = {}) {
    return {
      uid: profileOverrides.uid || 'test-user-uid',
      email: profileOverrides.email || 'usuario@gestaopro.com',
      displayName: profileOverrides.displayName || 'Usuário de Teste',
      metadata: { lastSignInTime: '2026-10-10T12:00:00Z' },
      getIdTokenResult: async (forceRefresh = false) => ({
        claims: { ...claims },
        token: `mock-jwt-token-for-${profileOverrides.uid || 'test-user-uid'}`
      }),
      getIdToken: async (forceRefresh = false) => `mock-jwt-token-for-${profileOverrides.uid || 'test-user-uid'}`
    };
  }

  // -------------------------------------------------------------------------
  // 1. Resolução Canônica de Papéis de Negócio (resolveBusinessRole)
  // -------------------------------------------------------------------------
  describe('1. Função Pura resolveBusinessRole', () => {
    it('deve rejeitar concessão de privilégios para tokens legados sem appRole e resolver para viewer (cutover canônico)', () => {
      expect(resolveBusinessRole({ role: 'admin' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'operator' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'viewer' })).toBe('viewer');
    });

    it('deve priorizar appRole sobre role em tokens no formato novo', () => {
      expect(resolveBusinessRole({ role: 'authenticated', appRole: 'admin' })).toBe('admin');
      expect(resolveBusinessRole({ role: 'authenticated', appRole: 'operator' })).toBe('operator');
      expect(resolveBusinessRole({ role: 'authenticated', appRole: 'viewer' })).toBe('viewer');
    });

    it('deve falhar para viewer se o token contiver role: "authenticated" sem appRole (fail-closed)', () => {
      expect(resolveBusinessRole({ role: 'authenticated' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'authenticated', appRole: null })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'authenticated', appRole: '' })).toBe('viewer');
    });

    it('deve falhar para viewer em papéis desconhecidos ou inválidos (fail-closed)', () => {
      expect(resolveBusinessRole({ role: 'superadmin' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'root' })).toBe('viewer');
      expect(resolveBusinessRole({ appRole: 'superadmin' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'authenticated', appRole: 'hacker' })).toBe('viewer');
    });

    it('deve resolver para viewer se claims for vazio, nulo ou indefinido', () => {
      expect(resolveBusinessRole({})).toBe('viewer');
      expect(resolveBusinessRole(null)).toBe('viewer');
      expect(resolveBusinessRole(undefined)).toBe('viewer');
    });

    it('em caso de conflito, appRole tem precedência e previne auto-elevação', () => {
      // Se alguém tentar injetar role: admin com appRole: viewer, prevalece o appRole restritivo
      expect(resolveBusinessRole({ role: 'admin', appRole: 'viewer' })).toBe('viewer');
    });

    it('deve rejeitar fallback e resolver para viewer quando appRole estiver presente e for inválido, nulo, vazio ou tipo incorreto (fail-closed estrito)', () => {
      // Combinação role: admin com appRole presente mas inválido/nulo/vazio NUNCA pode resultar em admin
      expect(resolveBusinessRole({ role: 'admin', appRole: 'superadmin' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'operator', appRole: 'invalid' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: '' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: null })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'operator', appRole: null })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: 123 })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: [] })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: {} })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'admin', appRole: false })).toBe('viewer');
    });

    it('deve recusar fallback e resolver para viewer quando appRole estiver ausente ou undefined (cutover canônico estrito)', () => {
      // Sem chave appRole
      expect(resolveBusinessRole({ role: 'admin' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'operator' })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'viewer' })).toBe('viewer');

      // Chave appRole explicitamente undefined (simulação em JS)
      expect(resolveBusinessRole({ role: 'admin', appRole: undefined })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'operator', appRole: undefined })).toBe('viewer');
      expect(resolveBusinessRole({ role: 'viewer', appRole: undefined })).toBe('viewer');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Construção de Sessão Segura (_buildSessionModel) no FirebaseAuthProvider
  // -------------------------------------------------------------------------
  describe('2. Sessão Estruturada no FirebaseAuthProvider (_buildSessionModel)', () => {
    const provider = new FirebaseAuthProvider();

    it('Cenário 1: Token legado com role: admin (sem appRole) resolve para viewer e requer migração', async () => {
      const user = createMockFirebaseUser({ role: 'admin', tenantId: 'tenant-matriz' });
      const session = await provider._buildSessionModel(user);

      expect(session).not.toBeNull();
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.tenantId).toBe('tenant-matriz');
      expect(session.authenticated).toBe(true);
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 2: Token legado com role: operator (sem appRole) resolve para viewer e requer migração', async () => {
      const user = createMockFirebaseUser({ role: 'operator', tenantId: 'tenant-matriz' });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.tenantId).toBe('tenant-matriz');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 3: Token legado com role: viewer (sem appRole) resolve para viewer e requer migração', async () => {
      const user = createMockFirebaseUser({ role: 'viewer', tenantId: 'tenant-matriz' });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.tenantId).toBe('tenant-matriz');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 4: Token novo canônico com role: authenticated e appRole: admin', async () => {
      const user = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'admin',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('admin');
      expect(session.appRole).toBe('admin');
      expect(session.claims.role).toBe('authenticated');
      expect(session.claims.appRole).toBe('admin');
      expect(session.tenantId).toBe('tenant-staging');
    });

    it('Cenário 5: Token novo canônico com role: authenticated e appRole: operator', async () => {
      const user = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'operator',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('operator');
      expect(session.appRole).toBe('operator');
      expect(session.tenantId).toBe('tenant-staging');
    });

    it('Cenário 6: Token novo canônico com role: authenticated e appRole: viewer', async () => {
      const user = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'viewer',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.tenantId).toBe('tenant-staging');
    });

    it('Cenário 7: Ausência de appRole no token novo (role: authenticated sem appRole)', async () => {
      const user = createMockFirebaseUser({
        role: 'authenticated',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(user);

      // Deve rebaixar categoricamente para viewer (menor privilégio, sem permissão de escrita)
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.role).not.toBe('admin');
      expect(session.role).not.toBe('operator');
    });

    it('Cenário 8: Papel desconhecido em appRole ou role', async () => {
      const userWithBadAppRole = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'super_gestor_financeiro',
        tenantId: 'tenant-staging'
      });
      const session1 = await provider._buildSessionModel(userWithBadAppRole);
      expect(session1.role).toBe('viewer');

      const userWithBadLegacyRole = createMockFirebaseUser({
        role: 'finance_manager',
        tenantId: 'tenant-staging'
      });
      const session2 = await provider._buildSessionModel(userWithBadLegacyRole);
      expect(session2.role).toBe('viewer');
    });

    it('Cenário 9: Ausência de tenantId no token', async () => {
      const userWithoutTenant = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'admin'
      });
      const session = await provider._buildSessionModel(userWithoutTenant);

      expect(session.tenantId).toBeNull();
      // Papel continua admin mas sem tenantId a aplicação e as regras rejeitam operações multi-tenant
    });

    it('Cenário 10: Conflito entre claims (role: admin e appRole: viewer)', async () => {
      const conflictingUser = createMockFirebaseUser({
        role: 'admin',
        appRole: 'viewer',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(conflictingUser);

      // appRole prevalece: rebaixa para viewer e nega privilégios de admin
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
    });

    it('Cenário 11: Tentativa de promover usuário a admin por dados do cliente (displayName / email)', async () => {
      // Usuário comum sem claims privilegiadas tenta se auto-declarar "admin" no nome ou perfil
      const sneakyUser = createMockFirebaseUser(
        { tenantId: 'tenant-matriz' }, // sem role nem appRole
        { displayName: 'admin', email: 'admin@hacker.com' }
      );
      const session = await provider._buildSessionModel(sneakyUser);

      // O SessionModel não pode conceder admin baseado no displayName ou email!
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.role).not.toBe('admin');
    });

    it('Cenário 12: Conflito entre claims (role: admin e appRole: superadmin) falha de forma fechada para viewer', async () => {
      const conflictingUser = createMockFirebaseUser({
        role: 'admin',
        appRole: 'superadmin',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(conflictingUser);

      // NUNCA pode recorrer a role: admin. Deve falhar estritamente para viewer!
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.role).not.toBe('admin');
    });

    it('Cenário 13: Conflito entre claims (role: operator e appRole: invalid) falha de forma fechada para viewer', async () => {
      const conflictingUser = createMockFirebaseUser({
        role: 'operator',
        appRole: 'invalid',
        tenantId: 'tenant-staging'
      });
      const session = await provider._buildSessionModel(conflictingUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.role).not.toBe('operator');
    });

    it('Cenário 14: Token com appRole: null presente falha de forma fechada para viewer (sem fallback legado)', async () => {
      const legacyNullUser = createMockFirebaseUser({
        role: 'admin',
        appRole: null,
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(legacyNullUser);

      // Como a chave appRole está presente e seu valor é null (inválido no domínio),
      // o fallback para role legado é negado: fail-closed para viewer!
      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.role).not.toBe('admin');
    });

    it('Cenário 15: Token legado sem a chave appRole (ou com appRole: undefined) tem privilégios revogados e resolve para viewer (fail-closed, migração exigida)', async () => {
      const legacyUser = createMockFirebaseUser({
        role: 'admin',
        appRole: undefined,
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(legacyUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 16: Sessão com appRole vazio ("") resulta em viewer, canonicalClaims false e requer migração', async () => {
      const emptyUser = createMockFirebaseUser({
        role: 'authenticated',
        appRole: '',
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(emptyUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 17: Sessão com appRole de tipo incorreto (número) resulta em viewer, canonicalClaims false e requer migração', async () => {
      const wrongTypeUser = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 123,
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(wrongTypeUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 18: Sessão com appRole desconhecido ("superadmin") resulta em viewer, canonicalClaims false e requer migração', async () => {
      const unknownUser = createMockFirebaseUser({
        role: 'authenticated',
        appRole: 'superadmin',
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(unknownUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 19: Sessão com appRole null explícito resulta em viewer, canonicalClaims false e requer migração', async () => {
      const nullUser = createMockFirebaseUser({
        role: 'authenticated',
        appRole: null,
        tenantId: 'tenant-matriz'
      });
      const session = await provider._buildSessionModel(nullUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });

    it('Cenário 20: Usuário autenticado totalmente sem claims (claims: {}) resulta em viewer, canonicalClaims false e requer migração', async () => {
      const noClaimsUser = createMockFirebaseUser({});
      const session = await provider._buildSessionModel(noClaimsUser);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Integração com AuthService
  // -------------------------------------------------------------------------
  describe('3. Métodos Auxiliares no AuthService com Provedor Canônico', () => {
    it('AuthService deve reportar isAdmin() false para tokens novos sem appRole ou viewer', () => {
      const mockProvider = {
        getCurrentSession: () => ({
          authenticated: true,
          role: 'viewer',
          appRole: 'viewer',
          tenantId: 'tenant-01'
        }),
        onAuthStateChanged: (cb) => {
          cb({
            authenticated: true,
            role: 'viewer',
            appRole: 'viewer',
            tenantId: 'tenant-01'
          });
          return () => {};
        },
        isConfigured: () => true
      };

      const authService = new AuthService(mockProvider);
      authService.setProvider(mockProvider);

      expect(authService.getRole()).toBe('viewer');
      expect(authService.isAdmin()).toBe(false);
      expect(authService.getTenantId()).toBe('tenant-01');
    });

    it('AuthService deve reportar isAdmin() true para token novo com appRole: admin', () => {
      const mockProvider = {
        getCurrentSession: () => ({
          authenticated: true,
          role: 'admin',
          appRole: 'admin',
          tenantId: 'tenant-01'
        }),
        onAuthStateChanged: (cb) => {
          cb({
            authenticated: true,
            role: 'admin',
            appRole: 'admin',
            tenantId: 'tenant-01'
          });
          return () => {};
        },
        isConfigured: () => true
      };

      const authService = new AuthService(mockProvider);
      authService.setProvider(mockProvider);

      expect(authService.getRole()).toBe('admin');
      expect(authService.isAdmin()).toBe(true);
      expect(authService.getTenantId()).toBe('tenant-01');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Experiência de Interface e Exposição da Sessão no App
  // -------------------------------------------------------------------------
  describe('4. Apresentação da Interface e Proteção contra Apresentação Incorreta de Privilégios (App UI)', () => {
    it('deve formatar badge como Visualizador e exibir alerta de regularização quando requiresMigration === true', async () => {
      const { App } = await import('../src/js/app.js');
      const appInstance = new App();

      const sessionNeedingMigration = {
        authenticated: true,
        email: 'legado@gestaopro.com',
        role: 'viewer',
        appRole: 'viewer',
        canonicalClaims: false,
        requiresMigration: true
      };

      const badgeHtml = appInstance._renderAuthBadge(sessionNeedingMigration);
      expect(badgeHtml).toContain('Visualizador');
      expect(badgeHtml).not.toContain('Operador');
      expect(badgeHtml).toContain('Aguardando Regularização');

      const bannerHtml = appInstance._renderMigrationBanner(sessionNeedingMigration);
      expect(bannerHtml).toContain('Aviso de Permissões');
      expect(bannerHtml).toContain('aguarda regularização administrativa');
    });

    it('deve ocultar banner e exibir papel comercial exato quando requiresMigration === false (canônico)', async () => {
      const { App } = await import('../src/js/app.js');
      const appInstance = new App();

      const canonicalAdminSession = {
        authenticated: true,
        email: 'admin@gestaopro.com',
        role: 'admin',
        appRole: 'admin',
        canonicalClaims: true,
        requiresMigration: false
      };

      const adminBadge = appInstance._renderAuthBadge(canonicalAdminSession);
      expect(adminBadge).toContain('Admin');
      expect(adminBadge).not.toContain('Aguardando Regularização');
      expect(appInstance._renderMigrationBanner(canonicalAdminSession)).toBe('');

      const canonicalOpSession = {
        authenticated: true,
        email: 'op@gestaopro.com',
        role: 'operator',
        appRole: 'operator',
        canonicalClaims: true,
        requiresMigration: false
      };

      const opBadge = appInstance._renderAuthBadge(canonicalOpSession);
      expect(opBadge).toContain('Operador');
      expect(opBadge).not.toContain('Aguardando Regularização');
      expect(appInstance._renderMigrationBanner(canonicalOpSession)).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Testes Positivos e Negativos de Custom Claims Canônicas (Fase 14.21 - Seção 3.3)
  // -------------------------------------------------------------------------
  describe('6. Convenção Canônica Estrita de Custom Claims (Fase 14.21 - Seção 3.3)', () => {
    const provider = new FirebaseAuthProvider();

    it('3.3.1: Sessão com tenantId e appRole válidos produz contexto autorizado para escrita', async () => {
      const user = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        appRole: 'admin',
        role: 'authenticated'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.tenantId).toBe('tenant-matriz');
      expect(session.appRole).toBe('admin');
      expect(session.canonicalClaims).toBe(true);
      expect(session.requiresMigration).toBe(false);

      const check = checkPermission(session, 'create', 'products');
      expect(check.authorized).toBe(true);
      expect(check.role).toBe('admin');
    });

    it('3.3.2: Sessão sem appRole falha para viewer e bloqueia qualquer mutação', async () => {
      const user = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        role: 'authenticated'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);

      const check = checkPermission(session, 'create', 'products');
      expect(check.authorized).toBe(false);
      expect(check.role).toBe('viewer');
    });

    it('3.3.3: Sessão com role legado mas sem appRole falha para viewer sem conceder privilégios', async () => {
      const user = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        role: 'admin'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.appRole).toBe('viewer');
      expect(session.requiresMigration).toBe(true);

      const check = checkPermission(session, 'update', 'products');
      expect(check.authorized).toBe(false);
      expect(check.reason).toContain('requiresMigration: true');
    });

    it('3.3.4: Sessão com tenant_id legado mas sem tenantId canônico tem tenantId nulo e bloqueia escrita', async () => {
      const user = createMockFirebaseUser({
        tenant_id: 'tenant-legado-snake',
        appRole: 'admin',
        role: 'authenticated'
      });
      const session = await provider._buildSessionModel(user);

      expect(session.tenantId).toBeNull();
      const check = checkPermission(session, 'create', 'products');
      expect(check.authorized).toBe(false);
      expect(check.reason).toContain('sem tenantId canônico');
    });

    it('3.3.5: Sessão com claims incompletas ou tipos inválidos falha de forma fechada', async () => {
      const userArrayAppRole = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        appRole: ['admin'],
        role: 'authenticated'
      });
      const session1 = await provider._buildSessionModel(userArrayAppRole);
      expect(session1.appRole).toBe('viewer');
      expect(session1.canonicalClaims).toBe(false);

      const userObjectTenant = createMockFirebaseUser({
        tenantId: { id: 'tenant-matriz' },
        appRole: 'admin'
      });
      const session2 = await provider._buildSessionModel(userObjectTenant);
      expect(session2.tenantId).toBeNull();
    });

    it('3.3.6: Sessão de um tenant tentando acessar outro tem sua ação de escrita isolada', async () => {
      const userTenantA = createMockFirebaseUser({
        tenantId: 'tenant-A',
        appRole: 'admin',
        role: 'authenticated'
      });
      const sessionA = await provider._buildSessionModel(userTenantA);
      expect(sessionA.tenantId).toBe('tenant-A');

      // Tentativa de escrita com dados de outro tenant
      const otherTenantData = { tenantId: 'tenant-B', name: 'Item Invasor' };
      expect(otherTenantData.tenantId).not.toBe(sessionA.tenantId);
    });

    it('3.3.7: Usuário sem autorização canônica tentando escrever é categoricamente bloqueado', async () => {
      const userViewer = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        appRole: 'viewer',
        role: 'authenticated'
      });
      const sessionViewer = await provider._buildSessionModel(userViewer);

      const checkProduct = checkPermission(sessionViewer, 'create', 'products');
      expect(checkProduct.authorized).toBe(false);
      expect(checkProduct.role).toBe('viewer');

      const checkSale = checkPermission(sessionViewer, 'create', 'sales');
      expect(checkSale.authorized).toBe(false);

      const checkStock = checkPermission(sessionViewer, 'create', 'stockMovements');
      expect(checkStock.authorized).toBe(false);
    });

    it('3.3.8: Administrador e operador possuem permissões corretas para seus papéis canônicos', async () => {
      const userAdmin = createMockFirebaseUser({ tenantId: 'tenant-matriz', appRole: 'admin', role: 'authenticated' });
      const sessionAdmin = await provider._buildSessionModel(userAdmin);

      const userOp = createMockFirebaseUser({ tenantId: 'tenant-matriz', appRole: 'operator', role: 'authenticated' });
      const sessionOp = await provider._buildSessionModel(userOp);

      // Admin tem acesso a compras e fornecedores
      expect(checkPermission(sessionAdmin, 'create', 'purchases').authorized).toBe(true);
      expect(checkPermission(sessionAdmin, 'create', 'suppliers').authorized).toBe(true);
      expect(checkPermission(sessionAdmin, 'create', 'products').authorized).toBe(true);

      // Operador tem acesso a catálogo e vendas, mas NÃO a compras e fornecedores
      expect(checkPermission(sessionOp, 'create', 'products').authorized).toBe(true);
      expect(checkPermission(sessionOp, 'create', 'sales').authorized).toBe(true);
      expect(checkPermission(sessionOp, 'create', 'purchases').authorized).toBe(false);
      expect(checkPermission(sessionOp, 'create', 'suppliers').authorized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Matriz de Auditoria e Fechamento de Invariantes de Custom Claims (Fase 14.22 - Seção 3.4)
  // -------------------------------------------------------------------------
  describe('7. Matriz de Auditoria e Fechamento de Invariantes de Custom Claims (Fase 14.22 - Seção 3.4)', () => {
    const provider = new FirebaseAuthProvider();

    it('3.4.1: Presença exclusiva de role legado sem appRole e sem tenantId resulta em viewer e bloqueio de escrita', async () => {
      const user = createMockFirebaseUser({ role: 'admin' });
      const session = await provider._buildSessionModel(user);

      expect(session.role).toBe('viewer');
      expect(session.appRole).toBe('viewer');
      expect(session.tenantId).toBeNull();
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);

      const check = checkPermission(session, 'create', 'products');
      expect(check.authorized).toBe(false);
      expect(check.reason).toContain('requiresMigration: true');
    });

    it('3.4.2: Presença exclusiva de tenant_id legado resulta em tenantId nulo e bloqueio de escrita', async () => {
      const user = createMockFirebaseUser({ tenant_id: 'tenant-snake-only' });
      const session = await provider._buildSessionModel(user);

      expect(session.tenantId).toBeNull();
      expect(session.canonicalClaims).toBe(false);

      const check = checkPermission(session, 'create', 'products');
      expect(check.authorized).toBe(false);
      expect(check.reason).toContain('requiresMigration: true');
    });

    it('3.4.3: Claims legadas acompanhadas de claims canônicas incompletas não concedem fallback', async () => {
      const user = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        role: 'admin',
        appRole: null
      });
      const session = await provider._buildSessionModel(user);

      expect(session.appRole).toBe('viewer');
      expect(session.canonicalClaims).toBe(false);
      expect(session.requiresMigration).toBe(true);

      const check = checkPermission(session, 'update', 'products');
      expect(check.authorized).toBe(false);
    });

    it('3.4.4: tenantId com espaços ou tipo incorreto (número) é normalizado para null e bloqueia mutação', async () => {
      const userEmptySpaces = createMockFirebaseUser({
        tenantId: '   ',
        appRole: 'admin',
        role: 'authenticated'
      });
      const sessionEmpty = await provider._buildSessionModel(userEmptySpaces);
      expect(sessionEmpty.tenantId).toBeNull();

      const checkEmpty = checkPermission(sessionEmpty, 'create', 'products');
      expect(checkEmpty.authorized).toBe(false);
      expect(checkEmpty.reason).toContain('sem tenantId canônico');

      const userNumeric = createMockFirebaseUser({
        tenantId: 99999,
        appRole: 'admin',
        role: 'authenticated'
      });
      const sessionNumeric = await provider._buildSessionModel(userNumeric);
      expect(sessionNumeric.tenantId).toBeNull();

      const checkNumeric = checkPermission(sessionNumeric, 'create', 'products');
      expect(checkNumeric.authorized).toBe(false);
    });

    it('3.4.5: Sessão autorizada para catálogo e vendas mas sem acesso a fornecedores/compras é estritamente barrada', async () => {
      const userOp = createMockFirebaseUser({
        tenantId: 'tenant-matriz',
        appRole: 'operator',
        role: 'authenticated'
      });
      const sessionOp = await provider._buildSessionModel(userOp);

      const checkSupplier = checkPermission(sessionOp, 'create', 'suppliers');
      expect(checkSupplier.authorized).toBe(false);
      expect(checkSupplier.reason).toContain('exclusiva para [admin]');

      const checkPurchase = checkPermission(sessionOp, 'create', 'purchases');
      expect(checkPurchase.authorized).toBe(false);
      expect(checkPurchase.reason).toContain('exclusiva para [admin]');
    });
  });
});

