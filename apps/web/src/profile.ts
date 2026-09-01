// The player card's remote data — v1's profile layer, verbatim behavior.
// Sleeper's own outlook/news (open-CORS graphql, same feed their app shows)
// plus last season's real weekly stat lines, re-scored under IMP rules by
// the drawer. Everything is fetched straight from the browser and cached as
// promises, one fetch per player per session.

export const headshot = (pid: string): string =>
  `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;
export const teamLogo = (team: string | null | undefined): string =>
  team ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png` : '';

export function fpSlug(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, '-');
}

export function heightStr(h: string | null | undefined): string | null {
  const n = parseInt(h ?? '', 10);
  return n ? `${Math.floor(n / 12)}'${n % 12}"` : null;
}

export interface Outlook { metadata?: { title?: string; description?: string; url?: string }; source?: string }
export interface NewsItem {
  metadata?: { title?: string; description?: string; analysis?: string; url?: string };
  published?: number;
  source?: string;
  source_key?: string;
}
export type GameLog = Record<string, { stats?: Record<string, number>; opponent?: string; is_away_team?: boolean }> | null;

interface Profile {
  outlook: Promise<Outlook | null>;
  news: Promise<NewsItem[] | null>; // null = fetch failed, [] = genuinely no news
  gamelog: Promise<GameLog>;
}

const profileCache: Record<string, Profile> = {};

async function sleeperGql(query: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://sleeper.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`sleeper graphql ${res.status}`);
  const json = (await res.json()) as { data: Record<string, unknown>; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]!.message);
  return json.data;
}

export function playerProfile(pid: string, outlookSeason: string, logSeason: string): Profile {
  const id = String(pid).replace(/[^A-Za-z0-9]/g, '');
  if (!profileCache[id]) {
    profileCache[id] = {
      outlook: sleeperGql(`{get_player_outlook(sport:"nfl",season:"${outlookSeason}",player_id:"${id}"){metadata source}}`)
        .then((d) => (d.get_player_outlook as Outlook | null) ?? null)
        .catch(() => null),
      news: sleeperGql(`{get_player_news(sport:"nfl",player_id:"${id}",limit:10){metadata published source source_key}}`)
        .then((d) => (d.get_player_news as NewsItem[]) ?? [])
        .catch(() => null),
      gamelog: fetch(`https://api.sleeper.app/stats/nfl/player/${id}?season_type=regular&season=${logSeason}&grouping=week`)
        .then((r) => (r.ok ? (r.json() as Promise<GameLog>) : null))
        .catch(() => null),
    };
  }
  return profileCache[id]!;
}

// Trending adds straight from Sleeper — open CORS, one fetch per session.
// Backs the drawer's "🔥 adds in 48h" line (v1 prefetched the same feed).
let trendingPromise: Promise<Map<string, number>> | null = null;
export function trendingAdds(): Promise<Map<string, number>> {
  trendingPromise ??= fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=50')
    .then((r) => (r.ok ? (r.json() as Promise<{ player_id: string; count?: number }[]>) : []))
    .then((list) => new Map((list || []).map((t) => [t.player_id, t.count ?? 0])))
    .catch(() => new Map<string, number>());
  return trendingPromise;
}

const NEWS_SOURCES: Record<string, string> = {
  fantasy_pros: 'FantasyPros',
  rotowire: 'RotoWire',
  rotoballer: 'RotoBaller',
  sleeper: 'Sleeper',
  espn: 'ESPN',
  nfl: 'NFL.com',
  yahoo: 'Yahoo Sports',
  cbs: 'CBS Sports',
};
export function sourceLabel(s: string | undefined): string {
  if (!s) return 'Report';
  return NEWS_SOURCES[s] ?? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function timeAgo(ms: number | undefined): string {
  if (!ms) return '';
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  const days = Math.round(secs / 86400);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

// One-line box score for a game log row, in the terms that matter per position.
export function logStatLine(pos: string, s: Record<string, number>): string {
  const g = (k: string): number => Number(s[k]) || 0;
  const bits: string[] = [];
  if (pos === 'QB') {
    bits.push(`${g('pass_cmp')}/${g('pass_att')}, ${g('pass_yd')} pass yd`);
    if (g('pass_td')) bits.push(`${g('pass_td')} pass TD`);
    if (g('pass_int')) bits.push(`${g('pass_int')} INT`);
    if (g('rush_att')) bits.push(`${g('rush_att')} car, ${g('rush_yd')} rush yd`);
    if (g('rush_td')) bits.push(`${g('rush_td')} rush TD`);
  } else if (pos === 'RB') {
    bits.push(`${g('rush_att')} car, ${g('rush_yd')} yd`);
    if (g('rec_tgt') || g('rec')) bits.push(`${g('rec')}/${g('rec_tgt')} for ${g('rec_yd')} yd`);
    const td = g('rush_td') + g('rec_td');
    if (td) bits.push(`${td} TD`);
  } else if (pos === 'WR' || pos === 'TE') {
    bits.push(`${g('rec')}/${g('rec_tgt')} for ${g('rec_yd')} yd`);
    if (g('rec_td')) bits.push(`${g('rec_td')} TD`);
    if (g('rush_att')) bits.push(`${g('rush_att')} car, ${g('rush_yd')} yd`);
  } else if (pos === 'K') {
    bits.push(`${g('fgm')}/${g('fga')} FG`);
    if (g('fgm_lng')) bits.push(`long ${g('fgm_lng')}`);
    bits.push(`${g('xpm')}/${g('xpa')} XP`);
  } else {
    bits.push(`${g('idp_tkl_solo')} solo`);
    if (g('idp_tkl_ast')) bits.push(`${g('idp_tkl_ast')} ast`);
    if (g('idp_sack')) bits.push(`${g('idp_sack')} sack`);
    if (g('idp_int')) bits.push(`${g('idp_int')} INT`);
    if (g('idp_pass_def')) bits.push(`${g('idp_pass_def')} PD`);
    if (g('idp_ff')) bits.push(`${g('idp_ff')} FF`);
  }
  if (g('fum_lost')) bits.push(`${g('fum_lost')} fum lost`);
  return bits.join(' · ');
}

// Sleeper shows the whole team's depth chart on a player's page. `depthPos`
// is the specific slot (SWR, RDE, NB…) and `depthOrder` the rung.
export const DEPTH_ORDER = [
  'QB', 'RB', 'LWR', 'SWR', 'RWR', 'TE', 'K',
  'LDE', 'LDT', 'NT', 'RDT', 'RDE', 'DL',
  'LOLB', 'LILB', 'MLB', 'RILB', 'ROLB', 'LB',
  'LCB', 'NB', 'RCB', 'SS', 'FS', 'DB',
];
export const DEPTH_LABEL: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running back', TE: 'Tight end', K: 'Kicker',
  LWR: 'Receiver — left', SWR: 'Receiver — slot', RWR: 'Receiver — right',
  LDE: 'Edge — left', RDE: 'Edge — right', LDT: 'Interior line — left',
  RDT: 'Interior line — right', NT: 'Nose tackle', DL: 'Defensive line',
  LOLB: 'Outside backer — left', ROLB: 'Outside backer — right',
  LILB: 'Inside backer — left', RILB: 'Inside backer — right',
  MLB: 'Middle backer', LB: 'Linebacker',
  LCB: 'Corner — left', RCB: 'Corner — right', NB: 'Nickel back',
  SS: 'Strong safety', FS: 'Free safety', DB: 'Defensive back',
};
