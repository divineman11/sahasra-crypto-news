import { SectionHeading } from "./SectionHeading";
import { Gloss } from "./GlossaryTerm";

export function Uncertain({ items, play }: { items: string[]; play?: boolean }) {
  return (
    <section className="ex-section" data-section="uncertain">
      <SectionHeading devi="dhumavati" play={play} />
      <ul className="ex-list">
        {items.map((u, i) => (
          <li key={i}><Gloss text={u} /></li>
        ))}
      </ul>
    </section>
  );
}
