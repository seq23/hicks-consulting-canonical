/**
 * One definition of how a bare location-implying "near me" target is governed,
 * shared by the two checks that read it:
 *
 *   _ops/validators/validate_discovery_gap.js            HARD_FAIL, blocks release
 *   _ops/validators/validate_discovery_gap_decisions_due.js  STRONG_WARNING, never blocks
 *
 * Why two checks. On 2026-09-23 the Content Publish lane went red with no commit
 * behind it: eleven queries that a Search Console refresh had added on 2026-09-08
 * were auto-quarantined with a 14-day decide_by, the date rolled over, and the
 * hard-fail check blocked the day's release of client-approved content. Nothing
 * was unsafe - a quarantined query is already undraftable through
 * blueOceanEligibility - a targeting decision was simply late. This repo's own
 * owner rule (see the agency-quality rationale in _repo_validation_registry.json)
 * is that SEO findings stay visible but never block publishing. So:
 *
 *   - the CONTROL stays a hard fail: a quarantine with no deadline, no reason, or
 *     that is still blue-ocean eligible, and any bare target nobody governs;
 *   - LATENESS is a strong warning: an overdue decide_by is reported every run
 *     and never stops a release.
 *
 * classifyBareTarget is a pure function of (row, localizedFor, today), so the
 * hard check can prove on a fixture that the clock cannot turn it red.
 */
// Same set as IMPLIES_LOCATION in scripts/queries/score_discovery_gap.mjs; the
// two must not drift.
const IMPLIES_A_PLACE = /\b(near me|nearby|near by|open now|around here|close to me)\b/i;

function localizedSet(rows) {
  return new Set(
    rows
      .filter((r) => r && r.intent === 'localized_variant' && r.localizes)
      .map((r) => String(r.localizes).toLowerCase())
  );
}

function bareTargets(rows) {
  return rows.filter((r) => r && r.query && IMPLIES_A_PLACE.test(r.query) && r.intent !== 'localized_variant');
}

/**
 * Returns { state, problems, overdue, decideBy } where state is one of
 * NOT_TARGETED | LOCALIZED | TARGETED | AWAITING | UNGOVERNED, problems are
 * hard-fail defects in the control, and overdue is true only for an AWAITING
 * row whose decide_by is before today (a warning, never a problem).
 */
function classifyBareTarget(row, localizedFor, today) {
  const q = String(row.query);
  const targeting = row.targeting || null;
  const problems = [];
  if (targeting && targeting.targeted === false) {
    if (!String(targeting.why || '').trim()) problems.push(`"${q}" is marked as never to be targeted with no reason recorded.`);
    if (!String(targeting.so_what_happens_instead || targeting.decision || '').trim()) problems.push(`"${q}" refuses a page without saying what happens to that searcher instead.`);
    if (row.blue_ocean_eligible && row.blue_ocean_eligible.eligible !== false) {
      problems.push(`"${q}" is marked as never to be targeted but is still blue-ocean eligible, so the drafting cycle will propose a page for it every run.`);
    }
    return { state: 'NOT_TARGETED', problems, overdue: false };
  }
  if (localizedFor.has(q.toLowerCase())) return { state: 'LOCALIZED', problems, overdue: false };
  if (targeting && targeting.targeted === true && String(targeting.how || '').trim()) return { state: 'TARGETED', problems, overdue: false };

  if (targeting && targeting.targeted === null && targeting.decision === 'AWAITING_TARGETING_DECISION') {
    const by = String(targeting.decide_by || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(by)) {
      problems.push(`"${q}" is quarantined awaiting a targeting decision with no usable decide_by date, so the quarantine has no deadline and would sit there for ever.`);
    } else if (!String(targeting.why || '').trim() || !String(targeting.how_to_decide || '').trim()) {
      problems.push(`"${q}" is quarantined awaiting a targeting decision without saying why it is held or how to decide it.`);
    } else if (!row.blue_ocean_eligible || row.blue_ocean_eligible.eligible !== false) {
      problems.push(`"${q}" is quarantined awaiting a targeting decision but is still blue-ocean eligible, so the drafting cycle can write a page for a query nobody has approved.`);
    }
    return { state: 'AWAITING', problems, overdue: !problems.length && by < today, decideBy: by };
  }

  problems.push(`"${q}" implies a location, names none, and carries neither a localized variant nor a recorded decision not to target it. Ungoverned: nobody can tell this apart from an oversight.`);
  return { state: 'UNGOVERNED', problems, overdue: false };
}

module.exports = { IMPLIES_A_PLACE, localizedSet, bareTargets, classifyBareTarget };
