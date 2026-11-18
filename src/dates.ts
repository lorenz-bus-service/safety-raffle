/** A calendar date written as YYYY-MM-DD. */
export type IsoDate = string;

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseIsoDate(date: IsoDate): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`"${date}" is not a date in YYYY-MM-DD form`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`"${date}" is not a real calendar date`);
  }
  return { year, month, day };
}

function toIsoDate(utc: Date): IsoDate {
  return utc.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  return toIsoDate(new Date(Date.UTC(year, month - 1, day + days)));
}

/** Milliseconds that the time zone's wall clock is ahead of UTC at the given instant. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the calendar date begins (local midnight) in the time zone. */
export function startOfDay(date: IsoDate, timeZone: string): Date {
  const { year, month, day } = parseIsoDate(date);
  const wallClock = Date.UTC(year, month - 1, day);
  // Two passes: the offset at the first guess can differ from the offset at the answer near a DST change.
  const firstGuess = wallClock - offsetMs(wallClock, timeZone);
  return new Date(wallClock - offsetMs(firstGuess, timeZone));
}

/** The window a Driver-Day covers: local midnight up to one second before the next local midnight. */
export function dayWindow(date: IsoDate, timeZone: string): { start: Date; end: Date } {
  const start = startOfDay(date, timeZone);
  const end = new Date(startOfDay(addDays(date, 1), timeZone).getTime() - 1000);
  return { start, end };
}

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The first and last day of a month written as YYYY-MM. */
export function monthRange(month: string): DateRange {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error(`"${month}" is not a month in YYYY-MM form`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    from: toIsoDate(new Date(Date.UTC(year, monthIndex, 1))),
    to: toIsoDate(new Date(Date.UTC(year, monthIndex + 1, 0))),
  };
}

/** The calendar month before the one that "now" falls in, in the time zone. */
export function previousMonth(timeZone: string, now: Date = new Date()): DateRange {
  const { year, month } = parseIsoDate(todayIn(timeZone, now));
  const firstOfPrevious = new Date(Date.UTC(year, month - 2, 1));
  return monthRange(firstOfPrevious.toISOString().slice(0, 7));
}

export function eachDay(range: DateRange): IsoDate[] {
  parseIsoDate(range.from);
  parseIsoDate(range.to);
  if (range.from > range.to) throw new Error(`The range starts (${range.from}) after it ends (${range.to})`);
  const days: IsoDate[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function monthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

/** Formats a date for printing on a Ticket, e.g. 10/01/26 for en-US. */
export function formatTicketDate(date: IsoDate, locale: string): string {
  const { year, month, day } = parseIsoDate(date);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: '2-digit', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export interface PeriodChoice {
  /** A calendar month, YYYY-MM. */
  period?: string;
  from?: string;
  to?: string;
  /** A single day. */
  date?: string;
}

/**
 * Turns the ways a period can be given into one range. With nothing given, it is last month.
 * The range must end before today in the time zone: a day's scores are not complete until it is over.
 */
export function resolveRange(choice: PeriodChoice, timeZone: string, now: Date = new Date()): DateRange {
  const given = (['period', 'from', 'date'] as const).filter((name) => choice[name]);
  if (given.length > 1) throw new Error('Give only one of a period, a from date and a single date');
  let range: DateRange;
  if (choice.period) range = monthRange(choice.period);
  else if (choice.date) range = { from: choice.date, to: choice.date };
  else if (choice.from) range = { from: choice.from, to: choice.to || choice.from };
  else if (choice.to) throw new Error('A to date needs a from date');
  else range = previousMonth(timeZone, now);

  parseIsoDate(range.from);
  parseIsoDate(range.to);
  if (range.from > range.to) throw new Error(`The range starts (${range.from}) after it ends (${range.to})`);
  const today = todayIn(timeZone, now);
  if (range.to >= today) {
    throw new Error(`The range must end before today (${today} in ${timeZone}); a day's scores are not complete until it is over`);
  }
  return range;
}
