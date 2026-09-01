// Send Draft to MFL — v1's modal, ported: live franchise list + player ID
// matching from the MFL proxy, the owner-keyed slot→franchise mapping
// (franchise ids are permanent; managers rename teams freely, so NOTHING is
// ever keyed on a team name), the draftResults XML builder, Download XML,
// and the commissioner push. Credentials go straight through our proxy to
// MFL over HTTPS and are never stored.

import { useEffect, useMemo, useState } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import { SEASON, transport, type MflSetup, type PoolPlayer, type Session } from '../api';
import { downloadBlob } from '../exports';
import styles from './panel.module.css';

// Owner-confirmed franchise mapping (Shak, 2026-08-03) — keyed by OWNER name
// as used in the app's draft order, so it survives renames and order changes.
const OWNER_TO_FRANCHISE: Record<string, string> = {
  shak: '0001', ryaan: '0002', samson: '0003', imran: '0004', hoss: '0005',
  andres: '0006', asher: '0007', dante: '0008', vip: '0009', anand: '0010',
  laura: '0011',
};
const MFL_OWNERS: Record<string, string> = {
  '0001': 'Shak', '0002': 'Ryaan', '0003': 'Samson', '0004': 'Imran',
  '0005': 'Hoss', '0006': 'Andres', '0007': 'Asher', '0008': 'Dante',
  '0009': 'Vip', '0010': 'Anand', '0011': 'Laura',
};

const MAP_KEY = `fa-mfl-franchise-map-${SEASON}`;

function guessFranchise(slotName: string, franchises: { id: string; name: string }[]): string {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(slotName);
  if (OWNER_TO_FRANCHISE[n]) return OWNER_TO_FRANCHISE[n]!;
  const hit = franchises.find((f) => {
    const fn = norm(f.name);
    return fn === n || fn.includes(n) || n.includes(fn);
  });
  return hit ? hit.id : '';
}

