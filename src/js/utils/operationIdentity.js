/**
 * GestãoPro — Identidade de Operação e Reconciliação Remota (FASE 14.12)
 *
 * Formaliza a identidade lógica de negócio, hashing canônico criptográfico (SHA-256),
 * normalização determinística offline e comparação de equivalência vs. divergência
 * de payloads remotos para a Outbox e controle de concorrência otimista.
 *
 * Distingue com precisão:
 * 1. Registro remoto ausente (RECORD_ABSENT)
 * 2. Registro remoto existente e equivalente (RECORD_EQUIVALENT)
 * 3. Registro remoto existente e divergente (RECORD_DIVERGENT)
 * 4. Conflito de versão concorrente (VERSION_CONFLICT)
 * 5. Registro remoto inacessível por instabilidade (INACCESSIBLE)
 * 6. Leitura remota rejeitada por autorização (PERMISSION_DENIED)
 */

export const REMOTE_RECONCILIATION_OUTCOME = Object.freeze({
  RECORD_ABSENT: 'RECORD_ABSENT',
  RECORD_EQUIVALENT: 'RECORD_EQUIVALENT',
  RECORD_DIVERGENT: 'RECORD_DIVERGENT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INACCESSIBLE: 'INACCESSIBLE',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UPDATE_ON_ABSENT_RECORD: 'UPDATE_ON_ABSENT_RECORD',
  ALREADY_DELETED: 'ALREADY_DELETED'
});

export const VOLATILE_METADATA_FIELDS = Object.freeze([
  '_serverTimestamp',
  'updatedAt',
  'createdAt',
  'sourceDeviceId',
  'lastMutationId',
  'version',
  'baseVersion',
  'expectedBaseVersion',
  'basePayloadHash',
  'syncedAt',
  'inFlight',
  'inFlightStartedAt',
  'inFlightInterruptedAt',
  'inFlightSwitchedTenant',
  'status',
  'attempts',
  'lastAttemptAt',
  'lastError',
  'permanentFailure',
  'requiresResolution',
  'remoteOutcomeUnknown',
  'remoteAckReceived',
  'remoteVersion',
  'recoveredFromCrash',
  'recoveredFromInterruptedSession',
  'reconciledByPlanId',
  'canonicalPayloadHash',
  'origin',
  '_origin',
  'pushedTimestamp'
]);

export const BUSINESS_FIELDS_BY_ENTITY = Object.freeze({
  products: [
    'id',
    'tenantId',
    'name',
    'salePriceCents',
    'purchasePriceCents',
    'productCode',
    'internalCode',
    'barcode',
    'category',
    'categoryId',
    'subcategory',
    'subcategoryId',
    'brand',
    'minimumStock',
    'maximumStock',
    'isActive',
    'notes',
    'description'
  ],
  sales: [
    'id',
    'tenantId',
    'productId',
    'quantity',
    'unitSalePriceCents',
    'unitCostCents',
    'totalSaleCents',
    'totalCostCents',
    'profitCents',
    'marginPercent',
    'markupPercent',
    'paymentMethod',
    'customerName',
    'date',
    'cancelledAt',
    'cancelReason',
    'notes'
  ],
  purchases: [
    'id',
    'tenantId',
    'productId',
    'supplierId',
    'quantity',
    'unitCostCents',
    'totalCostCents',
    'totalAmountCents',
    'invoiceNumber',
    'date',
    'cancelledAt',
    'cancelReason',
    'notes'
  ],
  stockMovements: [
    'id',
    'tenantId',
    'productId',
    'quantity',
    'delta',
    'type',
    'unitCostCents',
    'reason',
    'notes',
    'referenceId',
    'referenceType',
    'date'
  ],
  inventory: [
    'id',
    'tenantId',
    'productId',
    'quantity',
    'delta',
    'type',
    'unitCostCents',
    'reason',
    'notes',
    'referenceId',
    'referenceType',
    'date'
  ],
  settings: [
    'id',
    'tenantId',
    'key',
    'value'
  ],
  suppliers: [
    'id',
    'tenantId',
    'name',
    'document',
    'phone',
    'email',
    'contactName',
    'notes'
  ],
  productSuppliers: [
    'id',
    'tenantId',
    'productId',
    'supplierId',
    'priceCents',
    'referenceCode'
  ],
  imageManifest: [
    'id',
    'tenantId',
    'productId',
    'url',
    'version',
    'sha256',
    'mimeType',
    'sizeBytes'
  ]
});

/**
 * Implementação pura em JavaScript do padrão criptográfico SHA-256 (FIPS 180-4).
 * Funciona de forma 100% síncrona, determinística e offline no navegador, Bun e Node,
 * sem requisições de rede ou dependências externas.
 *
 * @param {string} str Mensagem de entrada codificada em UTF-8
 * @returns {string} Hexadecimal de 64 caracteres
 */
