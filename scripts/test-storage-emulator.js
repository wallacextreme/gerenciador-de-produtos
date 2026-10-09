#!/usr/bin/env bun
/**
 * GestãoPro — Orquestrador e Harness de Testes de Integração com Firebase Storage Emulator (PHASE 13.17)
 *
 * Requisitos e Salvaguardas de Segurança:
 * 1. Opera EXCLUSIVAMENTE contra o projeto demonstrativo: demo-gerenciador-produtos-staging.
 * 2. Bloqueia terminantemente conexões a projetos de produção ou sem o prefixo "demo-".
 * 3. Valida e injeta OpenJDK 21 LTS na sessão de subprocessos, preservando a instalação global do sistema (ex: Java 8).
 * 4. Inspeciona portas obrigatórias (Auth 9099, Storage 9199, UI 4000, Hub 4400) sob POLÍTICA CONSERVADORA:
 *    - Se todas as portas necessárias estiverem livres: inicia a suíte via `firebase emulators:exec`.
 *    - Se QUALQUER porta estiver ocupada antes da execução: ABORTA IMEDIATAMENTE (código de saída != 0).
 *    - Não envia payloads ou requisições de teste para serviços desconhecidos.
 *    - Não encerra nem interfere em processos preexistentes (zero taskkill).
 *    - Não tenta adotar ou reutilizar automaticamente sessões preexistentes.
 *    - Orienta o usuário a inspecionar e encerrar manualmente processos concorrentes, se apropriado.
 * 5. Gerenciamento de ciclo de vida 100% nativo pelo `firebase emulators:exec`.
 * 6. Propaga fielmente o código de saída dos testes.
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProductionProject } from '../src/js/utils/firebaseConfigValidator.js';

export const EXPECTED_PROJECT_ID = 'demo-gerenciador-produtos-staging';
export const AUTH_PORT = 9099;
export const STORAGE_PORT = 9199;
export const UI_PORT = 4000;
export const HUB_PORT = 4400;
export const TEST_FILE = './tests/storage_emulator.integration.js';

export const REQUIRED_PORTS = [
  { name: 'Auth Emulator', port: AUTH_PORT },
  { name: 'Storage Emulator', port: STORAGE_PORT },
  { name: 'Emulator UI', port: UI_PORT },
  { name: 'Emulator Hub', port: HUB_PORT }
];

/**
 * 1. Validação Estrita do Project ID e Detecção de Configuration Drift
 * Garante que a execução nunca aponte para um projeto real, de produção ou divergente.
 */
export function validateProjectSafety(projectId = EXPECTED_PROJECT_ID, env = process.env) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[SEGURANÇA FAIL-CLOSED] Project ID ausente ou inválido.');
  }

  const clean = projectId.trim();

  // 1. O projeto DEVE conter o prefixo demo-
  if (!clean.startsWith('demo-')) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Project ID "${clean}" não inicia com "demo-". ` +
      'O prefixo "demo-" é obrigatório para ativar salvaguardas offline do Firebase SDK.'
    );
  }

  // 2. O projeto DEVE ser rigorosamente o demonstrativo autorizado
  if (clean !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Project ID "${clean}" rejeitado! ` +
      `A suíte de testes de integração opera EXCLUSIVAMENTE contra "${EXPECTED_PROJECT_ID}".`
    );
  }

  // 3. Bloqueio absoluto contra projetos de produção conhecidos
  if (isProductionProject(clean)) {
    throw new Error(
      `[SEGURANÇA CRÍTICA] Tentativa de executar testes contra projeto de PRODUÇÃO "${clean}". Execução terminantemente abortada.`
    );
  }

  // 4. Verificação contra configuration drift em variáveis de ambiente
  const envCandidates = [
    { key: 'FIREBASE_PROJECT_ID', val: env.FIREBASE_PROJECT_ID },
    { key: 'VITE_FIREBASE_PROJECT_ID', val: env.VITE_FIREBASE_PROJECT_ID },
    { key: 'GCLOUD_PROJECT', val: env.GCLOUD_PROJECT }
  ];

  for (const { key, val } of envCandidates) {
    if (val && val.trim() !== clean) {
      throw new Error(
        `[CONFIGURATION DRIFT] Conflito de Project ID detectado na variável de ambiente ${key}: ` +
        `recebido "${val.trim()}", esperado "${clean}". ` +
        `Para evitar conexões indesejadas, remova ou alinhe ${key}.`
      );
    }
  }

  return clean;
}

/**
 * 2. Validação da Versão do Java
 */
