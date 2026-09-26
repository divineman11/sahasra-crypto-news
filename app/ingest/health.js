'use strict';

function toMs(v) {
  if (v instanceof Date) return v.getTime() > 0 ? v.getTime() : null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
}

const QUIET_FAIL_THRESHOLD = 6;
const QUIET_POLL_LOG_THROTTLE_MS = 3600000; // once/hour per adapter
// With ~77 non-quiet adapters, a total network outage would otherwise log ~77
// "no successful poll" lines a minute and send up to 77 Discord messages per 30-min throttle
// window. Above this many silent non-quiet adapters in one tick, collapse to ONE summary line and
// ONE alert (under a fixed alert name so the existing per-name 30-min Discord throttle still
// applies); at or under it, behaviour is unchanged (one line/alert per adapter).
const SILENT_FANOUT_THRESHOLD = 5;
const SILENT_FANOUT_LIST_MAX = 10;
const SILENT_FANOUT_ALERT_NAME = 'multiple-sources';

function startHealth({ scheduler, alerts, intervalMs = 60000 }) {
  const startedAt = Date.now();
  // Unverified (quietHealth) sources: the actual once-per-6h retry backoff lives in
  // scheduler._backoffUntil (adapter.quietHealth), not here — a side-channel here that also
  // pokes the scheduler's backoffUntil races the scheduler's own per-run backoff computation
  // and can undo the slow-down for hours. This file
  // only logs (never alerts Discord for a quietHealth source), throttled per adapter so a
  // permanently-dead source doesn't spam the log:
  //   - the generic "no successful poll" line: once per hour per adapter
  //   - the "[official] ... looks dead" line: once per failure streak (cleared on recovery)
  const quietDeadLogged = new Set(); // names that already printed the dead line for this streak
  const quietPollLoggedAt = new Map(); // name -> last time the "no successful poll" line printed
  const check = () => {
    try {
      let entries;
      try {
        entries = scheduler.health();
      } catch (e) {
        return;
      }
      const silent = []; // {name, text} — non-quiet adapters silent this tick
      for (const a of entries) {
        // The health window must never be tighter than 2x an adapter's own
        // poll interval — a fixed 30-min window falsely flags any 30-min-or-slower adapter (e.g
        // youtube.js, official.js) as silent on the ~half of scheduler jitter cycles (0.8-1.2x
        // intervalMs) that land past 30 min, alerting every minute even though the adapter is
        // healthy. scheduler.health() already exposes intervalMs per adapter (see scheduler.js).
        const limit = Math.max(a.tier === 1 ? 15 * 60000 : 30 * 60000, (a.intervalMs || 0) * 2);
        const ref = toMs(a.lastOkAt) ?? startedAt;
        const age = Date.now() - ref;
        if (age > limit) {
          const mins = Math.floor(age / 60000);
          const text = `no successful poll for ${mins} min, last error: ${a.lastErr || 'none'}`;
          if (!a.quietHealth && a.tier === 1) {
            // A tier-1 source (the primary exchange feeds) always gets its own immediate line +
            // alert, never folded into the >5 aggregate summary — a real tier-1 outage must stay
            // individually visible (and individually throttled by its own name) even during a
            // larger fan-out event.
            console.error(`[health] ${a.name} ${text}`);
            if (alerts) alerts.healthAlert(a.name, text);
          } else if (!a.quietHealth) {
            // Collected, not logged/alerted here — emitted individually or as one summary
            // below, once the full silent count for this tick is known.
            silent.push({ name: a.name, text });
          } else {
            const lastLoggedAt = quietPollLoggedAt.get(a.name) || 0;
            if (Date.now() - lastLoggedAt >= QUIET_POLL_LOG_THROTTLE_MS) {
              console.error(`[health] ${a.name} ${text}`);
              quietPollLoggedAt.set(a.name, Date.now());
            }
          }
        }
        if ((a.consecutiveSaveErrors || 0) >= 5) {
          const text = `saving items is failing (${a.consecutiveSaveErrors} runs in a row): ${a.lastSaveErr || ''}`;
          console.error(`[health] ${a.name} ${text}`);
          if (alerts && !a.quietHealth) alerts.healthAlert(a.name, text);
        }

        if (a.quietHealth) {
          const errs = a.consecutiveErrors || 0;
          if (errs >= QUIET_FAIL_THRESHOLD) {
            if (!quietDeadLogged.has(a.name)) {
              quietDeadLogged.add(a.name);
              // A tg:* wire adapter's `verified` flag lives in
              // config.js's TG_CHANNELS, not officialSources.json — point at the right file.
              const remedy = a.name.startsWith('tg:')
                ? 'set verified:true in TG_CHANNELS (config.js) or remove it'
                : 'set verified:true or remove it from officialSources.json';
              console.log(`[official] ${a.name} looks dead (${a.lastErr || 'no successful poll'}); ${remedy}`);
            }
          } else if (errs === 0) {
            // recovered: clear so a future failure streak is handled (and logged) fresh
            quietDeadLogged.delete(a.name);
            quietPollLoggedAt.delete(a.name);
          }
        }
      }

      // Emit either one line/alert per silent adapter (today's behaviour, <=threshold) or one
      // aggregated summary line/alert (above threshold) — never both.
      if (silent.length > SILENT_FANOUT_THRESHOLD) {
        const listed = silent.slice(0, SILENT_FANOUT_LIST_MAX).map((s) => s.name);
        const more = silent.length - listed.length;
        const tail = more > 0 ? `, … (+${more} more)` : '';
        const summary = `${silent.length} sources silent: ${listed.join(', ')}${tail}`;
        console.error(`[health] ${summary}`);
        if (alerts) alerts.healthAlert(SILENT_FANOUT_ALERT_NAME, summary);
      } else {
        for (const s of silent) {
          console.error(`[health] ${s.name} ${s.text}`);
          if (alerts) alerts.healthAlert(s.name, s.text);
        }
      }
    } catch (e) {
      console.error('[health] check error', e.message);
    }
  };
  const timer = setInterval(check, intervalMs);
  check();
  return () => clearInterval(timer);
}

module.exports = { startHealth };