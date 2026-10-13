#!/usr/bin/env node
/**
 * GestãoPro — Script de Provisionamento de Staging e Emulators (Fase 15.2 Hardened)
 * 
 * ATENÇÃO DE SEGURANÇA:
 * - Este script roda EXCLUSIVAMENTE em ambiente administrativo externo (Node/Bun).
 * - NUNCA deve ser importado em src/ ou empacotado no frontend/PWA/Tauri.
 * - Bloqueia terminantemente conexões a projetos de produção ou destinos não autorizados.
 * - Validação de ambiente EXATA e FAIL-CLOSED (sem correspondência parcial de strings).
 * - NUNCA imprime senhas, tokens ou chaves privadas nos logs.
 */

import { fileURLToPath } from 'node:url';
import { FORBIDDEN_PRODUCTION_PROJECTS, isProductionProject } from '../src/js/utils/firebaseConfigValidator.js';

/**
 * Lista exata e fechada de identificadores de projeto autorizados para cada modo de operação.
 * NENHUM outro identificador é aceito, mesmo que contenha palavras como "staging", "test" ou "demo".
 */
export const AUTHORIZED_EMULATOR_PROJECTS = Object.freeze([
  'demo-gerenciador-produtos-staging',
  'demo-rtdb-rules-emulator',
  'demo-rtdb-payload-roundtrip-14-26',
  'demo-rtdb-final-contract-14-25'
]);

export const AUTHORIZED_CLOUD_STAGING_PROJECTS = Object.freeze([
  'gerenciador-produtos-staging'
]);

/**
 * Usuários de staging base para retrocompatibilidade com a suíte da Fase 09 (STG-08).
 */
export const STAGING_USERS = Object.freeze([
  {
    email: 'admin@staging.local',
    role: 'admin',
    appRole: 'admin',
    tenantId: 'tenant-staging',
    displayName: 'Administrador Staging'
  },
  {
    email: 'operador@staging.local',
    role: 'operator',
    appRole: 'operator',
    tenantId: 'tenant-staging',
    displayName: 'Operador Staging'
  }
]);

/**
 * Contas sintéticas de teste com o contrato canônico completo de Custom Claims estabelecido na Fase 14/15:
 * - appRole: papel empresarial ('admin', 'operator', 'viewer')
 * - role: papel técnico para o Supabase Storage ('authenticated')
 * - tenantId: isolamento multi-tenant ('tenant-staging-01' e 'tenant-staging-02')
 * - Auditor funcional estritamente com appRole 'viewer'
 */
export const STAGING_TEST_USERS = Object.freeze([
  {
    email: 'admin@staging.local',
    appRole: 'admin',
    role: 'authenticated',
    tenantId: 'tenant-staging-01',
    displayName: 'Administrador Staging (Tenant A)'
  },
  {
    email: 'operador@staging.local',
    appRole: 'operator',
    role: 'authenticated',
    tenantId: 'tenant-staging-01',
    displayName: 'Operador Staging (Tenant A)'
  },
  {
    email: 'auditor@staging.local',
    appRole: 'viewer',
    role: 'authenticated',
    tenantId: 'tenant-staging-01',
    displayName: 'Auditor de Teste (Viewer - Tenant A)'
  },
  {
    email: 'admin-b@staging.local',
    appRole: 'admin',
    role: 'authenticated',
    tenantId: 'tenant-staging-02',
    displayName: 'Administrador Staging (Tenant B - Isolamento)'
  }
]);

/**
 * 1. Validação Pura de Destino e Modo (Sem Efeitos Colaterais)
 *
 * @param {string} projectId Identificador do projeto
 * @param {Object} options Opções de ambiente
 * @param {boolean} [options.isEmulator=false] Se o modo emulador foi ativado
 * @returns {{ valid: boolean, projectId: string, mode: 'emulator' | 'cloud-instructions' }}
 * @throws {Error} Se o identificador for inválido, desconhecido ou não autorizado para o modo
 */
