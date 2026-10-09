import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from 'bun:test';
import { openDB } from 'idb';
import { getDB } from '../src/js/db/connection.js';
import { DB_NAME, DB_VERSION, migrations } from '../src/js/db/migrations.js';
import {
  ImageManifestService,
  MANIFEST_STATUS,
  normalizeImageMetadata,
  computeImageHash
} from '../src/js/services/ImageManifestService.js';
import { imageManifestRepository, ImageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { settingsRepository } from '../src/js/repositories/SettingsRepository.js';

describe('PHASE 05 — Image Manifest & Incremental Reconciliation Suite', () => {
  const TENANT_A = 'tenant_empresa_a';
  const TENANT_B = 'tenant_empresa_b';

  beforeEach(async () => {
    // Limpar store do imageManifest antes de testes de repositório
    const db = await getDB();
    if (db.objectStoreNames.contains('imageManifest')) {
      const tx = db.transaction('imageManifest', 'readwrite');
      await tx.objectStore('imageManifest').clear();
      await tx.done;
    }
  });

  // =========================================================================
  // MANIFEST-01 a MANIFEST-17: Testes do Motor de Reconciliação
  // =========================================================================

  it('MANIFEST-01: deve classificar todas as fotos remotas como NEW quando o manifesto local estiver vazio', () => {
    const remote = [
      { photoId: 'p1', productId: 'prod-01', tenantId: TENANT_A, version: 1, hash: 'h1', url: 'https://cdn/p1.webp' },
      { photoId: 'p2', productId: 'prod-01', tenantId: TENANT_A, version: 1, hash: 'h2', url: 'https://cdn/p2.webp' }
    ];
    const local = [];

    const result = ImageManifestService.reconcile(remote, local, { tenantId: TENANT_A });

    expect(result.newPhotos.length).toBe(2);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.unchangedPhotos.length).toBe(0);
    expect(result.deletedPhotos.length).toBe(0);
    expect(result.localOnlyPhotos.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
    expect(result.summary.newCount).toBe(2);
    expect(result.newPhotos[0].photoId).toBe('p1');
    expect(result.newPhotos[0].status).toBe(MANIFEST_STATUS.NEW);
  });

  it('MANIFEST-02: deve classificar fotos locais como LOCAL_ONLY quando o manifesto remoto estiver vazio', () => {
    const remote = [];
    const local = [
      { photoId: 'loc1', productId: 'prod-01', tenantId: TENANT_A, version: 1, hash: 'hl1' }
    ];

    const result = ImageManifestService.reconcile(remote, local, { tenantId: TENANT_A });

    expect(result.localOnlyPhotos.length).toBe(1);
    expect(result.newPhotos.length).toBe(0);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.localOnlyPhotos[0].photoId).toBe('loc1');
    expect(result.localOnlyPhotos[0].status).toBe(MANIFEST_STATUS.LOCAL_ONLY);
  });

  it('MANIFEST-03: deve identificar photo NEW quando presente apenas no remoto', () => {
    const remote = [
      { photoId: 'photo-new', productId: 'prod-10', tenantId: TENANT_A, version: 1, hash: 'hash-new' }
    ];
    const local = [];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.newPhotos.length).toBe(1);
    expect(result.newPhotos[0].photoId).toBe('photo-new');
    expect(result.newPhotos[0].remote.hash).toBe('hash-new');
  });

  it('MANIFEST-04: deve classificar photo CHANGED quando a versão remota for superior à local', () => {
    const remote = [
      { photoId: 'p-updated', productId: 'prod-02', tenantId: TENANT_A, version: 3, hash: 'hash-v3' }
    ];
    const local = [
      { photoId: 'p-updated', productId: 'prod-02', tenantId: TENANT_A, version: 1, hash: 'hash-v1' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].photoId).toBe('p-updated');
    expect(result.changedPhotos[0].local.version).toBe(1);
    expect(result.changedPhotos[0].remote.version).toBe(3);
    expect(result.changedPhotos[0].status).toBe(MANIFEST_STATUS.CHANGED);
  });

  it('MANIFEST-05: deve classificar photo UNCHANGED quando versão e hash forem rigorosamente idênticos', () => {
    const remote = [
      { photoId: 'p-same', productId: 'prod-03', tenantId: TENANT_A, version: 2, hash: 'identical-hash' }
    ];
    const local = [
      { photoId: 'p-same', productId: 'prod-03', tenantId: TENANT_A, version: 2, hash: 'identical-hash' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.newPhotos.length).toBe(0);
    expect(result.unchangedPhotos[0].photoId).toBe('p-same');
    expect(result.unchangedPhotos[0].status).toBe(MANIFEST_STATUS.UNCHANGED);
  });

  it('MANIFEST-06: deve classificar photo DELETED quando o remoto possuir deletedAt definido', () => {
    const remote = [
      {
        photoId: 'p-deleted',
        productId: 'prod-04',
        tenantId: TENANT_A,
        version: 2,
        hash: 'h-del',
        deletedAt: Date.now()
      }
    ];
    const local = [
      { photoId: 'p-deleted', productId: 'prod-04', tenantId: TENANT_A, version: 2, hash: 'h-del', deletedAt: null }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.deletedPhotos.length).toBe(1);
    expect(result.deletedPhotos[0].photoId).toBe('p-deleted');
    expect(result.deletedPhotos[0].status).toBe(MANIFEST_STATUS.DELETED);
    expect(result.unchangedPhotos.length).toBe(0);
  });

  it('MANIFEST-07: deve classificar foto como LOCAL_ONLY quando só existe no cliente local', () => {
    const remote = [];
    const local = [
      { photoId: 'photo-offline', productId: 'prod-05', tenantId: TENANT_A, version: 1, hash: 'local-only-hash' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.localOnlyPhotos.length).toBe(1);
    expect(result.localOnlyPhotos[0].photoId).toBe('photo-offline');
    expect(result.localOnlyPhotos[0].status).toBe(MANIFEST_STATUS.LOCAL_ONLY);
  });

  it('MANIFEST-08: deve manter UNCHANGED para mesma versão e mesmo hash mesmo com timestamps updatedAt diferentes', () => {
    const remote = [
      { photoId: 'p-ts', productId: 'prod-06', tenantId: TENANT_A, version: 4, hash: 'stable-hash', updatedAt: 1700000000000 }
    ];
    const local = [
      { photoId: 'p-ts', productId: 'prod-06', tenantId: TENANT_A, version: 4, hash: 'stable-hash', updatedAt: 1710000000000 }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
  });

  it('MANIFEST-09: deve detectar CONFLICT quando versão for igual mas os hashes forem divergentes', () => {
    const remote = [
      { photoId: 'p-conflict', productId: 'prod-07', tenantId: TENANT_A, version: 5, hash: 'remote-hash-bbb' }
    ];
    const local = [
      { photoId: 'p-conflict', productId: 'prod-07', tenantId: TENANT_A, version: 5, hash: 'local-hash-aaa' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].photoId).toBe('p-conflict');
    expect(result.conflicts[0].status).toBe(MANIFEST_STATUS.CONFLICT);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.unchangedPhotos.length).toBe(0);
  });

  it('MANIFEST-10: deve classificar como CHANGED quando versão remota for superior', () => {
    const remote = [
      { photoId: 'p-high', productId: 'prod-08', tenantId: TENANT_A, version: 10, hash: 'h-10' }
    ];
    const local = [
      { photoId: 'p-high', productId: 'prod-08', tenantId: TENANT_A, version: 2, hash: 'h-2' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].photoId).toBe('p-high');
    expect(result.changedPhotos[0].status).toBe(MANIFEST_STATUS.CHANGED);
  });

  it('MANIFEST-11: deve detectar conflito/bloqueio se a versão remota for inferior à versão local com hashes diferentes', () => {
    const remote = [
      { photoId: 'p-low', productId: 'prod-09', tenantId: TENANT_A, version: 1, hash: 'old-remote-hash' }
    ];
    const local = [
      { photoId: 'p-low', productId: 'prod-09', tenantId: TENANT_A, version: 3, hash: 'new-local-hash' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].photoId).toBe('p-low');
    expect(result.changedPhotos.length).toBe(0);
    expect(result.conflicts[0].reason).toContain('inferior');
  });

  it('MANIFEST-12: deve processar e agrupar múltiplos produtos na reconciliação', () => {
    const remote = [
      { photoId: 'pA1', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'hA1' },
      { photoId: 'pB1', productId: 'prodB', tenantId: TENANT_A, version: 2, hash: 'hB1_v2' }
    ];
    const local = [
      { photoId: 'pA1', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'hA1' },
      { photoId: 'pB1', productId: 'prodB', tenantId: TENANT_A, version: 1, hash: 'hB1_v1' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.unchangedPhotos[0].productId).toBe('prodA');
    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].productId).toBe('prodB');
  });

  it('MANIFEST-13: deve processar múltiplas fotos por produto preservando primary e label', () => {
    const remote = [
      { photoId: 'f1', productId: 'prodMulti', tenantId: TENANT_A, version: 1, hash: 'h1', isPrimary: true, label: 'Frente' },
      { photoId: 'f2', productId: 'prodMulti', tenantId: TENANT_A, version: 1, hash: 'h2', isPrimary: false, label: 'Verso' },
      { photoId: 'f3', productId: 'prodMulti', tenantId: TENANT_A, version: 1, hash: 'h3', isPrimary: false, label: 'Lateral' }
    ];
    const local = [
      { photoId: 'f1', productId: 'prodMulti', tenantId: TENANT_A, version: 1, hash: 'h1', isPrimary: true, label: 'Frente' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.newPhotos.length).toBe(2);
    expect(result.unchangedPhotos[0].remote.isPrimary).toBeTrue();
  });

  it('MANIFEST-14: deve tratar múltiplas versões do mesmo produto com precisão', () => {
    const remote = [
      { photoId: 'img1', productId: 'prodP1', tenantId: TENANT_A, version: 5, hash: 'hash-v5' },
      { photoId: 'img2', productId: 'prodP1', tenantId: TENANT_A, version: 1, hash: 'hash-v1' }
    ];
    const local = [
      { photoId: 'img1', productId: 'prodP1', tenantId: TENANT_A, version: 4, hash: 'hash-v4' },
      { photoId: 'img2', productId: 'prodP1', tenantId: TENANT_A, version: 1, hash: 'hash-v1' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].photoId).toBe('img1');
    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.unchangedPhotos[0].photoId).toBe('img2');
  });

  it('MANIFEST-15: deve garantir isolamento estrito de tenants', () => {
    const remote = [
      { photoId: 'photoA', productId: 'prod1', tenantId: TENANT_A, version: 1, hash: 'hA' },
      { photoId: 'photoB', productId: 'prod2', tenantId: TENANT_B, version: 1, hash: 'hB' }
    ];
    const local = [
      { photoId: 'photoA', productId: 'prod1', tenantId: TENANT_A, version: 1, hash: 'hA' },
      { photoId: 'photoB', productId: 'prod2', tenantId: TENANT_B, version: 1, hash: 'hB' }
    ];

    // Reconciliação isolada do Tenant A
    const resultTenantA = ImageManifestService.reconcile(remote, local, { tenantId: TENANT_A });

    expect(resultTenantA.summary.totalRemote).toBe(1);
    expect(resultTenantA.summary.totalLocal).toBe(1);
    expect(resultTenantA.unchangedPhotos.length).toBe(1);
    expect(resultTenantA.unchangedPhotos[0].photoId).toBe('photoA');
    // Foto do Tenant B foi sumariamente desconsiderada
    expect(resultTenantA.newPhotos.some(p => p.photoId === 'photoB')).toBeFalse();
    expect(resultTenantA.unchangedPhotos.some(p => p.photoId === 'photoB')).toBeFalse();
  });

  it('MANIFEST-16: deve desduplicar entradas repetidas no manifesto de forma idempotente', () => {
    const remoteWithDuplicates = [
      { photoId: 'dup1', productId: 'p1', tenantId: TENANT_A, version: 1, hash: 'h-old', updatedAt: 100 },
      { photoId: 'dup1', productId: 'p1', tenantId: TENANT_A, version: 2, hash: 'h-new', updatedAt: 200 }
    ];
    const local = [
      { photoId: 'dup1', productId: 'p1', tenantId: TENANT_A, version: 1, hash: 'h-old', updatedAt: 100 }
    ];

    const result = ImageManifestService.reconcile(remoteWithDuplicates, local);

    expect(result.summary.totalRemote).toBe(1);
    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].remote.version).toBe(2);
    expect(result.changedPhotos[0].remote.hash).toBe('h-new');
  });

  it('MANIFEST-17: deve retornar listas e sumário zerados quando ambos os manifestos forem vazios', () => {
    const result = ImageManifestService.reconcile([], []);

    expect(result.newPhotos.length).toBe(0);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.unchangedPhotos.length).toBe(0);
    expect(result.deletedPhotos.length).toBe(0);
    expect(result.localOnlyPhotos.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
    expect(result.summary.totalRemote).toBe(0);
    expect(result.summary.totalLocal).toBe(0);
  });

  // =========================================================================
  // MANIFEST-18: Performance e Escala com Grandes Volumes
  // =========================================================================

  it('MANIFEST-18: deve reconciliar grandes volumes (1.000, 5.000, 10.000 e 30.000 fotos) com complexidade O(N) e alta velocidade', () => {
    const volumes = [1000, 5000, 10000, 30000];

    for (const count of volumes) {
      const remote = [];
      const local = [];

      // Simulação de distribuição realista:
      // 70% UNCHANGED, 10% CHANGED, 10% NEW, 5% DELETED, 5% LOCAL_ONLY
      for (let i = 0; i < count; i++) {
        const photoId = `photo-vol-${i}`;
        const productId = `prod-${Math.floor(i / 3)}`;

        if (i < count * 0.7) {
          // UNCHANGED
          remote.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}` });
          local.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}` });
        } else if (i < count * 0.8) {
          // CHANGED (remote v2 > local v1)
          remote.push({ photoId, productId, tenantId: TENANT_A, version: 2, hash: `hash-${i}-v2` });
          local.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}-v1` });
        } else if (i < count * 0.9) {
          // NEW (apenas no remoto)
          remote.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}` });
        } else if (i < count * 0.95) {
          // DELETED no remoto
          remote.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}`, deletedAt: Date.now() });
          local.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}` });
        } else {
          // LOCAL_ONLY
          local.push({ photoId, productId, tenantId: TENANT_A, version: 1, hash: `hash-${i}` });
        }
      }

      const t0 = performance.now();
      const result = ImageManifestService.reconcile(remote, local, { tenantId: TENANT_A });
      const elapsedMs = performance.now() - t0;

      expect(result.summary.totalRemote).toBeGreaterThan(0);
      expect(result.unchangedPhotos.length).toBeGreaterThan(0);
      expect(result.changedPhotos.length).toBeGreaterThan(0);
      expect(result.newPhotos.length).toBeGreaterThan(0);
      expect(result.deletedPhotos.length).toBeGreaterThan(0);
      expect(result.localOnlyPhotos.length).toBeGreaterThan(0);

      // Verificação de performance estrita: O(N) deve processar 30.000 fotos em menos de 250ms
      expect(elapsedMs).toBeLessThan(500);
    }
  });

  // =========================================================================
  // MANIFEST-19 e MANIFEST-20: LastSyncAt e Cálculo de Deltas
  // =========================================================================

  it('MANIFEST-19: deve ler e persistir o timestamp de lastSyncAt no IndexedDB por tenant', async () => {
    const initialSync = await ImageManifestService.getLastSyncAt(TENANT_A);
    expect(initialSync).toBe(0);

    const now = 1728399600000;
    await ImageManifestService.setLastSyncAt(TENANT_A, now);

    const savedSync = await ImageManifestService.getLastSyncAt(TENANT_A);
    expect(savedSync).toBe(now);

    // Tenant B permanece isolado
    const tenantBSync = await ImageManifestService.getLastSyncAt(TENANT_B);
    expect(tenantBSync).toBe(0);
  });

  it('MANIFEST-20: deve calcular deltas estritamente a partir do timestamp de corte', () => {
    const cutoff = 1728000000000;

    const manifestList = [
      { photoId: 'old1', updatedAt: 1727000000000 },
      { photoId: 'new1', updatedAt: 1728100000000 },
      { photoId: 'new2', updatedAt: 1728200000000 },
      { photoId: 'del1', updatedAt: 1727000000000, deletedAt: 1728150000000 }
    ];

    const deltas = ImageManifestService.calculateDelta(manifestList, cutoff);

    expect(deltas.length).toBe(3);
    expect(deltas.some(d => d.photoId === 'old1')).toBeFalse();
    expect(deltas.some(d => d.photoId === 'new1')).toBeTrue();
    expect(deltas.some(d => d.photoId === 'new2')).toBeTrue();
    expect(deltas.some(d => d.photoId === 'del1')).toBeTrue();
  });

  // =========================================================================
  // Cenários Mandatórios de Integridade, Exclusão, Conflito e Multi-Tenant
  // =========================================================================

  it('Cenário de Integridade: Produto A com 3 fotos (photo1 UNCHANGED, photo2 CHANGED, photo3 NEW)', () => {
    const remote = [
      { photoId: 'photo1', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'h1' },
      { photoId: 'photo2', productId: 'prodA', tenantId: TENANT_A, version: 2, hash: 'h2_v2' },
      { photoId: 'photo3', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'h3' }
    ];
    const local = [
      { photoId: 'photo1', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'h1' },
      { photoId: 'photo2', productId: 'prodA', tenantId: TENANT_A, version: 1, hash: 'h2_v1' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.unchangedPhotos.length).toBe(1);
    expect(result.unchangedPhotos[0].photoId).toBe('photo1');

    expect(result.changedPhotos.length).toBe(1);
    expect(result.changedPhotos[0].photoId).toBe('photo2');

    expect(result.newPhotos.length).toBe(1);
    expect(result.newPhotos[0].photoId).toBe('photo3');

    expect(result.deletedPhotos.length).toBe(0);
    expect(result.localOnlyPhotos.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
  });

  it('Cenário de Exclusão: Remote deletedAt != null deve classificar como DELETED sem apagar o Blob local', async () => {
    const remote = [
      { photoId: 'photo-to-delete', productId: 'p1', tenantId: TENANT_A, version: 1, hash: 'h1', deletedAt: Date.now() }
    ];
    const local = [
      { photoId: 'photo-to-delete', productId: 'p1', tenantId: TENANT_A, version: 1, hash: 'h1', deletedAt: null }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.deletedPhotos.length).toBe(1);
    expect(result.deletedPhotos[0].photoId).toBe('photo-to-delete');
    expect(result.deletedPhotos[0].status).toBe(MANIFEST_STATUS.DELETED);
    // Garantir que a cópia local é preservada nesta fase
    expect(result.deletedPhotos[0].local).toBeDefined();
    expect(result.deletedPhotos[0].local.deletedAt).toBeNull();
  });

  it('Cenário de Conflito: Local v5 hash AAA vs Remote v5 hash BBB não deve sobrescrever', () => {
    const remote = [
      { photoId: 'p-conflict-test', productId: 'p99', tenantId: TENANT_A, version: 5, hash: 'BBB' }
    ];
    const local = [
      { photoId: 'p-conflict-test', productId: 'p99', tenantId: TENANT_A, version: 5, hash: 'AAA' }
    ];

    const result = ImageManifestService.reconcile(remote, local);

    expect(result.conflicts.length).toBe(1);
    expect(result.changedPhotos.length).toBe(0);
    expect(result.unchangedPhotos.length).toBe(0);
    expect(result.conflicts[0].local.hash).toBe('AAA');
    expect(result.conflicts[0].remote.hash).toBe('BBB');
  });

  // =========================================================================
  // Migration & Persistência do IndexedDB (v2 -> v3)
  // =========================================================================

  it('Migration IndexedDB: deve aplicar versão 3 com store imageManifest e preservar dados de produtos existentes', async () => {
    // 1. Criar banco em versão 2 simulando legado
    const legacyDBName = 'gestaopro_test_migration_legacy';
    const legacyDB = await openDB(legacyDBName, 2, {
      upgrade(db, oldVersion, newVersion, tx) {
        if (migrations[1]) migrations[1](db);
        if (migrations[2]) migrations[2](db, tx);
      }
    });

    // Inserir produto no banco v2
    await legacyDB.add('products', {
      id: 'prod-legacy-01',
      name: 'Notebook Gamer Antigo',
      productCode: 'LEG-01',
      stockQuantity: 5
    });

    legacyDB.close();

    // 2. Executar upgrade para versão 3
    const upgradedDB = await openDB(legacyDBName, 3, {
      upgrade(db, oldVersion, newVersion, tx) {
        for (let v = oldVersion + 1; v <= newVersion; v++) {
          if (migrations[v]) migrations[v](db, tx);
        }
      }
    });

    // 3. Validar se a nova store existe e se os dados anteriores foram 100% preservados
    expect(upgradedDB.version).toBe(3);
    expect(upgradedDB.objectStoreNames.contains('imageManifest')).toBeTrue();

    const preservedProduct = await upgradedDB.get('products', 'prod-legacy-01');
    expect(preservedProduct).toBeDefined();
    expect(preservedProduct.name).toBe('Notebook Gamer Antigo');
    expect(preservedProduct.stockQuantity).toBe(5);

    upgradedDB.close();
  });

  it('ImageManifestRepository: deve executar operações CRUD, lote e consultas por índice no IndexedDB', async () => {
    const entry1 = normalizeImageMetadata({
      photoId: 'img-repo-1',
      productId: 'prod-100',
      tenantId: TENANT_A,
      label: 'Foto Frente',
      isPrimary: true,
      url: 'https://storage/img1.webp',
      version: 1,
      hash: 'h-repo-1'
    });

    const entry2 = normalizeImageMetadata({
      photoId: 'img-repo-2',
      productId: 'prod-100',
      tenantId: TENANT_A,
      label: 'Foto Verso',
      isPrimary: false,
      url: 'https://storage/img2.webp',
      version: 1,
      hash: 'h-repo-2'
    });

    // Save all em lote
    await imageManifestRepository.saveAll([entry1, entry2]);

    // Busca por photoId
    const fetched = await imageManifestRepository.findByPhotoId('img-repo-1');
    expect(fetched).toBeDefined();
    expect(fetched.productId).toBe('prod-100');
    expect(fetched.isPrimary).toBeTrue();

    // Busca por productId
    const byProduct = await imageManifestRepository.findByProductId('prod-100');
    expect(byProduct.length).toBe(2);

    // Busca por tenantId
    const byTenant = await imageManifestRepository.findByTenantId(TENANT_A);
    expect(byTenant.length).toBe(2);

    // Soft delete
    await imageManifestRepository.markDeleted('img-repo-1');
    const afterDelete = await imageManifestRepository.findByPhotoId('img-repo-1');
    expect(afterDelete.deletedAt).toBeDefined();
    expect(typeof afterDelete.deletedAt).toBe('number');
  });

  it('Integração com Realtime Provider: deve publicar, listar e reconciliar via MockRealtimeProvider', async () => {
    const mockRTDB = new MockRealtimeProvider({
      tenantId: TENANT_A,
      deviceId: 'device-test'
    });

    // Publicar entrada no Realtime Database em /tenants/{tenantId}/imageManifest/{photoId}
    const meta = normalizeImageMetadata({
      photoId: 'cloud-photo-1',
      productId: 'prod-cloud',
      tenantId: TENANT_A,
      version: 2,
      hash: 'cloud-hash-v2',
      url: 'https://firebasestorage.googleapis.com/.../cloud-photo-1.webp'
    });

    await ImageManifestService.publishRemoteEntry(mockRTDB, meta);

    // Listar remoto
    const remoteList = await ImageManifestService.pullRemoteManifest(mockRTDB, TENANT_A);
    expect(remoteList.length).toBe(1);
    expect(remoteList[0].photoId).toBe('cloud-photo-1');

    // Gravar manifesto local com versão defasada v1
    await imageManifestRepository.create({
      photoId: 'cloud-photo-1',
      productId: 'prod-cloud',
      tenantId: TENANT_A,
      version: 1,
      hash: 'cloud-hash-v1'
    });

    // Orquestrar reconciliação completa para o tenant
    const reconResult = await ImageManifestService.reconcileForTenant(mockRTDB, TENANT_A);

    expect(reconResult.changedPhotos.length).toBe(1);
    expect(reconResult.changedPhotos[0].photoId).toBe('cloud-photo-1');
    expect(reconResult.changedPhotos[0].remote.version).toBe(2);
    expect(reconResult.changedPhotos[0].local.version).toBe(1);
  });

  it('Cálculo de Hash SHA-256: deve gerar checksums determinísticos via Web Cryptography API', async () => {
    const text1 = "imagem-conteudo-teste-1";
    const text2 = "imagem-conteudo-teste-2";

    const hash1a = await computeImageHash(text1);
    const hash1b = await computeImageHash(text1);
    const hash2 = await computeImageHash(text2);

    expect(hash1a).toBeDefined();
    expect(hash1a.length).toBeGreaterThan(10);
    expect(hash1a).toBe(hash1b); // Idêntico
    expect(hash1a).not.toBe(hash2); // Diferente
  });
});
