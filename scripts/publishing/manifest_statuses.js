'use strict';
/**
 * The one vocabulary of content_manifest.json `status`. The publish-state
 * validator, the publisher and the release regression all read this list; a
 * status outside it is a fault, not a new state.
 *
 * A page that is due and approved but cannot be released safely (unsafe copy,
 * no compliant search metadata) has no status of its own: it stays `approved`,
 * its record untouched, and the hold is a NAMED STOP recorded in
 * data/autonomy/exceptions.json and the run receipt. On 9 Oct 2026 the
 * publisher wrote `skipped_unsafe` into the record instead, which neither the
 * state validator nor the protected editorial baseline knows, and Content
 * Publish went red.
 */
const MANIFEST_STATUSES = Object.freeze(['draft', 'ready_for_approval', 'approved', 'published', 'revoked']);
module.exports = { MANIFEST_STATUSES };
