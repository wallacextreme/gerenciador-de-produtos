/**
 * Validador de domínio para Ordens de Compra.
 */

export class PurchaseValidator {
  /**
   * Valida os dados de uma compra / entrada de mercadoria.
   * @param {Object} purchase 
   * @returns {Object} { isValid, errors }
   */
  static validate(purchase) {
    const errors = [];

    if (!purchase || typeof purchase !== 'object') {
      return { isValid: false, errors: ['Dados da compra inválidos.'] };
    }

    // 1. Produto obrigatório
    if (!purchase.productId || typeof purchase.productId !== 'string' || !purchase.productId.trim()) {
      errors.push('Produto é obrigatório para registrar a compra.');
    }

    // 2. Fornecedor obrigatório
    if (!purchase.supplierId || typeof purchase.supplierId !== 'string' || !purchase.supplierId.trim()) {
      errors.push('Fornecedor é obrigatório para registrar a compra.');
    }

    // 3. Quantidade deve ser inteiro > 0
    if (typeof purchase.quantity !== 'number' || isNaN(purchase.quantity)) {
      errors.push('Quantidade deve ser um número.');
    } else if (!Number.isInteger(purchase.quantity)) {
      errors.push('Quantidade comprada deve ser um número inteiro.');
    } else if (purchase.quantity <= 0) {
      errors.push('Quantidade comprada deve ser maior que zero.');
    }

    // 4. Custo unitário em centavos (inteiro >= 0)
    if (purchase.unitCostCents !== undefined && purchase.unitCostCents !== null) {
      if (typeof purchase.unitCostCents !== 'number' || !Number.isInteger(purchase.unitCostCents) || purchase.unitCostCents < 0) {
        errors.push('Custo unitário em centavos deve ser um número inteiro não-negativo.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Lança exceção caso os dados da compra sejam inválidos.
   * @param {Object} purchase 
   */
  static assertValid(purchase) {
    const result = this.validate(purchase);
    if (!result.isValid) {
      throw new Error(result.errors.join(' '));
    }
  }
}
