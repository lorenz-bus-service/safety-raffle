import type { DayScores, DailyScore, Driver } from '../../src/tickets.ts';
import { eachDay } from '../../src/dates.ts';
import type { DateRange } from '../../src/dates.ts';

/** An invented roster. No name, ID or score here belongs to a real person. */
const driver = (id: string, name: string, username: string, extra: Partial<Driver> = {}): Driver => ({
  id,
  name,
  username,
  email: `${username}@example.com`,
  active: true,
  tags: [],
  attributes: {},
  externalIds: { payrollId: `P-${id}` },
  ...extra,
});

export const roster: Driver[] = [
  driver('101', 'Alder, Maren', 'ma1001', { tags: ['North Depot'] }),
  driver('102', 'Birch, Tobias', 'tb1002', { tags: ['South Depot'] }),
  driver('103', 'Cedar, Imani', 'ic1003', { tags: ['North Depot'], email: '' }),
  // Two Drivers who share a name; only the Employee ID tells their Tickets apart.
  driver('104', 'Dunmore, Chris', 'cd1004', { tags: ['South Depot'] }),
  driver('105', 'Dunmore, Chris', 'cd1005', { tags: ['North Depot'] }),
  driver('106', 'Élan-Østergård, Zoë', 'ze1006'),
  driver('107', 'Fenwick, Oluwaseun', 'of1007', { active: false }),
  // Placeholder accounts that an Exclusion should remove.
  driver('900', 'Shop', 'Shop', { email: '' }),
  driver('901', 'Yard, Shuttle', 'yard01', { attributes: { Role: ['Placeholder'] }, email: '' }),
];

const MILE = 1609.344;

export const score = (driverId: string, safetyScore: number, miles: number): DailyScore => ({
  driverId,
  safetyScore,
  driveDistanceMeters: Math.round(miles * MILE),
});

export const day = (date: string, scores: DailyScore[]): DayScores => ({
  date,
  timeZone: 'America/Chicago',
  collectedAt: '2026-11-03T15:00:00.000Z',
  scores,
});

/** A small repeatable pseudo-random sequence, so the sample month is the same every time. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** A month of invented scores for the whole roster: mostly good days, some poor ones, some days off. */
export function sampleMonth(range: DateRange = { from: '2026-10-01', to: '2026-10-31' }): DayScores[] {
  const next = sequence(20261001);
  return eachDay(range).map((date) => {
    const scores: DailyScore[] = [];
    for (const d of roster) {
      const roll = next();
      const miles = Math.round(15 + next() * 240);
      const points = next();
      if (roll < 0.3) continue; // a day off
      const safetyScore = points < 0.7 ? 100 : points < 0.9 ? 90 + Math.floor(next() * 10) : 70 + Math.floor(next() * 20);
      scores.push(score(d.id, safetyScore, miles));
    }
    return day(date, scores);
  });
}
