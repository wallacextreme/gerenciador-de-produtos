import { supplierRepository } from '../repositories/SupplierRepository.js';
import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { SupplierValidator } from '../validators/SupplierValidator.js';
import { eventBus, EVENTS } from '../eventBus.js';

export class SupplierService {
  /**
   * Cria um novo fornecedor.
   * @param {Object} supplierData 
   * @returns {Promise<string>} ID do fornecedor criado
   */
  static async createSupplier(supplierData) {
    SupplierValidator.assertValid(supplierData);

    // Verificar se já existe fornecedor ativo com o mesmo documento
    if (supplierData.document) {
      const existing = await supplierRepository.findByDocument(supplierData.document);
      if (existing) {
        throw new Error(`Já existe um fornecedor cadastrado com o documento ${supplierData.document}.`);
      }
    }

    const supplierId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const record = {
      id: supplierId,
      name: supplierData.name.trim(),
      document: supplierData.document ? supplierData.document.trim() : '',
      email: supplierData.email ? supplierData.email.trim() : '',
      phone: supplierData.phone ? supplierData.phone.trim() : '',
      contactPerson: supplierData.contactPerson ? supplierData.contactPerson.trim() : '',
      address: supplierData.address ? supplierData.address.trim() : '',
      notes: supplierData.notes ? supplierData.notes.trim() : '',
      isActive: supplierData.isActive !== false,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    await supplierRepository.create(record);

    eventBus.emit('SUPPLIER_CREATED', { id: supplierId, name: record.name });
    return supplierId;
  }

  /**
   * Atualiza um fornecedor existente.
   * @param {string} id 
   * @param {Object} supplierData 
   */
  static async updateSupplier(id, supplierData) {
    const existing = await supplierRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new Error('Fornecedor não encontrado.');
    }

    SupplierValidator.assertValid(supplierData);

    // Verificar unicidade de documento excluindo o próprio
    if (supplierData.document) {
      const duplicate = await supplierRepository.findByDocument(supplierData.document, id);
      if (duplicate) {
        throw new Error(`Já existe outro fornecedor cadastrado com o documento ${supplierData.document}.`);
      }
    }

    const nowIso = new Date().toISOString();
    const updated = {
      ...existing,
      name: supplierData.name.trim(),
      document: supplierData.document !== undefined ? supplierData.document.trim() : existing.document,
      email: supplierData.email !== undefined ? supplierData.email.trim() : existing.email,
      phone: supplierData.phone !== undefined ? supplierData.phone.trim() : existing.phone,
      contactPerson: supplierData.contactPerson !== undefined ? supplierData.contactPerson.trim() : existing.contactPerson,
      address: supplierData.address !== undefined ? supplierData.address.trim() : existing.address,
      notes: supplierData.notes !== undefined ? supplierData.notes.trim() : existing.notes,
      isActive: supplierData.isActive !== undefined ? supplierData.isActive : existing.isActive,
      updatedAt: nowIso
    };

    await supplierRepository.update(updated);

    eventBus.emit('SUPPLIER_UPDATED', { id, name: updated.name });
    return updated;
  }

  /**
   * Realiza o soft delete de um fornecedor.
   * @param {string} id 
   */
  static async deleteSupplier(id) {
    const existing = await supplierRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new Error('Fornecedor não encontrado.');
    }

    existing.deletedAt = new Date().toISOString();
    await supplierRepository.update(existing);

    eventBus.emit('SUPPLIER_DELETED', { id, name: existing.name });
  }

  /**
   * Obtém detalhes de um fornecedor com histórico de compras.
   * @param {string} id 
   */
  static async getSupplierWithPurchases(id) {
    const supplier = await supplierRepository.findById(id);
    if (!supplier || supplier.deletedAt) return null;

    const purchases = await purchaseRepository.findBySupplierId(id);
    const activePurchases = purchases.filter(p => !p.cancelledAt);

    const totalSpentCents = activePurchases.reduce((acc, p) => acc + (p.totalCostCents || 0), 0);
    const totalItemsPurchased = activePurchases.reduce((acc, p) => acc + (p.quantity || 0), 0);

    return {
      supplier,
      purchases,
      stats: {
        totalOrders: activePurchases.length,
        totalSpentCents,
        totalItemsPurchased
      }
    };
  }

  /**
   * Lista fornecedores com sumário de compras.
   * @param {Object} filters 
   */
  static async listSuppliers(filters = {}) {
    const suppliers = await supplierRepository.list(filters);
    const allPurchases = await purchaseRepository.list();

    const statsMap = new Map();
    for (const p of allPurchases) {
      if (p.cancelledAt || !p.supplierId) continue;
      if (!statsMap.has(p.supplierId)) {
        statsMap.set(p.supplierId, { count: 0, totalSpentCents: 0 });
      }
      const s = statsMap.get(p.supplierId);
      s.count += 1;
      s.totalSpentCents += (p.totalCostCents || 0);
    }

    return suppliers.map(sup => ({
      ...sup,
      orderCount: statsMap.get(sup.id)?.count || 0,
      totalSpentCents: statsMap.get(sup.id)?.totalSpentCents || 0
    }));
  }
}
