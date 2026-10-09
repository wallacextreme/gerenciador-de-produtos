import { describe, it, expect } from 'bun:test';
import net from 'node:net';
import {
  EXPECTED_PROJECT_ID,
  REQUIRED_PORTS,
  AUTH_PORT,
  STORAGE_PORT,
  UI_PORT,
  HUB_PORT,
  validateProjectSafety,
  resolveJdk21Env,
  isPortListening,
  inspectRequiredPorts,
  inspectAndVerifyEmulators
} from '../scripts/test-storage-emulator.js';

describe('PHASE 13.17 — Storage Emulator Harness & Safety Audit Suite', () => {
  // =========================================================================
  // 1. Auditoria de Segurança do Project ID e Configuration Drift
  // =========================================================================
  describe('1: Validação de Segurança do Project ID e Configuration Drift', () => {
    it('deve aceitar estritamente o Project ID demonstrativo autorizado', () => {
      const res = validateProjectSafety(EXPECTED_PROJECT_ID);
      expect(res).toBe('demo-gerenciador-produtos-staging');
    });

    it('deve rejeitar categoricamente qualquer Project ID sem o prefixo demo-', () => {
      expect(() => {
        validateProjectSafety('gerenciador-produtos-staging');
      }).toThrow(/não inicia com "demo-"/);
    });

    it('deve rejeitar projeto divergente mesmo que comece com demo-', () => {
      expect(() => {
        validateProjectSafety('demo-outro-projeto');
      }).toThrow(/rejeitado! A suíte de testes de integração opera EXCLUSIVAMENTE contra/);
    });

    it('deve bloquear categoricamente tentativas contra projetos de produção conhecidos', () => {
      expect(() => {
        validateProjectSafety('caixa-autopecas');
      }).toThrow();
    });

    it('deve abortar em caso de configuration drift em FIREBASE_PROJECT_ID', () => {
      const mockEnv = { FIREBASE_PROJECT_ID: 'projeto-conflitante' };
      expect(() => {
        validateProjectSafety(EXPECTED_PROJECT_ID, mockEnv);
      }).toThrow(/Conflito de Project ID detectado na variável de ambiente FIREBASE_PROJECT_ID/);
    });

    it('deve abortar em caso de configuration drift em VITE_FIREBASE_PROJECT_ID', () => {
      const mockEnv = { VITE_FIREBASE_PROJECT_ID: 'outro-conflitante' };
      expect(() => {
        validateProjectSafety(EXPECTED_PROJECT_ID, mockEnv);
      }).toThrow(/Conflito de Project ID detectado na variável de ambiente VITE_FIREBASE_PROJECT_ID/);
    });

    it('deve abortar em caso de configuration drift em GCLOUD_PROJECT', () => {
      const mockEnv = { GCLOUD_PROJECT: 'gcloud-conflitante' };
      expect(() => {
        validateProjectSafety(EXPECTED_PROJECT_ID, mockEnv);
      }).toThrow(/Conflito de Project ID detectado na variável de ambiente GCLOUD_PROJECT/);
    });
  });

  // =========================================================================
  // 2. Auditoria de Seleção do JDK
  // =========================================================================
  describe('2: Resolução Segura do JDK 21', () => {
    it('deve falhar explicitamente quando nenhum JDK 21 estiver disponível nos candidatos', () => {
      expect(() => {
        resolveJdk21Env({
          checkPath: false,
          skipPlatformDefaults: true,
          env: { JAVA_HOME: '', PATH: '' },
          candidates: ['C:\\InexistentPath\\jdk-dummy']
        });
      }).toThrow(/JDK 21 LTS ou superior não encontrado/);
    });

    it('deve resolver o OpenJDK 21 existente sem modificar variáveis globais do sistema', () => {
      const originalJavaHome = process.env.JAVA_HOME;
      const originalPath = process.env.PATH;

      const resolved = resolveJdk21Env();
      expect(resolved).toBeDefined();
      expect(resolved.env).toBeDefined();
      expect(resolved.source).toBeDefined();

      // Confirma que o ambiente global não foi poluído
      expect(process.env.JAVA_HOME).toBe(originalJavaHome);
      expect(process.env.PATH).toBe(originalPath);
    });
  });

  // =========================================================================
  // 3. Auditoria de Portas Ocupadas e Preservação de Processos (Política Conservadora)
  // =========================================================================
  describe('3: Detecção de Conflitos e Preservação de Serviços (Política Conservadora)', () => {
    it('deve definir explicitamente todas as portas exigidas pelo Firebase Emulator Suite', () => {
      expect(AUTH_PORT).toBe(9099);
      expect(STORAGE_PORT).toBe(9199);
      expect(UI_PORT).toBe(4000);
      expect(HUB_PORT).toBe(4400);
      expect(REQUIRED_PORTS.length).toBe(4);
    });

    it('isPortListening deve reportar false para porta livre e true para servidor ativo', async () => {
      const server = net.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        const listening = await isPortListening(port);
        expect(listening).toBe(true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }

      const closed = await isPortListening(port);
      expect(closed).toBe(false);
    });

    it('deve abortar com status CONFLICT se qualquer porta necessária estiver em uso, preservando o processo', async () => {
      // Inicia um servidor sintético efêmero em porta aleatória
      const dummyProcess = net.createServer((socket) => {
        socket.write('HELLO THIRD PARTY SERVICE\n');
        socket.end();
      });

      await new Promise((resolve) => dummyProcess.listen(0, '127.0.0.1', resolve));
      const dummyPort = dummyProcess.address().port;

      try {
        const result = await inspectRequiredPorts({
          ports: [
            { name: 'Dummy Service', port: dummyPort },
            { name: 'Storage Fake', port: 64998 }
          ]
        });

        expect(result.status).toBe('CONFLICT');
        expect(result.busyPorts.length).toBe(1);
        expect(result.busyPorts[0].port).toBe(dummyPort);
        expect(result.message).toContain('Uma ou mais portas necessárias para o Firebase Emulator Suite já estão em uso');
        expect(result.message).toContain('O orquestrador NÃO encerra processos de terceiros');
        expect(result.message).toContain('O orquestrador NÃO tenta reutilizar sessões preexistentes');

        // Confirma categoricamente que o processo concorrente NÃO foi encerrado
        const stillListening = await isPortListening(dummyPort);
        expect(stillListening).toBe(true);
      } finally {
        await new Promise((resolve) => dummyProcess.close(resolve));
      }
    });

    it('deve reportar PORTS_FREE quando todas as portas obrigatórias estiverem desocupadas', async () => {
      const serverA = net.createServer();
      const serverB = net.createServer();
      await new Promise((r) => serverA.listen(0, '127.0.0.1', r));
      await new Promise((r) => serverB.listen(0, '127.0.0.1', r));
      const freePortA = serverA.address().port;
      const freePortB = serverB.address().port;
      await new Promise((r) => serverA.close(r));
      await new Promise((r) => serverB.close(r));

      const result = await inspectRequiredPorts({
        ports: [
          { name: 'Free Port A', port: freePortA },
          { name: 'Free Port B', port: freePortB }
        ]
      });

      expect(result.status).toBe('PORTS_FREE');
      expect(result.busyPorts.length).toBe(0);
    });

    it('inspectAndVerifyEmulators deve funcionar como alias compatível de inspectRequiredPorts', async () => {
      expect(typeof inspectAndVerifyEmulators).toBe('function');
      expect(inspectAndVerifyEmulators).toBe(inspectRequiredPorts);
    });
  });
});
