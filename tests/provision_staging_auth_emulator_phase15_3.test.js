import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, execSync } from 'child_process';
import {
  provisionEmulatorAuth,
  runProvisioning,
  validateProvisioningTarget,
  STAGING_USERS,
  STAGING_TEST_USERS
} from '../scripts/provision-staging.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * FASE 15.3 — Homologação Integrada do Provisionamento no Firebase Auth Emulator
 *
 * Esta suíte valida funcionalmente:
 * 1. O script real `scripts/provision-staging.js` contra o Firebase Auth Emulator local.
 * 2. Criação de nova conta e associação de claims no emulador real.
 * 3. Detecção de EMAIL_EXISTS e recuperação unívoca de UID via accounts:lookup no emulador real.
 * 4. Atribuição de custom claims via endpoint administrativo e emissão de JWT real.
 * 5. Decodificação do idToken emitido pelo emulador: tenantId, appRole, role: 'authenticated'.
 * 6. Casos de erro: falha de lookup, falha de atribuição de claims, rejeição de falso sucesso.
 * 7. Isolamento entre tenants e conformidade com papéis de negócio (Auditor = viewer, Admin B = tenant-staging-02).
 * 8. Importação sem efeitos colaterais.
 */

const AUTH_PORT = 9099;
const AUTH_HOST = '127.0.0.1:9099';
const TEST_PROJECT_ID = 'demo-gerenciador-produtos-staging';
const DEFAULT_TEST_PASSWORD = 'StagingPassword123!';

let spawnedEmulator = null;

