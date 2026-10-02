'use strict';
// All explain-card times: stored as ISO UTC, rendered in US Eastern ("ET"). Day keys use America/New_York.
const TZ = 'America/New_York';
const fDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const fClock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });

const fParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false });

const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
const etDay = (v) => fDay.format(ms(v)); // 2026-10-02
const etShort = (v) => fShort.format(ms(v)); // Oct 2
const etClock = (v) => fClock.format(ms(v)).replace(/\u202f/g, ' ') + ' ET'; // 2:40 PM ET
const etFull = (v) => `${etShort(v)}, ${etClock(v)}`; // Oct 2, 9:05 AM ET

// {y, m, d, hour} of an instant in ET
function etParts(v) {
  const o = {};
  for (const p of fParts.formatToParts(ms(v))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hour: +o.hour % 24 };
}

module.exports = { etParts, etDay, etShort, etClock, etFull, TZ };
