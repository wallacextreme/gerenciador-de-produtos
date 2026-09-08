import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Platform, platform, WebAdapter, TauriAdapter } from '../src/js/platform/index.js';

describe('Tauri Desktop, Adapters & Multi-Plataforma (FASE 12)', () => {

  describe('Adapters de Plataforma (WebAdapter & TauriAdapter)', () => {
    it('WebAdapter deve identificar ambiente web por padrão e resolver URLs de imagem', () => {
      const adapter = new WebAdapter();
      expect(adapter.isTauri()).toBe(false);
      expect(adapter.getPlatformType()).toBe('web');

      const fakeBlob = new Blob(['test-image'], { type: 'image/webp' });
      const record = { id: 'img-1', thumbnailBlob: fakeBlob };
      
      const url = adapter.resolveImageUrl(record);
      expect(typeof url).toBe('string');

      // Testar revogação sem erro
      expect(() => adapter.revokeImageUrl(url)).not.toThrow();
    });

    it('TauriAdapter deve manter fallbacks seguros e retornar tipo tauri', () => {
      const adapter = new TauriAdapter();
      expect(adapter.getPlatformType()).toBe('tauri');
      expect(adapter.getPlatformName()).toBe('Desktop (Windows Tauri)');

      const fakeBlob = new Blob(['test-image-tauri'], { type: 'image/webp' });
      const record = { id: 'img-2', blob: fakeBlob };

      const url = adapter.resolveImageUrl(record);
      expect(typeof url).toBe('string');
      expect(() => adapter.revokeImageUrl(url)).not.toThrow();
    });

    it('Platform Facade deve prover detecção consistente de ambiente', () => {
      const p = new Platform();
      const info = p.getPlatformInfo();

      expect(info).toHaveProperty('type');
      expect(info).toHaveProperty('name');
      expect(info).toHaveProperty('isDesktop');
      expect(info).toHaveProperty('isPWA');
      expect(info).toHaveProperty('isWeb');
    });
  });

  describe('Configuração do Backend Tauri v2 (`src-tauri/`)', () => {
    const tauriConfPath = resolve(process.cwd(), 'src-tauri', 'tauri.conf.json');
    const cargoTomlPath = resolve(process.cwd(), 'src-tauri', 'Cargo.toml');
    const capabilitiesPath = resolve(process.cwd(), 'src-tauri', 'capabilities', 'default.json');
    const buildRsPath = resolve(process.cwd(), 'src-tauri', 'build.rs');
    const mainRsPath = resolve(process.cwd(), 'src-tauri', 'src', 'main.rs');
    const libRsPath = resolve(process.cwd(), 'src-tauri', 'src', 'lib.rs');

    it('deve possuir tauri.conf.json válido com identificador, versão e caminhos de build corretos', () => {
      expect(existsSync(tauriConfPath)).toBe(true);
      const raw = readFileSync(tauriConfPath, 'utf-8');
      const conf = JSON.parse(raw);

      expect(conf.productName).toBe('GestãoPro');
      expect(conf.version).toBe('1.12.0');
      expect(conf.identifier).toBe('com.gestaopro.app');
      expect(conf.build.frontendDist).toBe('../dist');
      expect(conf.build.devUrl).toBe('http://localhost:3000');
      expect(conf.bundle.active).toBe(true);
    });

    it('deve possuir Cargo.toml com crate gestaopro e tauri v2', () => {
      expect(existsSync(cargoTomlPath)).toBe(true);
      const content = readFileSync(cargoTomlPath, 'utf-8');

      expect(content).toContain('name = "gestaopro"');
      expect(content).toContain('version = "1.12.0"');
      expect(content).toContain('tauri = { version = "2"');
      expect(content).toContain('tauri-build = { version = "2"');
    });

    it('deve possuir capabilities com princípio do menor privilégio (core:default)', () => {
      expect(existsSync(capabilitiesPath)).toBe(true);
      const raw = readFileSync(capabilitiesPath, 'utf-8');
      const cap = JSON.parse(raw);

      expect(cap.identifier).toBe('default');
      expect(Array.isArray(cap.permissions)).toBe(true);
      expect(cap.permissions).toContain('core:default');
    });

    it('deve conter arquivos de código Rust nativos (build.rs, main.rs, lib.rs)', () => {
      expect(existsSync(buildRsPath)).toBe(true);
      expect(existsSync(mainRsPath)).toBe(true);
      expect(existsSync(libRsPath)).toBe(true);
    });

    it('deve possuir ícones desktop em src-tauri/icons/', () => {
      const icon192 = resolve(process.cwd(), 'src-tauri', 'icons', 'icon-192.png');
      const icon512 = resolve(process.cwd(), 'src-tauri', 'icons', 'icon-512.png');

      expect(existsSync(icon192)).toBe(true);
      expect(existsSync(icon512)).toBe(true);
    });
  });

  describe('Integração com Scripts do Projeto & Vite', () => {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    const viteConfigPath = resolve(process.cwd(), 'vite.config.js');

    it('package.json deve conter scripts tauri, tauri:dev e tauri:build na versão 1.12.0', () => {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(raw);

      expect(pkg.version).toBe('1.12.0');
      expect(pkg.scripts.tauri).toBe('tauri');
      expect(pkg.scripts['tauri:dev']).toBe('tauri dev');
      expect(pkg.scripts['tauri:build']).toBe('tauri build');
    });

    it('vite.config.js deve expor envPrefix TAURI_ e porta 3000 fixa', () => {
      const content = readFileSync(viteConfigPath, 'utf-8');

      expect(content).toContain('port: 3000');
      expect(content).toContain('strictPort: true');
      expect(content).toContain("envPrefix: ['VITE_', 'TAURI_']");
    });
  });
});
