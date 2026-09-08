/**
 * GestãoPro — Tauri Desktop Platform Adapter (FASE 12)
 * Implementação especializada para execução nativa desktop via Tauri v2 (Windows WebView2).
 * Mantém fallbacks seguros e nunca quebra quando executado fora do runtime Tauri.
 */
export class TauriAdapter {
  isTauri() {
    if (typeof window === 'undefined') return false;
    return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  }

  getPlatformName() {
    return 'Desktop (Windows Tauri)';
  }

  getPlatformType() {
    return 'tauri';
  }

  async openExternal(url) {
    if (typeof window !== 'undefined') {
      // Se houver API de shell do Tauri v2, pode delegar; senão, fallback seguro via window.open
      try {
        if (window.__TAURI__ && window.__TAURI__.shell && typeof window.__TAURI__.shell.open === 'function') {
          await window.__TAURI__.shell.open(url);
          return;
        }
      } catch (err) {
        console.warn('[TauriAdapter] Fallback para window.open:', err);
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  print() {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  }

  resolveImageUrl(imageRecord) {
    if (!imageRecord) return null;
    if (typeof imageRecord === 'string') return imageRecord;

    // No modelo com IndexedDB unificado, resolve Blobs normalmente
    const sourceBlob = imageRecord.thumbnailBlob || imageRecord.blob;
    if (sourceBlob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(sourceBlob);
    }
    return null;
  }

  revokeImageUrl(url) {
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}

export const tauriAdapter = new TauriAdapter();
