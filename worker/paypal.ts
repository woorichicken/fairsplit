// PayPal sandbox REST — 응답 모양은 11-12 13:10 실측(OAuth 200 · Orders 200 PAYER_ACTION_REQUIRED · 미승인 authorize 422 ORDER_NOT_APPROVED · Payouts 201 PENDING).
// payment_source.paypal.experience_context 로 만들면 승인 링크의 rel 이 'approve' 가 아니라 'payer-action' 이다(실측).
import type { Money } from '../src/shared/types';

export const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';
const TOKEN_SAFETY_MS = 60_000; // 만료 1분 전에 새로 받는다

export interface PayPalEnv { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string }

export class PayPalError extends Error {
  constructor(public status: number, public issue: string, message: string) {
    super(message);
  }
}

let cached: { token: string; until: number; clientId: string } | undefined;

async function token(env: PayPalEnv): Promise<string> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new PayPalError(500, 'NO_CREDENTIALS', 'PayPal sandbox credentials are not configured.');
  if (cached && cached.clientId === env.PAYPAL_CLIENT_ID && cached.until > Date.now()) return cached.token;
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new PayPalError(res.status, 'OAUTH_FAILED', `PayPal OAuth failed (${res.status}).`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, until: Date.now() + body.expires_in * 1000 - TOKEN_SAFETY_MS, clientId: env.PAYPAL_CLIENT_ID };
  return body.access_token;
}

async function call<T>(env: PayPalEnv, method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(env)}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId; // 같은 요청을 두 번 보내도 한 번만 처리된다(멱등)
  const res = await fetch(`${PAYPAL_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const details = json.details as { issue?: string; description?: string }[] | undefined;
    const issue = details?.[0]?.issue ?? String(json.name ?? 'PAYPAL_ERROR');
    throw new PayPalError(res.status, issue, `PayPal ${method} ${path.split('/').slice(0, 4).join('/')} → ${res.status} ${issue}: ${details?.[0]?.description ?? json.message ?? ''}`.trim());
  }
  return json as T;
}

interface OrderLink { href: string; rel: string }

export async function createOrder(env: PayPalEnv, o: { projectId: string; title: string; amount: Money; returnUrl: string; cancelUrl: string }): Promise<{ orderId: string; status: string; approveUrl: string }> {
  const out = await call<{ id: string; status: string; links: OrderLink[] }>(env, 'POST', '/v2/checkout/orders', {
    intent: 'AUTHORIZE',
    purchase_units: [{ reference_id: o.projectId, description: o.title.slice(0, 127), amount: { currency_code: o.amount.currency, value: o.amount.value } }],
    payment_source: { paypal: { experience_context: { return_url: o.returnUrl, cancel_url: o.cancelUrl, brand_name: 'FairSplit', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } },
  }, `fund-${o.projectId}-${Date.now()}`);
  const link = out.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new PayPalError(502, 'NO_APPROVE_LINK', 'PayPal did not return an approval link.');
  return { orderId: out.id, status: out.status, approveUrl: link.href };
}

export async function getOrder(env: PayPalEnv, orderId: string): Promise<{ status: string; authorizationId?: string }> {
  const out = await call<AuthorizedOrder>(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  return { status: out.status, authorizationId: out.purchase_units?.[0]?.payments?.authorizations?.[0]?.id };
}

interface AuthorizedOrder { id: string; status: string; purchase_units?: { payments?: { authorizations?: { id: string; status: string }[] } }[] }

/** 이미 authorize 된 주문이면(PayPal 이 422 ORDER_ALREADY_AUTHORIZED) 주문을 다시 읽어 같은 authorization id 를 돌려준다 — 돌아오기 화면이 두 번 불러도 안전. */
export async function authorizeOrder(env: PayPalEnv, orderId: string): Promise<{ status: string; authorizationId: string }> {
  try {
    const out = await call<AuthorizedOrder>(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, `auth-${orderId}`);
    const id = out.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    if (!id) throw new PayPalError(502, 'NO_AUTHORIZATION', 'PayPal authorized the order but returned no authorization id.');
    return { status: out.status, authorizationId: id };
  } catch (e) {
    if (e instanceof PayPalError && e.issue === 'ORDER_ALREADY_AUTHORIZED') {
      const again = await getOrder(env, orderId);
      if (again.authorizationId) return { status: again.status, authorizationId: again.authorizationId };
    }
    throw e;
  }
}

export async function captureAuthorization(env: PayPalEnv, authorizationId: string, projectId: string): Promise<{ captureId: string; status: string }> {
  const out = await call<{ id: string; status: string }>(env, 'POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { final_capture: true }, `capture-${projectId}`);
  return { captureId: out.id, status: out.status };
}

export interface PayoutRequestItem { contributorId: string; email: string; amount: Money; note: string }
interface PayoutBatch {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { payout_item_id: string; transaction_id?: string; transaction_status?: string; payout_item: { sender_item_id: string; amount: { value: string; currency: string } } }[];
}

export async function createPayout(env: PayPalEnv, senderBatchId: string, subject: string, items: PayoutRequestItem[]): Promise<{ batchId: string; status: string }> {
  const out = await call<PayoutBatch>(env, 'POST', '/v1/payments/payouts', {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: subject, email_message: 'Your agreed share from FairSplit.' },
    items: items.map((i) => ({ recipient_type: 'EMAIL', receiver: i.email, amount: { value: i.amount.value, currency: i.amount.currency }, sender_item_id: i.contributorId, note: i.note.slice(0, 4000) })),
  });
  return { batchId: out.batch_header.payout_batch_id, status: out.batch_header.batch_status };
}

export async function getPayout(env: PayPalEnv, batchId: string): Promise<{ status: string; items: { contributorId: string; status: string; payoutItemId: string; transactionId?: string; amount: Money }[] }> {
  const out = await call<PayoutBatch>(env, 'GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  return {
    status: out.batch_header.batch_status,
    items: (out.items ?? []).map((i) => ({
      contributorId: i.payout_item.sender_item_id,
      status: i.transaction_status ?? 'PENDING',
      payoutItemId: i.payout_item_id,
      transactionId: i.transaction_id,
      amount: { value: i.payout_item.amount.value, currency: 'USD' },
    })),
  };
}
