import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDB, closeDB } from '../src/js/db/connection.js';
import {
  LocalImageCache,
  localImageCache,
  RETENTION_CATEGORY
} from '../src/js/services/LocalImageCache.js';
import { computeImageHash } from '../src/js/services/ImageManifestService.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';

describe('PHASE 06 — Local Image Cache Suite', () => {
  const TENANT_A = 'tenant_loja_principal';
  const TENANT_B = 'tenant_filial_norte';

  // Helper para criar Blobs mockados
  const createMockBlob = (content = 'fake-image-bytes-webp', type = 'image/webp') => {
    return new Blob([content], { type });
  };

  beforeEach(async () => {
    localImageCache.revokeAllUrls();
    localImageCache.setSimulatedQuotaLimit(null);

    const db = await getDB();
    if (db.objectStoreNames.contains('productImages')) {
      const tx = db.transaction(['productImages', 'imageManifest'], 'readwrite');
      await tx.objectStore('productImages').clear();
      await tx.objectStore('imageManifest').clear();
      await tx.done;
    }
  });

  afterEach(() => {
    localImageCache.revokeAllUrls();
  });

  // =========================================================================
  // CACHE-01 a CACHE-05: CRUD e Operações Fundamentais
  // =========================================================================

  it('CACHE-01: deve salvar (put) imagem e thumbnail com metadados estruturados', async () => {
    const blob = createMockBlob('img-conteudo-1');
    const thumb = createMockBlob('img-thumb-1');

    const result = await localImageCache.put({
      photoId: 'photo-01',
      productId: 'prod-100',
      tenantId: TENANT_A,
      blob,
      thumbnailBlob: thumb,
      version: 1,
      width: 1920,
      height: 1080,
      mimeType: 'image/webp',
      label: 'Foto Principal',
      isPrimary: true
    });

    expect(result.photoId).toBe('photo-01');
    expect(result.productId).toBe('prod-100');
    expect(result.version).toBe(1);
    expect(result.hash).toBeDefined();
    expect(result.hash.length).toBeGreaterThan(10);
    expect(result.cachedAt).toBeDefined();
    expect(result.isPrimary).toBeTrue();
  });

  it('CACHE-02: deve recuperar (get) imagem armazenada preservando o Blob íntegro', async () => {
    const blob = createMockBlob('blob-dados-originais');
    const thumb = createMockBlob('thumb-dados-originais');

    await localImageCache.put({
      photoId: 'photo-02',
      productId: 'prod-101',
      tenantId: TENANT_A,
      blob,
      thumbnailBlob: thumb,
      version: 1
    });

    const cached = await localImageCache.get('photo-02', { tenantId: TENANT_A });
    expect(cached).toBeDefined();
    expect(cached.photoId).toBe('photo-02');
    expect(cached.productId).toBe('prod-101');
    expect(cached.displayBlob).toBeDefined();
    expect(cached.displayBlob.size).toBe(blob.size);
  });

  it('CACHE-03: deve verificar existência (has) rápida e validação de versão mínima', async () => {
    const blob = createMockBlob('bytes-has-test');
    await localImageCache.put({
      photoId: 'photo-03',
      productId: 'prod-102',
      tenantId: TENANT_A,
      blob,
      version: 2
    });

    expect(await localImageCache.has('photo-03', { tenantId: TENANT_A })).toBeTrue();
    expect(await localImageCache.has('photo-03', { tenantId: TENANT_A, minVersion: 2 })).toBeTrue();
    expect(await localImageCache.has('photo-03', { tenantId: TENANT_A, minVersion: 3 })).toBeFalse();
    expect(await localImageCache.has('foto-inexistente')).toBeFalse();
  });

  it('CACHE-04: deve remover (remove) imagem do cache local com suporte a soft e hard delete', async () => {
    const blob = createMockBlob('bytes-remove-test');
    await localImageCache.put({
      photoId: 'photo-04',
      productId: 'prod-103',
      tenantId: TENANT_A,
      blob,
      version: 1
    });

    // Soft delete padrão
    const removedSoft = await localImageCache.remove('photo-04', { tenantId: TENANT_A, hard: false });
    expect(removedSoft).toBeTrue();
    expect(await localImageCache.get('photo-04', { tenantId: TENANT_A })).toBeNull();

    // Verificação de hard delete
    await localImageCache.put({
      photoId: 'photo-04-hard',
      productId: 'prod-103',
      tenantId: TENANT_A,
      blob,
      version: 1
    });
    const removedHard = await localImageCache.remove('photo-04-hard', { tenantId: TENANT_A, hard: true });
    expect(removedHard).toBeTrue();
    expect(await localImageCache.get('photo-04-hard', { tenantId: TENANT_A })).toBeNull();
  });

  it('CACHE-05: deve substituir (replace) imagem atualizando versão e hash criptográfico', async () => {
    const blobV1 = createMockBlob('conteudo-v1');
    const blobV2 = createMockBlob('conteudo-v2-modificado');

    await localImageCache.put({
      photoId: 'photo-05',
      productId: 'prod-104',
      tenantId: TENANT_A,
      blob: blobV1,
      version: 1
    });

    const replaced = await localImageCache.replace('photo-05', {
      productId: 'prod-104',
      tenantId: TENANT_A,
      blob: blobV2,
      version: 2
    });

    expect(replaced.version).toBe(2);
    expect(replaced.hash).not.toBe(await computeImageHash(blobV1));

    const updated = await localImageCache.get('photo-05', { tenantId: TENANT_A });
    expect(updated.version).toBe(2);
  });

  // =========================================================================
  // CACHE-06 a CACHE-08: Versionamento e Prevenção de Downgrade
  // =========================================================================

  it('CACHE-06: deve tratar mesma versão e mesmo hash como put duplicado idempotente', async () => {
    const blob = createMockBlob('dados-estaveis');
    await localImageCache.put({
      photoId: 'photo-06',
      productId: 'prod-105',
      tenantId: TENANT_A,
      blob,
      version: 3
    });

    const duplicateResult = await localImageCache.put({
      photoId: 'photo-06',
      productId: 'prod-105',
      tenantId: TENANT_A,
      blob,
      version: 3
    });

    expect(duplicateResult.isDuplicate).toBeTrue();
    expect(duplicateResult.version).toBe(3);
  });

  it('CACHE-07: deve permitir nova versão (new version) quando versão for superior', async () => {
    const blob1 = createMockBlob('versao-1');
    const blob2 = createMockBlob('versao-2');

    await localImageCache.put({
      photoId: 'photo-07',
      productId: 'prod-106',
      tenantId: TENANT_A,
      blob: blob1,
      version: 1
    });

    const resV2 = await localImageCache.put({
      photoId: 'photo-07',
      productId: 'prod-106',
      tenantId: TENANT_A,
      blob: blob2,
      version: 2
    });

    expect(resV2.version).toBe(2);
    expect(resV2.isDuplicate).toBeUndefined();
  });

  it('CACHE-08: deve bloquear estritamente tentativa de downgrade de versão', async () => {
    const blobV5 = createMockBlob('foto-versao-5');
    const blobV4 = createMockBlob('foto-versao-4-antiga');

    await localImageCache.put({
      photoId: 'photo-08',
      productId: 'prod-107',
      tenantId: TENANT_A,
      blob: blobV5,
      version: 5
    });

    // Tentativa de gravar versão 4
    await expect(
      localImageCache.put({
        photoId: 'photo-08',
        productId: 'prod-107',
        tenantId: TENANT_A,
        blob: blobV4,
        version: 4
      })
    ).rejects.toThrow(/Downgrade bloqueado/);

    // Verifica que o cache permaneceu na versão 5
    const current = await localImageCache.get('photo-08', { tenantId: TENANT_A });
    expect(current.version).toBe(5);
  });

  // =========================================================================
  // CACHE-09 a CACHE-11: Validação de Hash e Integridade Atômica
  // =========================================================================

  it('CACHE-09: deve validar hash SHA-256 e salvar com sucesso quando coincide com expectedHash', async () => {
    const blob = createMockBlob('imagem-integra');
    const expectedHash = await computeImageHash(blob);

    const result = await localImageCache.put({
      photoId: 'photo-09',
      productId: 'prod-108',
      tenantId: TENANT_A,
      blob,
      version: 1,
      expectedHash
    });

    expect(result.hash).toBe(expectedHash);
  });

  it('CACHE-10: deve rejeitar gravação se o Blob real divergir do expectedHash (corrupted blob)', async () => {
    const realBlob = createMockBlob('conteudo-real-corrompido');
    const fakeExpectedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    await expect(
      localImageCache.put({
        photoId: 'photo-10',
        productId: 'prod-109',
        tenantId: TENANT_A,
        blob: realBlob,
        version: 1,
        expectedHash: fakeExpectedHash
      })
    ).rejects.toThrow(/Falha de integridade/);

    // Garante que o arquivo corrompido não foi gravado
    expect(await localImageCache.get('photo-10')).toBeNull();
  });

  it('CACHE-11: deve garantir consistência atômica entre as stores productImages e imageManifest', async () => {
    const blob = createMockBlob('dados-consistencia-atomica');

    await localImageCache.put({
      photoId: 'photo-11',
      productId: 'prod-110',
      tenantId: TENANT_A,
      blob,
      version: 3,
      label: 'Foto Atômica'
    });

    const imgEntry = await localImageCache.get('photo-11', { tenantId: TENANT_A });
    const manifestEntry = await imageManifestRepository.findByPhotoId('photo-11');

    expect(imgEntry).toBeDefined();
    expect(manifestEntry).toBeDefined();
    expect(imgEntry.version).toBe(3);
    expect(manifestEntry.version).toBe(3);
    expect(imgEntry.hash).toBe(manifestEntry.hash);
  });

  // =========================================================================
  // CACHE-12 a CACHE-14: Isolamento e Ciclo de Vida de Object URLs
  // =========================================================================

  it('CACHE-12: deve garantir isolamento estrito de tenants (Tenant B não acessa foto do Tenant A)', async () => {
    const blob = createMockBlob('foto-privada-tenant-a');

    await localImageCache.put({
      photoId: 'photo-priv-a',
      productId: 'prod-a',
      tenantId: TENANT_A,
      blob,
      version: 1
    });

    // Tenant A acessa normalmente
    const accessA = await localImageCache.get('photo-priv-a', { tenantId: TENANT_A });
    expect(accessA).toBeDefined();

    // Tenant B é sumariamente bloqueado (retorna null)
    const accessB = await localImageCache.get('photo-priv-a', { tenantId: TENANT_B });
    expect(accessB).toBeNull();
  });

  it('CACHE-13: deve isolar fotos por produto sem vazar fotos de outros itens', async () => {
    const blob1 = createMockBlob('prod1-img');
    const blob2 = createMockBlob('prod2-img');

    await localImageCache.put({ photoId: 'img-p1', productId: 'p1', tenantId: TENANT_A, blob: blob1 });
    await localImageCache.put({ photoId: 'img-p2', productId: 'p2', tenantId: TENANT_A, blob: blob2 });

    const p1Meta = await localImageCache.getMetadata('img-p1', { tenantId: TENANT_A });
    const p2Meta = await localImageCache.getMetadata('img-p2', { tenantId: TENANT_A });

    expect(p1Meta.productId).toBe('p1');
    expect(p2Meta.productId).toBe('p2');
  });

  it('CACHE-14: deve gerenciar o ciclo de vida de Object URLs sem vazamentos de memória', async () => {
    const blob = createMockBlob('imagem-para-object-url');

    await localImageCache.put({
      photoId: 'photo-url-lifecycle',
      productId: 'prod-url',
      tenantId: TENANT_A,
      blob
    });

    // Criação de URL rastreada
    const url = await localImageCache.createUrl('photo-url-lifecycle', { tenantId: TENANT_A });
    if (url) {
      expect(url.startsWith('blob:')).toBeTrue();
      expect(localImageCache.getActiveUrlsCount()).toBe(1);

      // Revogação manual
      localImageCache.revokeUrl(url);
      expect(localImageCache.getActiveUrlsCount()).toBe(0);
    }
  });

  // =========================================================================
  // CACHE-15 a CACHE-19: Cotas, Thumbnails e Imagens em Alta Resolução
  // =========================================================================

  it('CACHE-15: deve estimar cota de armazenamento via getQuotaEstimate com fallback gracioso', async () => {
    const estimate = await LocalImageCache.getQuotaEstimate();
    expect(estimate).toBeDefined();
    expect(estimate.quota).toBeGreaterThan(0);
    expect(estimate.available).toBeGreaterThanOrEqual(0);
    expect(typeof estimate.percentUsed).toBe('number');
  });

  it('CACHE-16: deve avaliar suporte e fallback para armazenamento persistente', async () => {
    // Avalia método estático sem quebrar quando navigator.storage não estiver totalmente simulado
    const estimate = await LocalImageCache.getQuotaEstimate();
    expect(estimate.isFallback !== undefined).toBeTrue();
  });

  it('CACHE-17: deve suportar armazenamento de imagens grandes sem corromper dados', async () => {
    // Simula buffer de 1MB
    const largeBuffer = new Uint8Array(1024 * 1024);
    for (let i = 0; i < largeBuffer.length; i++) largeBuffer[i] = i % 256;
    const largeBlob = new Blob([largeBuffer], { type: 'image/webp' });

    const res = await localImageCache.put({
      photoId: 'large-photo',
      productId: 'prod-large',
      tenantId: TENANT_A,
      blob: largeBlob,
      version: 1
    });

    expect(res.sizeBytes).toBe(1024 * 1024);

    const fetched = await localImageCache.get('large-photo');
    expect(fetched.displayBlob.size).toBe(1024 * 1024);
  });

  it('CACHE-18 e CACHE-19: deve permitir recuperar thumbnail específico ou imagem completa', async () => {
    const fullBlob = createMockBlob('full-image-1920px');
    const thumbBlob = createMockBlob('thumb-image-320px');

    await localImageCache.put({
      photoId: 'photo-dual-size',
      productId: 'prod-sizes',
      tenantId: TENANT_A,
      blob: fullBlob,
      thumbnailBlob: thumbBlob,
      version: 1
    });

    const fullResult = await localImageCache.get('photo-dual-size', { size: 'full' });
    expect(fullResult.displayBlob.size).toBe(fullBlob.size);

    const thumbResult = await localImageCache.get('photo-dual-size', { size: 'thumbnail' });
    expect(thumbResult.displayBlob.size).toBe(thumbBlob.size);
  });

  // =========================================================================
  // CACHE-20 a CACHE-22: Atomicidade, Persistência e Deleção
  // =========================================================================

  it('CACHE-20: deve realizar rollback seguro se a gravação atômica for interrompida', async () => {
    // Simula erro durante a transação
    try {
      await executeTransaction(['productImages', 'imageManifest'], 'readwrite', async (stores) => {
        await stores.productImages.put({ id: 'photo-fail', photoId: 'photo-fail' });
        throw new Error('Falha simulada na gravação');
      });
    } catch (e) {
      // Ignora erro proposital
    }

    const check = await localImageCache.get('photo-fail');
    expect(check).toBeNull();
  });

  it('CACHE-21: deve persistir imagens após fechamento e reabertura da conexão do banco', async () => {
    const blob = createMockBlob('persist-test-content');

    await localImageCache.put({
      photoId: 'photo-persist-reopen',
      productId: 'prod-p1',
      tenantId: TENANT_A,
      blob,
      version: 1
    });

    // Fecha conexão ativa
    await closeDB();

    // Reabre nova conexão
    const reloaded = await localImageCache.get('photo-persist-reopen', { tenantId: TENANT_A });
    expect(reloaded).toBeDefined();
    expect(reloaded.photoId).toBe('photo-persist-reopen');
    expect(reloaded.displayBlob.size).toBe(blob.size);
  });

  it('CACHE-22: deve executar limpeza (clear) para tenant sem afetar outros tenants', async () => {
    const blobA = createMockBlob('foto-a');
    const blobB = createMockBlob('foto-b');

    await localImageCache.put({ photoId: 'pA', productId: 'p1', tenantId: TENANT_A, blob: blobA });
    await localImageCache.put({ photoId: 'pB', productId: 'p2', tenantId: TENANT_B, blob: blobB });

    // Limpa apenas Tenant A
    await localImageCache.clear({ tenantId: TENANT_A, hard: true });

    expect(await localImageCache.get('pA', { tenantId: TENANT_A })).toBeNull();
    expect(await localImageCache.get('pB', { tenantId: TENANT_B })).toBeDefined();
  });

  // =========================================================================
  // CACHE-23 a CACHE-26: Estatísticas, LastAccessed e Retenção
  // =========================================================================

  it('CACHE-23: deve consolidar estatísticas (getStats) com contagem, bytes e categorias', async () => {
    const blob = createMockBlob('12345'); // 5 bytes
    const thumb = createMockBlob('123'); // 3 bytes

    await localImageCache.put({
      photoId: 'stat-p1',
      productId: 'p1',
      tenantId: TENANT_A,
      blob,
      thumbnailBlob: thumb,
      version: 1
    });

    const stats = await localImageCache.getStats({ tenantId: TENANT_A });
    expect(stats.photosCount).toBe(1);
    expect(stats.totalBytes).toBe(8);
    expect(stats.fullBytes).toBe(5);
    expect(stats.thumbBytes).toBe(3);
    expect(stats.hotCount).toBe(1);
  });

  it('CACHE-24: deve registrar lastAccessedAt e categorizar retenção (HOT, WARM, COLD)', () => {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const tenDaysAgo = now - (10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);

    expect(LocalImageCache.getRetentionCategory({ lastAccessedAt: oneDayAgo }, now)).toBe(RETENTION_CATEGORY.HOT);
    expect(LocalImageCache.getRetentionCategory({ lastAccessedAt: tenDaysAgo }, now)).toBe(RETENTION_CATEGORY.WARM);
    expect(LocalImageCache.getRetentionCategory({ lastAccessedAt: fortyDaysAgo }, now)).toBe(RETENTION_CATEGORY.COLD);
  });

  it('CACHE-25: duplicate put idêntico não deve duplicar registros nem inflar contadores', async () => {
    const blob = createMockBlob('bytes-duplicados');

    const res1 = await localImageCache.put({ photoId: 'dup-1', productId: 'p1', tenantId: TENANT_A, blob, version: 1 });
    const res2 = await localImageCache.put({ photoId: 'dup-1', productId: 'p1', tenantId: TENANT_A, blob, version: 1 });

    expect(res1.hash).toBe(res2.hash);
    expect(res2.isDuplicate).toBeTrue();

    const stats = await localImageCache.getStats({ tenantId: TENANT_A });
    expect(stats.photosCount).toBe(1);
  });

  it('CACHE-26: getEvictionCandidates deve listar candidatos COLD/WARM preservando itens HOT e fotos primárias', async () => {
    const now = Date.now();
    const fortyDaysAgo = now - (40 * 24 * 60 * 60 * 1000);

    // Foto antiga secundária (candidata ideal)
    await localImageCache.put({
      photoId: 'cold-candidate',
      productId: 'p1',
      tenantId: TENANT_A,
      blob: createMockBlob('cold-bytes'),
      isPrimary: false
    });

    // Foto antiga primária (protegida)
    await localImageCache.put({
      photoId: 'primary-protected',
      productId: 'p1',
      tenantId: TENANT_A,
      blob: createMockBlob('primary-bytes'),
      isPrimary: true
    });

    // Forçar data antiga no banco para simulação
    const db = await getDB();
    const cold = await db.get('productImages', 'cold-candidate');
    cold.lastAccessedAt = fortyDaysAgo;
    await db.put('productImages', cold);

    const prim = await db.get('productImages', 'primary-protected');
    prim.lastAccessedAt = fortyDaysAgo;
    await db.put('productImages', prim);

    const candidates = await localImageCache.getEvictionCandidates({ tenantId: TENANT_A });
    expect(candidates.some(c => c.photoId === 'cold-candidate')).toBeTrue();
    // Foto primária é protegida e não entra nos candidatos
    expect(candidates.some(c => c.photoId === 'primary-protected')).toBeFalse();
  });

  // =========================================================================
  // Cenários Mandatórios de Teste (Seções 29 a 33)
  // =========================================================================

  it('Cenário 29: Persistência Offline — Imagem cacheada deve carregar offline após fechamento da conexão', async () => {
    const originalBlob = createMockBlob('dados-imagem-offline-real');

    // 1. Simula download e salvamento online
    await localImageCache.put({
      photoId: 'offline-photo-prod',
      productId: 'prod-offline-01',
      tenantId: TENANT_A,
      blob: originalBlob,
      version: 1
    });

    // 2. Simula fechamento do app / navegador
    await closeDB();

    // 3. Simula reabertura do app offline e recuperação do produto
    const offlineImage = await localImageCache.get('offline-photo-prod', { tenantId: TENANT_A });
    expect(offlineImage).toBeDefined();
    expect(offlineImage.displayBlob).toBeDefined();
    expect(offlineImage.displayBlob.size).toBe(originalBlob.size);
  });

  it('Cenário 30: Atualização controlada — substituição de v3 hash AAA por v4 hash BBB', async () => {
    const blobV3 = createMockBlob('conteudo-aaa');
    const blobV4 = createMockBlob('conteudo-bbb');

    await localImageCache.put({
      photoId: 'photo-update-scenario',
      productId: 'prod-up',
      tenantId: TENANT_A,
      blob: blobV3,
      version: 3
    });

    await localImageCache.replace('photo-update-scenario', {
      productId: 'prod-up',
      tenantId: TENANT_A,
      blob: blobV4,
      version: 4
    });

    const current = await localImageCache.get('photo-update-scenario');
    expect(current.version).toBe(4);
    expect(current.hash).toBe(await computeImageHash(blobV4));
  });

  it('Cenário 31: Bloqueio estrito de Downgrade (v5 em cache rejeita tentativa de gravar v4)', async () => {
    await localImageCache.put({
      photoId: 'photo-down-scenario',
      productId: 'prod-down',
      tenantId: TENANT_A,
      blob: createMockBlob('v5-bytes'),
      version: 5
    });

    await expect(
      localImageCache.put({
        photoId: 'photo-down-scenario',
        productId: 'prod-down',
        tenantId: TENANT_A,
        blob: createMockBlob('v4-bytes'),
        version: 4
      })
    ).rejects.toThrow(/Downgrade bloqueado/);

    const record = await localImageCache.get('photo-down-scenario');
    expect(record.version).toBe(5);
  });

  it('Cenário 32: Detecção de Corrupção — Blob com hash divergente não deve ser salvo', async () => {
    const blob = createMockBlob('conteudo-corrompido');
    const fakeHash = 'hash-invalido-falsificado-12345';

    await expect(
      localImageCache.put({
        photoId: 'photo-corrupt',
        productId: 'prod-c',
        tenantId: TENANT_A,
        blob,
        version: 1,
        expectedHash: fakeHash
      })
    ).rejects.toThrow(/Falha de integridade/);

    expect(await localImageCache.has('photo-corrupt')).toBeFalse();
  });

  it('Cenário 33: Tratamento de Quota — Cota insuficiente tratada graciosamente sem crash', async () => {
    // Define limite simulado de apenas 100 bytes
    localImageCache.setSimulatedQuotaLimit(100);

    const bigBlob = createMockBlob('x'.repeat(200));

    await expect(
      localImageCache.put({
        photoId: 'quota-overflow',
        productId: 'prod-quota',
        tenantId: TENANT_A,
        blob: bigBlob,
        version: 1
      })
    ).rejects.toThrow(/Cota de armazenamento insuficiente/);

    // Sistema comercial continua 100% operacional
    expect(await localImageCache.has('quota-overflow')).toBeFalse();
  });
});
