// FairSplit API — 계약서 「API」 표. 상태 전이 규칙은 flow.ts, 돈은 money.ts, 제안은 split.ts, PayPal 은 paypal.ts.
// AI 는 제안만 한다. 돈은 전원 동의 뒤에만 움직인다(approve → capture → payouts).
import Anthropic from '@anthropic-ai/sdk';
import type { Project } from '../src/shared/types';
import { makeDemoProject, parseRecipients } from './demo';
import { buildImportedProject, ImportError } from './importer';
import { applyProposal, approve, assertCanFund, assertCanPropose, FlowError, invariantErrors, markCaptured, markFunded, markPaying, openDispute, startFunding, updatePayout } from './flow';
import { authorizeOrder, captureAuthorization, createOrder, createPayout, getPayout, PayPalError, type PayPalEnv } from './paypal';
import { propose, type CreateFn } from './split';
import { storeOf, type StoreEnv } from './store';

export { ProjectStore } from './store';

interface Env extends PayPalEnv, StoreEnv {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  DEMO_RECIPIENTS?: string; // JSON {mina, jun, sora} → sandbox personal 이메일
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const fail = (code: string, message: string, status: number): Response => json({ error: { code, message } }, status);
const nowIso = (): string => new Date().toISOString();
const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

function claude(env: Env): CreateFn | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined;
  // 재시도는 끈다 — 20초 안에 끝나야 하고, 실패하면 규칙 제안으로 간다.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  return (params, signal) => client.beta.messages.create(params, { signal });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

async function load(env: Env, id: string): Promise<Project> {
  const p = await storeOf(env).getProject(id);
  if (!p) throw new FlowError('NOT_FOUND', `No project "${id}".`, 404);
  return p;
}

async function save(env: Env, p: Project): Promise<Project> {
  const errs = invariantErrors(p);
  if (errs.length) throw new FlowError('INVARIANT', `Refusing to save a broken project: ${errs.join('; ')}`, 500);
  await storeOf(env).putProject(p);
  return p;
}

/** 전원 동의 → 묶어 둔 결제를 capture → Payouts 한 번. 실패하면 agreed 로 남고, 같은 approve 를 다시 부르면 이어서 한다. */
async function settle(env: Env, p: Project): Promise<void> {
  const prop = p.proposal!;
  if (!p.order?.captureId) {
    const cap = await captureAuthorization(env, p.order!.authorizationId!, p.id);
    markCaptured(p, cap.captureId, nowIso());
    await save(env, p); // capture 는 되돌릴 수 없다 — payout 전에 먼저 남긴다
  }
  const byId = new Map(p.contributors.map((c) => [c.id, c]));
  const items = prop.shares.filter((s) => Number(s.amount.value) > 0).map((s) => ({ contributorId: s.contributorId, email: byId.get(s.contributorId)!.paypalEmail, amount: s.amount, note: `${p.title} — your agreed ${s.percent}% (v${prop.version}).` }));
  // sender_batch_id 가 같으면 PayPal 이 두 번째 배치를 거절한다 → 중복 지급 방지.
  const batch = await createPayout(env, `${p.id}-v${prop.version}`, `FairSplit payout: ${p.title}`, items);
  markPaying(p, batch.batchId, batch.status, items.map((i) => ({ contributorId: i.contributorId, amount: i.amount, status: batch.status })), nowIso());
}

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const m = req.method;
  if (path === '/api/config' && m === 'GET') return json({ paypalClientId: env.PAYPAL_CLIENT_ID ?? '', env: 'sandbox' });
  if (path === '/api/demo/reset' && m === 'POST') {
    const b = await body(req);
    if (b.scenario !== undefined && b.scenario !== 'brand-short') return fail('UNKNOWN_SCENARIO', 'Only "brand-short" exists.', 400);
    return json(await save(env, makeDemoProject(newId(), nowIso(), parseRecipients(env.DEMO_RECIPIENTS))));
  }
  if (path === '/api/projects' && m === 'POST') {
    // 자기 로그로 새 프로젝트 — 검증은 importer.ts, 저장 직전 불변식은 save() 가 한 번 더 본다
    try {
      return json(await save(env, buildImportedProject(await body(req), newId(), nowIso())), 201);
    } catch (e) {
      if (e instanceof ImportError) return json({ error: { code: 'IMPORT_INVALID', message: e.problems[0], problems: e.problems } }, 400);
      throw e;
    }
  }
  const pm = /^\/api\/projects\/([A-Za-z0-9_-]{1,64})(\/[a-z/]+)?$/.exec(path);
  if (!pm) return fail('NOT_FOUND', `No route ${m} ${path}.`, 404);
  const [, id, action = ''] = pm;
  if (action === '' && m === 'GET') return json(await load(env, id));
  if (m !== 'POST') return fail('METHOD_NOT_ALLOWED', `${m} is not supported here.`, 405);
  const p = await load(env, id);
  const at = nowIso();

