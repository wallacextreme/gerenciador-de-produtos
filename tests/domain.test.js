import { describe, it, expect } from 'bun:test';
import { MoneyService } from '../src/js/domain/MoneyService.js';
import { MarginService } from '../src/js/domain/MarginService.js';

describe('MoneyService', () => {
  it('deve converter R$ 89,90 para 8990 centavos', () => {
    expect(MoneyService.toCents('89,90')).toBe(8990);
  });

  it('deve converter R$ 0,01 para 1 centavo', () => {
    expect(MoneyService.toCents('0,01')).toBe(1);
  });

  it('deve converter R$ 1.000,50 para 100050 centavos', () => {
    expect(MoneyService.toCents('1.000,50')).toBe(100050);
  });

  it('deve converter R$ 999,99 para 99999 centavos', () => {
    expect(MoneyService.toCents('999,99')).toBe(99999);
  });

  it('deve converter número float 10.50 para 1050 centavos', () => {
    expect(MoneyService.toCents(10.50)).toBe(1050);
  });

  it('deve converter string com R$ para centavos', () => {
    expect(MoneyService.toCents('R$ 89,90')).toBe(8990);
  });

  it('deve retornar 0 para valor nulo ou vazio', () => {
    expect(MoneyService.toCents(null)).toBe(0);
    expect(MoneyService.toCents(undefined)).toBe(0);
    expect(MoneyService.toCents('')).toBe(0);
  });

  it('deve formatar 8990 centavos para R$ 89,90', () => {
    const formatted = MoneyService.format(8990);
    expect(formatted).toContain('89,90');
  });

  it('deve formatar 1 centavo para R$ 0,01', () => {
    const formatted = MoneyService.format(1);
    expect(formatted).toContain('0,01');
  });

  it('deve formatar 0 centavos para R$ 0,00', () => {
    const formatted = MoneyService.format(0);
    expect(formatted).toContain('0,00');
  });

  it('deve converter centavos para float corretamente', () => {
    expect(MoneyService.toFloat(8990)).toBe(89.90);
    expect(MoneyService.toFloat(1)).toBe(0.01);
  });
});

describe('MarginService', () => {
  it('deve calcular lucro absoluto em centavos', () => {
    expect(MarginService.calculateProfit(14286, 10000)).toBe(4286);
  });

  it('deve calcular lucro zero', () => {
    expect(MarginService.calculateProfit(5000, 5000)).toBe(0);
  });

  it('deve calcular lucro negativo', () => {
    expect(MarginService.calculateProfit(3000, 5000)).toBe(-2000);
  });

  it('deve calcular markup: compra 10000, venda 14286 => ~42.86%', () => {
    const markup = MarginService.calculateMarkup(14286, 10000);
    expect(markup).toBeCloseTo(42.86, 1);
  });

  it('deve retornar markup 0 quando custo é zero', () => {
    expect(MarginService.calculateMarkup(5000, 0)).toBe(0);
  });

  it('deve calcular margem: compra 10000, venda 14286 => ~30%', () => {
    const margin = MarginService.calculateMargin(14286, 10000);
    expect(margin).toBeCloseTo(30, 0);
  });

  it('deve retornar margem 0 quando venda é zero', () => {
    expect(MarginService.calculateMargin(0, 5000)).toBe(0);
  });

  it('deve calcular venda a partir da margem 30%: compra R$100 => venda R$142,86', () => {
    // purchaseCents=10000, margin=30%
    const saleCents = MarginService.calculateSaleFromMargin(10000, 30);
    expect(saleCents).toBe(14286);
  });

  it('deve lançar erro quando margem >= 100%', () => {
    expect(() => MarginService.calculateSaleFromMargin(10000, 100)).toThrow();
    expect(() => MarginService.calculateSaleFromMargin(10000, 150)).toThrow();
  });

  it('deve calcular venda a partir de margem 0% => venda = compra', () => {
    expect(MarginService.calculateSaleFromMargin(10000, 0)).toBe(10000);
  });

  it('deve calcular venda a partir de margem 50%: compra R$100 => venda R$200', () => {
    const saleCents = MarginService.calculateSaleFromMargin(10000, 50);
    expect(saleCents).toBe(20000);
  });

  it('deve calcular margem próxima de 100% sem quebrar (99.9%)', () => {
    // Margem 99.9%: Venda = 10000 / (1 - 0.999) = 10000 / 0.001 = 10_000_000
    const saleCents = MarginService.calculateSaleFromMargin(10000, 99.9);
    expect(saleCents).toBe(10000000);
  });

  it('deve calcular venda a partir do markup: compra R$100, markup 30% => venda R$130', () => {
    const saleCents = MarginService.calculateSaleFromMarkup(10000, 30);
    expect(saleCents).toBe(13000);
  });

  it('deve retornar 0 se custo é 0', () => {
    expect(MarginService.calculateSaleFromMargin(0, 30)).toBe(0);
    expect(MarginService.calculateSaleFromMarkup(0, 30)).toBe(0);
  });
});
