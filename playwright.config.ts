import { defineConfig, devices } from '@playwright/test';

const PORT = 4319;
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'ko-KR' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: `node_modules/.bin/vite build && node_modules/.bin/vite preview --host 127.0.0.1 --port ${PORT} --strictPort`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: false },
});
