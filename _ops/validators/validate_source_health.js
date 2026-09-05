const fs = require('fs');
const { warn: reportFindings } = require('../validation/protocol');
const warnings = [];
function finding(message) { warnings.push(`SOURCE HEALTH CONTRACT WARNING: ${message}`); }
const file = 'data/intake/source_health.json';
let health = null;
if (!fs.existsSync(file)) finding('data/intake/source_health.json missing. Run npm run ingest:social.');
else {
  try { health = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { finding(`source_health.json is invalid JSON: ${error.message}`); }
}
if (health) {
  if (!health.generatedAt || !health.mode || !Array.isArray(health.sources)) finding('source_health.json missing generatedAt, mode, or sources.');
  if (!['external', 'mixed', 'fallback'].includes(health.mode)) finding(`Invalid ingestion mode: ${health.mode}`);
  for (const source of Array.isArray(health.sources) ? health.sources : []) {
    if (!source.id || !source.status || typeof source.signalCount !== 'number') finding(`Invalid source health entry: ${JSON.stringify(source)}`);
  }
}
// This validator used to assert the SHAPE of the record and nothing else, so it
// printed "Source health contract OK" for a run in which every source had failed.
// Shape is not health. The status of the run is now reported too - as warnings,
// because a flaky no-auth feed is not a release blocker; social-ingestion-stops
// carries the blocking duty and hard-fails on a persistent outage.
if (health) {
  const sources = Array.isArray(health.sources) ? health.sources : [];
  if (!sources.length) finding('source_health.json records zero sources. A health report over nothing is not a healthy report.');
  const degraded = sources.filter((source) => source.status === 'degraded');
  const stopped = sources.filter((source) => source.status === 'stopped');
  const ok = sources.filter((source) => source.status === 'ok');
  // A rate-limited public feed is normal and warning on it every run trains people
  // to ignore this check. The degraded set is NAMED unconditionally so it is never
  // invisible, but it is only escalated to a finding when the run actually came
  // back empty - which is the condition that matters.
  for (const stop of Array.isArray(health.namedStops) ? health.namedStops : []) finding(`NAMED STOP ${stop.stop}: ${stop.detail}`);
  const streak = Number(health.fallbackStreak || 0);
  if (streak > 0) finding(`${streak} consecutive run(s) have ingested no external signal (limit ${Number(health.fallbackStreakLimit || 3)}, enforced by social-ingestion-stops).`);
  const roll = degraded.length
    ? ` Degraded this run: ${degraded.map((source) => `${source.id}(${source.httpStatus ?? source.error ?? 'no response'})`).join(', ')}.`
    : '';
  const stops = stopped.length
    ? ` Stopped by configuration: ${stopped.map((source) => source.id).join(', ')}.`
    : '';
  if (!warnings.length) {
    console.log(`Source health contract OK (${sources.length} source(s): ${ok.length} ok, ${stopped.length} stopped by configuration and named, `
      + `${degraded.length} degraded; ${health.externalSignalCount} external signal(s) in ${health.mode} mode, fallback streak ${streak}).${roll}${stops}`);
  }
}

if (warnings.length) reportFindings(warnings, `${warnings.length}-source-health-warning(s)`);
process.exit(0);
