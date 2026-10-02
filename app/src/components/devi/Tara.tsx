import { DeviSvg, Petal, RingPetal, accent, accentFill, type DeviProps } from "./shapes";

// Tara: lotus over two crossing waves, a guiding dot on the upper wave, thin ring of 8 small petals.
export function Tara({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="tara" size={size} play={play} className={className} title="Tara">
      <circle className="devi-tara-ring" cx="32" cy="32" r="28" opacity={0.55} />
      {Array.from({ length: 8 }, (_, i) => (
        <RingPetal key={i} cls="devi-tara-ring" deg={i * 45} r={24} len={5} hw={1.6} />
      ))}
      <g className="devi-tara-lotus">
        {[-40, -20, 0, 20, 40].map((d) => (
          <Petal key={d} cls="devi-tara-petal" len={14} hw={3.5} at={[32, 35]} rot={d} fillTint />
        ))}
      </g>
      <g className="devi-tara-waves">
        <path d="M12 44 C20 36 26 52 32 44 S44 36 52 44" />
        <path d="M12 44 C20 52 26 36 32 44 S44 52 52 44" style={accent("tara")} />
      </g>
      <circle className="devi-tara-dot" cx="46.3" cy="42.4" r="1.8" style={accentFill("tara")} />
    </DeviSvg>
  );
}
