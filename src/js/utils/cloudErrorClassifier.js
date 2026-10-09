/**
 * GestãoPro — Classificador de Erros de Nuvem e Resiliência (PHASE 12)
 * 
 * Classifica erros do Firebase (Auth, RTDB, Storage) e REST APIs em:
 * - 'temporary': falhas transitórias de rede, timeouts, 500/503, 429 (elegíveis para retry com backoff)
 * - 'auth': falhas de autenticação, token expirado, 401 (exigem refresh de sessão ou re-login; NUNCA retry infinito)
 * - 'security': permissão negada, RBAC, 403 (bloqueio de acesso, NUNCA retry)
 * - 'permanent': 400, 404, schema inválido, payload malformado (NUNCA retry)
 * 
 * Também converte erros técnicos em mensagens amigáveis em português (UX)
 * e sanitiza logs para evitar vazamento de credenciais e tokens.
 */

export const ERROR_CATEGORY = Object.freeze({
  TEMPORARY: 'temporary',
  PERMANENT: 'permanent',
  AUTH: 'auth',
  SECURITY: 'security'
});

/**
 * Classifica um erro do Firebase ou de rede.
 * @param {Error|Object|string} error 
 * @returns {{ category: string, shouldRetry: boolean, userMessage: string, code: string }}
 */
export function classifyCloudError(error) {
  if (!error) {
    return {
      category: ERROR_CATEGORY.PERMANENT,
      shouldRetry: false,
      userMessage: 'Ocorreu um erro desconhecido.',
      code: 'UNKNOWN'
    };
  }

  const rawMessage = typeof error === 'string' ? error : (error.message || '');
  const code = (error.code || error.status || '').toString().toLowerCase();
  const lowerMsg = rawMessage.toLowerCase();

  // 1. Erros de Autenticação (401 / unauthenticated / token expired)
  if (
    code === '401' ||
    code === 'unauthenticated' ||
    code === 'auth/id-token-expired' ||
    code === 'auth/user-token-expired' ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('token expired') ||
    lowerMsg.includes('401 unauthorized')
  ) {
    return {
      category: ERROR_CATEGORY.AUTH,
      shouldRetry: false,
      userMessage: 'Sua sessão expirou. Por favor, faça login novamente para continuar.',
      code: code || 'AUTH_EXPIRED'
    };
  }

  // 2. Erros de Permissão / Segurança (403 / permission-denied / forbidden)
  if (
    code === '403' ||
    code === 'permission-denied' ||
    code === 'storage/unauthorized' ||
    lowerMsg.includes('permission_denied') ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('403 forbidden') ||
    lowerMsg.includes('acesso negado')
  ) {
    return {
      category: ERROR_CATEGORY.SECURITY,
      shouldRetry: false,
      userMessage: 'Você não tem permissão para realizar esta operação.',
      code: code || 'PERMISSION_DENIED'
    };
  }

  // 3. Erros Transitórios / Rede / Timeout / Rate Limit (Temporary)
  if (
    code === '429' ||
    code === '500' ||
    code === '502' ||
    code === '503' ||
    code === '504' ||
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'timeout' ||
    code === 'network-request-failed' ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests')
  ) {
    return {
      category: ERROR_CATEGORY.TEMPORARY,
      shouldRetry: true,
      userMessage: 'Instabilidade temporária de rede. O sistema tentará novamente em instantes.',
      code: code || 'TEMPORARY_NETWORK'
    };
  }

  // 4. Erros Permanentes (404 Not Found, 400 Bad Request, Object Not Found)
  if (
    code === '404' ||
    code === 'storage/object-not-found' ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('não encontrado')
  ) {
    return {
      category: ERROR_CATEGORY.PERMANENT,
      shouldRetry: false,
      userMessage: 'O recurso solicitado não foi encontrado no servidor.',
      code: code || 'NOT_FOUND'
    };
  }

  // Padrão: Falha não transitória
  return {
    category: ERROR_CATEGORY.PERMANENT,
    shouldRetry: false,
    userMessage: 'Não foi possível completar a operação com o servidor.',
    code: code || 'GENERIC_ERROR'
  };
}

/**
 * Sanitiza objetos ou mensagens de log para evitar vazamento acidental
 * de segredos, senhas, tokens JWT ou credenciais no console.
 * @param {*} data 
 * @returns {*} Objeto ou string seguro para logging
 */
export function sanitizeLogData(data) {
  if (!data) return data;
  if (typeof data === 'string') {
    return data
      .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/token=([a-zA-Z0-9._-]+)/gi, 'token=[REDACTED]')
      .replace(/password=([^&\s]+)/gi, 'password=[REDACTED]')
      .replace(/apiKey=([a-zA-Z0-9_-]+)/gi, 'apiKey=[REDACTED]');
  }

  if (typeof data === 'object') {
    const sensitiveKeys = ['password', 'token', 'idToken', 'refreshToken', 'secret', 'clientSecret', 'privateKey', 'apiKey'];
    const copy = Array.isArray(data) ? [...data] : { ...data };
    for (const key of Object.keys(copy)) {
      if (sensitiveKeys.some(k => k.toLowerCase() === key.toLowerCase())) {
        copy[key] = '[REDACTED]';
      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
        copy[key] = sanitizeLogData(copy[key]);
      }
    }
    return copy;
  }

  return data;
}
