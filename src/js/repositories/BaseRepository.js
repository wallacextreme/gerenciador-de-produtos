import { getDB } from '../db/connection.js';
import { validateAttributionEvidence } from '../services/AttributionTrustBoundary.js';

let currentTenantResolver = null;

/**
 * Registra a função que resolve o tenantId ativo atual (desacoplada do AuthService).
 * @param {Function} fn
 */
export function setTenantResolver(fn) {
  currentTenantResolver = fn;
}

/**
 * Retorna o tenantId ativo atual ou null se nenhum estiver definido.
 * @returns {string|null}
 */
export function getCurrentTenant() {
  if (typeof currentTenantResolver === 'function') {
    try {
      return currentTenantResolver() || null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Repositório Base contendo operações CRUD padronizadas.
 * Esconde completamente a implementação do idb/IndexedDB e assegura isolamento por tenant.
 */
export class BaseRepository {
  constructor(storeName) {
    this.storeName = storeName;
  }

  async getStore(mode = 'readonly') {
    const db = await getDB();
    const tx = db.transaction(this.storeName, mode);
    return { store: tx.objectStore(this.storeName), tx };
  }

  async create(data) {
    if (!data.id) throw new Error('[Repository] Criação falhou: ID é obrigatório.');
    
    const curTenant = getCurrentTenant();
    if (curTenant && !data.tenantId && this.storeName !== 'settings') {
      data.tenantId = curTenant;
    }

    data.createdAt = data.createdAt || new Date().toISOString();
    data.updatedAt = data.updatedAt || new Date().toISOString();
    
    const db = await getDB();
    await db.add(this.storeName, data);
    return data;
  }

  async update(data) {
    if (!data.id) throw new Error('[Repository] Atualização falhou: ID é obrigatório.');
    
    const curTenant = getCurrentTenant();
    if (curTenant && this.storeName !== 'settings') {
      const db = await getDB();
      const existing = await db.get(this.storeName, data.id);
      if (existing) {
        if (existing.tenantId && existing.tenantId !== curTenant) {
          throw new Error('[Repository] Acesso negado: registro pertence a outro tenant.');
        }
        if (!existing.tenantId) {
          throw new Error('[Repository] Acesso negado: registro legado não atribuído ao tenant atual. Requer atribuição segura.');
        }
      }
    }

    data.updatedAt = new Date().toISOString();
    
    const db = await getDB();
    await db.put(this.storeName, data);
    return data;
  }

  async findById(id) {
    const db = await getDB();
    const record = await db.get(this.storeName, id);
    if (!record) return null;

    const curTenant = getCurrentTenant();
    if (curTenant && this.storeName !== 'settings') {
      if (record.tenantId !== curTenant) {
        return null;
      }
    }
    return record;
  }

  async findAll(filterTenant = true) {
    const db = await getDB();
    const all = await db.getAll(this.storeName);
    if (!filterTenant) return all;

    const curTenant = getCurrentTenant();
    if (!curTenant || this.storeName === 'settings') return all;

    return all.filter(item => {
      return item && item.tenantId === curTenant;
    });
  }

  /**
   * Retorna registros legados sem tenant ou pendentes de atribuição.
   * Utilizado exclusivamente para auditoria e rotinas seguras de migração.
   */
  async findUnassignedLegacy() {
    const db = await getDB();
    const all = await db.getAll(this.storeName);
    if (this.storeName === 'settings') return [];
    return all.filter(item => !item.tenantId || item.tenantStatus === 'PENDING_ATTRIBUTION');
  }

  /**
   * Atribui com segurança um tenantId a um registro legado com validação estrita da fronteira de confiança.
   * Não aceita strings arbitrárias como prova de atribuição.
   * @param {string} id Identificador do registro
   * @param {string} targetTenant Tenant de destino
   * @param {Object} evidence Evidência estruturada de proveniência ou confirmação humana de reconciliação
   * @param {Object} [options={}] Opções adicionais (ex: session para reconciliação humana)
   * @returns {Promise<Object>} Registro atualizado
   */
  async assignLegacyTenant(id, targetTenant, evidence, options = {}) {
    if (!id || !targetTenant) {
      throw new Error('[Repository] ID e targetTenant são obrigatórios para atribuição.');
    }
    const db = await getDB();
    const existing = await db.get(this.storeName, id);
    if (!existing) {
      throw new Error(`[Repository] Registro ${id} não encontrado na store ${this.storeName}.`);
    }

    // Validação centralizada e estrita pela fronteira de confiança (Trust Boundary)
    const validation = validateAttributionEvidence({
      targetTenantId: targetTenant,
      existingRecord: existing,
      evidence,
      session: options.session || null,
      authInstance: options.authService || null
    });

    existing.tenantId = targetTenant;
    existing.tenantStatus = 'RESOLVED';
    existing.tenantAttributionSource = validation.attributionSource;
    existing.tenantAttributionProof = validation.proofDetails;
    existing.tenantAttributionAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();

    await db.put(this.storeName, existing);
    return existing;
  }

  async softDelete(id) {
    const record = await this.findById(id);
    if (record) {
      record.deletedAt = new Date().toISOString();
      await this.update(record);
      return true;
    }
    return false;
  }

  async hardDelete(id) {
    const record = await this.findById(id);
    if (!record) {
      return false;
    }
    const db = await getDB();
    await db.delete(this.storeName, id);
    return true;
  }
}
