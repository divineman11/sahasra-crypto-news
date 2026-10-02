import type { ExplainEvent } from "@/lib/explainTypes";

const fmt = (n: number | null): string => (n == null ? "pending" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`);

// Secular block (no Devi). P1: earlier events of the same kind are listed with outcomes "pending" until the
// forward log (P3) fills them in; with no earlier case the literal "Not enough comparable cases" is shown.
export function PastCases({ history }: { history: ExplainEvent["history"] }) {
  return (
    <section className="ex-section" data-section="history">
      <h3 className="ex-heading"><span className="ex-heading-text">Has this happened before?</span></h3>
      {history.cases.length === 0 ? (
        <p className="ex-muted">{history.note ?? "Not enough comparable cases"}</p>
      ) : (
        <ul className="ex-list">
          {history.cases.map((c, i) => (
            <li key={i}>
              {c.coin ?? "—"} {c.date} <span className="ex-muted">· d1 {fmt(c.r1)} · d7 {fmt(c.r7)} · d30 {fmt(c.r30)} vs BTC</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
