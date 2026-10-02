import { splitGlossary, type GlossaryEntry } from "@/lib/glossary";

// Dotted-underlined term with a hover / focus / tap definition (CSS popover, keyboard reachable).
export function GlossaryTerm({ entry, children }: { entry: GlossaryEntry; children: React.ReactNode }) {
  return (
    <span className="ex-gloss" tabIndex={0} role="note" data-def={entry.def} aria-label={`${entry.term}: ${entry.def}`}>
      {children}
    </span>
  );
}

// Renders text with every known glossary term wrapped in <GlossaryTerm>.
export function Gloss({ text }: { text: string }) {
  return (
    <>
      {splitGlossary(text).map((seg, i) =>
        seg.entry ? (
          <GlossaryTerm key={i} entry={seg.entry}>{seg.text}</GlossaryTerm>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
