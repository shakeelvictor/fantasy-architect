// The Analyzer: draft grades for the live draft OR any archived season, and —
// once that season has actually been played — a retrospective checking those
// grades against what really happened.
//
// Grading is v1's: value over replacement PER PICK, z-scored across the teams
// that have picked, so a team is never marked down mid-draft for simply
// having picked fewer times. An archived draft is graded from the letter
// pinned into its document, which is the assessment as it stood on the night.
//
// Every grade card opens v1's hot take (blurbs.ts) — the last piece of the
// Analyzer the original port skipped. It works on the live board and on an
// archived one, so the public /{year} page gets it too.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DraftState, SeasonConfig } from '@fa/rules';
import { SEASON, type PoolPlayer } from '../api';
import { gradesFromArchive, type ArchiveDoc } from '../archive';
import { computeGrades, type TeamGrade } from '../grades';
import { buildRetro, fetchActuals, type Actuals, type PlayerVerdict, type Retro } from '../hindsight';
import { blurbContext, buildTeamBlurb, groupOf, takesFromArchive, type BlurbTeam } from '../blurbs';
import { isSleeper, pendingKeepersForSlot, rosterForSlot } from '../v1logic';

interface Source { season: number; label: string; file?: string }

export function Analyzer({ config, draft, byPid, teamName, mySlot }: {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  mySlot?: number;
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

  const archiveGrades: TeamGrade[] | null = useMemo(
    () => (doc ? gradesFromArchive(doc) : null), [doc]);

  const retro = useMemo(
    () => (doc && actuals ? buildRetro(doc, actuals) : null),
    [doc, actuals],
  );

  // takes for the live draft: real picks, in board order, with the 💎 rule
  // applied off each player's rank on the full board
  const liveTakes: BlurbTeam[] = useMemo(() => liveGrades.map((g) => ({
    slot: g.slot,
    name: g.name,
    grade: g.grade,
    picks: draft.picks
      .filter((pk) => pk.slot === g.slot)
      .map((pk) => {
        const p = byPid.get(pk.pid);
        return {
          name: p?.name ?? pk.pid,
          pos: p?.pos ?? '',
          group: p?.group ?? groupOf(p?.pos ?? ''),
          round: pk.round,
          overall: pk.overall,
          keeper: pk.is_keeper,
          adp: p?.adp ?? null,
          sleeper: !!p && isSleeper(p, p.overallRank ?? Infinity),
        };
      }),
  })), [liveGrades, draft.picks, byPid]);

  const archiveTakes: BlurbTeam[] | null = useMemo(
    () => (doc && archiveGrades
      ? takesFromArchive(doc.teams, (slot) => archiveGrades.find((g) => g.slot === slot)?.grade ?? 'C')
      : null),
    [doc, archiveGrades],
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
          <GradeGrid teams={liveGrades} takes={liveTakes} mySlot={mySlot} />
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
          <GradeGrid teams={archiveGrades} takes={archiveTakes ?? undefined} />
          <Retrospective season={doc.season} retro={retro} actuals={actuals} />
        </>
      )}
    </div>
  );
}

