import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './io.mjs';

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

function responseText(provider, body) {
  if (provider === 'anthropic') {
    return (body.content || []).map((part) => part.text || '').join('\n');
  }
  return body.choices?.[0]?.message?.content || body.output_text || body.text || body.content || '';
}

export function providerConfigured(env = process.env) {
  if (env.LLM_FIXTURE_PATH) return true;
  return Boolean(env.LLM_API_URL && env.LLM_API_KEY && env.LLM_MODEL);
}

export async function generateStructuredDraft({ candidate, brandContext, sourceContext = [], existingContext = [] }, env = process.env) {
  if (env.LLM_FIXTURE_PATH) {
    const fixture = path.resolve(ROOT, env.LLM_FIXTURE_PATH);
    return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }
  if (!providerConfigured(env)) throw new Error('LLM provider is not configured. Set LLM_API_URL, LLM_API_KEY, and LLM_MODEL.');
  const provider = String(env.LLM_PROVIDER || 'openai_compatible').toLowerCase();
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
  let payload;
  if (provider === 'anthropic') {
    payload = { model: env.LLM_MODEL, max_tokens: Number(env.LLM_MAX_TOKENS || 7000), system, messages: [{ role: 'user', content: user }] };
  } else {
    payload = { model: env.LLM_MODEL, temperature: 0.35, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  }
  const headers = { 'content-type': 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = env.LLM_API_KEY;
    headers['anthropic-version'] = env.ANTHROPIC_VERSION || '2023-06-01';
  } else {
    headers.authorization = `Bearer ${env.LLM_API_KEY}`;
  }
  const response = await fetch(env.LLM_API_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Number(env.LLM_TIMEOUT_MS || 90000)) });
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText }; }
  if (!response.ok) throw new Error(`LLM request failed ${response.status}: ${bodyText.slice(0, 800)}`);
  return extractJson(responseText(provider, body));
}

export async function repairStructuredDraft({ draft, findings, candidate }, env = process.env) {
  if (!providerConfigured(env) || env.LLM_FIXTURE_PATH) return null;
  const provider = String(env.LLM_PROVIDER || 'openai_compatible').toLowerCase();
  const system = 'Return one repaired JSON object only. Preserve the useful substance. Fix only the listed findings. Do not invent protected facts, personal stories, credentials, fees, insurance, availability, outcomes, or a physical Memphis office.';
  const user = JSON.stringify({ candidate, findings, draft }, null, 2);
  let payload;
  if (provider === 'anthropic') payload = { model: env.LLM_MODEL, max_tokens: Number(env.LLM_MAX_TOKENS || 7000), system, messages: [{ role: 'user', content: user }] };
  else payload = { model: env.LLM_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  const headers = { 'content-type': 'application/json' };
  if (provider === 'anthropic') { headers['x-api-key'] = env.LLM_API_KEY; headers['anthropic-version'] = env.ANTHROPIC_VERSION || '2023-06-01'; }
  else headers.authorization = `Bearer ${env.LLM_API_KEY}`;
  const response = await fetch(env.LLM_API_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(Number(env.LLM_TIMEOUT_MS || 90000)) });
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`LLM repair failed ${response.status}: ${bodyText.slice(0, 800)}`);
  const body = JSON.parse(bodyText);
  return extractJson(responseText(provider, body));
}
