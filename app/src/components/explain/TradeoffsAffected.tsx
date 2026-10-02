import { SectionHeading } from "./SectionHeading";
import { Gloss } from "./GlossaryTerm";

export function Tradeoffs({ text, play }: { text: string; play?: boolean }) {
  return (
    <section className="ex-section" data-section="tradeoffs">
      <SectionHeading devi="chhinnamasta" play={play} />
      <p className="ex-body"><Gloss text={text} /></p>
    </section>
  );
}

export function Affected({ items, play }: { items: { who: string; how: string }[]; play?: boolean }) {
  return (
    <section className="ex-section" data-section="affected">
      <SectionHeading devi="kamala" play={play} />
      <ul className="ex-list">
        {items.map((a, i) => (
          <li key={i}>
            <strong>{a.who}</strong> <span className="ex-muted">· <Gloss text={a.how} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
