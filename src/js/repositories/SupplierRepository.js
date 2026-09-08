import { BaseRepository } from './BaseRepository.js';

export class SupplierRepository extends BaseRepository {
  constructor() {
    super('suppliers');
  }

  /**
   * Lista fornecedores com filtros e ordenação alfabética por padrão.
   * @param {Object} filters { search, status, limit }
   */
  async list(filters = {}) {
    let suppliers = await this.findAll();

    // Excluir soft deleted por padrão
    suppliers = suppliers.filter(s => !s.deletedAt);

    // Filtro por status
    if (filters.status === 'active') {
      suppliers = suppliers.filter(s => s.isActive !== false);
    } else if (filters.status === 'inactive') {
      suppliers = suppliers.filter(s => s.isActive === false);
    }

    // Filtro textual (Nome, documento, email, pessoa de contato)
    if (filters.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      suppliers = suppliers.filter(s => 
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.document && s.document.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q)) ||
        (s.contactPerson && s.contactPerson.toLowerCase().includes(q))
      );
    }

    // Ordenação padrão por nome
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (filters.limit && typeof filters.limit === 'number') {
      suppliers = suppliers.slice(0, filters.limit);
    }

    return suppliers;
  }

  /**
   * Busca fornecedor por documento (CNPJ/CPF).
   * @param {string} document 
   * @param {string} excludeId 
   */
  async findByDocument(document, excludeId = null) {
    if (!document) return null;
    const cleanDoc = document.replace(/\D/g, '');
    const all = await this.findAll();
    return all.find(s => 
      !s.deletedAt && 
      s.document && 
      s.document.replace(/\D/g, '') === cleanDoc && 
      s.id !== excludeId
    ) || null;
  }
}

export const supplierRepository = new SupplierRepository();
