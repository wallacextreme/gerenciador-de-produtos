import { webAdapter } from './webAdapter.js';
import { tauriAdapter } from './tauriAdapter.js';

/**
 * GestãoPro — Platform Facade Singleton (FASE 12)
 * Roteia chamadas de sistema para o adapter apropriado (Web/PWA ou Tauri).
 */
export class Platform {
  constructor() {
    this._adapter = null;
    this._detectPlatform();
  }

  _detectPlatform() {
    if (tauriAdapter.isTauri()) {
      this._adapter = tauriAdapter;
    } else {
      this._adapter = webAdapter;
    }
  }

  get adapter() {
    // Redetecta dinamicamente se o runtime do Tauri tiver sido injetado após o carregamento inicial
    if (this._adapter === webAdapter && tauriAdapter.isTauri()) {
      this._adapter = tauriAdapter;
    }
    return this._adapter;
  }

  isDesktop() {
    return this.adapter.isTauri();
  }

  isPWA() {
    if (typeof window === 'undefined') return false;
    return (
      !this.isDesktop() &&
      (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
    );
  }

  isWeb() {
    return !this.isDesktop() && !this.isPWA();
  }

  getPlatformInfo() {
    return {
      type: this.adapter.getPlatformType(),
      name: this.adapter.getPlatformName(),
      isDesktop: this.isDesktop(),
      isPWA: this.isPWA(),
      isWeb: this.isWeb()
    };
  }

  async openExternal(url) {
    return this.adapter.openExternal(url);
  }

  print() {
    return this.adapter.print();
  }

  resolveImageUrl(imageRecord) {
    return this.adapter.resolveImageUrl(imageRecord);
  }

  revokeImageUrl(url) {
    return this.adapter.revokeImageUrl(url);
  }
}

export const platform = new Platform();
