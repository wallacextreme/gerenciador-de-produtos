import { authService } from '../services/AuthService.js';

/**
 * GestãoPro — Matriz Central de Permissões Offline e Guardião de Autorização (PHASE 14.7)
 * 
 * Regras Canônicas Estritas:
 * - admin: Leitura e escrita irrestrita em todos os módulos (Catálogo, Estoque, Vendas, Compras, Fornecedores, Configurações, Manifesto).
 * - operator: Leitura de todos os módulos; Escrita estrita permitida em Catálogo, Estoque, Vendas e Manifesto.
 *             Escrita ESTRITAMENTE NEGADA em Compras, Fornecedores e Configurações (exclusivos para admin no RTDB e Storage).
 * - viewer: Leitura autorizada no escopo do tenant; Escrita ESTRITAMENTE NEGADA em todos os módulos.
 * - requiresMigration: true / canonicalClaims: false:
 *   Sessão tratada como viewer (menor privilégio comercial). Escrita ESTRITAMENTE NEGADA.
 * - Usuário não autenticado: Quando a autenticação estiver ativa/configurada, nenhuma permissão de escrita implícita é concedida.
 */

export const PROTECTED_ENTITIES = Object.freeze({
  PRODUCTS: 'products',
  PRODUCT_IMAGES: 'productImages',
  STOCK_MOVEMENTS: 'stockMovements',
  SALES: 'sales',
  PURCHASES: 'purchases',
  SUPPLIERS: 'suppliers',
  PRODUCT_SUPPLIERS: 'productSuppliers',
  SETTINGS: 'settings',
  IMAGE_MANIFEST: 'imageManifest'
});

/**
 * Matriz canônica de papéis permitidos para operações de escrita/mutação por entidade.
 */
export const WRITE_PERMISSIONS_MATRIX = Object.freeze({
  products: ['admin', 'operator'],
  productimages: ['admin', 'operator'],
  stockmovements: ['admin', 'operator'],
  inventory: ['admin', 'operator'],
  sales: ['admin', 'operator'],
  purchases: ['admin'], // Exclusivo de admin
  suppliers: ['admin'], // Exclusivo de admin
  productsuppliers: ['admin'], // Exclusivo de admin
  settings: ['admin'],  // Exclusivo de admin
  imagemanifest: ['admin', 'operator'],
  syncqueue: ['admin', 'operator']
});

/**
 * Avalia se uma sessão tem permissão para realizar uma determinada ação sobre uma entidade.
 * @param {Object|null} session Sessão estruturada ativa
 * @param {string} action Ação ('create' | 'update' | 'delete' | 'record' | 'cancel' | 'read')
 * @param {string} entityType Tipo da entidade ('products', 'sales', 'purchases', etc.)
 * @returns {{ authorized: boolean, reason?: string, role?: string }}
 */
export function checkPermission(session, action, entityType) {
  const normAction = (action || '').toLowerCase();
  const normEntity = (entityType || '').toLowerCase();

  // Ações de leitura (read) são permitidas para qualquer usuário autenticado no tenant
  if (normAction === 'read' || normAction === 'get' || normAction === 'list') {
    if (!session || !session.authenticated) {
      return { authorized: false, reason: 'Usuário não autenticado.' };
    }
    return { authorized: true, role: session.role || 'viewer' };
  }

  // Se não há sessão autenticada
  if (!session || !session.authenticated) {
    return {
      authorized: false,
      reason: 'Usuário não autenticado. Nenhuma permissão de escrita concedida.',
      role: 'unauthenticated'
    };
  }

  // Se a conta requer migração de claims ou não possui claims canônicas válidas
  if (session.requiresMigration || session.canonicalClaims === false) {
    return {
      authorized: false,
      reason: 'Sessão aguarda regularização administrativa de claims (requiresMigration: true). Operações de gravação bloqueadas.',
      role: 'viewer'
    };
  }

  // Resolução estrita: apenas appRole explícito e válido no domínio concede privilégios (sem fallback para role legado)
  const role = (typeof session.appRole === 'string' && ['admin', 'operator', 'viewer'].includes(session.appRole))
    ? session.appRole
    : 'viewer';

  // Papel viewer nunca pode realizar mutações
  if (role === 'viewer') {
    return {
      authorized: false,
      reason: 'Papel comercial "viewer" possui permissão exclusivamente de leitura.',
      role
    };
  }

  const allowedRoles = WRITE_PERMISSIONS_MATRIX[normEntity];
  if (!allowedRoles) {
    // Entidade não mapeada na matriz de escrita: fail-closed para admin
    if (role === 'admin') {
      if (!session.tenantId || typeof session.tenantId !== 'string' || !session.tenantId.trim()) {
        return {
          authorized: false,
          reason: 'Sessão sem tenantId canônico válido. Operações de gravação multi-tenant bloqueadas.',
          role
        };
      }
      return { authorized: true, role };
    }
    return {
      authorized: false,
      reason: `Entidade "${normEntity}" desconhecida ou não autorizada para o papel "${role}".`,
      role
    };
  }

  if (!allowedRoles.includes(role)) {
    return {
      authorized: false,
      reason: `Operação de gravação em "${normEntity}" é exclusiva para [${allowedRoles.join(', ')}]. Seu papel atual é "${role}".`,
      role
    };
  }

  // Validação estrita de tenantId para qualquer operação de mutação autorizada pelo papel
  if (!session.tenantId || typeof session.tenantId !== 'string' || !session.tenantId.trim()) {
    return {
      authorized: false,
      reason: 'Sessão sem tenantId canônico válido. Operações de gravação multi-tenant bloqueadas.',
      role
    };
  }

  return { authorized: true, role };
}

/**
 * Afirma que a operação atual é permitida. Lança erro descritivo em caso de negação.
 * @param {string} action Ação ('create' | 'update' | 'delete' | 'record' | 'cancel')
 * @param {string} entityType Tipo da entidade
 * @param {Object} [options] { session, authInstance }
 * @throws {Error} Quando a operação não for autorizada
 */
export function assertPermission(action, entityType, options = {}) {
  const auth = options.authInstance || authService;
  const session = options.session !== undefined ? options.session : auth.getCurrentSession();

  // Modo aberto/local: Se o serviço de autenticação não estiver configurado com provedor ativo
  // e não houver nenhuma sessão (ex: testes legados sem mock de auth), não bloqueia.
  // Mas se estiver configurado ou se houver sessão ativa, A REGRA É FECHADA E OBRIGATÓRIA.
  const isAuthEnforced = auth.isConfigured() || (session !== null);

  if (!isAuthEnforced) {
    return true;
  }

  const result = checkPermission(session, action, entityType);
  if (!result.authorized) {
    throw new Error(`Operação não autorizada: ${result.reason}`);
  }

  return true;
}
