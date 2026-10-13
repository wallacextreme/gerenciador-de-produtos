import { describe, it, expect } from 'bun:test';
import {
  validateEmulatorHost,
  validateProvisioningTarget,
  provisionEmulatorAuth,
  runProvisioning,
  ALLOWED_LOOPBACK_HOSTS,
  ALLOWED_AUTH_EMULATOR_PORTS,
  AUTHORIZED_EMULATOR_PROJECTS,
  AUTHORIZED_CLOUD_STAGING_PROJECTS,
  STAGING_TEST_USERS
} from '../scripts/provision-staging.js';

/**
 * FASE 15.4 — Isolamento dos Endpoints Administrativos do Auth Emulator e Gate Final Local
 *
 * Suíte de testes rigorosa focada no isolamento estrito de chamadas com `Authorization: Bearer owner`:
 * 1. Validação estrutural e restrita do host do emulador (loopback restrito a 127.0.0.1, localhost e ::1).
 * 2. Proibição categórica de URLs completas, esquemas http/https, caminhos, queries e fragmentos.
 * 3. Proibição de portas divergentes da autorizada (9099).
 * 4. Matriz adversária de destinos (bypass por substring, domínios públicos, staging falsos).
 * 5. Bloqueio fail-closed antes de qualquer chamada HTTP.
 * 6. Impossibilidade de execução administrativa no modo cloud-instructions.
 * 7. Bloqueio de respostas de redirecionamento (redirect: 'error' / rejeição de 3xx).
 */

