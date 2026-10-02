// All explain-card times are stored as ISO UTC and shown in US Eastern with an explicit "ET" suffix.
const TZ = "America/New_York";
const fShort = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const fClock = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

const ms = (v: string | number): number => (typeof v === "number" ? v : Date.parse(v));

export const etShort = (v: string | number): string => fShort.format(ms(v));
export const etClock = (v: string | number): string => fClock.format(ms(v)).replace(/ /g, " ") + " ET";
const fDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const etDay = (v: string | number): string => fDay.format(ms(v));
export const etFull = (v: string | number): string => `${etShort(v)}, ${etClock(v)}`;
