import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { ref, set, get, update, remove } from 'firebase/database';

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
        salePriceCents: 2700
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
        salePriceCents: 1500
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
        salePriceCents: 3000
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
        salePriceCents: 4500
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
        salePriceCents: 1500
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
        salePriceCents: 2000
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
        salePriceCents: 3000
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
        salePriceCents: 1200
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
        salePriceCents: 2500
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
        salePriceCents: 999
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
});


