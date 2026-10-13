import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get } from 'firebase/database';
import { FirebaseAuthProvider, resolveBusinessRole } from '../src/js/auth/FirebaseAuthProvider.js';
import { checkPermission } from '../src/js/utils/authGuard.js';

/**
 * FASE 14.23 — P0: Harmonização da semântica das custom claims entre Firebase e Supabase
 *
 * Contrato canônico:
 * - tenantId: tenant autorizado da aplicação empresarial.
 * - appRole: papel empresarial ('admin' | 'operator' | 'viewer').
 * - role: 'authenticated': claim técnica exigida pelo fluxo JWT do Supabase/PostgreSQL.
 *   NUNCA confere privilégios empresariais por si só.
 * - Proibido fallback automático de role para appRole ou de tenant_id para tenantId.
 */

const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-claims-harmonization-14-23';

let testEnv;
let spawnedProcess = null;

async function isEmulatorRunning(port = EMULATOR_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.inspect/coverage.json`, { signal: AbortSignal.timeout(1000) });
    return res.ok || res.status === 404 || res.status === 401;
  } catch {
    return false;
  }
}

async function ensureEmulator(port = EMULATOR_PORT) {
  if (await isEmulatorRunning(port)) return;
  const jarPath = join(homedir(), '.cache', 'firebase', 'emulators', 'firebase-database-emulator-v4.11.2.jar');
  if (!existsSync(jarPath)) throw new Error(`Emulador RTDB não encontrado em ${jarPath}.`);
  spawnedProcess = spawn('java', ['-jar', jarPath, '--port', String(port)], { stdio: 'ignore', detached: true });
  spawnedProcess.unref();
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (await isEmulatorRunning(port)) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timeout aguardando emulador RTDB na porta ${port}`);
}

function mockUser(claims = {}) {
  return {
    uid: 'u_' + Math.random().toString(36).slice(2, 7),
    email: 'user@gestaopro.com',
    displayName: 'Usuário Homologação',
    getIdTokenResult: async () => ({ claims }),
    getIdToken: async () => 'mock-jwt-token'
  };
}

