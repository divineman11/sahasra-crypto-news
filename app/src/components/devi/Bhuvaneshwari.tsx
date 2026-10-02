import { DeviSvg, accent, accentFill, type DeviProps } from "./shapes";

// Bhuvaneshwari: three nested horizon arcs (bottom-anchored) under a small oval holding a 5-dot constellation.
export function Bhuvaneshwari({ size = 64, play = false, className }: DeviProps) {
  const arcs = [10, 18, 26];
  const stars: [number, number][] = [[26, 16], [30, 12.5], [34, 17], [38, 13.5], [32, 18]];
  return (
    <DeviSvg name="bhuvaneshwari" size={size} play={play} className={className} title="Bhuvaneshwari">
      <g className="devi-bhuvaneshwari-arcs">
        {arcs.map((r, i) => (
          <path key={r} className={`devi-bhuvaneshwari-arc devi-bhuvaneshwari-arc${i + 1}`} pathLength={1} d={`M${32 - r} 54 A${r} ${r} 0 0 1 ${32 + r} 54`} opacity={1 - i * 0.2} />
        ))}
      </g>
      <ellipse className="devi-bhuvaneshwari-oval" cx="32" cy="15.5" rx="11.5" ry="7" style={accent("bhuvaneshwari")} />
      <g className="devi-bhuvaneshwari-dots">
        {stars.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1" style={accentFill("bhuvaneshwari")} />
        ))}
      </g>
    </DeviSvg>
  );
}
