/**
 * GestãoPro — Web & PWA Platform Adapter (FASE 12)
 * Implementação padrão para navegadores modernos e modo PWA instalado.
 */
export class WebAdapter {
  isTauri() {
    return false;
  }

  getPlatformName() {
    if (typeof window !== 'undefined') {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      return isStandalone ? 'PWA Standalone' : 'Navegador Web';
    }
    return 'Web';
  }

  getPlatformType() {
    return 'web';
  }

  _isSafeExternalUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  async openExternal(url) {
    if (typeof window !== 'undefined') {
      if (!this._isSafeExternalUrl(url)) {
        console.warn('[WebAdapter] Tentativa de abrir URL insegura bloqueada:', url);
        return;
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

export const webAdapter = new WebAdapter();
