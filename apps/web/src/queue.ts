// The queue — v1's Sleeper-style personal list, carried over whole: an
// ordered array of pids, per-browser, never published, never touching the
// board's own order. Drafted/kept players drop off the VIEW but stay stored,
// so an undo puts them straight back.

import { useSyncExternalStore } from 'react';
import { SEASON } from './transport';

const KEY = `fa-queue-${SEASON}`;

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

let queue = read();
const listeners = new Set<() => void>();

function write(next: string[]): void {
  queue = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/blocked — the queue is a convenience, never critical */
  }
  for (const l of listeners) l();
}

export function toggleQueued(pid: string): void {
  write(queue.includes(pid) ? queue.filter((x) => x !== pid) : [...queue, pid]);
}

export function moveQueued(pid: string, dir: -1 | 1, visible: string[]): void {
  // move relative to the VISIBLE neighbour — hidden drafted entries would
  // otherwise swallow a ±1 move (the v1 lesson, kept)
  const vi = visible.indexOf(pid);
  const nb = visible[vi + dir];
  if (vi < 0 || !nb) return;
  const rest = queue.filter((x) => x !== pid);
  const at = rest.indexOf(nb) + (dir > 0 ? 1 : 0);
  write([...rest.slice(0, at), pid, ...rest.slice(at)]);
}

export function useQueue(): string[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => queue,
  );
}
