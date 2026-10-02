# The ten lenses (Devi marks)

The "Understand this" cards use ten small line-art marks, one per section. They are **original, contemporary editorial
symbols inspired by the Daśa Mahāvidyā**: decorative lenses for reading news, not devotional images, not ritual yantras,
and they make no claims about markets. A mark never labels a kind of news, a sentiment, a price direction or a scenario;
the same ten appear on every card, and every heading is text first (the marks are `aria-hidden`).

| # | Devi | Section (lens) | Meaning | Emblem |
|---|---|---|---|---|
| 1 | Tara (Tārā) | Understand this | Guidance across difficult water. | lotus over crossing waves |
| 2 | Kali (Kālī) | What changes? | Time and transformation. | opening circular arc |
| 3 | Bhuvaneshwari (Bhuvaneśvarī) | Wider context | The whole field in which things happen. | nested horizons |
| 4 | Tripura Sundari (Tripurasundarī) | Putting it together | The beauty of a complete, balanced picture. | three balanced petal clusters |
| 5 | Chhinnamasta (Chinnamastā) | Trade-offs | Energy given so that others are nourished. | three flowing ribbons |
| 6 | Kamala (Kamalā) | Who is affected? | Flourishing and plenty. | unfolding lotus |
| 7 | Bhairavi (Bhairavī) | What deserves attention? | Fierce, steady attention. | steady flame in a triangle |
| 8 | Bagalamukhi (Bagalāmukhī) | Pauses and restrictions | Stillness and restraint. | waves settling into a line |
| 9 | Dhumavati (Dhūmāvatī) | What remains uncertain? | Endurance when things are unclear. | open ring with smoke curves |
| 10 | Matangi (Mātaṅgī) | Terms and voices | The spoken word and learning. | abstract veena strings |

Tooltip text for every mark: *"Inspired by {Devi}'s association with {attribute}; a contemporary editorial interpretation."*

## Art rules
- Stroke-only inline SVG, `currentColor`, round caps; per-Devi colours are CSS tokens (`--devi-<name>`, `--devi-<name>-2`).
- No figures, faces, weapons, gore, Devanagari or invented syllables; no external assets or libraries.
- The mapping lives in `app/ingest/explain/devi.json` (one source for the legend page, tooltips and code).

## Motion rules
- One short, abstract animation per mark (2-4 s), played **once** when the card first becomes at least 50% visible. No idle loop.
- Only `opacity`, `transform` and `stroke-dashoffset` are animated; the resting drawing is the resolved final frame.
- `prefers-reduced-motion: reduce` shows the static frame only; leaving the viewport mid-play cancels to the static frame.
