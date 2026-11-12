import { expect, test } from '@playwright/test';

// 시연 경로 — 발표 때 누를 그 순서를 그대로 쓴다. 모델이 죽은 경우도 같이 본다.
test('입력 → 답', async ({ page }) => {
  await page.route('**/api/agent', (r) => r.fulfill({ json: { text: '예시 답', steps: [{ tool: 'look', result: '1건 찾음' }], by: 'ai' } }));
  await page.goto('/');
  await page.getByLabel('무엇을 도와 드릴까요?').fill('시험');
  await page.getByRole('button', { name: '찾기' }).click();
  await expect(page.getByText('예시 답')).toBeVisible();
});

test('API 가 죽으면 안내한다', async ({ page }) => {
  await page.route('**/api/agent', (r) => r.fulfill({ status: 500, body: '' }));
  await page.goto('/');
  await page.getByLabel('무엇을 도와 드릴까요?').fill('시험');
  await page.getByRole('button', { name: '찾기' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
