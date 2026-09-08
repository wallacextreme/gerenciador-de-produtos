import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { SyncRepository } from '../src/js/repositories/SyncRepository.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { CloudProvider, MockCloudProvider, FirebaseProvider } from '../src/js/sync/index.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import { getDB } from '../src/js/db/connection.js';

describe('Firebase & Sync Engine — Sincronização em Nuvem (FASE 13)', () => {
  let syncRepo;
  let mockProvider;
  let syncEngine;

  beforeEach(async () => {
    const db = await getDB();
    await db.clear('syncQueue');
    syncRepo = new SyncRepository();
    mockProvider = new MockCloudProvider();
    syncEngine = new SyncEngine(mockProvider);
  });

  afterEach(() => {
    syncEngine.destroy();
  });

  describe('1. Provedores em Nuvem (CloudProvider, MockCloudProvider & FirebaseProvider)', () => {
    it('CloudProvider base deve lançar erro se métodos abstratos não forem sobrescritos', async () => {
      const base = new CloudProvider();
      expect(base.getProviderName()).toBe('BaseCloudProvider');
      expect(base.isConfigured()).toBe(false);
      expect(base.testConnection()).rejects.toThrow();
      expect(base.pushChange({})).rejects.toThrow();
      expect(base.pullChanges('products')).rejects.toThrow();
    });

    it('MockCloudProvider deve realizar push, pull e simulação de conexões com sucesso', async () => {
      const resConn = await mockProvider.testConnection();
      expect(resConn.success).toBe(true);
      expect(resConn.latencyMs).toBeGreaterThan(0);

      // Push CREATE
      const changeItem = {
        id: 'sync-1',
        entityType: 'products',
        entityId: 'prod-100',
        action: 'CREATE',
        payload: { name: 'Monitor Gamer 4K', salePriceCents: 249900, updatedAt: '2026-08-20T10:00:00.000Z' }
      };

      const pushRes = await mockProvider.pushChange(changeItem);
      expect(pushRes.success).toBe(true);
      expect(pushRes.remoteId).toBe('prod-100');

      // Pull
      const pullRes = await mockProvider.pullChanges('products');
      expect(pullRes.items.length).toBe(1);
      expect(pullRes.items[0].name).toBe('Monitor Gamer 4K');
      expect(pullRes.items[0].salePriceCents).toBe(249900);

      // Simulação de falha
      mockProvider.setShouldFail(true, 'Erro de rede 503');
      expect(mockProvider.testConnection()).resolves.toEqual({ success: false, message: 'Erro de rede 503' });
      expect(mockProvider.pushChange(changeItem)).rejects.toThrow('Erro de rede 503');
    });

    it('FirebaseProvider deve codificar e decodificar tipos de dados do Firestore REST API', () => {
      const fb = new FirebaseProvider({ apiKey: 'key123', projectId: 'proj123' });
      expect(fb.isConfigured()).toBe(true);
      expect(fb.getProviderName()).toBe('Firebase Firestore');

      const originalData = {
        name: 'Teclado Mecânico RGB',
        salePriceCents: 35000,
        margin: 45.5,
        isActive: true,
        notes: null,
        tags: ['gamer', 'rgb', 'perifericos'],
        metadata: { switch: 'Red', layout: 'ABNT2' }
      };

      const encoded = fb._encodeFirestoreDocument(originalData);
      expect(encoded.fields.name.stringValue).toBe('Teclado Mecânico RGB');
      expect(encoded.fields.salePriceCents.integerValue).toBe('35000');
      expect(encoded.fields.margin.doubleValue).toBe(45.5);
      expect(encoded.fields.isActive.booleanValue).toBe(true);
      expect(encoded.fields.notes.nullValue).toBe(null);

      const decoded = fb._decodeFirestoreDocument(encoded);
      expect(decoded.name).toBe('Teclado Mecânico RGB');
      expect(decoded.salePriceCents).toBe(35000);
      expect(decoded.margin).toBe(45.5);
      expect(decoded.isActive).toBe(true);
      expect(decoded.notes).toBe(null);
      expect(decoded.metadata).toEqual({ switch: 'Red', layout: 'ABNT2' });
    });
  });

  describe('2. Repositório da Fila Outbox (SyncRepository)', () => {
    it('deve enfileirar mutações com status PENDING e attempts 0', async () => {
      const item = await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'p-1',
        action: 'CREATE',
        payload: { name: 'Mouse Sem Fio' }
      });

      expect(item.id).toBeDefined();
      expect(item.status).toBe('PENDING');
      expect(item.attempts).toBe(0);

      const pending = await syncRepo.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].entityId).toBe('p-1');
    });

    it('deve coalescer UPDATE após CREATE no mesmo registro não sincronizado', async () => {
      await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'p-2',
        action: 'CREATE',
        payload: { name: 'Fone Bluetooth', salePriceCents: 15000 }
      });

      const updatedItem = await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'p-2',
        action: 'UPDATE',
        payload: { salePriceCents: 18000 }
      });

      expect(updatedItem.action).toBe('CREATE');
      expect(updatedItem.payload.name).toBe('Fone Bluetooth');
      expect(updatedItem.payload.salePriceCents).toBe(18000);

      const all = await syncRepo.findAll();
      expect(all.length).toBe(1);
    });

    it('deve remover da fila se houver DELETE após CREATE não sincronizado (eliminação sem push)', async () => {
      await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'p-3',
        action: 'CREATE',
        payload: { name: 'Item Temporário' }
      });

      const res = await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'p-3',
        action: 'DELETE',
        payload: {}
      });

      expect(res).toBeNull();
      const all = await syncRepo.findAll();
      expect(all.length).toBe(0);
    });

    it('deve marcar como sincronizado (markSynced) e limpar concluídos (clearCompleted)', async () => {
      const item = await syncRepo.enqueue({
        entityType: 'sales',
        entityId: 'sale-99',
        action: 'CREATE',
        payload: { totalCents: 50000 }
      });

      await syncRepo.markSynced(item.id, { remoteVersion: 'v1.0' });
      const found = await syncRepo.findById(item.id);
      expect(found.status).toBe('SYNCED');
      expect(found.syncedAt).toBeDefined();

      await syncRepo.clearCompleted();
      const all = await syncRepo.findAll();
      expect(all.length).toBe(0);
    });

    it('deve transicionar para FAILED após número máximo de tentativas e permitir retryFailed', async () => {
      const item = await syncRepo.enqueue({
        entityType: 'stockMovements',
        entityId: 'mov-1',
        action: 'CREATE',
        payload: { quantity: 10 }
      });

      // Simula 5 falhas consecutivas
      for (let i = 1; i <= 5; i++) {
        await syncRepo.markFailed(item.id, 'Timeout de conexão', 5);
      }

      const failedItem = await syncRepo.findById(item.id);
      expect(failedItem.status).toBe('FAILED');
      expect(failedItem.attempts).toBe(5);

      const failedList = await syncRepo.getFailed();
      expect(failedList.length).toBe(1);

      // Reprocessar falhas
      await syncRepo.retryFailed();
      const retried = await syncRepo.findById(item.id);
      expect(retried.status).toBe('PENDING');
      expect(retried.attempts).toBe(0);
      expect(retried.lastError).toBeNull();
    });

    it('getStats deve consolidar total, pending, synced e failed', async () => {
      const item1 = await syncRepo.enqueue({ entityType: 'products', entityId: 'p-a', action: 'CREATE' });
      const item2 = await syncRepo.enqueue({ entityType: 'products', entityId: 'p-b', action: 'CREATE' });
      const item3 = await syncRepo.enqueue({ entityType: 'products', entityId: 'p-c', action: 'CREATE' });

      await syncRepo.markSynced(item1.id);
      await syncRepo.markFailed(item2.id, 'Erro 500', 1);

      const stats = await syncRepo.getStats();
      expect(stats.total).toBe(3);
      expect(stats.synced).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  describe('3. Motor de Sincronização (SyncEngine & Outbox Orchestration)', () => {
    it('deve processar a fila com sucesso através de processQueue()', async () => {
      await syncRepo.enqueue({
        entityType: 'products',
        entityId: 'sync-prod-1',
        action: 'CREATE',
        payload: { name: 'Smartwatch Pro', salePriceCents: 89900 }
      });

      await syncRepo.enqueue({
        entityType: 'sales',
        entityId: 'sync-sale-1',
        action: 'CREATE',
        payload: { totalCents: 89900 }
      });

      const res = await syncEngine.processQueue();
      expect(res.processed).toBe(2);
      expect(res.success).toBe(2);
      expect(res.failed).toBe(0);

      const stats = await syncEngine.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.synced).toBe(2);
      expect(stats.lastSyncTimestamp).toBeDefined();

      const remoteProducts = mockProvider.getRemoteData('products');
      expect(remoteProducts.length).toBe(1);
      expect(remoteProducts[0].name).toBe('Smartwatch Pro');
    });

    it('deve escutar eventos de mutação do EventBus e enfileirar automaticamente', async () => {
      await syncEngine.init();

      eventBus.emit(EVENTS.PRODUCT_UPDATED, {
        id: 'bus-prod-1',
        name: 'Webcam 4K',
        salePriceCents: 45000
      });

      // Aguarda tick de microtask para gravação assíncrona
      await new Promise(r => setTimeout(r, 50));

      const pending = await syncRepo.getPending();
      expect(pending.some(p => p.entityId === 'bus-prod-1')).toBe(true);
    });

    it('deve resolver conflitos determinísticamente com Last Write Wins (LWW)', () => {
      const localDoc = {
        id: 'conf-1',
        name: 'Placa de Vídeo RTX 4070',
        salePriceCents: 450000,
        updatedAt: '2026-08-20T10:00:00.000Z'
      };

      const remoteDocNewer = {
        id: 'conf-1',
        name: 'Placa de Vídeo RTX 4070 Super',
        salePriceCents: 480000,
        updatedAt: '2026-08-20T10:15:00.000Z'
      };

      const remoteWon = syncEngine.resolveConflict(localDoc, remoteDocNewer, 'LAST_WRITE_WINS');
      expect(remoteWon.name).toBe('Placa de Vídeo RTX 4070 Super');
      expect(remoteWon.salePriceCents).toBe(480000);
      expect(remoteWon._conflictResolved).toBe('remote_won');

      const remoteDocOlder = {
        id: 'conf-1',
        name: 'Placa de Vídeo RTX 4070 (Antiga)',
        salePriceCents: 420000,
        updatedAt: '2026-08-20T09:30:00.000Z'
      };

      const localWon = syncEngine.resolveConflict(localDoc, remoteDocOlder, 'LAST_WRITE_WINS');
      expect(localWon.name).toBe('Placa de Vídeo RTX 4070');
      expect(localWon._conflictResolved).toBe('local_won');
    });
  });
});
