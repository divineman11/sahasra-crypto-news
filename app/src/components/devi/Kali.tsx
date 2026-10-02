import { DeviSvg, accent, accentFill, arcPath, pt, type DeviProps } from "./shapes";

// Kali: one circular arc open at the top-right (~300 deg); a faint jagged shadow inside (already
// dissolved in the resting frame) and six light dots. Time and transformation; no figure, no combat.
export function Kali({ size = 64, play = false, className }: DeviProps) {
  const dots = Array.from({ length: 6 }, (_, i) => pt(32, 32, 14, 30 + i * 60));
  return (
    <DeviSvg name="kali" size={size} play={play} className={className} title="Kali">
      <circle className="devi-kali-ring" cx="32" cy="32" r="28" opacity={0.45} />
      <path className="devi-kali-arc" pathLength={1} d={arcPath(32, 32, 20, -15, 300)} style={accent("kali")} />
      <path className="devi-kali-shadow" d="M24 36 L27 28 L30 38 L33 27 L36 37 L40 30" opacity={0.2} />
      <g className="devi-kali-dots">
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.2" style={accentFill("kali")} />
        ))}
      </g>
    </DeviSvg>
  );
}
