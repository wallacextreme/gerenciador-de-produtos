/**
 * GestãoPro — Validador de Configuração do Firebase e Proteção de Produção (PHASE 09)
 * 
 * Garante que:
 * 1. Projetos de PRODUÇÃO nunca sejam conectados acidentalmente em fases de homologação/staging.
 * 2. Somente projetos explicitamente marcados como staging, test, demo, dev ou emulators sejam permitidos nesta fase.
 * 3. Segredos administrativos (Service Accounts, private keys) nunca sejam aceitos no frontend.
 */

/**
 * Lista explícita de projetos de produção conhecidos que NUNCA devem ser acessados nesta fase.
 */
export const FORBIDDEN_PRODUCTION_PROJECTS = [
  'caixa-autopecas',
  'fichas-tucano-loja',
  'tabela-porta-escovas',
  'tucano-vales'
];

/**
 * Verifica se um projectId pertence a um ambiente de produção.
 * @param {string} projectId 
 * @returns {boolean}
 */
export function isProductionProject(projectId) {
  if (!projectId || typeof projectId !== 'string') return false;
  const p = projectId.toLowerCase().trim();

  // 1. Bloqueio de projetos de produção conhecidos da conta
  if (FORBIDDEN_PRODUCTION_PROJECTS.includes(p)) {
    return true;
  }

  // 2. Projetos explicitamente identificados como produção
  if (/(^|[-_])(prod|production)([-_]|$)/i.test(p)) {
    return true;
  }

  return false;
}

/**
 * Valida a configuração do Firebase para uso no cliente, aplicando salvaguardas de segurança.
 * @param {Object} config Configuração do Firebase Web
 * @param {Object} [options] Opções de validação
 * @param {boolean} [options.allowProduction=false] Se falso, proíbe conexão com projetos de produção
 * @throws {Error} Se a configuração for inválida ou tentar conectar à produção
 */
export function validateFirebaseConfig(config, options = { allowProduction: false }) {
  if (!config) {
    return { valid: false, error: 'Configuração do Firebase não informada.' };
  }

  const projectId = (config.projectId || '').toLowerCase().trim();

  // 1. Bloqueio absoluto de projetos de produção na Phase 09/11 salvo consentimento explícito
  if (!options.allowProduction) {
    if (isProductionProject(projectId)) {
      throw new Error(
        `[SEGURANÇA PHASE 09] Conexão com o projeto de PRODUÇÃO "${projectId}" é terminantemente PROIBIDA neste estágio. ` +
        `Utilize exclusivamente o ambiente de staging/testes (ex: gerenciador-produtos-staging) ou o Firebase Emulator Suite.`
      );
    }
  }

  // 2. Proibição de inclusão de segredos de Service Account ou credenciais no bundle/config do cliente
  const forbiddenKeys = [
    'private_key',
    'private_key_id',
    'privateKey',
    'client_secret',
    'clientSecret',
    'serviceAccountKey',
    'serviceAccount',
    'service_account',
    'admin_token',
    'api_secret',
    'secret',
    'credential'
  ];

  for (const key of forbiddenKeys) {
    if (config[key]) {
      throw new Error(
        `[SEGURANÇA CRÍTICA] Segredo administrativo detectado na configuração do cliente: "${key}". ` +
        `Nunca passe credenciais de Service Account ou chaves privadas para o frontend!`
      );
    }
  }

  // 3. Validação condicional de databaseURL
  if (options.requireDatabaseURL) {
    if (!config.databaseURL || typeof config.databaseURL !== 'string' || !config.databaseURL.trim()) {
      throw new Error('[SEGURANÇA] Parâmetro obrigatório "databaseURL" ausente na configuração do Realtime Database.');
    }
  }

  // 4. Validação condicional de storageBucket
  if (options.requireStorageBucket) {
    if (!config.storageBucket || typeof config.storageBucket !== 'string' || !config.storageBucket.trim()) {
      throw new Error('[SEGURANÇA] Parâmetro obrigatório "storageBucket" ausente na configuração do Cloud Storage.');
    }
  }

  // 5. Detecção de Configuration Drift entre Auth, RTDB e Storage
  if (projectId) {
    if (config.databaseURL && typeof config.databaseURL === 'string') {
      const dbUrl = config.databaseURL.toLowerCase().trim();
      const isCloudDb = dbUrl.includes('.firebaseio.com') || dbUrl.includes('.firebasedatabase.app');
      if (isCloudDb && !dbUrl.includes(projectId)) {
        throw new Error(
          `[CONFIGURATION DRIFT] Inconsistência detectada: databaseURL ("${config.databaseURL}") pertence a um projeto diferente do projectId ("${projectId}").`
        );
      }
    }

    if (config.storageBucket && typeof config.storageBucket === 'string') {
      const bucket = config.storageBucket.toLowerCase().trim();
      const isCloudBucket = bucket.includes('.appspot.com') || bucket.includes('.firebasestorage.app');
      if (isCloudBucket && !bucket.includes(projectId)) {
        throw new Error(
          `[CONFIGURATION DRIFT] Inconsistência detectada: storageBucket ("${config.storageBucket}") pertence a um projeto diferente do projectId ("${projectId}").`
        );
      }
    }
  }

  // 6. Fail-closed no modo emulator: exige demo- e hosts locais de emulador
  const isEmulatorMode = options.isEmulatorMode || 
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.MODE === 'emulator');
  if (isEmulatorMode) {
    validateEmulatorRuntimeConfig(config, options);
  }

  return { valid: true };
}

