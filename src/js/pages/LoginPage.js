import { authService } from '../services/AuthService.js';

/**
 * GestãoPro — LoginPage (PHASE 02)
 * Interface moderna de login com Firebase Auth, suporte offline e tratamento de erros.
 */
export class LoginPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.isLoading = false;
    this.errorMessage = '';
    this.redirectUrl = '#/dashboard';
  }

  setRedirectUrl(url) {
    if (url && url !== '#/login') {
      this.redirectUrl = url;
    }
  }

  render() {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    this.rootElement.innerHTML = `
      <div class="min-h-full flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-slate-50">
        <div class="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div class="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-500/20 mb-4">
            <svg class="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
          </div>
          <h2 class="text-2xl font-black text-slate-900 tracking-tight">GestãoPro</h2>
          <p class="text-xs text-slate-500 font-medium mt-1">Acesso à Plataforma Comercial & Estoque</p>
        </div>

        <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
          <div class="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-2xl sm:px-10 border border-slate-200/60">
            
            <!-- Aviso de Rede Offline se aplicável -->
            ${!isOnline ? `
              <div class="mb-5 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 text-xs text-amber-800">
                <span class="text-base leading-none">⚠️</span>
                <div>
                  <p class="font-bold">Dispositivo Offline</p>
                  <p class="text-[11px] text-amber-700 mt-0.5">Para o primeiro acesso com novas credenciais é necessária conexão com a internet. Sessões anteriores permanecem ativas.</p>
                </div>
              </div>
            ` : ''}

            <!-- Mensagem de Erro -->
            <div id="login-error-container" class="${this.errorMessage ? '' : 'hidden'} mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
              <span class="text-rose-500 font-bold">✕</span>
              <span id="login-error-text">${this.errorMessage}</span>
            </div>

            <form id="form-login" class="space-y-5">
              <div>
                <label for="login-email" class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">E-mail</label>
                <div class="relative">
                  <input
                    id="login-email"
                    type="email"
                    autocomplete="email"
                    required
                    placeholder="operador@empresa.com"
                    class="block w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label for="login-password" class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Senha</label>
                <div class="relative">
                  <input
                    id="login-password"
                    type="password"
                    autocomplete="current-password"
                    required
                    placeholder="••••••••"
                    class="block w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>
              </div>

              <div class="pt-2">
                <button
                  type="submit"
                  id="btn-login-submit"
                  class="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all transform active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span id="btn-login-spinner" class="hidden w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span id="btn-login-text">Entrar no Sistema</span>
                </button>
              </div>
            </form>

            <!-- Rodapé informativo de segurança -->
            <div class="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                Sessão Segura
              </span>
              <span>Firebase Auth & IndexedDB</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const form = this.rootElement.querySelector('#form-login');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this._handleSubmit();
      });
    }
  }

  async _handleSubmit() {
    const emailInput = this.rootElement.querySelector('#login-email');
    const passwordInput = this.rootElement.querySelector('#login-password');
    const submitBtn = this.rootElement.querySelector('#btn-login-submit');
    const spinnerText = this.rootElement.querySelector('#btn-login-spinner');
    const btnText = this.rootElement.querySelector('#btn-login-text');
    const errorContainer = this.rootElement.querySelector('#login-error-container');
    const errorText = this.rootElement.querySelector('#login-error-text');

    const email = emailInput?.value || '';
    const password = passwordInput?.value || '';

    // Estado de Loading
    this.isLoading = true;
    if (submitBtn) submitBtn.disabled = true;
    if (spinnerText) spinnerText.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Autenticando...';
    if (errorContainer) errorContainer.classList.add('hidden');

    try {
      await authService.signIn(email, password);

      // Redireciona para a rota desejada
      window.location.hash = this.redirectUrl || '#/dashboard';
    } catch (err) {
      this.errorMessage = err.message || 'Erro ao realizar login.';
      if (errorContainer && errorText) {
        errorText.textContent = this.errorMessage;
        errorContainer.classList.remove('hidden');
      }
    } finally {
      this.isLoading = false;
      if (submitBtn) submitBtn.disabled = false;
      if (spinnerText) spinnerText.classList.add('hidden');
      if (btnText) btnText.textContent = 'Entrar no Sistema';
    }
  }

  destroy() {
    this.rootElement = null;
  }
}
