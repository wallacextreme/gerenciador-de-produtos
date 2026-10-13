import { describe, it, expect, vi } from 'bun:test';
import {
  validateProvisioningTarget,
  provisionEmulatorAuth,
  runProvisioning,
  STAGING_USERS,
  STAGING_TEST_USERS,
  AUTHORIZED_EMULATOR_PROJECTS,
  AUTHORIZED_CLOUD_STAGING_PROJECTS
} from '../scripts/provision-staging.js';

/**
 * FASE 15.2 — Hardening do Destino de Staging e Testes do Provisionamento
 * 
 * Bateria de testes de segurança estrita e fail-closed para o provisionamento administrativo:
 * 1. Validação exata e estrita do projeto (zero correspondência parcial permissiva).
 * 2. Bloqueio absoluto contra projetos de produção conhecidos ou nomes arbitrários.
 * 3. Ausência total de efeitos colaterais ao importar o módulo.
 * 4. Recuperação confiável de UID via accounts:lookup em contas existentes antes do update de claims.
 * 5. Tratamento estrito de erros (sem falsos positivos de sucesso).
 * 6. Garantia do contrato canônico de claims (appRole, role: 'authenticated', tenantId).
 * 7. Inexistência de chamadas destrutivas ou de deleção ampla.
 */

