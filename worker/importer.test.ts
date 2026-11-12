import { describe, expect, it } from 'vitest';
import { applyProposal, invariantErrors } from './flow';
import { buildImportedProject, CSV_HEADER, ImportError, parseCsv, type ImportInput } from './importer';
import { ruleProposal } from './split';

const NOW = '2026-11-12T00:00:00Z';

const people = [
  { name: 'Ari', role: 'Host', paypalEmail: 'ari@example.com' },
  { name: 'Bo Kim', role: 'Audio editor', paypalEmail: 'bo@example.com' },
];
const csv = [
  CSV_HEADER.join(','),
  '2026-11-01,client,brief,Episode 12 brief,,"Interview, 25 minutes"',
  '2026-11-02T10:00,Ari,recording,Interview recording,60,',
  '2026-11-03,bo kim,edit,"Rough cut, noise cleanup",90,Removed hum',
  '2026-11-04,Bo Kim,revision,Final mix,30,',
].join('\n');
const good: ImportInput = { title: 'Podcast episode 12', clientName: 'Quiet Pines Radio', budget: '450', contributors: people, csv };

const problemsOf = (input: ImportInput): string[] => {
  try {
    buildImportedProject(input, 'x', NOW);
  } catch (e) {
    if (e instanceof ImportError) return e.problems;
    throw e;
  }
  return [];
};

describe('parseCsv', () => {
  it('따옴표 안 쉼표·"" ·CRLF·빈 줄', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });
});

describe('buildImportedProject', () => {
  it('맞는 입력 → draft Project · 이름으로 actor 를 id 로 바꾼다 · 순서대로 e01..', () => {
    const p = buildImportedProject(good, 'p1', NOW);
    expect(p.status).toBe('draft');
    expect(p.budget).toEqual({ value: '450.00', currency: 'USD' });
    expect(p.contributors.map((c) => c.id)).toEqual(['ari', 'bo-kim']);
    expect(p.log.map((e) => [e.id, e.actor, e.kind, e.minutes])).toEqual([
      ['e01', 'client', 'brief', undefined],
      ['e02', 'ari', 'recording', 60],
      ['e03', 'bo-kim', 'edit', 90],
      ['e04', 'bo-kim', 'revision', 30],
    ]);
    expect(p.log[0].detail).toBe('Interview, 25 minutes');
    expect(p.log[2].title).toBe('Rough cut, noise cleanup');
    expect(invariantErrors(p)).toEqual([]);
  });

  it('만든 프로젝트로 규칙 제안까지 불변식을 지킨다(합 100 · 금액 합 = 예산)', () => {
    const p = buildImportedProject(good, 'p1', NOW);
    applyProposal(p, ruleProposal(p, 1, NOW), NOW);
    expect(invariantErrors(p)).toEqual([]);
    const cents = p.proposal!.shares.reduce((a, s) => a + Math.round(Number(s.amount.value) * 100), 0);
    expect(cents).toBe(45000);
  });

  it('틀린 곳을 줄 번호와 함께 한 번에 모아 돌려준다', () => {
    const bad = [CSV_HEADER.join(','), 'not-a-date,Ari,recording,Take,10,', '2026-11-02,Zed,edit,Cut,abc,', '2026-11-03,Ari,coffee,,5,'].join('\n');
    const problems = problemsOf({ ...good, csv: bad });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Line 2: "not-a-date" is not a date'),
        expect.stringContaining('Line 3: actor "Zed"'),
        expect.stringContaining('Line 3: minutes "abc"'),
        expect.stringContaining('Line 4: kind "coffee"'),
        expect.stringContaining('Line 4: title is empty'),
        expect.stringContaining('Bo Kim has no lines'),
      ]),
    );
  });

  it('머리줄·예산·기여자 수·이메일·같은 이름', () => {
    expect(problemsOf({ ...good, csv: 'when,who\n1,2' })[0]).toContain('first line must be exactly');
    expect(problemsOf({ ...good, budget: '-5' })).toEqual([expect.stringContaining('Budget must be a number')]);
    expect(problemsOf({ ...good, budget: '0' })).toEqual([expect.stringContaining('Budget must be between')]);
    expect(problemsOf({ ...good, contributors: [people[0]] })).toEqual(expect.arrayContaining([expect.stringContaining('Add 2 to 8 contributors')]));
    expect(problemsOf({ ...good, contributors: [people[0], { ...people[1], paypalEmail: 'nope' }] })).toEqual([expect.stringContaining('"nope" is not an email')]);
    expect(problemsOf({ ...good, contributors: [people[0], { ...people[0] }] })).toEqual(expect.arrayContaining([expect.stringContaining('used twice')]));
  });

  it('빈 입력은 받지 않는다', () => {
    expect(problemsOf({})).toEqual(expect.arrayContaining(['Give the project a title.', 'Paste the production log as CSV.']));
  });
});
