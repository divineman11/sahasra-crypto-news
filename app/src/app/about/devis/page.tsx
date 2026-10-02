import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { DEVI, DeviMark } from "@/components/devi";

export const metadata = { title: "The ten lenses | Sahasra" };

// Legend for the ten decorative marks used on the "Understand this" cards. Same shell as the post page
// (TopBar + bordered scroll area) and the same slate / neon label styling as the rest of the app.
export default function DevisPage() {
  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800">
        <main className="mx-auto max-w-3xl p-4 text-xs text-slate-300">
          <Link href="/" className="text-slate-500 hover:text-slate-300">back to feed</Link>
          <h2 className="mt-4 text-[10px] uppercase tracking-wider text-slate-500">About</h2>
          <h1 className="mt-1 font-sans text-lg font-semibold text-slate-100">The ten lenses</h1>
          <p className="devi-legend-note mt-3 text-slate-400" data-testid="devi-note">
            These are original, contemporary editorial symbols inspired by the Daśa Mahāvidyā. They are decorative lenses for
            reading news, not devotional images, not ritual yantras, and they make no claims about markets.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="devi-list">
            {DEVI.map((d) => (
              <li key={d.key} id={d.key} className="devi-legend-item flex gap-3 rounded border border-slate-800 p-3" data-devi={d.key}>
                <span className="shrink-0">
                  <DeviMark devi={d.key} size={64} play replay />
                </span>
                <div className="min-w-0">
                  <h2 className="font-sans text-sm font-semibold text-slate-100">
                    {d.name} <span className="font-normal text-slate-500">({d.iast})</span>
                  </h2>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-cyan-300">Lens: {d.lens}</p>
                  <p className="mt-1 text-slate-300">{d.meaning}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{d.tooltip}</p>
                </div>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  );
}
