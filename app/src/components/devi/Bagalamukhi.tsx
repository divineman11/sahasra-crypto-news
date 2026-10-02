import { DeviSvg, accent, type DeviProps } from "./shapes";

// Bagalamukhi: a zigzag on the left settling into a straight line on the right, with a square bracket
// around the transition. Stillness and restraint.
export function Bagalamukhi({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="bagalamukhi" size={size} play={play} className={className} title="Bagalamukhi">
      <path
        className="devi-bagalamukhi-zigzag"
        d="M4 32 L8 16 L13 48 L18 20 L22 44 L27 26 L31 38 L36 29 L40 35 L44 31 L48 32 L60 32"
      />
      <g className="devi-bagalamukhi-bracket" style={accent("bagalamukhi")}>
        <path className="devi-bagalamukhi-bracket-l" d="M24 12 H20 V52 H24" />
        <path className="devi-bagalamukhi-bracket-r" d="M44 12 H48 V52 H44" />
      </g>
    </DeviSvg>
  );
}
