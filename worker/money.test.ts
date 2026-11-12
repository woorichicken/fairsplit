import { describe, expect, it } from 'vitest';
import { allocate, allocateCents, fromCents, toCents } from './money';

describe('money', () => {
  it('문자열 금액 ↔ 센트', () => {
    expect(toCents('600.00')).toBe(60000);
    expect(toCents('0.5')).toBe(50);
    expect(toCents('7')).toBe(700);
    expect(fromCents(60000)).toBe('600.00');
    expect(fromCents(5)).toBe('0.05');
    expect(() => toCents('1.234')).toThrow();
    expect(() => toCents('-1')).toThrow();
  });

  it('나눠도 합이 예산과 정확히 같다 — 무작위 1,000번', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 1000; n += 1) {
      const total = Math.floor(rand() * 1_000_000) + 1;
      const k = 1 + Math.floor(rand() * 5);
      const cuts = Array.from({ length: k - 1 }, () => Math.floor(rand() * 101)).sort((a, b) => a - b);
      const percents = [...cuts, 100].map((c, i, arr) => c - (i ? arr[i - 1] : 0));
      const out = allocateCents(total, percents);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      out.forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
    }
  });

  it('남는 센트는 나머지가 큰 사람부터 — $1.00 을 33/33/34', () => {
    expect(allocateCents(100, [33, 33, 34])).toEqual([33, 33, 34]);
    expect(allocateCents(1, [33, 33, 34])).toEqual([0, 0, 1]);
    expect(allocate({ value: '600.00', currency: 'USD' }, [35, 39, 26]).map((m) => m.value)).toEqual(['210.00', '234.00', '156.00']);
  });

  it('합이 100 이 아니거나 정수가 아니면 거부', () => {
    expect(() => allocateCents(100, [50, 49])).toThrow();
    expect(() => allocateCents(100, [50.5, 49.5])).toThrow();
  });
});
