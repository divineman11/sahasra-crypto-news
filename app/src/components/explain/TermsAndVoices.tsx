import type { ExplainEvent } from "@/lib/explainTypes";
import { etClock } from "@/lib/timeET";
import { SectionHeading } from "./SectionHeading";
import { GlossaryTerm } from "./GlossaryTerm";
import { glossaryFor } from "@/lib/glossary";

// Matangi lens: the terms used in the card (plain list; hover definitions come later) and the timeline of voices.
export function TermsAndVoices({ glossary, timeline, play }: { glossary: string[]; timeline: ExplainEvent["timeline"]; play?: boolean }) {
  return (
    <section className="ex-section" data-section="voices">
      <SectionHeading devi="matangi" play={play} />
      {glossary.length > 0 ? (
        <p className="ex-body">
          {glossary.map((g, i) => {
            const e = glossaryFor(g);
            return (
              <span key={g} className="ex-term">
                {e ? <GlossaryTerm entry={e}>{g}</GlossaryTerm> : g}
                {i < glossary.length - 1 ? " · " : ""}
              </span>
            );
          })}
        </p>
      ) : null}
      <ol className="ex-timeline">
        {timeline.map((t, i) => (
          <li key={i}>
            <span className="ex-muted">{etClock(t.ts)}</span> {t.kind}{" "}
            {/^https?:\/\//.test(t.url) ? (
              <a href={t.url} target="_blank" rel="noopener noreferrer" className="ex-link">({t.source})</a>
            ) : (
              <span>({t.source})</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
