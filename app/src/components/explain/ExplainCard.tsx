import Link from "next/link";
import type { ExplainEvent } from "@/lib/explainTypes";
import { explainTag } from "@/lib/explainApi";
import { etClock, etFull } from "@/lib/timeET";
import { DeviMark } from "../devi";
import { SectionHeading } from "./SectionHeading";
import { Scenarios } from "./Scenarios";
import { Tradeoffs, Affected } from "./TradeoffsAffected";
import { WatchList } from "./WatchList";
import { Restrictions } from "./Restrictions";
import { Uncertain } from "./Uncertain";
import { EvidenceMeter } from "./EvidenceMeter";
import { PastCases } from "./PastCases";
import { TermsAndVoices } from "./TermsAndVoices";
import { HeatBadge } from "./HeatBadge";
import { Gloss } from "./GlossaryTerm";

// "Understand this" card (). Text first; Devi marks are decorative lenses. Times in ET.
export function ExplainCard({ event, play = false }: { event: ExplainEvent; play?: boolean }) {
  const tag = explainTag(event.category, event.subtype);
  const subject = event.coin ? event.coin.ticker : (event.topic ?? "market").replace(/_/g, " ");
  const t = event.text;
  return (
    <article className="explain-card" data-event={event.id} aria-label="Understand this">
      <header className="ex-header">
        <Link href="/about/devis#tara" className="ex-header-mark" aria-label="About the ten lenses"><DeviMark devi="tara" size={40} play={play} /></Link>
        <div className="ex-header-main">
          <div className="ex-header-top">
            <h2 className="ex-title">Understand this</h2>
            <EvidenceMeter evidence={event.evidence} />
          </div>
          <Link href="/about/devis" className="ex-about ex-link-quiet">About the ten lenses →</Link>
          <div className="ex-meta">
            <strong>{subject}</strong>
            <span className={`ex-tag ${tag.cls}`}>{tag.label}</span>
            <span className="ex-muted">{etFull(event.created_at)}</span>
            <span className="ex-muted">Updated {etClock(event.updated_at)} · rev {event.rev}</span>
          </div>
          <HeatBadge heat={event.heat} />
          {event.last_change ? <p className="ex-change" data-testid="ex-change"><span className="ex-muted">What changed:</span> {event.last_change.text}</p> : null}
        </div>
      </header>

      <div className="ex-rule" />
      <section className="ex-section" data-section="what">
        <SectionHeading devi="kali" play={play} />
        <p className="ex-body"><Gloss text={t.what} /></p>
      </section>
      <section className="ex-section" data-section="why">
        <SectionHeading devi="bhuvaneshwari" play={play} />
        <p className="ex-body"><Gloss text={t.why} /></p>
      </section>

      <div className="ex-rule" />
      <section className="ex-section" data-section="next">
        <SectionHeading devi="tripurasundari" play={play} sub={<span className="ex-muted"> — what could happen next</span>} />
        <Scenarios scenarios={t.scenarios} note={event.history.note} />
      </section>
      <Tradeoffs text={t.tradeoffs} play={play} />
      <Affected items={t.affected} play={play} />

      <div className="ex-rule" />
      <WatchList items={t.watch} play={play} />
      <Restrictions items={event.facts.restrictions} play={play} />
      <Uncertain items={t.uncertain} play={play} />

      <div className="ex-rule" />
      <section className="ex-section" data-section="evidence">
        <h3 className="ex-heading"><span className="ex-heading-text">Evidence</span></h3>
        <p className="ex-body"><EvidenceMeter evidence={event.evidence} withReason /></p>
      </section>
      <PastCases history={event.history} />
      <TermsAndVoices glossary={event.glossary} timeline={event.timeline} play={play} />

      <div className="ex-rule" />
      <footer className="ex-footer">Explains the news. Not advice. Nothing here says buy or sell. <Link href="/about/devis" className="ex-about">About the ten lenses →</Link></footer>
    </article>
  );
}
