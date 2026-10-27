import { BaseRepository, getCurrentTenant } from './BaseRepository.js';
import { getDB } from '../db/connection.js';
import { executeTransaction } from '../db/transactions.js';
import { checkPermission } from '../utils/authGuard.js';
import { authService } from '../services/AuthService.js';
import { computeCanonicalPayloadHash, arePayloadsEquivalent } from '../utils/operationIdentity.js';

/**
 * GestãoPro — Repositório da Fila de Sincronização (Outbox Pattern)
 * Persiste na store `syncQueue` todas as mutações locais para posterior sincronização assíncrona.
 * Garante isolamento por tenant e prevenção contra retentativas infinitas em erros permanentes de permissão.
 */
export class SyncRepository extends BaseRepository {
  constructor() {
    super('syncQueue');
    this._enqueueSeq = 0;
  }

  /**
   * Enfileira uma mutação para sincronização em nuvem com coalescência inteligente e escopo de tenant.
   * Executa dentro de uma transação atômica do IndexedDB para prevenir race conditions entre chamadas simultâneas.
   * @param {Object} params { entityType, entityId, action, payload, tenantId, operationId }
   * @returns {Promise<Object>} Item enfileirado
   */
  async enqueue({ entityType, entityId, action, payload, tenantId, operationId }) {
    const curTenant = tenantId || (payload && payload.tenantId) || getCurrentTenant() || null;
    const now = new Date().toISOString();
    const payloadHash = computeCanonicalPayloadHash(entityType, payload || {});
    const targetOpId = operationId || null;

    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const all = await stores.syncQueue.getAll();

      // 1. Verificação de deduplicação idempotente por operationId (se fornecido)
      if (targetOpId) {
        const existingOp = all.find(item => item && (item.operationId === targetOpId || item.id === targetOpId));
        if (existingOp) {
          if (arePayloadsEquivalent(entityType, existingOp.payload, payload)) {
            return existingOp; // Repetição idempotente legítima
          }
          throw new Error(`Operação com operationId "${targetOpId}" já existente possui payload divergente.`);
        }
      }

      // 2. Busca se já existe um item PENDENTE (e não em voo, nem despachado, nem com desfecho remoto desconhecido, nem bloqueado)
      const existing = all.find(
        item => item &&
                item.entityType === entityType &&
                item.entityId === entityId &&
                item.status === 'PENDING' &&
                !item.inFlight &&
                !item.dispatchStarted &&
                !item.remoteOutcomeUnknown &&
                !item.requiresResolution &&
                !item.remoteAckReceived &&
                (!curTenant || !item.tenantId || item.tenantId === curTenant)
      );

      if (existing) {
        // Coalescência de Ações:
        if (existing.action === 'CREATE' && action === 'UPDATE') {
          // Se foi criado e agora editado antes do sync, mescla no CREATE original
          // Preserva o contrato estrito de criação remota: version inicial = 1 e sem baseVersion
          existing.payload = {
            ...existing.payload,
            ...payload
          };
          if (entityType === 'products') {
            existing.payload.version = 1;
          }
          delete existing.payload.baseVersion;
          delete existing.payload.expectedBaseVersion;
          delete existing.payload.basePayloadHash;
          existing.canonicalPayloadHash = computeCanonicalPayloadHash(entityType, existing.payload);
          existing.updatedAt = now;
          if (!existing.operationId && targetOpId) existing.operationId = targetOpId;
          if (curTenant && !existing.tenantId) existing.tenantId = curTenant;
          await stores.syncQueue.put(existing);
          return existing;
        }

        if (existing.action === 'CREATE' && action === 'DELETE') {
          // Se foi criado e deletado antes do sync, remove da fila (nunca existiu na nuvem!)
          await stores.syncQueue.delete(existing.id);
          return null;
        }

        if (existing.action === 'UPDATE' && action === 'UPDATE') {
          // Se já havia um UPDATE pendente (ainda não sincronizado), mescla o novo UPDATE
          // Preserva o baseVersion original (o estado que o servidor realmente possui)
          // e define a versão esperada como baseVersion + 1
          const originalBaseVersion = existing.payload?.baseVersion;
          existing.payload = {
            ...existing.payload,
            ...payload
          };
          if (originalBaseVersion !== undefined && originalBaseVersion !== null) {
            existing.payload.baseVersion = originalBaseVersion;
            existing.payload.version = originalBaseVersion + 1;
          }
          existing.canonicalPayloadHash = computeCanonicalPayloadHash(entityType, existing.payload);
          existing.status = 'PENDING';
          existing.updatedAt = now;
          if (!existing.operationId && targetOpId) existing.operationId = targetOpId;
          if (curTenant && !existing.tenantId) existing.tenantId = curTenant;
          await stores.syncQueue.put(existing);
          return existing;
        }

        // Atualiza com a nova ação e payload mantendo estritamente o entityId
        existing.action = action;
        existing.payload = payload;
        existing.canonicalPayloadHash = payloadHash;
        existing.status = 'PENDING';
        existing.updatedAt = now;
        if (!existing.operationId && targetOpId) existing.operationId = targetOpId;
        if (curTenant && !existing.tenantId) existing.tenantId = curTenant;
        await stores.syncQueue.put(existing);
        return existing;
      }

      const newItem = {
        id: crypto.randomUUID(),
        _seq: ++this._enqueueSeq,
        operationId: targetOpId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'op_' + Math.random().toString(36).substring(2, 9)),
        entityType,
        entityId,
        action, // 'CREATE' | 'UPDATE' | 'DELETE'
        payload: payload || {},
        canonicalPayloadHash: payloadHash,
        tenantId: curTenant,
        status: 'PENDING', // 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED'
        inFlight: false,
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        permanentFailure: false,
        requiresResolution: false,
        remoteOutcomeUnknown: false,
        remoteAckReceived: false,
        syncedAt: null,
        createdAt: now,
        updatedAt: now
      };

