// 돈 계산은 AI 가 아니라 서버가 한다. 모든 계산은 센트 정수로 — 부동소수 덧셈은 600.00 을 599.99 로 만든다.
import type { Money } from '../src/shared/types';

const CENTS_PER_DOLLAR = 100;
const PERCENT_TOTAL = 100;

/** "600.00" → 60000. 소수 셋째 자리 이상이나 음수는 받지 않는다. */
export function toCents(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new Error(`금액 형식이 아니다: ${value}`);
  return Number(m[1]) * CENTS_PER_DOLLAR + Number((m[2] ?? '').padEnd(2, '0'));
}

export function fromCents(cents: number): string {
  return `${Math.floor(cents / CENTS_PER_DOLLAR)}.${String(cents % CENTS_PER_DOLLAR).padStart(2, '0')}`;
}

export const usd = (value: string): Money => ({ value: fromCents(toCents(value)), currency: 'USD' });

/**
 * largest remainder — 정수 total 을 정수 가중치 비율로 나눈다.
 * 1) 각자 floor(total × w / Σw) 를 받고 2) 남는 단위를 나머지가 큰 순서(같으면 앞사람)로 1씩 준다.
 * → 합은 언제나 total 과 정확히 같다.
 */
export function apportion(total: number, weights: number[]): number[] {
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error('가중치는 0 이상 정수여야 한다');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error('가중치 합이 0 이다');
  const raw = weights.map((w) => total * w); // 정수 곱 — 아직 나누지 않는다
  const base = raw.map((r) => Math.floor(r / sum));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r % sum })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

/** percent(정수, 합 100) → 센트. */
export function allocateCents(totalCents: number, percents: number[]): number[] {
  const sum = percents.reduce((a, b) => a + b, 0);
  if (sum !== PERCENT_TOTAL) throw new Error(`percent 합이 ${sum} 이다(100 이어야 한다)`);
  if (percents.some((p) => !Number.isInteger(p) || p < 0)) throw new Error('percent 는 0 이상 정수여야 한다');
  return apportion(totalCents, percents);
}

export function allocate(budget: Money, percents: number[]): Money[] {
  return allocateCents(toCents(budget.value), percents).map((c) => ({ value: fromCents(c), currency: 'USD' }));
}
