// Draft grading, shared by the live Analyzer, the archive document, and the
// retrospective. Ported from v1's computeTeamGrades.
//
// The grade is VALUE PER PICK, not total value — v1's rule, and the reason
// matters: mid-draft the teams differ in how many picks they have made, and
// grading on a total would mark a team down for simply not having picked yet.
//
// It is also always LEAGUE-RELATIVE (a z-score across the teams that have
// picked). That is what makes a draft-night grade comparable to a grade
// computed from what actually happened later: both are "how did this team do
// against the others", so a half-played season makes the comparison noisier
// but never lopsided.

export function letterGrade(z: number): string {
  if (z >= 0.8) return 'A';
  if (z >= 0.25) return 'B';
  if (z >= -0.25) return 'C';
  if (z >= -0.8) return 'D';
  return 'F';
}

/** z-scores of a value list, with the degenerate zero-spread case pinned to 0. */
export function zScores(values: number[]): number[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) || 0;
  return values.map((v) => (sd ? (v - mean) / sd : 0));
}

export interface GradeInput {
  slot: number;
  name: string;
  roster: { proj: number; vorp: number }[];
}

export interface TeamGrade {
  slot: number;
  name: string;
  count: number;
  proj: number;
  totalVorp: number;
  perPick: number;
  z: number;
  grade: string;
}

export function computeGrades(teams: GradeInput[]): TeamGrade[] {
  const base = teams.map((t) => {
    // negative VORP is floored at zero: a bench flier is worth nothing, not
    // a penalty, and without the floor a deep roster of replacements would
    // drag a team below one that simply drafted fewer players
    const totalVorp = t.roster.reduce((a, p) => a + Math.max(p.vorp, 0), 0);
    return {
      slot: t.slot,
      name: t.name,
      count: t.roster.length,
      proj: t.roster.reduce((a, p) => a + p.proj, 0),
      totalVorp,
      perPick: t.roster.length ? totalVorp / t.roster.length : 0,
    };
  });
  const withPicks = base.filter((t) => t.count > 0);
  const zs = zScores(withPicks.map((t) => t.perPick));
  const zBySlot = new Map(withPicks.map((t, i) => [t.slot, zs[i]!]));
  return base.map((t) => {
    const z = zBySlot.get(t.slot) ?? 0;
    return { ...t, z, grade: t.count ? letterGrade(z) : '—' };
  });
}
