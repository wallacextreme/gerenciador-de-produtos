import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PWAHandler } from '../src/js/utils/pwa.js';
import { eventBus, EVENTS } from '../src/js/eventBus.js';

describe('PWA & Resiliência Offline (FASE 11)', () => {

  describe('Web App Manifest W3C & Ícones', () => {
    const manifestPath = resolve(process.cwd(), 'public', 'manifest.json');

    it('deve possuir arquivo manifest.json válido e bem formatado', () => {
      expect(existsSync(manifestPath)).toBe(true);
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);

      expect(manifest.name).toBe('GestãoPro — Gestão Comercial e Estoque');
      expect(manifest.short_name).toBe('GestãoPro');
      expect(manifest.start_url).toBe('/');
      expect(manifest.scope).toBe('/');
      expect(manifest.display).toBe('standalone');
      expect(manifest.background_color).toBe('#0f172a');
      expect(manifest.theme_color).toBe('#0f172a');
      expect(manifest.lang).toBe('pt-BR');
    });

    it('deve declarar ícones obrigatórios em múltiplos tamanhos e todos devem existir no disco', () => {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);

      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

      const expectedSizes = ['96x96', '144x144', '192x192', '512x512'];
      for (const size of expectedSizes) {
        const iconDef = manifest.icons.find((i) => i.sizes === size);
        expect(iconDef).toBeDefined();
        expect(iconDef.type).toBe('image/png');

        // Verifica existência do arquivo físico
        const iconPath = resolve(process.cwd(), 'public', iconDef.src.replace(/^\//, ''));
        expect(existsSync(iconPath)).toBe(true);
      }

      // Verifica ícone da Apple
      const appleTouchIconPath = resolve(process.cwd(), 'public', 'icons', 'apple-touch-icon.png');
      expect(existsSync(appleTouchIconPath)).toBe(true);
    });

    it('deve declarar atalhos rápidos (shortcuts) para Dashboard, PDV e Estoque com ícones existentes', () => {
      const raw = readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);

      expect(Array.isArray(manifest.shortcuts)).toBe(true);
      const urls = manifest.shortcuts.map((s) => s.url);
      expect(urls).toContain('/#/dashboard');
      expect(urls).toContain('/#/vendas');
      expect(urls).toContain('/#/estoque');

      for (const shortcut of manifest.shortcuts) {
        if (shortcut.icons && shortcut.icons.length > 0) {
          for (const sIcon of shortcut.icons) {
            const sIconPath = resolve(process.cwd(), 'public', sIcon.src.replace(/^\//, ''));
            expect(existsSync(sIconPath)).toBe(true);
          }
        }
      }
    });
  });

  describe('Service Worker (public/sw.js) & Estratégias de Cache', () => {
    const swPath = resolve(process.cwd(), 'public', 'sw.js');

    it('deve possuir o arquivo sw.js com versionamento explícito e App Shell pré-cacheado', () => {
      expect(existsSync(swPath)).toBe(true);
      const content = readFileSync(swPath, 'utf-8');

      // Versionamento explícito
      expect(content).toContain('const CACHE_VERSION =');
      expect(content).toMatch(/gestaopro-v1\.\d+\.\d+/);

      // Definição dos caches
      expect(content).toContain('-static');
      expect(content).toContain('-runtime');

      // Shell Assets
      expect(content).toContain("'/index.html'");
      expect(content).toContain("'/manifest.json'");
      expect(content).toContain("'/icons/icon-192.png'");
      expect(content).toContain("'/icons/icon-512.png'");
      expect(content).toContain("'/icons/apple-touch-icon.png'");
    });

    it('deve conter tratamento para ciclo de vida do SW (install, activate, fetch, message)', () => {
      const content = readFileSync(swPath, 'utf-8');

      expect(content).toContain("addEventListener('install'");
      expect(content).toContain("addEventListener('activate'");
      expect(content).toContain("addEventListener('fetch'");
      expect(content).toContain("addEventListener('message'");

      // Deve lidar com SKIP_WAITING e GET_VERSION
      expect(content).toContain('SKIP_WAITING');
      expect(content).toContain('GET_VERSION');
    });

    it('deve conter limpeza segura de versões anteriores de cache sem tocar no IndexedDB', () => {
      const content = readFileSync(swPath, 'utf-8');

      expect(content).toContain('caches.delete');
      expect(content).toContain('clients.claim');

      // O SW não deve manipular IndexedDB
      expect(content).not.toContain('indexedDB.deleteDatabase');
    });

    it('deve implementar estratégias diferenciadas de rede: Network First para navegação e Cache First para assets Vite', () => {
      const content = readFileSync(swPath, 'utf-8');

      expect(content).toContain('networkFirst');
      expect(content).toContain('cacheFirst');
      expect(content).toContain('staleWhileRevalidate');
      expect(content).toContain("url.pathname.startsWith('/assets/')");
    });
  });

  describe('PWAHandler — Utilitário de Ciclo de Vida e Rede', () => {
    let handler;

    beforeEach(() => {
      handler = new PWAHandler();
    });

    it('deve inicializar com estado online padrão e sem prompts pendentes', () => {
      expect(handler.isOnline).toBe(true);
      expect(handler.isInstallable).toBe(false);
      expect(handler.deferredPrompt).toBeNull();
      expect(handler.waitingWorker).toBeNull();
    });

    it('deve emitir evento de status offline com mensagem padronizada não-intrusiva', () => {
      let eventPayload = null;
      const unsub = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, (payload) => {
        eventPayload = payload;
      });

      handler._handleNetworkChange(false);

      expect(handler.isOnline).toBe(false);
      expect(eventPayload).not.toBeNull();
      expect(eventPayload.isOnline).toBe(false);
      expect(eventPayload.message).toBe('Você está offline. Os dados locais continuam disponíveis.');

      unsub();
    });

    it('deve emitir evento de reconexão online com mensagem padronizada', () => {
      let eventPayload = null;
      const unsub = eventBus.on(EVENTS.NETWORK_STATUS_CHANGED, (payload) => {
        eventPayload = payload;
      });

      handler._handleNetworkChange(true);

      expect(handler.isOnline).toBe(true);
      expect(eventPayload).not.toBeNull();
      expect(eventPayload.isOnline).toBe(true);
      expect(eventPayload.message).toBe('Conexão restaurada.');

      unsub();
    });

    it('deve gerenciar notificação de atualização pronta (PWA_UPDATE_READY)', () => {
      let updateReadyPayload = null;
      const unsub = eventBus.on(EVENTS.PWA_UPDATE_READY, (payload) => {
        updateReadyPayload = payload;
      });

      handler._notifyUpdateReady();

      expect(updateReadyPayload).not.toBeNull();
      expect(typeof updateReadyPayload.applyUpdate).toBe('function');

      unsub();
    });

    it('deve retornar null em promptInstall se deferredPrompt não estiver configurado', async () => {
      const result = await handler.promptInstall();
      expect(result).toBeNull();
    });

    it('deve executar promptInstall com sucesso quando deferredPrompt existir', async () => {
      const fakePrompt = {
        prompt: mock(() => {}),
        userChoice: Promise.resolve({ outcome: 'accepted' })
      };

      handler.deferredPrompt = fakePrompt;
      handler.isInstallable = true;

      const result = await handler.promptInstall();
      expect(fakePrompt.prompt).toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'accepted' });
      expect(handler.deferredPrompt).toBeNull();
      expect(handler.isInstallable).toBe(false);
    });

    it('deve enviar SKIP_WAITING ao acionar applyUpdate', () => {
      const postMessageMock = mock(() => {});
      handler.waitingWorker = { postMessage: postMessageMock };

      handler.applyUpdate();
      expect(postMessageMock).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    it('deve detectar modo de execução standalone com segurança', () => {
      const isStandalone = handler.isStandalone();
      expect(typeof isStandalone).toBe('boolean');
    });
  });
});
