import { DeviSvg, accent, type DeviProps } from "./shapes";

// Bhairava (guardian mark): a trident with a small damaru-like hourglass inside a guarding circle.
// Stroke-only. No figure. The circle closes once around the trident when the mark plays.
export function Bhairava({ size = 64, play = false, className }: DeviProps) {
  return (
    <DeviSvg name="bhairava" size={size} play={play} className={className} title="Bhairava">
      <circle className="devi-bhairava-circle" cx={32} cy={32} r={27} pathLength={1} transform="rotate(-90 32 32)" opacity={0.7} />
      <path className="devi-bhairava-trident" d="M32 52 V12 M32 12 L29.5 16 M32 12 L34.5 16 M23 15 V23 C23 29 27 30 32 30 C37 30 41 29 41 23 V15 M23 15 L21 18.5 M23 15 L25 18.5 M41 15 L39 18.5 M41 15 L43 18.5" />
      <path className="devi-bhairava-damaru" d="M27 34 H37 L32 40 L37 46 H27 L32 40 Z" style={accent("bhairava")} />
    </DeviSvg>
  );
}
