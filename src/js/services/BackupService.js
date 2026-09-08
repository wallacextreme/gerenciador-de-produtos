import { getDB } from '../db/connection.js';
import { DB_VERSION } from '../db/migrations.js';
import { executeTransaction } from '../db/transactions.js';
import { eventBus, EVENTS } from '../eventBus.js';

export const BACKUP_FORMAT = 'gestaopro_backup';
export const BACKUP_VERSION = '1.0';
export const APP_VERSION = '1.9.0';

export const ALL_STORES = [
  'products',
  'productImages',
  'suppliers',
  'productSuppliers',
  'sales',
  'purchases',
  'stockMovements',
  'categories',
  'settings',
  'syncQueue'
];

export class BackupService {
  /**
   * Converte um Blob para string Base64 Data URL.
   * @param {Blob} blob 
   * @returns {Promise<string>}
   */
  static async blobToBase64(blob) {
    if (!blob) return null;
    if (typeof blob === 'string') return blob; // Já em base64/url

    // Suporte a ambientes sem FileReader (ex: Bun / Node)
    if (typeof blob.arrayBuffer === 'function') {
      const buffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      let binary = '';
      const len = uint8.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);
      const mime = blob.type || 'image/webp';
      return `data:${mime};base64,${base64}`;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Converte uma string Base64 Data URL de volta para Blob.
   * @param {string} base64Data 
   * @param {string} [fallbackMimeType='image/webp']
   * @returns {Blob}
   */
  static base64ToBlob(base64Data, fallbackMimeType = 'image/webp') {
    if (!base64Data) return null;
    if (base64Data instanceof Blob) return base64Data;

    try {
      const parts = base64Data.split(',');
      const header = parts[0];
      const dataStr = parts[1] || parts[0];

      let mimeType = fallbackMimeType;
      const mimeMatch = header.match(/:(.*?);/);
      if (mimeMatch) {
        mimeType = mimeMatch[1];
      }

      const binaryStr = atob(dataStr);
      const len = binaryStr.length;
      const u8arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        u8arr[i] = binaryStr.charCodeAt(i);
      }

      return new Blob([u8arr], { type: mimeType });
    } catch (err) {
      console.warn('[BackupService] Erro ao converter base64 para Blob:', err);
      return null;
    }
  }

  /**
   * Serializa um payload de forma canônica determinística para cálculo de checksum.
   * @param {Object} dataPayload 
   * @returns {string}
   */
  static canonicalStringify(dataPayload) {
    const sortedKeys = Object.keys(dataPayload).sort();
    const sortedObj = {};
    for (const key of sortedKeys) {
      sortedObj[key] = dataPayload[key];
    }
    return JSON.stringify(sortedObj);
  }

