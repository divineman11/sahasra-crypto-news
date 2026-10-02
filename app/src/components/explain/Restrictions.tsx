import type { ExplainRestriction } from "@/lib/explainTypes";
import { SectionHeading } from "./SectionHeading";

// Only rendered when facts.restrictions is non-empty (halts, paused withdrawals, delisting dates, deadlines).
export function Restrictions({ items, play }: { items: ExplainRestriction[]; play?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="ex-section" data-section="restrictions">
      <SectionHeading devi="bagalamukhi" play={play} />
      <ul className="ex-list">
        {items.map((r, i) => (
          <li key={i}>
            {r.detail}
            {r.when_et ? <span className="ex-muted"> · {r.when_et}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
