/**
 * Validador de domínio para Movimentações de Estoque.
 */

export const MOVEMENT_TYPES = {
  IN: 'IN',                 // Entrada manual / avulsa
  OUT: 'OUT',               // Saída manual / avulsa / perda / avaria
  ADJUSTMENT: 'ADJUSTMENT', // Ajuste / balanço físico de inventário
  RETURN: 'RETURN',         // Devolução de cliente / fornecedor
  PURCHASE: 'PURCHASE',     // Entrada originada por compra
  SALE: 'SALE'              // Saída originada por venda
};

export class StockValidator {
  /**
   * Valida os dados de uma movimentação de estoque.
   * Lança exceção com mensagem amigável caso haja inconsistência.
   * @param {Object} movement 
   */
  static validate(movement) {
    const errors = [];

    if (!movement || typeof movement !== 'object') {
      return { isValid: false, errors: ['Dados da movimentação inválidos.'] };
    }

    // 1. Validação de Produto
    if (!movement.productId || typeof movement.productId !== 'string' || !movement.productId.trim()) {
      errors.push('Produto obrigatório.');
    }

    // 2. Validação do Tipo
    const validTypes = Object.values(MOVEMENT_TYPES);
    if (!movement.type || !validTypes.includes(movement.type)) {
      errors.push(`Tipo de movimentação inválido. Tipos permitidos: ${validTypes.join(', ')}.`);
    }

    // 3. Validação de Quantidade
    if (typeof movement.quantity !== 'number' || isNaN(movement.quantity)) {
      errors.push('Quantidade deve ser um número.');
    } else if (!Number.isInteger(movement.quantity)) {
      errors.push('Quantidade deve ser um número inteiro.');
    } else if (movement.type === MOVEMENT_TYPES.ADJUSTMENT) {
      // No caso de delta de ajuste ou quantidade do movimento de ajuste, não pode ser 0
      if (movement.quantity === 0) {
        errors.push('Quantidade de movimentação de ajuste não pode ser zero.');
      }
    } else if (movement.quantity <= 0) {
      errors.push('Quantidade deve ser maior que zero.');
    }

    // 4. Validação de Motivo (obrigatório para saídas e ajustes manuais)
    if (['OUT', 'ADJUSTMENT'].includes(movement.type)) {
      if (!movement.reason || typeof movement.reason !== 'string' || !movement.reason.trim()) {
        errors.push('Motivo/justificativa é obrigatório para saídas e ajustes de estoque.');
      }
    }

    // 5. Custo unitário em centavos (se informado, deve ser inteiro >= 0)
    if (movement.unitCostCents !== undefined && movement.unitCostCents !== null) {
      if (typeof movement.unitCostCents !== 'number' || !Number.isInteger(movement.unitCostCents) || movement.unitCostCents < 0) {
        errors.push('Custo unitário em centavos deve ser um número inteiro não-negativo.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida e lança erro caso não seja válido.
   * @param {Object} movement 
   */
  static assertValid(movement) {
    const result = this.validate(movement);
    if (!result.isValid) {
      throw new Error(result.errors.join(' '));
    }
  }
}
