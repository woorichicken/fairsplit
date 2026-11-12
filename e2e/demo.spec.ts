import { expect, test, type Page } from '@playwright/test';
import { fixtureProject } from '../src/ui/fixtures';

// 시연 경로 — 발표 때 누를 그 순서 그대로. 서버 없이 fixture(?fixture=v1)로 v1 → 이의 → v2 → 전원 동의 → paid 까지 간다.
// fixture 숫자는 S1 이 실제 Claude 로 받은 응답(Sora 19% → 23%)이다 — 기대값도 그 기록에서 읽는다.
const V1 = fixtureProject('v1');
const V2 = fixtureProject('v2');
const sharePct = (p: typeof V1, id: string) => p.proposal!.shares.find((s) => s.contributorId === id)!.percent;
const shareUsd = (p: typeof V1, id: string) => `$${p.proposal!.shares.find((s) => s.contributorId === id)!.amount.value}`;
const SHOT_DIR = process.env.S2_SHOT_DIR;

async function approveAs(page: Page, id: string, name: string) {
  await page.getByLabel('Viewing as').selectOption(id);
  await page.getByRole('button', { name: `Approve as ${name}` }).click();
}

async function shot(page: Page, name: string) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/s2r2-state-${name}.png` });
}

test('v1 → dispute → v2 → everyone approves → PayPal sends → receipt', async ({ page }) => {
  await page.goto('/p/sample?fixture=v1');
  await expect(page.getByRole('heading', { name: /Spring launch short/ })).toBeVisible();

  const sora = page.getByTestId('share-sora');
  await expect(sora).toContainText(`${sharePct(V1, 'sora')}%`);
  await expect(sora).toContainText(shareUsd(V1, 'sora'));

  // Sora 로 보고 이의를 건다 → AI 가 다시 읽는 중 → v2
  await page.getByLabel('Viewing as').selectOption('sora');
  await page.getByLabel(/Something missing\? Tell the AI/).fill("My two re-recordings weren't counted.");
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await expect(page.getByText(`Re-reading ${V1.log.length} log events`)).toBeVisible();

  await expect(page.getByRole('heading', { name: /Proposed split/ })).toContainText('v2');
  await expect(sora).toContainText(`${sharePct(V2, 'sora')}%`);
  await expect(sora).toContainText(`${sharePct(V1, 'sora')}% → ${sharePct(V2, 'sora')}%`);
  await expect(page.getByRole('note', { name: /What changed from v1/ })).toContainText('re-recordings');

  // 근거 칩을 누르면 왼쪽 로그 줄이 밝아진다
  await expect(page.getByTestId('log-e10')).toHaveAttribute('data-highlight', 'false');
  await sora.getByRole('button', { name: /e10 · Re-recording 1/ }).click();
  await expect(page.getByTestId('log-e10')).toHaveAttribute('data-highlight', 'true');
  await expect(page.getByTestId('log-e12')).toHaveAttribute('data-highlight', 'true');
  await expect(page.getByTestId('log-e02')).toHaveAttribute('data-highlight', 'false');

  // 사람별로 동의 — 마지막 동의에서 PayPal 이 보낸다
  await approveAs(page, 'mina', 'Mina');
  await expect(page.getByText('✓ Mina approved v2.')).toBeVisible();
  await approveAs(page, 'jun', 'Jun');
  await approveAs(page, 'sora', 'Sora');
  await expect(page.getByRole('heading', { name: 'PayPal is sending 3 payouts…' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Payout receipt' })).toBeVisible({ timeout: 10_000 });
  const soraPayout = page.getByTestId('payout-sora');
  await expect(soraPayout).toContainText(shareUsd(V2, 'sora'));
  await expect(soraPayout).toContainText('Sent');
  await expect(soraPayout).toContainText('SAMPLE-ITEM-3');
  await expect(page.getByRole('list', { name: 'Progress' }).getByRole('listitem').last()).toHaveClass(/step-done/);
});

test('Landing shows a real split card and Try the demo opens the project', async ({ page }) => {
  await page.goto('/?fixture=v1');
  const preview = page.getByRole('region', { name: 'Example split' });
  await expect(preview).toContainText('AI proposal');
  await expect(preview).toContainText('Sample');
  await expect(preview).toContainText(`${sharePct(V1, 'sora')}% → ${sharePct(V2, 'sora')}%`);
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/p\/sample\?fixture=v1$/);
  await expect(page.getByTestId('share-mina')).toBeVisible();
});

test('PayPal return calls fund/complete and the rule badge shows', async ({ page }) => {
  const ruled = { ...fixtureProject('v1'), id: 'p1' };
  ruled.proposal!.by = 'rule';
  let completeBody: unknown = null;
  await page.route('**/api/projects/p1/fund/complete', async (r) => {
    completeBody = r.request().postDataJSON();
    await r.fulfill({ json: ruled });
  });
  await page.goto('/p/p1?paypal=return&token=ORDER-123&PayerID=X');
  await expect(page.getByText('Rule-based fallback')).toBeVisible();
  expect(completeBody).toEqual({ orderId: 'ORDER-123' });
  await expect(page).toHaveURL(/\/p\/p1$/);
});

// ───── 상태 화면: 오류·느린 AI·없는 id ─────

test('state: 409 FUNDING_REQUIRED on the last approval is explained in plain words', async ({ page }) => {
  const unfunded = { ...fixtureProject('v2'), id: 'p2', order: { id: 'O-1', status: 'PAYER_ACTION_REQUIRED' } };
  await page.route('**/api/projects/p2', (r) => r.fulfill({ json: unfunded }));
  await page.route('**/api/projects/p2/approve', (r) =>
    r.fulfill({ status: 409, json: { error: { code: 'FUNDING_REQUIRED', message: 'Everyone else agreed, but the client has not authorized the PayPal payment yet.' } } }),
  );
  await page.goto('/p/p2');
  await expect(page.getByRole('heading', { name: /funds the job/ })).toBeVisible();
  await expect(page.getByText('Not funded yet')).toBeVisible();
  await page.getByRole('button', { name: 'Approve as Mina' }).click();
  await expect(page.getByRole('alert')).toContainText('has not authorized the PayPal payment yet');
  await shot(page, `409-${test.info().project.name}`);
});

test('state: 5xx shows a calm message, not the server text', async ({ page }) => {
  await page.route('**/api/projects/p3', (r) => r.fulfill({ json: { ...fixtureProject('v1'), id: 'p3' } }));
  await page.route('**/api/projects/p3/disputes', (r) => r.fulfill({ status: 502, json: { error: { code: 'PAYPAL_INTERNAL', message: 'upstream INTERNAL_SERVICE_ERROR at api-m' } } }));
  await page.goto('/p/p3');
  await page.getByLabel(/Something missing\? Tell the AI/).fill('Please re-check.');
  await page.getByRole('button', { name: 'Send dispute' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('No money was moved');
  await expect(alert).not.toContainText('INTERNAL_SERVICE_ERROR at api-m');
  await expect(page.getByTestId('share-sora')).toBeVisible(); // 화면이 비지 않는다
  await shot(page, `5xx-${test.info().project.name}`);
});

test('state: AI thinking for 15+ seconds tells the user about the fallback', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/projects/p4', (r) => r.fulfill({ json: { ...fixtureProject('v1'), id: 'p4' } }));
  await page.route('**/api/projects/p4/disputes', () => {
    /* 답하지 않는다 — 느린 AI */
  });
  await page.goto('/p/p4');
  await page.getByLabel(/Something missing\? Tell the AI/).fill('Please re-check.');
  await page.getByRole('button', { name: 'Send dispute' }).click();
  await expect(page.getByText(`Re-reading ${V1.log.length} log events`)).toBeVisible();
  await expect(page.getByText('taking longer than usual')).toHaveCount(0);
  await page.clock.fastForward(16_000);
  await expect(page.getByText(/taking longer than usual.*Rule-based fallback/)).toBeVisible();
  await shot(page, `slow-${test.info().project.name}`);
});

test('state: unknown project id (404)', async ({ page }) => {
  await page.route('**/api/projects/missing', (r) => r.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'nope' } } }));
  await page.goto('/p/missing');
  await expect(page.getByRole('alert')).toContainText('does not exist');
  await expect(page.getByRole('button', { name: 'Start a new demo' })).toBeVisible();
  await shot(page, `404-${test.info().project.name}`);
});
