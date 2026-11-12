import { defineConfig } from 'vitest/config';

// e2e/*.spec.ts 는 Playwright 몫이다 — vitest 가 집어 가면 `pnpm test` 가 깨진다(11-12 실측).
export default defineConfig({ test: { include: ['worker/**/*.test.ts', 'src/**/*.test.ts'] } });
