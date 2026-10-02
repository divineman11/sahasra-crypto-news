import { DeviSvg, accent, type DeviProps } from "./shapes";

// Matangi: four veena-string curves across a ring, with slightly different amplitudes.
export function Matangi({ size = 64, play = false, className }: DeviProps) {
  const strings = [
    { x: 20, amp: 3, alt: false },
    { x: 28, amp: -5, alt: true },
    { x: 36, amp: 4, alt: false },
    { x: 44, amp: -2.5, alt: true },
  ];
  return (
    <DeviSvg name="matangi" size={size} play={play} className={className} title="Matangi">
      <circle className="devi-matangi-ring" cx="32" cy="32" r="28" opacity={0.5} />
      {strings.map((s, i) => {
        const h = Math.round(Math.sqrt(28 * 28 - (s.x - 32) * (s.x - 32)) * 100) / 100;
        return (
          <path
            key={s.x}
            className={`devi-matangi-string devi-matangi-string${i + 1}`}
            d={`M${s.x} ${32 - h} Q${s.x + s.amp} 32 ${s.x} ${32 + h}`}
            style={s.alt ? accent("matangi") : undefined}
          />
        );
      })}
    </DeviSvg>
  );
}