      await stores.syncQueue.add(newItem);
      return newItem;
    });
  }

  /**
   * Tenta reservar atomicamente um item da Outbox para despacho via transação IndexedDB.
   * Suporta propriedade de claim (ownerId), lease com expiração e identificador único de tentativa.
   * Garante que entre duas abas ou dois ciclos de sync concorrentes, exatamente um reserve o item.
   * @param {string} itemId
   * @param {string|null} [ownerId=null]
   * @param {Object} [options={}]
   * @param {number} [options.leaseDurationMs=30000] Duração do lease em milissegundos
   * @param {boolean} [options.isRecovery=false]
   * @param {boolean} [options.preserveDispatchStarted=false]
   * @returns {Promise<Object|null>}
   */
  async claimForDispatch(itemId, ownerId = null, options = {}) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(itemId);
      if (!item || item.status === 'SYNCED' || item.requiresResolution) {
        return null;
      }

      const now = Date.now();
      const leaseDurationMs = options.leaseDurationMs || 30000;

      // Se já estiver in-flight ou SYNCING, verifica se o lease está ativo
      if (item.inFlight || item.status === 'SYNCING') {
        const isExpired = item.claimExpiresAt ? (new Date(item.claimExpiresAt).getTime() <= now) : true;
        if (!isExpired && item.claimedBy && item.claimedBy !== ownerId && !options.isRecovery) {
          // Outra instância ativa detém o lease válido
          return null;
        }
      } else if (item.status !== 'PENDING') {
        return null;
      }

      const attemptId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'attempt_' + Math.random().toString(36).substring(2, 9);
      const nowIso = new Date(now).toISOString();
      const expiresAtIso = new Date(now + leaseDurationMs).toISOString();

      item.inFlight = true;
      item.status = 'SYNCING';
      item.claimedBy = ownerId || 'anonymous_instance';
      item.claimAttemptId = attemptId;
      item.claimedAt = nowIso;
      item.claimExpiresAt = expiresAtIso;
      item.inFlightStartedAt = nowIso;
      // FASE 14.23: a evidência de que um envio já foi iniciado (dispatchStarted === true) nunca é apagada
      // por uma nova reserva quando o chamador pede preservação. Registros sem o marcador viram `false`.
      if (!options.preserveDispatchStarted || item.dispatchStarted === undefined) {
        item.dispatchStarted = false;
      }

      await stores.syncQueue.put(item);
      return item;
    });
  }

  /**
   * Registra atomicamente o início do envio do payload para a rede.
   * Garante distinção comprovável entre "reserva criada sem envio" e "envio em andamento".
   * @param {string} itemId
   * @param {string} attemptId
   * @returns {Promise<Object|null>}
   */
  async recordDispatchStarted(itemId, attemptId) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(itemId);
      if (!item || item.status === 'SYNCED') return null;
      if (attemptId && (!item.claimAttemptId || item.claimAttemptId !== attemptId)) {
        // Tentativa suplantada ou lease não mais ativo
        return null;
      }
      item.dispatchStarted = true;
      item.dispatchStartedAt = new Date().toISOString();
      await stores.syncQueue.put(item);
      return item;
    });
  }

  /**
   * Registra duravelmente a resposta remota recebida com proteção contra ACK atrasado.
   * Se a tentativa foi suplantada por outra instância (superseded: true), registra o ACK
   * confirmado para não perder o sucesso na nuvem, mas NÃO altera o status para SYNCED
   * e não sobrescreve o estado da nova instância proprietária.
   * @param {string} itemId
   * @param {string} attemptId
   * @param {Object} [result={}]
   * @returns {Promise<{ recorded: boolean, superseded: boolean, item: Object|null }>}
   */
  async recordRemoteAck(itemId, attemptId, result = {}) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(itemId);
      if (!item) return { recorded: false, superseded: false, item: null };

      // Se a operação já estiver SYNCED, um ACK (duplicado ou tardio) não pode reabrir nem alterar o status
      if (item.status === 'SYNCED') {
        const isDuplicateOfSynced = Boolean(attemptId && (item.syncedAttemptId === attemptId || item.claimAttemptId === attemptId));
        if (attemptId && !isDuplicateOfSynced) {
          // ACK tardio de tentativa superada que chegou após a sincronização
          item.staleAttemptAcks = item.staleAttemptAcks || [];
          if (!item.staleAttemptAcks.some(a => a.attemptId === attemptId)) {
            item.staleAttemptAcks.push({
              attemptId,
              recordedAt: new Date().toISOString(),
              remoteVersion: result.remoteVersion || null,
              success: Boolean(result && result.success),
              note: 'ACK recebido após item já estar SYNCED'
            });
            await stores.syncQueue.put(item);
          }
        }
        return { recorded: false, superseded: !isDuplicateOfSynced, alreadySynced: true, item };
      }

      // Tentativa superada: attemptId informado difere da concessão ativa ou concessão não mais ativa
      const isSuperseded = Boolean(attemptId && (!item.claimAttemptId || item.claimAttemptId !== attemptId));

      if (isSuperseded) {
        // INVARIANTE OBRIGATÓRIA (FASE 14.21):
        // 1. Um ACK atrasado de tentativa antiga NUNCA pode sobrescrever o estado atual da operação.
        // 2. Um ACK atrasado NUNCA pode remover `requiresResolution` nem desbloquear um conflito já identificado por B.
        // 3. A evidência do ACK da tentativa antiga é preservada de forma isolada em `staleAttemptAcks`.
        // 4. O sucesso na nuvem é preservado duravelmente (remoteAckReceived: true) sem alterar o status local.
        item.staleAttemptAcks = item.staleAttemptAcks || [];
        item.staleAttemptAcks.push({
          attemptId,
          recordedAt: new Date().toISOString(),
          remoteVersion: result.remoteVersion || null,
          success: Boolean(result && result.success)
        });
        if (result && result.success) {
          item.remoteAckReceived = true;
          if (result.remoteVersion) {
            item.remoteVersion = result.remoteVersion;
          }
        }
        await stores.syncQueue.put(item);
        return { recorded: true, superseded: true, item };
      }

      if (result && result.success) {
        if (!item.requiresResolution) {
          item.status = 'SYNCED';
          item.syncedAt = new Date().toISOString();
          item.syncedAttemptId = attemptId || item.claimAttemptId || null;
          item.remoteVersion = result.remoteVersion || item.remoteVersion || null;
          item.remoteAckReceived = true;
          item.inFlight = false;
          item.lastError = null;
          item.permanentFailure = false;
          item.remoteOutcomeUnknown = false;
          item.updatedAt = new Date().toISOString();
        } else {
          item.remoteAckReceived = true;
          if (result.remoteVersion) item.remoteVersion = result.remoteVersion;
          item.inFlight = false;
          item.updatedAt = new Date().toISOString();
        }
      } else {
        item.inFlight = false;
        item.remoteOutcomeUnknown = true;
        item.updatedAt = new Date().toISOString();
      }

      await stores.syncQueue.put(item);
      return { recorded: true, superseded: false, item };
    });
  }

  /**
   * Libera a reserva in-flight de um item caso o despacho não prossiga.
   * @param {string} itemId
   * @param {string|null} [attemptId=null]
   * @param {string} [resetStatus='PENDING']
   * @returns {Promise<Object|null>}
   */
  async releaseDispatchClaim(itemId, attemptId = null, resetStatus = 'PENDING') {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(itemId);
      if (item && item.inFlight) {
        if (attemptId && item.claimAttemptId && item.claimAttemptId !== attemptId) {
          // Tentativa suplantada; não cancela reserva de outra instância
          return item;
        }
        item.inFlight = false;
        item.status = resetStatus;
        item.claimedBy = null;
        item.claimAttemptId = null;
        item.claimExpiresAt = null;
        item.dispatchStarted = false;
        await stores.syncQueue.put(item);
      }
      return item;
    });
  }

  /**
   * FASE 14.23 — Registra uma TENTATIVA DE RECONCILIAÇÃO (leitura remota) que falhou por inacessibilidade.
   * Esta rotina NUNCA autoriza reenvio da escrita comercial: o item permanece PENDING com
   * `remoteOutcomeUnknown: true` e só será reavaliado depois de `nextReconcileAt` (backoff exponencial).
   * Falha de leitura NÃO é ausência de registro. Ao exceder `maxReconcileAttempts`, o item é bloqueado
   * para resolução (FAILED + requiresResolution).
   * @param {string} itemId
   * @param {string|null} attemptId
   * @param {Object} [info={}]
   * @param {string} [info.message]
   * @param {number} [info.now] relógio injetável (ms)
   * @param {number} [info.maxReconcileAttempts=5]
   * @param {number} [info.baseDelayMs=1000]
   * @param {number} [info.maxDelayMs=60000]
   * @returns {Promise<{ success: boolean, escalated?: boolean, superseded?: boolean, item: Object|null }>}
   */
  async recordReconcileDeferred(itemId, attemptId = null, info = {}) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(itemId);
      if (!item) return { success: false, item: null };
      if (item.status === 'SYNCED') return { success: false, item };
      if (attemptId && item.claimAttemptId && item.claimAttemptId !== attemptId) {
        return { success: false, superseded: true, item };
      }

      const nowMs = info.now !== undefined ? new Date(info.now).getTime() : Date.now();
      const maxAttempts = info.maxReconcileAttempts || 5;
      const baseDelay = info.baseDelayMs || 1000;
      const maxDelay = info.maxDelayMs || 60000;

      item.reconcileAttempts = (item.reconcileAttempts || 0) + 1;
      item.lastReconcileAt = new Date(nowMs).toISOString();
      item.lastReconcileOutcome = 'INACCESSIBLE';
      item.lastReconcileError = info.message || 'Leitura remota de reconciliação inacessível.';
      item.lastError = item.lastReconcileError;
      item.errorCategory = 'unknown_remote_outcome';
      item.remoteOutcomeUnknown = true;
      item.inFlightInterrupted = true;
      item.inFlight = false;
      item.claimedBy = null;
      item.claimAttemptId = null;
      item.claimExpiresAt = null;
      item.updatedAt = new Date().toISOString();

      let escalated = false;
      if (item.reconcileAttempts >= maxAttempts) {
        item.status = 'FAILED';
        item.permanentFailure = true;
        item.requiresResolution = true;
        item.nextReconcileAt = null;
        escalated = true;
      } else {
        const delay = Math.min(baseDelay * Math.pow(2, item.reconcileAttempts - 1), maxDelay);
        item.status = 'PENDING';
        item.requiresResolution = false;
        item.nextReconcileAt = new Date(nowMs + delay).toISOString();
      }

      await stores.syncQueue.put(item);
      return { success: true, escalated, item };
    });
  }

  /**
   * Localiza um item na Outbox pelo identificador único.
   * Aplica isolamento de tenant da sessão ativa por padrão.
   * Permite bypass explícito exclusivamente para rotinas técnicas de recuperação.
   * @param {string} id
   * @param {Object} [options={}]
   * @param {boolean} [options.allowCrossTenant=false]
   * @returns {Promise<Object|null>}
   */
  async findById(id, options = {}) {
    if (!id) return null;
    const db = await getDB();
    const item = (await db.get(this.storeName, id)) || null;
    if (!item) return null;

    if (!options.allowCrossTenant) {
      const curTenant = getCurrentTenant();
      if (curTenant && item.tenantId && item.tenantId !== curTenant) {
        return null;
      }
    }

    return item;
  }

  /**
   * Consulta um registro para recuperação técnica interna sem restrição de tenant de sessão.
   * Usado pelo SyncEngine durante crash recovery e verificação de leases órfãos.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findTechnicalRecord(id) {
    if (!id) return null;
    const db = await getDB();
    return (await db.get(this.storeName, id)) || null;
  }

  /**
   * Atualiza duravelmente um item na Outbox com salvaguardas rigorosas:
   * 1. Imutabilidade absoluta de identidade (tenantId, operationId, entityType, entityId).
   * 2. Isolamento multi-tenant: sessão ativa não pode sobrescrever payload comercial de outro tenant.
   * 3. Atualizações técnicas entre tenants (options.isTechnicalUpdate) restritas a metadados de ciclo de vida.
   * @param {Object} data
   * @param {Object} [options={}]
   * @param {boolean} [options.isTechnicalUpdate=false]
   * @returns {Promise<Object>}
   */
  async update(data, options = {}) {
    if (!data || !data.id) throw new Error('[SyncRepository] Atualização falhou: ID é obrigatório.');

    return await executeTransaction([this.storeName], 'readwrite', async (stores) => {
      const existing = await stores.syncQueue.get(data.id);
      if (!existing) {
        throw new Error(`[SyncRepository] Item da fila "${data.id}" não encontrado para atualização.`);
      }

      // Invariante 1: Imutabilidade estrita de campos de identidade
      if (data.tenantId !== undefined && data.tenantId !== existing.tenantId) {
        throw new Error(`[SyncRepository] Violação de segurança: alteração de tenantId em item da Outbox é estritamente proibida (original: "${existing.tenantId}", recebido: "${data.tenantId}").`);
      }
      if (data.operationId !== undefined && existing.operationId && data.operationId !== existing.operationId) {
        throw new Error('[SyncRepository] Violação de segurança: alteração de operationId em item da Outbox é estritamente proibida.');
      }
      if (data.entityType !== undefined && data.entityType !== existing.entityType) {
        throw new Error('[SyncRepository] Violação de integridade: alteração de entityType em item da Outbox é estritamente proibida.');
      }
      if (data.entityId !== undefined && data.entityId !== existing.entityId) {
        throw new Error('[SyncRepository] Violação de integridade: alteração de entityId em item da Outbox é estritamente proibida.');
      }
      if (data.canonicalPayloadHash !== undefined && existing.canonicalPayloadHash && data.canonicalPayloadHash !== existing.canonicalPayloadHash) {
        throw new Error('[SyncRepository] Violação de integridade: alteração de canonicalPayloadHash em item da Outbox é estritamente proibida.');
      }

      // Invariante 2: Isolamento multi-tenant para dados comerciais
      const curTenant = getCurrentTenant();
      if (curTenant && existing.tenantId && curTenant !== existing.tenantId) {
        if (!options.isTechnicalUpdate) {
          throw new Error(`[SyncRepository] Violação de isolamento multi-tenant: sessão do tenant "${curTenant}" não pode atualizar item do tenant "${existing.tenantId}".`);
        }
        // Em atualizações técnicas entre tenants (ex: interrupção em voo), proíbe alteração do payload comercial
        if (data.payload !== undefined && JSON.stringify(data.payload) !== JSON.stringify(existing.payload)) {
          throw new Error('[SyncRepository] Violação de segurança multi-tenant: atualização técnica de outro tenant não pode alterar o payload comercial.');
        }
      }

      // Em atualizações técnicas, alteração de payload comercial é estritamente proibida
      if (options.isTechnicalUpdate && data.payload !== undefined && !arePayloadsEquivalent(existing.entityType, existing.payload, data.payload)) {
        throw new Error('[SyncRepository] Violação de segurança: atualização técnica da Outbox não pode alterar o payload comercial.');
      }

      // Em qualquer atualização com payload comercial fornecido, o payload deve permanecer equivalente ao canônico existente
      if (data.payload !== undefined && existing.canonicalPayloadHash && !arePayloadsEquivalent(existing.entityType, existing.payload, data.payload)) {
        throw new Error('[SyncRepository] Violação de integridade: alteração de payload em item da Outbox sem equivalência semântica é estritamente proibida.');
      }

      data.updatedAt = new Date().toISOString();
      await stores.syncQueue.put(data);
      return data;
    });
  }

  /**
   * Verifica se há outra operação da mesma entidade em voo ou predecessora não sincronizada.
   * Garante a serialização estrita e a ordem causal FIFO por entidade, impedindo
   * que operações posteriores ultrapassem uma anterior ou rodem em paralelo na mesma entidade.
   * @param {string} entityType
   * @param {string} entityId
   * @param {string|null} tenantId
   * @param {string} currentItemId
   * @param {string} currentItemCreatedAt
   * @returns {Promise<boolean>}
   */
  async hasUnsyncedPredecessorOrInFlight(entityType, entityId, tenantId, currentItemId, currentItemCreatedAt) {
    const all = await this.findAll(false);
    const currentItem = all.find(i => i && i.id === currentItemId) || null;
    return all.some(other => {
      if (!other || other.id === currentItemId) return false;
      if (other.entityType !== entityType || other.entityId !== entityId) return false;
      if (tenantId && other.tenantId && other.tenantId !== tenantId) return false;

      // 1. Se outro item da mesma entidade está atualmente em voo ou SYNCING
      if (other.inFlight || other.status === 'SYNCING') return true;

      // 2. Se há item anterior da mesma entidade que ainda não foi SYNCED
      if (other.status !== 'SYNCED') {
        const otherTime = new Date(other.createdAt).getTime();
        const currTime = new Date(currentItemCreatedAt).getTime();
        if (otherTime < currTime) return true;
        if (otherTime === currTime) {
          if (currentItem && typeof other._seq === 'number' && typeof currentItem._seq === 'number' && other._seq !== currentItem._seq) {
            return other._seq < currentItem._seq;
          }
          if (currentItem?.payload?.version !== undefined && other.payload?.version !== undefined && other.payload.version !== currentItem.payload.version) {
            return other.payload.version < currentItem.payload.version;
          }
          if (String(other.id) < String(currentItemId)) return true;
        }
      }
      return false;
    });
  }

  /**
   * Busca mutação pendente ou em sincronização para uma entidade específica no escopo de tenant.
   * @param {string} entityType
   * @param {string} entityId
   * @param {string} [tenantId]
   * @returns {Promise<Object|null>}
   */
  async findPendingByEntity(entityType, entityId, tenantId = null) {
    const curTenant = tenantId || getCurrentTenant() || null;
    const all = await this.findAll(false);
    return all.find(
      item => item &&
              item.entityType === entityType &&
              item.entityId === entityId &&
              item.status !== 'SYNCED' &&
              (!curTenant || !item.tenantId || item.tenantId === curTenant)
    ) || null;
  }

  /**
   * Retorna todas as mutações pendentes ordenadas cronologicamente no escopo do tenant atual.
   * Exclui itens pendentes de outros tenants, itens sem tenant, itens em voo e itens com resolução pendente.
   * @returns {Promise<Array<Object>>}
   */
  async getPending() {
    const all = await this.findAll();
    const curTenant = getCurrentTenant();
    return all
      .filter(item => {
        if (item.status !== 'PENDING') return false;
        if (item.inFlight) return false;
        if (item.requiresResolution) return false;
        if (curTenant && item.tenantId !== curTenant) {
          return false;
        }
        if (curTenant && !item.tenantId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt) - new Date(b.createdAt);
        if (diff !== 0) return diff;
        if (typeof a._seq === 'number' && typeof b._seq === 'number' && a._seq !== b._seq) {
          return a._seq - b._seq;
        }
        return String(a.id).localeCompare(String(b.id));
      });
  }

  /**
   * Retorna itens com falha definitiva de sincronização no escopo do tenant atual.
   * @returns {Promise<Array<Object>>}
   */
  async getFailed() {
    const all = await this.findAll();
    const curTenant = getCurrentTenant();
    return all.filter(item => {
      if (item.status !== 'FAILED') return false;
      if (curTenant && item.tenantId !== curTenant) {
        return false;
      }
      return true;
    });
  }

  /**
   * Marca um item como sincronizado com sucesso dentro de uma transação atômica.
   * Valida a titularidade da tentativa (attemptId) para impedir que uma tentativa superada
   * marque SYNCED ou apague um conflito/bloqueio já identificado.
   * @param {string} id
   * @param {Object} [remoteMeta={}]
   * @param {string|null} [attemptId=null]
   * @returns {Promise<{ success: boolean, item: Object|null, superseded?: boolean, blockedByResolution?: boolean }>}
   */
  async markSynced(id, remoteMeta = {}, attemptId = null) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(id);
      if (!item) return { success: false, item: null };

      // Se a operação já estiver SYNCED, evita reescrita ou corrupção de estado
      if (item.status === 'SYNCED') {
        return { success: true, alreadySynced: true, item };
      }

      // Se um attemptId foi informado e divergir da concessão atual (ou concessão não mais ativa):
      if (attemptId && (!item.claimAttemptId || item.claimAttemptId !== attemptId)) {
        item.staleAttemptAcks = item.staleAttemptAcks || [];
        item.staleAttemptAcks.push({
          attemptId,
          recordedAt: new Date().toISOString(),
          remoteVersion: remoteMeta.remoteVersion || null,
          note: 'Tentativa superada tentou marcar SYNCED.'
        });
        await stores.syncQueue.put(item);
        return { success: false, superseded: true, item };
      }

      // Se a operação estiver sob bloqueio de resolução humana e a chamada não for resolução explícita:
      if (item.requiresResolution && !remoteMeta.forceResolveConflict) {
        return { success: false, blockedByResolution: true, item };
      }

      item.status = 'SYNCED';
      item.syncedAt = new Date().toISOString();
      item.syncedAttemptId = attemptId || item.claimAttemptId || null;
      item.remoteVersion = remoteMeta.remoteVersion || item.remoteVersion || null;
      item.remoteAckReceived = true;
      item.inFlight = false;
      item.claimedBy = null;
      item.claimAttemptId = null;
      item.claimExpiresAt = null;
      item.lastError = null;
      item.permanentFailure = false;
      item.requiresResolution = false;
      item.remoteOutcomeUnknown = false;
      item.updatedAt = new Date().toISOString();
      await stores.syncQueue.put(item);
      return { success: true, item };
    });
  }

  /**
   * Registra uma falha de sincronização e incrementa contador de tentativas atomicamente.
   * Falhas permanentes (ex: violação de permissão / segurança) não realizam retentativa infinita.
   * @param {string} id 
   * @param {string} errorMessage 
   * @param {number} [maxAttempts=5] 
   * @param {boolean} [permanent=false]
   * @param {Object} [meta={}]
   * @param {string|null} [attemptId=null]
   * @returns {Promise<{ success: boolean, item: Object|null, superseded?: boolean }>}
   */
  async markFailed(id, errorMessage, maxAttempts = 5, permanent = false, meta = {}, attemptId = null) {
    return await executeTransaction(['syncQueue'], 'readwrite', async (stores) => {
      const item = await stores.syncQueue.get(id);
      if (!item) return { success: false, item: null };

      // Se a tentativa foi superada por outra instância, não altera o estado corrente do item
      if (attemptId && item.claimAttemptId && item.claimAttemptId !== attemptId) {
        item.staleAttemptErrors = item.staleAttemptErrors || [];
        item.staleAttemptErrors.push({
          attemptId,
          recordedAt: new Date().toISOString(),
          error: errorMessage
        });
        await stores.syncQueue.put(item);
        return { success: false, superseded: true, item };
      }

      item.inFlight = false;
      item.attempts = (item.attempts || 0) + 1;
      item.lastAttemptAt = new Date().toISOString();
      item.lastError = errorMessage;
      item.updatedAt = new Date().toISOString();
      if (meta.errorCategory) {
        item.errorCategory = meta.errorCategory;
      }
      if (meta.requiresResolution !== undefined) {
        item.requiresResolution = !!meta.requiresResolution;
      }
      if (meta.remoteOutcomeUnknown !== undefined) {
        item.remoteOutcomeUnknown = !!meta.remoteOutcomeUnknown;
      }

      if (permanent || item.attempts >= maxAttempts) {
        item.status = 'FAILED';
        if (permanent) {
          item.permanentFailure = true;
        }
      } else {
        item.status = 'PENDING';
      }

      await stores.syncQueue.put(item);
      return { success: true, item };
    });
  }

  /**
   * Reativa itens com falha para nova tentativa de forma segura e controlada:
   * - Confirma que o item pertence ao tenant atual;
   * - Confirma que a ação continua autorizada para o papel atual;
   * - Valida a integridade estrutural da mutação;
   * - Previne reativação automática de falhas permanentes de integridade/schema;
   * - Preserva IDs e idempotência.
   *
   * @param {Object} [options={}]
   * @param {Object} [options.authService] Instância personalizada de AuthService para testes
   * @param {boolean} [options.force=false] Forçar reativação de falha permanente
   * @returns {Promise<{ retriedCount: number, skippedCount: number, skippedItems: Array<Object> }>}
   */
  async retryFailed(options = {}) {
    const failed = await this.getFailed();
    const curTenant = getCurrentTenant();
    const auth = options.authService || authService;
    const currentSession = auth ? auth.getCurrentSession() : null;
    const isAuthEnforced = auth ? (auth.isConfigured() || (currentSession !== null)) : false;
    const now = new Date().toISOString();

    let retriedCount = 0;
    let skippedCount = 0;
    const skippedItems = [];

    for (const item of failed) {
      // 1. Isolamento de tenant: item deve pertencer estritamente ao tenant atual se houver tenant ativo
      if (curTenant && item.tenantId !== curTenant) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'TENANT_MISMATCH' });
        continue;
      }

      // 1.1 Item legado sem tenant não pode ser enviado arbitrariamente
      if (curTenant && !item.tenantId) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'UNASSIGNED_LEGACY_ITEM' });
        continue;
      }

      // 2. Validação da estrutura mínima da operação
      if (!item.entityType || !item.action || !item.entityId) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'INVALID_MUTATION_STRUCTURE' });
        continue;
      }

      // 2.1 Validação de options.force: não pode operar como bypass genérico
      if (options.force) {
        if (!currentSession || (currentSession.role !== 'admin' && currentSession.appRole !== 'admin')) {
          skippedCount++;
          skippedItems.push({ id: item.id, reason: 'FORCE_RETRY_REQUIRES_ADMIN_ROLE' });
          continue;
        }
      }

      // 3. Conflito por divergência de payload remoto exige estratégia explícita de reconciliação
      if (item.errorCategory === 'payload_divergence_conflict' && (!options.force || !options.resolutionAction)) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'PAYLOAD_DIVERGENCE_REQUIRES_EXPLICIT_RESOLUTION' });
        continue;
      }

      // 4. Verificação de causa permanente de integridade (schema inválido, 400 bad request, objeto não encontrado)
      const isCorruptedOrMalformed = item.requiresResolution ||
        (item.errorCategory === 'permanent' &&
         !String(item.lastError || '').includes('403') &&
         !String(item.lastError || '').includes('não autorizada') &&
         !String(item.lastError || '').includes('permission'));

      if (isCorruptedOrMalformed && !options.force) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'MANUAL_RESOLUTION_REQUIRED' });
        continue;
      }

      // 4.1. Operação com resultado remoto desconhecido no ledger append-only requer reconciliação explícita
      if (item.remoteOutcomeUnknown && (item.entityType === 'stockMovements' || item.entityType === 'inventory') && !options.force) {
        skippedCount++;
        skippedItems.push({ id: item.id, reason: 'UNKNOWN_REMOTE_OUTCOME_REQUIRES_RECONCILIATION' });
        continue;
      }

      // 5. Re-validação de autorização do papel ativo
      if (isAuthEnforced) {
        const permCheck = checkPermission(currentSession, item.action, item.entityType);
        if (!permCheck.authorized) {
          skippedCount++;
          skippedItems.push({ id: item.id, reason: 'INSUFFICIENT_ROLE_PERMISSIONS' });
          continue;
        }
      }

      // Critérios satisfeitos: transiciona para PENDING de forma segura preservando estritamente entityId e payload
      item.status = 'PENDING';
      item.attempts = 0;
      item.lastError = null;
      item.permanentFailure = false;
      item.requiresResolution = false;
      item.remoteOutcomeUnknown = false;
      item.updatedAt = now;
      await this.update(item);
      retriedCount++;
    }

    return { retriedCount, skippedCount, skippedItems };
  }

  /**
   * Recupera itens que falharam EXCLUSIVAMENTE por erro de configuração de provedor
   * (versões anteriores enviavam para a API REST do Cloud Firestore, desativada no projeto).
   * Essas requisições foram rejeitadas antes de qualquer gravação remota, portanto o desfecho
   * remoto é conhecido (nada foi gravado) e o reenvio é seguro e idempotente.
   * Respeita isolamento de tenant e a matriz de permissões da sessão ativa.
   * @param {Object} [options={}]
   * @returns {Promise<{ recoveredCount: number }>}
   */
  async recoverProviderMisconfigurationFailures(options = {}) {
    const PROVIDER_MISCONFIG_PATTERNS = [
      'cloud firestore api has not been used',
      'firestore.googleapis.com',
      'erro ao salvar documento no firestore',
      'erro ao deletar documento no firestore',
      'firebase não configurado com project id e api key',
      'falha no upload para o supabase storage',
      'could not resolve host',
      'dns não existe',
      'enotfound',
      'failed to fetch',
      'fetch failed',
      'project paused',
      'pausado',
      '540',
      '503',
      'temporary_network'
    ];
    const failed = await this.getFailed();
    const curTenant = getCurrentTenant();
    const auth = options.authService || authService;
    const currentSession = auth ? auth.getCurrentSession() : null;
    const now = new Date().toISOString();
    let recoveredCount = 0;

    for (const item of failed) {
      const msg = String(item.lastError || '').toLowerCase();
      const cat = String(item.errorCategory || '').toLowerCase();
      if (!PROVIDER_MISCONFIG_PATTERNS.some((p) => msg.includes(p)) && cat !== 'temporary') continue;
      if (!item.tenantId || (curTenant && item.tenantId !== curTenant)) continue;
      if (!item.entityType || !item.action || !item.entityId) continue;
      if (currentSession && !checkPermission(currentSession, item.action, item.entityType).authorized) continue;

      item.status = 'PENDING';
      item.attempts = 0;
      item.lastError = null;
      item.errorCategory = null;
      item.permanentFailure = false;
      item.requiresResolution = false;
      item.remoteOutcomeUnknown = false;
      item.inFlightInterrupted = false;
      item.dispatchStarted = false;
      item.recoveredFromProviderMisconfig = true;
      item.updatedAt = now;
      await this.update(item, { isTechnicalUpdate: true });
      recoveredCount++;
    }
    return { recoveredCount };
  }

  /**
   * Remove da fila todos os itens já sincronizados.
   */
  async clearCompleted() {
    const all = await this.findAll();
    const synced = all.filter(item => item.status === 'SYNCED');
    for (const item of synced) {
      await this.hardDelete(item.id);
    }
  }

  /**
   * Retorna estatísticas consolidadas da fila de sincronização.
   * @returns {Promise<{ total: number, pending: number, syncing: number, synced: number, failed: number }>}
   */
  async getStats() {
    const all = await this.findAll();
    return {
      total: all.length,
      pending: all.filter(i => i.status === 'PENDING').length,
      syncing: all.filter(i => i.status === 'SYNCING').length,
      synced: all.filter(i => i.status === 'SYNCED').length,
      failed: all.filter(i => i.status === 'FAILED').length
    };
  }
}

export const syncRepository = new SyncRepository();