export function validateProvisioningTarget(projectId, options = {}) {
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('[SEGURANÇA FAIL-CLOSED] Project ID ausente ou inválido.');
  }

  const clean = projectId.trim();

  // 1. Bloqueio absoluto e imediato de projetos de produção conhecidos
  if (isProductionProject(clean)) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Tentativa de provisionamento no projeto de PRODUÇÃO "${clean}". Execução terminantemente bloqueada.`
    );
  }

  const isEmulator = Boolean(options.isEmulator);

  // 2. Modo Emulador: Validação Exata contra lista de projetos demo autorizados
  if (isEmulator) {
    if (!AUTHORIZED_EMULATOR_PROJECTS.includes(clean)) {
      throw new Error(
        `[SEGURANÇA FAIL-CLOSED] Project ID "${clean}" rejeitado para modo emulador! ` +
        `Identificadores autorizados: ${AUTHORIZED_EMULATOR_PROJECTS.join(', ')}.`
      );
    }
    return { valid: true, projectId: clean, mode: 'emulator' };
  }

  // 3. Modo Cloud Staging: Validação Exata contra lista de staging autorizada
  if (!AUTHORIZED_CLOUD_STAGING_PROJECTS.includes(clean)) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Project ID "${clean}" rejeitado para staging em nuvem! ` +
      `Identificadores autorizados: ${AUTHORIZED_CLOUD_STAGING_PROJECTS.join(', ')}.`
    );
  }

  // Modo cloud staging não executa chamadas remotas automáticas, apenas orientações manuais
  return { valid: true, projectId: clean, mode: 'cloud-instructions' };
}

/**
 * 2. Validação Estrutural e de Segurança do Host do Emulador (Fase 15.4)
 *
 * Garante que chamadas administrativas nunca possam ser direcionadas para hosts remotos,
 * domínios públicos, URLs contendo esquemas/caminhos ou portas não autorizadas.
 */
export const ALLOWED_LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1']);
export const ALLOWED_AUTH_EMULATOR_PORTS = Object.freeze([9099]);

export function validateEmulatorHost(rawHost, options = {}) {
  if (!rawHost || typeof rawHost !== 'string' || !rawHost.trim()) {
    throw new Error('[SEGURANÇA FAIL-CLOSED] Host do Auth Emulator não informado ou vazio.');
  }

  const clean = rawHost.trim();

  // 1. Proibir categoricamente esquema http/https, caminhos, queries, fragmentos ou credenciais
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(clean) || clean.includes('/') || clean.includes('?') || clean.includes('#') || clean.includes('@')) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Host do Auth Emulator "${clean}" contém formato de URL completa, esquema ou caminho inválido. ` +
      'Esperado estritamente formato "host:porta" (ex: "127.0.0.1:9099").'
    );
  }

  let hostPart = '';
  let portPart = '';

  if (clean.startsWith('[')) {
    // IPv6 entre colchetes: [::1]:9099
    const closingBracket = clean.indexOf(']');
    if (closingBracket === -1 || clean[closingBracket + 1] !== ':') {
      throw new Error(`[SEGURANÇA FAIL-CLOSED] Formato IPv6 inválido em "${clean}".`);
    }
    hostPart = clean.slice(1, closingBracket);
    portPart = clean.slice(closingBracket + 2);
  } else {
    const parts = clean.split(':');
    if (parts.length !== 2) {
      throw new Error(
        `[SEGURANÇA FAIL-CLOSED] Host do Auth Emulator "${clean}" deve conter exatamente "host:porta".`
      );
    }
    hostPart = parts[0];
    portPart = parts[1];
  }

  // 2. Validação estrita da porta
  const portNum = parseInt(portPart, 10);
  const allowedPorts = options.allowedPorts || ALLOWED_AUTH_EMULATOR_PORTS;
  if (!/^\d+$/.test(portPart) || isNaN(portNum) || portNum <= 0 || portNum > 65535 || !allowedPorts.includes(portNum)) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Porta "${portPart}" do Auth Emulator não autorizada. ` +
      `Portas permitidas: ${allowedPorts.join(', ')}.`
    );
  }

  // 3. Validação estrita do hostname contra lista exata de loopback autorizada
  const allowedHosts = options.allowedHosts || ALLOWED_LOOPBACK_HOSTS;
  if (!allowedHosts.includes(hostPart.toLowerCase())) {
    throw new Error(
      `[SEGURANÇA FAIL-CLOSED] Host do Auth Emulator "${hostPart}" não é um endereço de loopback autorizado. ` +
      `Hosts permitidos: ${allowedHosts.join(', ')}.`
    );
  }

  const normalized = hostPart === '::1' ? `[::1]:${portNum}` : `${hostPart.toLowerCase()}:${portNum}`;
  return {
    valid: true,
    host: hostPart.toLowerCase(),
    port: portNum,
    normalized
  };
}

