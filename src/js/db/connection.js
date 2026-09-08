import { openDB } from 'idb';
import { DB_NAME, DB_VERSION, migrations } from './migrations.js';

let dbPromise = null;

/**
 * Retorna a conexão global com o IndexedDB, abrindo o banco se necessário.
 * Inicializa com as migrations estruturadas.
 */
export async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        for (let v = oldVersion + 1; v <= newVersion; v++) {
          if (migrations[v]) {
            console.info(`[DB] Aplicando migration versão ${v}...`);
            migrations[v](db, transaction);
          }
        }
      },
      blocked() {
        console.warn('[DB] O banco de dados está bloqueado por outra aba aberta.');
      },
      blocking() {
        console.warn('[DB] Esta aba está bloqueando uma atualização em outra aba. Fechando conexão.');
        if (dbPromise) {
          dbPromise.then(db => db.close());
          dbPromise = null;
        }
      },
      terminated() {
        console.error('[DB] A conexão com o banco de dados foi encerrada inesperadamente.');
        dbPromise = null;
      }
    });
  }
  return dbPromise;
}

/**
 * Fecha a conexão com o banco de dados.
 */
export async function closeDB() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}
