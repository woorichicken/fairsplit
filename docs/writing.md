# Screen writing rules (English UI)

The UI is English (contest rules). These ten rules apply to every sentence a person sees: buttons, badges, errors, captions.
Check: `node ~/.claude/skills/copy-lint/scripts/lint.mjs src/ui/*.tsx src/ui/format.ts` (E 0, no W in screen strings).

1. Say who does what: the AI **proposes**, everyone **agrees**, PayPal **sends**. Never "AI decides" or "AI pays".
2. Do not promise fairness. Say "evidence-based" or "explainable", and show the log line.
3. No code, tool, model or error-code names on screen (`claude-sonnet-5-5` → "Claude", `FUNDING_REQUIRED` → the plain message).
4. Errors start with what happened to the money: "No money was moved."
5. One idea per sentence, about 20 words or fewer. Use a period or colon, not an em dash.
6. Buttons are a verb and an object: "Approve as Mina", "Split your own job", "Dispute this split".
7. Numbers come from data (API, recorded runs). Do not round, guess or invent them.
8. Name people. If a pronoun is needed, use they/them.
9. Plain verbs. Avoid "leverage", "seamless", "robust", "delve".
10. Mark sample data as sample ("Sample data", "Recorded example"). Real data has no sample badge.

Applied on 2026-11-12: before/after table in the contest folder `team/evidence/s2r7-human-tone.md` (lint W 5 → 2, both left are code comments).
