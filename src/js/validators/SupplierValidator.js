/**
 * Validador de domínio para Fornecedores.
 */

export class SupplierValidator {
  /**
   * Valida os dados de um fornecedor.
   * @param {Object} supplier 
   * @returns {Object} { isValid, errors }
   */
  static validate(supplier) {
    const errors = [];

    if (!supplier || typeof supplier !== 'object') {
      return { isValid: false, errors: ['Dados do fornecedor inválidos.'] };
    }

    // 1. Nome / Razão Social obrigatório (mín 2, máx 255 chars)
    if (!supplier.name || typeof supplier.name !== 'string' || !supplier.name.trim()) {
      errors.push('Nome / Razão Social do fornecedor é obrigatório.');
    } else if (supplier.name.trim().length < 2) {
      errors.push('Nome do fornecedor deve ter no mínimo 2 caracteres.');
    } else if (supplier.name.trim().length > 255) {
      errors.push('Nome do fornecedor deve ter no máximo 255 caracteres.');
    }

    // 2. Email (se fornecido, deve ter formato básico válido)
    if (supplier.email && typeof supplier.email === 'string' && supplier.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(supplier.email.trim())) {
        errors.push('Email do fornecedor possui formato inválido.');
      }
    }

    // 3. Documento (CNPJ/CPF - se fornecido, valida comprimento básico)
    if (supplier.document && typeof supplier.document === 'string' && supplier.document.trim()) {
      const cleanDoc = supplier.document.replace(/\D/g, '');
      if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
        errors.push('Documento do fornecedor deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Lança exceção caso os dados do fornecedor sejam inválidos.
   * @param {Object} supplier 
   */
  static assertValid(supplier) {
    const result = this.validate(supplier);
    if (!result.isValid) {
      throw new Error(result.errors.join(' '));
    }
  }
}
