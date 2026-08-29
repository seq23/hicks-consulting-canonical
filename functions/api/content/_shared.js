// The content mirror of functions/api/digital-products/_shared.js.
//
// Products persist to KV; content does not. The content a person approves lives
// in the repository - data/admin/publication_approvals.json is the audit record
// and scripts/publishing/process_manifest.js is the only reader - so the write
// goes to the repository, through the same GitHub path the admin runtime already
// uses for data/autonomy/state.json. What is mirrored exactly is the part that
// matters here: the auth check, the JSON error shape, and one decision per call.
import { handleContentDecision } from '../../../worker/admin_runtime.mjs';
import { verifyAdminPasswordHash } from '../../../worker/admin_runtime.mjs';

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function requireAdmin(request, env) {
  if (!verifyAdminPasswordHash(request)) return { ok: false, response: jsonResponse({ ok: false, error: 'Admin password did not match.' }, 401) };
  return { ok: true };
}

export async function decide(request, env, decision) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  return handleContentDecision(request, env, decision);
}