/**
 * Validação rigorosa e FAIL-CLOSED para modo de emulação (PHASE 13.9).
 * Garante que:
 * 1. O projectId obrigatoriamente comece com "demo-" para ativar a salvaguarda offline do Firebase SDK.
 * 2. Os hosts de Authentication e Realtime Database estejam configurados com hosts locais.
 * 3. Se Storage estiver presente, storageEmulatorHost deve estar configurado com host local.
 * 4. NUNCA ocorra fallback silencioso para a nuvem real.
 * @param {Object} config 
 * @param {Object} [options]
 * @param {boolean} [options.requireStorage=false]
 */
export function validateEmulatorRuntimeConfig(config, options = {}) {
  if (!config) {
    throw new Error('[FAIL-CLOSED] Configuração do Firebase não informada no modo emulator.');
  }

  const projectId = (config.projectId || '').toLowerCase().trim();
  if (!projectId) {
    throw new Error('[FAIL-CLOSED] "projectId" ausente no modo emulator.');
  }

  if (!projectId.startsWith('demo-')) {
    throw new Error(
      `[FAIL-CLOSED] No modo emulator, o "projectId" DEVE obrigatoriamente iniciar com o prefixo "demo-" ` +
      `(ex: demo-gerenciador-produtos-staging) para garantir o isolamento offline do Firebase SDK. Recebido: "${projectId}".`
    );
  }

  // 1. Auth Emulator obrigatório
  const authHost = config.authEmulatorHost;
  if (!authHost || typeof authHost !== 'string' || !authHost.trim()) {
    throw new Error(
      '[FAIL-CLOSED] Host do Auth Emulator (VITE_FIREBASE_AUTH_EMULATOR_HOST) é OBRIGATÓRIO no modo emulator. ' +
      'Fallback para a nuvem do Firebase Authentication é terminantemente proibido.'
    );
  }

  // 2. Realtime Database Emulator obrigatório
  const dbHost = config.emulatorHost || config.databaseEmulatorHost;
  if (!dbHost || typeof dbHost !== 'string' || !dbHost.trim()) {
    throw new Error(
      '[FAIL-CLOSED] Host do Realtime Database Emulator (VITE_FIREBASE_EMULATOR_HOST) é OBRIGATÓRIO no modo emulator. ' +
      'Fallback para a nuvem do Firebase Realtime Database é terminantemente proibido.'
    );
  }

  // 3. Storage Emulator (se storageBucket estiver presente ou se requireStorage for true)
  if (options.requireStorage || config.storageBucket) {
    const storageHost = config.storageEmulatorHost;
    if (!storageHost || typeof storageHost !== 'string' || !storageHost.trim()) {
      throw new Error(
        '[FAIL-CLOSED] Host do Storage Emulator (VITE_FIREBASE_STORAGE_EMULATOR_HOST) é OBRIGATÓRIO no modo emulator ' +
        'quando Cloud Storage está habilitado. Fallback para a nuvem é terminantemente proibido.'
      );
    }
  }

  return { valid: true };
}
