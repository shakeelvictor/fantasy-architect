// v1's player card/drawer (openDrawer + showDrawerTab), verbatim DOM over v2
// state: Sleeper-style hero band with the vitals strip and league-scoring
// ranks, Summary / Game Log / Depth / News tabs, and the news rail down the
// right on wide screens. Remote parts (outlook, news, last season's game log)
// come straight from Sleeper's open-CORS endpoints via src/profile.ts; the
// game log is re-scored client-side under IMP rules with @fa/scoring.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { scoreWeek } from '@fa/scoring';
import { currentOverall, ownerOf, roundOf, type DraftState, type SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from '../api';
import {
  DEPTH_LABEL, DEPTH_ORDER, fpSlug, headshot, heightStr, logStatLine,
  playerProfile, sourceLabel, teamLogo, timeAgo, trendingAdds,
  type GameLog, type NewsItem, type Outlook,
} from '../profile';
import { sosClass } from '../v1logic';
import { toggleQueued, useQueue } from '../queue';

type Tab = 'summary' | 'log' | 'depth' | 'news';

interface Props {
  pid: string;
  players: PoolPlayer[];
  byPid: Map<string, PoolPlayer>;
  sosRanks: Record<string, Record<string, number>>;
  season: string; // the bake's season — outlook + projection labels
  prior: string; //  and the season the game log is from
  config: SeasonConfig;
  draft: DraftState;
  teamName: (slot: number) => string;
  mode: 'commish' | 'team';
  mySlot: number;
  done: boolean;
  disabled: boolean;
  onDraft: (pid: string) => void;
  onAsk: (pid: string) => void;
  onOpen: (pid: string) => void;
  onClose: () => void;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function Drawer(props: Props): React.JSX.Element | null {
  const { pid, byPid, onClose, onOpen } = props;
  const p = byPid.get(pid);

  const [tab, setTab] = useState<Tab>('summary');
  const [outlook, setOutlook] = useState<Outlook | null | undefined>(undefined);
  const [news, setNews] = useState<NewsItem[] | null | undefined>(undefined);
  const [gamelog, setGamelog] = useState<GameLog | undefined>(undefined);
  const [trend, setTrend] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new player mid-close cancels the exit — the card opens on the player
  // just asked for instead of finishing its fade on top of them (v1's rule).
  useEffect(() => {
    setTab('summary');
    setClosing(false);
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOutlook(undefined);
    setNews(undefined);
    setGamelog(undefined);
    setTrend(null);
    if (drawerRef.current) drawerRef.current.scrollTop = 0;
    let live = true;
    const prof = playerProfile(pid, props.season, props.prior);
    void prof.outlook.then((o) => { if (live) setOutlook(o); });
    void prof.news.then((n) => { if (live) setNews(n); });
    void prof.gamelog.then((g) => { if (live) setGamelog(g); });
    void trendingAdds().then((m) => { if (live) setTrend(m.get(pid) ?? null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  // The card plays an exit animation, so it can't unmount on the tick it is
  // dismissed. The timer is the load-bearing part — a tab backgrounded
  // mid-close never fires animationend, and a card that never leaves is a
  // backdrop that swallows every click on the board.
  const requestClose = (): void => {
    if (closing) return;
    const reduced = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { onClose(); return; }
    setClosing(true);
    const el = drawerRef.current;
    const finish = (): void => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      onClose();
    };
    const onEnd = (e: AnimationEvent): void => {
      // animationend BUBBLES — only the card's own exit counts
      if (e.target !== el) return;
      el?.removeEventListener('animationend', onEnd);
      finish();
    };
    el?.addEventListener('animationend', onEnd);
    closeTimer.current = setTimeout(() => {
      el?.removeEventListener('animationend', onEnd);
      finish();
    }, 400);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  if (!p) return null;

  return (
    <>
      <div
        id="drawer-backdrop"
        className={`drawer-backdrop${closing ? ' is-closing' : ''}`}
        onClick={requestClose}
      ></div>
      <aside id="player-drawer" data-testid="player-drawer" className={`drawer${closing ? ' is-closing' : ''}`} ref={drawerRef}>
        <button className="icon-btn close-x" id="drawer-close" data-testid="drawer-close" onClick={requestClose}>✕</button>
        <Hero p={p} trend={trend} />
        <div className="pc-body">
          <div className="pc-main">
            <ActionArea {...props} p={p} requestClose={requestClose} />
            <QueueRow {...props} p={p} />
            <nav className="tabs drawer-tabs" id="drawer-tabs">
              {(['summary', 'log', 'depth', 'news'] as Tab[]).map((t) => (
                <button key={t} data-tab={t} data-testid={`drawer-tab-${t}`} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'summary' ? 'Summary' : t === 'log' ? 'Game Log' : t === 'depth' ? 'Depth' : 'News'}
                </button>
              ))}
            </nav>
            <div id="drawer-tab-body">
              {tab === 'summary' && <SummaryTab {...props} p={p} outlook={outlook} />}
              {tab === 'log' && <GameLogTab p={p} gamelog={gamelog} season={props.season} prior={props.prior} />}
              {tab === 'depth' && <DepthTab p={p} players={props.players} draft={props.draft} onOpen={onOpen} />}
              {tab === 'news' && (news === undefined
                ? <p className="p-meta">Loading news…</p>
                : <NewsList items={news} playerName={p.name} />)}
            </div>
          </div>
          <NewsRail news={news} playerName={p.name} />
        </div>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------- hero

function Hero({ p, trend }: { p: PoolPlayer; trend: number | null }): React.JSX.Element {
  const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    (e.target as HTMLImageElement).style.display = 'none';
  };
  const bio = [
    p.number != null ? `#${p.number}` : null,
    heightStr(p.height),
    p.weight ? `${p.weight} lbs` : null,
    p.age ? `Age ${p.age}` : null,
    p.yearsExp != null ? (p.yearsExp === 0 ? 'Rookie' : `${p.yearsExp} yrs exp`) : null,
    p.college,
  ].filter(Boolean);
  const vitals: [string, string | null][] = [
    ['Age', p.age != null ? String(p.age) : null],
    ['Height', heightStr(p.height)],
    ['Weight', p.weight ? `${p.weight}` : null],
    ['Exp', p.yearsExp != null ? (p.yearsExp === 0 ? 'R' : String(p.yearsExp)) : null],
    ['College', p.college ?? null],
  ];
  const ranks: [string, string][] = [
    [`#${p.posRank}`, p.pos],
    [p.overallRank != null ? `#${p.overallRank}` : '—', 'Overall'],
    [p.adp != null ? p.adp.toFixed(1) : '—', 'ADP'],
    [p.tier ? `T${p.tier}` : '—', 'Tier'],
    [p.bye ? String(p.bye) : '—', 'Bye'],
  ];
  return (
    <div className="drawer-hero">
      {p.team && <img className="pc-watermark" src={teamLogo(p.team)} alt="" onError={hideOnError} />}
      <img className="headshot" src={headshot(p.pid)} alt="" onError={hideOnError} />
      <div className="hero-main">
        <h2>
          {p.name}
          {p.number != null && (
            <span className="pc-num">
              {p.team && <img src={teamLogo(p.team)} alt="" onError={hideOnError} />}
              #{p.number}
            </span>
          )}
        </h2>
        <div className="sub">
          <span className={`pos-pill pos-${p.pos}`}>{p.pos}</span>{' '}
          {p.team ?? 'FA'}{p.tier ? <> · <b>Tier {p.tier}</b></> : null} · Bye {p.bye ?? '—'}{' '}
          {p.depthOrder ? `· ${p.depthPos ?? p.pos}${p.depthOrder} on depth chart` : ''}
          {p.injury && <span className="inj-chip">{p.injury}</span>}
        </div>
        <div className="bio-line">{bio.join(' · ')}</div>
        <div className="pc-vitals">
          {vitals.filter(([, v]) => v).map(([l, v]) => (
            <span key={l} className="pc-vital"><i>{l}</i><b>{v}{l === 'Weight' ? <i>lbs</i> : null}</b></span>
          ))}
        </div>
        <div className="pc-ranks-label">Player rankings <span>· this league's scoring</span></div>
        <div className="pc-ranks">
          {ranks.map(([v, l]) => (
            <span key={l} className="pc-rank"><b>{v}</b><i>{l}</i></span>
          ))}
          {p.injury && <span className="inj-chip">{p.injury}</span>}
        </div>
        {trend != null && <div className="trend-badge">🔥 {trend.toLocaleString()} adds on Sleeper in 48h</div>}
      </div>
      <span className={`pc-posbadge pos-pill pos-${p.pos}`}>{p.pos}</span>
      {p.team && <img className="hero-logo" src={teamLogo(p.team)} alt="" onError={hideOnError} />}
    </div>
  );
}

// ---------------------------------------------------- action + queue rows

function ActionArea(props: Props & { p: PoolPlayer; requestClose: () => void }): React.JSX.Element | null {
  const { p, config, draft, teamName, mode, mySlot, done, disabled, onDraft, onAsk, requestClose } = props;
  const drafted = draft.picks.find((pk) => pk.pid === p.pid);
  const keeper = draft.keepers.find((k) => k.pid === p.pid);
  if (drafted) {
    const pir = ((drafted.overall - 1) % config.teams) + 1;
    return (
      <div className="drafted-banner" data-testid="drawer-drafted">
        {drafted.is_keeper ? '🔒 Kept' : '✅ Drafted'} by <b>{teamName(drafted.slot)}</b> — pick {drafted.round}.{pad2(pir)} (#{drafted.overall} overall)
      </div>
    );
  }
  if (keeper) {
    return (
      <div className="drafted-banner">
        🔒 Registered keeper for <b>{teamName(keeper.slot)}</b>, round {keeper.round} — off the board
      </div>
    );
  }
  if (done) return null;
  const cur = currentOverall(draft);
  const round = roundOf(config, cur);
  const pir = ((cur - 1) % config.teams) + 1;
  const owner = ownerOf(config, draft, cur);
  const label = `pick ${round}.${pad2(pir)} for ${teamName(owner)}`;
  if (mode === 'commish') {
    return (
      <button
        className="btn primary drawer-draft"
        data-testid="drawer-draft"
        disabled={disabled}
        onClick={() => onDraft(p.pid)}
      >
        Draft {p.name} · {label}
      </button>
    );
  }
  const asked = draft.requests.some((r) => !r.resolved && r.pid === p.pid);
  const onClock = owner === mySlot;
  return (
    <button
      className="btn primary drawer-draft"
      data-testid="drawer-ask"
      disabled={disabled || asked}
      onClick={() => { onAsk(p.pid); requestClose(); }}
    >
      {asked
        ? 'Asked — waiting on the commissioner'
        : onClock
          ? `Draft ${p.name} · ${label}`
          : `Pre-pick ${p.name} for when your turn comes`}
    </button>
  );
}

function QueueRow({ p, draft, byPid }: Props & { p: PoolPlayer }): React.JSX.Element | null {
  const queue = useQueue();
  const gone = useMemo(() => new Set(draft.picks.map((pk) => pk.pid)), [draft.picks]);
  const kept = useMemo(() => new Set(draft.keepers.map((k) => k.pid)), [draft.keepers]);
  if (gone.has(p.pid) || kept.has(p.pid)) return null;
  const visible = queue.filter((pid) => byPid.has(pid) && !gone.has(pid) && !kept.has(pid));
  const inQ = queue.includes(p.pid);
  return (
    <div className="myrank-row">
      <button className="btn" id="drawer-queue" data-testid="drawer-queue" onClick={() => toggleQueued(p.pid)}>
        {inQ ? '★ In your queue — remove' : '☆ Add to my queue'}
      </button>
      <span className="p-meta" id="drawer-queue-note">
        {inQ
          ? `#${visible.indexOf(p.pid) + 1} of ${visible.length} · reorder from the ★ Queue view`
          : 'your list only, this browser only'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- summary

function SummaryTab(props: Props & { p: PoolPlayer; outlook: Outlook | null | undefined }): React.JSX.Element {
  const { p, outlook, season, prior, sosRanks } = props;
  const newsAge = p.newsUpdated ? Math.round((Date.now() - p.newsUpdated) / (3600 * 1000)) : null;
  const fpUrl = `https://www.fantasypros.com/nfl/players/${fpSlug(p.name)}.php`;
  const newsUrl = `https://news.google.com/search?q=${encodeURIComponent(p.name + ' ' + (p.team ?? 'NFL'))}`;
  return (
    <>
      <div id="outlook-slot">
        {outlook === undefined
          ? <p className="p-meta">Loading the {season} outlook…</p>
          : <OutlookBlock outlook={outlook} season={season} pid={p.pid} />}
      </div>
      <div className="stat-grid">
        <div className="stat-box"><div className="v">{p.proj.toFixed(1)}</div><div className="l">Proj (custom)</div></div>
        <div className="stat-box"><div className="v">{p.ppg != null ? p.ppg.toFixed(1) : '—'}</div><div className="l">Per game</div></div>
        <div className="stat-box"><div className="v">{p.adp != null ? p.adp.toFixed(1) : '—'}</div><div className="l">ADP</div></div>
        <div className="stat-box"><div className="v">{p.pos}{p.posRank}</div><div className="l">Pos rank</div></div>
        <div className="stat-box"><div className={`v ${sosClass(p.sos)}`}>{p.sos != null ? `${p.sos.toFixed(0)}/32` : '—'}</div><div className="l">SOS wk 1–14</div></div>
        <div className="stat-box"><div className={`v ${sosClass(p.po)}`}>{p.po != null ? `${p.po.toFixed(0)}/32` : '—'}</div><div className="l">SOS wk 15–17</div></div>
      </div>
      {p.lastSeason != null && (
        <div className="season-compare">
          <span>{prior} actual: <b>{p.lastSeason.toFixed(0)}</b>{p.lastSeasonRank ? ` (${p.pos}${p.lastSeasonRank})` : ''}</span>
          <span className="arrow">→</span>
          <span>{season} proj: <b>{p.proj.toFixed(0)}</b> ({p.pos}{p.posRank})</span>
        </div>
      )}
      {p.injury && (
        <div className="inj-note">
          <b>{p.injury}</b>{p.injuryPart ? ` — ${p.injuryPart}` : ''}
          {p.injuryNotes ? <><br />{p.injuryNotes}</> : null}
          {newsAge != null && <><br /><span style={{ opacity: 0.7 }}>News updated {newsAge}h ago</span></>}
        </div>
      )}
      <h4>{season} schedule — matchup difficulty vs {p.pos}s (outlined = fantasy playoffs)</h4>
      <ScheduleStrip p={p} sosRanks={sosRanks} />
      <h4>Links</h4>
      <div className="p-meta drawer-links">
        <a href={fpUrl} target="_blank" rel="noopener noreferrer">FantasyPros profile ↗</a>
        <a href={newsUrl} target="_blank" rel="noopener noreferrer">Latest news ↗</a>
      </div>
    </>
  );
}

// Outlooks run long, and on the wide card the whole thing would push the
// stat tiles below the fold. Clamp with a More toggle — laptop card only;
// the phone sheet scrolls anyway (v1's clampOutlook, as state).
function OutlookBlock({ outlook, season, pid }: { outlook: Outlook | null; season: string; pid: string }): React.JSX.Element {
  const paraRef = useRef<HTMLParagraphElement>(null);
  const [clamp, setClamp] = useState<'unknown' | 'clamped' | 'none'>('unknown');
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    setClamp('unknown');
    setExpanded(false);
  }, [pid]);
  useLayoutEffect(() => {
    if (clamp !== 'unknown') return;
    const para = paraRef.current;
    if (!para) { setClamp('none'); return; }
    if (!window.matchMedia('(min-width: 821px)').matches) { setClamp('none'); return; }
    // nothing actually cut off — drop the clamp rather than show a dead More
    setClamp(para.scrollHeight - para.clientHeight < 8 ? 'none' : 'clamped');
  }, [clamp, outlook]);
  const m = outlook?.metadata;
  if (!m?.description) {
    return <p className="p-meta">No {season} outlook published for this player.</p>;
  }
  return (
    <>
      <h4>{m.title || 'Season outlook'}</h4>
      <div className="outlook">
        <p ref={paraRef} className={clamp !== 'none' && !expanded ? 'clamped' : ''}>{m.description}</p>
        {clamp === 'clamped' && (
          <button className="outlook-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Less' : 'More'}
          </button>
        )}
        <div className="src-line">
          {sourceLabel(outlook?.source)}
          {m.url && <> · <a href={m.url} target="_blank" rel="noopener noreferrer">read at source ↗</a></>}
        </div>
      </div>
    </>
  );
}

// 18-week matchup strip: each opponent colored by how many custom points
// that defense allowed to this position group last season (1 = most generous).
function ScheduleStrip({ p, sosRanks }: { p: PoolPlayer; sosRanks: Record<string, Record<string, number>> }): React.JSX.Element {
  const cells: React.JSX.Element[] = [];
  let easy = 0;
  let hard = 0;
  for (let w = 1; w <= 18; w++) {
    const opp = p.opps ? p.opps[w] : null;
    if (!opp) {
      // Unsigned players carry no schedule at all — say what's actually true.
      const label = p.team ? 'BYE' : '—';
      const title = p.team ? `Week ${w}: bye` : `Week ${w}: no NFL team`;
      cells.push(
        <div key={w} className="sched-cell m-bye" title={title}>
          <span className="sc-w">{w}</span><span className="sc-opp">{label}</span>
        </div>,
      );
      continue;
    }
    const r = sosRanks[opp]?.[p.group];
    let cls = 'm-med';
    if (r != null && r <= 11) { cls = 'm-easy'; easy++; }
    else if (r != null && r >= 22) { cls = 'm-hard'; hard++; }
    const po = w >= 15 && w <= 17 ? ' m-po' : '';
    const ord = r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th';
    cells.push(
      <div key={w} className={`sched-cell ${cls}${po}`}
        title={`Week ${w} vs ${opp}${r ? ` · allows ${r}${ord}-most pts to ${p.pos}s` : ''}`}>
        <span className="sc-w">{w}</span><span className="sc-opp">{opp}</span>
        {r ? <span className="sc-r">{r}</span> : null}
      </div>,
    );
  }
  const poBits = (p.playoffOpps ?? []).map((o) => {
    const r = sosRanks[o.opp]?.[p.group];
    return `${o.opp}${r ? ` (${r})` : ''}`;
  });
  return (
    <>
      <div className="sched-strip">{cells}</div>
      <div className="sched-summary">
        <span className="sos-good">●</span> {easy} favorable · <span className="sos-bad">●</span> {hard} tough
        {poBits.length ? ` · Playoff run: ${poBits.join(' → ')}` : ''}
      </div>
    </>
  );
}

// --------------------------------------------------------------- game log

function GameLogTab({ p, gamelog, season, prior }: {
  p: PoolPlayer; gamelog: GameLog | undefined; season: string; prior: string;
}): React.JSX.Element {
  // projections strip — no fetch needed, it's already in the bake
  const wp = p.weekPts ?? {};
  const projMax = Math.max(1, ...Object.values(wp));
  const projStrip = (
    <>
      <h4>{season} projected IMP points by week</h4>
      <div className="wk-bars">
        {Array.from({ length: 18 }, (_, i) => {
          const w = i + 1;
          const v = wp[w] ?? 0;
          const bye = !!p.team && !!p.opps && !p.opps[w];
          const cls = bye ? 'bye' : w >= 15 && w <= 17 ? 'po' : '';
          return (
            <div key={w} className={`wk-bar ${cls}`}
              style={{ height: `${bye ? 8 : Math.max(3, (v / projMax) * 100)}%` }}
              title={`Week ${w}: ${bye ? 'BYE' : `${v.toFixed(1)} pts${p.opps?.[w] ? ` vs ${p.opps[w]}` : ''}`}`}></div>
          );
        })}
      </div>
      <div className="wk-labels">{Array.from({ length: 18 }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
    </>
  );

  if (gamelog === undefined) {
    return <>{projStrip}<h4>{prior} game log</h4><p className="p-meta">Loading game log…</p></>;
  }
  if (!gamelog) {
    return <>{projStrip}<h4>{prior} game log</h4><p className="p-meta">Couldn't load the {prior} game log.</p></>;
  }

  interface LogRow {
    week: number; dnp?: boolean; opp?: string | null | undefined; away?: boolean | undefined;
    pts?: number; snaps?: number | null; teamSnaps?: number | null; line?: string;
  }
  const rows: LogRow[] = [];
  let played = 0;
  let total = 0;
  let best: { week: number; pts: number } | null = null;
  for (let w = 1; w <= 18; w++) {
    const entry = gamelog[w] ?? gamelog[String(w)];
    const s = entry?.stats;
    if (!s || !Object.keys(s).length || !Number(s.gp)) {
      rows.push({ week: w, dnp: true, opp: entry?.opponent });
      continue;
    }
    const pts = scoreWeek(s, true);
    played++;
    total += pts;
    if (!best || pts > best.pts) best = { week: w, pts };
    // snap share compares like with like — a defender's snaps against the
    // team's DEFENSIVE plays, not its offensive ones
    const off = Number(s.off_snp) || 0;
    const def = Number(s.def_snp) || 0;
    const onDefense = def > off;
    rows.push({
      week: w,
      pts,
      opp: entry!.opponent,
      away: entry!.is_away_team,
      snaps: (onDefense ? def : off) || null,
      teamSnaps: (onDefense ? Number(s.tm_def_snp) : Number(s.tm_off_snp)) || null,
      line: logStatLine(p.pos, s),
    });
  }

  if (!played) {
    return (
      <>{projStrip}<h4>{prior} game log</h4>
        <p className="p-meta">No {prior} games{p.yearsExp === 0 ? ' — rookie' : ''}.</p></>
    );
  }

  const ppg = total / played;
  const boom = rows.filter((r) => !r.dnp && r.pts! >= ppg * 1.5).length;
  const bust = rows.filter((r) => !r.dnp && r.pts! <= ppg * 0.5).length;

  return (
    <>
      {projStrip}
      <h4>{prior} game log — scored under IMP rules</h4>
      <div className="stat-grid log-summary">
        <div className="stat-box"><div className="v">{played}</div><div className="l">Games</div></div>
        <div className="stat-box"><div className="v">{ppg.toFixed(1)}</div><div className="l">IMP pts/game</div></div>
        <div className="stat-box"><div className="v">{best!.pts.toFixed(1)}</div><div className="l">Best (wk {best!.week})</div></div>
        <div className="stat-box"><div className="v sos-good">{boom}</div><div className="l">Boom ≥1.5× avg</div></div>
        <div className="stat-box"><div className={`v ${bust ? 'sos-bad' : ''}`}>{bust}</div><div className="l">Bust ≤0.5× avg</div></div>
        <div className="stat-box"><div className="v">{total.toFixed(0)}</div><div className="l">Season total</div></div>
      </div>
      <table className="log-table">
        <thead><tr><th>Wk</th><th>Opp</th><th>Stat line</th><th className="num">Snaps</th><th className="num">IMP</th></tr></thead>
        <tbody>
          {rows.map((r) => r.dnp ? (
            <tr key={r.week} className="dnp">
              <td>{r.week}</td><td>{r.opp ?? 'BYE'}</td>
              <td colSpan={2}>{r.opp ? 'Did not play' : 'Bye week'}</td><td className="num">—</td>
            </tr>
          ) : (
            <tr key={r.week} className={r.pts! >= ppg * 1.5 ? 'boom' : r.pts! <= ppg * 0.5 ? 'bust' : ''}>
              <td>{r.week}</td>
              <td>{r.away ? '@' : ''}{r.opp ?? '—'}</td>
              <td className="log-line">{r.line}</td>
              <td className="num">
                {r.snaps != null
                  ? <>{r.snaps}{r.teamSnaps ? <> <span className="pct">({Math.round((r.snaps / r.teamSnaps) * 100)}%)</span></> : null}</>
                  : '—'}
              </td>
              <td className="num pts">{r.pts!.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ------------------------------------------------------------------ depth

function DepthTab({ p, players, draft, onOpen }: {
  p: PoolPlayer; players: PoolPlayer[]; draft: DraftState; onOpen: (pid: string) => void;
}): React.JSX.Element {
  if (!p.team) {
    return <p className="p-meta">{p.name} isn't on an NFL roster, so there's no depth chart to show.</p>;
  }
  const groups: Record<string, PoolPlayer[]> = {};
  for (const x of players) {
    if (x.team !== p.team || !x.depthOrder || !x.depthPos) continue;
    (groups[x.depthPos] = groups[x.depthPos] ?? []).push(x);
  }
  for (const slot of Object.keys(groups)) groups[slot]!.sort((a, b) => a.depthOrder! - b.depthOrder!);
  const known = DEPTH_ORDER.filter((slot) => groups[slot]);
  const rest = Object.keys(groups).filter((slot) => !DEPTH_ORDER.includes(slot)).sort();
  const ordered = [...known, ...rest];
  if (!ordered.length) {
    return <p className="p-meta">No depth chart published for {p.team}.</p>;
  }
  const gone = new Set([...draft.picks.map((pk) => pk.pid), ...draft.keepers.map((k) => k.pid)]);
  return (
    <>
      <h4>{p.team} depth chart</h4>
      <div className="depth-chart">
        {ordered.map((slot) => (
          <div key={slot} className="dc-group">
            <div className="dc-slot">{DEPTH_LABEL[slot] ?? slot}</div>
            {groups[slot]!.map((x) => (
              <div key={x.pid} className={`dc-row${x.pid === p.pid ? ' is-him' : ''}`} data-pid={x.pid}
                onClick={() => { if (x.pid !== p.pid) onOpen(x.pid); }}>
                <span className="dc-rung">{x.depthOrder}</span>
                <span className="dc-name">
                  {x.name}
                  {x.injury && <span className="inj">{x.injury.slice(0, 4).toUpperCase()}</span>}
                  {gone.has(x.pid) && <span className="dc-taken">drafted</span>}
                </span>
                <span className="dc-pos">{x.pos}{x.posRank}</span>
                <span className="dc-proj">{x.proj.toFixed(0)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="p-meta dc-note">
        Rungs and slots come from Sleeper; points are our projections.
        Offensive linemen aren't in this app's pool, so they don't appear.
      </p>
    </>
  );
}

// ------------------------------------------------------------------- news

function NewsList({ items, playerName }: { items: NewsItem[] | null; playerName: string }): React.JSX.Element {
  if (items === null) {
    return (
      <p className="p-meta">
        Couldn't reach Sleeper's news feed.{' '}
        <a href={`https://news.google.com/search?q=${encodeURIComponent(playerName)}`} target="_blank" rel="noopener noreferrer">
          Search the news ↗
        </a>
      </p>
    );
  }
  if (!items.length) return <p className="p-meta">No recent news for this player.</p>;
  return (
    <>
      {items.map((n, i) => {
        const m = n.metadata ?? {};
        return (
          <article key={i} className="pnews-item">
            <h5>{m.title || 'Update'}</h5>
            <div className="ni-meta">
              <span className="ni-src">{sourceLabel(n.source)}</span>
              {n.published ? ` · ${timeAgo(n.published)}` : ''}
            </div>
            {m.description && <p>{m.description}</p>}
            {m.analysis && <div className="ni-analysis"><b>Analysis:</b> {m.analysis}</div>}
            {m.url && <a className="ni-link" href={m.url} target="_blank" rel="noopener noreferrer">Read at {sourceLabel(n.source)} ↗</a>}
          </article>
        );
      })}
    </>
  );
}

// The rail and the News tab share one cached promise — no extra request, and
// on a phone the rail is display:none and simply never seen.
//
// v1's watchRailEnd used to live here: a scroll listener plus a
// ResizeObserver, both running for as long as the card was open, keeping an
// .at-end class in sync so the bottom veil lifted at the end of the list.
// styles/native-motion.css now says the same thing as a scroll-driven
// animation, which the browser runs off the main thread — so the listeners,
// the observer, the two refs and the effect are all gone.
function NewsRail({ news, playerName }: { news: NewsItem[] | null | undefined; playerName: string }): React.JSX.Element {
  return (
    <aside className="pc-news">
      <div className="pc-news-inner">
        <h4>News</h4>
        <div id="pc-news-rail">
          {news === undefined
            ? <p className="p-meta">Loading news…</p>
            : <NewsList items={news} playerName={playerName} />}
        </div>
      </div>
    </aside>
  );
}
