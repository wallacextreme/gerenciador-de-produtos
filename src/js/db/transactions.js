import { getDB } from './connection.js';

/**
 * Cria uma transação no IndexedDB garantindo atomicidade.
 * O wrapper idb completa a transação automaticamente se a promessa do callback resolver.
 * Caso ocorra um erro dentro do callback, o rollback é feito automaticamente.
 * 
 * @param {string[]} storeNames Array com o nome das stores envolvidas
 * @param {string} mode 'readonly' ou 'readwrite'
 * @param {Function} callback Função que recebe as stores ({ storeName: storeObject, ... }) e executa as operações
 * @returns {Promise<any>} O resultado do callback
 */
export async function executeTransaction(storeNames, mode, callback) {
  const db = await getDB();
  const tx = db.transaction(storeNames, mode);
  
  // Impede que tx.done gere unhandled promise rejection em caso de abort
  tx.done.catch(() => {});
  
  // Mapear os object stores do tx em um dicionário mais amigável
  const stores = {};
  for (const name of storeNames) {
    stores[name] = tx.objectStore(name);
  }

  try {
    const result = await callback(stores);
    await tx.done; // Espera a transação completar no banco de dados com sucesso
    return result;
  } catch (error) {
    // tx.abort() ocorre automaticamente quando um erro é lançado dentro da Promise de uma store do idb,
    // ou se falhar antes, porém se capturamos e quisermos forçar, idb lida com rollback.
    // É importante repassar o erro para as camadas superiores.
    console.error(`[Transaction] Falha atômica nas stores ${storeNames.join(', ')}. Rollback acionado.`, error);
    try {
      tx.abort();
    } catch (abortErr) {
      // Ignora se a transação já foi abortada pelo engine
    }
    throw error;
  }
}
