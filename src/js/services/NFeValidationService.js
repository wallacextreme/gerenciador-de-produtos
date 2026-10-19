import { SettingsRepository } from '../repositories/SettingsRepository.js';

/**
 * Serviço responsável por validar as regras de negócio de uma NFe parseada.
 */
export class NFeValidationService {
  /**
   * Valida a NFe e determina seu status inicial na staging area.
   * Lança erros se a nota for estritamente inválida.
   * 
   * @param {Object} nfe NFe parseada pelo NFeParserService
   * @returns {Promise<Object>} Resultado da validação { isValid, status, errors, warnings }
   */
  static async validate(nfe) {
    const errors = [];
    const warnings = [];
    let status = 'IMPORTADA';

    // 1. Validação de Estrutura Mínima
    if (!nfe.cabecalho || !nfe.cabecalho.chaveAcesso) {
      errors.push('A NFe não possui Chave de Acesso.');
    }
    if (!nfe.emitente || !nfe.emitente.cnpj) {
      errors.push('A NFe não possui CNPJ do Emitente.');
    }
    if (!nfe.itens || nfe.itens.length === 0) {
      errors.push('A NFe não possui produtos detalhados (tag det).');
    }

    if (errors.length > 0) {
      return { isValid: false, status: 'ERRO', errors, warnings };
    }

    // 2. Validação de Destinatário (CNPJ da empresa configurada no ERP)
    // Busca o CNPJ da empresa nas configurações do sistema (companyProfile.cnpj ou legado companyCnpj)
    const settingsRepo = new SettingsRepository();
    const companyProfile = await settingsRepo.get('companyProfile', null);
    const companyCnpjSetting = await settingsRepo.findById('companyCnpj');
    const configuredCnpj = companyProfile?.cnpj || companyCnpjSetting?.value || '';
    
    if (configuredCnpj) {
      const expectedCnpj = String(configuredCnpj).replace(/\D/g, '');
      const xmlCnpj = (nfe.destinatario?.cnpj || '').replace(/\D/g, '');
      
      if (xmlCnpj && expectedCnpj && xmlCnpj !== expectedCnpj) {
        errors.push(`NFe emitida para CNPJ diferente (${xmlCnpj}). O CNPJ esperado é ${expectedCnpj}.`);
      }
    } else {
      warnings.push('CNPJ da empresa não configurado no sistema. A validação de destinatário foi ignorada.');
    }

    // 3. Status Fiscal (cStat)
    const cStat = nfe.statusFiscal?.cStat;
    if (cStat) {
      if (cStat === '100') {
        // Autorizado o uso - OK
        status = 'ANALISANDO';
      } else if (cStat === '101' || cStat === '151' || cStat === '135') {
        // Cancelada
        errors.push(`NFe Cancelada (Status ${cStat}: ${nfe.statusFiscal.xMotivo}).`);
        status = 'CANCELADA';
      } else if (cStat === '110' || cStat === '301' || cStat === '302' || cStat === '303') {
        // Denegada
        errors.push(`NFe Denegada (Status ${cStat}: ${nfe.statusFiscal.xMotivo}).`);
        status = 'ERRO';
      } else {
        warnings.push(`Status fiscal da NFe desconhecido ou não finalizado (${cStat}: ${nfe.statusFiscal.xMotivo}).`);
        status = 'ANALISANDO';
      }
    } else {
      warnings.push('NFe não possui protocolo de autorização (cStat ausente). Verifique se é um arquivo válido.');
      status = 'ANALISANDO';
    }

    return {
      isValid: errors.length === 0,
      status: errors.length > 0 ? (status === 'CANCELADA' ? 'CANCELADA' : 'ERRO') : status,
      errors,
      warnings
    };
  }
}
