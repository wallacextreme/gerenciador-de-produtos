import { deParaRepository } from '../repositories/DeParaRepository.js';
import { nfeImportRepository } from '../repositories/NFeImportRepository.js';
import { purchaseRepository } from '../repositories/PurchaseRepository.js';
import { supplierRepository } from '../repositories/SupplierRepository.js';
import { NFeValidationService } from './NFeValidationService.js';
import { getDB } from '../db/connection.js';

export class NFeProcessorService {
  /**
   * Processa a importação de uma NFe recém-parseada.
   * Faz a validação de regras, checa duplicidade, executa o De-Para, e salva na Staging Area.
   * @param {Object} nfe NFe normalizada
   */
  static async processNewImport(nfe) {
    // 1. Validação inicial e status
    const validationResult = await NFeValidationService.validate(nfe);
    nfe.status = validationResult.status;
    nfe.erros = validationResult.errors || [];
    nfe.avisos = validationResult.warnings || [];

    // 2. Identificação de Fornecedor
    if (nfe.emitente && nfe.emitente.cnpj) {
      const fornecedor = await supplierRepository.findByDocument(nfe.emitente.cnpj);
      if (fornecedor) {
        nfe.emitente.fornecedorId = fornecedor.id;
      } else {
        nfe.avisos.push('Fornecedor não encontrado no cadastro. A NFe usará o CNPJ como referência.');
      }
    }

    // 3. Checagem de Duplicidade (Apenas se não estiver com ERRO ou CANCELADA)
    if (nfe.status !== 'ERRO' && nfe.status !== 'CANCELADA') {
      const duplicidadeErro = await this._checkDuplicidade(nfe.cabecalho.chaveAcesso);
      if (duplicidadeErro) {
        nfe.status = 'DUPLICADA';
        nfe.erros.push(duplicidadeErro);
      }
    }

    // 4. Executar Motor De-Para (Se não houver erro que impeça)
    if (nfe.status !== 'ERRO' && nfe.status !== 'CANCELADA' && nfe.status !== 'DUPLICADA') {
      await this._executarMotorDePara(nfe);
    }

    // 5. Salvar na Staging Area
    const record = {
      id: crypto.randomUUID(),
      chaveAcesso: nfe.cabecalho.chaveAcesso,
      numero: nfe.cabecalho.numero,
      serie: nfe.cabecalho.serie,
      fornecedor: nfe.emitente.razaoSocial || nfe.emitente.nomeFantasia,
      cnpjFornecedor: nfe.emitente.cnpj,
      valorTotal: nfe.totais.valorTotalNota,
      dataEmissao: nfe.cabecalho.dataEmissao,
      dadosNormalizados: nfe,
      status: nfe.status,
      erros: nfe.erros,
      avisos: nfe.avisos
    };

    // Tenta atualizar se já estiver na staging e permitirmos sobrescrever, ou cria novo.
    // Como a duplicidade na staging é tratada, criaremos novo se não existir, 
    // ou atualizaremos se o usuário estiver reenviando. 
    // Mas o fluxo diz "mesma chave -> DUPLICADA", então salvamos como DUPLICADA se tentar inserir novo.
    const existenteNaStaging = await nfeImportRepository.findByChaveAcesso(nfe.cabecalho.chaveAcesso);
    if (existenteNaStaging) {
      record.id = existenteNaStaging.id;
      await nfeImportRepository.update(record);
    } else {
      await nfeImportRepository.create(record);
    }

    return record;
  }

  /**
   * Tenta resolver novamente o De-Para de uma NFe já na Staging.
   * Chamado quando o usuário salva novos vínculos manuais.
   * @param {string} idStaging 
   */
  static async reavaliarDePara(idStaging) {
    const record = await nfeImportRepository.findById(idStaging);
    if (!record) throw new Error('NFe não encontrada na Staging.');

    if (record.status !== 'REQUER_DE_PARA' && record.status !== 'ANALISANDO' && record.status !== 'PRONTA') {
      return record; // Não processa DUPLICADA, ERRO, etc.
    }

    await this._executarMotorDePara(record.dadosNormalizados);
    record.status = record.dadosNormalizados.status;
    
    await nfeImportRepository.update(record);
    return record;
  }

  static async _checkDuplicidade(chaveAcesso) {
    if (!chaveAcesso) return null;

    // A. Verifica no banco definitivo (purchases index)
    const db = await getDB();
    const compras = await db.getAllFromIndex('purchases', 'invoiceKey', chaveAcesso);
    if (compras && compras.length > 0) {
      return `Nota fiscal já importada no sistema (Encontrada em ${compras.length} item(s) de compra).`;
    }

    // B. Verifica na Staging
    const existente = await nfeImportRepository.findByChaveAcesso(chaveAcesso);
    if (existente && existente.status === 'PROCESSADA') {
      return 'Nota fiscal já processada anteriormente e finalizada.';
    }
    // Se existir na staging mas não estiver PROCESSADA, a UI decidirá se permite retomar ou avisa de duplicidade da tentativa.
    // No contexto do upload, tratar como duplicada ou atualizar? O fluxo instrui tratar como DUPLICADA se o usuário jogar o mesmo XML de novo e já estiver processado.
    if (existente) {
      return 'Esta NFe já está carregada na Fila de Conferência (Staging Area).';
    }

    return null;
  }

  static async _executarMotorDePara(nfe) {
    let requerAcao = false;
    const cnpj = nfe.emitente.cnpj;

    if (!cnpj) {
      nfe.status = 'ERRO';
      nfe.erros.push('Não é possível executar vínculo de produtos: CNPJ do emitente ausente.');
      return;
    }

    for (const item of nfe.itens) {
      const codigoForn = item.codigoFornecedor;
      
      const vinculo = await deParaRepository.findByFornecedorEProduto(cnpj, codigoForn);
      
      if (vinculo && vinculo.idProdutoInterno) {
        item.statusDePara = 'VINCULADO';
        item.idProdutoInterno = vinculo.idProdutoInterno;
        item.fatorConversao = vinculo.fatorConversao || 1;
      } else {
        item.statusDePara = 'PENDING';
        requerAcao = true;
      }
    }

    if (requerAcao) {
      nfe.status = 'REQUER_DE_PARA';
      if (!nfe.avisos.includes('Existem produtos na nota que precisam ser vinculados aos produtos do ERP.')) {
        nfe.avisos.push('Existem produtos na nota que precisam ser vinculados aos produtos do ERP.');
      }
    } else {
      nfe.status = 'PRONTA';
    }
  }
}