export function sha256(str) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  let i, j;
  let result = '';
  const words = [];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const utf8 = unescape(encodeURIComponent(str));
  const utf8BitLength = utf8.length * 8;
  for (i = 0; i < utf8.length; i++) {
    words[i >> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }
  words[utf8BitLength >> 5] |= 0x80 << (24 - (utf8BitLength % 32));
  words[(((utf8BitLength + 64) >> 9) << 4) + 15] = utf8BitLength;

  for (i = 0; i < words.length; i += 16) {
    const w = [];
    for (j = 0; j < 16; j++) w[j] = words[i + j] || 0;
    for (j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
    for (j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0; hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0; hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * Normaliza um valor de campo de negócio para comparação determinística.
 */
function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    return val.trim();
  }
  if (typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(normalizeValue);
  }
  if (typeof val === 'object') {
    const sorted = {};
    for (const key of Object.keys(val).sort()) {
      if (!VOLATILE_METADATA_FIELDS.includes(key)) {
        sorted[key] = normalizeValue(val[key]);
      }
    }
    return sorted;
  }
  return val;
}

/**
 * Normaliza a carga útil de um registro extraindo apenas campos de negócio.
 * @param {string} entityType 
 * @param {Object} payload 
 * @returns {Object} Payload canônico normalizado
 */
export function normalizeBusinessPayload(entityType, payload) {
  if (!payload || typeof payload !== 'object') return {};

  const knownFields = BUSINESS_FIELDS_BY_ENTITY[entityType];
  const normalized = {};

  if (knownFields && Array.isArray(knownFields)) {
    for (const field of knownFields) {
      if (payload[field] !== undefined) {
        normalized[field] = normalizeValue(payload[field]);
      } else if (entityType === 'suppliers' && field === 'contactName' && payload.contactPerson !== undefined) {
        normalized[field] = normalizeValue(payload.contactPerson);
      }
    }
  } else {
    // Para entidades não mapeadas, extrai todas as chaves exceto metadados voláteis
    for (const key of Object.keys(payload).sort()) {
      if (!VOLATILE_METADATA_FIELDS.includes(key)) {
        normalized[key] = normalizeValue(payload[key]);
      }
    }
  }

  return normalized;
}

/**
 * Calcula hash determinístico legado de 64 bits (FNV-1a) para suporte e verificação retroativa.
 * @param {string} canonicalString
 * @returns {string} Hash no formato `can_${16hex}`
 */
export function computeLegacy64BitHash(canonicalString) {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < canonicalString.length; i++) {
    const ch = canonicalString.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch << 1), 0x01000193);
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  return `can_${hex}`;
}

/**
 * Gera um hash determinístico e criptográfico (SHA-256) para a carga de negócio.
 * O hash identifica conteúdo; não é prova de autorização nem de aceitação remota.
 *
 * @param {string} entityType 
 * @param {Object} payload 
 * @param {Object} [options={}]
 * @returns {string} Hash SHA-256 canônico prefixado `can_sha256_${hex}`
 */
export function computeCanonicalPayloadHash(entityType, payload, options = {}) {
  const norm = normalizeBusinessPayload(entityType, payload);
  const envelope = {
    _entityType: entityType,
    _tenantId: norm.tenantId || payload?.tenantId || options.tenantId || null,
    ...norm
  };
  const sortedKeys = Object.keys(envelope).sort();
  const canonicalString = JSON.stringify(envelope, sortedKeys);
  const hashHex = sha256(canonicalString);

  return `can_sha256_${hashHex}`;
}

/**
 * Verifica se um hash foi gerado sob a especificação legada de 64 bits da Fase 14.11.
 * @param {string} hash
 * @returns {boolean}
 */
export function isLegacyPayloadHash(hash) {
  if (!hash || typeof hash !== 'string') return false;
  return hash.startsWith('can_') && !hash.startsWith('can_sha256_') && hash.length === 20;
}

/**
 * Recalcula a representação canônica e valida a integridade do payload contra um hash armazenado.
 * Nunca confia cegamente no hash sem recalcular sobre o payload real.
 *
 * @param {string} entityType
 * @param {Object} payload
 * @param {string} storedHash
 * @returns {{ valid: boolean, isLegacy: boolean, currentHash: string }}
 */