describe('FASE 15.4 — Isolamento dos Endpoints Administrativos e Gate Final Local', () => {

  describe('1. Matriz de Destinos de Host e Porta (Validação Estrutural)', () => {
    it('1.1 Aceita 127.0.0.1 com a porta autorizada 9099', () => {
      const res = validateEmulatorHost('127.0.0.1:9099');
      expect(res.valid).toBe(true);
      expect(res.host).toBe('127.0.0.1');
      expect(res.port).toBe(9099);
      expect(res.normalized).toBe('127.0.0.1:9099');
    });

    it('1.2 Aceita localhost com a porta autorizada 9099', () => {
      const res = validateEmulatorHost('localhost:9099');
      expect(res.valid).toBe(true);
      expect(res.host).toBe('localhost');
      expect(res.port).toBe(9099);
      expect(res.normalized).toBe('localhost:9099');
    });

    it('1.3 Aceita [::1] (IPv6 loopback) com a porta autorizada 9099', () => {
      const res = validateEmulatorHost('[::1]:9099');
      expect(res.valid).toBe(true);
      expect(res.host).toBe('::1');
      expect(res.port).toBe(9099);
      expect(res.normalized).toBe('[::1]:9099');
    });

    it('1.4 Rejeita hostname público arbitrário', () => {
      expect(() => validateEmulatorHost('api.exemplo.com:9099'))
        .toThrow(/não é um endereço de loopback autorizado/);
      expect(() => validateEmulatorHost('firebase.googleapis.com:9099'))
        .toThrow(/não é um endereço de loopback autorizado/);
      expect(() => validateEmulatorHost('8.8.8.8:9099'))
        .toThrow(/não é um endereço de loopback autorizado/);
    });

    it('1.5 Rejeita domínio contendo a palavra "staging"', () => {
      const candidates = [
        'staging.gestaopro.internal:9099',
        'auth-staging.firebase.com:9099',
        'my-staging-server:9099',
        'staging:9099'
      ];
      for (const host of candidates) {
        expect(() => validateEmulatorHost(host))
          .toThrow(/não é um endereço de loopback autorizado/);
      }
    });

    it('1.6 Rejeita domínio que apenas incorpora a palavra "localhost" como substring', () => {
      const bypassAttempts = [
        'localhost.attacker.com:9099',
        'fake-localhost:9099',
        'notlocalhost:9099',
        'localhost.org:9099'
      ];
      for (const host of bypassAttempts) {
        expect(() => validateEmulatorHost(host))
          .toThrow(/não é um endereço de loopback autorizado/);
      }
    });

    it('1.7 Rejeita host que incorpora "127.0.0.1" em parte do nome', () => {
      const bypassAttempts = [
        '127.0.0.1.nip.io:9099',
        '127.0.0.1.traefik.me:9099',
        'sub.127.0.0.1:9099',
        'evil127.0.0.1:9099'
      ];
      for (const host of bypassAttempts) {
        expect(() => validateEmulatorHost(host))
          .toThrow(/não é um endereço de loopback autorizado/);
      }
    });

    it('1.8 Rejeita URL completa onde se espera apenas host e porta', () => {
      const urls = [
        'http://127.0.0.1:9099',
        'https://127.0.0.1:9099',
        'http://localhost:9099/',
        'http://127.0.0.1:9099/identitytoolkit',
        '127.0.0.1:9099/path',
        '127.0.0.1:9099?param=1',
        '127.0.0.1:9099#fragment',
        'admin:pass@127.0.0.1:9099'
      ];
      for (const u of urls) {
        expect(() => validateEmulatorHost(u))
          .toThrow(/contém formato de URL completa, esquema ou caminho inválido/);
      }
    });

    it('1.9 Rejeita porta diferente da autorizada (9099)', () => {
      const unauthPorts = [
        '127.0.0.1:80',
        '127.0.0.1:443',
        '127.0.0.1:8080',
        'localhost:3000',
        'localhost:5000',
        '127.0.0.1:9000', // RTDB port, not Auth port
        '127.0.0.1:9199'  // Storage port, not Auth port
      ];
      for (const host of unauthPorts) {
        expect(() => validateEmulatorHost(host))
          .toThrow(/Porta ".*" do Auth Emulator não autorizada/);
      }
    });

    it('1.10 Rejeita configuração vazia, nula, indefinida ou malformada', () => {
      expect(() => validateEmulatorHost('')).toThrow(/não informado ou vazio/);
      expect(() => validateEmulatorHost(null)).toThrow(/não informado ou vazio/);
      expect(() => validateEmulatorHost(undefined)).toThrow(/não informado ou vazio/);
      expect(() => validateEmulatorHost('   ')).toThrow(/não informado ou vazio/);
      expect(() => validateEmulatorHost('127.0.0.1')).toThrow(/deve conter exatamente "host:porta"/);
      expect(() => validateEmulatorHost('127.0.0.1:abc')).toThrow(/não autorizada/);
      expect(() => validateEmulatorHost('127.0.0.1:9099:extra')).toThrow(/deve conter exatamente "host:porta"/);
    });
  });

  describe('2. Isolamento de Project ID e Modos de Execução', () => {
    it('2.1 Rejeita projeto de demonstração não autorizado no modo emulador', () => {
      expect(() => validateProvisioningTarget('demo-projeto-estranho', { isEmulator: true }))
        .toThrow(/rejeitado para modo emulador/);
      expect(() => validateProvisioningTarget('demo-outro-sistema', { isEmulator: true }))
        .toThrow(/rejeitado para modo emulador/);
    });

    it('2.2 Rejeita project ID real ou desconhecido no modo emulador', () => {
      expect(() => validateProvisioningTarget('gerenciador-produtos', { isEmulator: true }))
        .toThrow();
      expect(() => validateProvisioningTarget('gerenciador-produtos-prod', { isEmulator: true }))
        .toThrow();
      expect(() => validateProvisioningTarget('meu-projeto-real', { isEmulator: true }))
        .toThrow(/rejeitado para modo emulador/);
    });

    it('2.3 Modo cloud-instructions NUNCA dispara chamadas HTTP ou cabeçalho Bearer owner', async () => {
      const calls = [];
      const mockFetch = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const result = await runProvisioning(
        {
          FIREBASE_PROJECT_ID: 'gerenciador-produtos-staging',
          // Sem FIREBASE_AUTH_EMULATOR_HOST e sem USE_EMULATOR
        },
        { fetchFn: mockFetch }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('cloud-instructions');
      // Prova matemática de ZERO chamadas HTTP e ZERO emissão de Bearer owner
      expect(calls).toHaveLength(0);
    });
  });

  describe('3. Isolamento do Cabeçalho Authorization: Bearer owner e Bloqueio Prévio', () => {
    it('3.1 Host inválido via opções bloqueia a execução ANTES da primeira chamada fetch', async () => {
      let fetchCalled = false;
      const mockFetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: 'evil-host.com:9099',
        projectId: 'demo-gerenciador-produtos-staging',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[0]]
      })).rejects.toThrow(/não é um endereço de loopback autorizado/);

      // Comprova que o fetch NUNCA foi chamado
      expect(fetchCalled).toBe(false);
    });

    it('3.2 Project ID inválido bloqueia a execução ANTES da primeira chamada fetch', async () => {
      let fetchCalled = false;
      const mockFetch = async () => {
        fetchCalled = true;
        return { ok: true, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: '127.0.0.1:9099',
        projectId: 'projeto-nao-autorizado',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[0]]
      })).rejects.toThrow(/rejeitado para modo emulador/);

      expect(fetchCalled).toBe(false);
    });

    it('3.3 Cabeçalho Bearer owner é enviado estritamente com URL validada e loopback comprovado', async () => {
      const capturedRequests = [];
      const mockFetch = async (url, opts) => {
        capturedRequests.push({ url, headers: opts?.headers, redirect: opts?.redirect });
        if (url.includes('accounts:signUp')) {
          return { ok: true, status: 200, json: async () => ({ localId: 'uid_test_123' }) };
        }
        if (url.includes('accounts:update')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      await provisionEmulatorAuth({
        authHost: '127.0.0.1:9099',
        projectId: 'demo-gerenciador-produtos-staging',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[0]]
      });

      expect(capturedRequests).toHaveLength(2);

      // Request 1: signUp não deve conter Bearer owner
      expect(capturedRequests[0].url).toBe('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key');
      expect(capturedRequests[0].headers.Authorization).toBeUndefined();
      expect(capturedRequests[0].redirect).toBe('error');

      // Request 2: update administrativo possui Bearer owner estritamente no loopback
      expect(capturedRequests[1].url).toBe('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-gerenciador-produtos-staging/accounts:update?key=fake-key');
      expect(capturedRequests[1].headers.Authorization).toBe('Bearer owner');
      expect(capturedRequests[1].redirect).toBe('error');
    });
  });

  describe('4. Respostas de Redirecionamento (Proteção contra Redirects Maliciosos)', () => {
    it('4.1 Rejeita respostas de redirecionamento HTTP 301/302/307/308 de forma fail-closed', async () => {
      const redirectStatuses = [301, 302, 307, 308];

      for (const status of redirectStatuses) {
        const mockFetch = async (url) => {
          if (url.includes('accounts:signUp')) {
            return {
              ok: false,
              status,
              headers: { location: 'http://malicious-host.com/steal' }
            };
          }
          return { ok: true, status: 200, json: async () => ({}) };
        };

        await expect(provisionEmulatorAuth({
          authHost: '127.0.0.1:9099',
          projectId: 'demo-gerenciador-produtos-staging',
          fetchFn: mockFetch,
          users: [STAGING_TEST_USERS[0]]
        })).rejects.toThrow(/Redirecionamento não permitido em chamadas administrativas/);
      }
    });

    it('4.2 Rejeita resposta de redirecionamento no endpoint administrativo accounts:update', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return { ok: true, status: 200, json: async () => ({ localId: 'uid_test_redirect' }) };
        }
        if (url.includes('accounts:update')) {
          return {
            ok: false,
            status: 302,
            headers: { location: 'http://malicious-host.com/leak-owner' }
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      await expect(provisionEmulatorAuth({
        authHost: '127.0.0.1:9099',
        projectId: 'demo-gerenciador-produtos-staging',
        fetchFn: mockFetch,
        users: [STAGING_TEST_USERS[0]]
      })).rejects.toThrow(/Redirecionamento não permitido em chamadas administrativas/);
    });
  });

  describe('5. Ausência de Credenciais em Mensagens de Erro', () => {
    it('5.1 Erro em chamadas administrativas não exibe o cabeçalho Bearer owner ou senhas no texto do erro', async () => {
      const mockFetch = async (url) => {
        if (url.includes('accounts:signUp')) {
          return { ok: true, status: 200, json: async () => ({ localId: 'uid_safe_err' }) };
        }
        if (url.includes('accounts:update')) {
          return {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({ error: { message: 'INSUFFICIENT_PERMISSIONS' } })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      try {
        await provisionEmulatorAuth({
          authHost: '127.0.0.1:9099',
          projectId: 'demo-gerenciador-produtos-staging',
          fetchFn: mockFetch,
          users: [STAGING_TEST_USERS[0]]
        });
        expect(true).toBe(false); // Não deve alcançar aqui
      } catch (err) {
        expect(err.message).not.toContain('Bearer owner');
        expect(err.message).not.toContain('StagingPassword123!');
        expect(err.message).toContain('[ERRO CRÍTICO] Falha ao associar custom claims');
      }
    });
  });
});
