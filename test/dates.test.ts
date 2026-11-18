import { describe, expect, it } from 'vitest';
import { addDays, dayWindow, eachDay, formatTicketDate, monthRange, parseIsoDate, previousMonth, startOfDay, todayIn } from '../src/dates.ts';

describe('day boundaries', () => {
  it('starts a Chicago day at local midnight in standard time (UTC-6)', () => {
    expect(startOfDay('2026-01-15', 'America/Chicago').toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });

  it('starts a Chicago day at local midnight in daylight time (UTC-5)', () => {
    expect(startOfDay('2026-07-15', 'America/Chicago').toISOString()).toBe('2026-07-15T05:00:00.000Z');
  });

  it('ends a day one second before the next local midnight', () => {
    const { start, end } = dayWindow('2026-10-17', 'America/Chicago');
    expect(start.toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-18T04:59:59.000Z');
  });

  it('gives the day clocks go back 25 hours and the day they go forward 23', () => {
    const hours = (date: string): number => {
      const { start, end } = dayWindow(date, 'America/Chicago');
      return (end.getTime() - start.getTime() + 1000) / 3_600_000;
    };
    expect(hours('2026-11-01')).toBe(25);
    expect(hours('2026-03-08')).toBe(23);
    expect(hours('2026-10-17')).toBe(24);
  });

  it('handles zones east of UTC and zones without daylight time', () => {
    expect(startOfDay('2026-10-17', 'Europe/Berlin').toISOString()).toBe('2026-10-16T22:00:00.000Z');
    expect(startOfDay('2026-07-15', 'America/Phoenix').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });
});

describe('periods', () => {
  it('takes last month from the local date, not the UTC date', () => {
    // 03:00 UTC on 1 November is still 31 October in Chicago, so last month is September.
    expect(previousMonth('America/Chicago', new Date('2026-11-01T03:00:00Z'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonth('America/Chicago', new Date('2026-11-03T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('wraps to December of the previous year in January', () => {
    expect(previousMonth('America/Chicago', new Date('2027-01-03T15:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('knows month lengths including leap years', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-02').to).toBe('2026-02-28');
    expect(() => monthRange('2026-13')).toThrow();
  });

  it('lists each day of a range across a month end', () => {
    expect(eachDay({ from: '2026-10-30', to: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(() => eachDay({ from: '2026-11-02', to: '2026-11-01' })).toThrow();
  });

  it('rejects dates that are not real', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow();
    expect(() => parseIsoDate('10/01/2026')).toThrow();
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('reads today in the time zone', () => {
    expect(todayIn('America/Chicago', new Date('2026-11-01T03:00:00Z'))).toBe('2026-10-31');
  });

  it('prints ticket dates in the locale', () => {
    expect(formatTicketDate('2026-10-01', 'en-US')).toBe('10/01/26');
    expect(formatTicketDate('2026-10-01', 'en-GB')).toBe('01/10/26');
  });
});