/**
 * 3. Provisionamento de Usuários e Claims no Auth Emulator
 *
 * @param {Object} [options] Injeção de dependências para testes e execução
 * @param {string} [options.authHost] Host do emulador (ex: 'localhost:9099')
 * @param {string} [options.projectId] Identificador do projeto (ex: 'demo-gerenciador-produtos-staging')
 * @param {Function} [options.fetchFn] Função fetch compatível
 * @param {Array} [options.users] Lista de usuários a provisionar
 * @returns {Promise<{ success: boolean, provisionedCount: number, results: Array }>}
 */
export async function provisionEmulatorAuth(options = {}) {
  const authHostInput = options.authHost || process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
  const projectIdInput = options.projectId || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'demo-gerenciador-produtos-staging';
  const fetchFn = options.fetchFn || globalThis.fetch;
  const users = options.users || STAGING_TEST_USERS;

  if (typeof fetchFn !== 'function') {
    throw new Error('[PROVISIONING ERROR] Função fetch não disponível.');
  }

  // Validação prévia de segurança: Project ID DEVE pertencer à lista autorizada de emuladores
  const projectValidation = validateProvisioningTarget(projectIdInput, { isEmulator: true });
  const projectId = projectValidation.projectId;

  // Validação prévia de segurança: Host DEVE ser estritamente endereço de loopback autorizado
  const hostValidation = validateEmulatorHost(authHostInput, options);
  const authHost = hostValidation.normalized;

  const results = [];

  for (const user of users) {
    let localId = null;

    // Etapa A: Tentativa de criação do usuário
    const signUpUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;
    const createRes = await fetchFn(signUpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify({
        email: user.email,
        password: 'StagingPassword123!', // Senha sintética de teste local
        returnSecureToken: true
      })
    });

    if (createRes.status >= 300 && createRes.status < 400) {
      throw new Error('[SEGURANÇA FAIL-CLOSED] Redirecionamento não permitido em chamadas administrativas.');
    }

    if (createRes.ok) {
      const data = await createRes.json();
      localId = data.localId;
    } else {
      // Se a conta já existe, recupera o UID via endpoint administrativo de lookup
      const errData = await createRes.json().catch(() => ({}));
      const isEmailExists = errData?.error?.message === 'EMAIL_EXISTS' || createRes.status === 400;

      if (isEmailExists) {
        const lookupUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup?key=fake-key`;
        const lookupRes = await fetchFn(lookupUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer owner'
          },
          redirect: 'error',
          body: JSON.stringify({ email: [user.email] })
        });

        if (lookupRes.status >= 300 && lookupRes.status < 400) {
          throw new Error('[SEGURANÇA FAIL-CLOSED] Redirecionamento não permitido em chamadas administrativas.');
        }

        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          const matchedUser = lookupData?.users?.find((u) => u.email === user.email);
          if (!matchedUser || !matchedUser.localId) {
            throw new Error(
              `[ERRO CRÍTICO] Não foi possível determinar o UID para o usuário ${user.email} na resposta de lookup.`
            );
          }
          localId = matchedUser.localId;
        } else {
          const lookupErr = await lookupRes.json().catch(() => ({}));
          throw new Error(
            `[ERRO CRÍTICO] Conta ${user.email} já existente, mas falha ao consultar UID: ${lookupErr?.error?.message || lookupRes.statusText}`
          );
        }
      } else {
        throw new Error(
          `[ERRO CRÍTICO] Falha ao criar conta ${user.email}: ${errData?.error?.message || createRes.statusText}`
        );
      }
    }

    // Validação estrita: se o UID não pôde ser obtido de forma confiável, ABORTA
    if (!localId) {
      throw new Error(`[ERRO CRÍTICO] Não foi possível determinar o UID para o usuário ${user.email}.`);
    }

    // Etapa B: Atribuição de Custom Claims Canônicas via endpoint administrativo
    const claimsPayload = {
      tenantId: user.tenantId,
      appRole: user.appRole || (user.role !== 'authenticated' ? user.role : 'viewer'),
      role: 'authenticated'
    };

    const updateUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update?key=fake-key`;
    const claimsRes = await fetchFn(updateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer owner'
      },
      redirect: 'error',
      body: JSON.stringify({
        localId,
        customAttributes: JSON.stringify(claimsPayload)
      })
    });

    if (claimsRes.status >= 300 && claimsRes.status < 400) {
      throw new Error('[SEGURANÇA FAIL-CLOSED] Redirecionamento não permitido em chamadas administrativas.');
    }

    if (!claimsRes.ok) {
      const claimsErr = await claimsRes.json().catch(() => ({}));
      throw new Error(
        `[ERRO CRÍTICO] Falha ao associar custom claims para ${user.email} (UID: ${localId}): ${claimsErr?.error?.message || claimsRes.statusText}`
      );
    }

    results.push({ email: user.email, uid: localId, claims: claimsPayload });
  }

  return { success: true, provisionedCount: results.length, results };
}

