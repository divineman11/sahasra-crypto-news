import data from "../../../ingest/explain/devi.json";
import { Tara } from "./Tara";
import { Kali } from "./Kali";
import { Bhuvaneshwari } from "./Bhuvaneshwari";
import { TripuraSundari } from "./TripuraSundari";
import { Chhinnamasta } from "./Chhinnamasta";
import { Kamala } from "./Kamala";
import { Bhairavi } from "./Bhairavi";
import { Bagalamukhi } from "./Bagalamukhi";
import { Dhumavati } from "./Dhumavati";
import { Matangi } from "./Matangi";
import type { DeviProps } from "./shapes";
import type { ComponentType } from "react";

export type DeviKey =
  | "tara" | "kali" | "bhuvaneshwari" | "tripurasundari" | "chhinnamasta"
  | "kamala" | "bhairavi" | "bagalamukhi" | "dhumavati" | "matangi";

export interface DeviEntry {
  key: DeviKey;
  name: string;
  iast: string;
  lens: string;
  meaning: string;
  tooltip: string;
  accentVar: string;
  Component: ComponentType<DeviProps>;
}

const COMPONENTS: Record<DeviKey, ComponentType<DeviProps>> = {
  tara: Tara, kali: Kali, bhuvaneshwari: Bhuvaneshwari, tripurasundari: TripuraSundari, chhinnamasta: Chhinnamasta,
  kamala: Kamala, bhairavi: Bhairavi, bagalamukhi: Bagalamukhi, dhumavati: Dhumavati, matangi: Matangi,
};

// Single source of truth for the mapping is ingest/explain/devi.json (legend page, tooltips, tests).
export const DEVI: DeviEntry[] = data.devis.map((d) => ({
  key: d.key as DeviKey,
  name: d.name,
  iast: d.iast,
  lens: d.lens,
  meaning: d.meaning,
  tooltip: d.tooltip,
  accentVar: d.accentVar,
  Component: COMPONENTS[d.key as DeviKey],
}));

export const DEVI_BY_KEY = Object.fromEntries(DEVI.map((d) => [d.key, d])) as Record<DeviKey, DeviEntry>;