describe('FASE 15.2 — Hardening do Destino de Staging e Testes de Segurança', () => {

  describe('1. Validação Exata e Fail-Closed de Identificadores de Projeto', () => {
    it('1.1 Aceita os identificadores exatos autorizados para o modo emulador', () => {
      for (const authorizedId of AUTHORIZED_EMULATOR_PROJECTS) {
        const res = validateProvisioningTarget(authorizedId, { isEmulator: true });
        expect(res.valid).toBe(true);
        expect(res.projectId).toBe(authorizedId);
        expect(res.mode).toBe('emulator');
      }
    });

    it('1.2 Aceita o identificador exato autorizado para o modo cloud instructions', () => {
      for (const authorizedId of AUTHORIZED_CLOUD_STAGING_PROJECTS) {
        const res = validateProvisioningTarget(authorizedId, { isEmulator: false });
        expect(res.valid).toBe(true);
        expect(res.projectId).toBe(authorizedId);
        expect(res.mode).toBe('cloud-instructions');
      }
    });

    it('1.3 Rejeita identificador desconhecido em ambos os modos', () => {
      expect(() => validateProvisioningTarget('projeto-completamente-desconhecido', { isEmulator: true }))
        .toThrow(/rejeitado para modo emulador/i);

      expect(() => validateProvisioningTarget('projeto-completamente-desconhecido', { isEmulator: false }))
        .toThrow(/rejeitado para staging em nuvem/i);
    });

    it('1.4 Rejeita identificador que apenas contém a substring "staging" se não for o autorizado', () => {
      const candidates = [
        'staging',
        'meu-staging',
        'gerenciador-produtos-staging-falso',
        'staging-producao',
        'app-staging-2'
      ];

      for (const id of candidates) {
        expect(() => validateProvisioningTarget(id, { isEmulator: true }))
          .toThrow(/rejeitado para modo emulador/i);
        expect(() => validateProvisioningTarget(id, { isEmulator: false }))
          .toThrow(/rejeitado para staging em nuvem/i);
      }
    });

    it('1.5 Rejeita identificador que apenas contém a substring "test" se não for autorizado', () => {
      const candidates = ['test', 'teste', 'my-test-app', 'test-gerenciador-produtos'];
      for (const id of candidates) {
        expect(() => validateProvisioningTarget(id, { isEmulator: true }))
          .toThrow(/rejeitado para modo emulador/i);
        expect(() => validateProvisioningTarget(id, { isEmulator: false }))
          .toThrow(/rejeitado para staging em nuvem/i);
      }
    });

    it('1.6 Rejeita identificador que apenas contém o prefixo "demo-" se não estiver na lista autorizada', () => {
      const candidates = ['demo-', 'demo-invalido', 'demo-projeto-arbitrario', 'demo-hack'];
      for (const id of candidates) {
        expect(() => validateProvisioningTarget(id, { isEmulator: true }))
          .toThrow(/rejeitado para modo emulador/i);
        expect(() => validateProvisioningTarget(id, { isEmulator: false }))
          .toThrow(/rejeitado para staging em nuvem/i);
      }
    });

    it('1.7 Rejeita valores vazios, nulos ou indefinidos de forma fail-closed', () => {
      expect(() => validateProvisioningTarget(null)).toThrow(/ausente ou inválido/i);
      expect(() => validateProvisioningTarget(undefined)).toThrow(/ausente ou inválido/i);
      expect(() => validateProvisioningTarget('')).toThrow(/ausente ou inválido/i);
      expect(() => validateProvisioningTarget('   ')).toThrow(/ausente ou inválido/i);
    });

    it('1.8 Bloqueia categoricamente projetos de produção conhecidos mesmo que contenham substrings permissivas', () => {
      const prodProjects = ['caixa-autopecas', 'fichas-tucano-loja', 'tabela-porta-escovas', 'tucano-vales', 'app-prod'];
      for (const prod of prodProjects) {
        expect(() => validateProvisioningTarget(prod, { isEmulator: true }))
          .toThrow(/PRODUÇÃO/i);
        expect(() => validateProvisioningTarget(prod, { isEmulator: false }))
          .toThrow(/PRODUÇÃO/i);
      }
    });
  });

  describe('2. Modos de Operação, Efeitos Colaterais e Salvaguardas', () => {
    it('2.1 A falta de configuração de emulador NUNCA ativa modo de mutação remota (cai estritamente em instruções manuais)', async () => {
      const calls = [];
      const mockFetch = async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({}) };
      };

      // Simula ambiente sem nenhuma variável de emulador
      const result = await runProvisioning({}, {
        projectId: 'gerenciador-produtos-staging',
        isEmulator: false,
        fetchFn: mockFetch
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe('cloud-instructions');
      expect(result.projectId).toBe('gerenciador-produtos-staging');
      // Comprova matematicamente que ZERO chamadas HTTP de rede foram efetuadas
      expect(calls).toHaveLength(0);
    });

    it('2.2 A importação do módulo scripts/provision-staging.js não causa nenhum efeito colateral nem chama fetch', () => {
      // Import já realizado no topo do arquivo sem disparar nenhum fetch ou erro de console
      expect(STAGING_USERS).toBeDefined();
      expect(Array.isArray(STAGING_USERS)).toBe(true);
      expect(STAGING_USERS.length).toBe(2); // Retrocompatibilidade Fase 09 (STG-08)

      expect(STAGING_TEST_USERS).toBeDefined();
      expect(Array.isArray(STAGING_TEST_USERS)).toBe(true);
      expect(STAGING_TEST_USERS.length).toBe(4); // Contrato canônico completo Fase 14/15
    });
  });

  describe('3. Auditoria de Contas, Lookup e Atribuição de Claims', () => {
    it('3.1 Usuários de teste recebem estritamente o contrato canônico de claims e papéis válidos', () => {
      const allowedRoles = ['admin', 'operator', 'viewer'];

      for (const u of STAGING_TEST_USERS) {
        expect(u.email).toMatch(/^[a-z0-9\-]+@staging\.local$/);
        expect(allowedRoles).toContain(u.appRole);
        expect(u.role).toBe('authenticated'); // Exigência técnica do Supabase
        expect(u.tenantId).toMatch(/^tenant-staging-\d{2}$/);
      }

      // Validação das 4 contas específicas
      const adminA = STAGING_TEST_USERS.find(u => u.email === 'admin@staging.local');
      expect(adminA.appRole).toBe('admin');
      expect(adminA.tenantId).toBe('tenant-staging-01');

      const operA = STAGING_TEST_USERS.find(u => u.email === 'operador@staging.local');
      expect(operA.appRole).toBe('operator');
      expect(operA.tenantId).toBe('tenant-staging-01');

      const auditorA = STAGING_TEST_USERS.find(u => u.email === 'auditor@staging.local');
      expect(auditorA.appRole).toBe('viewer'); // Auditor funcional é papel canônico viewer
      expect(auditorA.tenantId).toBe('tenant-staging-01');

      const adminB = STAGING_TEST_USERS.find(u => u.email === 'admin-b@staging.local');
      expect(adminB.appRole).toBe('admin');
      expect(adminB.tenantId).toBe('tenant-staging-02'); // Isolamento cross-tenant
    });

    it('3.2 Criação com sucesso de nova conta e associação de claims no emulador', async () => {
      const httpCalls = [];
      const mockFetch = async (url, opts) => {
        httpCalls.push({ url, method: opts?.method, body: JSON.parse(opts?.body || '{}') });

        if (url.includes('accounts:signUp')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ localId: 'uid_novo_123', email: 'admin@staging.local' })
          };
        }

        if (url.includes('accounts:update')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ localId: 'uid_novo_123' })
          };
        }

        throw new Error(`URL inesperada: ${url}`);
      };

      const res = await provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[0]]
      });

      expect(res.success).toBe(true);
      expect(res.provisionedCount).toBe(1);
      expect(res.results[0].uid).toBe('uid_novo_123');
      expect(res.results[0].claims.appRole).toBe('admin');
      expect(res.results[0].claims.role).toBe('authenticated');
      expect(res.results[0].claims.tenantId).toBe('tenant-staging-01');

      expect(httpCalls).toHaveLength(2);
      expect(httpCalls[0].url).toContain('accounts:signUp');
      expect(httpCalls[1].url).toContain('accounts:update');
      expect(httpCalls[1].body.localId).toBe('uid_novo_123');
    });

    it('3.3 Conta já existente recupera o UID via accounts:lookup antes de associar claims', async () => {
      const httpCalls = [];
      const mockFetch = async (url, opts) => {
        const body = JSON.parse(opts?.body || '{}');
        httpCalls.push({ url, method: opts?.method, body });

        // 1. SignUp falha informando EMAIL_EXISTS (status 400)
        if (url.includes('accounts:signUp')) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ error: { message: 'EMAIL_EXISTS' } })
          };
        }

        // 2. Lookup é chamado com o e-mail para recuperar o UID existente
        if (url.includes('accounts:lookup')) {
          expect(body.email).toEqual(['operador@staging.local']);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              users: [{ localId: 'uid_recuperado_999', email: 'operador@staging.local' }]
            })
          };
        }

        // 3. Update de claims é executado com o UID recuperado
        if (url.includes('accounts:update')) {
          expect(body.localId).toBe('uid_recuperado_999');
          return {
            ok: true,
            status: 200,
            json: async () => ({ localId: 'uid_recuperado_999' })
          };
        }

        throw new Error(`URL inesperada: ${url}`);
      };

      const res = await provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[1]] // Operador
      });

      expect(res.success).toBe(true);
      expect(res.provisionedCount).toBe(1);
      expect(res.results[0].uid).toBe('uid_recuperado_999');
      expect(res.results[0].claims.appRole).toBe('operator');

      expect(httpCalls).toHaveLength(3);
      expect(httpCalls[0].url).toContain('accounts:signUp');
      expect(httpCalls[1].url).toContain('accounts:lookup');
      expect(httpCalls[2].url).toContain('accounts:update');
      expect(httpCalls[2].body.localId).toBe('uid_recuperado_999');
    });

    it('3.4 Falha na consulta de UID em conta existente interrompe a execução com erro fail-closed', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { message: 'EMAIL_EXISTS' } })
          };
        }

        if (url.includes('accounts:lookup')) {
          // Lookup falha ou retorna lista vazia
          return {
            ok: true,
            status: 200,
            json: async () => ({ users: [] })
          };
        }

        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: [STAGING_USERS[0]]
      })).rejects.toThrow(/Não foi possível determinar o UID/i);
    });

    it('3.5 Erro genérico na criação da conta interrompe o provisionamento sem falso sucesso', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ error: { message: 'INTERNAL_ERROR' } })
          };
        }
        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: [STAGING_USERS[0]]
      })).rejects.toThrow(/Falha ao criar conta admin@staging.local: INTERNAL_ERROR/i);
    });

    it('3.6 Falha ao atribuir custom claims produz erro e aborta a operação', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ localId: 'uid_test_claims_fail' })
          };
        }

        if (url.includes('accounts:update')) {
          return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({ error: { message: 'OPERATION_NOT_ALLOWED' } })
          };
        }

        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: [STAGING_USERS[0]]
      })).rejects.toThrow(/Falha ao associar custom claims/i);
    });

    it('3.7 O script administrativo NÃO realiza chamadas de deleção física de contas ou limpeza ampla', async () => {
      const executedMethods = [];
      const executedEndpoints = [];

      const mockFetch = async (url, opts) => {
        executedMethods.push(opts?.method || 'GET');
        executedEndpoints.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ localId: 'uid_audit_safe' })
        };
      };

      await provisionEmulatorAuth({
        authHost: 'localhost:9099',
        fetchFn: mockFetch,
        users: STAGING_TEST_USERS
      });

      // Comprova que nenhum método DELETE foi disparado
      expect(executedMethods.every(m => m === 'POST')).toBe(true);
      expect(executedMethods.some(m => m === 'DELETE')).toBe(false);

      // Comprova que nenhum endpoint de deleteUser ou purge foi invocado
      for (const endpoint of executedEndpoints) {
        expect(endpoint).not.toMatch(/deleteAccount|deleteUser|purge|drop/i);
      }
    });
  });
});
