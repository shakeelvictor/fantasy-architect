// The pick celebration and the draft-ending finale, ported from v1's
// celebratePick / celebrateDraftEnd. Every class here already exists in
// v1.css — .pick-pop, .pp-card, .pp-claw, .pp-chant, .pp-tomato, .finale,
// .fw-p — so this is markup and timing, not new styling.
//
// Deliberately imperative over two fixed overlay nodes, exactly as v1 did.
// The pop has to REPLACE itself when picks land back to back, and restarting
// a CSS animation needs the `void el.offsetWidth` reflow between removing
// and re-adding `.show`. Driving that through React state would fight the
// animation rather than express it (the same reason the ticker memoizes its
// markup). Both overlays never take pointer events and remove themselves,
// so neither can swallow a click on the board underneath.

import { useEffect, useRef } from 'react';
import type { DraftState, SeasonConfig } from '@fa/rules';
import type { PoolPlayer } from './api';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const headshot = (pid: string): string =>
  `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;
const teamLogo = (team: string | null | undefined): string =>
  team ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png` : '';

// Bears picks get the fight song; the other three NFC North clubs get pelted.
// Chicago is itself in the division, so it is checked FIRST and never falls
// through to the rival treatment.
const NFC_NORTH_RIVALS = ['GB', 'DET', 'MIN'];

// The extra beats need longer on screen than a plain pick — the tomato has to
// fly, land and splat before the shot even starts. `pp-long` stretches the
// veil and card animations to match the timer below.
const POP_MS = 2300;
const POP_LONG_MS = 3900;

function teamCelebration(team: string | null | undefined): string {
  if (team === 'CHI') return 'pp-bears';
  if (team && NFC_NORTH_RIVALS.includes(team)) return 'pp-rival';
  return '';
}

