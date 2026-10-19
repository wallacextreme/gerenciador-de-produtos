import { App } from './app.js';
import { requestPersistentStorage } from './utils/storage.js';
import { getDB } from './db/connection.js';
import { pwaHandler } from './utils/pwa.js';
import { syncEngine } from './services/SyncEngine.js';
import { syncRepository } from './repositories/SyncRepository.js';
import { authService } from './services/AuthService.js';
import { imageSyncService } from './services/ImageSyncService.js';
import { SupabaseStorageProvider } from './sync/SupabaseStorageProvider.js';
import { FirebaseStorageProvider } from './sync/FirebaseStorageProvider.js';
import { initPublicDemoIfNeeded } from './demo/demoSeed.js';

// Application Entry Point
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Storage Permissions
    await requestPersistentStorage();
    
    // 2. Initialize Database and Migrations
    await getDB();
    
    // 2.1 Initialize Synthetic Demo Dataset if in Demo Mode or empty DB
    await initPublicDemoIfNeeded();
    
    // 3. Initialize PWA & Service Worker
    await pwaHandler.init();

    // 3.5 Initialize Authentication Service (PHASE 02)
    await authService.init();

    // 3.6 Configure Remote Image Storage Providers & Keep-Alive (PHASE 14.1)
    const supabaseProvider = new SupabaseStorageProvider();
    const firebaseStorageProvider = new FirebaseStorageProvider();
    if (firebaseStorageProvider.isConfigured()) {
      imageSyncService.registerProvider('firebase', firebaseStorageProvider);
    }
    if (supabaseProvider.isConfigured()) {
      imageSyncService.registerProvider('supabase', supabaseProvider);
      const preferredProvider = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_IMAGE_STORAGE_PROVIDER) || 'supabase';
      if (String(preferredProvider).toLowerCase() === 'supabase') {
        imageSyncService.setStorageProvider(supabaseProvider, 'supabase');
      }
      // Dispara Keep-Alive assíncrono não-bloqueante (throttled a cada 12h)
      supabaseProvider.pingKeepAlive().catch(() => {});
    } else if (firebaseStorageProvider.isConfigured()) {
      imageSyncService.setStorageProvider(firebaseStorageProvider, 'firebase');
    }

    // 4. Initialize Cloud Sync Engine (FASE 13)
    await syncEngine.init();

    // 4.1 Recuperação da Outbox sempre que a sessão estiver autenticada (a sessão pode
    // demorar a ser restaurada em redes lentas, por isso não rodamos apenas no boot).
    let lastRecoveredUid = null;
    authService.onAuthStateChanged(async ({ isAuthenticated, session }) => {
      if (!isAuthenticated || !session?.uid || lastRecoveredUid === session.uid) return;
      lastRecoveredUid = session.uid;
      try {
        await syncRepository.recoverProviderMisconfigurationFailures();
        await syncRepository.retryFailed();
      } catch (err) {
        console.warn('[Main] Aviso na recuperação da fila de sincronização:', err?.message);
      }
      syncEngine.triggerAutoSync(300);
    });

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
