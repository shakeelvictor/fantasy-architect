// Past Drafts — v1's archive tab: committed files under public/drafts/ are
// the permanent record, rendered as a mini board + final rosters + trades.
// "Archive current draft" folds the REAL log into the same document and
// downloads it; committing it to public/drafts/ makes it history. Mock
// drafts are practice and never become history (v1's rule).

import { useEffect, useState } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import { SEASON, type PoolPlayer } from '../api';
import { buildArchive, type ArchiveDoc } from '../archive';
import { downloadBlob } from '../exports';
import { headshot } from '../profile';
import { splitName } from '../v1logic';

interface Entry { season: number; label: string; file?: string; doc?: ArchiveDoc }

interface Props {
  config: SeasonConfig;
  draft: DraftState; // the REAL draft, never the mock
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
}

export function ArchiveTab({ config, draft, byPid, teamName }: Props): React.JSX.Element {
  const [list, setList] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0);
  const [doc, setDoc] = useState<ArchiveDoc | null>(null);

  useEffect(() => {
    fetch('/drafts/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((raw: { season: number; file: string; label?: string }[]) => {
        if (!Array.isArray(raw)) return;
        setList(raw
          .map((e) => ({ season: e.season, label: e.label ?? String(e.season), file: e.file }))
          .sort((a, b) => b.season - a.season));
      })
      .catch(() => { /* none committed yet */ });
  }, []);

  useEffect(() => {
    const entry = list[sel];
    if (!entry) return;
    setDoc(null);
    if (entry.doc) { setDoc(entry.doc); return; }
    let live = true;
    fetch(`/drafts/${entry.file}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ArchiveDoc | null) => { if (live) setDoc(d); })
      .catch(() => { if (live) setDoc(null); });
    return () => { live = false; };
  }, [list, sel]);

  const total = config.teams * config.rounds;
  const cur = draft.picks.length;

  const archiveNow = (): void => {
    if (!cur) { window.alert('There are no picks to archive yet. Mock drafts are practice and never become history.'); return; }
    const built = buildArchive(config, draft, byPid, teamName, SEASON);
    if (!built.complete && !window.confirm(`This draft has ${cur} of ${total} picks. Archive it as-is?`)) return;
    downloadBlob(new TextEncoder().encode(JSON.stringify(built, null, 2)),
      `fa-draft-${SEASON}.json`, 'application/json');
  };

  return (
    <div id="archive-body">
      <div className="card">
        <div className="values-head">
          <h3>Past Drafts</h3>
          <button className="btn primary" data-testid="archive-now" onClick={archiveNow}>
            Archive current draft
          </button>
        </div>
        <p className="p-meta">
          {cur
            ? <>The {SEASON} draft has <b>{cur}</b> of {total} picks. Archiving downloads a JSON document of the whole thing; commit it to <code>apps/web/public/drafts/</code> and it shows up here permanently.</>
            : 'No picks in the current draft yet. Finished drafts archived here stay readable for good.'}
        </p>
      </div>
      {!list.length ? (
        <div className="card"><p className="p-meta">No past drafts yet. Archive one after draft night and it lands here.</p></div>
      ) : (
        <div className="card">
          <div className="pos-tabs" id="archive-picker">
            {list.map((e, i) => (
              <button key={e.season} data-testid={`archive-${e.season}`} className={i === sel ? 'active' : ''} onClick={() => setSel(i)}>
                {e.label}
              </button>
            ))}
          </div>
          {/* the whole point of the public page is that it can be handed out,
              so the link to hand out lives next to the draft it shows */}
          <p className="p-meta" data-testid="public-link" style={{ margin: '10px 0 4px' }}>
            Shareable, no PIN needed:{' '}
            <a href={`/${list[sel]!.season}`} target="_blank" rel="noopener noreferrer">
              {typeof window === 'undefined' ? '' : window.location.origin}/{list[sel]!.season}
            </a>{' '}
            — the board, rosters and grades, plus a search for which round a player went in.
          </p>
          <div id="archive-doc">
            {doc ? <ArchiveDocView doc={doc} /> : <p className="p-meta">Loading…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const OFF = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

export function ArchiveDocView({ doc }: { doc: ArchiveDoc }): React.JSX.Element {
  const teams = doc.config ? doc.config.teams : doc.teams.length;
  const rounds = doc.config ? doc.config.rounds : Math.ceil(doc.picks.length / teams);
  const byOverall = new Map(doc.picks.map((p) => [p.overall, p]));
  const trades = (doc.tradeLog ?? []).filter((t) => t.status === 'applied');
  const bal = doc.rosterBalance;

  const cells: React.JSX.Element[] = [<div key="h0" className="board-head"></div>];
  for (const t of doc.teams) cells.push(<div key={`h${t.slot}`} className="board-head">{t.name}</div>);
  for (let r = 1; r <= rounds; r++) {
    cells.push(<div key={`r${r}`} className="round-label">R{r}</div>);
    for (let s = 1; s <= teams; s++) {
      const pk = byOverall.get((r - 1) * teams + s);
      if (!pk) { cells.push(<div key={`c${r}-${s}`} className="board-cell"></div>); continue; }
      const moved = pk.origSlot != null && pk.origSlot !== pk.slot;
      const { first, last } = splitName(pk.name);
      cells.push(
        <div key={`c${r}-${s}`} className={`board-cell ${pk.pid ? 'has-shot ' : ''}c-${OFF.has(pk.pos) ? pk.pos : 'IDP'}`}>
          {pk.pid && <img className="bc-shot" loading="lazy" src={headshot(pk.pid)} alt=""
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
          <div className="bc-name">
            <span className="bc-first">{pk.keeper ? '🔒 ' : ''}{first}</span>
            <span className="bc-last">{last}</span>
          </div>
          <div className="bc-meta">{pk.pos}·{pk.team ?? 'FA'}{moved ? ' ·traded' : ''}</div>
        </div>,
      );
    }
  }

  return (
    <>
      <p className="p-meta" style={{ margin: '10px 0 14px' }}>
        {doc.league ?? ''} · {doc.season} · {doc.picks.length} picks · archived{' '}
        {doc.archivedAt ? new Date(doc.archivedAt).toLocaleDateString() : '—'}
        {doc.complete === false && <> · <b>incomplete</b></>}
        {doc.scoring ? ` · scored under ${doc.scoring}` : ''}
      </p>
      <div className="board-wrap">
        <div className="board-grid" style={{ gridTemplateColumns: `40px repeat(${teams}, minmax(112px, 1fr))` }}>
          {cells}
        </div>
      </div>
      <h4 style={{ marginTop: 16 }}>Final rosters</h4>
      {bal && (bal.balanced
        ? <div className="balance-ok">✓ Every team finished on {bal.target} players.</div>
        : <div className="balance-bad">⚠ Finished uneven.</div>)}
      <div className="grade-grid">
        {doc.teams.map((t) => (
          <div key={t.slot} className="grade-card">
            <div className="grade-head">
              <span className="grade-team">{t.name}</span>
              <span className="p-meta">{t.projectedPoints ? `${t.projectedPoints} proj pts` : ''}</span>
            </div>
            <div className="grade-stats">
              {t.roster.map((r) => (
                <div key={r.overall}>
                  {r.round}.{String(((r.overall - 1) % teams) + 1).padStart(2, '0')} <b>{r.name}</b>{' '}
                  <span className="p-meta">{r.pos}{r.keeper ? ' · keeper' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {trades.length > 0 && (
        <>
          <h4 style={{ marginTop: 16 }}>Trades</h4>
          <div className="p-meta">
            {trades.map((t, i) => (
              <div key={i}>• {t.detail ?? ''}{t.note ? ` — ${t.note}` : ''}</div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