// The confetti of each special: built here rather than in CSS so the letters
// can be staggered individually.
function celebrationLayer(kind: string): string {
  if (kind === 'pp-bears') {
    const letters = [...'BEAR DOWN!'].map((ch, i) =>
      `<span style="animation-delay:${(i * 0.055).toFixed(3)}s">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
    return `<div class="pp-fx pp-fx-bears" aria-hidden="true">
      <div class="pp-claw"><i></i><i></i><i></i></div>
      <div class="pp-chant">${letters}</div>
    </div>`;
  }
  if (kind === 'pp-rival') {
    return `<div class="pp-fx pp-fx-rival" aria-hidden="true">
      <span class="pp-tomato">🍅</span>
      <span class="pp-splat"></span>
      <span class="pp-shot-glass">🥃</span>
      <span class="pp-shot-word">DIVISION RIVAL</span>
    </div>`;
  }
  return '';
}

export interface PopPick {
  pid: string;
  name: string;
  pos: string;
  group: string;
  team: string | null;
  proj: number | null;
  round: number;
  overall: number;
  pickInRound: number;
  teamLabel: string;
  mine: boolean;
}

let pickPopTimer: ReturnType<typeof setTimeout> | null = null;

export function celebratePick(pk: PopPick): void {
  const el = document.getElementById('pick-pop');
  if (!el) return;
  const fx = teamCelebration(pk.team);
  el.className = `pick-pop g-${esc(pk.group)}${pk.mine ? ' is-mine' : ''}${fx ? ` ${fx} pp-long` : ''}`;
  el.innerHTML = `
    <div class="pp-card">
      <div class="pp-spark"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      ${pk.team ? `<img class="pp-logo" src="${teamLogo(pk.team)}" alt="" onerror="this.style.display='none'" />` : ''}
      <img class="pp-shot" src="${headshot(pk.pid)}" alt="" onerror="this.style.visibility='hidden'" />
      <div class="pp-body">
        <div class="pp-label">${pk.mine ? 'Your pick' : 'Pick'} ${pk.round}.${String(pk.pickInRound).padStart(2, '0')} · #${pk.overall}</div>
        <div class="pp-name">${esc(pk.name)}</div>
        <div class="pp-sub">
          <span class="pos-pill pos-${esc(pk.pos)}">${esc(pk.pos)}</span>
          ${esc(pk.team || 'FA')} → <b>${esc(pk.teamLabel)}</b>
          ${pk.proj != null ? `<span class="pp-pts">${pk.proj.toFixed(0)} pts</span>` : ''}
        </div>
      </div>
      ${celebrationLayer(fx)}
    </div>`;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation when picks land back to back
  el.classList.add('show');
  if (pickPopTimer) clearTimeout(pickPopTimer);
  pickPopTimer = setTimeout(() => el.classList.remove('show'), fx ? POP_LONG_MS : POP_MS);
}

const FW_COLORS = ['#4da3ff', '#7ab8ff', '#67e8f9', '#14b8a6', '#22c55e',
  '#f59e0b', '#ec4899', '#a78bfa'];

function fireworkBurst(x: number, y: number, delay: number): string {
  let html = '';
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.3;
    const dist = 80 + Math.random() * 80;
    const dx = (Math.cos(ang) * dist).toFixed(1);
    const dy = (Math.sin(ang) * dist).toFixed(1);
    const color = FW_COLORS[(Math.random() * FW_COLORS.length) | 0];
    const fall = (55 + Math.random() * 85).toFixed(1);
    const size = (5 + Math.random() * 4).toFixed(1);
    html += `<span class="fw-p" style="left:${x}%;top:${y}%;--dx:${dx}px;--dy:${dy}px;animation-delay:${delay}s">`
      + `<i style="background:${color};width:${size}px;height:${size}px;--fall:${fall}px;animation-delay:${delay}s"></i></span>`;
  }
  return html;
}

let finaleTimer: ReturnType<typeof setTimeout> | null = null;

export function celebrateDraftEnd(opts: {
  picks: number; teams: number; mock: boolean;
  best: { name: string; pts: number } | null;
}): void {
  const el = document.getElementById('draft-finale');
  if (!el) return;

  const spots: [number, number][] = [[24, 30], [74, 24], [49, 16], [16, 50], [85, 45], [37, 38], [63, 55], [29, 20]];
  const bursts = spots.map(([x, y], i) => fireworkBurst(x, y, +(i * 0.34).toFixed(2))).join('');

  el.innerHTML = bursts + `
    <div class="finale-card">
      <div class="finale-kicker">${opts.mock ? 'Mock complete' : "That's a wrap"}</div>
      <div class="finale-title">DRAFT COMPLETE</div>
      <div class="finale-sub">${opts.picks} picks · ${opts.teams} teams${
        opts.best ? ` · best board: <b>${esc(opts.best.name)}</b> ${opts.best.pts.toFixed(0)} pts` : ''}</div>
      <div class="finale-hint">Head to the Analyzer for grades — or Past Drafts to archive it</div>
    </div>`;

  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.add('show');
  if (finaleTimer) clearTimeout(finaleTimer);
  // must match the fin-veil / fin-card duration in v1.css
  finaleTimer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hidden');
    el.innerHTML = '';
  }, 10000);
}

// ------------------------------------------------------------- the trigger

// A redo resubmits a real pick_made, so the fold cannot tell it from a fresh
// pick — v1 could, because redo took a different code path. One consumed
// flag keeps v1's rule that a correction is not a moment.
let suppressOnce = false;
export function suppressNextPickPop(): void { suppressOnce = true; }

interface CelebrateArgs {
  config: SeasonConfig | null;
  draft: DraftState;
  byPid: Map<string, PoolPlayer>;
  teamName: (slot: number) => string;
  mySlot: number;
  done: boolean;
  isMock: boolean;
  botsRunning: boolean;
}

export function useCelebrations(args: CelebrateArgs): void {
  const { config, draft, byPid, teamName, mySlot, done, isMock, botsRunning } = args;
  // null until the first board arrives, so opening a draft already in
  // progress does not replay the last pick at you (v1's watchLastOverall)
  const lastOverall = useRef<number | null>(null);
  const finaleShown = useRef(false);

  useEffect(() => {
    if (!config) return;
    const newest = draft.picks.length ? draft.picks[draft.picks.length - 1]! : null;
    const highest = newest ? newest.overall : 0;
    const seen = lastOverall.current;
    lastOverall.current = highest;
    if (seen == null || !newest || highest <= seen) return;

    const consumed = suppressOnce;
    suppressOnce = false;

    // v1's exclusions: auto-applied keepers chain several at once, bots in a
    // running mock would strobe, and undo/redo are corrections. Bots pick for
    // every seat except yours, so that check needs no extra bookkeeping.
    const isBotPick = isMock && botsRunning && newest.slot !== mySlot;
    if (consumed || newest.is_keeper || isBotPick) return;

    const p = byPid.get(newest.pid);
    celebratePick({
      pid: newest.pid,
      name: p?.name ?? newest.pid,
      pos: p?.pos ?? '',
      group: p?.group ?? p?.pos ?? '',
      team: p?.team ?? null,
      proj: p?.proj ?? null,
      round: newest.round,
      overall: newest.overall,
      pickInRound: ((newest.overall - 1) % config.teams) + 1,
      teamLabel: teamName(newest.slot),
      mine: newest.slot === mySlot,
    });
  }, [config, draft.picks, byPid, teamName, mySlot, isMock, botsRunning]);

  // The last pick of the draft earns more than a pick card. Fires once on the
  // transition into a complete board; an undo re-arms it, so the next genuine
  // final pick celebrates again.
  useEffect(() => {
    if (!config || !done) { finaleShown.current = false; return; }
    if (finaleShown.current || lastOverall.current == null) return;
    finaleShown.current = true;
    let best: { name: string; pts: number } | null = null;
    for (let s = 1; s <= config.teams; s++) {
      const pts = draft.picks
        .filter((pk) => pk.slot === s)
        .reduce((a, pk) => a + (byPid.get(pk.pid)?.proj ?? 0), 0);
      if (!best || pts > best.pts) best = { name: teamName(s), pts };
    }
    const t = setTimeout(() => celebrateDraftEnd({
      picks: draft.picks.length, teams: config.teams, mock: isMock, best,
    }), 1200);
    return () => clearTimeout(t);
  }, [config, done, draft.picks, byPid, teamName, isMock]);
}
