// The public record of a past draft: fantasy-architect.netlify.app/2026
//
// No PIN. That is not a hole — the archive under public/drafts/ is already a
// world-readable static file and the anon key in this bundle already reads
// every season; the PIN gates WRITES and always did. What this adds is a URL
// a manager can open without being handed credentials.
//
// It exists mainly to answer one question: what round did this player go in?
// Keepers cost the round a player was drafted in, so every off-season someone
// has to work that out, and until now the only way was to ask the
// commissioner. The search below answers it in one keystroke.
//
// Everything rendered here is the same component the signed-in app uses —
// ArchiveDocView for the board and rosters, GradeGrid and Retrospective for
// the Analyzer — so the public view can never drift from the private one.

import { useEffect, useMemo, useState } from 'react';
import { gradesFromArchive, type ArchiveDoc, type ArchivePick } from '../archive';
import { buildRetro, fetchActuals, type Actuals } from '../hindsight';
import { takesFromArchive } from '../blurbs';
import { GradeGrid, Retrospective } from './Analyzer';
import { ArchiveDocView } from './ArchiveTab';

interface Entry { season: number; label: string; file: string }

export function PublicSeason({ year }: { year: number }): React.JSX.Element {
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [doc, setDoc] = useState<ArchiveDoc | null | undefined>(undefined);
  const [actuals, setActuals] = useState<Actuals | null | undefined>(undefined);
  const [term, setTerm] = useState('');

  useEffect(() => {
    fetch('/drafts/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((raw: Entry[]) => setIndex(Array.isArray(raw) ? [...raw].sort((a, b) => b.season - a.season) : []))
      .catch(() => setIndex([]));
  }, []);

  useEffect(() => {
    let live = true;
    setDoc(undefined);
    fetch(`/drafts/${year}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<ArchiveDoc>) : null))
      .then((d) => { if (live) setDoc(d); })
      .catch(() => { if (live) setDoc(null); });
    void fetchActuals(year).then((a) => { if (live) setActuals(a); });
    return () => { live = false; };
  }, [year]);

  const grades = useMemo(() => (doc ? gradesFromArchive(doc) : null), [doc]);
  const takes = useMemo(
    () => (doc && grades
      ? takesFromArchive(doc.teams, (slot) => grades.find((g) => g.slot === slot)?.grade ?? 'C')
      : null),
    [doc, grades],
  );
  const retro = useMemo(() => (doc && actuals ? buildRetro(doc, actuals) : null), [doc, actuals]);

  const teams = doc?.config?.teams ?? doc?.teams.length ?? 0;
  const hits = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!doc || t.length < 2) return [];
    return doc.picks
      .filter((p) => p.name.toLowerCase().includes(t))
      .sort((a, b) => a.overall - b.overall)
      .slice(0, 12);
  }, [doc, term]);

  const teamOf = (slot: number): string =>
    doc?.teams.find((t) => t.slot === slot)?.name ?? `Team ${slot}`;

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">FA</span>
          <div className="brand-text">
            <span id="league-name">Fantasy Architect</span>
            <span className="brand-sub">
              {doc ? `${doc.league} · ${doc.season} draft · ${doc.picks.length} picks` : `${year} draft`}
            </span>
          </div>
        </div>
        <div className="clock-banner">
          <span className="clock-pill" data-testid="public-banner">Draft record · read-only</span>
        </div>
      </header>

      {index && index.length > 1 && (
        <nav className="tabs" id="public-years">
          {index.map((e) => (
            <a key={e.season} href={`/${e.season}`} data-testid={`year-${e.season}`}
              className={e.season === year ? 'active' : ''}>
              {e.label}
            </a>
          ))}
        </nav>
      )}

      <main>
        {doc === undefined ? (
          <div className="card"><p className="p-meta">Loading the {year} draft…</p></div>
        ) : !doc ? (
          <div className="card" data-testid="public-missing" style={{ maxWidth: 620 }}>
            <h3>No {year} draft here yet</h3>
            <p className="p-meta">
              A draft appears at this address once it has been archived — the commissioner does
              that from Past Drafts after draft night.
              {index && index.length > 0 && (
                <> Archived so far: {index.map((e) => e.label).join(', ')}.</>
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="card">
              <h3>Which round did a player go in?</h3>
              <p className="p-meta" style={{ marginBottom: 8 }}>
                Keepers cost the round a player was drafted in, so this is usually the thing you
                need. Type any name.
              </p>
              <input
                type="search"
                data-testid="public-search"
                placeholder={`Search the ${year} draft…`}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                style={{ width: '100%', maxWidth: 420 }}
              />
              {term.trim().length >= 2 && (
                <div className="list" data-testid="public-results" style={{ marginTop: 10 }}>
                  {hits.length === 0 ? (
                    <p className="p-meta">Nobody by that name was drafted in {year}.</p>
                  ) : hits.map((p: ArchivePick) => (
                    <div key={p.overall} className="rec-item" data-testid={`hit-${p.pid}`}>
                      <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>
                      <div className="rec-main">
                        <div className="rec-name">{p.name}{p.keeper ? ' 🔒' : ''}</div>
                        <div className="rec-why">
                          {p.team ?? 'FA'} · pick {p.round}.
                          {String(((p.overall - 1) % teams) + 1).padStart(2, '0')} (#{p.overall} overall)
                          {' → '}<b>{teamOf(p.slot)}</b>
                          {p.keeper ? ' · was a keeper' : ''}
                        </div>
                      </div>
                      <span className="rec-pts" title="Round drafted">R{p.round}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <ArchiveDocView doc={doc} />
            </div>

            <div className="card">
              <h3>Analyzer — draft grades</h3>
              <p className="p-meta" style={{ margin: '0 0 12px' }}>
                Graded on the projections the board held that night, on value per pick.
              </p>
              {grades && <GradeGrid teams={grades} takes={takes ?? undefined} />}
              <Retrospective season={doc.season} retro={retro} actuals={actuals} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
