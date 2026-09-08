/**
 * Domain Service: Operações Puras de Dinheiro.
 * Todo o sistema trata valores em "cents" (inteiros) para evitar erros de precisão float.
 */
export class MoneyService {
  /**
   * Converte uma string ou número flutuante (ex: 10.50 ou "10,50") para centavos (1050).
   * Suporta formatos: 10.50, 10,50, "R$ 10,50", "1.000,50"
   */
  static toCents(value) {
    if (value === null || value === undefined || value === '') return 0;
    
    if (typeof value === 'number') {
      return Math.round(value * 100);
    }
    
    if (typeof value === 'string') {
      // Remove R$, espaços
      let cleanStr = value.replace(/[R$\s]/g, '');
      
      // Checar se usa vírgula para decimal (ex: 1.000,50)
      if (cleanStr.includes(',') && cleanStr.includes('.')) {
        // Remove pontos de milhar e troca vírgula por ponto
        cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
      } else if (cleanStr.includes(',')) {
        // Apenas vírgula, ex: 10,50
        cleanStr = cleanStr.replace(',', '.');
      }
      // Se tiver apenas ponto e sem vírgula, assumimos que é decimal padrão (1000.50)
      
      const floatVal = parseFloat(cleanStr);
      if (isNaN(floatVal)) return 0;
      return Math.round(floatVal * 100);
    }
    
    return 0;
  }

  /**
   * Formata centavos em string Real padrão local.
   * @param {number} cents ex: 1050
   * @param {boolean} hideSymbol se true, retorna "10,50" invés de "R$ 10,50"
   */
  static format(cents, hideSymbol = false) {
    if (cents === null || cents === undefined || isNaN(cents)) cents = 0;
    
    const floatValue = cents / 100;
    const formatted = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2
    }).format(floatValue);

    if (hideSymbol) {
      return formatted.replace(/[R$\s]/g, '').trim();
    }
    
    return formatted;
  }

  /**
   * Retorna float para inputs `type="number" step="0.01"`
   */
  static toFloat(cents) {
    return cents / 100;
  }
}
