import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './io.mjs';
import { freeChat } from '../../llm/free_router.mjs';

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('LLM returned an empty response.');
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('LLM response did not contain valid JSON.');
}

/*
 * The model, the endpoint and the price ceiling all come from the router now,
 * never from the environment.
 *
 * This module used to take LLM_API_URL, LLM_API_KEY and LLM_MODEL from the
 * workflow secrets and POST to whatever they named. That is the defect the
 * owner's Search Readiness Checklist item i3 describes in one line: "If any
 * script can name its own model, one of them will name a paid one." Two
 * scheduled workflows - autonomy-cycle.yml and social-ingestion.yml - passed
 * secrets.LLM_MODEL straight through, so a single edit to a repository secret
 * could have put this loop on a paid model with nothing in the repo to catch
 * it.
 *
 * Every call now goes through scripts/llm/free_router.mjs: $0/$0 models from
 * config/llm_routing.json, provider.max_price 0 on every request, usage.cost
 * read back and a non-zero cost thrown. LLM_FIXTURE_PATH still short-circuits
 * the whole thing for tests, as before.
 */
export function providerConfigured(env = process.env) {
  if (env.LLM_FIXTURE_PATH) return true;
  return Boolean(env.OPENROUTER_API_KEY);
}

export async function generateStructuredDraft({ candidate, brandContext, sourceContext = [], existingContext = [] }, env = process.env) {
  if (env.LLM_FIXTURE_PATH) {
    const fixture = path.resolve(ROOT, env.LLM_FIXTURE_PATH);
    return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }
  if (!providerConfigured(env)) throw new Error('LLM provider is not configured. Set OPENROUTER_API_KEY; the model comes from config/llm_routing.json, never from the environment.');
  const system = [
    'You create source-aware educational resources for Hicks Consulting.',
    'Return one JSON object only. Do not use markdown fences.',
    'Never diagnose the reader, guarantee an outcome, invent a client story, invent a testimonial, invent credentials, invent fees, invent insurance participation, invent availability, or imply a physical Memphis therapy office.',
    'Therapy is virtual and limited to eligible clients located in Tennessee. Coaching is non-clinical and is not therapy.',
    'Use a warm, grounded, specific voice. Give practical examples without pretending they came from a real client.',
    'If a factual or numeric claim needs evidence, include an HTTPS source URL or remove the claim.',
    'The JSON shape must be: {title, description, shortAnswer, sections:[{heading, body, bullets?}], sources:[{title,url}], internalLinks:[string], disclaimer}.',
    'Write enough substantive content to meet the supplied minimum word count.'
  ].join(' ');
  const user = JSON.stringify({ candidate, brandContext, sourceContext, existingContext }, null, 2);
  const { ok, content, stop } = await freeChat({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: Number(env.LLM_MAX_TOKENS || 7000),
    temperature: 0.35,
    purpose: 'autonomy:generate_structured_draft',
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 90000),
    env,
  });
  if (!ok) throw new Error(`LLM draft unavailable: ${stop}`);
  return extractJson(content);
}

export async function repairStructuredDraft({ draft, findings, candidate }, env = process.env) {
  if (!providerConfigured(env) || env.LLM_FIXTURE_PATH) return null;
  const system = 'Return one repaired JSON object only. Preserve the useful substance. Fix only the listed findings. Do not invent protected facts, personal stories, credentials, fees, insurance, availability, outcomes, or a physical Memphis office.';
  const user = JSON.stringify({ candidate, findings, draft }, null, 2);
  const { ok, content } = await freeChat({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: Number(env.LLM_MAX_TOKENS || 7000),
    temperature: 0.2,
    purpose: 'autonomy:repair_structured_draft',
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 90000),
    env,
  });
  // A repair is best-effort: the caller keeps the good draft when it returns null.
  if (!ok) return null;
  return extractJson(content);
}
