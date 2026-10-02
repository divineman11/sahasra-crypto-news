import type { CSSProperties, ReactNode } from "react";

// Shared plumbing for the ten Dasa Mahavidya line-art marks . Original, stroke-only,
// yantra-inspired ornament: circles, petals, arcs, triangles. No figures, no text, no syllables.
// Marks are decorative (aria-hidden); the heading text next to them carries the meaning.

export interface DeviProps {
  size?: number;
  play?: boolean;
  className?: string;
}

const f = (n: number): number => Math.round(n * 100) / 100;

// Stroke width in viewBox units: 1.5 at 64 px (spec); thicker at small sizes so the line stays ~1 px.
export function strokeFor(size: number): number {
  return size >= 40 ? 1.5 : size >= 24 ? 2.2 : 3.2;
}

export function pt(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))];
}

// Clockwise arc (screen coords: 0 deg = east, positive = clockwise).
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const [x0, y0] = pt(cx, cy, r, startDeg);
  const [x1, y1] = pt(cx, cy, r, startDeg + sweepDeg);
  return `M${x0} ${y0} A${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

// A narrow petal pointing up from the origin: length `len`, half-width `hw`.
export function petalD(len: number, hw: number): string {
  return `M0 0 Q${hw} ${f(-len / 2)} 0 ${-len} Q${-hw} ${f(-len / 2)} 0 0Z`;
}

export const accent = (name: string): CSSProperties => ({ stroke: `var(--devi-${name}-2)` });
export const accentFill = (name: string): CSSProperties => ({ stroke: `var(--devi-${name}-2)`, fill: `var(--devi-${name}-2)` });

export function Petal({
  cls, len, hw, at, rot = 0, style, fillTint,
}: {
  cls: string; len: number; hw: number; at: [number, number]; rot?: number; style?: CSSProperties; fillTint?: boolean;
}) {
  return (
    <path
      className={cls}
      d={petalD(len, hw)}
      transform={`translate(${at[0]} ${at[1]}) rotate(${rot})`}
      style={style}
      fill={fillTint ? "currentColor" : undefined}
      fillOpacity={fillTint ? 0.12 : undefined}
    />
  );
}

// Petal placed on a ring: centre (32,32), at radius r, pointing outward at `deg` (0 = up).
export function RingPetal({ cls, deg, r, len, hw, style }: { cls: string; deg: number; r: number; len: number; hw: number; style?: CSSProperties }) {
  return <path className={cls} d={petalD(len, hw)} transform={`translate(32 32) rotate(${deg}) translate(0 ${-r})`} style={style} />;
}

export function DeviSvg({
  name, size = 64, play = false, className, title, children,
}: {
  name: string; size?: number; play?: boolean; className?: string; title: string; children: ReactNode;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-name={title}
      className={`devi devi-${name}${play ? " is-playing" : ""}${className ? " " + className : ""}`}
    >
      {children}
    </svg>
  );
}
