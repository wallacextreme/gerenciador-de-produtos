import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'bun:test';
import { BackupService, BACKUP_FORMAT } from '../src/js/services/BackupService.js';
import { productRepository } from '../src/js/repositories/ProductRepository.js';
import { productImageRepository } from '../src/js/repositories/ProductImageRepository.js';
import { supplierRepository } from '../src/js/repositories/SupplierRepository.js';
import { saleRepository } from '../src/js/repositories/SaleRepository.js';
import { purchaseRepository } from '../src/js/repositories/PurchaseRepository.js';
import { stockMovementRepository } from '../src/js/repositories/StockMovementRepository.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';
import { getDB } from '../src/js/db/connection.js';

describe('BackupService & Settings (Phase 9)', () => {

  describe('Exportação de Backup Completo e Blobs', () => {
    test('deve exportar todas as stores, serializar Blobs de fotos e gerar checksum SHA-256 válido', async () => {
      // 1. Criar dados de teste
      const prodId = crypto.randomUUID();
      await productRepository.create({
        id: prodId,
        name: 'Produto Backup Teste',
        productCode: 'BKP-01',
        purchasePriceCents: 5000,
        salePriceCents: 10000,
        stockQuantity: 10,
        totalSold: 2,
        isActive: true,
        deletedAt: null
      });

      const fakeBlob = new Blob(['fake image content'], { type: 'image/webp' });
      await productImageRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        blob: fakeBlob,
        thumbnailBlob: fakeBlob,
        width: 800,
        height: 600,
        mimeType: 'image/webp',
        isPrimary: true
      });

      const suppId = crypto.randomUUID();
      await supplierRepository.create({
        id: suppId,
        name: 'Fornecedor Backup',
        document: '99888777000166',
        isActive: true,
        deletedAt: null
      });

      await settingsRepository.set('allowNegativeStock', true);
      await settingsRepository.set('companyInfo', { name: 'Minha Empresa Teste', cnpj: '12345678000100' });

      // 2. Gerar backup
      const backup = await BackupService.createBackup();

      expect(backup.backupObject).toBeDefined();
      expect(backup.backupObject.format).toBe(BACKUP_FORMAT);
      expect(backup.backupObject.version).toBe('1.0');
      expect(backup.backupObject.schemaVersion).toBe(1);
      expect(backup.backupObject.checksum).toBeDefined();
      expect(backup.backupObject.checksum.length).toBeGreaterThan(10);
      expect(backup.counts.products).toBeGreaterThanOrEqual(1);
      expect(backup.counts.productImages).toBeGreaterThanOrEqual(1);
      expect(backup.counts.suppliers).toBeGreaterThanOrEqual(1);
      expect(backup.counts.settings).toBeGreaterThanOrEqual(2);

      // Verificar serialização do Blob para string Data URL Base64
      const exportedImage = backup.backupObject.data.productImages.find(i => i.productId === prodId);
      expect(exportedImage).toBeDefined();
      expect(typeof exportedImage.blob).toBe('string');
      expect(exportedImage.blob).toContain('data:image/webp;base64,');
    });
  });

  describe('Validação de Integridade e Checksum', () => {
    test('deve validar com sucesso um backup íntegro', async () => {
      const backup = await BackupService.createBackup();
      const validation = await BackupService.validateBackup(backup.backupObject);

      expect(validation.isValid).toBe(true);
      expect(validation.error).toBeNull();
      expect(validation.metadata).toBeDefined();
    });

    test('deve rejeitar arquivo com formato inválido', async () => {
      const invalidBackup = { format: 'outro_formato', data: {} };
      const validation = await BackupService.validateBackup(invalidBackup);

      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('Formato de backup incompatível');
    });

    test('deve rejeitar arquivo corrompido cujo checksum SHA-256 não coincide', async () => {
      const backup = await BackupService.createBackup();
      // Simular alteração maliciosa ou corrupção externa no payload de dados
      backup.backupObject.data.products.push({
        id: 'corrupted-product',
        name: 'Produto Injetado'
      });

      const validation = await BackupService.validateBackup(backup.backupObject);

      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('checksum SHA-256 do backup não coincide');
    });

    test('deve rejeitar backup com schemaVersion superior à suportada', async () => {
      const backup = await BackupService.createBackup();
      backup.backupObject.schemaVersion = 99; // Futura incompatível

      const validation = await BackupService.validateBackup(backup.backupObject);

      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('schema (v99) incompatível');
    });
  });

  describe('Restauração e Reconstrução de Blobs', () => {
    test('deve restaurar todas as entidades e converter Base64 de volta para instâncias de Blob', async () => {
      // 1. Criar dados
      const prodId = crypto.randomUUID();
      await productRepository.create({
        id: prodId,
        name: 'Produto para Restauração',
        purchasePriceCents: 3000,
        salePriceCents: 7000,
        stockQuantity: 15,
        totalSold: 5
      });

      const fakeBlob = new Blob(['binario original de imagem'], { type: 'image/webp' });
      await productImageRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        blob: fakeBlob,
        thumbnailBlob: fakeBlob,
        mimeType: 'image/webp',
        isPrimary: true
      });

      // 2. Exportar
      const backup = await BackupService.createBackup();

      // 3. Modificar o banco local (simulando perda de dados ou troca de máquina)
      await productRepository.hardDelete(prodId);

      // 4. Restaurar backup
      const restoreResult = await BackupService.restoreBackup(backup.backupObject);

      expect(restoreResult.success).toBe(true);

      // 5. Verificar produto restaurado
      const restoredProd = await productRepository.findById(prodId);
      expect(restoredProd).toBeDefined();
      expect(restoredProd.name).toBe('Produto para Restauração');

      // 6. Verificar imagem restaurada como Blob real
      const restoredImages = await productImageRepository.findByProductId(prodId);
      expect(restoredImages.length).toBe(1);
      expect(restoredImages[0].blob instanceof Blob).toBe(true);
      expect(restoredImages[0].blob.type).toBe('image/webp');
    });
  });

  describe('Consistência de Caches Pós-Restauração', () => {
    test('deve recalcular corretamente os saldos de estoque e total vendido a partir dos movimentos reais', async () => {
      const prodId = crypto.randomUUID();
      await productRepository.create({
        id: prodId,
        name: 'Produto Consistência',
        stockQuantity: 999, // Valor inconsistente proposital
        totalSold: 999      // Valor inconsistente proposital
      });

      // Criar 1 movimento de entrada (+20) e 1 de saída (-5) -> Saldo real = 15
      await stockMovementRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        type: 'IN',
        quantity: 20,
        delta: 20,
        date: new Date().toISOString()
      });
      await stockMovementRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        type: 'OUT',
        quantity: 5,
        delta: -5,
        date: new Date().toISOString()
      });

      // Criar 1 venda de 3 unidades
      await saleRepository.create({
        id: crypto.randomUUID(),
        productId: prodId,
        quantity: 3,
        cancelledAt: null,
        date: new Date().toISOString()
      });

      // Recalcular consistência
      await BackupService.recalculateDerivativesAndCaches();

      const updated = await productRepository.findById(prodId);
      expect(updated.stockQuantity).toBe(15); // 20 - 5
      expect(updated.totalSold).toBe(3);
    });
  });

  describe('Limpeza de Dados de Teste e Factory Reset', () => {
    test('deve limpar dados transacionais (vendas, compras, movimentos) zerando os saldos e mantendo o catálogo', async () => {
      const prod = await productRepository.create({
        id: crypto.randomUUID(),
        name: 'Produto Catálogo Permanente',
        stockQuantity: 50,
        totalSold: 20
      });

      await saleRepository.create({
        id: crypto.randomUUID(),
        productId: prod.id,
        quantity: 5
      });

      await stockMovementRepository.create({
        id: crypto.randomUUID(),
        productId: prod.id,
        type: 'IN',
        quantity: 50
      });

      // Executar limpeza de dados comerciais de teste
      await BackupService.cleanTransactionalData();

      // Vendas e movimentações devem estar vazias
      const remainingSales = await saleRepository.findAll();
      const remainingMovements = await stockMovementRepository.findAll();
      expect(remainingSales.length).toBe(0);
      expect(remainingMovements.length).toBe(0);

      // Produto deve existir mas com saldos zerados
      const cleanProd = await productRepository.findById(prod.id);
      expect(cleanProd).toBeDefined();
      expect(cleanProd.name).toBe('Produto Catálogo Permanente');
      expect(cleanProd.stockQuantity).toBe(0);
      expect(cleanProd.totalSold).toBe(0);
    });

    test('deve executar o Factory Reset zerando todo o banco e restaurando configurações padrão', async () => {
      await productRepository.create({ id: crypto.randomUUID(), name: 'Produto a Resetar' });
      await settingsRepository.set('allowNegativeStock', true);

      await BackupService.factoryReset();

      const allProducts = await productRepository.findAll();
      expect(allProducts.length).toBe(0);

      const allowNeg = await settingsRepository.get('allowNegativeStock');
      expect(allowNeg).toBe(false);
    });
  });

  describe('Persistência de Configurações da Empresa e Operacionais', () => {
    test('deve salvar, persistir e carregar dados cadastrais da empresa e opções operacionais', async () => {
      const companyData = {
        tradeName: 'GestãoPro Informática',
        corporateName: 'GestãoPro Sistemas LTDA',
        cnpj: '12.345.678/0001-90',
        phone: '(11) 98765-4321',
        email: 'contato@gestaopro.com.br',
        address: 'Av. Paulista, 1000 - São Paulo/SP'
      };

      await settingsRepository.set('companyProfile', companyData);
      await settingsRepository.set('lowStockThresholdDefault', 10);

      const savedCompany = await settingsRepository.get('companyProfile');
      const savedThreshold = await settingsRepository.get('lowStockThresholdDefault');

      expect(savedCompany).toBeDefined();
      expect(savedCompany.tradeName).toBe('GestãoPro Informática');
      expect(savedCompany.cnpj).toBe('12.345.678/0001-90');
      expect(savedThreshold).toBe(10);
    });
  });
});
