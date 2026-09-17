/**
 * GestãoPro — Dataset de Demonstração Pública (FASE 3 & FASE 4)
 * 
 * Este arquivo contém exclusivamente dados sintéticos e fictícios para demonstração
 * profissional do sistema em ambiente público (ex: GitHub Pages / Portfólio).
 * 
 * Regras Estritas:
 * - NENHUM dado real de clientes, empresas, compras ou vendas;
 * - NENHUM CNPJ/CPF real;
 * - NENHUM segredo, chave de API ou credencial;
 * - Totalmente compatível com a integridade relacional do IndexedDB e auditoria de estoque.
 */

import { getDB } from '../db/connection.js';
import { executeTransaction } from '../db/transactions.js';
import { ALL_STORES } from '../services/BackupService.js';
import { eventBus, EVENTS } from '../eventBus.js';

export const DEMO_DATASET = {
  settings: [
    {
      id: 'companyProfile',
      value: {
        tradeName: 'GestãoPro Auto Center Demo',
        corporateName: 'GestãoPro Auto Center Comércio de Autopeças Demo Ltda.',
        cnpj: '00.000.000/0001-00',
        phone: '(11) 5555-0100',
        email: 'contato@gestaopro-demo.local',
        address: 'Av. das Nações Unidas, 1000 - Demo Park, São Paulo - SP'
      }
    },
    { id: 'allowNegativeStock', value: false },
    { id: 'lowStockThreshold', value: 5 },
    { id: 'isPublicDemo', value: true }
  ],

  categories: [
    { id: 'cat-freios', name: 'Freios', description: 'Pastilhas, discos e componentes de frenagem' },
    { id: 'cat-filtros', name: 'Filtros & Lubrificantes', description: 'Filtros de óleo, ar e combustível' },
    { id: 'cat-motor', name: 'Motor', description: 'Correias, tensores e polias' },
    { id: 'cat-iluminacao', name: 'Iluminação', description: 'Lâmpadas LED e sinalização automotiva' },
    { id: 'cat-eletrica', name: 'Elétrica', description: 'Baterias automotivas e componentes elétricos' }
  ],

  suppliers: [
    {
      id: 'sup-demo-01',
      name: 'AutoParts Brasil Demo Ltda.',
      corporateName: 'AutoParts Brasil Peças Automotivas Demo Ltda.',
      document: '12.345.678/0001-90',
      email: 'contato@autopartsdemo.local',
      phone: '(11) 5555-0100',
      contactPerson: 'Atendimento Comercial Demo',
      city: 'São Paulo',
      state: 'SP',
      address: 'Rua das Indústrias, 500',
      isActive: true,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z'
    },
    {
      id: 'sup-demo-02',
      name: 'Distribuidora Central Demo S.A.',
      corporateName: 'Distribuidora Central de Componentes Demo S.A.',
      document: '98.765.432/0001-10',
      email: 'vendas@centraldemo.local',
      phone: '(11) 5555-0200',
      contactPerson: 'Equipe Distribuição Demo',
      city: 'Campinas',
      state: 'SP',
      address: 'Av. Industrial, 1200',
      isActive: true,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z'
    }
  ],

  products: [
    {
      id: 'prod-demo-01',
      name: 'Pastilha de Freio Premium Demo',
      productCode: 'PST-001',
      internalCode: 'INT-001',
      barcode: '7891000000015',
      brand: 'BremboTech Demo',
      categoryId: 'cat-freios',
      purchasePriceCents: 8500,
      salePriceCents: 16000,
      stockQuantity: 24,
      minStock: 5,
      maxStock: 50,
      location: 'Corredor A - Prateleira 2',
      isActive: true,
      totalSold: 2,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-09-17T12:00:00.000Z'
    },
    {
      id: 'prod-demo-02',
      name: 'Filtro de Óleo 10W40 Demo',
      productCode: 'FLT-002',
      internalCode: 'INT-002',
      barcode: '7891000000022',
      brand: 'TecFil Demo',
      categoryId: 'cat-filtros',
      purchasePriceCents: 2500,
      salePriceCents: 5500,
      stockQuantity: 42,
      minStock: 10,
      maxStock: 100,
      location: 'Corredor B - Prateleira 1',
      isActive: true,
      totalSold: 3,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-09-17T12:00:00.000Z'
    },
    {
      id: 'prod-demo-03',
      name: 'Correia de Acessórios Demo',
      productCode: 'COR-003',
      internalCode: 'INT-003',
      barcode: '7891000000039',
      brand: 'GatesTech Demo',
      categoryId: 'cat-motor',
      purchasePriceCents: 4500,
      salePriceCents: 9500,
      stockQuantity: 18,
      minStock: 4,
      maxStock: 30,
      location: 'Corredor C - Prateleira 3',
      isActive: true,
      totalSold: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-09-17T12:00:00.000Z'
    },
    {
      id: 'prod-demo-04',
      name: 'Lâmpada LED Automotiva Demo',
      productCode: 'LMP-004',
      internalCode: 'INT-004',
      barcode: '7891000000046',
      brand: 'PhilipsVision Demo',
      categoryId: 'cat-iluminacao',
      purchasePriceCents: 3500,
      salePriceCents: 7500,
      stockQuantity: 30,
      minStock: 8,
      maxStock: 60,
      location: 'Corredor A - Prateleira 4',
      isActive: true,
      totalSold: 2,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-09-17T12:00:00.000Z'
    },
    {
      id: 'prod-demo-05',
      name: 'Bateria 60Ah Demo',
      productCode: 'BAT-005',
      internalCode: 'INT-005',
      barcode: '7891000000053',
      brand: 'MouraPower Demo',
      categoryId: 'cat-eletrica',
      purchasePriceCents: 28000,
      salePriceCents: 46000,
      stockQuantity: 8,
      minStock: 3,
      maxStock: 20,
      location: 'Área de Baterias - Setor E',
      isActive: true,
      totalSold: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-09-17T12:00:00.000Z'
    }
  ],

  productSuppliers: [
    {
      id: 'ps-demo-01',
      productId: 'prod-demo-01',
      supplierId: 'sup-demo-01',
      quotePriceCents: 8500,
      quoteDate: '2026-09-10T10:00:00.000Z',
      notes: 'Cotação mensal regular com entrega programada'
    },
    {
      id: 'ps-demo-02',
      productId: 'prod-demo-02',
      supplierId: 'sup-demo-01',
      quotePriceCents: 2500,
      quoteDate: '2026-09-10T10:00:00.000Z',
      notes: 'Preço promocional lote com 40 unidades'
    },
    {
      id: 'ps-demo-03',
      productId: 'prod-demo-05',
      supplierId: 'sup-demo-01',
      quotePriceCents: 28000,
      quoteDate: '2026-09-12T10:00:00.000Z',
      notes: 'Garantia de 24 meses do fabricante'
    },
    {
      id: 'ps-demo-04',
      productId: 'prod-demo-03',
      supplierId: 'sup-demo-02',
      quotePriceCents: 4500,
      quoteDate: '2026-09-11T10:00:00.000Z',
      notes: 'Distribuição direta pronta entrega'
    },
    {
      id: 'ps-demo-05',
      productId: 'prod-demo-04',
      supplierId: 'sup-demo-02',
      quotePriceCents: 3500,
      quoteDate: '2026-09-11T10:00:00.000Z',
      notes: 'Embalagem blister lacrada'
    }
  ],

  purchases: [
    {
      id: 'pur-demo-01',
      supplierId: 'sup-demo-01',
      productId: 'prod-demo-01',
      quantity: 20,
      unitCostCents: 8500,
      totalCostCents: 170000,
      date: '2026-09-01T10:00:00.000Z',
      invoiceNumber: 'NF-DEMO-1001',
      notes: 'Reposição quinzenal de pastilhas',
      createdAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'pur-demo-02',
      supplierId: 'sup-demo-01',
      productId: 'prod-demo-02',
      quantity: 40,
      unitCostCents: 2500,
      totalCostCents: 100000,
      date: '2026-09-03T10:00:00.000Z',
      invoiceNumber: 'NF-DEMO-1002',
      notes: 'Pedido programado de filtros de óleo',
      createdAt: '2026-09-03T10:00:00.000Z'
    },
    {
      id: 'pur-demo-03',
      supplierId: 'sup-demo-01',
      productId: 'prod-demo-05',
      quantity: 9,
      unitCostCents: 28000,
      totalCostCents: 252000,
      date: '2026-09-05T10:00:00.000Z',
      invoiceNumber: 'NF-DEMO-1003',
      notes: 'Lote baterias 60Ah alta durabilidade',
      createdAt: '2026-09-05T10:00:00.000Z'
    }
  ],

  sales: [
    {
      id: 'sale-demo-01',
      productId: 'prod-demo-01',
      quantity: 2,
      unitSalePriceCents: 16000,
      totalSaleCents: 32000,
      unitCostCents: 8500,
      totalCostCents: 17000,
      grossProfitCents: 15000,
      paymentMethod: 'PIX',
      customerName: 'Cliente Demonstração 01',
      date: '2026-09-14T14:30:00.000Z',
      createdAt: '2026-09-14T14:30:00.000Z'
    },
    {
      id: 'sale-demo-02',
      productId: 'prod-demo-02',
      quantity: 3,
      unitSalePriceCents: 5500,
      totalSaleCents: 16500,
      unitCostCents: 2500,
      totalCostCents: 7500,
      grossProfitCents: 9000,
      paymentMethod: 'CREDIT_CARD',
      customerName: 'Cliente Demonstração 02',
      date: '2026-09-15T11:15:00.000Z',
      createdAt: '2026-09-15T11:15:00.000Z'
    },
    {
      id: 'sale-demo-03',
      productId: 'prod-demo-05',
      quantity: 1,
      unitSalePriceCents: 46000,
      totalSaleCents: 46000,
      unitCostCents: 28000,
      totalCostCents: 28000,
      grossProfitCents: 18000,
      paymentMethod: 'DEBIT_CARD',
      customerName: 'Cliente Demonstração 03',
      date: '2026-09-16T16:45:00.000Z',
      createdAt: '2026-09-16T16:45:00.000Z'
    },
    {
      id: 'sale-demo-04',
      productId: 'prod-demo-04',
      quantity: 2,
      unitSalePriceCents: 7500,
      totalSaleCents: 15000,
      unitCostCents: 3500,
      totalCostCents: 7000,
      grossProfitCents: 8000,
      paymentMethod: 'MONEY',
      customerName: 'Cliente Demonstração 04',
      date: '2026-09-17T09:20:00.000Z',
      createdAt: '2026-09-17T09:20:00.000Z'
    },
    {
      id: 'sale-demo-05',
      productId: 'prod-demo-03',
      quantity: 1,
      unitSalePriceCents: 9500,
      totalSaleCents: 9500,
      unitCostCents: 4500,
      totalCostCents: 4500,
      grossProfitCents: 5000,
      paymentMethod: 'PIX',
      customerName: 'Cliente Demonstração 05',
      date: '2026-09-17T11:00:00.000Z',
      createdAt: '2026-09-17T11:00:00.000Z'
    }
  ],

  stockMovements: [
    // prod-demo-01 (Total = 6 + 20 - 2 = 24)
    {
      id: 'sm-demo-01',
      productId: 'prod-demo-01',
      type: 'IN',
      quantity: 6,
      date: '2026-08-01T10:00:00.000Z',
      reason: 'Saldo Inicial Demonstrativo',
      createdAt: '2026-08-01T10:00:00.000Z'
    },
    {
      id: 'sm-demo-02',
      productId: 'prod-demo-01',
      type: 'IN',
      quantity: 20,
      date: '2026-09-01T10:00:00.000Z',
      referenceId: 'pur-demo-01',
      reason: 'Entrada por Ordem de Compra NF-DEMO-1001',
      createdAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'sm-demo-03',
      productId: 'prod-demo-01',
      type: 'OUT',
      quantity: 2,
      date: '2026-09-14T14:30:00.000Z',
      referenceId: 'sale-demo-01',
      reason: 'Baixa por Venda PDV',
      createdAt: '2026-09-14T14:30:00.000Z'
    },

    // prod-demo-02 (Total = 5 + 40 - 3 = 42)
    {
      id: 'sm-demo-04',
      productId: 'prod-demo-02',
      type: 'IN',
      quantity: 5,
      date: '2026-08-01T10:00:00.000Z',
      reason: 'Saldo Inicial Demonstrativo',
      createdAt: '2026-08-01T10:00:00.000Z'
    },
    {
      id: 'sm-demo-05',
      productId: 'prod-demo-02',
      type: 'IN',
      quantity: 40,
      date: '2026-09-03T10:00:00.000Z',
      referenceId: 'pur-demo-02',
      reason: 'Entrada por Ordem de Compra NF-DEMO-1002',
      createdAt: '2026-09-03T10:00:00.000Z'
    },
    {
      id: 'sm-demo-06',
      productId: 'prod-demo-02',
      type: 'OUT',
      quantity: 3,
      date: '2026-09-15T11:15:00.000Z',
      referenceId: 'sale-demo-02',
      reason: 'Baixa por Venda PDV',
      createdAt: '2026-09-15T11:15:00.000Z'
    },

    // prod-demo-03 (Total = 19 - 1 = 18)
    {
      id: 'sm-demo-07',
      productId: 'prod-demo-03',
      type: 'IN',
      quantity: 19,
      date: '2026-08-01T10:00:00.000Z',
      reason: 'Saldo Inicial Demonstrativo',
      createdAt: '2026-08-01T10:00:00.000Z'
    },
    {
      id: 'sm-demo-08',
      productId: 'prod-demo-03',
      type: 'OUT',
      quantity: 1,
      date: '2026-09-17T11:00:00.000Z',
      referenceId: 'sale-demo-05',
      reason: 'Baixa por Venda PDV',
      createdAt: '2026-09-17T11:00:00.000Z'
    },

    // prod-demo-04 (Total = 32 - 2 = 30)
    {
      id: 'sm-demo-09',
      productId: 'prod-demo-04',
      type: 'IN',
      quantity: 32,
      date: '2026-08-01T10:00:00.000Z',
      reason: 'Saldo Inicial Demonstrativo',
      createdAt: '2026-08-01T10:00:00.000Z'
    },
    {
      id: 'sm-demo-10',
      productId: 'prod-demo-04',
      type: 'OUT',
      quantity: 2,
      date: '2026-09-17T09:20:00.000Z',
      referenceId: 'sale-demo-04',
      reason: 'Baixa por Venda PDV',
      createdAt: '2026-09-17T09:20:00.000Z'
    },

    // prod-demo-05 (Total = 9 - 1 = 8)
    {
      id: 'sm-demo-11',
      productId: 'prod-demo-05',
      type: 'IN',
      quantity: 9,
      date: '2026-09-05T10:00:00.000Z',
      referenceId: 'pur-demo-03',
      reason: 'Entrada por Ordem de Compra NF-DEMO-1003',
      createdAt: '2026-09-05T10:00:00.000Z'
    },
    {
      id: 'sm-demo-12',
      productId: 'prod-demo-05',
      type: 'OUT',
      quantity: 1,
      date: '2026-09-16T16:45:00.000Z',
      referenceId: 'sale-demo-03',
      reason: 'Baixa por Venda PDV',
      createdAt: '2026-09-16T16:45:00.000Z'
    }
  ]
};

