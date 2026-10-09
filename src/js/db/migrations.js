/**
 * Definições e evoluções do Schema do IndexedDB.
 * A versão do banco aumenta com cada nova migration.
 */

export const DB_NAME = 'gestaopro_db';
export const DB_VERSION = 3;

export const migrations = {
  1: (db) => {
    // products
    const productsStore = db.createObjectStore('products', { keyPath: 'id' });
    productsStore.createIndex('productCode', 'productCode', { unique: false }); // Unique via rule, mas falso para ignorar nulos múltiplos
    productsStore.createIndex('internalCode', 'internalCode', { unique: false });
    productsStore.createIndex('barcode', 'barcode', { unique: false });
    productsStore.createIndex('name', 'name', { unique: false });
    productsStore.createIndex('categoryId', 'categoryId', { unique: false });
    productsStore.createIndex('brand', 'brand', { unique: false });
    productsStore.createIndex('isActive', 'isActive', { unique: false });
    productsStore.createIndex('createdAt', 'createdAt', { unique: false });
    productsStore.createIndex('updatedAt', 'updatedAt', { unique: false });

    // productImages
    const imagesStore = db.createObjectStore('productImages', { keyPath: 'id' });
    imagesStore.createIndex('productId', 'productId', { unique: false });
    imagesStore.createIndex('isPrimary', 'isPrimary', { unique: false });

    // suppliers
    db.createObjectStore('suppliers', { keyPath: 'id' });

    // productSuppliers
    const psStore = db.createObjectStore('productSuppliers', { keyPath: 'id' });
    psStore.createIndex('productId', 'productId', { unique: false });
    psStore.createIndex('supplierId', 'supplierId', { unique: false });
    psStore.createIndex('quoteDate', 'quoteDate', { unique: false });

    // sales
    const salesStore = db.createObjectStore('sales', { keyPath: 'id' });
    salesStore.createIndex('productId', 'productId', { unique: false });
    salesStore.createIndex('date', 'date', { unique: false });
    salesStore.createIndex('createdAt', 'createdAt', { unique: false });

    // purchases
    const purchasesStore = db.createObjectStore('purchases', { keyPath: 'id' });
    purchasesStore.createIndex('productId', 'productId', { unique: false });
    purchasesStore.createIndex('supplierId', 'supplierId', { unique: false });
    purchasesStore.createIndex('date', 'date', { unique: false });
    purchasesStore.createIndex('createdAt', 'createdAt', { unique: false });

    // stockMovements
    const stockStore = db.createObjectStore('stockMovements', { keyPath: 'id' });
    stockStore.createIndex('productId', 'productId', { unique: false });
    stockStore.createIndex('type', 'type', { unique: false }); // IN, OUT, SALE, PURCHASE, ADJUSTMENT, RETURN
    stockStore.createIndex('date', 'date', { unique: false });
    stockStore.createIndex('referenceId', 'referenceId', { unique: false }); // ID da Venda ou Compra, se aplicável

    // categories
    db.createObjectStore('categories', { keyPath: 'id' });

    // settings
    db.createObjectStore('settings', { keyPath: 'id' }); // store chave-valor {id: 'allowNegativeStock', value: true}

    // syncQueue (Future use)
    db.createObjectStore('syncQueue', { keyPath: 'id' });
  },
  2: (db, tx) => {
    // 1. Criar store para staging area da NFe
    const nfeStore = db.createObjectStore('nfe_imports', { keyPath: 'id' });
    nfeStore.createIndex('chaveAcesso', 'chaveAcesso', { unique: true });
    nfeStore.createIndex('status', 'status', { unique: false });
    nfeStore.createIndex('cnpjFornecedor', 'cnpjFornecedor', { unique: false });
    nfeStore.createIndex('createdAt', 'createdAt', { unique: false });

    // 2. Criar store para motor de De-Para (vínculo fornecedor-produto)
    const deParaStore = db.createObjectStore('de_para_produtos', { keyPath: 'id' });
    // Índice composto não é suportado nativamente de forma fácil no getDB sem array,
    // então usaremos um compound index (Array) se necessário ou consultaremos por fornecedor e filtraremos.
    // O idb permite índices compostos passando um array de caminhos.
    deParaStore.createIndex('fornecedor_produto', ['cnpjFornecedor', 'codigoFornecedor'], { unique: true });
    deParaStore.createIndex('cnpjFornecedor', 'cnpjFornecedor', { unique: false });
    
    // 3. Adicionar índice invoiceKey à store purchases existente
    // O tx é o IDBTransaction passado pelo idb durante o upgrade
    if (tx) {
      const purchasesStore = tx.objectStore('purchases');
      if (!purchasesStore.indexNames.contains('invoiceKey')) {
        purchasesStore.createIndex('invoiceKey', 'invoiceKey', { unique: false });
      }
    }
  },
  3: (db, tx) => {
    // 1. Criar store para o manifesto local de imagens (imageManifest - PHASE 05)
    if (!db.objectStoreNames.contains('imageManifest')) {
      const manifestStore = db.createObjectStore('imageManifest', { keyPath: 'photoId' });
      manifestStore.createIndex('id', 'id', { unique: false });
      manifestStore.createIndex('productId', 'productId', { unique: false });
      manifestStore.createIndex('tenantId', 'tenantId', { unique: false });
      manifestStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      manifestStore.createIndex('tenant_product', ['tenantId', 'productId'], { unique: false });
    }

    // 2. Adicionar índices tenantId e photoId à store productImages existente (PHASE 06)
    if (tx && db.objectStoreNames.contains('productImages')) {
      const imgStore = tx.objectStore('productImages');
      if (!imgStore.indexNames.contains('tenantId')) {
        imgStore.createIndex('tenantId', 'tenantId', { unique: false });
      }
      if (!imgStore.indexNames.contains('photoId')) {
        imgStore.createIndex('photoId', 'photoId', { unique: false });
      }
    }
  }
};
