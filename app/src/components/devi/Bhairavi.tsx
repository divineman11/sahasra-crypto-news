import { DeviSvg, accent, type DeviProps } from "./shapes";

// Bhairavi: a steady three-tongue flame centred inside an upward triangle.
export function Bhairavi({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="bhairavi" size={size} play={play} className={className} title="Bhairavi">
      <path className="devi-bhairavi-triangle" d="M32 8 L52.8 44 L11.2 44 Z" opacity={0.55} />
      <path
        className="devi-bhairavi-flame" pathLength={1}
        d="M32 43 C24 43 22 35 26 30 C27 33 29 33 29 33 C28 27 31 22 33 17 C34 22 37 25 36 30 C38 28 39 27 39 27 C42 33 40 43 32 43 Z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path className="devi-bhairavi-core" d="M32 43 C29 40 30 36 32 34 C34 36 35 40 32 43" style={accent("bhairavi")} />
    </DeviSvg>
  );
}
