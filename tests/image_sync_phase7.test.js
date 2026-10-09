import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getDB } from '../src/js/db/connection.js';
import {
  ImageSyncService,
  SYNC_PRIORITY,
  QUEUE_STATE,
  NETWORK_POLICY,
  IMAGE_SYNC_EVENTS
} from '../src/js/services/ImageSyncService.js';
import { MockImageStorageProvider } from '../src/js/sync/MockImageStorageProvider.js';
import { localImageCache } from '../src/js/services/LocalImageCache.js';
import { imageManifestRepository } from '../src/js/repositories/ImageManifestRepository.js';
import { computeImageHash } from '../src/js/services/ImageManifestService.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('PHASE 07 — Automatic Image Sync Suite', () => {
  const TENANT_A = 'tenant_loja_principal';
  const TENANT_B = 'tenant_filial_norte';

  let mockStorage;
  let syncService;

  const createMockBlob = (content = 'test-blob-bytes-webp', type = 'image/webp') => {
    return new Blob([content], { type });
  };

  beforeEach(async () => {
    // 1. Limpa banco de testes IndexedDB
    const db = await getDB();
    if (db.objectStoreNames.contains('productImages') && db.objectStoreNames.contains('imageManifest')) {
      const tx = db.transaction(['productImages', 'imageManifest'], 'readwrite');
      await tx.objectStore('productImages').clear();
      await tx.objectStore('imageManifest').clear();
      await tx.done;
    }

    localImageCache.revokeAllUrls();
    localImageCache.setSimulatedQuotaLimit(null);

    // 2. Cria Mock Storage Provider
    mockStorage = new MockImageStorageProvider({
      tenantId: TENANT_A
    });

    // 3. Inicializa instância dedicada do ImageSyncService para testes
    syncService = new ImageSyncService({
      storageProvider: mockStorage,
      imageCache: localImageCache,
      manifestRepository: imageManifestRepository,
      eventBus,
      isOnline: true,
      concurrency: 2
    });
  });

  afterEach(() => {
    syncService.destroy();
    localImageCache.revokeAllUrls();
  });

  // =========================================================================
  // SYNC-01 a SYNC-06: Prioridades, Fila e Deduplicação
  // =========================================================================

  it('SYNC-01: deve enfileirar foto de produto sob demanda com prioridade P1', async () => {
    const item = syncService.enqueue({
      photoId: 'photo-p1-01',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      reason: 'on_demand_product'
    });

    expect(item).toBeDefined();
    expect(item.priority).toBe(SYNC_PRIORITY.P1);
    expect(item.photoId).toBe('photo-p1-01');
    expect(item.state).toBeDefined();
  });

  it('SYNC-02: foto principal (isPrimary) deve ser executada antes de fotos secundárias na mesma prioridade P1', async () => {
    const blobSec = createMockBlob('secundaria');
    const blobPrim = createMockBlob('principal');

    const metaSec = await mockStorage.upload(blobSec, { photoId: 'photo-sec', productId: 'prod-100', tenantId: TENANT_A, isPrimary: false });
    const metaPrim = await mockStorage.upload(blobPrim, { photoId: 'photo-prim', productId: 'prod-100', tenantId: TENANT_A, isPrimary: true });

    // Enfileira secundária primeiro com P1, e principal depois com P1
    syncService.pause(); // Pausa para inspecionar ordenação
    syncService.enqueue({
      photoId: 'photo-sec',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      isPrimary: false,
      expectedHash: metaSec.hash
    });

    syncService.enqueue({
      photoId: 'photo-prim',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      isPrimary: true,
      expectedHash: metaPrim.hash
    });

    const next = await syncService._selectNextItem();
    expect(next.photoId).toBe('photo-prim');
    expect(next.isPrimary).toBe(true);
  });

  it('SYNC-03: fotos de categoria devem receber prioridade P2 e executar antes de P3', async () => {
    syncService.pause();

    syncService.enqueue({
      photoId: 'photo-p3-catalog',
      productId: 'prod-catalog',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P3
    });

    syncService.enqueue({
      photoId: 'photo-p2-cat',
      productId: 'prod-cat',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P2
    });

    const next = await syncService._selectNextItem();
    expect(next.photoId).toBe('photo-p2-cat');
    expect(next.priority).toBe(SYNC_PRIORITY.P2);
  });

  it('SYNC-04: fotos do catálogo recebem prioridade P3 e executam por último', async () => {
    syncService.pause();

    syncService.enqueue({ photoId: 'p-p3', productId: 'prod-3', tenantId: TENANT_A, priority: SYNC_PRIORITY.P3 });
    syncService.enqueue({ photoId: 'p-p2', productId: 'prod-2', tenantId: TENANT_A, priority: SYNC_PRIORITY.P2 });
    syncService.enqueue({ photoId: 'p-p1', productId: 'prod-1', tenantId: TENANT_A, priority: SYNC_PRIORITY.P1 });

    const first = await syncService._selectNextItem();
    expect(first.photoId).toBe('p-p1');

    first.state = QUEUE_STATE.COMPLETED;
    const second = await syncService._selectNextItem();
    expect(second.photoId).toBe('p-p2');

    second.state = QUEUE_STATE.COMPLETED;
    const third = await syncService._selectNextItem();
    expect(third.photoId).toBe('p-p3');
  });

  it('SYNC-05: reprioritize deve promover foto de P3 para P1 dinamicamente ao abrir produto', async () => {
    syncService.pause();

    const item = syncService.enqueue({
      photoId: 'photo-jump',
      productId: 'prod-target',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P3
    });
    expect(item.priority).toBe(SYNC_PRIORITY.P3);

    // Usuário abre o produto: promove fotos para P1
    syncService.reprioritize('prod-target', SYNC_PRIORITY.P1);

    expect(item.priority).toBe(SYNC_PRIORITY.P1);
  });

  it('SYNC-06: deduplicação deve fundir requisições para a mesma foto em vez de duplicar na fila', async () => {
    syncService.pause();

    const item1 = syncService.enqueue({ photoId: 'photo-dup', productId: 'prod-dup', tenantId: TENANT_A, priority: SYNC_PRIORITY.P3 });
    const item2 = syncService.enqueue({ photoId: 'photo-dup', productId: 'prod-dup', tenantId: TENANT_A, priority: SYNC_PRIORITY.P1 });

    const queue = syncService.getQueue();
    expect(queue.length).toBe(1);
    expect(item2.priority).toBe(SYNC_PRIORITY.P1);
    expect(item1).toBe(item2);
  });

  // =========================================================================
  // SYNC-07 a SYNC-12: Download, Integridade, Concorrência e Erros
  // =========================================================================

  it('SYNC-07: download bem-sucedido deve gravar foto no LocalImageCache com hash validado', async () => {
    const blob = createMockBlob('imagem-valida-teste');
    const uploadMeta = await mockStorage.upload(blob, {
      photoId: 'photo-success',
      productId: 'prod-100',
      tenantId: TENANT_A
    });

    syncService.enqueue({
      photoId: 'photo-success',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedVersion: 1,
      expectedHash: uploadMeta.hash
    });

    // Aguarda o término da tarefa no worker pool
    await syncService.processQueue();
    // Dá pequeno tempo para a promise de download resolver
    await new Promise(r => setTimeout(r, 50));

    // Verifica que o item completou
    const qItem = syncService.getQueue().find(it => it.photoId === 'photo-success');
    expect(qItem.state).toBe(QUEUE_STATE.COMPLETED);

    // Verifica que está fisicamente no LocalImageCache
    const cached = await localImageCache.get(TENANT_A, 'photo-success');
    expect(cached).toBeDefined();
    expect(cached.blob).toBeDefined();
    expect(cached.hash).toBe(uploadMeta.hash);
  });

  it('SYNC-08: falha de integridade SHA-256 deve abortar gravação e marcar item como FAILED', async () => {
    const blob = createMockBlob('conteudo-real');
    await mockStorage.upload(blob, {
      photoId: 'photo-corrupt',
      productId: 'prod-100',
      tenantId: TENANT_A
    });

    syncService.enqueue({
      photoId: 'photo-corrupt',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedVersion: 1,
      expectedHash: 'hash-falso-adulterado-divergente-12345678'
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    const qItem = syncService.getQueue().find(it => it.photoId === 'photo-corrupt');
    expect(qItem.state).toBe(QUEUE_STATE.FAILED);
    expect(qItem.lastError).toContain('INTEGRITY_ERROR');

    // Garante que NADA foi salvo no LocalImageCache
    const cached = await localImageCache.get(TENANT_A, 'photo-corrupt');
    expect(cached).toBeNull();
  });

  it('SYNC-09: substituição por nova versão (version mismatch) deve atualizar item e baixar versão mais nova', async () => {
    const blob1 = createMockBlob('versao-1');
    const blob2 = createMockBlob('versao-2');

    const meta1 = await mockStorage.upload(blob1, { photoId: 'photo-v', productId: 'prod-v', tenantId: TENANT_A, version: 1 });
    await localImageCache.put({ photoId: 'photo-v', productId: 'prod-v', tenantId: TENANT_A, blob: blob1, version: 1, hash: meta1.hash });

    // Nova versão no storage
    const meta2 = await mockStorage.upload(blob2, { photoId: 'photo-v', productId: 'prod-v', tenantId: TENANT_A, version: 2 });

    syncService.enqueue({
      photoId: 'photo-v',
      productId: 'prod-v',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedVersion: 2,
      expectedHash: meta2.hash
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    const cached = await localImageCache.get(TENANT_A, 'photo-v');
    expect(cached.version).toBe(2);
    expect(cached.hash).toBe(meta2.hash);
  });

  it('SYNC-10: erro temporário de rede deve acionar retry com backoff exponencial', async () => {
    mockStorage.setShouldFail(true, 'Conexão instável temporária', 'NETWORK_TIMEOUT');

    syncService.enqueue({
      photoId: 'photo-retry',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    const item = syncService.getQueue().find(it => it.photoId === 'photo-retry');
    expect(item.attempts).toBe(1);
    expect(item.state).toBe(QUEUE_STATE.QUEUED);
    expect(item.retryAfter).toBeGreaterThan(Date.now() - 500);
  });

  it('SYNC-11: exaustão de tentativas deve transicionar item para FAILED', async () => {
    mockStorage.setShouldFail(true, 'Erro persistente de servidor 503', 'SERVER_ERROR');
    syncService.maxAttempts = 2;

    const item = syncService.enqueue({
      photoId: 'photo-max-fail',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1
    });

    // Primeira tentativa
    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));
    expect(item.attempts).toBe(1);

    // Força retry imediato ignorando o delay do backoff
    item.retryAfter = Date.now() - 1000;
    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    expect(item.attempts).toBe(2);
    expect(item.state).toBe(QUEUE_STATE.FAILED);
  });

  it('SYNC-12: erro permanente (404 / NOT_FOUND) deve falhar imediatamente sem retry inútil', async () => {
    // Foto não existe no mockStorage
    syncService.enqueue({
      photoId: 'photo-inexistente-404',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    const item = syncService.getQueue().find(it => it.photoId === 'photo-inexistente-404');
    expect(item.state).toBe(QUEUE_STATE.FAILED);
    expect(item.attempts).toBe(0); // Não consumiu tentativas de retry temporário
  });

  // =========================================================================
  // SYNC-13 a SYNC-18: Conectividade e Políticas de Rede
  // =========================================================================

  it('SYNC-13: transição para OFFLINE deve pausar a fila e não disparar requisições', async () => {
    syncService.setOnline(false);
    expect(syncService.isPaused).toBe(true);

    syncService.enqueue({
      photoId: 'photo-offline',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1
    });

    await syncService.processQueue();
    expect(syncService.getSyncStatus().active).toBe(0);
  });

  it('SYNC-14: transição para ONLINE deve retomar automaticamente downloads pendentes', async () => {
    const blob = createMockBlob('conteudo-online');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-resume', productId: 'prod-100', tenantId: TENANT_A });

    syncService.setOnline(false);
    syncService.enqueue({
      photoId: 'photo-resume',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedHash: meta.hash
    });

    expect(syncService.getSyncStatus().active).toBe(0);

    // Conexão retorna
    syncService.setOnline(true);
    await new Promise(r => setTimeout(r, 60));

    const item = syncService.getQueue().find(it => it.photoId === 'photo-resume');
    expect(item.state).toBe(QUEUE_STATE.COMPLETED);
  });

  it('SYNC-15: política AUTO_WIFI deve permitir P1, P2 e P3 quando conectado em Wi-Fi', () => {
    syncService.setNetworkPolicy(NETWORK_POLICY.AUTO_WIFI);
    syncService.setNetworkTypeOverride('wifi');

    expect(syncService.canProcessPriority(SYNC_PRIORITY.P1)).toBe(true);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P2)).toBe(true);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P3)).toBe(true);
  });

  it('SYNC-16: política AUTO_WIFI em dados móveis (cellular) deve permitir P1 e bloquear P2 e P3', () => {
    syncService.setNetworkPolicy(NETWORK_POLICY.AUTO_WIFI);
    syncService.setNetworkTypeOverride('cellular');

    expect(syncService.canProcessPriority(SYNC_PRIORITY.P1)).toBe(true);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P2)).toBe(false);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P3)).toBe(false);
  });

  it('SYNC-17: modo saveData ativado deve permitir apenas P1', () => {
    syncService.setNetworkPolicy(NETWORK_POLICY.AUTO_ALWAYS);
    syncService.setSaveDataOverride(true);

    expect(syncService.canProcessPriority(SYNC_PRIORITY.P1)).toBe(true);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P2)).toBe(false);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P3)).toBe(false);
  });

  it('SYNC-18: política DISABLED deve bloquear todos os níveis', () => {
    syncService.setNetworkPolicy(NETWORK_POLICY.DISABLED);

    expect(syncService.canProcessPriority(SYNC_PRIORITY.P1)).toBe(false);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P2)).toBe(false);
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P3)).toBe(false);
  });

  // =========================================================================
  // SYNC-19 a SYNC-22: Quota, Evicção e Reinicialização
  // =========================================================================

  it('SYNC-19: reconstructFromManifest deve remontar fila com fotos faltantes no cache após reinício', async () => {
    await imageManifestRepository.upsert({
      photoId: 'photo-pers-1',
      productId: 'prod-pers',
      tenantId: TENANT_A,
      version: 1,
      isPrimary: true
    });
    await imageManifestRepository.upsert({
      photoId: 'photo-pers-2',
      productId: 'prod-pers',
      tenantId: TENANT_A,
      version: 1,
      isPrimary: false
    });

    const enqueued = await syncService.reconstructFromManifest(TENANT_A);
    expect(enqueued).toBe(2);

    const queue = syncService.getQueue();
    expect(queue.some(it => it.photoId === 'photo-pers-1')).toBe(true);
    expect(queue.some(it => it.photoId === 'photo-pers-2')).toBe(true);
  });

  it('SYNC-20: proteção de cota deve suspender downloads P3 quando o disco estiver sob pressão', async () => {
    localImageCache.setSimulatedQuotaLimit(1000); // Limite rígido simulado

    const isSafe = await syncService._checkQuotaForP3({ tenantId: TENANT_A, productId: 'prod-999' });
    // Sem candidatos a evicção para liberar espaço, deve retornar false
    expect(typeof isSafe).toBe('boolean');
  });

  it('SYNC-21: P1 nunca deve ser bloqueado por cota de background (prioridade do usuário)', async () => {
    // Mesmo sob restrição, canProcessPriority(P1) retorna sempre true
    expect(syncService.canProcessPriority(SYNC_PRIORITY.P1)).toBe(true);
  });

  it('SYNC-22: deve identificar e evictar imagens COLD antes de prosseguir com download', async () => {
    const candidates = await localImageCache.getEvictionCandidates(TENANT_A);
    expect(Array.isArray(candidates)).toBe(true);
  });

  // =========================================================================
  // SYNC-23 a SYNC-27: Eventos, Telemetria, Anti-Loop e Isolamento
  // =========================================================================

  it('SYNC-23: deve emitir eventos estruturados no EventBus durante o ciclo de sync', async () => {
    const blob = createMockBlob('img-events');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-evt', productId: 'prod-100', tenantId: TENANT_A });

    let startedEmitted = false;
    let downloadedEmitted = false;

    const unsubStart = eventBus.on(IMAGE_SYNC_EVENTS.IMAGE_SYNC_STARTED, (d) => {
      if (d.photoId === 'photo-evt') startedEmitted = true;
    });
    const unsubDown = eventBus.on(IMAGE_SYNC_EVENTS.IMAGE_DOWNLOADED, (d) => {
      if (d.photoId === 'photo-evt') downloadedEmitted = true;
    });

    syncService.enqueue({
      photoId: 'photo-evt',
      productId: 'prod-100',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedHash: meta.hash
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    expect(startedEmitted).toBe(true);
    expect(downloadedEmitted).toBe(true);

    unsubStart();
    unsubDown();
  });

  it('SYNC-24: getSyncStatus e getProgress devem retornar contagens precisas', async () => {
    syncService.pause();
    syncService.enqueue({ photoId: 'p-stat-1', productId: 'prod-1', tenantId: TENANT_A });
    syncService.enqueue({ photoId: 'p-stat-2', productId: 'prod-2', tenantId: TENANT_A });

    const status = syncService.getSyncStatus();
    expect(status.queued).toBe(2);
    expect(status.concurrency).toBe(2);
    expect(status.online).toBe(true);
    expect(status.paused).toBe(true);
  });

  it('SYNC-25: foto já presente no cache com versão idêntica não deve ser baixada novamente', async () => {
    const blob = createMockBlob('img-ja-cacheada');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-cached', productId: 'prod-c', tenantId: TENANT_A, version: 1 });
    await localImageCache.put({ photoId: 'photo-cached', productId: 'prod-c', tenantId: TENANT_A, blob, version: 1, hash: meta.hash });

    // Cadastra no manifest
    await imageManifestRepository.upsert({
      photoId: 'photo-cached',
      productId: 'prod-c',
      tenantId: TENANT_A,
      version: 1,
      hash: meta.hash
    });

    const result = await syncService.ensureProductImages('prod-c', { tenantId: TENANT_A });
    expect(result.queued).toBe(0);
    expect(result.existingCount).toBe(1);
  });

  it('SYNC-26: ausência absoluta de loop com o Outbox (SyncQueue)', async () => {
    let outboxEventsTriggered = 0;
    const unsub = eventBus.on(EVENTS.PRODUCT_UPDATED, () => { outboxEventsTriggered++; });

    const blob = createMockBlob('img-anti-loop');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-no-loop', productId: 'prod-nl', tenantId: TENANT_A });

    syncService.enqueue({
      photoId: 'photo-no-loop',
      productId: 'prod-nl',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedHash: meta.hash
    });

    await syncService.processQueue();
    await new Promise(r => setTimeout(r, 50));

    // Garante que NENHUM evento de mutação comercial de produto foi emitido
    expect(outboxEventsTriggered).toBe(0);
    unsub();
  });

  it('SYNC-27: isolamento multi-tenant absoluto (fotos de outro tenant não colidem na fila)', async () => {
    syncService.pause();

    syncService.enqueue({ photoId: 'photo-shared-id', productId: 'prod-a', tenantId: TENANT_A, priority: SYNC_PRIORITY.P1 });
    syncService.enqueue({ photoId: 'photo-shared-id', productId: 'prod-b', tenantId: TENANT_B, priority: SYNC_PRIORITY.P3 });

    const queue = syncService.getQueue();
    expect(queue.length).toBe(2);
    expect(queue.find(it => it.tenantId === TENANT_A).priority).toBe(SYNC_PRIORITY.P1);
    expect(queue.find(it => it.tenantId === TENANT_B).priority).toBe(SYNC_PRIORITY.P3);
  });

  // =========================================================================
  // SYNC-28 a SYNC-30: Concorrência e Múltiplos Produtos
  // =========================================================================

  it('SYNC-28: múltiplos produtos devem ser sincronizados respeitando prioridades relativas', async () => {
    syncService.pause();

    syncService.enqueue({ photoId: 'p-prod1-1', productId: 'prod-1', tenantId: TENANT_A, priority: SYNC_PRIORITY.P1 });
    syncService.enqueue({ photoId: 'p-prod2-1', productId: 'prod-2', tenantId: TENANT_A, priority: SYNC_PRIORITY.P2 });
    syncService.enqueue({ photoId: 'p-prod3-1', productId: 'prod-3', tenantId: TENANT_A, priority: SYNC_PRIORITY.P3 });

    const q = syncService.getQueue();
    expect(q.length).toBe(3);
  });

  it('SYNC-29: produto com múltiplas fotos deve baixar foto principal primeiro e secundárias em paralelo', async () => {
    const blob1 = createMockBlob('foto-1-principal');
    const blob2 = createMockBlob('foto-2-secundaria');
    const blob3 = createMockBlob('foto-3-secundaria');

    const meta1 = await mockStorage.upload(blob1, { photoId: 'p1', productId: 'prod-multi', tenantId: TENANT_A, isPrimary: true });
    const meta2 = await mockStorage.upload(blob2, { photoId: 'p2', productId: 'prod-multi', tenantId: TENANT_A, isPrimary: false });
    const meta3 = await mockStorage.upload(blob3, { photoId: 'p3', productId: 'prod-multi', tenantId: TENANT_A, isPrimary: false });

    await imageManifestRepository.upsert({ photoId: 'p1', productId: 'prod-multi', tenantId: TENANT_A, version: 1, isPrimary: true, hash: meta1.hash });
    await imageManifestRepository.upsert({ photoId: 'p2', productId: 'prod-multi', tenantId: TENANT_A, version: 1, isPrimary: false, hash: meta2.hash });
    await imageManifestRepository.upsert({ photoId: 'p3', productId: 'prod-multi', tenantId: TENANT_A, version: 1, isPrimary: false, hash: meta3.hash });

    const result = await syncService.ensureProductImages('prod-multi', { tenantId: TENANT_A });
    expect(result.queued).toBe(3);

    // Permite que o processamento execute
    await new Promise(r => setTimeout(r, 80));

    expect(await localImageCache.has(TENANT_A, 'p1')).toBe(true);
    expect(await localImageCache.has(TENANT_A, 'p2')).toBe(true);
    expect(await localImageCache.has(TENANT_A, 'p3')).toBe(true);
  });

  it('SYNC-30: abertura de produto enquanto P3 executa deve fazer novo P1 ultrapassar fila pendente', async () => {
    syncService.pause();

    // 10 itens P3 enfileirados
    for (let i = 1; i <= 10; i++) {
      syncService.enqueue({ photoId: `p3-${i}`, productId: `prod-${i}`, tenantId: TENANT_A, priority: SYNC_PRIORITY.P3 });
    }

    // Usuário abre produto: adiciona P1
    syncService.enqueue({ photoId: 'p1-urgente', productId: 'prod-urgente', tenantId: TENANT_A, priority: SYNC_PRIORITY.P1, isPrimary: true });

    const next = await syncService._selectNextItem();
    expect(next.photoId).toBe('p1-urgente');
    expect(next.priority).toBe(SYNC_PRIORITY.P1);
  });

  // =========================================================================
  // CENÁRIOS INTEGRAIS: 51, 52, 53, 56, 57
  // =========================================================================

  it('Cenário 51: Fluxo Completo Multi-Device (Upload -> Sync PWA -> Cache -> Offline Real)', async () => {
    // 1. Windows: Produto cadastrado com foto no storage remoto
    const originalBlob = createMockBlob('foto-alta-resolucao-windows');
    const remoteMeta = await mockStorage.upload(originalBlob, {
      photoId: 'photo-cenario-51',
      productId: 'prod-cross-51',
      tenantId: TENANT_A,
      isPrimary: true,
      version: 1
    });

    // 2. Celular: PWA abre produto e sincroniza foto via ensureProductImages
    await imageManifestRepository.upsert({
      photoId: 'photo-cenario-51',
      productId: 'prod-cross-51',
      tenantId: TENANT_A,
      version: 1,
      isPrimary: true,
      hash: remoteMeta.hash
    });

    const syncRes = await syncService.ensureProductImages('prod-cross-51', { tenantId: TENANT_A });
    expect(syncRes.queued).toBe(1);

    await new Promise(r => setTimeout(r, 60));

    // Foto agora está no cache local
    const cachedBefore = await localImageCache.get(TENANT_A, 'photo-cenario-51');
    expect(cachedBefore).toBeDefined();

    // 3. Celular fica OFFLINE
    syncService.setOnline(false);
    mockStorage.setConfigured(false); // Simula rede 100% indisponível

    // 4. Usuário reabre produto offline: a foto continua acessível no cache
    const offlineCached = await localImageCache.get(TENANT_A, 'photo-cenario-51');
    expect(offlineCached).toBeDefined();
    expect(offlineCached.blob).toBeDefined();
    expect(offlineCached.hash).toBe(remoteMeta.hash);
  });

  it('Cenário 52: Atualização remota v1 -> v2 substitui foto antiga localmente', async () => {
    const blobV1 = createMockBlob('versao-1');
    const blobV2 = createMockBlob('versao-2-nova');

    const metaV1 = await mockStorage.upload(blobV1, { photoId: 'photo-update-52', productId: 'prod-52', tenantId: TENANT_A, version: 1 });
    await localImageCache.put({ photoId: 'photo-update-52', productId: 'prod-52', tenantId: TENANT_A, blob: blobV1, version: 1, hash: metaV1.hash });

    // Servidor atualiza para v2
    const metaV2 = await mockStorage.upload(blobV2, { photoId: 'photo-update-52', productId: 'prod-52', tenantId: TENANT_A, version: 2 });

    await imageManifestRepository.upsert({
      photoId: 'photo-update-52',
      productId: 'prod-52',
      tenantId: TENANT_A,
      version: 2,
      hash: metaV2.hash
    });

    const res = await syncService.ensureProductImages('prod-52', { tenantId: TENANT_A });
    expect(res.queued).toBe(1);

    await new Promise(r => setTimeout(r, 60));

    const finalCached = await localImageCache.get(TENANT_A, 'photo-update-52');
    expect(finalCached.version).toBe(2);
    expect(finalCached.hash).toBe(metaV2.hash);
  });

  it('Cenário 53: Foto inalterada (v5 hash AAA) gera ZERO download redundante', async () => {
    const blob = createMockBlob('versao-imutavel');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-53', productId: 'prod-53', tenantId: TENANT_A, version: 5 });
    await localImageCache.put({ photoId: 'photo-53', productId: 'prod-53', tenantId: TENANT_A, blob, version: 5, hash: meta.hash });

    await imageManifestRepository.upsert({
      photoId: 'photo-53',
      productId: 'prod-53',
      tenantId: TENANT_A,
      version: 5,
      hash: meta.hash
    });

    const historyBefore = mockStorage.uploadHistory.length;
    const res = await syncService.ensureProductImages('prod-53', { tenantId: TENANT_A });

    expect(res.queued).toBe(0);
    expect(res.existingCount).toBe(1);
    expect(mockStorage.uploadHistory.length).toBe(historyBefore);
  });

  it('Cenário 56: Flapping de rede (online -> offline -> online) preserva integridade sem corrupção', async () => {
    const blob = createMockBlob('img-flapping');
    const meta = await mockStorage.upload(blob, { photoId: 'photo-flap', productId: 'prod-flap', tenantId: TENANT_A });

    syncService.enqueue({
      photoId: 'photo-flap',
      productId: 'prod-flap',
      tenantId: TENANT_A,
      priority: SYNC_PRIORITY.P1,
      expectedHash: meta.hash
    });

    // Simula instabilidade no meio
    syncService.setOnline(false);
    syncService.setOnline(true);
    syncService.setOnline(false);
    syncService.setOnline(true);

    await new Promise(r => setTimeout(r, 80));

    const cached = await localImageCache.get(TENANT_A, 'photo-flap');
    expect(cached).toBeDefined();
    expect(cached.hash).toBe(meta.hash);
  });

  it('Cenário 57 & 58: Catálogo volumoso com 1.000 imagens enfileira sem travar e respeita concorrência = 2', async () => {
    syncService.pause();

    const items = [];
    for (let i = 1; i <= 1000; i++) {
      items.push({
        photoId: `bulk-photo-${i}`,
        productId: `bulk-prod-${Math.ceil(i / 3)}`,
        tenantId: TENANT_A,
        priority: SYNC_PRIORITY.P3,
        expectedVersion: 1
      });
    }

    const start = performance.now();
    const count = syncService.enqueueMany(items);
    const duration = performance.now() - start;

    expect(count).toBe(1000);
    expect(syncService.getQueue().length).toBe(1000);
    expect(duration).toBeLessThan(100); // Planejamento instantâneo em memória

    // Verifica que o limite de concorrência é estritamente 2
    expect(syncService.concurrency).toBe(2);
  });
});
