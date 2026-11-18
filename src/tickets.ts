import type { TicketRules } from './config.ts';
import type { IsoDate } from './dates.ts';

export interface Driver {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  tags: string[];
  attributes: Record<string, string[]>;
  externalIds: Record<string, string>;
}

/** The Safety Score and Miles Driven recorded for one Driver on one day. */
export interface DailyScore {
  driverId: string;
  safetyScore: number;
  driveDistanceMeters: number;
}

/** Everything collected for one calendar day. */
export interface DayScores {
  date: IsoDate;
  timeZone: string;
  collectedAt: string;
  scores: DailyScore[];
}

export interface Ticket {
  driverId: string;
  employeeId: string;
  firstName: string;
  surname: string;
  email: string;
  date: IsoDate;
  safetyScore: number;
  milesDriven: number;
  /** The tag this Driver's Tickets are grouped under, or '' when grouping is off or no tag matched. */
  group: string;
}

export interface TicketResult {
  /** Driver-Days that earned a Ticket, in print order. */
  tickets: Ticket[];
  /** Driver-Days with some driving that did not earn a Ticket, in the same shape and order. */
  nonQualifying: Ticket[];
  excludedDrivers: Driver[];
  /** Driver IDs that had scores but are not in the roster (for example, deactivated Drivers when those are not included). */
  unknownDriverIds: string[];
}

const METERS_TO_MILES = 0.00062137119224;

export function toMiles(meters: number): number {
  return Math.round(meters * METERS_TO_MILES);
}

/** A Driver-Day qualifies when the score meets the minimum and the miles exceed the minimum. */
export function qualifies(safetyScore: number, milesDriven: number, rules: TicketRules): boolean {
  return safetyScore >= rules.minimumScore && milesDriven > rules.minimumMiles;
}

/** Splits "Surname, First" (Samsara's usual form here) or "First Surname". */
export function splitName(name: string): { firstName: string; surname: string } {
  const trimmed = name.trim();
  const comma = trimmed.indexOf(',');
  if (comma >= 0) {
    return { surname: trimmed.slice(0, comma).trim(), firstName: trimmed.slice(comma + 1).trim() };
  }
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace < 0) return { firstName: '', surname: trimmed };
  return { firstName: trimmed.slice(0, lastSpace).trim(), surname: trimmed.slice(lastSpace + 1).trim() };
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function employeeIdOf(driver: Driver, rules: TicketRules): string {
  if (same(rules.employeeIdSource, 'username')) return driver.username;
  const key = Object.keys(driver.externalIds).find((name) => same(name, rules.employeeIdSource));
  return key ? (driver.externalIds[key] ?? '') : '';
}

export function isExcluded(driver: Driver, rules: TicketRules): boolean {
  if (rules.excludeUsernames.some((username) => same(username, driver.username))) return true;
  if (rules.excludeTags.some((tag) => driver.tags.some((driverTag) => same(tag, driverTag)))) return true;
  return rules.excludeAttributes.some(({ name, value }) =>
    Object.entries(driver.attributes).some(
      ([attributeName, values]) => same(attributeName, name) && values.some((v) => same(v, value)),
    ),
  );
}

function groupOf(driver: Driver, rules: TicketRules): string {
  return rules.groupByTags.find((tag) => driver.tags.some((driverTag) => same(tag, driverTag))) ?? '';
}

export interface BuildOptions {
  /** Restrict the result to these Employee IDs. Empty or absent means everyone. */
  employeeIds?: string[];
}

export function buildTickets(drivers: Driver[], days: DayScores[], rules: TicketRules, options: BuildOptions = {}): TicketResult {
  const only = (options.employeeIds ?? []).filter((id) => id.trim() !== '');
  const roster = new Map(drivers.map((driver) => [driver.id, driver]));
  const excludedDrivers = drivers.filter((driver) => isExcluded(driver, rules));
  const excludedIds = new Set(excludedDrivers.map((driver) => driver.id));
  const unknown = new Set<string>();

  const tickets: Ticket[] = [];
  const nonQualifying: Ticket[] = [];

  for (const day of days) {
    for (const score of day.scores) {
      const driver = roster.get(score.driverId);
      if (!driver) {
        unknown.add(score.driverId);
        continue;
      }
      if (excludedIds.has(driver.id)) continue;
      const employeeId = employeeIdOf(driver, rules);
      if (only.length > 0 && !only.some((id) => same(id, employeeId))) continue;

      const milesDriven = toMiles(score.driveDistanceMeters);
      const entry: Ticket = {
        driverId: driver.id,
        employeeId,
        ...splitName(driver.name),
        email: driver.email,
        date: day.date,
        safetyScore: score.safetyScore,
        milesDriven,
        group: groupOf(driver, rules),
      };
      if (qualifies(score.safetyScore, milesDriven, rules)) tickets.push(entry);
      else if (score.driveDistanceMeters > 0) nonQualifying.push(entry);
    }
  }

  const order = printOrder(rules);
  tickets.sort(order);
  nonQualifying.sort(order);
  return { tickets, nonQualifying, excludedDrivers, unknownDriverIds: [...unknown].sort() };
}

/** Group (in configured order, ungrouped last), then surname, first name, Employee ID and date. */
function printOrder(rules: TicketRules): (a: Ticket, b: Ticket) => number {
  const rank = (group: string): number => {
    const index = rules.groupByTags.findIndex((tag) => same(tag, group));
    return index < 0 ? rules.groupByTags.length : index;
  };
  const compare = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return (a, b) =>
    rank(a.group) - rank(b.group) ||
    compare(a.surname, b.surname) ||
    compare(a.firstName, b.firstName) ||
    compare(a.employeeId, b.employeeId) ||
    a.driverId.localeCompare(b.driverId) ||
    a.date.localeCompare(b.date);
}

/** Identifies a Ticket across runs: one Driver on one day. */
export function ticketKey(ticket: { driverId: string; date: IsoDate }): string {
  return `${ticket.driverId}|${ticket.date}`;
}

export interface DriverSummary {
  driverId: string;
  employeeId: string;
  firstName: string;
  surname: string;
  email: string;
  group: string;
  tickets: Ticket[];
}

/** Tickets gathered per Driver, keeping print order. */
export function byDriver(tickets: Ticket[]): DriverSummary[] {
  const summaries = new Map<string, DriverSummary>();
  for (const ticket of tickets) {
    let summary = summaries.get(ticket.driverId);
    if (!summary) {
      const { driverId, employeeId, firstName, surname, email, group } = ticket;
      summary = { driverId, employeeId, firstName, surname, email, group, tickets: [] };
      summaries.set(ticket.driverId, summary);
    }
    summary.tickets.push(ticket);
  }
  return [...summaries.values()];
}
