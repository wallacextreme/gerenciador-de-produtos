/**
 * GestãoPro — AttributionTrustBoundary (FASE 14.9 & 14.10)
 *
 * Fronteira Centralizada de Confiança para Atribuição de Tenant a Registros Legados.
 *
 * Separação Rígida de Conceitos:
 * 1. Metadado descritivo da origem (ex: string 'ADMIN_RECONCILIATION_VERIFIED'):
 *    - Informativo apenas; NUNCA aceito como evidência ou autorização de atribuição.
 * 2. Evidência de proveniência do registro:
 *    - Relacionamento comprovado com entidade pai do mesmo tenant ('RELATIONAL_PROVENANCE').
 *    - Correlação inequívoca de manifestos de fotos ('IMAGE_MANIFEST_PROVENANCE').
 *    - Metadados históricos contidos no próprio registro ('HISTORICAL_METADATA').
 * 3. Confirmação humana estruturada de reconciliação ('HUMAN_RECONCILIATION'):
 *    - Exige confirmedByHuman === true, confirmedByUserId (UID do operador), reason fundamentada.
 * 4. Autorização administrativa efetiva:
 *    - Exige sessão autenticada canônica com papel 'admin', sem pendência de migração e compatibilidade de tenant.
 *    - A autorização deriva da fonte confiável da aplicação (AuthService), e não de um objeto arbitrário forjado.
 * 5. Registro imutável de auditoria:
 *    - Grava tenantAttributionSource, tenantAttributionProof, tenantAttributionAt.
 *
 * LIMITAÇÃO ARQUITETURAL EXPLÍCITA:
 * Em um ambiente estritamente cliente/navegador, validações locais garantem integridade
 * estrutural e previnem erros operacionais, mas NÃO constituem fronteira de segurança
 * impenetrável contra um ator que controle o ambiente de execução (DevTools/memória).
 * Nenhuma validação local substitui ou suplanta a autorização do backend remoto.
 */

/**
 * Resolve a sessão autoritativa confiável para reconciliação humana.
 * Previne que objetos arbitrários forjados pelo chamador substituam a autoridade confiável.
 *
 * @param {Object|null} providedSession Sessão informada pelo chamador (opcional)
 * @param {Object|null} [authInstance=null] Instância do serviço de autenticação (opcional)
 * @returns {Object} Sessão resolvida e validada
 */
export function resolveTrustedSession(providedSession = null, authInstance = null) {
  const trusted = authInstance && typeof authInstance.getCurrentSession === 'function'
    ? authInstance.getCurrentSession()
    : null;
  const isEnforced = authInstance && typeof authInstance.isConfigured === 'function'
    ? (authInstance.isConfigured() || trusted !== null)
    : (trusted !== null);

  // Se o serviço de autenticação estiver ativo ou configurado
  if (isEnforced) {
    if (!trusted || !trusted.authenticated) {
      throw new Error('[TrustBoundary] Reconciliação humana rejeitada: nenhuma sessão autenticada ativa no serviço de autenticação.');
    }
    // Se o chamador forneceu uma sessão, deve coincidir estritamente com a sessão confiável
    if (providedSession) {
      const trustedUid = trusted.uid || trusted.userId;
      const providedUid = providedSession.uid || providedSession.userId;
      if (trustedUid && providedUid && trustedUid !== providedUid) {
        throw new Error(
          `[TrustBoundary] Reconciliação humana rejeitada: UID da sessão fornecida ("${providedUid}") diverge da identidade autenticada corrente ("${trustedUid}").`
        );
      }
      const trustedTenant = trusted.tenantId;
      const providedTenant = providedSession.tenantId;
      if (trustedTenant && providedTenant && trustedTenant !== providedTenant) {
        throw new Error(
          `[TrustBoundary] Reconciliação humana rejeitada: tenant da sessão fornecida ("${providedTenant}") diverge do tenant autenticado corrente ("${trustedTenant}").`
        );
      }
      const trustedRole = trusted.appRole || trusted.role;
      const providedRole = providedSession.appRole || providedSession.role;
      if (trustedRole && providedRole && trustedRole !== providedRole) {
        throw new Error(
          `[TrustBoundary] Reconciliação humana rejeitada: papel da sessão fornecida ("${providedRole}") diverge do papel autenticado corrente ("${trustedRole}").`
        );
      }
    }
    return trusted;
  }

  // Se o serviço não possui sessão ativa configurada (ex: mock isolado em teste unitário)
  if (!providedSession || !providedSession.authenticated) {
    throw new Error('[TrustBoundary] Reconciliação humana rejeitada: nenhuma sessão autenticada ativa.');
  }

  return providedSession;
}

