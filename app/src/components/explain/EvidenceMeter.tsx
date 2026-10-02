import type { ExplainEvidence } from "@/lib/explainTypes";

const DOTS: Record<ExplainEvidence["level"], number> = { Strong: 3, Moderate: 2, Limited: 1 };

// Secular three-dot meter (no Devi): source quality, corroboration, timestamp, uncertainty.
export function EvidenceMeter({ evidence, withReason = false }: { evidence: ExplainEvidence; withReason?: boolean }) {
  const on = DOTS[evidence.level] ?? 1;
  return (
    <span className="ex-evidence" data-level={evidence.level} title={evidence.reason}>
      <span className="ex-dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < on ? "ex-dot ex-dot-on" : "ex-dot"} />
        ))}
      </span>
      <span className="ex-evidence-level">Evidence: {evidence.level}</span>
      {withReason ? <span className="ex-muted"> {evidence.reason.replace(/^[A-Za-z]+ — /, "— ")}</span> : null}
    </span>
  );
}
