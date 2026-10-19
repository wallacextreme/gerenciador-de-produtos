import { BaseRepository, getCurrentTenant } from './BaseRepository.js';
import { getDB } from '../db/connection.js';

export class NFeImportRepository extends BaseRepository {
  constructor() {
    super('nfe_imports');
  }

  /**
   * Busca uma NFe na staging area pela chave de acesso.
   * @param {string} chaveAcesso 
   */
  async findByChaveAcesso(chaveAcesso) {
    if (!chaveAcesso) return null;
    const db = await getDB();
    const curTenant = getCurrentTenant();
    const all = await db.getAllFromIndex(this.storeName, 'chaveAcesso', chaveAcesso);
    return all.find(item => !curTenant || item.tenantId === curTenant) || null;
  }

  /**
   * Lista todas as NFe na staging, com filtro opcional por status.
   * @param {string} [status] 
   */
  async findByStatus(status) {
    const all = await this.findAll();
    if (!status) return all;
    return all.filter(n => n.status === status);
  }

  /**
   * Sobrescreve create para garantir unicidade da chave.
   * @param {Object} data 
   */
  async create(data) {
    if (!data.chaveAcesso) throw new Error('A Chave de Acesso é obrigatória para salvar na Staging.');
    const existente = await this.findByChaveAcesso(data.chaveAcesso);
    if (existente) {
      throw new Error('Esta NFe já está na Staging Area.');
    }
    return super.create(data);
  }
}

export const nfeImportRepository = new NFeImportRepository();
