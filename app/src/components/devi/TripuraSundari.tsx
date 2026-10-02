import { DeviSvg, Petal, accentFill, type DeviProps } from "./shapes";

// Tripura Sundari: three clusters of three petals at 120 degrees around a centre dot, inside a ring.
export function TripuraSundari({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="tripurasundari" size={size} play={play} className={className} title="Tripura Sundari">
      <circle className="devi-tripurasundari-ring" cx="32" cy="32" r="28" opacity={0.5} />
      {[0, 120, 240].map((a) => (
        <g key={a} className={`devi-tripurasundari-cluster devi-tripurasundari-cluster${a}`}>
          {[-16, 0, 16].map((d) => (
            <g key={d} transform={`rotate(${a + d} 32 32)`}>
              <Petal cls="devi-tripurasundari-petal" len={13} hw={3.2} at={[32, 25]} fillTint />
            </g>
          ))}
        </g>
      ))}
      <circle className="devi-tripurasundari-centre" cx="32" cy="32" r="2.2" style={accentFill("tripurasundari")} />
    </DeviSvg>
  );
}
