import { readJson, writeJsonAtomic, nowIso } from './io.mjs';

export async function refreshCompetitorObservations(env = process.env, clock = new Date()) {
  const targets = readJson('data/search/target_queries.json', { queries: [] });
  const observations = [];
  const configured = Boolean(env.SEARCH_API_URL && env.SEARCH_PROVIDER_API_KEY);
  if (configured) {
    for (const target of targets.queries.slice(0, Number(env.COMPETITOR_QUERY_LIMIT || 7))) {
      const url = new URL(env.SEARCH_API_URL);
      url.searchParams.set(env.SEARCH_QUERY_PARAM || 'q', target.query);
      const response = await fetch(url, { headers: { authorization: `Bearer ${env.SEARCH_PROVIDER_API_KEY}`, 'x-api-key': env.SEARCH_PROVIDER_API_KEY }, signal: AbortSignal.timeout(Number(env.SEARCH_TIMEOUT_MS || 20000)) });
      const text = await response.text();
      if (!response.ok) { observations.push({ query: target.query, status: 'warning', error: `${response.status}: ${text.slice(0, 300)}` }); continue; }
      let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
      const results = body.organic || body.webPages?.value || body.results || body.items || [];
      observations.push({ query: target.query, status: 'ok', collectedAt: nowIso(clock), primaryPage: target.primaryPage, results: results.slice(0, 10).map((item, index) => ({ rank: index + 1, title: item.title || item.name || '', url: item.link || item.url || '', snippet: item.snippet || item.description || '' })) });
    }
  }
  const result = { schemaVersion: '1.0.0', generatedAt: nowIso(clock), providerState: configured ? 'CONNECTED' : 'DISCONNECTED', observations };
  writeJsonAtomic('data/search/competitor_observations.json', result);
  return result;
}