/**
 * Carrega o conjunto de dados sintéticos de demonstração no banco local.
 * @param {boolean} [force=false] Se true, substitui dados existentes.
 */
export async function loadDemoSeed(force = false) {
  const db = await getDB();
  
  // Verifica se o banco já contém produtos cadastrados
  const existingProducts = await db.getAll('products');
  if (existingProducts.length > 0 && !force) {
    console.log('[DemoSeed] Banco já possui registros; carga de dados demo ignorada.');
    return { success: true, seeded: false };
  }

  console.log('[DemoSeed] Carregando dataset sintético para demonstração pública...');

  const tx = db.transaction(ALL_STORES, 'readwrite');

  try {
    // 1. Settings
    const settingsStore = tx.objectStore('settings');
    for (const setting of DEMO_DATASET.settings) {
      await settingsStore.put(setting);
    }

    // 2. Categorias
    const catStore = tx.objectStore('categories');
    for (const cat of DEMO_DATASET.categories) {
      await catStore.put(cat);
    }

    // 3. Fornecedores
    const supStore = tx.objectStore('suppliers');
    for (const sup of DEMO_DATASET.suppliers) {
      await supStore.put(sup);
    }

    // 4. Produtos
    const prodStore = tx.objectStore('products');
    for (const prod of DEMO_DATASET.products) {
      await prodStore.put(prod);
    }

    // 5. Cotações / Fornecedor-Produto
    const psStore = tx.objectStore('productSuppliers');
    for (const ps of DEMO_DATASET.productSuppliers) {
      await psStore.put(ps);
    }

    // 6. Compras
    const purStore = tx.objectStore('purchases');
    for (const pur of DEMO_DATASET.purchases) {
      await purStore.put(pur);
    }

    // 7. Vendas
    const saleStore = tx.objectStore('sales');
    for (const sale of DEMO_DATASET.sales) {
      await saleStore.put(sale);
    }

    // 8. Movimentações de Estoque
    const smStore = tx.objectStore('stockMovements');
    for (const sm of DEMO_DATASET.stockMovements) {
      await smStore.put(sm);
    }

    await tx.done;

    console.log('[DemoSeed] Dataset sintético carregado com sucesso!');

    // Notificar UI sobre atualização de catálogo e estoque
    eventBus.emit(EVENTS.PRODUCT_UPDATED, { action: 'demo_seed' });
    eventBus.emit(EVENTS.STOCK_CHANGED, { action: 'demo_seed' });

    return { success: true, seeded: true };
  } catch (error) {
    console.error('[DemoSeed] Erro ao carregar seed de demonstração:', error);
    return { success: false, error };
  }
}

/**
 * Inicializador condicional de demonstração pública.
 * Ativado quando VITE_PUBLIC_DEMO=true ou quando o banco está vazio.
 */
export async function initPublicDemoIfNeeded() {
  const isPublicDemoMode = typeof import.meta !== 'undefined' && 
                           import.meta.env && 
                           (import.meta.env.VITE_PUBLIC_DEMO === 'true' || import.meta.env.VITE_PUBLIC_DEMO === true);

  const db = await getDB();
  const existingProducts = await db.getAll('products');

  if (isPublicDemoMode || existingProducts.length === 0) {
    await loadDemoSeed(false);
  }
}
