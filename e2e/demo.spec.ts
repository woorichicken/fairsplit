import { expect, test, type Page } from '@playwright/test';

// 시연 경로 — 발표 때 누를 그 순서 그대로. 서버 없이 fixture(?fixture=v1)로 v1 → 이의 → v2 → 전원 동의 → paid 까지 간다.

async function approveAs(page: Page, id: string, name: string) {
  await page.getByLabel('Viewing as').selectOption(id);
  await page.getByRole('button', { name: `Approve as ${name}` }).click();
}

test('v1 → dispute → v2 → everyone approves → PayPal sends → receipt', async ({ page }) => {
  await page.goto('/p/sample?fixture=v1');
  await expect(page.getByRole('heading', { name: /Spring launch short/ })).toBeVisible();

  const sora = page.getByTestId('share-sora');
  await expect(sora).toContainText('20%');
  await expect(sora).toContainText('$120.00');

  // Sora 로 보고 이의를 건다 → AI 가 다시 읽는 중 → v2
  await page.getByLabel('Viewing as').selectOption('sora');
  await page.getByLabel(/Something missing\? Tell the AI/).fill("My two re-recordings weren't counted.");
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await expect(page.getByText(/Re-reading 16 log events/)).toBeVisible();

  await expect(page.getByRole('heading', { name: /Proposed split/ })).toContainText('v2');
  await expect(sora).toContainText('26%');
  await expect(sora).toContainText('20% → 26%');
  await expect(page.getByRole('note', { name: /What changed from v1/ })).toContainText('re-recordings');

  // 근거 칩을 누르면 왼쪽 로그 줄이 밝아진다
  await expect(page.getByTestId('log-e11')).toHaveAttribute('data-highlight', 'false');
  await sora.getByRole('button', { name: /e11 · Re-recording 1/ }).click();
  await expect(page.getByTestId('log-e11')).toHaveAttribute('data-highlight', 'true');
  await expect(page.getByTestId('log-e12')).toHaveAttribute('data-highlight', 'true');
  await expect(page.getByTestId('log-e2')).toHaveAttribute('data-highlight', 'false');

  // 사람별로 동의 — 마지막 동의에서 PayPal 이 보낸다
  await approveAs(page, 'mina', 'Mina');
  await expect(page.getByText('✓ Mina approved v2.')).toBeVisible();
  await approveAs(page, 'jun', 'Jun');
  await approveAs(page, 'sora', 'Sora');
  await expect(page.getByRole('heading', { name: 'PayPal is sending 3 payouts…' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Payout receipt' })).toBeVisible({ timeout: 10_000 });
  const soraPayout = page.getByTestId('payout-sora');
  await expect(soraPayout).toContainText('$156.00');
  await expect(soraPayout).toContainText('Sent');
  await expect(soraPayout).toContainText('SAMPLE-ITEM-3');
  await expect(page.getByRole('list', { name: 'Progress' }).getByRole('listitem').last()).toHaveClass(/step-done/);
});

test('Landing → Try the demo opens the project', async ({ page }) => {
  await page.goto('/?fixture=v1');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/p\/sample\?fixture=v1$/);
  await expect(page.getByTestId('share-mina')).toBeVisible();
});

test('server path: PayPal return calls fund/complete, rule badge, and errors are shown', async ({ page }) => {
  const { fixtureProject } = await import('../src/ui/fixtures');
  const ruled = fixtureProject('v1');
  ruled.proposal!.by = 'rule';
  let completeBody: unknown = null;

  await page.route('**/api/projects/p1/fund/complete', async (r) => {
    completeBody = r.request().postDataJSON();
    await r.fulfill({ json: { ...ruled, id: 'p1' } });
  });
  await page.goto('/p/p1?paypal=return&token=ORDER-123&PayerID=X');
  await expect(page.getByText('Rule-based fallback')).toBeVisible();
  expect(completeBody).toEqual({ orderId: 'ORDER-123' });
  await expect(page).toHaveURL(/\/p\/p1$/);

  // 서버 오류는 알림으로 — 화면이 비지 않는다
  await page.route('**/api/projects/p1/approve', (r) => r.fulfill({ status: 409, json: { error: { code: 'not_funded', message: 'The client payment is not authorized yet.' } } }));
  await page.getByRole('button', { name: 'Approve as Mina' }).click();
  await expect(page.getByRole('alert')).toContainText('not authorized yet');

  await page.route('**/api/projects/missing', (r) => r.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'nope' } } }));
  await page.goto('/p/missing');
  await expect(page.getByRole('alert')).toContainText('does not exist');
});
