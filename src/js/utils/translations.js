/**
 * Módulo Central de Traduções e Formatações para a Interface de Usuário (PT-BR)
 * Garante que todos os termos, tipos, enums e status sejam exibidos em português claro e amigável.
 */

export const TRANSLATIONS = {
  // Tipos de movimentação de estoque
  MOVEMENT_TYPES: {
    IN: 'Entrada',
    OUT: 'Saída',
    ADJUSTMENT: 'Balanço / Ajuste',
    RETURN: 'Devolução',
    PURCHASE: 'Compra',
    SALE: 'Venda',
    LOSS: 'Perda / Avaria'
  },

  // Status de estoque
  STOCK_STATUS: {
    OUT_OF_STOCK: 'Esgotado',
    LOW_STOCK: 'Estoque Baixo',
    NORMAL: 'Normal',
    EXCESS_STOCK: 'Excesso'
  },

  // Formas de pagamento
  PAYMENT_METHODS: {
    DINHEIRO: 'Dinheiro',
    PIX: 'PIX',
    CARTAO_CREDITO: 'Cartão de Crédito',
    CARTAO_DEBITO: 'Cartão de Débito',
    BOLETO: 'Boleto Bancário',
    OUTRO: 'Outro'
  },

  // Entidades da fila de sincronização
  SYNC_ENTITIES: {
    products: 'Produtos',
    productImages: 'Fotos de Produtos',
    sales: 'Vendas',
    purchases: 'Compras',
    stockMovements: 'Movimentações de Estoque',
    suppliers: 'Fornecedores',
    quotations: 'Cotações',
    settings: 'Configurações'
  },

  // Ações de mutação
  SYNC_ACTIONS: {
    CREATE: 'Criação',
    UPDATE: 'Atualização',
    DELETE: 'Exclusão'
  },

  // Status de sincronização
  SYNC_STATUS: {
    PENDING: 'Pendente',
    SYNCING: 'Sincronizando',
    SYNCED: 'Sincronizado',
    FAILED: 'Falha'
  },

  // Classificação de velocidade de vendas / giro
  VELOCITY: {
    RAPIDA: 'Alta Rotatividade',
    NORMAL: 'Giro Normal',
    LENTA: 'Baixo Giro',
    PARADO: 'Sem Giro (Parado)'
  },

  // Períodos
  PERIODS: {
    ALL: 'Todas',
    TODAY: 'Hoje',
    WEEK: 'Últimos 7 dias',
    MONTH: 'Este Mês',
    LAST_7_DAYS: 'Últimos 7 dias',
    LAST_30_DAYS: 'Últimos 30 dias',
    LAST_90_DAYS: 'Últimos 90 dias',
    LAST_12_MONTHS: 'Últimos 12 meses',
    CUSTOM: 'Personalizado'
  }
};

/**
 * Traduz o tipo de movimentação de estoque para português.
 * @param {string} type 
 * @returns {string}
 */
export function formatMovementType(type) {
  if (!type) return 'Movimentação';
  return TRANSLATIONS.MOVEMENT_TYPES[type] || type;
}

/**
 * Renderiza um badge HTML estilizado para o tipo de movimentação.
 * @param {string} type 
 * @returns {string} HTML string
 */
export function renderMovementTypeBadge(type) {
  const label = formatMovementType(type);
  switch (type) {
    case 'IN':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Entrada</span>`;
    case 'OUT':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Saída</span>`;
    case 'ADJUSTMENT':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800">Balanço</span>`;
    case 'RETURN':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Devolução</span>`;
    case 'SALE':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">Venda</span>`;
    case 'PURCHASE':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800">Compra</span>`;
    case 'LOSS':
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">Perda</span>`;
    default:
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${label}</span>`;
  }
}

/**
 * Traduz o status de estoque para português.
 * @param {string} status 
 * @returns {string}
 */
export function formatStockStatus(status) {
  if (!status) return 'Normal';
  return TRANSLATIONS.STOCK_STATUS[status] || status;
}

/**
 * Traduz o método de pagamento para português.
 * @param {string} method 
 * @returns {string}
 */
export function formatPaymentMethod(method) {
  if (!method) return 'Não informado';
  return TRANSLATIONS.PAYMENT_METHODS[method] || method;
}

/**
 * Traduz o nome da entidade para a fila de sincronização.
 * @param {string} entity 
 * @returns {string}
 */
export function formatSyncEntity(entity) {
  if (!entity) return 'Registro';
  return TRANSLATIONS.SYNC_ENTITIES[entity] || entity;
}

/**
 * Traduz o nome da ação da fila de sincronização.
 * @param {string} action 
 * @returns {string}
 */
export function formatSyncAction(action) {
  if (!action) return 'Ação';
  return TRANSLATIONS.SYNC_ACTIONS[action] || action;
}

/**
 * Traduz o status da sincronização.
 * @param {string} status 
 * @returns {string}
 */
export function formatSyncStatus(status) {
  if (!status) return 'Pendente';
  return TRANSLATIONS.SYNC_STATUS[status] || status;
}
