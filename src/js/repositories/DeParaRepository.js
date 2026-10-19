import { BaseRepository, getCurrentTenant } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class DeParaRepository extends BaseRepository {
  constructor() {
    super('de_para_produtos');
  }

  /**
   * Busca um vínculo específico pelo CNPJ do fornecedor e código do produto no fornecedor.
   * @param {string} cnpjFornecedor 
   * @param {string} codigoFornecedor 
   * @returns {Promise<Object|null>}
   */
  async findByFornecedorEProduto(cnpjFornecedor, codigoFornecedor) {
    if (!cnpjFornecedor || !codigoFornecedor) return null;
    const db = await getDB();
    const curTenant = getCurrentTenant();
    const all = await db.getAllFromIndex(this.storeName, 'fornecedor_produto', [cnpjFornecedor, codigoFornecedor]);
    return all.find(item => !curTenant || item.tenantId === curTenant) || null;
  }

  /**
   * Salva ou atualiza um vínculo De-Para.
   * @param {Object} data { cnpjFornecedor, codigoFornecedor, idProdutoInterno, fatorConversao, eanFornecedor }
   * @param {IDBObjectStore} [transactionStore] Store aberta, se estiver em uma transação
   */
  async salvarVinculo(data, transactionStore = null) {
    if (!data.cnpjFornecedor || !data.codigoFornecedor || !data.idProdutoInterno) {
      throw new Error('CNPJ Fornecedor, Código Fornecedor e ID Interno são obrigatórios.');
    }

    const curTenant = getCurrentTenant();
    const vinculoExistente = await this.findByFornecedorEProduto(data.cnpjFornecedor, data.codigoFornecedor);
    
    const record = vinculoExistente || {
      id: crypto.randomUUID(),
      ...(curTenant ? { tenantId: curTenant } : {}),
      cnpjFornecedor: data.cnpjFornecedor,
      codigoFornecedor: data.codigoFornecedor,
      createdAt: new Date().toISOString()
    };

    record.idProdutoInterno = data.idProdutoInterno;
    record.fatorConversao = data.fatorConversao || 1;
    record.eanFornecedor = data.eanFornecedor || '';
    record.updatedAt = new Date().toISOString();

    if (transactionStore) {
      await transactionStore.put(record);
    } else {
      const db = await getDB();
      await db.put(this.storeName, record);
    }

    return record;
  }
}

export const deParaRepository = new DeParaRepository();
