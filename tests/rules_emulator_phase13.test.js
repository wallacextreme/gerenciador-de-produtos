import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get, update, remove, runTransaction } from 'firebase/database';
import { arePayloadsEquivalent, computeCanonicalPayloadHash } from '../src/js/utils/operationIdentity.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';

let testEnv;
let spawnedProcess = null;
const EMULATOR_PORT = 9000;
const TEST_PROJECT_ID = 'demo-rtdb-rules-emulator';

async function isEmulatorRunning(port = EMULATOR_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.inspect/coverage.json`, {
      signal: AbortSignal.timeout(1000)
    });
    return res.ok || res.status === 404 || res.status === 401;
  } catch {
    return false;
  }
}

async function ensureEmulator(port = EMULATOR_PORT) {
  if (await isEmulatorRunning(port)) {
    return;
  }
  const jarPath = join(homedir(), '.cache', 'firebase', 'emulators', 'firebase-database-emulator-v4.11.2.jar');
  if (!existsSync(jarPath)) {
    throw new Error(`Emulator JAR não encontrado em ${jarPath}`);
  }
  spawnedProcess = spawn('java', ['-jar', jarPath, '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    detached: false
  });
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    if (await isEmulatorRunning(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Falha ao iniciar Realtime Database Emulator em 15 segundos');
}

describe('PHASE 13.2 — Executable Realtime Database Security Rules Tests', () => {
  beforeAll(async () => {
    await ensureEmulator(EMULATOR_PORT);
    const rulesPath = join(process.cwd(), 'database.rules.json');
    const rulesContent = readFileSync(rulesPath, 'utf-8');

    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      database: {
        host: '127.0.0.1',
        port: EMULATOR_PORT,
        rules: rulesContent
      }
    });

    // Harmonização canônica: Em testes anteriores da Phase 13, os contextos foram escritos
    // com { role: 'admin' | 'operator' } antes do cutover canônico da Phase 14.5.
    // Mapeamos para claims canônicas nos fixtures da Phase 13, preservando rigorosamente
    // as claims originais nos testes específicos da Phase 14 (identificados por prefixo).
    const originalAuthenticatedContext = testEnv.authenticatedContext.bind(testEnv);
    testEnv.authenticatedContext = (uid, token = {}) => {
      if (uid && (uid.startsWith('u_p14_') || uid.startsWith('u_legacy_') || uid === 'u_self_elevation')) {
        return originalAuthenticatedContext(uid, token);
      }
      const enrichedToken = { ...token };
      if (token && typeof token === 'object') {
        if (!('appRole' in token)) {
          if (token.role === 'admin') enrichedToken.appRole = 'admin';
          else if (token.role === 'operator') enrichedToken.appRole = 'operator';
          else if (token.role === 'viewer') enrichedToken.appRole = 'viewer';
        }
      }
      return originalAuthenticatedContext(uid, enrichedToken);
    };
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
    if (spawnedProcess) {
      try {
        spawnedProcess.kill();
      } catch {}
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearDatabase();
    }
  });

  // =========================================================================
  // CENÁRIO A: Usuário não autenticado
  // =========================================================================
  describe('Cenário A: Usuário não autenticado', () => {
    it('deve recusar leitura não autenticada em caminhos privados de tenant', async () => {
      // Seed dados em tenantA com regras desabilitadas
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        const db = adminCtx.database();
        await set(ref(db, 'tenants/tenantA/products/prod1'), { id: 'prod1', name: 'Item', salePriceCents: 100 });
        await set(ref(db, 'tenants/tenantA/inventory/mov1'), { id: 'mov1', productId: 'prod1', quantity: 5, delta: 5, type: 'IN' });
        await set(ref(db, 'tenants/tenantA/sales/sale1'), { id: 'sale1', productId: 'prod1', quantity: 1, totalSaleCents: 100 });
        await set(ref(db, 'tenants/tenantA/purchases/pur1'), { id: 'pur1', totalAmountCents: 500 });
        await set(ref(db, 'tenants/tenantA/suppliers/sup1'), { id: 'sup1', name: 'Fornecedor' });
        await set(ref(db, 'tenants/tenantA/productSuppliers/ps1'), { id: 'ps1', productId: 'prod1', supplierId: 'sup1' });
        await set(ref(db, 'tenants/tenantA/settings/app'), { appName: 'Loja' });
        await set(ref(db, 'tenants/tenantA/imageManifest/img1'), { id: 'img1', productId: 'prod1', url: 'https://img.test', version: 1 });
        await set(ref(db, 'tenants/tenantA/syncMetadata'), { lastSync: 123456789 });
        await set(ref(db, 'users/userA'), { name: 'Alice', role: 'admin' });
      });

      const unauthCtx = testEnv.unauthenticatedContext();
      const db = unauthCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products/prod1')));
      await assertFails(get(ref(db, 'tenants/tenantA/inventory/mov1')));
      await assertFails(get(ref(db, 'tenants/tenantA/sales/sale1')));
      await assertFails(get(ref(db, 'tenants/tenantA/purchases/pur1')));
      await assertFails(get(ref(db, 'tenants/tenantA/suppliers/sup1')));
      await assertFails(get(ref(db, 'tenants/tenantA/productSuppliers/ps1')));
      await assertFails(get(ref(db, 'tenants/tenantA/settings/app')));
      await assertFails(get(ref(db, 'tenants/tenantA/imageManifest/img1')));
      await assertFails(get(ref(db, 'tenants/tenantA/syncMetadata')));
      await assertFails(get(ref(db, 'users/userA')));
    });

    it('deve recusar gravação não autenticada em todas as coleções privadas', async () => {
      const unauthCtx = testEnv.unauthenticatedContext();
      const db = unauthCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/products/p1'), { id: 'p1', name: 'Item', salePriceCents: 100 }));
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/m1'), { id: 'm1', productId: 'p1', quantity: 1, delta: 1, type: 'IN' }));
      await assertFails(set(ref(db, 'tenants/tenantA/sales/s1'), { id: 's1', productId: 'p1', quantity: 1, totalSaleCents: 100 }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur1'), { id: 'pur1', totalAmountCents: 500 }));
      await assertFails(set(ref(db, 'tenants/tenantA/settings/app'), { key: 'val' }));
      await assertFails(set(ref(db, 'tenants/tenantA/imageManifest/img1'), { id: 'img1', productId: 'p1', url: 'https://test', version: 1 }));
      await assertFails(set(ref(db, 'users/userUnauth'), { name: 'Hacker' }));
    });
  });

  // =========================================================================
  // CENÁRIO B: Isolamento entre tenants
  // =========================================================================
  describe('Cenário B: Isolamento estrito entre tenants', () => {
    beforeEach(async () => {
      // Seed sintético para tenantA e tenantB
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        const db = adminCtx.database();
        // Tenant A
        await set(ref(db, 'tenants/tenantA/products/prodA'), { id: 'prodA', name: 'Produto Tenant A', salePriceCents: 1000 });
        await set(ref(db, 'tenants/tenantA/inventory/movA'), { id: 'movA', productId: 'prodA', quantity: 10, delta: 10, type: 'IN' });
        await set(ref(db, 'tenants/tenantA/sales/saleA'), { id: 'saleA', productId: 'prodA', quantity: 2, totalSaleCents: 2000 });
        await set(ref(db, 'tenants/tenantA/purchases/purA'), { id: 'purA', totalAmountCents: 5000 });
        await set(ref(db, 'tenants/tenantA/suppliers/supA'), { id: 'supA', name: 'Fornecedor A' });
        await set(ref(db, 'tenants/tenantA/productSuppliers/psA'), { id: 'psA', productId: 'prodA', supplierId: 'supA' });
        await set(ref(db, 'tenants/tenantA/settings/configA'), { theme: 'dark' });
        await set(ref(db, 'tenants/tenantA/imageManifest/imgA'), { id: 'imgA', productId: 'prodA', url: 'https://imgA.test', version: 1 });
        await set(ref(db, 'tenants/tenantA/syncMetadata'), { version: 1 });

        // Tenant B
        await set(ref(db, 'tenants/tenantB/products/prodB'), { id: 'prodB', name: 'Produto Tenant B', salePriceCents: 2000 });
        await set(ref(db, 'tenants/tenantB/inventory/movB'), { id: 'movB', productId: 'prodB', quantity: 5, delta: 5, type: 'IN' });
        await set(ref(db, 'tenants/tenantB/sales/saleB'), { id: 'saleB', productId: 'prodB', quantity: 1, totalSaleCents: 2000 });
        await set(ref(db, 'tenants/tenantB/purchases/purB'), { id: 'purB', totalAmountCents: 8000 });
        await set(ref(db, 'tenants/tenantB/suppliers/supB'), { id: 'supB', name: 'Fornecedor B' });
        await set(ref(db, 'tenants/tenantB/productSuppliers/psB'), { id: 'psB', productId: 'prodB', supplierId: 'supB' });
        await set(ref(db, 'tenants/tenantB/settings/configB'), { theme: 'light' });
        await set(ref(db, 'tenants/tenantB/imageManifest/imgB'), { id: 'imgB', productId: 'prodB', url: 'https://imgB.test', version: 1 });
        await set(ref(db, 'tenants/tenantB/syncMetadata'), { version: 1 });
      });
    });

    it('usuário do Tenant A não pode ler dados do Tenant B (todas as coleções)', async () => {
      const userAAdminCtx = testEnv.authenticatedContext('userA_admin', { tenantId: 'tenantA', role: 'admin' });
      const db = userAAdminCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantB/products/prodB')));
      await assertFails(get(ref(db, 'tenants/tenantB/inventory/movB')));
      await assertFails(get(ref(db, 'tenants/tenantB/sales/saleB')));
      await assertFails(get(ref(db, 'tenants/tenantB/purchases/purB')));
      await assertFails(get(ref(db, 'tenants/tenantB/suppliers/supB')));
      await assertFails(get(ref(db, 'tenants/tenantB/productSuppliers/psB')));
      await assertFails(get(ref(db, 'tenants/tenantB/settings/configB')));
      await assertFails(get(ref(db, 'tenants/tenantB/imageManifest/imgB')));
      await assertFails(get(ref(db, 'tenants/tenantB/syncMetadata')));
    });

    it('usuário do Tenant A não pode alterar, gravar ou excluir dados do Tenant B', async () => {
      const userAAdminCtx = testEnv.authenticatedContext('userA_admin', { tenantId: 'tenantA', role: 'admin' });
      const db = userAAdminCtx.database();

      // Tentativa de escrita
      await assertFails(set(ref(db, 'tenants/tenantB/products/prodB2'), { id: 'prodB2', name: 'Invasor', salePriceCents: 50 }));
      await assertFails(set(ref(db, 'tenants/tenantB/inventory/movB2'), { id: 'movB2', productId: 'prodB', quantity: 99, delta: 99, type: 'IN' }));
      await assertFails(set(ref(db, 'tenants/tenantB/sales/saleB2'), { id: 'saleB2', productId: 'prodB', quantity: 1, totalSaleCents: 10 }));
      await assertFails(set(ref(db, 'tenants/tenantB/purchases/purB2'), { id: 'purB2', totalAmountCents: 100 }));
      await assertFails(set(ref(db, 'tenants/tenantB/suppliers/supB2'), { id: 'supB2', name: 'Fornecedor Malicioso' }));
      await assertFails(set(ref(db, 'tenants/tenantB/productSuppliers/psB2'), { id: 'psB2', productId: 'prodB', supplierId: 'supB' }));
      await assertFails(set(ref(db, 'tenants/tenantB/settings/configB'), { theme: 'hacked' }));
      await assertFails(set(ref(db, 'tenants/tenantB/imageManifest/imgB2'), { id: 'imgB2', productId: 'prodB', url: 'https://hack', version: 1 }));
      await assertFails(set(ref(db, 'tenants/tenantB/syncMetadata'), { hacked: true }));

      // Tentativa de exclusão
      await assertFails(remove(ref(db, 'tenants/tenantB/products/prodB')));
    });

    it('usuário operador do Tenant B não pode ler ou alterar dados do Tenant A', async () => {
      const userBOperatorCtx = testEnv.authenticatedContext('userB_op', { tenantId: 'tenantB', role: 'operator' });
      const db = userBOperatorCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products/prodA')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/prodA'), { id: 'prodA', name: 'Alterado por B', salePriceCents: 10 }));
    });
  });

  // =========================================================================
  // CENÁRIO C: Proteção do perfil do próprio usuário
  // =========================================================================
  describe('Cenário C: Proteção do perfil do próprio usuário', () => {
    it('C.1: deve permitir criação do próprio perfil sem campos privilegiados (role, tenantId)', async () => {
      const userCtx = testEnv.authenticatedContext('userNew123', {});
      const db = userCtx.database();

      await assertSucceeds(set(ref(db, 'users/userNew123'), {
        displayName: 'Novo Usuário',
        email: 'novo@loja.com',
        createdAt: '2026-10-09'
      }));
    });

    it('C.2: deve rejeitar tentativa de definir role: admin na criação do próprio perfil', async () => {
      const userCtx = testEnv.authenticatedContext('attacker1', {});
      const db = userCtx.database();

      await assertFails(set(ref(db, 'users/attacker1'), {
        displayName: 'Atacante',
        email: 'attacker@test.com',
        role: 'admin'
      }));
    });

    it('C.3: deve rejeitar tentativa de definir tenantId arbitrário na criação do próprio perfil', async () => {
      const userCtx = testEnv.authenticatedContext('attacker2', {});
      const db = userCtx.database();

      await assertFails(set(ref(db, 'users/attacker2'), {
        displayName: 'Atacante',
        email: 'attacker2@test.com',
        tenantId: 'tenantAlheio'
      }));
    });

    it('C.4: deve rejeitar tentativa de alterar o próprio papel em perfil existente', async () => {
      // Seed do perfil do usuário com role operator
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/operatorUser'), {
          displayName: 'Operador',
          role: 'operator',
          tenantId: 'tenantA'
        });
      });

      const userCtx = testEnv.authenticatedContext('operatorUser', {});
      const db = userCtx.database();

      await assertFails(update(ref(db, 'users/operatorUser'), {
        role: 'admin'
      }));
    });

    it('C.5: deve rejeitar tentativa de mudar o próprio tenant em perfil existente', async () => {
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/userTenantChange'), {
          displayName: 'Usuário Fixo',
          role: 'operator',
          tenantId: 'tenantA'
        });
      });

      const userCtx = testEnv.authenticatedContext('userTenantChange', {});
      const db = userCtx.database();

      await assertFails(update(ref(db, 'users/userTenantChange'), {
        tenantId: 'tenantB'
      }));
    });

    it('C.6: deve rejeitar tentativa de remover ou adulterar campos protegidos (role, tenantId)', async () => {
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/protectedUser'), {
          displayName: 'Usuário Protegido',
          role: 'operator',
          tenantId: 'tenantA'
        });
      });

      const userCtx = testEnv.authenticatedContext('protectedUser', {});
      const db = userCtx.database();

      // Tentativa de anular role
      await assertFails(update(ref(db, 'users/protectedUser'), { role: null }));

      // Tentativa de anular tenantId
      await assertFails(update(ref(db, 'users/protectedUser'), { tenantId: null }));

      // Tentativa de excluir o nó inteiro de perfil para limpar dados protegidos
      await assertFails(remove(ref(db, 'users/protectedUser')));

      // Porém, atualização legítima de campo não protegido (displayName) deve ser permitida
      await assertSucceeds(update(ref(db, 'users/protectedUser'), {
        displayName: 'Usuário Protegido Nome Atualizado'
      }));
    });

    it('C.7: deve rejeitar criação de perfil para outro usuário sem token admin', async () => {
      const userCtx = testEnv.authenticatedContext('userRegular', {});
      const db = userCtx.database();

      await assertFails(set(ref(db, 'users/anotherUser'), {
        displayName: 'Outro Perfil',
        email: 'outro@test.com'
      }));
    });
  });

  // =========================================================================
  // CENÁRIO D: Elevação de privilégios e acesso a terceiros
  // =========================================================================
  describe('Cenário D: Elevação de privilégios e acesso a terceiros', () => {
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        const db = adminCtx.database();
        await set(ref(db, 'users/targetUser'), {
          displayName: 'Alvo',
          role: 'operator',
          tenantId: 'tenantA'
        });
      });
    });

    it('usuário comum não pode ler nem alterar perfil de terceiro', async () => {
      const commonCtx = testEnv.authenticatedContext('commonUser', {});
      const db = commonCtx.database();

      await assertFails(get(ref(db, 'users/targetUser')));
      await assertFails(update(ref(db, 'users/targetUser'), { role: 'admin' }));
      await assertFails(update(ref(db, 'users/targetUser'), { tenantId: 'tenantHacked' }));
    });

    it('operador não pode alterar papéis ou tenants de outros usuários', async () => {
      const operatorCtx = testEnv.authenticatedContext('operatorUser', { tenantId: 'tenantA', role: 'operator' });
      const db = operatorCtx.database();

      await assertFails(update(ref(db, 'users/targetUser'), { role: 'admin' }));
      await assertFails(update(ref(db, 'users/targetUser'), { tenantId: 'tenantB' }));
    });

    it('somente administrador com escopo do mesmo tenant consegue provisionar e alterar perfis de terceiros', async () => {
      const adminCtx = testEnv.authenticatedContext('adminTenantA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Leitura permitida para admin do mesmo tenant
      await assertSucceeds(get(ref(db, 'users/targetUser')));

      // Atualização permitida para admin do mesmo tenant
      await assertSucceeds(update(ref(db, 'users/targetUser'), {
        role: 'admin',
        tenantId: 'tenantA'
      }));

      // Criação de terceiro permitida para admin no mesmo tenant
      await assertSucceeds(set(ref(db, 'users/newProvisionedUser'), {
        displayName: 'Provisionado pelo Admin',
        role: 'operator',
        tenantId: 'tenantA'
      }));

      // Admin de outro tenant é recusado
      const adminBCtx = testEnv.authenticatedContext('adminTenantB', { role: 'admin', tenantId: 'tenantB' });
      await assertFails(get(ref(adminBCtx.database(), 'users/targetUser')));
      await assertFails(update(ref(adminBCtx.database(), 'users/targetUser'), { role: 'operator' }));
    });
  });

  // =========================================================================
  // CENÁRIO E: Escritas em caminhos pais (anti-sobrescrita em massa)
  // =========================================================================
  describe('Cenário E: Escritas em caminhos pais', () => {
    it('deve rejeitar gravações em nós pais e coleções completas', async () => {
      const adminCtx = testEnv.authenticatedContext('adminTenantA', { tenantId: 'tenantA', role: 'admin' });
      const db = adminCtx.database();

      // Tentativa de escrita na raiz /tenants
      await assertFails(set(ref(db, 'tenants'), { hacked: true }));

      // Tentativa de escrita no nó pai do tenant /tenants/tenantA
      await assertFails(set(ref(db, 'tenants/tenantA'), { wiped: true }));

      // Tentativa de escrita em coleções completas de produtos, estoque, vendas, etc.
      await assertFails(set(ref(db, 'tenants/tenantA/products'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/inventory'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/sales'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/suppliers'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/productSuppliers'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/settings'), { massOverwrite: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/imageManifest'), { massOverwrite: true }));

      // Tentativa de escrita na raiz /users
      await assertFails(set(ref(db, 'users'), { massOverwrite: true }));
    });
  });

  // =========================================================================
  // CENÁRIO F: Operações legítimas
  // =========================================================================
  describe('Cenário F: Operações legítimas e validação de schema', () => {
    it('admin legítimo deve executar CRUD completo respeitando as regras', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { tenantId: 'tenantA', role: 'admin' });
      const db = adminCtx.database();

      // 1. Criar produto válido
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/pLegit1'), {
        id: 'pLegit1',
        name: 'Produto Legítimo',
        salePriceCents: 2500,
        version: 1
      }));

      // 2. Ler produto
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products/pLegit1')));

      // 3. Atualizar produto
      await assertSucceeds(update(ref(db, 'tenants/tenantA/products/pLegit1'), {
        name: 'Produto Legítimo Atualizado',
        salePriceCents: 2700,
        baseVersion: 1,
        version: 2
      }));

      // 4. Criar e ler estoque
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/movLegit1'), {
        id: 'movLegit1',
        productId: 'pLegit1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantA/inventory/movLegit1')));

      // 5. Criar e ler venda
      await assertSucceeds(set(ref(db, 'tenants/tenantA/sales/saleLegit1'), {
        id: 'saleLegit1',
        productId: 'pLegit1',
        quantity: 2,
        totalSaleCents: 5400
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantA/sales/saleLegit1')));

      // 6. Criar e ler compras (privilégio admin)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/purchases/purLegit1'), {
        id: 'purLegit1',
        totalAmountCents: 15000
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantA/purchases/purLegit1')));

      // 7. Criar e ler configurações (privilégio admin)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/general'), {
        companyName: 'Minha Loja'
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantA/settings/general')));

      // 8. Criar e ler manifesto de imagens
      await assertSucceeds(set(ref(db, 'tenants/tenantA/imageManifest/imgLegit1'), {
        id: 'imgLegit1',
        productId: 'pLegit1',
        url: 'https://cdn.test/img1.webp',
        version: 1
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantA/imageManifest/imgLegit1')));

      // 9. Excluir produto
      await assertSucceeds(remove(ref(db, 'tenants/tenantA/products/pLegit1')));
    });

    it('operador legítimo deve operar produtos e vendas, mas ser bloqueado em compras e configurações', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { tenantId: 'tenantA', role: 'operator' });
      const db = opCtx.database();

      // Permitido para operador: produto, estoque, venda, manifesto
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/pOp1'), {
        id: 'pOp1',
        name: 'Produto Operador',
        salePriceCents: 1500,
        version: 1
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/sales/saleOp1'), {
        id: 'saleOp1',
        productId: 'pOp1',
        quantity: 1,
        totalSaleCents: 1500
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/imageManifest/imgOp1'), {
        id: 'imgOp1',
        productId: 'pOp1',
        url: 'https://cdn.test/op.webp',
        version: 1
      }));

      // Bloqueado para operador: gravação de compras e configurações
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/purOpBlocked'), {
        id: 'purOpBlocked',
        totalAmountCents: 5000
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/settings/blocked'), {
        securityLevel: 'low'
      }));
    });

    it('validação de schema (.validate) deve rejeitar payloads corrompidos ou incompletos', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { tenantId: 'tenantA', role: 'admin' });
      const db = adminCtx.database();

      // Produto sem campos obrigatórios
      await assertFails(set(ref(db, 'tenants/tenantA/products/bad1'), {
        name: 'Sem ID nem preço'
      }));

      // Produto com preço não numérico
      await assertFails(set(ref(db, 'tenants/tenantA/products/bad2'), {
        id: 'bad2',
        name: 'Preço em string',
        salePriceCents: 'cem reais'
      }));

      // Estoque sem delta ou type
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/badMov'), {
        id: 'badMov',
        productId: 'p1',
        quantity: 10
      }));

      // Venda sem totalSaleCents
      await assertFails(set(ref(db, 'tenants/tenantA/sales/badSale'), {
        id: 'badSale',
        productId: 'p1',
        quantity: 1
      }));
    });
  });

  // =========================================================================
  // CENÁRIO G: Dados de fallback e custom claims
  // =========================================================================
  describe('Cenário G: Dados de fallback e custom claims', () => {
    it('G.1: usuário com custom claims opera diretamente sem registro prévio em /users/{uid}', async () => {
      const tokenUserCtx = testEnv.authenticatedContext('tokenOnlyUser', {
        tenantId: 'tenantAlpha',
        role: 'admin'
      });
      const db = tokenUserCtx.database();

      await assertSucceeds(set(ref(db, 'tenants/tenantAlpha/products/pAlpha'), {
        id: 'pAlpha',
        name: 'Produto Alpha',
        salePriceCents: 3000,
        version: 1
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantAlpha/products/pAlpha')));
    });

    it('G.2: usuário sem custom claims, mas com perfil provisionado em /users/{uid}, deve ter acesso de fallback', async () => {
      // Provisiona perfil seguro para fallbackUser
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/fallbackUser'), {
          displayName: 'Usuário Fallback',
          role: 'admin',
          tenantId: 'tenantAlpha'
        });
      });

      // Usuário autenticado sem claims (token vazio)
      const fallbackCtx = testEnv.authenticatedContext('fallbackUser', {});
      const db = fallbackCtx.database();

      // Consegue ler e gravar no tenant correspondente ao fallback
      await assertSucceeds(set(ref(db, 'tenants/tenantAlpha/products/pFallback'), {
        id: 'pFallback',
        name: 'Produto Gravado por Fallback',
        salePriceCents: 4500,
        version: 1
      }));
      await assertSucceeds(get(ref(db, 'tenants/tenantAlpha/products/pFallback')));

      // Consegue gravar compras pois o perfil é admin
      await assertSucceeds(set(ref(db, 'tenants/tenantAlpha/purchases/purFallback'), {
        id: 'purFallback',
        totalAmountCents: 12000
      }));

      // Mas NÃO consegue acessar tenant Beta
      await assertFails(get(ref(db, 'tenants/tenantBeta/products/pBeta')));
      await assertFails(set(ref(db, 'tenants/tenantBeta/products/pBeta'), {
        id: 'pBeta',
        name: 'Invasão',
        salePriceCents: 10
      }));
    });

    it('G.3: usuário sem tenant válido (sem claims e sem perfil) é completamente bloqueado', async () => {
      const noTenantCtx = testEnv.authenticatedContext('homelessUser', {});
      const db = noTenantCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantAlpha/products/pAlpha')));
      await assertFails(set(ref(db, 'tenants/tenantAlpha/products/pAlpha'), {
        id: 'pAlpha',
        name: 'Tentativa',
        salePriceCents: 10
      }));
    });

    it('G.4: usuário com papel incompatível (viewer) pode ler mas não pode gravar', async () => {
      const viewerCtx = testEnv.authenticatedContext('viewerUser', {
        tenantId: 'tenantAlpha',
        role: 'viewer'
      });
      const db = viewerCtx.database();

      // Seed de produto
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'tenants/tenantAlpha/products/pView'), {
          id: 'pView',
          name: 'Produto Vitrine',
          salePriceCents: 1000
        });
      });

      // Leitura permitida para viewer do mesmo tenant
      await assertSucceeds(get(ref(db, 'tenants/tenantAlpha/products/pView')));

      // Escrita de produto bloqueada
      await assertFails(set(ref(db, 'tenants/tenantAlpha/products/pView2'), {
        id: 'pView2',
        name: 'Novo Produto',
        salePriceCents: 1000
      }));

      // Escrita de compras bloqueada
      await assertFails(set(ref(db, 'tenants/tenantAlpha/purchases/purViewer'), {
        id: 'purViewer',
        totalAmountCents: 500
      }));
    });

    it('G.5: inconsistência entre claims e perfil não concede privilégios indevidos em terceiros', async () => {
      // Usuário tem token para tenantAlpha, mas perfil no banco aponta para tenantBeta
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/mismatchedUser'), {
          displayName: 'Inconsistente',
          role: 'admin',
          tenantId: 'tenantBeta'
        });
      });

      const mismatchedCtx = testEnv.authenticatedContext('mismatchedUser', {
        tenantId: 'tenantAlpha',
        role: 'operator'
      });
      const db = mismatchedCtx.database();

      // Tentativa de acessar um terceiro tenantGamma deve ser estritamente bloqueada
      await assertFails(get(ref(db, 'tenants/tenantGamma/products/pGamma')));
      await assertFails(set(ref(db, 'tenants/tenantGamma/products/pGamma'), {
        id: 'pGamma',
        name: 'Invasão Gamma',
        salePriceCents: 50
      }));
    });
  });

  // =========================================================================
  // PHASE 13.3 — AUDITORIA A: ISOLAMENTO ADMINISTRATIVO ENTRE TENANTS
  // =========================================================================
  describe('PHASE 13.3 — Auditoria A: Isolamento Administrativo Entre Tenants', () => {
    beforeEach(async () => {
      // Seed isolado de dois tenants com seus respectivos administradores e operadores
      await testEnv.withSecurityRulesDisabled(async (adminEnv) => {
        const db = adminEnv.database();
        // Tenant A: adminA e userA
        await set(ref(db, 'users/adminA'), {
          displayName: 'Admin Tenant A',
          role: 'admin',
          tenantId: 'tenantA'
        });
        await set(ref(db, 'users/userA'), {
          displayName: 'Operador Tenant A',
          role: 'operator',
          tenantId: 'tenantA'
        });

        // Tenant B: adminB e userB
        await set(ref(db, 'users/adminB'), {
          displayName: 'Admin Tenant B',
          role: 'admin',
          tenantId: 'tenantB'
        });
        await set(ref(db, 'users/userB'), {
          displayName: 'Operador Tenant B',
          role: 'operator',
          tenantId: 'tenantB'
        });
      });
    });

    it('1. Administrador A pode ler seu próprio perfil', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertSucceeds(get(ref(db, 'users/adminA')));
    });

    it('2. Administrador A pode administrar usuários autorizados do tenant A', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();

      // Leitura permitida de userA
      await assertSucceeds(get(ref(db, 'users/userA')));

      // Atualização permitida de userA mantendo tenantA
      await assertSucceeds(update(ref(db, 'users/userA'), {
        displayName: 'Operador Tenant A Atualizado'
      }));

      // Provisionamento de novo usuário para tenantA
      await assertSucceeds(set(ref(db, 'users/newUserA'), {
        displayName: 'Novo Membro Tenant A',
        role: 'operator',
        tenantId: 'tenantA'
      }));
    });

    it('3. Administrador A não pode ler o perfil privado do usuário B', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(get(ref(db, 'users/userB')));
    });

    it('4. Administrador A não pode alterar o papel do usuário B', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(update(ref(db, 'users/userB'), {
        role: 'admin'
      }));
    });

    it('5. Administrador A não pode alterar o tenant do usuário B', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(update(ref(db, 'users/userB'), {
        tenantId: 'tenantA'
      }));
    });

    it('6. Administrador A não pode excluir o perfil do usuário B', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(remove(ref(db, 'users/userB')));
    });

    it('7. Administrador A não pode mudar o usuário B para tenant A para depois obter acesso aos seus dados', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(set(ref(db, 'users/userB'), {
        displayName: 'User B Sequestrado',
        role: 'operator',
        tenantId: 'tenantA'
      }));
    });

    it('8. Administrador A não pode atribuir a si próprio privilégios globais ou mudar seu próprio tenant', async () => {
      const adminACtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();
      await assertFails(update(ref(db, 'users/adminA'), {
        tenantId: 'tenantB'
      }));
    });

    it('9. Operador A não pode administrar perfis de outros usuários', async () => {
      const opACtx = testEnv.authenticatedContext('userA', { role: 'operator', tenantId: 'tenantA' });
      const db = opACtx.database();
      await assertFails(get(ref(db, 'users/adminA')));
      await assertFails(update(ref(db, 'users/adminA'), { displayName: 'Hacked' }));
      await assertFails(get(ref(db, 'users/userB')));
      await assertFails(update(ref(db, 'users/userB'), { displayName: 'Hacked' }));
    });

    it('10. Administrador B continua autorizado a realizar operações permitidas dentro do tenant B', async () => {
      const adminBCtx = testEnv.authenticatedContext('adminB', { role: 'admin', tenantId: 'tenantB' });
      const db = adminBCtx.database();
      await assertSucceeds(get(ref(db, 'users/adminB')));
      await assertSucceeds(get(ref(db, 'users/userB')));
      await assertSucceeds(update(ref(db, 'users/userB'), {
        displayName: 'User B Atualizado por Admin B'
      }));
    });

    it('11. Usuário sem tenant válido não recebe permissões indevidas', async () => {
      const rogueCtx = testEnv.authenticatedContext('rogueAdmin', { role: 'admin' });
      const db = rogueCtx.database();
      await assertFails(get(ref(db, 'users/userA')));
      await assertFails(update(ref(db, 'users/userA'), { role: 'operator' }));
      await assertFails(get(ref(db, 'users/userB')));
      await assertFails(update(ref(db, 'users/userB'), { role: 'operator' }));
    });

    it('12. Tokens e dados de perfil contraditórios não concedem acesso por combinação permissiva', async () => {
      // Usuário com token tenantA mas perfil tenantB
      await testEnv.withSecurityRulesDisabled(async (adminEnv) => {
        await set(ref(adminEnv.database(), 'users/contradictoryUser'), {
          displayName: 'Contraditório',
          role: 'admin',
          tenantId: 'tenantB'
        });
      });

      const badCtx = testEnv.authenticatedContext('contradictoryUser', {
        role: 'admin',
        tenantId: 'tenantA'
      });
      const db = badCtx.database();

      // Tentativa de alterar um terceiro em tenantC deve falhar
      await assertFails(set(ref(db, 'users/thirdPartyUser'), {
        displayName: 'Terceiro',
        role: 'operator',
        tenantId: 'tenantC'
      }));
    });
  });

  // =========================================================================
  // PHASE 13.3 — AUDITORIA B: LEDGER DE ESTOQUE APPEND-ONLY
  // =========================================================================
  describe('PHASE 13.3 — Auditoria B: Ledger de Estoque Append-Only', () => {
    it('1. Administrador cria movimento válido no próprio tenant', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_admin_1'), {
        id: 'mov_admin_1',
        productId: 'prod1',
        quantity: 100,
        delta: 100,
        type: 'IN'
      }));
    });

    it('2. Operador cria movimento quando autorizado no próprio tenant', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_op_1'), {
        id: 'mov_op_1',
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('3. Registro duplicado com mesmo identificador é recusado', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Criação inicial
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_dup_1'), {
        id: 'mov_dup_1',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // Tentativa de recriar com o mesmo ID
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_dup_1'), {
        id: 'mov_dup_1',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));
    });

    it('4. update() de movimento existente é recusado (imutabilidade)', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_immut_1'), {
        id: 'mov_immut_1',
        productId: 'prod1',
        quantity: 50,
        delta: 50,
        type: 'IN'
      }));

      await assertFails(update(ref(db, 'tenants/tenantA/inventory/mov_immut_1'), {
        quantity: 999
      }));
    });

    it('5. set() substituindo movimento existente é recusado', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_subst_1'), {
        id: 'mov_subst_1',
        productId: 'prod1',
        quantity: 30,
        delta: 30,
        type: 'IN'
      }));

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_subst_1'), {
        id: 'mov_subst_1',
        productId: 'prod1',
        quantity: 1,
        delta: 1,
        type: 'IN'
      }));
    });

    it('6. remove() de movimento existente é recusado', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_del_1'), {
        id: 'mov_del_1',
        productId: 'prod1',
        quantity: 20,
        delta: 20,
        type: 'IN'
      }));

      await assertFails(remove(ref(db, 'tenants/tenantA/inventory/mov_del_1')));
    });

    it('7. Escrita num caminho pai que substitua a coleção de estoque é recusada', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory'), {
        wipedCollection: true
      }));
    });

    it('8. Usuário de outro tenant não pode criar, alterar nem excluir movimentos', async () => {
      const opBCtx = testEnv.authenticatedContext('opB', { role: 'operator', tenantId: 'tenantB' });
      const db = opBCtx.database();

      // Tentativa de criar movimento em tenantA
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_cross_1'), {
        id: 'mov_cross_1',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));
    });

    it('9. Movimento compensatório novo com identificador exclusivo é aceito quando válido', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // 1. Movimento original
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_orig_1'), {
        id: 'mov_orig_1',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // 2. Movimento compensatório com novo ID (ex: estorno ou ajuste de 2 unidades)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_comp_1'), {
        id: 'mov_comp_1',
        productId: 'prod1',
        quantity: 2,
        delta: -2,
        type: 'ADJUSTMENT'
      }));
    });

    it('10. Os registros anteriores permanecem estritamente inalterados após a compensação (ledger imutável)', async () => {
      const opCtx = testEnv.authenticatedContext('opA', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Movimento original
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_immutable_orig'), {
        id: 'mov_immutable_orig',
        productId: 'prod1',
        quantity: 50,
        delta: 50,
        type: 'IN'
      }));

      // Movimento compensatório
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_immutable_comp'), {
        id: 'mov_immutable_comp',
        productId: 'prod1',
        quantity: 10,
        delta: -10,
        type: 'ADJUSTMENT'
      }));

      // O registro original permanece exatamente com quantity: 50
      const origSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_immutable_orig'));
      expect(origSnap.val().quantity).toBe(50);
      expect(origSnap.val().delta).toBe(50);
      expect(origSnap.val().type).toBe('IN');

      // O registro compensatório existe separadamente
      const compSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_immutable_comp'));
      expect(compSnap.val().quantity).toBe(10);
      expect(compSnap.val().delta).toBe(-10);
      expect(compSnap.val().type).toBe('ADJUSTMENT');
    });
  });

  // =========================================================================
  // PHASE 13.4 — ETAPA A: Validação Rigorosa do Schema do Ledger Append-Only
  // =========================================================================
  describe('PHASE 13.4 — ETAPA A: Validação Rigorosa do Schema do Ledger Append-Only', () => {
    it('1. Movimento válido completo é aceito com todos os campos legítimos suportados', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      const validMovement = {
        id: 'mov_p134_full_1',
        productId: 'prod_xyz_100',
        type: 'IN',
        quantity: 15,
        delta: 15,
        unitCostCents: 2500,
        reason: 'Entrada de reposição de estoque',
        notes: 'Nota fiscal NF-e 44321',
        referenceId: 'ref_nfe_44321',
        referenceType: 'PURCHASE',
        previousStock: 10,
        resultingStock: 25,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        sourceDeviceId: 'dev_test_456',
        lastMutationId: 'mut_test_789',
        updatedAt: new Date().toISOString(),
        version: 1,
        _serverTimestamp: Date.now()
      };

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_p134_full_1'), validMovement));
    });

    it('2. Campo obrigatório ausente: falha sem "id"', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p134_noid'), {
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('3. Campo obrigatório ausente: falha sem "productId"', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p134_noprod'), {
        id: 'mov_p134_noprod',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('4. Campo obrigatório ausente: falha sem "quantity"', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p134_noqty'), {
        id: 'mov_p134_noqty',
        productId: 'prod1',
        delta: 5,
        type: 'IN'
      }));
    });

    it('5. Campo obrigatório ausente: falha sem "delta"', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p134_nodelta'), {
        id: 'mov_p134_nodelta',
        productId: 'prod1',
        quantity: 5,
        type: 'IN'
      }));
    });

    it('6. Campo obrigatório ausente: falha sem "type"', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p134_notype'), {
        id: 'mov_p134_notype',
        productId: 'prod1',
        quantity: 5,
        delta: 5
      }));
    });

    it('7. id incompatível com a chave $movementId é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_key_expected'), {
        id: 'mov_key_different',
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('8. productId com tipo inválido ou vazio é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // productId numérico
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_prod1'), {
        id: 'mov_bad_prod1',
        productId: 12345,
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));

      // productId string vazia
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_prod2'), {
        id: 'mov_bad_prod2',
        productId: '',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('9. quantity com tipo inválido (string) é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_qty_type'), {
        id: 'mov_bad_qty_type',
        productId: 'prod1',
        quantity: '10',
        delta: 10,
        type: 'IN'
      }));
    });

    it('10. quantity menor ou igual a zero é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // quantity zero
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_zero_qty'), {
        id: 'mov_zero_qty',
        productId: 'prod1',
        quantity: 0,
        delta: 0,
        type: 'IN'
      }));

      // quantity negativo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_neg_qty'), {
        id: 'mov_neg_qty',
        productId: 'prod1',
        quantity: -5,
        delta: -5,
        type: 'IN'
      }));
    });

    it('11. delta como string ou tipo não permitido é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_delta_type'), {
        id: 'mov_bad_delta_type',
        productId: 'prod1',
        quantity: 5,
        delta: 'cinco',
        type: 'IN'
      }));
    });

    it('12. Tipo de movimento não reconhecido pelo domínio é rejeitado', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_unknown_type'), {
        id: 'mov_unknown_type',
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'TRANSFERENCIA_FORJADA'
      }));
    });

    it('13. Todos os tipos legítimos (IN, OUT, ADJUSTMENT, RETURN, PURCHASE, SALE) são aceitos quando válidos', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      const types = [
        { type: 'IN', delta: 10 },
        { type: 'OUT', delta: -5 },
        { type: 'ADJUSTMENT', delta: -2 },
        { type: 'RETURN', delta: 3 },
        { type: 'PURCHASE', delta: 20 },
        { type: 'SALE', delta: -4 }
      ];

      for (let i = 0; i < types.length; i++) {
        const item = types[i];
        const movId = `mov_legit_type_${item.type.toLowerCase()}`;
        await assertSucceeds(set(ref(db, `tenants/tenantA/inventory/${movId}`), {
          id: movId,
          productId: 'prod1',
          quantity: Math.abs(item.delta),
          delta: item.delta,
          type: item.type
        }));
      }
    });

    it('14. Propriedade desconhecida ou arbitrária injetada é rejeitada pelo schema', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_injected_prop'), {
        id: 'mov_injected_prop',
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'IN',
        maliciousInjectedField: 'hack_admin_role_true'
      }));
    });

    it('15. Tentativa de gravação no tenant errado é rejeitada', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantB/inventory/mov_cross_tenant_134'), {
        id: 'mov_cross_tenant_134',
        productId: 'prod1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('16. Reutilização de ID existente é rejeitada (append-only estrito)', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Gravação inicial legítima
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_id_reuse_test'), {
        id: 'mov_id_reuse_test',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // Tentativa de regravar com o mesmo ID
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_id_reuse_test'), {
        id: 'mov_id_reuse_test',
        productId: 'prod1',
        quantity: 99,
        delta: 99,
        type: 'IN'
      }));
    });

    it('17. Alteração de movimento existente via update() é rejeitada', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(update(ref(db, 'tenants/tenantA/inventory/mov_id_reuse_test'), {
        quantity: 50
      }));
    });

    it('18. Exclusão de movimento existente via remove() é rejeitada', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA_schema', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      await assertFails(remove(ref(db, 'tenants/tenantA/inventory/mov_id_reuse_test')));
    });

    it('19. Movimento compensatório legítimo com ID exclusivo é aceito e preserva o histórico', async () => {
      const opCtx = testEnv.authenticatedContext('opA_schema', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // 1. Criar movimento original
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_orig_p134'), {
        id: 'mov_orig_p134',
        productId: 'prod1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // 2. Movimento compensatório estornando parcialmente
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_compensatory_p134'), {
        id: 'mov_compensatory_p134',
        productId: 'prod1',
        quantity: 3,
        delta: -3,
        type: 'ADJUSTMENT',
        reason: 'Estorno de avaria identificada no lote',
        referenceId: 'mov_orig_p134',
        referenceType: 'STOCK_MOVEMENT'
      }));

      // Ambos os registros continuam íntegros
      const origSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_orig_p134'));
      const compSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_compensatory_p134'));
      expect(origSnap.val().quantity).toBe(10);
      expect(compSnap.val().delta).toBe(-3);
    });
  });

  // =========================================================================
  // PHASE 13.4 — ETAPA B: Ciclo de Vida do Usuário e Política de Offboarding
  // =========================================================================
  describe('PHASE 13.4 — ETAPA B: Ciclo de Vida do Usuário e Política de Offboarding', () => {
    it('1. Usuário ativo com perfil e tenant válidos opera normalmente', async () => {
      const adminRoot = testEnv.authenticatedContext('admin_setup', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_active_1'), {
        displayName: 'Operador Ativo',
        email: 'op_active@tenantA.com',
        role: 'operator',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_active_1');
      const db = userCtx.database();

      // Consegue ler produtos do seu tenant
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));
    });

    it('2. Usuário sem perfil provisionado e sem claims é rejeitado em todas as coleções de tenant', async () => {
      const unprovCtx = testEnv.authenticatedContext('unprovisioned_user_99');
      const db = unprovCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(get(ref(db, 'tenants/tenantA/inventory')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_hack'), {
        id: 'p_hack',
        name: 'Hacked',
        salePriceCents: 100
      }));
    });

    it('3. Exclusão do perfil RTDB revoga imediatamente o acesso para usuário que dependia do perfil no RTDB', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA_offboard', { role: 'admin', tenantId: 'tenantA' });
      const adminDb = adminCtx.database();

      // Provisionar usuário que depende do perfil no RTDB (sem custom claims no JWT)
      await set(ref(adminDb, 'users/user_offboard_target'), {
        displayName: 'Operador a Desativar',
        email: 'target@tenantA.com',
        role: 'operator',
        tenantId: 'tenantA'
      });

      // Usuário consegue acessar antes da remoção
      const targetCtx = testEnv.authenticatedContext('user_offboard_target');
      await assertSucceeds(get(ref(targetCtx.database(), 'tenants/tenantA/products')));

      // Administrador do tenantA remove o perfil em /users/{uid}
      await assertSucceeds(remove(ref(adminDb, 'users/user_offboard_target')));

      // Imediatamente após a remoção do perfil no RTDB, o acesso ao tenant é bloqueado!
      await assertFails(get(ref(targetCtx.database(), 'tenants/tenantA/products')));
      await assertFails(get(ref(targetCtx.database(), 'tenants/tenantA/inventory')));
    });

    it('4. Token com Custom Claims no JWT continua autorizado pelo RTDB mesmo após remoção de /users/{uid}', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA_offboard', { role: 'admin', tenantId: 'tenantA' });
      const adminDb = adminCtx.database();

      // Criar perfil no RTDB
      await set(ref(adminDb, 'users/user_with_jwt_claims'), {
        displayName: 'Operador com Claims',
        email: 'claims@tenantA.com',
        role: 'operator',
        tenantId: 'tenantA'
      });

      // Remover perfil do RTDB
      await assertSucceeds(remove(ref(adminDb, 'users/user_with_jwt_claims')));

      // Usuário possui token JWT assinado com claims válidos:
      // Pelo design das regras (auth.token.tenantId === $tenantId), o acesso à RTDB continua autorizado
      // até que a conta seja desativada no Firebase Auth ou o token JWT expire (TTL <= 1h).
      const claimsCtx = testEnv.authenticatedContext('user_with_jwt_claims', {
        role: 'operator',
        tenantId: 'tenantA'
      });
      await assertSucceeds(get(ref(claimsCtx.database(), 'tenants/tenantA/products')));
    });

    it('5. Administrador de tenantA consegue remover usuário do próprio tenantA', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA_offboard', { role: 'admin', tenantId: 'tenantA' });
      const adminDb = adminCtx.database();

      await set(ref(adminDb, 'users/user_same_tenant'), {
        displayName: 'Operador Mesmo Tenant',
        role: 'operator',
        tenantId: 'tenantA'
      });

      await assertSucceeds(remove(ref(adminDb, 'users/user_same_tenant')));
    });

    it('6. Administrador de tenantA é TERMINANTEMENTE BLOQUEADO ao tentar remover usuário de tenantB', async () => {
      const adminBCtx = testEnv.authenticatedContext('adminB_offboard', { role: 'admin', tenantId: 'tenantB' });
      const adminBDb = adminBCtx.database();

      // Criar usuário no tenantB
      await set(ref(adminBDb, 'users/user_tenantB_victim'), {
        displayName: 'Usuário Tenant B',
        role: 'operator',
        tenantId: 'tenantB'
      });

      // Administrador do tenantA tenta remover usuário do tenantB
      const adminACtx = testEnv.authenticatedContext('adminA_offboard', { role: 'admin', tenantId: 'tenantA' });
      await assertFails(remove(ref(adminACtx.database(), 'users/user_tenantB_victim')));
    });

    it('7. Operador comum é bloqueado ao tentar remover ou desativar qualquer usuário', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_setup', { role: 'admin', tenantId: 'tenantA' });
      await set(ref(adminCtx.database(), 'users/user_existing_target'), {
        displayName: 'Alvo',
        role: 'operator',
        tenantId: 'tenantA'
      });
      await set(ref(adminCtx.database(), 'users/opA_regular'), {
        displayName: 'Operador Regular',
        role: 'operator',
        tenantId: 'tenantA'
      });

      const opCtx = testEnv.authenticatedContext('opA_regular', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Tentativa de remover outro usuário existente
      await assertFails(remove(ref(db, 'users/user_existing_target')));
      // Tentativa de remover seu próprio perfil existente
      await assertFails(remove(ref(db, 'users/opA_regular')));
    });

    it('8. Usuário desprovido/removido é bloqueado ao tentar recriar seu perfil com role admin', async () => {
      const rogueCtx = testEnv.authenticatedContext('rogue_former_user');
      const db = rogueCtx.database();

      await assertFails(set(ref(db, 'users/rogue_former_user'), {
        displayName: 'Invasor Escalado',
        role: 'admin',
        tenantId: 'tenantA'
      }));
    });

    it('9. Preservação integral dos dados comerciais e do histórico do estoque durante o offboarding', async () => {
      const adminCtx = testEnv.authenticatedContext('adminA_audit', { role: 'admin', tenantId: 'tenantA' });
      const adminDb = adminCtx.database();

      // 1. Criar perfil de operador transitório
      await set(ref(adminDb, 'users/op_transitory'), {
        displayName: 'Operador Transitório',
        role: 'operator',
        tenantId: 'tenantA'
      });

      // 2. Operador registra movimento de estoque e venda
      const opCtx = testEnv.authenticatedContext('op_transitory', { role: 'operator', tenantId: 'tenantA' });
      await assertSucceeds(set(ref(opCtx.database(), 'tenants/tenantA/inventory/mov_historical_transitory'), {
        id: 'mov_historical_transitory',
        productId: 'prod_audit_1',
        quantity: 100,
        delta: 100,
        type: 'IN',
        createdAt: new Date().toISOString()
      }));

      await assertSucceeds(set(ref(opCtx.database(), 'tenants/tenantA/sales/sale_historical_transitory'), {
        id: 'sale_historical_transitory',
        productId: 'prod_audit_1',
        quantity: 2,
        totalSaleCents: 5000,
        createdAt: new Date().toISOString()
      }));

      // 3. Administrador desativa/remove o operador
      await assertSucceeds(remove(ref(adminDb, 'users/op_transitory')));

      // 4. Histórico comercial e de estoque permanece 100% INTACTO e legível
      const invSnap = await get(ref(adminDb, 'tenants/tenantA/inventory/mov_historical_transitory'));
      const saleSnap = await get(ref(adminDb, 'tenants/tenantA/sales/sale_historical_transitory'));

      expect(invSnap.exists()).toBe(true);
      expect(invSnap.val().quantity).toBe(100);
      expect(invSnap.val().delta).toBe(100);
      expect(saleSnap.exists()).toBe(true);
      expect(saleSnap.val().totalSaleCents).toBe(5000);
    });
  });

  // =========================================================================
  // PHASE 13.5 — ETAPA A: Testes Executáveis de Coerência de Origem de Autorização
  // =========================================================================
  describe('PHASE 13.5 — ETAPA A: Testes Executáveis de Coerência de Origem de Autorização', () => {
    it('1. Claims completos e coerentes para o tenant A concedem acesso de administrador', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_p135_a', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Pode ler produtos
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));
      // Pode gravar compras
      await assertSucceeds(set(ref(db, 'tenants/tenantA/purchases/pur_p135_1'), {
        id: 'pur_p135_1',
        totalAmountCents: 15000
      }));
      // Pode gravar configurações
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/theme'), {
        theme: 'dark'
      }));
    });

    it('2. Claims completos e coerentes para o tenant B concedem acesso de operador, mas bloqueiam compras', async () => {
      const opCtx = testEnv.authenticatedContext('op_p135_b', { role: 'operator', tenantId: 'tenantB' });
      const db = opCtx.database();

      // Pode ler produtos
      await assertSucceeds(get(ref(db, 'tenants/tenantB/products')));
      // Pode gravar vendas
      await assertSucceeds(set(ref(db, 'tenants/tenantB/sales/sale_p135_b'), {
        id: 'sale_p135_b',
        productId: 'prod_b1',
        quantity: 1,
        totalSaleCents: 2000
      }));
      // NÃO pode gravar compras (requer admin)
      await assertFails(set(ref(db, 'tenants/tenantB/purchases/pur_p135_b_fail'), {
        id: 'pur_p135_b_fail',
        totalAmountCents: 5000
      }));
    });

    it('3. Ausência de claims com perfil válido de administrador no tenant A concede acesso', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_fallback_admin_a'), {
        displayName: 'Admin Fallback',
        role: 'admin',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_fallback_admin_a');
      const db = userCtx.database();

      // Pode ler produtos e gravar compras
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/purchases/pur_fallback_ok'), {
        id: 'pur_fallback_ok',
        totalAmountCents: 8500
      }));
    });

    it('4. Ausência de claims com perfil de operador no tenant B bloqueia operações administrativas', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root_b', { role: 'admin', tenantId: 'tenantB' }).database();
      await set(ref(adminRoot, 'users/user_fallback_op_b'), {
        displayName: 'Operador Fallback B',
        role: 'operator',
        tenantId: 'tenantB'
      });

      const userCtx = testEnv.authenticatedContext('user_fallback_op_b');
      const db = userCtx.database();

      // Pode ler produtos
      await assertSucceeds(get(ref(db, 'tenants/tenantB/products')));
      // NÃO pode gravar compras
      await assertFails(set(ref(db, 'tenants/tenantB/purchases/pur_fallback_b_fail'), {
        id: 'pur_fallback_b_fail',
        totalAmountCents: 3000
      }));
    });

    it('5. Token do tenant B com perfil persistido do tenant A (identidades contraditórias) é rejeitado', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_contradictory_5'), {
        displayName: 'Contraditório 5',
        role: 'operator',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_contradictory_5', { role: 'operator', tenantId: 'tenantB' });
      const db = userCtx.database();

      // Tentativa de acessar tenantA (token diz tenantB) -> BLOQUEADO
      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      // Tentativa de acessar tenantB (perfil diz tenantA, contradição) -> BLOQUEADO
      await assertFails(get(ref(db, 'tenants/tenantB/products')));
    });

    it('6. Token de operador do tenant B com perfil de administrador do tenant A não combina privilégios', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_cross_role_6'), {
        displayName: 'Admin em A',
        role: 'admin',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_cross_role_6', { role: 'operator', tenantId: 'tenantB' });
      const db = userCtx.database();

      // Não pode gravar purchases em tenantB usando o papel admin de tenantA
      await assertFails(set(ref(db, 'tenants/tenantB/purchases/pur_cross_fail'), {
        id: 'pur_cross_fail',
        totalAmountCents: 1000
      }));
      // Não pode acessar tenantA
      await assertFails(get(ref(db, 'tenants/tenantA/products')));
    });

    it('7. Token de administrador do tenant B com perfil de operador do tenant A não acessa tenant A', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_cross_role_7'), {
        displayName: 'Operador em A',
        role: 'operator',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_cross_role_7', { role: 'admin', tenantId: 'tenantB' });
      const db = userCtx.database();

      // Não pode gravar purchases em tenantA
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_cross_fail_7'), {
        id: 'pur_cross_fail_7',
        totalAmountCents: 2000
      }));
    });

    it('8. Token sem role, mas com tenantId, não pode executar escritas que requerem papel', async () => {
      const userCtx = testEnv.authenticatedContext('user_no_role', { tenantId: 'tenantA' });
      const db = userCtx.database();

      // Pode ler produtos de tenantA (é membro do tenant)
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));
      // NÃO pode gravar produtos (requer admin ou operator no token)
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_no_role'), {
        id: 'p_no_role',
        name: 'Produto Sem Papel',
        salePriceCents: 1000
      }));
    });

    it('9. Token sem tenantId, mas com role, avalia o papel exclusivamente a partir do perfil no RTDB', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_incomplete_claims_9'), {
        displayName: 'Operador Real',
        role: 'operator',
        tenantId: 'tenantA'
      });

      // Token possui role: admin forjado sem tenantId
      const userCtx = testEnv.authenticatedContext('user_incomplete_claims_9', { role: 'admin' });
      const db = userCtx.database();

      // Como o token não possui tenantId, o fallback é o perfil (onde o papel é operator)
      // Tentar gravar purchases (requer admin) deve falhar!
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_incomp_fail'), {
        id: 'pur_incomp_fail',
        totalAmountCents: 5000
      }));
    });

    it('10. Token sem claims e sem perfil é recusado em 100% dos caminhos protegidos', async () => {
      const ghostCtx = testEnv.authenticatedContext('ghost_user');
      const db = ghostCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(get(ref(db, 'tenants/tenantA/inventory')));
      await assertFails(set(ref(db, 'tenants/tenantA/sales/s1'), { id: 's1', productId: 'p1', quantity: 1, totalSaleCents: 100 }));
    });

    it('11. Perfil com papel inválido é recusado em operações operacionais', async () => {
      const adminRoot = testEnv.authenticatedContext('setup_root', { role: 'admin', tenantId: 'tenantA' }).database();
      await set(ref(adminRoot, 'users/user_bad_role_11'), {
        role: 'convidado_sem_acesso',
        tenantId: 'tenantA'
      });

      const userCtx = testEnv.authenticatedContext('user_bad_role_11');
      const db = userCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/products/p_bad_role'), {
        id: 'p_bad_role',
        name: 'Produto Inválido',
        salePriceCents: 500
      }));
    });

    it('12. Perfil sem tenantId é recusado em acessos de tenant', async () => {
      const userCtx = testEnv.authenticatedContext('user_no_tenant_12');
      const db = userCtx.database();

      // Usuário auto-cria seu perfil comum sem tenantId e sem role
      await assertSucceeds(set(ref(db, 'users/user_no_tenant_12'), {
        displayName: 'Usuário Sem Tenant'
      }));

      // Tentativas de acesso a qualquer tenant devem falhar
      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(set(ref(db, 'tenants/tenantA/settings/s1'), { s: 1 }));
    });

    it('13. Permissões de operador são válidas para vendas/estoque, mas recusadas para configurações/compras', async () => {
      const opCtx = testEnv.authenticatedContext('op_tenantA_13', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Permitido
      await assertSucceeds(set(ref(db, 'tenants/tenantA/sales/sale_ok_13'), {
        id: 'sale_ok_13',
        productId: 'prod1',
        quantity: 1,
        totalSaleCents: 1000
      }));
      // Recusado
      await assertFails(set(ref(db, 'tenants/tenantA/settings/taxConfig'), {
        rate: 0.15
      }));
    });

    it('14. Operações cruzando tenants são categoricamente rejeitadas', async () => {
      const opCtx = testEnv.authenticatedContext('op_tenantA_14', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantB/products')));
      await assertFails(set(ref(db, 'tenants/tenantB/inventory/mov_cross'), {
        id: 'mov_cross',
        productId: 'prod1',
        quantity: 1,
        delta: 1,
        type: 'IN'
      }));
    });

    it('15. Tentativas de escrita na raiz do banco ou no nó pai do tenant são recusadas', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_tenantA_15', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Raiz /tenants
      await assertFails(set(ref(db, 'tenants'), { hacked: true }));
      // Pai /tenants/tenantA
      await assertFails(set(ref(db, 'tenants/tenantA'), { wiped: true }));
    });
  });

  // =========================================================================
  // PHASE 13.5 — ETAPA B: Testes Executáveis de Completude do Schema do Ledger
  // =========================================================================
  describe('PHASE 13.5 — ETAPA B: Testes Executáveis de Completude do Schema do Ledger', () => {
    it('1. Cada tipo legítimo com dados e delta semanticamente corretos é aceito', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      const validScenarios = [
        { id: 'mov_in_valid', type: 'IN', quantity: 10, delta: 10 },
        { id: 'mov_purch_valid', type: 'PURCHASE', quantity: 25, delta: 25 },
        { id: 'mov_ret_valid', type: 'RETURN', quantity: 4, delta: 4 },
        { id: 'mov_out_valid', type: 'OUT', quantity: 7, delta: -7 },
        { id: 'mov_sale_valid', type: 'SALE', quantity: 3, delta: -3 },
        { id: 'mov_adj_pos_valid', type: 'ADJUSTMENT', quantity: 8, delta: 8 },
        { id: 'mov_adj_neg_valid', type: 'ADJUSTMENT', quantity: 6, delta: -6 }
      ];

      for (const item of validScenarios) {
        await assertSucceeds(set(ref(db, `tenants/tenantA/inventory/${item.id}`), {
          id: item.id,
          productId: 'prod_sku_1',
          quantity: item.quantity,
          delta: item.delta,
          type: item.type,
          createdAt: new Date().toISOString()
        }));
      }
    });

    it('2. Cada relação semanticamente inválida entre type e delta é rejeitada', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // IN com delta negativo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_in_neg'), {
        id: 'mov_in_neg', productId: 'p1', quantity: 10, delta: -10, type: 'IN'
      }));

      // PURCHASE com delta negativo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_purch_neg'), {
        id: 'mov_purch_neg', productId: 'p1', quantity: 15, delta: -15, type: 'PURCHASE'
      }));

      // RETURN com delta negativo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_ret_neg'), {
        id: 'mov_ret_neg', productId: 'p1', quantity: 5, delta: -5, type: 'RETURN'
      }));

      // OUT com delta positivo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_out_pos'), {
        id: 'mov_out_pos', productId: 'p1', quantity: 8, delta: 8, type: 'OUT'
      }));

      // SALE com delta positivo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_sale_pos'), {
        id: 'mov_sale_pos', productId: 'p1', quantity: 3, delta: 3, type: 'SALE'
      }));

      // ADJUSTMENT com delta zero
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_adj_zero'), {
        id: 'mov_adj_zero', productId: 'p1', quantity: 5, delta: 0, type: 'ADJUSTMENT'
      }));

      // ADJUSTMENT com delta divergente da magnitude de quantity
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_adj_mismatch'), {
        id: 'mov_adj_mismatch', productId: 'p1', quantity: 10, delta: -5, type: 'ADJUSTMENT'
      }));

      // IN com delta zero
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_in_zero'), {
        id: 'mov_in_zero', productId: 'p1', quantity: 10, delta: 0, type: 'IN'
      }));
    });

    it('3. Campos opcionais legítimos com tipos corretos são aceitos', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      const completeMovement = {
        id: 'mov_optional_complete',
        productId: 'prod_sku_opt',
        quantity: 12,
        delta: 12,
        type: 'IN',
        unitCostCents: 3500,
        reason: 'Reposição quinzenal',
        notes: 'Mercadoria conferida na doca',
        referenceId: 'nfe_998877',
        referenceType: 'NFE',
        previousStock: 20,
        resultingStock: 32,
        date: '2026-10-09T14:30:00.000Z',
        createdAt: '2026-10-09T14:30:00.000Z',
        sourceDeviceId: 'device_desktop_01',
        lastMutationId: 'mut_sync_123',
        updatedAt: '2026-10-09T14:30:00.000Z',
        version: 1,
        _serverTimestamp: 1775831400000
      };

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_optional_complete'), completeMovement));
    });

    it('4. Valores inválidos em campos opcionais são rejeitados', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // unitCostCents negativo
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_cost_neg'), {
        id: 'mov_bad_cost_neg', productId: 'p1', quantity: 1, delta: 1, type: 'IN', unitCostCents: -50
      }));

      // unitCostCents como string
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_cost_str'), {
        id: 'mov_bad_cost_str', productId: 'p1', quantity: 1, delta: 1, type: 'IN', unitCostCents: '3500'
      }));

      // notes como objeto aninhado não previsto
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_notes_obj'), {
        id: 'mov_bad_notes_obj', productId: 'p1', quantity: 1, delta: 1, type: 'IN', notes: { nested: 'hack' }
      }));

      // referenceId como número em vez de string
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_ref_num'), {
        id: 'mov_bad_ref_num', productId: 'p1', quantity: 1, delta: 1, type: 'IN', referenceId: 998877
      }));

      // version menor que 1
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_ver_zero'), {
        id: 'mov_bad_ver_zero', productId: 'p1', quantity: 1, delta: 1, type: 'IN', version: 0
      }));

      // version como string
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_bad_ver_str'), {
        id: 'mov_bad_ver_str', productId: 'p1', quantity: 1, delta: 1, type: 'IN', version: '1'
      }));
    });

    it('5. Campos desconhecidos ou injetados são recusados pelo fechamento $other: false', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_injected_attr'), {
        id: 'mov_injected_attr',
        productId: 'p1',
        quantity: 5,
        delta: 5,
        type: 'IN',
        arbitraryInjectedAttribute: 'malicious_content'
      }));
    });

    it('6. IDs incompatíveis com a chave $movementId são recusados', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_key_path_135'), {
        id: 'mov_key_payload_different',
        productId: 'p1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('7. Movimentos de tenants diferentes permanecem estritamente isolados', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantB/inventory/mov_isolated_tB'), {
        id: 'mov_isolated_tB',
        productId: 'p1',
        quantity: 5,
        delta: 5,
        type: 'IN'
      }));
    });

    it('8. Movimentos gravados não podem ser alterados nem excluídos (append-only)', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_lock_test'), {
        id: 'mov_lock_test',
        productId: 'p1',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // update() recusado
      await assertFails(update(ref(db, 'tenants/tenantA/inventory/mov_lock_test'), {
        quantity: 20
      }));

      // remove() recusado
      await assertFails(remove(ref(db, 'tenants/tenantA/inventory/mov_lock_test')));
    });

    it('9. Movimento compensatório válido com ID exclusivo preserva integralmente o registro original', async () => {
      const opCtx = testEnv.authenticatedContext('op_ledger_p135', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Original
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_comp_orig'), {
        id: 'mov_comp_orig',
        productId: 'p1',
        quantity: 50,
        delta: 50,
        type: 'IN'
      }));

      // Compensatório estornando 10 unidades
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_comp_fix'), {
        id: 'mov_comp_fix',
        productId: 'p1',
        quantity: 10,
        delta: -10,
        type: 'ADJUSTMENT',
        reason: 'Estorno de lote defeituoso',
        referenceId: 'mov_comp_orig'
      }));

      // Conferir ambos
      const origSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_comp_orig'));
      const fixSnap = await get(ref(db, 'tenants/tenantA/inventory/mov_comp_fix'));

      expect(origSnap.val().quantity).toBe(50);
      expect(origSnap.val().delta).toBe(50);
      expect(fixSnap.val().quantity).toBe(10);
      expect(fixSnap.val().delta).toBe(-10);
    });
  });

  // =========================================================================
  // PHASE 13.6 — Final Pre-Staging Consistency Gate: Auditoria Rigorosa
  // =========================================================================
  describe('PHASE 13.6 — Final Pre-Staging Consistency Gate: Matriz Completa de Auditoria', () => {
    it('1. Claims completos e perfil coerente concedem acesso às coleções e permissões do papel', async () => {
      const adminCtx = testEnv.authenticatedContext('u_p136_coherent_admin', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Perfil armazenado e coerente
      await assertSucceeds(set(ref(db, 'users/u_p136_coherent_admin'), {
        tenantId: 'tenantA',
        role: 'admin',
        displayName: 'Coherent Admin'
      }));

      // Acesso legítimo em coleções operacionais e administrativas
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/prod_coh_1'), {
        id: 'prod_coh_1',
        name: 'Produto Coerente',
        salePriceCents: 1500,
        version: 1
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/tax_p136'), {
        rate: 0.18
      }));
    });

    it('2. Claims completos sem perfil no RTDB concedem acesso às coleções autorizadas', async () => {
      const adminCtx = testEnv.authenticatedContext('u_p136_claims_only_admin', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Sem perfil em /users/u_p136_claims_only_admin
      // Acesso operacional e administrativo concedido via token claims
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/prod_claimsonly_1'), {
        id: 'prod_claimsonly_1',
        name: 'Produto Sem Perfil',
        salePriceCents: 2000,
        version: 1
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/sys_p136'), {
        enabled: true
      }));
    });

    it('3. Token admin e perfil operator no mesmo tenant: token JWT mantém poderes administrativos até expiração (Caso D)', async () => {
      const adminCtx = testEnv.authenticatedContext('u_p136_demoted_admin', { role: 'admin', tenantId: 'tenantA' });
      const db = adminCtx.database();

      // Perfil persistido rebaixado para operator no mesmo tenant
      await assertSucceeds(set(ref(db, 'users/u_p136_demoted_admin'), {
        tenantId: 'tenantA',
        role: 'operator',
        displayName: 'Demoted Admin'
      }));

      // Demonstração técnica: token JWT contendo custom claims role: admin continua sendo validado pelas regras
      // para operações administrativas até a expiração da sessão (risco auditado e documentado)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/admin_setting_p136'), {
        adminOverride: true
      }));
    });

    it('4. Token operator e perfil admin no mesmo tenant: token operator NÃO herda privilégios de admin do perfil', async () => {
      const opCtx = testEnv.authenticatedContext('u_p136_op_token_admin_profile', { role: 'operator', tenantId: 'tenantA' });
      const adminSetupCtx = testEnv.authenticatedContext('admin_setup_p136', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminSetupCtx.database();
      const opDb = opCtx.database();

      // Configura perfil no RTDB com role: admin
      await assertSucceeds(set(ref(setupDb, 'users/u_p136_op_token_admin_profile'), {
        tenantId: 'tenantA',
        role: 'admin',
        displayName: 'Perfil Admin Mas Token Op'
      }));

      // Token operator pode fazer operações de operador (produtos)
      await assertSucceeds(set(ref(opDb, 'tenants/tenantA/products/prod_p136_op'), {
        id: 'prod_p136_op',
        name: 'Produto do Operador',
        salePriceCents: 3000,
        version: 1
      }));

      // Mas é ESTRITAMENTE RECUSADO em operações restritas a admin (settings, purchases)
      await assertFails(set(ref(opDb, 'tenants/tenantA/settings/restricted_setting'), {
        secret: 123
      }));
      await assertFails(set(ref(opDb, 'tenants/tenantA/purchases/pur_restricted'), {
        id: 'pur_restricted',
        totalAmountCents: 5000
      }));
    });

    it('5. Token e perfil com tenants diferentes: acesso categoricamente recusado em ambos os tenants', async () => {
      const userCtx = testEnv.authenticatedContext('u_p136_conflict_tenants', { role: 'admin', tenantId: 'tenantB' });
      const adminACtx = testEnv.authenticatedContext('admin_A_setup_136', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminACtx.database();
      const db = userCtx.database();

      // Perfil no RTDB pertence a tenantA
      await assertSucceeds(set(ref(setupDb, 'users/u_p136_conflict_tenants'), {
        tenantId: 'tenantA',
        role: 'admin',
        displayName: 'Perfil Tenant A'
      }));

      // Tentativa de acessar tenantA (onde está o perfil): RECUSADO porque token tem tenantB
      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_hacked'), { id: 'p_hacked', name: 'X', salePriceCents: 10 }));

      // Tentativa de acessar tenantB (onde está o token): RECUSADO porque perfil aponta para tenantA
      await assertFails(get(ref(db, 'tenants/tenantB/products')));
      await assertFails(set(ref(db, 'tenants/tenantB/products/p_hacked'), { id: 'p_hacked', name: 'X', salePriceCents: 10 }));
    });

    it('6. Token somente com tenant (sem role): recusado em escritas operacionais e administrativas', async () => {
      const userCtx = testEnv.authenticatedContext('u_p136_token_tenant_only', { tenantId: 'tenantA' });
      const db = userCtx.database();

      // Leitura permitida
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));

      // Escrita em produtos recusada (falta role)
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_no_role_136'), {
        id: 'p_no_role_136',
        name: 'Produto Sem Role',
        salePriceCents: 100
      }));

      // Escrita em settings recusada
      await assertFails(set(ref(db, 'tenants/tenantA/settings/sys_136'), {
        key: 'val'
      }));
    });

    it('7. Token somente com role (sem tenantId): recusado em coleções de tenant sem perfil coerente', async () => {
      const userCtx = testEnv.authenticatedContext('u_p136_token_role_only', { role: 'admin' });
      const adminSetupCtx = testEnv.authenticatedContext('admin_setup_p136_t7', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminSetupCtx.database();
      const db = userCtx.database();

      // Sem perfil: recusado
      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_no_tid'), {
        id: 'p_no_tid',
        name: 'Prod',
        salePriceCents: 50
      }));

      // Com perfil que tem tenantId: tenantA, mas role: operator (criado por admin do tenant):
      // Não pode emprestar o role: admin do token para escrever em settings!
      await assertSucceeds(set(ref(setupDb, 'users/u_p136_token_role_only'), {
        tenantId: 'tenantA',
        role: 'operator',
        displayName: 'Operator Profile'
      }));

      // Como perfil é operator, settings exige admin no perfil quando token.tenantId == null
      await assertFails(set(ref(db, 'tenants/tenantA/settings/admin_setting'), { blocked: true }));
    });

    it('8. Ausência total de claims, com perfil válido: fallback do perfil opera estritamente pelo papel configurado', async () => {
      const opUserCtx = testEnv.authenticatedContext('u_p136_fallback_op');
      const adminSetupCtx = testEnv.authenticatedContext('admin_setup_p136_fb', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminSetupCtx.database();
      const opDb = opUserCtx.database();

      await assertSucceeds(set(ref(setupDb, 'users/u_p136_fallback_op'), {
        tenantId: 'tenantA',
        role: 'operator',
        displayName: 'Operador Fallback'
      }));

      // Leitura permitida via fallback do perfil
      await assertSucceeds(get(ref(opDb, 'tenants/tenantA/products')));

      // Escrita de operador (produtos) permitida
      await assertSucceeds(set(ref(opDb, 'tenants/tenantA/products/prod_fb_ok'), {
        id: 'prod_fb_ok',
        name: 'Produto Fallback',
        salePriceCents: 1200,
        version: 1
      }));

      // Escrita restrita de admin (settings) recusada
      await assertFails(set(ref(opDb, 'tenants/tenantA/settings/sys_fb'), { block: true }));
    });

    it('9. Ausência total de claims e de perfil: categoricamente recusado em todas as coleções de tenant', async () => {
      const anonCtx = testEnv.authenticatedContext('u_p136_ghost');
      const db = anonCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p1'), { id: 'p1', name: 'X', salePriceCents: 1 }));
      await assertFails(get(ref(db, 'tenants/tenantA/inventory')));
      await assertFails(set(ref(db, 'tenants/tenantA/settings/s1'), { s: 1 }));
    });

    it('10. Perfil com papel inválido é rejeitado em escritas de negócio', async () => {
      const userCtx = testEnv.authenticatedContext('u_p136_invalid_role');
      const adminCtx = testEnv.authenticatedContext('admin_setup_136_ir', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminCtx.database();
      const db = userCtx.database();

      await assertSucceeds(set(ref(setupDb, 'users/u_p136_invalid_role'), {
        tenantId: 'tenantA',
        role: 'guest_manager',
        displayName: 'Papel Invalido'
      }));

      // Leitura permitida por ter tenantId
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products')));

      // Escritas de operador/admin recusadas porque o papel não é nem admin nem operator
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_invalid'), {
        id: 'p_invalid',
        name: 'Tentativa',
        salePriceCents: 50
      }));
    });

    it('11. Tentativa de usar papel de administrador para acessar outro tenant é estritamente bloqueada', async () => {
      const adminACtx = testEnv.authenticatedContext('u_p136_admin_cross', { role: 'admin', tenantId: 'tenantA' });
      const db = adminACtx.database();

      await assertFails(get(ref(db, 'tenants/tenantB/products')));
      await assertFails(set(ref(db, 'tenants/tenantB/products/p_cross'), { id: 'p_cross', name: 'Cross', salePriceCents: 10 }));
      await assertFails(set(ref(db, 'tenants/tenantB/settings/sec'), { leaked: true }));
      await assertFails(set(ref(db, 'tenants/tenantB/inventory/mov_cross'), {
        id: 'mov_cross',
        productId: 'prod1',
        quantity: 1,
        delta: 1,
        type: 'IN'
      }));
    });

    it('12. Escritas legítimas dos papéis autorizados (admin em settings/purchases; operator em sales/inventory/products)', async () => {
      const adminCtx = testEnv.authenticatedContext('u_p136_legit_admin', { role: 'admin', tenantId: 'tenantA' });
      const opCtx = testEnv.authenticatedContext('u_p136_legit_op', { role: 'operator', tenantId: 'tenantA' });
      const adminDb = adminCtx.database();
      const opDb = opCtx.database();

      // Admin em settings e purchases
      await assertSucceeds(set(ref(adminDb, 'tenants/tenantA/settings/legit_setting'), { active: true }));
      await assertSucceeds(set(ref(adminDb, 'tenants/tenantA/purchases/pur_legit_136'), {
        id: 'pur_legit_136',
        totalAmountCents: 8500
      }));

      // Operador em sales, inventory e products
      await assertSucceeds(set(ref(opDb, 'tenants/tenantA/products/prod_legit_136'), {
        id: 'prod_legit_136',
        name: 'Produto Legítimo',
        salePriceCents: 2500,
        version: 1
      }));
      await assertSucceeds(set(ref(opDb, 'tenants/tenantA/sales/sale_legit_136'), {
        id: 'sale_legit_136',
        productId: 'prod_legit_136',
        quantity: 2,
        totalSaleCents: 5000
      }));
      await assertSucceeds(set(ref(opDb, 'tenants/tenantA/inventory/mov_legit_136'), {
        id: 'mov_legit_136',
        productId: 'prod_legit_136',
        quantity: 10,
        delta: 10,
        type: 'IN'
      }));

      // Operador impedido em settings
      await assertFails(set(ref(opDb, 'tenants/tenantA/settings/forbidden_for_op'), { val: 1 }));
    });

    it('13. Imutabilidade e validação de schema do ledger: append-only estrito, sem update, sem remove e delta validado', async () => {
      const opCtx = testEnv.authenticatedContext('u_p136_ledger_audit', { role: 'operator', tenantId: 'tenantA' });
      const db = opCtx.database();

      // Movimento válido aceito
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_audit_136'), {
        id: 'mov_audit_136',
        productId: 'prod_legit_136',
        quantity: 15,
        delta: 15,
        type: 'IN',
        unitCostCents: 450,
        notes: 'Lote de teste Phase 13.6',
        version: 1
      }));

      // Update recusado (append-only)
      await assertFails(update(ref(db, 'tenants/tenantA/inventory/mov_audit_136'), {
        quantity: 25
      }));

      // Remove recusado (append-only)
      await assertFails(remove(ref(db, 'tenants/tenantA/inventory/mov_audit_136')));

      // Relação semântica inválida recusada (IN com delta negativo)
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_in_neg_136'), {
        id: 'mov_in_neg_136',
        productId: 'prod_legit_136',
        quantity: 10,
        delta: -10,
        type: 'IN'
      }));

      // Campo desconhecido recusado ($other: false)
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_unknown_field_136'), {
        id: 'mov_unknown_field_136',
        productId: 'prod_legit_136',
        quantity: 5,
        delta: 5,
        type: 'IN',
        injectedMaliciousField: 'payload'
      }));
    });

    it('14. Acesso após remoção do perfil: distingue explicitamente usuários com claims vs sem claims', async () => {
      const adminCtx = testEnv.authenticatedContext('admin_offboarding_136', { role: 'admin', tenantId: 'tenantA' });
      const setupDb = adminCtx.database();

      // 14A. Usuário com Custom Claims no JWT
      const claimsUserCtx = testEnv.authenticatedContext('u_claims_offboarding_136', { role: 'operator', tenantId: 'tenantA' });
      const claimsDb = claimsUserCtx.database();

      // Perfil criado inicialmente
      await assertSucceeds(set(ref(setupDb, 'users/u_claims_offboarding_136'), {
        tenantId: 'tenantA',
        role: 'operator',
        displayName: 'Operador Com Claims'
      }));

      // Perfil é excluído pelo Admin
      await assertSucceeds(remove(ref(setupDb, 'users/u_claims_offboarding_136')));

      // Comprovação técnica: usuário COM claims continua com acesso às coleções do tenant até expirar o JWT
      await assertSucceeds(get(ref(claimsDb, 'tenants/tenantA/products')));
      await assertSucceeds(set(ref(claimsDb, 'tenants/tenantA/products/p_claims_post_delete'), {
        id: 'p_claims_post_delete',
        name: 'Produto Criado Com Token Ativo',
        salePriceCents: 999,
        version: 1
      }));

      // 14B. Usuário Sem Custom Claims (dependente do nó /users/uid)
      const fallbackUserCtx = testEnv.authenticatedContext('u_fallback_offboarding_136');
      const fallbackDb = fallbackUserCtx.database();

      // Perfil criado inicialmente
      await assertSucceeds(set(ref(setupDb, 'users/u_fallback_offboarding_136'), {
        tenantId: 'tenantA',
        role: 'operator',
        displayName: 'Operador Fallback'
      }));

      // Antes da exclusão: acesso funciona
      await assertSucceeds(get(ref(fallbackDb, 'tenants/tenantA/products')));

      // Perfil é excluído pelo Admin
      await assertSucceeds(remove(ref(setupDb, 'users/u_fallback_offboarding_136')));

      // Comprovação técnica: usuário SEM claims PERDE IMEDIATAMENTE o acesso ao RTDB
      await assertFails(get(ref(fallbackDb, 'tenants/tenantA/products')));
      await assertFails(set(ref(fallbackDb, 'tenants/tenantA/products/p_fallback_fail'), {
        id: 'p_fallback_fail',
        name: 'Deve Falhar',
        salePriceCents: 500
      }));
    });
  });

  // =========================================================================
  // PHASE 14.2 — VALIDAÇÃO DE TRANSIÇÃO DE CLAIMS E RETROCOMPATIBILIDADE RTDB
  // =========================================================================
  describe('PHASE 14.2 — Transição Canônica de Claims e Retrocompatibilidade RTDB', () => {
    beforeEach(async () => {
      // Seed inicial de tenantA e tenantB
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        const db = adminCtx.database();
        await set(ref(db, 'tenants/tenantA/products/p_seed_p14'), {
          id: 'p_seed_p14',
          name: 'Produto Base',
          salePriceCents: 1500
        });
        await set(ref(db, 'users/user_tenantA_target'), {
          displayName: 'Membro Tenant A',
          tenantId: 'tenantA',
          role: 'operator'
        });
      });
    });

    it('14.2.1: Token Novo Canônico (role: authenticated, appRole: admin) deve possuir privilégios administrativos plenos', async () => {
      const adminCtx = testEnv.authenticatedContext('u_p14_admin', {
        role: 'authenticated',
        appRole: 'admin',
        tenantId: 'tenantA'
      });
      const db = adminCtx.database();

      // Gravação em produtos
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/p_p14_new'), {
        id: 'p_p14_new',
        name: 'Produto Criado por Token Novo Admin',
        salePriceCents: 3200,
        version: 1
      }));

      // Gravação em compras (privilégio admin)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/purchases/pur_p14_new'), {
        id: 'pur_p14_new',
        totalAmountCents: 8500
      }));

      // Gravação em configurações (privilégio admin)
      await assertSucceeds(set(ref(db, 'tenants/tenantA/settings/loja'), {
        nomeFantasia: 'GestãoPro Staging'
      }));

      // Gravação de manifesto de imagens e sync metadata
      await assertSucceeds(set(ref(db, 'tenants/tenantA/imageManifest/img_p14'), {
        id: 'img_p14',
        productId: 'p_p14_new',
        url: 'https://test.supabase.co/img.webp',
        version: 1
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/syncMetadata'), {
        lastSync: Date.now()
      }));

      // Administração de usuários do mesmo tenant
      await assertSucceeds(get(ref(db, 'users/user_tenantA_target')));
      await assertSucceeds(update(ref(db, 'users/user_tenantA_target'), {
        displayName: 'Membro Tenant A Atualizado por Novo Admin'
      }));
    });

    it('14.2.2: Token Novo Canônico (role: authenticated, appRole: operator) deve operar catálogo e vendas, mas ser bloqueado em compras e configurações', async () => {
      const opCtx = testEnv.authenticatedContext('u_p14_op', {
        role: 'authenticated',
        appRole: 'operator',
        tenantId: 'tenantA'
      });
      const db = opCtx.database();

      // Permitido: produtos e vendas
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/p_p14_op'), {
        id: 'p_p14_op',
        name: 'Produto Operador Novo Token',
        salePriceCents: 1200,
        version: 1
      }));
      await assertSucceeds(set(ref(db, 'tenants/tenantA/sales/sale_p14_op'), {
        id: 'sale_p14_op',
        productId: 'p_p14_op',
        quantity: 1,
        totalSaleCents: 1200
      }));

      // Bloqueado: compras, configurações e administração de usuários
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_blocked_op'), {
        id: 'pur_blocked_op',
        totalAmountCents: 4000
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/settings/blocked'), {
        segredo: 'proibido'
      }));
      await assertFails(update(ref(db, 'users/user_tenantA_target'), {
        role: 'admin'
      }));
    });

    it('14.2.3: Token Novo Canônico (role: authenticated, appRole: viewer) deve ter acesso somente leitura', async () => {
      const viewerCtx = testEnv.authenticatedContext('u_p14_viewer', {
        role: 'authenticated',
        appRole: 'viewer',
        tenantId: 'tenantA'
      });
      const db = viewerCtx.database();

      // Leitura permitida
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products/p_seed_p14')));

      // Todas as gravações bloqueadas
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_viewer_fail'), {
        id: 'p_viewer_fail',
        name: 'Tentativa Viewer',
        salePriceCents: 100
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/sales/s_viewer_fail'), {
        id: 's_viewer_fail',
        productId: 'p_seed_p14',
        quantity: 1,
        totalSaleCents: 100
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_viewer_fail'), {
        id: 'pur_viewer_fail',
        totalAmountCents: 100
      }));
    });

    it('14.2.4: Token Novo Incompleto (role: authenticated sem appRole) deve falhar de forma segura sem conceder escrita', async () => {
      const incompleteCtx = testEnv.authenticatedContext('u_p14_incomplete', {
        role: 'authenticated',
        tenantId: 'tenantA'
      });
      const db = incompleteCtx.database();

      // Leitura do próprio tenant é permitida (membro autenticado)
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products/p_seed_p14')));

      // Gravação DEVE falhar de forma segura (sem concessão de escrita privilegiada)
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_incomplete_fail'), {
        id: 'p_incomplete_fail',
        name: 'Incompleto Deve Falhar',
        salePriceCents: 500
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_incomplete_fail'), {
        id: 'pur_incomplete_fail',
        totalAmountCents: 500
      }));
    });

    it('14.2.5: Token Novo com Papel Desconhecido (appRole: superadmin) deve ter gravação rejeitada', async () => {
      const unknownRoleCtx = testEnv.authenticatedContext('u_p14_unknown', {
        role: 'authenticated',
        appRole: 'superadmin',
        tenantId: 'tenantA'
      });
      const db = unknownRoleCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/products/p_unknown_fail'), {
        id: 'p_unknown_fail',
        name: 'Desconhecido Deve Falhar',
        salePriceCents: 500
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_unknown_fail'), {
        id: 'pur_unknown_fail',
        totalAmountCents: 500
      }));
    });

    it('14.2.6: Tokens legados sem appRole (role: admin e role: operator) têm escrita negada (cutover canônico)', async () => {
      // Admin legado sem appRole
      const legacyAdminCtx = testEnv.authenticatedContext('u_legacy_admin', {
        role: 'admin',
        tenantId: 'tenantA'
      });
      await assertFails(set(ref(legacyAdminCtx.database(), 'tenants/tenantA/products/p_legacy_admin'), {
        id: 'p_legacy_admin',
        name: 'Tentativa por Admin Legado',
        salePriceCents: 2000
      }));
      await assertFails(set(ref(legacyAdminCtx.database(), 'tenants/tenantA/purchases/pur_legacy_admin'), {
        id: 'pur_legacy_admin',
        totalAmountCents: 7000
      }));

      // Operator legado sem appRole
      const legacyOpCtx = testEnv.authenticatedContext('u_legacy_op', {
        role: 'operator',
        tenantId: 'tenantA'
      });
      await assertFails(set(ref(legacyOpCtx.database(), 'tenants/tenantA/products/p_legacy_op'), {
        id: 'p_legacy_op',
        name: 'Tentativa por Operador Legado',
        salePriceCents: 1800
      }));
      await assertFails(set(ref(legacyOpCtx.database(), 'tenants/tenantA/purchases/pur_legacy_op_fail'), {
        id: 'pur_legacy_op_fail',
        totalAmountCents: 3000
      }));
    });

    it('14.2.7: Token com claims conflitantes (role: admin e appRole: viewer) não eleva privilégio', async () => {
      const conflictCtx = testEnv.authenticatedContext('u_p14_conflict', {
        role: 'admin',
        appRole: 'viewer',
        tenantId: 'tenantA'
      });
      const db = conflictCtx.database();

      // Como appRole é viewer, o fallback para role legado é desativado e o acesso de escrita é negado
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_conflict_fail'), {
        id: 'p_conflict_fail',
        name: 'Conflito Deve Falhar',
        salePriceCents: 1000
      }));
    });

    it('14.2.8: Isolamento estrito entre tenants com novos tokens (rejeição de cross-tenant)', async () => {
      const adminTenantBCtx = testEnv.authenticatedContext('u_p14_admin_tenantB', {
        role: 'authenticated',
        appRole: 'admin',
        tenantId: 'tenantB'
      });
      const db = adminTenantBCtx.database();

      // Admin do Tenant B tentando ler ou alterar dados do Tenant A
      await assertFails(get(ref(db, 'tenants/tenantA/products/p_seed_p14')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_cross_fail'), {
        id: 'p_cross_fail',
        name: 'Invasão Cross-Tenant',
        salePriceCents: 100
      }));
    });

    it('14.2.9: Bloqueio de auto-elevação com appRole no próprio perfil', async () => {
      const userCtx = testEnv.authenticatedContext('u_self_elevation', {});
      const db = userCtx.database();

      // Tentativa de criar perfil contendo appRole
      await assertFails(set(ref(db, 'users/u_self_elevation'), {
        displayName: 'Atacante',
        appRole: 'admin'
      }));
    });

    it('14.3.1: Token conflitante/inválido (role: admin com appRole: superadmin) não obtém privilégios por fallback', async () => {
      const superadminCtx = testEnv.authenticatedContext('u_p14_superadmin_fail', {
        role: 'admin',
        appRole: 'superadmin',
        tenantId: 'tenantA'
      });
      const db = superadminCtx.database();

      // A presença de appRole não-nulo impede o fallback para auth.token.role.
      // Como 'superadmin' não é 'admin' nem 'operator', a escrita DEVE falhar.
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_superadmin_fail'), {
        id: 'p_superadmin_fail',
        name: 'Superadmin Não Permitido',
        salePriceCents: 1000
      }));
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_superadmin_fail'), {
        id: 'pur_superadmin_fail',
        totalAmountCents: 5000
      }));
    });

    it('14.3.2: Token conflitante/inválido (role: operator com appRole: invalid) não obtém privilégios por fallback', async () => {
      const badOpCtx = testEnv.authenticatedContext('u_p14_bad_op', {
        role: 'operator',
        appRole: 'invalid_role',
        tenantId: 'tenantA'
      });
      const db = badOpCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/products/p_bad_op_fail'), {
        id: 'p_bad_op_fail',
        name: 'Operador Inválido Falha',
        salePriceCents: 1000
      }));
    });

    it('14.3.3: Token legado com role: viewer pode ler mas não pode escrever no próprio tenant', async () => {
      const legacyViewerCtx = testEnv.authenticatedContext('u_p14_legacy_viewer', {
        role: 'viewer',
        tenantId: 'tenantA'
      });
      const db = legacyViewerCtx.database();

      // Leitura permitida para membro do tenant
      await assertSucceeds(get(ref(db, 'tenants/tenantA/products/p_seed_p14')));

      // Escrita negada
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_legacy_viewer_write'), {
        id: 'p_legacy_viewer_write',
        name: 'Viewer Não Pode Escrever',
        salePriceCents: 1000
      }));
    });

    it('14.3.4: Token sem tenantId (mesmo com appRole: admin) não pode acessar nem escrever em nós de tenant', async () => {
      const noTenantCtx = testEnv.authenticatedContext('u_p14_no_tenant', {
        role: 'authenticated',
        appRole: 'admin'
        // tenantId ausente
      });
      const db = noTenantCtx.database();

      await assertFails(get(ref(db, 'tenants/tenantA/products/p_seed_p14')));
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_no_tenant_fail'), {
        id: 'p_no_tenant_fail',
        name: 'Sem Tenant Falha',
        salePriceCents: 1000
      }));
    });

    it('14.3.5: Escrita em nós protegidos (movimento de inventário) exige schema e delta estritos', async () => {
      const canonicalAdminCtx = testEnv.authenticatedContext('u_p14_admin_ledger', {
        role: 'authenticated',
        appRole: 'admin',
        tenantId: 'tenantA'
      });
      const db = canonicalAdminCtx.database();

      // Movimento de estoque com schema incompleto ou delta inconsistente deve ser rejeitado
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_invalid'), {
        id: 'mov_invalid',
        productId: 'p_seed_p14',
        type: 'IN',
        quantity: 10,
        delta: 5 // delta deve ser igual a quantity para tipo IN
      }));
    });

    it('14.4.1: Token com appRole: null tem escrita protegida categoricamente negada (gap de privilégio eliminado no RTDB)', async () => {
      // No RTDB com regras canônicas estritas (Phase 14.5), auth.token.appRole === 'admin' é estritamente exigido.
      // O valor null NÃO satisfaz a condição canônica e não possui mais fallback para auth.token.role.
      const nullAppRoleCtx = testEnv.authenticatedContext('u_p14_null_approle', {
        role: 'admin',
        appRole: null,
        tenantId: 'tenantA'
      });
      const db = nullAppRoleCtx.database();

      // Escrita em produtos DEVE falhar
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_null_approle_fail'), {
        id: 'p_null_approle_fail',
        name: 'Produto Null AppRole RTDB Rejeitado',
        salePriceCents: 1500
      }));
      // Escrita em compras DEVE falhar
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_null_approle_fail'), {
        id: 'pur_null_approle_fail',
        totalAmountCents: 5000
      }));
    });

    it('14.4.2: RTDB Semântica: Token com appRole vazio ("") avalia auth.token.appRole == null como falso e tem escrita rejeitada (fail-closed)', async () => {
      // Quando appRole está presente com string vazia "", auth.token.appRole == null é falso!
      const emptyAppRoleCtx = testEnv.authenticatedContext('u_p14_empty_approle', {
        role: 'admin',
        appRole: '',
        tenantId: 'tenantA'
      });
      const db = emptyAppRoleCtx.database();

      await assertFails(set(ref(db, 'tenants/tenantA/products/p_empty_approle_fail'), {
        id: 'p_empty_approle_fail',
        name: 'Produto Empty AppRole Falha',
        salePriceCents: 1500
      }));
    });

    it('14.5.1: Leitura administrativa em /users/$uid: membro canônico admin pode ler outro perfil do mesmo tenant, mas token legado ou sem appRole é negado', async () => {
      // Seed de um usuário no tenantA
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), 'users/user_alvo_tenantA'), {
          displayName: 'Usuário Alvo',
          tenantId: 'tenantA',
          role: 'operator'
        });
      });

      // Admin canônico com appRole: admin e tenantId: tenantA
      const canonicalAdminCtx = testEnv.authenticatedContext('u_p14_canonical_reader', {
        role: 'authenticated',
        appRole: 'admin',
        tenantId: 'tenantA'
      });
      await assertSucceeds(get(ref(canonicalAdminCtx.database(), 'users/user_alvo_tenantA')));

      // Token legado com role: admin mas sem appRole
      const legacyAdminCtx = testEnv.authenticatedContext('u_legacy_reader_fail', {
        role: 'admin',
        tenantId: 'tenantA'
      });
      await assertFails(get(ref(legacyAdminCtx.database(), 'users/user_alvo_tenantA')));

      // Token com role: admin e appRole: null
      const nullAppRoleCtx = testEnv.authenticatedContext('u_p14_null_reader_fail', {
        role: 'admin',
        appRole: null,
        tenantId: 'tenantA'
      });
      await assertFails(get(ref(nullAppRoleCtx.database(), 'users/user_alvo_tenantA')));
    });
  });

  describe('PHASE 14.12 — RTDB Security Rules: Identity Immutability, Version Monotonicity & Ledger Integrity', () => {
    const adminCtx = () => testEnv.authenticatedContext('admin_p14_12', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const operatorCtx = () => testEnv.authenticatedContext('op_p14_12', { role: 'authenticated', appRole: 'operator', tenantId: 'tenantA' });

    it('14.12.1: Produto com id divergente da chave ($productId) é rejeitado', async () => {
      const db = adminCtx().database();
      await assertFails(set(ref(db, 'tenants/tenantA/products/p_prod_key_1'), {
        id: 'p_prod_key_DIFFERENT',
        name: 'Produto Chave Incompatível',
        salePriceCents: 1500,
        version: 1
      }));
    });

    it('14.12.2: Produto com id idêntico à chave é aceito e inicializado', async () => {
      const db = adminCtx().database();
      await assertSucceeds(set(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        id: 'p_prod_key_valid',
        name: 'Produto Válido',
        salePriceCents: 1500,
        version: 1
      }));
    });

    it('14.12.3: Atualização de produto alterando o id é estritamente rejeitada (imutabilidade de identidade)', async () => {
      const db = adminCtx().database();
      await set(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        id: 'p_prod_key_valid',
        name: 'Produto Válido',
        salePriceCents: 1500,
        version: 1
      });
      await assertFails(update(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        id: 'p_prod_key_MUTATED'
      }));
    });

    it('14.12.4: Atualização de produto incrementando versão (v1 -> v2) é permitida', async () => {
      const db = adminCtx().database();
      await set(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        id: 'p_prod_key_valid',
        name: 'Produto Válido',
        salePriceCents: 1500,
        version: 1
      });
      await assertSucceeds(update(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        salePriceCents: 2000,
        baseVersion: 1,
        version: 2
      }));
    });

    it('14.12.5: Retrocesso de versão de produto (v2 -> v1) é categoricamente rejeitado pelas regras RTDB', async () => {
      const db = adminCtx().database();
      await set(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        id: 'p_prod_key_valid',
        name: 'Produto Válido',
        salePriceCents: 2000,
        version: 1
      });
      await update(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        baseVersion: 1,
        version: 2
      });
      await assertFails(update(ref(db, 'tenants/tenantA/products/p_prod_key_valid'), {
        salePriceCents: 2500,
        version: 1
      }));
    });

    it('14.12.6: Venda com id divergente da chave é rejeitada', async () => {
      const db = operatorCtx().database();
      await assertFails(set(ref(db, 'tenants/tenantA/sales/sale_key_1'), {
        id: 'sale_mismatch',
        productId: 'p_prod_key_valid',
        quantity: 1,
        totalSaleCents: 1500
      }));
    });

    it('14.12.7: Venda válida com id correspondente à chave é aceita', async () => {
      const db = operatorCtx().database();
      await assertSucceeds(set(ref(db, 'tenants/tenantA/sales/sale_key_valid'), {
        id: 'sale_key_valid',
        productId: 'p_prod_key_valid',
        quantity: 2,
        totalSaleCents: 3000
      }));
    });

    it('14.12.8: Tentativa de alterar productId de venda existente é rejeitada (imutabilidade comercial)', async () => {
      const db = adminCtx().database();
      await set(ref(db, 'tenants/tenantA/sales/sale_key_valid'), {
        id: 'sale_key_valid',
        productId: 'p_prod_key_valid',
        quantity: 2,
        totalSaleCents: 3000
      });
      await assertFails(update(ref(db, 'tenants/tenantA/sales/sale_key_valid'), {
        productId: 'p_another_product'
      }));
    });

    it('14.12.9: Compra com id divergente da chave é rejeitada', async () => {
      const db = adminCtx().database();
      await assertFails(set(ref(db, 'tenants/tenantA/purchases/pur_key_1'), {
        id: 'pur_mismatch',
        productId: 'p_prod_key_valid',
        quantity: 10,
        totalAmountCents: 5000
      }));
    });

    it('14.12.10: Compra válida com id correspondente à chave é aceita e id não pode ser alterado', async () => {
      const db = adminCtx().database();
      await assertSucceeds(set(ref(db, 'tenants/tenantA/purchases/pur_key_valid'), {
        id: 'pur_key_valid',
        productId: 'p_prod_key_valid',
        quantity: 10,
        totalAmountCents: 5000
      }));

      // Tentativa de alterar o id da compra
      await assertFails(update(ref(db, 'tenants/tenantA/purchases/pur_key_valid'), {
        id: 'pur_tampered'
      }));
    });

    it('14.12.11: Movimento de estoque append-only: criação aceita, mas sobrescrita, update ou deleção rejeitados', async () => {
      const db = operatorCtx().database();
      const movPayload = {
        id: 'mov_p14_12_strict',
        productId: 'p_prod_key_valid',
        delta: 5,
        type: 'IN',
        quantity: 5,
        date: '2026-10-11'
      };

      // 1. Criação no ledger: aceita
      await assertSucceeds(set(ref(db, 'tenants/tenantA/inventory/mov_p14_12_strict'), movPayload));

      // 2. Tentativa de sobrescrever com set: rejeitada (append-only)
      await assertFails(set(ref(db, 'tenants/tenantA/inventory/mov_p14_12_strict'), {
        ...movPayload,
        quantity: 10,
        delta: 10
      }));

      // 3. Tentativa de modificar via update: rejeitada
      await assertFails(update(ref(db, 'tenants/tenantA/inventory/mov_p14_12_strict'), {
        quantity: 99
      }));

      // 4. Tentativa de deletar via remove: rejeitada
      await assertFails(remove(ref(db, 'tenants/tenantA/inventory/mov_p14_12_strict')));
    });
  });

  describe('PHASE 14.12 — Real Concurrency & Atomic Transaction Suite in RTDB Emulator', () => {
    const clientAdmin1 = () => testEnv.authenticatedContext('admin_client_1', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const clientAdmin2 = () => testEnv.authenticatedContext('admin_client_2', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const clientTenantB = () => testEnv.authenticatedContext('admin_tenant_b', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantB' });

    it('14.12.12: Dois clientes tentando criar o mesmo ID com dados divergentes: exatamente um comita, o segundo aborta por conflito sem sobrescrever', async () => {
      const db1 = clientAdmin1().database();
      const db2 = clientAdmin2().database();
      const path = 'tenants/tenantA/products/p_race_divergent_1';

      const payload1 = { id: 'p_race_divergent_1', name: 'Item Original', salePriceCents: 1000, version: 1 };
      const payload2 = { id: 'p_race_divergent_1', name: 'Item Concorrente', salePriceCents: 2000, version: 1 };

      const runCreateTx = async (db, payload) => {
        let abortReason = null;
        const txResult = await runTransaction(ref(db, path), (current) => {
          if (current === null) {
            return { ...payload };
          }
          if (arePayloadsEquivalent('products', payload, current)) {
            abortReason = 'EQUIVALENT';
            return undefined;
          }
          abortReason = 'DIVERGENT';
          return undefined;
        }, { applyLocally: false });
        return { txResult, abortReason };
      };

      // Dispara simultaneamente
      const [res1, res2] = await Promise.all([
        runCreateTx(db1, payload1),
        runCreateTx(db2, payload2)
      ]);

      // Exatamente um comitou
      const committedCount = (res1.txResult.committed ? 1 : 0) + (res2.txResult.committed ? 1 : 0);
      expect(committedCount).toBe(1);

      // O que não comitou detectou divergência
      const uncommitted = res1.txResult.committed ? res2 : res1;
      expect(uncommitted.abortReason).toBe('DIVERGENT');

      // Estado final no banco no emulador é o do vencedor
      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.exists()).toBe(true);
      const winnerPayload = res1.txResult.committed ? payload1 : payload2;
      expect(finalSnap.val().salePriceCents).toBe(winnerPayload.salePriceCents);
      expect(finalSnap.val().name).toBe(winnerPayload.name);
    });

    it('14.12.13: Duas criações com o mesmo ID e conteúdo equivalente: segundo reconhece já aplicado sem segundo efeito', async () => {
      const db1 = clientAdmin1().database();
      const db2 = clientAdmin2().database();
      const path = 'tenants/tenantA/products/p_race_equiv_1';

      const payload = { id: 'p_race_equiv_1', name: 'Item Idêntico', salePriceCents: 1500, version: 1 };

      const runCreateTx = async (db) => {
        let abortReason = null;
        const txResult = await runTransaction(ref(db, path), (current) => {
          if (current === null) {
            return { ...payload };
          }
          if (arePayloadsEquivalent('products', payload, current)) {
            abortReason = 'EQUIVALENT';
            return undefined;
          }
          abortReason = 'DIVERGENT';
          return undefined;
        }, { applyLocally: false });
        return { txResult, abortReason };
      };

      const res1 = await runCreateTx(db1);
      expect(res1.txResult.committed).toBe(true);

      const res2 = await runCreateTx(db2);
      expect(res2.txResult.committed).toBe(false);
      expect(res2.abortReason).toBe('EQUIVALENT');

      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().salePriceCents).toBe(1500);
      expect(finalSnap.val().version).toBe(1);
    });

    it('14.12.14: Atualização concorrente baseada na mesma versão base: primeiro incrementa para v2, segundo detecta conflito e aborta', async () => {
      const db1 = clientAdmin1().database();
      const db2 = clientAdmin2().database();
      const path = 'tenants/tenantA/products/p_race_version_1';

      // Cria estado base v1
      await set(ref(db1, path), {
        id: 'p_race_version_1',
        name: 'Item Base',
        salePriceCents: 1000,
        version: 1
      });

      const runUpdateTx = async (db, expectedBase, newPrice) => {
        let abortReason = null;
        const txResult = await runTransaction(ref(db, path), (current) => {
          if (current === null) {
            // Ciclo preliminar local: propõe mutação com próxima versão para sincronizar com servidor
            return {
              id: 'p_race_version_1',
              name: 'Item Base',
              salePriceCents: newPrice,
              baseVersion: expectedBase,
              version: expectedBase + 1
            };
          }
          if ((current.version || 1) !== expectedBase) {
            abortReason = 'VERSION_CONFLICT';
            return undefined;
          }
          return {
            ...current,
            salePriceCents: newPrice,
            baseVersion: expectedBase,
            version: current.version + 1
          };
        }, { applyLocally: false });
        return { txResult, abortReason };
      };

      // Ambos disparam atualização concorrente esperando baseVersion 1
      const [res1, res2] = await Promise.all([
        runUpdateTx(db1, 1, 2000),
        runUpdateTx(db2, 1, 3000)
      ]);

      const committedCount = (res1.txResult.committed ? 1 : 0) + (res2.txResult.committed ? 1 : 0);
      expect(committedCount).toBe(1);

      const uncommitted = res1.txResult.committed ? res2 : res1;
      expect(uncommitted.abortReason).toBe('VERSION_CONFLICT');

      // Estado final está na versão 2 com o valor do vencedor
      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBe(2);
      const winningPrice = res1.txResult.committed ? 2000 : 3000;
      expect(finalSnap.val().salePriceCents).toBe(winningPrice);
    });

    it('14.12.15: Atualização tardia (stale update) após confirmação prévia é rejeitada sem tocar no banco', async () => {
      const db1 = clientAdmin1().database();
      const db2 = clientAdmin2().database();
      const path = 'tenants/tenantA/products/p_stale_upd_1';

      // Record já foi atualizado para v3
      await set(ref(db1, path), {
        id: 'p_stale_upd_1',
        name: 'Item Avançado',
        salePriceCents: 4000,
        version: 1
      });
      await update(ref(db1, path), {
        baseVersion: 1,
        version: 2
      });
      await update(ref(db1, path), {
        baseVersion: 2,
        version: 3
      });

      // Cliente 2 envia update baseado na v1 defasada
      let abortReason = null;
      const txResult = await runTransaction(ref(db2, path), (current) => {
        if (!current || (current.version || 1) !== 1) {
          abortReason = 'VERSION_CONFLICT';
          return undefined;
        }
        return { ...current, salePriceCents: 5000, version: 2 };
      }, { applyLocally: false });

      expect(txResult.committed).toBe(false);
      expect(abortReason).toBe('VERSION_CONFLICT');

      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBe(3);
      expect(finalSnap.val().salePriceCents).toBe(4000);
    });

    it('14.12.16: Cliente lê registro v1 e tenta sobrescrever após alteração concorrente: rejeitado atomicamente', async () => {
      const db1 = clientAdmin1().database();
      const db2 = clientAdmin2().database();
      const path = 'tenants/tenantA/products/p_read_modify_write_1';

      await set(ref(db1, path), {
        id: 'p_read_modify_write_1',
        name: 'Item Lido',
        salePriceCents: 1000,
        version: 1
      });

      // Cliente 1 lê o registro
      const snapshotRead = await get(ref(db1, path));
      const readVersion = snapshotRead.val().version;
      expect(readVersion).toBe(1);

      // Enquanto cliente 1 prepara mutação, Cliente 2 altera no servidor para v2
      await update(ref(db2, path), {
        salePriceCents: 1800,
        baseVersion: 1,
        version: 2
      });

      // Cliente 1 tenta enviar mutação condicional à versão lida (readVersion: 1)
      let abortReason = null;
      const txResult = await runTransaction(ref(db1, path), (current) => {
        if (!current || current.version !== readVersion) {
          abortReason = 'VERSION_CONFLICT';
          return undefined;
        }
        return { ...current, salePriceCents: 2500, version: readVersion + 1 };
      }, { applyLocally: false });

      expect(txResult.committed).toBe(false);
      expect(abortReason).toBe('VERSION_CONFLICT');

      // Estado remoto foi preservado intacto na alteração do cliente 2
      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBe(2);
      expect(finalSnap.val().salePriceCents).toBe(1800);
    });

    it('14.12.17: Tentativa de transação por tenant incompatível é negada pelas regras de segurança', async () => {
      const dbB = clientTenantB().database();
      const path = 'tenants/tenantA/products/p_cross_tenant_tx';

      await assertFails(runTransaction(ref(dbB, path), () => ({
        id: 'p_cross_tenant_tx',
        name: 'Injeção Ilegítima',
        salePriceCents: 9999,
        version: 1
      }), { applyLocally: false }));
    });
  });

  // =========================================================================
  // FASE 14.13 — SERVER-SIDE VERSION ENFORCEMENT & DIRECT-WRITE RESISTANCE
  // =========================================================================
  describe('PHASE 14.13 — Server-Side Version Enforcement, Direct-Write Resistance & Legacy Mutation Safety', () => {
    const admin1 = () => testEnv.authenticatedContext('admin_p1413_1', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const admin2 = () => testEnv.authenticatedContext('admin_p1413_2', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const operator1 = () => testEnv.authenticatedContext('op_p1413_1', { role: 'authenticated', appRole: 'operator', tenantId: 'tenantA' });
    const tenantBClient = () => testEnv.authenticatedContext('admin_p1413_b', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantB' });

    it('14.13.1: Criação válida de produto na versão inicial (version: 1) via set() direto', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_valid_1';
      const payload = {
        id: 'p_p1413_valid_1',
        name: 'Produto Inicial 14.13',
        salePriceCents: 1500,
        version: 1
      };

      await assertSucceeds(set(ref(db, path), payload));
      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(1);
      expect(snap.val().salePriceCents).toBe(1500);
      expect(snap.val().name).toBe('Produto Inicial 14.13');
    });

    it('14.13.2: Tentativa de criar novamente registro existente com payload divergente via set() é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_dup_create';

      // 1. Criação legítima inicial v1
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_dup_create',
        name: 'Produto Inicial Legítimo',
        salePriceCents: 1500,
        version: 1
      }));

      // 2. Registro já existe em v1. Tentativa de chamar set() com versão inicial 1 e dados divergentes
      await assertFails(set(ref(db, path), {
        id: 'p_p1413_dup_create',
        name: 'Sobrescrita Divergente Ilegítima',
        salePriceCents: 9999,
        version: 1
      }));

      // Estado remoto anterior permaneceu 100% intacto
      const snap = await get(ref(db, path));
      expect(snap.val().name).toBe('Produto Inicial Legítimo');
      expect(snap.val().salePriceCents).toBe(1500);
      expect(snap.val().version).toBe(1);
    });

    it('14.13.3: Tentativa de alterar payload mantendo a mesma versão (v1 -> v1) é estritamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_same_ver';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_same_ver',
        name: 'Produto Original',
        salePriceCents: 1500,
        version: 1
      }));

      // Tentativa de update modificando o preço mas conservando version: 1
      await assertFails(update(ref(db, path), {
        salePriceCents: 2500,
        baseVersion: 1,
        version: 1
      }));

      // Tentativa de update modificando apenas campos de negócio sem avançar versão nem baseVersion
      await assertFails(update(ref(db, path), {
        name: 'Nome Alterado Mas Mesma Versao'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().salePriceCents).toBe(1500);
      expect(snap.val().name).toBe('Produto Original');
      expect(snap.val().version).toBe(1);
    });

    it('14.13.4: Tentativa de pular versões (v1 diretamente para v3) é categoricamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_jump_ver';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_jump_ver',
        name: 'Produto Base',
        salePriceCents: 1500,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 1,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
      expect(snap.val().salePriceCents).toBe(1500);
    });

    it('14.13.5: Atualização canônica com baseVersion correspondente e incremento exato (v1 -> v2) é aceita', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_canonical_upd';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_canonical_upd',
        name: 'Produto Base',
        salePriceCents: 1500,
        version: 1
      }));

      await assertSucceeds(update(ref(db, path), {
        salePriceCents: 2200,
        name: 'Produto Atualizado v2',
        baseVersion: 1,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().baseVersion).toBe(1);
      expect(snap.val().salePriceCents).toBe(2200);
      expect(snap.val().name).toBe('Produto Atualizado v2');
    });

    it('14.13.6: Atualização com baseVersion obsoleta é rejeitada (proteção contra conflito concorrente tardio)', async () => {
      const db = admin2().database();
      const path = 'tenants/tenantA/products/p_p1413_stale_ver';

      await assertSucceeds(set(ref(admin1().database(), path), {
        id: 'p_p1413_stale_ver',
        name: 'Produto em v2',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(admin1().database(), path), {
        baseVersion: 1,
        version: 2
      }));

      // Registro remoto está em v2. Cliente tenta enviar mutação informando baseVersion: 1
      await assertFails(update(ref(db, path), {
        salePriceCents: 3500,
        baseVersion: 1,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2200);
    });

    it('14.13.7: Atualização com baseVersion arbitrariamente superior é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_future_ver';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_future_ver',
        name: 'Produto em v2',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      // Remoto está em v2. Cliente tenta baseVersion fictícia 99
      await assertFails(update(ref(db, path), {
        salePriceCents: 4500,
        baseVersion: 99,
        version: 100
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2200);
    });

    it('14.13.8: Tentativa de alterar a identidade (id) do produto existente na atualização é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_id_immut';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_id_immut',
        name: 'Produto em v2',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      await assertFails(update(ref(db, path), {
        id: 'p_p1413_tampered_id',
        baseVersion: 2,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().id).toBe('p_p1413_id_immut');
      expect(snap.val().version).toBe(2);
    });

    it('14.13.9: Atualização direta com tenant incompatível é categoricamente negada', async () => {
      const dbAdmin = admin1().database();
      const dbB = tenantBClient().database();
      const path = 'tenants/tenantA/products/p_p1413_cross_tenant';

      await assertSucceeds(set(ref(dbAdmin, path), {
        id: 'p_p1413_cross_tenant',
        name: 'Produto Tenant A',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(dbAdmin, path), {
        baseVersion: 1,
        version: 2
      }));

      await assertFails(update(ref(dbB, path), {
        salePriceCents: 9999,
        baseVersion: 2,
        version: 3
      }));

      const snap = await get(ref(dbAdmin, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2200);
    });

    it('14.13.10: Tentativa de retroceder versão (v2 -> v1) é estritamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_regress';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_regress',
        name: 'Produto em v2',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      await assertFails(update(ref(db, path), {
        salePriceCents: 1100,
        baseVersion: 2,
        version: 1
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2200);
    });

    it('14.13.11: Movimento de estoque no ledger append-only não pode ser sobrescrito nem removido', async () => {
      const db = operator1().database();
      const movPath = 'tenants/tenantA/inventory/mov_p1413_strict_ledger';
      const movData = {
        id: 'mov_p1413_strict_ledger',
        productId: 'p_prod_ledger_ref',
        quantity: 10,
        delta: 10,
        type: 'IN',
        date: '2026-10-12'
      };

      // Criação legítima no ledger append-only
      await assertSucceeds(set(ref(db, movPath), movData));

      // Tentativa de sobrescrever via set()
      await assertFails(set(ref(db, movPath), {
        ...movData,
        quantity: 20,
        delta: 20
      }));

      // Tentativa de modificar via update()
      await assertFails(update(ref(db, movPath), {
        quantity: 99,
        delta: 99
      }));

      // Tentativa de remover via remove()
      await assertFails(remove(ref(db, movPath)));

      const snap = await get(ref(db, movPath));
      expect(snap.exists()).toBe(true);
      expect(snap.val().quantity).toBe(10);
      expect(snap.val().delta).toBe(10);
    });

    it('14.13.12: Vendas: campos comerciais imutáveis não podem ser alterados e remoção física é proibida', async () => {
      const db = operator1().database();
      const salePath = 'tenants/tenantA/sales/sale_p1413_strict';
      const saleData = {
        id: 'sale_p1413_strict',
        productId: 'p_prod_sale_ref',
        quantity: 2,
        totalSaleCents: 4400,
        unitSalePriceCents: 2200,
        unitCostCents: 1000,
        date: '2026-10-12T09:00:00Z'
      };

      // 1. Criação válida de venda
      await assertSucceeds(set(ref(db, salePath), saleData));

      // 2. Tentativa de alterar totalSaleCents (fraude de valor)
      await assertFails(update(ref(db, salePath), {
        totalSaleCents: 100
      }));

      // 3. Tentativa de alterar quantidade
      await assertFails(update(ref(db, salePath), {
        quantity: 10
      }));

      // 4. Tentativa de alterar unitSalePriceCents ou unitCostCents
      await assertFails(update(ref(db, salePath), {
        unitSalePriceCents: 50
      }));

      // 5. Tentativa de alterar data
      await assertFails(update(ref(db, salePath), {
        date: '2025-01-01T00:00:00Z'
      }));

      // 6. Tentativa de exclusão física via remove()
      await assertFails(remove(ref(db, salePath)));

      // 7. Atualização comercial permitida: cancelamento/estorno com registro de motivo
      await assertSucceeds(update(ref(db, salePath), {
        cancelledAt: '2026-10-12T10:00:00Z',
        cancelReason: 'Desistência do cliente',
        notes: 'Estorno aprovado'
      }));

      // Estado final confirma imutabilidade dos campos financeiros
      const snap = await get(ref(db, salePath));
      expect(snap.val().totalSaleCents).toBe(4400);
      expect(snap.val().quantity).toBe(2);
      expect(snap.val().cancelledAt).toBe('2026-10-12T10:00:00Z');
      expect(snap.val().cancelReason).toBe('Desistência do cliente');
    });

    it('14.13.13: Compras: campos comerciais imutáveis não podem ser alterados e remoção física é proibida', async () => {
      const db = admin1().database();
      const purPath = 'tenants/tenantA/purchases/pur_p1413_strict';
      const purData = {
        id: 'pur_p1413_strict',
        productId: 'p_prod_pur_ref',
        supplierId: 'sup_p1413_1',
        quantity: 50,
        totalAmountCents: 50000,
        date: '2026-10-12T08:00:00Z'
      };

      // 1. Criação de compra (exclusiva de admin)
      await assertSucceeds(set(ref(db, purPath), purData));

      // 2. Tentativa de alterar totalAmountCents
      await assertFails(update(ref(db, purPath), {
        totalAmountCents: 1000
      }));

      // 3. Tentativa de alterar productId ou quantity
      await assertFails(update(ref(db, purPath), {
        productId: 'another_product'
      }));
      await assertFails(update(ref(db, purPath), {
        quantity: 5
      }));

      // 4. Tentativa de remoção física via remove()
      await assertFails(remove(ref(db, purPath)));

      // 5. Atualização comercial permitida: cancelamento/estorno
      await assertSucceeds(update(ref(db, purPath), {
        cancelledAt: '2026-10-12T11:00:00Z',
        cancelReason: 'Erro na nota fiscal de entrada'
      }));

      const snap = await get(ref(db, purPath));
      expect(snap.val().totalAmountCents).toBe(50000);
      expect(snap.val().quantity).toBe(50);
      expect(snap.val().cancelledAt).toBe('2026-10-12T11:00:00Z');
    });

    it('14.13.14: Atualização de produto legada sem baseVersion é rejeitada pelo servidor', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_no_basever';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_no_basever',
        name: 'Produto em v2',
        salePriceCents: 2200,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      // Produto está na v2. Cliente legado envia mutação contendo version: 3 mas sem baseVersion
      await assertFails(update(ref(db, path), {
        salePriceCents: 2600,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2200);
    });

    it('14.13.15: Tentativa de gravação em nós ancestrais ou múltiplos caminhos é bloqueada', async () => {
      const db = admin1().database();

      // Gravação direta no nó ancestral /tenants/tenantA
      await assertFails(set(ref(db, 'tenants/tenantA'), {
        hacked: true
      }));

      // Gravação no nó /tenants/tenantA/products diretamente
      await assertFails(set(ref(db, 'tenants/tenantA/products'), {
        p_all_hacked: { name: 'Root Override' }
      }));

      // Multi-path update no caminho ancestral
      await assertFails(update(ref(db, 'tenants/tenantA'), {
        'products/p_multipath_hack/name': 'Bypass'
      }));
    });

    it('14.13.16: Tentativa de exclusão física de produto por operador é rejeitada pelas regras', async () => {
      const adminDb = admin1().database();
      const opDb = operator1().database();
      const path = 'tenants/tenantA/products/p_p1413_op_del';

      // Seed produto legítimo via admin
      await assertSucceeds(set(ref(adminDb, path), {
        id: 'p_p1413_op_del',
        name: 'Produto Teste Delecao',
        salePriceCents: 2000,
        version: 1
      }));
      await assertSucceeds(update(ref(adminDb, path), {
        baseVersion: 1,
        version: 2
      }));

      // Operador tenta physical remove()
      await assertFails(remove(ref(opDb, path)));

      // Produto permanece preservado
      const snap = await get(ref(adminDb, path));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(2);
    });

    it('14.13.17: Exclusão lógica canônica via update com deletedAt incrementa versão e mantém registro seguro', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1413_soft_del';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1413_soft_del',
        name: 'Produto para Soft Delete',
        salePriceCents: 2000,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      // Soft delete canônico: preserva registro com deletedAt, baseVersion: 2, version: 3
      await assertSucceeds(update(ref(db, path), {
        deletedAt: new Date().toISOString(),
        baseVersion: 2,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(3);
      expect(snap.val().baseVersion).toBe(2);
      expect(snap.val().deletedAt).toBeDefined();
    });

    it('14.13.18: Disputa concorrente entre dois clientes autorizados na mesma versão: exatamente um vence e o segundo falha', async () => {
      const db1 = admin1().database();
      const db2 = admin2().database();
      const path = 'tenants/tenantA/products/p_p1413_race_direct';

      // Cria produto v1
      await set(ref(db1, path), {
        id: 'p_p1413_race_direct',
        name: 'Item Race Direct',
        salePriceCents: 1000,
        version: 1
      });

      // Cliente 1 e Cliente 2 tentam avançar concorrentemente de baseVersion: 1 para version: 2
      const updateClient = async (db, price) => {
        let abortReason = null;
        const txResult = await runTransaction(ref(db, path), (current) => {
          if (current === null) {
            return {
              id: 'p_p1413_race_direct',
              name: 'Item Race Direct',
              salePriceCents: price,
              baseVersion: 1,
              version: 2
            };
          }
          if (current.version !== 1) {
            abortReason = 'VERSION_CONFLICT';
            return undefined;
          }
          return {
            ...current,
            salePriceCents: price,
            baseVersion: 1,
            version: 2
          };
        }, { applyLocally: false });
        return { txResult, abortReason };
      };

      const [res1, res2] = await Promise.all([
        updateClient(db1, 2000),
        updateClient(db2, 3000)
      ]);

      const committedCount = (res1.txResult.committed ? 1 : 0) + (res2.txResult.committed ? 1 : 0);
      expect(committedCount).toBe(1);

      const rejected = res1.txResult.committed ? res2 : res1;
      expect(rejected.abortReason).toBe('VERSION_CONFLICT');

      // Estado remoto está exatamente na versão 2 com o valor vencedor
      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBe(2);
      expect(finalSnap.val().baseVersion).toBe(1);
      const winningPrice = res1.txResult.committed ? 2000 : 3000;
      expect(finalSnap.val().salePriceCents).toBe(winningPrice);

      // Agora, o cliente perdedor (ou qualquer outro) tentando aplicar mutação com a v1 antiga é rejeitado pelo servidor
      await assertFails(update(ref(db2, path), {
        salePriceCents: 9999,
        baseVersion: 1,
        version: 2
      }));
    });
  });

  describe('PHASE 14.14 — End-to-End Version Contract, Legacy Bootstrap & BaseVersion Integrity', () => {
    const admin1 = () => testEnv.authenticatedContext('admin_p1414_1', {
      role: 'authenticated',
      appRole: 'admin',
      tenantId: 'tenantA'
    });

    const admin2 = () => testEnv.authenticatedContext('admin_p1414_2', {
      role: 'authenticated',
      appRole: 'admin',
      tenantId: 'tenantA'
    });

    it('14.14.1: Validação de escopo: regras de produto avaliadas no caminho $productId e bloqueiam escritas em nós ancestrais', async () => {
      const db = admin1().database();
      await assertFails(set(ref(db, 'tenants/tenantA'), { hacker: true }));
      await assertFails(set(ref(db, 'tenants/tenantA/products'), { p1: { name: 'Hack' } }));
    });

    it('14.14.2: Criação de produto: version: 1 com baseVersion: 0 (ou ausente) é aceita', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_create_v1';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_create_v1',
        name: 'Produto Inicial v1',
        salePriceCents: 1500,
        version: 1,
        baseVersion: 0
      }));
      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(1);
      expect(snap.val().baseVersion).toBe(0);
    });

    it('14.14.3: Criação de produto: versão inválida (version: 0, negativa ou string) é estritamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_invalid_ver';

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_invalid_ver',
        name: 'Produto Invalido',
        salePriceCents: 1500,
        version: 0
      }));

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_invalid_ver',
        name: 'Produto Invalido',
        salePriceCents: 1500,
        version: -1
      }));

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_invalid_ver',
        name: 'Produto Invalido',
        salePriceCents: 1500,
        version: '1'
      }));

      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.14.4: Criação de produto: versão fracionária (version: 1.5) é rejeitada pelo backend', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_frac_ver';

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_frac_ver',
        name: 'Produto Fracionario',
        salePriceCents: 1500,
        version: 1.5
      }));

      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.14.5: Criação de produto: salto inicial (version: 2 em nó novo) é rejeitado pelo servidor', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_skip_create';

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_skip_create',
        name: 'Produto Salto Inicial',
        salePriceCents: 1500,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.14.6: Criação de produto: baseVersion inconsistente (baseVersion: 5 ou baseVersion: 1 em nó novo) é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_inconsistent_base';

      await assertFails(set(ref(db, path), {
        id: 'p_p1414_inconsistent_base',
        name: 'Produto Base Inconsistente',
        salePriceCents: 1500,
        version: 1,
        baseVersion: 5
      }));

      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.14.7: Sequência contínua completa: progressão rigorosa v1 -> v2 -> v3 -> v4 é aceita', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_seq_full';

      // v1
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_seq_full',
        name: 'Item Seq v1',
        salePriceCents: 1000,
        version: 1
      }));
      let snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);

      // v1 -> v2
      await assertSucceeds(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 1,
        version: 2
      }));
      snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().baseVersion).toBe(1);
      expect(snap.val().salePriceCents).toBe(2000);

      // v2 -> v3
      await assertSucceeds(update(ref(db, path), {
        salePriceCents: 3000,
        baseVersion: 2,
        version: 3
      }));
      snap = await get(ref(db, path));
      expect(snap.val().version).toBe(3);
      expect(snap.val().baseVersion).toBe(2);
      expect(snap.val().salePriceCents).toBe(3000);

      // v3 -> v4
      await assertSucceeds(update(ref(db, path), {
        salePriceCents: 4000,
        baseVersion: 3,
        version: 4
      }));
      snap = await get(ref(db, path));
      expect(snap.val().version).toBe(4);
      expect(snap.val().baseVersion).toBe(3);
      expect(snap.val().salePriceCents).toBe(4000);
    });

    it('14.14.8: Rejeição na sequência: estando em v2, salto para v4 (baseVersion: 2, version: 4) é rejeitado e preserva v2', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_seq_jump';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_seq_jump',
        name: 'Item Jump',
        salePriceCents: 1000,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));

      // Tenta pular para v4
      await assertFails(update(ref(db, path), {
        salePriceCents: 9999,
        baseVersion: 2,
        version: 4
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(1000);
    });

    it('14.14.9: Rejeição na sequência: estando em v3, baseVersion obsoleto (baseVersion: 1) é rejeitado e preserva v3', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_seq_stale';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_seq_stale',
        name: 'Item Stale',
        salePriceCents: 1000,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), { baseVersion: 1, version: 2 }));
      await assertSucceeds(update(ref(db, path), { baseVersion: 2, version: 3 }));

      // Tenta usar baseVersion 1 quando o servidor está em v3
      await assertFails(update(ref(db, path), {
        salePriceCents: 9999,
        baseVersion: 1,
        version: 4
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(3);
    });

    it('14.14.10: Tipagem na atualização: baseVersion ou version textual é rejeitado pelo servidor', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_type_str';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_type_str',
        name: 'Item Str',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: '1',
        version: 2
      }));

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 1,
        version: '2'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.14.11: Tipagem na atualização: baseVersion ou version fracionário (ex: 1.5, 2.5) é rejeitado', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_type_frac';

      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1414_type_frac',
        name: 'Item Frac',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 1.5,
        version: 2.5
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.14.12: Registro legado sem version: tentativa de saltar para versão arbitrária (version: 10 ou 50) é categoricamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_leg_skip';

      // Seed de registro legado sem campo version via admin fixture
      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1414_leg_skip',
          name: 'Item Legado Sem Versao',
          salePriceCents: 1000
        });
      });

      // Tentativa de saltar para version: 10
      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        version: 10,
        baseVersion: 1
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBeUndefined();
      expect(snap.val().salePriceCents).toBe(1000);
    });

    it('14.14.13: Registro legado sem version: tentativa de atualização com baseVersion arbitrário (baseVersion: 99) é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_leg_arb_base';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1414_leg_arb_base',
          name: 'Item Legado Arb Base',
          salePriceCents: 1000
        });
      });

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 99,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBeUndefined();
    });

    it('14.14.14: Registro legado sem version: tentativa de atualizar para version: 2 sem baseVersion é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_leg_no_base';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1414_leg_no_base',
          name: 'Item Legado No Base',
          salePriceCents: 1000
        });
      });

      await assertFails(update(ref(db, path), {
        salePriceCents: 2000,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBeUndefined();
    });

    it('14.14.15: Registro legado sem version: mutação e bootstrap por cliente comum são categoricamente rejeitados', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1414_leg_canon';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1414_leg_canon',
          name: 'Item Legado Canonico',
          salePriceCents: 1000
        });
      });

      // Tentativa de bootstrap por cliente é rejeitada pelo backend
      await assertFails(update(ref(db, path), {
        salePriceCents: 1500,
        baseVersion: 1,
        version: 2
      }));

      // Tentativa de mutação comercial sem version é rejeitada
      await assertFails(update(ref(db, path), {
        salePriceCents: 1200
      }));

      // Registro permanece íntegro no estado original
      const snap = await get(ref(db, path));
      expect(snap.val().version).toBeUndefined();
      expect(snap.val().salePriceCents).toBe(1000);
      expect(snap.val().name).toBe('Item Legado Canonico');
    });

    it('14.14.16: Registro legado sem version: mutação concorrente por clientes é rejeitada e preserva registro intacto', async () => {
      const db1 = admin1().database();
      const db2 = admin2().database();
      const path = 'tenants/tenantA/products/p_p1414_leg_race';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1414_leg_race',
          name: 'Item Legado Race',
          salePriceCents: 1000
        });
      });

      // Ambos os clientes tentam mutação sobre o nó legado: ambos são rejeitados pelo servidor
      await assertFails(update(ref(db1, path), {
        salePriceCents: 1500,
        baseVersion: 1,
        version: 2
      }));
      await assertFails(update(ref(db2, path), {
        salePriceCents: 2500,
        baseVersion: 1,
        version: 2
      }));

      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBeUndefined();
      expect(finalSnap.val().salePriceCents).toBe(1000);
      expect(finalSnap.val().name).toBe('Item Legado Race');
    });

    it('14.14.17: Imutabilidade financeira em Vendas: alteração em unitSalePriceCents ou date é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/sales/sale_p1414_strict';

      await assertSucceeds(set(ref(db, path), {
        id: 'sale_p1414_strict',
        productId: 'prod_1414_s',
        quantity: 2,
        totalSaleCents: 4000,
        unitSalePriceCents: 2000,
        unitCostCents: 1000,
        date: '2026-10-12T10:00:00Z'
      }));

      await assertFails(update(ref(db, path), { unitSalePriceCents: 2500 }));
      await assertFails(update(ref(db, path), { date: '2026-10-15T00:00:00Z' }));

      // Cancelamento permitido
      await assertSucceeds(update(ref(db, path), {
        cancelledAt: '2026-10-12T12:00:00Z',
        cancelReason: 'Desistência do cliente'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().unitSalePriceCents).toBe(2000);
      expect(snap.val().totalSaleCents).toBe(4000);
      expect(snap.val().cancelledAt).toBe('2026-10-12T12:00:00Z');
    });

    it('14.14.18: Imutabilidade financeira em Compras: alteração em supplierId ou totalAmountCents é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/purchases/pur_p1414_strict';

      await assertSucceeds(set(ref(db, path), {
        id: 'pur_p1414_strict',
        productId: 'prod_1414_p',
        supplierId: 'sup_1414_orig',
        quantity: 10,
        totalAmountCents: 10000,
        date: '2026-10-12T08:00:00Z'
      }));

      await assertFails(update(ref(db, path), { supplierId: 'sup_1414_hacked' }));
      await assertFails(update(ref(db, path), { totalAmountCents: 99999 }));

      // Cancelamento permitido
      await assertSucceeds(update(ref(db, path), {
        cancelledAt: '2026-10-12T12:00:00Z',
        cancelReason: 'Devolução ao fornecedor'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().supplierId).toBe('sup_1414_orig');
      expect(snap.val().totalAmountCents).toBe(10000);
      expect(snap.val().cancelledAt).toBe('2026-10-12T12:00:00Z');
    });

    it('14.14.19: Ledger de Estoque (/inventory): update parcial em notas ou campos descritivos é estritamente rejeitado', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/inventory/mov_p1414_ledger';

      await assertSucceeds(set(ref(db, path), {
        id: 'mov_p1414_ledger',
        productId: 'p_p1414_seq_full',
        quantity: 10,
        delta: 10,
        type: 'IN',
        notes: 'Entrada Inicial'
      }));

      await assertFails(update(ref(db, path), { notes: 'Tentativa de alteração descritiva' }));
      await assertFails(update(ref(db, path), { quantity: 15 }));
      await assertFails(remove(ref(db, path)));

      const snap = await get(ref(db, path));
      expect(snap.val().notes).toBe('Entrada Inicial');
      expect(snap.val().quantity).toBe(10);
    });

    it('14.14.20: Paridade de Provedor: MockRealtimeProvider detecta conflito de versão e preserva registro intacto', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('prod_mock_1', {
        id: 'prod_mock_1',
        name: 'Mock Prod',
        salePriceCents: 1000,
        version: 2,
        baseVersion: 1
      });

      let thrownError = null;
      try {
        await mock.pushChange({
          entityType: 'products',
          entityId: 'prod_mock_1',
          action: 'UPDATE',
          payload: {
            salePriceCents: 2000,
            baseVersion: 1,
            version: 3
          }
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.code).toBe('concurrency_conflict');
      expect(thrownError.errorCategory).toBe('version_conflict');

      const stored = mock._getStore('products').get('prod_mock_1');
      expect(stored.version).toBe(2);
      expect(stored.salePriceCents).toBe(1000);
    });

    it('14.14.21: Idempotência de Provedor: reenvio de operação equivalente retorna alreadyApplied: true em MockRealtimeProvider', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('prod_mock_2', {
        id: 'prod_mock_2',
        name: 'Mock Prod Idemp',
        salePriceCents: 3000,
        version: 2,
        baseVersion: 1
      });

      const res = await mock.pushChange({
        entityType: 'products',
        entityId: 'prod_mock_2',
        action: 'UPDATE',
        payload: {
          id: 'prod_mock_2',
          name: 'Mock Prod Idemp',
          salePriceCents: 3000,
          baseVersion: 1,
          version: 2
        }
      });

      expect(res.success).toBe(true);
      expect(res.alreadyApplied).toBe(true);
    });
  });

  // =========================================================================
  // PHASE 14.15 — FECHAMENTO DAS BRECHAS DE VERSIONAMENTO, CAS E PROTEÇÃO CONTRA ESCRITAS DIRETAS
  // =========================================================================
  describe('PHASE 14.15 — Fechamento das Brechas de Versionamento, CAS e Proteção contra Escritas Diretas', () => {
    const admin1 = () => testEnv.authenticatedContext('admin_p1415_1', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const admin2 = () => testEnv.authenticatedContext('admin_p1415_2', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantA' });
    const operator1 = () => testEnv.authenticatedContext('op_p1415_1', { role: 'authenticated', appRole: 'operator', tenantId: 'tenantA' });
    const viewer1 = () => testEnv.authenticatedContext('view_p1415_1', { role: 'authenticated', appRole: 'viewer', tenantId: 'tenantA' });
    const tenantBClient = () => testEnv.authenticatedContext('admin_p1415_b', { role: 'authenticated', appRole: 'admin', tenantId: 'tenantB' });

    // -------------------------------------------------------------
    // GRUPO 1: CRIAÇÃO E FECHAMENTO DE BRECHAS DE VERSIONAMENTO
    // -------------------------------------------------------------
    it('14.15.1: Criação de produto com version: 1 e baseVersion omitido ou 0 é aceita com sucesso', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_create_valid';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_create_valid',
        name: 'Produto Valido 14.15',
        salePriceCents: 1500,
        version: 1
      }));
      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.15.2: Criação de produto sem version (omissão do campo) é categoricamente rejeitada pelo servidor', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_no_ver';
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_no_ver',
        name: 'Produto Sem Version',
        salePriceCents: 1500
      }));
      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.15.3: Criação de produto com version: null é categoricamente rejeitada pelo servidor', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_null_ver';
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_null_ver',
        name: 'Produto Null Version',
        salePriceCents: 1500,
        version: null
      }));
      const snap = await get(ref(db, path));
      expect(snap.exists()).toBe(false);
    });

    it('14.15.4: Criação de produto com version: 0, negativo, fracionário ou textual é rejeitada', async () => {
      const db = admin1().database();
      const path0 = 'tenants/tenantA/products/p_p1415_v0';
      const pathNeg = 'tenants/tenantA/products/p_p1415_vneg';
      const pathFrac = 'tenants/tenantA/products/p_p1415_vfrac';
      const pathStr = 'tenants/tenantA/products/p_p1415_vstr';

      await assertFails(set(ref(db, path0), { id: 'p_p1415_v0', name: 'V0', salePriceCents: 100, version: 0 }));
      await assertFails(set(ref(db, pathNeg), { id: 'p_p1415_vneg', name: 'VNeg', salePriceCents: 100, version: -1 }));
      await assertFails(set(ref(db, pathFrac), { id: 'p_p1415_vfrac', name: 'VFrac', salePriceCents: 100, version: 1.5 }));
      await assertFails(set(ref(db, pathStr), { id: 'p_p1415_vstr', name: 'VStr', salePriceCents: 100, version: '1' }));
    });

    it('14.15.5: Criação com salto de versão (version: 2 ou superior) é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_jump_init';
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_jump_init',
        name: 'Salto Inicial',
        salePriceCents: 200,
        version: 2
      }));
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_jump_init',
        name: 'Salto Inicial 10',
        salePriceCents: 200,
        version: 10
      }));
    });

    it('14.15.6: Criação com baseVersion inconsistente (baseVersion: 1, -1, 1.5 ou string) é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_inconsistent_base';
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_inconsistent_base',
        name: 'Base Inconsistente',
        salePriceCents: 300,
        version: 1,
        baseVersion: 1
      }));
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_inconsistent_base',
        name: 'Base Inconsistente Neg',
        salePriceCents: 300,
        version: 1,
        baseVersion: -1
      }));
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_inconsistent_base',
        name: 'Base Inconsistente Str',
        salePriceCents: 300,
        version: 1,
        baseVersion: '0'
      }));
    });

    it('14.15.7: Criação com id divergente da chave ou com tenantId de outro tenant é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_id_mismatch';
      await assertFails(set(ref(db, path), {
        id: 'p_divergent_id',
        name: 'ID Divergente',
        salePriceCents: 400,
        version: 1
      }));
      await assertFails(set(ref(db, path), {
        id: 'p_p1415_id_mismatch',
        name: 'Tenant Divergente',
        salePriceCents: 400,
        tenantId: 'tenantB',
        version: 1
      }));
    });

    // -------------------------------------------------------------
    // GRUPO 2: ATUALIZAÇÃO E REMOÇÃO DE CAMPOS DE VERSIONAMENTO
    // -------------------------------------------------------------
    it('14.15.8: Atualização de produto versionado removendo version com update({ version: null }) é categoricamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_rm_ver';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_rm_ver',
        name: 'Produto Base Para Nulificar Versao',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        version: null,
        baseVersion: 1
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.15.9: Atualização que remove somente baseVersion (update({ baseVersion: null })) é categoricamente rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_rm_basever';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_rm_basever',
        name: 'Produto Para Nulificar BaseVersion',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        version: 2,
        baseVersion: null
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.15.10: Atualização que remove simultaneamente campos de versionamento ({ version: null, baseVersion: null }) é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_rm_both';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_rm_both',
        name: 'Produto Nulificar Ambos',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        version: null,
        baseVersion: null
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
    });

    it('14.15.11: Escrita de objeto completo via set() com version ausente ou nulo sobre nó versionado é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_set_nover';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_set_nover',
        name: 'Original v1',
        salePriceCents: 1000,
        version: 1
      }));

      await assertFails(set(ref(db, path), {
        id: 'p_p1415_set_nover',
        name: 'Hacked Sem Versao',
        salePriceCents: 9999
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(1);
      expect(snap.val().salePriceCents).toBe(1000);
      expect(snap.val().name).toBe('Original v1');
    });

    it('14.15.12: Sequência contínua válida v1 -> v2 -> v3 é aceita; tentativas de salto (v1 -> v3), retrocesso (v2 -> v1) ou mesma versão (v2 -> v2) são rejeitadas', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_seq_strict';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_seq_strict',
        name: 'Seq Inicial',
        salePriceCents: 1000,
        version: 1
      }));

      // Tentativa de salto v1 -> v3 rejeitada
      await assertFails(update(ref(db, path), { salePriceCents: 1100, baseVersion: 1, version: 3 }));

      // Avanço legítimo v1 -> v2
      await assertSucceeds(update(ref(db, path), { salePriceCents: 1200, baseVersion: 1, version: 2 }));

      // Tentativa de mesma versão com conteúdo alterado (v2 -> v2) rejeitada
      await assertFails(update(ref(db, path), { salePriceCents: 1300, baseVersion: 2, version: 2 }));

      // Tentativa de retrocesso (v2 -> v1) rejeitada
      await assertFails(update(ref(db, path), { salePriceCents: 1400, baseVersion: 2, version: 1 }));

      // Avanço legítimo v2 -> v3
      await assertSucceeds(update(ref(db, path), { salePriceCents: 1500, baseVersion: 2, version: 3 }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(3);
      expect(snap.val().baseVersion).toBe(2);
      expect(snap.val().salePriceCents).toBe(1500);
    });

    it('14.15.13: Atualização com baseVersion obsoleto é rejeitada e preserva o estado mais recente', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_stale_base';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_stale_base',
        name: 'Item Stale Test',
        salePriceCents: 1000,
        version: 1
      }));
      await assertSucceeds(update(ref(db, path), {
        salePriceCents: 2000,
        baseVersion: 1,
        version: 2
      }));

      // Estando em v2, cliente com baseVersion 1 tentando ir para v3 é rejeitado
      await assertFails(update(ref(db, path), {
        salePriceCents: 3000,
        baseVersion: 1,
        version: 3
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBe(2);
      expect(snap.val().salePriceCents).toBe(2000);
    });

    it('14.15.14: Atualização tentando alterar id ou tenantId do produto é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_immut';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_immut',
        name: 'Item Imutavel',
        salePriceCents: 1000,
        tenantId: 'tenantA',
        version: 1
      }));

      await assertFails(update(ref(db, path), {
        id: 'p_p1415_id_hacked',
        baseVersion: 1,
        version: 2
      }));
      await assertFails(update(ref(db, path), {
        tenantId: 'tenantB',
        baseVersion: 1,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().id).toBe('p_p1415_immut');
      expect(snap.val().tenantId).toBe('tenantA');
    });

    // -------------------------------------------------------------
    // GRUPO 3: REGISTROS LEGADOS NÃO VERSIONADOS
    // -------------------------------------------------------------
    it('14.15.15: Fixture legada não versionada: edição comercial irrestrita por cliente comum é categoricamente negada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_leg_edit';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1415_leg_edit',
          name: 'Produto Legado Intacto',
          salePriceCents: 5000
        });
      });

      // Tentativa de editar preço ou nome diretamente
      await assertFails(update(ref(db, path), {
        salePriceCents: 3000
      }));
      await assertFails(update(ref(db, path), {
        name: 'Nome Alterado Ilegalmente'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().name).toBe('Produto Legado Intacto');
      expect(snap.val().salePriceCents).toBe(5000);
      expect(snap.val().version).toBeUndefined();
    });

    it('14.15.16: Fixture legada não versionada: bootstrap por cliente comum é negado, preservando registro para migração administrativa', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_leg_boot';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1415_leg_boot',
          name: 'Produto Legado Seguro',
          salePriceCents: 8000
        });
      });

      // Tentativa de bootstrap via v1 sem baseVersion
      await assertFails(update(ref(db, path), {
        version: 1
      }));
      // Tentativa de bootstrap via v2 com baseVersion: 1
      await assertFails(update(ref(db, path), {
        baseVersion: 1,
        version: 2
      }));
      // Tentativa de bootstrap alterando campos comerciais
      await assertFails(update(ref(db, path), {
        salePriceCents: 1000,
        baseVersion: 1,
        version: 2
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().version).toBeUndefined();
      expect(snap.val().salePriceCents).toBe(8000);
    });

    it('14.15.17: Fixture legada não versionada: é legível por membros autenticados do tenant e não é excluída nem corrompida', async () => {
      const db = operator1().database();
      const path = 'tenants/tenantA/products/p_p1415_leg_read';

      await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
        await set(ref(adminCtx.database(), path), {
          id: 'p_p1415_leg_read',
          name: 'Produto Legado Para Leitura',
          salePriceCents: 4500
        });
      });

      // Leitura permitida
      const snap = await assertSucceeds(get(ref(db, path)));
      expect(snap.exists()).toBe(true);
      expect(snap.val().name).toBe('Produto Legado Para Leitura');

      // Tentativa de exclusão física por operador é negada
      await assertFails(remove(ref(db, path)));

      const snapAfter = await get(ref(db, path));
      expect(snapAfter.exists()).toBe(true);
    });

    // -------------------------------------------------------------
    // GRUPO 4: ESCRITAS DIRETAS, NÓS ANCESTRAIS E ATUALIZAÇÕES MULTIPATH
    // -------------------------------------------------------------
    it('14.15.18: Tentativas de escrita direta via set, update e remove em caminhos ancestrais são bloqueadas', async () => {
      const db = admin1().database();

      // Escrita em /tenants
      await assertFails(set(ref(db, 'tenants'), { hacked: true }));
      // Escrita em /tenants/tenantA
      await assertFails(set(ref(db, 'tenants/tenantA'), { hacked: true }));
      // Escrita em /tenants/tenantA/products
      await assertFails(set(ref(db, 'tenants/tenantA/products'), { p_hack: { name: 'Hack' } }));
      // Multipath update no caminho ancestral
      await assertFails(update(ref(db, 'tenants/tenantA'), {
        'products/p_multi/name': 'Multipath'
      }));
    });

    it('14.15.19: Atualização multipath em produto tentando omitir version ou baseVersion é rejeitada', async () => {
      const db = admin1().database();
      const path = 'tenants/tenantA/products/p_p1415_multipath';
      await assertSucceeds(set(ref(db, path), {
        id: 'p_p1415_multipath',
        name: 'Item Multi',
        salePriceCents: 1000,
        version: 1
      }));

      // Multipath update alterando nome sem fornecer baseVersion ou version válido
      await assertFails(update(ref(db, path), {
        name: 'Nome Alterado Sem CAS'
      }));

      const snap = await get(ref(db, path));
      expect(snap.val().name).toBe('Item Multi');
      expect(snap.val().version).toBe(1);
    });

    it('14.15.20: Exclusão física de produto por operador via remove() ou set(null) é categoricamente rejeitada', async () => {
      const adminDb = admin1().database();
      const opDb = operator1().database();
      const path = 'tenants/tenantA/products/p_p1415_op_phys_del';

      await assertSucceeds(set(ref(adminDb, path), {
        id: 'p_p1415_op_phys_del',
        name: 'Produto Anti Operador Delete',
        salePriceCents: 2000,
        version: 1
      }));

      await assertFails(remove(ref(opDb, path)));
      await assertFails(set(ref(opDb, path), null));

      const snap = await get(ref(adminDb, path));
      expect(snap.exists()).toBe(true);
      expect(snap.val().version).toBe(1);
    });

    it('14.15.21: Exclusão física de produto por admin é aceita, enquanto soft-delete canônico via CAS funciona para operador', async () => {
      const adminDb = admin1().database();
      const opDb = operator1().database();
      const pathAdmin = 'tenants/tenantA/products/p_p1415_adm_del';
      const pathOp = 'tenants/tenantA/products/p_p1415_op_soft';

      // 1. Admin physical delete
      await assertSucceeds(set(ref(adminDb, pathAdmin), {
        id: 'p_p1415_adm_del',
        name: 'Deletar Fisicamente',
        salePriceCents: 1000,
        version: 1
      }));
      await assertSucceeds(remove(ref(adminDb, pathAdmin)));
      const snapAdmin = await get(ref(adminDb, pathAdmin));
      expect(snapAdmin.exists()).toBe(false);

      // 2. Operador soft-delete com deletedAt e avanço CAS
      await assertSucceeds(set(ref(adminDb, pathOp), {
        id: 'p_p1415_op_soft',
        name: 'Soft Delete Por Operador',
        salePriceCents: 1000,
        version: 1
      }));
      await assertSucceeds(update(ref(opDb, pathOp), {
        deletedAt: new Date().toISOString(),
        baseVersion: 1,
        version: 2
      }));
      const snapOp = await get(ref(adminDb, pathOp));
      expect(snapOp.exists()).toBe(true);
      expect(snapOp.val().version).toBe(2);
      expect(snapOp.val().deletedAt).toBeDefined();
    });

    it('14.15.22: Disputa concorrente atômica: dois clientes partindo da mesma versão v1: exatamente um avança para v2 e o segundo aborta por conflito', async () => {
      const db1 = admin1().database();
      const db2 = admin2().database();
      const path = 'tenants/tenantA/products/p_p1415_race_atomic';

      await assertSucceeds(set(ref(db1, path), {
        id: 'p_p1415_race_atomic',
        name: 'Corrida Atomica',
        salePriceCents: 1000,
        version: 1
      }));

      const runClient = async (db, newPrice) => {
        let abortReason = null;
        const txResult = await runTransaction(ref(db, path), (current) => {
          if (!current) {
            return {
              id: 'p_p1415_race_atomic',
              name: 'Corrida Atomica',
              salePriceCents: newPrice,
              baseVersion: 1,
              version: 2
            };
          }
          if (current.version !== 1) {
            abortReason = 'VERSION_CONFLICT';
            return undefined;
          }
          return {
            ...current,
            salePriceCents: newPrice,
            baseVersion: 1,
            version: 2
          };
        }, { applyLocally: false });
        return { txResult, abortReason };
      };

      const [r1, r2] = await Promise.all([
        runClient(db1, 1500),
        runClient(db2, 2500)
      ]);

      const committed = (r1.txResult.committed ? 1 : 0) + (r2.txResult.committed ? 1 : 0);
      expect(committed).toBe(1);

      const finalSnap = await get(ref(db1, path));
      expect(finalSnap.val().version).toBe(2);
      expect(finalSnap.val().baseVersion).toBe(1);

      // Mutação direta subsequente do perdedor com baseVersion desatualizada é rejeitada
      await assertFails(update(ref(db2, path), {
        salePriceCents: 9999,
        baseVersion: 1,
        version: 2
      }));
    });

    // -------------------------------------------------------------
    // GRUPO 5: VENDAS, COMPRAS E INVENTORY (IMUTABILIDADE E NÃO-EXCLUSÃO)
    // -------------------------------------------------------------
    it('14.15.23: Vendas: imutabilidade de todos os campos comerciais e proibição total de exclusão física para todos os papéis', async () => {
      const adminDb = admin1().database();
      const opDb = operator1().database();
      const path = 'tenants/tenantA/sales/sale_p1415_strict';

      await assertSucceeds(set(ref(adminDb, path), {
        id: 'sale_p1415_strict',
        productId: 'prod_1415',
        quantity: 5,
        totalSaleCents: 10000,
        unitSalePriceCents: 2000,
        unitCostCents: 1000,
        date: '2026-10-12T10:00:00Z'
      }));

      // Alteração de cada campo imutável é rejeitada
      await assertFails(update(ref(adminDb, path), { quantity: 6 }));
      await assertFails(update(ref(adminDb, path), { productId: 'prod_other' }));
      await assertFails(update(ref(adminDb, path), { totalSaleCents: 12000 }));
      await assertFails(update(ref(adminDb, path), { unitSalePriceCents: 2500 }));
      await assertFails(update(ref(adminDb, path), { unitCostCents: 1200 }));
      await assertFails(update(ref(adminDb, path), { date: '2026-10-15T00:00:00Z' }));

      // Exclusão física é rejeitada tanto para operador quanto para admin
      await assertFails(remove(ref(opDb, path)));
      await assertFails(remove(ref(adminDb, path)));
      await assertFails(set(ref(adminDb, path), null));

      // Cancelamento permitido preservando dados financeiros
      await assertSucceeds(update(ref(adminDb, path), {
        cancelledAt: '2026-10-12T12:00:00Z',
        cancelReason: 'Cliente solicitou estorno'
      }));

      const snap = await get(ref(adminDb, path));
      expect(snap.val().quantity).toBe(5);
      expect(snap.val().totalSaleCents).toBe(10000);
      expect(snap.val().unitSalePriceCents).toBe(2000);
      expect(snap.val().cancelledAt).toBe('2026-10-12T12:00:00Z');
    });

    it('14.15.24: Compras: imutabilidade de todos os campos comerciais e proibição total de exclusão física', async () => {
      const adminDb = admin1().database();
      const path = 'tenants/tenantA/purchases/pur_p1415_strict';

      await assertSucceeds(set(ref(adminDb, path), {
        id: 'pur_p1415_strict',
        productId: 'prod_1415',
        supplierId: 'sup_orig',
        quantity: 20,
        totalAmountCents: 20000,
        date: '2026-10-12T08:00:00Z'
      }));

      await assertFails(update(ref(adminDb, path), { supplierId: 'sup_hacked' }));
      await assertFails(update(ref(adminDb, path), { totalAmountCents: 99999 }));
      await assertFails(update(ref(adminDb, path), { quantity: 50 }));
      await assertFails(update(ref(adminDb, path), { productId: 'prod_changed' }));
      await assertFails(update(ref(adminDb, path), { date: '2026-10-20T00:00:00Z' }));

      // Exclusão física rejeitada para admin
      await assertFails(remove(ref(adminDb, path)));
      await assertFails(set(ref(adminDb, path), null));

      // Cancelamento permitido
      await assertSucceeds(update(ref(adminDb, path), {
        cancelledAt: '2026-10-12T14:00:00Z',
        cancelReason: 'Pedido cancelado com o fornecedor'
      }));

      const snap = await get(ref(adminDb, path));
      expect(snap.val().supplierId).toBe('sup_orig');
      expect(snap.val().totalAmountCents).toBe(20000);
      expect(snap.val().quantity).toBe(20);
      expect(snap.val().cancelledAt).toBe('2026-10-12T14:00:00Z');
    });

    it('14.15.25: Ledger /inventory: append-only estrito, rejeitando updates parciais, remoções e sobreescritas', async () => {
      const adminDb = admin1().database();
      const path = 'tenants/tenantA/inventory/mov_p1415_strict';

      await assertSucceeds(set(ref(adminDb, path), {
        id: 'mov_p1415_strict',
        productId: 'prod_1415',
        quantity: 10,
        delta: 10,
        type: 'IN',
        notes: 'Entrada Inicial Estrita'
      }));

      await assertFails(update(ref(adminDb, path), { notes: 'Modificacao Proibida' }));
      await assertFails(update(ref(adminDb, path), { quantity: 20 }));
      await assertFails(update(ref(adminDb, path), { delta: 20 }));
      await assertFails(remove(ref(adminDb, path)));
      await assertFails(set(ref(adminDb, path), null));
      await assertFails(set(ref(adminDb, path), {
        id: 'mov_p1415_strict',
        productId: 'prod_1415',
        quantity: 99,
        delta: 99,
        type: 'IN'
      }));

      const snap = await get(ref(adminDb, path));
      expect(snap.val().quantity).toBe(10);
      expect(snap.val().delta).toBe(10);
      expect(snap.val().notes).toBe('Entrada Inicial Estrita');
    });

    // -------------------------------------------------------------
    // GRUPO 6: PARIDADE E INTEGRAÇÃO DE PROVEDORES
    // -------------------------------------------------------------
    it('14.15.26: MockRealtimeProvider: recusa mutação sobre registro não-versionado (unversioned_legacy_conflict)', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('prod_mock_unver', {
        id: 'prod_mock_unver',
        name: 'Mock Unversioned Item',
        salePriceCents: 5000
      });

      let thrownError = null;
      try {
        await mock.pushChange({
          entityType: 'products',
          entityId: 'prod_mock_unver',
          action: 'UPDATE',
          payload: {
            id: 'prod_mock_unver',
            salePriceCents: 6000,
            baseVersion: 1,
            version: 2
          }
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.code).toBe('concurrency_conflict');
      expect(thrownError.errorCategory).toBe('unversioned_legacy_conflict');

      const stored = mock._getStore('products').get('prod_mock_unver');
      expect(stored.version).toBeUndefined();
      expect(stored.salePriceCents).toBe(5000);
    });

    it('14.15.27: MockRealtimeProvider: rejeita atualização de produto versionado sem baseVersion (missing_base_version)', async () => {
      const mock = new MockRealtimeProvider();
      mock.setConnected(true);

      mock._getStore('products').set('prod_mock_ver', {
        id: 'prod_mock_ver',
        name: 'Mock Versioned Item',
        salePriceCents: 2000,
        version: 2,
        baseVersion: 1
      });

      let thrownError = null;
      try {
        await mock.pushChange({
          entityType: 'products',
          entityId: 'prod_mock_ver',
          action: 'UPDATE',
          payload: {
            id: 'prod_mock_ver',
            salePriceCents: 2500,
            version: 3
          }
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError.code).toBe('concurrency_conflict');
      expect(thrownError.errorCategory).toBe('missing_base_version');

      const stored = mock._getStore('products').get('prod_mock_ver');
      expect(stored.version).toBe(2);
      expect(stored.salePriceCents).toBe(2000);
    });
  });
});
