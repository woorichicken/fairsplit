# FairSplit

**Get paid for team work without the spreadsheet argument.**

A client funds one creative job through PayPal. FairSplit's AI reads the real production log —
script drafts, edit rounds, review comments, re-recordings — and **proposes** who gets what, with the
log lines that justify every share. Any contributor can dispute in plain words; the AI re-reads the log
and revises. When **every** contributor agrees, FairSplit captures the client's payment and PayPal sends
**one Payouts batch** to everyone.

> The AI never moves money. It only proposes. Money moves after unanimous approval.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

## Why

Small studios and creator collectives finish a job together, then split the money by memory, chat
threads and spreadsheets. It's slow, it's awkward, and the person who did the invisible work
(the re-record at 11pm, the fourth edit) is the one who gets under-counted. FairSplit makes the split
**explainable**: every percentage points back to evidence everyone can see.

## How it works

| Step | What happens | PayPal / AI |
|---|---|---|
| 1. Fund | Client pays the job budget on PayPal checkout | Orders v2 `intent: AUTHORIZE` — money is held, not captured |
| 2. Propose | AI reads the production log and proposes shares with evidence | Claude (tool use: `list_log_events`, `get_contributor`, `get_disputes`, `submit_proposal`) |
| 3. Dispute | A contributor says what was missed; AI re-reads and revises | Same agent loop, disputes as data (never as instructions) |
| 4. Agree | Each contributor approves the current version; a new version resets approvals | — |
| 5. Pay | Capture the authorization, then one Payouts batch to all contributors | `POST /v2/payments/authorizations/{id}/capture` · `POST /v1/payments/payouts` |

Guardrails: shares must sum to exactly 100% and to the budget to the cent (server computes amounts,
not the model); every reason must cite real log events; if the model fails or times out, a transparent
rule-based proposal (labelled **Rule-based fallback**) keeps the flow working.

## Try it

_Hosted demo URL: (added at submission)_

### Run locally

Requirements: Node 22+, pnpm, a PayPal Developer **sandbox** app, an Anthropic API key.

```bash
pnpm install
cp .env.example .dev.vars   # then fill in the values below
pnpm build
npx wrangler@4.130.0 dev    # http://localhost:8787
```

`.dev.vars`:

```
PAYPAL_CLIENT_ID=<sandbox client id>
PAYPAL_CLIENT_SECRET=<sandbox secret>
ANTHROPIC_API_KEY=<key>
```

Open the app → **Try the demo** → **Fund with PayPal (sandbox)** and pay with a sandbox personal
account (Developer Dashboard → Testing Tools → Sandbox Accounts).

## Tools used

| Tool | How it's used |
|---|---|
| PayPal Orders v2 | Authorize the client's payment at funding; capture only after unanimous approval |
| PayPal Payouts | One batch sends every contributor their share |
| Claude (Anthropic API) | Reads the production log through tools, proposes and revises the split with cited evidence |
| Cloudflare Workers + Durable Objects | API and project state |
| React + Vite | Web UI |

## What was built during the hackathon

Everything in this repository was created during the submission period (Nov 12, 2026).

## License

MIT — see [LICENSE](LICENSE).
