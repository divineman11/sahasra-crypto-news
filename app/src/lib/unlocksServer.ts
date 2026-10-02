import fs from "fs";
import path from "path";
import type { UnlockView } from "./unlockTypes";

// Server-side reader for ingest/cache/unlocks/view.json (written atomically by the collector).
// Read on request with an mtime cache: no polling, no database.
function viewFile(): string {
  const dir = process.env.UNLOCKS_DIR || path.join(process.cwd(), "ingest", "cache", "unlocks");
  return path.join(dir, "view.json");
}

let cache: { file: string; mtime: number; view: UnlockView | null } = { file: "", mtime: -1, view: null };

export function readUnlockView(): UnlockView | null {
  const file = viewFile();
  try {
    const st = fs.statSync(file);
    if (cache.file === file && cache.mtime === st.mtimeMs) return cache.view;
    const view = JSON.parse(fs.readFileSync(file, "utf8")) as UnlockView;
    cache = { file, mtime: st.mtimeMs, view };
    return view;
  } catch {
    return null;
  }
}
