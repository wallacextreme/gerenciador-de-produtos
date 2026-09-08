import { App } from './app.js';
import { requestPersistentStorage } from './utils/storage.js';
import { getDB } from './db/connection.js';
import { pwaHandler } from './utils/pwa.js';
import { syncEngine } from './services/SyncEngine.js';

// Application Entry Point
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Storage Permissions
    await requestPersistentStorage();
    
    // 2. Initialize Database and Migrations
    await getDB();
    
    // 3. Initialize PWA & Service Worker
    await pwaHandler.init();

    // 4. Initialize Cloud Sync Engine (FASE 13)
    await syncEngine.init();

    // 5. Mount Application UI
    const app = new App();
    app.mount(document.getElementById('app'));
  } catch (error) {
    console.error('Falha ao inicializar a aplicação:', error);
    document.getElementById('app').innerHTML = `
      <div class="flex items-center justify-center h-full bg-red-50 text-red-600 p-4 text-center">
        <div>
          <h2 class="text-xl font-bold mb-2">Erro Fatal</h2>
          <p>O sistema não pôde ser carregado. Verifique o console.</p>
        </div>
      </div>
    `;
  }
});
