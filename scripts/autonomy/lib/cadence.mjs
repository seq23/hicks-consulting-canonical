import { readJson } from './io.mjs';

const ROUTE_TYPE_MAP = new Map([
  ['insight', 'insights'],
  ['insights', 'insights'],
  ['faq', 'insights'],
  ['fanout', 'insights'],
  ['article', 'articles'],
  ['articles', 'articles'],
  ['guide', 'guides'],
  ['guides', 'guides'],
  ['whitepaper', 'white-papers'],
  ['whitepapers', 'white-papers'],
  ['white-paper', 'white-papers'],
  ['white-papers', 'white-papers']
]);

export function normalizeContentType(value) {
  const normalized = ROUTE_TYPE_MAP.get(String(value || '').toLowerCase());
  if (!normalized) throw new Error(`Unsupported content type: ${value}`);
  return normalized;
}

function atReleaseHour(date) {
  const d = new Date(date);
  d.setUTCHours(13, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function firstDayNextMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 13, 0, 0, 0));
}

function slotKey(date) {
  return atReleaseHour(date).toISOString();
}

export function cadenceMatches(contentType, date) {
  const type = normalizeContentType(contentType);
  const d = new Date(date);
  const day = d.getUTCDay();
  const dom = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  if (type === 'insights') return day >= 1 && day <= 5;
  if (type === 'articles') return day === 2;
  if (type === 'guides') return dom === 15;
  if (type === 'white-papers') return dom === 20 && [3, 6, 9, 12].includes(month);
  return false;
}

export function nextAvailableSlot(contentType, manifest, after = null) {
  const type = normalizeContentType(contentType);
  const occupied = new Set((manifest || [])
    .filter((item) => normalizeContentType(item.contentType || item.type) === type)
    .map((item) => item.scheduledAt)
    .filter(Boolean));
  const maxScheduled = (manifest || [])
    .map((item) => item.scheduledAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((d) => !Number.isNaN(d.valueOf()))
    .sort((a, b) => b - a)[0];
  let cursor = after ? new Date(after) : (maxScheduled ? addDays(maxScheduled, 1) : addDays(new Date(), 1));
  cursor = atReleaseHour(cursor);

  if (type === 'insights') {
    for (let i = 0; i < 740; i += 1) {
      if (cadenceMatches(type, cursor) && !occupied.has(slotKey(cursor))) return slotKey(cursor);
      cursor = addDays(cursor, 1);
    }
  }

  if (type === 'articles') {
    for (let i = 0; i < 160; i += 1) {
      if (cadenceMatches(type, cursor) && !occupied.has(slotKey(cursor))) return slotKey(cursor);
      cursor = addDays(cursor, 1);
    }
  }

  if (type === 'guides') {
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 15, 13, 0, 0, 0));
    if (cursor <= (after ? new Date(after) : maxScheduled || new Date())) cursor = firstDayNextMonth(cursor);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 15, 13, 0, 0, 0));
    for (let i = 0; i < 48; i += 1) {
      if (!occupied.has(slotKey(cursor))) return slotKey(cursor);
      cursor = firstDayNextMonth(cursor);
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 15, 13, 0, 0, 0));
    }
  }

  if (type === 'white-papers') {
    for (let i = 0; i < 1600; i += 1) {
      if (cadenceMatches(type, cursor) && !occupied.has(slotKey(cursor))) return slotKey(cursor);
      cursor = addDays(cursor, 1);
    }
  }

  throw new Error(`Unable to find a cadence-compliant slot for ${type}.`);
}

export function assertVelocityContract(manifest) {
  const contract = readJson('data/system/publishing_velocity_contract.json');
  const failures = [];
  for (const item of manifest || []) {
    if (!item.scheduledAt || !item.contentType) continue;
    if (!cadenceMatches(item.contentType, item.scheduledAt)) failures.push(`${item.id}:${item.contentType}:${item.scheduledAt}`);
  }
  return {
    ok: failures.length === 0,
    authority: contract.authority,
    lockedRecordCount: contract.lockedRecordCount,
    failures
  };
}
