import { DeviSvg, accent, arcPath, type DeviProps } from "./shapes";

// Dhumavati: an open ring (gap at the top) with two calm smoke curls rising from the gap; the centre stays empty.
export function Dhumavati({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="dhumavati" size={size} play={play} className={className} title="Dhumavati">
      <path className="devi-dhumavati-ring" pathLength={1} d={arcPath(32, 41, 16, -75, 330)} />
      <g className="devi-dhumavati-curls" style={accent("dhumavati")}>
        <path className="devi-dhumavati-curl1" d="M30 24 C24 18 36 14 30 7" />
        <path className="devi-dhumavati-curl2" d="M35 24 C41 18 29 13 36 6" />
      </g>
    </DeviSvg>
  );
}