export function verifyPayloadIntegrity(entityType, payload, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return { valid: false, isLegacy: false, currentHash: computeCanonicalPayloadHash(entityType, payload) };
  }

  const currentHash = computeCanonicalPayloadHash(entityType, payload);
  if (currentHash === storedHash) {
    return { valid: true, isLegacy: false, currentHash };
  }

  // Verifica compatibilidade com hash legado de 64 bits
  if (isLegacyPayloadHash(storedHash)) {
    const norm = normalizeBusinessPayload(entityType, payload);
    const sortedKeys = Object.keys(norm).sort();
    const canonicalString = JSON.stringify(norm, sortedKeys);
    const legacyCalculated = computeLegacy64BitHash(canonicalString);

    if (legacyCalculated === storedHash) {
      return { valid: true, isLegacy: true, currentHash };
    }
  }

  return { valid: false, isLegacy: false, currentHash };
}

/**
 * Compara dois valores normalizados para equivalência semântica estrita.
 */
function valuesAreEqual(v1, v2) {
  if (v1 === v2) return true;
  if ((v1 === null || v1 === undefined || v1 === '') &&
      (v2 === null || v2 === undefined || v2 === '')) {
    return true;
  }
  if (typeof v1 === 'number' && typeof v2 === 'number') {
    return Math.abs(v1 - v2) < 0.00001;
  }
  if (typeof v1 === 'object' && typeof v2 === 'object' && v1 !== null && v2 !== null) {
    const s1 = JSON.stringify(v1);
    const s2 = JSON.stringify(v2);
    return s1 === s2;
  }
  return false;
}

/**
 * Verifica se a carga útil local e a remota são semanticamente equivalentes.
 * Ignora timestamps voláteis de retentativa, IDs de mutação e marcadores de dispositivo.
 * @param {string} entityType 
 * @param {Object} localPayload 
 * @param {Object} remotePayload 
 * @returns {boolean}
 */
export function arePayloadsEquivalent(entityType, localPayload, remotePayload) {
  if (!localPayload && !remotePayload) return true;
  if (!localPayload || !remotePayload) return false;

  const normLocal = normalizeBusinessPayload(entityType, localPayload);
  const normRemote = normalizeBusinessPayload(entityType, remotePayload);

  const allKeys = new Set([...Object.keys(normLocal), ...Object.keys(normRemote)]);

  for (const key of allKeys) {
    // Isolamento multi-tenant: se um dos lados não tiver tenantId gravado no corpo
    // (comum no RTDB onde tenantId reside na rota tenants/$tenantId), tolera ausência
    // contanto que não haja divergência explícita quando ambos estiverem presentes.
    if (key === 'tenantId') {
      const tLocal = normLocal[key];
      const tRemote = normRemote[key];
      if (tLocal && tRemote && tLocal !== tRemote) {
        return false;
      }
      continue;
    }

    const valLocal = normLocal[key];
    const valRemote = normRemote[key];
    if (!valuesAreEqual(valLocal, valRemote)) {
      return false;
    }
  }

  return true;
}

/**
 * Retorna os campos divergentes entre duas cargas de negócio.
 * @param {string} entityType 
 * @param {Object} localPayload 
 * @param {Object} remotePayload 
 * @returns {Array<{ field: string, localValue: any, remoteValue: any }>}
 */
export function getDivergentFields(entityType, localPayload, remotePayload) {
  if (!localPayload && !remotePayload) return [];
  const normLocal = normalizeBusinessPayload(entityType, localPayload || {});
  const normRemote = normalizeBusinessPayload(entityType, remotePayload || {});

  const allKeys = new Set([...Object.keys(normLocal), ...Object.keys(normRemote)]);
  const differences = [];

  for (const key of allKeys) {
    if (key === 'tenantId') {
      const tLocal = normLocal[key];
      const tRemote = normRemote[key];
      if (tLocal && tRemote && tLocal !== tRemote) {
        differences.push({ field: key, localValue: tLocal, remoteValue: tRemote });
      }
      continue;
    }

    const valLocal = normLocal[key];
    const valRemote = normRemote[key];
    if (!valuesAreEqual(valLocal, valRemote)) {
      differences.push({
        field: key,
        localValue: valLocal,
        remoteValue: valRemote
      });
    }
  }

  return differences;
}

/**
 * Classifica formalmente o resultado da consulta remota para reconciliação da Outbox.
 * @param {Object} params
 * @param {string} params.entityType
 * @param {string} params.entityId
 * @param {Object} params.localPayload
 * @param {Object|null} params.remoteRecord
 * @param {Error|null} [params.readError]
 * @param {number|null} [params.expectedBaseVersion]
 * @returns {{ outcome: string, isEquivalent: boolean, divergentFields: Array, reason: string }}
 */
