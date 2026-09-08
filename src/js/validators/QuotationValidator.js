/**
 * Validador de domínio para Cotações de Fornecedores por Produto.
 * Entidade: ProductSupplier (cotação)
 */

export class QuotationValidator {
  /**
   * Valida os dados de uma cotação.
   * @param {Object} quotation
   * @returns {{ isValid: boolean, errors: string[] }}
   */
  static validate(quotation) {
    const errors = [];

    if (!quotation || typeof quotation !== 'object') {
      return { isValid: false, errors: ['Dados da cotação inválidos.'] };
    }

    // 1. productId obrigatório
    if (!quotation.productId || typeof quotation.productId !== 'string' || !quotation.productId.trim()) {
      errors.push('Produto é obrigatório para a cotação.');
    }

    // 2. supplierId obrigatório
    if (!quotation.supplierId || typeof quotation.supplierId !== 'string' || !quotation.supplierId.trim()) {
      errors.push('Fornecedor é obrigatório para a cotação.');
    }

    // 3. unitCostCents obrigatório, inteiro >= 0
    if (quotation.unitCostCents === undefined || quotation.unitCostCents === null) {
      errors.push('Preço unitário da cotação é obrigatório.');
    } else if (
      typeof quotation.unitCostCents !== 'number' ||
      !Number.isInteger(quotation.unitCostCents) ||
      quotation.unitCostCents < 0
    ) {
      errors.push('Preço unitário deve ser um valor inteiro em centavos, maior ou igual a zero.');
    }

    // 4. minimumOrderQty — opcional, mas se informado deve ser inteiro positivo
    if (quotation.minimumOrderQty !== undefined && quotation.minimumOrderQty !== null && quotation.minimumOrderQty !== '') {
      const qty = Number(quotation.minimumOrderQty);
      if (!Number.isInteger(qty) || qty < 1) {
        errors.push('Quantidade mínima de pedido deve ser um número inteiro positivo.');
      }
    }

    // 5. leadTimeDays — opcional, mas se informado deve ser inteiro >= 0
    if (quotation.leadTimeDays !== undefined && quotation.leadTimeDays !== null && quotation.leadTimeDays !== '') {
      const ltd = Number(quotation.leadTimeDays);
      if (!Number.isInteger(ltd) || ltd < 0) {
        errors.push('Prazo de entrega deve ser um número inteiro de dias (mínimo 0).');
      }
    }

    // 6. quoteDate — se informado, deve ser uma string de data válida
    if (quotation.quoteDate && typeof quotation.quoteDate === 'string' && quotation.quoteDate.trim()) {
      const d = new Date(quotation.quoteDate);
      if (isNaN(d.getTime())) {
        errors.push('Data da cotação inválida.');
      }
    }

    // 7. validUntil — se informado, deve ser data válida e posterior à quoteDate
    if (quotation.validUntil && typeof quotation.validUntil === 'string' && quotation.validUntil.trim()) {
      const validD = new Date(quotation.validUntil);
      if (isNaN(validD.getTime())) {
        errors.push('Data de validade da cotação inválida.');
      } else if (quotation.quoteDate) {
        const quoteD = new Date(quotation.quoteDate);
        if (!isNaN(quoteD.getTime()) && validD < quoteD) {
          errors.push('Data de validade deve ser posterior à data da cotação.');
        }
      }
    }

    // 8. paymentTerms — se informado, deve ser string não muito longa
    if (quotation.paymentTerms && typeof quotation.paymentTerms === 'string' && quotation.paymentTerms.trim().length > 255) {
      errors.push('Condições de pagamento devem ter no máximo 255 caracteres.');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Lança exceção se os dados da cotação forem inválidos.
   * @param {Object} quotation
   */
  static assertValid(quotation) {
    const result = this.validate(quotation);
    if (!result.isValid) {
      throw new Error(result.errors.join(' '));
    }
  }

  /**
   * Verifica se uma cotação está vencida.
   * @param {Object} quotation
   * @param {Date} [referenceDate] Data de referência (default: agora)
   * @returns {boolean}
   */
  static isExpired(quotation, referenceDate = new Date()) {
    if (!quotation.validUntil) return false;
    const validUntilDate = new Date(quotation.validUntil);
    if (isNaN(validUntilDate.getTime())) return false;
    return referenceDate > validUntilDate;
  }
}
