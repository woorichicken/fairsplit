import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS, normalizeAi, runAgent, type ChatFn, type Tool } from './agent';

const tool: Tool = { name: 'look', description: 'd', parameters: {}, run: async () => '값' };
const rule = () => ({ text: '규칙 답', steps: [], by: 'rule' as const });

describe('에이전트 루프', () => {
  it('도구를 끝없이 부르는 모델도 상한에서 멈추고 요약한다', async () => {
    let calls = 0;
    const chat: ChatFn = async (_m, tools) => {
      calls += 1;
      return tools ? { toolCalls: [{ id: 'c', name: 'look', arguments: {} }] } : { content: '요약' };
    };
    const a = await runAgent('x', [tool], chat, rule);
    expect(a.text).toBe('요약');
    expect(a.steps).toHaveLength(MAX_ROUNDS);
    expect(calls).toBe(MAX_ROUNDS + 1);
  });

  it('모델이 죽으면 규칙 답으로 돈다', async () => {
    const chat: ChatFn = async () => { throw new Error('down'); };
    expect((await runAgent('x', [tool], chat, rule)).by).toBe('rule');
  });

  it('없는 도구를 불러도 죽지 않는다', async () => {
    let n = 0;
    const chat: ChatFn = async () => { n += 1; return n === 1 ? { toolCalls: [{ id: 'c', name: 'nope', arguments: {} }] } : { content: '끝' }; };
    const a = await runAgent('x', [tool], chat, rule);
    expect(a.steps[0].result).toContain('없는 도구');
    expect(a.text).toBe('끝');
  });

  it('Workers AI 두 가지 답 모양을 읽는다', () => {
    const openai = normalizeAi({ choices: [{ message: { content: null, tool_calls: [{ id: 'a', function: { name: 'look', arguments: '{"q":"x"}' } }] } }] });
    expect(openai.toolCalls[0]).toEqual({ id: 'a', name: 'look', arguments: { q: 'x' } });
    const plain = normalizeAi({ response: '답', tool_calls: [{ name: 'look', arguments: { q: 'y' } }] });
    expect(plain.content).toBe('답');
    expect(plain.toolCalls[0].arguments).toEqual({ q: 'y' });
    expect(normalizeAi({ choices: [{ message: { content: '끝' } }] }).toolCalls).toEqual([]);
  });
});
