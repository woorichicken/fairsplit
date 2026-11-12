import type { Project } from '../shared/types';
import { createFixtureApi, FIXTURE_NAMES, type FixtureName } from './fixtures';

/**
 * 서버 호출은 이 파일 한 곳에만 둔다(계약서). 화면은 `getApi()` 가 주는 함수만 부른다.
 * `?fixture=v1|v2|paid` 가 붙으면 서버 대신 fixtures.ts 의 가짜 흐름으로 그린다 — E2E·캡처용.
 */
export interface FundStart { orderId: string; approveUrl: string }

/** 자기 로그로 새 프로젝트 — 계약서 API 표 `POST /api/projects` */
export interface NewProjectInput {
  title: string;
  clientName: string;
  budget: string;
  contributors: { name: string; role: string; paypalEmail: string }[];
  csv: string;
}

export interface Api {
  resetDemo(): Promise<Project>;
  createProject(input: NewProjectInput): Promise<Project>;
  getProject(id: string): Promise<Project>;
  fund(id: string): Promise<FundStart>;
  completeFund(id: string, orderId: string): Promise<Project>;
  propose(id: string): Promise<Project>;
  dispute(id: string, contributorId: string, text: string): Promise<Project>;
  approve(id: string, contributorId: string): Promise<Project>;
  refresh(id: string): Promise<Project>;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    /** 입력 검증 실패면 틀린 곳 전부(몇째 줄·무엇) */
    public readonly problems: string[] = [],
  ) {
    super(message);
  }
}

const NETWORK_ERROR = 'Could not reach the FairSplit server. Check your connection and try again.';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', NETWORK_ERROR, 0);
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; problems?: unknown } } | null;
  if (!res.ok) {
    const problems = Array.isArray(data?.error?.problems) ? data.error.problems.map(String) : [];
    throw new ApiError(data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? `The server answered ${res.status}. Try again in a moment.`, res.status, problems);
  }
  if (data === null) throw new ApiError('bad_json', 'The server sent an empty answer. Try again in a moment.', res.status);
  return data as T;
}

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

const httpApi: Api = {
  resetDemo: () => call<Project>('POST', '/api/demo/reset', { scenario: 'brand-short' }),
  createProject: (input) => call<Project>('POST', '/api/projects', input),
  getProject: (id) => call<Project>('GET', project(id)),
  fund: (id) => call<FundStart>('POST', `${project(id)}/fund`),
  completeFund: (id, orderId) => call<Project>('POST', `${project(id)}/fund/complete`, { orderId }),
  propose: (id) => call<Project>('POST', `${project(id)}/propose`),
  dispute: (id, contributorId, text) => call<Project>('POST', `${project(id)}/disputes`, { contributorId, text }),
  approve: (id, contributorId) => call<Project>('POST', `${project(id)}/approve`, { contributorId }),
  refresh: (id) => call<Project>('POST', `${project(id)}/refresh`),
};

export function fixtureFromUrl(search = window.location.search): FixtureName | null {
  const value = new URLSearchParams(search).get('fixture');
  return FIXTURE_NAMES.includes(value as FixtureName) ? (value as FixtureName) : null;
}

// 같은 fixture 는 탭 안에서 한 벌만 — 화면을 옮겨 다녀도 이의·동의 상태가 이어진다
const fixtureApis = new Map<FixtureName, Api>();

export function getApi(): Api {
  const name = fixtureFromUrl();
  if (!name) return httpApi;
  if (!fixtureApis.has(name)) fixtureApis.set(name, createFixtureApi(name));
  return fixtureApis.get(name)!;
}
