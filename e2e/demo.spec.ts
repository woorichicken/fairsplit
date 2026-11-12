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
  await expect(preview).toContainText('Recorded example');
  await expect(page.getByText(/A recorded AI answer: Jun disputed .* kept every share\./)).toBeVisible();
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

// ───── 3회차: 자기 로그로 새 프로젝트 · 약한 이의 · 실제 데이터 영수증 ─────

test('Use your own log: the example creates a project and opens it', async ({ page }) => {
  const created = { ...fixtureProject('draft'), id: 'imp1', title: 'Podcast episode 12' };
  let sent: { contributors?: unknown[]; csv?: string; budget?: string } = {};
  await page.route('**/api/projects', async (r) => {
    sent = r.request().postDataJSON();
    await r.fulfill({ status: 201, json: created });
  });
  await page.route('**/api/projects/imp1', (r) => r.fulfill({ json: created }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your own log' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/p\/imp1$/);
  await expect(page.getByRole('heading', { name: 'Podcast episode 12' })).toBeVisible();
  expect(sent.contributors).toHaveLength(3);
  expect(sent.budget).toBe('450.00');
  expect(sent.csv?.split('\n')[0]).toBe('at,actor,kind,title,minutes,detail');
});

test('Use your own log: server problems are listed line by line', async ({ page }) => {
  await page.route('**/api/projects', (r) =>
    r.fulfill({ status: 400, json: { error: { code: 'IMPORT_INVALID', message: 'Line 3: kind "coffee" …', problems: ['Line 3: kind "coffee" must be one of brief, draft.', 'Cleo has no lines in the log.'] } } }),
  );
  await page.goto('/new');
  await page.getByRole('button', { name: 'Create project' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Please fix these');
  await expect(alert.getByRole('listitem')).toHaveCount(2);
  await expect(page).toHaveURL(/\/new$/);
});

test('weak dispute: the AI answer is shown next to the split', async ({ page }) => {
  await page.goto('/p/sample?fixture=v1');
  await page.getByRole('button', { name: /Try a weak dispute \(as Jun\)/ }).click();
  await expect(page.getByLabel('Viewing as')).toHaveValue('jun');
  await expect(page.getByLabel(/Something missing\? Tell the AI/)).toHaveValue('I should get 70% because editing is the hardest part.');
  await page.getByRole('button', { name: 'Send dispute' }).click();
  const note = page.getByRole('note', { name: 'AI answer to Jun' });
  await expect(note).toContainText('Jun: “I should get 70% because editing is the hardest part.”');
  await expect(note).toContainText('No change — the log doesn’t support this claim');
  await expect(note).toContainText('No change:');
  // 몫은 v1 그대로 — 화살표가 없다
  await expect(page.locator('.delta-up, .delta-down')).toHaveCount(0);
  await expect(page.locator('.dispute-answer')).toContainText('AI:');
});

test('real paid project: no Sample badge, PayPal IDs and unclaimed explained', async ({ page }) => {
  const paid = fixtureProject('paid');
  const real = {
    ...paid,
    id: 'real1',
    order: { id: '43510105SL835515C', status: 'CAPTURED', authorizationId: '07C37982KW8841448', captureId: '07C28288056195432' },
    payout: { ...paid.payout!, batchId: 'X62XZ7LSPKK3Y', items: paid.payout!.items.map((i, k) => ({ ...i, status: 'UNCLAIMED', payoutItemId: `ITEM${k}`, transactionId: `TX${k}` })) },
  };
  await page.route('**/api/projects/real1', (r) => r.fulfill({ json: real }));
  await page.goto('/p/real1');
  await expect(page.getByRole('heading', { name: 'Payout receipt' })).toBeVisible();
  await expect(page.getByText('Sample data')).toHaveCount(0);
  for (const id of ['43510105SL835515C', '07C37982KW8841448', '07C28288056195432', 'X62XZ7LSPKK3Y', 'TX0', 'ITEM2']) await expect(page.getByText(id)).toBeVisible();
  await expect(page.getByTestId('payout-sora')).toContainText('Unclaimed — PayPal emailed a claim link (receiver has no sandbox account)');
});

test('fund step tells the honor period and the sandbox test card', async ({ page }) => {
  await page.goto('/p/sample?fixture=draft');
  await expect(page.getByText(/up to 29 days \(3-day honor period\)/)).toBeVisible();
  await expect(page.getByText('4005 5192 0000 0004')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fund with PayPal (sandbox)' })).toBeVisible();
});