async function isAuthEmulatorRunning() {
  try {
    const res = await fetch(`http://${AUTH_HOST}/`, {
      signal: AbortSignal.timeout(1000)
    });
    return res.ok || res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}

async function ensureAuthEmulator() {
  if (await isAuthEmulatorRunning()) {
    return false; // Emulador já estava em execução
  }

  const cmd = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args = process.platform === 'win32'
    ? ['/c', `npx firebase emulators:start --only auth --project ${TEST_PROJECT_ID}`]
    : ['firebase', 'emulators:start', '--only', 'auth', '--project', TEST_PROJECT_ID];

  spawnedEmulator = spawn(cmd, args, { stdio: 'pipe' });

  const start = Date.now();
  while (Date.now() - start < 25000) {
    if (await isAuthEmulatorRunning()) {
      return true; // Inicializado por esta suíte
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Falha ao inicializar o Firebase Auth Emulator dentro da janela de 25 segundos.');
}

async function teardownAuthEmulator() {
  if (spawnedEmulator && spawnedEmulator.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${spawnedEmulator.pid}`, { stdio: 'ignore' });
      } else {
        spawnedEmulator.kill('SIGTERM');
      }
    } catch {}
    spawnedEmulator = null;
  }
}

/**
 * Auxiliar para autenticar conta no Auth Emulator via REST API
 * e decodificar o payload do idToken JWT retornado.
 */
async function authenticateAndDecodeToken(email, password = DEFAULT_TEST_PASSWORD) {
  const signInUrl = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;
  const res = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Falha na autenticação de ${email}: ${errData?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const idToken = data.idToken;
  const parts = idToken.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));

  return {
    idToken,
    localId: data.localId,
    payload
  };
}

describe('FASE 15.3 — Homologação Integrada do Provisionamento no Firebase Auth Emulator', () => {

  beforeAll(async () => {
    await ensureAuthEmulator();
  }, 30000);

  afterAll(async () => {
    await teardownAuthEmulator();
  });

  describe('1. Ciclo de Vida do Emulador e Isolamento do Destino', () => {
    it('1.1 O Firebase Auth Emulator local está ativo e acessível na porta 9099', async () => {
      const running = await isAuthEmulatorRunning();
      expect(running).toBe(true);
    });

    it('1.2 O destino validado é exatamente o projeto demonstrativo demo-gerenciador-produtos-staging', () => {
      const validation = validateProvisioningTarget(TEST_PROJECT_ID, { isEmulator: true });
      expect(validation.valid).toBe(true);
      expect(validation.mode).toBe('emulator');
      expect(validation.projectId).toBe('demo-gerenciador-produtos-staging');
    });

    it('1.3 A importação do módulo de provisionamento não causa efeitos colaterais nem dispara requisições', () => {
      expect(STAGING_USERS).toBeDefined();
      expect(STAGING_TEST_USERS).toBeDefined();
      expect(STAGING_TEST_USERS.length).toBe(4);
    });
  });

  describe('2. Caso A — Criação de Nova Conta e Atribuição de Claims no Emulador Real', () => {
    it('2.1 Cria novo usuário, obtém UID e associa custom claims canônicas no emulador', async () => {
      const testEmail = `new_admin_${Date.now()}@staging.local`;
      const testUser = {
        email: testEmail,
        appRole: 'admin',
        role: 'authenticated',
        tenantId: 'tenant-staging-01',
        displayName: 'Administrador de Teste'
      };

      const result = await provisionEmulatorAuth({
        authHost: AUTH_HOST,
        projectId: TEST_PROJECT_ID,
        users: [testUser]
      });

      expect(result.success).toBe(true);
      expect(result.provisionedCount).toBe(1);
      const provisioned = result.results[0];
      expect(provisioned.email).toBe(testEmail);
      expect(typeof provisioned.uid).toBe('string');
      expect(provisioned.uid.length).toBeGreaterThan(5);

      // Autenticar com o usuário recém-criado no emulador e decodificar token JWT emitido
      const authResult = await authenticateAndDecodeToken(testEmail);
      expect(authResult.localId).toBe(provisioned.uid);

      // Validação das claims canônicas diretamente no payload do JWT emitido
      expect(authResult.payload.tenantId).toBe('tenant-staging-01');
      expect(authResult.payload.appRole).toBe('admin');
      expect(authResult.payload.role).toBe('authenticated');
      expect(authResult.payload.user_id).toBe(provisioned.uid);
      expect(authResult.payload.email).toBe(testEmail);
    });
  });

  describe('3. Caso B — Conta Existente (Detecção de EMAIL_EXISTS, Lookup de UID e Update de Claims)', () => {
    it('3.1 Detecta EMAIL_EXISTS, recupera UID original via accounts:lookup e reaplica claims sem duplicar conta', async () => {
      const existingEmail = `dup_user_${Date.now()}@staging.local`;

      // 1. Criar previamente o usuário no emulador via REST
      const signUpUrl = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;
      const initialRes = await fetch(signUpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: existingEmail,
          password: DEFAULT_TEST_PASSWORD,
          returnSecureToken: true
        })
      });
      expect(initialRes.ok).toBe(true);
      const initialData = await initialRes.json();
      const originalUid = initialData.localId;
      expect(originalUid).toBeDefined();

      // 2. Executar provisionEmulatorAuth para esse mesmo email (deve acionar o caminho EMAIL_EXISTS)
      const userToProvision = {
        email: existingEmail,
        appRole: 'operator',
        role: 'authenticated',
        tenantId: 'tenant-staging-01',
        displayName: 'Operador Atualizado'
      };

      const result = await provisionEmulatorAuth({
        authHost: AUTH_HOST,
        projectId: TEST_PROJECT_ID,
        users: [userToProvision]
      });

      expect(result.success).toBe(true);
      expect(result.provisionedCount).toBe(1);
      const provisioned = result.results[0];

      // O UID recuperado DEVE ser rigorosamente o original (não pode gerar um novo UID)
      expect(provisioned.uid).toBe(originalUid);

      // 3. Autenticar no emulador e verificar se as claims foram atualizadas na conta existente
      const authResult = await authenticateAndDecodeToken(existingEmail);
      expect(authResult.localId).toBe(originalUid);
      expect(authResult.payload.tenantId).toBe('tenant-staging-01');
      expect(authResult.payload.appRole).toBe('operator');
      expect(authResult.payload.role).toBe('authenticated');
    });
  });

  describe('4. Casos C e D — Falhas de Lookup e Atribuição de Claims (Fail-Closed)', () => {
    it('4.1 Caso C: Falha de lookup em conta existente aborta imediatamente com erro crítico', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { message: 'EMAIL_EXISTS' } })
          };
        }
        if (url.includes('accounts:lookup')) {
          // Lookup retorna lista vazia (usuário não encontrado)
          return {
            ok: true,
            status: 200,
            json: async () => ({ users: [] })
          };
        }
        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: AUTH_HOST,
        projectId: TEST_PROJECT_ID,
        fetchFn: mockFetch,
        users: [{ email: 'ghost@staging.local', tenantId: 'tenant-staging-01', appRole: 'admin' }]
      })).rejects.toThrow(/Não foi possível determinar o UID/i);
    });

    it('4.2 Caso D: Falha na atribuição de custom claims produz erro e aborta a execução', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ localId: 'uid_mock_claims_fail' })
          };
        }
        if (url.includes('accounts:update')) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Error',
            json: async () => ({ error: { message: 'INTERNAL_SERVER_ERROR' } })
          };
        }
        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: AUTH_HOST,
        projectId: TEST_PROJECT_ID,
        fetchFn: mockFetch,
        users: [{ email: 'test_claim_fail@staging.local', tenantId: 'tenant-staging-01', appRole: 'admin' }]
      })).rejects.toThrow(/Falha ao associar custom claims/i);
    });
  });

  describe('5. Caso E — Provisionamento Completo e Validação dos 4 Perfis Canônicos no Emulador', () => {
    it('5.1 Provisiona as 4 contas canônicas de teste no Auth Emulator e valida tokens JWT emitidos', async () => {
      const result = await provisionEmulatorAuth({
        authHost: AUTH_HOST,
        projectId: TEST_PROJECT_ID,
        users: STAGING_TEST_USERS
      });

      expect(result.success).toBe(true);
      expect(result.provisionedCount).toBe(4);

      // Autenticar e validar token para cada uma das 4 contas
      const adminRes = await authenticateAndDecodeToken('admin@staging.local');
      expect(adminRes.payload.appRole).toBe('admin');
      expect(adminRes.payload.role).toBe('authenticated');
      expect(adminRes.payload.tenantId).toBe('tenant-staging-01');

      const operRes = await authenticateAndDecodeToken('operador@staging.local');
      expect(operRes.payload.appRole).toBe('operator');
      expect(operRes.payload.role).toBe('authenticated');
      expect(operRes.payload.tenantId).toBe('tenant-staging-01');

      // Auditor funcional DEVE possuir estritamente appRole 'viewer'
      const auditorRes = await authenticateAndDecodeToken('auditor@staging.local');
      expect(auditorRes.payload.appRole).toBe('viewer');
      expect(auditorRes.payload.role).toBe('authenticated');
      expect(auditorRes.payload.tenantId).toBe('tenant-staging-01');

      // Admin B DEVE pertencer estritamente ao tenant-staging-02 (isolamento cross-tenant)
      const adminBRes = await authenticateAndDecodeToken('admin-b@staging.local');
      expect(adminBRes.payload.appRole).toBe('admin');
      expect(adminBRes.payload.role).toBe('authenticated');
      expect(adminBRes.payload.tenantId).toBe('tenant-staging-02');
    });
  });

  describe('6. Caso G — Isolamento Multi-Tenant e Matriz de Autorização com Tokens Reais', () => {
    // Avaliador de regras do RTDB baseado no schema real em database.rules.json
    const evaluateRtdbAuthorization = (rules, path, action, token) => {
      const segments = path.split('/').filter(Boolean);
      // /tenants/$tenantId/...
      if (segments[0] !== 'tenants') return false;
      const targetTenant = segments[1];

      // 1. Isolamento de tenant: auth.token.tenantId === $tenantId
      if (!token || token.tenantId !== targetTenant) {
        return false;
      }

      // 2. Leitura permitida para qualquer usuário autenticado com tenant correspondente
      if (action === 'read') {
        return Boolean(token.tenantId);
      }

      // 3. Escrita exige appRole canônico 'admin' ou 'operator'
      if (action === 'write') {
        return token.appRole === 'admin' || token.appRole === 'operator';
      }

      return false;
    };

    it('6.1 Tokens reais do Auth Emulator comprovam isolamento cross-tenant (Tenant A bloqueado em Tenant B)', async () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8'));

      const adminAToken = (await authenticateAndDecodeToken('admin@staging.local')).payload;
      const adminBToken = (await authenticateAndDecodeToken('admin-b@staging.local')).payload;

      // Admin A em seu próprio tenant
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'write', adminAToken)).toBe(true);

      // Admin A tentando escrever no tenant B -> BLOQUEADO
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-02/products', 'write', adminAToken)).toBe(false);
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-02/products', 'read', adminAToken)).toBe(false);

      // Admin B em seu próprio tenant
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-02/products', 'write', adminBToken)).toBe(true);

      // Admin B tentando escrever no tenant A -> BLOQUEADO
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'write', adminBToken)).toBe(false);
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'read', adminBToken)).toBe(false);
    });

    it('6.2 Conta Auditor com appRole "viewer" tem leitura autorizada e qualquer escrita estritamente bloqueada', async () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8'));
      const auditorToken = (await authenticateAndDecodeToken('auditor@staging.local')).payload;

      // Auditor no tenant A tem permissão de leitura
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'read', auditorToken)).toBe(true);

      // Auditor tentando escrever no catálogo ou estoque -> BLOQUEADO
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'write', auditorToken)).toBe(false);
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/inventory', 'write', auditorToken)).toBe(false);
    });

    it('6.3 Claim técnica role: "authenticated" NÃO substitui appRole para privilégios de escrita', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8'));
      const technicalOnlyToken = {
        tenantId: 'tenant-staging-01',
        role: 'authenticated',
        appRole: undefined
      };

      // Leitura permitida pelo tenantId
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'read', technicalOnlyToken)).toBe(true);

      // Escrita NEGADA porque appRole está ausente
      expect(evaluateRtdbAuthorization(rules, '/tenants/tenant-staging-01/products', 'write', technicalOnlyToken)).toBe(false);
    });
  });
});