  /**
   * Calcula o Checksum SHA-256 canônico sobre o payload de dados.
   * Utilizado exclusivamente para detecção de corrupção e verificação de integridade.
   * @param {Object} dataPayload 
   * @returns {Promise<string>} Hexadecimal SHA-256
   */
  static async computeChecksum(dataPayload) {
    const canonicalStr = this.canonicalStringify(dataPayload);
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalStr);

    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback simples caso subtle não esteja disponível
    let hash = 0;
    for (let i = 0; i < canonicalStr.length; i++) {
      hash = ((hash << 5) - hash) + canonicalStr.charCodeAt(i);
      hash |= 0;
    }
    return 'fallback-' + Math.abs(hash).toString(16);
  }

  /**
   * Gera um backup completo estruturado de todas as stores do banco.
   * @param {Function} [onProgress] Callback de progresso (percentual, mensagem)
   * @returns {Promise<{ backupObject: Object, backupJson: string, sizeBytes: number, counts: Object }>}
   */
  static async createBackup(onProgress = null) {
    const db = await getDB();
    const data = {};
    const counts = {};
    let totalItems = 0;

    const totalStores = ALL_STORES.length;
    for (let i = 0; i < totalStores; i++) {
      const storeName = ALL_STORES[i];
      if (onProgress) onProgress(Math.round(((i + 1) / (totalStores + 2)) * 100), `Lendo store ${storeName}...`);

      let records = [];
      try {
        records = await db.getAll(storeName);
      } catch (e) {
        records = [];
      }

      // Processamento especial de imagens (Blob -> Base64)
      if (storeName === 'productImages') {
        const processedImages = [];
        for (const img of records) {
          const mainBase64 = img.blob ? await this.blobToBase64(img.blob) : null;
          const thumbBase64 = img.thumbnailBlob ? await this.blobToBase64(img.thumbnailBlob) : null;

          processedImages.push({
            id: img.id,
            productId: img.productId,
            blob: mainBase64,
            thumbnailBlob: thumbBase64,
            width: img.width,
            height: img.height,
            mimeType: img.mimeType || 'image/webp',
            sizeBytes: img.sizeBytes || 0,
            isPrimary: !!img.isPrimary,
            deletedAt: img.deletedAt || null,
            createdAt: img.createdAt || new Date().toISOString()
          });
        }
        data[storeName] = processedImages;
      } else {
        data[storeName] = records;
      }

      counts[storeName] = data[storeName].length;
      totalItems += counts[storeName];
    }

    if (onProgress) onProgress(90, 'Calculando checksum de integridade SHA-256...');
    const checksum = await this.computeChecksum(data);

    const backupObject = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schemaVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      appName: 'GestãoPro',
      appVersion: APP_VERSION,
      checksum,
      metadata: {
        counts,
        totalRecords: totalItems
      },
      data
    };

    if (onProgress) onProgress(98, 'Serializando arquivo JSON...');
    const backupJson = JSON.stringify(backupObject, null, 2);
    const sizeBytes = new Blob([backupJson]).size;

    if (onProgress) onProgress(100, 'Backup concluído com sucesso!');

    return {
      backupObject,
      backupJson,
      sizeBytes,
      counts
    };
  }

  /**
   * Valida a integridade, formato, schema e checksum de um arquivo de backup antes de restaurar.
   * @param {Object} backupObject 
   * @returns {Promise<{ isValid: boolean, error: string|null, metadata: Object }>}
   */
  static async validateBackup(backupObject) {
    if (!backupObject || typeof backupObject !== 'object') {
      return { isValid: false, error: 'O arquivo informado não é um JSON válido.', metadata: null };
    }

    if (backupObject.format !== BACKUP_FORMAT) {
      return { isValid: false, error: `Formato de backup incompatível. Esperado: "${BACKUP_FORMAT}".`, metadata: null };
    }

    if (!backupObject.data || typeof backupObject.data !== 'object') {
      return { isValid: false, error: 'O arquivo de backup não contém a seção de dados ("data").', metadata: null };
    }

    if (backupObject.schemaVersion > DB_VERSION) {
      return {
        isValid: false,
        error: `O backup foi gerado por uma versão mais recente do schema (v${backupObject.schemaVersion}) incompatível com a versão atual (v${DB_VERSION}).`,
        metadata: backupObject.metadata
      };
    }

    // Verificação do Checksum de Integridade
    if (backupObject.checksum) {
      const computedChecksum = await this.computeChecksum(backupObject.data);
      if (computedChecksum !== backupObject.checksum) {
        return {
          isValid: false,
          error: 'Falha de integridade: o checksum SHA-256 do backup não coincide. O arquivo pode estar corrompido ou ter sido alterado externamente.',
          metadata: backupObject.metadata
        };
      }
    }

    return {
      isValid: true,
      error: null,
      metadata: backupObject.metadata || { counts: {}, totalRecords: 0 }
    };
  }

  /**
   * Extrai um snapshot em memória completo do estado atual de todas as stores do banco.
   * Utilizado para rollback de emergência se a restauração falhar.
   * @returns {Promise<Object>} Snapshot dos dados atuais
   */
  static async captureCurrentSnapshot() {
    const db = await getDB();
    const snapshot = {};
    for (const storeName of ALL_STORES) {
      try {
        snapshot[storeName] = await db.getAll(storeName);
      } catch (e) {
        snapshot[storeName] = [];
      }
    }
    return snapshot;
  }

  /**
   * Restaura um snapshot de segurança gravando de volta em caso de falha (Rollback).
   * @param {Object} snapshot 
   */
  static async rollbackSnapshot(snapshot) {
    console.warn('[BackupService] Acionando Rollback de emergência para estado anterior...');
    const db = await getDB();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    for (const storeName of ALL_STORES) {
      const store = tx.objectStore(storeName);
      await store.clear();
      const records = snapshot[storeName] || [];
      for (const rec of records) {
        await store.put(rec);
      }
    }
    await tx.done;
    console.info('[BackupService] Rollback concluído com sucesso.');
  }

  /**
   * Restaura com segurança um backup validado no banco de dados IndexedDB.
   * Executa validação, snapshot pré-restauração, limpeza, inserção,
   * reconstrução de Blobs de fotos e recálculo de consistência dos caches.
   * @param {Object} backupObject 
   * @param {Object} [options] { onProgress }
   * @returns {Promise<{ success: boolean, restoredCounts: Object }>}
   */
  static async restoreBackup(backupObject, options = {}) {
    const { onProgress } = options;

    // 1. Validação Estrita do Backup
    if (onProgress) onProgress(10, 'Validando integridade do arquivo de backup...');
    const validation = await this.validateBackup(backupObject);
    if (!validation.isValid) {
      throw new Error(`Validação do backup falhou: ${validation.error}`);
    }

    // 2. Captura do Snapshot de Segurança Pré-Restauração
    if (onProgress) onProgress(25, 'Criando snapshot de segurança pré-restauração...');
    const safetySnapshot = await this.captureCurrentSnapshot();

    try {
      if (onProgress) onProgress(45, 'Iniciando gravação transacional das stores...');
      const db = await getDB();
      const tx = db.transaction(ALL_STORES, 'readwrite');

      const importedData = backupObject.data;
      const restoredCounts = {};

      for (const storeName of ALL_STORES) {
        const store = tx.objectStore(storeName);
        await store.clear(); // Limpeza da store

        const records = importedData[storeName] || [];
        restoredCounts[storeName] = 0;

        for (const record of records) {
          // Reconstrução de Blobs de imagens
          if (storeName === 'productImages') {
            const restoredImg = {
              ...record,
              blob: record.blob ? this.base64ToBlob(record.blob, record.mimeType) : null,
              thumbnailBlob: record.thumbnailBlob ? this.base64ToBlob(record.thumbnailBlob, record.mimeType) : null
            };
            await store.put(restoredImg);
          } else {
            await store.put(record);
          }
          restoredCounts[storeName]++;
        }
      }

      await tx.done;

      // 3. Recalibração de Integridade e Caches Pós-Restauração
      if (onProgress) onProgress(80, 'Validando e recalculando caches de consistência...');
      await this.recalculateDerivativesAndCaches();

      // 4. Emissão de eventos para atualizar UI
      eventBus.emit(EVENTS.PRODUCT_UPDATED, { action: 'backup_restore' });
      eventBus.emit(EVENTS.STOCK_CHANGED, { action: 'backup_restore' });

      if (onProgress) onProgress(100, 'Restauração concluída com sucesso!');
      return { success: true, restoredCounts };

    } catch (err) {
      console.error('[BackupService] Erro fatal durante restauração:', err);
      if (onProgress) onProgress(50, 'Falha detectada. Revertendo alterações via Rollback...');
      
      // Rollback para estado anterior
      try {
        await this.rollbackSnapshot(safetySnapshot);
      } catch (rbErr) {
        console.error('[BackupService] Erro crítico no rollback:', rbErr);
      }

      throw new Error(`A restauração falhou e foi cancelada. O banco anterior foi preservado. Detalhe: ${err.message}`);
    }
  }

  /**
   * Recalcula campos derivados (`Product.stockQuantity`, `Product.totalSold`)
   * para assegurar integridade perfeita após importação ou limpeza.
   */
  static async recalculateDerivativesAndCaches() {
    const db = await getDB();
    const [products, stockMovements, sales] = await Promise.all([
      db.getAll('products'),
      db.getAll('stockMovements'),
      db.getAll('sales')
    ]);

    // Mapear saldo real a partir de stockMovements
    const stockMap = new Map();
    for (const mov of stockMovements) {
      const pId = mov.productId;
      const current = stockMap.get(pId) || 0;
      let delta = 0;
      if (mov.delta !== undefined && mov.delta !== null) {
        delta = mov.delta;
      } else if (['IN', 'PURCHASE', 'RETURN'].includes(mov.type)) {
        delta = mov.quantity || 0;
      } else if (['OUT', 'SALE'].includes(mov.type)) {
        delta = -(mov.quantity || 0);
      } else if (mov.type === 'ADJUSTMENT') {
        delta = mov.quantity || 0;
      }
      stockMap.set(pId, current + delta);
    }

    // Mapear total vendido a partir de sales ativas
    const soldMap = new Map();
    for (const sale of sales) {
      if (!sale.cancelledAt) {
        const pId = sale.productId;
        soldMap.set(pId, (soldMap.get(pId) || 0) + (sale.quantity || 0));
      }
    }

    // Atualizar produtos com dados coerentes
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    for (const prod of products) {
      const calculatedStock = stockMap.get(prod.id) ?? (prod.stockQuantity || 0);
      const calculatedSold = soldMap.get(prod.id) ?? (prod.totalSold || 0);
      
      prod.stockQuantity = calculatedStock;
      prod.totalSold = calculatedSold;
      await store.put(prod);
    }
    await tx.done;
  }

  /**
   * Limpa dados comerciais de teste (vendas, compras, movimentações)
   * mantendo intactos produtos, fotos, fornecedores e configurações,
   * e recalibra com segurança os saldos para o estado inicial.
   */
  static async cleanTransactionalData() {
    const db = await getDB();
    const transactionalStores = ['sales', 'purchases', 'stockMovements'];

    // 1. Limpar stores transacionais
    const tx = db.transaction(transactionalStores, 'readwrite');
    for (const storeName of transactionalStores) {
      await tx.objectStore(storeName).clear();
    }
    await tx.done;

    // 2. Atualizar produtos: zerar totalSold e stockQuantity (já que não há movimentos)
    const pTx = db.transaction('products', 'readwrite');
    const pStore = pTx.objectStore('products');
    const products = await pStore.getAll();
    for (const p of products) {
      p.stockQuantity = 0;
      p.totalSold = 0;
      p.updatedAt = new Date().toISOString();
      await pStore.put(p);
    }
    await pTx.done;

    eventBus.emit(EVENTS.PRODUCT_UPDATED, { action: 'clean_test_data' });
    eventBus.emit(EVENTS.STOCK_CHANGED, { action: 'clean_test_data' });

    return { success: true };
  }

  /**
   * Executa o Reset de Fábrica completo do banco, restaurando as configurações padrão.
   */
  static async factoryReset() {
    const db = await getDB();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    for (const storeName of ALL_STORES) {
      await tx.objectStore(storeName).clear();
    }

    // Restaurar configuração padrão
    const settingsStore = tx.objectStore('settings');
    await settingsStore.put({ id: 'allowNegativeStock', value: false });
    await tx.done;

    eventBus.emit(EVENTS.PRODUCT_UPDATED, { action: 'factory_reset' });
    eventBus.emit(EVENTS.STOCK_CHANGED, { action: 'factory_reset' });

    return { success: true };
  }

  /**
   * Helper para disparar salvamento do arquivo JSON com suporte à janela "Salvar Como..." do Windows.
   * @param {Object|string} backupData 
   * @param {string} [customFileName]
   */
  static async downloadBackupFile(backupData, customFileName = null) {
    const jsonStr = typeof backupData === 'string' ? backupData : JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = customFileName || `gestaopro_backup_${dateStr}_${timeStr}.json`;

    // 1. Tenta abrir a caixa nativa "Salvar Como..." do Windows
    if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'Arquivo de Backup JSON (*.json)',
            accept: { 'application/json': ['.json'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('[BackupService] showSaveFilePicker indisponível, usando fallback:', err);
      }
    }

    // 2. Fallback universal garantindo o nome do arquivo via Data URL
    const reader = new FileReader();
    reader.onload = () => {
      const a = document.createElement('a');
      a.href = reader.result;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 1500);
    };
    reader.readAsDataURL(blob);
  }
}
