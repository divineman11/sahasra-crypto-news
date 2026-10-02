import type { ExplainEvent } from "@/lib/explainTypes";

// Plain text, no Devi: "Volatility: high" only when the 24h range is wide.
export function HeatBadge({ heat }: { heat: ExplainEvent["heat"] }) {
  if (heat.level !== "high") return null;
  return (
    <div className="ex-heat-row">
      <span className="ex-heat" data-level="high">
        Volatility: high{heat.range_24h_pct != null ? ` (24h range ${heat.range_24h_pct}%)` : ""}
      </span>
    </div>
  );
}
