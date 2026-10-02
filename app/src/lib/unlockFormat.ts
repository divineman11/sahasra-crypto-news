const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });

export function etDate(tsSec: number): string {
  return ET_DAY.format(tsSec * 1000);
}
export function etWeekday(tsSec: number): string {
  return ET_WEEKDAY.format(tsSec * 1000);
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtPct(p: number | null | undefined): string {
  if (p == null || !isFinite(p)) return "—";
  return (Math.round(p * 10) / 10).toString() + "%";
}

// "today", "tomorrow", "in 5 d", or "unlocked 3 h ago"
export function whenText(tsSec: number, nowMs: number): string {
  const diffH = (tsSec * 1000 - nowMs) / 3_600_000;
  if (diffH <= 0) {
    const ago = Math.max(1, Math.round(-diffH));
    return ago >= 24 ? "just unlocked" : `unlocked ${ago} h ago`;
  }
  if (diffH < 24) return `in ${Math.max(1, Math.round(diffH))} h`;
  const d = Math.round(diffH / 24);
  return d === 1 ? "tomorrow" : `in ${d} d`;
}
