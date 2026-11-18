import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import type { TicketRules } from '../src/config.ts';
import { buildTickets, byDriver, employeeIdOf, splitName, toMiles } from '../src/tickets.ts';
import { day, roster, score } from './fixtures/roster.ts';

const rules = (env: Record<string, string> = {}): TicketRules => loadConfig({ SAMSARA_API_TOKEN: 'x', ...env }).rules;
const keys = (tickets: { employeeId: string; date: string }[]): string[] => tickets.map((t) => `${t.employeeId} ${t.date}`);

describe('the ticket rule', () => {
  it('awards a ticket at exactly the minimum score but not at exactly the minimum miles', () => {
    const days = [
      day('2026-10-01', [score('101', 90, 21), score('102', 89, 200), score('103', 100, 20)]),
      day('2026-10-02', [score('101', 100, 20.4), score('102', 100, 20.6)]),
    ];
    const result = buildTickets(roster, days, rules());
    // 20.4 miles rounds to 20, which does not exceed 20; 20.6 rounds to 21, which does.
    expect(keys(result.tickets)).toEqual(['ma1001 2026-10-01', 'tb1002 2026-10-02']);
    expect(keys(result.nonQualifying).sort()).toEqual(['ic1003 2026-10-01', 'ma1001 2026-10-02', 'tb1002 2026-10-01']);
  });

  it('uses configured thresholds', () => {
    const days = [day('2026-10-01', [score('101', 95, 60), score('102', 96, 40), score('103', 96, 60)])];
    const result = buildTickets(roster, days, rules({ MINIMUM_SCORE: '96', MINIMUM_MILES: '50' }));
    expect(keys(result.tickets)).toEqual(['ic1003 2026-10-01']);
  });

  it('gives one ticket per driver per day with no cap', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03'].map((date) => day(date, [score('101', 100, 80)]));
    expect(buildTickets(roster, days, rules()).tickets).toHaveLength(3);
  });

  it('leaves a driver who did not move out of the non-qualifying list', () => {
    const result = buildTickets(roster, [day('2026-10-01', [score('101', 100, 0)])], rules());
    expect(result.tickets).toHaveLength(0);
    expect(result.nonQualifying).toHaveLength(0);
  });

  it('rounds metres to whole miles', () => {
    expect(toMiles(100_000)).toBe(62);
    expect(toMiles(0)).toBe(0);
  });
});

describe('who earns tickets', () => {
  const days = [day('2026-10-01', roster.map((d) => score(d.id, 100, 80)))];

  it('excludes nobody by default', () => {
    const result = buildTickets(roster, days, rules());
    expect(result.tickets).toHaveLength(roster.length);
    expect(result.excludedDrivers).toHaveLength(0);
  });

  it('excludes by username, tag and attribute, ignoring letter case', () => {
    const result = buildTickets(
      roster,
      days,
      rules({ EXCLUDE_USERNAMES: 'shop', EXCLUDE_TAGS: 'south depot', EXCLUDE_ATTRIBUTES: 'role=placeholder' }),
    );
    expect(result.excludedDrivers.map((d) => d.username).sort()).toEqual(['Shop', 'cd1004', 'tb1002', 'yard01']);
    expect(result.tickets.map((t) => t.employeeId)).not.toContain('tb1002');
    expect(result.tickets).toHaveLength(roster.length - 4);
  });

  it('ignores and reports scores for a driver who is not on the active roster', () => {
    const activeOnly = roster.filter((d) => d.active);
    const result = buildTickets(activeOnly, days, rules());
    expect(result.tickets.map((t) => t.employeeId)).not.toContain('of1007');
    expect(result.unknownDriverIds).toEqual(['107']);
  });

  it('restricts a run to given employee IDs', () => {
    const result = buildTickets(roster, days, rules(), { employeeIds: ['MA1001', 'cd1005'] });
    expect(keys(result.tickets)).toEqual(['ma1001 2026-10-01', 'cd1005 2026-10-01']);
  });
});

describe('employee ID and names', () => {
  it('uses the username by default and a named external ID when configured', () => {
    const maren = roster[0]!;
    expect(employeeIdOf(maren, rules())).toBe('ma1001');
    expect(employeeIdOf(maren, rules({ EMPLOYEE_ID_SOURCE: 'payrollid' }))).toBe('P-101');
    expect(employeeIdOf(maren, rules({ EMPLOYEE_ID_SOURCE: 'missing' }))).toBe('');
  });

  it('splits both name forms', () => {
    expect(splitName('Agudo Aucapina, Jaime')).toEqual({ surname: 'Agudo Aucapina', firstName: 'Jaime' });
    expect(splitName('Mary Ann Smith')).toEqual({ surname: 'Smith', firstName: 'Mary Ann' });
    expect(splitName('Shop')).toEqual({ surname: 'Shop', firstName: '' });
  });
});

describe('print order', () => {
  const days = [
    day('2026-10-02', roster.slice(0, 6).map((d) => score(d.id, 100, 80))),
    day('2026-10-01', roster.slice(0, 6).map((d) => score(d.id, 100, 80))),
  ];

  it('sorts by surname, first name, employee ID, then date', () => {
    const result = buildTickets(roster, days, rules());
    expect(keys(result.tickets)).toEqual([
      'ma1001 2026-10-01', 'ma1001 2026-10-02',
      'tb1002 2026-10-01', 'tb1002 2026-10-02',
      'ic1003 2026-10-01', 'ic1003 2026-10-02',
      'cd1004 2026-10-01', 'cd1004 2026-10-02',
      'cd1005 2026-10-01', 'cd1005 2026-10-02',
      'ze1006 2026-10-01', 'ze1006 2026-10-02',
    ]);
  });

  it('groups by tag in the configured order, with untagged drivers last', () => {
    const result = buildTickets(roster, days, rules({ GROUP_BY_TAGS: 'South Depot,North Depot' }));
    expect(byDriver(result.tickets).map((d) => `${d.group}:${d.employeeId}`)).toEqual([
      'South Depot:tb1002', 'South Depot:cd1004',
      'North Depot:ma1001', 'North Depot:ic1003', 'North Depot:cd1005',
      ':ze1006',
    ]);
  });

  it('keeps two drivers with the same name apart', () => {
    const result = byDriver(buildTickets(roster, days, rules()).tickets).filter((d) => d.surname === 'Dunmore');
    expect(result.map((d) => [d.employeeId, d.tickets.length])).toEqual([['cd1004', 2], ['cd1005', 2]]);
  });
});