/**
 * 3. Instruções Manuais para Staging em Nuvem (Zero Ação Remota Automática)
 */
export function printCloudStagingInstructions(projectId) {
  console.log('\n=============================================================');
  console.log('   GESTAOPRO — INSTRUÇÕES MANUAIS PARA STAGING EM NUVEM');
  console.log('=============================================================');
  console.log(`Projeto Homologado: ${projectId}`);
  console.log('Por salvaguarda de segurança, NENHUMA mutação remota é executada automaticamente.');
  console.log('Para provisionar Custom Claims em staging real:');
  console.log('1. Crie o projeto dedicado no Firebase Console;');
  console.log('2. Gere uma Service Account administrativa temporária FORA do repositório;');
  console.log('3. Execute o script administrativo dedicado com autorização humana explícita;');
  console.log('4. NUNCA comite credenciais ou arquivos json de chaves no repositório Git.');
  console.log('=============================================================\n');
}

/**
 * 4. Orquestrador de Execução do Script
 */
export async function runProvisioning(env = process.env, options = {}) {
  const isEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.USE_EMULATOR || options.isEmulator);
  const defaultProject = isEmulator ? 'demo-gerenciador-produtos-staging' : 'gerenciador-produtos-staging';
  const targetProject = options.projectId || env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || defaultProject;

  // Validação estrita e fail-closed antes de qualquer operação
  const validation = validateProvisioningTarget(targetProject, { isEmulator });

  if (validation.mode === 'emulator') {
    return await provisionEmulatorAuth({
      authHost: env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099',
      projectId: validation.projectId,
      ...options
    });
  }

  // Modo nuvem: imprime orientações e encerra sem efetuar chamadas remotas
  printCloudStagingInstructions(validation.projectId);
  return { success: true, mode: 'cloud-instructions', projectId: validation.projectId };
}

// 5. Ponto de Entrada Executável (Executa SOMENTE quando chamado diretamente)
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('provision-staging.js')
);

if (isMain) {
  runProvisioning()
    .then((res) => {
      console.log(`[PROVISIONING] Finalizado com sucesso (Modo: ${res.mode || 'emulator'}).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\x1b[31m[ERRO DE PROVISIONAMENTO] ${err.message}\x1b[0m`);
      process.exit(1);
    });
}
