#!/usr/bin/env node
/**
 * GestãoPro — Script de Provisionamento de Staging e Emulators (PHASE 09)
 * 
 * ATENÇÃO DE SEGURANÇA:
 * - Este script roda EXCLUSIVAMENTE em ambiente administrativo externo (Node/Bun).
 * - NUNCA deve ser importado em src/ ou empacotado no frontend/PWA/Tauri.
 * - Bloqueia terminantemente conexões a projetos de produção.
 * - NUNCA imprime senhas ou chaves nos logs.
 */

import { FORBIDDEN_PRODUCTION_PROJECTS, isProductionProject } from '../src/js/utils/firebaseConfigValidator.js';

const STAGING_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'gerenciador-produtos-staging';
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
const RTDB_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000';
const IS_EMULATOR = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.USE_EMULATOR);

// 1. Verificação Estrita de Segurança contra Projetos de Produção
if (isProductionProject(STAGING_PROJECT_ID)) {
  console.error(`\x1b[31m[ERRO CRÍTICO] Execução abortada! O projeto "${STAGING_PROJECT_ID}" foi identificado como PRODUÇÃO.\x1b[0m`);
  console.error('O script de provisionamento só pode ser executado contra projetos de homologação/staging ou emulators.');
  process.exit(1);
}

console.log('=====================================================');
console.log(' GestãoPro — Provisionamento Staging / Homologação');
console.log('=====================================================');
console.log(`Projeto Alvo: ${STAGING_PROJECT_ID}`);
console.log(`Modo: ${IS_EMULATOR ? 'Firebase Local Emulator Suite' : 'Firebase Cloud Staging'}`);
console.log('-----------------------------------------------------');

export const STAGING_USERS = [
  {
    email: 'admin@staging.local',
    role: 'admin',
    tenantId: 'tenant-staging',
    displayName: 'Administrador Staging'
  },
  {
    email: 'operador@staging.local',
    role: 'operator',
    tenantId: 'tenant-staging',
    displayName: 'Operador Staging'
  }
];

/**
 * Provisiona usuários e custom claims no Auth Emulator via REST API nativa do Firebase Auth Emulator.
 */
async function provisionEmulatorAuth() {
  console.log(`Conectando ao Auth Emulator em: http://${AUTH_EMULATOR_HOST}...`);

  for (const user of STAGING_USERS) {
    try {
      // 1. Criar ou atualizar usuário no emulador
      const createRes = await fetch(`http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          password: 'StagingPassword123!', // Senha de homologação fictícia
          returnSecureToken: true
        })
      });

      let localId = null;
      if (createRes.ok) {
        const data = await createRes.json();
        localId = data.localId;
        console.log(`[AUTH] Usuário criado: ${user.email} (UID: ${localId})`);
      } else {
        // Se usuário já existe, pesquisa UID
        console.log(`[AUTH] Usuário ${user.email} já existente ou resposta recebida.`);
      }

      // 2. Definir Custom Claims via API do Emulator (emulator REST endpoint)
      if (localId) {
        const claimsPayload = {
          tenantId: user.tenantId,
          role: user.role
        };

        const claimsRes = await fetch(`http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            localId,
            customAttributes: JSON.stringify(claimsPayload)
          })
        });

        if (claimsRes.ok) {
          console.log(`[CLAIMS] Custom claims associadas para ${user.email}: tenantId=${user.tenantId}, role=${user.role}`);
        }
      }
    } catch (err) {
      console.warn(`[AVISO] Não foi possível provisionar diretamente no emulador (${err.message}). Certifique-se de que o Emulator Suite está ativo.`);
    }
  }
}

/**
 * Exibe instruções caso o usuário deseje provisionar um projeto real na nuvem do Firebase.
 */
function printCloudStagingInstructions() {
  console.log('\n--- INSTRUÇÕES PARA PROJETO FIREBASE CLOUD REAL ---');
  console.log('Para provisionar Custom Claims em um projeto real de Staging:');
  console.log('1. Crie o projeto "gerenciador-produtos-staging" no Firebase Console (plano Spark ou Blaze de testes).');
  console.log('2. Crie uma Service Account administrativa e defina a variável:');
  console.log('   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\\caminho\\seguro\\serviceAccountKey.json"');
  console.log('3. NUNCA coloque o arquivo json da Service Account dentro de src/ ou do repositório Git.');
  console.log('4. Execute este script com permissões administrativas.');
  console.log('-----------------------------------------------------\n');
}

// Execução principal
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  (async () => {
    if (IS_EMULATOR) {
      await provisionEmulatorAuth();
    } else {
      printCloudStagingInstructions();
    }
    console.log('[PROVISIONING] Concluído com sucesso.');
  })();
}
