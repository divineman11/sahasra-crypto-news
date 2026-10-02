import type { ExplainScenario } from "@/lib/explainTypes";
import { Gloss } from "./GlossaryTerm";

const GLYPH: Record<ExplainScenario["dir"], { g: string; word: string }> = {
  down: { g: "▼", word: "Lower" },
  up: { g: "▲", word: "Higher" },
  chop: { g: "◆", word: "Sideways" },
};

// "Historically X of N" is shown only for a sane count: integers, N at least 20, 0 <= X <= N.
const MIN_CASES = 20;
function validBaseRate(b: { x: number; n: number }): boolean {
  return Number.isInteger(b.n) && Number.isInteger(b.x) && b.n >= MIN_CASES && b.x >= 0 && b.x <= b.n;
}

// Three collapsible scenarios, first open. Native <details>: Enter/Space work, focusable.
export function Scenarios({ scenarios, note }: { scenarios: ExplainScenario[]; note: string | null }) {
  return (
    <div className="ex-scenarios">
      {scenarios.map((s, i) => (
        <details key={i} open={i === 0} className="ex-scenario">
          <summary className="ex-scenario-sum">
            <span className="ex-dir" aria-hidden="true">{GLYPH[s.dir].g}</span>
            <span className="ex-sr">{GLYPH[s.dir].word}: </span>
            <span className="ex-scenario-title">{s.title}</span>
            <span className="ex-muted"> · {s.timeframe}</span>
          </summary>
          <div className="ex-scenario-body">
            <p><span className="ex-muted">Condition:</span> <Gloss text={s.condition} /></p>
            <p><span className="ex-muted">We would know because:</span> <Gloss text={s.evidence} /></p>
            {s.base_rate && validBaseRate(s.base_rate) ? (
              <p className="ex-base">Historically {s.base_rate.x} of {s.base_rate.n} {s.base_rate.measure}.</p>
            ) : i === 0 && note ? (
              <p className="ex-muted">{note}</p>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