function loadSavedMap(): Record<number, string> {
  try {
    return (JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') ?? {}) as Record<number, string>;
  } catch {
    return {};
  }
}

const escX = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Props {
  config: SeasonConfig;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  session: Session;
  onClose: () => void;
}

export function MflPanel({ config, draft, byPid, teamName, session, onClose }: Props): React.JSX.Element {
  const [setup, setSetup] = useState<MflSetup | null>(null);
  const [status, setStatus] = useState('Loading MFL league info and matching player IDs…');
  const [franchiseMap, setFranchiseMap] = useState<Record<number, string>>(loadSavedMap);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    const drafted = draft.picks
      .map((pk) => byPid.get(pk.pid))
      .filter((p): p is PoolPlayer => !!p)
      .map((p) => ({ id: p.pid, name: p.name, pos: p.pos, team: p.team }));
    transport.mfl(session, { op: 'setup', season: SEASON, players: drafted })
      .then((s) => {
        const st = s as unknown as MflSetup;
        setSetup(st);
        setStatus(`MFL league: ${st.leagueName} · ${st.franchises.length} franchises · ${Object.keys(st.map).length}/${drafted.length} drafted players matched`);
      })
      .catch((e: Error) => setStatus('Failed to load MFL data: ' + e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ignore a saved choice pointing at a franchise the league no longer has
  const effectiveMap = useMemo(() => {
    if (!setup) return {};
    const out: Record<number, string> = {};
    for (let slot = 1; slot <= config.teams; slot++) {
      const kept = franchiseMap[slot];
      out[slot] = kept && setup.franchises.some((f) => f.id === kept)
        ? kept
        : guessFranchise(teamName(slot), setup.franchises);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, franchiseMap, config.teams]);

  const setSlot = (slot: number, id: string): void => {
    const next = { ...effectiveMap, [slot]: id };
    setFranchiseMap(next);
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify(next));
    } catch { /* convenience only */ }
  };

  const buildXmlOrWarn = (): string | null => {
    if (!setup) return null;
    if (!draft.picks.length) { window.alert('No picks to send yet.'); return null; }
    const missing: string[] = [];
    for (let slot = 1; slot <= config.teams; slot++) {
      if (!effectiveMap[slot]) missing.push(teamName(slot));
    }
    if (missing.length) { window.alert('Choose an MFL franchise for: ' + missing.join(', ')); return null; }
    const used = Object.values(effectiveMap);
    if (new Set(used).size !== used.length) { window.alert('Two slots point at the same MFL franchise.'); return null; }

    const round1Order: string[] = [];
    for (let slot = 1; slot <= config.teams; slot++) round1Order.push(effectiveMap[slot]!);
    const lines = ['<draftResults>',
      `  <draftUnit unit="LEAGUE" round1DraftOrder="${round1Order.join(',')}," draftType="SAME">`];
    for (const pk of draft.picks) {
      const pir = ((pk.overall - 1) % config.teams) + 1;
      lines.push(`    <draftPick round="${String(pk.round).padStart(2, '0')}" pick="${String(pir).padStart(2, '0')}" franchise="${escX(effectiveMap[pk.slot])}" player="${escX(setup.map[pk.pid] ?? '')}" timestamp="" comments="${escX(pk.is_keeper ? 'Keeper' : '')}" />`);
    }
    lines.push('  </draftUnit>', '</draftResults>');
    return lines.join('\n');
  };

  const downloadXml = (): void => {
    const xml = buildXmlOrWarn();
    if (!xml) return;
    downloadBlob(new TextEncoder().encode(xml), `fa-draft-${SEASON}-mfl.xml`, 'application/xml');
  };

  const push = async (): Promise<void> => {
    const xml = buildXmlOrWarn();
    if (!xml) return;
    if (!user.trim() || !pass) { window.alert('Enter the MFL commissioner username and password.'); return; }
    if (!window.confirm('This REPLACES all existing draft results in the MFL league. Continue?')) return;
    setPushing(true);
    try {
      await transport.mfl(session, { op: 'push', season: SEASON, username: user.trim(), password: pass, xml });
      setStatus('✓ Draft results pushed to MFL. Check the league site to confirm rosters.');
      setPass('');
    } catch (e) {
      setStatus('✗ Push failed: ' + (e as Error).message);
    } finally {
      setPushing(false);
    }
  };

  const unmatchedDrafted = setup
    ? setup.unmatched.filter((u) => draft.picks.some((pk) => pk.pid === u.id))
    : [];

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.card} data-testid="mfl-panel">
        <h2>Send Draft to MFL</h2>
        <p className={styles.hint} data-testid="mfl-status">{status}</p>

        <h3>Team mapping — app slot → MFL franchise</h3>
        <p className={styles.hint}>
          Matched on the franchise number, which never changes — team names below are whatever MFL
          shows right now, so a manager renaming their team doesn't affect the import. Worth a glance anyway.
        </p>
        <div className={styles.list}>
          {setup && Array.from({ length: config.teams }, (_, i) => i + 1).map((slot) => (
            <div key={slot} className={styles.row}>
              <span>{slot}. {teamName(slot)}</span>
              <select
                data-testid={`mfl-fr-${slot}`}
                value={effectiveMap[slot] ?? ''}
                onChange={(e) => setSlot(slot, e.target.value)}
              >
                <option value="">— choose —</option>
                {setup.franchises.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.name}{MFL_OWNERS[f.id] ? ` — ${MFL_OWNERS[f.id]}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <h3>Player ID matching</h3>
        <p className={styles.hint} data-testid="mfl-unmatched">
          {!setup
            ? '…'
            : unmatchedDrafted.length
              ? `⚠ ${unmatchedDrafted.length} drafted player(s) had no MFL match and will import as empty picks (fix in MFL afterward): ${unmatchedDrafted.map((u) => `${u.name} (${u.pos})`).join(', ')}`
              : `All ${draft.picks.length} drafted player(s) matched to MFL IDs.`}
        </p>

        <h3>Upload</h3>
        <p className={styles.hint}>
          ⚠ Importing replaces ALL existing draft results in the MFL league. Requires the commissioner
          login; credentials go directly to MFL over HTTPS and are never stored.
        </p>
        <div className={styles.form}>
          <label className={styles.inline}>MFL username{' '}
            <input data-testid="mfl-user" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
          </label>
          <label className={styles.inline}>MFL password{' '}
            <input data-testid="mfl-pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
        </div>

        <div className={styles.actions} style={{ gap: 8 }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" data-testid="mfl-download" title="Download the draftResults XML to import yourself"
            disabled={!setup} onClick={downloadXml}>
            Download XML
          </button>
          <button className="btn primary" data-testid="mfl-push-btn" disabled={!setup || pushing} onClick={() => void push()}>
            {pushing ? 'Pushing…' : 'Push to MFL'}
          </button>
        </div>
      </div>
    </div>
  );
}
