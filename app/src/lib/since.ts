const SINCE_RE = /^(\d+)(m|h|d)$/;

const MIN_MS = 60 * 1000;
const MAX_MS = 30 * 24 * 3600 * 1000;

export function parseSince(v: string | null, def = "48h"): number {
  const input = v ?? def;
  const m = SINCE_RE.exec(input);
  if (!m) {
    const dm = SINCE_RE.exec(def);
    if (!dm) return 48 * 3600 * 1000;
    return clamp(parseInt(dm[1], 10) * unitMs(dm[2]));
  }
  return clamp(parseInt(m[1], 10) * unitMs(m[2]));
}

function unitMs(unit: string): number {
  switch (unit) {
    case "m":
      return 60 * 1000;
    case "h":
      return 3600 * 1000;
    case "d":
      return 24 * 3600 * 1000;
    default:
      return 3600 * 1000;
  }
}

function clamp(ms: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}