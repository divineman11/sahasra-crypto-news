import type { UnlockItem } from "@/lib/unlockTypes";

// Neon badges used on the sidebar, the /unlocks page and coin pages.
export function Badge({ kind, children, title }: { kind: "shock" | "disagree" | "missing" | "anniv" | "cross" | "past"; children: React.ReactNode; title?: string }) {
  return (
    <span className={`un-badge un-badge-${kind}`} title={title}>
      {children}
    </span>
  );
}

export function UnlockBadges({ u }: { u: UnlockItem }) {
  return (
    <>
      {u.supplyShock ? (
        <Badge kind="shock" title="At least 5% of the coins already on the market become free to trade on this day.">SUPPLY SHOCK</Badge>
      ) : null}
      {u.disagree ? (
        <Badge kind="disagree" title="Two sources give very different sizes. Check both before trusting either.">{u.disagree.badge.replace(/ \([^)]*\)$/, "")}</Badge>
      ) : null}
      {u.justUnlocked ? <Badge kind="past" title="This unlock happened in the last 24 hours.">JUST UNLOCKED</Badge> : null}
    </>
  );
}
