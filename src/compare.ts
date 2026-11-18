import type { TicketResult } from './tickets.ts';

/** Parses CSV text with optional double-quoted fields into rows keyed by the header line. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const character = source[i] as string;
    if (quoted) {
      if (character === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);

  const header = rows.shift() ?? [];
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ''])));
}

export interface Comparison {
  matched: number;
  /** In the reference file but not produced here, with what this project sees for that Driver-Day. */
  onlyInReference: { employeeId: string; date: string; seenHere: string }[];
  /** Produced here but absent from the reference file. */
  onlyHere: { employeeId: string; date: string; safetyScore: number; milesDriven: number }[];
}

const keyOf = (employeeId: string, date: string): string => `${employeeId.trim().toLowerCase()}|${date}`;

/**
 * Compares the Tickets this project produces with a CSV from the earlier PowerShell script
 * (columns EmployeeId and FromDate), Ticket for Ticket.
 */
export function compareWithReference(built: TicketResult, reference: Record<string, string>[]): Comparison {
  const here = new Map(built.tickets.map((t) => [keyOf(t.employeeId, t.date), t]));
  const missed = new Map(built.nonQualifying.map((t) => [keyOf(t.employeeId, t.date), t]));
  const referenceKeys = new Set<string>();
  const comparison: Comparison = { matched: 0, onlyInReference: [], onlyHere: [] };

  for (const row of reference) {
    const employeeId = row.EmployeeId ?? '';
    const date = (row.FromDate ?? row.Date ?? '').slice(0, 10);
    const key = keyOf(employeeId, date);
    referenceKeys.add(key);
    if (here.has(key)) {
      comparison.matched += 1;
      continue;
    }
    const seen = missed.get(key);
    comparison.onlyInReference.push({
      employeeId,
      date,
      seenHere: seen
        ? `score ${seen.safetyScore}, ${seen.milesDriven} miles (reference: score ${row.SafetyScore ?? '?'}, ${row.MilesDriven ?? '?'} miles)`
        : `no driving recorded (reference: score ${row.SafetyScore ?? '?'}, ${row.MilesDriven ?? '?'} miles)`,
    });
  }
  for (const [key, ticket] of here) {
    if (!referenceKeys.has(key)) {
      comparison.onlyHere.push({
        employeeId: ticket.employeeId,
        date: ticket.date,
        safetyScore: ticket.safetyScore,
        milesDriven: ticket.milesDriven,
      });
    }
  }
  return comparison;
}
