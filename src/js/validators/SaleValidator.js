/**
 * Validador de domínio para Vendas.
 */

export const PAYMENT_METHODS = {
  DINHEIRO: 'DINHEIRO',
  PIX: 'PIX',
  CARTAO_CREDITO: 'CARTAO_CREDITO',
  CARTAO_DEBITO: 'CARTAO_DEBITO',
  BOLETO: 'BOLETO',
  OUTRO: 'OUTRO'
};

export class SaleValidator {
  /**
   * Valida os dados de uma venda comercial.
   * @param {Object} sale 
   * @returns {Object} { isValid, errors }
   */
  static validate(sale) {
    const errors = [];

    if (!sale || typeof sale !== 'object') {
      return { isValid: false, errors: ['Dados da venda inválidos.'] };
    }

    // 1. Produto obrigatório
    if (!sale.productId || typeof sale.productId !== 'string' || !sale.productId.trim()) {
      errors.push('Produto é obrigatório.');
    }

    // 2. Quantidade deve ser inteiro > 0
    if (typeof sale.quantity !== 'number' || isNaN(sale.quantity)) {
      errors.push('Quantidade deve ser um número.');
    } else if (!Number.isInteger(sale.quantity)) {
      errors.push('Quantidade deve ser um número inteiro.');
    } else if (sale.quantity <= 0) {
      errors.push('Quantidade vendida deve ser maior que zero.');
    }

    // 3. Preço de venda unitário em centavos (inteiro >= 0)
    if (sale.unitSalePriceCents !== undefined && sale.unitSalePriceCents !== null) {
      if (typeof sale.unitSalePriceCents !== 'number' || !Number.isInteger(sale.unitSalePriceCents) || sale.unitSalePriceCents < 0) {
        errors.push('Preço unitário de venda em centavos deve ser um número inteiro não-negativo.');
      }
    }

    // 4. Custo unitário em centavos (inteiro >= 0)
    if (sale.unitCostCents !== undefined && sale.unitCostCents !== null) {
      if (typeof sale.unitCostCents !== 'number' || !Number.isInteger(sale.unitCostCents) || sale.unitCostCents < 0) {
        errors.push('Custo unitário em centavos deve ser um número inteiro não-negativo.');
      }
    }

    // 5. Forma de pagamento (se informada, deve ser válida)
    if (sale.paymentMethod) {
      const validMethods = Object.values(PAYMENT_METHODS);
      if (!validMethods.includes(sale.paymentMethod)) {
        errors.push(`Forma de pagamento inválida. Formas permitidas: ${validMethods.join(', ')}.`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Lança exceção caso os dados da venda sejam inválidos.
   * @param {Object} sale 
   */
  static assertValid(sale) {
    const result = this.validate(sale);
    if (!result.isValid) {
      throw new Error(result.errors.join(' '));
    }
  }
}
