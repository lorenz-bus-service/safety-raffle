import type { RerunMode } from './config.ts';
import { monthOf } from './dates.ts';
import type { IsoDate } from './dates.ts';
import { readJson, writeJson } from './storage.ts';
import type { Storage } from './storage.ts';
import { ticketKey } from './tickets.ts';
import type { Ticket } from './tickets.ts';

/** One Ticket that has been issued, as remembered between runs. */
export interface IssuedTicket {
  driverId: string;
  employeeId: string;
  firstName: string;
  surname: string;
  date: IsoDate;
  issuedAt: string;
}

const ledgerKey = (month: string): string => `issued/${month}.json`;

export async function readIssued(storage: Storage, months: string[]): Promise<IssuedTicket[]> {
  const issued: IssuedTicket[] = [];
  for (const month of months) {
    issued.push(...((await readJson<IssuedTicket[]>(storage, ledgerKey(month))) ?? []));
  }
  return issued;
}

export interface IssuePlan {
  /** Tickets to print in this run. */
  toIssue: Ticket[];
  /** Tickets issued by an earlier run that no longer qualify. They are reported, never taken back. */
  noLongerQualifying: IssuedTicket[];
  /** What the record of issued Tickets should hold after this run. */
  ledger: IssuedTicket[];
  /** True when earlier Tickets exist for the scope of this run. */
  isRerun: boolean;
}

/**
 * Decides which Tickets this run prints.
 * `inScope` says whether an earlier Ticket falls within this run's dates and Driver restriction;
 * Tickets outside that scope are left untouched.
 */
export function planIssue(
  current: Ticket[],
  previouslyIssued: IssuedTicket[],
  mode: RerunMode,
  inScope: (issued: IssuedTicket) => boolean,
  issuedAt: string,
): IssuePlan {
  const currentKeys = new Set(current.map(ticketKey));
  const scoped = previouslyIssued.filter(inScope);
  const scopedKeys = new Set(scoped.map(ticketKey));
  const outOfScope = previouslyIssued.filter((issued) => !inScope(issued));
  const noLongerQualifying = scoped.filter((issued) => !currentKeys.has(ticketKey(issued)));

  const record = (ticket: Ticket): IssuedTicket => ({
    driverId: ticket.driverId,
    employeeId: ticket.employeeId,
    firstName: ticket.firstName,
    surname: ticket.surname,
    date: ticket.date,
    issuedAt,
  });

  if (mode === 'full') {
    return { toIssue: current, noLongerQualifying, ledger: [...outOfScope, ...current.map(record)], isRerun: scoped.length > 0 };
  }
  const toIssue = current.filter((ticket) => !scopedKeys.has(ticketKey(ticket)));
  return {
    toIssue,
    noLongerQualifying,
    // Earlier Tickets stay on record even if they no longer qualify: they are in a Driver's hands.
    ledger: [...previouslyIssued, ...toIssue.map(record)],
    isRerun: scoped.length > 0,
  };
}

export async function writeIssued(storage: Storage, months: string[], ledger: IssuedTicket[]): Promise<void> {
  for (const month of months) {
    const entries = ledger
      .filter((issued) => monthOf(issued.date) === month)
      .sort((a, b) => a.driverId.localeCompare(b.driverId) || a.date.localeCompare(b.date));
    await writeJson(storage, ledgerKey(month), entries);
  }
}
