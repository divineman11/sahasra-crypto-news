import { DeviSvg, Petal, RingPetal, accent, accentFill, type DeviProps } from "./shapes";

// Kamala: an unfolding lotus of five petals inside eight outer petals, with two dotted showering arcs above.
export function Kamala({ size = 64, play = false, className }: DeviProps) {
  const left: [number, number][] = [[19, 29], [22, 31], [25, 32.5]];
  const right: [number, number][] = [[45, 29], [42, 31], [39, 32.5]];
  return (
    <DeviSvg name="kamala" size={size} play={play} className={className} title="Kamala">
      {Array.from({ length: 8 }, (_, i) => (
        <RingPetal key={i} cls="devi-kamala-outer" deg={i * 45} r={19} len={8} hw={2.4} />
      ))}
      <g className="devi-kamala-lotus">
        {[-50, -25, 0, 25, 50].map((d) => (
          <g key={d} className="devi-kamala-p" style={{ ["--r" as string]: `${d < 0 ? -25 : d > 0 ? 25 : 0}deg` }}>
            <Petal cls="devi-kamala-petal" len={15} hw={3.6} at={[32, 45]} rot={d} fillTint />
          </g>
        ))}
      </g>
      <g className="devi-kamala-showers" style={accent("kamala")}>
        <path className="devi-kamala-shower" d="M17 26 Q21 19 28 21" strokeDasharray="1 3" />
        <path className="devi-kamala-shower" d="M47 26 Q43 19 36 21" strokeDasharray="1 3" />
        {[...left, ...right].map(([x, y], i) => (
          <circle key={i} className="devi-kamala-dot" cx={x} cy={y} r="0.9" style={accentFill("kamala")} />
        ))}
      </g>
    </DeviSvg>
  );
}
