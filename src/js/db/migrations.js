/**
 * Definições e evoluções do Schema do IndexedDB.
 * A versão do banco aumenta com cada nova migration.
 */

export const DB_NAME = 'gestaopro_db';
export const DB_VERSION = 1;

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
  }
};