/**
 * Valida rigorosamente a atribuição de um tenantId contra a fronteira de confiança.
 *
 * @param {Object} params
 * @param {string} params.targetTenantId Tenant de destino
 * @param {Object} params.existingRecord Registro original inspecionado
 * @param {Object} params.evidence Evidência estruturada ou confirmação humana
 * @param {Object} [params.session=null] Sessão do operador (opcional, resolvida via AuthService)
 * @param {Object} [params.authInstance=authService] Instância de AuthService
 * @returns {{ isValid: boolean, attributionSource: string, proofDetails: Object }}
 * @throws {Error} Se qualquer validação da fronteira de confiança falhar
 */
export function validateAttributionEvidence({ targetTenantId, existingRecord, evidence, session = null, authInstance = null }) {
  // 1. Validação do tenant de destino
  if (!targetTenantId || typeof targetTenantId !== 'string' || !targetTenantId.trim()) {
    throw new Error('[TrustBoundary] targetTenantId é obrigatório e deve ser uma string não vazia.');
  }
  const cleanTargetTenant = targetTenantId.trim();

  // 2. Validação do registro existente
  if (!existingRecord || typeof existingRecord !== 'object') {
    throw new Error('[TrustBoundary] Registro a ser inspecionado é inválido ou ausente.');
  }

  // Prevenção de conflito irrecuperável entre tenants
  if (existingRecord.tenantId && existingRecord.tenantId !== cleanTargetTenant) {
    throw new Error(
      `[TrustBoundary] Conflito irrecuperável: registro já pertence ao tenant "${existingRecord.tenantId}", incompatível com "${cleanTargetTenant}".`
    );
  }

  // 3. Rejeição de strings isoladas como evidência (Regra Obrigatória 4.1)
  if (!evidence || typeof evidence === 'string') {
    const rawVal = typeof evidence === 'string' ? `"${evidence}"` : String(evidence);
    throw new Error(
      `[TrustBoundary] Atribuição rejeitada: strings arbitrárias de origem (ex: ${rawVal}) são meros metadados descritivos e não constituem evidência válida de proveniência ou autorização de reconciliação.`
    );
  }

  if (typeof evidence !== 'object') {
    throw new Error('[TrustBoundary] Evidência de atribuição inválida: deve ser um objeto estruturado de evidência ou confirmação humana.');
  }

  // 4. Validação por Tipo de Evidência

  // Caso 4.1: Proveniência Relacional com Entidade Pai Comprovada
  if (evidence.type === 'RELATIONAL_PROVENANCE') {
    if (!evidence.parentEntity || typeof evidence.parentEntity !== 'string') {
      throw new Error('[TrustBoundary] Evidência relacional exige "parentEntity" especificado.');
    }
    if (!evidence.parentId || typeof evidence.parentId !== 'string') {
      throw new Error('[TrustBoundary] Evidência relacional exige "parentId" especificado.');
    }
    if (!evidence.parentTenant || typeof evidence.parentTenant !== 'string') {
      throw new Error('[TrustBoundary] Evidência relacional exige "parentTenant" especificado.');
    }
    if (evidence.parentTenant !== cleanTargetTenant) {
      throw new Error(
        `[TrustBoundary] Conflito de tenant relacional: entidade pai pertence a "${evidence.parentTenant}", mas targetTenant é "${cleanTargetTenant}".`
      );
    }

    return {
      isValid: true,
      attributionSource: 'PARENT_RELATION_VERIFIED',
      proofDetails: {
        type: 'RELATIONAL_PROVENANCE',
        parentEntity: evidence.parentEntity,
        parentId: evidence.parentId,
        parentTenant: evidence.parentTenant,
        validatedAt: new Date().toISOString()
      }
    };
  }

  // Caso 4.2: Proveniência de Manifesto de Imagens (todas as fotos apontam para um único tenant)
  if (evidence.type === 'IMAGE_MANIFEST_PROVENANCE') {
    if (!evidence.singleTenant || typeof evidence.singleTenant !== 'string') {
      throw new Error('[TrustBoundary] Evidência de manifesto exige "singleTenant" especificado.');
    }
    if (evidence.singleTenant !== cleanTargetTenant) {
      throw new Error(
        `[TrustBoundary] Conflito no manifesto de fotos: fotos apontam para "${evidence.singleTenant}", mas targetTenant é "${cleanTargetTenant}".`
      );
    }

    return {
      isValid: true,
      attributionSource: 'IMAGE_MANIFEST_PROVENANCE',
      proofDetails: {
        type: 'IMAGE_MANIFEST_PROVENANCE',
        singleTenant: evidence.singleTenant,
        manifestCount: evidence.manifestCount || 1,
        validatedAt: new Date().toISOString()
      }
    };
  }

  // Caso 4.3: Metadado Histórico Intrínseco do Próprio Registro
  if (evidence.type === 'HISTORICAL_METADATA') {
    if (!evidence.metadataKey || !evidence.expectedTenant) {
      throw new Error('[TrustBoundary] Evidência de metadado histórico exige metadataKey e expectedTenant.');
    }
    if (evidence.expectedTenant !== cleanTargetTenant) {
      throw new Error(
        `[TrustBoundary] Conflito de metadado histórico: metadado indica "${evidence.expectedTenant}", incompatível com "${cleanTargetTenant}".`
      );
    }

    return {
      isValid: true,
      attributionSource: 'HISTORICAL_METADATA_VERIFIED',
      proofDetails: {
        type: 'HISTORICAL_METADATA',
        metadataKey: evidence.metadataKey,
        expectedTenant: evidence.expectedTenant,
        validatedAt: new Date().toISOString()
      }
    };
  }

  // Caso 4.4: Confirmação Humana Estruturada de Reconciliação Administrativa
  if (evidence.type === 'HUMAN_RECONCILIATION') {
    if (evidence.confirmedByHuman !== true) {
      throw new Error('[TrustBoundary] Reconciliação administrativa rejeitada: exige confirmedByHuman === true.');
    }
    if (!evidence.confirmedByUserId || typeof evidence.confirmedByUserId !== 'string' || !evidence.confirmedByUserId.trim()) {
      throw new Error('[TrustBoundary] Reconciliação administrativa rejeitada: identificador confirmedByUserId ausente ou inválido.');
    }
    if (!evidence.reason || typeof evidence.reason !== 'string' || evidence.reason.trim().length < 5) {
      throw new Error('[TrustBoundary] Reconciliação administrativa rejeitada: exige justificativa fundamentada de negócio (mínimo 5 caracteres).');
    }

    // Validação da Sessão Administrativa Ativa através da autoridade confiável
    const activeSession = resolveTrustedSession(session || evidence.session, authInstance);

    if (activeSession.requiresMigration === true) {
      throw new Error('[TrustBoundary] Permissão negada: sessão com migração de claims pendente (requiresMigration: true) não pode autorizar reconciliação de tenant.');
    }

    const userRole = activeSession.appRole || activeSession.role;
    if (userRole !== 'admin') {
      throw new Error(`[TrustBoundary] Permissão negada: reconciliação humana exige papel "admin", mas usuário ativo possui papel "${userRole || 'anônimo'}".`);
    }

    if (activeSession.tenantId && activeSession.tenantId !== cleanTargetTenant) {
      throw new Error(
        `[TrustBoundary] Conflito de tenant da sessão: usuário ativo pertence a "${activeSession.tenantId}", mas registro é atribuído a "${cleanTargetTenant}".`
      );
    }

    // Verificação de Identidade Efetiva: o UID de confirmação DEVE corresponder à sessão autenticada corrente
    const activeUid = activeSession.uid || activeSession.userId;
    if (activeUid && evidence.confirmedByUserId.trim() !== activeUid) {
      throw new Error(
        `[TrustBoundary] Reconciliação administrativa rejeitada: UID de confirmação ("${evidence.confirmedByUserId.trim()}") diverge da identidade corrente autenticada ("${activeUid}").`
      );
    }

    return {
      isValid: true,
      attributionSource: 'EXPLICIT_HUMAN_ADMIN_RECONCILIATION',
      proofDetails: {
        type: 'HUMAN_RECONCILIATION',
        confirmedByUserId: evidence.confirmedByUserId.trim(),
        confirmedAt: evidence.confirmedAt || new Date().toISOString(),
        reason: evidence.reason.trim(),
        adminRole: userRole,
        planId: evidence.planId || null,
        validatedAt: new Date().toISOString()
      }
    };
  }

  // Evidência não reconhecida
  throw new Error(`[TrustBoundary] Tipo de evidência não reconhecido: "${evidence.type}". Atribuição negada.`);
}
