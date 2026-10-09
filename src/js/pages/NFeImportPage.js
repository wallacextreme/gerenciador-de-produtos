import { NFeParserService } from '../services/NFeParserService.js';
import { NFeProcessorService } from '../services/NFeProcessorService.js';
import { NFeTransactionService } from '../services/NFeTransactionService.js';
import { nfeImportRepository } from '../repositories/NFeImportRepository.js';
import { deParaRepository } from '../repositories/DeParaRepository.js';
import { productRepository } from '../repositories/ProductRepository.js';
import { MoneyService } from '../domain/MoneyService.js';

export class NFeImportPage {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.nfes = [];
    this.allProducts = []; // Para o motor de busca do De-Para
  }

  async render() {
    this.rootElement.innerHTML = `
      <div class="flex flex-col h-full space-y-6">
        
        <!-- Upload Area -->
        <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-col items-center justify-center border-dashed border-2 bg-slate-50 transition-colors" id="nfe-dropzone">
          <div class="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
          </div>
          <h3 class="text-base font-bold text-slate-800">Importar XML de NFe</h3>
          <p class="text-xs text-slate-500 max-w-sm text-center mb-4 mt-1">Arraste os arquivos .xml aqui ou clique para selecionar. Múltiplos arquivos são suportados.</p>
          
          <input type="file" id="nfe-file-input" accept=".xml" multiple class="hidden" />
          <button id="btn-browse-files" class="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
            Procurar Arquivos
          </button>
        </div>

        <!-- Toolbar -->
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
            Fila de Conferência (Staging)
          </h2>
          <button id="btn-process-batch" class="px-5 py-2 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 transition shadow-xs flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            Processar Notas Prontas
          </button>
        </div>

        <!-- Tabela Staging -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex-1 flex flex-col">
          <div class="overflow-x-auto flex-1">
            <table class="w-full text-left text-sm text-slate-600">
              <thead class="bg-slate-50 text-xs font-bold uppercase text-slate-500 border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th scope="col" class="py-3.5 px-4">Fornecedor</th>
                  <th scope="col" class="py-3.5 px-3">Número / Série</th>
                  <th scope="col" class="py-3.5 px-3">Data Emissão</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Valor Total</th>
                  <th scope="col" class="py-3.5 px-3 text-center">Status</th>
                  <th scope="col" class="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody id="nfe-table-body" class="divide-y divide-slate-100">
                <!-- Conteúdo gerado via JS -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <div id="nfe-modal-container"></div>
    `;

    this.bindEvents();
    this.allProducts = await productRepository.list({ status: 'active' });
    await this.loadData();
  }

  async loadData() {
    try {
      const all = await nfeImportRepository.findAll();
      // Ordenar por data decrescente de importação
      all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      this.nfes = all;
      this.renderTable();
    } catch (e) {
      console.error('Erro ao carregar fila:', e);
    }
  }

  renderTable() {
    const tbody = this.rootElement.querySelector('#nfe-table-body');
    if (!tbody) return;

    if (this.nfes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Nenhuma NFe na fila de conferência.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.nfes.map(nfe => {
      const dataStr = nfe.dataEmissao ? new Date(nfe.dataEmissao).toLocaleDateString('pt-BR') : '-';
      const valor = MoneyService.format(Math.round(nfe.valorTotal * 100));
      const statusBadge = this._renderStatusBadge(nfe.status);

      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-3 px-4">
            <div class="font-bold text-slate-800 text-xs truncate max-w-[200px]" title="${this._esc(nfe.fornecedor)}">${this._esc(nfe.fornecedor)}</div>
            <div class="text-[10px] text-slate-400 font-mono">${this._esc(nfe.cnpjFornecedor)}</div>
          </td>
          <td class="py-3 px-3">
            <div class="font-semibold text-slate-700 text-xs">${this._esc(nfe.numero)}</div>
            <div class="text-[10px] text-slate-400">Série ${this._esc(nfe.serie)}</div>
          </td>
          <td class="py-3 px-3 text-xs text-slate-600">${dataStr}</td>
          <td class="py-3 px-3 text-center text-xs font-black text-slate-800">${valor}</td>
          <td class="py-3 px-3 text-center">${statusBadge}</td>
          <td class="py-3 px-4 text-right">
            ${nfe.status !== 'PROCESSADA' ? `
              <button data-action="review" data-id="${nfe.id}" class="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-100 transition">
                Conferir
              </button>
            ` : `
              <button data-action="delete" data-id="${nfe.id}" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Remover Histórico">
                <svg class="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  }

  _renderStatusBadge(status) {
    switch (status) {
      case 'PRONTA': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">🟢 PRONTA</span>';
      case 'REQUER_DE_PARA': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">🟡 REQUER AÇÃO</span>';
      case 'DUPLICADA': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">🔴 DUPLICADA</span>';
      case 'ERRO': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">🔴 ERRO</span>';
      case 'CANCELADA': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">🔴 CANCELADA</span>';
      case 'PROCESSADA': return '<span class="inline-flex px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">✅ PROCESSADA</span>';
      default: return `<span class="inline-flex px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">${this._esc(status)}</span>`;
    }
  }

  bindEvents() {
    const fileInput = this.rootElement.querySelector('#nfe-file-input');
    const btnBrowse = this.rootElement.querySelector('#btn-browse-files');
    const dropzone = this.rootElement.querySelector('#nfe-dropzone');
    const btnProcess = this.rootElement.querySelector('#btn-process-batch');
    const tbody = this.rootElement.querySelector('#nfe-table-body');

    btnBrowse?.addEventListener('click', () => fileInput.click());

    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.handleFiles(Array.from(e.target.files));
      }
      fileInput.value = ''; // Reset
    });

    // Drag and Drop
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('border-blue-400', 'bg-blue-50');
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('border-blue-400', 'bg-blue-50');
    });
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('border-blue-400', 'bg-blue-50');
      if (e.dataTransfer.files.length > 0) {
        await this.handleFiles(Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.xml')));
      }
    });

    btnProcess?.addEventListener('click', () => this.processBatch());

    tbody?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      
      const id = btn.dataset.id;
      const nfe = this.nfes.find(n => n.id === id);
      if (!nfe) return;

      if (btn.dataset.action === 'review') {
        this.openReviewModal(nfe);
      } else if (btn.dataset.action === 'delete') {
        if (confirm('Deseja remover este histórico da Staging Area?')) {
          nfeImportRepository.hardDelete(id).then(() => this.loadData());
        }
      }
    });
  }

  async handleFiles(files) {
    if (files.length === 0) return;
    
    // Mostra loading
    const dropzone = this.rootElement.querySelector('#nfe-dropzone');
    const originalContent = dropzone.innerHTML;
    dropzone.innerHTML = `<div class="text-blue-600 font-bold flex flex-col items-center"><span class="animate-spin text-3xl mb-2">↻</span>Processando ${files.length} arquivo(s)...</div>`;

    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = NFeParserService.parse(text);
        await NFeProcessorService.processNewImport(parsed);
      } catch (err) {
        console.error('Erro ao processar', file.name, err);
        alert(`Erro ao processar ${file.name}:\n${err.message}`);
      }
    }

    dropzone.innerHTML = originalContent;
    this.bindEvents(); // Re-bind dropzone events as innerHTML changed
    await this.loadData();
  }

  async processBatch() {
    const prontas = this.nfes.filter(n => n.status === 'PRONTA');
    if (prontas.length === 0) {
      alert('Não há notas com status PRONTA para processar.');
      return;
    }

    if (!confirm(`Deseja gravar definitivamente ${prontas.length} NFe(s) no estoque e financeiro?`)) {
      return;
    }

    const btnProcess = this.rootElement.querySelector('#btn-process-batch');
    const originalText = btnProcess.innerHTML;
    btnProcess.innerHTML = 'Processando...';
    btnProcess.disabled = true;

    let successCount = 0;
    let errors = [];

    for (const nfe of prontas) {
      try {
        await NFeTransactionService.processFinalEntry(nfe.id);
        successCount++;
      } catch (e) {
        errors.push(`NFe ${nfe.numero}: ${e.message}`);
      }
    }

    btnProcess.innerHTML = originalText;
    btnProcess.disabled = false;

    if (errors.length > 0) {
      alert(`Processamento finalizado com falhas.\n\nSucessos: ${successCount}\nFalhas: ${errors.length}\n\nErros:\n${errors.join('\n')}`);
    } else {
      alert(`✅ ${successCount} NFe(s) gravada(s) no sistema com sucesso!`);
    }

    await this.loadData();
  }

  // ==========================================
  // MODAL DE CONFERÊNCIA / DE-PARA
  // ==========================================

  openReviewModal(nfeRecord) {
    const nfe = nfeRecord.dadosNormalizados;
    const modalContainer = this.rootElement.querySelector('#nfe-modal-container');
    
    // Monta itens da nota
    const itensHtml = nfe.itens.map((item, index) => {
      const isVinculado = item.statusDePara === 'VINCULADO';
      const prodSelectOptions = this.allProducts.map(p => 
        `<option value="${p.id}" ${item.idProdutoInterno === p.id ? 'selected' : ''}>${this._esc(p.name)} (SKU: ${p.productCode || '-'})</option>`
      ).join('');

      return `
        <div class="p-3 border ${isVinculado ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50'} rounded-lg text-xs space-y-2 mb-2">
          <div class="flex justify-between items-start">
            <div>
              <strong class="text-slate-800">${item.codigoFornecedor} - ${this._esc(item.descricao)}</strong>
              <div class="text-[10px] text-slate-500 font-mono mt-0.5">EAN: ${item.ean || 'N/A'} | NCM: ${item.ncm || 'N/A'} | CFOP: ${item.cfop || 'N/A'}</div>
            </div>
            <div class="text-right">
              <span class="font-bold text-slate-800">${item.quantidade} ${item.unidade}</span>
              <div class="text-slate-600">Total: R$ ${item.valorTotal.toFixed(2)}</div>
            </div>
          </div>
          
          <div class="pt-2 border-t ${isVinculado ? 'border-emerald-100' : 'border-amber-100'} flex gap-3 items-end">
            <div class="flex-1">
              <label class="block text-[10px] font-bold uppercase text-slate-600 mb-1">Vincular a Produto Interno:</label>
              <select class="de-para-select w-full p-1.5 border border-slate-300 rounded text-xs" data-index="${index}">
                <option value="">Selecione o Produto correspondente...</option>
                ${prodSelectOptions}
              </select>
            </div>
            <div class="w-24">
              <label class="block text-[10px] font-bold uppercase text-slate-600 mb-1">Multiplicador:</label>
              <input type="number" step="0.001" value="${item.fatorConversao || 1}" class="de-para-fator w-full p-1.5 border border-slate-300 rounded text-xs text-center" data-index="${index}" title="Ex: XML tem 1 CX, Interno tem 10 UN. Fator = 10">
            </div>
            <button class="btn-salvar-vinculo px-3 py-1.5 bg-slate-800 text-white rounded font-semibold transition hover:bg-slate-700" data-index="${index}">
              Salvar Vínculo
            </button>
          </div>
        </div>
      `;
    }).join('');

    const avisosHtml = nfe.avisos.length > 0 ? `
      <div class="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs mb-4">
        <strong>Avisos:</strong><ul class="list-disc ml-4 mt-1">${nfe.avisos.map(a => `<li>${this._esc(a)}</li>`).join('')}</ul>
      </div>
    ` : '';

    const errosHtml = nfe.erros.length > 0 ? `
      <div class="p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-lg text-xs mb-4">
        <strong>Erros (Bloqueante):</strong><ul class="list-disc ml-4 mt-1">${nfe.erros.map(e => `<li>${this._esc(e)}</li>`).join('')}</ul>
      </div>
    ` : '';

    modalContainer.innerHTML = `
      <div class="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
          
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-2xl shrink-0">
            <div>
              <h3 class="text-base font-bold text-slate-800">Conferência de NFe - ${nfe.cabecalho.numero} / ${nfe.cabecalho.serie}</h3>
              <p class="text-xs text-slate-500">${this._esc(nfe.emitente.razaoSocial)} (CNPJ: ${nfe.emitente.cnpj})</p>
            </div>
            <button id="modal-close-btn" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition">
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <div class="p-6 overflow-y-auto flex-1 bg-white">
            ${errosHtml}
            ${avisosHtml}
            
            <div class="mb-4 text-sm">
              <div class="grid grid-cols-2 gap-4 border p-3 rounded-lg bg-slate-50 text-xs">
                <div><span class="text-slate-500">Chave de Acesso:</span> <br><strong class="font-mono text-[10px]">${nfe.cabecalho.chaveAcesso}</strong></div>
                <div><span class="text-slate-500">Data Emissão:</span> <br><strong>${new Date(nfe.cabecalho.dataEmissao).toLocaleString('pt-BR')}</strong></div>
                <div><span class="text-slate-500">Valor Produtos:</span> <br><strong>R$ ${nfe.totais.valorProdutos.toFixed(2)}</strong></div>
                <div><span class="text-slate-500">Total NFe:</span> <br><strong class="text-blue-700">R$ ${nfe.totais.valorTotalNota.toFixed(2)}</strong></div>
              </div>
            </div>

            <h4 class="text-sm font-bold text-slate-800 mb-2 border-b pb-1">Itens da Nota (${nfe.itens.length})</h4>
            <div id="de-para-list">
              ${itensHtml}
            </div>
          </div>

          <div class="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-between items-center shrink-0">
            <span class="text-xs text-slate-500">Status da Nota: ${this._renderStatusBadge(nfeRecord.status)}</span>
            <button id="modal-done-btn" class="px-5 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-semibold transition">
              Fechar e Reavaliar Nota
            </button>
          </div>
        </div>
      </div>
    `;

    // Lógica para salvar vínculo
    modalContainer.querySelectorAll('.btn-salvar-vinculo').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idx = e.target.dataset.index;
        const select = modalContainer.querySelector(`.de-para-select[data-index="${idx}"]`);
        const inputFator = modalContainer.querySelector(`.de-para-fator[data-index="${idx}"]`);
        
        const idProdutoInterno = select.value;
        const fatorConversao = parseFloat(inputFator.value);

        if (!idProdutoInterno) {
          alert('Selecione o produto interno.');
          return;
        }
        if (isNaN(fatorConversao) || fatorConversao <= 0) {
          alert('O fator de conversão deve ser um número maior que zero.');
          return;
        }

        const item = nfe.itens[idx];
        
        try {
          await deParaRepository.salvarVinculo({
            cnpjFornecedor: nfe.emitente.cnpj,
            codigoFornecedor: item.codigoFornecedor,
            eanFornecedor: item.ean,
            idProdutoInterno,
            fatorConversao
          });

          // Atualiza dados em memória localmente para reflexão visual
          item.statusDePara = 'VINCULADO';
          item.idProdutoInterno = idProdutoInterno;
          item.fatorConversao = fatorConversao;

          const row = e.target.closest('.border');
          row.classList.remove('border-amber-200', 'bg-amber-50');
          row.classList.add('border-emerald-200', 'bg-emerald-50/30');
          alert('Vínculo salvo com sucesso!');
        } catch (err) {
          alert('Erro ao salvar vínculo: ' + err.message);
        }
      });
    });

    const close = async () => {
      // Forçar reavaliação da nota antes de fechar
      try {
        await NFeProcessorService.reavaliarDePara(nfeRecord.id);
      } catch (e) {
        console.error('Erro na reavaliação', e);
      }
      modalContainer.innerHTML = '';
      await this.loadData();
    };

    modalContainer.querySelector('#modal-close-btn').addEventListener('click', close);
    modalContainer.querySelector('#modal-done-btn').addEventListener('click', close);
  }

  destroy() {
    //
  }

  _esc(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
  }
}