export function classifyRemoteOutcome({ entityType, entityId, action = 'CREATE', localPayload, remoteRecord, readError = null, expectedBaseVersion = null }) {
  if (readError) {
    const msg = (readError.message || '').toLowerCase();
    const code = (readError.code || '').toLowerCase();
    if (code === 'permission_denied' || code === '403' || msg.includes('permission_denied') || msg.includes('permission denied')) {
      return {
        outcome: REMOTE_RECONCILIATION_OUTCOME.PERMISSION_DENIED,
        isEquivalent: false,
        isAbsent: false,
        requiresResolution: true,
        divergentFields: [],
        reason: 'Leitura remota rejeitada por regras de autorização/permissão.'
      };
    }
    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.INACCESSIBLE,
      isEquivalent: false,
      isAbsent: false,
      requiresResolution: true,
      divergentFields: [],
      reason: `Servidor remoto inacessível durante verificação: ${readError.message}`
    };
  }

  // 1. Registro inexistente remotamente (null ou undefined)
  if (remoteRecord === null || remoteRecord === undefined) {
    if (action === 'DELETE') {
      return {
        outcome: REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED,
        isEquivalent: true,
        isAbsent: true,
        requiresResolution: false,
        divergentFields: [],
        reason: 'Registro remoto não existe ou já foi excluído. Operação de exclusão satisfeita.'
      };
    }

    if (action === 'UPDATE') {
      return {
        outcome: REMOTE_RECONCILIATION_OUTCOME.UPDATE_ON_ABSENT_RECORD,
        isEquivalent: false,
        isAbsent: true,
        requiresResolution: true,
        divergentFields: [],
        reason: 'Registro remoto inexistente para operação de UPDATE (exclusão remota ou perda de entidade). Requer resolução.'
      };
    }

    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT,
      isEquivalent: false,
      isAbsent: true,
      requiresResolution: false,
      divergentFields: [],
      reason: 'Registro remoto não existe no destino.'
    };
  }

  // 2. Registro existe remotamente
  // Validação explícita de isolamento multi-tenant na reconciliação
  if (remoteRecord && remoteRecord.tenantId && localPayload?.tenantId && remoteRecord.tenantId !== localPayload.tenantId) {
    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT,
      isEquivalent: false,
      isAbsent: false,
      requiresResolution: true,
      divergentFields: [{ field: 'tenantId', localValue: localPayload.tenantId, remoteValue: remoteRecord.tenantId }],
      reason: `Violação multi-tenant: registro remoto pertence a outro tenant ("${remoteRecord.tenantId}" vs "${localPayload.tenantId}").`
    };
  }

  if (action === 'DELETE') {
    if (remoteRecord.deletedAt) {
      return {
        outcome: REMOTE_RECONCILIATION_OUTCOME.ALREADY_DELETED,
        isEquivalent: true,
        divergentFields: [],
        reason: 'Registro remoto já possui soft-delete aplicado. Exclusão já confirmada.'
      };
    }
    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.RECORD_ABSENT,
      isEquivalent: false,
      divergentFields: [],
      reason: 'Registro remoto ainda está ativo no servidor. Exclusão pendente de execução.'
    };
  }

  // Se for UPDATE e o registro remoto já estiver com soft-delete
  if (action === 'UPDATE' && remoteRecord.deletedAt && !localPayload?.deletedAt) {
    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT,
      isEquivalent: false,
      divergentFields: [{ field: 'deletedAt', localValue: null, remoteValue: remoteRecord.deletedAt }],
      reason: 'Registro remoto foi excluído enquanto a atualização local estava pendente.'
    };
  }

  const isEq = arePayloadsEquivalent(entityType, localPayload, remoteRecord);
  if (isEq) {
    return {
      outcome: REMOTE_RECONCILIATION_OUTCOME.RECORD_EQUIVALENT,
      isEquivalent: true,
      divergentFields: [],
      reason: 'Registro remoto existente é semanticamente equivalente à operação local.'
    };
  }

  // Detecção de conflito de concorrência por avanço de versão remota
  const expVer = expectedBaseVersion ?? localPayload?.baseVersion ?? localPayload?.expectedBaseVersion;
  if (expVer !== undefined && expVer !== null && remoteRecord.version !== undefined && remoteRecord.version !== null) {
    if (remoteRecord.version !== expVer) {
      const divergences = getDivergentFields(entityType, localPayload, remoteRecord);
      return {
        outcome: REMOTE_RECONCILIATION_OUTCOME.VERSION_CONFLICT,
        isEquivalent: false,
        isAbsent: false,
        requiresResolution: true,
        divergentFields: divergences,
        reason: `Conflito de concorrência: versão remota atual (v${remoteRecord.version}) difere da versão-base esperada (v${expVer}).`
      };
    }
  }

  const divergences = getDivergentFields(entityType, localPayload, remoteRecord);
  return {
    outcome: REMOTE_RECONCILIATION_OUTCOME.RECORD_DIVERGENT,
    isEquivalent: false,
    isAbsent: false,
    requiresResolution: true,
    divergentFields: divergences,
    reason: `Registro remoto existente difere da operação local nos campos: ${divergences.map(d => d.field).join(', ')}`
  };
}
