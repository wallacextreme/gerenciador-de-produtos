/**
 * GestãoPro — Contrato Abstrato de Provedor em Nuvem (FASE 13)
 * Define a interface padrão para qualquer backend de sincronização (Firebase, Supabase, API Customizada).
 */
export class CloudProvider {
  /**
   * Nome identificador do provedor.
   * @returns {string}
   */
  getProviderName() {
    return 'BaseCloudProvider';
  }

  /**
   * Verifica se o provedor está configurado com credenciais válidas.
   * @returns {boolean}
   */
  isConfigured() {
    return false;
  }

  /**
   * Testa a conectividade com o serviço em nuvem.
   * @returns {Promise<{ success: boolean, message: string, latencyMs?: number }>}
   */
  async testConnection() {
    throw new Error('testConnection() deve ser implementado pela subclasse.');
  }

  /**
   * Envia uma mutação local para a nuvem.
   * @param {Object} changeItem Item da syncQueue
   * @returns {Promise<{ success: boolean, remoteId?: string, remoteVersion?: string, error?: string }>}
   */
  async pushChange(changeItem) {
    throw new Error('pushChange() deve ser implementado pela subclasse.');
  }

  /**
   * Busca alterações remotas ocorridas após determinado timestamp.
   * @param {string} entityType Tipo da entidade (ex: 'products')
   * @param {string|null} sinceTimestamp Data ISO ou null
   * @returns {Promise<{ items: Array<Object>, latestTimestamp: string }>}
   */
  async pullChanges(entityType, sinceTimestamp = null) {
    throw new Error('pullChanges() deve ser implementado pela subclasse.');
  }
}
