import { buildFreeWins } from './lib/search_intelligence.mjs';
import { refreshCompetitorObservations } from './lib/competitor.mjs';
const clock = new Date();
const freeWins = buildFreeWins(clock);
const competitors = await refreshCompetitorObservations(process.env, clock);
console.log(JSON.stringify({ ok: true, freeWins: freeWins.items.length, competitorQueries: competitors.observations.length, providerState: { gsc: freeWins.providerState, competitor: competitors.providerState } }, null, 2));
