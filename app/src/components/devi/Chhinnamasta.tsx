import { DeviSvg, Petal, accent, accentFill, type DeviProps } from "./shapes";

// Chhinnamasta: a centre dot with three ribbons flowing outward to three small 3-petal forms.
// Energy given so that others are nourished; abstract, no severing imagery.
export function Chhinnamasta({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="chhinnamasta" size={size} play={play} className={className} title="Chhinnamasta">
      <circle className="devi-chhinnamasta-ring" cx="32" cy="32" r="28" opacity={0.5} />
      <circle className="devi-chhinnamasta-centre" cx="32" cy="32" r="2.6" style={accentFill("chhinnamasta")} />
      {[0, 120, 240].map((a) => (
        <g key={a} transform={`rotate(${a} 32 32)`}>
          <path className="devi-chhinnamasta-ribbon" pathLength={1} d="M32 29 C38 24 26 19 32 14" style={accent("chhinnamasta")} />
          <g className="devi-chhinnamasta-form">
            {[-25, 0, 25].map((d) => (
              <Petal key={d} cls="devi-chhinnamasta-petal" len={7} hw={2} at={[32, 14]} rot={d} fillTint />
            ))}
          </g>
        </g>
      ))}
    </DeviSvg>
  );
}
