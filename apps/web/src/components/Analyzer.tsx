// The Analyzer: draft grades for the live draft OR any archived season, and —
// once that season has actually been played — a retrospective checking those
// grades against what really happened.
//
// Grading is v1's: value over replacement PER PICK, z-scored across the teams
// that have picked, so a team is never marked down mid-draft for simply
// having picked fewer times. An archived draft is graded from the letter
// pinned into its document, which is the assessment as it stood on the night.

import { useEffect, useMemo, useState } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import { SEASON, type PoolPlayer } from '../api';
import type { ArchiveDoc } from '../archive';
import { computeGrades, type TeamGrade } from '../grades';
import { buildRetro, fetchActuals, type Actuals, type PlayerVerdict, type Retro } from '../hindsight';
import { pendingKeepersForSlot, rosterForSlot } from '../v1logic';

interface Source { season: number; label: string; file?: string }

export function Analyzer({ config, draft, byPid, teamName }: {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
}): React.JSX.Element {
  const [past, setPast] = useState<Source[]>([]);
  const [sel, setSel] = useState(0); // 0 = the live draft
  const [doc, setDoc] = useState<ArchiveDoc | null>(null);
  const [actuals, setActuals] = useState<Actuals | null | undefined>(undefined);

  useEffect(() => {
    fetch('/drafts/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((raw: { season: number; file: string; label?: string }[]) => {
        if (!Array.isArray(raw)) return;
        setPast(raw
          .filter((e) => e.season !== SEASON) // the live draft is already source 0
          .map((e) => ({ season: e.season, label: e.label ?? String(e.season), file: e.file }))
          .sort((a, b) => b.season - a.season));
      })
      .catch(() => { /* nothing archived yet */ });
  }, []);

  const source = sel === 0 ? null : past[sel - 1];

  useEffect(() => {
    if (!source) { setDoc(null); setActuals(undefined); return; }
    let live = true;
    setDoc(null);
    setActuals(undefined);
    void fetch(`/drafts/${source.file}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ArchiveDoc | null) => { if (live) setDoc(d); })
      .catch(() => { if (live) setDoc(null); });
    void fetchActuals(source.season).then((a) => { if (live) setActuals(a); });
    return () => { live = false; };
  }, [source?.season, source?.file]);

  // live grades — v1's per-pick rule
  const liveGrades = useMemo(() => computeGrades(
    Array.from({ length: config.teams }, (_, i) => i + 1).map((slot) => ({
      slot,
      name: teamName(slot),
      roster: [
        ...rosterForSlot(byPid, draft, slot),
        ...pendingKeepersForSlot(byPid, draft, slot).map((x) => x.p),
      ].map((p) => ({ proj: p.proj, vorp: p.vorp ?? 0 })),
    })),
  ), [config.teams, byPid, draft, teamName]);

  const archiveGrades: TeamGrade[] | null = useMemo(() => {
    if (!doc) return null;
    const computed = computeGrades(doc.teams.map((t) => ({
      slot: t.slot, name: t.name,
      roster: t.roster.map((r) => ({ proj: r.proj ?? 0, vorp: r.vorp ?? 0 })),
    })));
    // prefer the pinned letter — what was actually said that night
    return computed.map((g) => ({
      ...g,
      grade: doc.teams.find((t) => t.slot === g.slot)?.draftGrade ?? g.grade,
    }));
  }, [doc]);

  const retro = useMemo(
    () => (doc && actuals ? buildRetro(doc, actuals) : null),
    [doc, actuals],
  );

  return (
    <div className="analyzer" id="analyzer-content">
      {past.length > 0 && (
        <div className="pos-tabs" id="analyzer-source" style={{ marginBottom: 12 }}>
          <button data-testid="an-src-live" className={sel === 0 ? 'active' : ''} onClick={() => setSel(0)}>
            {SEASON} (live)
          </button>
          {past.map((s, i) => (
            <button key={s.season} data-testid={`an-src-${s.season}`}
              className={sel === i + 1 ? 'active' : ''} onClick={() => setSel(i + 1)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {sel === 0 ? (
        <>
          <GradeGrid teams={liveGrades} />
          {!draft.picks.length && (
            <p className="p-meta" style={{ marginTop: 12 }}>Grades sharpen as picks land.</p>
          )}
        </>
      ) : !doc || !archiveGrades ? (
        <p className="p-meta">Loading {source?.label}…</p>
      ) : (
        <>
          <p className="p-meta" style={{ margin: '0 0 12px' }}>
            {doc.league} · {doc.season} · {doc.picks.length} picks · graded on the projections
            the board held that night.
          </p>
          <GradeGrid teams={archiveGrades} />
          <Retrospective season={doc.season} retro={retro} actuals={actuals} />
        </>
      )}
    </div>
  );
}

function GradeGrid({ teams }: { teams: TeamGrade[] }): React.JSX.Element {
  return (
    <div className="grade-grid">
      {teams.map((t) => (
        <div key={t.slot} className="grade-card" data-slot={t.slot} data-testid={`grade-${t.slot}`}>
          <div className="grade-head">
            <span className="grade-team">{t.name}</span>
            <span className={`grade-letter g-${t.grade}`}>{t.grade}</span>
          </div>
          <div className="grade-stats">
            Projected points: <b>{t.proj.toFixed(0)}</b><br />
            Value over replacement: <b>{t.totalVorp.toFixed(0)}</b><br />
            Picks made: <b>{t.count}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ retrospective

const VERDICT_CLASS: Record<string, string> = {
  'called it': 'g-A', underrated: 'g-B', overrated: 'g-D',
};

function Retrospective({ season, retro, actuals }: {
  season: number; retro: Retro | null; actuals: Actuals | null | undefined;
}): React.JSX.Element {
  if (actuals === undefined) {
    return <p className="p-meta" style={{ marginTop: 16 }}>Checking the {season} results…</p>;
  }
  if (!retro) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Were the grades right?</h3>
        <p className="p-meta">
          No {season} games have been played yet, so there is nothing to check these grades against.
          This fills in from week 1 — the daily bake records what every drafted player actually
          scored under this league's rules, and the grades get marked against it.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div className="values-head">
        <h3 style={{ margin: 0 }}>Were the grades right?</h3>
        <span className="p-meta">
          {retro.complete ? 'Full season' : `Through week ${retro.throughWeek}`} · actual points
          scored under this league's rules
        </span>
      </div>
      <p className="p-meta" style={{ margin: '6px 0 12px' }}>
        <b>{retro.withinOne}</b> of {retro.teams.length} teams finished within one place of where
        the board ranked them; the average miss was <b>{retro.meanRankError}</b> places.
        {!retro.complete && ' Early weeks are noisy — a grade is a season-long claim.'}
      </p>
      <div className="grade-grid" data-testid="retro-grid">
        {retro.teams.map((t) => (
          <div key={t.slot} className="grade-card" data-testid={`retro-${t.slot}`}>
            <div className="grade-head">
              <span className="grade-team">{t.name}</span>
              <span>
                <span className={`grade-letter g-${t.draftGrade}`} title="Draft-night grade">{t.draftGrade}</span>
                <span className="p-meta" style={{ margin: '0 6px' }}>→</span>
                <span className={`grade-letter g-${t.actualGrade}`} title="Grade on what actually happened">{t.actualGrade}</span>
              </span>
            </div>
            <div className="grade-stats">
              <span className={`grade-letter ${VERDICT_CLASS[t.verdict] ?? ''}`}
                style={{ fontSize: 'var(--fs-12)', fontStyle: 'normal' }}>
                {t.verdict}
              </span>
              {t.rankDelta !== 0 && (
                <span className="p-meta"> · finished #{t.actualRank}, board said #{t.projRank}</span>
              )}
              <br />
              Actual points: <b>{t.actualPts.toFixed(0)}</b> <span className="p-meta">(projected {t.projPts})</span><br />
              <Verdict label="Best hit" p={t.bestHit} sign="+" />
              <Verdict label="Worst miss" p={t.worstMiss} sign="" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Verdict({ label, p, sign }: { label: string; p: PlayerVerdict | null; sign: string }): React.JSX.Element | null {
  if (!p) return null;
  const d = p.delta;
  return (
    <>
      {label}: <b>{p.name}</b>{' '}
      <span className="p-meta">
        {d >= 0 ? sign || '+' : ''}{d.toFixed(1)}/gm vs projection
        {p.games ? ` · ${p.games} gm` : ' · never played'}
      </span>
      <br />
    </>
  );
}
