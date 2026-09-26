// Sahasra emblem — a Sahasrara (thousand-petalled crown lotus) mandala.
// Self-contained inline SVG: no external assets, all ids prefixed `sahasra-`.
// Four concentric petal rings (24 / 16 / 12 / 8 — four-fold symmetric) in
// violet → magenta → cyan → white, a gold ring of 72 seed-dots ("thousand"),
// and a luminous bindu with a fine star hexagram at the centre.
// Motion (outer ring + dot ring slow spin, bindu breath) lives in globals.css
// under `.sahasra-ring-outer`, `.sahasra-ring-dots`, `.sahasra-bindu` and is
// disabled by the prefers-reduced-motion guard there.

const C = 100;

type Ring = {
  id: string;
  n: number;
  base: number;
  tip: number;
  w: number;
  offset: number;
  grad: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  vein: boolean;
};

const RINGS: readonly Ring[] = [
  { id: "outer", n: 24, base: 60, tip: 92, w: 11.0, offset: 0, grad: "sahasra-g-outer", fillOpacity: 0.16, stroke: "#c084ff", strokeOpacity: 0.85, strokeWidth: 0.9, vein: false },
  { id: "r2", n: 16, base: 44, tip: 74, w: 12.0, offset: 11.25, grad: "sahasra-g-r2", fillOpacity: 0.22, stroke: "#ff2bd6", strokeOpacity: 0.8, strokeWidth: 0.9, vein: true },
  { id: "r3", n: 12, base: 30, tip: 56, w: 11.5, offset: 15, grad: "sahasra-g-r3", fillOpacity: 0.26, stroke: "#00f0ff", strokeOpacity: 0.75, strokeWidth: 0.9, vein: true },
  { id: "inner", n: 8, base: 16, tip: 40, w: 11.0, offset: 22.5, grad: "sahasra-g-inner", fillOpacity: 0.42, stroke: "#bffcff", strokeOpacity: 0.9, strokeWidth: 1.0, vein: true },
];

/** Petal pointing to 12 o'clock, base at radius `b`, tip at radius `t`, half-width `w`. */
function petalPath(b: number, t: number, w: number): string {
  const L = t - b;
  return (
    `M${C} ${C - b} ` +
    `C${C + w} ${C - b - L * 0.28} ${C + w * 0.82} ${C - t + L * 0.32} ${C} ${C - t} ` +
    `C${C - w * 0.82} ${C - t + L * 0.32} ${C - w} ${C - b - L * 0.28} ${C} ${C - b}Z`
  );
}

function veinPath(b: number, t: number): string {
  const L = t - b;
  return `M${C} ${C - b - 2} L${C} ${C - t + L * 0.38}`;
}

function angles(n: number, offset: number): number[] {
  return Array.from({ length: n }, (_, i) => offset + (i * 360) / n);
}

function triangle(up: boolean, r: number): string {
  return [0, 1, 2]
    .map((k) => {
      const a = (((up ? -90 : 90) + k * 120) * Math.PI) / 180;
      return `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
    })
    .join(" ");
}

const DOTS = Array.from({ length: 72 }, (_, i) => {
  const a = (i * 5 * Math.PI) / 180;
  return {
    x: (C + 97 * Math.sin(a)).toFixed(2),
    y: (C - 97 * Math.cos(a)).toFixed(2),
    r: i % 3 === 0 ? 1.0 : 0.6,
  };
});

export function SahasraLotus({ size = 72 }: { size?: number }) {
  return (
    <svg
      className="sahasra-emblem"
      width={size}
      height={size}
      viewBox="-6 -6 212 212"
      role="img"
      aria-label="Sahasra"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="sahasra-g-outer" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#9d4dff" />
          <stop offset="1" stopColor="#ff2bd6" />
        </linearGradient>
        <linearGradient id="sahasra-g-r2" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff2bd6" />
          <stop offset="1" stopColor="#9d4dff" />
        </linearGradient>
        <linearGradient id="sahasra-g-r3" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#9d4dff" />
          <stop offset="1" stopColor="#00f0ff" />
        </linearGradient>
        <linearGradient id="sahasra-g-inner" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#00f0ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <radialGradient id="sahasra-g-bindu" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#ffd166" />
          <stop offset="0.75" stopColor="#ff2bd6" />
          <stop offset="1" stopColor="#ff2bd6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sahasra-g-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb000" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#ff2bd6" stopOpacity="0.35" />
          <stop offset="1" stopColor="#9d4dff" stopOpacity="0" />
        </radialGradient>
        <filter id="sahasra-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="sahasra-glow-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {RINGS.map((r) => (
          <path key={r.id} id={`sahasra-petal-${r.id}`} d={petalPath(r.base, r.tip, r.w)} />
        ))}
        {RINGS.filter((r) => r.vein).map((r) => (
          <path key={r.id} id={`sahasra-vein-${r.id}`} d={veinPath(r.base, r.tip)} />
        ))}
      </defs>

      {/* soft aura behind the whole mandala */}
      <circle cx={C} cy={C} r="96" fill="url(#sahasra-g-halo)" opacity="0.4" filter="url(#sahasra-glow-soft)" />

      {/* the "thousand": 72 gold seed-dots on the rim, counter-rotating slowly */}
      <g className="sahasra-ring-dots" fill="#ffb000" opacity="0.6">
        {DOTS.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} />
        ))}
      </g>
      <circle cx={C} cy={C} r="100" fill="none" stroke="#ffb000" strokeWidth="0.5" opacity="0.35" />
      <circle cx={C} cy={C} r="94" fill="none" stroke="#9d4dff" strokeWidth="0.4" opacity="0.35" />

      {/* petal rings, outer → inner */}
      <g filter="url(#sahasra-glow)">
        {RINGS.map((r) => (
          <g
            key={r.id}
            className={r.id === "outer" ? "sahasra-ring-outer" : undefined}
            fill={`url(#${r.grad})`}
            fillOpacity={r.fillOpacity}
            stroke={r.stroke}
            strokeOpacity={r.strokeOpacity}
            strokeWidth={r.strokeWidth}
            strokeLinejoin="round"
          >
            {angles(r.n, r.offset).map((a) => (
              <use key={a} href={`#sahasra-petal-${r.id}`} transform={`rotate(${a} ${C} ${C})`} />
            ))}
            {r.vein && (
              <g strokeWidth="0.6" strokeOpacity="0.35" fill="none">
                {angles(r.n, r.offset).map((a) => (
                  <use key={a} href={`#sahasra-vein-${r.id}`} transform={`rotate(${a} ${C} ${C})`} />
                ))}
              </g>
            )}
          </g>
        ))}
      </g>

      {/* centre: gold ring, star hexagram, bindu */}
      <circle cx={C} cy={C} r="13.5" fill="#05060d" fillOpacity="0.55" />
      <circle cx={C} cy={C} r="13.5" fill="none" stroke="#ffb000" strokeWidth="1.1" opacity="0.9" filter="url(#sahasra-glow)" />
      <g fill="none" stroke="#ffd166" strokeWidth="0.7" opacity="0.6">
        <polygon points={triangle(true, 10.5)} />
        <polygon points={triangle(false, 10.5)} />
      </g>
      <circle className="sahasra-bindu" cx={C} cy={C} r="10" fill="url(#sahasra-g-bindu)" opacity="0.55" filter="url(#sahasra-glow-soft)" />
      <circle className="sahasra-bindu" cx={C} cy={C} r="5" fill="url(#sahasra-g-bindu)" />
    </svg>
  );
}

export default SahasraLotus;