// The hot take — v1's buildTeamBlurb, ported whole. This is the one piece of
// the Analyzer the original port skipped ("that carnival arrives later").
//
// Every line pool below is v1's, lifted verbatim rather than retyped, because
// retyping is how a port quietly becomes a rewrite. What changed is only the
// INPUT: v1 read global draft state, this takes a normalized list of picks so
// the same generator serves the live draft and an archived one.
//
// The rotation is the load-bearing part and the reason this isn't just
// Math.random(). Teams that share a group — same grade, or both having a
// steal — take their line from a shared pool at an offset derived from the
// team's position within that group, so no two teams get the same sentence
// while the pool is deep enough. The offset itself is seeded from the pick
// count, so takes stay fresh as the draft moves without ever being random
// (the same board always reads the same way).

export interface BlurbPick {
  name: string;
  pos: string;
  group: string;
  round: number;
  overall: number;
  keeper: boolean;
  adp: number | null;
  sleeper: boolean;
}

export interface BlurbTeam {
  slot: number;
  name: string;
  grade: string;
  picks: BlurbPick[];
}

// Deterministic seed from a string, so the phrasing picked for a given team
// reads the same every time rather than reshuffling on render (v1's hashSeed).
function hashSeed(str: string): number {
  let h = 7;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

interface Facts {
  picks: BlurbPick[];
  bestSteal: { name: string; delta: number } | null;
  worstReach: { name: string; delta: number } | null;
  sleeperCount: number;
  kRound: number | null;
  posCounts: Record<string, number>;
  heavyPos: { g: string; n: number } | null;
}

// Everything roast-worthy about one team's picks.
function mineTeamFacts(picks: BlurbPick[]): Facts {
  const f: Facts = {
    picks, bestSteal: null, worstReach: null, sleeperCount: 0,
    kRound: null, posCounts: {}, heavyPos: null,
  };
  for (const pk of picks) {
    f.posCounts[pk.group] = (f.posCounts[pk.group] ?? 0) + 1;
    if (pk.group === 'K' && f.kRound == null) f.kRound = pk.round;
    if (pk.sleeper) f.sleeperCount++;
    if (pk.adp != null && !pk.keeper) {
      const delta = pk.adp - pk.overall;
      if (delta >= 12 && (!f.bestSteal || delta > f.bestSteal.delta)) {
        f.bestSteal = { name: pk.name, delta: Math.round(delta) };
      }
      if (delta <= -12 && (!f.worstReach || delta < f.worstReach.delta)) {
        f.worstReach = { name: pk.name, delta: Math.round(delta) };
      }
    }
  }
  for (const [g, n] of Object.entries(f.posCounts)) {
    if (['RB', 'WR'].includes(g) && n >= 4 && (!f.heavyPos || n > f.heavyPos.n)) f.heavyPos = { g, n };
  }
  return f;
}

type Group = 'grade' | 'steal' | 'reach' | 'kick' | 'qb' | 'sleeper' | 'heavy' | 'early' | 'gradeDF';
type Positions = Record<Group, Record<number, number>>;

interface Ctx { facts: Record<number, Facts>; pos: Positions; totalPicks: number }

// Cross-team variant assignment: teams that share a group rotate through the
// line pool from a shared offset, so no two get the same sentence.
export function blurbContext(teams: BlurbTeam[]): Ctx {
  const facts: Record<number, Facts> = {};
  for (const t of teams) facts[t.slot] = mineTeamFacts(t.picks);
  const pos: Positions = {
    grade: {}, steal: {}, reach: {}, kick: {}, qb: {},
    sleeper: {}, heavy: {}, early: {}, gradeDF: {},
  };
  const byGrade: Record<string, number[]> = {};
  for (const t of teams) (byGrade[t.grade] = byGrade[t.grade] ?? []).push(t.slot);
  for (const slots of Object.values(byGrade)) slots.forEach((sl, i) => (pos.grade[sl] = i));
  let i;
  i = 0; for (const t of teams) if (facts[t.slot]!.bestSteal) pos.steal[t.slot] = i++;
  i = 0; for (const t of teams) if (facts[t.slot]!.worstReach) pos.reach[t.slot] = i++;
  i = 0; for (const t of teams) if (facts[t.slot]!.kRound != null && facts[t.slot]!.kRound! <= 14) pos.kick[t.slot] = i++;
  i = 0; for (const t of teams) if ((facts[t.slot]!.posCounts.QB ?? 0) >= 3) pos.qb[t.slot] = i++;
  i = 0; for (const t of teams) if (facts[t.slot]!.sleeperCount >= 2) pos.sleeper[t.slot] = i++;
  i = 0; for (const t of teams) if (facts[t.slot]!.heavyPos) pos.heavy[t.slot] = i++;
  i = 0; for (const t of teams) if (facts[t.slot]!.picks.length > 0 && facts[t.slot]!.picks.length < 3) pos.early[t.slot] = i++;
  i = 0; for (const t of teams) if (t.grade === 'D' || t.grade === 'F') pos.gradeDF[t.slot] = i++;
  const totalPicks = teams.reduce((a, t) => a + t.picks.length, 0);
  return { facts, pos, totalPicks };
}

/** 2-4 sentences, tone scaled to the grade, seasoned with real facts from the
 *  team's actual picks — and distinct across teams via the rotation above. */
export function buildTeamBlurb(t: BlurbTeam, ctx: Ctx, isMe: boolean): string {
  const f = ctx.facts[t.slot] ?? mineTeamFacts(t.picks);
  const picks = f.picks;
  const line = (arr: string[], group: Group, salt: string): string => {
    const offset = hashSeed(salt + ':' + ctx.totalPicks);
    const p = ctx.pos[group][t.slot] ?? 0;
    return arr[(offset + p) % arr.length]!;
  };

  if (!picks.length) {
    return `${t.name} hasn't made a pick yet. Technically undefeated, spiritually asleep at the wheel.`;
  }
  if (picks.length < 3) {
    return line([
      `Only ${picks.length} pick${picks.length === 1 ? '' : 's'} in, so we refuse to judge ${t.name} yet. Even our hot takes need more evidence than that.`,
      `Too early for a verdict on ${t.name}. The chair is warm, the snacks are gone, and that's all we know so far.`,
      `${t.name} has made ${picks.length} pick${picks.length === 1 ? '' : 's'}. Our lawyers advise us not to grade that yet.`,
      `Check back on ${t.name} in a few rounds — even the hottest take needs kindling.`,
    ], 'early', 'early');
  }

  const sentences: string[] = [];
  const openers: Record<string, string[]> = {
    A: [
      `${t.name} is drafting like they've already seen the box scores.`,
      `Someone slipped ${t.name} the answer key, and honestly? Respect.`,
      `${t.name} is running a masterclass while half the league is still googling bye weeks.`,
      `The projections keep blushing every time ${t.name} is on the clock.`,
      `${t.name} came prepared, which frankly feels like a violation of league tradition.`,
      `Vegas would like a word with ${t.name}, because this draft looks suspiciously well-informed.`,
      `${t.name} is playing chess while the rest of the room plays rock-paper-scissors for the last soda.`,
      `At this point the other teams should just ask ${t.name} for homework help.`,
    ],
    B: [
      `A quietly professional draft from ${t.name} — the kind that wins Tuesdays and, occasionally, championships.`,
      `${t.name} keeps making sensible picks. Suspicious behavior in this league, but the math approves.`,
      `No fireworks from ${t.name}, just steady value stacking. Boring is a strategy, and it's working.`,
      `${t.name} is drafting like someone who reads instruction manuals. It shows, in a good way.`,
      `Nothing flashy at ${t.name} HQ — just a roster quietly getting better while nobody's watching.`,
      `${t.name} is the designated driver of this draft: responsible, dependable, getting everyone home.`,
      `${t.name}'s draft is a firm handshake in roster form: solid, unremarkable, weirdly reassuring.`,
      `Nobody's talking about ${t.name}'s team, which is exactly how upsets get built.`,
    ],
    C: [
      `${t.name} is assembling the most aggressively average roster we've ever graded, which is its own kind of achievement.`,
      `${t.name} keeps splitting the difference between genius and chaos and landing squarely on "fine."`,
      `Every ${t.name} pick makes sense in isolation. Together? A shrug in roster form.`,
      `${t.name} is drafting the fantasy equivalent of a beige sedan: it'll get there. Eventually. Probably.`,
      `Half of ${t.name}'s picks are sneaky good and the other half are just sneaky. Net result: this grade.`,
      `${t.name} has achieved perfect equilibrium — every sharp decision immediately canceled by a curious one.`,
      `${t.name} keeps threading the needle between "fine" and "fine, I guess."`,
      `A very diplomatic draft from ${t.name}: it offends no one and terrifies no one.`,
    ],
    D: [
      `${t.name} appears to be drafting from a magazine found in a dentist's office in 2023.`,
      `The vibes-based drafting era is alive and well at ${t.name} headquarters.`,
      `${t.name} is one more reach away from the analytics department filing a restraining order.`,
      `We ran ${t.name}'s picks through the model twice because the first result seemed too unkind. It wasn't.`,
      `${t.name} is drafting with tremendous confidence, which would be inspiring if the math agreed.`,
      `Somewhere between the plan and the podium, ${t.name} misplaced the plan.`,
      `${t.name}'s draft board appears to be sorted alphabetically. Bravely so.`,
      `Watching ${t.name} draft is like watching someone parallel park by sound.`,
    ],
    F: [
      `Somewhere, a dart-throwing chimp is asking ${t.name} for royalties.`,
      `${t.name} has turned the draft board into performance art. The critics are horrified. We can't look away.`,
      `Future historians will study ${t.name}'s draft — not admiringly, the way one studies a shipwreck.`,
      `${t.name}'s strategy appears to be witness protection for good players: nobody will ever find them here.`,
      `The model asked us to stop feeding it ${t.name}'s picks. It has a family.`,
      `${t.name} is speedrunning toward the waiver wire, and honestly, the commitment is impressive.`,
      `${t.name} just proved you can lose a draft where no winner is ever announced.`,
      `Bold of ${t.name} to treat the draft like a raffle. Raffles have better odds.`,
    ],
  };
  sentences.push(line(openers[t.grade] ?? openers.C!, 'grade', 'open:' + t.grade));

  const facts: string[] = [];
  if (f.bestSteal) {
    const x = f.bestSteal;
    facts.push(line([
      `Grabbing ${x.name} ${x.delta} picks after his ADP was legalized theft.`,
      `${x.name} at a ${x.delta}-pick discount is the kind of move the rest of the room pretends not to notice.`,
      `${x.name} fell ${x.delta} picks and got caught — that's not luck, that's a trap being sprung.`,
      `The ${x.name} pick came with a ${x.delta}-pick coupon, and clipping coupons wins leagues.`,
      `Letting ${x.name} slide ${x.delta} picks into this roster should legally require a police report.`,
      `${x.name} arrived ${x.delta} picks past his price tag — one manager set an alert, and everyone else slept through it.`,
      `${x.name} ${x.delta} spots below market is the draft-day equivalent of finding cash in an old jacket.`,
      `Everyone's queue had ${x.name} in it — the difference is somebody actually pressed the button, ${x.delta} picks late.`,
      `${x.name} slid ${x.delta} picks and landed softly. The room will claim they "weren't targeting him." Sure.`,
      `A ${x.delta}-pick discount on ${x.name} isn't drafting, it's arbitrage.`,
      `${x.name} was hiding in plain sight for ${x.delta} picks. Exactly one team was wearing glasses.`,
      `The ${x.delta}-pick markdown on ${x.name} should have come with a gift receipt.`,
    ], 'steal', 'steal'));
  }
  if (f.worstReach) {
    const x = f.worstReach;
    const d = Math.abs(x.delta);
    facts.push(line([
      `Taking ${x.name} ${d} picks early suggests either insider info or a lost group-chat bet.`,
      `${x.name} that early wasn't a pick, it was a proposal of marriage.`,
      `${x.name} went ${d} picks before the market said hello. Love is blind; drafts have receipts.`,
      `The ${x.name} pick beat his ADP by ${d}. That's not conviction, that's a jump scare.`,
      `Reaching ${d} picks for ${x.name}? The queue was right there. The queue is always right there.`,
      `${x.name} would've still been available a round later, but panic remains undefeated.`,
      `${x.name} went ${d} early — someone listened to one podcast this morning and it shows.`,
      `That ${x.name} pick was ${d} ahead of schedule. The heart wants what it wants.`,
      `${d} picks early for ${x.name} is a bold way to announce you don't believe in ADP. Or gravity.`,
      `${x.name}, ${d} picks before anyone else was thinking about him. Trendsetter or tilt — history will decide.`,
      `Paying ${d} picks over sticker for ${x.name}? Car dealers hate this one trick. No wait — they love it.`,
      `The ${x.name} reach (${d} early) had big "afraid of getting sniped by absolutely nobody" energy.`,
    ], 'reach', 'reach'));
  }
  if (f.kRound != null && f.kRound <= 14) {
    facts.push(line([
      `A kicker in round ${f.kRound}? Bold. The distance-scoring gods had better deliver.`,
      `Round ${f.kRound} felt early for a kicker until you remember 60-yarders pay six here. It's still early.`,
      `A round-${f.kRound} kicker is either galaxy-brain or a misclick, and there's no in-between.`,
    ], 'kick', 'kick'));
  }
  if ((f.posCounts.QB ?? 0) >= 3) {
    facts.push(line([
      `Three quarterbacks in a one-QB league is called a collection, not a plan.`,
      `A third QB is a bold answer to a question nobody asked.`,
      `Hoarding quarterbacks in a one-QB league: either a trade empire is coming or the roster rules got skimmed.`,
    ], 'qb', 'qb'));
  }
  if (f.heavyPos) {
    facts.push(line([
      `${f.heavyPos.n} ${f.heavyPos.g}s already — that's not a roster, that's a museum exhibit.`,
      `Drafting ${f.heavyPos.n} ${f.heavyPos.g}s is a lifestyle choice we're choosing to respect. Barely.`,
      `${f.heavyPos.n} ${f.heavyPos.g}s and counting; diversification called and went straight to voicemail.`,
    ], 'heavy', 'heavy'));
  }
  if (f.sleeperCount >= 2 && t.grade !== 'F') {
    facts.push(line([
      `Credit where due: ${f.sleeperCount} certified 💎 sleepers means somebody actually did the homework.`,
      `${f.sleeperCount} 💎 sleepers on one roster — the late rounds are where this draft got won.`,
      `Quietly stashing ${f.sleeperCount} 💎 sleepers is the kind of nerd behavior that ruins leagues for everyone else.`,
      `${f.sleeperCount} sleepers deep already — the waiver wire will have nothing left to teach this team.`,
    ], 'sleeper', 'sleeper'));
  }
  sentences.push(...facts.slice(0, 2));

  if (sentences.length < 4) {
    if (isMe) {
      sentences.push(line([
        `Also, this is your team, so we mean all of the above affectionately.`,
        `(Editor's note: this take was written about you, reviewed by you, and approved unanimously.)`,
        `Full disclosure: the analyst has money on this team.`,
      ], 'grade', 'closer:me'));
    } else if (t.grade === 'A') {
      sentences.push(line([
        `The rest of the league should be nervous.`,
        `Draft nights like this pay for themselves in trash talk alone.`,
        `Enjoy it — this is the part of the season where everything still goes right.`,
        `If this holds, the group chat is going to be insufferable by October.`,
        `Somewhere a projection model is asking this draft for an autograph.`,
        `The blueprint is working. Annoyingly.`,
      ], 'grade', 'closer:A'));
    } else if (t.grade === 'F' || t.grade === 'D') {
      sentences.push(line([
        `There's still time. There is not much time.`,
        `The waiver wire is about to become a very close friend.`,
        `On the bright side, low expectations are extremely easy to beat.`,
        `The good news: championship odds can't go below zero.`,
        `Every league needs a redemption arc, and this one is being set up beautifully.`,
        `Consider it a rebuilding year, declared in week zero.`,
        `The draft is only half the battle. Unfortunately, it's the half that just happened.`,
        `Autopsies take time; the season starts anyway.`,
      ], 'gradeDF', 'closer:DF'));
    }
  }

  return sentences.slice(0, 4).join(' ');
}

// --------------------------------------------------------------- adapters
// The generator is fed from two places — a live draft and an archived one —
// so the shapes are normalized here rather than inside it.

const OFF = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
export const groupOf = (pos: string): string => (OFF.has(pos) ? pos : 'IDP');

export interface ArchiveRosterEntry {
  name: string; pos: string; round: number; overall: number;
  keeper: boolean; adp: number | null;
}

/** Takes for an archived draft. The 💎 sleeper fact is the one thing that
 *  cannot be recovered: v1's rule needs a player's rank on the FULL board,
 *  and an archive stores only the players who were drafted — ranking those
 *  alone would flatter everyone. The other five facts all survive. */
export function takesFromArchive(
  teams: { slot: number; name: string; draftGrade?: string; roster: ArchiveRosterEntry[] }[],
  fallbackGrade: (slot: number) => string,
): BlurbTeam[] {
  return teams.map((t) => ({
    slot: t.slot,
    name: t.name,
    grade: t.draftGrade ?? fallbackGrade(t.slot),
    picks: t.roster.map((r) => ({
      name: r.name, pos: r.pos, group: groupOf(r.pos),
      round: r.round, overall: r.overall, keeper: r.keeper,
      adp: r.adp, sleeper: false,
    })),
  }));
}
