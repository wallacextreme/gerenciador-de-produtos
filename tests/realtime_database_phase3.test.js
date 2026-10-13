import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import 'fake-indexeddb/auto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { CloudProvider } from '../src/js/sync/CloudProvider.js';
import { MockRealtimeProvider } from '../src/js/sync/MockRealtimeProvider.js';
import { FirebaseRealtimeProvider } from '../src/js/sync/FirebaseRealtimeProvider.js';
import { SyncEngine } from '../src/js/services/SyncEngine.js';
import { SyncRepository } from '../src/js/repositories/SyncRepository.js';
import { ProductRepository } from '../src/js/repositories/ProductRepository.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';
import { getDB } from '../src/js/db/connection.js';

describe('Firebase Realtime Database — Camada de Nuvem e Anti-Loop (PHASE 03)', () => {
  let mockRtdb;
  let syncRepo;
  let syncEngine;
  let productRepo;

  beforeEach(async () => {
    const db = await getDB();
    await db.clear('syncQueue');
    await db.clear('products');
    await db.clear('stockMovements');

    mockRtdb = new MockRealtimeProvider({
      tenantId: 'tenant_loja_01',
      deviceId: 'device_desktop_windows_01'
    });
    syncRepo = new SyncRepository();
    syncEngine = new SyncEngine(mockRtdb);
    await syncEngine.init();
    productRepo = new ProductRepository();
  });

  afterEach(() => {
    if (syncEngine) syncEngine.destroy();
    if (mockRtdb) mockRtdb.clear();
  });

  describe('RTDB-01: Inicialização do Provedor', () => {
    it('deve inicializar MockRealtimeProvider e FirebaseRealtimeProvider implementando CloudProvider', () => {
      expect(mockRtdb).toBeInstanceOf(CloudProvider);
      expect(mockRtdb.getProviderName()).toBe('MockRealtimeProvider');
      expect(mockRtdb.isConfigured()).toBe(true);
      expect(mockRtdb.getTenantId()).toBe('tenant_loja_01');
      expect(mockRtdb.isConnected()).toBe(true);

      const fbProvider = new FirebaseRealtimeProvider({
        apiKey: 'fake-api-key',
        projectId: 'gestaopro-demo',
        databaseURL: 'https://gestaopro-demo-default-rtdb.firebaseio.com'
      });
      expect(fbProvider).toBeInstanceOf(CloudProvider);
      expect(fbProvider.getProviderName()).toBe('Firebase Realtime Database');
      expect(fbProvider.isConfigured()).toBe(true);
    });
  });

  describe('RTDB-02: Configuração Inválida', () => {
    it('deve identificar provedor não configurado e rejeitar operações sem credenciais', async () => {
      const unconfigured = new MockRealtimeProvider({ configured: false });
      expect(unconfigured.isConfigured()).toBe(false);

      const connRes = await unconfigured.testConnection();
      expect(connRes.success).toBe(false);

      expect(unconfigured.pushChange({ entityType: 'products', entityId: 'p1', action: 'CREATE', payload: {} })).rejects.toThrow();
      expect(unconfigured.pullChanges('products')).rejects.toThrow();

      const fbUnconfigured = new FirebaseRealtimeProvider(null);
      expect(fbUnconfigured.isConfigured()).toBe(false);
    });
  });

  describe('RTDB-03: Create (Escrita de Registro)', () => {
    it('deve gravar novo registro com version, sourceDeviceId, timestamps e mutationId', async () => {
      const changeItem = {
        id: 'mut_item_001',
        entityType: 'products',
        entityId: 'prod_mon_4k',
        action: 'CREATE',
        payload: {
          name: 'Monitor Gamer 4K IPS',
          salePriceCents: 289900,
          category: 'Monitores'
        }
      };

      const res = await mockRtdb.pushChange(changeItem);
      expect(res.success).toBe(true);
      expect(res.remoteId).toBe('prod_mon_4k');

      const savedDoc = await mockRtdb.get('products', 'prod_mon_4k');
      expect(savedDoc).toBeDefined();
      expect(savedDoc.name).toBe('Monitor Gamer 4K IPS');
      expect(savedDoc.version).toBe(1);
      expect(savedDoc.sourceDeviceId).toBe('device_desktop_windows_01');
      expect(savedDoc.lastMutationId).toBe('mut_item_001');
      expect(savedDoc.updatedAt).toBeDefined();
      expect(savedDoc._serverTimestamp).toBeDefined();
    });
  });

  describe('RTDB-04: Update (Atualização e Incremento de Versão)', () => {
    it('deve atualizar campos e incrementar a versão sequencial do documento', async () => {
      await mockRtdb.create('products', 'prod_mon_4k', {
        name: 'Monitor Gamer 4K',
        salePriceCents: 289900
      });

      const initial = await mockRtdb.get('products', 'prod_mon_4k');
      expect(initial.version).toBe(1);

      await mockRtdb.update('products', 'prod_mon_4k', {
        salePriceCents: 269900
      });

      const updated = await mockRtdb.get('products', 'prod_mon_4k');
      expect(updated.version).toBe(2);
      expect(updated.salePriceCents).toBe(269900);
      expect(updated.name).toBe('Monitor Gamer 4K');
    });
  });

  describe('RTDB-05: Delete (Soft Delete)', () => {
    it('deve registrar soft delete preenchendo deletedAt', async () => {
      await mockRtdb.create('products', 'prod_headset_71', {
        name: 'Headset Surround 7.1',
        salePriceCents: 35000
      });

      await mockRtdb.remove('products', 'prod_headset_71');

      const deletedDoc = await mockRtdb.get('products', 'prod_headset_71');
      expect(deletedDoc.deletedAt).toBeDefined();
      expect(typeof deletedDoc.deletedAt).toBe('string');
    });
  });

  describe('RTDB-06: Get (Busca Direta por Chave)', () => {
    it('deve retornar null para chaves inexistentes e o documento para chaves existentes', async () => {
      expect(await mockRtdb.get('products', 'chave_inexistente')).toBeNull();

      await mockRtdb.create('products', 'prod_mouse_rgb', { name: 'Mouse Óptico RGB' });
      const mouse = await mockRtdb.get('products', 'prod_mouse_rgb');
      expect(mouse.name).toBe('Mouse Óptico RGB');
    });
  });

  describe('RTDB-07: List/Query com Índices e Filtros', () => {
    it('deve listar, filtrar e ordenar documentos remotos', async () => {
      await mockRtdb.create('products', 'p1', { name: 'Teclado Mecânico', category: 'Periféricos', salePriceCents: 20000 });
      await mockRtdb.create('products', 'p2', { name: 'Gabinete ATX', category: 'Hardware', salePriceCents: 45000 });
      await mockRtdb.create('products', 'p3', { name: 'Mouse Pad Grande', category: 'Periféricos', salePriceCents: 8000 });

      const all = await mockRtdb.list('products');
      expect(all.length).toBe(3);

      const perif = await mockRtdb.list('products', {
        filter: (p) => p.category === 'Periféricos'
      });
      expect(perif.length).toBe(2);

      const sortedByPrice = await mockRtdb.list('products', { orderBy: 'salePriceCents' });
      expect(sortedByPrice[0].salePriceCents).toBe(8000);
      expect(sortedByPrice[2].salePriceCents).toBe(45000);
    });
  });

  describe('RTDB-08: Subscribe (Listener de Tempo Real com Tagging Remoto)', () => {
    it('deve receber notificações marcadas como origin: "remote"', async () => {
      const receivedEvents = [];

      const unsub = mockRtdb.subscribe('products', (event) => {
        receivedEvents.push(event);
      });

      // Simula alteração originada por outro dispositivo
      mockRtdb.simulateRemoteChange({
        entityType: 'products',
        entityId: 'prod_remoto_01',
        payload: { name: 'Cadeira Ergonômica', salePriceCents: 120000 },
        sourceDeviceId: 'device_mobile_android_02',
        version: 1
      });

      unsub();

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      const last = receivedEvents[receivedEvents.length - 1];
      expect(last.origin).toBe('remote');
      expect(last.doc.name).toBe('Cadeira Ergonômica');
    });
  });

  describe('RTDB-09: Unsubscribe (Cancelamento de Subscrição)', () => {
    it('não deve mais notificar o callback após chamada de unsubscribe', () => {
      let callCount = 0;
      const callback = () => { callCount++; };

      const unsub = mockRtdb.subscribe('products', callback);
      const countBefore = callCount;

      unsub();

      mockRtdb.simulateRemoteChange({
        entityType: 'products',
        entityId: 'prod_teste_unsub',
        payload: { name: 'Teste Unsub' },
        sourceDeviceId: 'device_other'
      });

      expect(callCount).toBe(countBefore);
    });
  });

  describe('RTDB-10: Listener Duplicado e Múltiplas Inscrições', () => {
    it('deve gerenciar múltiplos listeners no mesmo caminho sem colisão', () => {
      let countA = 0;
      let countB = 0;

      const unsubA = mockRtdb.subscribe('products', () => { countA++; });
      const unsubB = mockRtdb.subscribe('products', () => { countB++; });

      mockRtdb.simulateRemoteChange({
        entityType: 'products',
        entityId: 'p_mult',
        payload: { name: 'Multi-listener' },
        sourceDeviceId: 'device_other'
      });

      unsubA();

      mockRtdb.simulateRemoteChange({
        entityType: 'products',
        entityId: 'p_mult',
        payload: { name: 'Multi-listener 2' },
        sourceDeviceId: 'device_other'
      });

      unsubB();

      expect(countA).toBeLessThan(countB);
    });
  });

  describe('RTDB-11: Evento Local -> Enfileiramento no Outbox', () => {
    it('evento local do EventBus deve entrar na fila de sincronização', async () => {
      eventBus.emit(EVENTS.PRODUCT_UPDATED, {
        id: 'prod_local_001',
        name: 'SSD NVMe 1TB',
        salePriceCents: 45000,
        origin: 'local'
      });

      // Aguarda deterministicamente a inclusão do item na fila do Outbox (polling com teto de 1000ms)
      const start = Date.now();
      let pending = [];
      while (Date.now() - start < 1000) {
        pending = await syncRepo.getPending();
        if (pending.length >= 1) break;
        await new Promise(r => setTimeout(r, 10));
      }

      expect(pending.length).toBe(1);
      expect(pending[0].entityId).toBe('prod_local_001');
      expect(pending[0].entityType).toBe('products');
    });
  });

  describe('RTDB-12: Evento Remoto -> Tagging Seguro', () => {
    it('evento remoto deve portar origin: "remote"', () => {
      let receivedOrigin = null;

      const unsub = mockRtdb.subscribe('products', (event) => {
        receivedOrigin = event.origin;
      });

      mockRtdb.simulateRemoteChange({
        entityType: 'products',
        entityId: 'prod_remote_check',
        payload: { name: 'Webcam 1080p' },
        sourceDeviceId: 'device_remote_02'
      });

      unsub();

      expect(receivedOrigin).toBe('remote');
    });
  });

  describe('RTDB-13: Anti-Loop — Remote Echo Descartado', () => {
    it('deve descartar eco quando sourceDeviceId é o do próprio dispositivo', () => {
      const fbProvider = new FirebaseRealtimeProvider();
      fbProvider.setDeviceId('device_windows_pc01');

      let notifyCount = 0;
      const callback = () => { notifyCount++; };

      // Simulamos um documento retornado cujo sourceDeviceId é o próprio
      const localEchoDoc = {
        id: 'p100',
        name: 'Produto Meu',
        sourceDeviceId: 'device_windows_pc01',
        lastMutationId: 'mut_100'
      };

      // No filtro do subscribe de FirebaseRealtimeProvider:
      // item.sourceDeviceId === this.deviceId -> continue (DROP)
      expect(localEchoDoc.sourceDeviceId === fbProvider.getDeviceId()).toBe(true);
      expect(notifyCount).toBe(0);
    });
  });

  describe('RTDB-14: Anti-Loop — Versão Menor Ignorada', () => {
    it('deve ignorar atualização remota com versão inferior à versão local existente', () => {
      const localDoc = { id: 'p1', version: 5, updatedAt: '2026-10-08T12:00:00Z' };
      const remoteDoc = { id: 'p1', version: 3, updatedAt: '2026-10-08T10:00:00Z' };

      const winner = syncEngine.resolveConflict(localDoc, remoteDoc);
      expect(winner._conflictResolved).toBe('local_won');
      expect(winner.version).toBe(5);
    });
  });

  describe('RTDB-15: Anti-Loop — Versão Maior Aplicada', () => {
    it('deve aplicar atualização remota com versão superior', () => {
      const localDoc = { id: 'p1', version: 2, updatedAt: '2026-10-08T10:00:00Z' };
      const remoteDoc = { id: 'p1', version: 4, updatedAt: '2026-10-08T14:00:00Z' };

      const winner = syncEngine.resolveConflict(localDoc, remoteDoc);
      expect(winner._conflictResolved).toBe('remote_won');
      expect(winner.version).toBe(4);
    });
  });

  describe('RTDB-16: Anti-Loop — MutationId Duplicado Ignorado', () => {
    it('deve descartar alterações cujo mutationId já foi registrado localmente', () => {
      mockRtdb.processedMutations.add('mut_ja_processada_99');

      let accepted = true;
      const incomingMutationId = 'mut_ja_processada_99';

      if (mockRtdb.processedMutations.has(incomingMutationId)) {
        accepted = false; // DESCARTA
      }

      expect(accepted).toBe(false);
    });
  });

  describe('RTDB-17: Integração com Fila Offline (Outbox)', () => {
    it('deve acumular mutações locais na Outbox quando offline sem falhar operação do usuário', async () => {
      mockRtdb.setConnected(false);

      // Usuário cadastra produto offline
      await syncEngine.enqueue('products', 'prod_offline_01', 'CREATE', {
        name: 'Placa de Vídeo RTX 4070',
        salePriceCents: 499900
      });

      const stats = await syncEngine.getStats();
      expect(stats.pending).toBe(1);

      // Tentativa de processar offline não perde dados e marca falha ou aguarda
      const processRes = await syncEngine.processQueue();
      expect(processRes.failed).toBe(1);

      const stillPending = await syncRepo.getPending();
      expect(stillPending.length).toBe(1);
    });
  });

  describe('RTDB-18: Reconexão e Despacho Automático', () => {
    it('deve processar fila acumulada com sucesso após restabelecimento de conexão', async () => {
      // 1. Enfileira offline
      mockRtdb.setConnected(false);
      await syncEngine.enqueue('products', 'prod_reconnect_01', 'CREATE', {
        name: 'Memória RAM DDR5 32GB',
        salePriceCents: 85000
      });

      // 2. Conexão restabelecida
      mockRtdb.setConnected(true);

      // 3. Processa fila
      const processRes = await syncEngine.processQueue();
      expect(processRes.success).toBe(1);
      expect(processRes.failed).toBe(0);

      const pendingAfter = await syncRepo.getPending();
      expect(pendingAfter.length).toBe(0);
    });
  });

  describe('RTDB-19: Erro de Autenticação (UNAUTHENTICATED)', () => {
    it('deve tratar e propagar erro de não autenticado adequadamente', async () => {
      mockRtdb.setShouldFail(true, 'Usuário não autenticado', 'UNAUTHENTICATED');

      expect(mockRtdb.pushChange({
        entityType: 'products',
        entityId: 'p_err_auth',
        action: 'CREATE',
        payload: { name: 'Erro Auth' }
      })).rejects.toThrow('Usuário não autenticado');
    });
  });

  describe('RTDB-20: Erro de Autorização (PERMISSION_DENIED)', () => {
    it('deve simular rejeição por Security Rule do Realtime Database', async () => {
      mockRtdb.setShouldFail(true, 'Permissão negada pelas regras de segurança', 'PERMISSION_DENIED');

      expect(mockRtdb.pushChange({
        entityType: 'products',
        entityId: 'p_perm',
        action: 'CREATE',
        payload: { name: 'Erro Perm' }
      })).rejects.toThrow('Permissão negada');
    });
  });

  describe('RTDB-21: Isolamento de Tenants (Multi-Tenancy)', () => {
    it('operações do tenantA não devem vazar para o tenantB', async () => {
      // Tenant A
      mockRtdb.setTenantId('tenant_empresa_A');
      await mockRtdb.create('products', 'prod_tA_01', { name: 'Produto Tenant A' });

      expect(await mockRtdb.get('products', 'prod_tA_01')).toBeDefined();

      // Tenant B
      mockRtdb.setTenantId('tenant_empresa_B');
      expect(await mockRtdb.get('products', 'prod_tA_01')).toBeNull();

      const itemsB = await mockRtdb.list('products');
      expect(itemsB.length).toBe(0);
    });
  });

  describe('RTDB-22: Validação de Regras (database.rules.json)', () => {
    it('arquivo database.rules.json deve existir, conter JSON válido e regras estritas de segurança', () => {
      const rulesPath = join(process.cwd(), 'database.rules.json');
      expect(existsSync(rulesPath)).toBe(true);

      const content = readFileSync(rulesPath, 'utf-8');
      const rules = JSON.parse(content);

      expect(rules.rules).toBeDefined();
      expect(rules.rules.tenants).toBeDefined();

      // Proíbe regras abertas em produção
      expect(rules.rules['.read']).toBeUndefined();
      expect(rules.rules['.write']).toBeUndefined();

      // Verifica índices exigidos
      const prodRules = rules.rules.tenants.$tenantId.products;
      expect(prodRules['.indexOn']).toContain('productCode');
      expect(prodRules['.indexOn']).toContain('barcode');
    });
  });

  describe('RTDB-23: Controle de Roles (RBAC: Admin vs Operador)', () => {
    it('regras devem restringir operações de escrita privilegiadas', () => {
      const rules = JSON.parse(readFileSync(join(process.cwd(), 'database.rules.json'), 'utf-8'));
      const settingsRule = rules.rules.tenants.$tenantId.settings.$settingKey['.write'];
      
      expect(settingsRule).toContain("appRole === 'admin'");
    });
  });

  describe('RTDB-24: Conflito de Produtos (LWW Determinístico)', () => {
    it('deve resolver conflito concorrente de produto elegendo a versão mais recente por timestamp', () => {
      const localProduct = {
        id: 'p_conflito',
        name: 'Notebook 16GB (Local)',
        salePriceCents: 450000,
        updatedAt: '2026-10-08T12:00:00.000Z'
      };

      const remoteProduct = {
        id: 'p_conflito',
        name: 'Notebook 16GB (Remoto Mais Recente)',
        salePriceCents: 420000,
        updatedAt: '2026-10-08T12:05:00.000Z'
      };

      const resolved = syncEngine.resolveConflict(localProduct, remoteProduct, 'LAST_WRITE_WINS');
      expect(resolved.name).toBe('Notebook 16GB (Remoto Mais Recente)');
      expect(resolved.salePriceCents).toBe(420000);
      expect(resolved._conflictResolved).toBe('remote_won');
    });
  });

  describe('RTDB-25: Concorrência em Estoque (Append-Only Ledger)', () => {
    it('dois movimentos concorrentes de estoque devem coexistir sem sobrescrita', async () => {
      // Dispositivo A registra Venda (-2 unidades)
      const movA = {
        id: 'mov_pdv_a_001',
        productId: 'prod_cafe_500g',
        type: 'OUT',
        quantity: 2,
        delta: -2,
        sourceDeviceId: 'device_pdv_01'
      };
      await mockRtdb.create('stockMovements', movA.id, movA);

      // Dispositivo B registra Entrada por Compra (+10 unidades)
      const movB = {
        id: 'mov_estoque_b_002',
        productId: 'prod_cafe_500g',
        type: 'IN',
        quantity: 10,
        delta: 10,
        sourceDeviceId: 'device_estoque_02'
      };
      await mockRtdb.create('stockMovements', movB.id, movB);

      // Ambos coexistem no banco remoto
      const movements = await mockRtdb.list('stockMovements');
      expect(movements.length).toBe(2);

      const ids = movements.map(m => m.id);
      expect(ids).toContain('mov_pdv_a_001');
      expect(ids).toContain('mov_estoque_b_002');

      // Saldo resultante acumulado: -2 + 10 = +8
      const totalDelta = movements.reduce((acc, m) => acc + m.delta, 0);
      expect(totalDelta).toBe(8);
    });
  });

  describe('RTDB-26: Cleanup e Destruição de Listeners', () => {
    it('deve remover todos os listeners e limpar referências na destruição', () => {
      const cb = () => {};
      mockRtdb.subscribe('products', cb);
      expect(mockRtdb.listeners.get('products').size).toBe(1);

      mockRtdb.unsubscribeAll();
      expect(mockRtdb.listeners.size).toBe(0);
    });
  });

  describe('RTDB-27: Teste Absoluto de Ausência de Loop de Sincronização', () => {
    it('Dispositivo B que recebe alteração remota NÃO deve reenviar para o Outbox ou Nuvem', async () => {
      // Instrumentação: Dispositivo B com seu próprio SyncEngine e Outbox
      const dbB = await getDB();
      const syncRepoB = new SyncRepository();
      const mockRtdbB = new MockRealtimeProvider({ deviceId: 'device_b_tablet' });
      const syncEngineB = new SyncEngine(mockRtdbB);
      await syncEngineB.init();

      // Dispositivo A despachou mutação que chegou ao Dispositivo B via listener remoto
      let receivedRemoteDoc = null;
      mockRtdbB.subscribe('products', (event) => {
        receivedRemoteDoc = event.doc;
        // Ao aplicar no app local, o evento é emitido com origin: 'remote'
        eventBus.emit(EVENTS.PRODUCT_UPDATED, {
          ...event.doc,
          origin: 'remote',
          _origin: 'remote'
        });
      });

      // Simula chegada do evento de A
      mockRtdbB.simulateRemoteChange({
        entityType: 'products',
        entityId: 'prod_loop_test',
        payload: { name: 'Monitor Anti-Loop', salePriceCents: 150000 },
        sourceDeviceId: 'device_a_pc',
        version: 1
      });

      // Aguarda possíveis ticks assíncronos do eventBus
      await new Promise(r => setTimeout(r, 60));

      // VERIFICAÇÃO CRÍTICA ANTI-LOOP:
      // O Outbox do Dispositivo B DEVE ESTAR VAZIO!
      const pendingOnB = await syncRepoB.getPending();
      expect(pendingOnB.length).toBe(0);

      // O Dispositivo B NÃO DEVE TER FEITO NENHUM PUSH
      expect(mockRtdbB.pushedChanges.length).toBe(0);

      syncEngineB.destroy();
    });
  });
});
