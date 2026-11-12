import { MODEL, normalizeAi, runAgent, type Answer, type ChatFn, type Tool } from './agent';

interface Env { AI: Ai; ASSETS: Fetcher }

const MAX_INPUT = 300;

// 대회 주제에 맞춰 도구를 바꾼다. 데이터는 public/data/*.json 을 env.ASSETS 로 읽는다.
const tools: Tool[] = [
  { name: 'echo_length', description: '글자 수를 센다(예시 도구 — 바꾼다)', parameters: { type: 'object', properties: { text: { type: 'string' } } }, run: async (a) => `${String(a.text ?? '').length}자` },
];

const ruleAnswer = (input: string): Answer => ({ text: `「${input.slice(0, 40)}」를 규칙으로 읽었어요. 예시 답을 바꿔 주세요.`, steps: [], by: 'rule' });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/agent' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { text?: string };
      const text = String(body.text ?? '').slice(0, MAX_INPUT);
      if (!text.trim()) return Response.json({ error: 'empty' }, { status: 400 });
      // 이 모델은 추론을 켜 두면 토큰을 다 써서 답이 비어 온다 — 끈다(11-08 실측).
      const chat: ChatFn = async (messages, specs) => normalizeAi(await env.AI.run(MODEL as never, { messages, ...(specs ? { tools: specs } : {}), max_tokens: 400, chat_template_kwargs: { enable_thinking: false } } as never));
      return Response.json(await runAgent(text, tools, chat, ruleAnswer));
    }
    return env.ASSETS.fetch(req);
  },
};
