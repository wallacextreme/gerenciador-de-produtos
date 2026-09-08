/**
 * Domain Service: Interdependência de Margem, Lucro e Markup.
 * Respeita regras matemáticas absolutas, bloqueia Margem >= 100% no cálculo de Venda.
 */
export class MarginService {
  /**
   * Calcula o lucro absoluto em centavos
   */
  static calculateProfit(saleCents, purchaseCents) {
    return (saleCents || 0) - (purchaseCents || 0);
  }

  /**
   * Calcula o Markup (Percentual sobre o custo)
   * Fórmula: (Lucro / Custo) * 100
   * Retorna float percentual. Ex: 30.5 => 30.5%
   */
  static calculateMarkup(saleCents, purchaseCents) {
    if (!purchaseCents || purchaseCents <= 0) return 0;
    const profit = this.calculateProfit(saleCents, purchaseCents);
    return (profit / purchaseCents) * 100;
  }

  /**
   * Calcula a Margem (Percentual sobre a venda)
   * Fórmula: (Lucro / Venda) * 100
   * Retorna float percentual. Ex: 30.5 => 30.5%
   */
  static calculateMargin(saleCents, purchaseCents) {
    if (!saleCents || saleCents <= 0) return 0;
    const profit = this.calculateProfit(saleCents, purchaseCents);
    return (profit / saleCents) * 100;
  }

  /**
   * Calcula o preço de venda baseado no custo e na margem desejada.
   * Fórmula: Venda = Custo / (1 - MargemDecimal)
   * @param {number} purchaseCents Custo em centavos
   * @param {number} marginPercent Margem (0 a 99.99)
   * @returns {number} saleCents
   */
  static calculateSaleFromMargin(purchaseCents, marginPercent) {
    if (!purchaseCents) return 0;
    if (marginPercent >= 100) {
      throw new Error('A margem de lucro não pode ser igual ou superior a 100%.');
    }
    const marginDecimal = marginPercent / 100;
    const saleFloat = (purchaseCents / 100) / (1 - marginDecimal);
    return Math.round(saleFloat * 100);
  }

  /**
   * Calcula o preço de venda baseado no custo e no markup desejado.
   * Fórmula: Venda = Custo * (1 + MarkupDecimal)
   */
  static calculateSaleFromMarkup(purchaseCents, markupPercent) {
    if (!purchaseCents) return 0;
    const markupDecimal = markupPercent / 100;
    const saleFloat = (purchaseCents / 100) * (1 + markupDecimal);
    return Math.round(saleFloat * 100);
  }
}
