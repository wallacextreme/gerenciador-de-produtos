/**
 * Validador de domínio para Produtos.
 * Executa validações estruturais, tipos e regras de negócio antes da persistência.
 */
export class ProductValidator {
  /**
   * Valida os dados de um produto.
   * @param {Object} product
   * @returns {{ isValid: boolean, errors: Record<string, string> }}
   */
  static validate(product) {
    const errors = {};

    // 1. Nome obrigatório (mínimo 2 caracteres)
    if (!product.name || typeof product.name !== 'string' || product.name.trim().length < 2) {
      errors.name = 'O nome do produto é obrigatório e deve ter no mínimo 2 caracteres.';
    } else if (product.name.trim().length > 255) {
      errors.name = 'O nome do produto não pode exceder 255 caracteres.';
    }

    // 2. Preço de compra (em centavos, >= 0)
    if (product.purchasePriceCents !== undefined && product.purchasePriceCents !== null) {
      if (typeof product.purchasePriceCents !== 'number' || !Number.isInteger(product.purchasePriceCents) || product.purchasePriceCents < 0) {
        errors.purchasePriceCents = 'O valor de compra deve ser um número inteiro não negativo em centavos.';
      }
    }

    // 3. Preço de venda (em centavos, >= 0)
    if (product.salePriceCents !== undefined && product.salePriceCents !== null) {
      if (typeof product.salePriceCents !== 'number' || !Number.isInteger(product.salePriceCents) || product.salePriceCents < 0) {
        errors.salePriceCents = 'O valor de venda deve ser um número inteiro não negativo em centavos.';
      }
    }

    // 4. Estoque mínimo e máximo (>= 0)
    const minStock = product.minimumStock ?? 0;
    const maxStock = product.maximumStock ?? 0;

    if (typeof minStock !== 'number' || minStock < 0) {
      errors.minimumStock = 'O estoque mínimo deve ser maior ou igual a zero.';
    }

    if (typeof maxStock !== 'number' || maxStock < 0) {
      errors.maximumStock = 'O estoque máximo deve ser maior ou igual a zero.';
    }

    if (minStock > 0 && maxStock > 0 && maxStock < minStock) {
      errors.maximumStock = 'O estoque máximo não pode ser menor que o estoque mínimo.';
    }

    // 5. Validação de formato de códigos quando fornecidos
    if (product.productCode && typeof product.productCode === 'string' && product.productCode.length > 50) {
      errors.productCode = 'O código do produto não pode exceder 50 caracteres.';
    }
    if (product.internalCode && typeof product.internalCode === 'string' && product.internalCode.length > 50) {
      errors.internalCode = 'O código interno não pode exceder 50 caracteres.';
    }
    if (product.barcode && typeof product.barcode === 'string' && product.barcode.length > 50) {
      errors.barcode = 'O código de barras não pode exceder 50 caracteres.';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Lança exceção com a primeira mensagem de erro caso inválido.
   * @param {Object} product 
   */
  static assertValid(product) {
    const result = this.validate(product);
    if (!result.isValid) {
      const firstError = Object.values(result.errors)[0];
      throw new Error(firstError);
    }
  }
}
