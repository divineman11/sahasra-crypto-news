import type { ReactNode } from "react";
import Link from "next/link";
import { DeviMark, DEVI_BY_KEY, type DeviKey } from "../devi";

// Heading is text first; the mark beside it is decorative (aria-hidden) and never carries the meaning.
export function SectionHeading({ devi, label, sub, play = false }: { devi: DeviKey; label?: string; sub?: ReactNode; play?: boolean }) {
  const text = label ?? DEVI_BY_KEY[devi].lens;
  return (
    <h3 className="ex-heading" data-lens={devi}>
      <Link href={`/about/devis#${devi}`} className="ex-mark" style={{ opacity: 0.85 }} tabIndex={-1} aria-hidden="true">
        <DeviMark devi={devi} size={18} play={play} />
      </Link>
      <span className="ex-heading-text">{text}</span>
      {sub ? <span className="ex-heading-sub">{sub}</span> : null}
    </h3>
  );
}