export function GradeGrid({ teams, takes, mySlot }: {
  teams: TeamGrade[];
  /** Supply this and the cards become clickable, opening v1's hot take. */
  takes?: BlurbTeam[] | undefined;
  mySlot?: number | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  // one context for the whole grid: the rotation that keeps two teams from
  // drawing the same sentence only works if every team is considered together
  const ctx = useMemo(() => (takes ? blurbContext(takes) : null), [takes]);
  const shown = takes?.find((t) => t.slot === open) ?? null;

  return (
    <>
      <div className="grade-grid">
        {teams.map((t) => (
          <div key={t.slot} className={`grade-card${takes ? ' clickable' : ''}`}
            data-slot={t.slot} data-testid={`grade-${t.slot}`}
            title={takes ? 'Click for the hot take' : undefined}
            onClick={takes ? () => setOpen(t.slot) : undefined}>
            <div className="grade-head">
              <span className="grade-team">{t.name}{t.slot === mySlot ? ' ⭐' : ''}</span>
              <span className={`grade-letter g-${t.grade}`}>{t.grade}</span>
            </div>
            <div className="grade-stats">
              Projected points: <b>{t.proj.toFixed(0)}</b><br />
              Value over replacement: <b>{t.totalVorp.toFixed(0)}</b><br />
              Picks made: <b>{t.count}</b>
            </div>
            {takes && <div className="grade-hint">🎙 the hot take →</div>}
          </div>
        ))}
      </div>
      {shown && ctx && (
        <TeamTake team={shown} ctx={ctx} grade={teams.find((x) => x.slot === shown.slot)}
          isMe={shown.slot === mySlot} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

// v1's #team-modal, markup for markup — .team-take, .team-take-head,
// .team-blurb and .grade-letter.big are all already in v1.css.
//
// PORTALLED to document.body, and that is not decoration. v1 put this modal
// at the end of #app; rendering it where the grid lives instead puts it
// inside `.card`, which carries a transform — and a transform makes a
// `position: fixed` descendant resolve against THAT box rather than the
// viewport. The modal was landing 3600px down the page, off screen. A portal
// restores v1's placement and is immune to whatever wraps the grid next.
function TeamTake({ team, ctx, grade, isMe, onClose }: {
  team: BlurbTeam;
  ctx: ReturnType<typeof blurbContext>;
  grade: TeamGrade | undefined;
  isMe: boolean;
  onClose: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal" id="team-modal" data-testid="team-take"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card team-take">
        <div className="team-take-head">
          <h2 id="team-modal-name">{team.name}{isMe ? ' ⭐' : ''}</h2>
          <span className={`grade-letter big g-${team.grade}`}>{team.grade}</span>
        </div>
        <p className="team-blurb" data-testid="team-take-blurb">
          {buildTeamBlurb(team, ctx, isMe)}
        </p>
        <div className="p-meta" data-testid="team-take-facts">
          {grade && grade.count
            ? `${grade.count} pick${grade.count === 1 ? '' : 's'} · ${grade.proj.toFixed(0)} projected points · ${grade.totalVorp.toFixed(0)} value over replacement`
            : ''}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------ retrospective

const VERDICT_CLASS: Record<string, string> = {
  'called it': 'g-A', underrated: 'g-B', overrated: 'g-D',
};

export function Retrospective({ season, retro, actuals }: {
  season: number; retro: Retro | null; actuals: Actuals | null | undefined;
}): React.JSX.Element {
  if (actuals === undefined) {
    return <p className="p-meta" style={{ marginTop: 16 }}>Checking the {season} results…</p>;
  }
  // A draft grade is a claim about a whole season, so it is only marked once
  // that season is finished — weeks 1-17 here, the regular season plus the
  // 15-17 playoff window. Part-way through, this shows where the season is up
  // to and nothing more.
  if (!retro) {
    const weeks = actuals?.seasonWeeks ?? 17;
    const played = actuals?.throughWeek ?? 0;
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h3>Did the draft hold up?</h3>
        <p className="p-meta" data-testid="retro-pending">
          {played === 0
            ? `The ${season} season has not kicked off yet.`
            : `The ${season} season is ${played} of ${weeks} weeks in.`}{' '}
          These grades get marked once it finishes — a draft grade is a claim about a whole
          season, and scoring it week by week would measure luck more than the claim.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div className="values-head">
        <h3 style={{ margin: 0 }}>Did the draft hold up?</h3>
        <span className="p-meta">
          Final · weeks 1–{retro.seasonWeeks} scored under this league's rules
        </span>
      </div>
      <p className="p-meta" style={{ margin: '6px 0 12px' }}>
        <b>{retro.withinOne}</b> of {retro.teams.length} drafted squads landed within one place of
        where the board ranked them; the average miss was <b>{retro.meanRankError}</b> places.
      </p>
      {/* The distinction that makes these numbers readable. Without it "actual
          grade F" looks like a bad season, when it may be a bad draft that
          waivers rescued — two different claims. */}
      <p className="p-meta" data-testid="retro-scope" style={{ margin: '0 0 12px' }}>
        This follows the <b>players each team drafted</b>, wherever they ended up — every point
        they scored counts to the team that picked them, even after a drop or a trade. It grades
        the draft, not the season: a team can win the league off waivers on a draft that graded
        badly here, and that gap is the point rather than an error.
      </p>
      <div className="grade-grid" data-testid="retro-grid">
        {retro.teams.map((t) => (
          <div key={t.slot} className="grade-card" data-testid={`retro-${t.slot}`}>
            <div className="grade-head">
              <span className="grade-team">{t.name}</span>
              <span>
                <span className={`grade-letter g-${t.draftGrade}`} title="Draft-night grade">{t.draftGrade}</span>
                <span className="p-meta" style={{ margin: '0 6px' }}>→</span>
                <span className={`grade-letter g-${t.actualGrade}`}
                  title="Grade on what the drafted players went on to score">{t.actualGrade}</span>
              </span>
            </div>
            <div className="grade-stats">
              <span className={`grade-letter ${VERDICT_CLASS[t.verdict] ?? ''}`}
                style={{ fontSize: 'var(--fs-12)', fontStyle: 'normal' }}>
                {t.verdict}
              </span>
              {t.rankDelta !== 0 && (
                <span className="p-meta"> · drafted squad #{t.actualRank}, board said #{t.projRank}</span>
              )}
              <br />
              Draft squad scored: <b>{t.actualPts.toFixed(0)}</b>{' '}
              <span className="p-meta">(board said {t.projPts})</span><br />
              <Verdict label="Best hit" p={t.bestHit} />
              <Verdict label="Worst miss" p={t.worstMiss} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Verdict({ label, p }: { label: string; p: PlayerVerdict | null }): React.JSX.Element | null {
  if (!p) return null;
  return (
    <>
      {label}: <b>{p.name}</b>{' '}
      <span className="p-meta">
        {p.delta >= 0 ? '+' : ''}{p.delta.toFixed(0)} vs projection
        {p.games ? ` · ${p.games} gm` : ' · never played'}
      </span>
      <br />
    </>
  );
}