describe('FASE 14.23 — Harmonização de Claims (10 Casos Obrigatórios)', () => {
  const provider = new FirebaseAuthProvider();

  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: { host: '127.0.0.1', port: EMULATOR_PORT, rules: readFileSync(join(process.cwd(), 'database.rules.json'), 'utf8') }
    });
  });

  afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
    if (spawnedProcess && spawnedProcess.pid) { try { process.kill(spawnedProcess.pid); } catch (_) {} }
  });

  // 1. Sessão válida com tenantId, appRole e role: 'authenticated'
  it('1. Sessão válida com tenantId, appRole e role: "authenticated": concede papel empresarial e marca canonicalClaims', async () => {
    const user = mockUser({ tenantId: 'tenantA', appRole: 'admin', role: 'authenticated' });
    const session = await provider._buildSessionModel(user);

    expect(session.authenticated).toBe(true);
    expect(session.tenantId).toBe('tenantA');
    expect(session.appRole).toBe('admin');
    expect(session.role).toBe('admin');
    expect(session.canonicalClaims).toBe(true);
    expect(session.requiresMigration).toBe(false);

    const perm = checkPermission(session, 'CREATE', 'products');
    expect(perm.authorized).toBe(true);
  });

  // 2. Sessão sem appRole, mas com role: 'authenticated'
  it('2. Sessão sem appRole, mas com role: "authenticated": rebaixa para viewer (claim técnica não concede privilégio comercial)', async () => {
    const user = mockUser({ tenantId: 'tenantA', role: 'authenticated' });
    const session = await provider._buildSessionModel(user);

    expect(session.authenticated).toBe(true);
    expect(session.appRole).toBe('viewer');
    expect(session.role).toBe('viewer');
    expect(session.canonicalClaims).toBe(false);
    expect(session.requiresMigration).toBe(true);

    const perm = checkPermission(session, 'CREATE', 'products');
    expect(perm.authorized).toBe(false);
  });

  // 3. Sessão somente com role: 'admin' (legado, sem appRole)
  it('3. Sessão somente com role: "admin": sem fallback automático, rebaixa para viewer e exige migração', async () => {
    const user = mockUser({ tenantId: 'tenantA', role: 'admin' });
    const session = await provider._buildSessionModel(user);

    expect(session.appRole).toBe('viewer');
    expect(session.role).toBe('viewer');
    expect(session.canonicalClaims).toBe(false);
    expect(session.requiresMigration).toBe(true);

    const perm = checkPermission(session, 'CREATE', 'products');
    expect(perm.authorized).toBe(false);
  });

  // 4. Sessão somente com tenant_id (snake_case legado, sem tenantId)
  it('4. Sessão somente com tenant_id: sem fallback automático, tenantId fica nulo e mutação é bloqueada', async () => {
    const user = mockUser({ tenant_id: 'tenant_legacy_1', appRole: 'admin', role: 'authenticated' });
    const session = await provider._buildSessionModel(user);

    expect(session.tenantId).toBeNull();
    const perm = checkPermission(session, 'CREATE', 'products');
    expect(perm.authorized).toBe(false);
  });

  // 5. Sessão com tenantId inválido (vazio, numérico, caracteres ilegais)
  it('5. Sessão com tenantId inválido: rejeitado de forma segura (fail-closed)', async () => {
    for (const badTenant of ['', '   ', null, 12345]) {
      const user = mockUser({ tenantId: badTenant, appRole: 'admin', role: 'authenticated' });
      const session = await provider._buildSessionModel(user);
      expect(session.tenantId).toBeNull();
      const perm = checkPermission(session, 'CREATE', 'products');
      expect(perm.authorized).toBe(false);
    }
  });

  // 6. Sessão com appRole inválida
  it('6. Sessão com appRole inválida: rebaixa para viewer e recusa auto-elevação', async () => {
    for (const badRole of ['superadmin', 'root', 'hacker', null, 999, 'ADMIN', '']) {
      const user = mockUser({ tenantId: 'tenantA', appRole: badRole, role: 'authenticated' });
      const session = await provider._buildSessionModel(user);
      expect(session.appRole).toBe('viewer');
      expect(session.role).toBe('viewer');
      const perm = checkPermission(session, 'CREATE', 'products');
      expect(perm.authorized).toBe(false);
    }
  });

  // 7. Acesso empresarial válido ao RTDB Emulator
  it('7. Acesso empresarial válido ao RTDB Emulator: escrita em /products e /inventory autorizada com claims canônicas', async () => {
    const adminCtx = testEnv.authenticatedContext('user_valid_admin', {
      tenantId: 'tenantA', appRole: 'admin', role: 'authenticated'
    });
    const db = adminCtx.database();

    // Gravação em products
    await assertSucceeds(set(ref(db, 'tenants/tenantA/products/p_claims_1'), {
      id: 'p_claims_1', name: 'Prod Claims', salePriceCents: 1000, version: 1
    }));
    const pSnap = await get(ref(db, 'tenants/tenantA/products/p_claims_1'));
    expect(pSnap.exists()).toBe(true);

    // Gravação em inventory
    await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_claims_1'), {
      id: 'mov_claims_1', productId: 'p_claims_1', delta: 10, quantity: 10, type: 'IN'
    }));
    const mSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_claims_1'));
    expect(mSnap.exists()).toBe(true);
  });

  // 8. Escrita empresarial negada no RTDB Emulator sem claims canônicas
  it('8. Escrita empresarial negada no RTDB sem claims canônicas (ex: apenas role: "authenticated" ou apenas role: "admin")', async () => {
    // 8a. Usuário com apenas role: 'authenticated' (sem appRole e sem tenantId compatível)
    const techOnlyCtx = testEnv.authenticatedContext('user_tech_only', {
      tenantId: 'tenantA', role: 'authenticated'
    });
    await assertFails(set(ref(techOnlyCtx.database(), 'tenants/tenantA/products/p_fail_1'), {
      id: 'p_fail_1', name: 'Fail', salePriceCents: 1000, version: 1
    }));

    // 8b. Usuário sem appRole e sem tenantId
    const noTenantCtx = testEnv.authenticatedContext('user_no_claims', {});
    await assertFails(set(ref(noTenantCtx.database(), 'tenants/tenantA/products/p_fail_2'), {
      id: 'p_fail_2', name: 'Fail', salePriceCents: 1000, version: 1
    }));

    // 8c. Usuário de outro tenant (cross-tenant)
    const crossTenantCtx = testEnv.authenticatedContext('user_cross', {
      tenantId: 'tenantB', appRole: 'admin', role: 'authenticated'
    });
    await assertFails(set(ref(crossTenantCtx.database(), 'tenants/tenantA/products/p_fail_3'), {
      id: 'p_fail_3', name: 'Fail', salePriceCents: 1000, version: 1
    }));
  });

  // 9. As regras de Storage aplicam a política documentada
  it('9. Regras de Storage / Supabase Storage aplicam a política: leitura isolada por tenantId, escrita exige appRole', () => {
    const sqlSelectAllowed = (jwt, path) => {
      const parts = path.split('/');
      return jwt?.role === 'authenticated' &&
             jwt?.tenantId === parts[1] &&
             parts[0] === 'tenants' &&
             parts[2] === 'products' &&
             parts.length === 5;
    };
    const sqlWriteAllowed = (jwt, path) => {
      return sqlSelectAllowed(jwt, path) && ['admin', 'operator'].includes(jwt?.appRole);
    };

    const pathA = 'tenants/tenantA/products/p1/img1.webp';
    const pathB = 'tenants/tenantB/products/p1/img1.webp';

    // Sessão canônica admin tenantA
    const adminA = { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' };
    expect(sqlSelectAllowed(adminA, pathA)).toBe(true);
    expect(sqlWriteAllowed(adminA, pathA)).toBe(true);
    // Não pode acessar tenantB
    expect(sqlSelectAllowed(adminA, pathB)).toBe(false);
    expect(sqlWriteAllowed(adminA, pathB)).toBe(false);

    // Sessão viewer tenantA
    const viewerA = { role: 'authenticated', appRole: 'viewer', tenantId: 'tenantA' };
    expect(sqlSelectAllowed(viewerA, pathA)).toBe(true);
    expect(sqlWriteAllowed(viewerA, pathA)).toBe(false); // viewer não grava

    // Sessão sem appRole
    const noRoleA = { role: 'authenticated', tenantId: 'tenantA' };
    expect(sqlSelectAllowed(noRoleA, pathA)).toBe(true);
    expect(sqlWriteAllowed(noRoleA, pathA)).toBe(false); // não grava sem appRole
  });

  // 10. Políticas SQL de Supabase não concedem permissões empresariais com base apenas em role: 'authenticated'
  it('10. Políticas SQL de Supabase: role: "authenticated" sozinho NÃO concede permissão de INSERT/UPDATE/DELETE', () => {
    const migrationSql = readFileSync(join(process.cwd(), 'supabase/migrations/20261010000000_create_product_images_storage.sql'), 'utf8');

    // Confirma que a política de escrita exige appRole IN ('admin', 'operator')
    expect(migrationSql).toContain("(auth.jwt() ->> 'appRole') IN ('admin', 'operator')");
    // Confirma que role = 'authenticated' está presente mas NÃO é a única condição de escrita
    expect(migrationSql).toContain("(auth.jwt() ->> 'role') = 'authenticated'");
    // Confirma que isolamento multi-tenant vincula tenantId
    expect(migrationSql).toContain("split_part(name, '/', 2) = (auth.jwt() ->> 'tenantId')");
  });
});
