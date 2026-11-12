// 저장 — Durable Object 하나(ProjectStore)에 프로젝트 id 별 JSON. SQLite 백엔드(wrangler migrations new_sqlite_classes).
// 해커톤 규모라 인스턴스 하나(idFromName('main'))로 충분하다. 요청 하나 = get → 바꾸기 → put.
import { DurableObject } from 'cloudflare:workers';
import type { Project } from '../src/shared/types';

const KEY_PREFIX = 'project:';

export class ProjectStore extends DurableObject {
  async getProject(id: string): Promise<Project | null> {
    return (await this.ctx.storage.get<Project>(KEY_PREFIX + id)) ?? null;
  }

  async putProject(project: Project): Promise<void> {
    await this.ctx.storage.put(KEY_PREFIX + project.id, project);
  }
}

export interface StoreEnv { PROJECTS: DurableObjectNamespace<ProjectStore> }

export const storeOf = (env: StoreEnv): DurableObjectStub<ProjectStore> => env.PROJECTS.get(env.PROJECTS.idFromName('main'));
