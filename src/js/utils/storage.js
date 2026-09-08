/**
 * Utilitário para lidar com o armazenamento persistente do navegador (Storage API).
 * Verifica se o armazenamento local pode ser tratado como persistente, evitando a
 * expulsão de dados pelo sistema operacional de forma silenciosa.
 */

export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        const granted = await navigator.storage.persist();
        if (granted) {
          console.info('[Storage] Armazenamento persistente concedido.');
        } else {
          console.warn('[Storage] Armazenamento persistente negado. Os dados podem ser apagados pelo navegador se houver falta de espaço.');
        }
      } else {
        console.info('[Storage] Armazenamento já está configurado como persistente.');
      }
      return await navigator.storage.persisted();
    } catch (error) {
      console.error('[Storage] Erro ao solicitar armazenamento persistente:', error);
      return false;
    }
  } else {
    console.warn('[Storage] API de armazenamento persistente não suportada neste navegador.');
    return false;
  }
}
