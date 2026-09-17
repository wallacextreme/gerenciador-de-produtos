import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/gerenciador-de-produtos/' : './',
  plugins: [
    tailwindcss(),
  ],
  // Previne que o Vite limpe o terminal para manter logs do Rust/Tauri legíveis
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
    open: false
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'esnext'
  }
});
