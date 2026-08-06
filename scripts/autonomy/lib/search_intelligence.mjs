import { readJson, writeJsonAtomic, nowIso } from './io.mjs';

function queryFromRow(row) { return String(row?.keys?.[0] || row?.query || '').trim(); }
function pageFromRow(row) { return String(row?.keys?.[1] || row?.page || '').trim(); }
function canonicalPath(url) {
  try { return new URL(url).pathname; } catch { return String(url || ''); }
}

export function buildFreeWins(clock = new Date()) {
  const gsc = readJson('data/agency/gsc_snapshot.json', { status: 'not_connected' });
  const governed = readJson('data/search/target_queries.json', { queries: [] });
  const items = [];
  if (gsc.status === 'ok') {
    const rows = Array.isArray(gsc.queryPage) ? gsc.queryPage : [];
    for (const row of rows) {
      const query = queryFromRow(row);
      const page = pageFromRow(row);
      const position = Number(row.position || 0);
      const impressions = Number(row.impressions || 0);
      const ctr = Number(row.ctr || 0);
      const target = governed.queries.find((entry) => entry.query.toLowerCase() === query.toLowerCase());
      if (position >= 4 && position <= 20 && impressions >= 10) items.push({ type: 'STRIKING_DISTANCE', query, page, position, impressions, ctr, recommendedAction: 'Improve answer alignment, title/snippet, and supporting internal links without changing page identity.', confidence: 'high' });
      if (impressions >= 30 && ctr < 0.02) items.push({ type: 'LOW_CTR', query, page, position, impressions, ctr, recommendedAction: 'Review search title and description against the actual query intent.', confidence: 'medium' });
      if (target && canonicalPath(page) && canonicalPath(page) !== target.primaryPage) items.push({ type: 'WRONG_PAGE_RANKING', query, page, expectedPage: target.primaryPage, position, impressions, recommendedAction: 'Strengthen query ownership and internal links toward the governed primary page.', confidence: 'high' });
    }
  }
  const result = { schemaVersion: '1.0.0', generatedAt: nowIso(clock), providerState: gsc.status === 'ok' ? 'CONNECTED' : String(gsc.status || 'DISCONNECTED').toUpperCase(), items };
  writeJsonAtomic('data/search/free_wins.json', result);
  return result;
}
