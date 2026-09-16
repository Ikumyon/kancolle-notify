import { json, readBody } from './status.js';
import { applySettings, reconcile } from '../../domain/state.js';
export async function handleGetSettings(request, env, repo) { return json((await repo.read()).state.settings); }
export async function handlePatchSettings(request, env, repo) {
  const patch = await readBody(request, 4096);
  const settings = await repo.mutate(s => {
    const now = Date.now(); applySettings(s, patch, now); reconcile(s, now); return s.settings;
  });
  return json(settings);
}