  switch (action) {
    case '/fund': {
      assertCanFund(p);
      const back = `${url.origin}/p/${p.id}`;
      const order = await createOrder(env, { projectId: p.id, title: p.title, amount: p.budget, returnUrl: `${back}?paypal=return`, cancelUrl: `${back}?paypal=cancel` });
      startFunding(p, order.orderId, order.status, at);
      await save(env, p);
      return json({ orderId: order.orderId, approveUrl: order.approveUrl });
    }
    case '/fund/complete': {
      const orderId = String((await body(req)).orderId ?? '');
      if (!orderId) return fail('MISSING_ORDER', 'orderId is required.', 400);
      // 돌아오기 화면이 두 번 불러도 같은 결과(멱등).
      if (p.order?.id === orderId && p.order.authorizationId) return json(p);
      if (p.order?.id !== orderId) return fail('ORDER_MISMATCH', 'This PayPal order does not belong to this project.', 400);
      const auth = await authorizeOrder(env, orderId);
      markFunded(p, orderId, auth.status, auth.authorizationId, at);
      return json(await save(env, p));
    }
    case '/propose': {
      assertCanPropose(p);
      const { proposal } = await propose(p, at, claude(env));
      applyProposal(p, proposal, nowIso());
      return json(await save(env, p));
    }
    case '/disputes': {
      const b = await body(req);
      openDispute(p, b.contributorId, b.text, `d${p.disputes.length + 1}`, at);
      await save(env, p); // 이의는 AI 가 죽어도 남아야 한다
      const { proposal } = await propose(p, nowIso(), claude(env));
      applyProposal(p, proposal, nowIso());
      return json(await save(env, p));
    }
    case '/approve': {
      const cid = (await body(req)).contributorId;
      // agreed 에 멈춘 경우(capture/payout 실패) 다시 부르면 정산만 이어서 한다.
      const allAgreed = p.status === 'agreed' ? true : approve(p, cid, at);
      if (!allAgreed) return json(await save(env, p));
      await save(env, p);
      try {
        await settle(env, p);
      } catch (e) {
        p.events.push({ at: nowIso(), text: `Payment step failed: ${e instanceof Error ? e.message : String(e)}. Approve again to retry.` });
        await save(env, p);
        throw e;
      }
      return json(await save(env, p));
    }
    case '/refresh': {
      if (p.status === 'paid') return json(p);
      if (p.status !== 'paying' || !p.payout) throw new FlowError('BAD_STATE', `Nothing to refresh while ${p.status}.`);
      const batch = await getPayout(env, p.payout.batchId);
      updatePayout(p, batch.status, batch.items.map((i) => ({ contributorId: i.contributorId, amount: i.amount, status: i.status, payoutItemId: i.payoutItemId, transactionId: i.transactionId })), at);
      return json(await save(env, p));
    }
    default:
      return fail('NOT_FOUND', `No route ${m} ${path}.`, 404);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      if (e instanceof FlowError) return fail(e.code, e.message, e.status);
      if (e instanceof PayPalError) return fail(`PAYPAL_${e.issue}`, e.message, e.status === 422 ? 409 : 502);
      console.error('unhandled', e);
      return fail('INTERNAL', 'Something went wrong on the server.', 500);
    }
  },
} satisfies ExportedHandler<Env>;