export function getJavaMajorVersion(javaExePath, env = process.env) {
  try {
    const res = spawnSync(javaExePath, ['-version'], { env, encoding: 'utf-8' });
    const output = (res.stderr || '') + (res.stdout || '');
    const match = output.match(/(?:openjdk|java)\s+(?:version\s+)?"?([0-9]+(?:\.[0-9]+)*)/i);
    if (match) {
      const major = parseInt(match[1].split('.')[0], 10);
      return { major, raw: output, versionString: match[1] };
    }
  } catch {}
  return null;
}

export function isJdk21OrHigher(javaExePath, env = process.env) {
  const ver = getJavaMajorVersion(javaExePath, env);
  return ver !== null && ver.major >= 21;
}

/**
 * 3. Resolução Segura do JDK 21 (Portabilidade e Preservação)
 * Injeta JAVA_HOME e PATH estritamente no subprocesso sem tocar em variáveis globais.
 */
export function resolveJdk21Env(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const javaBinaryName = platform === 'win32' ? 'java.exe' : 'java';
  const customCandidates = options.candidates || [];
  const skipPlatformDefaults = options.skipPlatformDefaults || false;

  // Passo A: Testar se o java já no PATH fornecido é 21+
  if (options.checkPath !== false && isJdk21OrHigher('java', env)) {
    return {
      env: { ...env },
      source: 'PATH',
      jdkPath: null
    };
  }

  // Passo B: Testar JAVA_HOME se estiver definido no ambiente
  if (env.JAVA_HOME) {
    const homeJava = path.join(env.JAVA_HOME, 'bin', javaBinaryName);
    if (fs.existsSync(homeJava) && isJdk21OrHigher(homeJava, env)) {
      const separator = platform === 'win32' ? ';' : ':';
      return {
        env: {
          ...env,
          JAVA_HOME: env.JAVA_HOME,
          PATH: `${path.join(env.JAVA_HOME, 'bin')}${separator}${env.PATH || ''}`
        },
        source: 'JAVA_HOME',
        jdkPath: env.JAVA_HOME
      };
    }
  }

  // Passo C: Candidatos padrão do sistema de arquivos
  const platformCandidates = [];
  if (!skipPlatformDefaults) {
    if (platform === 'win32') {
      platformCandidates.push(
        'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot',
        'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
        'C:\\Program Files\\Java\\jdk-21',
        'C:\\Program Files\\Microsoft\\jdk-21'
      );
    } else if (platform === 'darwin') {
      platformCandidates.push(
        '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
        '/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home'
      );
    } else {
      platformCandidates.push(
        '/usr/lib/jvm/java-21-openjdk',
        '/usr/lib/jvm/java-21-openjdk-amd64',
        '/usr/lib/jvm/temurin-21-jdk'
      );
    }
  }

  const allCandidates = [...customCandidates, ...platformCandidates];
  for (const candidate of allCandidates) {
    if (!candidate) continue;
    const candidateJava = path.join(candidate, 'bin', javaBinaryName);
    if (fs.existsSync(candidateJava) && isJdk21OrHigher(candidateJava)) {
      const separator = platform === 'win32' ? ';' : ':';
      return {
        env: {
          ...env,
          JAVA_HOME: candidate,
          PATH: `${path.join(candidate, 'bin')}${separator}${env.PATH || ''}`
        },
        source: candidate,
        jdkPath: candidate
      };
    }
  }

  throw new Error(
    `[JDK-21 CRÍTICO] JDK 21 LTS ou superior não encontrado!\n` +
    `O Firebase Storage Emulator exige Java 21+ para o runtime de regras.\n` +
    `Defina a variável JAVA_HOME apontando para um JDK 21 válido ou instale o OpenJDK 21 LTS.\n` +
    `Caminho verificado no Windows: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot".`
  );
}

/**
 * 4. Inspeção de Conectividade TCP
 */
export function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * 5. Inspeção Conservadora de Portas Obrigatórias (Política Fail-Closed Fase 13.17)
 *
 * Regra:
 * - Se todas as portas necessárias estiverem livres: retorna status 'PORTS_FREE'.
 * - Se QUALQUER porta necessária estiver ocupada: retorna status 'CONFLICT' e aborta.
 * - NENHUM payload ou probe HTTP é enviado para portas ocupadas.
 * - NENHUM processo preexistente é encerrado (zero encerramento forçado / zero taskkill).
 * - NENHUMA tentativa de adoção/reutilização automática de sessão preexistente é realizada.
 */
export async function inspectRequiredPorts(options = {}) {
  const portsToCheck = options.ports || (
    options.authPort || options.storagePort || options.hubPort || options.uiPort
      ? [
          { name: 'Auth Emulator', port: options.authPort || AUTH_PORT },
          { name: 'Storage Emulator', port: options.storagePort || STORAGE_PORT },
          { name: 'Emulator UI', port: options.uiPort || UI_PORT },
          { name: 'Emulator Hub', port: options.hubPort || HUB_PORT }
        ]
      : REQUIRED_PORTS
  );

  const busyPorts = [];

  for (const item of portsToCheck) {
    const port = typeof item === 'number' ? item : item.port;
    const name = typeof item === 'object' && item.name ? item.name : `Porta ${port}`;
    const inUse = await isPortListening(port);
    if (inUse) {
      busyPorts.push({ name, port });
    }
  }

  if (busyPorts.length === 0) {
    return {
      status: 'PORTS_FREE',
      busyPorts: []
    };
  }

  const busyDescriptions = busyPorts.map((b) => `${b.name} (${b.port})`).join(', ');

  return {
    status: 'CONFLICT',
    busyPorts,
    message:
      `[PORTA OCUPADA - ABORTO SEGURO] Uma ou mais portas necessárias para o Firebase Emulator Suite já estão em uso: ${busyDescriptions}.\n` +
      `Política de Segurança Conservadora (Fase 13.17):\n` +
      `- O orquestrador NÃO envia payloads nem realiza sondagens nas portas ocupadas.\n` +
      `- O orquestrador NÃO encerra processos de terceiros (zero encerramento forçado).\n` +
      `- O orquestrador NÃO tenta reutilizar sessões preexistentes para evitar interferência em outros serviços locais.\n` +
      `Ação recomendada: Verifique quais processos locais estão utilizando as portas ${busyDescriptions} e encerre-os manualmente se apropriado antes de reexecutar os testes.`
  };
}

// Alias para retrocompatibilidade
export const inspectAndVerifyEmulators = inspectRequiredPorts;

/**
 * 6. Função Principal do Orquestrador
 */
export async function runOrchestrator() {
  console.log('=====================================================================');
  console.log(' GestãoPro — Orquestrador de Testes do Storage Emulator (Fase 13.17)');
  console.log('=====================================================================');

  // A. Validação fail-closed do projeto
  const projectId = validateProjectSafety(EXPECTED_PROJECT_ID);
  console.log(`[SEGURANÇA] Projeto validado: ${projectId} (modo demonstrativo offline)`);

  // B. Resolução do JDK 21
  const { env: jdkEnv, source: jdkSource } = resolveJdk21Env();
  console.log(`[JDK] Ambiente Java 21 configurado via: ${jdkSource}`);

  // C. Inspeção conservadora de portas obrigatórias
  console.log(`[PORTAS] Inspecionando portas necessárias: ${REQUIRED_PORTS.map((p) => `${p.name} (${p.port})`).join(', ')}...`);
  const portStatus = await inspectRequiredPorts();

  if (portStatus.status === 'CONFLICT') {
    console.error(`\n\x1b[31m${portStatus.message}\x1b[0m\n`);
    process.exit(1);
  }

  console.log('[PORTAS] Todas as portas necessárias estão livres.');
  console.log('[EMULATOR] Iniciando ciclo de vida gerenciado via `firebase emulators:exec`...');
  console.log('[EMULATOR] O `emulators:exec` é o único responsável pelo boot e encerramento gracioso.');
  console.log('---------------------------------------------------------------------');
  console.log(`[TEST] Comando de teste: bun test ${TEST_FILE}`);
  console.log('---------------------------------------------------------------------');

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const testCommand = `bun test ${TEST_FILE}`;

  const execRun = spawnSync(
    npxCmd,
    [
      'firebase',
      'emulators:exec',
      '--only',
      'storage,auth',
      '--project',
      projectId,
      testCommand
    ],
    {
      stdio: 'inherit',
      env: jdkEnv
    }
  );

  const exitCode = execRun.status ?? (execRun.error ? 1 : 0);

  console.log('=====================================================================');
  console.log(`Resultado da Execução: ${exitCode === 0 ? '\x1b[32mPASS (Sucesso)\x1b[0m' : '\x1b[31mFAIL (Falha)\x1b[0m'}`);
  console.log('=====================================================================');
  process.exit(exitCode);
}

// Executar main somente quando chamado diretamente via linha de comando
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('test-storage-emulator.js')
);

if (isMain) {
  // Tratar sinais de interrupção com segurança
  process.on('SIGINT', () => {
    console.log('\n[INTERRUPÇÃO] Sinal SIGINT recebido pelo orquestrador. Finalizando...');
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    console.log('\n[INTERRUPÇÃO] Sinal SIGTERM recebido pelo orquestrador. Finalizando...');
    process.exit(143);
  });

  runOrchestrator().catch((err) => {
    console.error(`\x1b[31m[ERRO NÃO TRATADO]\x1b[0m ${err.message}`);
    process.exit(1);
  });
}
